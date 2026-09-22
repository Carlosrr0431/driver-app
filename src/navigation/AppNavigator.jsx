import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { NavigationContainer } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/authStore';
import { useGpsSimulation } from '../hooks/useGpsSimulation';
import { useNavigationPersistence } from '../hooks/useNavigationPersistence';
import { useAppResumeHydration } from '../hooks/useAppResumeHydration';
import { AppResumeSkeleton } from '../components/ui/AppResumeSkeleton';
import AuthNavigator from './AuthNavigator';
import MainNavigator from './MainNavigator';
import { colors } from '../theme/colors';
import { navigationRef } from './navigationRef';

function GpsSimulationBridge() {
  useGpsSimulation();
  return null;
}

function AppResumeBridge() {
  const queryClient = useQueryClient();
  const visible = useAppResumeHydration({
    hydrate: () => queryClient.invalidateQueries({ refetchType: 'all' }),
  });
  return <AppResumeSkeleton visible={visible} />;
}

const AppNavigator = () => {
  const { isAuthenticated, isLoading } = useAuthStore();
  const insets = useSafeAreaInsets();
  const {
    showNavigation,
    showLoadingOverlay,
    navigationInitialState,
    onNavigationStateChange,
  } = useNavigationPersistence({
    isAuthed: isAuthenticated,
    isLoading,
  });

  return (
    <View style={styles.root}>
      {showNavigation ? (
        <NavigationContainer
          ref={navigationRef}
          initialState={navigationInitialState}
          onStateChange={onNavigationStateChange}
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
          {isAuthenticated ? (
            <>
              <GpsSimulationBridge />
              <MainNavigator />
            </>
          ) : (
            <AuthNavigator />
          )}
        </NavigationContainer>
      ) : null}
      <AppResumeBridge />
      {showLoadingOverlay ? (
        <View style={styles.loadingOverlay} pointerEvents="auto">
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logo}
            contentFit="contain"
          />
          <View style={[styles.splashFooter, { bottom: Math.max(insets.bottom, 24) + 56 }]}>
            <Text style={styles.splashText}>Profesional</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 280,
    height: 280,
  },
  splashFooter: {
    position: 'absolute',
    alignItems: 'center',
  },
  splashText: {
    color: '#8E8E93',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});

export default AppNavigator;
