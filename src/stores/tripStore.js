import { create } from 'zustand';

export const useTripStore = create((set, get) => ({
  activeTrip: null,
  pendingTrip: null,
  showNewTripModal: false,
  tripTimer: 0,
  tripStartTime: null,
  tripDistanceKm: 0,
  lastTrackingLocation: null,
  /** Paso UI del viaje activo (sobrevive remounts de navegación). */
  driverFlowStep: null,
  driverFlowTripId: null,

  setActiveTrip: (trip) => set({ activeTrip: trip }),
  setDriverFlowStep: (step, tripId) =>
    set((state) => {
      const resolvedTripId = tripId ?? state.activeTrip?.id ?? state.driverFlowTripId;
      const currentStep =
        state.driverFlowTripId === resolvedTripId && state.driverFlowStep
          ? state.driverFlowStep
          : null;
      const resolvedStep = typeof step === 'function' ? step(currentStep) : step;
      return {
        driverFlowStep: resolvedStep,
        driverFlowTripId: resolvedTripId ?? null,
      };
    }),
  clearDriverFlowStep: () => set({ driverFlowStep: null, driverFlowTripId: null }),
  setPendingTrip: (trip) => set({ pendingTrip: trip, showNewTripModal: !!trip }),
  setShowNewTripModal: (show) => set({ showNewTripModal: show }),
  setTripTimer: (timer) => set({ tripTimer: timer }),
  setTripStartTime: (time) => set({ tripStartTime: time }),
  setTripDistanceKm: (km) => set({ tripDistanceKm: km }),

  addTripDistance: (location) => {
    const { lastTrackingLocation, tripDistanceKm, activeTrip } = get();
    if (!activeTrip || activeTrip.status !== 'in_progress') {
      set({ lastTrackingLocation: location });
      return;
    }
    if (lastTrackingLocation) {
      const dist = haversineKm(
        lastTrackingLocation.lat, lastTrackingLocation.lng,
        location.lat, location.lng
      );
      // Only add if movement is between 10m and 2km (filter GPS noise)
      if (dist > 0.01 && dist < 2) {
        set({ tripDistanceKm: tripDistanceKm + dist, lastTrackingLocation: location });
        return;
      }
    }
    set({ lastTrackingLocation: location });
  },

  updateActiveTrip: (updates) =>
    set((state) => ({
      activeTrip: state.activeTrip ? { ...state.activeTrip, ...updates } : null,
    })),

  clearActiveTrip: () =>
    set({
      activeTrip: null,
      tripTimer: 0,
      tripStartTime: null,
      tripDistanceKm: 0,
      lastTrackingLocation: null,
      driverFlowStep: null,
      driverFlowTripId: null,
    }),

  clearPendingTrip: () =>
    set({
      pendingTrip: null,
      showNewTripModal: false,
    }),
}));

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
