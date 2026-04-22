import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
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
  const [routeCoords, setRouteCoords] = useState([]);

  useEffect(() => {
    if (polyline) {
      const decoded = decodePolyline(polyline);
      setRouteCoords(decoded);
      hasFitted.current = false;
      lastNearestIdxRef.current = 0;
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

    // ── Reposicionamiento rápido para que el encuadre se acomode al instante.
    const now = Date.now();
    if (now - lastCameraTimeRef.current < 250) return;
    lastCameraTimeRef.current = now;

    const speedMps = Number(driverLocation?.speed) > 0 ? Number(driverLocation.speed) : 0;
    const speedKmh = speedMps * 3.6;

    // ── Zoom dinámico según velocidad
    let zoom = getZoomForSpeed(speedKmh);
    if (Number.isFinite(remainingDistanceMeters) && remainingDistanceMeters < 250) {
      zoom = Math.max(zoom, 17.8);
    }
    if (lastZoomTierRef.current !== null && Math.abs(lastZoomTierRef.current - zoom) < 0.15) {
      zoom = lastZoomTierRef.current;
    }
    lastZoomTierRef.current = zoom;

    // ── Cámara estilo navegación: orientada según la ruta azul, no según el GPS.
    const lookAheadDistances = speedKmh > 60
      ? [90, 220, 360]
      : speedKmh > 30
        ? [70, 170, 280]
        : [50, 120, 200];
    const routeFocusPoint = getRouteFocusPoint(driverCoord, remainingRouteCoords, lookAheadDistances);
    const targetHeading = routeFocusPoint ? getBearing(driverCoord, routeFocusPoint) : driverMarkerHeading;
    smoothHeadingRef.current = targetHeading;
    const cameraHeading = targetHeading;
    const centerAheadMeters = speedKmh > 60 ? 170 : speedKmh > 30 ? 135 : 105;
    const cameraCenter = moveCoordinate(driverCoord, cameraHeading, centerAheadMeters);

    const nextCamera = {
      center: cameraCenter,
      heading: cameraHeading,
      pitch: 58,
      zoom,
    };

    if (typeof mapRef.current.setCamera === 'function') {
      mapRef.current.setCamera(nextCamera);
    } else {
      mapRef.current.animateCamera(nextCamera, { duration: 0 });
    }
  }, [navigationMode, driverCoord, driverLocation?.speed, remainingDistanceMeters, remainingRouteCoords, driverMarkerHeading]);

  const driverCoord = useMemo(() => {
    if (!driverLocation) return null;
    return { latitude: driverLocation.lat, longitude: driverLocation.lng };
  }, [driverLocation?.lat, driverLocation?.lng]);

  const originCoord = useMemo(() => {
    if (!origin) return null;
    return { latitude: parseFloat(origin.lat), longitude: parseFloat(origin.lng) };
  }, [origin?.lat, origin?.lng]);

  const destCoord = useMemo(() => {
    if (!destination) return null;
    return { latitude: parseFloat(destination.lat), longitude: parseFloat(destination.lng) };
  }, [destination?.lat, destination?.lng]);

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
      const routeFocusPoint = navigationMode
        ? getRouteFocusPoint(driverCoord, remainingRouteCoords, [50, 120, 200])
        : null;
      const targetHeading = routeFocusPoint ? getBearing(driverCoord, routeFocusPoint) : driverMarkerHeading;
      if (navigationMode) {
        smoothHeadingRef.current = targetHeading;
      }
      const cameraCenter = navigationMode
        ? moveCoordinate(driverCoord, targetHeading, 105)
        : driverCoord;
      const nextCamera = {
        center: cameraCenter,
        heading: navigationMode ? targetHeading : 0,
        pitch: navigationMode ? 58 : 0,
        zoom: navigationMode ? 17.2 : 16.5,
      };
      if (typeof mapRef.current.setCamera === 'function') {
        mapRef.current.setCamera(nextCamera);
      } else {
        mapRef.current.animateCamera(nextCamera, { duration: 0 });
      }
    }
  }, [driverCoord, navigationMode, remainingRouteCoords, driverMarkerHeading]);

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
        rotateEnabled={!navigationMode}
        pitchEnabled
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
          <DriverDot coordinate={driverCoord} heading={driverMarkerHeading} />
        )}
      </MapView>

      <View style={styles.btnCol}>
        <TouchableOpacity onPress={fitAll} style={styles.mapBtn}>
          <Ionicons name="expand-outline" size={18} color={colors.secondary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={centerOnDriver} style={styles.mapBtn}>
          <Ionicons name="locate" size={18} color={colors.secondary} />
        </TouchableOpacity>
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
    position: 'absolute', bottom: 16, right: 12, gap: 8,
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
