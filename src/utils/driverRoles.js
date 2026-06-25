/** Mismo dominio que conductores regulares; sin "+" (Supabase Auth lo rechaza). */
const ASSIGNED_DRIVER_EMAIL_DOMAIN = 'profesional.test';

export function normalizeDriverPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length <= 10 && !digits.startsWith('54')) {
    digits = `54${digits}`;
  }
  return digits;
}

export function formatPhoneForDisplay(phone) {
  const normalized = normalizeDriverPhone(phone);
  if (!normalized) return '';
  if (normalized.startsWith('54') && normalized.length >= 12) {
    return `+${normalized.slice(0, 2)} ${normalized.slice(2)}`;
  }
  return `+${normalized}`;
}

export function buildAssignedDriverAuthEmail(normalizedPhone) {
  return `assigned.${normalizedPhone}@${ASSIGNED_DRIVER_EMAIL_DOMAIN}`;
}

export function isAssignedDriver(driver) {
  return Boolean(driver?.owner_id) || driver?.is_assigned_driver === true;
}

export function isFleetOwner(driver) {
  return driver?.role === 'owner' && !driver?.owner_id;
}

export const MAX_ASSIGNED_DRIVERS = 3;
