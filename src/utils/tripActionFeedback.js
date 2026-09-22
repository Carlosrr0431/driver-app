import * as Haptics from 'expo-haptics';

export function buzzSuccess() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function buzzLight() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Evita doble tap en celulares lentos mientras el sheet todavía suelta el gesto. */
export function beginExclusiveAction(lockRef, cooldownMs = 450) {
  if (!lockRef || lockRef.current) return false;
  lockRef.current = true;
  if (cooldownMs > 0) {
    setTimeout(() => {
      lockRef.current = false;
    }, cooldownMs);
  }
  return true;
}

export function releaseExclusiveAction(lockRef) {
  if (lockRef) lockRef.current = false;
}
