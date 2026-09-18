import { supabase } from './supabase';
import { normalizeDriverPhone, normalizeLoginEmail } from '../utils/driverRoles';

const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://profesional-dashboard.vercel.app';

/** Lookup unificado: dueño o chofer asignado. */
export async function lookupDriverPhoneLogin(phone, driverNumber = null, loginKind = null) {
  const params = {
    p_phone: normalizeDriverPhone(phone) || phone,
  };
  if (driverNumber != null && Number.isFinite(Number(driverNumber))) {
    params.p_driver_number = Number(driverNumber);
  }
  if (loginKind === 'owner' || loginKind === 'assigned') {
    params.p_login_kind = loginKind;
  }

  const { data, error } = await supabase.rpc('lookup_driver_phone_login', params);

  if (error) throw error;
  return data || { found: false };
}

export async function lookupDriverEmailLogin(email) {
  const { data, error } = await supabase.rpc('lookup_driver_email_login', {
    p_email: normalizeLoginEmail(email),
  });

  if (error) throw error;
  return data || { found: false };
}

export async function lookupAssignedDriverLogin(phone, driverNumber = null) {
  const params = {
    p_phone: normalizeDriverPhone(phone) || phone,
  };
  if (driverNumber != null && Number.isFinite(Number(driverNumber))) {
    params.p_driver_number = Number(driverNumber);
  }

  const { data, error } = await supabase.rpc('lookup_assigned_driver_login', params);

  if (error) throw error;
  return data || { found: false };
}

function isOwnerLookupPending(result) {
  return Boolean(
    result?.needs_driver_number
    && Array.isArray(result.choices)
    && result.choices.length > 0,
  );
}

/**
 * Detecta si el teléfono corresponde a chofer asignado, propietario, o ambos.
 * No muta los resultados del RPC.
 */
export function detectDriverLoginKind(assignedResult, ownerResult) {
  const assignedFound = Boolean(assignedResult?.found);
  const ownerFound = Boolean(ownerResult?.found);
  const ownerPending = isOwnerLookupPending(ownerResult);

  if (assignedFound && (ownerFound || ownerPending)) {
    return {
      kind: 'ambiguous',
      assigned: assignedResult,
      owner: ownerResult,
    };
  }
  if (assignedFound) {
    return { kind: 'assigned', result: assignedResult };
  }
  if (ownerPending || ownerFound) {
    return { kind: 'owner', result: ownerResult };
  }
  return { kind: null, result: { found: false } };
}

/** Lookup unificado: dueño y asignado en paralelo, sin que el usuario elija el tipo. */
export async function resolveUnifiedDriverPhoneLogin(phone, driverNumber = null) {
  const [assigned, owner] = await Promise.all([
    lookupDriverPhoneLogin(phone, driverNumber, 'assigned'),
    lookupDriverPhoneLogin(phone, driverNumber, 'owner'),
  ]);

  const detected = detectDriverLoginKind(assigned, owner);
  if (detected.kind === 'ambiguous') {
    return {
      found: false,
      needs_account_choice: true,
      assigned: detected.assigned,
      owner: detected.owner,
    };
  }
  return detected.result || { found: false };
}

/**
 * Primera configuración de contraseña vía dashboard (admin API, sin enviar emails).
 */
export async function provisionDriverPhoneAuth({ driverId, phone, password }) {
  const response = await fetch(`${DASHBOARD_URL}/api/auth/driver-phone/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      driverId,
      phone: normalizeDriverPhone(phone) || phone,
      password,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.message || `Error del servidor (${response.status})`);
    error.httpStatus = response.status;
    throw error;
  }

  return payload;
}

export async function provisionDriverEmailAuth({ driverId, email, password }) {
  const response = await fetch(`${DASHBOARD_URL}/api/auth/driver-email/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      driverId,
      email: normalizeLoginEmail(email),
      password,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.message || `Error del servidor (${response.status})`);
    error.httpStatus = response.status;
    throw error;
  }

  return payload;
}

/** @deprecated Usar provisionDriverPhoneAuth */
export async function provisionAssignedDriverAuth(params) {
  return provisionDriverPhoneAuth(params);
}

export async function linkAssignedDriverUser(driverId) {
  const { data, error } = await supabase.rpc('link_assigned_driver_user', {
    p_driver_id: driverId,
  });

  if (error) throw error;
  if (!data?.success) {
    throw new Error(data?.error || 'No se pudo vincular la cuenta del chofer asignado');
  }
  return data;
}

export async function markAssignedDriverPasswordInitialized(driverId) {
  const { error } = await supabase.rpc('mark_assigned_driver_password_initialized', {
    p_driver_id: driverId,
  });
  if (error) throw error;
}

export async function setDriverOnlineStatus(driverId, isOnline) {
  const { data, error } = await supabase.rpc('set_driver_online_status', {
    p_driver_id: driverId,
    p_online: isOnline,
  });

  if (error) throw error;
  if (!data?.success) {
    throw new Error(data?.error || 'No se pudo cambiar el estado en línea');
  }
  return data;
}

export async function fetchOwnerVehicleProfile(ownerId) {
  if (!ownerId) return null;
  const { data, error } = await supabase
    .from('drivers')
    .select('full_name, phone, vehicle_brand, vehicle_model, vehicle_plate, vehicle_color, vehicle_photo_url, vehicle_type, driver_number')
    .eq('id', ownerId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Perfil completo del dueño del vehículo (siempre desde BD, no del store en caché). */
export async function fetchFleetOwnerProfile(ownerId) {
  if (!ownerId) return null;

  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('id', ownerId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id || data.is_assigned_driver || data.owner_id) return null;
  return data;
}
