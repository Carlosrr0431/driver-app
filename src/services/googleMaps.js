const GOOGLE_MAPS_API_KEY = 'AIzaSyAkXsxRZfAehqO8EPxFN24nSJRPDHqh2jg';

const DIRECTIONS_BASE_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const GEOCODE_BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const AUTOCOMPLETE_BASE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const PLACE_DETAILS_BASE_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

// Salta Capital center and bounds
const SALTA_CENTER = { lat: -24.7829, lng: -65.4122 };
const SALTA_RADIUS = 12000; // 12km radius covering the city

export const getDirections = async (origin, destination) => {
  try {
    const originStr = `${origin.lat},${origin.lng}`;
    const destStr = `${destination.lat},${destination.lng}`;

    const response = await fetch(
      `${DIRECTIONS_BASE_URL}?origin=${originStr}&destination=${destStr}&key=${GOOGLE_MAPS_API_KEY}&language=es`
    );
    const data = await response.json();

    if (data.status !== 'OK' || !data.routes.length) {
      throw new Error('No se pudo obtener la ruta');
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    return {
      distance: leg.distance.text,
      duration: leg.duration.text,
      distanceValue: leg.distance.value,
      durationValue: leg.duration.value,
      polyline: route.overview_polyline.points,
      steps: leg.steps,
    };
  } catch (error) {
    console.error('Error obteniendo direcciones:', error);
    throw error;
  }
};

export const geocodeAddress = async (address) => {
  try {
    const response = await fetch(
      `${GEOCODE_BASE_URL}?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}&language=es`
    );
    const data = await response.json();

    if (data.status !== 'OK' || !data.results.length) {
      throw new Error('No se encontró la dirección');
    }

    const location = data.results[0].geometry.location;

    return {
      lat: location.lat,
      lng: location.lng,
      formattedAddress: data.results[0].formatted_address,
    };
  } catch (error) {
    console.error('Error geocodificando:', error);
    throw error;
  }
};

/**
 * Geocode returning ALL results (up to limit) for disambiguation
 */
export const geocodeAddressMultiple = async (address, limit = 5) => {
  try {
    const response = await fetch(
      `${GEOCODE_BASE_URL}?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}&language=es&region=ar`
    );
    const data = await response.json();

    if (data.status !== 'OK' || !data.results.length) {
      throw new Error('No se encontró la dirección');
    }

    return data.results.slice(0, limit).map((r) => ({
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: r.formatted_address,
    }));
  } catch (error) {
    console.error('Error geocodificando múltiple:', error);
    throw error;
  }
};

export const reverseGeocode = async (lat, lng) => {
  try {
    const response = await fetch(
      `${GEOCODE_BASE_URL}?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}&language=es`
    );
    const data = await response.json();

    if (data.status !== 'OK' || !data.results.length) {
      throw new Error('No se pudo obtener la dirección');
    }

    return data.results[0].formatted_address;
  } catch (error) {
    console.error('Error en geocodificación inversa:', error);
    throw error;
  }
};

/**
 * Search using Google Places Autocomplete API (same as Google Maps search bar)
 * Returns predictions constrained to Salta Capital — addresses AND establishments
 * Returns instantly WITHOUT resolving lat/lng (use getPlaceDetails for that on selection)
 */
export const autocompleteAddressSalta = async (query, limit = 5) => {
  try {
    const params = new URLSearchParams({
      input: query,
      key: GOOGLE_MAPS_API_KEY,
      language: 'es',
      components: 'country:ar',
      location: `${SALTA_CENTER.lat},${SALTA_CENTER.lng}`,
      radius: String(SALTA_RADIUS),
      strictbounds: 'true',
    });

    const response = await fetch(`${AUTOCOMPLETE_BASE_URL}?${params}`);
    const data = await response.json();

    if (data.status !== 'OK' || !data.predictions?.length) {
      return [];
    }

    return data.predictions.slice(0, limit).map((pred) => ({
      address: pred.description,
      placeId: pred.place_id,
    }));
  } catch (error) {
    console.error('Error en autocomplete:', error);
    return [];
  }
};

/**
 * Get place details (lat/lng) from a place_id
 */
export const getPlaceDetails = async (placeId) => {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'geometry',
    key: GOOGLE_MAPS_API_KEY,
  });

  const response = await fetch(`${PLACE_DETAILS_BASE_URL}?${params}`);
  const data = await response.json();

  if (data.status !== 'OK' || !data.result?.geometry?.location) {
    throw new Error('No se pudo obtener detalles del lugar');
  }

  return {
    lat: data.result.geometry.location.lat,
    lng: data.result.geometry.location.lng,
  };
};

export const decodePolyline = (encoded) => {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return points;
};
