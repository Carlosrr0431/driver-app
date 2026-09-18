/** ~8 m a latitud de Salta: sigue el caminar sin recentrar por jitter de 2–3 m. */
const HOME_FOLLOW_MIN_LAT = 0.00007;
const HOME_FOLLOW_MIN_LNG = 0.00008;
export const HOME_CAMERA_ZOOM = 15;

export function toCameraLngLat(loc) {
  const lat = Number(loc?.lat ?? loc?.latitude);
  const lng = Number(loc?.lng ?? loc?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

export function nextHomeFollowCenter(prev, loc, options = {}) {
  const { force = false } = options;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return prev ?? null;
  const next = { lat, lng };
  if (!force && shouldSkipHomeCameraFollow(prev, next)) return prev;
  return next;
}

export function coordsToMapPos(location) {
  const lat = Number(location?.coords?.latitude ?? location?.lat);
  const lng = Number(location?.coords?.longitude ?? location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const speed = Number(location?.coords?.speed ?? location?.speed);
  const heading = Number(location?.coords?.heading ?? location?.heading);
  const accuracy = Number(location?.coords?.accuracy ?? location?.accuracy);
  return {
    lat,
    lng,
    speed: Number.isFinite(speed) ? speed : 0,
    heading: Number.isFinite(heading) ? heading : 0,
    accuracy: Number.isFinite(accuracy) ? accuracy : 99,
  };
}

export function shouldSkipHomeCameraFollow(last, next) {
  if (!last || !next) return false;
  return Math.abs(last.lat - next.lat) < HOME_FOLLOW_MIN_LAT
    && Math.abs(last.lng - next.lng) < HOME_FOLLOW_MIN_LNG;
}

/** En el primer fix del Home hay que pintar el pin aunque el GPS todavía sea burdo. */
export function shouldAcceptForceLocation(accuracy, maxAccuracy, force) {
  const value = Number(accuracy);
  if (Number.isFinite(value) && value <= maxAccuracy) return true;
  return Boolean(force);
}
