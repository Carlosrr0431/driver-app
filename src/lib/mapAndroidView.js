/**
 * MapLibre v11 usa GLSurfaceView por defecto en Android.
 * Esa superficie perfora el árbol de vistas: hasta que carga el estilo
 * (o si falla) tapa sheet, HUD y botones con una pantalla negra.
 * TextureView respeta el z-order de React Native.
 */
export function resolveAndroidMapView(androidView) {
  return androidView === 'surface' ? 'surface' : 'texture';
}
