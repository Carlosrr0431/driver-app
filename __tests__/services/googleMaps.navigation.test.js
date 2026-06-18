import {
  computeNavigationSnapshot,
  createInitialNavigationProgressState,
  evaluateRerouteState,
  getRouteRemainingMeters,
  projectPointOntoPolyline,
} from '../../src/services/navigation';

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

describe('projectPointOntoPolyline', () => {
  const routeCoords = [
    { latitude: -24.7829, longitude: -65.4122 },
    { latitude: -24.7839, longitude: -65.4122 },
    { latitude: -24.7849, longitude: -65.4122 },
  ];

  it('proyecta un punto sobre el segmento más cercano', () => {
    const projection = projectPointOntoPolyline(
      { latitude: -24.7834, longitude: -65.41225 },
      routeCoords,
    );

    expect(projection.deviationMeters).toBeLessThan(30);
    expect(projection.distanceAlongMeters).toBeGreaterThan(0);
    expect(projection.snappedPoint.latitude).toBeCloseTo(-24.7834, 3);
  });
});

describe('computeNavigationSnapshot', () => {
  const routeCoords = [
    { latitude: -24.7800, longitude: -65.4100 },
    { latitude: -24.7810, longitude: -65.4100 },
    { latitude: -24.7820, longitude: -65.4100 },
    { latitude: -24.7830, longitude: -65.4100 },
  ];

  const steps = [
    {
      index: 0,
      instruction: 'Continúa por Av. San Martín',
      distanceValue: 600,
      maneuver: 'straight',
      endLocation: { lat: -24.7810, lng: -65.4100 },
    },
    {
      index: 1,
      instruction: 'Gira a la derecha en Av. Belgrano',
      distanceValue: 500,
      maneuver: 'turn-right',
      endLocation: { lat: -24.7830, lng: -65.4100 },
    },
  ];

  it('mantiene progreso monótono y calcula paso actual', () => {
    const first = computeNavigationSnapshot({
      currentPoint: { latitude: -24.7802, longitude: -65.4100 },
      routeCoords,
      steps,
      progressState: createInitialNavigationProgressState(),
      routeDistanceMeters: 1100,
      routeDurationSeconds: 240,
      speedMps: 8,
    });

    const second = computeNavigationSnapshot({
      currentPoint: { latitude: -24.7798, longitude: -65.4100 },
      routeCoords,
      steps,
      progressState: first.progressState,
      routeDistanceMeters: 1100,
      routeDurationSeconds: 240,
      speedMps: 8,
    });

    expect(second.progressState.lastDistanceAlongMeters)
      .toBeGreaterThanOrEqual(first.progressState.lastDistanceAlongMeters - 14);
    expect(second.currentStep).toBeTruthy();
    expect(second.remainingDistanceMeters).toBeGreaterThan(0);
    expect(Number.isFinite(second.remainingDurationSeconds)).toBe(true);
  });

  it('avanza de rotonda a la maniobra siguiente al salir de la rotonda', () => {
    const routeCoords = [
      { latitude: -24.7800, longitude: -65.4100 },
      { latitude: -24.7810, longitude: -65.4100 },
      { latitude: -24.7820, longitude: -65.4100 },
      { latitude: -24.7830, longitude: -65.4100 },
      { latitude: -24.7840, longitude: -65.4100 },
    ];

    const roundaboutSteps = [
      {
        index: 0,
        instruction: 'Continúa por Av. San Martín',
        distanceValue: 300,
        maneuver: 'straight',
        endLocation: { lat: -24.7810, lng: -65.4100 },
      },
      {
        index: 1,
        instruction: 'En la rotonda, tomá la tercera salida',
        distanceValue: 220,
        maneuver: 'roundabout-right',
        endLocation: { lat: -24.7830, lng: -65.4100 },
      },
      {
        index: 2,
        instruction: 'Gira a la izquierda hacia Juan Gálvez',
        distanceValue: 180,
        maneuver: 'turn-left',
        endLocation: { lat: -24.7840, lng: -65.4100 },
      },
    ];

    const snapshot = computeNavigationSnapshot({
      currentPoint: { latitude: -24.7832, longitude: -65.4100 },
      routeCoords,
      steps: roundaboutSteps,
      progressState: createInitialNavigationProgressState(),
      routeDistanceMeters: 700,
      routeDurationSeconds: 180,
      speedMps: 6,
    });

    expect(snapshot.currentStep?.maneuver).toBe('turn-left');
    expect(snapshot.currentStep?.index).toBe(2);
  });

  it('avanza de rotonda cuando el conductor ya pasó la salida pero el progreso en ruta quedó atrás', () => {
    const routeCoords = [
      { latitude: -24.7800, longitude: -65.4100 },
      { latitude: -24.7810, longitude: -65.4100 },
      { latitude: -24.7820, longitude: -65.4100 },
      { latitude: -24.7830, longitude: -65.4100 },
      { latitude: -24.7840, longitude: -65.4100 },
    ];

    const steps = [
      {
        index: 0,
        instruction: 'Continúa recto',
        distanceValue: 200,
        maneuver: 'straight',
        endLocation: { lat: -24.7810, lng: -65.4100 },
      },
      {
        index: 1,
        instruction: 'En la rotonda, tomá la segunda salida',
        distanceValue: 500,
        maneuver: 'roundabout-right',
        endLocation: { lat: -24.7830, lng: -65.4100 },
      },
      {
        index: 2,
        instruction: 'Seguí por Av. Belgrano',
        distanceValue: 200,
        maneuver: 'straight',
        endLocation: { lat: -24.7840, lng: -65.4100 },
      },
    ];

    const snapshot = computeNavigationSnapshot({
      currentPoint: { latitude: -24.7831, longitude: -65.4100 },
      routeCoords,
      steps,
      progressState: {
        lastDistanceAlongMeters: 250,
        lastStepIndex: 1,
        smoothedEtaSeconds: 120,
      },
      routeDistanceMeters: 900,
      routeDurationSeconds: 240,
      speedMps: 8,
    });

    expect(snapshot.currentStep?.maneuver).toBe('straight');
    expect(snapshot.currentStep?.index).toBe(2);
  });

  it('avanza de rotonda cuando el conductor ya dejó atrás la salida geométrica', () => {
    const routeCoords = [
      { latitude: -24.7800, longitude: -65.4100 },
      { latitude: -24.7810, longitude: -65.4100 },
      { latitude: -24.7820, longitude: -65.4100 },
      { latitude: -24.7830, longitude: -65.4100 },
      { latitude: -24.7845, longitude: -65.4100 },
    ];

    const steps = [
      {
        index: 0,
        instruction: 'Continúa recto',
        distanceValue: 200,
        maneuver: 'straight',
        endLocation: { lat: -24.7810, lng: -65.4100 },
      },
      {
        index: 1,
        instruction: 'En la rotonda, tomá la segunda salida',
        distanceValue: 500,
        maneuver: 'roundabout-right',
        endLocation: { lat: -24.7830, lng: -65.4100 },
      },
      {
        index: 2,
        instruction: 'Continúa por Av. Hipólito Yrigoyen',
        distanceValue: 300,
        maneuver: 'straight',
        endLocation: { lat: -24.7845, lng: -65.4100 },
      },
    ];

    const snapshot = computeNavigationSnapshot({
      currentPoint: { latitude: -24.7838, longitude: -65.4100 },
      routeCoords,
      steps,
      progressState: {
        lastDistanceAlongMeters: 280,
        lastStepIndex: 1,
        smoothedEtaSeconds: 120,
      },
      routeDistanceMeters: 1000,
      routeDurationSeconds: 240,
      speedMps: 4,
    });

    expect(snapshot.currentStep?.maneuver).toBe('straight');
    expect(snapshot.currentStep?.index).toBe(2);
  });
});

describe('getRouteRemainingMeters', () => {
  it('usa proyección sobre la polilínea en lugar del vértice más cercano', () => {
    const routeCoords = [
      { latitude: -24.7800, longitude: -65.4100 },
      { latitude: -24.7830, longitude: -65.4100 },
    ];

    const remaining = getRouteRemainingMeters(
      { latitude: -24.7815, longitude: -65.4100 },
      routeCoords,
    );

    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(350);
  });
});
