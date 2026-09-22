import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useResponsive } from '../../hooks/useResponsive';

const CANCEL_BODY = {
  pickup: 'El pasajero sigue con el mismo viaje y se buscará otro chofer. Vos volvés al inicio.',
  streetHail: 'Este viaje en calle se cancela y volvés al inicio.',
};

export function ConfirmCancelTripModal({
  visible,
  confirming = false,
  variant = 'pickup',
  onConfirm,
  onDismiss,
}) {
  const { s, fs, contentMaxWidth, isCompactHeight, screenPadding } = useResponsive();
  const iconSize = isCompactHeight ? s(48) : s(56);

  if (!visible) return null;

  return (
    <View pointerEvents="auto" style={[styles.root, { zIndex: 80, elevation: 80 }]}>
      <View style={[styles.backdrop, { paddingHorizontal: screenPadding }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
          disabled={confirming}
          onPress={onDismiss}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.card,
            {
              maxWidth: Math.min(contentMaxWidth, s(360)),
              paddingHorizontal: s(22),
              paddingTop: isCompactHeight ? s(18) : s(24),
              paddingBottom: isCompactHeight ? s(16) : s(20),
              borderRadius: s(22),
            },
          ]}
        >
          <View
            style={[
              styles.iconWrap,
              {
                width: iconSize,
                height: iconSize,
                borderRadius: iconSize / 2,
              },
            ]}
          >
            <Ionicons
              name="close-circle"
              size={Math.round(fs(isCompactHeight ? 26 : 30))}
              color={colors.danger}
            />
          </View>

          <Text
            style={[
              styles.title,
              {
                fontSize: fs(isCompactHeight ? 17 : 20),
                marginTop: s(14),
                lineHeight: fs(26),
              },
            ]}
          >
            ¿Cancelar viaje?
          </Text>
          <Text
            style={[
              styles.body,
              {
                fontSize: fs(14),
                lineHeight: fs(20),
                marginTop: s(8),
              },
            ]}
          >
            {CANCEL_BODY[variant] || CANCEL_BODY.pickup}
          </Text>

          <View style={[styles.actions, { marginTop: s(isCompactHeight ? 16 : 22), gap: s(8) }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancelar viaje"
              disabled={confirming}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.dangerBtn,
                {
                  minHeight: s(48),
                  borderRadius: s(14),
                  opacity: confirming ? 0.7 : pressed ? 0.9 : 1,
                },
              ]}
            >
              <Text style={[styles.dangerText, { fontSize: fs(15) }]}>
                {confirming ? 'Cancelando…' : 'Cancelar viaje'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Volver"
              disabled={confirming}
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.secondaryBtn,
                {
                  minHeight: s(44),
                  borderRadius: s(14),
                  opacity: confirming ? 0.6 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.secondaryText, { fontSize: fs(14) }]}>Volver</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
    zIndex: 1,
    elevation: 12,
    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.18)',
  },
  iconWrap: {
    backgroundColor: colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Inter_700Bold',
    color: colors.text,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
  },
  dangerBtn: {
    width: '100%',
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderCurve: 'continuous',
  },
  dangerText: {
    fontFamily: 'Inter_700Bold',
    color: colors.textInverse,
  },
  secondaryBtn: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryText: {
    fontFamily: 'Inter_600SemiBold',
    color: colors.textMuted,
  },
});
