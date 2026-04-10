import React from 'react';
import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { TRIP_STATUS } from '../../utils/constants';

const STEPS = [
  { key: TRIP_STATUS.ACCEPTED, label: 'Viaje aceptado', icon: 'check-circle' },
  { key: TRIP_STATUS.GOING_TO_PICKUP, label: 'En camino al pasajero', icon: 'car' },
  { key: 'passenger_aboard', label: 'Pasajero a bordo', icon: 'account-check' },
  { key: TRIP_STATUS.COMPLETED, label: 'Viaje completado', icon: 'flag-checkered' },
];

const STATUS_ORDER = {
  [TRIP_STATUS.ACCEPTED]: 0,
  [TRIP_STATUS.GOING_TO_PICKUP]: 1,
  [TRIP_STATUS.IN_PROGRESS]: 2,
  [TRIP_STATUS.COMPLETED]: 3,
};

export const TripStepper = ({ currentStatus }) => {
  const currentIndex = STATUS_ORDER[currentStatus] ?? 0;

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
