import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useResponsive } from '../hooks/useResponsive';
import { summarizeDriverRating } from '../../shared/driver-rating';

function StarRow({ average, size = 16 }) {
  const value = Number(average) || 0;
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = value >= star;
        const half = !filled && value >= star - 0.5;
        return (
          <MaterialCommunityIcons
            key={star}
            name={filled ? 'star' : half ? 'star-half-full' : 'star-outline'}
            size={size}
            color={colors.warning}
          />
        );
      })}
    </View>
  );
}

function Histogram({ histogram, total, compact }) {
  if (!total) return null;
  return (
    <View style={styles.bars}>
      {[5, 4, 3, 2, 1].map((star) => {
        const count = histogram[star - 1] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <View key={star} style={styles.barRow}>
            <Text style={[styles.barLabel, compact ? styles.barLabelCompact : null]}>{star}</Text>
            <MaterialCommunityIcons name="star" size={compact ? 9 : 10} color={colors.warning} />
            <View style={[styles.barTrack, compact ? styles.barTrackCompact : null]}>
              <View style={[styles.barFill, { width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }]} />
            </View>
            <Text style={styles.barPct}>{count > 0 ? `${pct}%` : ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function DriverRatingCard({ driver }) {
  const { fs, s, isCompactHeight } = useResponsive();
  const summary = summarizeDriverRating(driver);
  const compact = isCompactHeight;

  return (
    <View style={[styles.card, { padding: s(16, { min: 12, max: 20 }), gap: s(14, { min: 10, max: 18 }) }]}>
      <View style={styles.top}>
        <Text style={[styles.average, { fontSize: fs(compact ? 32 : 36), minWidth: s(56, { min: 48, max: 72 }) }]}>
          {summary.averageLabel}
        </Text>
        <View style={styles.topMeta}>
          {summary.hasRatings ? <StarRow average={summary.average} size={Math.round(fs(16))} /> : (
            <View style={styles.newPill}>
              <MaterialCommunityIcons name="star-outline" size={14} color={colors.textMuted} />
              <Text style={styles.newPillText}>Sin reseñas aún</Text>
            </View>
          )}
          <Text style={[styles.count, { fontSize: fs(13) }]}>{summary.countLabel}</Text>
        </View>
      </View>
      {summary.hasRatings ? (
        <Histogram histogram={summary.histogram} total={summary.count} compact={compact} />
      ) : (
        <Text style={[styles.empty, { fontSize: fs(13), lineHeight: fs(19) }]}>
          Todavía no tenés reseñas. Cuando un pasajero califique un viaje, vas a ver el promedio acá.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
  },
  average: {
    fontFamily: 'Inter_700Bold',
    color: colors.text,
    letterSpacing: -1,
  },
  topMeta: {
    flex: 1,
    minWidth: 140,
    gap: 4,
  },
  starRow: {
    flexDirection: 'row',
    gap: 2,
  },
  count: {
    fontFamily: 'Inter_500Medium',
    color: colors.textMuted,
  },
  newPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  newPillText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: colors.textMuted,
  },
  empty: {
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
  },
  bars: {
    gap: 6,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  barLabel: {
    width: 10,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: colors.textMuted,
    textAlign: 'right',
  },
  barLabelCompact: {
    fontSize: 10,
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceLight,
    overflow: 'hidden',
  },
  barTrackCompact: {
    height: 6,
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.warning,
  },
  barPct: {
    width: 28,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: colors.textMuted,
    textAlign: 'right',
  },
});
