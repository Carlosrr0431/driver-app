import { create } from 'zustand';

export const useAuthStore = create((set, get) => ({
  user: null,
  driver: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setDriver: (driver) => set({ driver }),
  setSession: (session) => set({ session }),
  setLoading: (isLoading) => set({ isLoading }),

  login: (user, session, driver) =>
    set({
      user,
      session,
      driver,
      isAuthenticated: true,
      isLoading: false,
    }),

  logout: () =>
    set({
      user: null,
      driver: null,
      session: null,
      isAuthenticated: false,
      isLoading: false,
    }),

  updateDriver: (updates) =>
    set((state) => {
      if (!state.driver) return state;
      const nextUpdates = updates || {};
      const unchanged = Object.keys(nextUpdates).every((key) => (
        Object.is(state.driver[key], nextUpdates[key])
      ));
      if (unchanged) return state;
      return { driver: { ...state.driver, ...nextUpdates } };
    }),
}));
