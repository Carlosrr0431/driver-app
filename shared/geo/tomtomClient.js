/**
 * Cliente HTTP de TomTom Search + Routing API.
 * La clave solo debe usarse en servidor (TOMTOM_API_KEY).
 */
const {
  TOMTOM_API_KEY,
  SALTA_CENTER_LAT,
  SALTA_CENTER_LNG,
  SALTA_SEARCH_RADIUS_M,
  TOMTOM_LANGUAGE,
  TOMTOM_COUNTRY_SET,
  TOMTOM_VIEW,
} = require('./mapConfig');

const SEARCH_BASE = 'https://api.tomtom.com/search/2';
const ROUTING_BASE = 'https://api.tomtom.com/routing/1';
const REQUEST_TIMEOUT_MS = 20000;

let lastRequestAt = 0;
let requestChain = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function getApiKey() {
  const key = String(TOMTOM_API_KEY || '').trim();
  if (!key) {
    throw new Error('TOMTOM_API_KEY no configurada');
  }
  return key;
}

function parseCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value || '').trim());
}

async function tomtomFetch(url, options = {}) {
  requestChain = requestChain.then(async () => {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < 80) {
      await sleep(80 - elapsed);
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      : null;

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller?.signal,
        headers: {
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      });
      const data = await response.json().catch(() => ({}));
      lastRequestAt = Date.now();

      if (!response.ok) {
        const reason = data?.errorText || data?.detailedError?.message || `HTTP ${response.status}`;
        throw new Error(String(reason));
      }

      return data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  return requestChain;
}

function defaultSearchParams(extra = {}) {
  return {
    key: getApiKey(),
    countrySet: TOMTOM_COUNTRY_SET,
    language: TOMTOM_LANGUAGE,
    view: TOMTOM_VIEW,
    lat: String(SALTA_CENTER_LAT),
    lon: String(SALTA_CENTER_LNG),
    radius: String(SALTA_SEARCH_RADIUS_M),
    ...extra,
  };
}

function buildSearchUrl(path, params = {}) {
  const qs = new URLSearchParams(defaultSearchParams(params));
  return `${SEARCH_BASE}${path}?${qs.toString()}`;
}

function mapTomTomAddress(addr = {}) {
  return {
    house_number: String(addr.streetNumber || '').trim(),
    road: String(addr.streetName || addr.streetNameAndNumber || '').trim(),
    city: String(addr.municipality || addr.municipalitySubdivision || '').trim(),
    state: String(addr.countrySubdivision || '').trim(),
    country: String(addr.country || 'Argentina').trim(),
    postcode: String(addr.postalCode || '').trim(),
  };
}

function mapTomTomResult(item) {
  const lat = parseCoordinate(item?.position?.lat);
  const lng = parseCoordinate(item?.position?.lon);
  if (lat === null || lng === null) return null;

  const addr = mapTomTomAddress(item.address || {});
  const poiName = String(item?.poi?.name || '').trim();
  const freeform = String(item?.address?.freeformAddress || '').trim();
  const formattedAddress = poiName
    ? [poiName, freeform || [addr.house_number, addr.road, addr.city].filter(Boolean).join(', ')].filter(Boolean).join(', ')
    : (freeform
      || [addr.house_number, addr.road, addr.city].filter(Boolean).join(', ')
      || poiName);

  const resultType = String(item?.type || '').toLowerCase();
  let osmClass = 'place';
  let osmType = resultType || 'unknown';
  if (resultType.includes('address') || resultType.includes('street')) {
    osmClass = 'building';
    osmType = addr.house_number ? 'house' : 'residential';
  } else if (resultType.includes('poi')) {
    osmClass = 'amenity';
    osmType = 'poi';
  } else if (resultType.includes('geography')) {
    osmClass = 'place';
    osmType = 'administrative';
  }

  return {
    lat,
    lng,
    formattedAddress,
    placeId: item.id != null
      ? String(item.id)
      : `coord:${lat.toFixed(6)},${lng.toFixed(6)}`,
    importance: Number(item.score) || 0,
    osmClass,
    osmType,
    address: addr,
    poiName,
  };
}

function extractSearchResults(data) {
  return (Array.isArray(data?.results) ? data.results : [])
    .map(mapTomTomResult)
    .filter(Boolean);
}

/**
 * Búsqueda difusa (direcciones, calles, lugares).
 */
async function fuzzySearch(query, { limit = 8, idxSet = 'Addr,Str,Geo' } = {}) {
  const text = String(query || '').trim();
  if (!text) return [];

  const data = await tomtomFetch(buildSearchUrl(`/search/${encodePathSegment(text)}.json`, {
    limit: String(Math.max(1, Math.min(limit, 20))),
    idxSet,
  }));

  return extractSearchResults(data);
}

/**
 * Búsqueda de POIs por nombre.
 */
async function poiSearch(query, { limit = 8 } = {}) {
  const text = String(query || '').trim();
  if (!text) return [];

  const data = await tomtomFetch(buildSearchUrl(`/poiSearch/${encodePathSegment(text)}.json`, {
    limit: String(Math.max(1, Math.min(limit, 20))),
    categorySet: '',
  }));

  return extractSearchResults(data);
}

/**
 * Geocodificación directa.
 */
async function geocodeQuery(query, { limit = 8 } = {}) {
  const text = String(query || '').trim();
  if (!text) return [];

  const data = await tomtomFetch(buildSearchUrl(`/geocode/${encodePathSegment(text)}.json`, {
    limit: String(Math.max(1, Math.min(limit, 20))),
  }));

  return extractSearchResults(data);
}

/**
 * Geocodificación inversa.
 */
async function reverseGeocodeCoords(lat, lng) {
  const data = await tomtomFetch(buildSearchUrl(
    `/reverseGeocode/${lat},${lng}.json`,
    { radius: '80' },
  ));

  const item = Array.isArray(data?.addresses) ? data.addresses[0] : null;
  if (!item) return null;

  const mapped = mapTomTomResult({
    id: item.id,
    type: 'Address',
    score: 1,
    position: { lat: item.position?.lat, lon: item.position?.lon },
    address: item.address,
  });

  return mapped;
}

/**
 * Detalle de lugar por entity id de TomTom.
 */
async function getPlaceById(entityId) {
  const id = String(entityId || '').trim();
  if (!id) return null;

  const data = await tomtomFetch(buildSearchUrl('/place.json', {
    entityId: id,
  }));

  const item = data?.result || data?.results?.[0] || null;
  if (!item) return null;
  return mapTomTomResult(item);
}

function formatRouteLocations(points) {
  return points
    .map((point) => {
      const lat = parseCoordinate(point?.lat ?? point?.latitude);
      const lng = parseCoordinate(point?.lng ?? point?.longitude);
      return `${lat},${lng}`;
    })
    .join(':');
}

function flattenRoutePoints(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const points = [];
  for (const leg of legs) {
    const legPoints = Array.isArray(leg?.points) ? leg.points : [];
    for (const point of legPoints) {
      const lat = parseCoordinate(point?.latitude ?? point?.lat);
      const lng = parseCoordinate(point?.longitude ?? point?.lon ?? point?.lng);
      if (lat === null || lng === null) continue;
      const last = points[points.length - 1];
      if (last && last.lat === lat && last.lng === lng) continue;
      points.push({ lat, lng, latitude: lat, longitude: lng });
    }
  }
  return points;
}

function mapTomTomRouteToOsrmShape(route) {
  const summary = route?.summary || {};
  const distance = Math.round(Number(summary.lengthInMeters) || 0);
  const duration = Math.round(Number(summary.travelTimeInSeconds) || 0);
  const polylineCoords = flattenRoutePoints(route);

  return {
    distance,
    duration,
    geometry: route?.encodedPolyline || '',
    polylineCoords,
    legs: Array.isArray(route?.legs) ? route.legs : [],
    guidance: route?.guidance || null,
    summary,
    _tomtom: route,
  };
}

/**
 * Calcula ruta entre puntos (origen, waypoints opcionales, destino).
 */
async function calculateRoute(origin, destination, waypoints = [], options = {}) {
  const from = {
    lat: parseCoordinate(origin?.lat ?? origin?.latitude),
    lng: parseCoordinate(origin?.lng ?? origin?.longitude),
  };
  const to = {
    lat: parseCoordinate(destination?.lat ?? destination?.latitude),
    lng: parseCoordinate(destination?.lng ?? destination?.longitude),
  };

  if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) {
    throw new Error('Coordenadas de ruta inválidas');
  }

  const via = (waypoints || [])
    .map((point) => ({
      lat: parseCoordinate(point?.lat ?? point?.latitude),
      lng: parseCoordinate(point?.lng ?? point?.longitude),
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  const locations = formatRouteLocations([from, ...via, to]);
  const params = new URLSearchParams({
    key: getApiKey(),
    travelMode: 'car',
    routeType: options.routeType || 'fastest',
    traffic: options.traffic === false ? 'false' : 'true',
    computeBestOrder: 'false',
    language: TOMTOM_LANGUAGE,
    instructionsType: options.instructionsType || 'text',
    ...(options.maxAlternatives
      ? {
        maxAlternatives: String(options.maxAlternatives),
        alternativeType: options.alternativeType || 'anyRoute',
      }
      : {}),
  });

  const data = await tomtomFetch(
    `${ROUTING_BASE}/calculateRoute/${locations}/json?${params.toString()}`,
  );

  const routes = Array.isArray(data?.routes) ? data.routes : [];
  if (!routes.length) {
    throw new Error('No se encontró ruta');
  }

  return routes.map(mapTomTomRouteToOsrmShape);
}

module.exports = {
  fuzzySearch,
  poiSearch,
  geocodeQuery,
  reverseGeocodeCoords,
  getPlaceById,
  calculateRoute,
  mapTomTomResult,
  flattenRoutePoints,
  mapTomTomRouteToOsrmShape,
};
