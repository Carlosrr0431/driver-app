const mockFrom = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
  },
}));

import { applyStreetHailStart, buildFreeRideTripUpdates } from '../../src/services/streetHailTrip';

function mockTripUpdate(trip) {
  const single = jest.fn().mockResolvedValue({ data: trip, error: null });
  const select = jest.fn(() => ({ single }));
  const eq = jest.fn(() => ({ select, single, eq, update: jest.fn() }));
  const update = jest.fn(() => ({ eq, select, single }));
  mockFrom.mockReturnValue({ update, select, eq, single });
  return { update, eq };
}

describe('applyStreetHailStart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marca notes [FREE_RIDE] y borra coords de destino', () => {
    const updates = buildFreeRideTripUpdates({ notes: '[STREET_HAIL]\nViaje tomado en calle.' });
    expect(updates.destination_address).toBe('A confirmar');
    expect(updates.destination_lat).toBeNull();
    expect(updates.destination_lng).toBeNull();
    expect(updates.notes).toContain('[FREE_RIDE]');
    expect(updates.notes).toContain('[STREET_HAIL]');
  });

  it('Ir sin destino pasa a in_progress sin coordenadas de destino', async () => {
    const trip = { id: 't1', status: 'in_progress', destination_lat: null };
    const { update } = mockTripUpdate(trip);

    const result = await applyStreetHailStart({ tripId: 't1', destination: null });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'in_progress',
      dispatch_status: 'accepted',
    }));
    const payload = update.mock.calls[0][0];
    expect(payload.destination_address).toBe('A confirmar');
    expect(payload.destination_lat).toBeNull();
    expect(payload.destination_lng).toBeNull();
    expect(payload.notes).toContain('[FREE_RIDE]');
    expect(result.id).toBe('t1');
  });

  it('con destino guarda dirección y coordenadas', async () => {
    const trip = { id: 't1', status: 'in_progress' };
    const { update } = mockTripUpdate(trip);

    await applyStreetHailStart({
      tripId: 't1',
      destination: { address: 'Mitre 300', lat: -24.79, lng: -65.41 },
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      destination_address: 'Mitre 300',
      destination_lat: -24.79,
      destination_lng: -65.41,
    }));
    const payload = update.mock.calls[0][0];
    expect(payload.notes).toBeUndefined();
  });
});
