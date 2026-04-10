import React from 'react';
import { View, Image, Text } from 'react-native';
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
