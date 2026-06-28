/**
 * Debe importarse desde App.js en el arranque (scope global).
 * expo-task-manager requiere defineTask antes de startLocationUpdatesAsync.
 */
import * as TaskManager from 'expo-task-manager';
import { useLocationStore } from '../stores/locationStore';
import { isGpsSimulationActive } from '../lib/gpsSimulation';

export const BACKGROUND_LOCATION_TASK = 'background-location-task';

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error('Error en tarea de ubicación:', error);
      return;
    }
    if (!data) return;

    const { locations } = data;
    const location = locations?.[0];
    if (!location) return;

    const accuracy = location.coords.accuracy ?? 99;
    if (accuracy > 30) return;
    if (isGpsSimulationActive()) return;

    const { setCurrentLocation } = useLocationStore.getState();
    setCurrentLocation({
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      speed: location.coords.speed ?? 0,
      heading: location.coords.heading ?? 0,
      accuracy,
    });
  });
}
