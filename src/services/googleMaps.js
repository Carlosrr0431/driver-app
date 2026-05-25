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

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function decodePolyline(encoded = '') {
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
}

/**
 * Evalua si corresponde recalcular la ruta para reaccionar rapido a desvios
 * reales sin entrar en bucles por jitter de GPS.
 */
export function evaluateRerouteState({
  deviationMeters,
  speedMps = 0,
  accuracyMeters = null,
  distanceToNextStepMeters = null,
  state = {},
  now = Date.now(),
}) {
  const deviation = Number.isFinite(deviationMeters) ? Math.max(0, Number(deviationMeters)) : 0;
  const speed = Number.isFinite(speedMps) ? Math.max(0, Number(speedMps)) : 0;
  const speedKmh = speed * 3.6;
  const accuracy = Number.isFinite(accuracyMeters) ? Math.max(0, Number(accuracyMeters)) : null;
  const nextStepMeters = Number.isFinite(distanceToNextStepMeters)
    ? Math.max(0, Number(distanceToNextStepMeters))
    : null;
  const nearManeuver = nextStepMeters !== null && nextStepMeters <= 180;

  // Umbral dinamico similar al comportamiento de SDK de navegacion:
  // mas estricto cerca de maniobras y mas tolerante con mala precision.
  const speedAllowance = clampNumber(speedKmh * 0.3, 0, 20);
  const accuracyAllowance = accuracy === null
    ? 8
    : clampNumber((accuracy - 8) * 0.8, 0, 24);
  const maneuverTightening = nearManeuver ? 8 : 0;

  const enterThreshold = clampNumber(40 + speedAllowance + accuracyAllowance - maneuverTightening, 35, 88);
  const exitThreshold = clampNumber(enterThreshold * 0.58, 20, 55);
  const hardThreshold = Math.max(enterThreshold + 18, enterThreshold * 1.4);

  const persistMs = nearManeuver ? 900 : speedKmh >= 60 ? 1200 : speedKmh >= 30 ? 1700 : 2400;
  const cooldownMs = nearManeuver ? 3500 : speedKmh >= 60 ? 4000 : 5000;

  let offRouteSinceTs = Number.isFinite(state.offRouteSinceTs) ? state.offRouteSinceTs : null;
  let offRouteSamples = Number.isFinite(state.offRouteSamples) ? state.offRouteSamples : 0;
  let onRouteSamples = Number.isFinite(state.onRouteSamples) ? state.onRouteSamples : 0;

  const previousEma = Number.isFinite(state.emaDeviation)
    ? state.emaDeviation
    : deviation;
  const emaDeviation = previousEma * 0.68 + deviation * 0.32;
  const isDeviationIncreasingFast = emaDeviation - previousEma >= 4;

  if (deviation >= enterThreshold) {
    offRouteSamples += 1;
    onRouteSamples = 0;
    if (offRouteSinceTs === null) offRouteSinceTs = now;
  } else if (deviation <= exitThreshold) {
    onRouteSamples += 1;
    if (onRouteSamples >= 2) {
      offRouteSinceTs = null;
      offRouteSamples = 0;
    }
  } else {
    // Banda de histeresis: no entramos ni salimos abruptamente del estado.
    onRouteSamples = Math.max(0, onRouteSamples - 1);
  }

  const persistentOffRoute = offRouteSinceTs !== null
    && offRouteSamples >= 2
    && (now - offRouteSinceTs) >= persistMs;
  const severeOffRoute = deviation >= hardThreshold
    && (isDeviationIncreasingFast || offRouteSamples >= 2);

  return {
    shouldReroute: persistentOffRoute || severeOffRoute,
    rerouteReason: severeOffRoute
      ? 'deviation_severe'
      : (persistentOffRoute ? 'deviation_persistent' : null),
    thresholds: {
      enterThreshold,
      exitThreshold,
      hardThreshold,
      persistMs,
      cooldownMs,
      nearManeuver,
    },
    state: {
      offRouteSinceTs,
      offRouteSamples,
      onRouteSamples,
      emaDeviation,
      lastDeviationMeters: deviation,
      lastUpdatedAt: now,
    },
  };
}

function normalizeStep(step, index) {
  const encodedPolyline = step?.polyline?.points || null;
  const decodedPolyline = encodedPolyline ? decodePolyline(encodedPolyline) : [];
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
    polyline: encodedPolyline,
    polylineCoords: decodedPolyline,
  };
}

function getPolylineTotalLengthMeters(routeCoords = []) {
  if (routeCoords.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < routeCoords.length - 1; index += 1) {
    total += getDistanceMeters(routeCoords[index], routeCoords[index + 1]);
  }
  return total;
}

/**
 * Proyecta un punto GPS sobre la polilínea de ruta.
 * Devuelve posición ajustada a la calle, distancia recorrida y desvío lateral.
 */
export function projectPointOntoPolyline(point, routeCoords = []) {
  if (!point || routeCoords.length === 0) {
    return {
      snappedPoint: point || null,
      segmentIndex: 0,
      distanceAlongMeters: 0,
      deviationMeters: Number.POSITIVE_INFINITY,
    };
  }

  if (routeCoords.length === 1) {
    const deviationMeters = getDistanceMeters(point, routeCoords[0]);
    return {
      snappedPoint: routeCoords[0],
      segmentIndex: 0,
      distanceAlongMeters: 0,
      deviationMeters,
    };
  }

  let best = {
    segmentIndex: 0,
    distanceAlongMeters: 0,
    deviationMeters: Number.POSITIVE_INFINITY,
    snappedPoint: routeCoords[0],
  };

  let accumulated = 0;
  for (let index = 0; index < routeCoords.length - 1; index += 1) {
    const start = routeCoords[index];
    const end = routeCoords[index + 1];
    const projected = projectPointToSegment(point, start, end);
    const deviationMeters = getDistanceMeters(point, projected);
    const segmentLength = getDistanceMeters(start, end);
    const alongSegment = getDistanceMeters(start, projected);

    if (deviationMeters < best.deviationMeters) {
      best = {
        segmentIndex: index,
        distanceAlongMeters: accumulated + alongSegment,
        deviationMeters,
        snappedPoint: projected,
      };
    }
    accumulated += segmentLength;
  }

  return best;
}

function buildStepEndDistances(steps = [], routeLengthMeters = 0) {
  if (!Array.isArray(steps) || steps.length === 0) return [];

  let cumulative = 0;
  const markers = steps.map((step, index) => {
    const stepMeters = Number(step?.distanceValue);
    cumulative += Number.isFinite(stepMeters) && stepMeters > 0 ? stepMeters : 0;
    return {
      index,
      endDistanceMeters: Math.min(cumulative, routeLengthMeters || cumulative),
      step,
    };
  });

  if (routeLengthMeters > 0 && markers.length > 0) {
    markers[markers.length - 1].endDistanceMeters = routeLengthMeters;
  }

  return markers;
}

function resolveStepFromProgress(distanceAlongMeters, stepMarkers = [], lastStepIndex = 0) {
  if (!stepMarkers.length) return null;

  const advanceThresholdMeters = 28;
  let stepIndex = Math.max(0, Math.min(lastStepIndex, stepMarkers.length - 1));

  for (let index = stepIndex; index < stepMarkers.length; index += 1) {
    if (distanceAlongMeters + advanceThresholdMeters < stepMarkers[index].endDistanceMeters) {
      stepIndex = index;
      break;
    }
    stepIndex = index;
  }

  const marker = stepMarkers[stepIndex];
  const distanceToStepMeters = Math.max(
    0,
    Math.round(marker.endDistanceMeters - distanceAlongMeters),
  );

  if (distanceToStepMeters <= advanceThresholdMeters && stepIndex + 1 < stepMarkers.length) {
    const next = stepMarkers[stepIndex + 1];
    return {
      ...next.step,
      index: next.index,
      distanceToStepMeters: Math.max(
        0,
        Math.round(next.endDistanceMeters - distanceAlongMeters),
      ),
    };
  }

  return {
    ...marker.step,
    index: marker.index,
    distanceToStepMeters,
  };
}

function estimateRemainingDurationSeconds({
  remainingMeters,
  speedMps = 0,
  routeDistanceMeters = 0,
  routeDurationSeconds = 0,
}) {
  if (!Number.isFinite(remainingMeters) || remainingMeters <= 0) return 0;

  const trafficEta = routeDistanceMeters > 0 && routeDurationSeconds > 0
    ? (remainingMeters / routeDistanceMeters) * routeDurationSeconds
    : null;

  const speedKmh = Math.max(0, Number(speedMps) || 0) * 3.6;
  if (speedKmh >= 8) {
    const effectiveSpeedMps = Math.max(Number(speedMps) || 0, 2.8);
    const speedEta = remainingMeters / effectiveSpeedMps;
    if (Number.isFinite(trafficEta)) {
      return Math.max(0, Math.round(speedEta * 0.62 + trafficEta * 0.38));
    }
    return Math.max(0, Math.round(speedEta));
  }

  if (Number.isFinite(trafficEta)) {
    return Math.max(0, Math.round(trafficEta));
  }

  return null;
}

function smoothEtaSeconds(nextEtaSeconds, previousEtaSeconds) {
  if (!Number.isFinite(nextEtaSeconds) || nextEtaSeconds <= 0) {
    return previousEtaSeconds ?? null;
  }
  if (!Number.isFinite(previousEtaSeconds) || previousEtaSeconds <= 0) {
    return nextEtaSeconds;
  }
  return Math.round(previousEtaSeconds * 0.72 + nextEtaSeconds * 0.28);
}

export function createInitialNavigationProgressState() {
  return {
    lastDistanceAlongMeters: 0,
    lastStepIndex: 0,
    smoothedEtaSeconds: null,
  };
}

/**
 * Calcula el estado completo de navegación en un solo paso, al estilo Navigation SDK:
 * proyección sobre ruta, progreso monótono, paso actual y ETA híbrida (velocidad + tráfico).
 */
export function computeNavigationSnapshot({
  currentPoint,
  routeCoords = [],
  steps = [],
  progressState = {},
  speedMps = 0,
  routeDistanceMeters = 0,
  routeDurationSeconds = 0,
  accuracyMeters = null,
}) {
  const routeLengthMeters = routeDistanceMeters > 0
    ? routeDistanceMeters
    : getPolylineTotalLengthMeters(routeCoords);

  if (!currentPoint || routeCoords.length === 0 || routeLengthMeters <= 0) {
    return {
      snappedPoint: currentPoint || null,
      deviationMeters: Number.POSITIVE_INFINITY,
      remainingDistanceMeters: 0,
      remainingDurationSeconds: null,
      currentStep: null,
      progressRatio: 0,
      progressState: progressState || createInitialNavigationProgressState(),
    };
  }

  const projection = projectPointOntoPolyline(currentPoint, routeCoords);
  const lastAlong = Number.isFinite(progressState?.lastDistanceAlongMeters)
    ? progressState.lastDistanceAlongMeters
    : 0;
  const jitterAllowance = Number.isFinite(accuracyMeters)
    ? clampNumber(accuracyMeters * 0.35, 4, 14)
    : 6;
  const distanceAlongMeters = Math.max(
    lastAlong - jitterAllowance,
    Math.min(projection.distanceAlongMeters, routeLengthMeters),
  );

  const remainingDistanceMeters = Math.max(0, Math.round(routeLengthMeters - distanceAlongMeters));
  const stepMarkers = buildStepEndDistances(steps, routeLengthMeters);
  const lastStepIndex = Number.isFinite(progressState?.lastStepIndex)
    ? progressState.lastStepIndex
    : 0;
  const currentStep = resolveStepFromProgress(distanceAlongMeters, stepMarkers, lastStepIndex);

  const rawEtaSeconds = estimateRemainingDurationSeconds({
    remainingMeters: remainingDistanceMeters,
    speedMps,
    routeDistanceMeters: routeLengthMeters,
    routeDurationSeconds,
  });
  const smoothedEtaSeconds = smoothEtaSeconds(
    rawEtaSeconds,
    progressState?.smoothedEtaSeconds,
  );

  const progressRatio = routeLengthMeters > 0
    ? Math.max(0, Math.min(1, distanceAlongMeters / routeLengthMeters))
    : 0;

  return {
    snappedPoint: projection.snappedPoint,
    deviationMeters: projection.deviationMeters,
    remainingDistanceMeters,
    remainingDurationSeconds: smoothedEtaSeconds,
    currentStep,
    progressRatio,
    progressState: {
      lastDistanceAlongMeters: distanceAlongMeters,
      lastStepIndex: currentStep?.index ?? lastStepIndex,
      smoothedEtaSeconds,
    },
  };
}

export function getRouteRemainingMeters(currentPoint, routeCoords = []) {
  if (!currentPoint || routeCoords.length === 0) return 0;
  const routeLengthMeters = getPolylineTotalLengthMeters(routeCoords);
  if (routeLengthMeters <= 0) {
    return routeCoords.length === 1
      ? Math.round(getDistanceMeters(currentPoint, routeCoords[0]))
      : 0;
  }

  const projection = projectPointOntoPolyline(currentPoint, routeCoords);
  return Math.max(0, Math.round(routeLengthMeters - projection.distanceAlongMeters));
}

export function getCurrentNavigationStep(currentPoint, steps = [], options = {}) {
  if (!currentPoint || !Array.isArray(steps) || steps.length === 0) return null;

  const routeCoords = Array.isArray(options.routeCoords) ? options.routeCoords : [];
  const routeLengthMeters = Number(options.routeDistanceMeters) > 0
    ? Number(options.routeDistanceMeters)
    : getPolylineTotalLengthMeters(routeCoords);

  if (routeCoords.length >= 2 && routeLengthMeters > 0) {
    const snapshot = computeNavigationSnapshot({
      currentPoint,
      routeCoords,
      steps,
      progressState: options.progressState || createInitialNavigationProgressState(),
      routeDistanceMeters: routeLengthMeters,
    });
    return snapshot.currentStep;
  }

  // Fallback legacy: proyección por step cuando no hay polyline completa.
  let bestIndex = 0;
  let bestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const coords = Array.isArray(step?.polylineCoords) && step.polylineCoords.length >= 2
      ? step.polylineCoords
      : [
        { latitude: step?.startLocation?.lat, longitude: step?.startLocation?.lng },
        { latitude: step?.endLocation?.lat, longitude: step?.endLocation?.lng },
      ].filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));

    const dist = getDistanceToPolylineMeters(currentPoint, coords);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }

  const step = steps[bestIndex];
  const distToEnd = Math.round(getDistanceMeters(currentPoint, step.endLocation));

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

    // departure_time=now + traffic_model=best_guess → ruta optimizada con tráfico en tiempo real.
    // Si la API devuelve duration_in_traffic se usa para el ETA; si no, cae al duration estático.
    const params = new URLSearchParams({
      origin: originStr,
      destination: destStr,
      key: GOOGLE_MAPS_API_KEY,
      language: 'es',
      region: 'ar',
      mode: 'driving',
      units: 'metric',
      departure_time: 'now',
      traffic_model: 'best_guess',
    });

    const response = await fetch(`${DIRECTIONS_BASE_URL}?${params}`);
    const data = await response.json();

    if (data.status !== 'OK' || !data.routes.length) {
      throw new Error('No se pudo obtener la ruta');
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    return {
      distance: leg.distance.text,
      duration: leg.duration_in_traffic?.text || leg.duration.text,
      distanceValue: leg.distance.value,
      // Priorizar duración con tráfico real cuando esté disponible
      durationValue: leg.duration_in_traffic?.value || leg.duration.value,
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

