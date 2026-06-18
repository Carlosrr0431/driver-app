const DEFAULT_TARIFF_PER_KM = 600;
const DEFAULT_COMMISSION_PERCENT = 10;

const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://profesional-dashboard.vercel.app';

/** Tarifa activa de plataforma (todos los viajes operativos). */
export const PLATFORM_TARIFF_SETTING_KEYS = [
  'platform_tariff_per_km',
  'platform_tariff_base',
  'platform_commission_percent',
];

/** Tarifa activa para viajes de la app de pasajeros. */
export const PASSENGER_APP_TARIFF_SETTING_KEYS = [
  'passenger_app_tariff_per_km',
  'passenger_app_tariff_base',
  'passenger_app_commission_percent',
];

export const TARIFF_SETTING_KEYS = [
  ...PLATFORM_TARIFF_SETTING_KEYS,
  ...PASSENGER_APP_TARIFF_SETTING_KEYS,
];

export function parseSettingNumber(rawValue) {
  const normalized = String(rawValue ?? '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function settingsRowsToMap(rows = []) {
  const map = {};
  rows.forEach((row) => {
    const key = String(row?.key || '').trim().toLowerCase();
    if (key) map[key] = parseSettingNumber(row?.value);
  });
  return map;
}

export function settingsObjectToMap(rawMap = {}) {
  const map = {};
  Object.entries(rawMap).forEach(([key, value]) => {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (normalizedKey) map[normalizedKey] = parseSettingNumber(value);
  });
  return map;
}

export function resolveCommissionPercent(settingsMap) {
  const platformCommission = parseSettingNumber(settingsMap.platform_commission_percent);
  if (platformCommission > 0) return platformCommission;
  return DEFAULT_COMMISSION_PERCENT;
}

function resolvePassengerAppCommissionPercent(settingsMap) {
  const commission = parseSettingNumber(settingsMap.passenger_app_commission_percent);
  if (commission > 0) return commission;
  return DEFAULT_COMMISSION_PERCENT;
}

function isPassengerAppTrip(trip) {
  return String(trip?.notes || '').includes('[PASSENGER_APP]');
}

export function resolvePassengerAppTariff(settingsMap, { defaultPerKm = DEFAULT_TARIFF_PER_KM } = {}) {
  const perKm = parseSettingNumber(settingsMap.passenger_app_tariff_per_km);
  const base = parseSettingNumber(settingsMap.passenger_app_tariff_base) || 0;
  const commission = resolvePassengerAppCommissionPercent(settingsMap);

  return {
    base,
    perKm: perKm > 0 ? perKm : defaultPerKm,
    commission,
    source: 'passenger_app',
  };
}

/** Viajes de plataforma usan tarifa platform_*; viajes de app pasajeros usan passenger_app_*. */
export function resolveTariffFromSettingsMap(
  settingsMap,
  { defaultPerKm = DEFAULT_TARIFF_PER_KM, trip = null } = {}
) {
  if (trip && isPassengerAppTrip(trip)) {
    return resolvePassengerAppTariff(settingsMap, { defaultPerKm });
  }

  const perKm = parseSettingNumber(settingsMap.platform_tariff_per_km);
  const base = parseSettingNumber(settingsMap.platform_tariff_base) || 0;
  const commission = resolveCommissionPercent(settingsMap);

  return {
    base,
    perKm: perKm > 0 ? perKm : defaultPerKm,
    commission,
    source: 'platform',
  };
}

export function calculateTripPrice({ base, perKm, distanceKm }) {
  const dist = Number(distanceKm);
  if (!Number.isFinite(dist) || dist <= 0) return 0;
  return Math.round((Number(base) || 0) + (Number(perKm) || 0) * dist);
}

export function calculateTripCommission({ price, commissionPercent }) {
  const totalPrice = Number(price);
  const pct = Number(commissionPercent);
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) return 0;
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return Math.round(totalPrice * pct / 100);
}

async function fetchTariffSettingsFromDashboard() {
  const response = await fetch(`${DASHBOARD_URL}/api/tariff-settings`, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || 'No se pudieron cargar las tarifas del servidor');
  }
  return settingsObjectToMap(payload?.data || {});
}

async function fetchTariffSettingsFromSupabase(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', TARIFF_SETTING_KEYS);

  if (error) throw error;

  const map = settingsRowsToMap(data);

  if (!parseSettingNumber(map.platform_tariff_per_km)) {
    const { data: perKmRow } = await supabase
      .from('settings')
      .select('key, value')
      .ilike('key', 'platform_tariff_per_km')
      .limit(1)
      .maybeSingle();
    map.platform_tariff_per_km = parseSettingNumber(perKmRow?.value);
  }

  return map;
}

function tariffSettingsLookEmpty(map, keys) {
  return keys.every((key) => map[key] == null || map[key] === undefined);
}

export async function fetchTariffForTrip(supabase, trip, { defaultPerKm = DEFAULT_TARIFF_PER_KM } = {}) {
  const keysForTrip = trip && isPassengerAppTrip(trip)
    ? PASSENGER_APP_TARIFF_SETTING_KEYS
    : PLATFORM_TARIFF_SETTING_KEYS;

  let map = {};

  try {
    map = await fetchTariffSettingsFromSupabase(supabase);
  } catch (error) {
    console.warn('[tripTariff] Error leyendo settings desde Supabase:', error?.message || error);
  }

  if (tariffSettingsLookEmpty(map, keysForTrip)) {
    try {
      map = await fetchTariffSettingsFromDashboard();
    } catch (error) {
      console.warn('[tripTariff] Error leyendo tarifas desde dashboard:', error?.message || error);
    }
  }

  return resolveTariffFromSettingsMap(map, { defaultPerKm, trip });
}
