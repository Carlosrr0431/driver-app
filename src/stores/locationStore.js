import { create } from 'zustand';
import { bearingDegrees } from '../utils/locationWatch';

// Velocidad mínima (m/s) para actualizar el heading del mapa.
// Por debajo de este valor el auto se considera detenido y el heading
// se mantiene fijo para evitar rotaciones por ruido de GPS.
// 1.5 m/s ≈ 5.4 km/h
const MIN_SPEED_FOR_HEADING_MS = 0.8;

export const useLocationStore = create((set, get) => ({
  currentLocation: null,
  isTracking: false,
  speed: 0,
  heading: 0,
  permissionStatus: null,

  setCurrentLocation: (location) => {
    const prev = get();
    const prevHeading = prev.heading;
    const prevLoc = prev.currentLocation;
    const speed = location?.speed ?? 0;
    const isMoving = speed > MIN_SPEED_FOR_HEADING_MS;
    const reportedHeading = Number(location?.heading);
    const hasReportedHeading = Number.isFinite(reportedHeading) && reportedHeading >= 0;
    let heading = prevHeading;
    if (isMoving) {
      if (hasReportedHeading) {
        heading = reportedHeading;
      } else if (prevLoc && Number.isFinite(prevLoc.lat) && Number.isFinite(prevLoc.lng)) {
        heading = bearingDegrees(prevLoc.lat, prevLoc.lng, location.lat, location.lng);
      }
    }
    if (
      prevLoc
      && prevLoc.lat === location?.lat
      && prevLoc.lng === location?.lng
      && prev.speed === speed
      && prev.heading === heading
    ) {
      return;
    }
    set({
      currentLocation: location,
      speed,
      // Solo rotar el mapa cuando hay movimiento real; de lo contrario
      // el heading de GPS es ruido y hace girar el mapa innecesariamente.
      heading,
    });
  },

  setIsTracking: (isTracking) => set({ isTracking }),
  setPermissionStatus: (status) => set({ permissionStatus: status }),

  reset: () =>
    set({
      currentLocation: null,
      isTracking: false,
      speed: 0,
      heading: 0,
    }),
}));
