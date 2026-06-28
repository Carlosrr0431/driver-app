/**
 * Clasificación heurística de tramos OSRM como sentido único o doble mano.
 * Usa el patrón de entradas en intersecciones OSRM (vías con una sola entrada = mano única).
 */

function countOpenEntries(intersection) {
  if (!Array.isArray(intersection?.entry)) return 0;
  return intersection.entry.filter(Boolean).length;
}

function coordDistMeters(a, b) {
  const R = 6378137;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function snapCoordToSegment(point, a, b) {
  const dx = b.longitude - a.longitude;
  const dy = b.latitude - a.latitude;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  let t = ((point.longitude - a.longitude) * dx + (point.latitude - a.latitude) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { latitude: a.latitude + t * dy, longitude: a.longitude + t * dx };
}

function minDistanceToPolyline(point, polyline) {
  if (!point || !Array.isArray(polyline) || polyline.length < 2) return Infinity;
  let nearest = Infinity;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const snapped = snapCoordToSegment(point, polyline[i], polyline[i + 1]);
    nearest = Math.min(nearest, coordDistMeters(point, snapped));
  }
  return nearest;
}

function normalizeCoordList(coords) {
  if (!Array.isArray(coords)) return [];
  return coords
    .map((point) => ({
      latitude: Number(point?.latitude ?? point?.lat),
      longitude: Number(point?.longitude ?? point?.lng),
    }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}

export function classifyStepOneway(step) {
  const intersections = Array.isArray(step?.intersections) ? step.intersections : [];
  if (intersections.length === 0) return false;

  const entryCounts = intersections.map(countOpenEntries);
  const avg = entryCounts.reduce((sum, value) => sum + value, 0) / entryCounts.length;
  const max = Math.max(...entryCounts);
  const singleEntryRatio = entryCounts.filter((value) => value <= 1).length / entryCounts.length;
  const name = String(step?.name || '').toLowerCase();
  const isArterial = /avenida|av\.|boulevard|pasaje|autopista|ramal/.test(name);

  if (max <= 1 && avg <= 1.1) return true;
  if (singleEntryRatio >= 0.7 && avg <= 1.3) return true;
  if (isArterial && singleEntryRatio >= 0.55 && avg <= 1.45) return true;

  return false;
}

export function buildRouteSegmentsFromSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return [];

  return steps
    .filter((step) => Array.isArray(step?.polylineCoords) && step.polylineCoords.length >= 2)
    .map((step) => ({
      coords: step.polylineCoords,
      oneway: Boolean(step.likelyOneway),
    }));
}

function resolveOnewayAtPoint(coord, stepSegments) {
  let bestDist = Infinity;
  let oneway = false;

  for (const segment of stepSegments) {
    const polyline = normalizeCoordList(segment.coords);
    const dist = minDistanceToPolyline(coord, polyline);
    if (dist < bestDist) {
      bestDist = dist;
      oneway = Boolean(segment.oneway);
    }
  }

  return bestDist < 45 ? oneway : false;
}

/** Segmentos solo sobre la polilínea restante (sin tramo ya recorrido). */
export function buildRemainingRouteSegments(routeSteps, remainingCoords) {
  const remaining = normalizeCoordList(remainingCoords);
  if (remaining.length < 2) return [];

  const stepSegments = buildRouteSegmentsFromSteps(routeSteps);
  if (stepSegments.length === 0) {
    return [{ coords: remaining, oneway: false }];
  }

  const segments = [];
  let current = {
    oneway: resolveOnewayAtPoint(remaining[0], stepSegments),
    coords: [remaining[0]],
  };

  for (let i = 1; i < remaining.length; i += 1) {
    const coord = remaining[i];
    const oneway = resolveOnewayAtPoint(coord, stepSegments);

    if (oneway === current.oneway) {
      current.coords.push(coord);
      continue;
    }

    if (current.coords.length >= 2) {
      segments.push(current);
    }
    const bridge = current.coords[current.coords.length - 1];
    current = { oneway, coords: [bridge, coord] };
  }

  if (current.coords.length >= 2) {
    segments.push(current);
  }

  return segments.length > 0 ? segments : [{ coords: remaining, oneway: false }];
}
