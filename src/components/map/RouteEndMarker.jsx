import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import { colors } from '../../theme/colors';

/**
 * Marca el punto final de la ruta activa en MapLibre.
 */
const RouteEndMarker = React.memo(({ lngLat, variant = 'destination' }) => {
  const isPickup = variant === 'pickup';

  if (!Array.isArray(lngLat) || lngLat.length < 2) return null;

  return (
    <Marker id={`route-end-${variant}`} lngLat={lngLat}>
      <View style={styles.wrap}>
        <View style={styles.halo} />
        <View style={[styles.pin, isPickup ? styles.pinRound : styles.pinSquare]}>
          <View style={[styles.core, isPickup ? styles.corePickup : styles.coreDest]} />
        </View>
      </View>
    </Marker>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(40, 46, 105, 0.12)',
  },
  pin: {
    width: 22,
    height: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    boxShadow: '0 2px 6px rgba(15,23,42,0.2)',
  },
  pinRound: {
    borderRadius: 11,
  },
  pinSquare: {
    borderRadius: 5,
  },
  corePickup: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  coreDest: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
});

RouteEndMarker.displayName = 'RouteEndMarker';

export default RouteEndMarker;
