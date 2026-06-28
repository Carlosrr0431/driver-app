import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearNavigationState,
  flushNavigationPersistence,
  getLatestNavigationState,
  loadNavigationState,
  saveNavigationState,
  setLatestNavigationState,
} from '../navigation/navigationPersistence';

const runtime = globalThis.__driverAppNavigationRuntime ??= {
  hasMounted: false,
  restoreSettled: false,
  restorePromise: null,
  restoredState: undefined,
};

function ensureNavigationRestore() {
  if (!runtime.restorePromise) {
    runtime.restorePromise = loadNavigationState()
      .then((state) => {
        runtime.restoredState = state;
        if (state) {
          setLatestNavigationState(state);
        }
        return state;
      })
      .finally(() => {
        runtime.restoreSettled = true;
      });
  }

  return runtime.restorePromise;
}

export function useNavigationPersistence({ isAuthed, isLoading }) {
  const [isRestoring, setIsRestoring] = useState(!runtime.restoreSettled);
  const [initialState, setInitialState] = useState(runtime.restoredState);
  const [hasNavigationMounted, setHasNavigationMounted] = useState(runtime.hasMounted);
  const wasAuthedRef = useRef(isAuthed);

  useEffect(() => {
    let cancelled = false;

    ensureNavigationRestore().then((state) => {
      if (!cancelled && state) {
        setInitialState(state);
      }
      if (!cancelled) {
        setIsRestoring(false);
      }
    });

    return () => {
      cancelled = true;
      flushNavigationPersistence();
    };
  }, []);

  useEffect(() => {
    if (isRestoring) return;
    if (!isLoading) {
      setHasNavigationMounted(true);
      runtime.hasMounted = true;
    }
  }, [isRestoring, isLoading]);

  useEffect(() => {
    if (wasAuthedRef.current && !isAuthed && !isLoading) {
      clearNavigationState();
      setInitialState(undefined);
      runtime.restoredState = undefined;
    }
    wasAuthedRef.current = isAuthed;
  }, [isAuthed, isLoading]);

  const bootstrapReady = !isRestoring && !isLoading;
  const showNavigation = runtime.hasMounted || (hasNavigationMounted && bootstrapReady);
  const showLoadingOverlay = isLoading || (!showNavigation && (isRestoring || !hasNavigationMounted));
  const navigationInitialState = isAuthed
    ? (getLatestNavigationState() ?? initialState ?? runtime.restoredState)
    : undefined;

  const onNavigationStateChange = useCallback(
    (state) => {
      if (!isAuthed || isLoading || !state) return;
      setLatestNavigationState(state);
      saveNavigationState(state);
    },
    [isAuthed, isLoading],
  );

  return {
    showNavigation,
    showLoadingOverlay,
    navigationInitialState,
    onNavigationStateChange,
  };
}
