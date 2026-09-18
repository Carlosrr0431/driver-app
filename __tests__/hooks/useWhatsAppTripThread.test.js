import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockFrom = jest.fn();
const mockChannelOn = jest.fn();
const mockRemoveChannel = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    channel: jest.fn(() => ({
      on: (...args) => {
        mockChannelOn(...args);
        return {
          on: mockChannelOn,
          subscribe: jest.fn().mockReturnThis(),
        };
      },
      subscribe: jest.fn().mockReturnThis(),
    })),
    removeChannel: (...args) => mockRemoveChannel(...args),
  },
}));

import { useWhatsAppTripThread } from '../../src/hooks/useWhatsAppTripThread';

function HookProbe({ trip, onValue }) {
  const value = useWhatsAppTripThread({ trip, enabled: true });
  onValue(value);
  return null;
}

function createQuery(result) {
  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    order: jest.fn(() => query),
    limit: jest.fn(() => Promise.resolve(result)),
  };
  return query;
}

describe('useWhatsAppTripThread', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no consulta en un viaje de la app de pasajeros', async () => {
    mockFrom.mockReturnValue(createQuery({ data: [], error: null }));
    let latest;
    await act(async () => {
      TestRenderer.create(
        <HookProbe
          trip={{
            id: 'trip-app',
            status: 'accepted',
            notes: '[APPROACH_ONLY]\n[PASSENGER_APP]',
          }}
          onValue={(value) => { latest = value; }}
        />
      );
    });
    expect(latest.visible).toBe(false);
    expect(latest.messages).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('carga el hilo del viaje WhatsApp aceptado', async () => {
    const rows = [
      {
        id: 'm1',
        trip_id: 'trip-wa',
        direction: 'incoming',
        body: 'Un móvil a Mitre',
        created_at: '2026-08-23T22:00:00.000Z',
      },
    ];
    mockFrom.mockReturnValue(createQuery({ data: rows, error: null }));
    let latest;
    await act(async () => {
      TestRenderer.create(
        <HookProbe
          trip={{
            id: 'trip-wa',
            status: 'accepted',
            notes: '[APPROACH_ONLY]\n[WHATSAPP]',
          }}
          onValue={(value) => { latest = value; }}
        />
      );
    });
    expect(mockFrom).toHaveBeenCalledWith('trip_whatsapp_messages');
    expect(latest.visible).toBe(true);
    expect(latest.messages).toEqual(rows);
    expect(latest.loading).toBe(false);
  });

  it('si la tabla no existe, no rompe el viaje', async () => {
    mockFrom.mockReturnValue(createQuery({
      data: null,
      error: { code: 'PGRST205', message: 'Could not find the table' },
    }));
    let latest;
    await act(async () => {
      TestRenderer.create(
        <HookProbe
          trip={{
            id: 'trip-wa',
            status: 'accepted',
            notes: '[APPROACH_ONLY]\n[WHATSAPP]',
          }}
          onValue={(value) => { latest = value; }}
        />
      );
    });
    expect(latest.visible).toBe(false);
    expect(latest.messages).toEqual([]);
  });

  it('limpia el hilo al cambiar de viaje y no deja mensajes del anterior', async () => {
    const queryA = createQuery({
      data: [{
        id: 'old',
        trip_id: 'trip-a',
        direction: 'incoming',
        body: 'viaje anterior',
        created_at: '2026-08-23T22:00:00.000Z',
      }],
      error: null,
    });
    const queryB = createQuery({
      data: [{
        id: 'new',
        trip_id: 'trip-b',
        direction: 'incoming',
        body: 'viaje actual',
        created_at: '2026-08-23T23:00:00.000Z',
      }],
      error: null,
    });
    mockFrom.mockReturnValue(queryA);

    let latest;
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <HookProbe
          trip={{
            id: 'trip-a',
            status: 'accepted',
            notes: '[APPROACH_ONLY]\n[WHATSAPP]',
          }}
          onValue={(value) => { latest = value; }}
        />
      );
    });
    expect(latest.messages.map((m) => m.id)).toEqual(['old']);

    mockFrom.mockReturnValue(queryB);
    await act(async () => {
      renderer.update(
        <HookProbe
          trip={{
            id: 'trip-b',
            status: 'accepted',
            notes: '[APPROACH_ONLY]\n[WHATSAPP]',
          }}
          onValue={(value) => { latest = value; }}
        />
      );
    });
    expect(latest.messages.every((m) => m.trip_id === 'trip-b')).toBe(true);
    expect(latest.messages.map((m) => m.id)).toEqual(['new']);
    expect(latest.messages.map((m) => m.body)).not.toContain('viaje anterior');
  });
});
