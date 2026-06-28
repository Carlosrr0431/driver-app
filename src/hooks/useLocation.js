import { useCallback, useEffect, useRef } from 'react';
import { AppState, InteractionManager } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../services/supabase';
import { useLocationStore } from '../stores/locationStore';
import { useAuthStore } from '../stores/authStore';
import { GPS_CONFIG } from '../utils/constants';
import { isGpsSimulationActive } from '../lib/gpsSimulation';
import { BACKGROUND_LOCATION_TASK } from '../tasks/backgroundLocationTask';
import Toast from 'react-native-toast-message';
const NAV_MAX_ACCURACY_METERS = 30;
const WATCH_MAX_ACCURACY_METERS = 25;
const MAP_BOOTSTRAP_MAX_ACCURACY_METERS = 150;
const BACKGROUND_START_MAX_RETRIES = 5;

function isBackgroundLocationNativeError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('sharedpreferences')
    || message.includes('nullpointerexception')
    || message.includes('null object reference')
    || message.includes('taskmanager.definetask')
    || message.includes("couldn't start the foreground service")
    || message.includes('foreground service cannot be started')
  );
}

async function safeHasStartedLocationUpdates(taskName) {
  try {
    return await Location.hasStartedLocationUpdatesAsync(taskName);
  } catch (error) {
    if (isBackgroundLocationNativeError(error)) return false;
    throw error;
  }
}

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  const navWatchSubscriptionRef = useRef(null);
  const navLastLocationRef = useRef(null);
  const pendingBackgroundStartRef = useRef(false);
  const backgroundStartAttemptRef = useRef({ failCount: 0, nextRetryAt: 0 });
  const isNavigationWatchActiveRef = useRef(false);
  const lastLocationRef = useRef(null);
  const lastSupabasePushRef = useRef(0);
  const hasSyncedToSupabaseRef = useRef(false);

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

  const updateDriverLocation = useCallback(async (location) => {
    if (!driver?.id || !location || isGpsSimulationActive()) return;
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

  const pushLocationToSupabase = useCallback(async (pos, options = {}) => {
    const { force = false } = options;
    if (!driver?.id || isGpsSimulationActive()) return;
    const now = Date.now();
    if (!force && now - lastSupabasePushRef.current < 5000) return;
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

  const syncLocationToBackend = useCallback(async (pos, options = {}) => {
    const { force = false } = options;
    if (!driver?.id || !pos || isGpsSimulationActive()) return;
    hasSyncedToSupabaseRef.current = true;
    await updateDriverLocation(pos);
    await pushLocationToSupabase(pos, { force });
  }, [driver, updateDriverLocation, pushLocationToSupabase]);

  const readPosition = useCallback(async (force = false) => {
    const accuracyMode = force
      ? Location.Accuracy.Balanced
      : Location.Accuracy.BestForNavigation;

    try {
      return await Location.getCurrentPositionAsync({ accuracy: accuracyMode });
    } catch (error) {
      if (!force) throw error;
      return Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      });
    }
  }, []);

  const getCurrentPosition = useCallback(async (options = {}) => {
    const { syncToSupabase = false, force = false } = options;
    if (isGpsSimulationActive()) {
      return useLocationStore.getState().currentLocation;
    }
    try {
      // Verificar permisos antes de pedir ubicación
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const granted = await requestPermissions();
        if (!granted) return null;
      }

      const location = await readPosition(force);
      const accuracy = location.coords.accuracy ?? 99;
      const maxAccuracy = force ? MAP_BOOTSTRAP_MAX_ACCURACY_METERS : NAV_MAX_ACCURACY_METERS;
      if (accuracy > maxAccuracy) return null;

      const pos = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        speed: location.coords.speed ?? 0,
        heading: location.coords.heading ?? 0,
        accuracy,
      };

      // Filtro de movimiento: evita actualizar currentLocation cuando el auto está
      // detenido y el GPS jittea entre la calle y la vereda.
      const last = lastLocationRef.current;
      if (last && !force) {
        const distMeters = getDistanceMeters(last.lat, last.lng, pos.lat, pos.lng);
        const isMoving = pos.speed > 1.5; // m/s ≈ 5.4 km/h
        // Parado: requiere ≥ 12 m de desplazamiento antes de aceptar el nuevo punto.
        // En movimiento: cualquier cambio ≥ 4 m es relevante para la navegación.
        if (distMeters < (isMoving ? 4 : 12)) return null;
      }
      lastLocationRef.current = pos;

      setCurrentLocation(pos);
      if (syncToSupabase) {
        await syncLocationToBackend(pos, { force: true });
      }
      return pos;
    } catch (error) {
      console.warn('Error obteniendo posición:', error.message);
      return null;
    }
  }, [requestPermissions, readPosition, setCurrentLocation, syncLocationToBackend]);

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
    if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
      pendingBackgroundStartRef.current = true;
      return false;
    }

    try {
      const isAvailable = await TaskManager.isAvailableAsync();
      if (!isAvailable) return false;
    } catch {
      return false;
    }

    const { status: backgroundStatus } = await Location.getBackgroundPermissionsAsync();
    if (backgroundStatus !== 'granted') return false;

    if (AppState.currentState !== 'active') {
      pendingBackgroundStartRef.current = true;
      return false;
    }

    const now = Date.now();
    if (backgroundStartAttemptRef.current.nextRetryAt > now) {
      return false;
    }

    try {
      const hasStarted = await safeHasStartedLocationUpdates(BACKGROUND_LOCATION_TASK);
      if (hasStarted) {
        pendingBackgroundStartRef.current = false;
        backgroundStartAttemptRef.current = { failCount: 0, nextRetryAt: 0 };
        return true;
      }

      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        distanceInterval: GPS_CONFIG.DISTANCE_FILTER,
        timeInterval: GPS_CONFIG.TRACKING_INTERVAL,
        foregroundService: {
          notificationTitle: 'Viaje en curso',
          notificationBody: 'Rastreando tu ubicacion...',
          notificationColor: '#282e69',
        },
        showsBackgroundLocationIndicator: true,
      });

      pendingBackgroundStartRef.current = false;
      backgroundStartAttemptRef.current = { failCount: 0, nextRetryAt: 0 };
      return true;
    } catch (error) {
      if (isBackgroundLocationNativeError(error)) {
        const failCount = backgroundStartAttemptRef.current.failCount + 1;
        const backoffMs = Math.min(30000, 1500 * failCount);
        backgroundStartAttemptRef.current = {
          failCount,
          nextRetryAt: Date.now() + backoffMs,
        };
        pendingBackgroundStartRef.current = failCount < BACKGROUND_START_MAX_RETRIES;

        if (failCount <= 2) {
          console.warn(
            'Tracking en background no listo; se reintentará. El viaje sigue con GPS en primer plano.',
            error?.message,
          );
        }
        return false;
      }

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
      if (isGpsSimulationActive()) {
        const simulated = useLocationStore.getState().currentLocation;
        if (simulated && activeTripIdRef.current) {
          await sendTrackingPoint(activeTripIdRef.current, simulated);
        }
        return;
      }

      const position = await getCurrentPosition();
      if (position) {
        await updateDriverLocation(position);
        if (activeTripIdRef.current) {
          await sendTrackingPoint(activeTripIdRef.current, position);
        }
      }
    }, GPS_CONFIG.TRACKING_INTERVAL);

    await new Promise((resolve) => {
      InteractionManager.runAfterInteractions(() => {
        setTimeout(resolve, 300);
      });
    });
    await maybeStartBackgroundUpdates();
  }, [requestPermissions, getCurrentPosition, updateDriverLocation, sendTrackingPoint, maybeStartBackgroundUpdates]);

  const stopTracking = useCallback(async () => {
    activeTripIdRef.current = null;
    pendingBackgroundStartRef.current = false;
    backgroundStartAttemptRef.current = { failCount: 0, nextRetryAt: 0 };
    setIsTracking(false);

    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }

    try {
      const hasStarted = await safeHasStartedLocationUpdates(BACKGROUND_LOCATION_TASK);
      if (hasStarted) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch (error) {
      // Task not running — safe to ignore
    }
  }, []);

  const applyLocationUpdate = useCallback((pos, options = {}) => {
    if (isGpsSimulationActive()) return false;

    const {
      minMovingMeters = 8,
      minStoppedMeters = 15,
      skipSupabase = false,
      force = false,
    } = options;
    const last = lastLocationRef.current;
    if (!force && last) {
      const dist = getDistanceMeters(last.lat, last.lng, pos.lat, pos.lng);
      const isMoving = pos.speed > 1.5;
      const minDist = isMoving ? minMovingMeters : minStoppedMeters;
      if (dist < minDist) return false;
    }

    lastLocationRef.current = pos;
    setCurrentLocation(pos);
    if (!skipSupabase) {
      hasSyncedToSupabaseRef.current = true;
      pushLocationToSupabase(pos, { force });
      updateDriverLocation(pos);
    }
    return true;
  }, [setCurrentLocation, pushLocationToSupabase, updateDriverLocation]);

  const startNavigationWatch = useCallback(async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;
    if (navWatchSubscriptionRef.current) return;

    isNavigationWatchActiveRef.current = true;
    navLastLocationRef.current = lastLocationRef.current;

    navWatchSubscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 3,
        timeInterval: 1000,
      },
      (location) => {
        const accuracy = location.coords.accuracy ?? 99;
        if (accuracy > 28) return;

        const pos = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          speed: location.coords.speed ?? 0,
          heading: location.coords.heading ?? 0,
          accuracy,
        };

        const last = navLastLocationRef.current || lastLocationRef.current;
        if (last) {
          const dist = getDistanceMeters(last.lat, last.lng, pos.lat, pos.lng);
          const isMoving = pos.speed > 1.2;
          const minDist = isMoving ? 3 : 8;
          if (dist < minDist) return;
        }

        navLastLocationRef.current = pos;
        applyLocationUpdate(pos, { minMovingMeters: 0, minStoppedMeters: 0 });
      },
    );
  }, [requestPermissions, applyLocationUpdate]);

  const stopNavigationWatch = useCallback(() => {
    isNavigationWatchActiveRef.current = false;
    navLastLocationRef.current = null;
    if (navWatchSubscriptionRef.current) {
      navWatchSubscriptionRef.current.remove();
      navWatchSubscriptionRef.current = null;
    }
  }, []);

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

  const startWatching = useCallback(async (options = {}) => {
    const { mapOnly = false } = options;
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    if (watchSubscriptionRef.current) return;

    watchSubscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 8,
        timeInterval: 3000,
      },
      (location) => {
        const accuracy = location.coords.accuracy ?? 99;
        const needsBootstrap = !useLocationStore.getState().currentLocation;
        const maxAccuracy = needsBootstrap
          ? MAP_BOOTSTRAP_MAX_ACCURACY_METERS
          : (mapOnly ? MAP_BOOTSTRAP_MAX_ACCURACY_METERS : WATCH_MAX_ACCURACY_METERS);
        if (accuracy > maxAccuracy) return;

        const pos = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          speed: location.coords.speed ?? 0,
          heading: location.coords.heading ?? 0,
          accuracy,
        };

        if (mapOnly) {
          applyLocationUpdate(pos, {
            force: needsBootstrap,
            skipSupabase: true,
            minMovingMeters: needsBootstrap ? 0 : 8,
            minStoppedMeters: needsBootstrap ? 0 : 15,
          });
          return;
        }

        if (!hasSyncedToSupabaseRef.current) {
          applyLocationUpdate(pos, { force: true });
          return;
        }

        const last = lastLocationRef.current;
        if (last) {
          const dist = getDistanceMeters(last.lat, last.lng, pos.lat, pos.lng);
          const isMoving = pos.speed > 1.5; // m/s ≈ 5.4 km/h
          const minDist = isMoving ? 8 : 15;
          if (dist < minDist) return;
        }

        applyLocationUpdate(pos);
      }
    );
  }, [requestPermissions, applyLocationUpdate]);

  const stopWatching = useCallback(() => {
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.remove();
      watchSubscriptionRef.current = null;
    }
    hasSyncedToSupabaseRef.current = false;
    setOfflineLocation();
  }, [setOfflineLocation]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && pendingBackgroundStartRef.current && activeTripIdRef.current) {
        setTimeout(() => {
          maybeStartBackgroundUpdates();
        }, 500);
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
      stopNavigationWatch();
    };
  }, [maybeStartBackgroundUpdates, stopNavigationWatch]);

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
    startNavigationWatch,
    stopNavigationWatch,
    updateDriverLocation,
    pushLocationToSupabase,
    setOfflineLocation,
  };
};
