import React from 'react';
import { Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { MaterialCommunityIcons } from '@expo/vector-icons';

/**
 * Botón de acción dentro del BottomSheet.
 * RNGH Pressable no pelea con el pan de Gorhom (TouchableOpacity sí, en Android barato).
 */
export function SheetActionButton({
  label,
  icon,
  color,
  onPress,
  disabled = false,
  busy = false,
  style,
}) {
  const blocked = Boolean(disabled || busy);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={blocked}
      delayPressIn={0}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: color },
        style,
        pressed && !blocked ? styles.pressed : null,
        blocked ? styles.disabled : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <>
          {icon ? (
            <MaterialCommunityIcons name={icon} size={22} color="#fff" />
          ) : null}
          <Text style={styles.label}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    borderCurve: 'continuous',
    gap: 10,
    marginBottom: 12,
    minHeight: 54,
  },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.7 },
  label: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
});
