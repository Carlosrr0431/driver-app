/**
 * Zonas de servicio — geometría compartida (dashboard, WhatsApp, passenger-app).
 * coordinates: [{ lat, lng }, ...] con al menos 3 vértices.
 */

export const PICKUP_OUTSIDE_COVERAGE_TITLE = 'Sin cobertura en esta zona';

export const PICKUP_OUTSIDE_COVERAGE_MESSAGE =
  'No hay cobertura para su zona por el momento. No podemos tomar viajes con recogida en esta dirección.';

/** Ray-casting: true si el punto está dentro del polígono. */
export function isPointInPolygon(lat, lng, coordinates) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!Array.isArray(coordinates) || coordinates.length < 3) return false;

  let inside = false;
  const n = coordinates.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = Number(coordinates[i].lat);
    const xi = Number(coordinates[i].lng);
    const yj = Number(coordinates[j].lat);
    const xj = Number(coordinates[j].lng);

    if (![yi, xi, yj, xj].every(Number.isFinite)) continue;

    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

function normalizeActiveZones(zones) {
  return (zones || []).filter(
    (zone) =>
      zone?.is_active !== false
      && Array.isArray(zone.coordinates)
      && zone.coordinates.length >= 3
  );
}

/**
 * true si el retiro está cubierto.
 * Sin zonas activas configuradas → sin restricción (aceptar todo).
 */
export function isPickupInActiveZones(zones, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;

  const activeZones = normalizeActiveZones(zones);
  if (activeZones.length === 0) return true;

  return activeZones.some((zone) => isPointInPolygon(lat, lng, zone.coordinates));
}
