const {
  isApproachOnlyTrip,
  isPassengerAppTrip,
  isWhatsAppTrip,
  cleanTripNotesForDriverDisplay,
} = require('../../shared/trip-contract');
const {
  displayWhatsAppThreadBody,
  mergeWhatsAppThreadMessages,
  filterWhatsAppThreadMessagesForTrip,
  isWhatsAppThreadVisibleStatus,
  isMissingWhatsAppThreadRelationError,
} = require('../../shared/whatsapp-trip-thread');

describe('hilo WhatsApp del viaje', () => {
  it('detecta viaje WhatsApp y no mezcla app ni panel', () => {
    expect(isWhatsAppTrip({ notes: '[APPROACH_ONLY]\nEn cola de espera. Retiro confirmado.' })).toBe(true);
    expect(isWhatsAppTrip({ notes: '[APPROACH_ONLY]\n[WHATSAPP]\nRetiro confirmado.' })).toBe(true);
    expect(isWhatsAppTrip({ notes: '[APPROACH_ONLY]\n[PASSENGER_APP]\nSolicitado desde la app.' })).toBe(false);
    expect(isWhatsAppTrip({ notes: '[APPROACH_ONLY]\n[DASHBOARD]\nViaje del panel.' })).toBe(false);
    expect(isPassengerAppTrip({ notes: '[APPROACH_ONLY]\n[PASSENGER_APP]' })).toBe(true);
    expect(isApproachOnlyTrip({ notes: '[APPROACH_ONLY]\n[WHATSAPP]' })).toBe(true);
    expect(isWhatsAppTrip({ notes: '[STREET_HAIL]\nViaje tomado en calle. Destino a definir.' })).toBe(false);
  });

  it('oculta el marcador [WHATSAPP] en las notas del chofer', () => {
    const cleaned = cleanTripNotesForDriverDisplay(
      '[APPROACH_ONLY]\n[WHATSAPP]\nLlevar silla de bebé.'
    );
    expect(cleaned).toBe('Llevar silla de bebé.');
    expect(cleaned).not.toContain('[WHATSAPP]');
  });

  it('el historial solo se muestra tras aceptar', () => {
    expect(isWhatsAppThreadVisibleStatus('pending')).toBe(false);
    expect(isWhatsAppThreadVisibleStatus('queued')).toBe(false);
    expect(isWhatsAppThreadVisibleStatus('accepted')).toBe(true);
    expect(isWhatsAppThreadVisibleStatus('going_to_pickup')).toBe(true);
    expect(isWhatsAppThreadVisibleStatus('in_progress')).toBe(true);
    expect(isWhatsAppThreadVisibleStatus('completed')).toBe(false);
  });

  it('arma el texto visible de audio/foto y mergea realtime sin duplicar', () => {
    expect(displayWhatsAppThreadBody({ body: 'Hola, un móvil', message_type: 'text' })).toBe('Hola, un móvil');
    expect(displayWhatsAppThreadBody({ body: '  ', message_type: 'audio' })).toBe('Audio');
    expect(displayWhatsAppThreadBody({ message_type: 'image' })).toBe('Foto');

    const first = { id: 'a', whatsapp_message_id: 'w1', created_at: '2026-08-23T22:00:00.000Z', body: 'uno' };
    const dup = { id: 'a', whatsapp_message_id: 'w1', created_at: '2026-08-23T22:00:00.000Z', body: 'uno' };
    const second = { id: 'b', whatsapp_message_id: 'w2', created_at: '2026-08-23T22:01:00.000Z', body: 'dos' };
    const merged = mergeWhatsAppThreadMessages(mergeWhatsAppThreadMessages([first], dup), second);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.body)).toEqual(['uno', 'dos']);
  });

  it('filtra mensajes de otro viaje', () => {
    const current = { id: 'a', trip_id: 'trip-2', body: 'actual' };
    const previous = { id: 'b', trip_id: 'trip-1', body: 'anterior' };
    expect(filterWhatsAppThreadMessagesForTrip([previous, current, { id: 'c' }], 'trip-2')).toEqual([current]);
    expect(filterWhatsAppThreadMessagesForTrip([previous], 'trip-2')).toEqual([]);
  });

  it('degrada si la tabla todavía no existe en Supabase', () => {
    expect(isMissingWhatsAppThreadRelationError({ code: '42P01' })).toBe(true);
    expect(isMissingWhatsAppThreadRelationError({ code: 'PGRST205', message: 'Could not find the table' })).toBe(true);
    expect(isMissingWhatsAppThreadRelationError({ message: 'permission denied' })).toBe(false);
  });
});
