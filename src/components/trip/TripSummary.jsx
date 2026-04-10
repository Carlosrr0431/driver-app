import React from 'react';
import { View, Text } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { colors } from '../../theme/colors';
import { formatPrice, formatDistance, formatDuration, formatDateTime } from '../../utils/formatters';

export const TripSummary = ({ trip }) => {
  if (!trip) return null;

  const items = [
    {
      icon: 'map-marker-distance',
      label: 'Distancia',
      value: formatDistance(trip.distance_km),
      color: colors.info,
    },
    {
      icon: 'clock-outline',
      label: 'Duración',
      value: formatDuration(trip.duration_minutes),
      color: colors.warning,
    },
    {
      icon: 'cash',
      label: 'Ganancia',
      value: formatPrice(trip.price),
      color: colors.secondary,
      highlight: true,
    },
  ];

  return (
    <Animated.View entering={FadeInUp.delay(200).springify()}>
      <Card style={{ padding: 20 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 20,
            fontFamily: 'Inter_700Bold',
            textAlign: 'center',
            marginBottom: 4,
          }}
        >
          🎉 ¡Viaje completado!
        </Text>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 13,
            fontFamily: 'Inter_400Regular',
            textAlign: 'center',
            marginBottom: 20,
          }}
        >
          {formatDateTime(trip.completed_at)}
        </Text>

        {/* Route Summary */}
        <View style={{ marginBottom: 16 }}>
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
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
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
        </View>

        {/* Stats */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-around',
            paddingTop: 16,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          {items.map((item) => (
            <View key={item.label} style={{ alignItems: 'center' }}>
              <MaterialCommunityIcons name={item.icon} size={24} color={item.color} />
              <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
                {item.label}
              </Text>
              <Text
                style={{
                  color: item.highlight ? item.color : colors.text,
                  fontSize: item.highlight ? 22 : 16,
                  fontFamily: 'Inter_700Bold',
                  marginTop: 2,
                }}
              >
                {item.value}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </Animated.View>
  );
};
