import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
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
    const { status } = await Notifications.requestPermissionsAsync();
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
      lightColor: '#6C63FF',
      sound: 'default',
    });

    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Mensajes',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }

  const token = (await Notifications.getExpoPushTokenAsync()).data;

  if (driverId && token) {
    await supabase
      .from('drivers')
      .update({ push_token: token })
      .eq('id', driverId);
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
