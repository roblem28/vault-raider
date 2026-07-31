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

## M2 — floor view (2026-07-30)

### M2-A1 — INVENTED CONSTANTS, need approval: the WARDEN unstick trio

`warden.unstickAfterTicks: 45`, `unstickMinSpanPx: 12`, `unstickSlideTicks: 60`.
Not transcribed from SPEC — flagged separately here rather than buried in the
transcribed table, same as `accumulatorEpsilonSec` (A7).

**The defect they fix was real and severe.** A purely greedy chaser cannot step
*away* from PIP, so any barrier between them grants **permanent immunity**
rather than cover. Measured on floor 1: PIP stood at spawn **untouched for 600
seconds** while one WARDEN logged 29523 ticks on a single tile. Floor view stops
being evasion when standing still is the winning move.

SPEC §4.5 already sanctions the fix without improving pathing — walls block
WARDENs *badly*, "slow corner clipping only". §4.3.1 now states what that means.

**Four attempts, three of which failed. Recorded because the failures are the
interesting part and a future edit will re-propose them:**

| Attempt | Result |
|---|---|
| Slide when the tick is blocked | **Failed.** A WARDEN pinned on a barrier still succeeds on one axis most ticks, so it never looks blocked. |
| Re-roll slide handedness per stall | **Failed.** Scraping a wall lets greed partially succeed, clearing the stall and triggering a fresh roll — it oscillates in place. 5/8 seeds never caught. |
| Detect wedging by net displacement | **Failed.** Oscillating between two adjacent tiles is 8 px of travel; window endpoints sit far enough apart to pass. Replaced with the **span** of motion, which catches standstill and oscillation alike. |
| Abort the slide when any greedy step is viable | **Failed, 8/40 seeds.** The small off-axis step that caused the trap is still viable, so one tick of sliding is undone immediately. Now aborts only when the **dominant** axis opens. |

Also required: **resolve the dominant axis first** when chasing.
`moveAxisSeparated` resolves X before Y, which is right for PIP and actively
harmful for a chaser — the small eastward pull was consuming the tick before the
large southward escape was ever tried.

Result: **0/40 seeds** leave PIP permanently safe. Median catch 33 s, p90 44 s,
worst 48 s. Guarded by `tests/floors.mjs`, verified failing pre-fix on 4 seeds.

This is still not pathfinding and must never become pathfinding (§4.3). The
WARDEN picks a direction blindly, often commits to the wrong way round, and
takes a long time. Barriers give **temporary cover, not immunity**.

### M2-D1 — floor-1 layout is authored, not transcribed

SPEC §7.1's example floor is a **schema illustration and is not internally
consistent**: door `(6,19)` sits in the interior of room rect `[5,16,6,5]` rather
than on its perimeter, and the room rects overlap the warden routes implied by
its own waypoint list. The mask itself was never specified — §7.1 carries a
`"…30 rows of 40 chars…"` placeholder.

So floor 1's geometry is authored, preserving §7.1's *intent* (four corner
rooms, centre stairs, a perimeter patrol plus a central vertical one) and its
schema exactly. Room ids and the two warden routes are kept verbatim; door and
rect coordinates are chosen to be consistent. Validated by `tests/floors.mjs`
rather than by inspection.

Barriers are baked into the mask as wall rather than carried in §7.1's separate
`barriers` array. Floor-view barriers are static walls (§4.5 `WALL`); the array
is retained in the schema for M3's `SLIDING_BARRIER` room hazards, which are a
different thing that happens to share a name.

### M2-D2 — SPEC §14 says "1 WARDEN", §4.3 says 2. Built 2.

§14's M2 row reads "1 WARDEN on a route". §4.3's `countByLayout[0]` is **2**, and
floor 1 is a real floor rather than a test fixture. Built 2, which is what the
shipped floor needs; §14's figure reads as milestone shorthand rather than
content. Flagging rather than silently choosing.

### M2-D3 — unit conversion is not a tuning constant

`main.js` converts `performance.now()` milliseconds to seconds with a literal
`/ 1000`. CLAUDE.md bans magic numbers in logic files; a unit conversion is not
one, and putting it in `tuning.js` would oblige §6 to carry it under the §6
invariant. Left inline with a comment. Raise it if you disagree.

### M2-A2 — two more invented constants: `geom.boxEdgeEpsilonPx`, `zeroStepEpsilonPx`

`1e-9` and `1e-6`. Found by `fidelity-auditor`, which correctly noted these are
the *opposite* case from `SCHEDULER.accumulatorEpsilonSec`: that one is safe
because it is unreachable from `update()`, while these two sit **inside**
simulation code. Promoted from literals into `TUNING.geom` and SPEC §6 so the
precedent is "named and disclosed", not "literal in whichever collision file
needed it".

- `boxEdgeEpsilonPx` makes tile intervals half-open. Without it a 6 px box whose
  edge lands exactly on x=8 claims both tile 1 and tile 2.
- `zeroStepEpsilonPx` is the "close enough to zero to not be a step" threshold
  in WARDEN chase stepping.

### M2-F1 — a11y flash cap existed and was not being consulted

`render.js` blinked respawn invulnerability every 4 ticks — a **7.5 Hz** flash,
against `TUNING.a11y.maxFlashHz: 3` which has existed since v0.5. Nothing was
wrong with the constant; nothing read it.

Now **derived**: `ceil(1 / (maxFlashHz * 2 * dt))` = 10 ticks, giving exactly
3 Hz. Deriving rather than hardcoding a correct value means the cap cannot drift
out of sync with the thing it caps. Caught at M2 rather than M9, which is where
`reducedFlash` is scheduled and where it would have shipped.

### M2-F2 — duplicate fire gate removed before it could become three

`entities.js` exported `requestFire` and `floor.js` kept a private
`requestFloorFire` doing the same thing; the exported one was dead code. Both
enforced §3.8 identically, so nothing was broken — but M3 adds room-view firing,
and three independently-maintained copies of "exactly one arrow alive, ever" is
how that invariant stops being true. Consolidated to the single exported
`requestFire`.

### M2-F3 — the doorway test I first shipped covered one dimension of three

I reported "9/9 sub-pixel offsets" as doorway coverage. The brief was four
approach directions at 60 **and** 30 Hz — three dimensions, and I had varied
one. Extended to the full matrix:

- **40 one-tile gap tiles**, not the 12 room-door notches I would have hand-
  listed. The barriers create 1-tile lanes too, and the detector found them.
- **1368 combinations**: every gap × every cardinal approach whose entry tile is
  floor (84 more are walled and reported N/A rather than silently skipped) × 9
  sub-pixel alignments × {60 Hz, 30 Hz}.
- Driven through `advanceAccumulator`, so 30 Hz exercises the real 2-substep
  path rather than an assumption about it.

All 1368 pass. Mutation-verified: raising the collision box to 8 px fails
**912 of 1368**, which is SPEC §4.1's "zero tolerance in a 1-tile gap" claim
turning out to be literally true.

**A second mutation found something worth recording: disabling doorway
snap-assist entirely changes nothing.** All 1368 still pass. A 4×4 box in an
8 px gap has 2 px of slack per side, so floor view never needs the assist —
which means **snap-assist is currently unexercised by any test**. It exists for
the 6×6 *room* hitbox (1 px per side), and that geometry does not exist until
M3. Flagged as an M3 test requirement rather than covered by a floor-mask proxy,
which would have given false confidence.

### M2 scaffolding removed

M1's `createMainDebugState` / `updateMainDebug` / `mainRenderDebug` and their
module-local palette constants are **deleted** from `main.js`, closing the F3
AT RISK item from M1. `main.js` is now wiring only.

---

## M3 — vertical slice (2026-07-30/31)

### M3-A1 — INVENTED CONSTANT, needs approval: `ARCHETYPE.crawlerSpeedFrac: 0.55`

SPEC §4.4 describes each archetype qualitatively — CRAWLER is "perimeter /
wall-following, predictable" — and gives **none of them a speed**. That number
has to come from somewhere.

0.55 × PIP's room speed, so the floor-1 teaching monster can be walked away
from, which is what makes "predictable" true in play rather than just on paper.

Lives in a **fourth** segregated block, `ARCHETYPE`, alongside `SCHEDULER`,
`GEOM`, and `UNSTICK`. Same risk class as `UNSTICK`: reachable from `update()`,
determinism-critical, and balance-affecting. It gets its own block rather than
joining `UNSTICK` because §6.1 forbids applying one block's rationale to another
by analogy, and M6 adds five more archetypes that will each need speed and
behaviour numbers — a named home now, or five copy-pasted module-locals later.

**Feel-gate knob.**

### M3-A2 — INVENTED CONSTANTS: the `AUDIO` block

`sirenBaseHz: 220`, `sirenPeakHz: 880`, `sirenGain: 0.12`, `sirenRampSec: 0.05`.
§10 specifies the siren qualitatively — "rising siren… must be unmistakable" —
and gives no frequencies.

Determinism-**neutral**, and for the same structural reason `SCHEDULER` is:
nothing reachable from `update()` reads them. Audio is driven from `main.js`'s
render side and can never feed back into game state. That is what puts it in a
different risk class from `GEOM` and `UNSTICK`, and it is worth keeping true —
if a game rule ever reads an audio value, that reasoning is void.

### M3-F1 — FOUNDATION WRONG, fixed: the intruder patrolled instead of hunting

`fidelity-auditor` found it. §4.3: "On intrusion: spawns at a room door,
**switches to pure chase**, ignores geometry cost."

The intruder was built with an ordinary `createWarden` on a one-waypoint route
and driven through the same `updateWarden` as a patrol WARDEN — which rolls
`chase = rng() < pursuitBias`. Bias caps at `pursuitBiasCap` 0.9 and **can never
reach 1.0**, so the intruder headed back to its own spawn door on roughly 10% of
ticks, forever. It spawned correctly, never left, and killed on contact, so
every existing assertion passed. It simply did not hunt.

Fixed with an explicit `pureChase` argument. The RNG roll is still consumed in
both modes so that consumption order — and therefore replay determinism — does
not depend on which mode is active.

**The first regression test I wrote for this had no teeth**, and the reason is
worth keeping: by the time intrusion fires, elapsed ≥ `floorTimerSec`, so bias
is already at 0.9 and patrol mode chases 90% of ticks. It still arrives, just
wastefully — "does it close on PIP" passes either way. The discriminator is
**bias zero**, where the two modes are exact opposites: patrol walks to the
waypoint every tick, pure chase walks to PIP every tick. Verified failing
pre-fix at −30 px.

### M3-F2 — FOUNDATION WRONG, fixed: the intruder was under-hashed

`hashGameState` gave patrol WARDENs all 11 state fields and the room intruder
**2** — position only — while both are the same entity shape driven by the same
`updateWarden`, corner-clipping included. §12.1.1's inclusion test is explicit,
and nine steering fields were being dropped.

Fixed by routing both through one `pushWardenState` helper. The underlying cause
was two hand-maintained copies of one entity's hash, so the fix is structural
rather than just adding the missing fields: a field added to one is now
necessarily added to both.

### M3-F3 — a fabricated citation, and the discipline failure behind it

`entities.js` carried `// INVENTED - see docs/NOTES.md M3-A1` **when no M3
section of NOTES.md existed**. The auditor caught it by grepping for the anchor.
Four siren constants had no disclosure attempted at all.

Both are now real entries (M3-A1, M3-A2 above) with real constants in
`tuning.js`. Recording the failure mode because it is subtle: a comment
promising disclosure reads exactly like disclosure to a later reader, and is
worse than no comment, because it stops them looking.

### M3-F4 — a11y: the corpse hatch thinned to one pixel at the final decay phase

`fidelity-auditor` traced the hatch arithmetic by hand. A fixed 2 px diagonal
stride over a box shrinking with each decay phase left exactly **one** hatch
pixel at phase 3 — the last phase before a corpse vanishes, while it is still
lethal and still blocking.

§11 requires corpse lethality never be conveyed by hue alone, at every phase.
One pixel is not a hatch.

**My first fix was wrong, and the same auditor caught that too.** Scaling the
stride to the current span still left only **two** marks at phase 3, because
letting the box shrink a pixel per phase makes it 2×2 by then — and a 2×2 box
cannot hold three diagonal marks. **The geometry was the limit, not the
stride**, and I had changed the wrong variable.

Actually fixed by capping the shrink at `decayPhases - 2`, so a corpse never
falls below half a tile while it is still lethal, and adding the second diagonal
at the final phase — which also solves the problem that capping the shrink makes
the last two phases the same size. An X is a distinct broken silhouette.

Measured, per phase: span 8, 6, 4, 4 → **4, 3, 4, 8** hatch marks.

**The counts are now asserted in `tests/rooms.mjs`, not claimed in a comment.**
That is the actual lesson: I made this claim twice in a code comment and was
wrong twice. A number a reviewer has to re-derive by hand to check is a number
that should be in a test.

Caught at M3 rather than at M9's accessibility pass, which is where it would
otherwise have shipped from.

### M3-F5 — FEEL BUG, fixed: the arrow was the only un-interpolated actor

`game-feel-critic` found it. PIP, monsters, and WARDENs all lerp `prevX/prevY`
by `alpha`; the arrow rendered at its raw tick position because
`createArrowState` never allocated `prevX/prevY`.

It matters more than a generic stutter would, because the arrow is **the one
object precision aiming is judged against**. A non-interpolated projectile makes
a clean miss look like a rendering glitch rather than a player error — which is
feel-gate question 2 ("does a missed shot feel like *your* mistake") failing for
a reason that has nothing to do with the aiming.

### M3-F6 — the diagonal snap-assist "fix" was WRONG, and the measurement said so

`game-feel-critic`'s second finding: `applyDoorwaySnap`'s guards
(`dx !== 0 && dy === 0`) mean a **diagonal** approach to a 1-tile gap gets no
assist at all, and the trial only swept cardinals so the blind spot was
invisible. Plausible, specific, and it named the right code.

**I implemented it, extended the trial to all eight directions, and the numbers
said the reviewer was wrong.**

| Snap-assist | Entry window (1436 legal starts) |
|---|---|
| Cardinal-only (shipped) | **988 / 1436 — 68.8%** |
| Extended to diagonals | **444 / 1436 — 30.9%** |
| Disabled entirely | 924 / 1436 — 64.3% |

Extending it more than halved the entry window. Two reasons:

1. On a diagonal both nudges fire, and each is validated against the
   **pre-nudge** position — so the combined result is never checked, and the two
   corrections push each other into walls.
2. More fundamentally, **a diagonal already self-corrects on both axes as it
   travels**, so it does not need help. Un-assisted diagonal entry is 64.3%;
   assisted cardinal-only is 68.8%.

Reverted to cardinal-only, with the reasoning recorded at the guard so the next
reader does not "fix" it again. **The diagonal sweep stays in the trial** — it
now costs nothing and keeps this measured rather than re-argued.

Net effect of adding diagonals to the trial: the honest denominator went from
828 to 1436 starts, and snap-assist still rescues **64**. It earns its place.

### M3-D4 — TUNING CONCERN, deferred to the gate: CRAWLER dodge compounds

`game-feel-critic`'s third finding, and the arithmetic is right. §4.4 specifies
the dodge roll happens **on each tick** an arrow is in range and aligned. With
`dodgeSkill.LOW = 0.15` and `dodgeLookahead = 24 px` against a 3.5 px/tick
arrow, that is ~7 rolls per approach: `1 - 0.85^7 ≈ 68%` aggregate dodge, not
15%. My own M3 measurement — the CRAWLER stepping out of the lane at tick 21 and
a fixed-row test never connecting again — is this working exactly as coded.

**Not changed, deliberately.** The code matches §4.4 literally; both
`dodgeSkill.LOW` and `dodgeLookahead` are transcribed SPEC values, so retuning
either is a spec deviation needing approval, and "gate the roll to once per
arrow" is a mechanic change. The tension is real though: floor 1's *teaching*
monster, labelled LOW and "predictable", behaves like a much higher tier in
aggregate, and an unhittable first monster fails feel-gate question 2.

Three options for the gate, cheapest first: drop `dodgeSkill.LOW` toward
0.05–0.08; drop `dodgeLookahead` for the LOW tier only; or roll once per
arrow-entering-range instead of per tick. Raise at the checkpoint.

### M3-F7 — FOUNDATION WRONG (SPEC semantics), fixed: dodge was per-TICK

**The constants were fine. The semantics were wrong, and they were wrong in the
spec, not just the code.**

`dodgeSkill` values were authored as **per-shot** probabilities. §4.4 said "on
each tick an arrow is within `dodgeLookahead`… roll", which implemented them as
per-tick. A 3.5 px/tick arrow spends ~7 ticks inside a 24 px window, so:

| Tier | Label | Compounded per-tick reality |
|---|---|---|
| `LOW` 0.15 | 15% | **68%** |
| `MED` 0.45 | 45% | **98.5%** |
| `HIGH` 0.80 | 80% | **99.999%** |

Only `LOW` shipped at M3, so only `LOW` was observed. **At M6, `BRUTE` and
`BLINKER` at HIGH would have been unhittable** — not hard, unhittable — and it
would have surfaced three milestones downstream as "the game is broken".

Ruled and amended into SPEC §4.4 as `[v0.9]`: roll **once per arrow per
monster**, on first entry into the lookahead window. Implemented with an arrow
`id` and a `dodgedArrowId` on the monster, both in the determinism hash.

Measured after the fix — labels now mean what they say:

| Tier | Label | Single roll | Held 7 ticks in window |
|---|---|---|---|
| LOW | 0.15 | 0.144 | 0.148 |
| MED | 0.45 | 0.457 | 0.440 |
| HIGH | 0.80 | 0.814 | 0.816 |

**A note on the test, because the first version was weak.** Asserting the rate
over two calls is not enough: reverting to per-tick still passes it, since two
rolls only lift LOW from 0.15 to 0.28. The assertion that actually guards the
defect holds ONE arrow in the window for seven ticks and requires the aggregate
to still equal the label. Mutation-verified.

### M3-D5 — OPEN QUESTION for the feel gate: geometry silently scales dodge

**a) What the code does when the sidestep is blocked.** Nothing. It picks one
random direction, tries it once, and keeps whatever `moveAxisSeparated` returns:

```js
const perp = shot.dx !== 0 ? { dx: 0, dy: 1 } : { dx: 1, dy: 0 };
const sign = rng.nextFloat() < 0.5 ? -1 : 1;
const moved = moveAxisSeparated(monster.x, monster.y, size, size,
  perp.dx * TUNING.tile * sign, perp.dy * TUNING.tile * sign, tiles, null);
monster.x = moved.x;
monster.y = moved.y;
return true;
```

If that direction is wall, the monster stays put, eats the arrow, and **still
returns `true`** with `dodgedArrowId` set — so it does not retry, and does not
get a second roll. It does not try the opposite direction.

**b) Measured variance by room shape. 4000 trials per cell.**

| Shape | LOW (0.15) | MED (0.45) | HIGH (0.80) |
|---|---|---|---|
| Open hall, ≥3 tiles tall | 0.149 | 0.449 | **0.808** |
| Wide lane, 4 tall | 0.149 | 0.449 | **0.808** |
| 2-tall lane (THE COIL) | 0.077 | 0.226 | **0.402** |
| 1-tall corridor | 0.000 | 0.000 | **0.000** |

The roll rate is identical everywhere — 0.149 / 0.449 / 0.808. What changes is
whether the sidestep lands. In a 2-tall lane one of the two directions is always
wall, so **exactly half** of successful dodges are eaten. In a 1-tall corridor
**every** dodge is eaten and the tier is inert.

**So HIGH swings 80% → 40% → 0% purely on room shape.** That is a balance
mechanic nobody designed, and eleven more rooms get authored at M4 and M7 —
including the T-shaped `THE SUMP` and Y-shaped `THE FORK`, which are exactly the
shapes that mix wide and narrow bands in one room.

**c) §4.4 says nothing about blocked sidesteps.** It says only "On success,
sidestep 1 tile perpendicular." The omission is in the spec.

**Not fixed, deliberately** — this changes combat feel and the feel gate is
next. Trying the opposite direction when the first is blocked would preserve the
label, is what a real dodge looks like, and costs one branch; but it should be
felt before it is ruled. **If the gate rules for it, §4.4 must be amended before
any room authoring at M4**, because otherwise twelve layouts get designed
against dodge rates that later change.

### FEEL GATE PASSED — 2026-07-31. Three rulings, all SPEC v1.0.

THE COIL played, three sealed doors correct as M4 scope, hall firing confirmed
useless against WARDENs. Content work is unblocked.

**M3-D5 RULED — a blocked dodge retries the opposite direction.** The geometry
table settled it without more play: `0.000` in a 1-tall corridor is not a
tuned-low rate, it is a **dead mechanic** — BLINKER and CRAWLER become identical
and the tier stops meaning anything, which is worse than either extreme.

SPEC §4.4 `[v1.0]`: sidestep one tile perpendicular; if blocked, attempt the
opposite; if both are blocked the dodge fails and the monster takes the hit,
because the geometry genuinely gave it nowhere to go. The roll is still spent.

Measured at HIGH (label 0.80), 3000 trials per cell:

| Room shape | Single direction | Retry opposite |
|---|---|---|
| Open hall, ≥3 tall | 0.808 | **0.809** |
| 2-tall lane (THE COIL) | 0.402 | **0.809** |
| 1-tall corridor | 0.000 | 0.000 |

Mutation-verified: reverting to single-direction drops the 2-tall lane to 0.415
and fails. **Landed before any M4 room authoring**, deliberately — twelve
layouts designed against rates that then moved would be the rework.

**M3-D2 CLOSED — the siren sounds in both views.** SPEC §10 `[v1.0]`. The clock
is per-FLOOR so the threat is per-floor: a player in the hall at t=41s is four
seconds from a WARDEN entering whichever room they walk into next, and silence
would make the hall feel safe when it is not.

**M3-D3 CLOSED — the four dead `corpse` flags are deleted.** `lethalToPlayer`,
`blocksPlayer`, `blocksMonsters`, `blocksWarden` were declared and never read;
§3.5 and §4.1 hard-spec that behaviour and the code enforces it structurally
(corpses are never passed to monster or WARDEN movement at all). Removed from
SPEC §6 and `tuning.js`. `decayPhases` and `phaseSec` are live and stay.

Three code comments still cited the deleted flags after the deletion — the same
"reference to something that is not there" class as the fabricated NOTES anchor.
Fixed by hand.

### M3-F8 — a checker I wrote, could not verify, and removed

I extended `refs.mjs` with a check that every cited `TUNING.x.y` key resolves,
aimed at the stale-comment class above. **It did not work in either direction**:
it missed a planted dead-flag citation, and a corrected version reported **42
false positives on a clean tree**, because the key extractor only captured the
first key per line and multi-key lines like `logicalW: 320, logicalH: 240` lost
everything after the first.

Removed rather than shipped. A broken checker inside the file whose whole job is
protecting the audit trail is worse than none — it reports green while missing
the class it claims to cover, which is the cries-wolf failure this project
already ruled on when retiring the v0.5 blanket IP rule.

The reasoning and the rebuild conditions are recorded at the site in
`refs.mjs` rather than only here, so the next reader meets them in the code.

### M3-D1 — AT RISK, accepted: two arrow slots, one gate

`floor.arrow` and `room.arrow` are separate objects sharing one `requestFire`
gate. §3.8 says "exactly one arrow alive, ever" without saying whether that is
global or per-view. Not exploitable today — only one view updates at a time, so
a hall arrow freezes on room entry and resumes on exit rather than double-
updating. Flagged rather than changed, because collapsing them to one slot is a
behaviour change SPEC does not clearly ask for. Raise at the feel gate.

### M3-D2 — SPEC ambiguity: the siren sounds in floor view too

`main.js` drives the siren from the floor clock regardless of phase, so the
warning sounds wherever PIP is. §10 frames the siren around room intrusion and
does not say whether it should be silent in the hall. Arguably better as-is —
advance warning is useful everywhere — but it is a guess. Raise at the gate.

### M3-D3 — dead tuning data

`TUNING.corpse.lethalToPlayer`, `blocksPlayer`, `blocksMonsters`, `blocksWarden`
are declared and never read; the behaviours they describe are enforced
structurally instead (corpses simply are not passed to monster or WARDEN
movement). Same class as `arrow.maxAlive`. Not a bug, but a future editor could
flip one expecting an effect and get none. Left alone at M3; worth either wiring
or deleting before M6 adds more archetypes.

---

## M4 — Floor 1 content (2026-07-31)

### M4-R1 — the room design table

Reference for M7, when eight more rooms get authored. **Narrowest is measured
where a monster can reach**, not overall — every room's door corridors are
1 tile, which is free in a room with no monsters and irrelevant in one where
monsters never go there.

| Room | Contents | Tallest | Widest | Narrowest (monster space) | Shape |
|---|---|---|---|---|---|
| `THE COIL` | 4× CRAWLER | 30 | 34 | 2 | serpentine, 4 lanes + 3 pinches |
| `THE SLABS` | 4× SLIDING_BARRIER, no monsters | 26 | 34 | n/a | one open chamber, 4 stubs |
| `THE OSSUARY` | 4× BOUNCER | 22 | 34 | 22 | open chamber, 4 pillars |
| `THE WARRENS` | 5× BOUNCER | 30 | 34 | 8 | 4 dividers, loose cells |

**Tension lines** — what decision the room asks of the player:

- **THE COIL** — *A maze under a clock. The pinches are shortcuts that cost you
  the ability to retreat; the long way round is safe and expensive.*
- **THE SLABS** — *Cross four sweeping electrified barriers with no combat
  option. The only resource is timing, and the floor clock is running.*
- **THE OSSUARY** — *The monsters move unpredictably and the room is open, so
  you cannot plan a route and there is nowhere to break line of sight. React,
  or leave.*
- **THE WARRENS** — *The same unpredictability with more bodies and less room
  to be wrong in. The treasure is dead centre, so every route in is also the
  route out.*

**The v1.0 dodge ruling shaped these.** 1-tall corridors are dodge-dead at every
tier, so no monster spawns in one and nothing a monster can reach is narrower
than 3 in THE OSSUARY or THE WARRENS. THE SLABS uses 1-tile geometry freely
**because it has no monsters at all** — hazards are not monsters and do not
dodge, so the constraint does not bind there. That is a deliberate use of the
shape, not an oversight.

Also worth carrying to M7: **a 2-tall lane no longer behaves specially.** After
the retry-opposite ruling it dodges exactly like open space, so THE COIL's
signature shape is no longer doing anything mechanical that a wide room does
not. If M7 wants narrowness to *mean* something, it has to be 1-tall, and that
turns dodge off entirely.

### M4-A1 — INVENTED CONSTANT: `ARCHETYPE.bouncerSpeedFrac: 0.80`

Same class as `crawlerSpeedFrac`. §4.4 calls BOUNCER "erratic" and §5 asks for a
*fast* variant in THE WARRENS, but gives no number. Faster than CRAWLER because
a BOUNCER cannot corner you — it is dangerous by being where you did not expect,
not by applying pressure. Feel-gate knob.

### M4-D1 — SPEC ORDERING CONFLICT: M4 needs BOUNCER, §14 schedules it at M6

§14's M4 row is "all 4 Floor-1 rooms"; §5 says THE OSSUARY and THE WARRENS
contain BOUNCERs; §14's M6 row is "Remaining archetypes: BOUNCER DROPPER
STALKER BRUTE BLINKER". M4 cannot deliver its own stated validation — *loot
floor 1, descend* — without a monster §14 schedules two milestones later.

Resolved by building **BOUNCER only**, because M4 needs it, and leaving the
other four to M6. The seam is a `MONSTER_BEHAVIOUR` table: M6 adds entries
rather than editing `updateMonster`, and any archetype not in the table falls
back to CRAWLER movement with `placeholder: true` set on the monster so it
cannot ship silently.

Flagging rather than silently choosing. If you would rather M4 shipped those two
rooms with CRAWLERs and M6 swapped them, say so — the room data is already
final either way.

### M4-D2 — the floor-clear BONUS is M8, the transition is M4

`FLOOR_CLEAR_BONUS` awards **zero** right now. §14 puts scoring and the
time-bonus formula at M8; M4 owns only the phase transition, so the floor
advances and the clock resets exactly once, in `startFloor`. Awarding a guessed
number would be worse than awarding none.

### M4-F2 — the M4 gates found four, all real, all fixed

**`test-engineer`: the stairs gate had no teeth.** Removing `isStairsUnlocked`
from the FLOOR_VIEW dispatch left all eight suites green. The existing assertion
read the data function directly and never drove PIP onto the stairs tile through
`updateGame` before looting, so the real gate was never exercised early. Fixed
in `floors.mjs` and mutation-verified.

**`test-engineer`: SLIDING_BARRIER lethality had ZERO coverage.** Making
`hazardTouchesPlayer` return false left all eight green. THE SLABS has no
monsters — the barriers *are* the room — so an inert hazard turned a pure-timing
room into walk-in-take-the-coin. Now covered and mutation-verified, along with
sweep bounds, periodicity, purity, and the reset-on-death.

**`fidelity-auditor`: the hazards were never DRAWN.** `renderRoomView` read
tiles, doors, treasure, corpses, monsters, arrow, intruder and PIP — and never
`room.def.hazards`. THE SLABS shipped as an empty-looking chamber where PIP dies
to something invisible, which also defeats §11: there is nothing to animate a
steady no-strobe sweep for. Now drawn with hatched cross-bars and bright end
caps, so it is not conveyed by hue alone and has a silhouette distinct from the
treasure it shares a hue family with.

**`fidelity-auditor`: `room.ticks` was missing from the hash — the SECOND
instance of this class.** THE SLABS has no monsters and no corpses, so its whole
per-room hash contribution was three constant booleans regardless of where its
barriers were. The first instance was M3's WARDEN corner-clip fields. Both times
the pattern is the same: **a new field that steers behaviour, added to state but
not to `hashGameState`.** Standing habit from here — when `hashGameState` grows
a block, diff it against the nearest existing block of the same shape.

**`fidelity-auditor`: my `MONSTER_BEHAVIOUR` claim was false.** Both the code
comment and NOTES said "M6 adds entries rather than editing `updateMonster`",
while `updateMonster` dispatched on a bare `if (behaviour === 'ricochet')` with
CRAWLER inlined — so M6's four archetypes would each have needed an edit to the
very function the note promised they would not touch. Now keyed to functions, so
the claim is true. Same class as the fabricated citation: **a comment asserting
a property the code does not have.**

**`fidelity-auditor`: THE WARRENS' "(fast)" was decoration.** §5 asks for 5×
BOUNCER **fast** against THE OSSUARY's plain four, and both rooms instantiated
identical monsters off the same global constant — the schema had no way to say
"fast". SPEC §7.2.1 `[v1.1]` adds an optional per-spawn `speedFrac`; THE WARRENS
now uses 1.10 against the 0.80 archetype default. Content fidelity, caught only
because the auditor compared the shipped rooms against §5's table line by line.

### M4-F1 — a test regressed because the game got bigger, not because it broke

`floors.mjs`'s doorway matrix started failing 54 of 1368 the moment three more
rooms became live: PIP walking onto a room door now begins a zoom, so those
three door tiles stopped being inert floor and the traversal left `FLOOR_VIEW`
mid-measurement. Nothing about the geometry had changed.

Fixed by excluding room door tiles from both gaps and approaches — the identical
correction `rooms.mjs` needed at M3 for the same reason. Worth noting the shape:
**a passing test can start failing because a neighbouring system came online**,
and the first instinct of blaming the new code would have been wrong twice.

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

**B3 — WARDEN unstick timing. Decide by playing. BASELINE RECORDED.**

`UNSTICK.afterTicks: 45`, `minSpanPx: 12`, `slideTicks: 60` — all invented, none
specified. They quantify something SPEC only ever stated qualitatively: §4.3
calls barriers "PIP's only defensive tool" without saying for how long.

Measured on floor 1, PIP stationary at spawn, 40 seeds:

| | |
|---|---|
| Seeds where PIP is permanently safe | **0 / 40** (was 6/40, and 600 s+ before the fix) |
| Median time for a WARDEN to reach PIP | **33.2 s** |
| p90 | **44.3 s** |
| Worst | **47.6 s** |
| Floor-1 timer for comparison | **45 s** |

So on some seeds a barrier shelters PIP for the entire floor timer. **Not a
defect** — camping the hall gains nothing and burns the time bonus, so it is
self-punishing — but it is a balance fact that was invented rather than
specified, and it should be felt rather than reasoned about.

Turn `afterTicks` down to make barriers less protective; `slideTicks` up to make
a wedged WARDEN commit longer to escaping. Re-run the sweep after any change and
compare against the table above.

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
