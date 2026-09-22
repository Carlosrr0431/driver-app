/**
 * Componente: TripMap
 * Mapa de viaje con MapLibre Native (vector tiles OpenFreeMap bright),
 * ruta OSRM y navegación in-app con cámara adaptativa.
 */
import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import MapLibreGL from '../../lib/maplibre';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { decodePolyline } from '../../utils/polyline';
import { projectPointOntoPolyline, prependDriverConnector } from '../../services/navigation';
import { MAPLIBRE_STYLE } from '../../utils/mapProvider';
import {
  ARRIVAL_DISTANCE_METERS,
  NAV_ZOOM_CEILING,
  resolveFollowPadding,
  resolveNavigationCameraPitch,
  resolveNavigationCameraZoom,
  resolveSettledOverviewZoom,
} from '../../utils/tripMapCamera';
import { MapRouteLayers } from './MapRouteLayers';
import RouteEndMarker from './RouteEndMarker';
import DriverNavMarker from './DriverNavMarker';
import { DRIVER_PUCK_SIZE_IDLE } from './driverPuckSizes';
import { useSmoothMapCoords } from '../../hooks/useSmoothMapCoords';

/* ── Constantes de navegación ────────────────────────────────────────────── */
const NAV_PITCH_NORTH_UP = 12;
const NAV_PITCH_FOLLOW   = 52;
const NAV_HEADING_SMOOTH_FACTOR = 0.26;
const ON_ROUTE_SNAP_MAX_M = 32;
/** Padding norte geográfico arriba. */
const NAV_PADDING_NORTH_UP = { top: 56, bottom: 200, left: 48, right: 48 };

function buildCornerAwareFollowPadding(controlsBottomOffset, turn, factor, viewportHeight) {
  const base = resolveFollowPadding({ controlsBottomOffset, viewportHeight });
  if (!turn || factor <= 0.05) return base;
  const extra = Math.round(factor * 64);
  if (turn.turnSide === 'right') {
    return { ...base, left: base.left + extra };
  }
  return { ...base, right: base.right + extra };
}

function getFollowAheadMeters(speedKmh) {
  if (speedKmh >= 50) return 36;
  if (speedKmh >= 25) return 26;
  if (speedKmh >= 8) return 18;
  return 12;
}

const TRIP_VIEW_MARKER_OUTER = Math.round(DRIVER_PUCK_SIZE_IDLE * 0.9);
const TRIP_VIEW_MARKER_RING = Math.round(DRIVER_PUCK_SIZE_IDLE * 0.66);
const TRIP_VIEW_MARKER_CORE = Math.round(DRIVER_PUCK_SIZE_IDLE * 0.55);
const FREE_RIDE_CAMERA_PADDING = { top: 56, bottom: 120, left: 44, right: 44 };
const SALTA_DEFAULT = [-65.42, -24.78]; // [lng, lat]

/* ── Funciones geométricas (sin cambios) ─────────────────────────────────── */
function getBearing(from, to) {
  if (!from || !to) return 0;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const dLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function moveCoordinate(point, bearing, distanceMeters) {
  const R = 6378137;
  const lat1 = (point.latitude * Math.PI) / 180;
  const lng1 = (point.longitude * Math.PI) / 180;
  const brng = (bearing * Math.PI) / 180;
  const angDist = distanceMeters / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
    Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { latitude: (lat2 * 180) / Math.PI, longitude: (lng2 * 180) / Math.PI };
}

function snapCoordToSegment(point, a, b) {
  const dx = b.longitude - a.longitude;
  const dy = b.latitude - a.latitude;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  let t = ((point.longitude - a.longitude) * dx + (point.latitude - a.latitude) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { latitude: a.latitude + t * dy, longitude: a.longitude + t * dx };
}

function snapToPolyline(point, coords) {
  if (!point || coords.length < 2) return point;
  let nearest = null;
  let nearestDist = Infinity;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const snapped = snapCoordToSegment(point, coords[i], coords[i + 1]);
    const d = coordDistMeters(point, snapped);
    if (d < nearestDist) { nearestDist = d; nearest = snapped; }
  }
  return nearest && nearestDist < 40 ? nearest : point;
}

function buildActiveRoutePolyline(driverCoord, routeCoords, projection = null) {
  if (!routeCoords || routeCoords.length < 2) return [];
  if (!driverCoord) return routeCoords;

  const resolved = projection?.snappedPoint
    ? projection
    : projectPointOntoPolyline(
      { latitude: driverCoord.latitude, longitude: driverCoord.longitude },
      routeCoords,
    );
  const snapped = resolved.snappedPoint;
  if (!snapped) return routeCoords;

  const idx = Math.max(0, Math.min(resolved.segmentIndex, routeCoords.length - 2));
  const forward = routeCoords.slice(idx + 1);
  const coords = [snapped, ...forward];
  return coords.filter((point, index) => {
    if (index === 0) return true;
    return coordDistMeters(coords[index - 1], point) > 1.5;
  });
}

function smoothAngle(current, target, factor) {
  const diff = ((target - current + 540) % 360) - 180;
  return (current + diff * factor + 360) % 360;
}

function coordDistMeters(a, b) {
  const R = 6378137;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function interpolateAlongPolyline(routeCoords, distanceAlongMeters) {
  if (!routeCoords?.length) return null;
  if (distanceAlongMeters <= 0) return routeCoords[0];

  let accumulated = 0;
  for (let i = 0; i < routeCoords.length - 1; i += 1) {
    const a = routeCoords[i];
    const b = routeCoords[i + 1];
    const segLen = coordDistMeters(a, b);
    if (accumulated + segLen >= distanceAlongMeters) {
      const frac = segLen > 0 ? (distanceAlongMeters - accumulated) / segLen : 0;
      return {
        latitude: a.latitude + frac * (b.latitude - a.latitude),
        longitude: a.longitude + frac * (b.longitude - a.longitude),
      };
    }
    accumulated += segLen;
  }
  return routeCoords[routeCoords.length - 1];
}

function getPointAheadOnPolyline(origin, routeCoords, metersAhead = 40) {
  if (!origin || routeCoords.length < 2) return null;
  const projection = projectPointOntoPolyline(origin, routeCoords);
  const from = projection.snappedPoint || origin;
  const ahead = interpolateAlongPolyline(
    routeCoords,
    projection.distanceAlongMeters + Math.max(6, metersAhead),
  );
  if (!ahead || coordDistMeters(from, ahead) < 2) {
    const idx = Math.min(projection.segmentIndex + 1, routeCoords.length - 1);
    return routeCoords[idx];
  }
  return ahead;
}

function angleDiff(a, b) {
  return Math.abs(((b - a + 540) % 360) - 180);
}

function getTurnSide(bearingIn, bearingOut) {
  const delta = ((bearingOut - bearingIn + 540) % 360) - 180;
  return delta > 0 ? 'right' : 'left';
}

function distanceAlongPolylineToVertex(routeCoords, vertexIndex) {
  let distance = 0;
  for (let i = 0; i < vertexIndex && i < routeCoords.length - 1; i += 1) {
    distance += coordDistMeters(routeCoords[i], routeCoords[i + 1]);
  }
  return distance;
}

/** Próximo giro significativo adelante en la polilínea restante. */
function findUpcomingTurn(origin, routeCoords, minTurnAngle = 22) {
  if (!origin || routeCoords.length < 3) return null;

  const projection = projectPointOntoPolyline(origin, routeCoords);
  const driverAlong = projection.distanceAlongMeters;
  const segIdx = projection.segmentIndex;

  for (let vtx = segIdx + 1; vtx < routeCoords.length - 1; vtx += 1) {
    const prev = routeCoords[vtx - 1];
    const turnPoint = routeCoords[vtx];
    const next = routeCoords[vtx + 1];
    const bearingIn = getBearing(prev, turnPoint);
    const bearingOut = getBearing(turnPoint, next);
    const turnAngle = angleDiff(bearingIn, bearingOut);
    if (turnAngle < minTurnAngle) continue;

    const distToTurn = distanceAlongPolylineToVertex(routeCoords, vtx) - driverAlong;
    if (distToTurn <= 0 || distToTurn > 450) continue;

    return {
      distanceMeters: distToTurn,
      turnAngle,
      bearingIn,
      bearingOut,
      turnPoint,
      afterPoint: next,
      turnSide: getTurnSide(bearingIn, bearingOut),
    };
  }
  return null;
}

function getAnticipationZoneMeters(speedKmh, turnAngle) {
  let zone = 85;
  if (speedKmh >= 50) zone = 200;
  else if (speedKmh >= 30) zone = 155;
  else if (speedKmh >= 12) zone = 115;

  if (turnAngle >= 75) zone *= 1.3;
  else if (turnAngle >= 45) zone *= 1.15;
  return zone;
}

function getCornerAnticipationFactor(distanceMeters, speedKmh, turnAngle) {
  const zone = getAnticipationZoneMeters(speedKmh, turnAngle);
  if (!Number.isFinite(distanceMeters) || distanceMeters > zone) return 0;
  const raw = Math.max(0, 1 - distanceMeters / zone);
  return raw * raw * (3 - 2 * raw);
}

function buildCornerAwareNorthPadding(turn, factor) {
  const base = { ...NAV_PADDING_NORTH_UP };
  if (!turn || factor <= 0.05) return base;
  const sideInset = Math.round(factor * 72);
  const topInset = base.top + Math.round(factor * 42);
  if (turn.turnSide === 'right') {
    return { ...base, top: topInset, left: base.left + sideInset };
  }
  return { ...base, top: topInset, right: base.right + sideInset };
}

function getAnticipatedCameraCenter({
  navAnchor,
  cameraHeading,
  speedKmh,
  routeCoords,
  northUp,
}) {
  const turn = findUpcomingTurn(navAnchor, routeCoords);
  const factor = turn
    ? getCornerAnticipationFactor(turn.distanceMeters, speedKmh, turn.turnAngle)
    : 0;

  if (!northUp) {
    const aheadMeters = getFollowAheadMeters(speedKmh) + factor * 24;
    let center = moveCoordinate(navAnchor, cameraHeading, aheadMeters);

    if (turn && factor > 0.03) {
      const afterDist = Math.min(100, 28 + turn.turnAngle * 0.8);
      const postTurnPoint = moveCoordinate(turn.turnPoint, turn.bearingOut, afterDist);
      const pull = factor * 0.65;
      const apexPull = factor * 0.3;
      center = {
        latitude:
          center.latitude
          + (postTurnPoint.latitude - center.latitude) * pull
          + (turn.turnPoint.latitude - center.latitude) * apexPull,
        longitude:
          center.longitude
          + (postTurnPoint.longitude - center.longitude) * pull
          + (turn.turnPoint.longitude - center.longitude) * apexPull,
      };
    }
    return { center, factor, turn };
  }

  let center = { ...navAnchor };
  if (turn && factor > 0.03) {
    const revealBearing = (turn.bearingOut + 180) % 360;
    const offsetMeters = factor * (32 + turn.turnAngle * 0.55);
    center = moveCoordinate(navAnchor, revealBearing, offsetMeters);
    const forwardMeters = factor * Math.min(turn.distanceMeters * 0.38, 38);
    center = moveCoordinate(center, turn.bearingIn, forwardMeters);
  }
  return { center, factor, turn };
}

function getLookaheadMeters(speedKmh, cornerFactor = 0) {
  let base = 14;
  if (speedKmh >= 55) base = 48;
  else if (speedKmh >= 30) base = 32;
  else if (speedKmh >= 12) base = 22;
  return base + cornerFactor * 40;
}

function getNavigationBearing(origin, routeCoords, speedKmh = 0, lookAheadOverride = null) {
  if (!origin || routeCoords.length < 2) return 0;
  const projection = projectPointOntoPolyline(origin, routeCoords);
  const from = projection.snappedPoint || origin;
  const segIdx = Math.min(projection.segmentIndex, routeCoords.length - 2);
  const segmentBearing = getBearing(routeCoords[segIdx], routeCoords[segIdx + 1]);
  const lookAhead = Number.isFinite(lookAheadOverride)
    ? lookAheadOverride
    : getLookaheadMeters(speedKmh);
  const ahead = getPointAheadOnPolyline(origin, routeCoords, lookAhead);
  if (!ahead) return segmentBearing;
  const forwardBearing = getBearing(from, ahead);
  const diff = Math.abs(((forwardBearing - segmentBearing + 540) % 360) - 180);
  if (diff > 22) {
    return smoothAngle(forwardBearing, segmentBearing, diff > 40 ? 0.62 : 0.45);
  }
  return forwardBearing;
}

function getAnticipatedNavigationBearing(origin, routeCoords, speedKmh) {
  const turn = findUpcomingTurn(origin, routeCoords);
  const cornerFactor = turn
    ? getCornerAnticipationFactor(turn.distanceMeters, speedKmh, turn.turnAngle)
    : 0;
  const lookAhead = getLookaheadMeters(speedKmh, cornerFactor);
  const base = getNavigationBearing(origin, routeCoords, speedKmh, lookAhead);
  if (!turn || cornerFactor <= 0.03) return base;

  const turnBlend = turn.turnAngle >= 60 ? 0.92 : turn.turnAngle >= 35 ? 0.78 : 0.62;
  return smoothAngle(base, turn.bearingOut, cornerFactor * turnBlend);
}

const FREE_RIDE_ZOOM_TIERS = [
  { minKmh: 65, zoom: 14.2 },
  { minKmh: 40, zoom: 14.6 },
  { minKmh: 20, zoom: 15.0 },
  { minKmh: 0,  zoom: 15.4 },
];

function getZoomFromTiers(speedKmh, tiers, fallback) {
  for (const tier of tiers) {
    if (speedKmh >= tier.minKmh) return tier.zoom;
  }
  return fallback;
}

function getFreeRideRouteSpanMeters(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const point of coords) {
    if (!Number.isFinite(point?.latitude) || !Number.isFinite(point?.longitude)) continue;
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
  }
  if (!Number.isFinite(minLat)) return 0;
  return coordDistMeters(
    { latitude: maxLat, longitude: minLng },
    { latitude: minLat, longitude: maxLng },
  );
}

/** Zoom más abierto para ver el recorrido GPS sin perder contexto urbano. */
function getFreeRideZoom(speedKmh, traveledCoords = []) {
  let zoom = getZoomFromTiers(speedKmh, FREE_RIDE_ZOOM_TIERS, 15.4);
  const spanM = getFreeRideRouteSpanMeters(traveledCoords);
  if (spanM > 80) zoom = Math.min(zoom, 15.1);
  if (spanM > 200) zoom = Math.min(zoom, 14.7);
  if (spanM > 450) zoom = Math.min(zoom, 14.3);
  if (spanM > 900) zoom = Math.min(zoom, 13.9);
  if (spanM > 1800) zoom = Math.min(zoom, 13.4);
  if (spanM > 3500) zoom = Math.min(zoom, 12.9);
  return Math.max(12.6, zoom);
}

/* ── Marcador de punto (origen / destino) ────────────────────────────────── */
const PointMarkerAnnotation = React.memo(({ coordinate, type }) => {
  const isOrigin = type === 'origin';
  const id = isOrigin ? 'origin-marker' : 'dest-marker';
  return (
    <MapLibreGL.PointAnnotation
      id={id}
      coordinate={[coordinate.longitude, coordinate.latitude]}
    >
      <View style={[styles.pointMarker, { backgroundColor: isOrigin ? colors.success : colors.danger }]}>
        <MaterialCommunityIcons
          name={isOrigin ? 'radiobox-marked' : 'flag-variant'}
          size={14}
          color="#fff"
        />
      </View>
    </MapLibreGL.PointAnnotation>
  );
});

/* ── Componente principal ────────────────────────────────────────────────── */
export const TripMap = React.memo(({
  driverLocation,
  origin,
  destination,
  polyline,
  routeCoords: routeCoordsProp = [],
  routeSteps = [],
  routeRevision = 0,
  isRerouting = false,
  heading = 0,
  navigationMode = false,
  threeDEnabled = false,
  freeRideMode = false,
  traveledRouteCoords = [],
  onToggleThreeD,
  onToggleVoiceMute,
  isVoiceMuted = false,
  controlsBottomOffset = 16,
  remainingDistanceMeters = null,
  routeEndVariant = 'destination',
  style,
}) => {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const cameraRef = useRef(null);
  const hasFitted = useRef(false);
  const lastNearestIdxRef = useRef(0);
  const lastRouteRevisionRef = useRef(-1);
  const smoothHeadingRef = useRef(null);
  const lastCameraTimeRef = useRef(0);
  const lastZoomTierRef = useRef(null);
  const freeRideCameraBootstrappedRef = useRef(false);
  const prevNavigationModeRef = useRef(navigationMode);
  const needsSettleRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const routeCoords = useMemo(() => {
    if (Array.isArray(routeCoordsProp) && routeCoordsProp.length > 0) return routeCoordsProp;
    if (polyline) return decodePolyline(polyline);
    return [];
  }, [routeCoordsProp, polyline]);

  /* ── Coordenadas del conductor ─────────────────────────────────────────── */
  const smoothGps = useSmoothMapCoords(
    driverLocation?.lat,
    driverLocation?.lng,
    driverLocation?.speed,
    heading,
  );
  const driverCoord = useMemo(() => {
    if (!Number.isFinite(Number(smoothGps?.lat)) || !Number.isFinite(Number(smoothGps?.lng))) {
      return null;
    }
    if (!smoothGps.lat && !smoothGps.lng) return null;
    return { latitude: smoothGps.lat, longitude: smoothGps.lng };
  }, [smoothGps.lat, smoothGps.lng]);

  /* ── Proyección única sobre la ruta (no repetir haversine por frame) ───── */
  const routeProjection = useMemo(() => {
    if (!driverCoord || routeCoords.length < 2) {
      return { deviationMeters: Infinity, snappedPoint: null, segmentIndex: 0 };
    }
    return projectPointOntoPolyline(driverCoord, routeCoords, {
      hintSegmentIndex: lastNearestIdxRef.current,
    });
  }, [driverCoord, routeCoords]);

  const remainingRouteCoords = useMemo(() => {
    if (routeCoords.length === 0) return [];
    if (!driverCoord) return routeCoords;
    const projectedIdx = Number.isFinite(routeProjection.segmentIndex)
      ? routeProjection.segmentIndex
      : 0;
    const idx = Math.max(lastNearestIdxRef.current, projectedIdx);
    lastNearestIdxRef.current = idx;
    if (idx === projectedIdx) {
      return buildActiveRoutePolyline(driverCoord, routeCoords, routeProjection);
    }
    return buildActiveRoutePolyline(driverCoord, routeCoords.slice(idx));
  }, [driverCoord, routeCoords, routeProjection]);

  const isOnRoute = useMemo(() => (
    Number.isFinite(routeProjection.deviationMeters)
    && routeProjection.deviationMeters <= ON_ROUTE_SNAP_MAX_M
  ), [routeProjection.deviationMeters]);

  const snappedDriverCoord = useMemo(() => {
    if (!driverCoord) return null;
    if (navigationMode) {
      return routeProjection.snappedPoint ?? driverCoord;
    }
    if (!isOnRoute) return driverCoord;
    const forwardPolyline = remainingRouteCoords.length >= 2 ? remainingRouteCoords : routeCoords;
    if (forwardPolyline.length < 2) return driverCoord;
    return snapToPolyline(driverCoord, forwardPolyline) ?? driverCoord;
  }, [driverCoord, navigationMode, remainingRouteCoords, routeCoords, isOnRoute, routeProjection.snappedPoint]);

  const driverMarkerCoord = useMemo(() => {
    if (!driverCoord) return null;
    return snappedDriverCoord ?? driverCoord;
  }, [driverCoord, snappedDriverCoord]);

  const displayRouteCoords = useMemo(() => {
    if (isRerouting) return [];
    if (!driverCoord) return routeCoords.length >= 2 ? routeCoords : [];
    // En navegación activa, si el tramo restante es muy corto (chofer llegando),
    // mostrar la ruta completa para que la polilínea nunca desaparezca.
    if (navigationMode) {
      return remainingRouteCoords.length >= 2 ? remainingRouteCoords : routeCoords;
    }
    if (remainingRouteCoords.length < 2) return [];
    const connectorThreshold = isOnRoute ? 10 : 4;
    const routeAnchor = isOnRoute ? (snappedDriverCoord ?? driverCoord) : driverCoord;
    return prependDriverConnector(routeAnchor, remainingRouteCoords, connectorThreshold);
  }, [isRerouting, remainingRouteCoords, routeCoords, driverCoord, snappedDriverCoord, isOnRoute, navigationMode]);

  const traveledRouteDisplayCoords = useMemo(() => {
    if (!freeRideMode || !Array.isArray(traveledRouteCoords) || traveledRouteCoords.length === 0) {
      return [];
    }
    if (!driverCoord) return traveledRouteCoords;
    const last = traveledRouteCoords[traveledRouteCoords.length - 1];
    if (!last) return traveledRouteCoords;
    if (coordDistMeters(last, driverCoord) < 2) return traveledRouteCoords;
    return [...traveledRouteCoords, driverCoord];
  }, [freeRideMode, traveledRouteCoords, driverCoord]);

  const navigationSpeedKmh = useMemo(() => {
    const speedMps = Number(driverLocation?.speed);
    return Number.isFinite(speedMps) && speedMps > 0 ? speedMps * 3.6 : 0;
  }, [driverLocation?.speed]);

  const routeHeading = useMemo(() => {
    const originPoint = snappedDriverCoord || driverCoord;
    const bearingRoute = remainingRouteCoords.length >= 2
      ? remainingRouteCoords
      : routeCoords;
    if (navigationMode) {
      if (!originPoint || bearingRoute.length < 2) return smoothHeadingRef.current ?? 0;
      return getAnticipatedNavigationBearing(originPoint, bearingRoute, navigationSpeedKmh);
    }
    if (!isOnRoute && Number.isFinite(heading)) return heading;
    if (!originPoint || bearingRoute.length < 2) {
      return Number.isFinite(heading) ? heading : 0;
    }
    return getAnticipatedNavigationBearing(originPoint, bearingRoute, navigationSpeedKmh);
  }, [navigationMode, isOnRoute, heading, snappedDriverCoord, driverCoord, routeCoords, remainingRouteCoords, navigationSpeedKmh]);

  useEffect(() => {
    if (routeRevision === lastRouteRevisionRef.current) return;
    lastRouteRevisionRef.current = routeRevision;
    hasFitted.current = false;
    smoothHeadingRef.current = null;
    lastCameraTimeRef.current = 0;
    lastNearestIdxRef.current = 0;
    freeRideCameraBootstrappedRef.current = false;
    if (driverCoord && routeCoords.length >= 2) {
      const projection = projectPointOntoPolyline(driverCoord, routeCoords, {
        hintSegmentIndex: lastNearestIdxRef.current,
      });
      lastNearestIdxRef.current = projection.segmentIndex || 0;
    }
  }, [routeRevision, routeCoords, driverCoord]);

  useEffect(() => {
    freeRideCameraBootstrappedRef.current = false;
  }, [freeRideMode]);

  // Al reactivar 3D, re-alinear la cámara al rumbo de la polilínea (mismo default inicial).
  const prevThreeDEnabledRef = useRef(threeDEnabled);
  useEffect(() => {
    const wasThreeD = prevThreeDEnabledRef.current;
    prevThreeDEnabledRef.current = threeDEnabled;
    if (wasThreeD || !threeDEnabled) return;
    smoothHeadingRef.current = null;
    lastCameraTimeRef.current = 0;
    lastZoomTierRef.current = null;
  }, [threeDEnabled]);

  /* ── Control de cámara unificado ──────────────────────────────────────── */
  const applyCameraStop = useCallback((stop) => {
    if (!cameraRef.current) return;
    if (stop.bounds) {
      const [[minLng, minLat], [maxLng, maxLat]] = stop.bounds;
      cameraRef.current.fitBounds(
        [maxLng, maxLat],
        [minLng, minLat],
        stop.padding ?? 60,
        stop.duration ?? 400,
      );
      return;
    }
    if (stop.center) {
      const rawZoom = Number(stop.zoom);
      const zoom = Number.isFinite(rawZoom)
        ? Math.min(rawZoom, NAV_ZOOM_CEILING)
        : 15;
      cameraRef.current.setCamera({
        centerCoordinate: stop.center,
        zoomLevel: zoom,
        heading: stop.bearing ?? 0,
        pitch: stop.pitch ?? 0,
        padding: stop.padding,
        animationDuration: stop.duration ?? 250,
        animationMode: 'easeTo',
      });
    }
  }, []);

  /* ── Al salir de navegación (retiro / elegir destino) volver a un zoom de manzana ── */
  useEffect(() => {
    const wasNavigating = prevNavigationModeRef.current;
    prevNavigationModeRef.current = navigationMode;
    if (navigationMode) {
      needsSettleRef.current = true;
      return;
    }
    if (freeRideMode) {
      needsSettleRef.current = false;
      return;
    }
    if (!wasNavigating && !needsSettleRef.current) return;
    if (!driverCoord || !mapReady) return;
    needsSettleRef.current = false;
    lastZoomTierRef.current = null;
    lastCameraTimeRef.current = 0;
    applyCameraStop({
      center: [driverCoord.longitude, driverCoord.latitude],
      bearing: 0,
      pitch: 0,
      zoom: resolveSettledOverviewZoom({ width: viewportWidth, height: viewportHeight }),
      duration: 450,
    });
  }, [
    navigationMode,
    freeRideMode,
    mapReady,
    applyCameraStop,
    viewportWidth,
    viewportHeight,
    driverCoord,
  ]);

  /* ── Cámara 2D en viaje libre: sigue al auto y dibuja el recorrido ──────── */
  useEffect(() => {
    if (!freeRideMode || !driverCoord || !mapReady) return;

    let cancelled = false;
    let frameId = null;
    const followFreeRideCamera = () => {
      if (cancelled) return;
      if (!cameraRef.current) {
        frameId = requestAnimationFrame(followFreeRideCamera);
        return;
      }

      const now = Date.now();
      const isFirst = !freeRideCameraBootstrappedRef.current;
      if (!isFirst && now - lastCameraTimeRef.current < 250) return;

      freeRideCameraBootstrappedRef.current = true;
      lastCameraTimeRef.current = now;
      smoothHeadingRef.current = 0;
      lastZoomTierRef.current = null;

      const speedMps = Number(driverLocation?.speed) > 0 ? Number(driverLocation.speed) : 0;
      const speedKmh = speedMps * 3.6;
      applyCameraStop({
        center: [driverCoord.longitude, driverCoord.latitude],
        bearing: 0,
        pitch: 0,
        zoom: getFreeRideZoom(speedKmh, traveledRouteDisplayCoords),
        padding: FREE_RIDE_CAMERA_PADDING,
        duration: isFirst ? 0 : 250,
      });
    };

    followFreeRideCamera();
    return () => {
      cancelled = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [
    freeRideMode,
    driverCoord,
    traveledRouteDisplayCoords,
    applyCameraStop,
    mapReady,
    driverLocation?.speed,
  ]);

  /* ── Fit inicial a la ruta ─────────────────────────────────────────────── */
  useEffect(() => {
    if (navigationMode || !mapReady || hasFitted.current) return;
    if (routeCoords.length === 0) return;

    let cancelled = false;
    let frameId = null;
    const tryFit = () => {
      if (cancelled || hasFitted.current) return;
      if (!cameraRef.current) {
        frameId = requestAnimationFrame(tryFit);
        return;
      }
      hasFitted.current = true;
      const points = [...routeCoords];
      if (driverCoord) points.push(driverCoord);
      const spanM = getFreeRideRouteSpanMeters(points);
      if (spanM < 280 && driverCoord) {
        applyCameraStop({
          center: [driverCoord.longitude, driverCoord.latitude],
          bearing: 0,
          pitch: 0,
          zoom: resolveSettledOverviewZoom({ width: viewportWidth, height: viewportHeight }),
          duration: 450,
        });
        return;
      }
      const lngs = points.map((p) => p.longitude);
      const lats = points.map((p) => p.latitude);
      cameraRef.current.fitBounds(
        [Math.max(...lngs), Math.max(...lats)],
        [Math.min(...lngs), Math.min(...lats)],
        60,
        600,
      );
    };

    tryFit();
    return () => {
      cancelled = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [routeCoords, navigationMode, driverCoord, mapReady, applyCameraStop, viewportWidth, viewportHeight]);

  /* ── Cámara de navegación ──────────────────────────────────────────────── */
  useEffect(() => {
    if (!navigationMode || !driverCoord || !mapReady) return;

    const now = Date.now();
    const speedMps = Number(driverLocation?.speed) > 0 ? Number(driverLocation.speed) : 0;
    const speedKmh = speedMps * 3.6;
    const navAnchor = driverMarkerCoord ?? snappedDriverCoord ?? driverCoord;
    if (!navAnchor) return;

    const bearingRoute = remainingRouteCoords.length >= 2 ? remainingRouteCoords : routeCoords;
    const effectiveRemainingMeters = Number.isFinite(remainingDistanceMeters)
      ? remainingDistanceMeters
      : (bearingRoute.length >= 2 ? getFreeRideRouteSpanMeters(bearingRoute) : null);

    if (freeRideMode) {
      if (now - lastCameraTimeRef.current < 250) return;
      lastCameraTimeRef.current = now;
      smoothHeadingRef.current = 0;
      const zoom = getFreeRideZoom(speedKmh, traveledRouteDisplayCoords);
      applyCameraStop({
        center: [navAnchor.longitude, navAnchor.latitude],
        bearing: 0,
        pitch: 0,
        zoom,
        padding: FREE_RIDE_CAMERA_PADDING,
        duration: 0,
      });
      return;
    }

    if (threeDEnabled) {
      const upcomingTurn = findUpcomingTurn(navAnchor, bearingRoute);
      const cornerFactor = upcomingTurn
        ? getCornerAnticipationFactor(upcomingTurn.distanceMeters, speedKmh, upcomingTurn.turnAngle)
        : 0;
      const targetHeading = routeHeading;
      // null = primera vez / vuelta a 3D: snap inmediato al rumbo de la ruta.
      if (!Number.isFinite(smoothHeadingRef.current)) {
        smoothHeadingRef.current = targetHeading;
      } else {
        const angleDiffToTarget = Math.abs(((targetHeading - smoothHeadingRef.current + 540) % 360) - 180);
        if (angleDiffToTarget >= 2) {
          const smoothFactor = NAV_HEADING_SMOOTH_FACTOR + cornerFactor * 0.34;
          smoothHeadingRef.current = smoothAngle(smoothHeadingRef.current, targetHeading, smoothFactor);
        }
      }
    } else {
      // 2D: norte geográfico arriba; limpia el rumbo suavizado para el próximo 3D.
      smoothHeadingRef.current = null;
    }

    if (now - lastCameraTimeRef.current < 250) return;
    lastCameraTimeRef.current = now;
    if (Number.isFinite(effectiveRemainingMeters) && effectiveRemainingMeters < ARRIVAL_DISTANCE_METERS) {
      lastZoomTierRef.current = null;
    }

    if (threeDEnabled) {
      const cameraHeading = Number.isFinite(smoothHeadingRef.current) ? smoothHeadingRef.current : routeHeading;
      const { center: cameraCenter, factor: cornerFactor, turn: upcomingTurn } = getAnticipatedCameraCenter({
        navAnchor,
        cameraHeading,
        speedKmh,
        routeCoords: bearingRoute,
        northUp: false,
      });
      const followPadding = buildCornerAwareFollowPadding(
        controlsBottomOffset,
        upcomingTurn,
        cornerFactor,
        viewportHeight,
      );
      const zoom = resolveNavigationCameraZoom({
        speedKmh,
        threeDEnabled: true,
        remainingDistanceMeters: effectiveRemainingMeters,
        cornerFactor,
        viewportWidth,
        viewportHeight,
      });
      const pitch = resolveNavigationCameraPitch({
        threeDEnabled: true,
        remainingDistanceMeters: effectiveRemainingMeters,
        cornerFactor,
        basePitch3d: NAV_PITCH_FOLLOW,
      });
      if (lastZoomTierRef.current === null || Math.abs(lastZoomTierRef.current - zoom) >= 0.15) {
        lastZoomTierRef.current = zoom;
      }
      applyCameraStop({
        center: [cameraCenter.longitude, cameraCenter.latitude],
        bearing: cameraHeading,
        pitch,
        zoom: lastZoomTierRef.current,
        padding: followPadding,
      });
    } else {
      const { center: cameraCenter, factor: cornerFactor, turn: upcomingTurn } = getAnticipatedCameraCenter({
        navAnchor,
        cameraHeading: 0,
        speedKmh,
        routeCoords: bearingRoute,
        northUp: true,
      });
      const northPadding = buildCornerAwareNorthPadding(upcomingTurn, cornerFactor);
      const zoom = resolveNavigationCameraZoom({
        speedKmh,
        threeDEnabled: false,
        remainingDistanceMeters: effectiveRemainingMeters,
        cornerFactor,
        viewportWidth,
        viewportHeight,
      });
      const pitch = resolveNavigationCameraPitch({
        threeDEnabled: false,
        remainingDistanceMeters: effectiveRemainingMeters,
        cornerFactor,
        basePitch2d: NAV_PITCH_NORTH_UP,
      });
      if (lastZoomTierRef.current === null || Math.abs(lastZoomTierRef.current - zoom) >= 0.15) {
        lastZoomTierRef.current = zoom;
      }
      applyCameraStop({
        center: [cameraCenter.longitude, cameraCenter.latitude],
        bearing: 0,
        pitch,
        zoom: lastZoomTierRef.current,
        padding: northPadding,
      });
    }
  }, [
    navigationMode, threeDEnabled, freeRideMode, driverCoord, driverMarkerCoord, snappedDriverCoord,
    driverLocation?.speed, remainingDistanceMeters, remainingRouteCoords, routeCoords, routeHeading,
    traveledRouteDisplayCoords, controlsBottomOffset, applyCameraStop, mapReady,
    viewportWidth, viewportHeight,
  ]);

  /* ── Marcadores ────────────────────────────────────────────────────────── */
  const originCoord = useMemo(() => {
    if (!origin) return null;
    return { latitude: parseFloat(origin.lat), longitude: parseFloat(origin.lng) };
  }, [origin?.lat, origin?.lng]);

  const destCoord = useMemo(() => {
    if (!destination) return null;
    const lat = parseFloat(destination.lat);
    const lng = parseFloat(destination.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { latitude: lat, longitude: lng };
  }, [destination?.lat, destination?.lng]);

  const routeEndCoord = useMemo(() => {
    const pickLast = (coords) => {
      if (!Array.isArray(coords) || coords.length === 0) return null;
      const last = coords[coords.length - 1];
      if (!Number.isFinite(last?.latitude) || !Number.isFinite(last?.longitude)) return null;
      return { latitude: last.latitude, longitude: last.longitude };
    };
    return pickLast(remainingRouteCoords) || pickLast(routeCoords) || destCoord;
  }, [remainingRouteCoords, routeCoords, destCoord]);

  const driverPuckHeading = useMemo(() => {
    if (!navigationMode) {
      return Number.isFinite(heading) ? heading : 0;
    }
    if ((freeRideMode || routeCoords.length < 2) && !threeDEnabled) {
      return Number.isFinite(heading) ? heading : 0;
    }
    // Con mapa rotando, el puck apunta arriba (= dirección de la polilínea).
    if (threeDEnabled) return 0;
    return routeHeading;
  }, [navigationMode, freeRideMode, threeDEnabled, routeCoords.length, routeHeading, heading]);

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <View style={[{ flex: 1 }, style]}>
      <MapLibreGL.MapView
        style={StyleSheet.absoluteFillObject}
        mapStyle={MAPLIBRE_STYLE}
        compassEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
        rotateEnabled={navigationMode && threeDEnabled && !freeRideMode}
        pitchEnabled={navigationMode && threeDEnabled && !freeRideMode}
        onDidFinishLoadingMap={() => setMapReady(true)}
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          maxZoom={NAV_ZOOM_CEILING}
          defaultSettings={{
            centerCoordinate: driverCoord
              ? [driverCoord.longitude, driverCoord.latitude]
              : SALTA_DEFAULT,
            zoomLevel: 14,
            heading: 0,
            pitch: 0,
          }}
        />

        {/* Ruta OSRM */}
        {displayRouteCoords.length > 1 && !freeRideMode ? (
          <MapRouteLayers
            coords={displayRouteCoords}
            routeSteps={routeSteps}
            navigationMode={navigationMode}
          />
        ) : null}

        {/* Recorrido GPS en viaje sin destino */}
        {freeRideMode && traveledRouteDisplayCoords.length > 1 ? (
          <MapRouteLayers
            layerIdPrefix="traveled-route"
            coords={traveledRouteDisplayCoords}
            navigationMode={false}
            lineColor={colors.success}
            casingWidth={9}
            lineWidth={5}
          />
        ) : null}

        {/* Marcadores de puntos (no-nav) */}
        {!navigationMode && originCoord && (
          <PointMarkerAnnotation coordinate={originCoord} type="origin" />
        )}
        {!navigationMode && destCoord && !freeRideMode && (
          <PointMarkerAnnotation coordinate={destCoord} type="dest" />
        )}

        {/* Marcador fin de ruta (nav) */}
        {navigationMode && routeEndCoord && !freeRideMode && (
          <MapLibreGL.MarkerView
            id="route-end-marker"
            coordinate={[routeEndCoord.longitude, routeEndCoord.latitude]}
          >
            <RouteEndMarker coordinate={routeEndCoord} variant={routeEndVariant} />
          </MapLibreGL.MarkerView>
        )}

        {/* Marcador conductor (navegación) */}
        {driverMarkerCoord && navigationMode && (
          <MapLibreGL.MarkerView
            id="driver-nav-marker"
            coordinate={[driverMarkerCoord.longitude, driverMarkerCoord.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <DriverNavMarker heading={driverPuckHeading} />
          </MapLibreGL.MarkerView>
        )}

        {/* Marcador conductor (visualización) */}
        {driverMarkerCoord && !navigationMode && (
          <MapLibreGL.MarkerView
            id="driver-view-marker"
            coordinate={[driverMarkerCoord.longitude, driverMarkerCoord.latitude]}
          >
            <View style={styles.driverMarkerRoot}>
              <View style={styles.driverMarkerRing}>
                <View style={styles.driverMarkerCore}>
                  <MaterialCommunityIcons name="navigation" size={18} color="#fff" />
                </View>
              </View>
            </View>
          </MapLibreGL.MarkerView>
        )}
      </MapLibreGL.MapView>

      {freeRideMode ? null : (
      <View style={[styles.btnCol, { bottom: controlsBottomOffset }]}>
        {typeof onToggleVoiceMute === 'function' ? (
          <Pressable onPress={onToggleVoiceMute} style={({ pressed }) => [styles.mapBtn, pressed && { opacity: 0.7 }]}>
            <MaterialCommunityIcons
              name={isVoiceMuted ? 'volume-off' : 'volume-high'}
              size={18}
              color={isVoiceMuted ? colors.textMuted : colors.primary}
            />
          </Pressable>
        ) : null}
        {navigationMode && typeof onToggleThreeD === 'function' ? (
          <Pressable
            onPress={onToggleThreeD}
            style={({ pressed }) => [styles.modeBtn, pressed && { opacity: 0.7 }]}
            accessibilityLabel={threeDEnabled ? 'Cambiar a vista 2D' : 'Cambiar a vista 3D'}
          >
            <Text style={styles.modeBtnText}>
              {threeDEnabled ? '2D' : '3D'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  driverMarkerRoot: {
    width: TRIP_VIEW_MARKER_OUTER,
    height: TRIP_VIEW_MARKER_OUTER,
    alignItems: 'center', justifyContent: 'center',
  },
  driverMarkerRing: {
    width: TRIP_VIEW_MARKER_RING,
    height: TRIP_VIEW_MARKER_RING,
    borderRadius: TRIP_VIEW_MARKER_RING / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  driverMarkerCore: {
    width: TRIP_VIEW_MARKER_CORE,
    height: TRIP_VIEW_MARKER_CORE,
    borderRadius: TRIP_VIEW_MARKER_CORE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  pointMarker: {
    width: 30, height: 30,
    borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: '#fff',
  },
  btnCol: {
    position: 'absolute',
    right: 12,
    gap: 8,
  },
  modeBtn: {
    width: 40, height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E2E8F0',
    elevation: 3,
  },
  modeBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: colors.secondary,
    letterSpacing: 0.3,
  },
  mapBtn: {
    width: 40, height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E2E8F0',
    elevation: 3,
  },
});
