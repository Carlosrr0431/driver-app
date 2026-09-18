/** Watch de primer plano: el pin sigue el GPS del celular, no un intervalo fijo de 3–5 s. */
export const FOREGROUND_WATCH_TIME_INTERVAL_MS = 500;
export const FOREGROUND_WATCH_DISTANCE_INTERVAL_M = 1;
export const NAV_WATCH_TIME_INTERVAL_MS = 500;
export const NAV_WATCH_DISTANCE_INTERVAL_M = 1;

/**
 * Heartbeat de flota (speed/heading → driver_locations).
 * No usar GPS_CONFIG.TRACKING_INTERVAL acá: ese 5 s alimenta
 * trip_tracking y el reruteo. Mezclarlos rompería la guía.
 */
export const DRIVER_LOCATION_PUSH_INTERVAL_MS = 800;

/** GPS de flota con la app minimizada (Android FGS + iOS Always). */
export const BACKGROUND_GPS_TIME_INTERVAL_MS = 1000;
export const BACKGROUND_GPS_DISTANCE_INTERVAL_M = 5;
/** iOS en background suele reportar 20–60 m; 45 m congelaba el pin. */
export const BACKGROUND_GPS_MAX_ACCURACY_M = 65;

/** Título de la notificación persistente de Android (servicio en primer plano). */
export const FLEET_ONLINE_NOTIFICATION_TITLE = 'Estás en línea';

/** Always en iOS; ACCESS_BACKGROUND_LOCATION en Android. */
export function isAlwaysLocationGranted(permission) {
  if (!permission || permission.status !== 'granted') return false;
  if (permission.ios?.scope === 'whenInUse' || permission.ios?.scope === 'none') {
    return false;
  }
  return true;
}

/**
 * iOS ignora timeInterval y puede pausar o agrupar puntos.
 * pausesUpdatesAutomatically=false + deferred=0 mantienen el pin en vivo.
 */
export function buildFleetBackgroundLocationOptions(LocationApi) {
  const options = {
    accuracy: LocationApi.Accuracy.BestForNavigation,
    timeInterval: BACKGROUND_GPS_TIME_INTERVAL_MS,
    distanceInterval: BACKGROUND_GPS_DISTANCE_INTERVAL_M,
    deferredUpdatesInterval: 0,
    deferredUpdatesDistance: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: FLEET_ONLINE_NOTIFICATION_TITLE,
      notificationBody: '',
      killServiceOnDestroy: false,
    },
  };
  const activityType = LocationApi.ActivityType?.AutomotiveNavigation
    ?? LocationApi.ActivityType?.OtherNavigation;
  if (activityType != null) options.activityType = activityType;
  return options;
}

export function shouldPushDriverLocationHeartbeat({
  lastPushAt = 0,
  now = Date.now(),
  force = false,
  minIntervalMs = DRIVER_LOCATION_PUSH_INTERVAL_MS,
} = {}) {
  if (force) return true;
  return (Number(now) - Number(lastPushAt)) >= minIntervalMs;
}

export const MOVING_SPEED_MPS = 0.8;
export const MOVING_ACCEPT_METERS = 1;
export const STOPPED_ACCEPT_METERS = 10;
export const FOREGROUND_MAX_ACCURACY_M = 40;
export const BOOTSTRAP_MAX_ACCURACY_M = 150;

/** Primer pintado puede ser burdo. Con viaje activo / fix previo no. */
export function resolveForcedFixAccuracy({ force = false, hasCurrentFix = false } = {}) {
  const allowCoarse = Boolean(force) && !hasCurrentFix;
  return {
    allowCoarse,
    maxAccuracy: allowCoarse ? BOOTSTRAP_MAX_ACCURACY_M : FOREGROUND_MAX_ACCURACY_M,
  };
}

export function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Last-known solo para el primer pintado. Si ya hay fix, al volver hay que leer GPS fresco. */
export function shouldUseLastKnownBootstrap({ force = false, hasCurrentFix = false } = {}) {
  return Boolean(force) && !hasCurrentFix;
}

export function isMovingSpeed(speed) {
  const value = Number(speed);
  return Number.isFinite(value) && value > MOVING_SPEED_MPS;
}

/** Parado: ignora jitter. En movimiento: acepta el propio paso del GPS. */
export function resolveLocationAcceptMinMeters({
  speed = 0,
  movingMeters = MOVING_ACCEPT_METERS,
  stoppedMeters = STOPPED_ACCEPT_METERS,
} = {}) {
  return isMovingSpeed(speed) ? movingMeters : stoppedMeters;
}

export function shouldAcceptLocationStep(last, next, options = {}) {
  if (!last || !next) return true;
  const dist = getDistanceMeters(last.lat, last.lng, next.lat, next.lng);
  const minDist = resolveLocationAcceptMinMeters({
    speed: next.speed,
    movingMeters: options.movingMeters,
    stoppedMeters: options.stoppedMeters,
  });
  return dist >= minDist;
}

export function shouldRefreshLocationOnForeground(nextState, prevState) {
  return nextState === 'active' && Boolean(prevState) && prevState !== 'active';
}
