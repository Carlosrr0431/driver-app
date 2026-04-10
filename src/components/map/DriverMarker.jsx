import React from 'react';
import { View } from 'react-native';
import { Marker } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

export const DriverMarker = ({ coordinate, heading = 0 }) => {
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={heading}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 3,
          borderColor: '#FFFFFF',
          elevation: 5,
          shadowColor: colors.primary,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.4,
          shadowRadius: 4,
        }}
      >
        <MaterialCommunityIcons name="car" size={22} color="#FFFFFF" />
      </View>
      {/* Pulse animation ring */}
      <View
        style={{
          position: 'absolute',
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: `${colors.primary}20`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      />
    </Marker>
  );
};
