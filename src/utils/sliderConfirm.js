export const SLIDER_THUMB = 52;
export const SLIDER_PAD = 4;
export const SLIDER_CONFIRM_RATIO = 0.72;
export const SLIDER_FLICK_RATIO = 0.42;
export const SLIDER_FLICK_VELOCITY = 650;
export const SLIDER_ACTIVE_OFFSET_X = 12;
export const SLIDER_FAIL_OFFSET_Y = 22;
export const SLIDER_MIN_TRACK = SLIDER_THUMB + SLIDER_PAD * 2 + 24;

export function sliderMaxTravel(trackWidth, thumb = SLIDER_THUMB, pad = SLIDER_PAD) {
  'worklet';
  const width = Number(trackWidth);
  if (!Number.isFinite(width) || width < SLIDER_MIN_TRACK) return 0;
  return Math.max(1, width - thumb - pad * 2);
}

export function sliderProgress(translateX, maxTravel) {
  'worklet';
  const max = Number(maxTravel);
  if (!Number.isFinite(max) || max <= 0) return 0;
  const x = Number(translateX);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.max(0, Math.min(1, x / max));
}

/** Confirmar al soltar, no a mitad del gesto: evita congelar el sheet en Android lento. */
export function shouldConfirmSlide(progress, velocityX) {
  'worklet';
  const p = Number(progress) || 0;
  const v = Number(velocityX) || 0;
  if (p >= SLIDER_CONFIRM_RATIO) return true;
  return v > SLIDER_FLICK_VELOCITY && p >= SLIDER_FLICK_RATIO;
}
