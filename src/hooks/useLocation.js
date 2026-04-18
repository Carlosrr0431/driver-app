import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
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
  const watchSubscriptionRef = useRef(null);
  const pendingBackgroundStartRef = useRef(false);

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

  const maybeStartBackgroundUpdates = useCallback(async () => {
    try {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (hasStarted) {
        pendingBackgroundStartRef.current = false;
        return true;
      }

      // Android foreground service can only be started while app is active.
      if (AppState.currentState !== 'active') {
        pendingBackgroundStartRef.current = true;
        return false;
      }

      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        distanceInterval: GPS_CONFIG.DISTANCE_FILTER,
        timeInterval: GPS_CONFIG.TRACKING_INTERVAL,
        foregroundService: {
          notificationTitle: 'Viaje en curso',
          notificationBody: 'Rastreando tu ubicacion...',
          notificationColor: '#DC2626',
        },
        showsBackgroundLocationIndicator: true,
      });

      pendingBackgroundStartRef.current = false;
      return true;
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      const isForegroundServiceTimingError =
        message.includes('foreground service cannot be started when the application is in the background') ||
        message.includes("couldn't start the foreground service");

      if (isForegroundServiceTimingError) {
        pendingBackgroundStartRef.current = true;
        return false;
      }

      console.error('Error iniciando tracking en background:', error);
      return false;
    }
  }, []);

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

    await maybeStartBackgroundUpdates();
  }, [requestPermissions, getCurrentPosition, updateDriverLocation, sendTrackingPoint, maybeStartBackgroundUpdates]);

  const stopTracking = useCallback(async () => {
    activeTripIdRef.current = null;
    pendingBackgroundStartRef.current = false;
    setIsTracking(false);

    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }

    try {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (hasStarted) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch (error) {
      // Task not running — safe to ignore
    }
  }, []);

  const lastLocationRef = useRef(null);
  const lastSupabasePushRef = useRef(0);

  const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const pushLocationToSupabase = useCallback(async (pos) => {
    if (!driver?.id) return;
    const now = Date.now();
    // Throttle: solo pushear cada 5 segundos como mínimo
    if (now - lastSupabasePushRef.current < 5000) return;
    lastSupabasePushRef.current = now;

    try {
      await supabase
        .from('driver_locations')
        .upsert({
          driver_id: driver.id,
          lat: pos.lat,
          lng: pos.lng,
          speed: pos.speed || 0,
          heading: pos.heading || 0,
          is_online: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_id' });
    } catch (error) {
      console.warn('Error pushing location to Supabase:', error.message);
    }
  }, [driver]);

  const setOfflineLocation = useCallback(async () => {
    if (!driver?.id) return;
    try {
      await supabase
        .from('driver_locations')
        .upsert({
          driver_id: driver.id,
          lat: currentLocation?.lat || 0,
          lng: currentLocation?.lng || 0,
          is_online: false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'driver_id' });
    } catch (error) {
      console.warn('Error setting offline:', error.message);
    }
  }, [driver, currentLocation]);

  const startWatching = useCallback(async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    if (watchSubscriptionRef.current) return;

    watchSubscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 5,
        timeInterval: 3000,
      },
      (location) => {
        const pos = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          speed: location.coords.speed,
          heading: location.coords.heading,
        };

        const last = lastLocationRef.current;
        if (last) {
          const dist = getDistanceMeters(last.lat, last.lng, pos.lat, pos.lng);
          if (dist < 5) return;
        }

        lastLocationRef.current = pos;
        setCurrentLocation(pos);
        pushLocationToSupabase(pos);
        updateDriverLocation(pos);
      }
    );
  }, [requestPermissions, setCurrentLocation, pushLocationToSupabase, updateDriverLocation]);

  const stopWatching = useCallback(() => {
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.remove();
      watchSubscriptionRef.current = null;
    }
    setOfflineLocation();
  }, [setOfflineLocation]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && pendingBackgroundStartRef.current && activeTripIdRef.current) {
        maybeStartBackgroundUpdates();
      }
    });

    return () => {
      subscription.remove();
      if (trackingIntervalRef.current) {
        clearInterval(trackingIntervalRef.current);
      }
      if (watchSubscriptionRef.current) {
        watchSubscriptionRef.current.remove();
        watchSubscriptionRef.current = null;
      }
    };
  }, [maybeStartBackgroundUpdates]);

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
    startWatching,
    stopWatching,
    updateDriverLocation,
    pushLocationToSupabase,
    setOfflineLocation,
  };
};
