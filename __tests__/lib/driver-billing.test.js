const {
  BILLING_MODE_COMMISSION,
  BILLING_MODE_WEEKLY,
  shouldShowCommissionDebtUi,
} = require('../../shared/driver-billing');

describe('shouldShowCommissionDebtUi (driver-app)', () => {
  test('oculta el cartel con plan semanal aunque haya saldo', () => {
    expect(shouldShowCommissionDebtUi({
      billing_mode: BILLING_MODE_WEEKLY,
      pending_commission: 1500,
    })).toBe(false);
  });

  test('muestra el cartel solo con plan de comisiones', () => {
    expect(shouldShowCommissionDebtUi({
      billingMode: BILLING_MODE_COMMISSION,
      balance: 1500,
    })).toBe(true);
  });
});
