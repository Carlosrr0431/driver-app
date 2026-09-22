const {
  shouldFallbackToBusyDrivers,
  shouldAcceptAsNextTrip,
  isReservedNextTrip,
  shouldTreatAsLiveDriverTrip,
  buildAcceptAsNextTripUpdate,
  buildActivateNextTripUpdate,
} = require('../../shared/next-trip');

describe('next-trip driver-app', () => {
  it('no reemplaza el viaje activo con uno reservado', () => {
    const reserved = { id: 'n1', status: 'accepted', next_after_trip_id: 'live-1' };
    expect(isReservedNextTrip(reserved)).toBe(true);
    expect(shouldTreatAsLiveDriverTrip(reserved)).toBe(false);
    expect(shouldTreatAsLiveDriverTrip({ id: 'live-1', status: 'in_progress' })).toBe(true);
  });

  it('acepta en paralelo si hay viaje vivo distinto', () => {
    expect(shouldAcceptAsNextTrip({
      liveTrip: { id: 'live-1', status: 'in_progress' },
      offerTripId: 'n1',
    })).toBe(true);
    expect(shouldFallbackToBusyDrivers({ idleInRadiusCount: 0 })).toBe(true);
  });

  it('activa el siguiente como going_to_pickup', () => {
    expect(buildAcceptAsNextTripUpdate()).toMatchObject({ status: 'accepted' });
    expect(buildActivateNextTripUpdate()).toMatchObject({
      status: 'going_to_pickup',
      next_after_trip_id: null,
    });
  });
});
