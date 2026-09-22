import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import MapLibreGL from '../../lib/maplibre';
import { useSmoothMapCoords } from '../../hooks/useSmoothMapCoords';
import { DRIVER_PUCK_SIZE_IDLE } from './driverPuckSizes';

const DRIVER_PUCK = require('../../../assets/driver-nav-puck.png');

const puckBox = {
  width: DRIVER_PUCK_SIZE_IDLE,
  height: DRIVER_PUCK_SIZE_IDLE,
};

/** Marcador de posición actual del chofer para MapLibre Native. */
const DriverLocationMarker = React.memo(({ lat, lng, speed, heading, location }) => {
  const smooth = useSmoothMapCoords(
    lat ?? location?.lat,
    lng ?? location?.lng,
    speed ?? location?.speed,
    heading ?? location?.heading,
  );
  if (!Number.isFinite(Number(smooth?.lat)) || !Number.isFinite(Number(smooth?.lng))) return null;
  if (!smooth.lat && !smooth.lng) return null;

  return (
    <MapLibreGL.MarkerView
      id="driver-location-marker"
      coordinate={[Number(smooth.lng), Number(smooth.lat)]}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.wrap}>
        <Image
          source={DRIVER_PUCK}
          style={puckBox}
          contentFit="contain"
          cachePolicy="memory"
        />
      </View>
    </MapLibreGL.MarkerView>
  );
});

DriverLocationMarker.displayName = 'DriverLocationMarker';

export default DriverLocationMarker;

const styles = StyleSheet.create({
  wrap: {
    width: DRIVER_PUCK_SIZE_IDLE,
    height: DRIVER_PUCK_SIZE_IDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
