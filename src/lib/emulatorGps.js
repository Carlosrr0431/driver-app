/** Punto real de desarrollo (Salta) cuando el emulador no entrega GPS fresco. */
export const DEFAULT_EMULATOR_GPS = '-24.794977,-65.3756143';

export function parseLatLngPair(raw) {
  const [lat, lng] = String(raw || '').split(',').map((part) => Number(part.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat,
    lng,
    speed: 0,
    heading: 0,
    accuracy: 8,
  };
}

export function resolveEmulatorGpsSeed({
  isEmulator = false,
  raw = process.env.EXPO_PUBLIC_EMULATOR_GPS,
  fallback = DEFAULT_EMULATOR_GPS,
} = {}) {
  if (!isEmulator) return null;
  return parseLatLngPair(raw) || parseLatLngPair(fallback);
}
