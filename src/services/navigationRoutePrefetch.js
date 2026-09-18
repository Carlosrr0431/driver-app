import { resolveTripPickupCoords } from '../../shared/trip-contract';
import { prefetchNavigationRoute } from './routing';

export function resolveDriverToPickupEndpoints(trip, location) {
  if (!trip || !location) return null;

  const originLat = Number(location?.lat ?? location?.latitude);
  const originLng = Number(location?.lng ?? location?.longitude);
  if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) return null;
  if (originLat === 0 && originLng === 0) return null;

  const pickup = resolveTripPickupCoords(trip);
  if (pickup?.lat == null || pickup?.lng == null) return null;

  const destLat = Number(pickup.lat);
  const destLng = Number(pickup.lng);
  if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return null;
  if (destLat === 0 && destLng === 0) return null;

  return {
    origin: { lat: originLat, lng: originLng },
    destination: { lat: destLat, lng: destLng },
  };
}

/**
 * Arranca OSRM hacia el retiro apenas llega la oferta, para que al aceptar
 * la navegación guiada ya esté en cache.
 */
export function prefetchDriverToPickupRoute(trip, location) {
  const endpoints = resolveDriverToPickupEndpoints(trip, location);
  if (!endpoints) return Promise.resolve(null);
  return prefetchNavigationRoute(endpoints.origin, endpoints.destination);
}
