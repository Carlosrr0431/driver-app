import {
  resolveDriverToPickupEndpoints,
  prefetchDriverToPickupRoute,
} from '../../src/services/navigationRoutePrefetch';
import { buildRouteCacheKey, routeCache } from '../../src/lib/geoCache';
import { peekCachedDirections } from '../../src/services/routing';

const WHATSAPP_APPROACH_NOTES = '[APPROACH_ONLY]\nEn cola de espera. Retiro confirmado.';

const DRIVER_GPS = { lat: -24.80203, lng: -65.39437 };

describe('resolveDriverToPickupEndpoints', () => {
  it('usa GPS del chofer y el retiro WhatsApp (PICKUP_JSON / origin)', () => {
    const trip = {
      origin_address: 'Bartolomé Mitre 300, A4400 Salta, Argentina',
      origin_lat: -24.7864131,
      origin_lng: -65.4107548,
      destination_address: null,
      destination_lat: null,
      destination_lng: null,
      notes: `${WHATSAPP_APPROACH_NOTES}\n[PICKUP_JSON:{"address":"Bartolomé Mitre 300, A4400 Salta, Argentina","lat":-24.7864131,"lng":-65.4107548}]`,
    };

    const endpoints = resolveDriverToPickupEndpoints(trip, DRIVER_GPS);
    expect(endpoints.origin).toEqual(DRIVER_GPS);
    expect(endpoints.destination.lat).toBeCloseTo(-24.7864131, 5);
    expect(endpoints.destination.lng).toBeCloseTo(-65.4107548, 5);
  });

  it('legacy: retiro en destination_* cuando origin es GPS del chofer', () => {
    const trip = {
      origin_address: '-24.78766, -65.41078',
      origin_lat: -24.78766,
      origin_lng: -65.4107783,
      destination_address: 'Bartolomé Mitre 300, A4400 Salta, Argentina',
      destination_lat: -24.7864131,
      destination_lng: -65.4107548,
      notes: WHATSAPP_APPROACH_NOTES,
    };

    const endpoints = resolveDriverToPickupEndpoints(trip, DRIVER_GPS);
    expect(endpoints.destination.lat).toBeCloseTo(-24.7864131, 5);
    expect(endpoints.destination.lng).toBeCloseTo(-65.4107548, 5);
  });

  it('passenger-app: retiro en origin, no el destino final', () => {
    const trip = {
      origin_address: 'Juana Hernandez 792, Salta',
      origin_lat: -24.7981783,
      origin_lng: -65.3903467,
      destination_address: 'Avenida Belgrano 300, Salta, Argentina',
      destination_lat: -24.7876626,
      destination_lng: -65.4067392,
      notes: [
        '[APPROACH_ONLY]',
        '[PASSENGER_APP]',
        '[PICKUP_JSON:{"address":"Juana Hernandez 792, Salta","lat":-24.7981783,"lng":-65.3903467}]',
        '[FINAL_DEST_JSON:{"address":"Avenida Belgrano 300, Salta, Argentina","lat":-24.7876626,"lng":-65.4067392}]',
      ].join('\n'),
    };

    const endpoints = resolveDriverToPickupEndpoints(trip, DRIVER_GPS);
    expect(endpoints.destination.lat).toBeCloseTo(-24.7981783, 5);
    expect(endpoints.destination.lng).toBeCloseTo(-65.3903467, 5);
  });

  it('devuelve null sin GPS o sin retiro', () => {
    expect(resolveDriverToPickupEndpoints({ origin_lat: -24.78, origin_lng: -65.41 }, null)).toBeNull();
    expect(resolveDriverToPickupEndpoints({}, DRIVER_GPS)).toBeNull();
    expect(resolveDriverToPickupEndpoints({ origin_lat: -24.78, origin_lng: -65.41 }, { lat: 0, lng: 0 })).toBeNull();
  });

  it('acepta latitude/longitude además de lat/lng', () => {
    const trip = {
      origin_lat: -24.7864,
      origin_lng: -65.4107,
    };
    const endpoints = resolveDriverToPickupEndpoints(trip, {
      latitude: DRIVER_GPS.lat,
      longitude: DRIVER_GPS.lng,
    });
    expect(endpoints.origin).toEqual(DRIVER_GPS);
  });
});

describe('prefetchDriverToPickupRoute', () => {
  it('no dispara fetch si faltan coordenadas', async () => {
    await expect(prefetchDriverToPickupRoute(null, DRIVER_GPS)).resolves.toBeNull();
  });
});

describe('peekCachedDirections', () => {
  it('lee la ruta ya cacheada para pintar al aceptar', () => {
    const origin = { lat: -24.802, lng: -65.3944 };
    const destination = { lat: -24.7864, lng: -65.4108 };
    const cached = {
      polyline: 'abc',
      steps: [{ instruction: 'Seguí derecho' }],
      polylineCoords: [{ latitude: -24.802, longitude: -65.3944 }],
    };
    routeCache.set(buildRouteCacheKey(origin, destination), cached);
    expect(peekCachedDirections(origin, destination)).toEqual(cached);
  });
});
