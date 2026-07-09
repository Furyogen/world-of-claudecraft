import { describe, expect, it } from 'vitest';
import { selfMotionPredictionActive, selfMotionQueryDisabled } from '../src/game/self_motion_gate';

describe('self_motion_gate', () => {
  it('detects the ?nopredict escape hatch anywhere in the query string', () => {
    expect(selfMotionQueryDisabled('?nopredict')).toBe(true);
    expect(selfMotionQueryDisabled('?realm=alpha&nopredict')).toBe(true);
    expect(selfMotionQueryDisabled('?nopredict=1')).toBe(true);
    // absent, empty, or merely similar params never trip it
    expect(selfMotionQueryDisabled('')).toBe(false);
    expect(selfMotionQueryDisabled('?realm=alpha')).toBe(false);
    expect(selfMotionQueryDisabled('?nopredictx=1')).toBe(false);
  });

  it('runs the predictor only when opted in AND the escape hatch is absent', () => {
    // the full truth table: ?nopredict always wins over the Graphics opt-in
    expect(selfMotionPredictionActive(false, true)).toBe(true);
    expect(selfMotionPredictionActive(true, true)).toBe(false);
    expect(selfMotionPredictionActive(false, false)).toBe(false);
    expect(selfMotionPredictionActive(true, false)).toBe(false);
  });
});
