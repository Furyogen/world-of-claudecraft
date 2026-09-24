# Brawler class concept

Status: concept, pre-implementation. Nothing here ships yet. Every number is a
starting point to be measured under `docs/design/spell-balance-framework.md`,
never a final value (the root rule: gameplay numbers need a classic-era formula,
a checked-in reference, or a measured simulation result).

Companion rules: `docs/design/class-design-rules.md` (complexity and passive
budgets, talent row jobs, the 10 to 15 percent power ceiling, mobile controls).

## Identity

The Brawler fights with fists, kicks, knees and headbutts, in leather, on
Agility. Where every other melee class trades blows at arm's length, the
Brawler grabs hold: a **Lockdown** pins the Brawler and the enemy together in
place while the grip itself hurts the enemy. It is the only class that gets
stronger as it gets hurt.

| | |
|---|---|
| Armor | Leather |
| Primary stat | Agility (attack power, crit, dodge, and for this class only, parry) |
| Weapons | Fist weapons and hand wraps; fights unarmed at full strength |
| Resource | **Grit**, built by landing hits and by getting hit |
| Specs | **Bareknuckle** (damage), **Counterpuncher** (tank), **Cornerman** (support) |

### Names (originality check)

Checked against the naming protocol in `src/sim/content/CLAUDE.md`:

| Name | Verdict |
|---|---|
| Brawler | Shared generic English (Pathfinder and many others use it). Allowed. |
| Bareknuckle | No class or spec collision found. Replaces "Streetfighter" (a Capcom trademark). |
| Counterpuncher | No collision found. Replaces "Parry King" (a parry skill in Tainted Grail: Fall of Avalon, and a Steam game title). |
| Cornerman | Borderline: a boxing-management game is titled "The Cornerman", but no class or spec uses it. Replaces "Coach", which also collides with the Proving Shore tutorial "coach" players already see. |
| Last Legs | No collision found. Replaces "Masochism" (Dr. Mundo's ability in League of Legends: bonus damage from missing health, the same role). |
| Seeing Red | English idiom, no collision found. Chosen over "Red Mist" (a Risk of Rain 2 survivor). |
| Lockdown, Grit | Generic English. |

Every ability name below still needs the per-name exact-phrase check before
it ships.

## Class-wide systems

### Grit (resource)

Grit is one shared resource name across all three specs. It runs on the warrior's classic rage conversion (damage dealt and damage
taken both turn into resource, and it decays out of combat) under the Brawler's
own label. The engine is reused, not rewritten. Each spec changes one input:

- **Bareknuckle:** the full conversion, from both dealing and taking damage.
- **Counterpuncher:** avoidance counts too. A dodge or parry generates Grit as
  if the blow had landed, so a tank that avoids everything still has resource.
- **Cornerman:** only damage dealt to enemies generates Grit. To heal, you have
  to fight.

### Lockdown (signature mechanic)

A Lockdown is a grapple:

- **Both are pinned.** The Brawler and the target are rooted for its duration.
  Neither can move, but both can still attack, cast and be damaged by anyone.
- **The grip is a damage over time.** The target takes a periodic Crush tick,
  scaling with attack power, for as long as the hold lasts.
- **Close quarters only.** While locked, the Brawler can use only close strikes
  (fists, knees, headbutts). Kicks need space and are unavailable, which
  changes what you press.
- **One at a time.** The Brawler can hold one Lockdown at a time.
- **Early ends.** It breaks early if the Brawler is stunned, feared, knocked
  back or killed. The Brawler can also end it deliberately with a finisher.
- **Control rules.** In PvP it shares the root diminishing-returns category,
  with the same duration as in PvE.
- **Root-immune targets (bosses):** the Crush still ticks, but only the Brawler
  is rooted. Against a boss a Lockdown is a pure damage-over-time that costs
  your own mobility, a clear risk tradeoff.

### Agility parry

Today parry is warrior-only and Strength-scaled (`src/sim/combat/warrior_hit_table.ts`).
The Brawler gains parry from Agility, and it works unarmed. Like every parry it
only applies to attacks from the front. There is no block: the Brawler never
uses a shield.

### Shared kit

Every spec gets these utility actions, which sit outside the core rotation:

| Ability | Summary |
|---|---|
| **Headbutt** | Interrupt plus a 1 sec daze. Costs 3 percent of your own health, which feeds Last Legs. |
| **Flying Knee** | Leap-strike gap closer (8 to 25 yd). |
| **Shake It Off** | Breaks roots and slows on yourself. Not usable during your own Lockdown. |
| **Headlock** | The baseline Lockdown: 6 sec, Crush ticks every 1 sec. |

## Bareknuckle (damage): the glass cannon

The fantasy: the more blood you lose, the harder you hit. Sustained output
peaks in the danger zone, so the spec's skill test is managing your own health.

### Last Legs (spec passive)

You deal 1 percent more damage for every 1 percent of health you are missing.
At 90 percent health that is +10 percent, and at 50 percent it is +50 percent,
matching the brief.

Three rules keep it honest:

1. **Base damage is tuned below the peer median.** A Bareknuckle at full health
   is the weakest melee in the game; the fight-average (health dipping and
   recovering) is what must land inside the power ceiling.
2. **Cap: +85 percent, reached at 15 percent health.** The bonus grows linearly
   down to 15 percent health and stops there, so there is no extra reward for
   hovering at 1 hp.
3. **The bonus falls slowly when you are healed.** It rises instantly as you
   lose health, but when a heal (yours or a healer's) raises your health, the
   bonus drops toward its new value gradually (starting point: 5 percentage
   points per second, to be measured). Healers keep you alive without
   instantly erasing the damage you paid for in blood.

Mobile readability: the player-frame health bar tints as the bonus grows, and
the tooltip shows the live percentage.

### Core rotation (4 to 5 buttons)

| Ability | Role | Summary |
|---|---|---|
| **Jab** | Builder | Fast, cheap strike. Close strike (usable in Lockdown). |
| **Roundhouse** | Spender | Heavy kick, the main Grit dump. Not usable in Lockdown. |
| **Uppercut** | Spender | Close-strike spender for use inside a Lockdown; lower damage than Roundhouse. |
| **Armbar** | Lockdown | 5 sec. Crush ticks, and the target deals 20 percent less physical damage while held. |
| **Suplex** | Finisher | Ends your Lockdown: damage plus a 2 sec stun, stronger for each second the hold lasted. |

The loop: open with kicks at range (Flying Knee into Roundhouse), grab
(Headlock or Armbar) and switch to close strikes (Jab, Uppercut) while the
Crush ticks, then Suplex out and return to kicks. Each Lockdown decides when to
give up kicks and mobility for the grip.

### Burst: Seeing Red (the one major cooldown)

For 15 sec, Last Legs treats you as missing 25 percent more health than you
are (still capped), and your strikes cost 30 percent less Grit. You also take
10 percent more damage, the glass-cannon price. Cooldown 2 min.

### Defensive: Second Wind

Heal 20 percent of your health over 6 sec, cooldown 90 sec. It is the spec's
only self-heal, and it lowers your own Last Legs bonus: a genuine decision
between safety and damage.

## Counterpuncher (tank): no shield, no block, only footwork

The fantasy: nothing lands. The tank's mitigation is avoidance (dodge and
Agility parry) instead of armor and block, and every avoided blow is a
counterattack waiting to happen.

### Passive: Counter Rhythm (spec passive)

Each dodge or parry grants a stack (up to 5) that empowers your next Riposte.
Avoidance also generates Grit (see the Grit rules above). Last Legs does not
apply to this spec: a tank should not want to sit at low health.

### Core kit

| Ability | Role | Summary |
|---|---|---|
| **Jab** | Builder | Shared with Bareknuckle; high threat modifier in this spec. |
| **Riposte** | Reactive spender | Usable within 5 sec of a dodge or parry. High threat, consumes Counter Rhythm stacks. |
| **Sweep the Leg** | Area threat | Low kick around you: area damage, 3 sec daze, high threat. |
| **Clinch** | Tank Lockdown | Hold a dangerous enemy in place. While clinched it deals 30 percent less damage to you and generates heavy threat. The answer to the add that must not reach the healer. |
| **Come Get Some** | Taunt | Taunt a target. |

### Defensives (avoidance has a hole: spells cannot be dodged)

| Ability | Summary |
|---|---|
| **Slip** | +50 percent dodge for 6 sec. Short cooldown, the rotational defensive. |
| **Iron Chin** | 30 percent less magic damage for 8 sec. Covers the avoidance blind spot. |
| **Rope-a-Dope** | Major defensive: 40 percent less damage for 8 sec, but you are rooted (leaning on the ropes). Cooldown 3 min. |

Tuning risk: avoidance tanks are spiky (streaks of misses, then several hits in
a row). The measurement pass must compare damage-intake variance against the
other tanks, not just the mean.

## Cornerman (support): the melee healer

The fantasy: the trainer who sprints into the fight, cracks a shoulder back into
place and screams you to your feet. Heals are acupressure, so they need touch:
**every heal has a 5 yd range**. The Cornerman has to physically run to whoever
needs help. All heals, including Crack It Back, share the 5 yd range.

### The heal contract

- **Single target by default.** Heals hit one ally unless allies are stacked.
- **The strongest single-target heal in the game.** Pressure Point outheals
  any comparable heal of any other healer.
- **Paid for with position and uptime.** The 5 yd range costs running time,
  heals cost Grit, and Grit only comes from punching enemies. Ranged healers
  heal more over time and from safety; the Cornerman heals less often but
  harder.

### Heals and support

| Ability | Role | Summary |
|---|---|---|
| **Pressure Point** | Big heal | 2 sec cast, 5 yd. The strongest single heal in the game. |
| **Knead** | Heal over time | 5 yd, 12 sec. Lets you leave to run to the next ally. |
| **Crack It Back** | Instant heal | 5 yd. Medium heal that also removes one slow or root. |
| **Huddle** | Stacked heal | 5 yd. Heals the target plus each ally within 4 yd of them; the heal splits, so it is weaker per person than Pressure Point. The only multi-target heal. |
| **Sprint to the Corner** | Mobility | Dash to a friendly target (25 yd). Mandatory for a melee-range healer. |
| **Smelling Salts** | Dispel | Removes a stun or sleep from an ally. |
| **Towel In** | Emergency | Target ally takes 60 percent less damage for 4 sec. Cooldown 3 min. |

### Screams (motivation shouts)

| Ability | Summary |
|---|---|
| **Pep Talk** | Party buff: the standard class raid-buff slot (1800 sec, like the other class raid buffs). |
| **On Your Feet!** | Short party rally: 10 sec, allies take 10 percent less damage. Cooldown 2 min. The spec's one major cooldown. |
| **Get Up!** | Target ally cannot drop below 1 health for 4 sec. Cooldown 3 min. |

### Damage

The Cornerman uses Jab and Roundhouse from the shared kit to earn Grit between
heals. Its damage is intentionally low: it exists to fund heals, not to compete
with Bareknuckle.

## Talent rows (sketch)

Class-wide rows following the row jobs in `class-design-rules.md` (every
option must be live for all three specs at unlock):

| Level | Job | Options (sketch) |
|---|---|---|
| 5 | Mobility | Flying Knee has two charges / Shake It Off also gives 30 percent run speed for 3 sec / Lockdown finishers leave you with 40 percent run speed |
| 8 | Survival | Headbutt's health cost becomes a small self-heal on interrupt / Iron Chin is available to all specs / a killing blow restores 10 percent health |
| 11 | Control | Lockdown lasts 2 sec longer / Suplex stun becomes an area knockdown / Sweep the Leg is available to all specs |
| 14 | Resource | Grit decays half as fast / Lockdown Crush ticks generate Grit / a larger Grit pool |
| 17 | Major offensive choice | The spec's major cooldown lasts longer / a second, smaller charge / a party-wide variant of it |
| 20 | Capstone | Lockdown on an enemy also holds a second enemy within 3 yd / Last Legs and Counter Rhythm effects scale 20 percent harder / a Lockdown can be released onto a new target once |

## Implementation notes (for when this becomes a build)

- **Class definition:** a new class record in `src/sim/content/classes.ts`,
  with abilities, talents and specs as declarative content, merged by `data.ts`.
- **Lockdown:** a new sim system module behind `SimContext` (for example
  `src/sim/combat/lockdown.ts`), reusing the existing root aura and
  damage-over-time machinery, never a method cluster on `sim.ts`.
- **Agility parry:** extends the defender hit table beside
  `warrior_hit_table.ts`.
- **Last Legs:** one pure damage modifier with its own unit test.
- **Grit:** reuses the rage engine with one shared class label for all three
  specs. If a distinct resource id is needed, it is a new `resourceType`
  member, implemented in BOTH the offline `Sim` and `ClientWorld`, with the
  parity pin updated.
- **Last Legs decay:** the bonus tracks a smoothed health value that follows
  health down instantly and up at the decay rate, stepped on the 20 Hz tick
  so it stays deterministic.
- **Same-change obligations:** i18n English keys (plus the five M16 non-Latin
  fills for wordy names), guide regeneration (`npm run wiki:content`), Book of
  Deeds records where applicable, and class icons plus spell icons.
- **Animation:** punches, kicks, headbutt and a two-body grapple pose are new
  animation clips (the `blender-anim-pipeline` skill). The grapple is the
  largest art cost in the class.
- **Mobile:** each spec's core loop stays at four to five buttons, and the
  close-strike restriction during a Lockdown must be readable on a small
  screen (greyed kicks).

## Decisions

Settled with the owner:

1. **Last Legs cap:** linear down to 15 percent health, for a maximum of +85
   percent damage.
2. **Healing into Last Legs:** the bonus decays slowly after a heal instead of
   dropping instantly.
3. **Lockdown in PvP:** same duration as in PvE, not shortened.
4. **Cornerman heal range:** every heal is 5 yd.
5. **Grit:** one shared resource name for all three specs.
