import { OSRM_BASE_URL } from '../utils/mapConfig';
import { decodePolyline } from '../utils/polyline';

const ROUTE_TIMEOUT_MS = 20000;

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

function osrmManeuverToKey(maneuver) {
  const type = String(maneuver?.type || '').toLowerCase().replace(/\s+/g, ' ');
  const modifier = String(maneuver?.modifier || '').toLowerCase();

  if (type === 'arrive') return 'arrive';
  if (type === 'depart') return 'straight';

  if (type.includes('roundabout') || type === 'rotary' || type === 'roundabout turn') {
    if (modifier.includes('left')) return 'roundabout-left';
    if (modifier.includes('right')) return 'roundabout-right';
    return 'roundabout';
  }

  if (type === 'turn' || type === 'end of road' || type === 'fork') {
    if (modifier.includes('sharp') && modifier.includes('left')) return 'turn-sharp-left';
    if (modifier.includes('sharp') && modifier.includes('right')) return 'turn-sharp-right';
    if (modifier.includes('slight') && modifier.includes('left')) return 'turn-slight-left';
    if (modifier.includes('slight') && modifier.includes('right')) return 'turn-slight-right';
    if (modifier.includes('left')) return 'turn-left';
    if (modifier.includes('right')) return 'turn-right';
    return 'straight';
  }

  if (type === 'on ramp' || type === 'off ramp') {
    if (modifier.includes('left')) return 'ramp-left';
    if (modifier.includes('right')) return 'ramp-right';
    return 'ramp-right';
  }

  if (type === 'merge') return 'merge';
  if (type.includes('uturn')) return modifier.includes('right') ? 'uturn-right' : 'uturn-left';
  if (type === 'continue' || type === 'new name' || type === 'notification') return 'straight';

  return modifier ? `${type}-${modifier}`.replace(/\s+/g, '-') : (type || 'straight');
}

function buildOsrmInstruction(step) {
  const road = String(step?.name || step?.ref || '').trim();
  const maneuverKey = osrmManeuverToKey(step?.maneuver);
  const roadSuffix = road ? ` por ${road}` : '';

  if (maneuverKey.includes('roundabout')) {
    return road ? `En la rotonda, salí${roadSuffix}` : 'Entrá en la rotonda';
  }
  if (maneuverKey.includes('turn-left')) return `Doblá a la izquierda${roadSuffix}`;
  if (maneuverKey.includes('turn-right')) return `Doblá a la derecha${roadSuffix}`;
  if (maneuverKey.includes('uturn')) return `Hacé un retorno${roadSuffix}`;
  if (maneuverKey.includes('ramp-left')) return `Tomá la rampa a la izquierda${roadSuffix}`;
  if (maneuverKey.includes('ramp-right')) return `Tomá la rampa a la derecha${roadSuffix}`;
  if (maneuverKey === 'merge') return `Incorporate al tráfico${roadSuffix}`;
  if (maneuverKey === 'arrive') return 'Llegaste a destino';
  if (maneuverKey === 'straight' && road) return `Seguí por ${road}`;
  return road ? `Continuá${roadSuffix}` : 'Seguí derecho';
}

function normalizeOsrmStep(step, index, previousLocation) {
  const maneuverLocation = Array.isArray(step?.maneuver?.location)
    ? step.maneuver.location
    : null;
  const endLng = maneuverLocation ? Number(maneuverLocation[0]) : null;
  const endLat = maneuverLocation ? Number(maneuverLocation[1]) : null;
  const startLng = previousLocation?.lng ?? endLng;
  const startLat = previousLocation?.lat ?? endLat;

  const encodedPolyline = typeof step?.geometry === 'string' ? step.geometry : null;
  const decodedPolyline = encodedPolyline ? decodePolyline(encodedPolyline) : [];

  return {
    index,
    instruction: buildOsrmInstruction(step),
    distance: formatMeters(step?.distance),
    distanceValue: Math.round(Number(step?.distance) || 0),
    duration: formatSeconds(step?.duration),
    durationValue: Math.round(Number(step?.duration) || 0),
    maneuver: osrmManeuverToKey(step?.maneuver),
    startLocation: {
      lat: Number(startLat),
      lng: Number(startLng),
    },
    endLocation: {
      lat: Number(endLat),
      lng: Number(endLng),
    },
    polyline: encodedPolyline,
    polylineCoords: decodedPolyline,
  };
}

function mapOsrmRoute(route, leg) {
  const steps = Array.isArray(leg?.steps) ? leg.steps : [];
  let previousLocation = null;
  const normalizedSteps = steps
    .filter((step) => String(step?.maneuver?.type || '').toLowerCase() !== 'depart')
    .map((step, index) => {
      const normalized = normalizeOsrmStep(step, index, previousLocation);
      if (Number.isFinite(normalized.endLocation.lat) && Number.isFinite(normalized.endLocation.lng)) {
        previousLocation = normalized.endLocation;
      }
      return normalized;
    });

  return {
    distance: formatMeters(leg?.distance),
    duration: formatSeconds(leg?.duration),
    distanceValue: Math.round(Number(leg?.distance) || 0),
    durationValue: Math.round(Number(leg?.duration) || 0),
    polyline: route?.geometry || '',
    steps: normalizedSteps,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = ROUTE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Obtiene ruta de manejo vía OSRM (perfil driving).
 * Devuelve el mismo contrato que el antiguo getDirections de Google.
 * @see https://project-osrm.org/docs/v26.6.1/http
 */
export async function getDirections(origin, destination) {
  const from = toLatLng(origin);
  const to = toLatLng(destination);

  if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) {
    throw new Error('Coordenadas de ruta inválidas');
  }

  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    steps: 'true',
    overview: 'full',
    geometries: 'polyline',
    annotations: 'false',
  });

  const response = await fetchWithTimeout(
    `${OSRM_BASE_URL}/route/v1/driving/${coordinates}?${params.toString()}`,
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.code !== 'Ok' || !data?.routes?.length) {
    const reason = data?.message || data?.code || `HTTP ${response.status}`;
    throw new Error(reason === 'NoRoute' ? 'No se encontró ruta' : String(reason));
  }

  const route = data.routes[0];
  const leg = route.legs?.[0];
  if (!leg) {
    throw new Error('Respuesta de ruta inválida');
  }

  return mapOsrmRoute(route, leg);
}
