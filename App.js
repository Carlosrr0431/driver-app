// Silenciar warnings de deprecación que no afectan funcionalidad
globalThis.RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;
import 'expo-device';
import './src/tasks/backgroundLocationTask';
import './src/services/notificationsBackground';
import { LogBox } from 'react-native';
LogBox.ignoreLogs([
  '[expo-av]',
  'This method is deprecated',
  'Invalid Refresh Token',
  'Refresh Token Not Found',
]);

import React, { useEffect, useState, useRef } from 'react';
import { StatusBar, View, Text } from 'react-native';
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
import { useAuthStore } from './src/stores/authStore';
import { useAppResumeHydrator } from './src/hooks/useAppResumeHydration';
import { useResponsive, ResponsiveProvider } from './src/hooks/useResponsive';
import { useStoreUpdateCheck } from './src/hooks/useStoreUpdateCheck';
import { StoreUpdateModal } from './src/components/ui/StoreUpdateModal';
import { DEV_AUTO_LOGIN, DEV_DRIVER_EMAIL, DEV_DRIVER_PASSWORD } from './src/config/devDefaults';
import { useTripStore } from './src/stores/tripStore';
import { colors } from './src/theme/colors';
import { navigateTo } from './src/navigation/navigationRef';
import {
  extractNotificationData,
  subscribeToForegroundMessages,
  subscribeToNotificationOpen,
} from './src/services/notifications';

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

const ToastContent = ({ text1, text2, borderColor }) => {
  const { s, fs, contentMaxWidth } = useResponsive();
  return (
    <View
      style={{
        maxWidth: Math.min(contentMaxWidth, s(340)),
        width: '90%',
        backgroundColor: colors.surface,
        borderRadius: s(12),
        padding: s(14),
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
      <Text style={{ color: colors.text, fontSize: fs(14), fontFamily: 'Inter_600SemiBold' }}>
        {text1}
      </Text>
      {text2 ? (
        <Text style={{ color: colors.textMuted, fontSize: fs(12), fontFamily: 'Inter_400Regular', marginTop: 2 }}>
          {text2}
        </Text>
      ) : null}
    </View>
  );
};

const toastConfig = {
  success: (props) => <ToastContent {...props} borderColor={colors.success} />,
  error: (props) => <ToastContent {...props} borderColor={colors.danger} />,
  info: (props) => <ToastContent {...props} borderColor={colors.info} />,
};

function applyIncomingPushData(data) {
  if (data?.type === 'new_trip' && data?.trip) {
    useTripStore.getState().setPendingTrip(data.trip);
  }
}

function handlePushTap(data) {
  if (!data) return;

  Notifications.setBadgeCountAsync(0).catch(() => {});

  if (data.type === 'new_trip') {
    if (data.trip) {
      useTripStore.getState().setPendingTrip(data.trip);
    }
    navigateTo('Home');
    return;
  }

  if (data.type === 'trip_chat') {
    const tripId = data.tripId || data.trip_id;
    if (tripId) {
      useTripStore.getState().requestOpenChat(String(tripId));
    }
    navigateTo('Home', { screen: 'ActiveTrip' });
    return;
  }

  if (data.type === 'dispatcher_message' || data.type === 'message') {
    navigateTo('Home');
  }
}

const AppContent = () => {
  const { login, fetchDriverProfile } = useAuth({ enableBootstrap: true });
  const { isAuthenticated, isLoading } = useAuthStore();
  useAppResumeHydrator(async () => {
    const userId = useAuthStore.getState().user?.id;
    if (userId) await fetchDriverProfile(userId);
  });
  const {
    visible: storeUpdateVisible,
    dismiss: dismissStoreUpdate,
    openUpdate: openStoreUpdate,
  } = useStoreUpdateCheck({
    isAuthenticated,
  });
  const devLoginAttempted = useRef(false);
  const notificationListener = useRef();
  const responseListener = useRef();
  const fcmForegroundSub = useRef();
  const fcmOpenSub = useRef();

  useEffect(() => {
    if (!DEV_AUTO_LOGIN || devLoginAttempted.current || isLoading || isAuthenticated) {
      return;
    }
    devLoginAttempted.current = true;
    login(DEV_DRIVER_EMAIL, DEV_DRIVER_PASSWORD).catch(() => {});
  }, [isAuthenticated, isLoading, login]);

  useEffect(() => {
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      applyIncomingPushData(notification.request.content.data);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      handlePushTap(response.notification.request.content.data);
    });

    fcmForegroundSub.current = subscribeToForegroundMessages((remoteMessage) => {
      applyIncomingPushData(extractNotificationData(remoteMessage));
    });

    fcmOpenSub.current = subscribeToNotificationOpen((remoteMessage) => {
      handlePushTap(extractNotificationData(remoteMessage));
    });

    Notifications.dismissAllNotificationsAsync().catch(() => {});

    return () => {
      notificationListener.current?.remove?.();
      responseListener.current?.remove?.();
      fcmForegroundSub.current?.remove?.();
      fcmOpenSub.current?.remove?.();
    };
  }, []);

  return (
    <>
      <AppNavigator />
      <StoreUpdateModal
        visible={storeUpdateVisible}
        onUpdate={openStoreUpdate}
        onDismiss={dismissStoreUpdate}
      />
    </>
  );
};

export default function App() {
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const forceReady = setTimeout(() => {
      if (!cancelled) {
        setAppReady(true);
        SplashScreen.hideAsync().catch(() => {});
      }
    }, 4000);

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
      } finally {
        if (!cancelled) {
          setAppReady(true);
          SplashScreen.hideAsync().catch(() => {});
        }
      }
    }
    prepare();
    return () => {
      cancelled = true;
      clearTimeout(forceReady);
    };
  }, []);

  if (!appReady) {
    return null;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <ResponsiveProvider>
              <StatusBar barStyle="light-content" backgroundColor={colors.background} />
              <AppContent />
              <Toast config={toastConfig} topOffset={60} />
            </ResponsiveProvider>
          </SafeAreaProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
