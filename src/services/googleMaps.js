const GOOGLE_MAPS_API_KEY = 'AIzaSyAkXsxRZfAehqO8EPxFN24nSJRPDHqh2jg';

const DIRECTIONS_BASE_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const GEOCODE_BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

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
