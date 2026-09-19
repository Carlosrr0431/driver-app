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
  /** Ir sin destino: atómico con el paso para no disparar OSRM un frame. */
  driverFreeRide: false,
  /** Abrir chat del viaje al tocar una push de mensaje. */
  pendingOpenChatTripId: null,
  /** Evita que un refetch/realtime resucite el viaje que acabamos de cerrar. */
  ignoredTripId: null,

  setActiveTrip: (trip) =>
    set((state) => {
      if (!trip) return state;
      const status = String(trip.status || '');
      if (status === 'completed' || status === 'cancelled' || status === 'queued') return state;
      if (state.ignoredTripId && trip.id === state.ignoredTripId) return state;
      if (state.activeTrip === trip) return state;
      return {
        activeTrip: trip,
        ignoredTripId: null,
      };
    }),
  requestOpenChat: (tripId) => set({ pendingOpenChatTripId: tripId || null }),
  clearPendingOpenChat: () => set({ pendingOpenChatTripId: null }),
  setDriverFlowStep: (step, tripId, extras = {}) =>
    set((state) => {
      const resolvedTripId = tripId ?? state.activeTrip?.id ?? state.driverFlowTripId;
      const currentStep =
        state.driverFlowTripId === resolvedTripId && state.driverFlowStep
          ? state.driverFlowStep
          : null;
      const resolvedStep = typeof step === 'function' ? step(currentStep) : step;
      const nextTripId = resolvedTripId ?? null;
      const tripChanged = nextTripId !== state.driverFlowTripId;
      let nextFreeRide = tripChanged ? false : Boolean(state.driverFreeRide);
      if (extras.freeRide !== undefined) {
        nextFreeRide = Boolean(extras.freeRide);
      } else if (resolvedStep !== 'in_progress') {
        nextFreeRide = false;
      }
      if (
        state.driverFlowStep === resolvedStep
        && state.driverFlowTripId === nextTripId
        && state.driverFreeRide === nextFreeRide
      ) {
        return state;
      }
      return {
        driverFlowStep: resolvedStep,
        driverFlowTripId: nextTripId,
        driverFreeRide: nextFreeRide,
      };
    }),
  clearDriverFlowStep: () => set({
    driverFlowStep: null,
    driverFlowTripId: null,
    driverFreeRide: false,
  }),
  setPendingTrip: (trip) => set({ pendingTrip: trip, showNewTripModal: !!trip }),
  updatePendingTrip: (updates) =>
    set((state) => {
      if (!state.pendingTrip || !updates) return state;
      return { pendingTrip: { ...state.pendingTrip, ...updates } };
    }),
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
    set((state) => ({
      activeTrip: null,
      tripTimer: 0,
      tripStartTime: null,
      tripDistanceKm: 0,
      lastTrackingLocation: null,
      driverFlowStep: null,
      driverFlowTripId: null,
      driverFreeRide: false,
      ignoredTripId: state.activeTrip?.id ?? state.ignoredTripId,
    })),

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
