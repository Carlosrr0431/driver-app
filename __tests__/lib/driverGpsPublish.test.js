import {
  clearDriverGpsContext,
  ensureAuthSession,
  handleBackgroundLocations,
  parseDriverGpsContext,
  publishDriverGps,
  resetDriverGpsPublishState,
  resolveBackgroundGpsContext,
  saveDriverGpsContext,
  shouldKeepFleetGps,
  toFleetGpsPoint,
} from '../../src/lib/driverGpsPublish';
import { setGpsSimulationActive } from '../../src/lib/gpsSimulation';
import { useLocationStore } from '../../src/stores/locationStore';

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: jest.fn(async (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null)),
    setItem: jest.fn(async (key, value) => {
      data[key] = value;
    }),
    removeItem: jest.fn(async (key) => {
      delete data[key];
    }),
  };
}

function mockClient() {
  const eq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn().mockReturnValue({ eq });
  const upsert = jest.fn().mockResolvedValue({ error: null });
  return {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      }),
      refreshSession: jest.fn().mockResolvedValue({
        data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      }),
    },
    from: jest.fn((table) => {
      if (table === 'drivers') return { update };
      return { upsert };
    }),
    _update: update,
    _upsert: upsert,
    _eq: eq,
  };
}

describe('driverGpsPublish', () => {
  beforeEach(() => {
    resetDriverGpsPublishState();
    setGpsSimulationActive(false);
    useLocationStore.getState().reset();
  });

  afterEach(() => {
    setGpsSimulationActive(false);
  });

  it('shouldKeepFleetGps si está en línea o en viaje', () => {
    expect(shouldKeepFleetGps({ isAvailable: true, isTracking: false })).toBe(true);
    expect(shouldKeepFleetGps({ isAvailable: false, isTracking: true })).toBe(true);
    expect(shouldKeepFleetGps({ isAvailable: false, isTracking: false })).toBe(false);
  });

  it('parsea y persiste el contexto para cuando iOS relanza el proceso', async () => {
    expect(parseDriverGpsContext('{"driverId":"d1","publish":true,"isOnline":true}')).toEqual({
      driverId: 'd1',
      publish: true,
      isOnline: true,
    });
    expect(parseDriverGpsContext('{"publish":true}')).toBeNull();

    const storage = memoryStorage();
    await saveDriverGpsContext({ driverId: 'd1', publish: true, isOnline: true }, storage);
    expect(JSON.parse(storage.setItem.mock.calls[0][1])).toEqual({
      driverId: 'd1',
      publish: true,
      isOnline: true,
    });
    await clearDriverGpsContext(storage);
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it('usa el contexto guardado si iOS mata Zustand', () => {
    expect(resolveBackgroundGpsContext({
      stored: { driverId: 'd1', publish: true, isOnline: true },
      driver: null,
    })).toEqual({ driverId: 'd1', publish: true, isOnline: true });

    expect(resolveBackgroundGpsContext({
      stored: null,
      driver: { id: 'd2', is_available: true },
    })).toEqual({ driverId: 'd2', publish: true, isOnline: true });
  });

  it('no publica sin chofer ni en simulación', async () => {
    const client = mockClient();
    await expect(publishDriverGps({
      client,
      pos: { lat: -24.79, lng: -65.41 },
    })).resolves.toEqual({ published: false });

    setGpsSimulationActive(true);
    await expect(publishDriverGps({
      client,
      driverId: 'd1',
      pos: { lat: -24.79, lng: -65.41 },
    })).resolves.toEqual({ published: false });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('publica lat/lng a drivers y el heartbeat a driver_locations', async () => {
    const client = mockClient();
    const result = await publishDriverGps({
      client,
      driverId: 'd1',
      pos: { lat: -24.79, lng: -65.41, speed: 8, heading: 90 },
      now: 1000,
      force: true,
    });

    expect(result).toEqual({ published: true, heartbeat: true });
    expect(client._update).toHaveBeenCalledWith({
      current_lat: -24.79,
      current_lng: -65.41,
      updated_at: expect.any(String),
    });
    expect(client._eq).toHaveBeenCalledWith('id', 'd1');
    expect(client._upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        driver_id: 'd1',
        lat: -24.79,
        lng: -65.41,
        speed: 8,
        heading: 90,
        is_online: true,
      }),
      { onConflict: 'driver_id' },
    );
  });

  it('refresca el token si está por vencer en background', async () => {
    const client = mockClient();
    client.auth.getSession.mockResolvedValue({
      data: { session: { expires_at: Math.floor(Date.now() / 1000) + 10 } },
    });
    await ensureAuthSession(client, Date.now());
    expect(client.auth.refreshSession).toHaveBeenCalled();
  });

  it('el task de fondo publica el último punto de iOS', async () => {
    const client = mockClient();
    const locations = [
      { coords: { latitude: -24.79, longitude: -65.41, accuracy: 20, speed: 3, heading: 10 } },
      { coords: { latitude: -24.791, longitude: -65.411, accuracy: 18, speed: 9, heading: 45 } },
    ];

    const result = await handleBackgroundLocations({
      locations,
      context: { driverId: 'd1', publish: true, isOnline: true },
      client,
      now: 2000,
    });

    expect(result).toEqual({ published: true, heartbeat: true });
    expect(toFleetGpsPoint(locations[1])).toEqual(expect.objectContaining({
      lat: -24.791,
      lng: -65.411,
    }));
    expect(useLocationStore.getState().currentLocation).toEqual(expect.objectContaining({
      lat: -24.791,
      lng: -65.411,
    }));
  });

  it('omite puntos sin contexto o con mala precisión', async () => {
    const client = mockClient();
    await expect(handleBackgroundLocations({
      locations: [{ coords: { latitude: -24.79, longitude: -65.41, accuracy: 12 } }],
      context: null,
      client,
    })).resolves.toEqual({ skipped: 'nocontext' });

    await expect(handleBackgroundLocations({
      locations: [{ coords: { latitude: -24.79, longitude: -65.41, accuracy: 90 } }],
      context: { driverId: 'd1', publish: true },
      client,
    })).resolves.toEqual({ skipped: 'filtered' });
  });
});
