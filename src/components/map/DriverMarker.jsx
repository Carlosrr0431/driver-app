/**
 * Componente: DriverMarker
 * Marcador del conductor para MapLibre.
 */
import React from 'react';
import { View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

export const DriverMarker = ({ coordinate, heading = 0 }) => {
  const lat = Number(coordinate?.latitude ?? coordinate?.lat);
  const lng = Number(coordinate?.longitude ?? coordinate?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const rotation = Number.isFinite(heading) ? heading : 0;

  return (
    <Marker id="driver-marker" lngLat={[lng, lat]}>
      <View style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2.5,
        borderColor: '#FFFFFF',
        transform: [{ rotate: `${rotation}deg` }],
        boxShadow: '0 3px 10px rgba(40,46,105,0.45)',
      }}>
        <MaterialCommunityIcons name="navigation" size={20} color="#fff" />
      </View>
    </Marker>
  );
};
