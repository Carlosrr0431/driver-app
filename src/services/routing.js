import { decodePolyline } from '../utils/polyline';
import { classifyStepOneway } from '../utils/routeOneway';
import {
  buildRouteCacheKey,
  routeCache,
  withCachedFetch,
} from '../lib/geoCache';
import { OSRM_BASE_URL } from '../utils/mapConfig';

function toLatLng(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.longitude);
  return { lat, lng };
}

function formatMeters(meters) {
  const value = Math.round(Number(meters) || 0);
  if (value < 1000) return `${value} m`;
  const km = value / 1000;
  return `${km >= 10 ? Math.round(km) : km.toFixed(1)} km`;
}

function formatSeconds(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
}

function formatOsrmManeuver(maneuver) {
  if (!maneuver) return 'straight';
  if (typeof maneuver === 'string') return maneuver;

  const type = String(maneuver.type || 'straight').toLowerCase();
  const modifier = String(maneuver.modifier || '').toLowerCase();
  if (type === 'roundabout' && maneuver.exit != null) {
    return modifier ? `roundabout-${modifier}` : 'roundabout';
  }
  if (modifier) return `${type}-${modifier}`;
  return type;
}

function mapOsrmStep(step, index, previousLocation) {
  const maneuverLoc = step?.maneuver?.location;
  const endLng = Array.isArray(maneuverLoc) ? Number(maneuverLoc[0]) : null;
  const endLat = Array.isArray(maneuverLoc) ? Number(maneuverLoc[1]) : null;
  const startLat = previousLocation?.lat ?? endLat;
  const startLng = previousLocation?.lng ?? endLng;
  const stepPolylineCoords = step?.geometry ? decodePolyline(step.geometry) : [];

  return {
    index,
    instruction: String(step?.name || '').trim() || 'Seguí derecho',
    distance: formatMeters(step?.distance || 0),
    distanceValue: Math.round(Number(step?.distance) || 0),
    duration: formatSeconds(step?.duration || 0),
    durationValue: Math.round(Number(step?.duration) || 0),
    maneuver: formatOsrmManeuver(step?.maneuver),
    startLocation: { lat: startLat, lng: startLng },
    endLocation: { lat: endLat, lng: endLng },
    polyline: step?.geometry || '',
    polylineCoords: stepPolylineCoords,
    likelyOneway: classifyStepOneway(step),
  };
}

async function fetchOsrmJson(coordinates, params) {
  const response = await fetch(
    `${OSRM_BASE_URL}/route/v1/driving/${coordinates}?${params.toString()}`,
    { headers: { Accept: 'application/json' } },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.code !== 'Ok' || !data?.routes?.[0]) {
    throw new Error(data?.message || data?.code || 'No se encontró ruta');
  }
  return data.routes[0];
}

/**
 * Navegación guiada: pasos + polilínea simplificada (menos puntos que overview=full).
 */
async function fetchOsrmRoute(from, to) {
  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    steps: 'true',
    overview: 'simplified',
    geometries: 'polyline',
    annotations: 'false',
  });

  const route = await fetchOsrmJson(coordinates, params);
  const leg = route?.legs?.[0];
  if (!leg) {
    throw new Error('Ruta sin tramos');
  }

  const polylineCoords = route.geometry ? decodePolyline(route.geometry) : [];
  let previousLocation = null;
  const steps = (Array.isArray(leg.steps) ? leg.steps : [])
    .map((step, index) => {
      const normalized = mapOsrmStep(step, index, previousLocation);
      if (Number.isFinite(normalized.endLocation.lat) && Number.isFinite(normalized.endLocation.lng)) {
        previousLocation = normalized.endLocation;
      }
      return normalized;
    });

  return {
    distance: formatMeters(leg.distance || 0),
    duration: formatSeconds(leg.duration || 0),
    distanceValue: Math.round(Number(leg.distance) || 0),
    durationValue: Math.round(Number(leg.duration) || 0),
    polyline: route.geometry || '',
    steps,
    polylineCoords,
  };
}

/**
 * Solo distancia/duración — sin geometría ni pasos (tarifas, previews).
 */
async function fetchOsrmSummary(from, to) {
  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    steps: 'false',
    overview: 'false',
    annotations: 'false',
  });

  const route = await fetchOsrmJson(coordinates, params);
  const leg = route?.legs?.[0];
  if (!leg) {
    throw new Error('Ruta sin tramos');
  }

  return {
    distance: formatMeters(leg.distance || 0),
    duration: formatSeconds(leg.duration || 0),
    distanceValue: Math.round(Number(leg.distance) || 0),
    durationValue: Math.round(Number(leg.duration) || 0),
  };
}

function summaryCacheKey(origin, destination) {
  return `summary:${buildRouteCacheKey(origin, destination)}`;
}

/**
 * Obtiene ruta de manejo vía OSRM (navegación guiada turn-by-turn).
 */
export async function getDirections(origin, destination, { bypassCache = false } = {}) {
  const from = toLatLng(origin);
  const to = toLatLng(destination);

  if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) {
    throw new Error('Coordenadas de ruta inválidas');
  }

  if (bypassCache) {
    return fetchOsrmRoute(from, to);
  }

  const cacheKey = buildRouteCacheKey(from, to);
  return withCachedFetch(routeCache, cacheKey, () => fetchOsrmRoute(from, to));
}

/**
 * Distancia y tiempo estimado sin polilínea — mucho más liviano para OSRM.
 */
export async function getRouteSummary(origin, destination, { bypassCache = false } = {}) {
  const from = toLatLng(origin);
  const to = toLatLng(destination);

  if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) {
    throw new Error('Coordenadas de ruta inválidas');
  }

  if (bypassCache) {
    return fetchOsrmSummary(from, to);
  }

  const cacheKey = summaryCacheKey(from, to);
  return withCachedFetch(routeCache, cacheKey, () => fetchOsrmSummary(from, to));
}
