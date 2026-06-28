/**
 * Estilo híbrido MapLibre: base raster Carto + flechas de sentido único (OSM).
 * Las flechas usan tiles vectoriales OpenFreeMap / OpenMapTiles (capa transportation).
 */

/** TileJSON — resuelve la ruta versionada real (planet/{z}/{x}/{y}.pbf devuelve tiles vacíos). */
const OPENFREEMAP_PLANET = 'https://tiles.openfreemap.org/planet';
const OPENFREEMAP_SPRITE = 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm';
const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'];

function cartoTiles(style) {
  return CARTO_SUBDOMAINS.map(
    (sub) => `https://${sub}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}@2x.png`,
  );
}

/**
 * Flechas visibles solo con zoom de calle (como Google Maps).
 * z17: avenidas principales · z18+: todas las calles de sentido único.
 */
const ONEWAY_ZOOM_MAJOR = 17;
const ONEWAY_ZOOM_ALL = 18;

const MAJOR_ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];

const ONEWAY_FILTER_FORWARD = [
  'any',
  ['==', ['get', 'oneway'], 1],
  ['==', ['get', 'oneway'], true],
];

const ONEWAY_FILTER_REVERSE = ['==', ['get', 'oneway'], -1];

function buildOnewayDirectionFilter(directionFilter, roadClassFilter = null) {
  if (!roadClassFilter) {
    return ['all', directionFilter];
  }
  return ['all', directionFilter, roadClassFilter];
}

function buildOnewayLayer({ id, directionFilter, minzoom, maxzoom, roadClassFilter, iconRotate, emphasizeOneway = false }) {
  const sizeBoost = emphasizeOneway ? 0.5 : 0.2;
  const spacingScale = emphasizeOneway ? 0.75 : 0.9;
  const arrowColor = emphasizeOneway ? '#0f172a' : '#1e293b';
  const arrowOpacity = emphasizeOneway ? 1 : 0.96;

  return {
    id,
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    minzoom,
    ...(maxzoom != null ? { maxzoom } : {}),
    filter: buildOnewayDirectionFilter(directionFilter, roadClassFilter),
    layout: {
      'icon-image': 'arrow',
      'symbol-placement': 'line',
      'icon-rotate': iconRotate,
      'symbol-spacing': [
        'interpolate',
        ['linear'],
        ['zoom'],
        17,
        Math.round(220 * spacingScale),
        18,
        Math.round(150 * spacingScale),
        19,
        Math.round(110 * spacingScale),
      ],
      'icon-keep-upright': false,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        17,
        0.82 + sizeBoost,
        18,
        1.12 + sizeBoost,
        19,
        1.42 + sizeBoost,
      ],
    },
    paint: {
      'icon-color': arrowColor,
      'icon-opacity': ['interpolate', ['linear'], ['zoom'], minzoom - 0.1, 0, minzoom + 0.15, arrowOpacity],
      'icon-halo-color': '#ffffff',
      'icon-halo-width': emphasizeOneway ? 1.25 : 0.9,
      'icon-halo-blur': 0.15,
    },
  };
}

function buildOneWayLayers(emphasizeOneway = false) {
  const majorRoadsOnly = ['in', ['get', 'class'], ['literal', MAJOR_ROAD_CLASSES]];

  return [
    buildOnewayLayer({
      id: 'road_oneway_arrow_major',
      directionFilter: ONEWAY_FILTER_FORWARD,
      minzoom: ONEWAY_ZOOM_MAJOR,
      maxzoom: ONEWAY_ZOOM_ALL,
      roadClassFilter: majorRoadsOnly,
      iconRotate: 0,
      emphasizeOneway,
    }),
    buildOnewayLayer({
      id: 'road_oneway_arrow_major_opposite',
      directionFilter: ONEWAY_FILTER_REVERSE,
      minzoom: ONEWAY_ZOOM_MAJOR,
      maxzoom: ONEWAY_ZOOM_ALL,
      roadClassFilter: majorRoadsOnly,
      iconRotate: 180,
      emphasizeOneway,
    }),
    buildOnewayLayer({
      id: 'road_oneway_arrow',
      directionFilter: ONEWAY_FILTER_FORWARD,
      minzoom: ONEWAY_ZOOM_ALL,
      roadClassFilter: null,
      iconRotate: 0,
      emphasizeOneway,
    }),
    buildOnewayLayer({
      id: 'road_oneway_arrow_opposite',
      directionFilter: ONEWAY_FILTER_REVERSE,
      minzoom: ONEWAY_ZOOM_ALL,
      roadClassFilter: null,
      iconRotate: 180,
      emphasizeOneway,
    }),
  ];
}

/**
 * Carto Voyager + flechas OSM (OpenFreeMap vector).
 * @param {{ maxZoom?: number }} [options]
 */
function buildHybridMapStyle(options = {}) {
  const maxZoom = options.maxZoom ?? 18;
  const emphasizeOneway = Boolean(options.emphasizeOneway);

  return {
    version: 8,
    sprite: OPENFREEMAP_SPRITE,
    glyphs: OPENFREEMAP_GLYPHS,
    sources: {
      'carto-voyager': {
        type: 'raster',
        tiles: cartoTiles('voyager'),
        tileSize: 256,
        attribution: '© OpenStreetMap contributors © CARTO',
        maxzoom: maxZoom,
      },
      openmaptiles: {
        type: 'vector',
        url: OPENFREEMAP_PLANET,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#f4f4f0' },
      },
      {
        id: 'osm-tiles',
        type: 'raster',
        source: 'carto-voyager',
        minzoom: 0,
        maxzoom: maxZoom,
      },
      ...buildOneWayLayers(emphasizeOneway),
    ],
  };
}

module.exports = {
  buildHybridMapStyle,
  ONEWAY_ZOOM_MAJOR,
  ONEWAY_ZOOM_ALL,
  OPENFREEMAP_PLANET,
  OPENFREEMAP_SPRITE,
};
