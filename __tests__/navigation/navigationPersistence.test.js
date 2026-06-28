import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearNavigationState,
  loadNavigationState,
  saveNavigationState,
  sanitizeNavigationStateForRestore,
} from '../../src/navigation/navigationPersistence';
import { NAVIGATION_STRUCTURE_FINGERPRINT } from '../../src/navigation/navigationStructure';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

describe('navigationPersistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restaura un estado válido del main navigator', async () => {
    const state = {
      index: 0,
      routes: [{ name: 'Home', state: { index: 0, routes: [{ name: 'HomeMain' }] } }],
    };

    AsyncStorage.getItem.mockResolvedValue(
      JSON.stringify({ fingerprint: NAVIGATION_STRUCTURE_FINGERPRINT, state }),
    );

    await expect(loadNavigationState()).resolves.toEqual(state);
  });

  it('descarta estados con rutas de auth', async () => {
    AsyncStorage.getItem.mockResolvedValue(
      JSON.stringify({
        fingerprint: NAVIGATION_STRUCTURE_FINGERPRINT,
        state: {
          index: 0,
          routes: [{ name: 'Login' }],
        },
      }),
    );

    await expect(loadNavigationState()).resolves.toBeUndefined();
    expect(AsyncStorage.removeItem).toHaveBeenCalled();
  });

  it('descarta fingerprints desconocidos', async () => {
    AsyncStorage.getItem.mockResolvedValue(
      JSON.stringify({
        fingerprint: 'estructura-vieja',
        state: {
          index: 0,
          routes: [{ name: 'Home' }],
        },
      }),
    );

    await expect(loadNavigationState()).resolves.toBeUndefined();
    expect(AsyncStorage.removeItem).toHaveBeenCalled();
  });

  it('descarta snapshots con rutas internas que ya no existen', async () => {
    AsyncStorage.getItem.mockResolvedValue(
      JSON.stringify({
        fingerprint: NAVIGATION_STRUCTURE_FINGERPRINT,
        state: {
          index: 0,
          routes: [
            {
              name: 'Home',
              state: {
                index: 0,
                routes: [{ name: 'PantallaEliminada' }],
              },
            },
          ],
        },
      }),
    );

    await expect(loadNavigationState()).resolves.toBeUndefined();
    expect(AsyncStorage.removeItem).toHaveBeenCalled();
  });

  it('guarda solo estados del main navigator', async () => {
    const state = {
      index: 1,
      routes: [
        { name: 'Home' },
        { name: 'Profile', state: { index: 0, routes: [{ name: 'ProfileMain' }] } },
      ],
    };

    await saveNavigationState(state);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@driver_app/navigation_state_v1',
      JSON.stringify({ fingerprint: NAVIGATION_STRUCTURE_FINGERPRINT, state }),
    );
  });

  it('no guarda estados de auth', async () => {
    await saveNavigationState({
      index: 0,
      routes: [{ name: 'AssignedDriverLogin' }],
    });

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('limpia el storage persistido', async () => {
    await clearNavigationState();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      '@driver_app/navigation_state_v1',
    );
  });

  it('elimina keys de runtime antes de persistir', async () => {
    const rawState = {
      stale: false,
      type: 'tab',
      key: 'tab-yRPmJHyJdcuHdSMpnWapb',
      index: 0,
      routeNames: ['Home', 'History', 'Profile'],
      routes: [
        {
          name: 'Home',
          key: 'Home-7da3k2qdXV0qc_jHHwIWW',
          state: {
            key: 'stack-V83XD4-MfrBqB7Pwux77g',
            index: 1,
            routeNames: ['HomeMain', 'ActiveTrip', 'TripDetail', 'CommissionPayment'],
            routes: [
              { key: 'HomeMain-i4QNyg0gLK1xI4GhZrh8l', name: 'HomeMain' },
              { key: 'CommissionPayment-abc', name: 'CommissionPayment' },
            ],
          },
        },
      ],
    };

    await saveNavigationState(rawState);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@driver_app/navigation_state_v1',
      JSON.stringify({
        fingerprint: NAVIGATION_STRUCTURE_FINGERPRINT,
        state: {
          index: 0,
          routes: [
            {
              name: 'Home',
              state: {
                index: 1,
                routes: [{ name: 'HomeMain' }, { name: 'CommissionPayment' }],
              },
            },
          ],
        },
      }),
    );
  });

  it('sanitiza estados legacy al cargar', async () => {
    AsyncStorage.getItem.mockResolvedValue(
      JSON.stringify({
        fingerprint: NAVIGATION_STRUCTURE_FINGERPRINT,
        state: {
          key: 'tab-old',
          index: 0,
          routes: [
            {
              name: 'Home',
              key: 'Home-old',
              state: {
                index: 0,
                routes: [{ name: 'HomeMain', key: 'HomeMain-old' }],
              },
            },
          ],
        },
      }),
    );

    await expect(loadNavigationState()).resolves.toEqual({
      index: 0,
      routes: [
        {
          name: 'Home',
          state: {
            index: 0,
            routes: [{ name: 'HomeMain' }],
          },
        },
      ],
    });
  });
});
