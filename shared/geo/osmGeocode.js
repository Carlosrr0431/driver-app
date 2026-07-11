/**
 * Geocodificación forward vía Nominatim/OSM + Georef (sin Google Geocoding ni TomTom).
 * Usado para obtener lat/lng a partir del texto que devolvió Autocomplete (New).
 */

const {
  NOMINATIM_BASE_URL,
  NOMINATIM_USER_AGENT,
  NOMINATIM_SELF_HOSTED,
  SALTA_VIEWBOX,
  SALTA_COUNTRY,
  isWithinSaltaCapital,
} = require('./mapConfig');
const { searchGeorefAddress } = require('./georef');
const { pickPrimaryHouseNumber, getCatalogAddressVariants, buildAddressSearchQueries, parseStreetIntersection } = require('../salta-address');
const {
  resolveKnownPoiBranch,
  resolveSaltaKnownPoi,
  getKnownPoiSearchQueries,
  fixPoiTypoTokens,
  normalizePoiText,
} = require('../salta-known-pois');

const REQUEST_MIN_INTERVAL_MS = NOMINATIM_SELF_HOSTED ? 0 : 1100;
const NOMINATIM_TIMEOUT_MS = 12000;

const POI_CLASSES = new Set([
  'amenity', 'shop', 'tourism', 'leisure', 'office', 'craft', 'healthcare', 'historic',
]);

const GENERIC_GEO_TOKENS = new Set(['salta', 'argentina', 'capital', 'a4400']);

let lastRequestAt = 0;
let requestChain = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function foldText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Corrige typos frecuentes conservando mayúsculas razonables para Nominatim. */
function normalizeGeocodeText(text) {
  return String(text || '').trim()
    .replace(/\bfransisca\b/ig, 'Francisca')
    .replace(/\bjarava\b/ig, 'Jaraba')
    .replace(/\bshoping\b/ig, 'Shopping')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForMatch(text) {
  return foldText(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !GENERIC_GEO_TOKENS.has(token));
}

/** Calle indicada por Google (subtítulo / dirección formateada), ej. "Avenida Independencia". */
function extractStreetHint(...parts) {
  for (const raw of parts) {
    const text = normalizeGeocodeText(raw);
    if (!text) continue;

    const withNumber = text.match(
      /((?:avenida|av\.?|calle|c\.?|boulevard|bv\.?|pasaje|ruta|rn)\s+[^,]+?\d+[a-zA-Z]?)/i,
    );
    if (withNumber) return foldText(withNumber[1]);

    const streetOnly = text.match(
      /(?:^|,\s*)((?:avenida|av\.?|calle|c\.?|boulevard|bv\.?|pasaje)\s+[^,]+?)(?:\s*,\s*|\s+salta\b|$)/i,
    );
    if (streetOnly) {
      const name = streetOnly[1].trim();
      if (name.length >= 8) return foldText(name);
    }
  }
  return '';
}

function streetHintTokens(streetHint) {
  if (!streetHint) return [];
  const stripped = streetHint.replace(/^(avenida|av|calle|c|boulevard|bv|pasaje|ruta|rn)\s+/i, '');
  return tokenizeForMatch(stripped || streetHint);
}

function hitMatchesStreetHint(hit, streetHint) {
  if (!streetHint) return true;
  const tokens = streetHintTokens(streetHint);
  if (!tokens.length) return true;
  const road = foldText(hit.road);
  const display = foldText(hit.formattedAddress);
  const name = foldText(hit.name);
  return tokens.some((token) => road.includes(token) || display.includes(token) || name.includes(token));
}

function buildSearchQuery(address) {
  const text = normalizeGeocodeText(address);
  if (!text) return '';
  if (/salta/i.test(text)) return text;
  return `${text}, Salta, Argentina`;
}

function parseCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function mapSearchHit(item) {
  const osmIdRaw = item?.osm_id;
  const osmId = Number(osmIdRaw);
  return {
    lat: parseCoordinate(item?.lat),
    lng: parseCoordinate(item?.lon),
    formattedAddress: String(item?.display_name || '').trim(),
    name: String(item?.name || item?.namedetails?.name || '').trim(),
    osmClass: String(item?.class || '').trim(),
    osmType: String(item?.type || '').trim(),
    osmKind: String(item?.osm_type || '').trim(),
    osmId: Number.isFinite(osmId) ? osmId : null,
    road: String(item?.address?.road || '').trim(),
    suburb: String(item?.address?.suburb || item?.address?.neighbourhood || '').trim(),
  };
}

function scorePoiHit(hit, { title, subtitle, label }) {
  const titleFold = foldText(title);
  const subtitleFold = foldText(subtitle);
  const nameFold = foldText(hit.name);
  const displayFold = foldText(hit.formattedAddress);
  const roadFold = foldText(hit.road);
  const titleTokens = tokenizeForMatch(title);
  const subtitleTokens = tokenizeForMatch(subtitle);

  let score = 0;

  if (nameFold && titleFold) {
    if (nameFold === titleFold) score += 6;
    else if (nameFold.includes(titleFold) || titleFold.includes(nameFold)) score += 4.5;
  }

  if (titleFold && displayFold.includes(titleFold)) score += 2.5;

  for (const token of titleTokens) {
    if (nameFold.includes(token)) score += 2;
    else if (displayFold.includes(token)) score += 1;
    else score -= 1.2;
  }

  for (const token of subtitleTokens) {
    if (roadFold.includes(token) || displayFold.includes(token)) score += 1.2;
  }

  if (POI_CLASSES.has(hit.osmClass)) score += 2;
  if (hit.osmType === 'school' && /escuela|colegio|instituto|normal/i.test(titleFold)) score += 3;
  if (hit.osmClass === 'building' || hit.osmType === 'house') score += 1.5;
  if (hit.osmClass === 'highway' || hit.osmType === 'residential' || hit.osmType === 'tertiary') {
    score -= 2.5;
  }
  if (hit.osmClass === 'place' && !POI_CLASSES.has(hit.osmClass)) score -= 1;

  const titlePresent = titleTokens.length === 0
    || titleTokens.some((token) => nameFold.includes(token) || displayFold.includes(token));
  if (!titlePresent) score -= 4;

  if (subtitleFold && titlePresent) {
    const subtitleMatch = subtitleTokens.some(
      (token) => roadFold.includes(token) || displayFold.includes(token) || suburbFoldIncludes(hit, token),
    );
    if (subtitleMatch) score += 1.5;
  }

  if (isWithinSaltaCapital(hit.lat, hit.lng)) score += 0.5;

  const streetHint = extractStreetHint(subtitle, label);
  if (streetHint && !hitMatchesStreetHint(hit, streetHint)) score -= 10;

  return score;
}

function suburbFoldIncludes(hit, token) {
  return foldText(hit.suburb).includes(token);
}

function dedupeHits(hits) {
  const seen = new Set();
  const merged = [];
  for (const hit of hits) {
    if (hit.lat == null || hit.lng == null) continue;
    const key = `${hit.lat.toFixed(5)},${hit.lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }
  return merged;
}

function uniqueQueries(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = normalizeGeocodeText(value);
    if (!text) continue;
    const key = foldText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** Acorta nombres largos de escuelas/colegios para coincidir con OSM (ej. "Escuela Normal"). */
function buildInstitutionShortQueries(title, subtitle) {
  const text = normalizeGeocodeText(title);
  if (!/^(escuela|colegio|instituto|universidad|facultad)\b/i.test(text)) return [];

  const queries = [];
  const words = text.split(/\s+/).filter(Boolean);

  for (let len = Math.min(4, words.length); len >= 2; len -= 1) {
    queries.push(`${words.slice(0, len).join(' ')}, Salta, Argentina`);
  }

  const withoutHonorific = text
    .replace(/\s+(general|gral\.?|dr\.?|prof\.?|ing\.?)\s+[\w\s]+$/i, '')
    .trim();
  if (withoutHonorific !== text && withoutHonorific.length >= 8) {
    queries.push(`${withoutHonorific}, Salta, Argentina`);
  }

  const normalMatch = text.match(/^(escuela\s+normal)\b/i);
  if (normalMatch) {
    queries.push(`${normalMatch[1]}, Salta, Argentina`);
    if (subtitle && /mitre/i.test(subtitle)) {
      queries.push(`${normalMatch[1]}, Bartolomé Mitre, Salta, Argentina`);
    }
  }

  return queries;
}

function buildPoiGeocodeQueries(title, subtitle, label) {
  const poiTitle = normalizeGeocodeText(title);
  const poiSubtitle = normalizeGeocodeText(subtitle);
  const poiLabel = normalizeGeocodeText(label);
  const queries = [];

  if (poiTitle) {
    queries.push(`${poiTitle}, Salta, Argentina`);
    queries.push(`${poiTitle}, Salta Capital, Argentina`);
    if (poiSubtitle) queries.push(`${poiTitle}, ${poiSubtitle}`);
    if (poiSubtitle && !/salta/i.test(poiSubtitle)) {
      queries.push(`${poiTitle}, ${poiSubtitle}, Salta, Argentina`);
    }
    queries.push(poiTitle);
    if (/^la\s+/i.test(poiTitle)) {
      queries.push(`${poiTitle.replace(/^la\s+/i, '')}, Salta, Argentina`);
    }
    const typoNorm = fixPoiTypoTokens(normalizePoiText(poiTitle));
    if (typoNorm && typoNorm !== foldText(poiTitle)) {
      queries.push(`${typoNorm}, Salta, Argentina`);
    }
    queries.push(...buildInstitutionShortQueries(poiTitle, poiSubtitle));
  }

  if (poiLabel) queries.push(poiLabel);
  if (poiSubtitle && pickPrimaryHouseNumber(poiSubtitle) != null) {
    queries.push(`${poiSubtitle}, Salta, Argentina`);
    if (poiTitle) queries.push(`${poiTitle}, ${poiSubtitle}, Salta, Argentina`);
  }

  return uniqueQueries(queries);
}

/** POI con nombre propio (ej. "Plaza Ceferino") — priorizar Nominatim sobre alias genéricos. */
function hasNamedQualifier(title) {
  const norm = fixPoiTypoTokens(normalizePoiText(title));
  const match = norm.match(/^(plaza|parque|hospital|mercado|museo|estadio|restaurante?|bar|iglesia|capilla)\s+(.+)$/);
  if (!match) return false;

  const qualifier = String(match[2] || '').trim();
  if (qualifier.length < 3) return false;
  if (['salta', 'argentina', 'capital', 'centro', 'principal'].includes(qualifier)) return false;
  if (/^9\s+de\s+julio$/.test(qualifier)) return false;

  return true;
}

async function geocodeFromNominatimPoiLabel(poiTitle, poiSubtitle, label) {
  const queries = buildPoiGeocodeQueries(poiTitle, poiSubtitle, label);
  const allHits = await fetchHitsForQueries(queries, 8);
  const context = { title: poiTitle, subtitle: poiSubtitle, label };
  const best = pickBestHit(allHits, context);
  if (!best) return null;

  return {
    lat: best.lat,
    lng: best.lng,
    formattedAddress: label,
  };
}

/** Devuelve si las coordenadas parecen estar en otra calle que la indicada por Google. */
function assessStreetHintConsistency({ subtitle, formattedAddress, lat, lng, road = '' }) {
  const streetHint = extractStreetHint(subtitle, formattedAddress);
  if (!streetHint) return { ok: true };

  const hit = {
    lat,
    lng,
    road: String(road || ''),
    formattedAddress: String(formattedAddress || ''),
    name: '',
  };

  if (hitMatchesStreetHint(hit, streetHint)) return { ok: true };

  return {
    ok: false,
    message: `Coordenadas OSM incorrectas: el lugar no está en ${subtitle || formattedAddress}`,
    streetHint,
  };
}

function buildAddressGeocodeQueries(address) {
  const text = normalizeGeocodeText(address);
  const queries = [text, buildSearchQuery(text)];
  if (pickPrimaryHouseNumber(text) == null) {
    queries.push(...getCatalogAddressVariants(text, 4));
  }
  return uniqueQueries(queries);
}

async function nominatimFetch(path, params = {}) {
  requestChain = requestChain.then(async () => {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < REQUEST_MIN_INTERVAL_MS) {
      await sleep(REQUEST_MIN_INTERVAL_MS - elapsed);
    }

    const qs = new URLSearchParams({
      format: 'jsonv2',
      'accept-language': 'es',
      ...params,
    });

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS)
      : null;

    try {
      const response = await fetch(`${NOMINATIM_BASE_URL}${path}?${qs.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': NOMINATIM_USER_AGENT,
        },
        signal: controller?.signal,
      });

      lastRequestAt = Date.now();

      if (!response.ok) {
        throw new Error(`Nominatim HTTP ${response.status}`);
      }

      return response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  return requestChain;
}

async function fetchSearchHitsRaw(query, limit = 8) {
  const q = buildSearchQuery(query);
  if (!q) return [];

  const bounded = await nominatimFetch('/search', {
    q,
    limit: String(Math.max(1, Math.min(limit, 10))),
    viewbox: SALTA_VIEWBOX,
    bounded: '1',
    addressdetails: '1',
    countrycodes: SALTA_COUNTRY,
  });

  const boundedHits = (Array.isArray(bounded) ? bounded : [])
    .map(mapSearchHit)
    .filter((item) => item.lat != null && item.lng != null);

  if (boundedHits.length > 0) return boundedHits;

  const relaxed = await nominatimFetch('/search', {
    q,
    limit: String(Math.max(1, Math.min(limit, 10))),
    viewbox: SALTA_VIEWBOX,
    bounded: '0',
    addressdetails: '1',
    countrycodes: SALTA_COUNTRY,
  });

  const relaxedHits = (Array.isArray(relaxed) ? relaxed : [])
    .map(mapSearchHit)
    .filter((item) => item.lat != null && item.lng != null);

  if (relaxedHits.length > 0) return relaxedHits;

  const nationwide = await nominatimFetch('/search', {
    q,
    limit: String(Math.max(1, Math.min(limit, 12))),
    addressdetails: '1',
    countrycodes: SALTA_COUNTRY,
  });

  return (Array.isArray(nationwide) ? nationwide : [])
    .map(mapSearchHit)
    .filter((item) => item.lat != null && item.lng != null && isWithinSaltaCapital(item.lat, item.lng));
}

async function fetchHitsForQueries(queries, limit = 8) {
  const merged = [];
  for (const query of queries.slice(0, 8)) {
    const hits = await fetchSearchHitsRaw(query, limit);
    merged.push(...hits);
  }
  return dedupeHits(merged);
}

function shouldEnforceStreetHint(title, subtitle, label) {
  const titleNorm = foldText(title);
  const isInstitution = /\b(escuela|colegio|instituto|universidad|facultad|hospital|clinica|sanatorio)\b/.test(titleNorm);
  return isInstitution && Boolean(extractStreetHint(subtitle, label));
}

function pickBestHit(hits, context = {}, options = {}) {
  const { minScore = 0.5, allowRelaxed = true } = options;
  const streetHint = extractStreetHint(context.subtitle, context.label);
  const enforceStreet = shouldEnforceStreetHint(context.title, context.subtitle, context.label);
  const pool = hits.filter((hit) => isWithinSaltaCapital(hit.lat, hit.lng));
  let candidates = pool.length ? pool : hits;
  if (!candidates.length) return null;

  if (enforceStreet && streetHint) {
    const streetMatched = candidates.filter((hit) => hitMatchesStreetHint(hit, streetHint));
    if (streetMatched.length) candidates = streetMatched;
  }

  const scored = candidates
    .map((hit) => ({ hit, score: scorePoiHit(hit, context) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best && best.score >= minScore) return best.hit;

  if (!allowRelaxed) return null;

  const titleTokens = tokenizeForMatch(context.title);
  const relaxedPoi = candidates.find((hit) => {
    const nameFold = foldText(hit.name);
    const displayFold = foldText(hit.formattedAddress);
    const tokenHit = titleTokens.length === 0
      || titleTokens.some((token) => nameFold.includes(token) || displayFold.includes(token));
    return tokenHit && (POI_CLASSES.has(hit.osmClass) || hit.osmType === 'poi' || hit.name);
  });
  if (relaxedPoi) return relaxedPoi;

  const soft = scored.find(({ score, hit }) => score >= 0 && candidates.includes(hit));
  if (soft) return soft.hit;

  if (candidates.length === 1) return candidates[0];

  if (!context.title && candidates.length > 0) return candidates[0];

  return null;
}

async function geocodeViaGeoref(query) {
  const text = normalizeGeocodeText(query);
  if (!text || pickPrimaryHouseNumber(text) == null) return null;

  const hits = await searchGeorefAddress(text, 3);
  const best = hits.find((hit) => isWithinSaltaCapital(hit.lat, hit.lng)) || hits[0];
  if (!best || !isWithinSaltaCapital(best.lat, best.lng)) return null;

  return {
    lat: best.lat,
    lng: best.lng,
    formattedAddress: best.formattedAddress || text,
  };
}

const HIGHWAY_OSM_TYPES = new Set([
  'residential', 'primary', 'secondary', 'tertiary', 'trunk', 'living_street', 'unclassified', 'service',
]);

function scoreStreetWayHit(hit, streetName) {
  const streetFold = foldText(streetName);
  const nameFold = foldText(hit.name);
  const roadFold = foldText(hit.road);
  const tokens = tokenizeForMatch(streetName);

  let score = 0;
  if (hit.osmKind === 'way') score += 3;
  if (hit.osmClass === 'highway' || HIGHWAY_OSM_TYPES.has(hit.osmType)) score += 4;
  if (nameFold === streetFold || roadFold === streetFold) score += 6;
  for (const token of tokens) {
    if (nameFold.includes(token) || roadFold.includes(token)) score += 2;
    else score -= 0.5;
  }
  if (isWithinSaltaCapital(hit.lat, hit.lng)) score += 2;
  if (hit.osmKind === 'relation' || hit.osmType === 'administrative' || hit.osmType === 'town') score -= 6;
  if (['park', 'grassland', 'city_block', 'school', 'suburb'].includes(hit.osmType)) score -= 5;
  return score;
}

function flattenLineCoordinates(geojson) {
  if (!geojson) return [];
  if (geojson.type === 'LineString') return geojson.coordinates || [];
  if (geojson.type === 'MultiLineString') return (geojson.coordinates || []).flat();
  return [];
}

async function fetchStreetWayCandidates(streetName, limit = 4) {
  const queries = buildAddressSearchQueries(`${streetName}, Salta`);
  const allHits = await fetchHitsForQueries(queries.slice(0, 6), 8);
  const ranked = dedupeHits(allHits)
    .filter((hit) => isWithinSaltaCapital(hit.lat, hit.lng))
    .map((hit) => ({ hit, score: scoreStreetWayHit(hit, streetName) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  const candidates = [];
  const seenWayIds = new Set();

  for (const { hit } of ranked) {
    if (!hit.osmKind || hit.osmId == null) continue;
    const wayKey = `${hit.osmKind}:${hit.osmId}`;
    if (seenWayIds.has(wayKey)) continue;
    seenWayIds.add(wayKey);

    const osmIds = `${hit.osmKind[0].toUpperCase()}${hit.osmId}`;
    const data = await nominatimFetch('/lookup', { osm_ids: osmIds, polygon_geojson: '1' });
    const item = Array.isArray(data) ? data[0] : null;
    const coordinates = flattenLineCoordinates(item?.geojson);
    if (coordinates.length >= 2) {
      candidates.push({
        streetName: hit.name || streetName,
        coordinates,
      });
    }
    if (candidates.length >= limit) break;
  }

  return candidates;
}

function segmentIntersection(a1, a2, b1, b2) {
  const [x1, y1] = a1;
  const [x2, y2] = a2;
  const [x3, y3] = b1;
  const [x4, y4] = b2;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return {
    lng: x1 + t * (x2 - x1),
    lat: y1 + t * (y2 - y1),
  };
}

function findLineStringIntersections(lineA, lineB) {
  const points = [];
  for (let i = 0; i < lineA.length - 1; i += 1) {
    for (let j = 0; j < lineB.length - 1; j += 1) {
      const hit = segmentIntersection(lineA[i], lineA[i + 1], lineB[j], lineB[j + 1]);
      if (hit) points.push(hit);
    }
  }
  return points;
}

function dedupeNearbyPoints(points, epsilon = 0.00012) {
  const merged = [];
  for (const point of points) {
    const duplicate = merged.find(
      (item) => Math.abs(item.lat - point.lat) < epsilon && Math.abs(item.lng - point.lng) < epsilon,
    );
    if (!duplicate) merged.push(point);
  }
  return merged;
}

function closestPointsOnSegments(a1, a2, b1, b2) {
  const [x1, y1] = a1;
  const [x2, y2] = a2;
  const [x3, y3] = b1;
  const [x4, y4] = b2;
  const dx1 = x2 - x1;
  const dy1 = y2 - y1;
  const dx2 = x4 - x3;
  const dy2 = y4 - y3;

  let bestDist = Infinity;
  let bestA = null;
  let bestB = null;

  const consider = (pa, pb) => {
    const dist = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    if (dist < bestDist) {
      bestDist = dist;
      bestA = pa;
      bestB = pb;
    }
  };

  consider(a1, b1);
  consider(a1, b2);
  consider(a2, b1);
  consider(a2, b2);

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) > 1e-12) {
    const t = ((x3 - x1) * dy2 - (y3 - y1) * dx2) / denom;
    const u = ((x3 - x1) * dy1 - (y3 - y1) * dx1) / denom;
    const tc = Math.min(1, Math.max(0, t));
    const uc = Math.min(1, Math.max(0, u));
    consider([x1 + tc * dx1, y1 + tc * dy1], [x3 + uc * dx2, y3 + uc * dy2]);
  }

  for (const t of [0, 1]) {
    const px = x1 + t * dx1;
    const py = y1 + t * dy1;
    const u = dx2 * dx2 + dy2 * dy2 > 1e-12
      ? ((px - x3) * dx2 + (py - y3) * dy2) / (dx2 * dx2 + dy2 * dy2)
      : 0;
    const uc = Math.min(1, Math.max(0, u));
    consider([px, py], [x3 + uc * dx2, y3 + uc * dy2]);
  }

  for (const u of [0, 1]) {
    const px = x3 + u * dx2;
    const py = y3 + u * dy2;
    const t = dx1 * dx1 + dy1 * dy1 > 1e-12
      ? ((px - x1) * dx1 + (py - y1) * dy1) / (dx1 * dx1 + dy1 * dy1)
      : 0;
    const tc = Math.min(1, Math.max(0, t));
    consider([x1 + tc * dx1, y1 + tc * dy1], [px, py]);
  }

  if (!bestA || !bestB) return null;
  return {
    lat: (bestA[1] + bestB[1]) / 2,
    lng: (bestA[0] + bestB[0]) / 2,
    distance: bestDist,
  };
}

function closestApproachBetweenLines(lineA, lineB) {
  let best = null;
  for (let i = 0; i < lineA.length - 1; i += 1) {
    for (let j = 0; j < lineB.length - 1; j += 1) {
      const candidate = closestPointsOnSegments(lineA[i], lineA[i + 1], lineB[j], lineB[j + 1]);
      if (!candidate) continue;
      if (!best || candidate.distance < best.distance) best = candidate;
    }
  }
  return best;
}

async function geocodeStreetIntersection(intersection, label) {
  const { street1, street2 } = intersection;
  const [waysA, waysB] = await Promise.all([
    fetchStreetWayCandidates(street1),
    fetchStreetWayCandidates(street2),
  ]);

  if (!waysA.length || !waysB.length) {
    throw new Error('No se encontró la dirección en OSM/Nominatim');
  }

  let bestApproach = null;

  for (const wayA of waysA) {
    for (const wayB of waysB) {
      const intersections = dedupeNearbyPoints(
        findLineStringIntersections(wayA.coordinates, wayB.coordinates),
      );
      const chosen = intersections.find((point) => isWithinSaltaCapital(point.lat, point.lng))
        || intersections[0];
      if (chosen) {
        return {
          lat: chosen.lat,
          lng: chosen.lng,
          formattedAddress: label || `${street1} y ${street2}, Salta`,
        };
      }

      const approach = closestApproachBetweenLines(wayA.coordinates, wayB.coordinates);
      if (approach && isWithinSaltaCapital(approach.lat, approach.lng)) {
        if (!bestApproach || approach.distance < bestApproach.distance) {
          bestApproach = approach;
        }
      }
    }
  }

  if (bestApproach && bestApproach.distance <= 0.006) {
    return {
      lat: bestApproach.lat,
      lng: bestApproach.lng,
      formattedAddress: label || `${street1} y ${street2}, Salta`,
    };
  }

  throw new Error('No se encontró la intersección en OSM/Nominatim');
}

async function geocodeCoordsFromAddress(address, options = {}) {
  const preserveLabel = String(options?.preserveLabel || '').trim();
  const text = normalizeGeocodeText(address);
  if (!text) throw new Error('Dirección vacía');

  const intersection = parseStreetIntersection(text);
  if (intersection) {
    return geocodeStreetIntersection(intersection, preserveLabel || text);
  }

  const georef = await geocodeViaGeoref(text);
  if (georef) {
    return {
      ...georef,
      formattedAddress: preserveLabel || georef.formattedAddress,
    };
  }

  const queries = buildAddressGeocodeQueries(text);
  const hits = await fetchHitsForQueries(queries, 8);
  const best = pickBestHit(hits, { title: text, subtitle: '' }, { minScore: 0, allowRelaxed: true })
    || hits.find((hit) => isWithinSaltaCapital(hit.lat, hit.lng))
    || hits[0];

  if (!best) {
    throw new Error('No se encontró la dirección en OSM/Nominatim');
  }

  if (!isWithinSaltaCapital(best.lat, best.lng)) {
    throw new Error('La dirección debe estar en Salta Capital');
  }

  return {
    lat: best.lat,
    lng: best.lng,
    formattedAddress: preserveLabel || best.formattedAddress || text,
  };
}

async function tryKnownPoiGeocode(title, subtitle, label) {
  const knownBranch = resolveKnownPoiBranch(title, subtitle);
  if (knownBranch?.geocodeQuery) {
    try {
      const coords = await geocodeCoordsFromAddress(knownBranch.geocodeQuery, {
        preserveLabel: label || knownBranch.label,
      });
      return coords;
    } catch {
      // continuar
    }
  }

  const known = resolveSaltaKnownPoi(title);
  if (!known) return null;

  for (const query of getKnownPoiSearchQueries(known)) {
    try {
      const coords = await geocodeCoordsFromAddress(query, {
        preserveLabel: label || known.label,
      });
      return coords;
    } catch {
      // siguiente variante
    }
  }

  return null;
}

const FUEL_BRANDS = [
  { id: 'axion', patterns: [/\baxion\b/], nominatimName: 'Axion' },
  { id: 'ypf', patterns: [/\bypf\b/], nominatimName: 'YPF' },
  { id: 'shell', patterns: [/\bshell\b/], nominatimName: 'Shell' },
  { id: 'puma', patterns: [/\bpuma\b/], nominatimName: 'Puma' },
  { id: 'refinor', patterns: [/\brefinor\b/], nominatimName: 'Refinor' },
  { id: 'bandera_blanca', patterns: [/\bbandera\s*blanca\b/], nominatimName: 'Bandera Blanca' },
  { id: 'petrobras', patterns: [/\bpetrobras\b/], nominatimName: 'Petrobras' },
  { id: 'gulf', patterns: [/\bgulf\b/], nominatimName: 'Gulf' },
];

const FUEL_TOKEN_STOPWORDS = new Set([
  'energy', 'octano', 'srl', 'axion', 'ypf', 'shell', 'puma', 'refinor', 'petrobras', 'gulf',
  'estacion', 'servicio', 'combustible', 'avenida', 'av', 'calle', 'ruta', 'nacional', 'salta',
  'argentina', 'capital', 'del', 'las', 'los', 'energy', 'gas', 'gnc',
]);

function parseFuelStationBrand(title) {
  const norm = foldText(title);
  if (!norm) return null;
  return FUEL_BRANDS.find((brand) => brand.patterns.some((pattern) => pattern.test(norm))) || null;
}

function extractFuelBranchTokens(title, subtitle) {
  return tokenizeForMatch(`${title} ${subtitle}`)
    .filter((token) => !FUEL_TOKEN_STOPWORDS.has(token));
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function scoreFuelStationHit(hit, brand, title, subtitle, streetAnchor = null) {
  const brandFold = foldText(brand.nominatimName);
  const nameFold = foldText(hit.name);
  const displayFold = foldText(hit.formattedAddress);
  const roadFold = foldText(hit.road);
  const titleFold = foldText(title);
  const subtitleFold = foldText(subtitle);
  const combinedFold = `${titleFold} ${subtitleFold}`;

  const isFuelPoi = hit.osmType === 'fuel' || nameFold.includes(brandFold);
  if (!isFuelPoi) return -999;

  let score = hit.osmType === 'fuel' ? 8 : 4;
  if (nameFold.includes(brandFold)) score += 5;

  for (const token of extractFuelBranchTokens(title, subtitle)) {
    if (roadFold.includes(token) || displayFold.includes(token)) score += 3;
    else if (suburbFoldIncludes(hit, token)) score += 2;
    else score -= 0.4;
  }

  if (/del\s*paseo|paseo/.test(combinedFold) && /limache|malvinas|tavella|rotonda|paseo/.test(displayFold)) {
    score += 5;
  }
  if (/rural|octano|paraguay/.test(combinedFold) && /contreras|casino|paraguay/.test(displayFold)) {
    score += 5;
  }
  if (/lomas/.test(combinedFold) && /ruta\s*9|rn\s*9|nacional\s*9/.test(combinedFold + displayFold)) {
    score += 4;
  }
  if (/rn\s*51|nacional\s*51|ruta\s*51/.test(combinedFold) && /51|limache|alvarado/.test(displayFold)) {
    score += 3;
  }

  if (streetAnchor?.lat != null && streetAnchor?.lng != null) {
    const distanceKm = haversineKm(hit.lat, hit.lng, streetAnchor.lat, streetAnchor.lng);
    score += Math.max(0, 8 - distanceKm * 1.6);
  }

  if (isWithinSaltaCapital(hit.lat, hit.lng)) score += 1;
  return score;
}

async function resolveFuelStreetAnchor(subtitle) {
  const text = normalizeGeocodeText(subtitle);
  if (!text || pickPrimaryHouseNumber(text) != null) return null;
  if (!/(avenida|av\.?|ruta|rn\b|calle|boulevard|pasaje|ex\s+combat)/i.test(text)) return null;

  const hits = await fetchSearchHitsRaw(`${text}, Salta, Argentina`, 4);
  return hits.find((hit) => isWithinSaltaCapital(hit.lat, hit.lng)) || hits[0] || null;
}

async function geocodeFuelStationFromOsm(title, subtitle, label) {
  const brand = parseFuelStationBrand(title);
  if (!brand) return null;

  const queries = uniqueQueries([
    `${brand.nominatimName}, Salta, Argentina`,
    `${brand.nominatimName} Salta`,
    brand.nominatimName,
  ]);

  const allHits = await fetchHitsForQueries(queries, 12);
  const fuelHits = dedupeHits(allHits).filter((hit) => {
    if (!isWithinSaltaCapital(hit.lat, hit.lng)) return false;
    const nameFold = foldText(hit.name);
    return hit.osmType === 'fuel' || nameFold.includes(foldText(brand.nominatimName));
  });

  if (!fuelHits.length) return null;

  const streetAnchor = await resolveFuelStreetAnchor(subtitle);
  const scored = fuelHits
    .map((hit) => ({ hit, score: scoreFuelStationHit(hit, brand, title, subtitle, streetAnchor) }))
    .filter(({ score }) => score > -999)
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.hit;
  if (!best) return null;

  return {
    lat: best.lat,
    lng: best.lng,
    formattedAddress: label,
  };
}

/**
 * Geocodifica un POI usando título + subtítulo de Google Autocomplete.
 * Prioriza dirección estructurada (calle+altura) y POIs conocidos sobre nombre en OSM.
 */
async function geocodeCoordsFromPoiLabel({ title, subtitle, formattedAddress }) {
  const poiTitle = normalizeGeocodeText(title);
  const poiSubtitle = normalizeGeocodeText(subtitle);
  const label = normalizeGeocodeText(formattedAddress)
    || (poiTitle && poiSubtitle ? `${poiTitle}, ${poiSubtitle}` : poiTitle);

  if (!poiTitle) {
    return geocodeCoordsFromAddress(label);
  }

  const intersection = parseStreetIntersection(poiTitle) || parseStreetIntersection(label);
  if (intersection) {
    return geocodeStreetIntersection(intersection, label);
  }

  const preferNominatimFirst = hasNamedQualifier(poiTitle);

  if (!preferNominatimFirst) {
    const knownCoords = await tryKnownPoiGeocode(poiTitle, poiSubtitle, label);
    if (knownCoords) return knownCoords;

    const fuelCoords = await geocodeFuelStationFromOsm(poiTitle, poiSubtitle, label);
    if (fuelCoords) return fuelCoords;
  }

  if (poiSubtitle && pickPrimaryHouseNumber(poiSubtitle) != null) {
    try {
      const streetCoords = await geocodeCoordsFromAddress(`${poiSubtitle}, Salta, Argentina`, {
        preserveLabel: label,
      });
      return streetCoords;
    } catch {
      // continuar con búsqueda por nombre
    }
  }

  const nominatimCoords = await geocodeFromNominatimPoiLabel(poiTitle, poiSubtitle, label);
  if (nominatimCoords) return nominatimCoords;

  if (preferNominatimFirst) {
    const knownCoords = await tryKnownPoiGeocode(poiTitle, poiSubtitle, label);
    if (knownCoords) return knownCoords;
  }

  const fuelCoords = await geocodeFuelStationFromOsm(poiTitle, poiSubtitle, label);
  if (fuelCoords) return fuelCoords;

  throw new Error('No se encontró el lugar en OSM/Nominatim');
}

module.exports = {
  geocodeCoordsFromAddress,
  geocodeCoordsFromPoiLabel,
  buildSearchQuery,
  buildPoiGeocodeQueries,
  scorePoiHit,
  pickBestHit,
  normalizeGeocodeText,
  extractStreetHint,
  hitMatchesStreetHint,
  assessStreetHintConsistency,
};
