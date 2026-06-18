/**
 * Lógica de navegación turn-by-turn sobre rutas OSRM (proyección GPS, reroute, ETA).
 */

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

  // Umbral dinámico: más estricto cerca de maniobras y más tolerante con mala precisión.
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

const STEP_ADVANCE_THRESHOLD_METERS = 28;
const ROUNDABOUT_HANDOFF_DISTANCE_METERS = 70;
const ROUNDABOUT_EXIT_PROXIMITY_METERS = 45;
const ROUNDABOUT_PROGRESS_HANDOFF_RATIO = 0.42;
const ROUNDABOUT_EXIT_PASSED_ROUTE_METERS = 22;
const ROUNDABOUT_LEFT_EXIT_MIN_METERS = 48;

function isRoundaboutManeuver(maneuver) {
  return String(maneuver || '').toLowerCase().includes('roundabout');
}

function getStepStartDistanceMeters(stepMarkers, stepIndex) {
  if (!stepMarkers.length || stepIndex <= 0) return 0;
  return stepMarkers[stepIndex - 1].endDistanceMeters;
}

function metersToStepEndLocation(currentPoint, step) {
  const end = step?.endLocation;
  if (!currentPoint || !end) return null;
  const lat = Number(end.lat);
  const lng = Number(end.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return getDistanceMeters(currentPoint, { latitude: lat, longitude: lng });
}

function shouldHandOffRoundaboutStep({
  distanceAlongMeters,
  distanceToStepMeters,
  stepMarkers,
  stepIndex,
  currentPoint,
  currentStep,
}) {
  if (!isRoundaboutManeuver(currentStep?.maneuver)) return false;
  if (stepIndex + 1 >= stepMarkers.length) return false;

  const nextManeuver = stepMarkers[stepIndex + 1].step?.maneuver;
  const stepStart = getStepStartDistanceMeters(stepMarkers, stepIndex);
  const stepLength = Math.max(1, stepMarkers[stepIndex].endDistanceMeters - stepStart);
  const traveledInStep = Math.max(0, distanceAlongMeters - stepStart);
  const progressInStep = traveledInStep / stepLength;

  const stepEnd = stepMarkers[stepIndex].endDistanceMeters;
  const distToExit = metersToStepEndLocation(currentPoint, currentStep);
  const passedExit = Number.isFinite(distToExit) && distToExit <= ROUNDABOUT_EXIT_PROXIMITY_METERS;
  const nearStepEnd = Number.isFinite(distanceToStepMeters)
    && distanceToStepMeters <= ROUNDABOUT_HANDOFF_DISTANCE_METERS;
  const mostlyDone = progressInStep >= ROUNDABOUT_PROGRESS_HANDOFF_RATIO;
  const passedOnRoute = Number.isFinite(stepEnd)
    && distanceAlongMeters >= stepEnd - ROUNDABOUT_EXIT_PASSED_ROUTE_METERS;
  const leftExitBehind = Number.isFinite(distToExit)
    && distToExit >= ROUNDABOUT_LEFT_EXIT_MIN_METERS
    && distToExit <= 280
    && progressInStep >= 0.22;

  const nearExitGeometry = Number.isFinite(distToExit) && distToExit <= 120;
  const staleRoundaboutStep = nearExitGeometry
    && Number.isFinite(distanceToStepMeters)
    && distanceToStepMeters > 55;

  if (passedOnRoute || leftExitBehind || passedExit || staleRoundaboutStep) return true;
  if (!isRoundaboutManeuver(nextManeuver) && (nearStepEnd || mostlyDone)) return true;
  if (isRoundaboutManeuver(nextManeuver) && (nearStepEnd || mostlyDone || passedExit)) return true;

  return false;
}

function adjustDistanceAlongForStaleRoundabout(
  currentPoint,
  distanceAlongMeters,
  stepMarkers = [],
  lastStepIndex = 0,
  projectionAlongMeters = null,
) {
  if (!currentPoint || !stepMarkers.length) return distanceAlongMeters;

  let adjusted = distanceAlongMeters;
  const startIdx = Math.max(0, Math.min(lastStepIndex, stepMarkers.length - 1));

  for (let index = startIdx; index < stepMarkers.length; index += 1) {
    const marker = stepMarkers[index];
    if (!isRoundaboutManeuver(marker?.step?.maneuver)) continue;

    const stepStart = getStepStartDistanceMeters(stepMarkers, index);
    const stepEnd = marker.endDistanceMeters;
    const stepLength = Math.max(1, stepEnd - stepStart);
    const distToExit = metersToStepEndLocation(currentPoint, marker.step);
    const remainingOnStep = stepEnd - adjusted;
    const progressInStep = Math.max(0, adjusted - stepStart) / stepLength;

    if (
      Number.isFinite(projectionAlongMeters)
      && projectionAlongMeters >= stepEnd - ROUNDABOUT_EXIT_PASSED_ROUTE_METERS
    ) {
      adjusted = Math.max(adjusted, stepEnd - 10);
      continue;
    }

    if (Number.isFinite(distToExit) && distToExit <= 95 && remainingOnStep > 70) {
      adjusted = Math.max(adjusted, stepEnd - 24);
      continue;
    }

    if (
      Number.isFinite(distToExit)
      && distToExit >= ROUNDABOUT_LEFT_EXIT_MIN_METERS
      && distToExit <= 280
      && (progressInStep >= 0.2 || remainingOnStep > 45)
    ) {
      adjusted = Math.max(adjusted, stepEnd - 12);
    }
  }

  const routeEnd = stepMarkers[stepMarkers.length - 1]?.endDistanceMeters;
  if (Number.isFinite(routeEnd)) {
    return Math.min(adjusted, routeEnd);
  }
  return adjusted;
}

function resolveStepFromProgress(
  distanceAlongMeters,
  stepMarkers = [],
  lastStepIndex = 0,
  currentPoint = null,
) {
  if (!stepMarkers.length) return null;

  let stepIndex = Math.max(0, Math.min(lastStepIndex, stepMarkers.length - 1));

  for (let index = stepIndex; index < stepMarkers.length; index += 1) {
    if (distanceAlongMeters + STEP_ADVANCE_THRESHOLD_METERS < stepMarkers[index].endDistanceMeters) {
      stepIndex = index;
      break;
    }
    stepIndex = index;
  }

  const buildResolvedStep = (index) => {
    const marker = stepMarkers[index];
    return {
      ...marker.step,
      index: marker.index,
      distanceToStepMeters: Math.max(
        0,
        Math.round(marker.endDistanceMeters - distanceAlongMeters),
      ),
    };
  };

  let resolved = buildResolvedStep(stepIndex);

  if (
    resolved.distanceToStepMeters <= STEP_ADVANCE_THRESHOLD_METERS
    && stepIndex + 1 < stepMarkers.length
  ) {
    stepIndex += 1;
    resolved = buildResolvedStep(stepIndex);
  }

  let guard = 0;
  while (
    guard < 5
    && shouldHandOffRoundaboutStep({
      distanceAlongMeters,
      distanceToStepMeters: resolved.distanceToStepMeters,
      stepMarkers,
      stepIndex,
      currentPoint,
      currentStep: resolved,
    })
  ) {
    stepIndex += 1;
    resolved = buildResolvedStep(stepIndex);
    guard += 1;
  }

  return resolved;
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
 * Calcula el estado completo de navegación: proyección sobre ruta, progreso monótono,
 * paso actual y ETA híbrida (velocidad GPS + duración OSRM).
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
  let distanceAlongMeters = Math.max(
    lastAlong - jitterAllowance,
    Math.min(projection.distanceAlongMeters, routeLengthMeters),
  );

  const stepMarkers = buildStepEndDistances(steps, routeLengthMeters);
  const lastStepIndex = Number.isFinite(progressState?.lastStepIndex)
    ? progressState.lastStepIndex
    : 0;

  distanceAlongMeters = adjustDistanceAlongForStaleRoundabout(
    currentPoint,
    distanceAlongMeters,
    stepMarkers,
    lastStepIndex,
    projection.distanceAlongMeters,
  );

  const remainingDistanceMeters = Math.max(0, Math.round(routeLengthMeters - distanceAlongMeters));
  const currentStep = resolveStepFromProgress(
    distanceAlongMeters,
    stepMarkers,
    lastStepIndex,
    currentPoint,
  );

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

