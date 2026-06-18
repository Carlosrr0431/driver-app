/**
 * mapHelpers.test.js — Tests de las funciones de cálculo geográfico.
 * Son funciones puras, no requieren mocks.
 * Coordenadas de referencia: Salta Capital.
 */

import {
  calculateDistance,
  getRegionForCoordinates,
  getBearing,
} from '../../src/utils/mapHelpers';

// Coordenadas conocidas de Salta para tests
const PLAZA_9_DE_JULIO  = { latitude: -24.7883, longitude: -65.4106 };
const TERMINAL_OMNIBUS  = { latitude: -24.7980, longitude: -65.4114 };
// Distancia real entre plaza y terminal: ~1.1 km aprox.

describe('calculateDistance', () => {
  it('retorna 0 para el mismo punto', () => {
    const dist = calculateDistance(
      PLAZA_9_DE_JULIO.latitude, PLAZA_9_DE_JULIO.longitude,
      PLAZA_9_DE_JULIO.latitude, PLAZA_9_DE_JULIO.longitude,
    );
    expect(dist).toBe(0);
  });

  it('calcula distancia entre plaza y terminal (~1 km)', () => {
    const dist = calculateDistance(
      PLAZA_9_DE_JULIO.latitude, PLAZA_9_DE_JULIO.longitude,
      TERMINAL_OMNIBUS.latitude, TERMINAL_OMNIBUS.longitude,
    );
    // Tolerancia de ±0.3 km
    expect(dist).toBeGreaterThan(0.8);
    expect(dist).toBeLessThan(1.4);
  });

  it('retorna un número positivo para dos puntos distintos', () => {
    const dist = calculateDistance(-24.79, -65.41, -24.80, -65.42);
    expect(dist).toBeGreaterThan(0);
  });
});

describe('getRegionForCoordinates', () => {
  it('retorna región por defecto para array vacío', () => {
    const region = getRegionForCoordinates([]);
    expect(region).toHaveProperty('latitude');
    expect(region).toHaveProperty('longitude');
    expect(region).toHaveProperty('latitudeDelta');
    expect(region).toHaveProperty('longitudeDelta');
  });

  it('retorna región por defecto para null', () => {
    const region = getRegionForCoordinates(null);
    expect(region.latitudeDelta).toBeGreaterThan(0);
  });

  it('centra la región en el punto único dado', () => {
    const region = getRegionForCoordinates([PLAZA_9_DE_JULIO]);
    expect(region.latitude).toBeCloseTo(PLAZA_9_DE_JULIO.latitude, 4);
    expect(region.longitude).toBeCloseTo(PLAZA_9_DE_JULIO.longitude, 4);
  });

  it('calcula el centro correcto para dos puntos', () => {
    const region = getRegionForCoordinates([PLAZA_9_DE_JULIO, TERMINAL_OMNIBUS]);
    const expectedLat = (PLAZA_9_DE_JULIO.latitude + TERMINAL_OMNIBUS.latitude) / 2;
    const expectedLng = (PLAZA_9_DE_JULIO.longitude + TERMINAL_OMNIBUS.longitude) / 2;
    expect(region.latitude).toBeCloseTo(expectedLat, 3);
    expect(region.longitude).toBeCloseTo(expectedLng, 3);
  });

  it('garantiza deltas mínimos de 0.01', () => {
    // Dos puntos muy cercanos no deben producir un delta de 0
    const p1 = { latitude: -24.7883, longitude: -65.4106 };
    const p2 = { latitude: -24.7884, longitude: -65.4107 };
    const region = getRegionForCoordinates([p1, p2]);
    expect(region.latitudeDelta).toBeGreaterThanOrEqual(0.01);
    expect(region.longitudeDelta).toBeGreaterThanOrEqual(0.01);
  });
});

describe('getBearing', () => {
  it('retorna un número entre 0 y 360', () => {
    const bearing = getBearing(
      PLAZA_9_DE_JULIO.latitude, PLAZA_9_DE_JULIO.longitude,
      TERMINAL_OMNIBUS.latitude, TERMINAL_OMNIBUS.longitude,
    );
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });

  it('un punto al norte tiene bearing cercano a 0°', () => {
    // Desde -24.79 hacia -24.70 (norte) en el mismo meridiano
    const bearing = getBearing(-24.79, -65.41, -24.70, -65.41);
    expect(bearing).toBeCloseTo(0, 0); // tolerancia de ±1°
  });

  it('un punto al este tiene bearing cercano a 90°', () => {
    // Desde -24.79, -65.41 hacia -24.79, -65.30 (este)
    const bearing = getBearing(-24.79, -65.41, -24.79, -65.30);
    expect(bearing).toBeCloseTo(90, 0);
  });
});
