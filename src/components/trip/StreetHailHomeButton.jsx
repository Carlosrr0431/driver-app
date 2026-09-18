import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

/**
 * CTA del Home para iniciar un viaje con el pasajero ya a bordo.
 */
export function StreetHailHomeButton({
  online = false,
  loading = false,
  compact = false,
  disabled = false,
  onPress,
}) {
  const muted = !online || disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      accessibilityRole="button"
      accessibilityLabel="Tomar viaje en calle"
      style={({ pressed }) => ({
        marginTop: compact ? 8 : 10,
        borderRadius: 20,
        overflow: 'hidden',
        opacity: pressed ? 0.92 : 1,
        boxShadow: muted
          ? '0 3px 10px rgba(15,23,42,0.06)'
          : '0 8px 22px rgba(40,46,105,0.22)',
      })}
    >
      <LinearGradient
        colors={muted ? ['#F8F9FC', '#EEF1F7'] : [colors.primaryLight, colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.row, compact ? styles.rowCompact : null]}
      >
        <View style={[styles.iconWrap, muted ? styles.iconWrapMuted : null]}>
          {loading ? (
            <ActivityIndicator size="small" color={muted ? colors.primary : '#fff'} />
          ) : (
            <MaterialCommunityIcons
              name="car-arrow-right"
              size={compact ? 20 : 22}
              color={muted ? colors.primary : '#fff'}
            />
          )}
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, muted ? styles.titleMuted : null]}>
            Viaje en calle
          </Text>
          <Text
            style={[styles.subtitle, muted ? styles.subtitleMuted : null]}
            numberOfLines={2}
          >
            {loading
              ? 'Preparando…'
              : (online
                ? 'Pasajero a bordo · con destino o por kilómetro'
                : 'Ponete en línea para tomarlo')}
          </Text>
        </View>
        <View style={[styles.chevron, muted ? styles.chevronMuted : null]}>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={muted ? colors.primary : '#fff'}
          />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderCurve: 'continuous',
  },
  rowCompact: {
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapMuted: {
    backgroundColor: colors.surfaceLight,
  },
  copy: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  titleMuted: {
    color: colors.text,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    marginTop: 3,
    lineHeight: 15,
  },
  subtitleMuted: {
    color: colors.textMuted,
  },
  chevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronMuted: {
    backgroundColor: colors.surfaceLight,
  },
});
