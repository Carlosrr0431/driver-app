/**
 * Google Places API (New) — política de facturación estricta.
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SKUs permitidos                                             ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Autocomplete Requests   POST /v1/places:autocomplete        ║
 * ║    · Con sessionToken: keystrokes = $0 (bundled al Details)  ║
 * ║    · Sin sessionToken: $0.00283 / request                    ║
 * ║  Place Details Essentials (IDs Only)  mask = "id"            ║
 * ║    · Verificación barata de placeId sin coordenadas          ║
 * ║  Place Details Essentials  mask = id,formattedAddress,       ║
 * ║                                   location,types             ║
 * ║    · Única fuente de coordenadas                             ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  PROHIBIDO                                                   ║
 * ║    · displayName → dispara Place Details Pro                 ║
 * ║    · Text Search, Find Place, Nearby Search                  ║
 * ║    · Legacy Places API (maps.googleapis.com/maps/api/place)  ║
 * ║    · Google Geocoding API                                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * GESTIÓN DE SESIONES (evita cobro por keystroke):
 *   1. Crear sessionToken al abrir un campo de búsqueda.
 *   2. Pasar el mismo token en TODOS los keystrokes de esa sesión.
 *   3. Pasar el token en la llamada de Place Details que cierra la sesión.
 *   4. NO reutilizar el token después del Place Details → crear uno nuevo.
 *
 * CACHÉ (orden de consulta para Place Details):
 *   1. placeDetailsCache  — in-memory, proceso actual, TTL 6 h
 *   2. persistentCacheProvider — Supabase google_place_details_cache
 *   3. Google Place Details Essentials — solo si los dos anteriores fallan
 */

const { isWithinSaltaCapital, SALTA_CAPITAL_BOUNDS } = require('./mapConfig');

const PLACES_NEW_BASE = 'https://places.googleapis.com/v1';

const PLACES_TIMEOUT_MS = 8000;
const AUTOCOMPLETE_TTL_MS = 45 * 1000;
const LABEL_CACHE_TTL_MS = 30 * 60 * 1000;
const PLACE_DETAILS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ITEMS = 300;

/** Restricción dura: solo resultados dentro del rectángulo de Salta Capital. */
const SALTA_CAPITAL_RESTRICTION = {
  rectangle: {
    low: {
      latitude: SALTA_CAPITAL_BOUNDS.south,
      longitude: SALTA_CAPITAL_BOUNDS.west,
    },
    high: {
      latitude: SALTA_CAPITAL_BOUNDS.north,
      longitude: SALTA_CAPITAL_BOUNDS.east,
    },
  },
};

/** Localidades de la provincia que Google puede mezclar aun con restricción geográfica. */
const OUTSIDE_SALTA_CAPITAL_SUBTITLE = [
  /jujuy/,
  /\bvaqueros\b/,
  /\bcerrillos\b/,
  /\bchimilas\b/,
  /\bel carril\b/,
  /\bla silleta\b/,
  /\brosario de la frontera\b/,
  /\bmetan\b/,
  /\bcafayate\b/,
  /\btartagal\b/,
  /\boran\b/,
  /\bcampo santo\b/,
  /\bcolonia santa rosa\b/,
  /\bchicoana\b/,
  /\blas lajitas\b/,
  /\bgeneral g[uü]emes,\s*salta\b/,
];

const AUTOCOMPLETE_FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.structuredFormat',
  'suggestions.placePrediction.text',
  'suggestions.placePrediction.types',
].join(',');

/**
 * SKU: Place Details Essentials — mínimo para coords + dirección + tipo de POI.
 * Sin displayName (dispara Place Details Pro).
 */
const PLACE_DETAILS_ESSENTIALS_MASK = 'id,formattedAddress,location,types';

/**
 * SKU: Place Details Essentials (IDs Only) — solo devuelve el placeId canónico.
 * Uso: verificar que un placeId sigue siendo válido sin pagar Essentials completo.
 */
const PLACE_DETAILS_IDS_ONLY_MASK = 'id';

const FORBIDDEN_PLACE_DETAILS_FIELDS = [
  'displayName',
  'googleMapsUri',
  'rating',
  'userRatingCount',
  'reviews',
  'photos',
  'websiteUri',
  'nationalPhoneNumber',
  'regularOpeningHours',
  'businessStatus',
  'priceLevel',
  'editorialSummary',
];

const FORBIDDEN_URL_PATTERNS = [
  /textsearch/i,
  /findplacefromtext/i,
  /places:searchText/i,
  /searchNearby/i,
  /maps\.googleapis\.com\/maps\/api\/place/i,
  /maps\.googleapis\.com\/maps\/api\/geocode/i,
];

const autocompleteCache = new Map();
const placeLabelCache = new Map();
const placeDetailsCache = new Map();
const inFlightAutocomplete = new Map();
const inFlightPlaceDetails = new Map();
const activeSessions = new Map();

function normalizeQuery(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function foldText(text) {
  return normalizeQuery(String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

function getCached(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.data;
}

function setCached(map, key, data, ttlMs) {
  map.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (map.size > CACHE_MAX_ITEMS) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
}

function readGoogleApiKey() {
  if (typeof process === 'undefined' || !process.env) return '';
  return String(
    process.env.GOOGLE_MAPS_API_KEY
    || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    || '',
  ).trim();
}

function isGoogleConfigured() {
  return Boolean(readGoogleApiKey());
}

function isGooglePlaceId(placeId) {
  return String(placeId || '').startsWith('google:');
}

function fixCommonPoiTypos(query) {
  const text = String(query || '').trim();
  if (!text) return text;
  return text
    .replace(/\bshoping\b/ig, 'shopping')
    .replace(/\bshopin\b/ig, 'shopping')
    .replace(/\bsho+p+i+n+g\b/ig, 'shopping')
    .replace(/\bjarava\b/ig, 'Jaraba')
    .replace(/\bfransisca\b/ig, 'Francisca');
}

function assertAllowedUrl(url) {
  if (FORBIDDEN_URL_PATTERNS.some((pattern) => pattern.test(url))) {
    throw new Error('Endpoint de Google Places prohibido por política de costos');
  }
}

function assertPlaceDetailsEssentialsMask(fieldMask) {
  const normalized = String(fieldMask || '').replace(/\s/g, '');
  const fields = normalized.split(',').filter(Boolean);
  if (!fields.length) {
    throw new Error('Field mask vacío para Place Details');
  }
  for (const forbidden of FORBIDDEN_PLACE_DETAILS_FIELDS) {
    if (normalized.includes(forbidden)) {
      throw new Error(`Campo prohibido en Place Details (Pro): ${forbidden}`);
    }
  }
  if (!fields.includes('location')) {
    throw new Error('Place Details Essentials requiere el campo location');
  }
}

function assertPlaceDetailsIdsOnlyMask(fieldMask) {
  const normalized = String(fieldMask || '').replace(/\s/g, '');
  if (normalized !== 'id') {
    throw new Error('IDs Only mask debe ser exactamente "id"');
  }
}

function createSessionToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function registerAutocompleteSession(sessionToken) {
  const token = String(sessionToken || '').trim();
  if (!token) return createSessionToken();
  const existing = activeSessions.get(token) || { requestCount: 0, completed: false };
  existing.requestCount += 1;
  activeSessions.set(token, existing);
  return token;
}

function completeSession(sessionToken) {
  const token = String(sessionToken || '').trim();
  if (!token) return;
  const existing = activeSessions.get(token) || { requestCount: 0, completed: false };
  existing.completed = true;
  activeSessions.set(token, existing);
}

function resolveSessionToken(options = {}) {
  const explicit = String(options?.sessionToken || '').trim();
  if (explicit) return explicit;
  return createSessionToken();
}

function cleanAutocompleteSubtitle(text) {
  return String(text || '')
    .replace(/,?\s*Argentina\s*$/i, '')
    .replace(/,?\s*A4400\s*$/i, '')
    .trim();
}

function isOutsideSaltaCapitalSubtitle(subtitle) {
  const folded = foldText(cleanAutocompleteSubtitle(subtitle));
  if (!folded) return false;
  return OUTSIDE_SALTA_CAPITAL_SUBTITLE.some((pattern) => pattern.test(folded));
}

function cachePlaceLabel(rawPlaceId, label) {
  const id = String(rawPlaceId || '').trim();
  if (!id || !label?.title) return;
  setCached(placeLabelCache, id, label, LABEL_CACHE_TTL_MS);
}

function lookupPlaceLabel(rawPlaceId) {
  const id = String(rawPlaceId || '').replace(/^google:/, '').trim();
  return getCached(placeLabelCache, id);
}

function parseFormattedAddressParts(formattedAddress) {
  const parts = String(formattedAddress || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return { title: '', subtitle: '' };

  const title = parts[0] || '';
  const subtitle = parts
    .slice(1)
    .filter((part) => !/^salta$/i.test(part) && !/^argentina$/i.test(part) && !/^a4400/i.test(part))
    .join(', ');

  return { title, subtitle };
}

function mapGoogleTypes(types) {
  const t = Array.isArray(types) ? types : [];
  if (t.some((x) => ['hospital', 'doctor', 'health'].includes(x))) return { osmClass: 'amenity', osmType: 'hospital' };
  if (t.some((x) => ['university', 'school', 'primary_school'].includes(x))) return { osmClass: 'amenity', osmType: 'university' };
  if (t.includes('shopping_mall')) return { osmClass: 'shop', osmType: 'mall' };
  if (t.includes('stadium')) return { osmClass: 'leisure', osmType: 'stadium' };
  if (t.includes('museum')) return { osmClass: 'tourism', osmType: 'museum' };
  if (t.some((x) => ['bus_station', 'transit_station'].includes(x))) return { osmClass: 'amenity', osmType: 'bus_station' };
  if (t.includes('airport')) return { osmClass: 'aeroway', osmType: 'aerodrome' };
  if (t.includes('pharmacy')) return { osmClass: 'amenity', osmType: 'pharmacy' };
  if (t.some((x) => ['bank', 'atm'].includes(x))) return { osmClass: 'amenity', osmType: 'bank' };
  if (t.some((x) => ['supermarket', 'grocery_or_supermarket'].includes(x))) return { osmClass: 'amenity', osmType: 'supermarket' };
  if (t.some((x) => ['restaurant', 'cafe', 'food', 'ice_cream_shop'].includes(x))) return { osmClass: 'amenity', osmType: 'restaurant' };
  if (t.includes('gas_station')) return { osmClass: 'amenity', osmType: 'fuel' };
  return { osmClass: 'amenity', osmType: 'poi' };
}

function scoreAutocompleteSuggestion(mainText, secondaryText, query) {
  const q = foldText(query);
  const title = foldText(mainText);
  const subtitle = foldText(secondaryText);
  let score = 0;
  if (title === q) score += 4.2;
  else if (title.startsWith(q)) score += 2.8;
  else if (title.includes(q)) score += 1.9;
  if (subtitle.includes(q)) score += 0.7;
  if (subtitle.includes('salta') || title.includes('salta')) score += 0.9;
  return score;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractStreetAndNumber(query) {
  const raw = String(query || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const withAl = raw.match(
    /^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9.'-]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9.'-]+)*)\s+al\s+(\d{1,5}[a-zA-Z]?)$/i,
  );
  if (withAl) {
    return { street: withAl[1].trim(), number: withAl[2].trim() };
  }

  const simple = raw.match(
    /^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9.'-]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9.'-]+)*)\s+(\d{1,5}[a-zA-Z]?)$/i,
  );
  if (!simple) return null;

  return { street: simple[1].trim(), number: simple[2].trim() };
}

function getSuggestionText(item) {
  return String(item?.title || item?.poiName || item?.formattedAddress || '').trim();
}

function hasStreetNumber(item, number) {
  const text = foldText(getSuggestionText(item));
  const numPattern = new RegExp(`\\b${escapeRegex(number)}\\b`);
  return numPattern.test(text);
}

function isDoctorAGuemesWithNumber(item, number) {
  const text = foldText(getSuggestionText(item));
  const numPattern = new RegExp(`\\b${escapeRegex(number)}\\b`);
  return (
    numPattern.test(text)
    && /\b(dr\.?\s*a\.?\s*guemes|doctor\s+a\.?\s*guemes)\b/.test(text)
    && !/\badolfo\s+guemes\b/.test(text)
  );
}

function pickDoctorAGuemesHit(hits, number) {
  const withNumber = (hits || []).filter((item) => isDoctorAGuemesWithNumber(item, number));
  if (!withNumber.length) return null;

  return withNumber.find((item) => {
    const subtitle = foldText(item?.subtitle || '');
    return subtitle.includes('salta') && !subtitle.includes('villa san lorenzo');
  }) || withNumber[0];
}

async function enrichGuemesStreetNumberResults(items, query, sessionToken, limit) {
  const parsed = extractStreetAndNumber(query);
  if (!parsed || !/\bguemes\b/i.test(parsed.street)) {
    return items.slice(0, limit);
  }

  const withNumber = items.filter((item) => hasStreetNumber(item, parsed.number));
  const base = withNumber.length ? withNumber : items;

  const seen = new Set();
  const results = [];
  for (const item of base) {
    const key = item?.placeId || foldText(getSuggestionText(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }

  if (!results.some((item) => isDoctorAGuemesWithNumber(item, parsed.number))) {
    const suggestions = await placesAutocompleteRequest(`doctor a guemes ${parsed.number}`, sessionToken);
    const doctorHits = suggestions
      .map((item, index) => ({
        ...mapAutocompletePrediction(item?.placePrediction, sessionToken, `doctor a guemes ${parsed.number}`),
        _index: index,
      }))
      .filter(Boolean)
      .filter((item) => !isOutsideSaltaCapitalSubtitle(item.subtitle));
    const doctorA = pickDoctorAGuemesHit(doctorHits, parsed.number);
    const key = doctorA?.placeId;
    if (doctorA && key && !seen.has(key)) {
      results.splice(Math.min(3, results.length), 0, doctorA);
      seen.add(key);
    }
  }

  return results.slice(0, limit);
}

function mapAutocompletePrediction(prediction, sessionToken, query) {
  const rawId = String(prediction?.placeId || '').trim();
  if (!rawId) return null;

  const mainText = String(prediction?.structuredFormat?.mainText?.text || '').trim();
  const secondaryText = cleanAutocompleteSubtitle(
    prediction?.structuredFormat?.secondaryText?.text || '',
  );
  const types = Array.isArray(prediction?.types) ? prediction.types : [];
  const { osmClass, osmType } = mapGoogleTypes(types);

  const address = secondaryText ? `${mainText}, ${secondaryText}` : mainText;
  cachePlaceLabel(rawId, { title: mainText, subtitle: secondaryText, address });

  return {
    placeId: `google:${rawId}`,
    poiName: mainText,
    title: mainText,
    subtitle: secondaryText,
    formattedAddress: secondaryText || mainText,
    importance: 0.75,
    osmClass,
    osmType,
    address: { city: 'Salta' },
    sessionToken,
    types,
    _score: scoreAutocompleteSuggestion(mainText, secondaryText, query),
  };
}

async function placesAutocompleteRequest(input, sessionToken) {
  const text = String(input || '').trim();
  if (!text || !isGoogleConfigured()) return [];

  const key = readGoogleApiKey();
  const url = `${PLACES_NEW_BASE}/places:autocomplete`;
  assertAllowedUrl(url);

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS) : null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify({
        input: text,
        sessionToken,
        includedRegionCodes: ['ar'],
        languageCode: 'es',
        locationRestriction: SALTA_CAPITAL_RESTRICTION,
      }),
      signal: controller?.signal,
    });

    if (!response.ok) return [];

    const data = await response.json();
    return Array.isArray(data?.suggestions) ? data.suggestions : [];
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * SKU: Autocomplete (New) — devuelve sugerencias estilo Google Maps sin coords.
 *
 * BILLING: El sessionToken agrupa TODOS los keystrokes de la sesión en un único
 * cargo que se consolida con el Place Details final.
 * El cache NO incluye sessionToken en la clave — misma query en distintas sesiones
 * devuelve el resultado cacheado y re-inyecta el sessionToken actual, ahorrando
 * una llamada a Google por sesión repetida.
 */
async function autocompleteAddressSalta(query, limit = 8, options = {}) {
  const text = fixCommonPoiTypos(String(query || '').trim());
  if (!text || text.length < 2 || !isGoogleConfigured()) return [];

  const normalizedLimit = Math.max(1, Math.min(limit, 8));
  const sessionToken = registerAutocompleteSession(resolveSessionToken(options));

  // La clave NO incluye sessionToken: misma query + límite = mismo resultado de Google,
  // independientemente de la sesión. Re-inyectamos el token actual al devolver del cache.
  const cacheKey = `${normalizeQuery(text)}::${normalizedLimit}`;
  const cached = getCached(autocompleteCache, cacheKey);
  if (cached) {
    return cached.map((item) => ({ ...item, sessionToken }));
  }
  if (inFlightAutocomplete.has(cacheKey)) {
    const result = await inFlightAutocomplete.get(cacheKey);
    return result.map((item) => ({ ...item, sessionToken }));
  }

  const requestPromise = (async () => {
    const suggestions = await placesAutocompleteRequest(text, sessionToken);
    const mapped = suggestions
      .map((item, index) => ({
        ...mapAutocompletePrediction(item?.placePrediction, sessionToken, text),
        _index: index,
      }))
      .filter(Boolean)
      .filter((item) => !isOutsideSaltaCapitalSubtitle(item.subtitle))
      .sort((a, b) => a._index - b._index);

    const enriched = await enrichGuemesStreetNumberResults(mapped, text, sessionToken, normalizedLimit);
    const result = enriched.map(({ _score, _index, ...rest }) => rest);

    setCached(autocompleteCache, cacheKey, result, AUTOCOMPLETE_TTL_MS);
    return result;
  })();

  inFlightAutocomplete.set(cacheKey, requestPromise);
  try {
    const result = await requestPromise;
    return result.map((item) => ({ ...item, sessionToken }));
  } finally {
    inFlightAutocomplete.delete(cacheKey);
  }
}

const searchPoiSalta = autocompleteAddressSalta;

function mapPlaceDetailsEssentials(data, fallback = {}) {
  const id = String(data?.id || '').trim();
  const lat = Number(data?.location?.latitude);
  const lng = Number(data?.location?.longitude);
  const formattedAddress = String(data?.formattedAddress || '').trim();
  const types = Array.isArray(data?.types) ? data.types : [];

  if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Google Places no devolvió ubicación válida');
  }

  const parsed = parseFormattedAddressParts(formattedAddress);
  const title = String(fallback.title || parsed.title || '').trim();
  const subtitle = String(fallback.subtitle || parsed.subtitle || '').trim();

  return {
    placeId: `google:${id}`,
    lat,
    lng,
    formattedAddress: formattedAddress || fallback.formattedAddress || title,
    title,
    subtitle,
    types,
  };
}

/**
 * SKU: Place Details Essentials — coords + dirección desde Google (1 request por placeId, cacheado).
 */
async function fetchPlaceDetailsEssentials(rawPlaceId, options = {}) {
  const placeId = String(rawPlaceId || '').replace(/^google:/, '').trim();
  if (!placeId || !isGoogleConfigured()) {
    throw new Error('GOOGLE_MAPS_API_KEY no configurada');
  }

  assertPlaceDetailsEssentialsMask(PLACE_DETAILS_ESSENTIALS_MASK);

  const sessionToken = String(options?.sessionToken || '').trim();
  const cached = getCached(placeDetailsCache, placeId);
  if (cached) {
    if (sessionToken) completeSession(sessionToken);
    return cached;
  }

  const cacheKey = placeId;
  if (inFlightPlaceDetails.has(cacheKey)) return inFlightPlaceDetails.get(cacheKey);

  const fallback = {
    title: options?.title,
    subtitle: options?.subtitle,
    formattedAddress: options?.formattedAddress,
  };

  const requestPromise = (async () => {
    const key = readGoogleApiKey();
    const query = sessionToken
      ? `?sessionToken=${encodeURIComponent(sessionToken)}`
      : '';
    const url = `${PLACES_NEW_BASE}/places/${encodeURIComponent(placeId)}${query}`;
    assertAllowedUrl(url);

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS) : null;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': PLACE_DETAILS_ESSENTIALS_MASK,
        },
        signal: controller?.signal,
      });

      if (!response.ok) {
        throw new Error('No se pudo obtener el lugar en Google Places');
      }

      const data = await response.json();
      const mapped = mapPlaceDetailsEssentials(data, {
        ...fallback,
        ...lookupPlaceLabel(placeId),
      });

      if (sessionToken) completeSession(sessionToken);

      setCached(placeDetailsCache, placeId, mapped, PLACE_DETAILS_CACHE_TTL_MS);
      return mapped;
    } catch (err) {
      if (err?.message?.includes('Google Places')) throw err;
      throw new Error('No se pudo obtener el lugar en Google Places');
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  inFlightPlaceDetails.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightPlaceDetails.delete(cacheKey);
  }
}

function buildGoogleMapsSubtitle(item) {
  return cleanAutocompleteSubtitle(item?.subtitle || item?.shortAddress || '');
}

/**
 * SKU: Place Details Essentials (IDs Only) — verifica que un placeId sigue siendo
 * válido en Google sin pagar el SKU completo.
 * Devuelve el placeId canónico o null si no existe.
 */
async function fetchPlaceIdOnly(rawPlaceId) {
  const placeId = String(rawPlaceId || '').replace(/^google:/, '').trim();
  if (!placeId || !isGoogleConfigured()) return null;

  assertPlaceDetailsIdsOnlyMask(PLACE_DETAILS_IDS_ONLY_MASK);

  const inFlightKey = `ids-only:${placeId}`;
  if (inFlightPlaceDetails.has(inFlightKey)) return inFlightPlaceDetails.get(inFlightKey);

  const requestPromise = (async () => {
    const key = readGoogleApiKey();
    const url = `${PLACES_NEW_BASE}/places/${encodeURIComponent(placeId)}`;
    assertAllowedUrl(url);

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS) : null;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': PLACE_DETAILS_IDS_ONLY_MASK,
        },
        signal: controller?.signal,
      });

      if (!response.ok) return null;
      const data = await response.json();
      const canonical = String(data?.id || '').trim();
      return canonical ? `google:${canonical}` : null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  inFlightPlaceDetails.set(inFlightKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightPlaceDetails.delete(inFlightKey);
  }
}

function resolveFormattedAddress(rawPlaceId, options = {}) {
  const explicit = String(options?.formattedAddress || '').trim();
  if (explicit) return explicit;

  const cached = lookupPlaceLabel(rawPlaceId);
  if (cached?.address) return cached.address;

  const title = String(options?.title || '').trim();
  const subtitle = String(options?.subtitle || '').trim();
  if (title && subtitle) return `${title}, ${subtitle}`;
  return title || '';
}

let persistentCacheProvider = null;

/**
 * Registra caché persistente (p. ej. Supabase google_place_details_cache).
 * Se consulta antes de Place Details Essentials para ahorrar llamadas a Google.
 */
function setGooglePlacePersistentCache(provider) {
  persistentCacheProvider = provider || null;
}

function buildGooglePlaceDetailsResult(details, options = {}, geocodeSource = null) {
  if (!isWithinSaltaCapital(details.lat, details.lng)) {
    throw new Error('La dirección debe estar en Salta Capital');
  }

  const rawId = String(details?.placeId || '').replace(/^google:/, '').trim();
  const formattedAddress = details.formattedAddress
    || resolveFormattedAddress(rawId, options);

  return {
    lat: details.lat,
    lng: details.lng,
    formattedAddress,
    title: details.title || options?.title || null,
    subtitle: details.subtitle || options?.subtitle || null,
    placeId: details.placeId || (rawId ? `google:${rawId}` : null),
    types: details.types || [],
    geocodeSource,
  };
}

/**
 * Obtiene coordenadas y dirección vía caché Supabase + Place Details Essentials.
 */
async function getGooglePlaceDetails(placeId, options = {}) {
  const rawId = String(placeId || '').replace(/^google:/, '').trim();
  if (!rawId) throw new Error('place_id de Google inválido');
  if (!isGoogleConfigured()) throw new Error('GOOGLE_MAPS_API_KEY no configurada');

  const normalizedPlaceId = `google:${rawId}`;
  const sessionToken = String(options?.sessionToken || '').trim();

  if (persistentCacheProvider?.get) {
    try {
      const cached = await persistentCacheProvider.get(normalizedPlaceId);
      if (cached) {
        if (sessionToken) completeSession(sessionToken);
        return buildGooglePlaceDetailsResult(cached, options, 'supabase_cache');
      }
    } catch {
      // La caché es opcional; continuar con Place Details Essentials.
    }
  }

  const details = await fetchPlaceDetailsEssentials(rawId, {
    sessionToken: options?.sessionToken,
    title: options?.title,
    subtitle: options?.subtitle,
    formattedAddress: resolveFormattedAddress(rawId, options),
  });

  if (persistentCacheProvider?.upsert) {
    try {
      await persistentCacheProvider.upsert({
        placeId: normalizedPlaceId,
        formattedAddress: details.formattedAddress || resolveFormattedAddress(rawId, options),
        lat: details.lat,
        lng: details.lng,
        title: details.title || options?.title || null,
        subtitle: details.subtitle || options?.subtitle || null,
        types: details.types || [],
      });
    } catch {
      // La caché es opcional; no bloquear la respuesta.
    }
  }

  return buildGooglePlaceDetailsResult(details, options, 'google_place_details_essentials');
}

async function geocodeAddressGoogle() {
  throw new Error(
    'Geocodificar por texto requiere elegir una sugerencia (placeId). '
    + 'Usá Autocomplete para buscar y Place Details Essentials para coords.',
  );
}

module.exports = {
  autocompleteAddressSalta,
  searchPoiSalta,
  getGooglePlaceDetails,
  fetchPlaceDetailsEssentials,
  fetchPlaceIdOnly,
  geocodeAddressGoogle,
  setGooglePlacePersistentCache,
  isGooglePlaceId,
  isGoogleConfigured,
  buildGoogleMapsSubtitle,
  createSessionToken,
  registerAutocompleteSession,
  completeSession,
  lookupPlaceLabel,
  PLACE_DETAILS_ESSENTIALS_MASK,
  PLACE_DETAILS_IDS_ONLY_MASK,
};
