/**
 * Capa de compatibilidad para @maplibre/maplibre-react-native v11.
 * El código de la app usa la API v10 (MapView, MarkerView, PointAnnotation, ShapeSource, LineLayer…).
 * Este módulo adapta todos esos nombres a la nueva API v11 sin tocar el resto del código.
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import {
  Map,
  Camera,
  UserLocation,
  Marker,
  GeoJSONSource,
  Layer,
  LocationManager,
  LogManager,
  NetworkManager,
  OfflineManager,
} from '@maplibre/maplibre-react-native';
import { mapLegacyMarkerAnchor, mapLegacyMarkerOffset } from './mapLegacyMarkerAnchor';

/* ── Mapeo de props legacy del MapView ───────────────────────────────────── */
function mapLegacyMapProps(props) {
  const {
    compassEnabled,
    logoEnabled,
    attributionEnabled,
    rotateEnabled,
    pitchEnabled,
    zoomEnabled,
    scrollEnabled,
    ...rest
  } = props;

  const mapped = { ...rest };
  if (compassEnabled !== undefined) mapped.compass = compassEnabled;
  if (logoEnabled !== undefined) mapped.logo = logoEnabled;
  if (attributionEnabled !== undefined) mapped.attribution = attributionEnabled;
  if (rotateEnabled !== undefined) mapped.touchRotate = rotateEnabled;
  if (pitchEnabled !== undefined) mapped.touchPitch = pitchEnabled;
  if (zoomEnabled !== undefined) mapped.touchZoom = zoomEnabled;
  if (scrollEnabled !== undefined) mapped.dragPan = scrollEnabled;
  return mapped;
}

/* ── MapView ─────────────────────────────────────────────────────────────── */
const MapView = forwardRef(function MapView(props, ref) {
  return <Map ref={ref} {...mapLegacyMapProps(props)} />;
});
MapView.displayName = 'MLCompatMapView';

/* ── Camera ──────────────────────────────────────────────────────────────── */
/*
 * La API v10 exponía:
 *   - prop  defaultSettings  → initialViewState en v11
 *   - método setCamera({ centerCoordinate, zoomLevel, heading, pitch, animationDuration, animationMode })
 *   - método fitBounds(ne, sw, padding, duration)
 * Esta capa implementa todo sobre la v11 Camera.
 */
const CameraCompat = forwardRef(function CameraCompat(props, ref) {
  const innerRef = useRef(null);
  const { defaultSettings, initialViewState, ...rest } = props;

  /* Resolver initialViewState desde defaultSettings legacy */
  const resolvedInitialViewState = initialViewState ?? (() => {
    if (!defaultSettings) return undefined;
    const center = defaultSettings.centerCoordinate ?? defaultSettings.center;
    const zoom = defaultSettings.zoomLevel ?? defaultSettings.zoom;
    return {
      ...(center ? { center } : {}),
      ...(zoom !== undefined ? { zoom } : {}),
      ...(defaultSettings.bearing !== undefined ? { bearing: defaultSettings.bearing } : {}),
      ...(defaultSettings.pitch !== undefined ? { pitch: defaultSettings.pitch } : {}),
    };
  })();

  useImperativeHandle(ref, () => {
    const regionToZoom = (latitudeDelta) => {
      const latDelta = Number(latitudeDelta) || 0.02;
      const zoom = Math.log2(360 / latDelta);
      return Math.max(11, Math.min(18.5, zoom));
    };

    const api = {
    /** v10: setCamera({ centerCoordinate, zoomLevel, heading, pitch, animationDuration, animationMode }) */
    setCamera(options = {}) {
      if (!innerRef.current) return;
      const center = options.centerCoordinate ?? options.center;
      const zoom = options.zoomLevel ?? options.zoom;
      const bearing = options.heading ?? options.bearing;
      const pitch = options.pitch;
      const duration = options.animationDuration ?? options.duration ?? 0;
      const mode = options.animationMode ?? 'easeTo';

      const payload = {};
      if (center) payload.center = center;
      if (zoom !== undefined) payload.zoom = zoom;
      if (bearing !== undefined) payload.bearing = bearing;
      if (pitch !== undefined) payload.pitch = pitch;
      if (options.padding !== undefined) payload.padding = options.padding;
      if (duration > 0) payload.duration = duration;

      if (duration === 0) {
        innerRef.current.jumpTo(payload);
      } else if (mode === 'flyTo') {
        innerRef.current.flyTo(payload);
      } else {
        innerRef.current.easeTo(payload);
      }
    },

    /** react-native-maps: animateToRegion({ latitude, longitude, latitudeDelta }, duration) */
    animateToRegion(region, duration = 400) {
      if (!region) return;
      const latitude = Number(region.latitude);
      const longitude = Number(region.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      api.setCamera({
        centerCoordinate: [longitude, latitude],
        zoomLevel: regionToZoom(region.latitudeDelta),
        animationDuration: duration,
        animationMode: 'easeTo',
      });
    },

    /** v10: fitBounds(ne:[lng,lat], sw:[lng,lat], padding, duration) */
    fitBounds(ne, sw, paddingInput, duration = 0) {
      if (!innerRef.current) return;
      const west = sw[0];
      const south = sw[1];
      const east = ne[0];
      const north = ne[1];

      let padding;
      if (typeof paddingInput === 'number') {
        padding = { top: paddingInput, right: paddingInput, bottom: paddingInput, left: paddingInput };
      } else if (Array.isArray(paddingInput)) {
        padding = {
          top: paddingInput[0] ?? 0,
          right: paddingInput[1] ?? 0,
          bottom: paddingInput[2] ?? 0,
          left: paddingInput[3] ?? 0,
        };
      } else {
        padding = paddingInput;
      }

      innerRef.current.fitBounds([west, south, east, north], {
        padding,
        duration,
        easing: duration > 0 ? 'ease' : undefined,
      });
    },

    /* v11 direct API pass-through */
    jumpTo: (...args) => innerRef.current?.jumpTo?.(...args),
    easeTo: (...args) => innerRef.current?.easeTo?.(...args),
    flyTo: (...args) => innerRef.current?.flyTo?.(...args),
    zoomTo: (...args) => innerRef.current?.zoomTo?.(...args),
    setStop: (...args) => innerRef.current?.setStop?.(...args),
    };

    return api;
  });

  return (
    <Camera
      ref={innerRef}
      initialViewState={resolvedInitialViewState}
      {...rest}
    />
  );
});
CameraCompat.displayName = 'MLCompatCamera';

/* ── MarkerView (v10) → Marker (v11) ────────────────────────────────────── */
/*
 * v10: coordinate={[lng, lat]}, anchor={{ x: 0.5, y: 0.5 }}
 * v11: lngLat={[lng, lat]}, anchor="center"
 */
const MarkerView = forwardRef(function MarkerView({
  coordinate,
  lngLat,
  anchor,
  offset,
  ...props
}, ref) {
  const resolvedLngLat = lngLat ?? coordinate;
  return (
    <Marker
      ref={ref}
      lngLat={resolvedLngLat}
      anchor={mapLegacyMarkerAnchor(anchor)}
      {...(mapLegacyMarkerOffset(offset) ? { offset: mapLegacyMarkerOffset(offset) } : {})}
      {...props}
    />
  );
});
MarkerView.displayName = 'MLCompatMarkerView';

/* ── PointAnnotation (v10) → Marker (v11) ───────────────────────────────── */
const PointAnnotation = forwardRef(function PointAnnotation({
  coordinate,
  lngLat,
  anchor,
  offset,
  ...props
}, ref) {
  const resolvedLngLat = lngLat ?? coordinate;
  return (
    <Marker
      ref={ref}
      lngLat={resolvedLngLat}
      anchor={mapLegacyMarkerAnchor(anchor)}
      {...(mapLegacyMarkerOffset(offset) ? { offset: mapLegacyMarkerOffset(offset) } : {})}
      {...props}
    />
  );
});
PointAnnotation.displayName = 'MLCompatPointAnnotation';

/* ── ShapeSource (v10) → GeoJSONSource (v11) ────────────────────────────── */
/*
 * v10: shape={geoJSONObject}
 * v11: data={geoJSONObject}
 */
const ShapeSource = forwardRef(function ShapeSource({ shape, data, ...props }, ref) {
  return <GeoJSONSource ref={ref} data={data ?? shape} {...props} />;
});
ShapeSource.displayName = 'MLCompatShapeSource';

/* ── LineLayer (v10) → Layer type="line" (v11) ──────────────────────────── */
/*
 * v10: style={{ lineColor, lineWidth, ... }}, belowLayerID="..."
 * v11: style/paint/layout aún funciona (deprecated pero presente), beforeId="..."
 */
function LineLayer({ belowLayerID, beforeId, style, ...props }) {
  return (
    <Layer
      type="line"
      beforeId={beforeId ?? belowLayerID}
      style={style}
      {...props}
    />
  );
}

/* ── UserLocation ────────────────────────────────────────────────────────── */
/* v10 tenía prop `visible`; v11 no la tiene — simplemente no renderizar si visible=false */
function UserLocationCompat({ visible = true, ...props }) {
  if (visible === false) return null;
  return <UserLocation {...props} />;
}

/* ── Namespace completo (API v10-compatible) ─────────────────────────────── */
const MapLibreGL = {
  /* Componentes principales */
  MapView,
  Map,
  Camera: CameraCompat,
  UserLocation: UserLocationCompat,

  /* Marcadores */
  MarkerView,
  PointAnnotation,
  Marker,

  /* Fuentes y capas */
  ShapeSource,
  GeoJSONSource,
  LineLayer,
  Layer,

  /* Módulos */
  LocationManager,
  LogManager,
  NetworkManager,
  OfflineManager,
};

export default MapLibreGL;

export { mapLegacyMarkerAnchor, mapLegacyMarkerOffset } from './mapLegacyMarkerAnchor';
