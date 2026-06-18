import { getSafeSession } from './authSession';
import { supabase } from './supabase';

const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://profesional-dashboard.vercel.app';

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

export async function verifyTripAlreadyReleased(tripId, driverId) {
  const normalizedTripId = String(tripId || '').trim();
  const normalizedDriverId = String(driverId || '').trim();
  if (!normalizedTripId || !normalizedDriverId) return false;

  const { data, error } = await supabase
    .from('trips')
    .select('id, status, driver_id')
    .eq('id', normalizedTripId)
    .maybeSingle();

  if (error || !data) return false;

  const status = String(data.status || '').toLowerCase();
  const assignedDriverId = String(data.driver_id || '');

  if (assignedDriverId === normalizedDriverId && status === 'pending') {
    return false;
  }

  if (status === 'queued' && !data.driver_id) {
    return true;
  }

  if (status !== 'pending' && assignedDriverId !== normalizedDriverId) {
    return true;
  }

  return false;
}

export async function rejectTripViaRpc(tripId, reason, { retryOnDriverNotFound = true } = {}) {
  const normalizedTripId = String(tripId || '').trim();
  const normalizedReason = String(reason || 'Rechazado por chofer').trim();

  const callRpc = async () => {
    const { data, error } = await supabase.rpc('driver_reject_pending_trip', {
      p_trip_id: normalizedTripId,
      p_reason: normalizedReason,
    });
    return { data: parseRpcPayload(data), error };
  };

  let { data, error } = await callRpc();

  if (
    retryOnDriverNotFound
    && !error
    && data?.success !== true
    && String(data?.error || '') === 'driver_not_found'
  ) {
    await supabase.auth.refreshSession().catch(() => {});
    ({ data, error } = await callRpc());
  }

  if (error) {
    if (isRpcMissingError(error)) {
      return { success: false, rpcMissing: true };
    }
    throw error;
  }

  if (data?.success === true) {
    return {
      success: true,
      tripId: data.trip_id || normalizedTripId,
      idempotent: Boolean(data?.idempotent),
    };
  }

  if (data?.unavailable) {
    const unavailableError = new Error(data?.error || 'trip_not_pending');
    unavailableError.unavailable = true;
    throw unavailableError;
  }

  const errorCode = String(data?.error || '');
  if (errorCode === 'trip_not_owned' || errorCode === 'trip_not_pending') {
    return {
      success: false,
      needsVerify: true,
      unavailable: Boolean(data?.unavailable),
      error: errorCode,
    };
  }

  if (data?.error) {
    const rpcError = new Error(String(data.error));
    rpcError.code = data.error;
    throw rpcError;
  }

  throw new Error('reject_failed');
}

export async function rejectTripViaDashboard(
  tripId,
  reason,
  { timeoutMs = 12000, driverId = null } = {},
) {
  const normalizedTripId = String(tripId || '').trim();
  if (!normalizedTripId) {
    throw new Error('tripId invalido');
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    let accessToken = await resolveFreshAccessToken();
    let response = await fetch(`${DASHBOARD_URL}/api/driver/reject-trip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ tripId: normalizedTripId, reason }),
      signal: abortController.signal,
    });

    if (response.status === 401) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshed?.session?.access_token) {
        accessToken = refreshed.session.access_token;
        response = await fetch(`${DASHBOARD_URL}/api/driver/reject-trip`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ tripId: normalizedTripId, reason }),
          signal: abortController.signal,
        });
      }
    }

    const payload = await response.json().catch(() => ({}));

    if (response.ok && payload?.success === true) {
      return { success: true, tripId: payload.tripId || normalizedTripId };
    }

    if (driverId && (response.status === 403 || response.status === 409)) {
      const released = await verifyTripAlreadyReleased(normalizedTripId, driverId);
      if (released) {
        return { success: true, tripId: normalizedTripId, idempotent: true };
      }
    }

    const reasonText = payload?.error || `HTTP ${response.status}`;
    const error = new Error(reasonText);
    error.unavailable = Boolean(payload?.unavailable);
    error.httpStatus = response.status;
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
