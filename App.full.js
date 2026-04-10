import React, { useEffect, useState } from 'react';
import { StatusBar, View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import Toast from 'react-native-toast-message';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import AppNavigator from './src/navigation/AppNavigator';
import { useAuth } from './src/hooks/useAuth';
import { colors } from './src/theme/colors';

try {
  SplashScreen.preventAutoHideAsync();
} catch (_) {}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    },
  },
});

const toastConfig = {
  success: ({ text1, text2 }) => (
    <View
      style={{
        maxWidth: '90%',
        backgroundColor: colors.surface,
        borderRadius: 12,
        padding: 14,
        borderLeftWidth: 4,
        borderLeftColor: colors.success,
        borderWidth: 1,
        borderColor: colors.border,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
        {text1}
      </Text>
      {text2 && (
        <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
          {text2}
        </Text>
      )}
    </View>
  ),
  error: ({ text1, text2 }) => (
    <View
      style={{
        maxWidth: '90%',
        backgroundColor: colors.surface,
        borderRadius: 12,
        padding: 14,
        borderLeftWidth: 4,
        borderLeftColor: colors.danger,
        borderWidth: 1,
        borderColor: colors.border,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
        {text1}
      </Text>
      {text2 && (
        <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
          {text2}
        </Text>
      )}
    </View>
  ),
  info: ({ text1, text2 }) => (
    <View
      style={{
        maxWidth: '90%',
        backgroundColor: colors.surface,
        borderRadius: 12,
        padding: 14,
        borderLeftWidth: 4,
        borderLeftColor: colors.info,
        borderWidth: 1,
        borderColor: colors.border,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
        {text1}
      </Text>
      {text2 && (
        <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
          {text2}
        </Text>
      )}
    </View>
  ),
};

const AppContent = () => {
  useAuth();
  return <AppNavigator />;
};

export default function App() {
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        await Font.loadAsync({
          Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
          Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
          Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
          Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
        });
      } catch (e) {
        console.warn('Error loading fonts:', e);
      } finally {
        setAppReady(true);
        SplashScreen.hideAsync().catch(() => {});
      }
    }
    prepare();
  }, []);

  if (!appReady) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <StatusBar barStyle="light-content" backgroundColor={colors.background} />
            <AppContent />
            <Toast config={toastConfig} topOffset={60} />
          </SafeAreaProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
