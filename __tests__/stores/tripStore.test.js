/**
 * tripStore.test.js — Tests del store Zustand de viajes.
 *
 * El store es puro (sin side effects de red), por lo que se puede testear
 * directamente sin mocks adicionales. Se resetea el estado entre cada test.
 */

import { useTripStore } from '../../src/stores/tripStore';

// Resetear el store entre cada test para evitar contaminación
beforeEach(() => {
  useTripStore.setState({
    activeTrip: null,
    pendingTrip: null,
    showNewTripModal: false,
    tripTimer: 0,
    tripStartTime: null,
    tripDistanceKm: 0,
    lastTrackingLocation: null,
  });
});

const MOCK_TRIP = {
  id: 'trip-001',
  status: 'pending',
  pickup_address: 'Belgrano 200, Salta',
  pickup_lat: -24.79,
  pickup_lng: -65.41,
  destination_address: 'España 400, Salta',
  fare: 800,
};

describe('useTripStore — estado inicial', () => {
  it('tiene todos los campos en null/false/0', () => {
    const state = useTripStore.getState();
    expect(state.activeTrip).toBeNull();
    expect(state.pendingTrip).toBeNull();
    expect(state.showNewTripModal).toBe(false);
    expect(state.tripTimer).toBe(0);
    expect(state.tripDistanceKm).toBe(0);
  });
});

describe('setPendingTrip', () => {
  it('setea el viaje pendiente y abre el modal', () => {
    useTripStore.getState().setPendingTrip(MOCK_TRIP);
    const { pendingTrip, showNewTripModal } = useTripStore.getState();
    expect(pendingTrip).toEqual(MOCK_TRIP);
    expect(showNewTripModal).toBe(true);
  });

  it('null cierra el modal', () => {
    useTripStore.getState().setPendingTrip(MOCK_TRIP);
    useTripStore.getState().setPendingTrip(null);
    const { pendingTrip, showNewTripModal } = useTripStore.getState();
    expect(pendingTrip).toBeNull();
    expect(showNewTripModal).toBe(false);
  });
});

describe('setActiveTrip', () => {
  it('setea el viaje activo', () => {
    useTripStore.getState().setActiveTrip(MOCK_TRIP);
    expect(useTripStore.getState().activeTrip).toEqual(MOCK_TRIP);
  });
});

describe('updateActiveTrip', () => {
  it('actualiza campos del viaje activo sin borrar el resto', () => {
    useTripStore.getState().setActiveTrip(MOCK_TRIP);
    useTripStore.getState().updateActiveTrip({ status: 'in_progress' });
    const { activeTrip } = useTripStore.getState();
    expect(activeTrip.status).toBe('in_progress');
    expect(activeTrip.pickup_address).toBe('Belgrano 200, Salta');
  });

  it('no hace nada si no hay viaje activo', () => {
    useTripStore.getState().updateActiveTrip({ status: 'in_progress' });
    expect(useTripStore.getState().activeTrip).toBeNull();
  });
});

describe('clearActiveTrip', () => {
  it('limpia el viaje activo y resetea los contadores', () => {
    useTripStore.setState({
      activeTrip: MOCK_TRIP,
      tripTimer: 300,
      tripDistanceKm: 5.2,
      tripStartTime: new Date().toISOString(),
    });
    useTripStore.getState().clearActiveTrip();
    const state = useTripStore.getState();
    expect(state.activeTrip).toBeNull();
    expect(state.tripTimer).toBe(0);
    expect(state.tripDistanceKm).toBe(0);
    expect(state.tripStartTime).toBeNull();
  });
});

describe('clearPendingTrip', () => {
  it('limpia el viaje pendiente y cierra el modal', () => {
    useTripStore.getState().setPendingTrip(MOCK_TRIP);
    useTripStore.getState().clearPendingTrip();
    const { pendingTrip, showNewTripModal } = useTripStore.getState();
    expect(pendingTrip).toBeNull();
    expect(showNewTripModal).toBe(false);
  });
});

describe('addTripDistance', () => {
  const LOCATION_1 = { lat: -24.7900, lng: -65.4100 };
  const LOCATION_2 = { lat: -24.7950, lng: -65.4150 }; // ~700m de LOCATION_1

  it('no acumula distancia si no hay viaje activo', () => {
    useTripStore.getState().addTripDistance(LOCATION_1);
    expect(useTripStore.getState().tripDistanceKm).toBe(0);
  });

  it('no acumula distancia si el viaje no está en in_progress', () => {
    useTripStore.setState({ activeTrip: { ...MOCK_TRIP, status: 'accepted' } });
    useTripStore.getState().addTripDistance(LOCATION_1);
    useTripStore.getState().addTripDistance(LOCATION_2);
    expect(useTripStore.getState().tripDistanceKm).toBe(0);
  });

  it('acumula distancia durante in_progress', () => {
    useTripStore.setState({
      activeTrip: { ...MOCK_TRIP, status: 'in_progress' },
      lastTrackingLocation: LOCATION_1,
    });
    useTripStore.getState().addTripDistance(LOCATION_2);
    expect(useTripStore.getState().tripDistanceKm).toBeGreaterThan(0);
  });

  it('descarta movimientos de más de 2 km (ruido GPS)', () => {
    const FAR_POINT = { lat: -24.9000, lng: -65.5000 }; // ~15 km de distancia
    useTripStore.setState({
      activeTrip: { ...MOCK_TRIP, status: 'in_progress' },
      lastTrackingLocation: LOCATION_1,
    });
    useTripStore.getState().addTripDistance(FAR_POINT);
    expect(useTripStore.getState().tripDistanceKm).toBe(0);
  });

  it('descarta movimientos de menos de 10 metros (ruido GPS)', () => {
    const VERY_CLOSE = { lat: -24.79001, lng: -65.41001 }; // <5m
    useTripStore.setState({
      activeTrip: { ...MOCK_TRIP, status: 'in_progress' },
      lastTrackingLocation: LOCATION_1,
    });
    useTripStore.getState().addTripDistance(VERY_CLOSE);
    expect(useTripStore.getState().tripDistanceKm).toBe(0);
  });
});
