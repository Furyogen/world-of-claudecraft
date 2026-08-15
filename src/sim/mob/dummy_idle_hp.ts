// The health a practice dummy settles on once it has been idle long enough to
// drop combat (mob/locomotion.ts, the `dummy` branch). A pure leaf: no
// SimContext, no rng, no clock, so a Vitest imports it directly.
//
// Two dummies, two idles:
//
// - A HOSTILE dummy (the Training Dummy and the two boss dummies) heals back to
//   full, so the next parse starts from a clean pool. That is the behavior the
//   dummy row shipped with and it is unchanged.
// - A FRIENDLY dummy is a healing target, and a target parked at full health
//   makes every heal 100% overheal, which measures nothing. So once it has been
//   topped off it re-opens its wound and settles back to a fixed fraction of its
//   pool, ready for the next cast. Below that ceiling it is left exactly where
//   the healer's casts put it, so a heal is never undone mid-rotation: the
//   re-wound fires only on the tick the dummy actually reaches full.

/** The share of its pool a friendly practice dummy re-opens to once topped off. */
export const HEAL_PRACTICE_WOUND_FRACTION = 0.5;

export function dummyIdleHp(hp: number, maxHp: number, friendlyPracticeTarget: boolean): number {
  if (!friendlyPracticeTarget) return maxHp;
  if (hp >= maxHp) return Math.floor(maxHp * HEAL_PRACTICE_WOUND_FRACTION);
  return hp;
}
