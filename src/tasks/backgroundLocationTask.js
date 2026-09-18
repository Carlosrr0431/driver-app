/**
 * Debe importarse desde App.js en el arranque (scope global).
 * expo-task-manager requiere defineTask antes de startLocationUpdatesAsync.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import {
  handleBackgroundLocations,
  loadDriverGpsContext,
  resolveBackgroundGpsContext,
} from '../lib/driverGpsPublish';

export const BACKGROUND_LOCATION_TASK = 'background-location-task';

export async function stopBackgroundLocationUpdates() {
  try {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {
    // Task not running
  }
}

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error('Error en tarea de ubicación:', error);
      return;
    }
    if (!data) return;

    const stored = await loadDriverGpsContext();
    const context = resolveBackgroundGpsContext({
      stored,
      driver: useAuthStore.getState().driver,
      isTracking: false,
    });
    await handleBackgroundLocations({
      locations: data.locations,
      context,
      client: supabase,
    });
  });
}
