import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

/**
 * Muestra recogida, paradas intermedias y destino final en orden.
 * @param {number|null} activeIndex — índice del punto activo (0=recogida, 1..n=paradas, n+1=final). null = sin resaltar.
 * @param {number|null} completedThroughIndex — puntos ya visitados (inclusive).
 */
export function TripRouteTimeline({
  pickupAddress,
  waypoints = [],
  finalDestinationAddress,
  activeIndex = null,
  completedThroughIndex = null,
  compact = false,
}) {
  const stops = [
    {
      key: 'pickup',
      label: 'RECOGIDA',
      address: pickupAddress || '—',
      type: 'pickup',
    },
    ...waypoints.map((wp, index) => ({
      key: `wp-${index}`,
      label: `PARADA ${index + 1}`,
      address: wp?.address || '—',
      type: 'stop',
      index: index + 1,
    })),
    {
      key: 'final',
      label: waypoints.length > 0 ? 'DESTINO FINAL' : 'DESTINO',
      address: finalDestinationAddress || '—',
      type: 'final',
      index: waypoints.length + 1,
    },
  ];

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      {stops.map((stop, idx) => {
        const isActive = activeIndex != null && idx === activeIndex;
        const isCompleted = completedThroughIndex != null && idx <= completedThroughIndex;
        const isLast = idx === stops.length - 1;

        return (
          <View key={stop.key}>
            <View style={styles.row}>
              <View style={styles.dotCol}>
                {stop.type === 'pickup' ? (
                  <View style={[styles.dotPickup, isActive && styles.dotActive, isCompleted && styles.dotCompleted]} />
                ) : stop.type === 'stop' ? (
                  <View style={[styles.dotStop, isActive && styles.dotStopActive, isCompleted && styles.dotCompleted]} />
                ) : (
                  <View style={[styles.dotFinal, isActive && styles.dotActive, isCompleted && styles.dotCompleted]} />
                )}
              </View>
              <View style={styles.textCol}>
                <View style={styles.labelRow}>
                  <Text style={[styles.label, isActive && styles.labelActive]}>{stop.label}</Text>
                  {isActive ? (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeBadgeText}>Actual</Text>
                    </View>
                  ) : null}
                  {isCompleted && !isActive ? (
                    <MaterialCommunityIcons name="check-circle" size={14} color={colors.success} />
                  ) : null}
                </View>
                <Text
                  style={[styles.address, isActive && styles.addressActive, isCompleted && !isActive && styles.addressCompleted]}
                  numberOfLines={2}
                >
                  {stop.address}
                </Text>
              </View>
            </View>
            {!isLast ? (
              <View style={styles.connector}>
                {[0, 1, 2].map((dot) => (
                  <View key={dot} style={styles.connectorDot} />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 0,
  },
  cardCompact: {
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  dotCol: {
    width: 22,
    alignItems: 'center',
    paddingTop: 2,
  },
  dotPickup: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: `${colors.success}40`,
  },
  dotStop: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.warning,
  },
  dotStopActive: {
    backgroundColor: `${colors.warning}25`,
    borderColor: colors.warning,
  },
  dotFinal: {
    width: 11,
    height: 11,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  dotActive: {
    transform: [{ scale: 1.15 }],
  },
  dotCompleted: {
    opacity: 0.55,
  },
  textCol: {
    flex: 1,
    marginLeft: 10,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  label: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  labelActive: {
    color: colors.primary,
  },
  activeBadge: {
    backgroundColor: `${colors.primary}15`,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  activeBadgeText: {
    color: colors.primary,
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.4,
  },
  address: {
    color: colors.text,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    lineHeight: 19,
  },
  addressActive: {
    fontFamily: 'Inter_600SemiBold',
  },
  addressCompleted: {
    color: colors.textMuted,
  },
  connector: {
    marginLeft: 10,
    paddingVertical: 5,
    gap: 2,
  },
  connectorDot: {
    width: 2,
    height: 4,
    borderRadius: 1,
    backgroundColor: `${colors.textMuted}35`,
    marginLeft: 1,
  },
});
