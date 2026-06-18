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

async function postTripTransition(accessToken, tripId, timeoutMs) {
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
        event: 'trip.transition',
        tripId,
        status: 'going_to_pickup',
        source: 'driver_app_accept',
      }),
      signal: abortController.signal,
    });

    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function notifyTripAcceptedTransition(tripId, { timeoutMs = 7000 } = {}) {
  const normalizedTripId = String(tripId || '').trim();
  if (!normalizedTripId) {
    throw new Error('tripId invalido');
  }

  let accessToken = await resolveFreshAccessToken();
  let { response, payload } = await postTripTransition(accessToken, normalizedTripId, timeoutMs);

  if (response.status === 401) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError && refreshed?.session?.access_token) {
      accessToken = refreshed.session.access_token;
      ({ response, payload } = await postTripTransition(accessToken, normalizedTripId, timeoutMs));
    }
  }

  if (!response.ok || payload?.success !== true) {
    const reason = payload?.error || `HTTP ${response.status}`;
    throw new Error(`No se pudo notificar aceptacion inmediata: ${reason}`);
  }

  return payload;
}
