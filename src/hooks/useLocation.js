import { useCallback, useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../services/supabase';
import { useLocationStore } from '../stores/locationStore';
import { useAuthStore } from '../stores/authStore';
import { GPS_CONFIG } from '../utils/constants';
import Toast from 'react-native-toast-message';

const BACKGROUND_LOCATION_TASK = 'background-location-task';

try {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error('Error en tarea de ubicación:', error);
      return;
    }
    if (data) {
      const { locations } = data;
      const location = locations[0];
      if (location) {
        const { setCurrentLocation } = useLocationStore.getState();
        setCurrentLocation({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          speed: location.coords.speed,
          heading: location.coords.heading,
        });
      }
    }
  });
} catch (e) {
  console.warn('Background location task registration failed:', e);
}

export const useLocation = () => {
  const {
    currentLocation,
    isTracking,
    speed,
    heading,
    permissionStatus,
    setCurrentLocation,
    setIsTracking,
    setPermissionStatus,
  } = useLocationStore();

  const { driver } = useAuthStore();
  const trackingIntervalRef = useRef(null);
  const activeTripIdRef = useRef(null);

  const requestPermissions = useCallback(async () => {
    try {
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      if (foregroundStatus !== 'granted') {
        Toast.show({
          type: 'error',
          text1: 'Permiso denegado',
          text2: 'Necesitamos acceso a tu ubicación para funcionar correctamente',
        });
        setPermissionStatus('denied');
        return false;
      }

      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      setPermissionStatus(backgroundStatus === 'granted' ? 'granted' : 'foreground-only');

      return true;
    } catch (error) {
      console.error('Error solicitando permisos:', error);
      return false;
    }
  }, []);

  const getCurrentPosition = useCallback(async () => {
    try {
      // Verificar permisos antes de pedir ubicación
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const granted = await requestPermissions();
        if (!granted) return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const pos = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        speed: location.coords.speed,
        heading: location.coords.heading,
      };

      setCurrentLocation(pos);
      return pos;
    } catch (error) {
      console.warn('Error obteniendo posición:', error.message);
      return null;
    }
  }, [requestPermissions]);

  const updateDriverLocation = useCallback(async (location) => {
    if (!driver?.id || !location) return;
    try {
      await supabase
        .from('drivers')
        .update({
          current_lat: location.lat,
          current_lng: location.lng,
        })
        .eq('id', driver.id);
    } catch (error) {
      console.error('Error actualizando ubicación del chofer:', error);
    }
  }, [driver]);

  const sendTrackingPoint = useCallback(async (tripId, location) => {
    if (!tripId || !location || !driver?.id) return;
    try {
      await supabase.from('trip_tracking').insert({
        trip_id: tripId,
        driver_id: driver.id,
        lat: location.lat,
        lng: location.lng,
        speed: location.speed || 0,
        heading: location.heading || 0,
      });
    } catch (error) {
      console.error('Error enviando punto de tracking:', error);
    }
  }, [driver]);

  const startTracking = useCallback(async (tripId) => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    activeTripIdRef.current = tripId;
    setIsTracking(true);

    trackingIntervalRef.current = setInterval(async () => {
      const position = await getCurrentPosition();
      if (position) {
        await updateDriverLocation(position);
        if (activeTripIdRef.current) {
          await sendTrackingPoint(activeTripIdRef.current, position);
        }
      }
    }, GPS_CONFIG.TRACKING_INTERVAL);

    try {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        distanceInterval: GPS_CONFIG.DISTANCE_FILTER,
        timeInterval: GPS_CONFIG.TRACKING_INTERVAL,
        foregroundService: {
          notificationTitle: 'Viaje en curso',
          notificationBody: 'Rastreando tu ubicación...',
          notificationColor: '#6C63FF',
        },
        showsBackgroundLocationIndicator: true,
      });
    } catch (error) {
      console.error('Error iniciando tracking en background:', error);
    }
  }, [requestPermissions, getCurrentPosition, updateDriverLocation, sendTrackingPoint]);

  const stopTracking = useCallback(async () => {
    activeTripIdRef.current = null;
    setIsTracking(false);

    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }

    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      if (isRegistered) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch (error) {
      console.error('Error deteniendo tracking:', error);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (trackingIntervalRef.current) {
        clearInterval(trackingIntervalRef.current);
      }
    };
  }, []);

  return {
    currentLocation,
    isTracking,
    speed,
    heading,
    permissionStatus,
    requestPermissions,
    getCurrentPosition,
    startTracking,
    stopTracking,
    updateDriverLocation,
  };
};
