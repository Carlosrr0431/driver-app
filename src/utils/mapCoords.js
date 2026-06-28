/**
 * Utilidades de coordenadas para MapLibre / navegación.
 */

export function normalizeCoordinate(point) {
  if (!point) return null;
  const lat = Number(point.lat ?? point.latitude);
  const lng = Number(point.lng ?? point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

/** @deprecated Usar normalizeCoordinate */
export function toLngLat(point) {
  const coord = normalizeCoordinate(point);
  if (!coord) return null;
  return [coord.longitude, coord.latitude];
}

export function normalizeCoords(coords = []) {
  return coords.map(normalizeCoordinate).filter(Boolean);
}

export function regionToInitialViewState(region) {
  if (!region) return null;
  const lat = Number(region.latitude);
  const lng = Number(region.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const latDelta = Number(region.latitudeDelta) || 0.02;
  const zoom = Math.round(Math.log2(360 / latDelta));

  return {
    center: [lng, lat],
    zoom: Math.max(10, Math.min(18, zoom)),
    bearing: 0,
    pitch: 0,
  };
}
