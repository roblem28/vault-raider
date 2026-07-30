# NOTES — assumptions, ambiguities, deviations

Running log. Newest entries at the bottom of each section. Every SPEC ambiguity,
every assumption, and every tuning value that differs from §6 is recorded here.

---

## SPEC.md is AMENDED, not annotated

**As of 2026-07-30, `SPEC.md` is at v0.5 and supersedes v0.4.** The planning-phase
rulings are not merely logged in this file — they are written into the spec
itself and marked `[v0.5]`.

This matters operationally. `fidelity-auditor` and `softlock-hunter` audit code
against `SPEC.md`. If the spec had stayed at v0.4 while the code implemented the
v0.5 rulings, every audit from here to M11 would report drift and the project
would spend its time re-litigating settled decisions. The spec is the source of
truth or it is nothing.

Sections amended, all marked `[v0.5]`:

| Section | Amendment |
|---|---|
| Header | v0.5, supersedes v0.4, change summary |
| §2.1 (new) | `effectiveFloorIndex` clamp; treasure and warden-count formulas |
| §3.5 | Corpse blocking is tile-occupancy; lethality is AABB |
| §4.1 | Collision/hurt box split; `hitbox: 8` deleted; per-actor size table |
| §4.2 | Arrow direction = entity facing at spawn tick |
| §4.3 | WARDEN hurt box 8×8; no collision box |
| §4.4 | Monster hurt box 8×8 centered regardless of sprite |
| §6 | Block completed: hitbox split, 15 transcribed constants, indexing rules |
| §9 | Fire edge-detected at the source, all three inputs |
| §12.1.1 (new) | Determinism hash contents, included and excluded |
| §12.1.2 (new) | Headless input recorder required at M1 |
| §13 | Three modules added; gfx/render split; three build rules enforced |
| §17.1.1 (new) | `facingLatch` event vs entity facing state |

---

## Phase 0 — planning (2026-07-30)

### Conflicts found — all RESOLVED by ruling, folded into SPEC v0.5

**C1 — `player.hitbox` (SPEC §6 vs §4.1). RESOLVED.**
§6 carried a stale v0.2 `hitbox: 8`; §4.1 [v0.4] corrected the room hitbox to
6×6. One scalar could not express 4×4 floor view and 6×6 room view. Ruled a spec
defect, not an ambiguity. `hitbox` deleted; replaced by `hitboxFloor: 4`,
`hitboxRoom: 6`.

**C1a — collision box vs hurt box. RULED, was not previously in SPEC at all.**
The two are now separate concepts held at **equal size on purpose** (6×6 room,
4×4 floor for PIP) — the hurt box is deliberately forgiving because it matches
the small collision box rather than the 12×12 sprite. Monster and WARDEN hurt
boxes are 8×8 centered: PIP gets the forgiving box, the threats do not. Kept as
two named constants even while equal, so a feel-gate change to one cannot
silently move the other.

**C1b — corpse blocking is TILE-OCCUPANCY, not AABB. RULED.**
A corpse occupies its whole 8×8 tile for movement blocking; lethality is a
separate AABB test. These must not be collapsed. PIP's collision box is 6×6, so
an AABB-only corpse leaves 2 px of slack in an 8 px doorway and PIP squeezes
past — which silently deletes the doorway seal in §3.5 and with it the entire
rationale for §4.1's death handling. This is a softlock-adjacent detail hiding
in what looks like a collision-shape preference.

**C2 — CLAUDE.md internal nits. Cosmetic, no action.**
"The four mechanics that are always getting broken" lists six. "All four tests
must pass" lists five commands. Neither affects behavior.

### Ambiguities — all RULED, folded into SPEC v0.5

**A1 — treasure value past floor 3. RULED: index by layout, no cycle multiplier.**
`treasureByFloor[layoutIndex]`. Floors 4–6 and 7–9 reuse 400/600/800. Escalation
on deep floors comes from speed, warden count, and the time bonus — not from
inflating pickups. SPEC §6.

**A2 — warden count per cycle. RULED.**
`countByLayout[layoutIndex] + floor(effectiveFloorIndex / 3)`, `floorIndex`
0-based. Floors 1–3 → 2/3/4, floors 7–9 → 4/5/6. No explicit cap: the floor-10
clamp bounds it at 6. SPEC §2.1.

**A3 — floor 10+. RULED: one clamp, one place.**
`effectiveFloorIndex = min(floorIndex, 8)`. Layout, `floorSpeedMul`,
`floorTimerSec`, `warden.speedMul`, warden count, and treasure value all read
from it. Raw `floorIndex` is used only for display and score accumulation.
Clamping in two functions means the shape is wrong — route callers through
`floorDescriptorFor()`. SPEC §2.1.

**A4 — `dir` vs `facingLatch`. RULED, and my planning-phase model was incomplete.**
I had proposed one facing source read from `facingLatch`, which was the right
instinct but would have shipped a bug: I never specified what happens when input
goes neutral. If the struct's `facingLatch` *is* PIP's facing, facing resets on
key release and firing after release shoots the wrong way.

The correction — two variables, not one:

- **`facingLatch` is an EVENT.** `0..7` when a direction was expressed this tick,
  `-1` otherwise. Lives one tick. It is *not* state and must never be read as
  PIP's current facing.
- **Entity facing is persistent STATE.** Updates only when `facingLatch !== -1`.
  Persists across neutral input, pause, zoom transitions, and the arrow windup.
- **Arrow direction = entity facing at the SPAWN tick**, not the fire-input tick
  and not the input struct. This is what makes §4.2's "re-aim during windup,
  commit at spawn" actually work.

SPEC §17.1.1 and §4.2.

**A4a — accepted asymmetry between keyboard tap and touch tap. DO NOT UNIFY.**
A keyboard tap emits `dir` *and* `facingLatch` for one tick and drifts ~1 px,
exactly as §3.9 requires. A touch tap emits `facingLatch` only and drifts 0 px,
exactly as §17.4 requires. Both satisfy turn-without-moving. §3.9 specifies the
keyboard drift explicitly, so unifying them would violate it. Recorded here
because this looks like an inconsistency to a future reader and is not one.

**A5 — determinism hash contents. RULED, now enumerated in SPEC §12.1.1.**
Included: RNG state, tick, phase, PIP position/facing/lives/invuln, arrow state,
every monster's position/state/HP/dodge state, every corpse's position/decay
phase, floor timer, per-room looted flags, every warden's position/route
index/pursuit bias, score. Excluded: render interpolation, audio, cosmetics.
Inclusion test: *if omitting the field could hide a divergence that changes what
happens in the game, it goes in.* `hashGameState()` lives in `src/game/state.js`
and the test imports it, so test and implementation cannot drift.

### Rulings on items I did not raise

**E — fire edge-detection belongs at the SOURCE.**
Inside `input.js`, before the struct is built, for all three sources — not just
touch. Keyboard auto-repeat fires `keydown` continuously while held and must not
produce repeated fire events; a held gamepad button must not either. `fire` is an
edge, never a level. Edge-detecting downstream in game code would be a second
input path and would break §17.1. SPEC §9.

**F — the input recorder ships at M1, not M9.**
`determinism.mjs` needs a recorded input stream, which needs a recorder. Headless,
DOM-free, in the input module's test surface alongside `encodeInputFrame` /
`decodeInputFrame`. Trivial now, awkward to retrofit. SPEC §12.1.2.

**G — `build.py` enforces three rules that were previously enforced by trust.**
Build fails on: duplicate top-level identifier across the MANIFEST, any
`export default`, any `import` naming a file outside the MANIFEST. All three are
CLAUDE.md rules with no teeth until now. SPEC §13.

### File layout — three modules APPROVED and folded into SPEC §13

`core/touchmath.js`, `core/persist.js`, `game/render.js`. §13 was written at v0.2,
before §17 existed; this is correcting the spec, not deviating from it. The
gfx/render split is now stated explicitly in §13: `core/gfx.js` owns primitives,
`game/render.js` owns scene composition, both DOM-bound, neither imported by
`tests/`.

### Constants added to §6 — all transcribed, none invented

Fifteen values that v0.4 stated only in prose. Every one is quoted verbatim from
the section named; no rounding, no reinterpretation. Any value that had required
a judgment call would be flagged separately rather than buried here — none did.

| Key | Value | Source |
|---|---|---|
| `player.snapAssistWindowPx` | 2 | §4.1 |
| `player.snapAssistStepPx` | 1 | §4.1 |
| `zoom.durationTicks` | 24 | §8 |
| `touch.knobDiameterDevicePx` | 64 | §17.2 |
| `touch.maxRadiusDevicePx` | 40 | §17.2 |
| `touch.deadzoneDevicePx` | 12 | §17.2 |
| `touch.fadeOutTicks` | 8 | §17.2 |
| `touch.sectorWidthDeg` | 45 | §17.3 |
| `touch.hysteresisDeg` | 8 | §17.3 |
| `touch.tapMaxTicks` | 10 | §17.4 |
| `touch.moveZoneFrac` | 0.40 | §17.2 |
| `touch.fireZoneFrac` | 0.40 | §17.5 |
| `touch.overlayMaxOpacity` | 0.35 | §17.6 |
| `a11y.maxLuminanceStepPerFrame` | 0.10 | §11 |
| `a11y.maxFlashHz` | 3 | §11 |

Plus, from the hitbox/hurtbox ruling rather than from prose transcription:
`player.hitboxFloor: 4`, `player.hitboxRoom: 6`, `player.hurtboxFloor: 4`,
`player.hurtboxRoom: 6`, `monster.hurtbox: 8`, `warden.hurtbox: 8`.
Deleted: `player.hitbox: 8`.

---

## Withdrawn reviewer findings

Tracked per CLAUDE.md: if the withdrawal rate stays high, the agent file needs
rewriting, and that decision needs data rather than impressions.

| Milestone | Agent | Finding | Outcome |
|---|---|---|---|
| M1 | `fidelity-auditor` | `visibilitychange` on `window` "will silently never fire" | **Withdrawn.** The event is dispatched at `Document` with `bubbles: true` and `window` is in the propagation path, so the listener did fire. Agent agreed on challenge. The *fix* was still applied — `document` is the specified target and this binding is the template M10/M11 copy — but the stated failure mode was wrong. |
| M1 | `fidelity-auditor` | `deathFreezeSec` is an undisclosed invented constant | **Withdrawn.** It is at `SPEC.md:338` inside §6's own `TUNING` block, transcribed correctly. The agent grepped, got that exact line back as a hit, then wrote a conclusion contradicting its own grep output. It diagnosed the error itself on challenge. |

**M1 withdrawal rate: 2 of 5 substantive findings.** Both were caught by
challenging rather than by chance. The other three (`visibilitychange` target as
a forward-propagating pattern, arbitration asymmetry, prose-only constants) were
real and valuable — the arbitration one in particular would have been a genuine
M10 defect. Not yet enough signal to rewrite the agent file; revisit at M3.

---

## Containment breaches

Per CLAUDE.md's post-subagent `git status --porcelain` check.

| Milestone | Agent | Breach | Resolution |
|---|---|---|---|
| M1 | `fidelity-auditor` | Created `src_test_dup/` — a full copy of `src/` — to mutation-test `build.py` without touching the working tree | Deleted. Root cause was a harness defect, not agent misbehaviour: the agent was described as read-only but held `Bash`. `Bash` removed; `isolation: worktree` given to `softlock-hunter`, which is the agent that legitimately needs to write. |
| M1 | `fidelity-auditor` | Wrote six files to `.claude/agent-memory/fidelity-auditor/` | Accepted as intended behaviour, but **gitignored** — the repo is public and these are candid unreviewed assessments quoting source. Note that removing `Bash` did **not** stop this: `memory: project` grants `Write`/`Edit` regardless of the `tools:` line, and that grant is not scoped to the memory directory. This is why the containment check is a `git status` rule rather than a prompt constraint. |

---

## Deferred balance items — decide by playing, not by writing

**B1 — should `floorClearBase` scale by cycle?**
Treasure value deliberately does not (A1). Whether the floor-clear bonus should
grow on floors 4–6 and 7–9 is a balance question, not a spec question. Deferred
until after the feel gate (§12.3), decided by playtest.

**B2 — `CORPSE_SHOT_MODE`.**
SPEC §3.6 flags this as CONTESTED between two sources. Both modes implemented,
default `RESET_ONE`, decided by playtest not argument. Not a deviation — the
spec instructs exactly this.

---

## Open items to raise before the relevant gate

**IP1 — RESOLVED 2026-07-30. Repo is PUBLIC; the IP rule is now two-tier.**

I had flagged that `SPEC.md` contains `Venture`, `Exidy`, and `ColecoVision`
while §16 puts the repo at a public URL, and asked whether a public repo counts
as shipping.

Ruling: **the repo is public.** The portfolio card links to source, and a private
repo makes that link pointless. Everything committed is world-readable —
`SPEC.md`, `CLAUDE.md`, `docs/`, `.claude/` included.

The v0.5 rule was then found to be **too strict, not too loose**. It treated a
trademark string anywhere outside SPEC §0 and Appendix A as a finding, which
fired on `CLAUDE.md`, the harness prompt, and the bootstrap script — all of which
describe the game descriptively — and would have fired on every run forever. A
gate that cries wolf gets ignored, which is worse than no gate.

Replaced by two tiers in SPEC §0.1 `[v0.6]`. The line is **what work the string
does**, not where it sits:

- **Tier 1, BLOCKING** — `dist/`, README, `<title>`/meta/`og:`, repo name,
  Netlify site name, custom domain, the portfolio card, commit messages, and any
  **user-visible string** in `src/`. A hit is DO NOT PUSH, no judgment calls.
  (A comment in `src/` is not user-visible; a string literal that reaches the
  screen is.)
- **Tier 2, ALLOWED** — `SPEC.md`, `CLAUDE.md`, `docs/**`, `.claude/**`.
  Nominative use is lawful there because it is descriptive rather than
  source-identifying. Condition: phrasing must read "inspired by" / "in the
  tradition of", never "our version of X" or "X clone" as a product descriptor.

Consequences applied:

- SPEC.md bumped to **v0.6**, superseding v0.5.
- SPEC.md's own subtitle changed from "…dungeon crawler clone" to "An arcade
  dungeon crawler in the tradition of Venture (Exidy 1981 / ColecoVision 1982)" —
  the old phrasing used the mark as a product descriptor, which is precisely
  what Tier 2 forbids. The spec was violating its own new rule.
- Appendix A keeps its table and gains the header: "Design cross-reference.
  Nominative use for derivation tracking. Never reproduce in shipped output or
  public-facing copy."
- `.claude/agents/ip-compliance-reviewer.md` rewritten to audit against the two
  tiers instead of a location whitelist, with the verdict kept binary
  (SAFE TO PUSH / DO NOT PUSH) and Tier 2 findings explicitly non-blocking.

---

## Repo hygiene — root commit amended 2026-07-30

The root commit was amended rather than layered over, since nothing was pushed.

- **Removed from the tree:** `files.zip`, `files1.zip` (scratch binaries);
  `vault-raider-spec-v0.2.md`, `vault-raider-spec-v0.4.md` (superseded —
  `SPEC.md` is the only spec in the repo).
- **Moved to `docs/harness/`:** `vault-raider-bootstrap.ps1`,
  `CLAUDE_CODE_PROMPT_FULL.md`. These reproduce the agent harness and are kept
  as provenance.
- **`.gitignore`** gained `*.zip` and `vault-raider-spec-v*.md`.

---

## M1 — engine (2026-07-30)

### A6 — AMBIGUITY: SPEC never says whether diagonals are normalised

§4.1 gives PIP a single speed scalar (`1.00 × floorSpeedMul` px/tick in room
view). §3.10 requires 8-direction movement. SPEC never states whether a diagonal
step moves 1 px on each axis (making diagonal travel 1.414× faster than cardinal)
or is normalised to a uniform speed.

**My reading: normalise.** A single speed scalar only *is* a speed if it holds in
all eight directions; otherwise diagonals are strictly better than cardinals for
travel, which is a different game. `DIRS` in `tuning.js` carries pre-scaled
components using `Math.SQRT1_2` for the four diagonals.

This interacts with §3.10 ("diagonals beat cardinals") — but that advantage is
about *dodge checks* (`shotIsDiagonal ? 0.5 : 1.0`), which is preserved and
independent. Normalising movement does not weaken it. Raise at the feel gate if
diagonal movement feels sluggish.

### A7 — INVENTED CONSTANT: `accumulatorEpsilonSec: 1e-9` — **APPROVED 2026-07-30**

Approved with conditions. The rationale that makes it safe, which must survive
in writing because it is the thing keeping it safe:

> **THE EPSILON IS A SCHEDULER CONSTANT, NOT A SIMULATION CONSTANT.**
> `update()` always receives a fixed `DT`. Wall-clock jitter changes **when** a
> tick fires, never **what** happens inside one. Determinism is therefore
> unaffected — but only while that separation holds.

Conditions and their status:

| # | Condition | Status |
|---|---|---|
| a | Segregate it in `tuning.js`, out of the transcribed table | DONE — exported as `SCHEDULER`, not `TUNING`, with the IEEE-754 cause and the "no code reachable from `update()` may read this" rule stated at the declaration. `loop.js` is the only importer. |
| b | Replay must not go through the RAF loop | DONE and now **tested** — `tests/loop.mjs` replays a recorded stream with no `createLoop`, no `now()`, no `schedule()`, and asserts it reproduces the recording exactly and repeatably. |
| c | Promote timing checks out of the scratchpad | DONE — `tests/loop.mjs`, a sixth test file. `test-engineer` owns the suite from M3; this seeds it. |
| d | Cover JITTER, exact integer counts, no tolerances | DONE — see below. |
| e | If jitter proves flaky, switch to integer ticks; report first | NOT NEEDED — jitter passes exactly. Formulation kept. |

Jitter coverage in `tests/loop.mjs`, all asserting exact integers:

- Randomised deltas in `[1/240, 1/48]` over 60 simulated seconds → **exactly
  3600** updates. Seeded RNG, so a failure is reproducible rather than flaky.
  The run lands 4835 frames at a mean of 80.6 Hz.
- 30 Hz sustained → exactly 60 updates/sec, and separately asserts the frame
  really does take 2 substeps, so the multi-substep path is exercised rather
  than assumed.
- 90 Hz and 144 Hz sustained over **600 s** → exactly 36000 updates. This is the
  assertion that would have caught the original defect: a permanent one-tick
  offset is invisible to a short test but impossible to hide from an exact
  long-run count.
- A single 5 s stall → accumulator drains, and the following 60 frames yield
  exactly 60 updates with no catch-up burst.
- Nine constant rates from 30 to 240 Hz → exactly 60 updates/sec each.

#### A7 original finding (retained)

**This is the one number in `tuning.js` that is NOT transcribed from SPEC.** It is
pulled out and flagged separately here rather than buried in the transcribed
table, per the standing condition on §6 additions.

Found while validating M1. At 144 Hz the loop ran a permanent **one tick behind**:
60 updates in the first second became 59, then 119, 179, and so on — exactly
`60n - 1` forever. 60, 120, 165, and 240 Hz were all exact.

Cause: 144 additions of `1/144` sum to a hair under 1.0 in IEEE-754, so the 60th
step of every second falls just short of the threshold and slips a frame. It is a
constant phase offset, **not** compounding drift — game speed after the first
second was already correct.

Fixed in code rather than by relaxing the assertion, because SPEC §14 M1 requires
"exactly 60 Hz on a 144 Hz display". `advanceAccumulator` adds the epsilon before
the floor and clamps the remainder at zero so `alpha` cannot go negative.
Measured after the fix: 60/120/144/165/240 Hz all yield exactly 60 updates per
second over a 10-second run.

Determinism is unaffected: the accumulator governs *when* ticks run, never what
happens inside one. `determinism.mjs` replays a recorded input stream tick by
tick and never consults wall-clock time.

### D1 — `touchmath.js` deferred from M1 to M11

`docs/PLAN.md`'s milestone table listed `touchmath`(pure core) under M1. On
building it I concluded that was wrong and deferred it. The M1 requirement in
§17.1 is that the **unified struct** exist before touch is written — not that the
touch maths exist. Writing sector snapping and hysteresis now would be building
ahead of the milestone, which CLAUDE.md forbids.

What M1 delivers instead is the property that actually matters: `input.js` has no
per-source branch anywhere in its reduction. Sources register generically and
push intent through one setter. `setSourceIntent(hub, id, moveSector, faceSector)`
takes movement and facing as **separate arguments** specifically so touch
tap-to-reface (§17.4) — facing with no movement — is expressible at M1 with no
touch code in existence. Verified by test.

### D2 — the banned PRNG name cannot appear in `src/`, including in comments

`determinism.mjs` greps `src/` for the literal name and fails on any hit (§12.1).
My first draft of `src/core/rng.js` carried a comment saying that function was
banned — which would have failed the test on the very file that exists to prevent
it. Reworded. **Do not write the literal name anywhere under `src/`, comments
included.** The rule is a grep, and a grep cannot tell a prohibition from a use.

### F1 — FOUNDATION WRONG, fixed: `visibilitychange` bound to the wrong target

`fidelity-auditor` flagged `input.js` binding `visibilitychange` to `window`.
Fixed — it is now bound to `document`, which required threading `doc` into
`bindKeyboardInput`.

**One correction to the finding, for the record.** The auditor stated it "will
silently never fire." That overstates it: `visibilitychange` is dispatched at
the `Document` with `bubbles: true`, and `window` sits in the propagation path,
so a window listener does in fact receive it. The binding was not broken.

It was still worth fixing, and I fixed it, because `document` is the specified
target and this function is the template `bindGamepadInput` (M10) and
`bindTouchInput` (M11) will copy. The auditor's instinct — that this propagates
forward — was right even though its stated failure mode was not.

Not verified in a real browser (no browser access this session); the reasoning
above is from the Page Visibility spec, not from observation.

### F2 — AT RISK, fixed at M1 rather than deferred: input arbitration asymmetry

`fidelity-auditor` found that `lastIntentTick` advanced on every
`setSourceIntent` call. Keyboard pushes intent only on keydown/keyup
transitions, but §9 requires gamepad to be **polled every tick**. A held gamepad
direction would therefore refresh its timestamp continuously and always out-rank
a keyboard direction the player was actively using — arbitration decided by
which source repeats itself, not by intent.

The auditor recommended re-checking before M10. I fixed it now instead: M1 is
the milestone whose mistakes cannot be retrofitted, and the fix is three lines.
`lastIntentTick` now advances only when the intent actually **changes**, so
"most recently active" means most recently *changed* and is symmetric between
event-driven and polled sources.

### F3 — AT RISK, accepted: magic numbers in `main.js` scaffolding

`MAIN_BG_COLOR` … `MAIN_FPS_WINDOW` are module-local constants rather than
`tuning.js` entries. Accepted for M1 only: none are SPEC-governed gameplay
tuning, and the whole block is deleted at M2. **If any of these survive into
real game code they must move to `tuning.js`.**

### S1 — SPEC defects found by building M1, both fixed in v0.6

1. **§6 claimed to be "complete" but omitted the gamepad stick deadzone (0.35)**,
   which §9 states only in prose. Exactly the failure mode the v0.6 completion
   pass was meant to eliminate — the completion was itself incomplete. Added to
   §6 and to `tuning.js` now so M10 cannot hardcode it inline.
2. **§17.1.1's "Lifetime: one tick" was ambiguous** and could be read as
   "`facingLatch` goes neutral after one tick even while a key is held." The
   implementation had the correct reading; the prose did not enforce it. §17.1.1
   now carries a tick-by-tick counter-example table showing `facingLatch`
   holding `2` across a sustained press and entity facing surviving release.

### F4 — a regression test that passed against the bug it was written for

Worth recording as a method note, not just an incident.

After fixing the arbitration asymmetry (F2) I wrote the regression test the
auditor specified, and it passed. I then reverted the fix to confirm the test
had teeth — **and it still passed.** The test was worthless.

Cause: I polled the gamepad only *before* the keyboard press, so both sources
ended on the same `lastIntentTick`, and the registration-order tie-break — not
recency — handed the win to the keyboard. It passed for a reason unrelated to
what it claimed to test.

Rewritten so the pad keeps polling on strictly later ticks than the keyboard
press. Now verified in both directions: **fails** pre-fix (`expected 2, got 0`),
**passes** post-fix.

Standing practice from this: a regression test is not done when it passes. It is
done when it has been shown to fail against the defect. That check costs one
minute and is the only thing separating a test from a comment.

### F5 — `advanceAccumulator` was clamped on one side only

Found by the auditor. `Math.min(frameSec, maxFrameSec)` bounded the upper side
but not the lower, so a negative delta would drive the accumulator down and
under-count steps. `performance.now()` is monotonic so this cannot arise from
the real clock — but the loop takes an **injected** clock, and a test or a future
replay driver is not bound by that.

Now clamped on both sides, with `tests/loop.mjs` covering: a negative frame
yields zero steps and zero accumulator, a backward jump does not consume banked
time, and the run recovers to exactly 60 updates/sec immediately after.

### F6 — the §6 completeness claim, and why it is now gone

`fidelity-auditor` found two more prose-only constants after the gamepad
deadzone fix. I then ran a systematic sweep of every numeric literal in SPEC
prose against the §6 block and found two more it had not reported.

Promoted to §6 and `tuning.js`, each marked `[v0.6]`:

| Value | Was stated only in | Would have bitten at |
|---|---|---|
| `warden.pursuitBiasCap: 0.9` | §4.3 | M2 |
| `monster.diagonalDodgeMul: 0.5` | §4.4 | M6 |
| `player.startingLives: 3` | §4.1 | M5 |
| `player.spriteFloor: 4`, `spriteRoom: 12` | §4.1 | M3 |
| `scoring.floorClearMultBase: 1`, `floorClearMultRange: 4` | §6 formula | M8 |

`diagonalDodgeMul` sits on `monster` rather than inside `dodgeSkill`, because
`dodgeSkill` is a tier map read as `dodgeSkill[tier]` and must stay pure.

**The "this block is now complete" sentence has been deleted from §6.** It was
asserted at v0.5 and was wrong twice. A claim that has failed twice is not worth
repeating a third time. Replaced with a checkable invariant:

> Any numeric value a logic file needs must exist in §6 before that file is
> written. A milestone that discovers a prose-only constant folds it into §6
> first, then writes the code — never the reverse.

### M1 scaffolding, to be deleted at M2

`createMainDebugState` / `updateMainDebug` / `mainRenderDebug` in `src/main.js`
are the milestone's stated validation artifact — the "debug rect" from §14 M1.
They are not the game, and M2 replaces them with `game/state.js` and
`game/render.js`. The debug entity carries a persistent `facing` field
specifically to demonstrate §17.1.1 in a running build.

---

## Tuning values deviated from

None. Every value in `src/data/tuning.js` is transcribed from SPEC §6 v0.6, with
the single exception of `accumulatorEpsilonSec` (A7 above), an invented
engineering constant awaiting approval.
