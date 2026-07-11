/**
 * Cliente de APIs geo del dashboard (mantiene claves de servidor en backend).
 */

const GEO_REQUEST_TIMEOUT_MS = 20000;
const PUBLIC_NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const NOMINATIM_USER_AGENT = 'ProfesionalPasajero/1.0 (contacto@profesional.com.ar)';

function isCoordinateLikeAddress(text) {
  return /^-?\d+\.\d{4,},\s*-?\d+\.\d{4,}$/.test(String(text || '').trim());
}

function isSuspiciousReverseResult(text) {
  const value = String(text || '').trim();
  if (!value || isCoordinateLikeAddress(value)) return true;
  const folded = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(\w{3,})\s+\1\b/.test(folded);
}

function formatOsmReverseAddress(data) {
  const addr = data?.address || {};
  const road = String(addr.road || addr.pedestrian || addr.residential || '').trim();
  const house = String(addr.house_number || '').trim();
  const suburb = String(addr.suburb || addr.neighbourhood || '').trim();
  const city = String(addr.city || addr.town || 'Salta').trim();

  if (road && house) {
    const line = suburb ? `${road} ${house}, ${suburb}, ${city}` : `${road} ${house}, ${city}`;
    return line.replace(/\s+/g, ' ').trim();
  }
  if (road) {
    return suburb ? `${road}, ${suburb}, ${city}` : `${road}, ${city}`;
  }

  const display = String(data?.display_name || '').trim();
  if (!display) return null;
  return display.split(',').slice(0, 4).join(',').trim();
}

async function reverseGeocodeViaPublicOsm(lat, lng) {
  const qs = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    addressdetails: '1',
    zoom: '18',
    'accept-language': 'es',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${PUBLIC_NOMINATIM_BASE_URL}/reverse?${qs.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const data = await response.json();
    const formatted = formatOsmReverseAddress(data);
    if (formatted && !isCoordinateLikeAddress(formatted)) return formatted;
    throw new Error('Sin dirección legible');
  } finally {
    clearTimeout(timer);
  }
}

function readDashboardUrl() {
  if (typeof process !== 'undefined' && process.env) {
    const fromEnv = String(process.env.EXPO_PUBLIC_DASHBOARD_URL || '').trim();
    if (fromEnv) return fromEnv.replace(/\/$/, '');
  }
  return 'https://profesional-dashboard.vercel.app';
}

async function dashboardGeoGet(path, { headers = {}, signal, timeoutMs = GEO_REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw new Error('aborted');
    }
    signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const response = await fetch(`${readDashboardUrl()}${path}`, {
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    return payload.data;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

async function geocodeAddress(address) {
  const text = String(address || '').trim();
  if (!text) throw new Error('Dirección vacía');
  const qs = new URLSearchParams({ address: text });
  const data = await dashboardGeoGet(`/api/geo/geocode?${qs.toString()}`);
  return {
    lat: data.lat,
    lng: data.lng,
    formattedAddress: data.formattedAddress,
    placeId: data.placeId || null,
    title: data.title || null,
    subtitle: data.subtitle || null,
    geocodeSource: data.geocodeSource || null,
  };
}

async function geocodeAddressMultiple(address, limit = 5) {
  const suggestions = await autocompleteAddressSalta(address, Math.max(limit, 5));
  if (!suggestions.length) {
    throw new Error('No se encontró la dirección');
  }

  const results = [];
  for (const item of suggestions.slice(0, limit)) {
    if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
      results.push({
        lat: item.lat,
        lng: item.lng,
        formattedAddress: item.address,
      });
      continue;
    }
    if (!item.placeId) continue;
    const details = await getPlaceDetails(item.placeId, {
      sessionToken: item.sessionToken,
      formattedAddress: item.address,
      title: item.title,
      subtitle: item.subtitle,
    });
    results.push({
      lat: details.lat,
      lng: details.lng,
      formattedAddress: details.formattedAddress || item.address,
    });
  }
  if (!results.length) {
    throw new Error('No se encontró la dirección');
  }
  return results;
}

async function reverseGeocode(lat, lng) {
  const fallback = `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return fallback;

  let fromDashboard = null;
  try {
    const qs = new URLSearchParams({
      lat: String(parsedLat),
      lng: String(parsedLng),
    });
    const data = await dashboardGeoGet(`/api/geo/reverse?${qs.toString()}`, {
      timeoutMs: GEO_REQUEST_TIMEOUT_MS,
    });
    const formatted = String(data?.formattedAddress || data?.address || '').trim();
    if (formatted && !isSuspiciousReverseResult(formatted)) {
      return formatted;
    }
    if (formatted) fromDashboard = formatted;
  } catch {
    // continuar con fallback OSM público
  }

  try {
    return await reverseGeocodeViaPublicOsm(parsedLat, parsedLng);
  } catch {
    return fromDashboard && !isCoordinateLikeAddress(fromDashboard) ? fromDashboard : fallback;
  }
}

async function autocompleteAddressSalta(query, limit = 5, options = {}) {
  const text = String(query || '').trim();
  if (text.length < 2) return [];
  const qs = new URLSearchParams({
    q: text,
    limit: String(Math.max(1, Math.min(limit, 8))),
  });
  if (options?.sessionToken) {
    qs.set('sessionToken', String(options.sessionToken));
  }
  return dashboardGeoGet(`/api/geo/autocomplete?${qs.toString()}`, {
    signal: options.signal,
  });
}

async function getPlaceDetails(placeId, options = {}) {
  const id = String(placeId || '').trim();
  if (!id) throw new Error('place_id inválido');
  const qs = new URLSearchParams({ placeId: id });
  if (options?.sessionToken) {
    qs.set('sessionToken', String(options.sessionToken));
  }
  if (options?.formattedAddress) {
    qs.set('formattedAddress', String(options.formattedAddress));
  }
  if (options?.title) {
    qs.set('title', String(options.title));
  }
  if (options?.subtitle) {
    qs.set('subtitle', String(options.subtitle));
  }
  const data = await dashboardGeoGet(`/api/geo/geocode?${qs.toString()}`);
  return {
    lat: data.lat,
    lng: data.lng,
    formattedAddress: data.formattedAddress,
    placeId: data.placeId || id,
    title: data.title || options?.title || null,
    subtitle: data.subtitle || options?.subtitle || null,
    geocodeSource: data.geocodeSource || null,
  };
}

module.exports = {
  readDashboardUrl,
  geocodeAddress,
  geocodeAddressMultiple,
  reverseGeocode,
  autocompleteAddressSalta,
  getPlaceDetails,
};
