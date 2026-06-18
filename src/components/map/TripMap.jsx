/**
 * Componente: TripMap
 * Mapa de viaje con MapLibre + OSM, ruta, marcadores y cámara de navegación.
 */
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Map, Camera, Marker } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { decodePolyline } from '../../utils/polyline';
import { projectPointOntoPolyline } from '../../services/navigation';
import { DEFAULT_REGION } from '../../utils/constants';
import { MAP_STYLE_URL } from '../../utils/mapConfig';
import { getBoundsForCoords, regionToInitialViewState, toLngLat } from '../../utils/mapLibreHelpers';
import { MapRouteLayers } from './MapRouteLayers';
import RouteEndMarker from './RouteEndMarker';
import DriverNavMarker from './DriverNavMarker';

const NAV_PITCH_NORTH_UP = 12;
const NAV_PITCH_FOLLOW = 52;
const NAV_HEADING_SMOOTH_FACTOR = 0.18;
const ON_ROUTE_SNAP_MAX_M = 32;

function getBearing(from, to) {
  if (!from || !to) return 0;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const dLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function moveCoordinate(point, bearing, distanceMeters) {
  const R = 6378137;
  const lat1 = (point.latitude * Math.PI) / 180;
  const lng1 = (point.longitude * Math.PI) / 180;
  const brng = (bearing * Math.PI) / 180;
  const angDist = distanceMeters / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist)
    + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
    Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
  );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lng2 * 180) / Math.PI,
  };
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

function buildActiveRoutePolyline(driverCoord, routeCoords) {
  if (!routeCoords || routeCoords.length < 2) return [];
  if (!driverCoord) return routeCoords;

  const projection = projectPointOntoPolyline(
    { latitude: driverCoord.latitude, longitude: driverCoord.longitude },
    routeCoords,
  );
  const snapped = projection.snappedPoint;
  if (!snapped) return routeCoords;

  const idx = Math.max(0, Math.min(projection.segmentIndex, routeCoords.length - 2));
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

function getLookaheadMeters(speedKmh) {
  if (speedKmh >= 55) return 48;
  if (speedKmh >= 30) return 32;
  if (speedKmh >= 12) return 22;
  return 14;
}

function getNavigationBearing(origin, routeCoords, speedKmh = 0) {
  if (!origin || routeCoords.length < 2) return 0;

  const projection = projectPointOntoPolyline(origin, routeCoords);
  const from = projection.snappedPoint || origin;
  const segIdx = Math.min(projection.segmentIndex, routeCoords.length - 2);
  const segmentBearing = getBearing(routeCoords[segIdx], routeCoords[segIdx + 1]);

  const lookAhead = getLookaheadMeters(speedKmh);
  const ahead = getPointAheadOnPolyline(origin, routeCoords, lookAhead);
  if (!ahead) return segmentBearing;

  const forwardBearing = getBearing(from, ahead);
  const diff = Math.abs(((forwardBearing - segmentBearing + 540) % 360) - 180);

  if (diff > 22) {
    return smoothAngle(forwardBearing, segmentBearing, diff > 40 ? 0.62 : 0.45);
  }
  return forwardBearing;
}

const ZOOM_TIERS = [
  { minKmh: 65, zoom: 15.7 },
  { minKmh: 40, zoom: 16.2 },
  { minKmh: 20, zoom: 16.8 },
  { minKmh: 0, zoom: 17.2 },
];

function getZoomForSpeed(speedKmh) {
  for (const tier of ZOOM_TIERS) {
    if (speedKmh >= tier.minKmh) return tier.zoom;
  }
  return 17.2;
}

const PointMarker = React.memo(({ coordinate, type }) => {
  const isOrigin = type === 'origin';
  return (
    <Marker id={`point-${type}`} lngLat={[coordinate.longitude, coordinate.latitude]}>
      <View style={[styles.pointMarker, { backgroundColor: isOrigin ? colors.success : colors.danger }]}>
        <MaterialCommunityIcons
          name={isOrigin ? 'radiobox-marked' : 'flag-variant'}
          size={14}
          color="#fff"
        />
      </View>
    </Marker>
  );
});

export const TripMap = React.memo(({
  driverLocation,
  origin,
  destination,
  polyline,
  heading = 0,
  navigationMode = false,
  threeDEnabled = false,
  onToggleThreeD,
  onToggleVoiceMute,
  isVoiceMuted = false,
  controlsBottomOffset = 16,
  remainingDistanceMeters = null,
  routeEndVariant = 'destination',
  style,
}) => {
  const cameraRef = useRef(null);
  const hasFitted = useRef(false);
  const lastNearestIdxRef = useRef(0);
  const smoothHeadingRef = useRef(null);
  const lastCameraTimeRef = useRef(0);
  const lastZoomTierRef = useRef(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [mapReady, setMapReady] = useState(false);

  const driverCoord = useMemo(() => {
    if (!driverLocation) return null;
    return { latitude: driverLocation.lat, longitude: driverLocation.lng };
  }, [driverLocation?.lat, driverLocation?.lng]);

  const getRemainingRouteCoords = useCallback(() => {
    if (routeCoords.length === 0) return [];
    if (!driverCoord) return routeCoords;

    const projection = projectPointOntoPolyline(
      { latitude: driverCoord.latitude, longitude: driverCoord.longitude },
      routeCoords,
    );
    const segIdx = Math.max(lastNearestIdxRef.current, projection.segmentIndex || 0);
    lastNearestIdxRef.current = segIdx;

    return buildActiveRoutePolyline(driverCoord, routeCoords.slice(segIdx));
  }, [driverCoord, routeCoords]);

  const remainingRouteCoords = useMemo(() => getRemainingRouteCoords(), [getRemainingRouteCoords]);

  const routeProjection = useMemo(() => {
    if (!driverCoord || routeCoords.length < 2) {
      return { deviationMeters: Number.POSITIVE_INFINITY, snappedPoint: null };
    }
    return projectPointOntoPolyline(driverCoord, routeCoords);
  }, [driverCoord, routeCoords]);

  const isOnRoute = useMemo(() => (
    Number.isFinite(routeProjection.deviationMeters)
    && routeProjection.deviationMeters <= ON_ROUTE_SNAP_MAX_M
  ), [routeProjection.deviationMeters]);

  const snappedDriverCoord = useMemo(() => {
    if (!driverCoord || remainingRouteCoords.length < 2) return driverCoord;
    if (!isOnRoute) return driverCoord;
    return snapToPolyline(driverCoord, remainingRouteCoords);
  }, [driverCoord, remainingRouteCoords, isOnRoute]);

  const driverMarkerCoord = useMemo(() => {
    if (!driverCoord) return null;
    if (navigationMode) {
      if (isOnRoute && remainingRouteCoords.length > 0) {
        return remainingRouteCoords[0];
      }
      return driverCoord;
    }
    return snappedDriverCoord ?? driverCoord;
  }, [navigationMode, isOnRoute, remainingRouteCoords, driverCoord, snappedDriverCoord]);

  const navigationSpeedKmh = useMemo(() => {
    const speedMps = Number(driverLocation?.speed);
    return Number.isFinite(speedMps) && speedMps > 0 ? speedMps * 3.6 : 0;
  }, [driverLocation?.speed]);

  const routeHeading = useMemo(() => {
    if (!isOnRoute && Number.isFinite(heading)) {
      return heading;
    }
    const originPoint = snappedDriverCoord || driverCoord;
    const bearingRoute = routeCoords.length >= 2 ? routeCoords : remainingRouteCoords;
    if (!originPoint || bearingRoute.length < 2) return smoothHeadingRef.current ?? 0;
    return getNavigationBearing(originPoint, bearingRoute, navigationSpeedKmh);
  }, [
    isOnRoute,
    heading,
    snappedDriverCoord,
    driverCoord,
    routeCoords,
    remainingRouteCoords,
    navigationSpeedKmh,
  ]);

  useEffect(() => {
    if (polyline) {
      const decoded = decodePolyline(polyline);
      setRouteCoords(decoded);
      hasFitted.current = false;
      lastNearestIdxRef.current = 0;
      smoothHeadingRef.current = null;
      lastCameraTimeRef.current = 0;
    }
  }, [polyline]);

  const applyCameraStop = useCallback((stop) => {
    if (!cameraRef.current) return;
    cameraRef.current.setStop(stop);
  }, []);

  useEffect(() => {
    if (navigationMode) return;
    if (routeCoords.length > 0 && cameraRef.current && !hasFitted.current) {
      hasFitted.current = true;
      const points = [...routeCoords];
      if (driverCoord) points.push(driverCoord);
      const boundsInfo = getBoundsForCoords(points);
      if (boundsInfo) {
        applyCameraStop({
          bounds: boundsInfo.bounds,
          padding: { top: 80, right: 40, bottom: 200, left: 40 },
        });
      }
    }
  }, [routeCoords, navigationMode, driverCoord, applyCameraStop]);

  useEffect(() => {
    if (!navigationMode || !driverCoord || !mapReady) return;

    const now = Date.now();
    const speedMps = Number(driverLocation?.speed) > 0 ? Number(driverLocation.speed) : 0;
    const speedKmh = speedMps * 3.6;

    if (threeDEnabled) {
      const targetHeading = routeHeading;
      if (!Number.isFinite(smoothHeadingRef.current)) {
        smoothHeadingRef.current = targetHeading;
      } else {
        const angleDiff = Math.abs(((targetHeading - smoothHeadingRef.current + 540) % 360) - 180);
        if (angleDiff >= 2) {
          smoothHeadingRef.current = smoothAngle(
            smoothHeadingRef.current,
            targetHeading,
            NAV_HEADING_SMOOTH_FACTOR,
          );
        }
      }
    } else {
      smoothHeadingRef.current = 0;
    }

    if (now - lastCameraTimeRef.current < 250) return;
    lastCameraTimeRef.current = now;

    let zoom = getZoomForSpeed(speedKmh);
    if (Number.isFinite(remainingDistanceMeters) && remainingDistanceMeters < 250) {
      zoom = Math.max(zoom, 17.8);
    }
    if (lastZoomTierRef.current !== null && Math.abs(lastZoomTierRef.current - zoom) < 0.15) {
      zoom = lastZoomTierRef.current;
    }
    lastZoomTierRef.current = zoom;

    const navAnchor = driverMarkerCoord ?? snappedDriverCoord ?? driverCoord;
    if (!navAnchor) return;

    if (threeDEnabled) {
      const cameraHeading = Number.isFinite(smoothHeadingRef.current) ? smoothHeadingRef.current : routeHeading;
      const centerAheadMeters = speedKmh > 55 ? 72 : speedKmh > 25 ? 52 : speedKmh > 8 ? 38 : 26;
      const cameraCenter = moveCoordinate(navAnchor, cameraHeading, centerAheadMeters);
      applyCameraStop({
        center: [cameraCenter.longitude, cameraCenter.latitude],
        bearing: cameraHeading,
        pitch: NAV_PITCH_FOLLOW,
        zoom,
      });
    } else {
      const centerAheadMeters = speedKmh > 20 ? 45 : 28;
      const cameraCenter = moveCoordinate(navAnchor, routeHeading, centerAheadMeters);
      applyCameraStop({
        center: [cameraCenter.longitude, cameraCenter.latitude],
        bearing: 0,
        pitch: NAV_PITCH_NORTH_UP,
        zoom,
      });
    }
  }, [
    navigationMode,
    threeDEnabled,
    driverCoord,
    driverMarkerCoord,
    snappedDriverCoord,
    driverLocation?.speed,
    remainingDistanceMeters,
    remainingRouteCoords,
    routeHeading,
    mapReady,
    applyCameraStop,
  ]);

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

  const driverMarkerHeading = useMemo(() => {
    if (!driverMarkerCoord) return Number.isFinite(heading) ? heading : 0;
    if (navigationMode && !isOnRoute && Number.isFinite(heading)) {
      return heading;
    }
    const bearingRoute = routeCoords.length >= 2 ? routeCoords : remainingRouteCoords;
    if (navigationMode && isOnRoute && bearingRoute.length >= 2) {
      return routeHeading;
    }
    if (bearingRoute.length >= 2 && snappedDriverCoord) {
      return getNavigationBearing(snappedDriverCoord, bearingRoute, navigationSpeedKmh);
    }
    return Number.isFinite(heading) ? heading : 0;
  }, [
    driverMarkerCoord,
    snappedDriverCoord,
    routeCoords,
    remainingRouteCoords,
    navigationMode,
    isOnRoute,
    routeHeading,
    navigationSpeedKmh,
    heading,
  ]);

  const fitAll = useCallback(() => {
    const points = [...routeCoords];
    if (driverCoord) points.push(driverCoord);
    const boundsInfo = getBoundsForCoords(points);
    if (boundsInfo) {
      applyCameraStop({
        bounds: boundsInfo.bounds,
        padding: { top: 80, right: 40, bottom: 200, left: 40 },
      });
    }
  }, [routeCoords, driverCoord, applyCameraStop]);

  const centerOnDriver = useCallback(() => {
    const anchor = driverMarkerCoord ?? driverCoord;
    if (!anchor) return;

    if (navigationMode && threeDEnabled) {
      const cameraHeading = Number.isFinite(smoothHeadingRef.current) ? smoothHeadingRef.current : routeHeading;
      smoothHeadingRef.current = cameraHeading;
      const cameraCenter = moveCoordinate(anchor, cameraHeading, 75);
      applyCameraStop({
        center: [cameraCenter.longitude, cameraCenter.latitude],
        bearing: cameraHeading,
        pitch: NAV_PITCH_FOLLOW,
        zoom: 17.2,
      });
    } else if (navigationMode) {
      const cameraCenter = moveCoordinate(anchor, routeHeading, 40);
      applyCameraStop({
        center: [cameraCenter.longitude, cameraCenter.latitude],
        bearing: 0,
        pitch: NAV_PITCH_NORTH_UP,
        zoom: 16.8,
      });
    } else {
      applyCameraStop({
        center: [anchor.longitude, anchor.latitude],
        bearing: 0,
        pitch: 0,
        zoom: 16.5,
      });
    }
  }, [driverCoord, driverMarkerCoord, navigationMode, threeDEnabled, routeHeading, applyCameraStop]);

  const initialViewState = useMemo(() => {
    if (driverLocation) {
      return regionToInitialViewState({
        latitude: driverLocation.lat,
        longitude: driverLocation.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    }
    return regionToInitialViewState(DEFAULT_REGION);
  }, [driverLocation?.lat, driverLocation?.lng]);

  const driverLngLat = toLngLat(driverMarkerCoord);
  const routeEndLngLat = toLngLat(routeEndCoord);

  return (
    <View style={[{ flex: 1 }, style]}>
      <Map
        mapStyle={MAP_STYLE_URL}
        style={StyleSheet.absoluteFillObject}
        onDidFinishLoadingMap={() => setMapReady(true)}
        logo={false}
        attributionPosition={{ bottom: 8, left: 8 }}
      >
        <Camera ref={cameraRef} initialViewState={initialViewState} />

        {remainingRouteCoords.length > 1 && (
          <MapRouteLayers
            idPrefix="trip-route"
            coords={remainingRouteCoords}
            navigationMode={navigationMode}
          />
        )}

        {!navigationMode && originCoord && (
          <PointMarker coordinate={originCoord} type="origin" />
        )}
        {!navigationMode && destCoord && (
          <PointMarker coordinate={destCoord} type="dest" />
        )}

        {navigationMode && routeEndLngLat && (
          <RouteEndMarker lngLat={routeEndLngLat} variant={routeEndVariant} />
        )}

        {driverLngLat && navigationMode && (
          <DriverNavMarker lngLat={driverLngLat} heading={driverMarkerHeading} />
        )}

        {driverLngLat && !navigationMode && (
          <Marker id="driver-dot" lngLat={driverLngLat}>
            <View style={styles.driverMarkerRoot}>
              <View style={styles.driverMarkerRing}>
                <View style={styles.driverMarkerCore}>
                  <MaterialCommunityIcons name="navigation" size={16} color="#fff" />
                </View>
              </View>
            </View>
          </Marker>
        )}
      </Map>

      <View style={[styles.btnCol, { bottom: controlsBottomOffset }]}>
        {navigationMode && typeof onToggleThreeD === 'function' && (
          <Pressable onPress={onToggleThreeD} style={({ pressed }) => [styles.modeBtn, pressed && { opacity: 0.7 }]}>
            <MaterialCommunityIcons
              name={threeDEnabled ? 'compass-outline' : 'navigation-outline'}
              size={18}
              color={colors.secondary}
            />
          </Pressable>
        )}
        {typeof onToggleVoiceMute === 'function' && (
          <Pressable onPress={onToggleVoiceMute} style={({ pressed }) => [styles.mapBtn, pressed && { opacity: 0.7 }]}>
            <MaterialCommunityIcons
              name={isVoiceMuted ? 'volume-off' : 'volume-high'}
              size={18}
              color={isVoiceMuted ? colors.textMuted : colors.primary}
            />
          </Pressable>
        )}
        <Pressable onPress={fitAll} style={({ pressed }) => [styles.mapBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name="expand-outline" size={18} color={colors.secondary} />
        </Pressable>
        <Pressable onPress={centerOnDriver} style={({ pressed }) => [styles.mapBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name="locate" size={18} color={colors.secondary} />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  driverMarkerRoot: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverMarkerRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverMarkerCore: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#fff',
    boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
  },
  btnCol: {
    position: 'absolute',
    right: 12,
    gap: 8,
  },
  modeBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
  },
  mapBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
  },
});
