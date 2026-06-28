import React from 'react';
import { Image, View } from 'react-native';
import MapLibreGL from '../../lib/maplibre';
import { DRIVER_PUCK_SIZE_IDLE } from './driverPuckSizes';

/** Marcador de posición actual del chofer para MapLibre Native. */
const DriverLocationMarker = React.memo(({ location }) => {
  if (!location?.lat || !location?.lng) return null;

  return (
    <MapLibreGL.MarkerView
      id="driver-location-marker"
      coordinate={[Number(location.lng), Number(location.lat)]}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={{
        width: DRIVER_PUCK_SIZE_IDLE,
        height: DRIVER_PUCK_SIZE_IDLE,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      >
        <Image
          source={require('../../../assets/driver-nav-puck.png')}
          style={{ width: DRIVER_PUCK_SIZE_IDLE, height: DRIVER_PUCK_SIZE_IDLE }}
          resizeMode="contain"
        />
      </View>
    </MapLibreGL.MarkerView>
  );
});

DriverLocationMarker.displayName = 'DriverLocationMarker';

export default DriverLocationMarker;
