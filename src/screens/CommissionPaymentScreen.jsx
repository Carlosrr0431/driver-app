import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  AppState,
  Share,
  Linking,
  Animated,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { colors } from '../theme/colors';
import { formatPrice } from '../utils/formatters';
import { createPaymentSession, getPaymentStatus } from '../services/paypertic';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../services/supabase';
import { sendPaymentSuccessNotification } from '../services/notifications';
import {
  getPayperticRejectionTitle,
  isRejectedPaymentStatus,
  resolvePayperticRejectionMessage,
} from '../lib/payperticErrors';

const isPagoticTransferConfirmUrl = (url) =>
  typeof url === 'string' && url.includes('checkout.paypertic.com') && url.includes('guest-transfer-confirm-pay');

// JS inyectado en el WebView: clipboard + detectar contenido renderizado (SPA).
const INJECTED_JS = `
  (function() {
    var copyNotifiedAt = 0;
    var notifyClipboardCopy = function(text) {
      try {
        var now = Date.now();
        if (now - copyNotifiedAt < 600) return;
        copyNotifiedAt = now;
        var value = (text || '').toString().trim();
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'clipboard_copied',
          value: value.slice(0, 120)
        }));
      } catch(e) {}
    };

    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        var originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = function(value) {
          notifyClipboardCopy(value);
          return originalWriteText(value);
        };
      }
    } catch(e) {}

    document.addEventListener('copy', function() {
      try {
        var selected = '';
        if (window.getSelection) {
          selected = String(window.getSelection() || '').trim();
        }
        notifyClipboardCopy(selected);
      } catch(e) {}
    });

    // Detectar cuando el contenido real ya está renderizado.
    // Poll cada 80ms, máximo 3s de espera.
    var contentNotified = false;
    var maxWait = 3000;
    var started = Date.now();
    var checkContent = setInterval(function() {
      try {
        if (contentNotified) { clearInterval(checkContent); return; }
        var elapsed = Date.now() - started;
        var body = document.body;
        var ready = body &&
          body.scrollHeight > 100 &&
          body.innerText &&
          body.innerText.trim().length > 10;
        if (ready || elapsed >= maxWait) {
          clearInterval(checkContent);
          contentNotified = true;
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'content_ready' }));
        }
      } catch(e) { clearInterval(checkContent); }
    }, 80);
  })();
  true;
`;

const extractReceiptUrl = (payment) => {
  if (!payment || typeof payment !== 'object') return null;

  const candidates = [
    payment.receipt_url,
    payment.receiptUrl,
    payment.voucher_url,
    payment.voucherUrl,
    payment.ticket_url,
    payment.ticketUrl,
    payment.pdf_url,
    payment.pdfUrl,
    payment.download_url,
    payment.downloadUrl,
    payment.receipt?.url,
    payment.receipt?.download_url,
    payment.receipt?.downloadUrl,
    payment.links?.receipt,
    payment.links?.download,
  ];

  const validUrl = candidates.find(
    (value) => typeof value === 'string' && value.trim().toLowerCase().startsWith('http'),
  );

  return validUrl ? validUrl.trim() : null;
};

const parsePayperticDate = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const getPaymentPaidAt = (payment) =>
  payment?.paid_date ||
  payment?.accreditation_date ||
  payment?.process_date ||
  payment?.last_update_date ||
  null;

const isPayperticApprovedPayment = (payment) => {
  if (!payment || typeof payment !== 'object') return false;
  const normalizedStatus = String(payment?.status || '').toLowerCase();
  const approvedStatuses = new Set([
    'approved',
    'paid',
    'accredited',
    'completed',
    'success',
    'succeeded',
  ]);
  if (approvedStatuses.has(normalizedStatus)) return true;
  return Boolean(payment?.paid_date || payment?.accreditation_date);
};

const formatPaymentDate = (value) => {
  const date = parsePayperticDate(value);
  if (!date) return 'No disponible';

  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const PaymentLoadingCard = React.memo(function PaymentLoadingCard() {
  const pulse = useRef(new Animated.Value(1)).current;
  const dot1  = useRef(new Animated.Value(0.3)).current;
  const dot2  = useRef(new Animated.Value(0.3)).current;
  const dot3  = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.38, duration: 950, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 950, useNativeDriver: true }),
      ])
    ).start();

    const makeDot = (anim, delay) => {
      setTimeout(() => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: 1,   duration: 400, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          ])
        ).start();
      }, delay);
    };

    makeDot(dot1, 0);
    makeDot(dot2, 267);
    makeDot(dot3, 534);
  }, []);

  return (
    <View style={loadingCardStyles.card}>
      <View style={loadingCardStyles.iconContainer}>
        <Animated.View style={[loadingCardStyles.pulseRing, { transform: [{ scale: pulse }] }]} />
        <View style={loadingCardStyles.iconBg}>
          <MaterialCommunityIcons name="shield-lock" size={44} color={colors.primary} />
        </View>
      </View>
      <Text style={loadingCardStyles.title}>Preparando pago seguro</Text>
      <Text style={loadingCardStyles.subtitle}>
        Conectando con Paypertic de forma segura...
      </Text>
      <View style={loadingCardStyles.dotsRow}>
        <Animated.View style={[loadingCardStyles.dot, { opacity: dot1 }]} />
        <Animated.View style={[loadingCardStyles.dot, { opacity: dot2 }]} />
        <Animated.View style={[loadingCardStyles.dot, { opacity: dot3 }]} />
      </View>
    </View>
  );
});

const loadingCardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 28,
    paddingVertical: 36,
    alignItems: 'center',
    boxShadow: '0 6px 20px rgba(40,46,105,0.1)',
  },
  iconContainer: {
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  pulseRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#EEF2FF',
    borderWidth: 2,
    borderColor: '#C7D2FE',
  },
  iconBg: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#A5B4FC',
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: colors.primary,
  },
});

const generateReceiptHTML = (payment, balance) => {
  const amount = Number(payment?.final_amount) || balance;
  const paidAt = getPaymentPaidAt(payment);
  const providerPaymentId = payment?.id || 'No disponible';
  const paymentReference = payment?.external_transaction_id || 'No disponible';
  const dateStr = formatPaymentDate(paidAt);
  const generatedAt = new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #F0F4FF; padding: 40px 20px; }
    .card { background: white; border-radius: 20px; padding: 40px; max-width: 520px; margin: 0 auto; box-shadow: 0 8px 32px rgba(40,46,105,0.12); }
    .header { text-align: center; margin-bottom: 32px; }
    .brand { font-size: 13px; font-weight: 700; color: #282e69; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 20px; }
    .checkmark-circle { width: 72px; height: 72px; background: #DCFCE7; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 38px; line-height: 72px; text-align: center; }
    .title { font-size: 26px; font-weight: 700; color: #111827; margin-bottom: 6px; }
    .subtitle { font-size: 14px; color: #6B7280; }
    .amount-box { background: linear-gradient(135deg, #282e69 0%, #3a4494 100%); border-radius: 14px; padding: 24px; text-align: center; margin: 24px 0; }
    .amount-label { font-size: 11px; color: rgba(255,255,255,0.7); font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
    .amount-value { font-size: 40px; font-weight: 700; color: white; }
    .section-title { font-size: 11px; font-weight: 600; color: #9CA3AF; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 12px; }
    .rows { border: 1px solid #F3F4F6; border-radius: 12px; overflow: hidden; }
    .row { display: flex; justify-content: space-between; align-items: flex-start; padding: 13px 16px; border-bottom: 1px solid #F9FAFB; }
    .row:last-child { border-bottom: none; }
    .label { font-size: 13px; color: #9CA3AF; font-weight: 500; }
    .value { font-size: 13px; color: #111827; font-weight: 600; text-align: right; max-width: 58%; word-break: break-all; }
    .status-badge { display: inline-block; background: #DCFCE7; color: #16A34A; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
    .footer { text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #F3F4F6; }
    .footer-text { font-size: 11px; color: #D1D5DB; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">Remis Profesional</div>
      <div class="checkmark-circle">✅</div>
      <div class="title">Pago acreditado</div>
      <div class="subtitle">Tu comisión quedó registrada correctamente</div>
    </div>
    <div class="amount-box">
      <div class="amount-label">Monto pagado</div>
      <div class="amount-value">${formatPrice(amount)}</div>
    </div>
    <div class="section-title">Detalle de la operación</div>
    <div class="rows">
      <div class="row"><span class="label">Fecha y hora</span><span class="value">${dateStr}</span></div>
      <div class="row"><span class="label">ID de pago</span><span class="value">${providerPaymentId}</span></div>
      <div class="row"><span class="label">Referencia</span><span class="value">${paymentReference}</span></div>
      <div class="row"><span class="label">Estado</span><span class="value"><span class="status-badge">✓ Aprobado</span></span></div>
    </div>
    <div class="footer">
      <div class="footer-text">Comprobante generado el ${generatedAt}<br>Este documento es válido como constancia de pago</div>
    </div>
  </div>
</body>
</html>`;
};

const VerifyingPaymentCard = () => (
  <View style={loadingCardStyles.card}>
    <View style={loadingCardStyles.iconContainer}>
      <View style={loadingCardStyles.iconBg}>
        <MaterialCommunityIcons name="shield-check" size={44} color={colors.primary} />
      </View>
    </View>
    <Text style={loadingCardStyles.title}>Verificando tu pago</Text>
    <Text style={loadingCardStyles.subtitle}>
      Estamos confirmando el resultado con el proveedor...
    </Text>
    <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 8 }} />
  </View>
);

// Banner minimalista que flota sobre el WebView sin tapar el contenido (CVU, etc.)
const PaymentVerifyingBanner = React.memo(function PaymentVerifyingBanner() {
  const dot1 = useRef(new Animated.Value(0.35)).current;
  const dot2 = useRef(new Animated.Value(0.35)).current;
  const dot3 = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const makeDot = (anim, delay) => {
      setTimeout(() => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: 1, duration: 450, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0.35, duration: 450, useNativeDriver: true }),
          ])
        ).start();
      }, delay);
    };
    makeDot(dot1, 0);
    makeDot(dot2, 200);
    makeDot(dot3, 400);
  }, []);

  return (
    <View style={verifyingBannerStyles.wrapper}>
      <View style={verifyingBannerStyles.card}>
        <View style={verifyingBannerStyles.dotsCol}>
          <Animated.View style={[verifyingBannerStyles.dot, { opacity: dot1 }]} />
          <Animated.View style={[verifyingBannerStyles.dot, { opacity: dot2 }]} />
          <Animated.View style={[verifyingBannerStyles.dot, { opacity: dot3 }]} />
        </View>
        <View style={verifyingBannerStyles.textGroup}>
          <Text style={verifyingBannerStyles.title}>Esperando confirmación de pago</Text>
          <Text style={verifyingBannerStyles.subtitle}>
            Verificando en tiempo real con el proveedor...
          </Text>
        </View>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    </View>
  );
});

const verifyingBannerStyles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 28,
    left: 12,
    right: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingVertical: 14,
    paddingHorizontal: 16,
    boxShadow: '0 6px 24px rgba(40,46,105,0.18)',
  },
  dotsCol: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.primary,
  },
  textGroup: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: colors.text,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
    lineHeight: 15,
  },
});

const PaymentRejectedCard = React.memo(function PaymentRejectedCard({
  title,
  message,
  amount,
  statusDetail,
  onRetry,
  onGoBack,
  isRetrying,
}) {
  const isInsufficientFunds =
    String(statusDetail || '').includes('4268') ||
    /insufficient funds/i.test(String(statusDetail || '')) ||
    /fondos insuficientes/i.test(String(message || ''));

  return (
    <View style={rejectedCardStyles.wrapper}>
      <View style={rejectedCardStyles.card}>
        <View style={[rejectedCardStyles.iconCircle, isInsufficientFunds && rejectedCardStyles.iconCircleFunds]}>
          <MaterialCommunityIcons
            name={isInsufficientFunds ? 'credit-card-off-outline' : 'close-circle-outline'}
            size={44}
            color={isInsufficientFunds ? '#B45309' : '#DC2626'}
          />
        </View>

        <Text style={rejectedCardStyles.title}>{title}</Text>
        <Text style={rejectedCardStyles.subtitle}>{message}</Text>

        <View style={rejectedCardStyles.amountBox}>
          <Text style={rejectedCardStyles.amountLabel}>Monto no acreditado</Text>
          <Text style={rejectedCardStyles.amountValue}>{formatPrice(amount)}</Text>
        </View>

        {statusDetail ? (
          <View style={rejectedCardStyles.detailChip}>
            <MaterialCommunityIcons name="information-outline" size={14} color="#9CA3AF" />
            <Text style={rejectedCardStyles.detailChipText} numberOfLines={2}>
              {String(statusDetail)}
            </Text>
          </View>
        ) : null}

        <View style={rejectedCardStyles.hintBox}>
          <MaterialCommunityIcons name="lightbulb-outline" size={16} color="#6B7280" />
          <Text style={rejectedCardStyles.hintText}>
            Podés reintentar con otro medio de pago o verificar los datos ingresados.
          </Text>
        </View>

        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [rejectedCardStyles.retryButton, pressed && { opacity: 0.9 }]}
          disabled={isRetrying}
        >
          {isRetrying ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <MaterialCommunityIcons name="refresh" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={rejectedCardStyles.retryButtonText}>Reintentar pago</Text>
            </>
          )}
        </Pressable>

        <Pressable
          onPress={onGoBack}
          style={({ pressed }) => [rejectedCardStyles.secondaryButton, pressed && { opacity: 0.9 }]}
          disabled={isRetrying}
        >
          <Text style={rejectedCardStyles.secondaryButtonText}>Volver al inicio</Text>
        </Pressable>
      </View>
    </View>
  );
});

const rejectedCardStyles = StyleSheet.create({
  wrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 20,
    alignItems: 'center',
    boxShadow: '0 6px 20px rgba(220,38,38,0.08)',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  iconCircleFunds: {
    backgroundColor: '#FEF3C7',
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  amountBox: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FFF5F5',
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  amountLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#9CA3AF',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  amountValue: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: '#991B1B',
  },
  detailChip: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  detailChipText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: '#6B7280',
  },
  hintBox: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    padding: 12,
    marginBottom: 16,
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    lineHeight: 18,
  },
  retryButton: {
    width: '100%',
    flexDirection: 'row',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    boxShadow: '0 4px 12px rgba(40,46,105,0.2)',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  secondaryButton: {
    width: '100%',
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
});

const PaymentApprovedCard = React.memo(function PaymentApprovedCard({
  payment,
  fallbackAmount,
  isLoadingDetails,
  onGeneratePDF,
  onShareReceipt,
  onDownloadReceipt,
  onGoBack,
  isGeneratingPDF,
  isSharingReceipt,
  isDownloadingReceipt,
}) {
  const amount = Number(payment?.final_amount) || fallbackAmount;
  const paidAt = getPaymentPaidAt(payment);
  const providerPaymentId = payment?.id || '—';
  const paymentReference = payment?.external_transaction_id || '—';
  const receiptUrl = extractReceiptUrl(payment);
  const showPayperticReceipt = Boolean(receiptUrl);

  return (
    <View style={styles.resultCard}>
      <View style={[styles.iconCircle, { backgroundColor: '#DCFCE7' }]}>
        <MaterialCommunityIcons name="check-circle" size={48} color="#16A34A" />
      </View>

      <Text style={styles.resultTitle}>Pago acreditado</Text>
      <Text style={styles.resultSubtitle}>
        Tu comisión quedó registrada correctamente. Podés descargar el comprobante en PDF.
      </Text>

      <View style={[styles.receiptBox, { borderColor: '#BBF7D0' }]}>
        <View style={styles.receiptRow}>
          <Text style={styles.receiptLabel}>Monto</Text>
          <Text style={styles.receiptValue}>{formatPrice(amount)}</Text>
        </View>
        <View style={styles.receiptRow}>
          <Text style={styles.receiptLabel}>Fecha</Text>
          <Text style={styles.receiptValue}>{formatPaymentDate(paidAt)}</Text>
        </View>
        <View style={styles.receiptRow}>
          <Text style={styles.receiptLabel}>ID de pago</Text>
          <Text style={styles.receiptValueSmall} numberOfLines={2}>{providerPaymentId}</Text>
        </View>
        <View style={styles.receiptRow}>
          <Text style={styles.receiptLabel}>Referencia</Text>
          <Text style={styles.receiptValueSmall} numberOfLines={2}>{paymentReference}</Text>
        </View>
      </View>

      {isLoadingDetails ? (
        <View style={styles.infoInline}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.infoInlineText}>Actualizando comprobante...</Text>
        </View>
      ) : null}

      <Pressable
        onPress={onGeneratePDF}
        style={({ pressed }) => [styles.pdfButton, pressed && { opacity: 0.9 }]}
        disabled={isGeneratingPDF}
      >
        {isGeneratingPDF ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <MaterialCommunityIcons name="file-pdf-box" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.actionButtonText}>Descargar comprobante PDF</Text>
          </>
        )}
      </Pressable>

      {showPayperticReceipt ? (
        <Pressable
          onPress={onDownloadReceipt}
          style={({ pressed }) => [styles.secondaryActionButton, pressed && { opacity: 0.9 }]}
          disabled={isDownloadingReceipt}
        >
          {isDownloadingReceipt ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Text style={styles.secondaryActionButtonText}>Ver comprobante Paypertic</Text>
          )}
        </Pressable>
      ) : null}

      <Pressable
        onPress={onShareReceipt}
        style={({ pressed }) => [styles.secondaryActionButton, pressed && { opacity: 0.9 }]}
        disabled={isSharingReceipt}
      >
        {isSharingReceipt ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.secondaryActionButtonText}>Compartir datos del pago</Text>
        )}
      </Pressable>

      <Pressable
        onPress={onGoBack}
        style={({ pressed }) => [styles.secondaryActionButton, { marginTop: 4 }, pressed && { opacity: 0.9 }]}
      >
        <Text style={styles.secondaryActionButtonText}>Volver al inicio</Text>
      </Pressable>
    </View>
  );
});

export default function CommissionPaymentScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const queryClient = useQueryClient();
  const { driver } = useAuthStore();

  const { commissionData, autoStart = true } = route.params || {};
  const balance = commissionData?.balance || 0;
  const isOverdue = commissionData?.isOverdue || false;
  const balanceColor = isOverdue ? '#282e69' : '#D97706';

  // Estados: 'idle' | 'loading' | 'webview' | 'verifying' | 'approved' | 'rejected'
  const [phase, setPhase] = useState('idle');
  const [formUrl, setFormUrl] = useState(null);
  const [paymentId, setPaymentId] = useState(null);
  const [startupError, setStartupError] = useState(null);
  const [approvedPayment, setApprovedPayment] = useState(null);
  const [rejectedPayment, setRejectedPayment] = useState(null);
  const [isFetchingPaymentDetails, setIsFetchingPaymentDetails] = useState(false);
  const [isSharingReceipt, setIsSharingReceipt] = useState(false);
  const [isDownloadingReceipt, setIsDownloadingReceipt] = useState(false);
  const [webviewLoaded, setWebviewLoaded] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [showVerifyingOverlay, setShowVerifyingOverlay] = useState(false);
  const [paymentSuccessRecorded, setPaymentSuccessRecorded] = useState(false);
  const returnHandled = useRef(false);
  const approvedDetailsLoadedForPaymentId = useRef(null);
  const autoStartTriggered = useRef(false);
  const lastClipboardToastAt = useRef(0);
  const paymentSuccessRecordedRef = useRef(false);
  const webviewHasLoadedRef = useRef(false);

  const markWebviewContentVisible = () => {
    webviewHasLoadedRef.current = true;
    setWebviewLoaded(true);
  };

  // Registra el pago y muestra comprobante nativo (PDF), no el checkout de Pagotic.
  const recordPaymentSuccess = async (payment = null) => {
    const alreadyRecorded = paymentSuccessRecordedRef.current;
    paymentSuccessRecordedRef.current = true;
    setPaymentSuccessRecorded(true);
    setShowVerifyingOverlay(false);

    let resolvedPayment = payment;
    if (!resolvedPayment && paymentId) {
      try {
        resolvedPayment = await getPaymentStatus(paymentId);
      } catch {
        // seguir con datos locales
      }
    }

    if (resolvedPayment) {
      saveApprovedPayment({
        ...resolvedPayment,
        form_url: resolvedPayment.form_url || formUrl || null,
      });
    } else if (paymentId || formUrl) {
      saveApprovedPayment({
        id: paymentId,
        final_amount: balance,
        form_url: formUrl || null,
      });
    }

    setPhase('approved');

    if (!alreadyRecorded) {
      const amount = Number(resolvedPayment?.final_amount) || balance;
      sendPaymentSuccessNotification(formatPrice(amount));
      queryClient.invalidateQueries({ queryKey: ['commissionBalance', driver?.id] });
    }
  };

  const saveApprovedPayment = (payment) => {
    if (!payment || typeof payment !== 'object') return;

    const normalized = {
      ...payment,
      receipt_url: extractReceiptUrl(payment),
    };
    setApprovedPayment(normalized);

    if (payment?.id) {
      approvedDetailsLoadedForPaymentId.current = String(payment.id);
    }
  };

  const resetToIdle = () => {
    setPhase('idle');
    setFormUrl(null);
    setPaymentId(null);
    setStartupError(null);
    setApprovedPayment(null);
    setRejectedPayment(null);
    setIsFetchingPaymentDetails(false);
    setIsSharingReceipt(false);
    setIsDownloadingReceipt(false);
    setWebviewLoaded(false);
    webviewHasLoadedRef.current = false;
    setShowVerifyingOverlay(false);
    paymentSuccessRecordedRef.current = false;
    setPaymentSuccessRecorded(false);
    approvedDetailsLoadedForPaymentId.current = null;
  };

  const markAsRejected = (payment = null, fallbackMessage = null) => {
    if (returnHandled.current) return;
    returnHandled.current = true;

    const statusDetail = payment?.status_detail || null;
    const message =
      fallbackMessage ||
      resolvePayperticRejectionMessage(statusDetail);

    setRejectedPayment({
      status: (payment?.status || 'rejected').toLowerCase(),
      statusDetail,
      message,
      title: getPayperticRejectionTitle(statusDetail),
      amount: Number(payment?.final_amount) || balance,
      paymentId: payment?.id || paymentId || null,
    });
    setShowVerifyingOverlay(false);
    setPhase('rejected');
  };

  const resolvePaymentFromProvider = async ({ fallbackMessage = null } = {}) => {
    if (returnHandled.current) return;

    if (paymentId) {
      try {
        const payment = await getPaymentStatus(paymentId);
        if (isPayperticApprovedPayment(payment)) {
          await recordPaymentSuccess(payment);
          return;
        }

        if (isRejectedPaymentStatus(status)) {
          markAsRejected(payment, fallbackMessage);
          return;
        }

        setPhase('webview');
        setShowVerifyingOverlay(false);
        return;
      } catch {
        if (fallbackMessage) {
          markAsRejected(null, fallbackMessage);
        } else {
          setPhase('webview');
          setShowVerifyingOverlay(false);
        }
        return;
      }
    }

    if (fallbackMessage) {
      markAsRejected(null, fallbackMessage);
    } else {
      setPhase('webview');
      setShowVerifyingOverlay(false);
    }
  };

  const handleGeneratePDF = async () => {
    try {
      setIsGeneratingPDF(true);
      const html = generateReceiptHTML(approvedPayment, balance);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Comprobante de pago',
          UTI: 'com.adobe.pdf',
        });
      } else {
        Toast.show({
          type: 'info',
          text1: 'Comprobante generado',
          text2: 'Tu dispositivo no admite compartir archivos.',
          visibilityTime: 3500,
        });
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: 'No se pudo generar el PDF', text2: e?.message, visibilityTime: 4000 });
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleShareReceipt = async () => {    const amount = Number(approvedPayment?.final_amount) || balance;
    const paidAt = getPaymentPaidAt(approvedPayment);
    const paymentReference = approvedPayment?.external_transaction_id || 'No disponible';
    const providerPaymentId = approvedPayment?.id || paymentId || 'No disponible';
    const receiptUrl = extractReceiptUrl(approvedPayment);

    const lines = [
      'Comprobante de pago de comisión',
      `Monto: ${formatPrice(amount)}`,
      `Fecha: ${formatPaymentDate(paidAt)}`,
      `ID de pago: ${providerPaymentId}`,
      `Referencia: ${paymentReference}`,
    ];

    if (receiptUrl) {
      lines.push(`Comprobante: ${receiptUrl}`);
    }

    try {
      setIsSharingReceipt(true);
      await Share.share({
        message: lines.join('\n'),
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: 'No se pudo compartir',
        text2: 'Intentá nuevamente en unos segundos.',
        visibilityTime: 3500,
      });
    } finally {
      setIsSharingReceipt(false);
    }
  };

  const handleDownloadReceipt = async () => {
    const receiptUrl = extractReceiptUrl(approvedPayment);
    const targetUrl = receiptUrl;

    if (!targetUrl) {
      Toast.show({
        type: 'info',
        text1: 'Comprobante no disponible',
        text2: 'Paypertic no devolvió un enlace de comprobante. Usá el PDF local.',
        visibilityTime: 3500,
      });
      return;
    }

    try {
      setIsDownloadingReceipt(true);
      const canOpen = await Linking.canOpenURL(targetUrl);

      if (!canOpen) {
        throw new Error('No se puede abrir el comprobante');
      }

      await Linking.openURL(targetUrl);
    } catch {
      Toast.show({
        type: 'error',
        text1: 'No se pudo abrir el comprobante',
        text2: 'Probá descargar el PDF local o reintentá más tarde.',
        visibilityTime: 3500,
      });
    } finally {
      setIsDownloadingReceipt(false);
    }
  };

  const verifyPaymentByProviderStatus = async (showPendingToast = false) => {
    if (!paymentId || !driver?.id) return false;

    try {
      const payment = await getPaymentStatus(paymentId);
      if (isPayperticApprovedPayment(payment)) {
        await recordPaymentSuccess(payment);
        return true;
      }

      if (isRejectedPaymentStatus(status)) {
        markAsRejected(payment);
        return true;
      }

      if (showPendingToast) {
        const statusLabels = {
          issued: 'Transferencia registrada, esperando acreditación bancaria.',
          pending: 'El pago está pendiente de confirmación.',
          in_process: 'El pago está siendo procesado.',
        };
        Toast.show({
          type: 'info',
          text1: 'Pago en proceso',
          text2: statusLabels[status] || `Estado: ${status || 'pendiente'}`,
          visibilityTime: 3500,
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
        await recordPaymentSuccess(null);
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
    const shouldSubscribe = phase === 'webview';
    if (!shouldSubscribe || !driver?.id) return;

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
        () => {
          recordPaymentSuccess(null);
        },
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
            recordPaymentSuccess(null);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [phase, driver?.id, queryClient]);

  // Polling mientras el chofer completa transferencia o vuelve del banco.
  useEffect(() => {
    if (phase !== 'webview' || !paymentId || paymentSuccessRecordedRef.current) return;

    const runPoll = async () => {
      const statusHandled = await verifyPaymentByProviderStatus(false);
      if (!statusHandled && !paymentSuccessRecordedRef.current) {
        await verifyPaymentByDriverBalance(false);
      }
    };

    runPoll();
    const intervalId = setInterval(runPoll, 2500);

    return () => clearInterval(intervalId);
  }, [phase, paymentId, driver?.id]);

  // Validación al montar y al volver de background (banco / Pagotic).
  useEffect(() => {
    const shouldVerify = phase === 'webview';
    if (!shouldVerify || !driver?.id) return;

    const runVerification = async (showPendingToast = false) => {
      const statusHandled = await verifyPaymentByProviderStatus(showPendingToast);
      if (!statusHandled) {
        await verifyPaymentByDriverBalance(showPendingToast);
      }
    };

    runVerification(false);

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        runVerification(true);
      }
    });

    return () => {
      appStateSub.remove();
    };
  }, [phase, driver?.id, paymentId]);

  useEffect(() => {
    if (phase !== 'approved' || !paymentId) return;
    if (approvedDetailsLoadedForPaymentId.current === String(paymentId)) return;

    let active = true;
    approvedDetailsLoadedForPaymentId.current = String(paymentId);

    const loadPaymentDetails = async () => {
      try {
        setIsFetchingPaymentDetails(true);
        const payment = await getPaymentStatus(String(paymentId));
        if (active) {
          saveApprovedPayment(payment);
        }
      } catch {
        // mantener datos previos
      } finally {
        if (active) {
          setIsFetchingPaymentDetails(false);
        }
      }
    };

    loadPaymentDetails();

    return () => {
      active = false;
    };
  }, [phase, paymentId]);

  const handlePayperticMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === 'content_ready') {
        markWebviewContentVisible();
        return;
      }

      if (data.type === 'clipboard_copied') {
        const now = Date.now();
        if (now - lastClipboardToastAt.current >= 1200) {
          lastClipboardToastAt.current = now;
          Toast.show({
            type: 'success',
            text1: 'Copiado al portapapeles',
            text2: data.value ? `Dato copiado: ${String(data.value).slice(0, 32)}...` : 'Dato de pago copiado.',
            visibilityTime: 1800,
          });
        }
      }
    } catch {
      // mensaje no válido, ignorar
    }
  };

  const handleNavigationChange = (navState) => {
    const url = navState.url || '';
    if (isPagoticTransferConfirmUrl(url)) {
      markWebviewContentVisible();
      setShowVerifyingOverlay(true);
    }
  };

  const startPaymentFlow = async () => {
    returnHandled.current = false;

    if (paymentId && !paymentSuccessRecordedRef.current) {
      try {
        const existing = await getPaymentStatus(paymentId);
        if (isPayperticApprovedPayment(existing)) {
          setFormUrl(null);
          await recordPaymentSuccess(existing);
          return;
        }
      } catch {
        // seguir con nueva sesión si no se pudo consultar
      }
    }

    paymentSuccessRecordedRef.current = false;
    setPaymentSuccessRecorded(false);
    webviewHasLoadedRef.current = false;
    approvedDetailsLoadedForPaymentId.current = null;
    setApprovedPayment(null);
    setRejectedPayment(null);
    setStartupError(null);
    setWebviewLoaded(false);
    setPhase('idle');

    if (!(Number(balance) > 0)) {
      setPhase('idle');
      setStartupError('No hay saldo pendiente para pagar.');
      return;
    }

    setPhase('loading');

    try {
      const { form_url, payment_id } = await createPaymentSession(balance);
      setFormUrl(form_url);
      setPaymentId(payment_id || null);
      setPhase('webview');
    } catch (err) {
      setFormUrl(null);
      setPaymentId(null);
      setPhase('idle');
      setStartupError(err?.message || 'No se pudo iniciar el pago.');
      Toast.show({ type: 'error', text1: 'Error al iniciar el pago', text2: err.message, visibilityTime: 4000 });
    }
  };

  useEffect(() => {
    if (!autoStart || autoStartTriggered.current) return;
    autoStartTriggered.current = true;
    startPaymentFlow();
  }, [autoStart, balance]);

  // ── Pantalla aprobada con comprobante ─────────────────────────────────────
  if (phase === 'approved') {
    return (
      <View style={styles.screen}>
        <View style={[styles.resultContainer, { paddingTop: insets.top + 14 }]}>
          <PaymentApprovedCard
            payment={approvedPayment}
            fallbackAmount={balance}
            isLoadingDetails={isFetchingPaymentDetails}
            onGeneratePDF={handleGeneratePDF}
            onShareReceipt={handleShareReceipt}
            onDownloadReceipt={handleDownloadReceipt}
            onGoBack={() => navigation.goBack()}
            isGeneratingPDF={isGeneratingPDF}
            isSharingReceipt={isSharingReceipt}
            isDownloadingReceipt={isDownloadingReceipt}
          />
        </View>
      </View>
    );
  }

  // ── Pantalla rechazado ───────────────────────────────────────────────────
  if (phase === 'rejected' && rejectedPayment) {
    return (
      <View style={styles.screen}>
        <View style={[styles.resultContainer, { paddingTop: insets.top + 14 }]}>
          <PaymentRejectedCard
            title={rejectedPayment.title}
            message={rejectedPayment.message}
            amount={rejectedPayment.amount}
            statusDetail={rejectedPayment.statusDetail}
            onRetry={startPaymentFlow}
            onGoBack={() => navigation.goBack()}
            isRetrying={phase === 'loading'}
          />
        </View>
      </View>
    );
  }

  // ── WebView con formulario de Paypertic ────────────────────────────────────
  if (phase === 'webview' && formUrl) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <WebView
          source={{ uri: formUrl }}
          injectedJavaScript={INJECTED_JS}
          onMessage={handlePayperticMessage}
          onNavigationStateChange={handleNavigationChange}
          onLoadEnd={() => {
            if (webviewHasLoadedRef.current) return;
            setTimeout(() => markWebviewContentVisible(), 800);
          }}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          setBuiltInZoomControls={false}
          onError={() => {
            setFormUrl(null);
            setPaymentId(null);
            setPhase('idle');
            setStartupError('No se pudo cargar el formulario de pago.');
            Toast.show({ type: 'error', text1: 'Error al cargar el formulario de pago', visibilityTime: 4000 });
          }}
          style={{ flex: 1, backgroundColor: '#FFFFFF' }}
        />

        {/* Overlay solo en la primera carga del checkout; no vuelve al ir al CVU */}
        {!webviewLoaded && (
          <View style={[StyleSheet.absoluteFill, styles.webviewOverlay]}>
            {showVerifyingOverlay ? <VerifyingPaymentCard /> : <PaymentLoadingCard />}
          </View>
        )}

        {/* Banner flotante de verificación: aparece sobre el WebView SIN tapar el contenido.
            Permite al usuario ver y copiar los datos de CBU/CVU en pagos por transferencia
            mientras la app espera confirmación en tiempo real. */}
        {webviewLoaded && showVerifyingOverlay && !paymentSuccessRecorded ? (
          <PaymentVerifyingBanner />
        ) : null}
      </View>
    );
  }

  // ── Inicio automático / fallback de error ─────────────────────────────────
  return (
    <View style={styles.screen}>
      <View
        style={[
          styles.bootstrapContainer,
          {
            paddingTop: insets.top + 24,
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
      >
        {phase === 'loading' ? (
          <PaymentLoadingCard />
        ) : (
          <View style={[styles.bootstrapCard, { borderColor: isOverdue ? '#C5C8E8' : '#D1D5DB' }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={34} color="#D97706" />
            <Text style={styles.bootstrapTitle}>No se pudo abrir el pago</Text>
            <Text style={styles.bootstrapSubtitle}>
              {startupError || 'Intentá nuevamente para continuar con el pago de tu comisión.'}
            </Text>

            <Pressable
              onPress={startPaymentFlow}
              style={({ pressed }) => [styles.actionButton, { marginTop: 20, backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.actionButtonText}>Reintentar</Text>
            </Pressable>

            <Pressable
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.secondaryActionButton, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.secondaryActionButtonText}>Volver al inicio</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  bootstrapContainer: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  bootstrapCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 22,
    alignItems: 'center',
  },
  bootstrapTitle: {
    marginTop: 12,
    color: colors.text,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  bootstrapSubtitle: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  resultContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  resultCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 20,
    alignItems: 'center',
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
    textAlign: 'center',
  },
  resultSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  receiptBox: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    gap: 9,
    marginBottom: 14,
  },
  transferInfoBox: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    gap: 9,
    marginBottom: 12,
  },
  transferInfoHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  receiptLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  receiptValue: {
    color: colors.text,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    textAlign: 'right',
  },
  receiptValueSmall: {
    color: colors.text,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'right',
    flexShrink: 1,
  },
  infoInline: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  infoInlineText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  receiptHint: {
    width: '100%',
    marginTop: 10,
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  actionButton: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  pdfButton: {
    width: '100%',
    flexDirection: 'row',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    backgroundColor: colors.primary,
    boxShadow: '0 4px 12px rgba(40,46,105,0.25)',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  secondaryActionButton: {
    width: '100%',
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryActionButtonDisabled: {
    opacity: 0.55,
  },
  secondaryActionButtonText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  webviewOverlay: {
    backgroundColor: colors.background,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webviewTopBar: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  webviewTopBarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  webviewTopBarText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
});