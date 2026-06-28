import React from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { DRIVER_PUCK_SIZE_NAV } from './driverPuckSizes';

const DRIVER_NAV_PUCK = require('../../../assets/driver-nav-puck.png');

/** Puck de navegación del conductor. Se renderiza dentro de MapLibreGL.MarkerView. */
const DriverNavMarker = React.memo(({ heading = 0 }) => {
  const rotation = Number.isFinite(heading) ? heading : 0;

  return (
    <View style={[styles.puckWrap, { transform: [{ rotate: `${rotation}deg` }] }]}>
      <Image source={DRIVER_NAV_PUCK} style={styles.puckImage} resizeMode="contain" />
    </View>
  );
});

DriverNavMarker.displayName = 'DriverNavMarker';
export default DriverNavMarker;

const styles = StyleSheet.create({
  puckWrap: {
    width: DRIVER_PUCK_SIZE_NAV,
    height: DRIVER_PUCK_SIZE_NAV,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puckImage: { width: DRIVER_PUCK_SIZE_NAV, height: DRIVER_PUCK_SIZE_NAV },
});
