import { MAP_MAX_ZOOM } from './mapProvider';

/** A menos de esta distancia al retiro/destino, la cámara se acerca progresivamente. */
export const ARRIVAL_DISTANCE_METERS = 250;

/**
 * Techo: OSM raster + padding del sheet se ven grises/vacíos cerca de z17+
 * (quedan solo la ruta y las flechas de sentido).
 */
export const NAV_ZOOM_FLOOR = 13.8;
export const NAV_ZOOM_CEILING = Math.min(16.8, MAP_MAX_ZOOM - 1);

export const ARRIVAL_ZOOM_3D = 14.4;
export const ARRIVAL_ZOOM_2D = 14.2;
export const SETTLED_OVERVIEW_ZOOM = 14.2;
export const ARRIVAL_PITCH_3D = 28;
export const ARRIVAL_PITCH_2D = 8;

/**
 * Zoom de llegada progresivo: cuanto más cerca del punto, más acercado.
 *  250 m → zoom normal de navegación (sin cambio)
 *  100 m → 16.0
 *   50 m → 16.4
 *   20 m → 16.8
 */
export function resolveArrivalZoom(remainingDistanceMeters, speedKmh = 0) {
  const remaining = Number(remainingDistanceMeters);
  if (!Number.isFinite(remaining) || remaining >= ARRIVAL_DISTANCE_METERS) return null;
  if (remaining <= 20) return 16.8;
  if (remaining <= 50) return 16.4;
  if (remaining <= 100) return 16.0;
  // 100-250 m: interpolación suave hacia el zoom de velocidad actual
  const t = (remaining - 100) / (ARRIVAL_DISTANCE_METERS - 100); // 0=cerca 1=lejos
  return 16.0 - t * (16.0 - Math.min(15.8, 14.8 + (60 - Math.min(speedKmh, 60)) * 0.02));
}

const ZOOM_TIERS = [
  { minKmh: 65, zoom: 14.8 },
  { minKmh: 40, zoom: 15.2 },
  { minKmh: 20, zoom: 15.5 },
  { minKmh: 0, zoom: 15.2 },
];

const FOLLOW_ZOOM_TIERS = [
  { minKmh: 65, zoom: 15.2 },
  { minKmh: 40, zoom: 15.6 },
  { minKmh: 20, zoom: 15.8 },
  { minKmh: 0, zoom: 15.0 },
];

export function getZoomFromTiers(speedKmh, tiers, fallback) {
  const speed = Number(speedKmh);
  const kmh = Number.isFinite(speed) && speed > 0 ? speed : 0;
  const list = Array.isArray(tiers) ? tiers : [];
  for (const tier of list) {
    if (kmh >= tier.minKmh) return tier.zoom;
  }
  return fallback;
}

export function getZoomForSpeed(speedKmh, followRoute = false) {
  const tiers = followRoute ? FOLLOW_ZOOM_TIERS : ZOOM_TIERS;
  return getZoomFromTiers(speedKmh, tiers, followRoute ? 15.0 : 15.2);
}

export function isArrivalCameraDistance(remainingDistanceMeters) {
  return Number.isFinite(remainingDistanceMeters)
    && remainingDistanceMeters < ARRIVAL_DISTANCE_METERS;
}

/**
 * Pantallas chicas: el bottom sheet tapa más mapa, hay que alejar.
 * Negativo = más lejos. Positivo = un poco más cerca en phablets.
 */
export function getViewportArrivalZoomBias({ width = 360, height = 800 } = {}) {
  const w = Number(width);
  const h = Number(height);
  const safeW = Number.isFinite(w) && w > 0 ? w : 360;
  const safeH = Number.isFinite(h) && h > 0 ? h : 800;
  if (safeH < 640 || safeW < 340) return -0.4;
  if (safeH < 720) return -0.2;
  if (safeH > 920 && safeW >= 400) return 0.1;
  return 0;
}

export function resolveNavigationCameraZoom({
  speedKmh = 0,
  threeDEnabled = false,
  remainingDistanceMeters = null,
  cornerFactor = 0,
  viewportWidth = 360,
  viewportHeight = 800,
} = {}) {
  // Zoom de llegada progresivo: se acerca cuanto más cerca del destino
  const arrivalZoom = resolveArrivalZoom(remainingDistanceMeters, speedKmh);
  let zoom = arrivalZoom ?? getZoomForSpeed(speedKmh, threeDEnabled);

  // En pantallas chicas el sheet tapa más mapa: ajustar bias
  if (arrivalZoom !== null) {
    const bias = getViewportArrivalZoomBias({ width: viewportWidth, height: viewportHeight });
    zoom = zoom + bias;
  }

  const factor = Number(cornerFactor);
  const pull = Number.isFinite(factor) && factor > 0
    ? factor * (threeDEnabled ? 0.45 : 0.5)
    : 0;
  const pulled = Math.max(NAV_ZOOM_FLOOR, zoom - pull);
  return Math.min(NAV_ZOOM_CEILING, pulled);
}

export function resolveNavigationCameraPitch({
  threeDEnabled = false,
  remainingDistanceMeters = null,
  cornerFactor = 0,
  basePitch3d = 52,
  basePitch2d = 12,
} = {}) {
  if (isArrivalCameraDistance(remainingDistanceMeters)) {
    return threeDEnabled ? ARRIVAL_PITCH_3D : ARRIVAL_PITCH_2D;
  }
  const factor = Number(cornerFactor);
  const extra = Number.isFinite(factor) && factor > 0
    ? factor * (threeDEnabled ? 10 : 18)
    : 0;
  return (threeDEnabled ? basePitch3d : basePitch2d) + extra;
}

export function resolveSettledOverviewZoom({ width = 360, height = 800 } = {}) {
  return Math.max(
    NAV_ZOOM_FLOOR,
    SETTLED_OVERVIEW_ZOOM + getViewportArrivalZoomBias({ width, height }),
  );
}

export function resolveFollowPadding({
  controlsBottomOffset = 16,
  viewportHeight = 800,
} = {}) {
  const h = Number(viewportHeight);
  const safeH = Number.isFinite(h) && h > 0 ? h : 800;
  const top = safeH < 640 ? 140 : safeH < 720 ? 200 : 300;
  const bottomInset = Math.max(112, Math.round((Number(controlsBottomOffset) || 0) + 96));
  return {
    top,
    bottom: bottomInset,
    left: 44,
    right: 44,
  };
}
