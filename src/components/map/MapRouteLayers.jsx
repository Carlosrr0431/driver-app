/**
 * Polilíneas de ruta OSRM con MapLibre Native (ShapeSource + LineLayer).
 * En navegación: tramos de mano única más gruesos que doble mano.
 */
import React, { useMemo } from 'react';
import MapLibreGL from '../../lib/maplibre';
import { normalizeCoords } from '../../utils/mapCoords';
import { buildRemainingRouteSegments } from '../../utils/routeOneway';

const DEFAULT_ROUTE_BLUE = '#4285F4';
const DEFAULT_ROUTE_CASING = '#FFFFFF';

const NAV_WIDTH_ONEWAY = { casing: 22, line: 16 };
const NAV_WIDTH_TWOWAY = { casing: 14, line: 10 };

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
      geometry: {
        type: 'LineString',
        coordinates,
      },
    };
  }, [coords]);

  const navCasingWidth = casingWidth ?? [
    'case',
    ['==', ['get', 'oneway'], 1],
    NAV_WIDTH_ONEWAY.casing,
    NAV_WIDTH_TWOWAY.casing,
  ];

  const navLineWidth = lineWidth ?? [
    'case',
    ['==', ['get', 'oneway'], 1],
    NAV_WIDTH_ONEWAY.line,
    NAV_WIDTH_TWOWAY.line,
  ];

  if (navigationMode && segmentCollection) {
    return (
      <MapLibreGL.ShapeSource id={sourceId} shape={segmentCollection}>
        <MapLibreGL.LineLayer
          id={casingLayerId}
          style={{
            lineColor: casingColor,
            lineWidth: navCasingWidth,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: 0.95,
          }}
          belowLayerID={lineLayerId}
        />
        <MapLibreGL.LineLayer
          id={lineLayerId}
          style={{
            lineColor: lineColor,
            lineWidth: navLineWidth,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: 0.94,
          }}
        />
      </MapLibreGL.ShapeSource>
    );
  }

  if (!singleLineGeoJSON) return null;

  const resolvedCasingWidth = casingWidth ?? (navigationMode ? NAV_WIDTH_TWOWAY.casing : 9);
  const resolvedLineWidth = lineWidth ?? (navigationMode ? NAV_WIDTH_TWOWAY.line : 5);

  return (
    <MapLibreGL.ShapeSource id={sourceId} shape={singleLineGeoJSON}>
      <MapLibreGL.LineLayer
        id={casingLayerId}
        style={{
          lineColor: casingColor,
          lineWidth: resolvedCasingWidth,
          lineCap: 'round',
          lineJoin: 'round',
          lineOpacity: 0.95,
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
          lineOpacity: 0.92,
        }}
      />
    </MapLibreGL.ShapeSource>
  );
}
