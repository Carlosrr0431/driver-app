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

/** Datos compartidos del vehículo y número de móvil del dueño al crear un asignado. */
export function buildAssignedDriverInsertPayload(owner, { fullName, phone, phoneNormalized, authEmail }) {
  const root = owner || {};
  return {
    owner_id: root.id,
    user_id: null,
    role: 'driver',
    is_assigned_driver: true,
    password_initialized: false,
    full_name: String(fullName || '').trim(),
    phone: String(phone || '').trim(),
    phone_normalized: phoneNormalized,
    auth_email: authEmail,
    driver_number: root.driver_number ?? null,
    vehicle_brand: root.vehicle_brand ?? null,
    vehicle_model: root.vehicle_model ?? null,
    vehicle_year: root.vehicle_year ?? null,
    vehicle_plate: root.vehicle_plate ?? null,
    vehicle_color: root.vehicle_color ?? null,
    vehicle_photo_url: root.vehicle_photo_url ?? null,
    vehicle_type: root.vehicle_type || 'auto',
    is_available: false,
    rating: 5.0,
    total_trips: 0,
    total_km: 0,
  };
}

export function isAssignedDriver(driver) {
  return Boolean(driver?.owner_id) || driver?.is_assigned_driver === true;
}

export function isFleetOwner(driver) {
  return driver?.role === 'owner' && !driver?.owner_id;
}

export const MAX_ASSIGNED_DRIVERS = 3;
