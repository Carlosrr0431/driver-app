import React, { useEffect, useState } from 'react';
import { Polyline } from 'react-native-maps';
import { decodePolyline, getDirections } from '../../services/googleMaps';
import { colors } from '../../theme/colors';

export const RoutePolyline = ({ origin, destination, onRouteReady }) => {
  const [routeCoords, setRouteCoords] = useState([]);

  useEffect(() => {
    if (origin && destination) {
      fetchRoute();
    }
  }, [origin, destination]);

  const fetchRoute = async () => {
    try {
      const result = await getDirections(origin, destination);
      const coords = decodePolyline(result.polyline);
      setRouteCoords(coords);
      if (onRouteReady) {
        onRouteReady({
          distance: result.distance,
          duration: result.duration,
          coords,
        });
      }
    } catch (error) {
      console.error('Error obteniendo ruta:', error);
    }
  };

  if (routeCoords.length === 0) return null;

  return (
    <Polyline
      coordinates={routeCoords}
      strokeColor={colors.info}
      strokeWidth={4}
    />
  );
};
