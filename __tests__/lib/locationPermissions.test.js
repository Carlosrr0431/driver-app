import {
  canStartFleetBackgroundUpdates,
  requestFleetLocationPermissions,
  resetLocationPermissionRequest,
  resolveLocationPermissionStatus,
  shouldPromptBackgroundLocation,
} from '../../src/lib/locationPermissions';

function mockLocationApi({
  foreground = { status: 'undetermined', canAskAgain: true },
  background = { status: 'undetermined', canAskAgain: true },
} = {}) {
  return {
    getForegroundPermissionsAsync: jest.fn().mockResolvedValue(foreground),
    requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
    }),
    getBackgroundPermissionsAsync: jest.fn().mockResolvedValue(background),
    requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
      ios: { scope: 'always' },
    }),
  };
}

describe('locationPermissions', () => {
  beforeEach(() => {
    resetLocationPermissionRequest();
  });

  it('shouldPromptBackgroundLocation no insiste si ya hay Always o no se puede preguntar', () => {
    expect(shouldPromptBackgroundLocation({
      status: 'granted',
      ios: { scope: 'always' },
    })).toBe(false);
    expect(shouldPromptBackgroundLocation({
      status: 'denied',
      canAskAgain: false,
    })).toBe(false);
    expect(shouldPromptBackgroundLocation({
      status: 'undetermined',
      canAskAgain: true,
    })).toBe(true);
  });

  it('iOS no arranca GPS de flota sin Always; Android sí con ubicación en uso', () => {
    expect(canStartFleetBackgroundUpdates({
      platform: 'ios',
      foreground: true,
      always: false,
    })).toBe(false);
    expect(canStartFleetBackgroundUpdates({
      platform: 'ios',
      foreground: true,
      always: true,
    })).toBe(true);
    expect(canStartFleetBackgroundUpdates({
      platform: 'android',
      foreground: true,
      always: false,
    })).toBe(true);
    expect(canStartFleetBackgroundUpdates({
      platform: 'android',
      foreground: false,
      always: false,
    })).toBe(false);
  });

  it('resolveLocationPermissionStatus cubre los tres estados', () => {
    expect(resolveLocationPermissionStatus({ foreground: true, always: true })).toBe('granted');
    expect(resolveLocationPermissionStatus({ foreground: true, always: false })).toBe('foreground-only');
    expect(resolveLocationPermissionStatus({ foreground: false })).toBe('denied');
  });

  it('pide primero Al usar la app y después Always', async () => {
    const LocationApi = mockLocationApi();
    const result = await requestFleetLocationPermissions(LocationApi, { background: true });

    expect(LocationApi.getForegroundPermissionsAsync).toHaveBeenCalled();
    expect(LocationApi.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(LocationApi.getBackgroundPermissionsAsync).toHaveBeenCalled();
    expect(LocationApi.requestBackgroundPermissionsAsync).toHaveBeenCalled();
    expect(
      LocationApi.requestForegroundPermissionsAsync.mock.invocationCallOrder[0],
    ).toBeLessThan(
      LocationApi.requestBackgroundPermissionsAsync.mock.invocationCallOrder[0],
    );
    expect(result).toEqual(expect.objectContaining({
      foreground: true,
      always: true,
    }));
  });

  it('no pide Always si solo hace falta el mapa', async () => {
    const LocationApi = mockLocationApi({
      foreground: { status: 'granted' },
    });
    await requestFleetLocationPermissions(LocationApi, { background: false });
    expect(LocationApi.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(LocationApi.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('no vuelve a pedir Always si iOS ya lo concedió', async () => {
    const LocationApi = mockLocationApi({
      foreground: { status: 'granted' },
      background: { status: 'granted', ios: { scope: 'always' } },
    });
    const result = await requestFleetLocationPermissions(LocationApi, { background: true });
    expect(LocationApi.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(result.always).toBe(true);
  });

  it('no reabre el diálogo si el usuario ya dijo que no', async () => {
    const LocationApi = mockLocationApi({
      foreground: { status: 'granted' },
      background: { status: 'denied', canAskAgain: false, ios: { scope: 'whenInUse' } },
    });
    const result = await requestFleetLocationPermissions(LocationApi, { background: true });
    expect(LocationApi.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(result.always).toBe(false);
    expect(result.foreground).toBe(true);
  });
});
