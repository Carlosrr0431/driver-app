import React, { useEffect, useState, useRef } from 'react';
import { StatusBar, View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import Toast from 'react-native-toast-message';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import AppNavigator from './src/navigation/AppNavigator';
import { useAuth } from './src/hooks/useAuth';
import { useTripStore } from './src/stores/tripStore';
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

const ToastContent = ({ text1, text2, borderColor }) => (
  <View
    style={{
      maxWidth: '90%',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderLeftWidth: 4,
      borderLeftColor: borderColor,
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
    {text2 ? (
      <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
        {text2}
      </Text>
    ) : null}
  </View>
);

const toastConfig = {
  success: (props) => <ToastContent {...props} borderColor={colors.success} />,
  error: (props) => <ToastContent {...props} borderColor={colors.danger} />,
  info: (props) => <ToastContent {...props} borderColor={colors.info} />,
};

const AppContent = () => {
  useAuth();
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    // Listen for notifications received while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (data?.type === 'new_trip' && data?.trip) {
        useTripStore.getState().setPendingTrip(data.trip);
      }
    });

    // Handle user tapping on a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data && Object.keys(data).length > 0) {
        console.log('Notification tapped, data:', data);
      }
    });

    // Dismiss all delivered notifications to prevent re-delivery loop
    Notifications.dismissAllNotificationsAsync().catch(() => {});

    return () => {
      if (notificationListener.current) notificationListener.current.remove();
      if (responseListener.current) responseListener.current.remove();
    };
  }, []);

  return <AppNavigator />;
};

export default function App() {
  const [appReady, setAppReady] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    async function prepare() {
      try {
        await Font.loadAsync({
          Inter_400Regular,
          Inter_500Medium,
          Inter_600SemiBold,
          Inter_700Bold,
        });
      } catch (e) {
        console.warn('Error loading fonts:', e);
        setLoadError(e);
      } finally {
        setAppReady(true);
        try { SplashScreen.hideAsync(); } catch (_) {}
      }
    }
    prepare();
  }, []);

  if (!appReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0B1120', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#DC2626" />
        <Text style={{ color: '#94A3B8', marginTop: 16, fontSize: 14 }}>Cargando...</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0B1120', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ color: '#FF4757', fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>Error de carga</Text>
        <Text style={{ color: '#A0AEC0', fontSize: 13, textAlign: 'center' }}>{String(loadError)}</Text>
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
