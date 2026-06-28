/**
 * Servicios geoespaciales del chofer: OSRM (rutas) + Nominatim (direcciones).
 * El mapa base usa MapLibre + tiles Carto/OSM (ver mapProvider.js).
 */

export const OSRM_BASE_URL = (
  process.env.EXPO_PUBLIC_OSRM_URL
  || 'https://profesional-osrm-production.up.railway.app'
).replace(/\/$/, '');

export const NOMINATIM_BASE_URL = (
  process.env.EXPO_PUBLIC_NOMINATIM_URL
  || 'https://profesional-nominatim-production.up.railway.app'
).replace(/\/$/, '');

export const NOMINATIM_USER_AGENT =
  process.env.EXPO_PUBLIC_NOMINATIM_USER_AGENT
  || 'ProfesionalConductorDriverApp/1.0';

export const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL
  || 'https://profesional-dashboard.vercel.app';
