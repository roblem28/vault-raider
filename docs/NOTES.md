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

## Tuning values deviated from

None. Every value in `src/data/tuning.js` matches SPEC §6 v0.5.
