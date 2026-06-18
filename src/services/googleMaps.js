/**
 * Barrel de compatibilidad — geocodificación Nominatim, rutas OSRM y navegación in-app.
 * @deprecated Importar desde ./routing, ./nominatim, ./navigation o ../utils/polyline.
 */
export { getDirections } from './routing';
export {
  geocodeAddress,
  geocodeAddressMultiple,
  reverseGeocode,
  autocompleteAddressSalta,
  getPlaceDetails,
} from './nominatim';
export { decodePolyline } from '../utils/polyline';
export {
  stripHtmlInstruction,
  getDistanceMeters,
  getDistanceToPolylineMeters,
  evaluateRerouteState,
  projectPointOntoPolyline,
  createInitialNavigationProgressState,
  computeNavigationSnapshot,
  getRouteRemainingMeters,
  getCurrentNavigationStep,
} from './navigation';
