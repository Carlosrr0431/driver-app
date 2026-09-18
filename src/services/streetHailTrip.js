import { STREET_HAIL_PENDING_DESTINATION } from '../../shared/trip-contract';
import { appendFreeRideNotesMarker } from '../utils/activeTripNavigation';
import { getSafeSession } from './authSession';
import { supabase } from './supabase';

const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://profesional-dashboard.vercel.app';

function isRpcMissingError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === 'PGRST202' || message.includes('could not find the function');
}

function parseRpcPayload(data) {
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data === 'object') return data;
  return null;
}

async function resolveFreshAccessToken() {
  let { session } = await getSafeSession();
  if (!session?.access_token) {
    throw new Error('No hay sesion activa');
  }

  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
  const shouldRefresh = !expiresAtMs || expiresAtMs - Date.now() < 60_000;

  if (shouldRefresh) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError && refreshed?.session?.access_token) {
      session = refreshed.session;
    }
  }

  return session.access_token;
}

export async function createStreetHailTripViaRpc({ originAddress, originLat, originLng }) {
  const { data, error } = await supabase.rpc('driver_create_street_hail_trip', {
    p_origin_address: String(originAddress || '').trim(),
    p_origin_lat: Number(originLat),
    p_origin_lng: Number(originLng),
  });

  if (error) {
    if (isRpcMissingError(error)) {
      return { success: false, rpcMissing: true };
    }
    throw error;
  }

  const payload = parseRpcPayload(data);
  if (payload?.success === true && payload?.trip) {
    return { success: true, trip: payload.trip };
  }

  const errorCode = String(payload?.error || 'create_failed');
  const rpcError = new Error(errorCode);
  rpcError.code = errorCode;
  rpcError.tripId = payload?.trip_id || null;
  throw rpcError;
}

export async function createStreetHailTripViaDashboard({
  originAddress,
  originLat,
  originLng,
  timeoutMs = 12000,
} = {}) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const accessToken = await resolveFreshAccessToken();
    const response = await fetch(`${DASHBOARD_URL}/api/driver/street-hail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        origin_address: originAddress,
        origin_lat: originLat,
        origin_lng: originLng,
      }),
      signal: abortController.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success !== true || !payload?.trip) {
      const apiError = new Error(payload?.error || payload?.message || 'create_failed');
      apiError.code = payload?.error || 'create_failed';
      apiError.status = response.status;
      throw apiError;
    }

    return { success: true, trip: payload.trip };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function createStreetHailTrip({ originAddress, originLat, originLng }) {
  try {
    const rpcResult = await createStreetHailTripViaRpc({
      originAddress,
      originLat,
      originLng,
    });
    if (rpcResult?.success && rpcResult.trip) return rpcResult;
  } catch (error) {
    if (error?.code === 'driver_busy' || error?.code === 'origin_required') {
      throw error;
    }
    // RPC ausente o error inesperado → API del dashboard (service role).
  }

  return createStreetHailTripViaDashboard({
    originAddress,
    originLat,
    originLng,
  });
}

export function buildFreeRideTripUpdates(trip = {}) {
  return {
    destination_address: STREET_HAIL_PENDING_DESTINATION,
    destination_lat: null,
    destination_lng: null,
    notes: appendFreeRideNotesMarker(trip?.notes),
  };
}

/**
 * Recién acá el viaje pasa a en curso: con destino o en modo libre (por km).
 */
export async function applyStreetHailStart({ tripId, destination, notes } = {}) {
  if (!tripId) {
    throw new Error('create_failed');
  }

  const updates = {
    status: 'in_progress',
    dispatch_status: 'accepted',
    started_at: new Date().toISOString(),
  };

  const destLat = Number(destination?.lat);
  const destLng = Number(destination?.lng);
  const destAddress = String(destination?.address || '').trim();
  if (destAddress && Number.isFinite(destLat) && Number.isFinite(destLng)) {
    updates.destination_address = destAddress;
    updates.destination_lat = destLat;
    updates.destination_lng = destLng;
  } else {
    Object.assign(updates, buildFreeRideTripUpdates({ notes }));
  }

  const { data, error } = await supabase
    .from('trips')
    .update(updates)
    .eq('id', tripId)
    .select()
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error('create_failed');
  return data;
}
