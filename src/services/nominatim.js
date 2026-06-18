import {
  NOMINATIM_BASE_URL,
  NOMINATIM_SELF_HOSTED,
  NOMINATIM_USER_AGENT,
} from '../utils/mapConfig';

/** Salta Capital — viewbox Nominatim: oeste,sur,este,norte */
const SALTA_VIEWBOX = '-65.55,-24.90,-65.30,-24.70';
const SALTA_COUNTRY = 'ar';
/** Política Nominatim público: máx. 1 req/s. Desactivado con servidor propio. */
const REQUEST_MIN_INTERVAL_MS = NOMINATIM_SELF_HOSTED ? 0 : 1100;

let lastRequestAt = 0;
let requestChain = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function buildSearchQuery(address) {
  const text = String(address || '').trim();
  if (!text) return '';
  if (/salta/i.test(text)) return text;
  return `${text}, Salta, Argentina`;
}

function parseCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function mapNominatimResult(item) {
  const lat = parseCoordinate(item?.lat);
  const lng = parseCoordinate(item?.lon);
  if (lat === null || lng === null) return null;

  return {
    lat,
    lng,
    formattedAddress: String(item.display_name || '').trim(),
    placeId: item.place_id != null ? String(item.place_id) : null,
    importance: Number(item.importance) || 0,
    osmClass: String(item.class || ''),
    osmType: String(item.type || ''),
    address: item.address || {},
  };
}

function scoreNominatimResult(result, query = '') {
  if (!result) return Number.NEGATIVE_INFINITY;

  let score = (Number(result.importance) || 0) * 40;
  const name = String(result.formattedAddress || '').toLowerCase();
  const q = String(query || '').toLowerCase();
  const addr = result.address || {};

  if (addr.house_number) score += 18;
  if (addr.road) score += 12;
  if (result.osmClass === 'building') score += 14;
  if (result.osmClass === 'amenity' || result.osmClass === 'shop') score += 10;
  if (result.osmType === 'house' || result.osmType === 'residential') score += 8;
  if (name.includes('salta')) score += 10;
  if (name.includes('argentina')) score += 4;

  if (/\d/.test(q) && !addr.house_number) score -= 8;

  const vagueTypes = ['administrative', 'state', 'country', 'postcode'];
  if (vagueTypes.includes(result.osmType)) score -= 25;

  return score;
}

function sortNominatimResults(results, query) {
  return [...results]
    .map((item) => ({ item, score: scoreNominatimResult(item, query) }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
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

    const response = await fetch(`${NOMINATIM_BASE_URL}${path}?${qs.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_USER_AGENT,
      },
    });

    lastRequestAt = Date.now();

    if (!response.ok) {
      throw new Error(`Nominatim HTTP ${response.status}`);
    }

    return response.json();
  });

  return requestChain;
}

export const geocodeAddress = async (address) => {
  const query = buildSearchQuery(address);
  if (!query) throw new Error('Dirección vacía');

  const data = await nominatimFetch('/search', {
    q: query,
    addressdetails: '1',
    limit: '8',
    countrycodes: SALTA_COUNTRY,
    viewbox: SALTA_VIEWBOX,
    bounded: '1',
  });

  const results = (Array.isArray(data) ? data : [])
    .map(mapNominatimResult)
    .filter(Boolean);

  if (results.length === 0) {
    throw new Error('No se encontró la dirección');
  }

  const best = sortNominatimResults(results, address)[0];
  return {
    lat: best.lat,
    lng: best.lng,
    formattedAddress: best.formattedAddress,
  };
};

export const geocodeAddressMultiple = async (address, limit = 5) => {
  const query = buildSearchQuery(address);
  if (!query) throw new Error('Dirección vacía');

  const data = await nominatimFetch('/search', {
    q: query,
    addressdetails: '1',
    limit: String(Math.max(1, Math.min(limit, 10))),
    countrycodes: SALTA_COUNTRY,
    viewbox: SALTA_VIEWBOX,
    bounded: '1',
  });

  const results = (Array.isArray(data) ? data : [])
    .map(mapNominatimResult)
    .filter(Boolean);

  if (results.length === 0) {
    throw new Error('No se encontró la dirección');
  }

  return sortNominatimResults(results, address)
    .slice(0, limit)
    .map((item) => ({
      lat: item.lat,
      lng: item.lng,
      formattedAddress: item.formattedAddress,
    }));
};

export const reverseGeocode = async (lat, lng) => {
  const fallback = `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;

  try {
    const data = await nominatimFetch('/reverse', {
      lat: String(lat),
      lon: String(lng),
      addressdetails: '1',
      zoom: '18',
    });

    const label = String(data?.display_name || '').trim();
    return label || fallback;
  } catch (error) {
    console.error('Error en geocodificación inversa (Nominatim):', error);
    return fallback;
  }
};

/**
 * Búsqueda de direcciones en Salta Capital vía Nominatim.
 * Incluye lat/lng cuando están disponibles para evitar una segunda consulta.
 */
export const autocompleteAddressSalta = async (query, limit = 5) => {
  const text = String(query || '').trim();
  if (text.length < 3) return [];

  try {
    const data = await nominatimFetch('/search', {
      q: buildSearchQuery(text),
      addressdetails: '1',
      limit: String(Math.max(1, Math.min(limit, 8))),
      countrycodes: SALTA_COUNTRY,
      viewbox: SALTA_VIEWBOX,
      bounded: '1',
    });

    const results = (Array.isArray(data) ? data : [])
      .map(mapNominatimResult)
      .filter(Boolean);

    return sortNominatimResults(results, text)
      .slice(0, limit)
      .map((item) => ({
        address: item.formattedAddress,
        placeId: item.placeId,
        lat: item.lat,
        lng: item.lng,
      }));
  } catch (error) {
    console.error('Error en autocomplete Nominatim:', error);
    return [];
  }
};

export const getPlaceDetails = async (placeId) => {
  const id = String(placeId || '').trim();
  if (!id) throw new Error('place_id inválido');

  const data = await nominatimFetch('/lookup', {
    place_ids: id,
    addressdetails: '1',
  });

  const item = Array.isArray(data) ? data[0] : null;
  const mapped = mapNominatimResult(item);
  if (!mapped) {
    throw new Error('No se pudo obtener detalles del lugar');
  }

  return {
    lat: mapped.lat,
    lng: mapped.lng,
  };
};
