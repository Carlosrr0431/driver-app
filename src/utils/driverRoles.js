/** Mismo dominio que conductores regulares; sin "+" (Supabase Auth lo rechaza). */
const ASSIGNED_DRIVER_EMAIL_DOMAIN = 'profesional.test';

export function normalizeDriverPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  const ensureArgentinaMobile = (withCountryCode) => {
    const rest = withCountryCode.slice(2);
    if (rest.length === 11 && rest.startsWith('9')) {
      return `54${rest}`;
    }
    if (rest.length === 10) {
      return `549${rest}`;
    }
    return withCountryCode;
  };

  if (digits.startsWith('54')) {
    return ensureArgentinaMobile(digits);
  }

  if (digits.length === 11 && digits.startsWith('9')) {
    return `54${digits}`;
  }

  if (digits.length === 10) {
    return `549${digits}`;
  }

  if (digits.length < 10) {
    return ensureArgentinaMobile(`54${digits}`);
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

/** Códigos de área de 4 dígitos frecuentes en Salta (6 dígitos locales). */
const SALTA_INTERIOR_AREA_CODES = new Set(['3875', '3876', '3877', '3878']);

/**
 * Extrae 10 dígitos locales AR (área + número), sin 0 ni 54/549.
 * Ej: 3875345465 / 5493875345465 / +54 3875 345465 → 3875345465
 */
export function extractLocalArMobileDigits(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  while (digits.startsWith('0')) digits = digits.slice(1);

  let local = '';
  if (digits.startsWith('549')) {
    if (digits.length < 13) return '';
    local = digits.slice(3);
  } else if (digits.startsWith('54')) {
    if (digits.length < 12) return '';
    let rest = digits.slice(2);
    if (rest.startsWith('9') && rest.length >= 11) rest = rest.slice(1);
    local = rest;
  } else if (digits.startsWith('9') && digits.length === 11) {
    local = digits.slice(1);
  } else if (digits.length === 10) {
    local = digits;
  } else {
    return '';
  }

  if (/^\d{3}15\d{6,}$/.test(local)) {
    local = `${local.slice(0, 3)}${local.slice(5)}`;
  }

  local = local.slice(0, 10);
  if (!/^\d{10}$/.test(local)) return '';
  if (local.startsWith('54')) return '';
  if (local.startsWith('9') || local.startsWith('59')) return '';
  return local;
}

/** Dígitos locales para el input de login (máx. 10). `null` = pegado incompleto de +54, ignorar. */
export function sanitizeLoginPhoneInput(text) {
  const digits = String(text || '').replace(/\D/g, '');
  const local = extractLocalArMobileDigits(digits);
  if (local) return local;
  if (digits.startsWith('54') || (digits.startsWith('9') && digits.length > 11)) {
    return null;
  }
  return digits.slice(0, 10);
}

/**
 * Agrupa área + número para el input.
 * 3875 345465 (4+6) · 387 8630173 (3+7) · 11 4444 5555
 */
export function formatLocalArMobileDisplay(digits) {
  const d = String(digits || '').replace(/\D/g, '').slice(0, 10);
  if (!d) return '';

  if (d.startsWith('11')) {
    if (d.length <= 2) return d;
    if (d.length <= 6) return `${d.slice(0, 2)} ${d.slice(2)}`;
    return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  }

  const area4 = d.slice(0, 4);
  if (SALTA_INTERIOR_AREA_CODES.has(area4)) {
    return d.length <= 4 ? d : `${area4} ${d.slice(4)}`;
  }

  if (d.length <= 3) return d;
  return `${d.slice(0, 3)} ${d.slice(3)}`;
}

export function isCompleteLocalArMobile(phone) {
  return extractLocalArMobileDigits(phone).length === 10;
}

export function formatLoginPhoneHint(phone) {
  const local = extractLocalArMobileDigits(phone)
    || String(phone || '').replace(/\D/g, '').slice(0, 10);
  if (!local) return '';
  return `+54 ${formatLocalArMobileDisplay(local)}`;
}

/** Parte el local en área + número para la guía visual del login. */
export function splitLocalArMobileParts(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(0, 10);
  if (digits.startsWith('11')) {
    return {
      digits,
      area: digits.slice(0, Math.min(2, digits.length)),
      number: digits.slice(2),
      areaSize: 2,
      numberSize: 8,
    };
  }

  const area4 = digits.slice(0, 4);
  if (SALTA_INTERIOR_AREA_CODES.has(area4) || (digits.startsWith('387') && digits.length >= 4 && '5678'.includes(digits[3]))) {
    return {
      digits,
      area: digits.slice(0, Math.min(4, digits.length)),
      number: digits.slice(4),
      areaSize: 4,
      numberSize: 6,
    };
  }

  return {
    digits,
    area: digits.slice(0, Math.min(3, digits.length)),
    number: digits.slice(3),
    areaSize: 3,
    numberSize: 7,
  };
}

/**
 * Mensajes del login: cómo cargar el teléfono y qué está mal.
 * status: idle | typing | ok | error
 */
export function getLoginPhoneGuidance(phone, options = {}) {
  const submitted = Boolean(options.submitted);
  const blockedCountryPaste = Boolean(options.blockedCountryPaste);
  const digits = String(phone || '').replace(/\D/g, '');
  const local = extractLocalArMobileDigits(phone);

  if (blockedCountryPaste) {
    return {
      status: 'error',
      title: 'El +54 ya está puesto',
      message: 'No pegues el 54. Escribí solo el código de área y el número, por ejemplo 3875 345465.',
    };
  }

  if (local) {
    return {
      status: 'ok',
      title: 'Número listo',
      message: `Quedó +54 ${formatLocalArMobileDisplay(local)}. Así está bien.`,
    };
  }

  if (!digits) {
    return {
      status: submitted ? 'error' : 'idle',
      title: submitted ? 'Falta el teléfono' : '',
      message: submitted
        ? 'Cargá el código de área y el número. El +54 ya está. Ejemplo: 3875 y después 345465.'
        : 'Solo el área y el número. Sin 0, sin 15 y sin +54.',
    };
  }

  if (digits.startsWith('0')) {
    return {
      status: 'error',
      title: 'Sacá el 0 del principio',
      message: 'No pongas 0 ni 0387. Empezá con el código de área, por ejemplo 3875, y después los 6 dígitos.',
    };
  }

  if (digits.startsWith('54')) {
    return {
      status: 'error',
      title: 'El +54 ya está puesto',
      message: 'No repitas el 54. Solo cargá el área y el número: 3875 345465.',
    };
  }

  if (digits.startsWith('15')) {
    return {
      status: 'error',
      title: 'No hace falta el 15',
      message: 'En celulares no se usa 15. Cargá el área (3875) y el número de 6 dígitos.',
    };
  }

  if (/^\d{3}15/.test(digits) && !SALTA_INTERIOR_AREA_CODES.has(digits.slice(0, 4))) {
    return {
      status: 'error',
      title: 'No pongas el 15 después del área',
      message: 'Después de 387 va el número directo, sin 15. Ejemplo: 387 8630173.',
    };
  }

  if (digits.startsWith('9') && digits.length >= 2 && '38'.includes(digits[1])) {
    return {
      status: 'error',
      title: 'No pongas el 9 adelante',
      message: 'El 9 de celular no hace falta. Empezá con el área, por ejemplo 3875 345465.',
    };
  }

  if (digits.length < 10) {
    const missing = 10 - digits.length;
    return {
      status: submitted ? 'error' : 'typing',
      title: submitted ? 'El número está incompleto' : '',
      message: submitted
        ? `Te faltan ${missing} dígito${missing === 1 ? '' : 's'}. Son 10 en total: código de área + número, sin 0 ni +54. Ejemplo: 3875 345465.`
        : `Llevás ${digits.length} de 10. Completá el área y el número, por ejemplo 3875 345465.`,
    };
  }

  return {
    status: 'error',
    title: 'Este número no es válido',
    message: 'Usá 10 dígitos: código de área (387 o 3875) y el número. Sin 0, sin 15 y sin +54.',
  };
}

const LOGIN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SYNTHETIC_AUTH_DOMAIN = `@${ASSIGNED_DRIVER_EMAIL_DOMAIN}`;

export function normalizeLoginEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isCompleteLoginEmail(value) {
  return LOGIN_EMAIL_RE.test(normalizeLoginEmail(value));
}

export function isSyntheticAuthEmail(value) {
  return normalizeLoginEmail(value).endsWith(SYNTHETIC_AUTH_DOMAIN);
}

export function looksLikeLoginEmail(value) {
  const raw = String(value || '');
  if (raw.includes('@')) return true;
  return /[a-zA-Z]/.test(raw);
}

export function classifyLoginIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) return { kind: 'empty', raw: '' };
  if (looksLikeLoginEmail(raw)) {
    const email = normalizeLoginEmail(raw);
    return { kind: 'email', raw, email };
  }
  return { kind: 'phone', raw };
}

export function sanitizeLoginIdentifierInput(text) {
  const classified = classifyLoginIdentifier(text);
  if (classified.kind === 'email') {
    return String(text || '').replace(/\s+/g, '');
  }
  return sanitizeLoginPhoneInput(text);
}

export function isCompleteLoginIdentifier(value) {
  const classified = classifyLoginIdentifier(value);
  if (classified.kind === 'email') {
    return isCompleteLoginEmail(classified.email) && !isSyntheticAuthEmail(classified.email);
  }
  if (classified.kind === 'phone') return isCompleteLocalArMobile(value);
  return false;
}

/**
 * Feedback corto del input unificado (teléfono o correo).
 * status: idle | typing | ok | error
 */
export function getLoginIdentifierGuidance(value, options = {}) {
  const submitted = Boolean(options.submitted);
  const blockedCountryPaste = Boolean(options.blockedCountryPaste);
  const classified = classifyLoginIdentifier(value);

  if (!classified.raw) {
    return {
      status: submitted ? 'error' : 'idle',
      message: submitted ? 'Ingresá tu teléfono o correo.' : '',
    };
  }

  if (classified.kind === 'email') {
    if (isSyntheticAuthEmail(classified.email)) {
      return { status: 'error', message: 'Usá tu correo personal.' };
    }
    if (isCompleteLoginEmail(classified.email)) {
      return { status: 'ok', message: 'Correo listo.' };
    }
    if (submitted || classified.email.includes('@')) {
      return {
        status: submitted ? 'error' : 'typing',
        message: submitted ? 'El correo no es válido.' : '',
      };
    }
    return { status: submitted ? 'error' : 'typing', message: submitted ? 'Completá el correo.' : '' };
  }

  const phoneGuidance = getLoginPhoneGuidance(value, { submitted, blockedCountryPaste });
  if (phoneGuidance.status === 'idle' && !submitted) {
    return { status: 'idle', message: '' };
  }
  if (phoneGuidance.status === 'ok') {
    return { status: 'ok', message: 'Número listo.' };
  }
  if (phoneGuidance.status === 'typing') {
    return { status: 'typing', message: '' };
  }
  return {
    status: 'error',
    message: phoneGuidance.title || phoneGuidance.message,
  };
}

export function buildAssignedDriverAuthEmail(normalizedPhone) {
  return `assigned.${normalizedPhone}@${ASSIGNED_DRIVER_EMAIL_DOMAIN}`;
}

/** Email sintético para dueño/titular (único por número de móvil). */
export function buildOwnerAuthEmail(normalizedPhone, driverNumber = null) {
  if (driverNumber != null && String(driverNumber).trim() !== '') {
    return `owner.${driverNumber}@${ASSIGNED_DRIVER_EMAIL_DOMAIN}`;
  }
  return `owner.${normalizedPhone}@${ASSIGNED_DRIVER_EMAIL_DOMAIN}`;
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
  return Boolean(driver?.owner_id)
    || driver?.is_assigned_driver === true
    || driver?.isAssignedDriver === true;
}

/** Titular raíz de flota (dueño del móvil), sin importar role legacy. */
export function isFleetRoot(driver) {
  return Boolean(driver?.id) && !isAssignedDriver(driver) && !driver?.owner_id;
}

export function isFleetOwner(driver) {
  return isFleetRoot(driver) && driver?.role === 'owner';
}

/** Ingresa con teléfono (titular o chofer asignado), no con email. */
export function usesPhoneLogin(driver) {
  if (!driver?.id) return false;
  if (isAssignedDriver(driver)) return true;
  return isFleetOwner(driver) || Boolean(driver?.phone_normalized && driver?.auth_email);
}

export const MAX_ASSIGNED_DRIVERS = 3;
