import React from 'react';
import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

const STEPS = [
  { key: 'going_to_pickup', label: 'En camino al pasajero', icon: 'car' },
  { key: 'at_pickup', label: 'Pasajero a bordo', icon: 'account-check' },
  { key: 'set_destination', label: 'Destino por voz', icon: 'microphone' },
  { key: 'in_progress', label: 'Viaje en curso', icon: 'road-variant' },
];

const STEP_ORDER = {
  'going_to_pickup': 0,
  'at_pickup': 1,
  'set_destination': 2,
  'in_progress': 3,
  'completed': 4,
};

export const TripStepper = ({ currentStatus }) => {
  const currentIndex = STEP_ORDER[currentStatus] ?? 0;

  return (
    <View style={{ paddingVertical: 8 }}>
      {STEPS.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isUpcoming = index > currentIndex;

        let stepColor = colors.textMuted;
        if (isCompleted) stepColor = colors.success;
        if (isCurrent) stepColor = colors.primary;

        return (
          <View key={step.key}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {/* Circle / Icon */}
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: isCompleted
                    ? `${colors.success}20`
                    : isCurrent
                    ? `${colors.primary}20`
                    : `${colors.textMuted}10`,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: isCurrent ? 2 : 0,
                  borderColor: isCurrent ? colors.primary : 'transparent',
                }}
              >
                <MaterialCommunityIcons
                  name={isCompleted ? 'check' : step.icon}
                  size={18}
                  color={stepColor}
                />
              </View>

              {/* Label */}
              <Text
                style={{
                  marginLeft: 12,
                  color: isUpcoming ? colors.textMuted : colors.text,
                  fontSize: 14,
                  fontFamily: isCurrent ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  opacity: isUpcoming ? 0.5 : 1,
                }}
              >
                {isCurrent ? `📍 ${step.label}` : step.label}
              </Text>
            </View>

            {/* Connector Line */}
            {index < STEPS.length - 1 && (
              <View
                style={{
                  width: 2,
                  height: 20,
                  backgroundColor: isCompleted ? colors.success : colors.border,
                  marginLeft: 15,
                  marginVertical: 2,
                }}
              />
            )}
          </View>
        );
      })}
    </View>
  );
};
