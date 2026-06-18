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
  FINAL_DEST_JSON_PREFIX: '[FINAL_DEST_JSON:',
  PICKUP_JSON_PREFIX: '[PICKUP_JSON:',
  WAYPOINTS_JSON_PREFIX: '[WAYPOINTS_JSON:',
};

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
  return String(trip?.notes || '').includes('[PASSENGER_APP]');
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
 * Coordenadas de recogida del pasajero.
 * - WhatsApp / panel (APPROACH_ONLY): origin_* (+ PICKUP_JSON); legacy en destination_*.
 * - App de pasajeros: origin_* (+ PICKUP_JSON en notes).
 */
function extractPickupFromNotes(notes) {
  const src = String(notes || '');
  const prefix = NOTES_MARKERS.PICKUP_JSON_PREFIX;
  const start = src.indexOf(prefix);
  if (start === -1) return null;
  const jsonStart = start + prefix.length;
  const jsonEnd = src.indexOf(']', jsonStart);
  if (jsonEnd === -1) return null;
  try {
    return JSON.parse(src.slice(jsonStart, jsonEnd));
  } catch {
    return null;
  }
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
  if (isPassengerAppTrip(trip)) return true;
  if (notesContainPickupJson(trip?.notes)) return true;
  return hasReadablePickupInOrigin(trip);
}

function resolveTripPickupCoords(trip = {}) {
  if (usesPassengerAppPickupSchema(trip)) {
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

  const destLat = Number(trip.destination_lat);
  const destLng = Number(trip.destination_lng);
  const destAddress = String(trip.destination_address || '').trim();
  if (!destAddress || !Number.isFinite(destLat) || !Number.isFinite(destLng)) {
    return null;
  }

  const candidate = { address: destAddress, lat: destLat, lng: destLng };
  const shouldIgnoreDuplicatePickup = isApproachOnlyTrip(trip) || isPassengerAppTrip(trip);
  if (shouldIgnoreDuplicatePickup) {
    const pickup = isPassengerAppTrip(trip)
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
  const src = String(notes || '');
  const prefix = NOTES_MARKERS.FINAL_DEST_JSON_PREFIX;
  const start = src.indexOf(prefix);
  if (start === -1) return null;
  const jsonStart = start + prefix.length;
  const jsonEnd = src.indexOf(']', jsonStart);
  if (jsonEnd === -1) return null;
  try {
    return JSON.parse(src.slice(jsonStart, jsonEnd));
  } catch {
    return null;
  }
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
  const src = String(notes || '');
  const prefix = NOTES_MARKERS.WAYPOINTS_JSON_PREFIX;
  const start = src.indexOf(prefix);
  if (start === -1) return [];
  const jsonStart = start + prefix.length;
  const jsonEnd = src.indexOf(']', jsonStart);
  if (jsonEnd === -1) return [];
  try {
    return normalizeWaypointList(JSON.parse(src.slice(jsonStart, jsonEnd)));
  } catch {
    return [];
  }
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
  makeTripPayload,
  makeRealtimeInsertPayload,
  getMissingRequiredFields,
  isApproachOnlyTrip,
  isPassengerAppTrip,
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
  notesContainFinalDestJson,
  notesContainPickupJson,
  normalizeWaypointList,
  extractWaypointsFromNotes,
  buildWaypointsJsonMarker,
  notesContainWaypointsJson,
  resolveTripWaypoints,
};
