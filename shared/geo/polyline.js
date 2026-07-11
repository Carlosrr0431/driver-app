/**
 * Codifica/decodifica polylines (formato Google/OSRM/TomTom).
 */

function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const str = String(encoded || '');

  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += deltaLng;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
      lat: lat / 1e5,
      lng: lng / 1e5,
    });
  }

  return points;
}

function encodeSigned(value) {
  let signed = value < 0 ? ~(value << 1) : (value << 1);
  let output = '';
  while (signed >= 0x20) {
    output += String.fromCharCode((0x20 | (signed & 0x1f)) + 63);
    signed >>= 5;
  }
  output += String.fromCharCode(signed + 63);
  return output;
}

function encodePolyline(points = []) {
  let lastLat = 0;
  let lastLng = 0;
  let encoded = '';

  for (const point of points) {
    const lat = Math.round(Number(point?.lat ?? point?.latitude) * 1e5);
    const lng = Math.round(Number(point?.lng ?? point?.longitude) * 1e5);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    encoded += encodeSigned(lat - lastLat);
    encoded += encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }

  return encoded;
}

module.exports = { decodePolyline, encodePolyline };
