/**
 * Estilo de mapa inline para MapLibre Native.
 * Base raster Carto Voyager + flechas de sentido único (OpenFreeMap / OSM).
 */

const { buildHybridMapStyle } = require('../../shared/geo/hybridMapStyle');

/** Zoom máximo: 18 alcanza calle con buena definición en ciudad sin tiles extra. */
export const MAP_MAX_ZOOM = 18;

/** Flechas de contramano visibles desde zoom ~15 (navegación usa 17+). */
export const MAPLIBRE_STYLE = buildHybridMapStyle({ maxZoom: MAP_MAX_ZOOM, emphasizeOneway: true });
