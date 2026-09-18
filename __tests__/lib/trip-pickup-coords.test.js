const {
  resolveTripPickupCoords,
  resolveTripFinalDestCoords,
  resolveTripWaypoints,
  cleanTripNotesForDriverDisplay,
  isApproachOnlyTrip,
  isStreetHailTrip,
  isWhatsAppTrip,
  needsDriverDestinationChoice,
  shouldPreservePickupOriginOnAssign,
  buildStreetHailTripInsert,
  STREET_HAIL_PENDING_DESTINATION,
} = require('../../shared/trip-contract');

const WHATSAPP_APPROACH_NOTES = '[APPROACH_ONLY]\nEn cola de espera. Retiro confirmado.';

describe('trip pickup/final dest — WhatsApp APPROACH_ONLY', () => {
  const newSchemaPickupOnlyTrip = {
    origin_address: 'Bartolomé Mitre 300, A4400 Salta, Argentina',
    origin_lat: -24.7864131,
    origin_lng: -65.4107548,
    destination_address: null,
    destination_lat: null,
    destination_lng: null,
    notes: `${WHATSAPP_APPROACH_NOTES}\n[PICKUP_JSON:{"address":"Bartolomé Mitre 300, A4400 Salta, Argentina","lat":-24.7864131,"lng":-65.4107548}]`,
  };

  const legacyGoingToPickupTrip = {
    origin_address: '-24.78766, -65.41078',
    origin_lat: -24.78766,
    origin_lng: -65.4107783,
    destination_address: 'Bartolomé Mitre 300, A4400 Salta, Argentina',
    destination_lat: -24.7864131,
    destination_lng: -65.4107548,
    notes: WHATSAPP_APPROACH_NOTES,
  };

  it('nuevo esquema: retiro en origin_*, sin destino final', () => {
    const pickup = resolveTripPickupCoords(newSchemaPickupOnlyTrip);
    expect(pickup.address).toBe('Bartolomé Mitre 300, A4400 Salta, Argentina');
    expect(pickup.lat).toBeCloseTo(-24.7864131, 5);
    expect(resolveTripFinalDestCoords(newSchemaPickupOnlyTrip)).toBeNull();
    expect(isApproachOnlyTrip(newSchemaPickupOnlyTrip)).toBe(true);
  });

  it('legacy: retiro en destination_* cuando origin es GPS del chofer', () => {
    const pickup = resolveTripPickupCoords(legacyGoingToPickupTrip);
    expect(pickup.address).toBe('Bartolomé Mitre 300, A4400 Salta, Argentina');
    expect(resolveTripFinalDestCoords(legacyGoingToPickupTrip)).toBeNull();
    expect(needsDriverDestinationChoice(legacyGoingToPickupTrip)).toBe(true);
  });

  it('híbrido PICKUP_JSON + legacy destination: retiro correcto, sin destino final', () => {
    const hybridTrip = {
      origin_address: '-24.80203, -65.39437',
      origin_lat: -24.80203,
      origin_lng: -65.39437,
      destination_address: 'Bartolomé Mitre 300, A4400 Salta, Argentina',
      destination_lat: -24.7864131,
      destination_lng: -65.4107548,
      notes: newSchemaPickupOnlyTrip.notes,
    };

    const pickup = resolveTripPickupCoords(hybridTrip);
    expect(pickup.address).toBe('Bartolomé Mitre 300, A4400 Salta, Argentina');
    expect(resolveTripFinalDestCoords(hybridTrip)).toBeNull();
    expect(needsDriverDestinationChoice(hybridTrip)).toBe(true);
    expect(shouldPreservePickupOriginOnAssign(hybridTrip)).toBe(true);
  });
});

describe('trip pickup/final dest — passenger app', () => {
  const PASSENGER_APP_NOTES = [
    '[APPROACH_ONLY]',
    '[PASSENGER_APP]',
    'Solicitado desde la app de pasajeros.',
    '[PICKUP_JSON:{"address":"Juana Hernandez 792, Salta","lat":-24.7981783,"lng":-65.3903467}]',
    '[FINAL_DEST_JSON:{"address":"Avenida Belgrano 300, Salta, Argentina","lat":-24.7876626,"lng":-65.4067392}]',
  ].join('\n');

  it('retiro desde origin/PICKUP_JSON y destino final en destination_*', () => {
    const trip = {
      origin_address: 'Juana Hernandez 792, Salta',
      origin_lat: -24.7981783,
      origin_lng: -65.3903467,
      destination_address: 'Avenida Belgrano 300, Salta, Argentina',
      destination_lat: -24.7876626,
      destination_lng: -65.4067392,
      notes: PASSENGER_APP_NOTES,
    };

    const pickup = resolveTripPickupCoords(trip);
    expect(pickup.address).toBe('Juana Hernandez 792, Salta');

    const finalDest = resolveTripFinalDestCoords(trip);
    expect(finalDest.address).toContain('Belgrano');
    expect(needsDriverDestinationChoice(trip)).toBe(false);
  });
});

describe('trip waypoints — passenger app multi-stop', () => {
  const MULTI_STOP_NOTES = [
    '[APPROACH_ONLY]',
    '[PASSENGER_APP]',
    'Solicitado desde la app de pasajeros.',
    '[PICKUP_JSON:{"address":"Antonio Balcarce, Bº  El Pilar, Salta","lat":-24.7829,"lng":-65.4122}]',
    '[FINAL_DEST_JSON:{"address":"Bartolomé Mitre 1200, Salta","lat":-24.77487047,"lng":-65.40957297}]',
    '[WAYPOINTS_JSON:[{"address":"Bartolomé Mitre 200-298, Salta, Argentina","lat":-24.7874909,"lng":-65.41072919999999}]]',
  ].join('\n');

  it('extrae paradas intermedias desde WAYPOINTS_JSON en notes', () => {
    const trip = {
      notes: MULTI_STOP_NOTES,
      waypoints: null,
    };

    const waypoints = resolveTripWaypoints(trip);
    expect(waypoints).toHaveLength(1);
    expect(waypoints[0].address).toContain('Mitre 200');
    expect(waypoints[0].lat).toBeCloseTo(-24.7874909, 5);
  });

  it('cleanTripNotesForDriverDisplay elimina marcadores JSON embebidos', () => {
    const cleaned = cleanTripNotesForDriverDisplay(`${MULTI_STOP_NOTES}\nLlevar silla de bebé.`);
    expect(cleaned).toBe('Llevar silla de bebé.');
    expect(cleaned).not.toContain('WAYPOINTS_JSON');
    expect(cleaned).not.toContain('PICKUP_JSON');
    expect(cleaned).not.toContain('FINAL_DEST_JSON');
  });
});

describe('viaje en calle (STREET_HAIL)', () => {
  const payload = buildStreetHailTripInsert({
    driverId: 'driver-street-1',
    originAddress: 'Balcarce 500, Salta',
    originLat: -24.79,
    originLng: -65.41,
    nowIso: '2026-09-02T12:00:00.000Z',
  });

  it('crea origen GPS, destino pendiente y pide elección al chofer', () => {
    expect(payload.status).toBe('accepted');
    expect(payload.origin_address).toBe('Balcarce 500, Salta');
    expect(payload.origin_lat).toBeCloseTo(-24.79, 5);
    expect(payload.destination_address).toBe(STREET_HAIL_PENDING_DESTINATION);
    expect(payload.destination_lat).toBeNull();
    expect(payload.destination_lng).toBeNull();
    expect(isStreetHailTrip(payload)).toBe(true);
    expect(isWhatsAppTrip(payload)).toBe(false);
    expect(needsDriverDestinationChoice(payload)).toBe(true);
    expect(shouldPreservePickupOriginOnAssign(payload)).toBe(true);
  });

  it('el pickup sigue siendo el origen aunque después haya destino', () => {
    const pickup = resolveTripPickupCoords(payload);
    expect(pickup.address).toBe('Balcarce 500, Salta');
    expect(pickup.lat).toBeCloseTo(-24.79, 5);
    expect(resolveTripFinalDestCoords(payload)).toBeNull();

    const withDest = {
      ...payload,
      destination_address: 'Belgrano 200, Salta',
      destination_lat: -24.7921,
      destination_lng: -65.4115,
    };
    const pickupAfterDest = resolveTripPickupCoords(withDest);
    expect(pickupAfterDest.address).toBe('Balcarce 500, Salta');
    expect(resolveTripFinalDestCoords(withDest).address).toContain('Belgrano');
    expect(needsDriverDestinationChoice(withDest)).toBe(false);
  });

  it('oculta el marcador [STREET_HAIL] en las notas del chofer', () => {
    const cleaned = cleanTripNotesForDriverDisplay(payload.notes);
    expect(cleaned).not.toContain('[STREET_HAIL]');
    expect(cleaned).not.toContain('PICKUP_JSON');
  });
});
