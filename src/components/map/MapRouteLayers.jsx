/**
 * Capas de polilínea para MapLibre (borde blanco + línea azul).
 */
import React, { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { coordsToLineString } from '../../utils/mapLibreHelpers';

const ROUTE_BLUE = '#4285F4';
const ROUTE_CASING = '#FFFFFF';

export function MapRouteLayers({
  idPrefix = 'route',
  coords = [],
  navigationMode = false,
}) {
  const feature = useMemo(() => coordsToLineString(coords), [coords]);
  if (!feature) return null;

  const casingWidth = navigationMode ? 16 : 9;
  const lineWidth = navigationMode ? 11 : 5;

  return (
    <GeoJSONSource id={`${idPrefix}-source`} data={feature}>
      <Layer
        id={`${idPrefix}-casing`}
        type="line"
        style={{
          lineColor: ROUTE_CASING,
          lineWidth: casingWidth,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
      <Layer
        id={`${idPrefix}-line`}
        type="line"
        style={{
          lineColor: ROUTE_BLUE,
          lineWidth,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
    </GeoJSONSource>
  );
}
