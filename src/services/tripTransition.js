import { supabase } from './supabase';

const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://profesional-dashboard.vercel.app';

export async function notifyTripAcceptedTransition(tripId, { timeoutMs = 7000 } = {}) {
  const normalizedTripId = String(tripId || '').trim();
  if (!normalizedTripId) {
    throw new Error('tripId invalido');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('No hay sesion activa');
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/Agente_IA`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        event: 'trip.transition',
        tripId: normalizedTripId,
        status: 'going_to_pickup',
        source: 'driver_app_accept',
      }),
      signal: abortController.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success !== true) {
      const reason = payload?.error || `HTTP ${response.status}`;
      throw new Error(`No se pudo notificar aceptacion inmediata: ${reason}`);
    }

    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}
