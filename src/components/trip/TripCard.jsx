/**
 * TripCard — tarjeta de viaje histórico rediseñada.
 * Muestra: fecha, estado, origen, destino, métricas y precio.
 */
import React from 'react';
import { Pressable, View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Badge } from '../ui/Badge';
import { colors } from '../../theme/colors';
import { formatDateTime, formatPrice, formatDistance, formatDuration } from '../../utils/formatters';
import * as Haptics from 'expo-haptics';

const STATUS_ICON = {
  completed:       { icon: 'check-circle', color: colors.success, bg: colors.successBg },
  cancelled:       { icon: 'close-circle', color: colors.danger,  bg: colors.dangerBg },
  in_progress:     { icon: 'navigation',   color: colors.primary, bg: colors.surfaceLight },
  pending:         { icon: 'clock-outline', color: colors.warning, bg: colors.warningBg },
  accepted:        { icon: 'car-arrow-right', color: colors.info,  bg: colors.infoBg },
  going_to_pickup: { icon: 'car-arrow-right', color: colors.primary, bg: colors.surfaceLight },
};

export const TripCard = ({ trip, onPress }) => {
  const cfg = STATUS_ICON[trip.status] || { icon: 'car', color: colors.textMuted, bg: colors.surfaceLight };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onPress) onPress(trip);
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => ({
        backgroundColor: colors.surface,
        borderRadius: 18,
        padding: 16,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: colors.borderLight,
        boxShadow: '0 2px 10px rgba(15,23,42,0.06)',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {/* Header: fecha + estado */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{
            width: 36, height: 36, borderRadius: 11,
            backgroundColor: cfg.bg,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <MaterialCommunityIcons name={cfg.icon} size={18} color={cfg.color} />
          </View>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
            {formatDateTime(trip.created_at)}
          </Text>
        </View>
        <Badge status={trip.status} />
      </View>

      {/* Ruta: origen → destino */}
      <View style={{
        backgroundColor: colors.surfaceRaised,
        borderRadius: 13, padding: 12, marginBottom: 12,
        gap: 8,
      }}>
        {/* Origen */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success, borderWidth: 2, borderColor: `${colors.success}35` }} />
          <Text style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 }} numberOfLines={1}>
            {trip.origin_address || 'Origen no registrado'}
          </Text>
        </View>

        {/* Conector */}
        <View style={{ marginLeft: 4, gap: 2 }}>
          {[0, 1].map(i => (
            <View key={i} style={{ width: 2, height: 4, borderRadius: 1, backgroundColor: colors.textLight, marginLeft: 0 }} />
          ))}
        </View>

        {/* Destino */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colors.primary }} />
          <Text style={{
            color: trip.destination_address ? colors.text : colors.textMuted,
            fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1,
            fontStyle: trip.destination_address ? 'normal' : 'italic',
          }} numberOfLines={1}>
            {trip.destination_address || 'Destino libre'}
          </Text>
        </View>
      </View>

      {/* Footer: métricas + precio */}
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {trip.duration_minutes != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="clock-outline" size={13} color={colors.textMuted} />
              <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
                {formatDuration(trip.duration_minutes)}
              </Text>
            </View>
          )}
          {trip.distance_km != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MaterialCommunityIcons name="map-marker-distance" size={13} color={colors.textMuted} />
              <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
                {formatDistance(trip.distance_km)}
              </Text>
            </View>
          )}
        </View>
        <Text style={{ color: trip.status === 'completed' ? colors.earnings : colors.text, fontSize: 17, fontFamily: 'Inter_700Bold' }}>
          {trip.price == null ? 'A definir' : formatPrice(trip.price)}
        </Text>
      </View>
    </Pressable>
  );
};
