/**
 * Caché en memoria + deduplicación de requests geoespaciales (OSRM / Nominatim).
 * Reduce llamadas repetidas sin afectar calidad de navegación.
 */

class TtlCache {
  constructor(maxSize = 32, defaultTtlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear() {
    this.map.clear();
  }
}

const inFlight = new Map();

export const routeCache = new TtlCache(24, 20 * 60 * 1000);
export const nominatimCache = new TtlCache(64, 60 * 60 * 1000);

function roundCoord(value) {
  return Number(value).toFixed(4);
}

export function buildRouteCacheKey(origin, destination) {
  const fromLat = origin?.lat ?? origin?.latitude;
  const fromLng = origin?.lng ?? origin?.longitude;
  const toLat = destination?.lat ?? destination?.latitude;
  const toLng = destination?.lng ?? destination?.longitude;
  return [
    'route',
    roundCoord(fromLat),
    roundCoord(fromLng),
    roundCoord(toLat),
    roundCoord(toLng),
  ].join(':');
}

export function buildNominatimCacheKey(path, params = {}) {
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return `nom:${path}?${sorted}`;
}

export async function withCachedFetch(cache, key, fetcher, ttlMs) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = Promise.resolve()
    .then(fetcher)
    .then((value) => {
      cache.set(key, value, ttlMs);
      inFlight.delete(key);
      return value;
    })
    .catch((error) => {
      inFlight.delete(key);
      throw error;
    });

  inFlight.set(key, promise);
  return promise;
}

export function clearGeoCaches() {
  routeCache.clear();
  nominatimCache.clear();
  inFlight.clear();
}
