/**
 * Componente: RoutePolyline
 * Obtiene direcciones OSRM (con caché compartida) y pinta la ruta en el mapa.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { decodePolyline } from '../../utils/polyline';
import { getDirections } from '../../services/routing';
import { MapRouteLayers } from './MapRouteLayers';

function routeEndpointKey(point) {
  if (!point) return '';
  const lat = point.lat ?? point.latitude;
  const lng = point.lng ?? point.longitude;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return '';
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

export const RoutePolyline = ({ origin, destination, onRouteReady, navigationMode = false }) => {
  const [routeCoords, setRouteCoords] = useState([]);
  const routeKey = useMemo(
    () => `${routeEndpointKey(origin)}->${routeEndpointKey(destination)}`,
    [origin, destination],
  );

  useEffect(() => {
    if (!routeKey || routeKey === '->') {
      setRouteCoords([]);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await getDirections(origin, destination);
        if (cancelled) return;
        const coords = Array.isArray(result.polylineCoords) && result.polylineCoords.length > 0
          ? result.polylineCoords
          : decodePolyline(result.polyline);
        setRouteCoords(coords);
        onRouteReady?.({
          distance: result.distance,
          duration: result.duration,
          coords,
        });
      } catch (error) {
        if (!cancelled) console.error('Error obteniendo ruta:', error);
      }
    })();

    return () => { cancelled = true; };
  }, [routeKey, origin, destination, onRouteReady]);

  if (routeCoords.length === 0) return null;

  return (
    <MapRouteLayers
      idPrefix="route-polyline"
      coords={routeCoords}
      navigationMode={navigationMode}
    />
  );
};
