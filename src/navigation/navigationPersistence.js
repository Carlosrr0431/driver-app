import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { navigationRef } from './navigationRef';
import {
  NAVIGATION_STRUCTURE_FINGERPRINT,
  isNavigationStateCompatibleWithStructure,
} from './navigationStructure';

const STORAGE_KEY = '@driver_app/navigation_state_v1';

const runtime = globalThis.__driverAppNavigationPersistenceRuntime ??= {
  latestState: undefined,
};

/**
 * React Navigation genera keys en runtime; no se pueden reutilizar al restaurar.
 * Solo persistimos name, params, index y state anidado.
 */
export function sanitizeNavigationStateForRestore(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.routes)) {
    return undefined;
  }

  const routes = state.routes
    .map((route) => {
      if (!route?.name) return null;

      const sanitizedRoute = { name: route.name };
      if (route.params != null) {
        sanitizedRoute.params = route.params;
      }

      const nestedState = sanitizeNavigationStateForRestore(route.state);
      if (nestedState) {
        sanitizedRoute.state = nestedState;
      }

      return sanitizedRoute;
    })
    .filter(Boolean);

  if (routes.length === 0) return undefined;

  const index =
    typeof state.index === 'number' && state.index >= 0 && state.index < routes.length
      ? state.index
      : 0;

  return { index, routes };
}

function isPersistedPayloadCompatible(payload) {
  if (!payload || typeof payload !== 'object') return false;

  if (payload.fingerprint !== NAVIGATION_STRUCTURE_FINGERPRINT) {
    return false;
  }

  return isNavigationStateCompatibleWithStructure(payload.state);
}

export async function loadNavigationState() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;

    const parsed = JSON.parse(raw);
    const sanitized = sanitizeNavigationStateForRestore(parsed?.state);

    if (!sanitized || !isPersistedPayloadCompatible({ ...parsed, state: sanitized })) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return undefined;
    }

    runtime.latestState = sanitized;
    return sanitized;
  } catch (error) {
    console.warn('No se pudo restaurar la navegación:', error);
    return undefined;
  }
}

export async function saveNavigationState(state) {
  try {
    const sanitized = sanitizeNavigationStateForRestore(state);
    if (!sanitized || !isNavigationStateCompatibleWithStructure(sanitized)) return;

    runtime.latestState = sanitized;

    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        fingerprint: NAVIGATION_STRUCTURE_FINGERPRINT,
        state: sanitized,
      }),
    );
  } catch (error) {
    console.warn('No se pudo guardar la navegación:', error);
  }
}

export async function clearNavigationState() {
  try {
    runtime.latestState = undefined;
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

export function flushNavigationPersistence() {
  const { isAuthenticated, isLoading } = useAuthStore.getState();
  if (!isAuthenticated || isLoading || !navigationRef.isReady()) return;

  const state = navigationRef.getRootState();
  if (!state) return;

  saveNavigationState(state);
}

function installAppStateFlushListener() {
  const flag = '__driverAppNavigationFlushListener';
  if (globalThis[flag]) return;

  let currentState = AppState.currentState;

  globalThis[flag] = AppState.addEventListener('change', (nextState) => {
    if (currentState === 'active' && nextState !== 'active') {
      flushNavigationPersistence();
    }
    currentState = nextState;
  });
}

installAppStateFlushListener();

export function getLatestNavigationState() {
  return runtime.latestState;
}

export function setLatestNavigationState(state) {
  runtime.latestState = sanitizeNavigationStateForRestore(state);
}
