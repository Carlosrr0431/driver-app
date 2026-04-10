import { create } from 'zustand';

export const useTripStore = create((set, get) => ({
  activeTrip: null,
  pendingTrip: null,
  showNewTripModal: false,
  tripTimer: 0,
  tripStartTime: null,

  setActiveTrip: (trip) => set({ activeTrip: trip }),
  setPendingTrip: (trip) => set({ pendingTrip: trip, showNewTripModal: !!trip }),
  setShowNewTripModal: (show) => set({ showNewTripModal: show }),
  setTripTimer: (timer) => set({ tripTimer: timer }),
  setTripStartTime: (time) => set({ tripStartTime: time }),

  updateActiveTrip: (updates) =>
    set((state) => ({
      activeTrip: state.activeTrip ? { ...state.activeTrip, ...updates } : null,
    })),

  clearActiveTrip: () =>
    set({
      activeTrip: null,
      tripTimer: 0,
      tripStartTime: null,
    }),

  clearPendingTrip: () =>
    set({
      pendingTrip: null,
      showNewTripModal: false,
    }),
}));
