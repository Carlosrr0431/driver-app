/**

 * Georef Argentina — normalización de direcciones oficiales (calle + altura).

 * @see https://www.argentina.gob.ar/georef/normalizacion-de-direcciones

 * @see https://apis.datos.gob.ar/georef/api/direcciones

 */



const { readGeorefBaseUrl } = require('./mapConfig');

const { pickPrimaryHouseNumber } = require('../salta-address');



const GEOREF_TIMEOUT_MS = 8000;



function parseCoordinate(value) {

  if (value == null || value === '') return null;

  const num = Number(value);

  return Number.isFinite(num) ? num : null;

}



function isValidArgentinaCoordinate(lat, lng) {

  if (lat == null || lng == null) return false;

  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;

  return lat <= 0 && lat >= -60 && lng <= -50 && lng >= -75;

}



function buildGeorefPlaceId(item) {

  const lat = parseCoordinate(item?.ubicacion?.lat);

  const lng = parseCoordinate(item?.ubicacion?.lon);

  if (isValidArgentinaCoordinate(lat, lng)) {

    return `georef:${lat.toFixed(7)},${lng.toFixed(7)}`;

  }



  const nomenclatura = String(item?.nomenclatura || '').trim();

  if (nomenclatura) {

    return `georef:n:${encodeURIComponent(nomenclatura)}`;

  }



  return 'georef:unknown';

}



/**

 * Mapea una dirección Georef al formato interno usado por Nominatim.

 */

function mapGeorefDireccion(item, query = '') {

  const lat = parseCoordinate(item?.ubicacion?.lat);

  const lng = parseCoordinate(item?.ubicacion?.lon);

  if (!isValidArgentinaCoordinate(lat, lng)) return null;



  const houseNumber = item?.altura?.valor;

  const road = String(item?.calle?.nombre || '').trim();

  const nomenclatura = String(item?.nomenclatura || '').trim();



  return {

    lat,

    lng,

    formattedAddress: nomenclatura,

    placeId: buildGeorefPlaceId(item),

    importance: 1,

    osmClass: 'georef',

    osmType: 'address',

    address: {

      road,

      house_number: houseNumber != null ? String(houseNumber) : '',

      city: item?.localidad_censal?.nombre || 'Salta',

      state: item?.provincia?.nombre || 'Salta',

    },

  };

}



async function fetchGeorefDirecciones(query, { max = 3 } = {}) {

  const direccion = String(query || '').trim();

  if (!direccion || direccion.length < 3) return [];



  const baseUrl = readGeorefBaseUrl();

  const params = new URLSearchParams({

    direccion,

    provincia: 'Salta',

    departamento: 'Capital',

    localidad: 'Salta',

    max: String(Math.max(1, Math.min(max, 5))),

  });



  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

  const timeoutId = controller

    ? setTimeout(() => controller.abort(), GEOREF_TIMEOUT_MS)

    : null;



  try {

    const response = await fetch(`${baseUrl}/direcciones?${params.toString()}`, {

      headers: { Accept: 'application/json' },

      signal: controller?.signal,

    });



    if (!response.ok) return [];



    const data = await response.json();

    return Array.isArray(data?.direcciones) ? data.direcciones : [];

  } catch {

    return [];

  } finally {

    if (timeoutId) clearTimeout(timeoutId);

  }

}



/**

 * Busca direcciones con altura en Georef (Salta Capital).

 * Solo tiene sentido cuando el query incluye número de calle.

 */

async function searchGeorefAddress(query, max = 3) {

  const trimmed = String(query || '').trim();

  if (!trimmed || pickPrimaryHouseNumber(trimmed) == null) return [];



  const hits = await fetchGeorefDirecciones(trimmed, { max });

  return hits

    .map((item) => mapGeorefDireccion(item, trimmed))

    .filter(Boolean);

}



/**

 * Resuelve un placeId generado por Georef (re-consulta si hace falta).

 */

async function resolveGeorefPlaceId(placeId) {

  const id = String(placeId || '').trim();

  if (!id.startsWith('georef:')) return null;



  if (id.startsWith('georef:q:')) {

    const query = decodeURIComponent(id.slice('georef:q:'.length));

    const hits = await searchGeorefAddress(query, 1);

    return hits[0] || null;

  }



  if (id.startsWith('georef:n:')) {

    const nomenclatura = decodeURIComponent(id.slice('georef:n:'.length));

    const hits = await fetchGeorefDirecciones(nomenclatura, { max: 1 });

    return hits.map((item) => mapGeorefDireccion(item)).find(Boolean) || null;

  }



  const coordMatch = id.match(/^georef:(-?\d+\.?\d*),(-?\d+\.?\d*)$/);

  if (coordMatch) {

    const lat = parseCoordinate(coordMatch[1]);

    const lng = parseCoordinate(coordMatch[2]);

    if (lat != null && lng != null) {

      return { lat, lng, formattedAddress: `${lat}, ${lng}`, placeId: id, address: {} };

    }

  }



  return null;

}



module.exports = {

  mapGeorefDireccion,

  fetchGeorefDirecciones,

  searchGeorefAddress,

  resolveGeorefPlaceId,

};


