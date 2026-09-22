import React from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useResponsive } from '../../hooks/useResponsive';

export function FinishTripOverlay({
  visible,
  finishing = false,
  distanceLabel,
  priceLabel,
  legsLabel,
  onConfirm,
  onDismiss,
}) {
  const { s, fs, isCompactHeight, screenPadding, contentMaxWidth } = useResponsive();
  if (!visible) return null;

  return (
    <View
      pointerEvents="auto"
      style={[styles.root, { zIndex: 80, elevation: 80 }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cerrar confirmación de cobro"
        disabled={finishing}
        onPress={onDismiss}
        style={styles.backdrop}
      />
      <View
        style={[
          styles.card,
          {
            maxWidth: Math.min(contentMaxWidth, s(420)),
            marginHorizontal: screenPadding,
            maxHeight: isCompactHeight ? '88%' : '80%',
            padding: isCompactHeight ? s(14) : s(18),
            borderRadius: s(20),
          },
        ]}
      >
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons name="cash-check" size={18} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { fontSize: fs(isCompactHeight ? 16 : 17) }]}>
                Confirmar cobro y finalizar
              </Text>
              <Text style={[styles.subtitle, { fontSize: fs(12) }]}>
                Verificá el pago antes de cerrar el viaje
              </Text>
            </View>
          </View>

          {legsLabel ? (
            <View style={styles.legsRow}>
              <MaterialCommunityIcons name="layers-triple-outline" size={14} color={colors.info} />
              <Text style={styles.legsText}>{legsLabel}</Text>
            </View>
          ) : null}

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Distancia total</Text>
            <Text style={styles.infoValue}>{distanceLabel}</Text>
          </View>

          <View style={styles.totalWrap}>
            <Text style={styles.totalLabel}>Costo total del viaje</Text>
            <Text style={[styles.totalValue, { fontSize: fs(isCompactHeight ? 28 : 32) }]}>
              {priceLabel}
            </Text>
          </View>

          <View style={[styles.actions, { gap: s(10) }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancelar"
              disabled={finishing}
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                finishing && styles.btnDisabled,
                pressed && !finishing ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={styles.btnGhostText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirmar pago"
              disabled={finishing}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                finishing && styles.btnDisabled,
                pressed && !finishing ? { opacity: 0.9 } : null,
              ]}
            >
              {finishing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>Confirmar pago</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 18, 28, 0.5)',
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 1,
    elevation: 12,
    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.22)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: `${colors.success}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: 'Inter_700Bold' },
  subtitle: {
    color: colors.textMuted,
    fontFamily: 'Inter_500Medium',
    marginTop: 2,
  },
  legsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  legsText: {
    flex: 1,
    color: colors.info,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  infoLabel: { color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_500Medium' },
  infoValue: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  totalWrap: {
    marginTop: 10,
    marginBottom: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${colors.success}35`,
    backgroundColor: `${colors.success}12`,
    padding: 14,
  },
  totalLabel: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' },
  totalValue: { color: colors.success, fontFamily: 'Inter_700Bold', marginTop: 2 },
  actions: { flexDirection: 'row' },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  btnGhost: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  btnPrimary: { backgroundColor: colors.success },
  btnGhostText: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  btnPrimaryText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold' },
  btnDisabled: { opacity: 0.7 },
});
