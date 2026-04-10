import { create } from 'zustand';

export const useLocationStore = create((set, get) => ({
  currentLocation: null,
  isTracking: false,
  speed: 0,
  heading: 0,
  permissionStatus: null,

  setCurrentLocation: (location) =>
    set({
      currentLocation: location,
      speed: location?.speed || 0,
      heading: location?.heading || 0,
    }),

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
