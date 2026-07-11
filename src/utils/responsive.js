/**
 * Métricas responsive para driver-app.
 * Base: 360×800 (tamaño lógico más frecuente en devices.csv de Play Console).
 * Cubre phones chicos (~320), estándar (~360), landscape y tablets (≥600).
 */

export const BASE_WIDTH = 360;
export const BASE_HEIGHT = 800;

/** Ancho lógico a partir del cual se trata como tablet. */
export const TABLET_MIN_SHORT_SIDE = 600;

/** Escala mínima/máxima para no romper touch targets ni tipografía. */
export const SCALE_MIN = 0.82;
export const SCALE_MAX_PHONE = 1.12;
export const SCALE_MAX_TABLET = 1.28;

/** Ancho máximo del contenido en tablets / landscape ancho. */
export const CONTENT_MAX_WIDTH = 560;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {number} width
 * @param {number} height
 */
export function createResponsiveMetrics(width, height) {
  const w = Number(width) || BASE_WIDTH;
  const h = Number(height) || BASE_HEIGHT;
  const shortSide = Math.min(w, h);
  const longSide = Math.max(w, h);
  const isLandscape = w > h;
  const isTablet = shortSide >= TABLET_MIN_SHORT_SIDE;
  const isCompactHeight = h < 640 || (isLandscape && h < 420);

  const rawScale = shortSide / BASE_WIDTH;
  const scale = clamp(
    rawScale,
    SCALE_MIN,
    isTablet ? SCALE_MAX_TABLET : SCALE_MAX_PHONE,
  );

  const rawVertical = longSide / BASE_HEIGHT;
  const verticalScale = clamp(
    rawVertical,
    SCALE_MIN,
    isTablet ? SCALE_MAX_TABLET : SCALE_MAX_PHONE,
  );

  /** Escala horizontal (botones, padding, anchos). */
  const s = (size, options = {}) => {
    const n = Number(size) || 0;
    const factor = options.factor ?? 1;
    const scaled = n + (scale - 1) * n * factor;
    const min = options.min ?? (n > 0 ? Math.min(n, 1) : undefined);
    const max = options.max;
    let out = Math.round(scaled * 10) / 10;
    if (min != null) out = Math.max(min, out);
    if (max != null) out = Math.min(max, out);
    return out;
  };

  /** Escala vertical (alturas de paneles, spacers). */
  const vs = (size, options = {}) => {
    const n = Number(size) || 0;
    const factor = options.factor ?? 1;
    const scaled = n + (verticalScale - 1) * n * factor;
    const min = options.min ?? (n > 0 ? Math.min(n, 1) : undefined);
    const max = options.max;
    let out = Math.round(scaled * 10) / 10;
    if (min != null) out = Math.max(min, out);
    if (max != null) out = Math.min(max, out);
    return out;
  };

  /** Escala moderada (tipografía / iconos): menos agresiva. */
  const ms = (size, factor = 0.45) => s(size, { factor });

  /** Font size con piso legible. */
  const fs = (size) => Math.max(10, ms(size));

  const contentWidth = isTablet || (isLandscape && w >= 700)
    ? Math.min(w, CONTENT_MAX_WIDTH)
    : w;

  const screenPadding = s(20, { min: 12, max: isTablet ? 32 : 24 });

  return {
    width: w,
    height: h,
    shortSide,
    longSide,
    isLandscape,
    isTablet,
    isCompactHeight,
    scale,
    verticalScale,
    s,
    vs,
    ms,
    fs,
    contentWidth,
    contentMaxWidth: CONTENT_MAX_WIDTH,
    screenPadding,
    /** Fracción útil de altura para bottom sheets / modales. */
    sheetMaxHeight: Math.round(h * (isLandscape ? 0.92 : 0.88)),
    sheetMinHeight: Math.round(h * (isCompactHeight ? 0.42 : 0.32)),
  };
}

/** Métricas estáticas iniciales (útil fuera de React; se actualizan vía provider). */
let cachedMetrics = createResponsiveMetrics(BASE_WIDTH, BASE_HEIGHT);

export function getResponsiveMetrics() {
  return cachedMetrics;
}

export function setResponsiveMetrics(width, height) {
  cachedMetrics = createResponsiveMetrics(width, height);
  return cachedMetrics;
}

/** Atajos estáticos (se refrescan cuando el provider actualiza métricas). */
export const s = (size, options) => getResponsiveMetrics().s(size, options);
export const vs = (size, options) => getResponsiveMetrics().vs(size, options);
export const ms = (size, factor) => getResponsiveMetrics().ms(size, factor);
export const fs = (size) => getResponsiveMetrics().fs(size);
