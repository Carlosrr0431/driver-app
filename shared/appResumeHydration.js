/**
 * Rehidratación al volver a primer plano (estilo Uber/DiDi).
 * Overlay de skeleton solo si la app estuvo afuera un rato;
 * el refetch corre siempre, sin bloquear el hilo.
 */

const APP_RESUME = {
  MIN_BACKGROUND_MS: 700,
  MIN_OVERLAY_MS: 280,
  MAX_OVERLAY_MS: 4000,
};

function isLeavingForeground(nextState) {
  return nextState === 'background' || nextState === 'inactive';
}

function isEnteringForeground(previousState, nextState) {
  return nextState === 'active' && previousState !== 'active';
}

function nextBackgroundedAt({ current = null, nextState, now = Date.now() } = {}) {
  if (isLeavingForeground(nextState)) {
    return Number.isFinite(current) ? current : now;
  }
  if (nextState === 'active') return null;
  return current ?? null;
}

function shouldShowResumeSkeleton({
  previousState,
  nextState,
  backgroundedAt,
  now = Date.now(),
  minBackgroundMs = APP_RESUME.MIN_BACKGROUND_MS,
} = {}) {
  if (!isEnteringForeground(previousState, nextState)) return false;
  if (!Number.isFinite(backgroundedAt)) return false;
  return now - backgroundedAt >= minBackgroundMs;
}

function shouldHideResumeSkeleton({
  startedAt,
  now = Date.now(),
  settled = false,
  minVisibleMs = APP_RESUME.MIN_OVERLAY_MS,
  maxVisibleMs = APP_RESUME.MAX_OVERLAY_MS,
} = {}) {
  if (!Number.isFinite(startedAt)) return Boolean(settled);
  const elapsed = now - startedAt;
  if (elapsed >= maxVisibleMs) return true;
  return Boolean(settled) && elapsed >= minVisibleMs;
}

function resolveResumeHideDelayMs({
  startedAt,
  now = Date.now(),
  minVisibleMs = APP_RESUME.MIN_OVERLAY_MS,
} = {}) {
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, minVisibleMs - (now - startedAt));
}

function createAppResumeHydratorRegistry() {
  const hydrators = new Set();

  return {
    register(fn) {
      if (typeof fn !== 'function') return () => {};
      hydrators.add(fn);
      return () => {
        hydrators.delete(fn);
      };
    },
    async runAll() {
      const list = Array.from(hydrators);
      if (list.length === 0) return;
      await Promise.allSettled(list.map((fn) => Promise.resolve().then(fn)));
    },
    clear() {
      hydrators.clear();
    },
    size() {
      return hydrators.size;
    },
  };
}

const defaultRegistry = createAppResumeHydratorRegistry();

function registerAppResumeHydrator(fn) {
  return defaultRegistry.register(fn);
}

function runAppResumeHydrators() {
  return defaultRegistry.runAll();
}

function resetAppResumeHydrators() {
  defaultRegistry.clear();
}

function withResumeTimeout(promise, ms = APP_RESUME.MAX_OVERLAY_MS) {
  const limit = Number(ms);
  const timeoutMs = Number.isFinite(limit) && limit > 0 ? limit : APP_RESUME.MAX_OVERLAY_MS;
  return Promise.race([
    Promise.resolve().then(() => promise),
    new Promise((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

module.exports = {
  APP_RESUME,
  isLeavingForeground,
  isEnteringForeground,
  nextBackgroundedAt,
  shouldShowResumeSkeleton,
  shouldHideResumeSkeleton,
  resolveResumeHideDelayMs,
  createAppResumeHydratorRegistry,
  registerAppResumeHydrator,
  runAppResumeHydrators,
  resetAppResumeHydrators,
  withResumeTimeout,
};
