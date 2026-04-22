const GOOGLE_MAPS_API_KEY = 'AIzaSyAkXsxRZfAehqO8EPxFN24nSJRPDHqh2jg';

const DIRECTIONS_BASE_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const GEOCODE_BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const AUTOCOMPLETE_BASE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const PLACE_DETAILS_BASE_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

// Salta Capital center and bounds
const SALTA_CENTER = { lat: -24.7829, lng: -65.4122 };
const SALTA_RADIUS = 12000; // 12km radius covering the city

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function stripHtmlInstruction(text) {
  return decodeHtmlEntities(String(text || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function getDistanceMeters(from, to) {
  if (!from || !to) return Number.POSITIVE_INFINITY;
  const lat1 = Number(from.latitude ?? from.lat);
  const lng1 = Number(from.longitude ?? from.lng);
  const lat2 = Number(to.latitude ?? to.lat);
  const lng2 = Number(to.longitude ?? to.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function projectPointToSegment(point, start, end) {
  const ax = start.longitude;
  const ay = start.latitude;
  const bx = end.longitude;
  const by = end.latitude;
  const px = point.longitude;
  const py = point.latitude;
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby;

  if (ab2 === 0) return start;

  const apx = px - ax;
  const apy = py - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  return {
    latitude: ay + aby * t,
    longitude: ax + abx * t,
  };
}

export function getDistanceToPolylineMeters(point, polylineCoords = []) {
  if (!point || polylineCoords.length === 0) return Number.POSITIVE_INFINITY;
  if (polylineCoords.length === 1) return getDistanceMeters(point, polylineCoords[0]);

  let minDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polylineCoords.length - 1; index += 1) {
    const projected = projectPointToSegment(point, polylineCoords[index], polylineCoords[index + 1]);
    const distance = getDistanceMeters(point, projected);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
}

function normalizeStep(step, index) {
  return {
    index,
    instruction: stripHtmlInstruction(step?.html_instructions || step?.instructions || ''),
    distance: step?.distance?.text || '',
    distanceValue: Number(step?.distance?.value) || 0,
    duration: step?.duration?.text || '',
    durationValue: Number(step?.duration?.value) || 0,
    maneuver: step?.maneuver || null,
    startLocation: {
      lat: Number(step?.start_location?.lat),
      lng: Number(step?.start_location?.lng),
    },
    endLocation: {
      lat: Number(step?.end_location?.lat),
      lng: Number(step?.end_location?.lng),
    },
    polyline: step?.polyline?.points || null,
  };
}

export function getRouteRemainingMeters(currentPoint, routeCoords = []) {
  if (!currentPoint || routeCoords.length === 0) return 0;
  if (routeCoords.length === 1) return getDistanceMeters(currentPoint, routeCoords[0]);

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < routeCoords.length; index += 1) {
    const distance = getDistanceMeters(currentPoint, routeCoords[index]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  let total = nearestDistance;
  for (let index = nearestIndex; index < routeCoords.length - 1; index += 1) {
    total += getDistanceMeters(routeCoords[index], routeCoords[index + 1]);
  }
  return Math.round(total);
}

export function getCurrentNavigationStep(currentPoint, steps = []) {
  if (!currentPoint || !Array.isArray(steps) || steps.length === 0) return null;

  // Find the step the driver is geometrically ON by projecting the current
  // position onto each step's line segment and picking the closest one.
  // This avoids falsely staying on an already-passed step.
  let bestIndex = 0;
  let bestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const startPt = { latitude: step.startLocation.lat, longitude: step.startLocation.lng };
    const endPt   = { latitude: step.endLocation.lat,   longitude: step.endLocation.lng };
    const projected = projectPointToSegment(currentPoint, startPt, endPt);
    const dist = getDistanceMeters(currentPoint, projected);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }

  const step = steps[bestIndex];
  const distToEnd = Math.round(getDistanceMeters(currentPoint, step.endLocation));

  // If we've essentially reached the end of this step, advance to the next one
  // so the instruction already shown is for the upcoming maneuver.
  if (distToEnd <= 35 && bestIndex + 1 < steps.length) {
    const next = steps[bestIndex + 1];
    return {
      ...next,
      distanceToStepMeters: Math.round(getDistanceMeters(currentPoint, next.endLocation)),
    };
  }

  return {
    ...step,
    distanceToStepMeters: distToEnd,
  };
}

export const getDirections = async (origin, destination) => {
  try {
    const originStr = `${origin.lat},${origin.lng}`;
    const destStr = `${destination.lat},${destination.lng}`;

    const response = await fetch(
      `${DIRECTIONS_BASE_URL}?origin=${originStr}&destination=${destStr}&key=${GOOGLE_MAPS_API_KEY}&language=es`
    );
    const data = await response.json();

    if (data.status !== 'OK' || !data.routes.length) {
      throw new Error('No se pudo obtener la ruta');
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    return {
      distance: leg.distance.text,
      duration: leg.duration.text,
      distanceValue: leg.distance.value,
      durationValue: leg.duration.value,
      polyline: route.overview_polyline.points,
      steps: Array.isArray(leg.steps) ? leg.steps.map((step, index) => normalizeStep(step, index)) : [],
    };
  } catch (error) {
    console.error('Error obteniendo direcciones:', error);
    throw error;
  }
};

// ─── Scoring helpers ────────────────────────────────────────────────────────

/**
 * Puntúa un resultado de reverse-geocode por precisión.
 * Mayor puntaje = resultado más específico y confiable.
 */
function scoreReverseResult(result) {
  const types = Array.isArray(result?.types) ? result.types : [];
  const locationType = result?.geometry?.location_type || '';
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const hasStreetNumber = components.some((c) => c.types?.includes('street_number'));
  const hasRoute = components.some((c) => c.types?.includes('route'));

  let score = 0;
  if (types.includes('street_address')) score += 40;
  else if (types.includes('premise')) score += 35;
  else if (types.includes('subpremise')) score += 30;
  else if (types.includes('establishment')) score += 20;
  else if (types.includes('intersection')) score += 15;
  else if (types.includes('route')) score += 5;
  if (types.some((t) => ['locality','administrative_area_level_1','administrative_area_level_2','country','political','postal_code'].includes(t))) score -= 30;
  if (locationType === 'ROOFTOP') score += 30;
  else if (locationType === 'RANGE_INTERPOLATED') score += 20;
  else if (locationType === 'GEOMETRIC_CENTER') score += 10;
  else if (locationType === 'APPROXIMATE') score -= 10;
  if (hasStreetNumber) score += 15;
  if (hasRoute) score += 10;
  return score;
}

/**
 * Puntúa un resultado de geocode directo (address → coords).
 */
function scoreGeocodeResult(result, query) {
  const types = Array.isArray(result?.types) ? result.types : [];
  const locationType = result?.geometry?.location_type || '';
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const hasStreetNumber = components.some((c) => c.types?.includes('street_number'));
  const hasRoute = components.some((c) => c.types?.includes('route'));
  const formatted = (result?.formatted_address || '').toLowerCase();
  const q = String(query || '').toLowerCase();

  let score = 0;
  if (types.includes('street_address')) score += 30;
  else if (types.includes('premise')) score += 25;
  else if (types.includes('intersection')) score += 20;
  else if (types.includes('establishment')) score += 15;
  if (locationType === 'ROOFTOP') score += 25;
  else if (locationType === 'RANGE_INTERPOLATED') score += 15;
  else if (locationType === 'APPROXIMATE') score -= 15;
  if (hasStreetNumber) score += 15;
  if (hasRoute) score += 10;
  if (result?.partial_match) score -= 20;
  // Bonus si la dirección contiene Salta
  if (formatted.includes('salta')) score += 10;
  // Penalizar si hay números en la query y no hay street_number
  if (/\d/.test(q) && !hasStreetNumber) score -= 10;
  return score;
}

// ─── Geocode ──────────────────────────────────────────────────────────────────

export const geocodeAddress = async (address) => {
  try {
    const params = new URLSearchParams({
      address: `${address}, Salta`,
      key: GOOGLE_MAPS_API_KEY,
      language: 'es',
      region: 'ar',
      components: 'country:AR',
      bounds: '-24.90,-65.55|-24.70,-65.30',
    });
    const response = await fetch(`${GEOCODE_BASE_URL}?${params}`);
    const data = await response.json();

    if (data.status !== 'OK' || !data.results.length) {
      throw new Error('No se encontró la dirección');
    }

    // Elegir el resultado con mayor puntaje en vez de siempre el primero
    const best = data.results
      .map((r) => ({ r, score: scoreGeocodeResult(r, address) }))
      .sort((a, b) => b.score - a.score)[0].r;

    return {
      lat: best.geometry.location.lat,
      lng: best.geometry.location.lng,
      formattedAddress: best.formatted_address,
    };
  } catch (error) {
    console.error('Error geocodificando:', error);
    throw error;
  }
};

/**
 * Geocode returning ALL results (up to limit) for disambiguation
 */
export const geocodeAddressMultiple = async (address, limit = 5) => {
  try {
    const params = new URLSearchParams({
      address: `${address}, Salta`,
      key: GOOGLE_MAPS_API_KEY,
      language: 'es',
      region: 'ar',
      components: 'country:AR',
      bounds: '-24.90,-65.55|-24.70,-65.30',
    });
    const response = await fetch(`${GEOCODE_BASE_URL}?${params}`);
    const data = await response.json();

    if (data.status !== 'OK' || !data.results.length) {
      throw new Error('No se encontró la dirección');
    }

    // Ordenar por puntaje de precisión antes de devolver
    return data.results
      .map((r) => ({ r, score: scoreGeocodeResult(r, address) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ r }) => ({
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        formattedAddress: r.formatted_address,
      }));
  } catch (error) {
    console.error('Error geocodificando múltiple:', error);
    throw error;
  }
};

export const reverseGeocode = async (lat, lng) => {
  const fallback = `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
  try {
    // Pasada 1: pedir solo street_address con ROOFTOP o RANGE_INTERPOLATED (máxima precisión)
    const preciseParams = new URLSearchParams({
      latlng: `${lat},${lng}`,
      result_type: 'street_address',
      location_type: 'ROOFTOP|RANGE_INTERPOLATED',
      key: GOOGLE_MAPS_API_KEY,
      language: 'es',
      region: 'ar',
    });
    const preciseResp = await fetch(`${GEOCODE_BASE_URL}?${preciseParams}`);
    const preciseData = await preciseResp.json();
    if (preciseData.status === 'OK' && preciseData.results?.length) {
      const best = preciseData.results
        .map((r) => ({ r, score: scoreReverseResult(r) }))
        .sort((a, b) => b.score - a.score)[0].r;
      return best.formatted_address || fallback;
    }

    // Pasada 2: consulta general, elegir el resultado más preciso por scoring
    const generalParams = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: GOOGLE_MAPS_API_KEY,
      language: 'es',
      region: 'ar',
    });
    const response = await fetch(`${GEOCODE_BASE_URL}?${generalParams}`);
    const data = await response.json();

    if (data.status !== 'OK' || !data.results?.length) {
      throw new Error('No se pudo obtener la dirección');
    }

    const best = data.results
      .map((r) => ({ r, score: scoreReverseResult(r) }))
      .sort((a, b) => b.score - a.score)[0].r;
    return best.formatted_address || fallback;
  } catch (error) {
    console.error('Error en geocodificación inversa:', error);
    return fallback;
  }
};

/**
 * Search using Google Places Autocomplete API (same as Google Maps search bar)
 * Returns predictions constrained to Salta Capital — addresses AND establishments
 * Returns instantly WITHOUT resolving lat/lng (use getPlaceDetails for that on selection)
 */
export const autocompleteAddressSalta = async (query, limit = 5) => {
  try {
    const params = new URLSearchParams({
      input: query,
      key: GOOGLE_MAPS_API_KEY,
      language: 'es',
      components: 'country:ar',
      location: `${SALTA_CENTER.lat},${SALTA_CENTER.lng}`,
      radius: String(SALTA_RADIUS),
      strictbounds: 'true',
    });

    const response = await fetch(`${AUTOCOMPLETE_BASE_URL}?${params}`);
    const data = await response.json();

    if (data.status !== 'OK' || !data.predictions?.length) {
      return [];
    }

    return data.predictions.slice(0, limit).map((pred) => ({
      address: pred.description,
      placeId: pred.place_id,
    }));
  } catch (error) {
    console.error('Error en autocomplete:', error);
    return [];
  }
};

/**
 * Get place details (lat/lng) from a place_id
 */
export const getPlaceDetails = async (placeId) => {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'geometry',
    key: GOOGLE_MAPS_API_KEY,
  });

  const response = await fetch(`${PLACE_DETAILS_BASE_URL}?${params}`);
  const data = await response.json();

  if (data.status !== 'OK' || !data.result?.geometry?.location) {
    throw new Error('No se pudo obtener detalles del lugar');
  }

  return {
    lat: data.result.geometry.location.lat,
    lng: data.result.geometry.location.lng,
  };
};

export const decodePolyline = (encoded) => {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return points;
};
