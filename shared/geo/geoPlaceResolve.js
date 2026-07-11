/**
 * Resolución de direcciones alineada con AddressAutocomplete del dashboard.
 * Usa /api/geo/geocode (google_place_details_essentials + cache Supabase).
 */
const { getPlaceDetails } = require('./dashboardGeoApi');

function firstAddressLine(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.split(',')[0]?.trim() || '';
}

function buildSelectedAddressLabel({ title, line, fallback }) {
  const t = String(title || '').trim();
  const l = String(line || '').trim();
  const f = String(fallback || '').trim();
  if (t && l) {
    if (t.toLowerCase() === l.toLowerCase()) return t;
    return `${t}, ${l}`;
  }
  return t || l || f;
}

function isCoordinateFallbackText(text) {
  return /^-?\d+\.\d{4,},\s*-?\d+\.\d{4,}$/.test(String(text || '').trim());
}

/**
 * Convierte una sugerencia de autocomplete en un lugar resuelto (coords + etiqueta).
 * @param {object} suggestion
 * @param {string} [sessionToken]
 */
async function resolvePlaceFromSuggestion(suggestion, sessionToken) {
  const baseTitle = suggestion?.title || String(suggestion?.address || '').split(',')[0];
  const baseLine = firstAddressLine(suggestion?.subtitle || suggestion?.address);
  const labelText = buildSelectedAddressLabel({
    title: baseTitle,
    line: baseLine,
    fallback: suggestion?.address || '',
  });

  const hasCoords = Number.isFinite(suggestion?.lat) && Number.isFinite(suggestion?.lng);

  if (hasCoords) {
    return {
      address: labelText,
      lat: suggestion.lat,
      lng: suggestion.lng,
      placeId: suggestion.placeId || null,
      title: suggestion.title || null,
      subtitle: suggestion.subtitle || null,
      formattedAddress: labelText,
      geocodeSource: null,
    };
  }

  if (!suggestion?.placeId) {
    return {
      address: labelText,
      lat: null,
      lng: null,
      placeId: null,
      title: suggestion?.title || null,
      subtitle: suggestion?.subtitle || null,
      formattedAddress: labelText,
      geocodeSource: null,
    };
  }

  const details = await getPlaceDetails(suggestion.placeId, {
    sessionToken: suggestion.sessionToken || sessionToken,
    formattedAddress: labelText,
    title: suggestion.title,
    subtitle: suggestion.subtitle,
  });

  const resolvedTitle = details.title || suggestion.title || null;
  const resolvedLine = firstAddressLine(
    details.formattedAddress || suggestion.subtitle || suggestion.address || '',
  );
  const selectedLabel = buildSelectedAddressLabel({
    title: resolvedTitle,
    line: resolvedLine,
    fallback: details.formattedAddress || labelText,
  });

  return {
    address: selectedLabel,
    lat: details.lat,
    lng: details.lng,
    placeId: suggestion.placeId,
    title: resolvedTitle,
    subtitle: details.subtitle || suggestion.subtitle || null,
    formattedAddress: details.formattedAddress || null,
    geocodeSource: details.geocodeSource || null,
  };
}

module.exports = {
  firstAddressLine,
  buildSelectedAddressLabel,
  isCoordinateFallbackText,
  resolvePlaceFromSuggestion,
};
