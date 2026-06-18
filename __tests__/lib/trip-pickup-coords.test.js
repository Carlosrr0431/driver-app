const {
  resolveTripPickupCoords,
  resolveTripFinalDestCoords,
  isApproachOnlyTrip,
  needsDriverDestinationChoice,
  shouldPreservePickupOriginOnAssign,
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
