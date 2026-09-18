import {
  coordsToMapPos,
  nextHomeFollowCenter,
  shouldAcceptForceLocation,
  shouldSkipHomeCameraFollow,
  toCameraLngLat,
} from '../../src/utils/homeMapCamera';

describe('coordsToMapPos', () => {
  it('normaliza coords de expo-location', () => {
    expect(coordsToMapPos({
      coords: {
        latitude: -24.79,
        longitude: -65.41,
        accuracy: 12,
        speed: 3,
        heading: 90,
      },
    })).toEqual({
      lat: -24.79,
      lng: -65.41,
      accuracy: 12,
      speed: 3,
      heading: 90,
    });
  });

  it('rechaza coordenadas inválidas', () => {
    expect(coordsToMapPos(null)).toBeNull();
    expect(coordsToMapPos({ lat: 'x', lng: -65.41 })).toBeNull();
  });
});

describe('shouldSkipHomeCameraFollow', () => {
  const here = { lat: -24.79, lng: -65.41 };

  it('no saltea el primer centro', () => {
    expect(shouldSkipHomeCameraFollow(null, here)).toBe(false);
  });

  it('ignora jitter de menos de ~8 m', () => {
    expect(shouldSkipHomeCameraFollow(here, {
      lat: -24.79002,
      lng: -65.41002,
    })).toBe(true);
  });

  it('sigue un desplazamiento real', () => {
    expect(shouldSkipHomeCameraFollow(here, {
      lat: -24.792,
      lng: -65.412,
    })).toBe(false);
  });
});

describe('shouldAcceptForceLocation', () => {
  it('acepta un fix preciso', () => {
    expect(shouldAcceptForceLocation(20, 150, false)).toBe(true);
  });

  it('descarta GPS burdo si no es bootstrap', () => {
    expect(shouldAcceptForceLocation(400, 150, false)).toBe(false);
  });

  it('acepta GPS burdo en el primer centro del Home', () => {
    expect(shouldAcceptForceLocation(400, 150, true)).toBe(true);
  });
});

describe('toCameraLngLat', () => {
  it('devuelve [lng, lat] para MapLibre', () => {
    expect(toCameraLngLat({ lat: -24.801, lng: -65.411 })).toEqual([-65.411, -24.801]);
  });

  it('rechaza un punto incompleto', () => {
    expect(toCameraLngLat({ lat: -24.801 })).toBeNull();
  });
});

describe('nextHomeFollowCenter', () => {
  const here = { lat: -24.79, lng: -65.41 };

  it('toma el primer GPS aunque el mapa todavía esté en el centro', () => {
    expect(nextHomeFollowCenter(null, here, { force: true })).toEqual(here);
  });

  it('no pisa el centro por jitter', () => {
    expect(nextHomeFollowCenter(here, {
      lat: -24.79005,
      lng: -65.41005,
    })).toEqual(here);
  });

  it('actualiza cuando el chofer se movió de verdad', () => {
    expect(nextHomeFollowCenter(here, {
      lat: -24.801,
      lng: -65.411,
    })).toEqual({ lat: -24.801, lng: -65.411 });
  });
});
