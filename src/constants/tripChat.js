export const TRIP_CHAT_ACTIVE_STATUSES = ['accepted', 'going_to_pickup', 'in_progress'];
export const TRIP_CHAT_MAX_TEXT_LENGTH = 500;
export const TRIP_CHAT_MAX_AUDIO_SECONDS = 60;

/** Columnas compartidas del chat (incluye ticks leído/escuchado). */
export const TRIP_CHAT_MESSAGE_FIELDS =
  'id, trip_id, sender_role, message_type, body, audio_url, audio_duration_seconds, created_at, client_id, seen_at';

export function isTripChatAvailable(status) {
  return TRIP_CHAT_ACTIVE_STATUSES.includes(String(status || '').toLowerCase());
}

export function formatChatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function formatAudioDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** pending | sent | seen — estilo WhatsApp. */
export function getMessageReceiptStatus(message) {
  if (!message) return 'pending';
  if (message.seen_at) return 'seen';
  const id = String(message.id || '');
  const clientId = String(message.client_id || '');
  // Optimistic: id temporal igual al client_id o aún sin uuid real.
  if (!id || id === clientId || id.startsWith('d-') || id.startsWith('p-')) {
    return 'pending';
  }
  return 'sent';
}
