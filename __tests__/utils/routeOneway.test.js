import { classifyStepOneway, buildRouteSegmentsFromSteps, buildRemainingRouteSegments } from '../../src/utils/routeOneway';

describe('routeOneway', () => {
  it('detecta mano única cuando las intersecciones tienen una sola entrada', () => {
    const step = {
      name: 'Avenida San Martín',
      intersections: [
        { entry: [false, true, false, false] },
        { entry: [false, true, false, false] },
        { entry: [true] },
      ],
    };

    expect(classifyStepOneway(step)).toBe(true);
  });

  it('detecta doble mano cuando hay múltiples entradas abiertas', () => {
    const step = {
      name: 'Caseros',
      intersections: [
        { entry: [true, true, false, false] },
        { entry: [false, true, true, false] },
      ],
    };

    expect(classifyStepOneway(step)).toBe(false);
  });

  it('arma segmentos con flag oneway desde pasos OSRM normalizados', () => {
    const segments = buildRouteSegmentsFromSteps([
      {
        likelyOneway: true,
        polylineCoords: [
          { latitude: -24.78, longitude: -65.42 },
          { latitude: -24.781, longitude: -65.419 },
        ],
      },
      {
        likelyOneway: false,
        polylineCoords: [
          { latitude: -24.781, longitude: -65.419 },
          { latitude: -24.782, longitude: -65.418 },
        ],
      },
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0].oneway).toBe(true);
    expect(segments[1].oneway).toBe(false);
  });

  it('recorta segmentos a la polilínea restante sin incluir tramo ya recorrido', () => {
    const steps = [
      {
        likelyOneway: true,
        polylineCoords: [
          { latitude: -24.78, longitude: -65.42 },
          { latitude: -24.781, longitude: -65.419 },
        ],
      },
      {
        likelyOneway: false,
        polylineCoords: [
          { latitude: -24.781, longitude: -65.419 },
          { latitude: -24.782, longitude: -65.418 },
        ],
      },
    ];

    const remaining = [
      { latitude: -24.780, longitude: -65.42 },
      { latitude: -24.781, longitude: -65.419 },
      { latitude: -24.782, longitude: -65.418 },
    ];

    const segments = buildRemainingRouteSegments(steps, remaining);

    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(segments[0].coords[0]).toEqual(remaining[0]);
    expect(segments[segments.length - 1].coords.at(-1)).toEqual(remaining.at(-1));
    const allCoords = segments.flatMap((segment) => segment.coords);
    expect(allCoords.length).toBeGreaterThanOrEqual(remaining.length);
  });
});
