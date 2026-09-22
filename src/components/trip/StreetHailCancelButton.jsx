import React from 'react';
import { Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

export function StreetHailCancelButton({
  cancelling = false,
  disabled = false,
  onPress,
  label = 'Cancelar viaje en calle',
  style,
}) {
  const busy = Boolean(cancelling || disabled);

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      delayPressIn={0}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.btn,
        style,
        pressed && !busy ? styles.btnPressed : null,
        busy ? styles.btnDisabled : null,
      ]}
    >
      {cancelling ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name="close" size={20} color="#fff" />
        </View>
      )}
      <Text style={styles.label}>
        {cancelling ? 'Cancelando…' : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    marginTop: 10,
    width: '100%',
    minHeight: 54,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 18,
    boxShadow: '0 8px 18px rgba(239,68,68,0.28)',
  },
  btnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  btnDisabled: {
    opacity: 0.7,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});
