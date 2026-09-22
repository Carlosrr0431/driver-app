import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as Location from 'expo-location';
import { useLocation } from '../../src/hooks/useLocation';
import { useLocationStore } from '../../src/stores/locationStore';

function renderLocationHook() {
  const ref = { current: null };

  function Harness() {
    ref.current = useLocation();
    return null;
  }

  act(() => {
    TestRenderer.create(<Harness />);
  });

  return ref;
}

describe('useLocation bootstrap del mapa', () => {
  beforeEach(() => {
    useLocationStore.getState().reset();
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Location.getLastKnownPositionAsync.mockResolvedValue({
      coords: {
        latitude: -24.801,
        longitude: -65.411,
        accuracy: 40,
        speed: 0,
        heading: 0,
      },
    });
    Location.getCurrentPositionAsync.mockRejectedValue(new Error('no-gps'));
  });

  it('con un fix previo pide GPS fresco y no reusa last-known', async () => {
    useLocationStore.setState({
      currentLocation: { lat: -24.79, lng: -65.41, speed: 0, heading: 0, accuracy: 12 },
    });
    Location.getCurrentPositionAsync.mockResolvedValue({
      coords: {
        latitude: -24.805,
        longitude: -65.415,
        accuracy: 10,
        speed: 2,
        heading: 90,
      },
    });

    const hookRef = renderLocationHook();
    let pos;
    await act(async () => {
      pos = await hookRef.current.getCurrentPosition({ force: true });
    });

    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
    expect(pos).toEqual(expect.objectContaining({
      lat: -24.805,
      lng: -65.415,
    }));
  });

  it('usa last-known en force y no espera el GPS fresco', async () => {
    const hookRef = renderLocationHook();
    let pos;

    await act(async () => {
      pos = await hookRef.current.getCurrentPosition({ force: true });
    });

    expect(pos).toEqual(expect.objectContaining({
      lat: -24.801,
      lng: -65.411,
    }));
    expect(useLocationStore.getState().currentLocation).toEqual(
      expect.objectContaining({ lat: -24.801, lng: -65.411 }),
    );
  });
});
