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

