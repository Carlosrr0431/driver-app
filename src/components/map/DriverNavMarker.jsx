import React from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';

const DRIVER_NAV_PUCK = require('../../../assets/driver-nav-puck.png');

/**
 * Puck de navegación del conductor sobre MapLibre.
 */
const DriverNavMarker = React.memo(({ lngLat, heading = 0 }) => {
  if (!Array.isArray(lngLat) || lngLat.length < 2) return null;

  const rotation = Number.isFinite(heading) ? heading : 0;

  return (
    <Marker id="driver-nav-puck" lngLat={lngLat}>
      <View
        style={[
          styles.puckWrap,
          { transform: [{ rotate: `${rotation}deg` }] },
        ]}
      >
        <Image source={DRIVER_NAV_PUCK} style={styles.puckImage} resizeMode="contain" />
      </View>
    </Marker>
  );
});

DriverNavMarker.displayName = 'DriverNavMarker';

export default DriverNavMarker;

const styles = StyleSheet.create({
  puckWrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puckImage: {
    width: 52,
    height: 52,
  },
});
