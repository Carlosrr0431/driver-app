/**
 * Tamaño del isotipo en el adaptive icon (canvas 1024×1024).
 * Android recorta en squircle; la zona segura es ~66% del centro.
 * Referencia visual: PedidosYa (~28–32% del canvas, mucho margen blanco).
 *
 * FCM Android usa @mipmap/ic_launcher (mismo adaptive-icon.png generado con estos valores).
 */
const LAUNCHER_CANVAS = 1024;
const ADAPTIVE_ISOTIPO_WIDTH = 300;
const ICON_ISOTIPO_WIDTH = 200;

module.exports = {
  LAUNCHER_CANVAS,
  ADAPTIVE_ISOTIPO_WIDTH,
  ICON_ISOTIPO_WIDTH,
};
