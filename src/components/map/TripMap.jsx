/**
 * Componente: TripMap
 * Que hace: Renderiza el mapa principal del viaje con ruta restante, marcadores y camara de navegacion dinamica.
 * Usado por:
 * - driver-app/src/screens/ActiveTripScreen.jsx -> import { TripMap } from '../components/map/TripMap';
 */
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { decodePolyline } from '../../services/googleMaps';
import { DEFAULT_REGION } from '../../utils/constants';

const ROUTE_BLUE = '#2563EB';
const ROUTE_BLUE_SHADOW = 'rgba(37,99,235,0.24)';

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
    + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
    Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lng2 * 180) / Math.PI,
  };
}

/**
 * Projects `point` onto segment a→b and returns the nearest point on the segment.
 */
function snapCoordToSegment(point, a, b) {
  const dx = b.longitude - a.longitude;
  const dy = b.latitude - a.latitude;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  let t = ((point.longitude - a.longitude) * dx + (point.latitude - a.latitude) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { latitude: a.latitude + t * dy, longitude: a.longitude + t * dx };
}

/**
 * Snaps `point` to the nearest position on `coords` polyline.
 * Returns original point if polyline is too short or GPS is more than 40 m off-route.
 */
function snapToPolyline(point, coords) {
  if (!point || coords.length < 2) return point;
  let nearest = null;
  let nearestDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const snapped = snapCoordToSegment(point, coords[i], coords[i + 1]);
    const d = coordDistMeters(point, snapped);
    if (d < nearestDist) { nearestDist = d; nearest = snapped; }
  }
  return nearest && nearestDist < 40 ? nearest : point;
}

const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#F0F1F5' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5A6478' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E2E8F0' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#E8EBF0' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#C9DCF0' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#D5EDDA' }] },
];

const DriverDot = React.memo(({ coordinate, heading }) => {
  const [ready, setReady] = useState(true);
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={heading || 0}
      tracksViewChanges={ready}
    >
      <View
        style={styles.driverOuter}
        onLayout={() => { if (ready) setTimeout(() => setReady(false), 600); }}
      >
        <View style={styles.driverDot}>
          <MaterialCommunityIcons name="navigation" size={16} color="#fff" />
        </View>
      </View>
    </Marker>
  );
});

const PointMarker = React.memo(({ coordinate, type, address }) => {
  const [ready, setReady] = useState(true);
  const isOrigin = type === 'origin';
  return (
    <Marker
      coordinate={coordinate}
      title={isOrigin ? 'Origen' : 'Destino'}
      description={address}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={ready}
    >
      <View
        style={[styles.pointMarker, { backgroundColor: isOrigin ? colors.success : colors.danger }]}
        onLayout={() => { if (ready) setTimeout(() => setReady(false), 600); }}
      >
        <MaterialCommunityIcons
          name={isOrigin ? 'radiobox-marked' : 'flag-variant'}
          size={14}
          color="#fff"
        />
      </View>
    </Marker>
  );
});

// Smooth an angle in degrees handling 0/360 wraparound.
// factor: 0 = no change, 1 = snap to target
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

/**
 * Walk `metersAhead` along `coords` starting from the index nearest to `origin`.
 * Returns the coordinate that lies that far ahead, or the last coord if the route is shorter.
 * This gives a very stable bearing because it averages many polyline segments.
 */
function getPointAheadOnRoute(origin, coords, metersAhead) {
  if (!origin || coords.length < 2) return null;

  // Find nearest index
  let nearestIdx = 0;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coords.length; i++) {
    const d = coordDistMeters(origin, coords[i]);
    if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
  }

  // Walk forward metersAhead
  let remaining = metersAhead;
  for (let i = nearestIdx; i < coords.length - 1; i++) {
    const segLen = coordDistMeters(coords[i], coords[i + 1]);
    if (remaining <= segLen) {
      const frac = remaining / segLen;
      return {
        latitude: coords[i].latitude + frac * (coords[i + 1].latitude - coords[i].latitude),
        longitude: coords[i].longitude + frac * (coords[i + 1].longitude - coords[i].longitude),
      };
    }
    remaining -= segLen;
  }
  return coords[coords.length - 1];
}

function getRouteFocusPoint(origin, coords, distances) {
  if (!origin || coords.length < 2) return null;

  const points = distances
    .map((distance) => getPointAheadOnRoute(origin, coords, distance))
    .filter(Boolean);

  if (points.length === 0) return null;

  const sum = points.reduce((acc, point) => ({
    latitude: acc.latitude + point.latitude,
    longitude: acc.longitude + point.longitude,
  }), { latitude: 0, longitude: 0 });

  return {
    latitude: sum.latitude / points.length,
    longitude: sum.longitude / points.length,
  };
}

const ZOOM_TIERS = [
  { minKmh: 65, zoom: 15.7 },
  { minKmh: 40, zoom: 16.2 },
  { minKmh: 20, zoom: 16.8 },
  { minKmh: 0,  zoom: 17.2 },
];

function getZoomForSpeed(speedKmh) {
  for (const tier of ZOOM_TIERS) {
    if (speedKmh >= tier.minKmh) return tier.zoom;
  }
  return 17.2;
}

export const TripMap = React.memo(({
  driverLocation,
  origin,
  destination,
  polyline,
  heading = 0,
  navigationMode = false,
  threeDEnabled = false,
  onToggleThreeD,
  onOpenGoogleMaps,
  controlsBottomOffset = 16,
  remainingDistanceMeters = null,
  style,
}) => {
  const mapRef = useRef(null);
  const hasFitted = useRef(false);
  const lastNearestIdxRef = useRef(0);
  // Heading smoothing & camera throttle refs
  const smoothHeadingRef = useRef(null);   // last smoothed heading
  const lastCameraTimeRef = useRef(0);     // timestamp of last animateCamera call
  const lastZoomTierRef = useRef(null);    // last zoom value used
  const lastDriverPosRef = useRef(null);   // last position used for heading calc (GPS jitter guard)
  const [routeCoords, setRouteCoords] = useState([]);
  const [mapReady, setMapReady] = useState(false);

  // ── These memos are declared BEFORE the camera useEffect because they appear
  // in its dependency array. React hooks must be declared in the order they are
  // evaluated; accessing a `const` before its declaration causes a TDZ error.

  const driverCoord = useMemo(() => {
    if (!driverLocation) return null;
    return { latitude: driverLocation.lat, longitude: driverLocation.lng };
  }, [driverLocation?.lat, driverLocation?.lng]);

  const getPointDistanceMeters = useCallback((a, b) => {
    const R = 6371000;
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
    const lat1 = (a.latitude * Math.PI) / 180;
    const lat2 = (b.latitude * Math.PI) / 180;
    const hav =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
  }, []);

  const getRemainingRouteCoords = useCallback(() => {
    if (!driverCoord || routeCoords.length === 0) return routeCoords;

    let nearestIdx = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < routeCoords.length; i += 1) {
      const d = getPointDistanceMeters(driverCoord, routeCoords[i]);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearestIdx = i;
      }
    }

    // Keep progress monotonic to avoid route jumping backwards due to GPS drift.
    nearestIdx = Math.max(lastNearestIdxRef.current, nearestIdx);
    lastNearestIdxRef.current = nearestIdx;

    const remaining = routeCoords.slice(nearestIdx);
    if (remaining.length === 0) return [];

    // Start the visible route exactly at driver's current position.
    return [driverCoord, ...remaining];
  }, [driverCoord, routeCoords, getPointDistanceMeters]);

  const remainingRouteCoords = useMemo(() => getRemainingRouteCoords(), [getRemainingRouteCoords]);

  // Route-based heading: derived ONLY from route waypoints (pure road geometry).
  // Index 0 of remainingRouteCoords is the GPS position — we skip it and use
  // index 1+ which are actual route waypoints. This means heading is 100% stable
  // against GPS jitter and only changes when the driver truly advances to a new segment.
  const routeHeading = useMemo(() => {
    // Skip index 0 (GPS position), use actual route waypoints from index 1 onward.
    const routeOnly = remainingRouteCoords.length >= 3
      ? remainingRouteCoords.slice(1)
      : remainingRouteCoords;
    if (routeOnly.length < 2) return smoothHeadingRef.current ?? 0;
    // Walk 70 m along pure route points to get stable road bearing.
    let accumulated = 0;
    for (let i = 0; i < routeOnly.length - 1; i++) {
      const seg = coordDistMeters(routeOnly[i], routeOnly[i + 1]);
      accumulated += seg;
      if (accumulated >= 70) {
        return getBearing(routeOnly[0], routeOnly[i + 1]);
      }
    }
    return getBearing(routeOnly[0], routeOnly[routeOnly.length - 1]);
  }, [remainingRouteCoords]);

  // Snap driver position to the nearest point on the route polyline so the
  // arrow marker always sits on the road even with GPS noise.
  const snappedDriverCoord = useMemo(() => {
    if (!driverCoord || remainingRouteCoords.length < 2) return driverCoord;
    return snapToPolyline(driverCoord, remainingRouteCoords);
  }, [driverCoord, remainingRouteCoords]);

  // ── Effects

  useEffect(() => {
    if (polyline) {
      const decoded = decodePolyline(polyline);
      setRouteCoords(decoded);
      hasFitted.current = false;
      lastNearestIdxRef.current = 0;
      // Reset heading so camera snaps to correct orientation on new route
      smoothHeadingRef.current = null;
      lastDriverPosRef.current = null;
      lastCameraTimeRef.current = 0;
    }
  }, [polyline]);

  // Fit map to full route once
  useEffect(() => {
    if (navigationMode) return;
    if (routeCoords.length > 0 && mapRef.current && !hasFitted.current) {
      hasFitted.current = true;
      const points = [...routeCoords];
      if (driverLocation) {
        points.push({ latitude: driverLocation.lat, longitude: driverLocation.lng });
      }
      mapRef.current.fitToCoordinates(points, {
        edgePadding: { top: 80, right: 40, bottom: 200, left: 40 },
        animated: true,
      });
    }
  }, [routeCoords]);

  useEffect(() => {
    if (!navigationMode || !mapRef.current || !driverCoord) return;

    const now = Date.now();
    const speedMps = Number(driverLocation?.speed) > 0 ? Number(driverLocation.speed) : 0;
    const speedKmh = speedMps * 3.6;

    // ── Heading update: NO throttle — must apply every time route geometry changes.
    // routeHeading only changes when the driver passes a new waypoint, not on GPS jitter.
    if (threeDEnabled) {
      const targetHeading = routeHeading;
      if (!Number.isFinite(smoothHeadingRef.current)) {
        // First time or after reroute: snap instantly to road direction
        smoothHeadingRef.current = targetHeading;
      } else {
        const angleDiff = Math.abs(((targetHeading - smoothHeadingRef.current + 540) % 360) - 180);
        if (angleDiff >= 3) {
          // 0.15 factor = smooth like Google Maps, reacts to turns gradually
          smoothHeadingRef.current = smoothAngle(smoothHeadingRef.current, targetHeading, 0.15);
        }
      }
    }

    // ── Position update: throttled to avoid hammering animateCamera.
    if (now - lastCameraTimeRef.current < 250) return;
    lastCameraTimeRef.current = now;

    // ── Zoom dinámico según velocidad
    let zoom = getZoomForSpeed(speedKmh);
    if (Number.isFinite(remainingDistanceMeters) && remainingDistanceMeters < 250) {
      zoom = Math.max(zoom, 17.8);
    }
    if (lastZoomTierRef.current !== null && Math.abs(lastZoomTierRef.current - zoom) < 0.15) {
      zoom = lastZoomTierRef.current;
    }
    lastZoomTierRef.current = zoom;

    if (threeDEnabled) {
      const cameraHeading = Number.isFinite(smoothHeadingRef.current) ? smoothHeadingRef.current : routeHeading;
      const centerAheadMeters = speedKmh > 60 ? 170 : speedKmh > 30 ? 135 : 105;
      const cameraCenter = moveCoordinate(snappedDriverCoord, cameraHeading, centerAheadMeters);
      const nextCamera = { center: cameraCenter, heading: cameraHeading, pitch: 58, zoom };
      if (typeof mapRef.current.setCamera === 'function') {
        mapRef.current.setCamera(nextCamera);
      } else {
        mapRef.current.animateCamera(nextCamera, { duration: 0 });
      }
    } else {
      // ── 2D mode: north-up, flat, driver centered
      const nextCamera = { center: snappedDriverCoord, heading: 0, pitch: 0, zoom: 16.6 };
      if (typeof mapRef.current.setCamera === 'function') {
        mapRef.current.setCamera(nextCamera);
      } else {
        mapRef.current.animateCamera(nextCamera, { duration: 0 });
      }
    }
  }, [navigationMode, threeDEnabled, driverCoord, driverLocation?.speed, remainingDistanceMeters, remainingRouteCoords, routeHeading, mapReady]);

  // ── Remaining derived values (only used in JSX, can be after effects)

  const originCoord = useMemo(() => {
    if (!origin) return null;
    return { latitude: parseFloat(origin.lat), longitude: parseFloat(origin.lng) };
  }, [origin?.lat, origin?.lng]);

  const destCoord = useMemo(() => {
    if (!destination) return null;
    return { latitude: parseFloat(destination.lat), longitude: parseFloat(destination.lng) };
  }, [destination?.lat, destination?.lng]);

  const driverMarkerHeading = useMemo(() => {
    if (!driverCoord) return 0;
    const aheadPoint = getPointAheadOnRoute(driverCoord, remainingRouteCoords, 55);
    if (aheadPoint) {
      return getBearing(driverCoord, aheadPoint);
    }
    return Number.isFinite(heading) ? heading : 0;
  }, [driverCoord, remainingRouteCoords, heading]);

  const fitAll = useCallback(() => {
    if (!mapRef.current) return;
    const points = [...routeCoords];
    if (driverCoord) points.push(driverCoord);
    if (points.length > 0) {
      mapRef.current.fitToCoordinates(points, {
        edgePadding: { top: 80, right: 40, bottom: 200, left: 40 },
        animated: true,
      });
    }
  }, [routeCoords, driverCoord]);

  const centerOnDriver = useCallback(() => {
    if (driverCoord && mapRef.current) {
      let nextCamera;
      if (navigationMode && threeDEnabled) {
        // Use routeHeading (pure road geometry) same as the camera loop
        const cameraHeading = Number.isFinite(smoothHeadingRef.current) ? smoothHeadingRef.current : routeHeading;
        smoothHeadingRef.current = cameraHeading;
        const cameraCenter = moveCoordinate(snappedDriverCoord, cameraHeading, 105);
        nextCamera = { center: cameraCenter, heading: cameraHeading, pitch: 58, zoom: 17.2 };
      } else if (navigationMode) {
        nextCamera = { center: driverCoord, heading: 0, pitch: 0, zoom: 16.6 };
      } else {
        nextCamera = { center: driverCoord, heading: 0, pitch: 0, zoom: 16.5 };
      }
      if (typeof mapRef.current.setCamera === 'function') {
        mapRef.current.setCamera(nextCamera);
      } else {
        mapRef.current.animateCamera(nextCamera, { duration: 0 });
      }
    }
  }, [driverCoord, navigationMode, threeDEnabled, snappedDriverCoord, routeHeading]);

  const initialRegion = driverLocation
    ? { latitude: driverLocation.lat, longitude: driverLocation.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }
    : DEFAULT_REGION;

  return (
    <View style={[{ flex: 1 }, style]}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        initialRegion={initialRegion}
        customMapStyle={MAP_STYLE}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={!navigationMode}
        toolbarEnabled={false}
        showsBuildings={false}
        showsTraffic={navigationMode}
        moveOnMarkerPress={false}
        rotateEnabled={navigationMode}
        pitchEnabled={threeDEnabled}
        onMapReady={() => setMapReady(true)}
      >
        {/* Route shadow */}
        {remainingRouteCoords.length > 1 && (
          <Polyline
            coordinates={remainingRouteCoords}
            strokeColor={ROUTE_BLUE_SHADOW}
            strokeWidth={8}
          />
        )}
        {/* Route main */}
        {remainingRouteCoords.length > 1 && (
          <Polyline
            coordinates={remainingRouteCoords}
            strokeColor={ROUTE_BLUE}
            strokeWidth={4}
          />
        )}

        {originCoord && (
          <PointMarker coordinate={originCoord} type="origin" address={origin?.address} />
        )}
        {destCoord && (
          <PointMarker coordinate={destCoord} type="dest" address={destination?.address} />
        )}
        {driverCoord && (
          <DriverDot coordinate={snappedDriverCoord} heading={driverMarkerHeading} />
        )}
      </MapView>

      <View style={[styles.btnCol, { bottom: controlsBottomOffset }]}>
        {navigationMode && typeof onToggleThreeD === 'function' && (
          <Pressable onPress={onToggleThreeD} style={({ pressed }) => [styles.modeBtn, pressed && { opacity: 0.7 }]}>
            <MaterialCommunityIcons
              name={threeDEnabled ? 'cube-outline' : 'map-outline'}
              size={15}
              color={colors.secondary}
            />
            <MaterialCommunityIcons
              name={threeDEnabled ? 'numeric-3-box-outline' : 'numeric-2-box-outline'}
              size={15}
              color={colors.secondary}
              style={{ marginTop: -2 }}
            />
          </Pressable>
        )}
        {typeof onOpenGoogleMaps === 'function' && (
          <Pressable onPress={onOpenGoogleMaps} style={({ pressed }) => [styles.mapBtn, pressed && { opacity: 0.7 }]}>
            <MaterialCommunityIcons
              name="google-maps"
              size={18}
              color="#1A73E8"
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
  driverOuter: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  driverDot: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#fff',
    elevation: 6,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 6,
  },
  pointMarker: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: '#fff',
    elevation: 4,
  },
  btnCol: {
    position: 'absolute', right: 12, gap: 8,
  },
  modeBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E2E8F0',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4,
    gap: 0,
  },
  mapBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E2E8F0',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4,
  },
});
