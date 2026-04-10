import React, { useRef, useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { getRegionForCoordinates } from '../../utils/mapHelpers';
import { decodePolyline } from '../../services/googleMaps';
import { DriverMarker } from './DriverMarker';
import { DEFAULT_REGION } from '../../utils/constants';

const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#255763' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
];

export const TripMap = ({
  driverLocation,
  origin,
  destination,
  polyline,
  heading = 0,
  followDriver = true,
  style,
}) => {
  const mapRef = useRef(null);
  const [routeCoords, setRouteCoords] = useState([]);

  useEffect(() => {
    if (polyline) {
      const decoded = decodePolyline(polyline);
      setRouteCoords(decoded);
    }
  }, [polyline]);

  useEffect(() => {
    if (followDriver && driverLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: driverLocation.lat,
          longitude: driverLocation.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500
      );
    }
  }, [driverLocation, followDriver]);

  const fitToMarkers = () => {
    const points = [];
    if (driverLocation) {
      points.push({ latitude: driverLocation.lat, longitude: driverLocation.lng });
    }
    if (origin) {
      points.push({ latitude: origin.lat, longitude: origin.lng });
    }
    if (destination) {
      points.push({ latitude: destination.lat, longitude: destination.lng });
    }

    if (points.length > 0 && mapRef.current) {
      const region = getRegionForCoordinates(points);
      mapRef.current.animateToRegion(region, 500);
    }
  };

  const recenterOnDriver = () => {
    if (driverLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: driverLocation.lat,
          longitude: driverLocation.lng,
          latitudeDelta: 0.006,
          longitudeDelta: 0.006,
        },
        500
      );
    }
  };

  const initialRegion = driverLocation
    ? {
        latitude: driverLocation.lat,
        longitude: driverLocation.lng,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      }
    : DEFAULT_REGION;

  return (
    <View style={[{ flex: 1 }, style]}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        customMapStyle={MAP_STYLE}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {/* Driver Marker */}
        {driverLocation && (
          <DriverMarker
            coordinate={{
              latitude: driverLocation.lat,
              longitude: driverLocation.lng,
            }}
            heading={heading}
          />
        )}

        {/* Origin Marker */}
        {origin && (
          <Marker
            coordinate={{
              latitude: origin.lat,
              longitude: origin.lng,
            }}
            title="Origen"
            description={origin.address}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: colors.success,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 3,
                borderColor: '#fff',
              }}
            >
              <MaterialCommunityIcons name="alpha-a" size={20} color="#fff" />
            </View>
          </Marker>
        )}

        {/* Destination Marker */}
        {destination && (
          <Marker
            coordinate={{
              latitude: destination.lat,
              longitude: destination.lng,
            }}
            title="Destino"
            description={destination.address}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: colors.danger,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 3,
                borderColor: '#fff',
              }}
            >
              <MaterialCommunityIcons name="alpha-b" size={20} color="#fff" />
            </View>
          </Marker>
        )}

        {/* Route Polyline */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={colors.info}
            strokeWidth={4}
            lineDashPattern={null}
          />
        )}
      </MapView>

      {/* Recenter Button */}
      <TouchableOpacity
        onPress={recenterOnDriver}
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.border,
          elevation: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 4,
        }}
      >
        <MaterialCommunityIcons name="crosshairs-gps" size={24} color={colors.primary} />
      </TouchableOpacity>

      {/* Fit All Button */}
      <TouchableOpacity
        onPress={fitToMarkers}
        style={{
          position: 'absolute',
          bottom: 76,
          right: 20,
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.border,
          elevation: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 4,
        }}
      >
        <MaterialCommunityIcons name="fit-to-screen" size={24} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
};
