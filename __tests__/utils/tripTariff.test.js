import {
  resolveTariffFromSettingsMap,
  calculateTripPrice,
  calculateTripCommission,
  resolveCommissionPercent,
} from '../../src/utils/tripTariff';

describe('tripTariff', () => {
  const platformSettings = {
    platform_tariff_per_km: 600,
    platform_tariff_base: 0,
    platform_commission_percent: 50,
    passenger_app_tariff_per_km: 1000,
    passenger_app_tariff_base: 0,
    passenger_app_commission_percent: 50,
  };

  it('usa tarifa de plataforma para viajes WhatsApp', () => {
    const tariff = resolveTariffFromSettingsMap(platformSettings);
    expect(tariff.source).toBe('platform');
    expect(tariff.perKm).toBe(600);
    expect(tariff.commission).toBe(50);
    expect(calculateTripPrice({ ...tariff, distanceKm: 5 })).toBe(3000);
    expect(calculateTripCommission({ price: 3000, commissionPercent: tariff.commission })).toBe(1500);
  });

  it('usa tarifa de plataforma para viajes del dashboard', () => {
    const tariff = resolveTariffFromSettingsMap(platformSettings);
    expect(tariff.perKm).toBe(600);
    expect(tariff.commission).toBe(50);
  });

  it('ignora tarifas de app pasajeros en viajes de plataforma', () => {
    const settings = {
      platform_tariff_per_km: 600,
      platform_tariff_base: 0,
      platform_commission_percent: 50,
      passenger_app_tariff_per_km: 9999,
      passenger_app_commission_percent: 99,
    };
    const tariff = resolveTariffFromSettingsMap(settings);
    expect(tariff.perKm).toBe(600);
    expect(resolveCommissionPercent(settings)).toBe(50);
  });

  it('usa tarifa de app pasajeros para viajes passenger_app', () => {
    const settings = {
      platform_tariff_per_km: 600,
      platform_tariff_base: 500,
      platform_commission_percent: 50,
      passenger_app_tariff_per_km: 1000,
      passenger_app_tariff_base: 0,
      passenger_app_commission_percent: 50,
    };
    const trip = { notes: '[PASSENGER_APP] [APPROACH_ONLY]' };
    const tariff = resolveTariffFromSettingsMap(settings, { trip });
    expect(tariff.source).toBe('passenger_app');
    expect(tariff.perKm).toBe(1000);
    expect(tariff.commission).toBe(50);
    expect(calculateTripPrice({ ...tariff, distanceKm: 5 })).toBe(5000);
  });
});
