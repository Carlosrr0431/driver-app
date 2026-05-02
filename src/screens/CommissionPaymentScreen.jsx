import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  AppState,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { colors } from '../theme/colors';
import { formatPrice } from '../utils/formatters';
import { createPaymentSession, getPaymentStatus } from '../services/paypertic';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../services/supabase';

// URL prefix que usa el dashboard como return_url / back_url
const RETURN_URL_PREFIX = 'https://profesional-dashboard.vercel.app/api/paypertic/return';

// JS inyectado en el WebView: detecta la URL de retorno desde adentro
// sin depender de eventos de navegación nativos (más confiable en Android)
const INJECTED_JS = `
  (function() {
    var handled = false;
    var notifyIfReturnUrl = function() {
      try {
        var href = window.location.href || '';
        if (handled) return;
        if (href.indexOf('${RETURN_URL_PREFIX}') === 0) {
          handled = true;
          var search = href.indexOf('?') >= 0 ? href.slice(href.indexOf('?') + 1) : '';
          var params = new URLSearchParams(search);
          var status = params.get('status') || 'unknown';
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'paypertic_result', status: status }));
        }
      } catch(e) {}
    };

    var originalPush = history.pushState;
    history.pushState = function() {
      originalPush.apply(history, arguments);
      notifyIfReturnUrl();
    };

    var originalReplace = history.replaceState;
    history.replaceState = function() {
      originalReplace.apply(history, arguments);
      notifyIfReturnUrl();
    };

    window.addEventListener('popstate', notifyIfReturnUrl);
    window.addEventListener('hashchange', notifyIfReturnUrl);
    document.addEventListener('DOMContentLoaded', notifyIfReturnUrl);
    notifyIfReturnUrl();
  })();
  true;
`;

export default function CommissionPaymentScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const queryClient = useQueryClient();
  const { driver } = useAuthStore();

  const { commissionData } = route.params || {};
  const balance = commissionData?.balance || 0;
  const isOverdue = commissionData?.isOverdue || false;
  const balanceColor = isOverdue ? '#282e69' : '#D97706';

  // Estados: 'idle' | 'loading' | 'webview' | 'approved' | 'rejected'
  const [phase, setPhase] = useState('idle');
  const [formUrl, setFormUrl] = useState(null);
  const [paymentId, setPaymentId] = useState(null);
  // Evita procesar el return_url dos veces (onNavigationStateChange dispara en loading y loaded)
  const returnHandled = useRef(false);

  const resetToIdle = () => {
    setPhase('idle');
    setFormUrl(null);
    setPaymentId(null);
  };

  const markAsApproved = () => {
    if (returnHandled.current) return;
    returnHandled.current = true;
    queryClient.invalidateQueries({ queryKey: ['commissionBalance', driver?.id] });
    setPhase('approved');
  };

  const verifyPaymentByProviderStatus = async (showPendingToast = false) => {
    if (!paymentId || !driver?.id) return false;

    try {
      const payment = await getPaymentStatus(paymentId);
      const status = (payment?.status || '').toLowerCase();

      if (status === 'approved') {
        markAsApproved();
        return true;
      }

      if (status === 'rejected' || status === 'cancelled' || status === 'refunded' || status === 'overdue') {
        returnHandled.current = true;
        resetToIdle();
        Toast.show({
          type: 'error',
          text1: 'Pago no acreditado',
          text2: payment?.status_detail || 'La operacion no fue aprobada.',
          visibilityTime: 4500,
        });
        return true;
      }

      if (showPendingToast) {
        Toast.show({
          type: 'info',
          text1: 'Pago en proceso',
          text2: `Estado actual: ${status || 'pending'}`,
          visibilityTime: 3000,
        });
      }
    } catch {
      // Puede fallar por red momentaneamente, seguimos con fallback local
    }

    return false;
  };

  const verifyPaymentByDriverBalance = async (showPendingToast = false) => {
    if (!driver?.id) return;
    try {
      const { data, error } = await supabase
        .from('drivers')
        .select('pending_commission')
        .eq('id', driver.id)
        .single();

      if (error) return;

      const pending = Number(data?.pending_commission) || 0;
      if (pending <= 0) {
        markAsApproved();
        return;
      }

      if (showPendingToast) {
        Toast.show({
          type: 'info',
          text1: 'Pago en verificación',
          text2: 'Todavía estamos esperando la confirmación del banco.',
          visibilityTime: 3000,
        });
      }
    } catch {
      // error de red temporal, ignorar y reintentar en el próximo ciclo
    }
  };

  // Escuchar Supabase Realtime: cuando el webhook registra el pago en commission_payments,
  // la app lo detecta aunque Paypertic no redirija al return_url
  useEffect(() => {
    if (phase !== 'webview' || !driver?.id) return;

    const channel = supabase
      .channel(`commission-payment-${driver.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'commission_payments',
          filter: `driver_id=eq.${driver.id}`,
        },
        () => markAsApproved(),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'drivers',
          filter: `id=eq.${driver.id}`,
        },
        (payload) => {
          const pending = Number(payload?.new?.pending_commission) || 0;
          if (pending <= 0) {
            markAsApproved();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [phase, driver?.id, queryClient]);

  // Validación puntual al abrir y al volver de background, sin polling.
  useEffect(() => {
    if (phase !== 'webview' || !driver?.id) return;

    const runVerification = async (showPendingToast = false) => {
      const statusHandled = await verifyPaymentByProviderStatus(showPendingToast);
      if (!statusHandled) {
        await verifyPaymentByDriverBalance(showPendingToast);
      }
    };

    runVerification(false);

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        runVerification(false);
      }
    });

    return () => {
      appStateSub.remove();
    };
  }, [phase, driver?.id, paymentId]);

  const handlePayperticMessage = (event) => {
    if (returnHandled.current) return;
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type !== 'paypertic_result') return;
      if (data.status === 'approved') {
        markAsApproved();
      } else {
        returnHandled.current = true;
        resetToIdle();
      }
    } catch {
      // mensaje no válido, ignorar
    }
  };

  const handleNavigationChange = (navState) => {
    const url = navState.url || '';
    if (!url.startsWith(RETURN_URL_PREFIX)) return;
    if (returnHandled.current) return;

    try {
      const urlObj = new URL(url);
      const status = urlObj.searchParams.get('status');
      if (status === 'approved') {
        markAsApproved();
      } else {
        returnHandled.current = true;
        resetToIdle();
      }
    } catch {
      resetToIdle();
    }
  };

  const handleStart = async () => {
    returnHandled.current = false;
    setPhase('loading');
    try {
      const { form_url, payment_id } = await createPaymentSession(balance);
      setFormUrl(form_url);
      setPaymentId(payment_id || null);
      setPhase('webview');
    } catch (err) {
      resetToIdle();
      Toast.show({ type: 'error', text1: 'Error al iniciar el pago', text2: err.message, visibilityTime: 4000 });
    }
  };


  // ── Pantalla aprobado ──────────────────────────────────────────────────────
  if (phase === 'approved') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={styles.header(insets)}>
          <Text style={styles.headerTitle}>Pagar comisión</Text>
        </View>
        <View style={styles.resultContainer}>
          <View style={[styles.iconCircle, { backgroundColor: '#DCFCE7' }]}>
            <MaterialCommunityIcons name="check-circle" size={44} color="#16A34A" />
          </View>
          <Text style={styles.resultTitle}>¡Pago exitoso!</Text>
          <Text style={styles.resultSubtitle}>
            Tu comisión fue pagada correctamente. Tu cuenta se actualizó.
          </Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.actionButton, { backgroundColor: colors.primary }]}>
            <Text style={styles.actionButtonText}>Volver al inicio</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── WebView con formulario de Paypertic ────────────────────────────────────
  if (phase === 'webview' && formUrl) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.header(insets), { flexDirection: 'row', alignItems: 'center' }]}>
          <TouchableOpacity
            onPress={resetToIdle}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ marginRight: 14 }}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { flex: 1 }]}>Pagar {formatPrice(balance)}</Text>
          <TouchableOpacity
            onPress={async () => {
              const statusHandled = await verifyPaymentByProviderStatus(true);
              if (!statusHandled) {
                await verifyPaymentByDriverBalance(true);
              }
            }}
            style={styles.verifyButton}
            activeOpacity={0.85}
          >
            <Text style={styles.verifyButtonText}>Ya pague</Text>
          </TouchableOpacity>
        </View>
        <WebView
          source={{ uri: formUrl }}
          injectedJavaScript={INJECTED_JS}
          onMessage={handlePayperticMessage}
          onNavigationStateChange={handleNavigationChange}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={StyleSheet.absoluteFill}>
              <ActivityIndicator style={{ flex: 1 }} color={colors.primary} size="large" />
            </View>
          )}
          onError={() => {
            Toast.show({ type: 'error', text1: 'Error al cargar el formulario de pago', visibilityTime: 4000 });
            resetToIdle();
          }}
          style={{ flex: 1 }}
        />
        <View style={styles.verifyingHint}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.verifyingHintText}>Verificando pago automaticamente...</Text>
        </View>
      </View>
    );
  }

  // ── Pantalla inicial ───────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header(insets), { flexDirection: 'row', alignItems: 'center' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginRight: 14 }}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pagar comisión</Text>
      </View>

      <View style={{ flex: 1, padding: 20, justifyContent: 'space-between' }}>
        {/* Monto */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: isOverdue ? '#C5C8E8' : '#FDE68A' }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Total a pagar
          </Text>
          <Text style={{ fontSize: 34, fontFamily: 'Inter_700Bold', color: balanceColor }}>
            {formatPrice(balance)}
          </Text>
        </View>

        {/* Nota */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <MaterialCommunityIcons name="lock-outline" size={15} color={colors.textMuted} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', lineHeight: 18 }}>
            Serás redirigido al formulario seguro de Paypertic para ingresar los datos de tu tarjeta. Nunca los almacenamos.
          </Text>
        </View>

        {/* Botón */}
        <TouchableOpacity
          onPress={handleStart}
          disabled={phase === 'loading'}
          activeOpacity={0.85}
          style={[styles.actionButton, { backgroundColor: phase === 'loading' ? '#9CA3AF' : colors.primary, flexDirection: 'row', gap: 10 }]}
        >
          {phase === 'loading' ? (
            <>
              <ActivityIndicator color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Iniciando…</Text>
            </>
          ) : (
            <>
              <MaterialCommunityIcons name="lock" size={18} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Pagar {formatPrice(balance)}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: (insets) => ({
    paddingTop: insets.top + 8,
    paddingBottom: 14,
    paddingHorizontal: 20,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  }),
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: colors.text,
  },
  resultContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  resultTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: colors.text,
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  actionButton: {
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  verifyButton: {
    backgroundColor: '#EEF2FF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  verifyButtonText: {
    color: '#3730A3',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  verifyingHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  verifyingHintText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
});
