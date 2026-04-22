import React from 'react';
import { View, Image, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAuthStore } from '../stores/authStore';
import AuthNavigator from './AuthNavigator';
import MainNavigator from './MainNavigator';
import { colors } from '../theme/colors';

const AppNavigator = () => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Image
          source={require('../../assets/adaptive-icon.png')}
          style={{ width: 140, height: 140 }}
          resizeMode="contain"
        />
        <View
          style={{
            position: 'absolute',
            bottom: 80,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              color: '#8E8E93',
              fontSize: 13,
              fontFamily: 'Inter_400Regular',
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            Profesional
          </Text>
        </View>
      </View>
    );
  }

  return (
    <NavigationContainer
      theme={{
        dark: false,
        colors: {
          primary: colors.primary,
          background: colors.background,
          card: colors.surface,
          text: colors.text,
          border: colors.border,
          notification: colors.danger,
        },
        fonts: {
          regular: { fontFamily: 'Inter_400Regular', fontWeight: '400' },
          medium: { fontFamily: 'Inter_500Medium', fontWeight: '500' },
          bold: { fontFamily: 'Inter_700Bold', fontWeight: '700' },
          heavy: { fontFamily: 'Inter_700Bold', fontWeight: '700' },
        },
      }}
    >
      {isAuthenticated ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
};

export default AppNavigator;
