import {
  autocompleteAddressSalta,
  geocodeAddress,
  getPlaceDetails,
} from '../../src/services/nominatim';
import { clearGeoCaches } from '../../src/lib/geoCache';

describe('nominatim', () => {
  beforeEach(() => {
    clearGeoCaches();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('geocodeAddress devuelve el resultado con mayor puntaje', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          place_id: 1,
          lat: '-24.7900',
          lon: '-65.4100',
          display_name: 'Salta, Argentina',
          importance: 0.4,
          class: 'place',
          type: 'city',
          address: {},
        },
        {
          place_id: 2,
          lat: '-24.7855',
          lon: '-65.4118',
          display_name: 'Belgrano 1200, Salta, Argentina',
          importance: 0.55,
          class: 'building',
          type: 'house',
          address: { road: 'Belgrano', house_number: '1200' },
        },
      ]),
    });

    const result = await geocodeAddress('Belgrano 1200');

    expect(result.lat).toBeCloseTo(-24.7855, 4);
    expect(result.lng).toBeCloseTo(-65.4118, 4);
    expect(result.formattedAddress).toContain('Belgrano');
  });

  it('autocompleteAddressSalta incluye coordenadas en cada opción', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          place_id: 99,
          lat: '-24.7867',
          lon: '-65.4122',
          display_name: 'Terminal de Ómnibus, Salta, Argentina',
          importance: 0.5,
          class: 'amenity',
          type: 'bus_station',
          address: { road: 'Av. Hipólito Yrigoyen' },
        },
      ]),
    });

    const results = await autocompleteAddressSalta('terminal', 3);

    expect(results).toHaveLength(1);
    expect(results[0].placeId).toBe('99');
    expect(results[0].lat).toBeCloseTo(-24.7867, 4);
    expect(results[0].lng).toBeCloseTo(-65.4122, 4);
  });

  it('getPlaceDetails resuelve por place_id de Nominatim', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          place_id: 77,
          lat: '-24.7800',
          lon: '-65.4200',
          display_name: 'Calle Test, Salta, Argentina',
          importance: 0.5,
          class: 'highway',
          type: 'residential',
          address: {},
        },
      ]),
    });

    const details = await getPlaceDetails('77');

    expect(details.lat).toBeCloseTo(-24.78, 4);
    expect(details.lng).toBeCloseTo(-65.42, 4);
  });
});
