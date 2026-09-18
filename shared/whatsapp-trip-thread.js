/**
 * Hilo WhatsApp acotado a un viaje (agencia ↔ pasajero).
 * El chofer solo lo ve después de aceptar; no es el chat chofer↔pasajero.
 */

const WHATSAPP_THREAD_TABLE = 'trip_whatsapp_messages';
const WHATSAPP_THREAD_FIELDS =
  'id, trip_id, conversation_id, whatsapp_message_id, direction, message_type, body, created_at';
const WHATSAPP_THREAD_VISIBLE_STATUSES = ['accepted', 'going_to_pickup', 'in_progress'];
const WHATSAPP_THREAD_PREVIEW_COUNT = 6;
const WHATSAPP_THREAD_MAX_MESSAGES = 80;

const WHATSAPP_TYPE_LABELS = {
  audio: 'Audio',
  ptt: 'Audio',
  image: 'Foto',
  video: 'Video',
  location: 'Ubicación',
  sticker: 'Sticker',
  document: 'Documento',
  contact: 'Contacto',
};

function isWhatsAppThreadVisibleStatus(status) {
  return WHATSAPP_THREAD_VISIBLE_STATUSES.includes(String(status || '').toLowerCase());
}

function displayWhatsAppThreadBody(message) {
  const body = String(message?.body || '').trim();
  if (body) return body;
  const type = String(message?.message_type || 'text').toLowerCase();
  return WHATSAPP_TYPE_LABELS[type] || 'Mensaje';
}

function isWhatsAppThreadMessageForTrip(message, tripId) {
  const id = String(tripId || '');
  if (!id || !message) return false;
  return String(message.trip_id || '') === id;
}

function filterWhatsAppThreadMessagesForTrip(list, tripId) {
  const id = String(tripId || '');
  if (!id) return [];
  return (Array.isArray(list) ? list : []).filter((item) => isWhatsAppThreadMessageForTrip(item, id));
}

function mergeWhatsAppThreadMessages(list, message) {
  if (!message) return list || [];
  const current = Array.isArray(list) ? list : [];
  const messageId = message.id ? String(message.id) : '';
  const waId = message.whatsapp_message_id ? String(message.whatsapp_message_id) : '';
  if (!messageId && !waId) return current;

  const exists = current.some((item) => (
    (messageId && String(item.id) === messageId)
    || (waId && item.whatsapp_message_id && String(item.whatsapp_message_id) === waId)
  ));

  if (exists) {
    return current.map((item) => {
      if (messageId && String(item.id) === messageId) return { ...item, ...message };
      if (waId && item.whatsapp_message_id && String(item.whatsapp_message_id) === waId) {
        return { ...item, ...message };
      }
      return item;
    });
  }

  return [...current, message].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function isMissingWhatsAppThreadRelationError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01'
    || code === 'PGRST205'
    || /does not exist/i.test(message)
    || /schema cache/i.test(message)
    || /could not find the table/i.test(message);
}

module.exports = {
  WHATSAPP_THREAD_TABLE,
  WHATSAPP_THREAD_FIELDS,
  WHATSAPP_THREAD_VISIBLE_STATUSES,
  WHATSAPP_THREAD_PREVIEW_COUNT,
  WHATSAPP_THREAD_MAX_MESSAGES,
  WHATSAPP_TYPE_LABELS,
  isWhatsAppThreadVisibleStatus,
  displayWhatsAppThreadBody,
  isWhatsAppThreadMessageForTrip,
  filterWhatsAppThreadMessagesForTrip,
  mergeWhatsAppThreadMessages,
  isMissingWhatsAppThreadRelationError,
};
