import { create } from 'zustand';

// Velocidad mínima (m/s) para actualizar el heading del mapa.
// Por debajo de este valor el auto se considera detenido y el heading
// se mantiene fijo para evitar rotaciones por ruido de GPS.
// 1.5 m/s ≈ 5.4 km/h
const MIN_SPEED_FOR_HEADING_MS = 1.5;

export const useLocationStore = create((set, get) => ({
  currentLocation: null,
  isTracking: false,
  speed: 0,
  heading: 0,
  permissionStatus: null,

  setCurrentLocation: (location) => {
    const prevHeading = get().heading;
    const speed = location?.speed ?? 0;
    const isMoving = speed > MIN_SPEED_FOR_HEADING_MS;
    set({
      currentLocation: location,
      speed,
      // Solo rotar el mapa cuando hay movimiento real; de lo contrario
      // el heading de GPS es ruido y hace girar el mapa innecesariamente.
      heading: isMoving ? (location?.heading ?? prevHeading) : prevHeading,
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
