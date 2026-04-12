import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { decodePolyline } from '../../services/googleMaps';
import { DEFAULT_REGION } from '../../utils/constants';

const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#111B2E' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7088A8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#111B2E' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1A2540' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#253352' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2A3F5F' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0B1120' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
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

export const TripMap = React.memo(({
  driverLocation,
  origin,
  destination,
  polyline,
  heading = 0,
  style,
}) => {
  const mapRef = useRef(null);
  const hasFitted = useRef(false);
  const [routeCoords, setRouteCoords] = useState([]);

  useEffect(() => {
    if (polyline) {
      const decoded = decodePolyline(polyline);
      setRouteCoords(decoded);
      hasFitted.current = false;
    }
  }, [polyline]);

  // Fit map to full route once
  useEffect(() => {
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
      mapRef.current.animateToRegion({
        ...driverCoord,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      }, 400);
    }
  }, [driverCoord]);

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
        showsCompass={false}
        toolbarEnabled={false}
        showsBuildings={false}
        showsTraffic={false}
        moveOnMarkerPress={false}
      >
        {/* Route shadow */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="rgba(220,38,38,0.2)"
            strokeWidth={8}
          />
        )}
        {/* Route main */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={colors.primary}
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
          <DriverDot coordinate={driverCoord} heading={heading} />
        )}
      </MapView>

      <View style={styles.btnCol}>
        <TouchableOpacity onPress={fitAll} style={styles.mapBtn}>
          <Ionicons name="expand-outline" size={18} color={colors.primaryLight} />
        </TouchableOpacity>
        <TouchableOpacity onPress={centerOnDriver} style={styles.mapBtn}>
          <Ionicons name="locate" size={18} color={colors.primaryLight} />
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
    backgroundColor: 'rgba(30,30,53,0.92)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
});
