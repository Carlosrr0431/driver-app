import * as Notifications from 'expo-notifications';
import { NativeModules, Platform } from 'react-native';
import { supabase } from './supabase';

const updateDriverPushToken = async (driverId, token) => {
  if (!driverId || !token) return;
  const { error } = await supabase
    .from('drivers')
    .update({ push_token: token })
    .eq('id', driverId);

  if (error) {
    console.warn('No se pudo guardar el push_token del chofer:', error.message || error);
  }
};

function isFirebaseMessagingAvailable() {
  try {
    return Boolean(NativeModules.RNFBAppModule);
  } catch {
    return false;
  }
}

function getMessagingModule() {
  if (!isFirebaseMessagingAvailable()) return null;
  try {
    return require('@react-native-firebase/messaging').default;
  } catch (error) {
    console.warn('Firebase Messaging no disponible:', error?.message || error);
    return null;
  }
}

async function resolveFcmToken() {
  const messaging = getMessagingModule();

  if (messaging) {
    try {
      if (Platform.OS === 'ios') {
        await messaging().registerDeviceForRemoteMessages();
        const authorizationStatus = await messaging().requestPermission();
        const isAuthorized =
          authorizationStatus === messaging.AuthorizationStatus.AUTHORIZED
          || authorizationStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (!isAuthorized) {
          console.warn('Permiso FCM denegado en iOS');
          return null;
        }
      }

      const token = await messaging().getToken();
      if (token) return token;
    } catch (error) {
      console.warn('No se pudo obtener token FCM con Firebase:', error?.message || error);
    }
  }

  if (Platform.OS === 'android') {
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      const token = deviceToken?.data ?? null;
      if (token) return token;
    } catch (error) {
      console.warn(
        'No se pudo obtener token FCM desde expo-notifications:',
        error?.message || error
      );
    }
  }

  return null;
}

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
    }),
  });
} catch (e) {
  console.warn('Notifications handler setup failed:', e);
}

export const registerForPushNotifications = async (driverId) => {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync(
        Platform.OS === 'ios'
          ? {
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
            },
          }
          : undefined
      );
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Permiso de notificaciones denegado');
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('trips', {
        name: 'Viajes',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#282e69',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      });

      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Mensajes',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });

      await Notifications.setNotificationChannelAsync('commission', {
        name: 'Comisiones',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#282e69',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      });
    }

    const token = await resolveFcmToken();
    if (!token) {
      console.warn('No se pudo obtener el token FCM');
      return null;
    }

    console.log('Token FCM registrado:', `${token.slice(0, 18)}...`);

    if (driverId && token) {
      await updateDriverPushToken(driverId, token);
    }

    return token;
  } catch (error) {
    console.warn('Push notification registration failed:', error);
    return null;
  }
};

export const sendLocalNotification = async (title, body, data = {}) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: 'default',
      },
      trigger: null,
    });
  } catch (error) {
    console.warn('Local notification failed:', error);
  }
};

export const addNotificationListener = (handler) => {
  return Notifications.addNotificationReceivedListener(handler);
};

export const addResponseListener = (handler) => {
  return Notifications.addNotificationResponseReceivedListener(handler);
};

export const setBadgeCount = async (count) => {
  await Notifications.setBadgeCountAsync(count);
};

export const sendPaymentSuccessNotification = async (formattedAmount) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '✅ Pago acreditado',
        body: `Tu comisión de ${formattedAmount} quedó registrada. ¡Gracias por tu pago!`,
        data: { screen: 'CommissionPayment' },
        sound: 'default',
        channelId: 'commission',
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('Payment success notification failed:', e);
  }
};

/**
 * Escucha rotaciones del push token y actualiza Supabase automáticamente.
 * Retorna la suscripción para que el llamador pueda limpiarla.
 */
export const subscribeToTokenRefresh = (driverId) => {
  const messaging = getMessagingModule();
  if (!messaging) {
    return { remove: () => {} };
  }

  const unsubscribe = messaging().onTokenRefresh(async (token) => {
    if (!driverId || !token) return;
    try {
      await updateDriverPushToken(driverId, token);
    } catch (e) {
      console.warn('Token refresh update failed:', e);
    }
  });

  return {
    remove: () => {
      try {
        unsubscribe();
      } catch (e) {
        console.warn('Token refresh unsubscribe failed:', e);
      }
    },
  };
};
