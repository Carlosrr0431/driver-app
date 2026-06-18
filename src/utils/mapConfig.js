/**
 * Estilo de mapa basado en OpenStreetMap vía MapLibre.
 * OpenFreeMap sirve tiles vectoriales OSM sin API key.
 * @see https://maplibre.org/projects/gl-js/
 * @see https://www.openstreetmap.org/
 */
export const MAP_STYLE_URL =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL
  || 'https://tiles.openfreemap.org/styles/liberty';

/** Servidor OSRM para cálculo de rutas (perfil driving). Producción: Railway. */
export const OSRM_BASE_URL =
  process.env.EXPO_PUBLIC_OSRM_URL
  || 'https://profesional-osrm-production.up.railway.app';

/** API de geocodificación Nominatim. Producción: Railway. */
export const NOMINATIM_BASE_URL =
  process.env.EXPO_PUBLIC_NOMINATIM_URL
  || 'https://profesional-nominatim-production.up.railway.app';

/** User-Agent exigido por la política de uso de Nominatim. */
export const NOMINATIM_USER_AGENT =
  process.env.EXPO_PUBLIC_NOMINATIM_USER_AGENT
  || 'ProfesionalConductorDriverApp/1.0';

/**
 * Servidor Nominatim propio (Railway): sin throttle de uso público.
 * Desactivar con EXPO_PUBLIC_NOMINATIM_SELF_HOSTED=false (p. ej. Nominatim público).
 */
export const NOMINATIM_SELF_HOSTED =
  process.env.EXPO_PUBLIC_NOMINATIM_SELF_HOSTED !== 'false';
