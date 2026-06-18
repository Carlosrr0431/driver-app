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
    set((state) => ({
      driver: state.driver ? { ...state.driver, ...updates } : null,
    })),
}));
