/**
 * Marcador del conductor para MapLibre Native.
 * Se renderiza dentro de <MapLibreGL.MarkerView>.
 */
import React from 'react';
import { View } from 'react-native';
import MapLibreGL from '../../lib/maplibre';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { DRIVER_PUCK_SIZE_IDLE } from './driverPuckSizes';

export const DriverMarker = ({ coordinate, heading = 0 }) => {
  if (!coordinate?.latitude || !coordinate?.longitude) return null;

  const rotation = Number.isFinite(heading) ? heading : 0;
  const size = Math.round(DRIVER_PUCK_SIZE_IDLE * 0.82);

  return (
    <MapLibreGL.MarkerView
      id={`driver-marker-${coordinate.latitude}-${coordinate.longitude}`}
      coordinate={[coordinate.longitude, coordinate.latitude]}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primary,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 2.5, borderColor: '#FFFFFF',
        transform: [{ rotate: `${rotation}deg` }],
        elevation: 5,
      }}>
        <MaterialCommunityIcons name="navigation" size={Math.round(size * 0.52)} color="#fff" />
      </View>
    </MapLibreGL.MarkerView>
  );
};
