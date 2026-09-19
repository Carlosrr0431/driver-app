/**
 * shared/trip-contract.js
 *
 * Contrato compartido entre profesional-dashboard y driver-app.
 * Define el esquema exacto del objeto `trip` que se escribe en Supabase
 * y que la driver-app lee vía Realtime.
 *
 * REGLA: si route.js cambia el payload del INSERT → el test del dashboard falla.
 *        si driver-app cambia los campos que lee → el test del driver-app falla.
 *        Ambos tests usan este archivo → el contrato está siempre sincronizado.
 *
 * Compatible con CommonJS (funciona en jest-expo y en next/jest sin transformación).
 */

// ── Campos requeridos que route.js SIEMPRE incluye en el INSERT ───────────────
const REQUIRED_TRIP_FIELDS = [
  'driver_id',
  'passenger_name',
  'passenger_phone',
  'origin_address',
  'origin_lat',
  'origin_lng',
  'destination_address',
  'destination_lat',
  'destination_lng',
  'status',
  'notes',
];

// ── Campos que la driver-app SIEMPRE lee del objeto trip ─────────────────────
const DRIVER_APP_READS_FIELDS = [
  'id',
  'driver_id',
  'status',
  'passenger_name',
  'passenger_phone',
  'origin_address',
  'origin_lat',
  'origin_lng',
  'destination_address',
  'destination_lat',
  'destination_lng',
  'notes',
];

// ── Estados válidos del ciclo de vida ─────────────────────────────────────────
const TRIP_STATUSES = ['pending', 'accepted', 'going_to_pickup', 'in_progress', 'completed', 'cancelled'];

// ── Notas embebidas conocidas ──────────────────────────────────────────────────
const NOTES_MARKERS = {
  APPROACH_ONLY: '[APPROACH_ONLY]',
  WHATSAPP: '[WHATSAPP]',
  DASHBOARD: '[DASHBOARD]',
  PASSENGER_APP: '[PASSENGER_APP]',
  FINAL_DEST_JSON_PREFIX: '[FINAL_DEST_JSON:',
  PICKUP_JSON_PREFIX: '[PICKUP_JSON:',
  WAYPOINTS_JSON_PREFIX: '[WAYPOINTS_JSON:',
  STREET_HAIL: '[STREET_HAIL]',
};

/** Destino placeholder hasta que el chofer elija dirección o viaje libre. */
const STREET_HAIL_PENDING_DESTINATION = 'A confirmar';
const STREET_HAIL_PASSENGER_NAME = 'Pasajero en calle';

/**
 * Crea un objeto trip de ejemplo que cumple el contrato.
 * Útil para ambos test suites como punto de partida.
 *
 * @param {Partial<Trip>} overrides — campos a sobreescribir
 * @returns {Trip}
 */
function makeTripPayload(overrides = {}) {
  return {
    id: 'trip-test-001',
    driver_id: 'driver-test-001',
    passenger_name: 'Juan Pérez',
    passenger_phone: '5493878630173',
    origin_address: 'Balcarce 500, Salta',    // posición actual del chofer
    origin_lat: -24.7900,
    origin_lng: -65.4100,
    destination_address: 'Belgrano 200, Salta', // punto de RETIRO del pasajero
    destination_lat: -24.7921,
    destination_lng: -65.4115,
    status: 'pending',
    price: null,
    commission_amount: null,
    distance_km: null,
    duration_minutes: null,
    notes: '[APPROACH_ONLY] Creado automáticamente desde WhatsApp (chofer -> retiro pasajero, sin cobro inicial). Destino final: se define al subir el pasajero.',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Crea un payload de Supabase Realtime que simula el evento INSERT.
 * Es lo que `useRealtime.js` recibe en el callback `payload`.
 */
function makeRealtimeInsertPayload(trip = makeTripPayload()) {
  return {
    schema: 'public',
    table: 'trips',
    commit_timestamp: new Date().toISOString(),
    eventType: 'INSERT',
    new: trip,
    old: {},
    errors: null,
  };
}

/**
 * Verifica que un objeto trip cumple el contrato.
 * Devuelve los campos faltantes (array vacío si está ok).
 */
function getMissingRequiredFields(trip) {
  return REQUIRED_TRIP_FIELDS.filter((field) => !(field in trip));
}

/**
 * Verifica que el campo `notes` contiene la marca [APPROACH_ONLY].
 */
function isApproachOnlyTrip(trip) {
  return String(trip?.notes || '').includes(NOTES_MARKERS.APPROACH_ONLY);
}

function isPassengerAppTrip(trip) {
  return String(trip?.notes || '').includes(NOTES_MARKERS.PASSENGER_APP);
}

function isStreetHailTrip(trip) {
  return String(trip?.notes || '').includes(NOTES_MARKERS.STREET_HAIL);
}

function buildStreetHailNotes(origin = {}) {
  const lines = [
    NOTES_MARKERS.STREET_HAIL,
    'Viaje tomado en calle. Destino a definir.',
  ];
  const pickupMarker = buildPickupJsonMarker(origin);
  if (pickupMarker) lines.push(pickupMarker);
  return lines.join('\n');
}

/**
 * Payload de INSERT para un viaje en calle (pasajero ya a bordo).
 * Origen = GPS del chofer. Destino pendiente → needsDriverDestinationChoice.
 */
function buildStreetHailTripInsert({
  driverId,
  originAddress,
  originLat,
  originLng,
  nowIso,
} = {}) {
  const lat = Number(originLat);
  const lng = Number(originLng);
  const address = String(originAddress || '').trim()
    || (Number.isFinite(lat) && Number.isFinite(lng)
      ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      : '');
  const now = nowIso || new Date().toISOString();

  return {
    driver_id: driverId,
    passenger_name: STREET_HAIL_PASSENGER_NAME,
    passenger_phone: null,
    origin_address: address,
    origin_lat: Number.isFinite(lat) ? lat : null,
    origin_lng: Number.isFinite(lng) ? lng : null,
    destination_address: STREET_HAIL_PENDING_DESTINATION,
    destination_lat: null,
    destination_lng: null,
    status: 'accepted',
    dispatch_status: 'accepted',
    notes: buildStreetHailNotes({ address, lat, lng }),
    assigned_at: now,
    accepted_at: now,
    pickup_at: now,
    wa_context: { source: 'street_hail', dispatch_excluded_driver_ids: [] },
  };
}

/**
 * Viaje pedido por WhatsApp (no app de pasajeros ni panel).
 * Marcador explícito [WHATSAPP], o APPROACH_ONLY sin [PASSENGER_APP]/[DASHBOARD].
 */
function isWhatsAppTrip(trip) {
  const notes = String(trip?.notes || '');
  if (
    notes.includes(NOTES_MARKERS.PASSENGER_APP)
    || notes.includes(NOTES_MARKERS.DASHBOARD)
    || notes.includes(NOTES_MARKERS.STREET_HAIL)
  ) {
    return false;
  }
  if (notes.includes(NOTES_MARKERS.WHATSAPP)) return true;
  if (isApproachOnlyTrip(trip)) return true;
  return getScheduledTripSource(trip) === 'whatsapp';
}

/**
 * Origen del viaje programado: 'passenger_app' | 'whatsapp' | null.
 * WhatsApp no marca [PASSENGER_APP]; la app marca [SCHEDULED_SOURCE] passenger_app.
 */
function getScheduledTripSource(trip) {
  const notes = String(trip?.notes || '');
  const sourceMatch = notes.match(/\[SCHEDULED_SOURCE\]\s*([a-z_]+)/i);
  if (sourceMatch?.[1]) return sourceMatch[1].toLowerCase();

  const isScheduled = String(trip?.status || '') === 'scheduled'
    || Boolean(trip?.scheduled_for)
    || notes.includes('[SCHEDULED_FOR]');
  if (!isScheduled) return null;

  return isPassengerAppTrip(trip) ? 'passenger_app' : 'whatsapp';
}

function isPassengerAppScheduledTrip(trip) {
  return getScheduledTripSource(trip) === 'passenger_app';
}

function isWhatsAppScheduledTrip(trip) {
  return getScheduledTripSource(trip) === 'whatsapp';
}

function isCoordLikeAddress(address) {
  return /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(String(address || '').trim());
}

function coordsNearlyEqual(latA, lngA, latB, lngB, epsilon = 0.00005) {
  const aLat = Number(latA);
  const aLng = Number(lngA);
  const bLat = Number(latB);
  const bLng = Number(lngB);
  if (!Number.isFinite(aLat) || !Number.isFinite(aLng) || !Number.isFinite(bLat) || !Number.isFinite(bLng)) {
    return false;
  }
  return Math.abs(aLat - bLat) < epsilon && Math.abs(aLng - bLng) < epsilon;
}

function locationsMatch(pickup, dest) {
  if (!pickup || !dest) return false;
  const pickupAddress = String(pickup.address || '').trim().toLowerCase();
  const destAddress = String(dest.address || '').trim().toLowerCase();
  if (pickupAddress && destAddress && pickupAddress === destAddress) {
    return true;
  }
  return coordsNearlyEqual(pickup.lat, pickup.lng, dest.lat, dest.lng);
}

/**
 * Parsea JSON embebido tras un prefijo tipo [PICKUP_JSON:…] respetando arrays/objetos anidados.
 * @returns {number|null} índice inclusive del último carácter del JSON, o null si no se encuentra.
 */
function findEmbeddedJsonEndIndex(text, jsonStart) {
  const first = text[jsonStart];
  if (first !== '[' && first !== '{') return null;

  const pairs = { '[': ']', '{': '}' };
  const stack = [first];
  let inString = false;
  let escaped = false;

  for (let i = jsonStart + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[' || ch === '{') {
      stack.push(ch);
      continue;
    }
    if (ch === ']' || ch === '}') {
      const expected = pairs[stack[stack.length - 1]];
      if (ch !== expected) return null;
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return null;
}

function parseEmbeddedJsonAfterPrefix(src, prefix) {
  const text = String(src || '');
  const start = text.indexOf(prefix);
  if (start === -1) return null;
  const jsonStart = start + prefix.length;
  const jsonEnd = findEmbeddedJsonEndIndex(text, jsonStart);
  if (jsonEnd == null) return null;
  try {
    return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch {
    return null;
  }
}

function removeEmbeddedJsonMarkerBlock(notes, prefix) {
  const text = String(notes || '');
  const start = text.indexOf(prefix);
  if (start === -1) return text;
  const jsonStart = start + prefix.length;
  const jsonEnd = findEmbeddedJsonEndIndex(text, jsonStart);
  if (jsonEnd == null) return text;
  let markerEnd = jsonEnd + 1;
  if (text[markerEnd] === ']') markerEnd += 1;
  return `${text.slice(0, start)}${text.slice(markerEnd)}`;
}

/**
 * Notas legibles para el chofer: quita marcadores JSON embebidos y boilerplate del sistema.
 */
function cleanTripNotesForDriverDisplay(notes) {
  let result = String(notes || '');
  result = removeEmbeddedJsonMarkerBlock(result, NOTES_MARKERS.WAYPOINTS_JSON_PREFIX);
  result = removeEmbeddedJsonMarkerBlock(result, NOTES_MARKERS.FINAL_DEST_JSON_PREFIX);
  result = removeEmbeddedJsonMarkerBlock(result, NOTES_MARKERS.PICKUP_JSON_PREFIX);
  result = result
    .replace(/\[APPROACH_ONLY\]/gi, '')
    .replace(/\[PASSENGER_APP\]/gi, '')
    .replace(/\[PASSENGER_WEB\]/gi, '')
    .replace(/\[WHATSAPP\]/gi, '')
    .replace(/\[DASHBOARD_ASSIGN\]/gi, '')
    .replace(/\[DASHBOARD\]/gi, '')
    .replace(/\[STREET_HAIL\]/gi, '')
    .replace(/\[SCHEDULED_FOR\][^\n]*/gi, '')
    .replace(/\[SCHEDULED_DISPLAY\][^\n]*/gi, '')
    .replace(/\[SCHEDULED_SOURCE\][^\n]*/gi, '')
    .replace(/\[PASSENGER_PHONE\][^\n]*/gi, '')
    .replace(/Viaje tomado en calle[^.]*\./gi, '')
    .replace(/Creado autom[aá]ticamente desde WhatsApp[^.]*\./gi, '')
    .replace(/chofer\s*->\s*retiro pasajero[^.]*\./gi, '')
    .replace(/Destino final:[^.]*\./gi, '')
    .replace(/Destino final sugerido:.*/gi, '')
    .replace(/Solicitado desde la app de pasajeros\./gi, '')
    .replace(/Solicitado desde la web de pasajeros\./gi, '')
    .replace(/Viaje ingresado desde el panel de operaciones\.?/gi, '')
    .replace(/Viaje asignado desde el panel de operaciones\.?/gi, '')
    .replace(/En cola de espera\. Retiro confirmado\.?/gi, '')
    .replace(/\[FREE_RIDE\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return result || null;
}

const HUMAN_TRIP_NOTES_MAX_LENGTH = 800;

const MACHINE_NOTE_TAGS = [
  NOTES_MARKERS.APPROACH_ONLY,
  NOTES_MARKERS.WHATSAPP,
  NOTES_MARKERS.PASSENGER_APP,
  '[PASSENGER_WEB]',
  '[DASHBOARD_ASSIGN]',
  NOTES_MARKERS.DASHBOARD,
  NOTES_MARKERS.STREET_HAIL,
  '[FREE_RIDE]',
];

const MACHINE_NOTE_LINE_PATTERNS = [
  /\[SCHEDULED_FOR\][^\n]*/gi,
  /\[SCHEDULED_DISPLAY\][^\n]*/gi,
  /\[SCHEDULED_SOURCE\][^\n]*/gi,
  /\[PASSENGER_PHONE\][^\n]*/gi,
  /Viaje tomado en calle[^.]*\./gi,
  /Creado autom[aá]ticamente desde WhatsApp[^.]*\./gi,
  /chofer\s*->\s*retiro pasajero[^.]*\./gi,
  /Destino final:[^.]*\./gi,
  /Destino final sugerido:.*/gi,
  /Solicitado desde la app de pasajeros\./gi,
  /Solicitado desde la web de pasajeros\./gi,
  /Viaje ingresado desde el panel de operaciones\.?/gi,
  /Viaje asignado desde el panel de operaciones\.?/gi,
  /En cola de espera\. Retiro confirmado\.?/gi,
];

function extractEmbeddedJsonMarkerBlock(notes, prefix) {
  const text = String(notes || '');
  const start = text.indexOf(prefix);
  if (start === -1) return null;
  const jsonStart = start + prefix.length;
  const jsonEnd = findEmbeddedJsonEndIndex(text, jsonStart);
  if (jsonEnd == null) return null;
  let markerEnd = jsonEnd + 1;
  if (text[markerEnd] === ']') markerEnd += 1;
  return text.slice(start, markerEnd);
}

function collectMachineTripNoteParts(notes) {
  const text = String(notes || '');
  const parts = [];
  const seen = new Set();
  const pushUnique = (value) => {
    const next = String(value || '').trim();
    if (!next || seen.has(next)) return;
    seen.add(next);
    parts.push(next);
  };

  MACHINE_NOTE_TAGS.forEach((tag) => {
    if (!tag) return;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(escaped, 'i').test(text)) pushUnique(tag);
  });

  MACHINE_NOTE_LINE_PATTERNS.forEach((pattern) => {
    const matches = text.match(pattern);
    if (!matches) return;
    matches.forEach(pushUnique);
  });

  [
    NOTES_MARKERS.PICKUP_JSON_PREFIX,
    NOTES_MARKERS.FINAL_DEST_JSON_PREFIX,
    NOTES_MARKERS.WAYPOINTS_JSON_PREFIX,
  ].forEach((prefix) => {
    const block = extractEmbeddedJsonMarkerBlock(text, prefix);
    if (block) pushUnique(block);
  });

  return parts;
}

function sanitizeHumanTripNotes(text) {
  let result = String(text || '');
  result = removeEmbeddedJsonMarkerBlock(result, NOTES_MARKERS.WAYPOINTS_JSON_PREFIX);
  result = removeEmbeddedJsonMarkerBlock(result, NOTES_MARKERS.FINAL_DEST_JSON_PREFIX);
  result = removeEmbeddedJsonMarkerBlock(result, NOTES_MARKERS.PICKUP_JSON_PREFIX);
  result = result
    .replace(/\[APPROACH_ONLY\]/gi, '')
    .replace(/\[PASSENGER_APP\]/gi, '')
    .replace(/\[PASSENGER_WEB\]/gi, '')
    .replace(/\[WHATSAPP\]/gi, '')
    .replace(/\[DASHBOARD_ASSIGN\]/gi, '')
    .replace(/\[DASHBOARD\]/gi, '')
    .replace(/\[STREET_HAIL\]/gi, '')
    .replace(/\[FREE_RIDE\]/gi, '')
    .replace(/\[SCHEDULED_FOR\][^\n]*/gi, '')
    .replace(/\[SCHEDULED_DISPLAY\][^\n]*/gi, '')
    .replace(/\[SCHEDULED_SOURCE\][^\n]*/gi, '')
    .replace(/\[PASSENGER_PHONE\][^\n]*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (result.length > HUMAN_TRIP_NOTES_MAX_LENGTH) {
    result = result.slice(0, HUMAN_TRIP_NOTES_MAX_LENGTH).trim();
  }
  return result;
}

/**
 * Reemplaza el texto operativo que ve el chofer, conservando marcadores internos.
 */
function replaceHumanTripNotes(existingNotes, humanText) {
  const machine = collectMachineTripNoteParts(existingNotes);
  const human = sanitizeHumanTripNotes(humanText);
  const tagsAndLines = machine.filter((part) => !part.includes('_JSON:'));
  const jsonParts = machine.filter((part) => part.includes('_JSON:'));
  const combined = [...tagsAndLines, human, ...jsonParts].filter(Boolean);
  return combined.length ? combined.join('\n') : null;
}

/**
 * Coordenadas de recogida del pasajero.
 * - WhatsApp / panel (APPROACH_ONLY): origin_* (+ PICKUP_JSON); legacy en destination_*.
 * - App de pasajeros: origin_* (+ PICKUP_JSON en notes).
 */
function extractPickupFromNotes(notes) {
  return parseEmbeddedJsonAfterPrefix(notes, NOTES_MARKERS.PICKUP_JSON_PREFIX);
}

function buildPickupJsonMarker(location) {
  if (!location || typeof location !== 'object') return null;
  const { address, lat, lng } = location;
  const cleanAddress = String(address || '').trim();
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!cleanAddress || !Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return null;
  }
  return `${NOTES_MARKERS.PICKUP_JSON_PREFIX}${JSON.stringify({
    address: cleanAddress,
    lat: parsedLat,
    lng: parsedLng,
  })}]`;
}

function notesContainPickupJson(notes) {
  return String(notes || '').includes(NOTES_MARKERS.PICKUP_JSON_PREFIX);
}

function resolvePassengerAppPickupCoords(trip = {}) {
  const fromNotes = extractPickupFromNotes(trip?.notes);
  const noteLat = Number(fromNotes?.lat);
  const noteLng = Number(fromNotes?.lng);
  if (fromNotes?.address && Number.isFinite(noteLat) && Number.isFinite(noteLng)) {
    return {
      address: fromNotes.address,
      lat: noteLat,
      lng: noteLng,
    };
  }

  const lat = Number(trip.origin_lat);
  const lng = Number(trip.origin_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const address = isCoordLikeAddress(trip.origin_address) ? null : trip.origin_address;
    return { address: address || null, lat, lng };
  }

  return { address: null, lat: null, lng: null };
}

/**
 * App de pasajeros: retiro en origin_* (+ PICKUP_JSON en notes).
 * WhatsApp / panel APPROACH_ONLY: retiro en origin_*; legacy tenía retiro en destination_*.
 */
function usesPassengerAppPickupSchema(trip = {}) {
  if (isPassengerAppTrip(trip)) {
    return true;
  }

  // WhatsApp también puede incluir [PICKUP_JSON]; no confundir con passenger-app.
  if (isApproachOnlyTrip(trip)) {
    return false;
  }

  const originLat = Number(trip.origin_lat);
  const originLng = Number(trip.origin_lng);
  const destLat = Number(trip.destination_lat);
  const destLng = Number(trip.destination_lng);
  const originAddress = String(trip.origin_address || '').trim();
  const destinationAddress = String(trip.destination_address || '').trim();

  if (
    !originAddress
    || isCoordLikeAddress(originAddress)
    || !destinationAddress
    || !Number.isFinite(originLat)
    || !Number.isFinite(originLng)
    || !Number.isFinite(destLat)
    || !Number.isFinite(destLng)
  ) {
    return false;
  }

  return true;
}

function resolveWhatsappApproachPickupCoords(trip = {}) {
  const fromNotes = extractPickupFromNotes(trip?.notes);
  const noteLat = Number(fromNotes?.lat);
  const noteLng = Number(fromNotes?.lng);
  if (fromNotes?.address && Number.isFinite(noteLat) && Number.isFinite(noteLng)) {
    return {
      address: fromNotes.address,
      lat: noteLat,
      lng: noteLng,
    };
  }

  const originLat = Number(trip.origin_lat);
  const originLng = Number(trip.origin_lng);
  const originAddress = String(trip.origin_address || '').trim();
  if (
    originAddress
    && !isCoordLikeAddress(originAddress)
    && Number.isFinite(originLat)
    && Number.isFinite(originLng)
  ) {
    return {
      address: originAddress,
      lat: originLat,
      lng: originLng,
    };
  }

  const destLat = Number(trip.destination_lat);
  const destLng = Number(trip.destination_lng);
  if (Number.isFinite(destLat) && Number.isFinite(destLng)) {
    return {
      address: trip.destination_address || null,
      lat: destLat,
      lng: destLng,
    };
  }

  if (Number.isFinite(originLat) && Number.isFinite(originLng)) {
    return {
      address: isCoordLikeAddress(originAddress) ? null : originAddress || null,
      lat: originLat,
      lng: originLng,
    };
  }

  return { address: null, lat: null, lng: null };
}

function hasReadablePickupInOrigin(trip = {}) {
  const address = String(trip.origin_address || '').trim();
  const lat = Number(trip.origin_lat);
  const lng = Number(trip.origin_lng);
  return Boolean(address)
    && !isCoordLikeAddress(address)
    && Number.isFinite(lat)
    && Number.isFinite(lng);
}

/**
 * Al asignar chofer: no pisar origin_* si ya hay retiro legible o PICKUP_JSON en notes.
 */
function shouldPreservePickupOriginOnAssign(trip = {}) {
  if (isStreetHailTrip(trip)) return true;
  if (isPassengerAppTrip(trip)) return true;
  if (notesContainPickupJson(trip?.notes)) return true;
  return hasReadablePickupInOrigin(trip);
}

function resolveTripPickupCoords(trip = {}) {
  if (isStreetHailTrip(trip) || usesPassengerAppPickupSchema(trip)) {
    return resolvePassengerAppPickupCoords(trip);
  }

  if (isApproachOnlyTrip(trip)) {
    return resolveWhatsappApproachPickupCoords(trip);
  }

  const lat = Number(trip.destination_lat);
  const lng = Number(trip.destination_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return {
      address: trip.destination_address || null,
      lat,
      lng,
    };
  }

  const originLat = Number(trip.origin_lat);
  const originLng = Number(trip.origin_lng);
  if (Number.isFinite(originLat) && Number.isFinite(originLng)) {
    return {
      address: trip.origin_address || null,
      lat: originLat,
      lng: originLng,
    };
  }

  return { address: null, lat: null, lng: null };
}

/**
 * Destino final del pasajero (dropoff).
 * - App de pasajeros: destination_* si están cargados.
 * - WhatsApp: FINAL_DEST_JSON en notes.
 */
function resolveTripFinalDestCoords(trip = {}) {
  const fromNotes = extractFinalDestFromNotes(trip?.notes);
  if (fromNotes?.address) {
    const noteLat = Number(fromNotes.lat);
    const noteLng = Number(fromNotes.lng);
    if (Number.isFinite(noteLat) && Number.isFinite(noteLng)) {
      return { address: fromNotes.address, lat: noteLat, lng: noteLng };
    }
  }

  const destLat = trip.destination_lat == null ? NaN : Number(trip.destination_lat);
  const destLng = trip.destination_lng == null ? NaN : Number(trip.destination_lng);
  const destAddress = String(trip.destination_address || '').trim();
  if (!destAddress || !Number.isFinite(destLat) || !Number.isFinite(destLng)) {
    return null;
  }

  const candidate = { address: destAddress, lat: destLat, lng: destLng };
  const shouldIgnoreDuplicatePickup = isApproachOnlyTrip(trip)
    || isPassengerAppTrip(trip)
    || isStreetHailTrip(trip);
  if (shouldIgnoreDuplicatePickup) {
    const pickup = (isPassengerAppTrip(trip) || isStreetHailTrip(trip))
      ? resolvePassengerAppPickupCoords(trip)
      : resolveWhatsappApproachPickupCoords(trip);
    if (locationsMatch(pickup, candidate)) {
      return null;
    }
  }

  return candidate;
}

function hasResolvableFinalDestination(trip = {}) {
  const finalDest = resolveTripFinalDestCoords(trip);
  return Boolean(
    finalDest?.address
    && Number.isFinite(Number(finalDest.lat))
    && Number.isFinite(Number(finalDest.lng)),
  );
}

/**
 * Tras "Pasajero a bordo": el chofer debe elegir destino manualmente.
 * WhatsApp sin destino, passenger-app sin destino acordado, o legacy con retiro en destination_*.
 */
function needsDriverDestinationChoice(trip = {}) {
  return !hasResolvableFinalDestination(trip);
}

/**
 * Extrae el destino final embebido en `notes` como JSON, si existe.
 * Devuelve null si no está presente.
 */
function extractFinalDestFromNotes(notes) {
  return parseEmbeddedJsonAfterPrefix(notes, NOTES_MARKERS.FINAL_DEST_JSON_PREFIX);
}

/**
 * Marca en notes el destino final geocodificado (mismo formato que WhatsApp / dashboard).
 */
function buildFinalDestJsonMarker(location) {
  if (!location || typeof location !== 'object') return null;
  const { address, lat, lng } = location;
  const cleanAddress = String(address || '').trim();
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!cleanAddress || !Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return null;
  }
  return `${NOTES_MARKERS.FINAL_DEST_JSON_PREFIX}${JSON.stringify({
    address: cleanAddress,
    lat: parsedLat,
    lng: parsedLng,
  })}]`;
}

function notesContainFinalDestJson(notes) {
  return String(notes || '').includes(NOTES_MARKERS.FINAL_DEST_JSON_PREFIX);
}

function normalizeWaypointList(waypoints) {
  if (!Array.isArray(waypoints)) return [];
  return waypoints
    .map((wp) => {
      const address = String(wp?.address || '').trim();
      const lat = Number(wp?.lat);
      const lng = Number(wp?.lng);
      if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { address, lat, lng };
    })
    .filter(Boolean);
}

function extractWaypointsFromNotes(notes) {
  const parsed = parseEmbeddedJsonAfterPrefix(notes, NOTES_MARKERS.WAYPOINTS_JSON_PREFIX);
  return normalizeWaypointList(parsed);
}

function buildWaypointsJsonMarker(waypoints) {
  const normalized = normalizeWaypointList(waypoints);
  if (normalized.length === 0) return null;
  return `${NOTES_MARKERS.WAYPOINTS_JSON_PREFIX}${JSON.stringify(normalized)}]`;
}

function notesContainWaypointsJson(notes) {
  return String(notes || '').includes(NOTES_MARKERS.WAYPOINTS_JSON_PREFIX);
}

/**
 * Paradas intermedias entre recogida y destino final (orden de visita).
 * Viajes sin paradas devuelven [].
 */
function resolveTripWaypoints(trip = {}) {
  if (Array.isArray(trip?.waypoints) && trip.waypoints.length > 0) {
    return normalizeWaypointList(trip.waypoints);
  }
  return extractWaypointsFromNotes(trip?.notes);
}

module.exports = {
  REQUIRED_TRIP_FIELDS,
  DRIVER_APP_READS_FIELDS,
  TRIP_STATUSES,
  NOTES_MARKERS,
  STREET_HAIL_PENDING_DESTINATION,
  STREET_HAIL_PASSENGER_NAME,
  makeTripPayload,
  makeRealtimeInsertPayload,
  getMissingRequiredFields,
  isApproachOnlyTrip,
  isPassengerAppTrip,
  isStreetHailTrip,
  isWhatsAppTrip,
  getScheduledTripSource,
  isPassengerAppScheduledTrip,
  isWhatsAppScheduledTrip,
  isCoordLikeAddress,
  hasReadablePickupInOrigin,
  shouldPreservePickupOriginOnAssign,
  coordsNearlyEqual,
  locationsMatch,
  hasResolvableFinalDestination,
  needsDriverDestinationChoice,
  resolveTripPickupCoords,
  resolveTripFinalDestCoords,
  extractFinalDestFromNotes,
  extractPickupFromNotes,
  buildFinalDestJsonMarker,
  buildPickupJsonMarker,
  buildStreetHailNotes,
  buildStreetHailTripInsert,
  notesContainFinalDestJson,
  notesContainPickupJson,
  normalizeWaypointList,
  extractWaypointsFromNotes,
  buildWaypointsJsonMarker,
  notesContainWaypointsJson,
  resolveTripWaypoints,
  cleanTripNotesForDriverDisplay,
  sanitizeHumanTripNotes,
  replaceHumanTripNotes,
  HUMAN_TRIP_NOTES_MAX_LENGTH,
};
