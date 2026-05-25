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

export async function rejectTripViaRpc(tripId, reason) {
  const normalizedTripId = String(tripId || '').trim();
  const normalizedReason = String(reason || 'Rechazado por chofer').trim();

  const { data, error } = await supabase.rpc('driver_reject_pending_trip', {
    p_trip_id: normalizedTripId,
    p_reason: normalizedReason,
  });

  if (error) {
    if (isRpcMissingError(error)) {
      return { success: false, rpcMissing: true };
    }
    throw error;
  }

  if (data?.success === true) {
    return { success: true, tripId: data.trip_id || normalizedTripId };
  }

  if (data?.unavailable) {
    const unavailableError = new Error(data?.error || 'trip_not_pending');
    unavailableError.unavailable = true;
    throw unavailableError;
  }

  throw new Error(data?.error || 'reject_failed');
}

async function postRejectTrip(accessToken, tripId, reason, timeoutMs) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/Agente_IA`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        event: 'trip.driver_reject',
        tripId,
        reason,
      }),
      signal: abortController.signal,
    });

    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function rejectTripViaDashboard(tripId, reason, { timeoutMs = 10000 } = {}) {
  const normalizedTripId = String(tripId || '').trim();
  if (!normalizedTripId) {
    throw new Error('tripId invalido');
  }

  let accessToken = await resolveFreshAccessToken();
  let { response, payload } = await postRejectTrip(accessToken, normalizedTripId, reason, timeoutMs);

  if (response.status === 401) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError && refreshed?.session?.access_token) {
      accessToken = refreshed.session.access_token;
      ({ response, payload } = await postRejectTrip(
        accessToken,
        normalizedTripId,
        reason,
        timeoutMs,
      ));
    }
  }

  if (!response.ok || payload?.success !== true) {
    const reasonText = payload?.error || `HTTP ${response.status}`;
    const error = new Error(reasonText);
    error.unavailable = Boolean(payload?.unavailable);
    throw error;
  }

  return { success: true, tripId: payload.tripId || normalizedTripId };
}
