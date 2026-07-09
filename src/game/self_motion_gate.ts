// Gate for the online display-only self-motion predictor (src/render/self_motion.ts).
// Pure and host-agnostic so the ?nopredict-overrides-setting contract is unit-testable;
// main.ts is the thin consumer (it hoists the query check once at boot and reads the
// Graphics setting live each frame).

/** True when the page URL carries the ?nopredict live-ops escape hatch. */
export function selfMotionQueryDisabled(search: string): boolean {
  return new URLSearchParams(search).has('nopredict');
}

/** The predictor runs only when the opt-in Graphics setting (selfMotionPrediction,
 *  off by default) is on AND ?nopredict is absent: the escape hatch always wins. */
export function selfMotionPredictionActive(queryDisabled: boolean, settingOn: boolean): boolean {
  return settingOn && !queryDisabled;
}
