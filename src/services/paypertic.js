import { supabase } from './supabase';

const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://profesional-dashboard.vercel.app';

/**
 * Crea una sesión de pago en Paypertic y devuelve la form_url para mostrar en el WebView.
 *
 * @param {number} amount - Monto en ARS
 * @returns {{ form_url: string, payment_id: string, external_transaction_id: string }}
 */
export async function createPaymentSession(amount) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('No hay sesión activa');
  }

  const response = await fetch(`${DASHBOARD_URL}/api/paypertic`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ amount }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Error al iniciar el pago');
  }

  if (!data.form_url) {
    throw new Error('No se recibió la URL del formulario de pago');
  }

  return data;
}

/**
 * Consulta estado de una sesión de pago en Paypertic.
 *
 * @param {string} paymentId
 * @returns {{
 *   id: string,
 *   status: string,
 *   status_detail?: string,
 *   final_amount?: number,
 *   process_date?: string,
 *   paid_date?: string,
 *   external_transaction_id?: string,
 *   receipt_url?: string | null
 * }}
 */
export async function getPaymentStatus(paymentId) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('No hay sesión activa');
  }

  if (!paymentId) {
    throw new Error('payment_id inválido');
  }

  const response = await fetch(
    `${DASHBOARD_URL}/api/paypertic?payment_id=${encodeURIComponent(paymentId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Error al consultar estado del pago');
  }

  return data;
}

