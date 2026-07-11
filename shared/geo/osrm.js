const { OSRM_BASE_URL } = require('./mapConfig');
const { decodePolyline } = require('./polyline');

const ROUTE_TIMEOUT_MS = 20000;

function toLatLng(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.longitude);
  return { lat, lng };
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

function formatCoordinatesPath(points) {
  return points
    .map((p) => {
      const { lat, lng } = toLatLng(p);
      return `${lng},${lat}`;
    })
    .join(';');
}

async function fetchOsrm(path, timeoutMs = ROUTE_TIMEOUT_MS) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(`${OSRM_BASE_URL}${path}`, {
      signal: controller?.signal,
      headers: { Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.code !== 'Ok') {
      const reason = data?.message || data?.code || `HTTP ${response.status}`;
      throw new Error(String(reason));
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getRouteMetrics(origin, destination, waypoints = []) {
  const from = toLatLng(origin);
  const to = toLatLng(destination);
  if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) {
    return { distanceKm: null, durationMinutes: null };
  }

  const pathPoints = [from, ...waypoints.map(toLatLng), to];
  const coordinates = formatCoordinatesPath(pathPoints);
  const params = new URLSearchParams({
    overview: 'false',
    alternatives: 'true',
    steps: 'false',
  });

  const data = await fetchOsrm(`/route/v1/driving/${coordinates}?${params.toString()}`);
  const routes = Array.isArray(data?.routes) ? data.routes : [];
  if (!routes.length) {
    return { distanceKm: null, durationMinutes: null };
  }

  const best = routes.reduce((acc, route) => {
    const distance = Number(route?.distance) || 0;
    const duration = Number(route?.duration) || 0;
    if (!acc || distance < acc.distance) {
      return { distance, duration };
    }
    return acc;
  }, null);

  if (!best) {
    return { distanceKm: null, durationMinutes: null };
  }

  return {
    distanceKm: Math.round((best.distance / 1000) * 10) / 10,
    durationMinutes: Math.round(best.duration / 60),
  };
}

async function getDirectionsResponse(origin, destination) {
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

  const data = await fetchOsrm(`/route/v1/driving/${coordinates}?${params.toString()}`);
  const route = data.routes[0];
  const leg = route?.legs?.[0];
  if (!leg) throw new Error('Ruta sin tramos');

  const steps = Array.isArray(leg.steps) ? leg.steps : [];
  let prevLat = from.lat;
  let prevLng = from.lng;

  return {
    distance: {
      value: Math.round(Number(leg.distance) || 0),
      text: `${((Number(leg.distance) || 0) / 1000).toFixed(1)} km`,
    },
    duration: {
      value: Math.round(Number(leg.duration) || 0),
      text: `${Math.round((Number(leg.duration) || 0) / 60)} min`,
    },
    durationStatic: {
      value: Math.round(Number(leg.duration) || 0),
      text: `${Math.round((Number(leg.duration) || 0) / 60)} min`,
    },
    polyline: route.geometry || '',
    steps: steps.map((step) => {
      const loc = step?.maneuver?.location;
      const endLng = Array.isArray(loc) ? Number(loc[0]) : prevLng;
      const endLat = Array.isArray(loc) ? Number(loc[1]) : prevLat;
      const mapped = {
        distance: { value: Math.round(Number(step.distance) || 0) },
        duration: { value: Math.round(Number(step.duration) || 0) },
        html_instructions: step.name || '',
        maneuver: formatOsrmManeuver(step.maneuver),
        polyline: { points: step.geometry || '' },
        startLocation: { lat: prevLat, lng: prevLng },
        endLocation: { lat: endLat, lng: endLng },
      };
      prevLat = endLat;
      prevLng = endLng;
      return mapped;
    }),
    distanceValue: Math.round(Number(leg.distance) || 0),
    durationValue: Math.round(Number(leg.duration) || 0),
    polylineCoords: route.geometry ? decodePolyline(route.geometry) : [],
  };
}

async function getRouteMetricsByAddress(originAddress, destinationAddress) {
  const { geocodeAddress } = require('./nominatim');
  const origin = await geocodeAddress(originAddress);
  const destination = await geocodeAddress(destinationAddress);

  const from = { lat: origin.lat, lng: origin.lng };
  const to = { lat: destination.lat, lng: destination.lng };
  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    overview: 'false',
    alternatives: 'true',
    steps: 'false',
  });

  const data = await fetchOsrm(`/route/v1/driving/${coordinates}?${params.toString()}`);
  const routes = Array.isArray(data?.routes) ? data.routes : [];
  if (!routes.length) {
    return {
      distanceKm: null,
      durationMinutes: null,
      originResolved: origin.formattedAddress,
      destinationResolved: destination.formattedAddress,
    };
  }

  const routesWithMetrics = routes.map((route) => ({
    route,
    distance: Number(route.distance) || 0,
    duration: Number(route.duration) || 0,
  }));
  const minDuration = Math.min(...routesWithMetrics.map((r) => r.duration));
  const reasonable = routesWithMetrics.filter((r) => r.duration <= minDuration * 2.5);
  reasonable.sort((a, b) => b.distance - a.distance);
  const bestEntry = reasonable[0] || routesWithMetrics[0];

  return {
    distanceKm: Math.round((bestEntry.distance / 1000) * 10) / 10,
    durationMinutes: Math.round(bestEntry.duration / 60),
    originResolved: origin.formattedAddress,
    destinationResolved: destination.formattedAddress,
    originLat: origin.lat,
    originLng: origin.lng,
    destLat: destination.lat,
    destLng: destination.lng,
  };
}

async function getRouteAlternatives(origin, destination) {
  const from = toLatLng(origin);
  const to = toLatLng(destination);
  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    overview: 'full',
    alternatives: 'true',
    geometries: 'polyline',
    steps: 'false',
  });
  const data = await fetchOsrm(`/route/v1/driving/${coordinates}?${params.toString()}`);
  return Array.isArray(data?.routes) ? data.routes : [];
}

async function getPassengerFareRoute(origin, destination, waypoints = []) {
  const from = toLatLng(origin);
  const to = toLatLng(destination);
  if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) {
    return null;
  }

  const pathPoints = [from, ...waypoints.map(toLatLng), to];
  const coordinates = formatCoordinatesPath(pathPoints);
  const params = new URLSearchParams({
    overview: 'full',
    alternatives: 'true',
    geometries: 'polyline',
    steps: 'false',
  });

  const data = await fetchOsrm(`/route/v1/driving/${coordinates}?${params.toString()}`);
  const routes = Array.isArray(data?.routes) ? data.routes : [];
  if (!routes.length) return null;

  return routes;
}

module.exports = {
  getRouteMetrics,
  getDirectionsResponse,
  getRouteMetricsByAddress,
  getRouteAlternatives,
  getPassengerFareRoute,
  decodePolyline,
  formatOsrmManeuver,
};
