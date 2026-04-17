import React from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { colors } from '../../theme/colors';
import { formatDateTime, formatPrice, formatDistance, formatDuration } from '../../utils/formatters';
import * as Haptics from 'expo-haptics';

export const TripCard = ({ trip, onPress }) => {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onPress) onPress(trip);
  };

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
      <Card>
        {/* Header: Date & Status */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 12,
              fontFamily: 'Inter_500Medium',
            }}
          >
            {formatDateTime(trip.created_at)}
          </Text>
          <Badge status={trip.status} />
        </View>

        {/* Origin */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <MaterialCommunityIcons name="map-marker" size={18} color={colors.success} />
          <Text
            style={{
              color: colors.text,
              fontSize: 13,
              fontFamily: 'Inter_500Medium',
              marginLeft: 8,
              flex: 1,
            }}
            numberOfLines={1}
          >
            {trip.origin_address}
          </Text>
        </View>

        {/* Destination */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <MaterialCommunityIcons name="flag-checkered" size={18} color={colors.danger} />
          <Text
            style={{
              color: colors.text,
              fontSize: 13,
              fontFamily: 'Inter_500Medium',
              marginLeft: 8,
              flex: 1,
            }}
            numberOfLines={1}
          >
            {trip.destination_address}
          </Text>
        </View>

        {/* Footer: Stats */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 10,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
              ⏱ {formatDuration(trip.duration_minutes)}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
              📏 {formatDistance(trip.distance_km)}
            </Text>
          </View>
          <Text
            style={{
              color: colors.secondary,
              fontSize: 16,
              fontFamily: 'Inter_700Bold',
            }}
          >
            {trip.price == null ? 'A definir' : formatPrice(trip.price)}
          </Text>
        </View>

        {/* Arrow */}
        <View
          style={{
            position: 'absolute',
            right: 16,
            top: '50%',
          }}
        >
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
        </View>
      </Card>
    </TouchableOpacity>
  );
};
