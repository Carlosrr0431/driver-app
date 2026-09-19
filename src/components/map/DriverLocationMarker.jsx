import React from 'react';
import { Image, View } from 'react-native';
import MapLibreGL from '../../lib/maplibre';
import { useSmoothMapCoords } from '../../hooks/useSmoothMapCoords';
import { DRIVER_PUCK_SIZE_IDLE } from './driverPuckSizes';

/** Marcador de posición actual del chofer para MapLibre Native. */
const DriverLocationMarker = React.memo(({ location }) => {
  const smooth = useSmoothMapCoords(
    location?.lat,
    location?.lng,
    location?.speed,
    location?.heading,
  );
  if (!Number.isFinite(Number(smooth?.lat)) || !Number.isFinite(Number(smooth?.lng))) return null;
  if (!smooth.lat && !smooth.lng) return null;

  return (
    <MapLibreGL.MarkerView
      id="driver-location-marker"
      coordinate={[Number(smooth.lng), Number(smooth.lat)]}
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
