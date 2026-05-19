import { evaluateRerouteState } from '../../src/services/googleMaps';

describe('evaluateRerouteState', () => {
  it('no dispara reroute por un unico pico de jitter', () => {
    const result = evaluateRerouteState({
      deviationMeters: 62,
      speedMps: 0.8,
      accuracyMeters: 5,
      now: 1_000,
      state: {},
    });

    expect(result.shouldReroute).toBe(false);
    expect(result.state.offRouteSamples).toBe(1);
  });

  it('dispara reroute cuando el desvio persiste en el tiempo', () => {
    const first = evaluateRerouteState({
      deviationMeters: 58,
      speedMps: 6,
      accuracyMeters: 8,
      now: 0,
      state: {},
    });

    const second = evaluateRerouteState({
      deviationMeters: 60,
      speedMps: 6,
      accuracyMeters: 8,
      now: first.thresholds.persistMs + 250,
      state: first.state,
    });

    expect(second.shouldReroute).toBe(true);
    expect(second.rerouteReason).toBe('deviation_persistent');
  });

  it('aumenta tolerancia cuando la precision gps es mala', () => {
    const withGoodAccuracy = evaluateRerouteState({
      deviationMeters: 0,
      speedMps: 3,
      accuracyMeters: 5,
      now: 0,
      state: {},
    });

    const withPoorAccuracy = evaluateRerouteState({
      deviationMeters: 0,
      speedMps: 3,
      accuracyMeters: 28,
      now: 0,
      state: {},
    });

    expect(withPoorAccuracy.thresholds.enterThreshold)
      .toBeGreaterThan(withGoodAccuracy.thresholds.enterThreshold);
  });

  it('aprieta umbral y tiempos cerca de la siguiente maniobra', () => {
    const normal = evaluateRerouteState({
      deviationMeters: 0,
      speedMps: 5,
      accuracyMeters: 8,
      distanceToNextStepMeters: 600,
      now: 0,
      state: {},
    });

    const nearManeuver = evaluateRerouteState({
      deviationMeters: 0,
      speedMps: 5,
      accuracyMeters: 8,
      distanceToNextStepMeters: 80,
      now: 0,
      state: {},
    });

    expect(nearManeuver.thresholds.enterThreshold)
      .toBeLessThan(normal.thresholds.enterThreshold);
    expect(nearManeuver.thresholds.persistMs)
      .toBeLessThan(normal.thresholds.persistMs);
    expect(nearManeuver.thresholds.cooldownMs)
      .toBeLessThan(normal.thresholds.cooldownMs);
  });

  it('dispara rapido ante desvio severo en crecimiento', () => {
    const first = evaluateRerouteState({
      deviationMeters: 65,
      speedMps: 10,
      accuracyMeters: 8,
      now: 0,
      state: {},
    });

    const second = evaluateRerouteState({
      deviationMeters: 95,
      speedMps: 10,
      accuracyMeters: 8,
      now: 300,
      state: first.state,
    });

    expect(second.shouldReroute).toBe(true);
    expect(second.rerouteReason).toBe('deviation_severe');
  });
});
