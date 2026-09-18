import { TRACKING_BASE_URL } from '../utils/constants';
import { getSafeSession } from './authSession';
import { supabase } from './supabase';

async function resolveAccessToken() {
  let { session } = await getSafeSession();
  if (!session?.access_token) return null;

  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
  const shouldRefresh = !expiresAtMs || expiresAtMs - Date.now() < 60_000;
  if (shouldRefresh) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (!error && refreshed?.session?.access_token) {
      session = refreshed.session;
    }
  }
  return session?.access_token || null;
}

export async function insertDriverVoiceViaDashboard({
  audioUrl,
  durationSeconds,
  dashboardUrl = TRACKING_BASE_URL,
  accessToken,
} = {}) {
  const token = accessToken || await resolveAccessToken();
  if (!token || !dashboardUrl) return null;

  const response = await fetch(`${dashboardUrl}/api/driver/voice-messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      duration_seconds: durationSeconds,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success !== true || !payload?.message) {
    return null;
  }
  return payload.message;
}

export async function insertDriverVoiceMessage({
  driverId,
  audioUrl,
  durationSeconds,
} = {}) {
  const viaApi = await insertDriverVoiceViaDashboard({
    audioUrl,
    durationSeconds,
  }).catch(() => null);
  if (viaApi?.id) return viaApi;

  const { data, error } = await supabase
    .from('voice_messages')
    .insert({
      driver_id: driverId,
      sender_type: 'driver',
      audio_url: audioUrl,
      duration_seconds: durationSeconds,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}
