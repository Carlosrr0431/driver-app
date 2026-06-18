/**
 * Mensajes legibles para status_detail de Paypertic.
 * Referencia: https://documentos.paypertic.com/pages/viewpage.action?pageId=40468591
 */

const PAYPERTIC_ERROR_MESSAGES = {
  '4000': 'La solicitud de pago no es válida.',
  '4018': 'El monto de la transacción no es válido.',
  '4034': 'Este comercio no acepta el medio de pago seleccionado.',
  '4205': 'Las cuotas seleccionadas no están permitidas.',
  '4212': 'El pago está vencido.',
  '4220': 'Este pago no puede reintentarse.',
  '4253': 'El monto adeudado no es válido.',
  '4268': 'Fondos insuficientes. Verificá el saldo de tu cuenta o tarjeta e intentá con otro medio de pago.',
  '4301': 'Pago no autorizado: superaste el límite de tu tarjeta.',
  '4302': 'Pago no autorizado: la tarjeta está vencida.',
  '4303': 'Pago no autorizado: el código de seguridad (CVV) es incorrecto.',
  '4304': 'Pago no autorizado: la tarjeta no es válida.',
  '4305': 'Pago no autorizado por el banco emisor.',
  '4307': 'No se pudo autenticar la operación.',
  '4308': 'La solicitud no fue aceptada por el procesador de pagos.',
  '4309': 'Error al procesar el pago. Intentá nuevamente en unos minutos.',
  '4310': 'La operación expiró por tiempo de espera.',
  '4314': 'La operación fue rechazada por el sistema antifraude.',
  '4318': 'Pago pendiente: falta completar el pago en efectivo.',
  '4319': 'Pago pendiente: falta completar el pago bancario.',
  '4400': 'Acceso denegado al procesar el pago.',
  '4401': 'No se pudo autenticar con el proveedor de pagos.',
  '5001': 'Error interno del proveedor de pagos. Intentá más tarde.',
};

const ENGLISH_PHRASES = [
  { match: /insufficient funds/i, code: '4268' },
  { match: /not authorized/i, code: '4305' },
  { match: /card expired/i, code: '4302' },
  { match: /invalid security code/i, code: '4303' },
  { match: /invalid card/i, code: '4304' },
  { match: /limit exceeded/i, code: '4301' },
  { match: /fraud/i, code: '4314' },
  { match: /timed out/i, code: '4310' },
];

export const REJECTED_PAYMENT_STATUSES = new Set([
  'rejected',
  'cancelled',
  'refunded',
  'overdue',
  'failed',
  'denied',
]);

export const isRejectedPaymentStatus = (status) =>
  REJECTED_PAYMENT_STATUSES.has(String(status || '').toLowerCase());

const extractErrorCode = (statusDetail) => {
  const raw = String(statusDetail || '').trim();
  if (!raw) return null;

  const leadingCode = raw.match(/^(\d{4})\b/);
  if (leadingCode) return leadingCode[1];

  if (/^\d{4}$/.test(raw)) return raw;

  return null;
};

export const resolvePayperticRejectionMessage = (statusDetail) => {
  const raw = String(statusDetail || '').trim();

  if (!raw) {
    return 'La operación no fue aprobada. Podés reintentar con otro medio de pago.';
  }

  const code = extractErrorCode(raw);
  if (code && PAYPERTIC_ERROR_MESSAGES[code]) {
    return PAYPERTIC_ERROR_MESSAGES[code];
  }

  for (const phrase of ENGLISH_PHRASES) {
    if (phrase.match.test(raw) && PAYPERTIC_ERROR_MESSAGES[phrase.code]) {
      return PAYPERTIC_ERROR_MESSAGES[phrase.code];
    }
  }

  if (!/^\d+$/.test(raw) && raw.length > 8) {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  return `La operación no fue aprobada (${raw}). Intentá nuevamente con otro medio de pago.`;
};

export const getPayperticRejectionTitle = (statusDetail) => {
  const code = extractErrorCode(statusDetail);
  if (code === '4268') return 'Fondos insuficientes';
  if (code === '4303') return 'Código de seguridad incorrecto';
  if (code === '4302') return 'Tarjeta vencida';
  if (code === '4304') return 'Tarjeta no válida';
  if (code === '4301') return 'Límite superado';
  if (code === '4314') return 'Operación rechazada';

  const raw = String(statusDetail || '').toLowerCase();
  if (raw.includes('insufficient funds')) return 'Fondos insuficientes';

  return 'Pago no acreditado';
};
