# The merge-ready PR prompt

A reusable prompt for driving a World of ClaudeCraft contribution from an agent so that it
merges, passes CI, and gets proposed on the release tracker. Derived from the merge and
rejection history of `levy-street/world-of-claudecraft` as of August 2026.

The evidence behind each rule is in [Why these rules](#why-these-rules) at the bottom.

## The prompt

Copy everything between the fences, replace the one bracketed line, and paste it.

```text
You are contributing a pull request to levy-street/world-of-claudecraft, an upstream repo I
do not own. I contribute from my fork, Furyogen/world-of-claudecraft. Your job is not "write
the code": it is to land a PR that a maintainer merges. Optimize for merge probability, not
for scope.

THE CHANGE
[ Describe the ONE user-visible behavior to change, in two or three sentences. Name the bug
  or the feature and the file area you believe it lives in. ]

Treat that scope as a hard ceiling. If you find adjacent bugs, note them at the end of your
final report for a separate PR. Do not fix them here.

STEP 0: GROUND YOURSELF IN UPSTREAM, NOT IN THIS CHECKOUT
My local checkout may be many releases behind upstream and its CLAUDE.md may be stale. Before
anything else:
  git remote add upstream https://github.com/levy-street/world-of-claudecraft 2>/dev/null || true
  git fetch upstream
  git branch -r --list 'upstream/release/*' | sort -V | tail -1
Call the branch that lookup prints RELEASE. Then read, from RELEASE and not from my local
tree: CONTRIBUTING.md, CLAUDE.md, .github/PULL_REQUEST_TEMPLATE.md, docs/qa-gate.md, and the
CLAUDE.md of every directory you will touch. The package manager, Node version, and gate
commands have changed recently; use whatever RELEASE says, not what you remember.

Then check the change is not already done or already proposed. Search upstream for open and
recently merged PRs and open issues touching the same behavior. If someone has already
shipped or has an open PR for it, stop and tell me instead of writing a duplicate.

STEP 1: BRANCH AND BASE (this is the single most common reason my PRs die)
  git worktree add ../wocc-<slug> -b fix/<short-slug> RELEASE
Work in that worktree. Branch names are feature/<short-slug> or fix/<short-slug>.
The PR base MUST be RELEASE. Never main. GitHub preselects main on a fork PR, so set the
base explicitly when you open it and re-verify after opening that the PR shows
"base: release/vX.Y.Z" and not "base: main". A PR based on main will not be merged.

STEP 2: BUILD IT THE REPO'S WAY
- Fix bugs test-first: write a failing test that exercises the real code path, then make the
  smallest change that turns it green.
- New logic lands as its own small module behind an existing seam. Never append to sim.ts,
  hud.ts, renderer.ts, or main.ts.
- src/sim/ stays free of DOM, Three, and browser imports, and all randomness goes through Rng.
  Never Math.random, Date.now, or performance.now in sim logic.
- Any IWorld change goes in the matching src/world_api/<domain>.ts facet, is implemented in
  BOTH Sim and ClientWorld, and updates the pin in tests/world_api_parity.test.ts, all in
  this change.
- Any src/sim/ or server/ behavior change gets a test with a decisive assertion, one that
  actually fails if the change is reverted.

STEP 3: PRE-EMPT THE FOUR FINDINGS THAT ACTUALLY BLOCK PRS HERE
Two automated reviewers (OSSBrain and a Codex review bot) comment on every PR. These four are
what they block on. Handle each explicitly before you push, and say in your PR body that you
did:
1. i18n M16. Every new player-visible string is a t() key in the matching English catalog
   under src/ui/i18n.catalog/. If a new string is wordy, it ALSO needs real fills for
   zh_CN, zh_TW, ja_JP, ko_KR, and ru_RU in the same PR. Reuse an existing catalog entry for
   the same concept where one exists. Then regenerate i18n artifacts and commit them.
   Run the guard: the localization_fixes test must pass.
2. Asset licensing. Any new image, model, or sound file needs a CREDITS.md row in the same
   PR. No exceptions, including small original icons.
3. Formatting and typecheck. Run the repo's typecheck and run Biome on CHANGED FILES ONLY.
   Never run a repo-wide Biome write. Import order and duplicate declarations are common
   catches here.
4. Generated files. Never hand-edit *.generated.ts, the resolved i18n bundles, or the SFX
   manifest. Regenerate them through the owning build step and commit the regenerated output.

STEP 4: GATE IT LOCALLY
Run the full gate command RELEASE's CONTRIBUTING.md names as the merge bar (today that is the
full gate, not the fast path). It must be green. Do not pipe it through tail or head; that
masks the exit code. Paste its real output into your report. If it is red, fix it. Do not
open the PR on a red gate and do not tell me it "should" pass.

If the change is visual, capture before/after screenshots on desktop AND a phone viewport,
commit them under docs/screenshots, and reference them in the PR body. Do this yourself: on a
fork PR the repo's automatic screenshot bot gets a read-only token and produces nothing.

STEP 5: COMMITS AND PR
Conventional Commits with a scope, for both every commit title and the PR title:
  fix(ui): give the bags window an accessible dialog role and name
Every commit carries a body: blank line, then one to four plain sentences on what changed and
why, wrapped near 72 columns. A title alone is rejected by the repo's own rules.
No em dashes, no en dashes, no emojis, anywhere: code, comments, docs, commits, or PR text.

Open the PR from my fork against RELEASE, filling in the real
.github/PULL_REQUEST_TEMPLATE.md from RELEASE section by section. In "How was this tested?"
list the exact commands you ran and their real pass counts. Tick only the checklist boxes
that are genuinely true. In the body, add a line "Part of #<the open release tracker issue>".

STEP 6: COMMENT ON THE RELEASE TRACKER
Find the open issue titled "Release vX.Y.Z" matching RELEASE. That tracker is manually
curated and explicitly says a PR is only considered if someone comments proposing it, and
that a comment is a proposal rather than automatic inclusion. Post ONE comment there:
the PR link, one sentence on what it fixes, and one sentence on why it belongs in this
release. Keep it short and factual. Do not edit the issue body and do not add anything to the
Selected work list yourself.

STEP 7: DRIVE IT TO GREEN, DO NOT ABANDON IT
Watch CI. Two failure modes, two different responses:
- A failure in code you touched: fix it and push.
- "TEST_BASELINE_FAIL", or a suite failing identically on RELEASE itself: this is a stale
  base, not your regression. Rebase onto the current RELEASE, push, and post a short comment
  saying the failure reproduces on the base and what the rebase picked up.
When a reviewer or bot raises a finding, reply with EVIDENCE, not assurances: the exact
commands you ran and the real pass counts, or the commit that fixes it. That evidence comment
is what has historically converted a blocking finding into a merge here.
Never close the PR yourself because CI is annoying. Escalate to me instead.

HARD STOPS
- No automation, botting, or farming clients. Those are closed on sight as a terms of service
  violation.
- Never commit .env or secrets, and never enable ALLOW_DEV_COMMANDS in a production path.
- Do not invent balance numbers. Gameplay math follows real classic-era MMO formulas.

REPORT BACK
Give me: the PR URL, the confirmed base branch, the gate output, the four pre-empt items in
step 3 with how you satisfied each, the release-tracker comment URL, and a list of anything
you deliberately left out of scope.
```

## Why these rules

Every rule above is a response to something that actually happened in this repo.

**Base branch is the number one killer.** All three of my closed-unmerged PRs (#2540, #2541,
#2586) targeted `levy-street:main`. CONTRIBUTING.md says in bold: "Never target `main`, which
is a release-time integration branch rather than the contribution base. GitHub will often
preselect `main` for you, so change the base branch before you submit." Every PR merged in
the current cycle targets `release/v0.35.0`.

**Size.** #2586 carried 79 commits across server, UI, performance, tests, and docs. The PRs
that merge are one bug each: "fix(ui): give the bags window an accessible dialog role and
name", "fix(sim): exclude soulbound items from vendor bulk-buy quantity". CONTRIBUTING.md:
"Smaller, self-contained changes are easier to review and merge than large ones."

**Title format.** "Claude/damage meter hover details" and "Spirit regen in combat like WoW's
mp5 stat" are not Conventional Commits. Every merged PR title is.

**The toolchain moved.** Upstream now requires Node 26 and pnpm 10.34.x with
`pnpm-lock.yaml` as the single source of truth. A checkout carrying older npm-based
instructions will produce a PR that fails install in CI. Hence step 0.

**The four blockers are the observed ones.** #2905 was blocked twice, once for three new
WebP icons with no CREDITS.md row and once for leaving zh_CN, zh_TW, ja_JP, ko_KR, ru_RU on
English fallbacks. #2890 was blocked for exactly the same M16 i18n reason. #2897 was blocked
for Biome import order and then for a duplicate `KEYBIND_PANEL_SETTING_KEYS` declaration
causing TS2451.

**Stale-base CI noise is normal and survivable.** #2896 and #2910 both hit
"TEST_BASELINE_FAIL test command failed without a parseable Vitest failure; refusing an
unreliable baseline". Both merged. The move that worked both times was rebase onto the
current release branch plus a comment with concrete local pass counts. #2614 hit the same
class of problem and the author closed it: "am closing it, CI is a bloody mess and i dont
have time to go back and forth to fix this." That is the failure mode step 7 exists to
prevent.

**The release tracker is a real and underused lever.** Issue #2923 ("Release v0.35.0") says:
"If you want an issue or pull request considered for this release, add it in a comment below
with a link and a short explanation of why it belongs in v0.35.0", and "A comment is a
proposal, not automatic inclusion. Items are part of the release scope only after they appear
in Selected work." It also says the tracker is manually curated and that automated agents
"must not expand it". At the time of writing it has zero comments, so a well-formed proposal
comment stands out rather than competing.

**Check for supersession first.** #2591 was closed with "Has already been implemented by
#2716". #2732 was closed with "Closing this one because it seems to have been fixed by
another gfx optimization PR." Both were finished, reviewed, passing work that was wasted.

**Terms of service is an instant close.** #2984, an autonomous farming client with 266 tests,
got "Sorry, but this violates our terms of service" and nothing else.

**Fork PRs lose the screenshot bot.** `.github/workflows/pr-ai.yml` notes that a fork PR gets
a read-only token, so the screenshot job "degrades to a no-op". Visual changes from a fork
need screenshots committed by hand.
