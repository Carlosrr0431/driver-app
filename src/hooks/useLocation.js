import { useCallback, useEffect, useRef } from 'react';
import { AppState, InteractionManager, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../services/supabase';
import { useLocationStore } from '../stores/locationStore';
import { useAuthStore } from '../stores/authStore';
import { GPS_CONFIG } from '../utils/constants';
import { coordsToMapPos, shouldAcceptForceLocation } from '../utils/homeMapCamera';
import {
  BOOTSTRAP_MAX_ACCURACY_M,
  FOREGROUND_MAX_ACCURACY_M,
  FOREGROUND_WATCH_DISTANCE_INTERVAL_M,
  FOREGROUND_WATCH_TIME_INTERVAL_MS,
  MOVING_ACCEPT_METERS,
  MOVING_SPEED_MPS,
  NAV_WATCH_DISTANCE_INTERVAL_M,
  NAV_WATCH_TIME_INTERVAL_MS,
  STOPPED_ACCEPT_METERS,
  bearingDegrees,
  shouldAcceptLocationStep,
  resolveForcedFixAccuracy,
  shouldRefreshLocationOnForeground,
  shouldUseLastKnownBootstrap,
  buildFleetBackgroundLocationOptions,
  isAlwaysLocationGranted,
} from '../utils/locationWatch';
import { isGpsSimulationActive } from '../lib/gpsSimulation';
import {
  canStartFleetBackgroundUpdates,
  requestFleetLocationPermissions,
  resolveLocationPermissionStatus,
} from '../lib/locationPermissions';
import {
  clearDriverGpsContext,
  publishDriverGps,
  saveDriverGpsContext,
  shouldKeepFleetGps,
} from '../lib/driverGpsPublish';
import { BACKGROUND_LOCATION_TASK, stopBackgroundLocationUpdates } from '../tasks/backgroundLocationTask';
import Toast from 'react-native-toast-message';
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;
const LAST_KNOWN_REQUIRED_ACCURACY_M = 800;
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
  const watchMapOnlyRef = useRef(null);
  const navWatchSubscriptionRef = useRef(null);
  const navLastLocationRef = useRef(null);
  const pendingBackgroundStartRef = useRef(false);
  const backgroundStartAttemptRef = useRef({ failCount: 0, nextRetryAt: 0 });
  const fleetGpsEnabledRef = useRef(false);
  const backgroundDeniedToastRef = useRef(false);
  const isNavigationWatchActiveRef = useRef(false);
  const lastLocationRef = useRef(null);
  const hasSyncedToSupabaseRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);

  const applyPermissionResult = useCallback((result) => {
    setPermissionStatus(resolveLocationPermissionStatus(result));
  }, [setPermissionStatus]);

  const ensureForegroundPermission = useCallback(async () => {
    try {
      const result = await requestFleetLocationPermissions(Location, { background: false });
      applyPermissionResult(result);
      if (result.foreground) return true;
      Toast.show({
        type: 'error',
        text1: 'Permiso denegado',
        text2: 'Necesitamos acceso a tu ubicación para funcionar correctamente',
      });
      return false;
    } catch (error) {
      console.error('Error solicitando permisos:', error);
      return false;
    }
  }, [applyPermissionResult]);

  const requestPermissions = useCallback(async () => {
    try {
      const result = await requestFleetLocationPermissions(Location, { background: true });
      applyPermissionResult(result);
      if (result.foreground) return true;
      Toast.show({
        type: 'error',
        text1: 'Permiso denegado',
        text2: 'Necesitamos acceso a tu ubicación para funcionar correctamente',
      });
      return false;
    } catch (error) {
      console.error('Error solicitando permisos:', error);
      return false;
    }
  }, [applyPermissionResult]);

  const updateDriverLocation = useCallback(async (location) => {
    if (!driver?.id || !location || isGpsSimulationActive()) return;
    await publishDriverGps({
      driverId: driver.id,
      pos: location,
      isOnline: true,
    });
  }, [driver]);

  const pushLocationToSupabase = useCallback(async (pos, options = {}) => {
    const { force = false } = options;
    if (!driver?.id || !pos || isGpsSimulationActive()) return;
    await publishDriverGps({
      driverId: driver.id,
      pos,
      isOnline: true,
      force,
    });
  }, [driver]);

  const syncLocationToBackend = useCallback(async (pos, options = {}) => {
    const { force = false } = options;
    if (!driver?.id || !pos || isGpsSimulationActive()) return;
    hasSyncedToSupabaseRef.current = true;
    await updateDriverLocation(pos);
    await pushLocationToSupabase(pos, { force });
  }, [driver, updateDriverLocation, pushLocationToSupabase]);

  const readPosition = useCallback(async (force = false) => {
    try {
      return await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
    } catch (error) {
      if (!force) throw error;
      return Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    }
  }, []);

  const applyCurrentPosition = useCallback((pos, { syncToSupabase = false } = {}) => {
    lastLocationRef.current = pos;
    setCurrentLocation(pos);
    if (syncToSupabase) {
      void syncLocationToBackend(pos, { force: true });
    }
    return pos;
  }, [setCurrentLocation, syncLocationToBackend]);

  const readLastKnownPosition = useCallback(async () => {
    try {
      return await Location.getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracy: LAST_KNOWN_REQUIRED_ACCURACY_M,
      });
    } catch {
      return null;
    }
  }, []);

  const refineForcePosition = useCallback((syncToSupabase) => {
    void readPosition(true)
      .then((fresh) => {
        const next = coordsToMapPos(fresh);
        if (!next) return;
        applyCurrentPosition(next, { syncToSupabase });
      })
      .catch(() => {});
  }, [applyCurrentPosition, readPosition]);

  const getCurrentPosition = useCallback(async (options = {}) => {
    const { syncToSupabase = false, force = false } = options;
    if (isGpsSimulationActive()) {
      return useLocationStore.getState().currentLocation;
    }
    try {
      const granted = await ensureForegroundPermission();
      if (!granted) return null;

      const hasCurrentFix = Boolean(
        lastLocationRef.current || useLocationStore.getState().currentLocation,
      );
      if (shouldUseLastKnownBootstrap({ force, hasCurrentFix })) {
        const cached = coordsToMapPos(await readLastKnownPosition());
        if (cached) {
          applyCurrentPosition(cached, { syncToSupabase });
          refineForcePosition(syncToSupabase);
          return cached;
        }
      }

      const location = await readPosition(force);
      const pos = coordsToMapPos(location);
      if (!pos) return null;

      const { allowCoarse, maxAccuracy } = resolveForcedFixAccuracy({ force, hasCurrentFix });
      if (!shouldAcceptForceLocation(pos.accuracy, maxAccuracy, allowCoarse)) return null;

      const last = lastLocationRef.current;
      if (last && !force && !shouldAcceptLocationStep(last, pos, {
        movingMeters: MOVING_ACCEPT_METERS,
        stoppedMeters: STOPPED_ACCEPT_METERS,
      })) {
        return null;
      }

      return applyCurrentPosition(pos, { syncToSupabase });
    } catch (error) {
      console.warn('Error obteniendo posición:', error.message);
      return null;
    }
  }, [
    applyCurrentPosition,
    ensureForegroundPermission,
    readLastKnownPosition,
    readPosition,
    refineForcePosition,
  ]);

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

    const foregroundPermission = await Location.getForegroundPermissionsAsync();
    const backgroundPermission = await Location.getBackgroundPermissionsAsync();
    if (!canStartFleetBackgroundUpdates({
      platform: Platform.OS,
      foreground: foregroundPermission?.status === 'granted',
      always: isAlwaysLocationGranted(backgroundPermission),
    })) {
      return false;
    }

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

      const startOptions = buildFleetBackgroundLocationOptions(Location);
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, startOptions);

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
            'Tracking en background no listo; se reintentará. El GPS en primer plano sigue activo.',
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

  const enableFleetGps = useCallback(async () => {
    if (!driver?.id || isGpsSimulationActive()) return false;
    fleetGpsEnabledRef.current = true;
    await saveDriverGpsContext({
      driverId: driver.id,
      publish: true,
      isOnline: true,
    });

    let result;
    try {
      result = await requestFleetLocationPermissions(Location, { background: true });
    } catch (error) {
      console.error('Error solicitando permisos:', error);
      pendingBackgroundStartRef.current = true;
      return false;
    }
    applyPermissionResult(result);

    if (!result.foreground) {
      pendingBackgroundStartRef.current = true;
      return false;
    }

    if (!canStartFleetBackgroundUpdates({
      platform: Platform.OS,
      foreground: true,
      always: result.always,
    })) {
      pendingBackgroundStartRef.current = true;
      if (!backgroundDeniedToastRef.current) {
        backgroundDeniedToastRef.current = true;
        Toast.show({
          type: 'info',
          text1: 'Ubicación en segundo plano',
          text2: 'En Ajustes → Profesional Conductor → Ubicación, elegí Siempre. Si no, la central no actualiza tu pin con la app en segundo plano.',
        });
      }
      return false;
    }

    return maybeStartBackgroundUpdates();
  }, [applyPermissionResult, driver, maybeStartBackgroundUpdates]);

  const disableFleetGps = useCallback(async () => {
    fleetGpsEnabledRef.current = false;
    pendingBackgroundStartRef.current = false;
    backgroundStartAttemptRef.current = { failCount: 0, nextRetryAt: 0 };
    await clearDriverGpsContext();
    await stopBackgroundLocationUpdates();
  }, []);

  const startTracking = useCallback(async (tripId) => {
    const hasPermission = await ensureForegroundPermission();
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

      // Si el nav watch ya actualiza GPS ~1s, no pedir otra lectura (evita pisar lastLocationRef).
      if (isNavigationWatchActiveRef.current) {
        const position = useLocationStore.getState().currentLocation;
        if (position) {
          await updateDriverLocation(position);
          if (activeTripIdRef.current) {
            await sendTrackingPoint(activeTripIdRef.current, position);
          }
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
    await enableFleetGps();
  }, [ensureForegroundPermission, getCurrentPosition, updateDriverLocation, sendTrackingPoint, enableFleetGps]);

  const stopTracking = useCallback(async () => {
    activeTripIdRef.current = null;
    setIsTracking(false);

    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }

    const keepFleet = shouldKeepFleetGps({
      isAvailable: useAuthStore.getState().driver?.is_available,
      isTracking: false,
    });
    if (!keepFleet) {
      await disableFleetGps();
    }
  }, [disableFleetGps]);

  const applyLocationUpdate = useCallback((pos, options = {}) => {
    if (isGpsSimulationActive()) return false;

    const {
      minMovingMeters = MOVING_ACCEPT_METERS,
      minStoppedMeters = STOPPED_ACCEPT_METERS,
      skipSupabase = false,
      force = false,
    } = options;
    const last = lastLocationRef.current;
    if (!force && last && !shouldAcceptLocationStep(last, pos, {
      movingMeters: minMovingMeters,
      stoppedMeters: minStoppedMeters,
    })) {
      return false;
    }

    const reportedHeading = Number(pos.heading);
    if (
      last
      && Number(pos.speed) > MOVING_SPEED_MPS
      && (!Number.isFinite(reportedHeading) || reportedHeading < 0)
    ) {
      pos = {
        ...pos,
        heading: bearingDegrees(last.lat, last.lng, pos.lat, pos.lng),
      };
    }

    lastLocationRef.current = pos;
    setCurrentLocation(pos);
    if (!skipSupabase && driver?.id) {
      hasSyncedToSupabaseRef.current = true;
      void publishDriverGps({
        driverId: driver.id,
        pos,
        isOnline: true,
        force,
      });
    }
    return true;
  }, [driver, setCurrentLocation]);

  const startNavigationWatch = useCallback(async () => {
    const hasPermission = await ensureForegroundPermission();
    if (!hasPermission) return;
    if (navWatchSubscriptionRef.current) return;

    isNavigationWatchActiveRef.current = true;
    navLastLocationRef.current = lastLocationRef.current;

    navWatchSubscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: NAV_WATCH_DISTANCE_INTERVAL_M,
        timeInterval: NAV_WATCH_TIME_INTERVAL_MS,
      },
      (location) => {
        const accuracy = location.coords.accuracy ?? 99;
        if (accuracy > FOREGROUND_MAX_ACCURACY_M) return;

        const pos = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          speed: location.coords.speed ?? 0,
          heading: location.coords.heading ?? 0,
          accuracy,
        };

        const last = navLastLocationRef.current || lastLocationRef.current;
        if (last && !shouldAcceptLocationStep(last, pos, {
          movingMeters: MOVING_ACCEPT_METERS,
          stoppedMeters: STOPPED_ACCEPT_METERS,
        })) {
          return;
        }

        navLastLocationRef.current = pos;
        applyLocationUpdate(pos, { minMovingMeters: 0, minStoppedMeters: 0 });
      },
    );
  }, [ensureForegroundPermission, applyLocationUpdate]);

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
    const hasPermission = await ensureForegroundPermission();
    if (!hasPermission) return;

    if (watchSubscriptionRef.current && watchMapOnlyRef.current === mapOnly) {
      if (!mapOnly) void enableFleetGps();
      return;
    }

    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.remove();
      watchSubscriptionRef.current = null;
    }

    watchMapOnlyRef.current = mapOnly;
    watchSubscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: FOREGROUND_WATCH_DISTANCE_INTERVAL_M,
        timeInterval: FOREGROUND_WATCH_TIME_INTERVAL_MS,
      },
      (location) => {
        const accuracy = location.coords.accuracy ?? 99;
        const needsBootstrap = !useLocationStore.getState().currentLocation;
        const maxAccuracy = needsBootstrap
          ? BOOTSTRAP_MAX_ACCURACY_M
          : FOREGROUND_MAX_ACCURACY_M;
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
            minMovingMeters: needsBootstrap ? 0 : MOVING_ACCEPT_METERS,
            minStoppedMeters: needsBootstrap ? 0 : STOPPED_ACCEPT_METERS,
          });
          return;
        }

        if (!hasSyncedToSupabaseRef.current) {
          applyLocationUpdate(pos, { force: true });
          return;
        }

        applyLocationUpdate(pos);
      }
    );

    if (!mapOnly) void enableFleetGps();
  }, [ensureForegroundPermission, applyLocationUpdate, enableFleetGps]);

  const stopWatching = useCallback(async (options = {}) => {
    const { markOffline = false } = options;
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.remove();
      watchSubscriptionRef.current = null;
    }
    watchMapOnlyRef.current = null;
    hasSyncedToSupabaseRef.current = false;
    if (!markOffline) return;
    await setOfflineLocation();
    await disableFleetGps();
  }, [setOfflineLocation, disableFleetGps]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'active' && pendingBackgroundStartRef.current && fleetGpsEnabledRef.current) {
        setTimeout(() => {
          maybeStartBackgroundUpdates();
        }, 500);
      }

      if (
        shouldRefreshLocationOnForeground(nextState, prevState)
        && (watchSubscriptionRef.current || navWatchSubscriptionRef.current)
      ) {
        void getCurrentPosition({
          force: true,
          syncToSupabase: hasSyncedToSupabaseRef.current,
        });
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
  }, [getCurrentPosition, maybeStartBackgroundUpdates, stopNavigationWatch]);

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
