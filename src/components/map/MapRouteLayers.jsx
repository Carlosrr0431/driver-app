/**
 * Polilíneas de ruta OSRM con MapLibre Native (ShapeSource + LineLayer).
 * Estilo moderno Uber/DiDi: línea principal azul vivo, sombra exterior oscura,
 * borde blanco interior para profundidad. En mano única: más gruesa.
 */
import React, { useMemo } from 'react';
import MapLibreGL from '../../lib/maplibre';
import { normalizeCoords } from '../../utils/mapCoords';
import { buildRemainingRouteSegments } from '../../utils/routeOneway';

/** Azul Uber/DiDi — más vivo que el Google Maps original */
const DEFAULT_ROUTE_BLUE = '#1C6EF2';
/** Sombra exterior oscura para profundidad (capa más baja) */
const ROUTE_SHADOW = '#0A2E7A';
/** Borde blanco fino entre sombra y línea principal */
const DEFAULT_ROUTE_CASING = '#FFFFFF';

// Capas: sombra → casing blanco → línea principal
const NAV_WIDTH_ONEWAY = { shadow: 30, casing: 24, line: 17 };
const NAV_WIDTH_TWOWAY = { shadow: 20, casing: 15, line: 10 };

function coordsToLineString(coords) {
  return normalizeCoords(coords).map((point) => [point.longitude, point.latitude]);
}

function buildSegmentCollection(segments) {
  const features = segments
    .filter((segment) => Array.isArray(segment.coords) && segment.coords.length >= 2)
    .map((segment, index) => ({
      type: 'Feature',
      properties: { oneway: segment.oneway ? 1 : 0, index },
      geometry: {
        type: 'LineString',
        coordinates: coordsToLineString(segment.coords),
      },
    }));

  if (features.length === 0) return null;

  return { type: 'FeatureCollection', features };
}

export function MapRouteLayers({
  coords = [],
  routeSteps = [],
  navigationMode = false,
  layerIdPrefix = 'osrm-route',
  lineColor = DEFAULT_ROUTE_BLUE,
  casingColor = DEFAULT_ROUTE_CASING,
  casingWidth,
  lineWidth,
}) {
  const sourceId = `${layerIdPrefix}-source`;
  const shadowLayerId = `${layerIdPrefix}-shadow`;
  const casingLayerId = `${layerIdPrefix}-casing`;
  const lineLayerId = `${layerIdPrefix}-line`;

  const segmentCollection = useMemo(() => {
    if (!navigationMode || coords.length < 2) return null;
    const segments = buildRemainingRouteSegments(routeSteps, coords);
    return buildSegmentCollection(segments);
  }, [navigationMode, routeSteps, coords]);

  const singleLineGeoJSON = useMemo(() => {
    const coordinates = coordsToLineString(coords);
    if (coordinates.length < 2) return null;
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
    };
  }, [coords]);

  // Anchos adaptativos por tipo de vía (mano única más gruesa)
  const navShadowWidth = ['case', ['==', ['get', 'oneway'], 1], NAV_WIDTH_ONEWAY.shadow, NAV_WIDTH_TWOWAY.shadow];
  const navCasingWidth = casingWidth ?? ['case', ['==', ['get', 'oneway'], 1], NAV_WIDTH_ONEWAY.casing, NAV_WIDTH_TWOWAY.casing];
  const navLineWidth   = lineWidth   ?? ['case', ['==', ['get', 'oneway'], 1], NAV_WIDTH_ONEWAY.line,   NAV_WIDTH_TWOWAY.line];

  /* ── Modo navegación activa: segmentos con sentido único ────────────────── */
  if (navigationMode && segmentCollection) {
    return (
      <MapLibreGL.ShapeSource id={sourceId} shape={segmentCollection}>
        {/* 1. Sombra exterior (profundidad) */}
        <MapLibreGL.LineLayer
          id={shadowLayerId}
          style={{
            lineColor: ROUTE_SHADOW,
            lineWidth: navShadowWidth,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: 0.28,
            lineBlur: 4,
          }}
          belowLayerID={casingLayerId}
        />
        {/* 2. Borde blanco (separación del mapa) */}
        <MapLibreGL.LineLayer
          id={casingLayerId}
          style={{
            lineColor: casingColor,
            lineWidth: navCasingWidth,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: 1,
          }}
          belowLayerID={lineLayerId}
        />
        {/* 3. Línea principal */}
        <MapLibreGL.LineLayer
          id={lineLayerId}
          style={{
            lineColor: lineColor,
            lineWidth: navLineWidth,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: 1,
          }}
        />
      </MapLibreGL.ShapeSource>
    );
  }

  /* ── Sin navegación activa: línea simple (preview / free ride) ──────────── */
  if (!singleLineGeoJSON) return null;

  const isFreeRide = layerIdPrefix !== 'osrm-route';
  const resolvedShadowWidth = isFreeRide ? 0 : 18;
  const resolvedCasingWidth = casingWidth ?? (navigationMode ? NAV_WIDTH_TWOWAY.casing : 9);
  const resolvedLineWidth   = lineWidth   ?? (navigationMode ? NAV_WIDTH_TWOWAY.line   : 5);

  return (
    <MapLibreGL.ShapeSource id={sourceId} shape={singleLineGeoJSON}>
      {/* Sombra solo en ruta normal (no en recorrido GPS libre) */}
      {!isFreeRide ? (
        <MapLibreGL.LineLayer
          id={shadowLayerId}
          style={{
            lineColor: ROUTE_SHADOW,
            lineWidth: resolvedShadowWidth,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: 0.22,
            lineBlur: 4,
          }}
          belowLayerID={casingLayerId}
        />
      ) : null}
      <MapLibreGL.LineLayer
        id={casingLayerId}
        style={{
          lineColor: casingColor,
          lineWidth: resolvedCasingWidth,
          lineCap: 'round',
          lineJoin: 'round',
          lineOpacity: isFreeRide ? 0.85 : 1,
        }}
        belowLayerID={lineLayerId}
      />
      <MapLibreGL.LineLayer
        id={lineLayerId}
        style={{
          lineColor: lineColor,
          lineWidth: resolvedLineWidth,
          lineCap: 'round',
          lineJoin: 'round',
          lineOpacity: isFreeRide ? 0.75 : 0.97,
        }}
      />
    </MapLibreGL.ShapeSource>
  );
}
