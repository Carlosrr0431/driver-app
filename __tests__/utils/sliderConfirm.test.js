import {
  SLIDER_CONFIRM_RATIO,
  SLIDER_MIN_TRACK,
  shouldConfirmSlide,
  sliderMaxTravel,
  sliderProgress,
} from '../../src/utils/sliderConfirm';

describe('sliderConfirm', () => {
  it('exige un track usable antes de calcular el recorrido', () => {
    expect(sliderMaxTravel(0)).toBe(0);
    expect(sliderMaxTravel(SLIDER_MIN_TRACK - 1)).toBe(0);
    expect(sliderMaxTravel(320)).toBeGreaterThan(200);
  });

  it('normaliza el progreso entre 0 y 1', () => {
    expect(sliderProgress(-10, 100)).toBe(0);
    expect(sliderProgress(50, 100)).toBe(0.5);
    expect(sliderProgress(200, 100)).toBe(1);
    expect(sliderProgress(10, 0)).toBe(0);
  });

  it('confirma al soltar con recorrido suficiente o un flick claro', () => {
    expect(shouldConfirmSlide(0.5, 0)).toBe(false);
    expect(shouldConfirmSlide(SLIDER_CONFIRM_RATIO, 0)).toBe(true);
    expect(shouldConfirmSlide(0.9, 0)).toBe(true);
    expect(shouldConfirmSlide(0.45, 800)).toBe(true);
    expect(shouldConfirmSlide(0.2, 900)).toBe(false);
  });
});
