import { createClient, processLock } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { AUTH_STORAGE_KEY, INVALID_REFRESH_TOKEN_PATTERN } from './authConstants';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xzabzbrolmkezljsyycr.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_7NIfu3DWpS_73AyUfJIpmQ_O3yG38wq';

const suppressRecoverableAuthConsoleErrors = () => {
  const globalScope = globalThis;
  if (globalScope.__driverAppAuthConsoleFilterInstalled) return;
  globalScope.__driverAppAuthConsoleFilterInstalled = true;

  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    const combined = args
      .map((arg) => {
        if (arg?.message) return arg.message;
        if (typeof arg === 'string') return arg;
        return '';
      })
      .join(' ');

    if (INVALID_REFRESH_TOKEN_PATTERN.test(combined)) {
      return;
    }

    originalConsoleError(...args);
  };
};

suppressRecoverableAuthConsoleErrors();

const createSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

const globalScope = globalThis;

if (!globalScope.__driverAppSupabaseClient) {
  globalScope.__driverAppSupabaseClient = createSupabase();
}

export const supabase = globalScope.__driverAppSupabaseClient;

const authRuntime = globalScope.__driverAppSupabaseAuthRuntime || {
  initialized: false,
  autoRefreshEnabled: false,
};
globalScope.__driverAppSupabaseAuthRuntime = authRuntime;

const syncAutoRefreshWithAppState = (state) => {
  if (!authRuntime.initialized) return;

  if (state === 'active') {
    // Delay para evitar colisión con _recoverAndRefresh / INITIAL_SESSION al volver del background.
    setTimeout(() => {
      if (authRuntime.initialized && AppState.currentState === 'active') {
        supabase.auth.startAutoRefresh().catch(() => {});
      }
    }, 400);
  } else {
    supabase.auth.stopAutoRefresh().catch(() => {});
  }
};

if (!globalScope.__driverAppSupabaseAuthListener) {
  globalScope.__driverAppSupabaseAuthListener = supabase.auth.onAuthStateChange((event, session) => {
    if (event !== 'INITIAL_SESSION') return;

    authRuntime.initialized = true;

    if (!session) {
      AsyncStorage.multiRemove([
        AUTH_STORAGE_KEY,
        `${AUTH_STORAGE_KEY}-code-verifier`,
        `${AUTH_STORAGE_KEY}-user`,
      ]).catch(() => {});
    }

    if (!authRuntime.autoRefreshEnabled) {
      authRuntime.autoRefreshEnabled = true;
      syncAutoRefreshWithAppState(AppState.currentState);
    }
  });
}

if (!globalScope.__driverAppSupabaseAppStateListener) {
  globalScope.__driverAppSupabaseAppStateListener = AppState.addEventListener(
    'change',
    syncAutoRefreshWithAppState
  );
}

export const waitForAuthBootstrap = async (timeoutMs = 8000) => {
  if (authRuntime.initialized) return;

  await new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, timeoutMs);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION') {
        clearTimeout(timeoutId);
        subscription.unsubscribe();
        resolve();
      }
    });
  });
};
