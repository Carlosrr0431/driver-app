import { MAP_MAX_ZOOM } from './mapProvider';

/** A menos de esta distancia al retiro/destino, la cámara se aleja. */
export const ARRIVAL_DISTANCE_METERS = 250;

/** Piso: más cerca que esto los tiles raster OSM se ven en blanco. */
export const NAV_ZOOM_FLOOR = 15.0;
export const NAV_ZOOM_CEILING = MAP_MAX_ZOOM - 1.2;

export const ARRIVAL_ZOOM_3D = 15.7;
export const ARRIVAL_ZOOM_2D = 15.5;
export const SETTLED_OVERVIEW_ZOOM = 15.4;
export const ARRIVAL_PITCH_3D = 28;
export const ARRIVAL_PITCH_2D = 8;

const ZOOM_TIERS = [
  { minKmh: 65, zoom: 15.7 },
  { minKmh: 40, zoom: 16.2 },
  { minKmh: 20, zoom: 16.8 },
  { minKmh: 0, zoom: 16.4 },
];

const FOLLOW_ZOOM_TIERS = [
  { minKmh: 65, zoom: 17.2 },
  { minKmh: 40, zoom: 17.6 },
  { minKmh: 20, zoom: 17.9 },
  { minKmh: 0, zoom: 16.2 },
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
  return getZoomFromTiers(speedKmh, tiers, followRoute ? 16.2 : 16.4);
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
  let zoom = getZoomForSpeed(speedKmh, threeDEnabled);
  const arriving = isArrivalCameraDistance(remainingDistanceMeters);
  if (arriving) {
    const bias = getViewportArrivalZoomBias({
      width: viewportWidth,
      height: viewportHeight,
    });
    const arrivalCap = (threeDEnabled ? ARRIVAL_ZOOM_3D : ARRIVAL_ZOOM_2D) + bias;
    zoom = Math.min(zoom, arrivalCap);
  }

  const factor = Number(cornerFactor);
  const pull = Number.isFinite(factor) && factor > 0
    ? factor * (threeDEnabled ? 0.45 : 0.5)
    : 0;
  const pulled = Math.max(NAV_ZOOM_FLOOR, zoom - pull);
  return arriving ? Math.min(NAV_ZOOM_CEILING, pulled) : pulled;
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
