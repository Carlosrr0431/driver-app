/**
 * Componente: Avatar
 * Que hace: Renderiza avatar con imagen o iniciales y puede mostrar indicador de estado online/offline.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../../theme/colors';
import { useResponsive } from '../../hooks/useResponsive';

export const Avatar = ({ uri, name, size, showOnline, isOnline }) => {
  const { s } = useResponsive();
  const resolvedSize = s(size ?? 48, { min: 28 });

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
            width: resolvedSize,
            height: resolvedSize,
            borderRadius: resolvedSize / 2,
            borderWidth: 2,
            borderColor: colors.primary,
          }}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View
          style={{
            width: resolvedSize,
            height: resolvedSize,
            borderRadius: resolvedSize / 2,
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
              fontSize: resolvedSize * 0.35,
              fontFamily: 'Inter_700Bold',
            }}
          >
            {initials}
          </Text>
        </View>
      )}
      {showOnline ? (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: resolvedSize * 0.28,
            height: resolvedSize * 0.28,
            borderRadius: resolvedSize * 0.14,
            backgroundColor: isOnline ? colors.online : colors.offline,
            borderWidth: 2,
            borderColor: colors.background,
          }}
        />
      ) : null}
    </View>
  );
};
