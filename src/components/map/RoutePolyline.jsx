/**
 * Componente: RoutePolyline
 * Obtiene direcciones OSRM, decodifica la polyline y la pinta en MapLibre.
 */
import React, { useEffect, useState } from 'react';
import { decodePolyline } from '../../utils/polyline';
import { getDirections } from '../../services/routing';
import { MapRouteLayers } from './MapRouteLayers';

export const RoutePolyline = ({ origin, destination, onRouteReady, navigationMode = false }) => {
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
    <MapRouteLayers
      idPrefix="route-polyline"
      coords={routeCoords}
      navigationMode={navigationMode}
    />
  );
};
