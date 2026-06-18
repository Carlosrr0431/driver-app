/**
 * formatters.test.js — Tests de las funciones utilitarias de formateo.
 * Son funciones puras, no requieren mocks.
 */

import {
  formatPrice,
  formatDistance,
  formatDuration,
  formatTimerMMSS,
  formatSpeed,
} from '../../src/utils/formatters';

describe('formatPrice', () => {
  it('formatea precio con decimales en español AR', () => {
    expect(formatPrice(500)).toBe('$500,00');
  });
  it('retorna $0.00 para null', () => {
    expect(formatPrice(null)).toBe('$0.00');
  });
  it('retorna $0.00 para undefined', () => {
    expect(formatPrice(undefined)).toBe('$0.00');
  });
  it('formatea con separador de miles', () => {
    expect(formatPrice(1500.5)).toBe('$1.500,50');
  });
});

describe('formatDistance', () => {
  it('muestra metros cuando es menos de 1 km', () => {
    expect(formatDistance(0.5)).toBe('500 m');
  });
  it('muestra kilómetros con un decimal', () => {
    expect(formatDistance(3.2)).toBe('3.2 km');
  });
  it('retorna 0 km para null', () => {
    expect(formatDistance(null)).toBe('0 km');
  });
  it('redondea metros correctamente', () => {
    expect(formatDistance(0.123)).toBe('123 m');
  });
});

describe('formatDuration', () => {
  it('muestra minutos cuando es menos de 1 hora', () => {
    expect(formatDuration(45)).toBe('45 min');
  });
  it('muestra horas y minutos cuando es 1h o más', () => {
    expect(formatDuration(90)).toBe('1h 30min');
  });
  it('retorna 0 min para null', () => {
    expect(formatDuration(null)).toBe('0 min');
  });
  it('redondea los minutos', () => {
    expect(formatDuration(60)).toBe('1h 0min');
  });
});

describe('formatTimerMMSS', () => {
  it('formatea 0 como 00:00', () => {
    expect(formatTimerMMSS(0)).toBe('00:00');
  });
  it('formatea 90 segundos como 01:30', () => {
    expect(formatTimerMMSS(90)).toBe('01:30');
  });
  it('formatea 3661 segundos como 61:01', () => {
    expect(formatTimerMMSS(3661)).toBe('61:01');
  });
});

describe('formatSpeed', () => {
  it('convierte m/s a km/h', () => {
    // 10 m/s * 3.6 = 36 km/h
    expect(formatSpeed(10)).toBe('36 km/h');
  });
  it('retorna 0 km/h para null', () => {
    expect(formatSpeed(null)).toBe('0 km/h');
  });
  it('retorna 0 km/h para velocidades negativas', () => {
    expect(formatSpeed(-1)).toBe('0 km/h');
  });
});
