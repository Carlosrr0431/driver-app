/**
 * shared/driver-billing.js
 *
 * Modos de cobro de choferes y elegibilidad para recibir viajes (dispatch).
 *
 * - commission_current: cobro por comisiones con gracia de 3 días desde
 *   commission_debt_since_at. Si vence → no recibe viajes.
 * - weekly_traditional: cobro semanal tradicional. Siempre puede recibir
 *   viajes salvo bloqueo manual (commission_blocked).
 *
 * Compatible con CommonJS (jest / next sin transformación extra).
 */

const BILLING_MODE_COMMISSION = 'commission_current';
const BILLING_MODE_WEEKLY = 'weekly_traditional';
const COMMISSION_GRACE_DAYS = 3;

const BILLING_MODE_LABELS = {
  [BILLING_MODE_COMMISSION]: 'Comisiones (3 días)',
  [BILLING_MODE_WEEKLY]: 'Cobro semanal',
};

function normalizeBillingMode(mode) {
  if (mode === BILLING_MODE_WEEKLY) return BILLING_MODE_WEEKLY;
  return BILLING_MODE_COMMISSION;
}

function isWeeklyBillingMode(mode) {
  return normalizeBillingMode(mode) === BILLING_MODE_WEEKLY;
}

/**
 * Deuda vencida: pending > 0 y commission_debt_since_at hace más de 3 días.
 * Si debt_since es null, aún no empezó a contar (no vencida).
 */
function resolveCommissionOverdue(driver, now = new Date()) {
  const pending = Math.max(0, Number(driver?.pending_commission) || 0);
  if (pending <= 0) return false;

  const debtSinceRaw = driver?.commission_debt_since_at;
  if (!debtSinceRaw) return false;

  const debtSince = new Date(debtSinceRaw);
  if (Number.isNaN(debtSince.getTime())) return false;

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - COMMISSION_GRACE_DAYS);
  return debtSince < cutoff;
}

/**
 * ¿Puede recibir ofertas de viaje?
 * - commission_blocked (manual) siempre excluye.
 * - weekly: siempre elegible salvo bloqueo manual.
 * - commission: elegible si no está vencido.
 */
function isDriverEligibleForDispatch(driver, now = new Date()) {
  if (!driver) return false;
  if (driver.commission_blocked === true) return false;

  if (isWeeklyBillingMode(driver.billing_mode)) return true;

  return !resolveCommissionOverdue(driver, now);
}

function isDriverDispatchBlocked(driver, now = new Date()) {
  return !isDriverEligibleForDispatch(driver, now);
}

/**
 * Motivo de bloqueo para UI / logs.
 * @returns {'manual'|'commission_overdue'|null}
 */
function resolveDispatchBlockReason(driver, now = new Date()) {
  if (!driver) return null;
  if (driver.commission_blocked === true) return 'manual';
  if (isWeeklyBillingMode(driver.billing_mode)) return null;
  if (resolveCommissionOverdue(driver, now)) return 'commission_overdue';
  return null;
}

module.exports = {
  BILLING_MODE_COMMISSION,
  BILLING_MODE_WEEKLY,
  BILLING_MODE_LABELS,
  COMMISSION_GRACE_DAYS,
  normalizeBillingMode,
  isWeeklyBillingMode,
  resolveCommissionOverdue,
  isDriverEligibleForDispatch,
  isDriverDispatchBlocked,
  resolveDispatchBlockReason,
};
