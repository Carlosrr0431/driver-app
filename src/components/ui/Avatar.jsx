/**
 * Componente: Avatar
 * Que hace: Renderiza avatar con imagen o iniciales y puede mostrar indicador de estado online/offline.
 * Usado por:
 * - driver-app/src/screens/HomeScreen.old.jsx -> import { Avatar } from '../components/ui/Avatar';
 * - driver-app/src/screens/OwnerDashboardScreen.jsx -> import { Avatar } from '../components/ui/Avatar';
 * - driver-app/src/screens/OwnerDriverDetailScreen.jsx -> import { Avatar } from '../components/ui/Avatar';
 * - driver-app/src/screens/ProfileScreen.jsx -> import { Avatar } from '../components/ui/Avatar';
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../../theme/colors';

export const Avatar = ({ uri, name, size = 48, showOnline, isOnline }) => {
  const initials = name
    ? name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : '?';

  return (
    <View style={{ position: 'relative' }}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: colors.primary,
          }}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.surfaceLight,
            borderWidth: 2,
            borderColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: size * 0.35,
              fontFamily: 'Inter_700Bold',
            }}
          >
            {initials}
          </Text>
        </View>
      )}
      {showOnline && (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: size * 0.28,
            height: size * 0.28,
            borderRadius: size * 0.14,
            backgroundColor: isOnline ? colors.online : colors.offline,
            borderWidth: 2,
            borderColor: colors.background,
          }}
        />
      )}
    </View>
  );
};
