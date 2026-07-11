import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useResponsive } from '../../hooks/useResponsive';

/**
 * Aviso minimalista de actualización disponible en Google Play.
 */
export function StoreUpdateModal({ visible, onUpdate, onDismiss }) {
  const { s, fs, contentMaxWidth } = useResponsive();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.card,
            {
              maxWidth: Math.min(contentMaxWidth, s(340)),
              padding: s(24),
              borderRadius: s(20),
            },
          ]}
        >
          <View style={[styles.iconWrap, { width: s(56), height: s(56), borderRadius: s(16) }]}>
            <Ionicons name="cloud-download-outline" size={Math.round(fs(28))} color={colors.primary} />
          </View>

          <Text style={[styles.title, { fontSize: fs(18), marginTop: s(16) }]}>
            Nueva versión disponible
          </Text>
          <Text style={[styles.body, { fontSize: fs(14), marginTop: s(8), lineHeight: fs(20) }]}>
            Hay una actualización en Google Play. Actualizá para obtener mejoras y correcciones.
          </Text>

          <Pressable
            onPress={onUpdate}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                height: s(48),
                borderRadius: s(14),
                marginTop: s(22),
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <Text style={[styles.primaryText, { fontSize: fs(15) }]}>Actualizar</Text>
          </Pressable>

          <Pressable
            onPress={onDismiss}
            hitSlop={10}
            style={({ pressed }) => [
              styles.secondaryBtn,
              { marginTop: s(10), opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.secondaryText, { fontSize: fs(14) }]}>Más tarde</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  iconWrap: {
    backgroundColor: colors.surfaceLight,
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
  primaryBtn: {
    width: '100%',
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontFamily: 'Inter_700Bold',
    color: colors.textInverse,
  },
  secondaryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  secondaryText: {
    fontFamily: 'Inter_500Medium',
    color: colors.textMuted,
  },
});
