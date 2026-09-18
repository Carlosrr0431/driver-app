import {
  autocompleteAddressSalta,
  geocodeAddress,
  getPlaceDetails,
} from '../../src/services/nominatim';

describe('nominatim (dashboard geo)', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('geocodeAddress usa el API geo del dashboard', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          lat: -24.7855,
          lng: -65.4118,
          formattedAddress: 'Belgrano 1200, Salta',
          placeId: 'geo-2',
        },
      }),
    });

    const result = await geocodeAddress('Belgrano 1200');

    expect(result.lat).toBeCloseTo(-24.7855, 4);
    expect(result.lng).toBeCloseTo(-65.4118, 4);
    expect(result.formattedAddress).toContain('Belgrano');
    expect(String(global.fetch.mock.calls[0][0])).toContain('/api/geo/geocode');
  });

  it('autocompleteAddressSalta incluye POIs y coordenadas', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: [
          {
            address: 'Terminal de Ómnibus, Salta',
            placeId: '99',
            lat: -24.7867,
            lng: -65.4122,
            title: 'Terminal de Ómnibus',
            subtitle: 'Av. Hipólito Yrigoyen, Salta',
          },
          {
            address: 'Bartolomé Mitre 300, Salta',
            placeId: 'ChIJ-mitre',
            lat: -24.7891,
            lng: -65.4104,
            title: 'Bartolomé Mitre 300',
            subtitle: 'Centro, Salta',
          },
        ],
      }),
    });

    const results = await autocompleteAddressSalta('Bartolomé MITRE 300', 8);

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Terminal de Ómnibus');
    expect(results[1].address).toContain('Mitre');
    expect(results[1].lat).toBeCloseTo(-24.7891, 4);
    expect(String(global.fetch.mock.calls[0][0])).toContain('/api/geo/autocomplete');
  });

  it('getPlaceDetails resuelve un placeId vía dashboard', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          lat: -24.78,
          lng: -65.42,
          formattedAddress: 'Calle Test, Salta',
          placeId: '77',
        },
      }),
    });

    const details = await getPlaceDetails('77');

    expect(details.lat).toBeCloseTo(-24.78, 4);
    expect(details.lng).toBeCloseTo(-65.42, 4);
    expect(String(global.fetch.mock.calls[0][0])).toContain('placeId=77');
  });
});
