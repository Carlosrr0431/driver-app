import { beginExclusiveAction, releaseExclusiveAction } from '../../src/utils/tripActionFeedback';

describe('tripActionFeedback', () => {
  it('bloquea un segundo tap hasta que se libera', () => {
    const lock = { current: false };
    expect(beginExclusiveAction(lock, 0)).toBe(true);
    expect(beginExclusiveAction(lock, 0)).toBe(false);
    releaseExclusiveAction(lock);
    expect(beginExclusiveAction(lock, 0)).toBe(true);
  });
});
