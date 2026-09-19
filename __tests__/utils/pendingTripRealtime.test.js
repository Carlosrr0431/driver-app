import {
  isAcceptedOfferStatus,
  isCancelledTripStatus,
  resolveDriverTripRealtimeActions,
} from '../../src/utils/pendingTripRealtime';

const DRIVER_ID = 'driver-1';
const TRIP_ID = 'trip-1';

describe('resolveDriverTripRealtimeActions', () => {
  it('cierra la oferta si el viaje se cancela aunque payload.old venga vacío', () => {
    const actions = resolveDriverTripRealtimeActions({
      trip: { id: TRIP_ID, status: 'cancelled', driver_id: DRIVER_ID },
      previousTrip: { id: TRIP_ID },
      driverId: DRIVER_ID,
      pendingTripId: TRIP_ID,
      activeTripId: null,
    });

    expect(actions.relevant).toBe(true);
    expect(actions.assignPending).toBe(false);
    expect(actions.clearPending).toBe(true);
    expect(actions.notifyCancelled).toBe(true);
  });

  it('cierra la oferta si cancelan y liberan driver_id', () => {
    const actions = resolveDriverTripRealtimeActions({
      trip: { id: TRIP_ID, status: 'cancelled', driver_id: null },
      previousTrip: { id: TRIP_ID },
      driverId: DRIVER_ID,
      pendingTripId: TRIP_ID,
      activeTripId: null,
    });

    expect(actions.relevant).toBe(true);
    expect(actions.clearPending).toBe(true);
    expect(actions.notifyCancelled).toBe(true);
  });

  it('no cierra una oferta de otro viaje', () => {
    const actions = resolveDriverTripRealtimeActions({
      trip: { id: 'trip-2', status: 'cancelled', driver_id: DRIVER_ID },
      previousTrip: { id: 'trip-2', status: 'pending', driver_id: DRIVER_ID },
      driverId: DRIVER_ID,
      pendingTripId: TRIP_ID,
      activeTripId: null,
    });

    expect(actions.clearPending).toBe(false);
  });

  it('abre la oferta en queued -> pending', () => {
    const actions = resolveDriverTripRealtimeActions({
      trip: { id: TRIP_ID, status: 'pending', driver_id: DRIVER_ID },
      previousTrip: { id: TRIP_ID, status: 'queued', driver_id: null },
      driverId: DRIVER_ID,
      pendingTripId: null,
      activeTripId: null,
    });

    expect(actions.assignPending).toBe(true);
    expect(actions.clearPending).toBe(false);
    expect(actions.mergePending).toBe(false);
  });

  it('fusiona notas de una oferta pending ya abierta', () => {
    const actions = resolveDriverTripRealtimeActions({
      trip: { id: TRIP_ID, status: 'pending', driver_id: DRIVER_ID, notes: 'Esperar' },
      previousTrip: { id: TRIP_ID, status: 'pending', driver_id: DRIVER_ID, notes: 'Portón' },
      driverId: DRIVER_ID,
      pendingTripId: TRIP_ID,
      activeTripId: null,
    });

    expect(actions.assignPending).toBe(false);
    expect(actions.mergePending).toBe(true);
    expect(actions.clearPending).toBe(false);
  });
});

describe('estados de aceptación', () => {
  it('solo going_to_pickup cuenta como oferta aceptada', () => {
    expect(isAcceptedOfferStatus('going_to_pickup')).toBe(true);
    expect(isAcceptedOfferStatus('pending')).toBe(false);
    expect(isAcceptedOfferStatus('cancelled')).toBe(false);
  });

  it('detecta cancelled', () => {
    expect(isCancelledTripStatus('cancelled')).toBe(true);
    expect(isCancelledTripStatus('going_to_pickup')).toBe(false);
  });
});
