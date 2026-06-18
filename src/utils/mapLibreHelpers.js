/**
 * Utilidades compartidas para MapLibre + coordenadas de la app.
 */

export function toLngLat(point) {
  if (!point) return null;
  const lat = Number(point.lat ?? point.latitude);
  const lng = Number(point.lng ?? point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

export function coordsToLineString(coords = []) {
  const positions = coords
    .map((point) => {
      const lat = Number(point?.latitude ?? point?.lat);
      const lng = Number(point?.longitude ?? point?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lng, lat];
    })
    .filter(Boolean);

  if (positions.length < 2) return null;

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: positions,
    },
    properties: {},
  };
}

export function getBoundsForCoords(coords = []) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  coords.forEach((point) => {
    const lat = Number(point?.latitude ?? point?.lat);
    const lng = Number(point?.longitude ?? point?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  });

  if (!Number.isFinite(minLng)) return null;

  return {
    bounds: [[minLng, minLat], [maxLng, maxLat]],
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
  };
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
