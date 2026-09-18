import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { useLocationStore } from '../stores/locationStore';
import {
  BACKGROUND_GPS_DISTANCE_INTERVAL_M,
  BACKGROUND_GPS_MAX_ACCURACY_M,
  STOPPED_ACCEPT_METERS,
  shouldAcceptLocationStep,
  shouldPushDriverLocationHeartbeat,
} from '../utils/locationWatch';
import { isGpsSimulationActive } from './gpsSimulation';

export const DRIVER_GPS_CONTEXT_KEY = '@profesional/driver-gps-context';

function publishState() {
  if (!globalThis.__driverGpsPublishState) {
    globalThis.__driverGpsPublishState = { lastPushAt: 0, lastPos: null };
  }
  return globalThis.__driverGpsPublishState;
}

export function resetDriverGpsPublishState() {
  globalThis.__driverGpsPublishState = { lastPushAt: 0, lastPos: null };
}

export function shouldKeepFleetGps({ isAvailable = false, isTracking = false } = {}) {
  return Boolean(isAvailable) || Boolean(isTracking);
}

export function parseDriverGpsContext(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const driverId = parsed?.driverId ? String(parsed.driverId) : null;
    if (!driverId) return null;
    return {
      driverId,
      publish: parsed.publish !== false,
      isOnline: Boolean(parsed.isOnline),
    };
  } catch {
    return null;
  }
}

export async function saveDriverGpsContext(context, storage = AsyncStorage) {
  const parsed = parseDriverGpsContext(context);
  if (!parsed) {
    await storage.removeItem(DRIVER_GPS_CONTEXT_KEY);
    return null;
  }
  await storage.setItem(DRIVER_GPS_CONTEXT_KEY, JSON.stringify(parsed));
  return parsed;
}

export async function loadDriverGpsContext(storage = AsyncStorage) {
  return parseDriverGpsContext(await storage.getItem(DRIVER_GPS_CONTEXT_KEY));
}

export async function clearDriverGpsContext(storage = AsyncStorage) {
  resetDriverGpsPublishState();
  await storage.removeItem(DRIVER_GPS_CONTEXT_KEY);
}

export function toFleetGpsPoint(location) {
  const coords = location?.coords || location || {};
  const lat = Number(coords.latitude ?? coords.lat);
  const lng = Number(coords.longitude ?? coords.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const speed = Number(coords.speed);
  const heading = Number(coords.heading);
  const accuracy = Number(coords.accuracy ?? location?.accuracy);
  return {
    lat,
    lng,
    speed: Number.isFinite(speed) && speed > 0 ? speed : 0,
    heading: Number.isFinite(heading) ? heading : 0,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
  };
}

export function shouldAcceptBackgroundGpsPoint(last, next, maxAccuracy = BACKGROUND_GPS_MAX_ACCURACY_M) {
  if (!next) return false;
  if (Number.isFinite(next.accuracy) && next.accuracy > maxAccuracy) return false;
  if (!last) return true;
  return shouldAcceptLocationStep(last, next, {
    movingMeters: BACKGROUND_GPS_DISTANCE_INTERVAL_M,
    stoppedMeters: STOPPED_ACCEPT_METERS,
  });
}

function hasValidFleetCoords(pos) {
  const lat = Number(pos?.lat);
  const lng = Number(pos?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

export async function ensureAuthSession(client = supabase, now = Date.now()) {
  try {
    const { data } = await client.auth.getSession();
    const expiresAt = Number(data?.session?.expires_at || 0);
    if (!expiresAt || expiresAt * 1000 > now + 60_000) return data?.session || null;
    if (typeof client.auth.refreshSession !== 'function') return data?.session || null;
    const refreshed = await client.auth.refreshSession();
    return refreshed?.data?.session || data?.session || null;
  } catch {
    return null;
  }
}

export async function publishDriverGps({
  client = supabase,
  driverId,
  pos,
  isOnline = true,
  force = false,
  now = Date.now(),
} = {}) {
  if (!driverId || !hasValidFleetCoords(pos) || isGpsSimulationActive()) {
    return { published: false };
  }

  await ensureAuthSession(client, now);

  const state = publishState();
  const lat = Number(pos.lat);
  const lng = Number(pos.lng);
  const coordsChanged = !state.lastPos
    || state.lastPos.lat !== lat
    || state.lastPos.lng !== lng;

  if (coordsChanged || force) {
    const { error: driverError } = await client
      .from('drivers')
      .update({ current_lat: lat, current_lng: lng })
      .eq('id', driverId);
    if (driverError) {
      console.warn('GPS flota drivers:', driverError.message);
    }
    state.lastPos = { lat, lng, speed: pos.speed, heading: pos.heading };
  }

  if (!shouldPushDriverLocationHeartbeat({
    lastPushAt: state.lastPushAt,
    now,
    force,
  })) {
    return { published: true, heartbeat: false };
  }

  state.lastPushAt = now;
  const speed = Number(pos.speed);
  const heading = Number(pos.heading);
  const { error } = await client
    .from('driver_locations')
    .upsert({
      driver_id: driverId,
      lat,
      lng,
      speed: Number.isFinite(speed) && speed > 0 ? speed : 0,
      heading: Number.isFinite(heading) ? heading : 0,
      is_online: Boolean(isOnline),
      updated_at: new Date(now).toISOString(),
    }, { onConflict: 'driver_id' });
  if (error) {
    console.warn('GPS flota locations:', error.message);
  }
  return { published: true, heartbeat: true };
}

export async function handleBackgroundLocations({
  locations,
  context,
  client = supabase,
  now = Date.now(),
} = {}) {
  if (isGpsSimulationActive()) return { skipped: 'simulation' };
  const loc = Array.isArray(locations) ? locations[locations.length - 1] : null;
  const pos = toFleetGpsPoint(loc);
  if (!pos) return { skipped: 'nocoords' };
  if (!context?.driverId || context.publish === false) return { skipped: 'nocontext' };

  const state = publishState();
  if (!shouldAcceptBackgroundGpsPoint(state.lastPos, pos)) {
    return { skipped: 'filtered' };
  }

  useLocationStore.getState().setCurrentLocation(pos);
  return publishDriverGps({
    client,
    driverId: context.driverId,
    pos,
    isOnline: context.isOnline !== false,
    now,
  });
}

export function resolveBackgroundGpsContext({ stored, driver, isTracking = false } = {}) {
  if (stored?.driverId && stored.publish !== false) return stored;
  if (driver?.id && shouldKeepFleetGps({ isAvailable: driver.is_available, isTracking })) {
    return {
      driverId: driver.id,
      publish: true,
      isOnline: Boolean(driver.is_available) || Boolean(isTracking),
    };
  }
  return null;
}
