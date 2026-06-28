/**
 * Cliente Nominatim para el driver-app (OSM self-hosted en Railway).
 */

import {
  buildNominatimCacheKey,
  nominatimCache,
  withCachedFetch,
} from '../lib/geoCache';
import { NOMINATIM_BASE_URL, NOMINATIM_USER_AGENT } from '../utils/mapConfig';

const SALTA_VIEWBOX = '-65.55,-24.90,-65.30,-24.70';
const SALTA_BOUNDS = { north: -24.68, south: -24.88, east: -65.33, west: -65.48 };

const STREET_NUMBER_RE = /^(.+?)\s+(\d{1,5})$/;

function isWithinSalta(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  return (
    Number.isFinite(la) && Number.isFinite(ln)
    && la <= SALTA_BOUNDS.north && la >= SALTA_BOUNDS.south
    && ln <= SALTA_BOUNDS.east && ln >= SALTA_BOUNDS.west
  );
}

function hasStreetNumberPattern(query) {
  return STREET_NUMBER_RE.test(String(query || '').trim());
}

async function nominatimGet(path, params = {}) {
  const qs = {
    format: 'jsonv2',
    'accept-language': 'es',
    ...params,
  };
  const cacheKey = buildNominatimCacheKey(path, qs);

  return withCachedFetch(
    nominatimCache,
    cacheKey,
    async () => {
      const search = new URLSearchParams(qs);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${NOMINATIM_BASE_URL}${path}?${search.toString()}`, {
          headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
        return response.json();
      } finally {
        clearTimeout(timer);
      }
    },
  );
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const POI_CLASSES = new Set([
  'amenity', 'shop', 'tourism', 'leisure', 'office', 'craft', 'healthcare', 'historic',
]);
const VAGUE_TYPES = new Set(['administrative', 'state', 'country', 'postcode']);

function mapResult(item) {
  const lat = toNumber(item?.lat);
  const lng = toNumber(item?.lon);
  if (lat === null || lng === null) return null;

  const osmClass = String(item.class || '');
  const osmType = String(item.type || '');
  const addr = item.address || {};

  const street = String(addr.road || addr.pedestrian || addr.footway || '').trim();
  const house = String(addr.house_number || '').trim();
  const suburb = String(addr.suburb || addr.neighbourhood || addr.city_district || '').trim();
  const city = String(addr.city || addr.town || addr.village || 'Salta').trim();

  const poiName = POI_CLASSES.has(osmClass)
    ? String(item.name || '').trim()
    : '';

  let title = '';
  let subtitle = '';

  if (house && street) {
    title = `${street} ${house}`;
    subtitle = suburb ? `${suburb}, ${city}` : city;
  } else if (street) {
    title = street;
    subtitle = suburb ? `${suburb}, ${city}` : city;
  } else if (poiName) {
    title = poiName;
    subtitle = [street, suburb, city].filter(Boolean).join(', ');
  } else {
    const raw = String(item.display_name || '').split(',');
    title = raw[0]?.trim() || '';
    subtitle = raw.slice(1, 3).map((s) => s.trim()).filter(Boolean).join(', ');
  }

  const address = poiName
    ? [poiName, title && title !== poiName ? title : null, subtitle]
      .filter(Boolean).join(', ')
    : [title, subtitle].filter(Boolean).join(', ');

  const placeId = item.place_id != null ? String(item.place_id) : null;

  return {
    lat,
    lng,
    formattedAddress: address,
    placeId,
    title: (poiName || title) || address,
    subtitle,
    address: address || String(item.display_name || '').trim(),
    osmClass,
    osmType,
    osmId: item.osm_id != null ? String(item.osm_id) : null,
    osmIdType: item.osm_type != null ? String(item.osm_type) : null,
    importance: Number(item.importance) || 0,
  };
}

function scoreResult(result, query = '') {
  if (!result) return 0;
  const addr = String(result.formattedAddress || '').toLowerCase();
  const q = String(query || '').toLowerCase();
  let score = Number(result.importance ?? 0) * 20;

  if (result.osmClass === 'building' || result.osmType === 'house') score += 16;
  if (result.osmClass === 'amenity' || result.osmClass === 'shop') score += 10;
  if (addr.includes('salta')) score += 8;
  if (/\d/.test(q) && !String(result.formattedAddress).match(/\d/)) score -= 8;
  if (VAGUE_TYPES.has(result.osmType)) score -= 20;

  const queryWords = q.split(/\s+/).filter(Boolean);
  for (const word of queryWords) {
    if (addr.includes(word)) score += 5;
  }

  return score;
}

async function searchRaw(params) {
  const data = await nominatimGet('/search', {
    addressdetails: '1',
    countrycodes: 'ar',
    ...params,
  });
  return (Array.isArray(data) ? data : []).map(mapResult).filter(Boolean);
}

async function searchText(query, limit = 8, bounded = true) {
  const q = /salta/i.test(query) ? query : `${query}, Salta Capital, Argentina`;
  try {
    return await searchRaw({
      q,
      limit: String(Math.min(limit, 10)),
      viewbox: SALTA_VIEWBOX,
      bounded: bounded ? '1' : '0',
    });
  } catch {
    return [];
  }
}

async function searchStructured(query, limit = 6) {
  const match = String(query || '').trim().match(STREET_NUMBER_RE);
  if (!match) return [];
  const [, street, houseNumber] = match;

  try {
    return await searchRaw({
      street: `${houseNumber} ${street}`,
      city: 'Salta',
      state: 'Salta',
      country: 'Argentina',
      limit: String(limit),
      viewbox: SALTA_VIEWBOX,
      bounded: '1',
    });
  } catch {
    return [];
  }
}

function mergeRankedResults(primary, secondary, query, limit) {
  const seen = new Set();
  const results = [];

  for (const item of [...primary, ...secondary]) {
    if (!isWithinSalta(item.lat, item.lng)) continue;
    if (VAGUE_TYPES.has(item.osmType) && !item.formattedAddress.match(/\d/)) continue;
    const key = `${item.lat.toFixed(3)},${item.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ ...item, _score: scoreResult(item, query) });
  }

  results.sort((a, b) => b._score - a._score);
  return results.slice(0, limit);
}

export async function geocodeAddress(address) {
  const query = String(address || '').trim();
  if (!query) throw new Error('Dirección vacía');

  const structuredPromise = hasStreetNumberPattern(query)
    ? searchStructured(query, 3)
    : Promise.resolve([]);
  const hitsPromise = searchText(query, 5);

  const [structured, hits] = await Promise.all([structuredPromise, hitsPromise]);
  const results = mergeRankedResults(structured, hits, query, 8);

  if (results.length === 0) throw new Error('No se encontró la dirección');

  const best = results[0];
  return { lat: best.lat, lng: best.lng, formattedAddress: best.formattedAddress };
}

export async function autocompleteAddressSalta(query, limit = 4) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 3) return [];

  try {
    const structuredPromise = hasStreetNumberPattern(trimmed)
      ? searchStructured(trimmed, 3)
      : Promise.resolve([]);
    const primaryPromise = searchText(trimmed, Math.max(limit, 4), true);
    const [structured, primary] = await Promise.all([structuredPromise, primaryPromise]);

    return mergeRankedResults(structured, primary, trimmed, limit).map(({ _score, ...item }) => ({
      address: item.address,
      placeId: item.placeId,
      lat: item.lat,
      lng: item.lng,
      title: item.title,
      subtitle: item.subtitle,
    }));
  } catch {
    return [];
  }
}

export async function reverseGeocode(lat, lng) {
  const fallback = `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
  try {
    const data = await nominatimGet('/reverse', {
      lat: String(lat),
      lon: String(lng),
      addressdetails: '1',
      zoom: '17',
    });
    const mapped = mapResult(data);
    if (!mapped) return fallback;
    return mapped.formattedAddress || fallback;
  } catch {
    return fallback;
  }
}

export async function getPlaceDetails(placeId) {
  const id = String(placeId || '').trim();
  if (!id) throw new Error('placeId inválido');

  if (/^\d+$/.test(id)) {
    try {
      const data = await nominatimGet('/lookup', {
        place_ids: id,
        addressdetails: '1',
      });
      const item = Array.isArray(data) ? data[0] : null;
      const mapped = mapResult(item);
      if (mapped) {
        return { lat: mapped.lat, lng: mapped.lng, formattedAddress: mapped.formattedAddress };
      }
    } catch {
      // fallback abajo
    }
  }

  const coordMatch = id.replace('coord:', '').match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lng = Number(coordMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng, formattedAddress: await reverseGeocode(lat, lng) };
    }
  }

  throw new Error('No se pudo obtener detalles del lugar');
}

export async function geocodeAddressMultiple(address, limit = 5) {
  const results = await autocompleteAddressSalta(address, Math.max(limit, 5));
  if (results.length === 0) throw new Error('No se encontró la dirección');
  return results.slice(0, limit).map(({ lat, lng, address: formattedAddress }) => ({
    lat,
    lng,
    formattedAddress,
  }));
}
