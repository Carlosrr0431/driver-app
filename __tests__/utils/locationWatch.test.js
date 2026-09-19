import {
  DRIVER_LOCATION_PUSH_INTERVAL_MS,
  FLEET_ONLINE_NOTIFICATION_TITLE,
  buildFleetBackgroundLocationOptions,
  getDistanceMeters,
  isAlwaysLocationGranted,
  resolveForcedFixAccuracy,
  resolveLocationAcceptMinMeters,
  shouldAcceptLocationStep,
  shouldPushDriverLocationHeartbeat,
  shouldRefreshLocationOnForeground,
  shouldUseLastKnownBootstrap,
} from '../../src/utils/locationWatch';

describe('shouldUseLastKnownBootstrap', () => {
  it('usa last-known solo en el primer force sin fix', () => {
    expect(shouldUseLastKnownBootstrap({ force: true, hasCurrentFix: false })).toBe(true);
  });

  it('no reusa last-known si ya hay GPS (vuelta de background)', () => {
    expect(shouldUseLastKnownBootstrap({ force: true, hasCurrentFix: true })).toBe(false);
  });

  it('no usa last-known fuera de force', () => {
    expect(shouldUseLastKnownBootstrap({ force: false, hasCurrentFix: false })).toBe(false);
  });
});

describe('resolveLocationAcceptMinMeters', () => {
  it('en movimiento acepta pasos chicos del GPS', () => {
    expect(resolveLocationAcceptMinMeters({ speed: 1.4 })).toBe(1);
    expect(resolveLocationAcceptMinMeters({ speed: 14 })).toBe(1);
  });

  it('parado pide más metros para ignorar jitter', () => {
    expect(resolveLocationAcceptMinMeters({ speed: 0 })).toBe(10);
  });
});

describe('shouldAcceptLocationStep', () => {
  const here = { lat: -24.79, lng: -65.41, speed: 0 };

  it('acepta el primer punto', () => {
    expect(shouldAcceptLocationStep(null, here)).toBe(true);
  });

  it('rechaza jitter parado de pocos metros', () => {
    expect(shouldAcceptLocationStep(here, {
      lat: -24.79003,
      lng: -65.41003,
      speed: 0,
    })).toBe(false);
  });

  it('acepta un paso de caminata', () => {
    expect(shouldAcceptLocationStep(here, {
      lat: -24.79002,
      lng: -65.41,
      speed: 1.5,
    })).toBe(true);
  });

  it('rechaza un salto corto hacia atrás si iba en movimiento', () => {
    const movingEast = { lat: -24.79, lng: -65.41, speed: 10, heading: 90 };
    expect(shouldAcceptLocationStep(movingEast, {
      lat: -24.79,
      lng: -65.41018,
      speed: 10,
      heading: 90,
    })).toBe(false);
  });

  it('acepta seguir hacia el este', () => {
    const movingEast = { lat: -24.79, lng: -65.41, speed: 10, heading: 90 };
    expect(shouldAcceptLocationStep(movingEast, {
      lat: -24.79,
      lng: -65.40982,
      speed: 10,
      heading: 90,
    })).toBe(true);
  });
});

describe('resolveForcedFixAccuracy', () => {
  it('en el primer pintado permite un GPS más burdo', () => {
    expect(resolveForcedFixAccuracy({ force: true, hasCurrentFix: false })).toEqual({
      allowCoarse: true,
      maxAccuracy: 150,
    });
  });

  it('con viaje activo no acepta un salto de 150 m al volver', () => {
    expect(resolveForcedFixAccuracy({ force: true, hasCurrentFix: true })).toEqual({
      allowCoarse: false,
      maxAccuracy: 40,
    });
  });
});

describe('shouldRefreshLocationOnForeground', () => {
  it('pide GPS fresco al volver de background', () => {
    expect(shouldRefreshLocationOnForeground('active', 'background')).toBe(true);
    expect(shouldRefreshLocationOnForeground('active', 'inactive')).toBe(true);
  });

  it('no refresca si ya estaba activa', () => {
    expect(shouldRefreshLocationOnForeground('active', 'active')).toBe(false);
    expect(shouldRefreshLocationOnForeground('background', 'active')).toBe(false);
  });
});

describe('shouldPushDriverLocationHeartbeat', () => {
  it('manda el primer heartbeat y los force', () => {
    expect(shouldPushDriverLocationHeartbeat({ lastPushAt: 0, now: 1000 })).toBe(true);
    expect(shouldPushDriverLocationHeartbeat({
      lastPushAt: 10_000,
      now: 10_100,
      force: true,
    })).toBe(true);
  });

  it('espera 800 ms entre heartbeats de flota, no 5 s', () => {
    expect(DRIVER_LOCATION_PUSH_INTERVAL_MS).toBe(800);
    expect(shouldPushDriverLocationHeartbeat({
      lastPushAt: 10_000,
      now: 10_799,
    })).toBe(false);
    expect(shouldPushDriverLocationHeartbeat({
      lastPushAt: 10_000,
      now: 10_800,
    })).toBe(true);
  });
});

describe('getDistanceMeters', () => {
  it('mide un desplazamiento real en Salta', () => {
    const meters = getDistanceMeters(-24.79, -65.41, -24.791, -65.41);
    expect(meters).toBeGreaterThan(80);
    expect(meters).toBeLessThan(150);
  });
});

describe('isAlwaysLocationGranted', () => {
  it('exige Always en iOS, no Al usar la app', () => {
    expect(isAlwaysLocationGranted({ status: 'granted', ios: { scope: 'always' } })).toBe(true);
    expect(isAlwaysLocationGranted({ status: 'granted', ios: { scope: 'whenInUse' } })).toBe(false);
    expect(isAlwaysLocationGranted({ status: 'denied' })).toBe(false);
  });

  it('en Android granted alcanza', () => {
    expect(isAlwaysLocationGranted({ status: 'granted' })).toBe(true);
  });
});

describe('buildFleetBackgroundLocationOptions', () => {
  const LocationApi = {
    Accuracy: { BestForNavigation: 6 },
    ActivityType: { AutomotiveNavigation: 2, OtherNavigation: 4 },
  };

  it('deja el GPS de iOS sin pausar ni agrupar puntos', () => {
    const options = buildFleetBackgroundLocationOptions(LocationApi);
    expect(options.pausesUpdatesAutomatically).toBe(false);
    expect(options.showsBackgroundLocationIndicator).toBe(true);
    expect(options.deferredUpdatesInterval).toBe(0);
    expect(options.deferredUpdatesDistance).toBe(0);
    expect(options.activityType).toBe(2);
    expect(options.distanceInterval).toBe(5);
  });

  it('la notificación persistente solo dice que está en línea', () => {
    const options = buildFleetBackgroundLocationOptions(LocationApi);
    const service = options.foregroundService;
    expect(FLEET_ONLINE_NOTIFICATION_TITLE).toBe('Estás en línea');
    expect(service.notificationTitle).toBe('Estás en línea');
    expect(service.notificationBody).toBe('');
    expect(service.notificationBody).not.toMatch(/central/i);
    expect(service.notificationBody).not.toMatch(/ubicación/i);
    expect(service).not.toHaveProperty('notificationColor');
    expect(service.killServiceOnDestroy).toBe(false);
  });
});
