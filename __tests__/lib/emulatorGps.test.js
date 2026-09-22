import { parseLatLngPair, resolveEmulatorGpsSeed } from '../../src/lib/emulatorGps';

describe('emulatorGps', () => {
  it('parsea el punto de Google Maps', () => {
    expect(parseLatLngPair('-24.794977,-65.3756143')).toEqual(
      expect.objectContaining({
        lat: -24.794977,
        lng: -65.3756143,
      }),
    );
  });

  it('solo siembra GPS en emulador', () => {
    expect(resolveEmulatorGpsSeed({
      isEmulator: false,
      raw: '-24.794977,-65.3756143',
    })).toBeNull();
    expect(resolveEmulatorGpsSeed({
      isEmulator: true,
      raw: '-24.794977,-65.3756143',
    })).toEqual(expect.objectContaining({
      lat: -24.794977,
      lng: -65.3756143,
    }));
  });
});
