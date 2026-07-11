import {
  BASE_WIDTH,
  CONTENT_MAX_WIDTH,
  createResponsiveMetrics,
} from '../../src/utils/responsive';

describe('responsive metrics (devices.csv coverage)', () => {
  it('usa 360 como base (tamaño lógico más frecuente)', () => {
    expect(BASE_WIDTH).toBe(360);
  });

  it('escala phones chicos (~320) sin romper touch targets', () => {
    const m = createResponsiveMetrics(320, 569);
    expect(m.isTablet).toBe(false);
    expect(m.scale).toBeGreaterThanOrEqual(0.82);
    expect(m.s(52, { min: 48 })).toBeGreaterThanOrEqual(48);
    expect(m.fs(14)).toBeGreaterThanOrEqual(10);
  });

  it('mantiene escala estable en phones estándar 360x800', () => {
    const m = createResponsiveMetrics(360, 800);
    expect(m.scale).toBeCloseTo(1, 2);
    expect(m.s(20)).toBeCloseTo(20, 0);
    expect(m.contentWidth).toBe(360);
  });

  it('detecta landscape y ajusta sheet height', () => {
    const m = createResponsiveMetrics(800, 360);
    expect(m.isLandscape).toBe(true);
    expect(m.isCompactHeight).toBe(true);
    expect(m.sheetMaxHeight).toBeGreaterThan(m.height * 0.8);
  });

  it('detecta tablets y limita ancho de contenido', () => {
    const m = createResponsiveMetrics(800, 1280);
    expect(m.isTablet).toBe(true);
    expect(m.contentWidth).toBe(CONTENT_MAX_WIDTH);
    expect(m.scale).toBeLessThanOrEqual(1.28);
  });

  it('cubre extremos del CSV sin explotar tipografía', () => {
    const tiny = createResponsiveMetrics(240, 376);
    const huge = createResponsiveMetrics(1200, 1920);
    expect(tiny.fs(16)).toBeGreaterThanOrEqual(10);
    expect(huge.s(48)).toBeLessThanOrEqual(48 * 1.28 + 1);
  });
});
