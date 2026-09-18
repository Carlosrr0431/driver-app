import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, InteractionManager } from 'react-native';
import {
  APP_RESUME,
  isLeavingForeground,
  nextBackgroundedAt,
  registerAppResumeHydrator,
  resolveResumeHideDelayMs,
  runAppResumeHydrators,
  shouldHideResumeSkeleton,
  shouldShowResumeSkeleton,
  withResumeTimeout,
} from '../../shared/appResumeHydration';

const INTERACTION_WAIT_MS = 480;

function waitForInteractions() {
  return Promise.race([
    new Promise((resolve) => {
      try {
        const handle = InteractionManager.runAfterInteractions(() => resolve());
        if (handle && typeof handle.then === 'function') {
          handle.then(() => resolve()).catch(() => resolve());
        }
      } catch (_) {
        resolve();
      }
    }),
    new Promise((resolve) => setTimeout(resolve, INTERACTION_WAIT_MS)),
  ]);
}

export function useAppResumeHydrator(callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => registerAppResumeHydrator(() => callbackRef.current?.()), []);
}

export function useAppResumeHydration({ hydrate } = {}) {
  const [visible, setVisible] = useState(false);
  const previousStateRef = useRef(AppState.currentState);
  const backgroundedAtRef = useRef(null);
  const overlayStartedAtRef = useRef(null);
  const generationRef = useRef(0);
  const hydrateRef = useRef(hydrate);
  const hideTimerRef = useRef(null);
  const failSafeRef = useRef(null);
  hydrateRef.current = hydrate;

  const hideOverlay = useCallback((generation, settled) => {
    if (generation !== generationRef.current) return;
    const now = Date.now();
    if (!shouldHideResumeSkeleton({
      startedAt: overlayStartedAtRef.current,
      now,
      settled,
    })) {
      if (!settled) return;
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      const delay = resolveResumeHideDelayMs({
        startedAt: overlayStartedAtRef.current,
        now,
      });
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        hideOverlay(generation, true);
      }, delay);
      return;
    }
    overlayStartedAtRef.current = null;
    setVisible(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const sub = AppState.addEventListener('change', (nextState) => {
      const previousState = previousStateRef.current;
      previousStateRef.current = nextState;
      const now = Date.now();

      if (isLeavingForeground(nextState)) {
        backgroundedAtRef.current = nextBackgroundedAt({
          current: backgroundedAtRef.current,
          nextState,
          now,
        });
        return;
      }

      if (nextState !== 'active') return;
      if (previousState === 'active') {
        backgroundedAtRef.current = null;
        return;
      }

      const showOverlay = shouldShowResumeSkeleton({
        previousState,
        nextState,
        backgroundedAt: backgroundedAtRef.current,
        now,
      });
      backgroundedAtRef.current = null;

      generationRef.current += 1;
      const generation = generationRef.current;

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (failSafeRef.current) {
        clearTimeout(failSafeRef.current);
        failSafeRef.current = null;
      }

      if (showOverlay && !cancelled) {
        overlayStartedAtRef.current = now;
        setVisible(true);
      }

      failSafeRef.current = setTimeout(() => {
        failSafeRef.current = null;
        if (!cancelled) hideOverlay(generation, true);
      }, APP_RESUME.MAX_OVERLAY_MS);

      void (async () => {
        try {
          await waitForInteractions();
          if (cancelled || generation !== generationRef.current) return;
          await withResumeTimeout(
            Promise.allSettled([
              Promise.resolve().then(() => hydrateRef.current?.()),
              runAppResumeHydrators(),
            ]),
            APP_RESUME.MAX_OVERLAY_MS - 200,
          );
        } catch (error) {
          console.warn('No se pudo rehidratar al volver a la app:', error?.message || error);
        } finally {
          if (failSafeRef.current) {
            clearTimeout(failSafeRef.current);
            failSafeRef.current = null;
          }
          if (!cancelled) hideOverlay(generation, true);
        }
      })();
    });

    return () => {
      cancelled = true;
      sub.remove();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (failSafeRef.current) clearTimeout(failSafeRef.current);
    };
  }, [hideOverlay]);

  return visible;
}
