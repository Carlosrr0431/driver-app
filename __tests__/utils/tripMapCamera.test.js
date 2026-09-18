import {
  ARRIVAL_ZOOM_2D,
  ARRIVAL_ZOOM_3D,
  NAV_ZOOM_CEILING,
  getViewportArrivalZoomBias,
  getZoomForSpeed,
  isArrivalCameraDistance,
  resolveFollowPadding,
  resolveNavigationCameraPitch,
  resolveNavigationCameraZoom,
  resolveSettledOverviewZoom,
} from '../../src/utils/tripMapCamera';

describe('isArrivalCameraDistance', () => {
  it('detecta llegada al retiro', () => {
    expect(isArrivalCameraDistance(40)).toBe(true);
    expect(isArrivalCameraDistance(249)).toBe(true);
    expect(isArrivalCameraDistance(250)).toBe(false);
    expect(isArrivalCameraDistance(null)).toBe(false);
  });
});

describe('getViewportArrivalZoomBias', () => {
  it('aleja más en pantallas chicas', () => {
    expect(getViewportArrivalZoomBias({ width: 320, height: 569 })).toBe(-0.4);
    expect(getViewportArrivalZoomBias({ width: 360, height: 680 })).toBe(-0.2);
  });

  it('deja el encuadre estándar en 360x800', () => {
    expect(getViewportArrivalZoomBias({ width: 360, height: 800 })).toBe(0);
  });
});

describe('resolveNavigationCameraZoom', () => {
  it('aleja al llegar al pickup en vez de acercar a 17.8', () => {
    const cruising = getZoomForSpeed(51, true);
    expect(cruising).toBeGreaterThan(17);

    const arriving = resolveNavigationCameraZoom({
      speedKmh: 51,
      threeDEnabled: true,
      remainingDistanceMeters: 40,
      viewportWidth: 360,
      viewportHeight: 800,
    });

    expect(arriving).toBeLessThanOrEqual(ARRIVAL_ZOOM_3D);
    expect(arriving).toBeGreaterThanOrEqual(15);
    expect(arriving).toBeLessThan(cruising);
  });

  it('en 2D tampoco fuerza zoom 17+ al llegar', () => {
    const arriving = resolveNavigationCameraZoom({
      speedKmh: 51,
      threeDEnabled: false,
      remainingDistanceMeters: 30,
      viewportWidth: 360,
      viewportHeight: 800,
    });
    expect(arriving).toBeLessThanOrEqual(ARRIVAL_ZOOM_2D);
  });

  it('en un celular chico aleja un poco más', () => {
    const phone = resolveNavigationCameraZoom({
      speedKmh: 20,
      threeDEnabled: true,
      remainingDistanceMeters: 20,
      viewportWidth: 320,
      viewportHeight: 569,
    });
    const standard = resolveNavigationCameraZoom({
      speedKmh: 20,
      threeDEnabled: true,
      remainingDistanceMeters: 20,
      viewportWidth: 360,
      viewportHeight: 800,
    });
    expect(phone).toBeLessThan(standard);
  });

  it('durante la ruta (lejos del retiro) no cambia el zoom de crucero', () => {
    expect(resolveNavigationCameraZoom({
      speedKmh: 51,
      threeDEnabled: true,
      remainingDistanceMeters: 800,
    })).toBe(getZoomForSpeed(51, true));
  });

  it('nunca supera el techo que deja el mapa en blanco', () => {
    expect(resolveNavigationCameraZoom({
      speedKmh: 10,
      threeDEnabled: true,
      remainingDistanceMeters: 10,
      cornerFactor: -2,
    })).toBeLessThanOrEqual(NAV_ZOOM_CEILING);
  });
});

describe('resolveNavigationCameraPitch', () => {
  it('baja el pitch al llegar para no mirar tiles vacíos', () => {
    expect(resolveNavigationCameraPitch({
      threeDEnabled: true,
      remainingDistanceMeters: 40,
    })).toBe(28);
    expect(resolveNavigationCameraPitch({
      threeDEnabled: true,
      remainingDistanceMeters: 900,
    })).toBe(52);
  });
});

describe('resolveSettledOverviewZoom', () => {
  it('deja una vista de manzana al salir de navegación', () => {
    const zoom = resolveSettledOverviewZoom({ width: 360, height: 800 });
    expect(zoom).toBeGreaterThanOrEqual(15);
    expect(zoom).toBeLessThan(16.2);
  });
});

describe('resolveFollowPadding', () => {
  it('reduce el padding superior en pantallas bajas', () => {
    expect(resolveFollowPadding({ viewportHeight: 569 }).top).toBe(140);
    expect(resolveFollowPadding({ viewportHeight: 800 }).top).toBe(300);
  });
});
