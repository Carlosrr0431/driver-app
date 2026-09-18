import { getSafeSession } from './authSession';
import { supabase } from './supabase';

const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://profesional-dashboard.vercel.app';

async function resolveFreshAccessToken() {
  let { session } = await getSafeSession();
  if (!session?.access_token) return null;

  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
  const shouldRefresh = !expiresAtMs || expiresAtMs - Date.now() < 60_000;

  if (shouldRefresh) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError && refreshed?.session?.access_token) {
      session = refreshed.session;
    }
  }

  return session.access_token || null;
}

/**
 * Avisa al pasajero por FCM tras enviar un mensaje de chat.
 * Fire-and-forget: no lanza; el mensaje ya quedó guardado.
 */
export async function notifyPassengerTripChatMessage({
  tripId,
  messageId,
  messageType,
  body,
  timeoutMs = 8000,
} = {}) {
  const normalizedTripId = String(tripId || '').trim();
  if (!normalizedTripId) return { ok: false, reason: 'invalid_trip_id' };

  try {
    let accessToken = await resolveFreshAccessToken();
    if (!accessToken) return { ok: false, reason: 'no_session' };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response = await fetch(`${DASHBOARD_URL}/api/trips/chat/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          tripId: normalizedTripId,
          messageId: messageId || null,
          messageType: messageType || 'text',
          body: body || null,
          senderRole: 'driver',
        }),
        signal: controller.signal,
      });

      if (response.status === 401) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        accessToken = refreshed?.session?.access_token || null;
        if (accessToken) {
          response = await fetch(`${DASHBOARD_URL}/api/trips/chat/notify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
            body: JSON.stringify({
              tripId: normalizedTripId,
              messageId: messageId || null,
              messageType: messageType || 'text',
              body: body || null,
              senderRole: 'driver',
            }),
            signal: controller.signal,
          });
        }
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, reason: payload.reason || `http_${response.status}` };
      }
      return { ok: true, push: payload.push || null };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    console.warn('[tripChatNotify]', err?.message || err);
    return { ok: false, reason: 'network_error' };
  }
}
