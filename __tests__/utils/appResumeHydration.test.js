const {
  APP_RESUME,
  createAppResumeHydratorRegistry,
  isEnteringForeground,
  isLeavingForeground,
  nextBackgroundedAt,
  registerAppResumeHydrator,
  resetAppResumeHydrators,
  resolveResumeHideDelayMs,
  runAppResumeHydrators,
  shouldHideResumeSkeleton,
  shouldShowResumeSkeleton,
  withResumeTimeout,
} = require('../../shared/appResumeHydration');

describe('appResumeHydration', () => {
  afterEach(() => {
    resetAppResumeHydrators();
  });

  it('marca salida a background/inactive y entrada a primer plano', () => {
    expect(isLeavingForeground('inactive')).toBe(true);
    expect(isLeavingForeground('background')).toBe(true);
    expect(isLeavingForeground('active')).toBe(false);
    expect(isEnteringForeground('background', 'active')).toBe(true);
    expect(isEnteringForeground('active', 'active')).toBe(false);
  });

  it('conserva el primer timestamp al ir a background', () => {
    const first = nextBackgroundedAt({ current: null, nextState: 'inactive', now: 1000 });
    expect(first).toBe(1000);
    expect(nextBackgroundedAt({ current: first, nextState: 'background', now: 1800 })).toBe(1000);
    expect(nextBackgroundedAt({ current: first, nextState: 'active', now: 2000 })).toBeNull();
  });

  it('muestra skeleton solo si estuvo fuera el tiempo mínimo', () => {
    const backgroundedAt = 1000;
    expect(shouldShowResumeSkeleton({
      previousState: 'background',
      nextState: 'active',
      backgroundedAt,
      now: 1000 + APP_RESUME.MIN_BACKGROUND_MS - 1,
    })).toBe(false);
    expect(shouldShowResumeSkeleton({
      previousState: 'background',
      nextState: 'active',
      backgroundedAt,
      now: 1000 + APP_RESUME.MIN_BACKGROUND_MS,
    })).toBe(true);
    expect(shouldShowResumeSkeleton({
      previousState: 'background',
      nextState: 'active',
      backgroundedAt: null,
      now: 5000,
    })).toBe(false);
  });

  it('esconde el overlay al cumplir el mínimo o el máximo', () => {
    expect(shouldHideResumeSkeleton({
      startedAt: 1000,
      now: 1000 + APP_RESUME.MIN_OVERLAY_MS - 10,
      settled: true,
    })).toBe(false);
    expect(shouldHideResumeSkeleton({
      startedAt: 1000,
      now: 1000 + APP_RESUME.MIN_OVERLAY_MS,
      settled: true,
    })).toBe(true);
    expect(shouldHideResumeSkeleton({
      startedAt: 1000,
      now: 1000 + APP_RESUME.MAX_OVERLAY_MS,
      settled: false,
    })).toBe(true);
    expect(resolveResumeHideDelayMs({
      startedAt: 1000,
      now: 1100,
      minVisibleMs: 280,
    })).toBe(180);
  });

  it('corre hidratadores en paralelo y no falla si uno rechaza', async () => {
    const registry = createAppResumeHydratorRegistry();
    const ok = jest.fn().mockResolvedValue('ok');
    const bad = jest.fn().mockRejectedValue(new Error('fail'));
    registry.register(ok);
    registry.register(bad);
    await expect(registry.runAll()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalled();
    expect(bad).toHaveBeenCalled();
  });

  it('registra hidratadores globales y los limpia', async () => {
    const fn = jest.fn();
    const unregister = registerAppResumeHydrator(fn);
    await runAppResumeHydrators();
    expect(fn).toHaveBeenCalledTimes(1);
    unregister();
    await runAppResumeHydrators();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('corta hidrataciones lentas para no trabar el overlay', async () => {
    const started = Date.now();
    await withResumeTimeout(new Promise(() => {}), 40);
    expect(Date.now() - started).toBeLessThan(400);
  });
});
