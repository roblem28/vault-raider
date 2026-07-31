# VAULT RAIDER — Game Spec v1.1
**An arcade dungeon crawler in the tradition of Venture (Exidy 1981 /
ColecoVision 1982)** — nominative reference, see §0.1
Date: 2026-07-31 · Owner: Box of Rox LLC · Supersedes v1.0

Changes from v0.1 are marked **[v0.2]**. Changes from v0.2 are marked **[v0.3]**
(build output naming, deployment §16). Changes from v0.3 are marked **[v0.4]**
(mobile touch control §17, plus two defects it exposed in §4.1 and §15).
Changes from v0.4 are marked **[v0.5]** — planning-phase rulings folded in so the
spec stays the single source of truth for `fidelity-auditor` and
`softlock-hunter`: hitbox/hurtbox split and corpse tile-occupancy (§3.5, §4.1,
§4.3, §4.4, §6), §6 completed with constants previously stated only in prose,
`effectiveFloorIndex` clamp and per-layout indexing (§2, §6), `facingLatch` as
event vs entity facing as state (§4.2, §17.1), fire edge-detection at the source
(§9, §17.1), determinism hash contents and the input recorder (§12.1), and three
modules added to the repo layout (§13).
Changes from v0.5 are marked **[v0.6]** — the IP rule split into two tiers
(§0.1) after the v0.5 blanket rule proved to fire on every internal design
document, and the repo confirmed **public**.
Changes from v0.6 are marked **[v0.7]** — everything M1 found by building
against the spec rather than reading it: seven constants promoted out of prose
into §6 (§4.1, §4.3, §4.4, §9), the §6 completeness claim **deleted** and
replaced with a checkable invariant after being wrong twice, the scheduler
constant block (§6.1), §17.1.1's tick-by-tick counter-example, and
`tests/loop.mjs` added to §12.1 as a sixth test file.
Changes from v0.7 are marked **[v0.8]** — what M2 found by building floor view:
§4.3.1's corner-clipping unstick, the §7.1 floor-authoring invariants (§7.1's
own example violated them), §14's M2 row no longer naming a WARDEN count that
contradicts §4.3, and §6.1 split into three constant blocks by provenance.
Changes from v0.8 are marked **[v0.9]** — the §4.4 dodge roll corrected from
per-tick to ONCE PER ARROW PER MONSTER. `dodgeSkill` values were authored as
per-shot probabilities and implemented as per-tick rolls, which compounded them
to near-certainty; at HIGH that made a monster unhittable rather than hard.
Changes from v1.0 are marked **[v1.1]** — the §7.2 per-spawn `speedFrac`
override, added because §5's "fast" `BOUNCER` variant in `THE WARRENS` was
otherwise inexpressible and shipped identical to `THE OSSUARY`'s.
Changes from v0.9 are marked **[v1.0]** — the FEEL GATE PASSED, and three
questions it left open are now ruled: a blocked dodge sidestep retries the
opposite direction (§4.4), the intrusion siren sounds in floor view as well as
room view (§10), and the four unread `corpse` flags are deleted from §6 because
§3.5 and §4.1 hard-spec that behaviour.

---

## 0. IP / COMPLIANCE — READ FIRST

- Game **mechanics and rules are not copyrightable**. Sprites, character names, level art, music, and the title **are**.
- `Venture`, `Winky`, `Hallmonster` are Exidy/Coleco marks. **Do not ship them** — see the Tier 1 list in §0.1 for exactly what "ship" covers.
- Ship names: title `VAULT RAIDER`, protagonist `PIP`, hall stalker `WARDEN`.
- Do **not** extract sprites, tilemaps, audio, or ROM data from MAME sets or ColecoVision dumps. All art redrawn from scratch.
- **[v0.2]** Repo name is `vault-raider`. Do **not** name the repo, directory, package, or any public-facing string after the original trademark.
- **[v0.2]** Original room names appear only in **Appendix A** of this document. Appendix A is `SPEC-internal` — strip before publishing any README or store listing.
- **[v0.2]** Commit a `PROVENANCE.md` at repo root asserting: all assets original, no ROM-derived data, mechanics-only derivation.
- Public framing: "inspired by early-1980s arcade dungeon crawlers."
- **[v0.6]** The repo `roblem28/vault-raider` is **PUBLIC**. Everything committed
  is world-readable — `SPEC.md`, `CLAUDE.md`, `docs/`, `.claude/` included. The
  portfolio card links to source, which a private repo would make pointless.

### **[v0.6]** 0.1 Two tiers — where trademark strings may and may not appear

v0.5 treated a trademark string anywhere outside §0 and Appendix A as a finding.
That rule fired on `CLAUDE.md`, the harness prompt, and the bootstrap script —
all of which describe the game descriptively — and it would have fired on every
run forever. **A gate that cries wolf gets ignored, which is worse than no gate.**

The legal line is not *where* the string sits, it is *what work the string does*.
Naming the game you were inspired by, descriptively, in a design document is
**nominative use** and is lawful. What is unlawful is shipping their assets, or
using their name to identify **your** product.

#### TIER 1 — BLOCKING

Trademark strings (`Venture`, `Winky`, `Hallmonster`, `Exidy`, `Coleco`,
`ColecoVision`) must **NEVER** appear in anything that ships or identifies the
product:

- `dist/` — any file
- `README.md`, page `<title>`, `meta` tags, `og:` tags
- Repo name, Netlify site name, custom domain
- The portfolio card: its copy, its links, its alt text
- Commit messages
- Any user-visible string in `src/`

A Tier 1 hit is **DO NOT PUSH**. No exceptions, no judgment calls.

#### TIER 2 — ALLOWED

Nominative reference is permitted in internal development documents, because
there it is descriptive rather than source-identifying:

- `SPEC.md`, `CLAUDE.md`, `docs/**`, `.claude/**`

Condition on the phrasing: it must read as **"inspired by"** or **"in the
tradition of"** — never as **"our version of X"** or **"X clone"** used as a
product descriptor. The first describes lineage; the second identifies the
product by someone else's mark, which is exactly what Tier 1 forbids.

Ship names remain `VAULT RAIDER` / `PIP` / `WARDEN` everywhere, in both tiers.

---

## 1. TARGET / STACK

| Item | Choice |
|---|---|
| Deliverable | **[v0.3]** `dist/index.html` — one file, zero external requests |
| **[v0.2]** Source layout | `src/` ES modules + `build.py` inliner (see §13) |
| Render | 2D Canvas, logical 320×240, integer-scaled, letterboxed |
| Loop | Fixed 60 Hz accumulator with substep cap, interpolated render |
| Input | **[v0.4]** Keyboard, Gamepad, and Touch — three sources, ONE input model (§17.1) |
| Audio | WebAudio, procedural oscillators, no asset files |
| **[v0.2]** RNG | Seeded xorshift32 only. `Math.random` is **banned** — CI greps for it |
| Persist | `localStorage`, try/catch wrapped, high scores + options only |
| Deploy | Netlify drop, or route in the `boblemieux.ai` Next.js portfolio |

**[v0.2] One grid to rule them all.** Tile size is **8 px**. Every map — floor view and room view — is **40×30 tiles = 320×240 px**. v0.1's 64×48 floor mask is void.

Fallback stack: hand-maintained single HTML file, tests dropped. Only accept this if the build step proves to be a nuisance; it costs the winnability guard.

---

## 2. CORE LOOP

1. **Floor view** (map). PIP is a 4×4 dot. Corridors patrolled by invulnerable WARDENs.
2. Touch a door → zoom transition → **Room view**. PIP is 12×12 with a bow.
3. In room: dodge/shoot monsters, take the treasure, exit via any door.
4. Treasure taken → room **permanently sealed** (greyed, doors shut).
5. All 4 rooms looted → stairwell unlocks → descend.
6. Three floor layouts cycle across floors 1–9 with rising speed. Floor 10+ replays floor 9.

Floor view = evasion. Room view = combat under a clock. The two-view structure is the game.

### **[v0.5]** 2.1 Floor indexing — one clamp, one place

`floorIndex` is 0-based (`floorIndex = floorNumber - 1`). Everything that
escalates with depth derives from a single clamped value:

```js
effectiveFloorIndex = Math.min(floorIndex, 8)   // floor 10+ replays floor 9
layoutIndex         = effectiveFloorIndex % 3
```

**Every** derived value reads `effectiveFloorIndex` or `layoutIndex` — layout,
`floorSpeedMul`, `floorTimerSec`, `warden.speedMul`, warden count, and treasure
value. Raw `floorIndex` is used **only** for display and for score accumulation.

Clamping in more than one function is a defect, not a style choice. If a second
clamp appears, the shape is wrong — route the caller through
`floorDescriptorFor()` instead.

Derived formulas, stated once:

```js
treasureValue = scoring.treasureByFloor[layoutIndex]         // 400/600/800, no cycle multiplier
wardenCount   = warden.countByLayout[layoutIndex] + Math.floor(effectiveFloorIndex / 3)
```

`wardenCount` yields 2/3/4 on floors 1–3 and 4/5/6 on floors 7–9. The floor-10
clamp bounds it at 6; no separate cap exists or is needed.

---

## 3. NON-NEGOTIABLE MECHANICS

Cut any of these and it stops being a clone of the original.

1. **WARDENs are invulnerable.** Not killable, slowable, blockable, or divertible by any means.
2. **[v0.2] Firing in the hall is allowed and useless.** Arrows spawn and travel; they pass straight through WARDENs. Wasting time on this is an intended newbie trap. v0.1 wrongly disabled hall fire.
3. **Room timer → WARDEN intrusion.** Past `floorTimerSec`, a WARDEN enters the current room through a door and hunts. It never leaves. Only escape is leaving the room.
4. **The intrusion clock is per-FLOOR, not per-room, and never resets on room exit.** This is the central scoring tension. Verify by stopwatch across two rooms.
5. **Corpses are lethal terrain.** Kills decay through `decayPhases` over time, then vanish. While present they kill PIP on contact and **physically block PIP's movement** — including doorways.
   - **[v0.2]** Corpses block **PIP only**. Monsters walk through them. WARDENs walk through them (they are unblockable by definition).
   - **[v0.5] Blocking is TILE-OCCUPANCY. Lethality is AABB.** A corpse occupies
     its **whole 8×8 tile** for movement blocking — that tile is solid to PIP,
     exactly as a wall tile is. Its kill check is a separate AABB overlap against
     PIP's hurt box.
     These must not be collapsed into one test. PIP's collision box is 6×6
     (§4.1), so an AABB-only corpse leaves 2 px of slack in an 8 px doorway and
     PIP squeezes past — which silently deletes the doorway seal this mechanic
     exists to create, and with it the §4.1 death-handling rationale.
6. **[v0.2] Shooting a corpse is punished — exact behavior is CONTESTED.**
   - Sources disagree: Wikipedia says the shot corpse regresses to death-phase 0; a GameFAQs player report says shooting remains makes *all* remains reappear.
   - Implement both behind `CORPSE_SHOT_MODE: 'RESET_ONE' | 'RESET_ALL'`. Default `RESET_ONE`. Decide by playtest, not by argument.
7. **Treasure tile grants invulnerability.** While standing on the pickup point PIP cannot be killed. Camping to let monsters drift away is intended, not a bug.
8. **Arrow in flight = defenseless.** Exactly one arrow alive at a time; no separate cooldown. Long misses = long vulnerable windows.
9. **[v0.2] Facing is decoupled from movement.** Any directional input latches facing **that same frame**, whether or not movement is possible (wall, corpse, zero-length tap). Movement resolves separately. A 1-frame tap must reorient PIP with ~1 px of drift. Do not derive facing from realized displacement.
10. **8-direction aiming; diagonals beat cardinals.** Monster dodge checks are less effective against diagonal shots.
11. **Monsters dodge arrows** with per-type competence — sluggish on floor 1, expert by floor 3.
12. **Trap rooms** spawn extra monsters **on treasure pickup**, not on entry.
13. **Killing is optional.** Every room must be beatable treasure-only with zero kills. **[v0.2]** Enforced by automated test, not by good intentions (§12.1).

---

## 4. ENTITIES

### 4.1 PIP (player)

| Property | Floor view | Room view |
|---|---|---|
| Sprite | 4×4 dot | 12×12 with bow |
| **[v0.5]** Collision box | 4×4 AABB | 6×6 AABB, centered, 3 px inset |
| **[v0.5]** Hurt box | 4×4 AABB | 6×6 AABB, centered, 3 px inset |
| Speed | `1.10 × floorSpeedMul` px/tick | `1.00 × floorSpeedMul` px/tick |
| Can fire | **[v0.2]** Yes — no effect on WARDENs | Yes, 1 arrow max |
| Dies on | WARDEN | monster, corpse, WARDEN, hazard |
| Lives | 3 start; +1 per `extraLifeEvery` points | |

**[v0.4] Hitbox corrected from 8×8 to 6×6.** v0.2 specified an 8×8 hitbox. Tiles
are 8 px, so a 1-tile corridor is exactly 8 px wide and an 8×8 hitbox fits with
**zero tolerance** — PIP must be pixel-perfectly aligned to enter any 1-tile gap.
That is unplayable on a keyboard and impossible on a touchscreen. 6×6 gives 1 px
of slack per side. The winnability BFS in §12.1 is tile-based and is unaffected.
Confirm the value at the feel gate; do not raise it above 6 without re-checking
every 1-tile doorway.

**[v0.5] The v0.2 `hitbox: 8` scalar in §6 was stale and is deleted.** It
contradicted this section and could not express two view states in one number.
Replaced by `player.hitboxFloor: 4` and `player.hitboxRoom: 6`.

**[v0.5] Collision box and hurt box are separate concepts, equal in size.**
PIP's box against **walls, corpses, and doorways** and PIP's box against
**monsters, corpses, WARDENs, and hazards** are both 6×6 in room view and 4×4 in
floor view. They are the same dimensions **deliberately** — the hurt box is
forgiving because it matches the small collision box rather than the 12×12
sprite. Keep them as two named values even though they are currently equal; if
the feel gate moves one, it must not silently move the other.

Sizes, stated once, for every actor:

| Actor | Collision box | Hurt box |
|---|---|---|
| PIP, floor view | 4×4 | 4×4 |
| PIP, room view | 6×6 | 6×6 |
| Monster | — (tile-based movement) | **8×8 centered** |
| WARDEN | — (unblockable, §3.1) | **8×8 centered** |
| Corpse | **full 8×8 tile occupancy**, PIP only (§3.5) | 8×8 AABB |

Monster and WARDEN hurt boxes are 8×8 and centered: PIP is the forgiving box,
the threats are not. Do not scale any of these for touch (§15, §17.8).

**[v0.4] Doorway snap-assist (required).** Slack alone is not enough. When PIP
moves toward a 1-tile gap and is within 2 px of alignment on the perpendicular
axis, nudge 1 px per tick toward alignment. Applies to all input sources
identically so it cannot desync a replay.

**[v0.2] Death handling — corrected.** On death:

- Lose a life. Respawn at the floor entrance with **2.0 s blinking invulnerability**.
- **Floor intrusion timer is NOT reset, reduced, or paused.** v0.1's "reset to 60%" was a suicide-farm exploit.
- **Clear all corpses on the floor.** Reset all **unlooted** rooms to their entry spawn state.
- **Looted rooms stay looted.** Score and any in-room WARDEN are cleared.
- Rationale: without the corpse clear, a corpse decaying in the only doorway of an unlooted room makes the stairs permanently unreachable — an unwinnable run. This was a v0.1 softlock.

### 4.2 Arrow

- Speed `3.5` px/tick, 8-dir, despawns on wall / monster / corpse hit or screen edge.
- `windupTicks = 4` between fire input and spawn. During windup PIP may still reorient (§3.9) but the shot commits to the facing at spawn time.
- Rate of fire is gated purely by "is an arrow alive?".
- **[v0.5] Arrow direction is read from PIP's persistent entity facing at the
  SPAWN tick, never from the input struct and never from the fire-input tick.**
  This is precisely what makes "re-aim during windup, commit at spawn" work. An
  arrow that samples direction when the fire button was pressed cannot be
  re-aimed; an arrow that samples the input struct fires nowhere at all when the
  player has released the direction key during the 4-tick windup. See §17.1 for
  the event-vs-state distinction this depends on.

### 4.3 WARDEN

- Floor view: scripted waypoint patrol plus a **pursuit bias** that grows with elapsed floor time: `bias = min(0.9, pursuitBiasRate × elapsedSec)`. Each tick, with probability `bias`, step toward PIP instead of the next waypoint.
- **Deliberately poor** at navigating corridor barriers. Barriers are PIP's only defensive tool. Do not improve this pathing.
- On intrusion: spawns at a room door, switches to pure chase, ignores geometry cost.
- Count per floor layout: `wardenCount = [2, 3, 4]` by layout index, `+1` per full 3-floor cycle. **[v0.5]** Formula stated exactly in §2.1.
- Immune to everything, always.
- **[v0.5]** Hurt box **8×8 centered** (§4.1). WARDENs have no collision box against *actors*, but they DO resolve against walls — §4.5 says walls block them *badly*, not not-at-all.

#### **[v0.7]** 4.3.1 Corner clipping — the unstick rule

§4.5 allows walls to impede a WARDEN by "slow corner clipping only". That
clause is load-bearing and this section states what it means, because M2
measured what happens without it.

A purely greedy chaser **cannot step away from PIP**, so any barrier between
them grants PIP *permanent* immunity rather than cover. Measured at M2: PIP
stood at the floor-1 spawn untouched for 150 s while both WARDENs oscillated
between two adjacent tiles, one of them logging 3149 and 3120 visits to the
same pair. That is not "deliberately poor navigation" — it is a WARDEN that has
stopped being a threat, and it makes the floor trivially safe.

The rule:

- Track the SPAN of motion over `unstickAfterTicks` - the bounding box the
  WARDEN stayed inside. If that span is under `unstickMinSpanPx`, it is wedged.
  Span, not net displacement: oscillating between two adjacent tiles is 8 px of
  travel, so a net-displacement check passes while the WARDEN is plainly stuck.
- Resolve the **dominant axis first** when chasing. Generic axis-separated
  movement always resolves X before Y, which is right for PIP and wrong for a
  chaser: a WARDEN north-west of a barrier has a large southward pull and a
  small eastward one, and X-first spends the tick on the small eastward step
  back into the trap before the southward escape is attempted.
- Abort the slide when the **dominant axis** opens up — *not* when any greedy
  step becomes viable. Aborting on any movement makes the slide useless: the
  small off-axis step that caused the trap is still viable, so one tick of
  sliding is immediately undone and the WARDEN never travels the ~8 px needed
  to clear the obstacle. Measured: aborting on any movement left 8 of 40 seeds
  with a permanently safe PIP; aborting on the dominant axis left 0 of 40.
- A fixed-duration slide that never aborts is also wrong — it bounces inside a
  2-tile corridor instead of resuming the chase once clear.
- On wedging, commit to sliding along one perpendicular axis for
  `unstickSlideTicks`, **ignoring the target entirely** during the slide.
  Reverse the slide direction if that way is walled too.
- Handedness is fixed per WARDEN at creation, never re-rolled. Re-rolling was
  measured and fails: scraping a wall lets the greedy step partially succeed on
  most ticks, clearing the wedge flag and triggering a fresh roll, so the WARDEN
  oscillates in place instead of travelling far enough to find the gap.

**This is NOT pathfinding and must never become pathfinding** (§4.3). The WARDEN
picks a direction blindly and has no idea whether it helps; it frequently
commits to the wrong way round and takes a long time. That is the intended
texture. What it may not do is stop threatening PIP forever.

Barriers therefore give **temporary cover, not immunity** — which is what makes
them a tool rather than a win condition.

The three constants are **invented, not transcribed** from any other section.
See `docs/NOTES.md` M2-A1.

### 4.4 Room monster archetypes

Six behaviors, reskinned per room.

| Archetype | Movement | Dodge | HP | Notes |
|---|---|---|---|---|
| `CRAWLER` | Perimeter/wall-following, predictable | LOW | 1 | Corners PIP in dead ends |
| `BOUNCER` | Erratic diagonal ricochet | LOW–MED | 1 | Unpredictable; hit by luck |
| `DROPPER` | Ceiling descent, then horizontal scurry | MED | 1 | Wave cadence spawns |
| `STALKER` | Slow deliberate approach + projectile | MED | 1 | Only ranged monster |
| `BRUTE` | Lumbering patrol | HIGH | 2 | Body-blocks doorways |
| `BLINKER` | Teleport / home to PIP | HIGH | 1 | Floor 3 only; near-unshootable |

**[v0.9] Dodge check — ONCE PER ARROW PER MONSTER, not once per tick.**

When an arrow **first enters** a monster's `dodgeLookahead = 24 px` window and is
aligned to that monster's axis, roll **once**:

```
rng() < dodgeSkill[tier] × (shotIsDiagonal ? diagonalDodgeMul : 1.0)
```

On success, sidestep 1 tile perpendicular. **[v1.0] If that tile is blocked,
attempt the OPPOSITE perpendicular. If both are blocked the dodge fails and the
monster takes the hit** — the geometry genuinely gave it nowhere to go, and the
roll is still spent.

Whether it rolled, dodged, or failed for want of room, that monster does not
roll again for that arrow.

**[v1.0] Why the retry is required.** Single-direction sidestep let room shape
silently scale the dodge tier, because a blocked sidestep was eaten in silence.
Measured at HIGH (label 0.80), 3000 trials per cell:

| Room shape | Single direction | Retry opposite |
|---|---|---|
| Open hall, ≥3 tiles tall | 0.808 | **0.809** |
| 2-tall lane (`THE COIL`) | 0.402 | **0.809** |
| 1-tall corridor | 0.000 | 0.000 |

At 0.000 a `BLINKER` and a `CRAWLER` are identical and the tier means nothing —
a dead mechanic, worse than either extreme. The 1-tall corridor stays at zero
after the fix and that is correct: there is no perpendicular room at all.

This landed **before** any room geometry was authored at M4, deliberately.
Twelve layouts designed against rates that then moved would be rework.

**`dodgeSkill` values are PER-SHOT AGGREGATE probabilities.** LOW means a 15%
chance of dodging a shot. Not 15% per tick.

v0.8 and earlier said "on each tick", which compounded them. A 3.5 px/tick arrow
spends roughly 7 ticks inside a 24 px window, so the real aggregates were:

| Tier | Label | Compounded per-tick reality |
|---|---|---|
| `LOW` 0.15 | 15% | **68%** |
| `MED` 0.45 | 45% | **98.5%** |
| `HIGH` 0.80 | 80% | **99.999%** |

Only `LOW` shipped at M3, so only `LOW` was observed. At M6 `BRUTE` and
`BLINKER` at HIGH would have been **unhittable** — not hard, unhittable — and it
would have surfaced as "the game is broken" three milestones downstream.

Four things improve, none regress:

- The labels mean what they say.
- The sidestep is one decisive commitment rather than a repeated coin flip,
  which reads better and matches "sidestep 1 tile".
- Fewer RNG draws per tick, so determinism has a smaller surface.
- `diagonalDodgeMul` now halves an actual 15/45/80 rather than a compounded
  near-certainty, restoring §3.10's "diagonals beat cardinals" as a real edge.

**[v0.5]** Every monster's hurt box is **8×8 centered** (§4.1), whatever its
sprite size. `BRUTE` and `BLINKER` differ in HP, never in hurt box.

### 4.5 Hazards

- `SLIDING_BARRIER` — electrified segment on a fixed sweep period; contact kills. Pure timing.
- `WALL` — blocks PIP, arrows, monsters. Blocks WARDENs *badly* (slow corner clipping only).

---

## 5. CONTENT — 3 FLOORS × 4 ROOMS

Ship names only. Original references in Appendix A.

### Floor 1 — teaching floor, slow

| Ship name | Contents | Treasure | Trap on pickup |
|---|---|---|---|
| `THE SLABS` | 4× `SLIDING_BARRIER`, no monsters | Coin | No |
| `THE COIL` | 4× `CRAWLER` | Goblet | No |
| `THE OSSUARY` | 4× `BOUNCER` | Ring | No |
| `THE WARRENS` | 5× `BOUNCER` (fast) | Chest | No |

### Floor 2 — shaped rooms, faster

| Ship name | Contents | Treasure | Trap on pickup |
|---|---|---|---|
| `THE WEB` | 4× `DROPPER` | Idol | Yes — 2× `DROPPER` |
| `THE FORGE` | 2× `STALKER` | Crown | No |
| `THE SUMP` (T-shape) | 3× `BRUTE`, expert dodge | Jug | No |
| `THE FORK` (Y-shape) | none on entry | Rook | **Yes — 2× `BRUTE` instantly** |

### Floor 3 — unfair by design

| Ship name | Contents | Treasure | Trap on pickup |
|---|---|---|---|
| `THE LAMP` | 3× `BLINKER` | Lamp | Yes |
| `THE PIT` | 3× `BLINKER` + 1× `STALKER` | Key | Yes |
| `THE EYE` | 2× `BRUTE` (3 HP) | Amulet | No |
| `THE ROOST` | 6× `DROPPER` (fast, erratic) | Chalice | No |

**[v0.2] Difficulty is layout-led, not speed-led.** Per player reports on the original, map geometry dominates difficulty — floor 2 plays harder than floor 7. Do not flatten this by relying on `floorSpeedMul` alone. Floors 4–6 and 7–9 reuse layouts 1–3 with speed bumps; expect and accept a non-monotonic difficulty curve.

---

## 6. TUNING CONSTANTS

**[v0.5]** v0.4 stated fifteen values only in prose (§4.1 snap-assist, §8 zoom,
§11 flash caps, §17 touch), which collided with the project rule that all
constants live in `src/data/tuning.js` and no logic file carries a magic number.
Every value added is transcribed verbatim from the section named in its comment.
Nothing here is a judgment call; where a judgment call was required it is flagged
in `docs/NOTES.md` instead of being buried in this table.

**[v0.7] This block does NOT claim to be complete, and that wording is
deliberate.** v0.5 claimed completeness and was wrong twice: the gamepad stick
deadzone (§9) and then the pursuit-bias cap (§4.3), diagonal-dodge multiplier
(§4.4), starting lives (§4.1), and floor-clear multiplier terms all survived the
"completion" pass. Each was found only when a milestone was about to consume it.

The invariant, which is checkable, replaces the claim, which was not:

> **Any numeric value a logic file needs must exist here before that file is
> written.** A milestone that discovers a prose-only constant folds it into §6
> first, then writes the code — never the reverse.

A `[v0.7]` comment marks each value promoted out of prose after the fact.

```js
export const TUNING = {
  tile: 8, gridW: 40, gridH: 30,          // 320x240
  logicalW: 320, logicalH: 240, dt: 1/60,
  maxSubsteps: 5, maxFrameSec: 0.25,

  // [v0.5] hitbox: 8 deleted - stale v0.2, contradicted §4.1, and one scalar
  // cannot express two view states. Collision and hurt boxes are separate
  // concepts held at equal size on purpose; see the §4.1 table.
  player: { speedRoom: 1.00, speedFloor: 1.10,
            hitboxFloor: 4, hitboxRoom: 6,          // §4.1 collision box
            hurtboxFloor: 4, hurtboxRoom: 6,        // §4.1 hurt box
            spriteFloor: 4, spriteRoom: 12,         // [v0.7] §4.1 sprite, was prose-only
            snapAssistWindowPx: 2,                  // §4.1 doorway snap-assist
            snapAssistStepPx: 1,                    // §4.1
            startingLives: 3,                       // [v0.7] §4.1, was prose-only
            deathFreezeSec: 1.5, respawnInvulnSec: 2.0 },

  // [v0.7] diagonalDodgeMul lives here rather than inside dodgeSkill, because
  // dodgeSkill is a tier map read as dodgeSkill[tier] and must stay pure.
  monster: { hurtbox: 8,                            // §4.1, §4.4 - 8x8 centered
             diagonalDodgeMul: 0.5 },               // [v0.7] §4.4, was prose-only

  arrow:  { speed: 3.5, maxAlive: 1, windupTicks: 4, dodgeLookahead: 24 },

  zoom:   { durationTicks: 24 },                    // §8 - ticks, never ms

  gamepad: { stickDeadzone: 0.35 },                 // [v0.7] §9 - was stated only in
                                                    // §9's table; §6 claimed to
                                                    // be complete without it

  touch: {                                          // §17.2 - §17.6, device px
    knobDiameterDevicePx: 64,                       // §17.2
    maxRadiusDevicePx: 40,                          // §17.2
    deadzoneDevicePx: 12,                           // §17.2
    fadeOutTicks: 8,                                // §17.2
    sectorWidthDeg: 45,                             // §17.3
    hysteresisDeg: 8,                               // §17.3
    tapMaxTicks: 10,                                // §17.4
    moveZoneFrac: 0.40,                             // §17.2 left zone
    fireZoneFrac: 0.40,                             // §17.5 right zone
    overlayMaxOpacity: 0.35                         // §17.6
  },

  // Per-FLOOR intrusion clock. Never resets on room exit or on death.
  warden: { floorTimerSec: [45, 38, 32], intrusionWarnSec: 4,
            speedMul: [0.85, 0.95, 1.05], pursuitBiasRate: 0.02,
            pursuitBiasCap: 0.9,                    // [v0.7] §4.3, was prose-only
            countByLayout: [2, 3, 4],
            hurtbox: 8 },                           // §4.1, §4.3 - no collision box

  // [v1.0] lethalToPlayer / blocksPlayer / blocksMonsters / blocksWarden
  // DELETED. All four were declared and never read: the behaviour they described
  // is hard-specced in §3.5 and §4.1 and enforced structurally instead - corpses
  // are simply never passed to monster or WARDEN movement. An unread flag is a
  // lie about what is configurable, and a future editor flipping one would get
  // no effect at all.
  corpse: { decayPhases: 4, phaseSec: 2.5 },

  floorSpeedMul: [1.00, 1.08, 1.16, 1.24, 1.32, 1.40, 1.50, 1.60, 1.72],

  dodgeSkill: { LOW: 0.15, MED: 0.45, HIGH: 0.80 },

  scoring: {
    monsterKill: { CRAWLER: 100, BOUNCER: 150, DROPPER: 200,
                   STALKER: 250, BRUTE: 300, BLINKER: 400 },
    treasureByFloor: [400, 600, 800],
    floorClearBase: 1000,
    // [v0.7] The two terms of the §6 bonus formula, previously inline literals
    // in the formula block below: mult = base + range * (remain / timer).
    floorClearMultBase: 1,
    floorClearMultRange: 4,
    extraLifeEvery: 20000
  },

  flags: {
    HALL_FIRE_ENABLED: true,
    CORPSE_SHOT_MODE: 'RESET_ONE',   // | 'RESET_ALL'  — CONTESTED, decide by playtest
    DEATH_RESETS_FLOOR_TIMER: false, // must stay false; true is an exploit
    DEATH_CLEARS_CORPSES: true       // must stay true; false softlocks the run
  },

  a11y: { reducedFlash: false, colorblindCorpses: true, masterVolume: 0.7,
          maxLuminanceStepPerFrame: 0.10,           // §11
          maxFlashHz: 3 }                           // §11
};
```

### **[v0.8]** 6.1 Invented constants — three blocks, three risk levels

Everything in §6 above is transcribed from this document. Everything here was
**invented while building** and is exported separately from `TUNING` so it can
never be mistaken for a transcribed value.

**The three blocks have different provenance and different risk. Do not apply
one block's rationale to another by analogy** — that is the specific mistake
this segregation exists to prevent.

| Block | Transcribed? | Reachable from `update()`? | Risk |
|---|---|---|---|
| `SCHEDULER` | no | **no** | determinism-neutral |
| `GEOM` | no | **yes** | determinism-critical |
| `UNSTICK` | no | **yes** | determinism-critical **and balance-affecting** |

```js
export const SCHEDULER = { accumulatorEpsilonSec: 1e-9 };
export const GEOM      = { boxEdgeEpsilonPx: 1e-9, zeroStepEpsilonPx: 1e-6 };
export const UNSTICK   = { afterTicks: 45, minSpanPx: 12, slideTicks: 60 };
```

**`SCHEDULER`** — safe *precisely because* it is unreachable from `update()`.
`update()` always receives a fixed `dt`, so wall-clock jitter changes **when** a
tick fires, never **what** happens inside one. `src/core/loop.js` is the only
permitted importer. If a game rule ever reads it, the scheduler has entered the
simulation and this approval is void. Replay must not go through
`requestAnimationFrame` (§12.1.2). Cause: IEEE-754 — see §12.1 and NOTES A7.

**`GEOM`** — the opposite case. Read from code reachable by `update()`, so it
carries none of `SCHEDULER`'s protection: changing either value changes what
happens in the game and invalidates every recorded replay.
`boxEdgeEpsilonPx` makes tile intervals half-open; `zeroStepEpsilonPx` is the
"not a step at all" threshold in WARDEN chase stepping. NOTES M2-A2.

**`UNSTICK`** — highest risk. Reachable from `update()` like `GEOM`, and on top
of that it sets **how long a barrier shelters PIP**, which §4.3 calls his only
defensive tool. Measured baseline on floor 1: median catch 33 s, worst 48 s,
against a 45 s floor timer. These are feel-gate knobs. See §4.3.1 and NOTES
M2-A1 / M2-B3.

**[v0.5] Indexing rules for the arrays above.** `floorTimerSec`,
`warden.speedMul`, `warden.countByLayout`, and `scoring.treasureByFloor` are all
indexed by **`layoutIndex`**, not by floor number. `floorSpeedMul` is indexed by
**`effectiveFloorIndex`**. Both derive from the single clamp in §2.1.

Treasure is therefore worth 400/600/800 on floors 4–6 and again on floors 7–9 —
there is deliberately **no cycle multiplier** on treasure value. Escalation on
deep floors comes from speed, warden count, and the time bonus, not from
inflating pickups.

**[v0.2] Floor-clear bonus formula, made explicit.**

```
remain = max(0, floorTimerSec[layout] - elapsedFloorSec)
mult   = 1 + 4 * (remain / floorTimerSec[layout])     // 1.0 .. 5.0
bonus  = round(floorClearBase * mult)
```

All numbers above are original-*inspired*, not original-accurate. The arcade scoring tables are undocumented and internally inconsistent. Treat as balance baseline.

---

## 7. DATA SCHEMAS

### 7.1 Floor

```json
{
  "id": "floor1",
  "layoutIndex": 0,
  "spawn": { "tx": 5, "ty": 25 },
  "mask": ["########################################", "…30 rows of 40 chars, '#'=wall '.'=floor…"],
  "barriers": [ { "tx": 12, "ty": 4, "tw": 5, "th": 1 } ],
  "wardenRoutes": [
    { "waypoints": [[3,3],[36,3],[36,26],[3,26]], "startIdx": 0 },
    { "waypoints": [[20,3],[20,26]], "startIdx": 1 }
  ],
  "rooms": [
    { "id": "coil",    "door": { "tx": 10, "ty": 7  }, "rect": [6,7,9,6] },
    { "id": "ossuary", "door": { "tx": 28, "ty": 7  }, "rect": [24,7,9,6] },
    { "id": "slabs",   "door": { "tx": 10, "ty": 22 }, "rect": [6,17,9,6] },
    { "id": "warrens", "door": { "tx": 28, "ty": 22 }, "rect": [24,17,9,6] }
  ],
  "stairs": { "tx": 20, "ty": 15, "lockedUntilAllLooted": true }
}
```

#### **[v0.8]** 7.1.1 Floor-authoring invariants — ENFORCED, not advisory

**The coordinates above were wrong until v0.8.** The example had door `(6,19)`
sitting in the *interior* of rect `[5,16,6,5]` rather than on its perimeter, and
its room rects overlapped the corridor implied by its own warden waypoints. A
schema illustration that violates its own rules misleads whoever authors the
next floor, and eleven more rooms get authored at M4 and M7.

Every floor must satisfy all of these. `tests/floors.mjs` checks each one for
every layout — an invariant that exists only in prose is the same class of thing
as the banned-PRNG rule was before `determinism.mjs` existed.

1. **The door tile lies ON the room rect's perimeter**, never inside it.
2. **The door tile is the ONLY tile of the rect that is floor**, and it is
   adjacent to corridor. The rest of the rect is solid.
3. **No room rect contains a warden route waypoint**, nor any tile on the
   straight segment between consecutive waypoints. A rect swallowing a patrol
   line strands a WARDEN, and §4.3 forbids giving them pathfinding to escape.
4. **Room rects do not overlap each other.**
5. Spawn, all four doors, and the stairs are mutually reachable on the mask
   (already enforced since M2).
6. **Every 1-tile gap is passable by PIP's collision box from every approach
   direction whose entry tile is floor, at 60 Hz and 30 Hz, at every sub-pixel
   alignment.** This is the softlock `winnability.mjs` structurally cannot find:
   its BFS is tile-based and does not model the hitbox at all.

Barriers are static walls in floor view (§4.5 `WALL`) and are baked into the
mask. The `barriers` array is retained for renderer hinting and for M3's
`SLIDING_BARRIER` room hazards, which are a different mechanic sharing a name.

### 7.2 Room

```json
{
  "id": "fork",
  "shipName": "THE FORK",
  "layoutIndex": 1,
  "tiles": ["…30 rows of 40 chars…"],
  "doors": [ { "tx": 20, "ty": 29, "side": "S" }, { "tx": 5, "ty": 0, "side": "N" } ],
  "treasure": { "tx": 20, "ty": 6, "type": "rook", "safeTile": true },
  "spawnOnEntry": [],
  "spawnOnPickup": [
    { "type": "BRUTE", "tx": 14, "ty": 6, "dodge": "HIGH" },
    { "type": "BRUTE", "tx": 26, "ty": 6, "dodge": "HIGH" }
  ],
  "_note": "[v1.1] a spawn may carry an optional speedFrac overriding the archetype default - see below",
  "hazards": []
}
```

#### **[v1.1]** 7.2.1 Optional per-spawn `speedFrac`

A spawn entry may carry `speedFrac`, overriding that archetype's default speed
for that one monster. Omitted means the archetype default.

This exists because §5 asks for **5× `BOUNCER` (fast)** in `THE WARRENS` against
`THE OSSUARY`'s plain four, and the schema had no way to express it — so the two
rooms shipped byte-identical monsters and the "(fast)" qualifier was decoration.
Caught by the M4 audit.

Use it sparingly. A per-spawn override is content, not tuning: it does not live
in §6, and a value used by more than one or two spawns belongs in the
`ARCHETYPE` block instead.

### 7.3 **[v0.2]** Sprite encoding (keeps the single-file constraint)

```json
{ "w": 12, "h": 12, "bpp": 2, "pal": ["#00000000","#e04030","#f8f0c0","#301820"],
  "data": "…base64 of row-major 2-bit indices, rows byte-padded…" }
```

Decoded at boot into offscreen canvases; palette-swapped per floor. No image files, no data-URI PNGs.

---

## 8. STATE MACHINE

```
BOOT → ATTRACT → INTRO_WALK → FLOOR_VIEW ⇄ ROOM_ZOOM_IN → ROOM_VIEW
                                   ↑                          │
                                   └── ROOM_ZOOM_OUT ─────────┘
FLOOR_VIEW → STAIRS → FLOOR_CLEAR_BONUS → FLOOR_VIEW(next layout)
any → PLAYER_DEATH → (lives>0 ? FLOOR_VIEW : GAME_OVER) → HIGH_SCORE → ATTRACT
```

- `INTRO_WALK`: cosmetic — PIP walks the screen border, collects the bow, descends. Keep it. It is the game's signature cold open.
- `ROOM_ZOOM_IN/OUT`: 24-tick scale-lerp of the room rect to full screen. Non-interactive. **The floor intrusion timer keeps running during zooms.** Duration measured in ticks, never in ms.

---

## 9. CONTROLS

| Action | Keyboard | Gamepad | **[v0.4]** Touch |
|---|---|---|---|
| Move / aim | Arrows or WASD (8-dir) | Left stick (deadzone 0.35) / D-pad | Floating thumbstick, left zone (§17) |
| Fire | Space or `J` | A / X | Tap anywhere in right zone |
| Pause | `P` / Esc | Start | Top-centre pause glyph |
| Mute | `M` | — | Options panel |

**[v0.2] Web hygiene requirements**

- `preventDefault()` on arrows, space, and WASD to stop page scroll and button re-activation.
- Gamepad polled inside the update step, never event-driven.
- **[v0.5] Fire is edge-detected at the SOURCE, inside `input.js`, before the
  struct is built — for all three sources, not just touch.** §17.5 states it for
  touch; it holds for keyboard and gamepad identically. Keyboard auto-repeat
  fires `keydown` continuously while a key is held and must **not** produce
  repeated fire events; a held gamepad button must not either. The struct's
  `fire` field is an edge, never a level. Edge-detecting downstream in game code
  would be a second input path and would break §17.1.
- Pause dims and freezes the canvas — it must not become a free scouting tool. Pause is ignored during zoom transitions and death animations.
- `touch-action: none`, viewport meta set, pinch/scroll suppressed.

---

## 10. AUDIO

Procedural, no asset files.

| Cue | Sound |
|---|---|
| Floor theme | 8-bar bass arpeggio loop, tempo scales with `floorSpeedMul` |
| Room enter | Descending 4-note sting |
| Arrow fire | Noise burst + pitch drop |
| Monster death | Square-wave downward glide |
| Treasure pickup | Ascending major triad |
| **Intrusion warning** | Rising siren, begins `intrusionWarnSec` before entry — must be unmistakable. **[v1.0]** Sounds in FLOOR VIEW as well as room view — see below |
| WARDEN in room | Continuous dissonant throb; silences the theme |
| PIP death | Long descending chromatic run |

**[v0.2]** `AudioContext` is created **lazily on the first user gesture**, never at load — browser autoplay policy will otherwise leave the game silent with no error.

**[v1.0] The intrusion siren sounds in BOTH views.** The clock is per-FLOOR
(§3.4), so the threat is per-floor. A player standing in the hall at t=41s is
four seconds from a WARDEN entering whichever room they walk into next, and they
need that to decide whether to commit. Silence in the hall would make the hall
feel safe when it is not. The on-screen indicator §11 requires is driven from
the same value, in both views, so sound and picture cannot disagree.

---

## 11. **[v0.2]** ACCESSIBILITY (blockers, not niceties)

- **Photosensitivity.** The intrusion siren visual and `SLIDING_BARRIER` animation are flash sources. `reducedFlash` option must cap full-screen luminance change to ≤10% per frame and hold barrier animation to a steady sweep with no strobe. Nothing in the game may flash above 3 Hz.
- **Colorblind safety.** Corpse lethality must never be conveyed by hue alone. Corpses render with a diagonal hatch fill and a distinct broken silhouette at every decay phase.
- **Contrast.** PIP must be distinguishable from every monster by silhouette alone at 1× scale. Verify with a greyscale screenshot pass.
- **No audio-only information.** The intrusion warning has a matching persistent on-screen indicator (border pulse + countdown pips).
- Full keyboard play; no mouse required at any point including menus.
- `localStorage` wrapped in try/catch — Safari private mode throws on write.

---

## 12. VALIDATION

### 12.1 **[v0.2]** Automated tests (Node, zero dependencies)

| Test | Asserts |
|---|---|
| `tests/winnability.mjs` | For **all 12 rooms**: BFS on the tilemap with monsters ignored finds door → treasure → door. Fails the build otherwise. This is the guard for "every room beatable kill-free." **[v0.7]** Lands at M3 (one room), all twelve at M7. |
| `tests/determinism.mjs` | Same seed + same recorded input stream → identical final state hash across two runs. Also greps `src/` for the banned platform PRNG and fails on any hit. **[v0.7]** Landed at **M2**, earlier than planned: until it existed the PRNG ban had no automated enforcement at all, and an unenforced hard rule is a comment. |
| `tests/timer.mjs` | Floor timer monotonic across simulated room enter/exit/enter; unchanged by a simulated death; unchanged by zoom transitions. **[v0.7]** Landed at M2 covering death and respawn; room enter/exit and zoom join at M3. |
| `tests/floors.mjs` | Every floor: spawn reaches all 4 doors and the stairs on the corridor mask; every warden waypoint sits on a floor tile. **[v0.7]** Landed at M2, plus §4.3.1's guard that no barrier grants a stationary PIP permanent immunity. |

Run: `node tests/winnability.mjs && node tests/determinism.mjs && node tests/timer.mjs && node tests/floors.mjs`

**[v0.5]** `tests/input.mjs` (§17.7) joins the suite at M11, making five.

**[v0.7]** `tests/loop.mjs` is a **sixth** test file, seeded at M1. `input.mjs`
was also started early — the touch assertions still land at M11, but its
source-agnostic assertions exist from M1.

| Test | Asserts | From |
|---|---|---|
| `tests/loop.mjs` | Scheduler timing. **Exact integer update counts, never tolerances.** Nine constant rates 30–240 Hz → 60 updates/sec each. 90 Hz and 144 Hz over **600 s** → exactly 36000, which is the only shape that catches a permanent one-tick offset. Seeded jittered VRR deltas in `[1/240, 1/48]` over 60 s → exactly 3600. 30 Hz exercising the multi-substep path. Stall → accumulator **drains**, no catch-up burst, exactly 60/sec immediately after. Backward clock → no steps, no consumed time. Replay runs with no loop, clock, or scheduler (§6.1). | M1 |
| `tests/input.mjs` | Sector mapping for all 8 directions; fire edge-detected at the source for **any** source; arbitration recency means most-recently-**changed**, not most-recently-polled; `facingLatch` as event vs entity facing as state (§17.1.1); release clears intent without a phantom fire edge; frame codec round-trip. Touch maths added at M11 per §17.7. | M1, extended M11 |

Run: `node tests/winnability.mjs && node tests/determinism.mjs && node tests/timer.mjs && node tests/floors.mjs && node tests/loop.mjs && node tests/input.mjs`

#### **[v0.5]** 12.1.1 Determinism hash — exact contents

`hashGameState()` lives in `src/game/state.js` and the test imports it rather
than reimplementing it, so the two cannot drift. FNV-1a 32-bit over a canonical
numeric serialisation.

**Included** — omitting any of these could hide a divergence that changes what
happens in the game:

- RNG state, tick count, current phase
- PIP position, entity facing, lives, invulnerability timer
- Arrow: alive flag, position, direction, windup counter, **[v0.9]** spawn `id`
- Every monster: position, state, HP, dodge state, **[v0.9]** `dodgedArrowId`
- Every corpse: position, decay phase
- Floor timer
- Per-room looted flags
- Every WARDEN: position, route index, pursuit bias
- Score

**Excluded** — cosmetic, and including them would make the hash fail on render
timing rather than on logic:

- Render interpolation alpha, camera/zoom lerp progress
- Audio state
- Sprite frames, palettes, HUD strings, particle/flash effects

The test for inclusion: *if omitting this field could hide a divergence that
changes what happens in the game, it goes in.*

**[v0.9]** The two fields added above are why this list has to be maintained
rather than assumed: §4.4's once-per-arrow dodge is expressed entirely through
`arrow.id` and `monster.dodgedArrowId`, so omitting either would let two replays
diverge on whether a monster dodged while every other field matched.

#### **[v0.5]** 12.1.2 Input recorder — required at M1

`determinism.mjs` needs a recorded input stream, which needs a recorder. The
headless recorder/player ships in the input module's test surface at **M1**,
alongside `encodeInputFrame` / `decodeInputFrame` — not at M9 when the test is
finally written. It is trivial to add while the input model is being built and
awkward to retrofit afterwards.

It must be headless, DOM-free, and produce a stream that replays identically
regardless of which source recorded it (§17.1, §17.7).

### 12.2 Manual checklist

- [ ] Every room clearable treasure-only, zero kills (confirm the automated result by hand on `THE SUMP` and `THE PIT`)
- [ ] Floor timer does **not** reset on room exit — stopwatch across two rooms
- [ ] Floor timer does **not** move on death — die deliberately, confirm
- [ ] Treasure tile is provably unkillable — walk a monster into PIP
- [ ] Corpse in the sole doorway can trap and kill PIP (correct behavior)
- [ ] After that death, the room is re-enterable and re-lootable (no softlock)
- [ ] Shooting a corpse resets decay per `CORPSE_SHOT_MODE`
- [ ] Firing in the hall spawns a real arrow that passes through a WARDEN
- [ ] Exactly one arrow alive, ever
- [ ] 1-frame directional tap reorients PIP against a wall with no displacement
- [ ] WARDEN survives arrows, corpses, hazards, and geometry
- [ ] Looted rooms unenterable and visually distinct
- [ ] Identical behavior at 60 / 120 / 144 Hz; tab away 30 s and return with no time-skip burst
- [ ] Network tab: 1 document request, 0 others
- [ ] Greyscale screenshot: PIP distinguishable from all monsters
- [ ] No Exidy/Coleco names, art, or audio anywhere in `dist/` or repo metadata

### 12.3 **[v0.2]** Feel gate

Content work does not start until the vertical slice (M3) passes a Hudson playtest with these three questions answered yes:

1. Does dodging in the hall feel tense rather than fiddly?
2. Does a missed shot feel like *your* mistake rather than the controls'?
3. Do you want another go immediately after dying?

If any answer is no, tune §6 and re-gate. Do not build 12 rooms on top of bad movement.

---

## 13. **[v0.2]** REPO LAYOUT & BUILD

```
C:\Projects\vault-raider\
  SPEC.md              this document
  PROVENANCE.md        originality assertion
  build.py             inliner: src/ -> dist/index.html
  src/
    index.html         shell with <!--INLINE_CSS--> / <!--INLINE_JS--> markers
    styles.css
    core/   loop.js  rng.js  input.js  touchmath.js  audio.js
            sprites.js  gfx.js  persist.js
    game/   state.js  floor.js  room.js  entities.js  collision.js
            scoring.js  render.js
    data/   tuning.js  floors.js  rooms.js  sprites.data.js
    main.js
  tests/  winnability.mjs  determinism.mjs  timer.mjs  floors.mjs
          loop.mjs  input.mjs                        [v0.7] six test files
  dist/   index.html
```

**[v0.5] Three modules added.** This layout was written at v0.2, before §17
existed, and named no home for scene composition or persistence.

- `core/touchmath.js` — pure touch maths: sector snapping, hysteresis, deadzone,
  tap detection. **No DOM, no `window`.** §17.7 requires these be tested headless;
  that is unsatisfiable if they sit next to the pointer-event bindings, which is
  why this is a separate file rather than a section of `input.js`.
- `core/persist.js` — `localStorage` behind try/catch (§11) and input-source-tagged
  high scores (§17.8). One file means one place for the try/catch to be audited
  rather than a hunt through call sites.
- `game/render.js` — scene composition. **The split is explicit:** `core/gfx.js`
  owns primitives (canvas init, scaling, viewport, palette, blit);
  `game/render.js` owns composition (floor view, room view, HUD, transitions,
  touch overlay). Both are DOM-bound and **neither is imported by `tests/`**.

**[v0.5] The three build rules below are enforced by `build.py`, not by trust.**
The build fails on: any duplicate top-level identifier across the MANIFEST, any
`export default`, and any `import` naming a file outside the MANIFEST.

Build rules:

- ES modules, **named exports only**, no default exports, unique top-level identifiers across all files.
- `build.py` holds an explicit ordered `MANIFEST` of source files, strips `import`/`export` keywords, concatenates into one `<script type="module">`, inlines CSS, writes **[v0.3]** `dist/index.html`. The `index.html` name lets Netlify serve `dist/` with no root redirect, which matters under the proxy in §16.
- Dev server: `python -m http.server 8000` from `src/`, open `http://localhost:8000/`.
- Tests import the same ES modules directly under Node — no DOM, no shims. Any module used by tests must not touch `window` at import time.

Commands:

```powershell
cd C:\Projects\vault-raider
python -m http.server 8000        # dev, run from src\
python build.py                   # emit dist\index.html
node tests\winnability.mjs        # etc.
```

---

## 14. **[v0.2]** MILESTONES — reordered for an early feel gate

| # | Milestone | Validation |
|---|---|---|
| M1 | Loop (clamped accumulator, 5-substep cap), 320×240 scaling, seeded RNG, **[v0.4]** unified input model per §17.1 with latched facing | Debug rect at exactly 60 Hz on a 144 Hz display; tab-away 30 s causes no burst |
| M2 | Floor view: 40×30 mask, axis-separated collision, **[v0.8]** WARDENs per §4.3 (`countByLayout`, so 2 on floor 1), death on contact, **hall firing** | Loop the corridor, get killed, fire a useless arrow through a WARDEN |
| **M3** | **VERTICAL SLICE** — one room (`THE COIL`), zoom in/out, arrow + one-alive rule, `CRAWLER` + dodge, corpse decay/lethality/blocking, treasure + safe tile, floor timer + intrusion + siren | **FEEL GATE §12.3.** Full tension arc playable in one room |
| M4 | Room sealing, all 4 Floor-1 rooms, stairs unlock, floor descend | Loot floor 1, descend |
| M5 | Death handling: life loss, corpse clear, unlooted-room reset, timer untouched, respawn invuln | `tests/timer.mjs` green; deliberate softlock attempt fails to softlock |
| M6 | Remaining archetypes: `BOUNCER` `DROPPER` `STALKER` `BRUTE` `BLINKER` | Isolated test room per archetype |
| M7 | Floors 2–3 content + shaped rooms + trap-on-pickup | `tests/winnability.mjs` green on all 12 |
| M8 | Scoring, time-bonus formula, extra lives, HUD | Hand-reconcile a run against §6 |
| M9 | Audio (gesture-gated), accessibility options, `localStorage` | Manual §12.2 |
| M10 | Attract mode, intro walk, gamepad, floors 4–9 escalation + floor-9 loop | Cold start → game over, zero console output |
| **[v0.4]** M11 | Touch layer per §17: floating thumbstick, hysteresis, tap-to-reface, fire zone, layout, platform hygiene | §17.9 checklist on a real phone. The unified input model from §17.1 must already exist from M1 — M11 adds a source, never a second path |

---

## 15. STRETCH (post-1.0)

- 2-player alternating, per the original cabinet.
- Seeded floor-layout generator honoring archetype budgets → daily challenge.
- Replay verification (already free — determinism is a v1 requirement).
- **[v0.4]** Mobile moved OUT of stretch into §17 and milestone M11.
  The old note said "hitboxes +15%". That was wrong and would have shipped a
  softlock: 8 px × 1.15 = 9.2 px, wider than an 8 px tile, making every 1-tile
  doorway impassable. Never scale the collision hitbox for touch. Scale touch
  targets and add input assists instead.

---

## 16. **[v0.3]** DEPLOYMENT & PORTFOLIO INTEGRATION

Public URL: **`https://boblemieux.ai/games/vault-raider`**

Served by a Netlify proxy rewrite, not by vendoring the build into the portfolio.

### 16.1 Topology

```
roblem28/vault-raider  ──push──>  Netlify site "vault-raider"
                                  publish = dist/ , no build command
                                          │
                                          │  proxy rewrite (status 200)
                                          ▼
roblem28/boblemieux    ──────>  Netlify site boblemieuxai
                                  serves boblemieux.ai/games/vault-raider
```

Rationale: the game iterates constantly through M1–M10 and post-gate tuning. A
proxy means a push to `vault-raider` updates the public URL with **zero commits
to the portfolio repo**. Vendoring the artifact would turn every tuning pass
into a portfolio PR plus `npm run build` plus a preview review.

### 16.2 Constraints

- Both Netlify sites must belong to the **same Netlify team**. Netlify blocks
  rewrites between sites on different teams.
- The rewrite target must be the **`.netlify.app` subdomain**, not a custom
  domain. This is Netlify's own recommendation for site-to-site rewrites.
- `force = true` is required. Netlify will not shadow a path that resolves to a
  real file by default, and Next.js route emission is not worth guessing about.
- Proxying is server-side. This is **not** an iframe, so it does not interact
  with the `X-Frame-Options` header, and the game is not boxed inside the
  portfolio layout.
- The usual proxy failure mode — relative asset paths breaking under the proxied
  prefix — cannot occur here, because the build is one self-contained file with
  zero external requests. This is a direct payoff of the single-file constraint
  in §1.

### 16.3 `netlify.toml` — vault-raider repo

```toml
[build]
  publish = "dist"
  command = ""
```

No redirects needed. `dist/index.html` is served at the site root.

### 16.4 `netlify.toml` — portfolio repo (add to existing, or create)

```toml
[[redirects]]
  from = "/games/vault-raider"
  to = "https://vault-raider.netlify.app/index.html"
  status = 200
  force = true

[[redirects]]
  from = "/games/vault-raider/*"
  to = "https://vault-raider.netlify.app/:splat"
  status = 200
  force = true
```

### 16.5 Portfolio project card

- Links to `/games/vault-raider` (same-origin path, not the `netlify.app` URL).
- Secondary link to `https://github.com/roblem28/vault-raider`.
- Copy describes an original arcade dungeon crawler inspired by early-1980s
  coin-op games. **Never names the original game** — see §0.
- Must match the existing card pattern in the portfolio exactly. Discover it
  before writing; do not invent a new shape.

### 16.6 Validation

- [ ] `https://vault-raider.netlify.app/` loads the game directly
- [ ] `https://boblemieux.ai/games/vault-raider` loads the game with the address
      bar **still showing boblemieux.ai**
- [ ] Portfolio card renders in the Projects section and its link works
- [ ] Pushing a change to `vault-raider` updates the boblemieux.ai path with no
      portfolio deploy
- [ ] Network tab on the proxied URL: 1 document request, 0 others

---

## 17. **[v0.4]** MOBILE / TOUCH

Target: phone in **landscape**. Portrait shows a rotate prompt and pauses.

### 17.1 One input model — architectural requirement

Keyboard, gamepad, and touch all reduce to the same per-tick struct before any
game code sees them:

```js
// src/core/input.js — the ONLY thing game logic reads
{ dir: 0..7 | -1,   // 8-way sector, -1 = neutral. MOVEMENT intent only.
  fire: bool,       // edge-detected at the source, not level (§9)
  facingLatch: 0..7 | -1 }   // EVENT: a direction was expressed this tick
```

**This abstraction must exist in M1, before any touch code is written.** If touch
is bolted on as a second path later, `tests/determinism.mjs` breaks and replay
verification dies. Three sources, one struct, one consumer. Non-negotiable.

#### **[v0.5]** 17.1.1 `facingLatch` is an EVENT. Entity facing is STATE.

These are two different things and must be two different variables. Collapsing
them is a bug: if the struct's `facingLatch` *is* PIP's facing, then facing
resets to neutral the moment the player releases a key, and firing after release
shoots the wrong way — or nowhere.

| | Lives in | Lifetime | Neutral input |
|---|---|---|---|
| `facingLatch` | the per-tick input struct | **one tick** | `-1` |
| entity facing | PIP (game state) | **persistent** | unchanged |

**[v0.7] "Lifetime: one tick" means the struct is rebuilt each tick — NOT that
`facingLatch` goes neutral after one tick of a held direction.** The distinction
is easy to misread, so, explicitly:

| Tick | Keyboard | `dir` | `facingLatch` | entity facing |
|---|---|---|---|---|
| 1 | press E | 2 | 2 | 2 |
| 2 | hold E | 2 | **2** | 2 |
| 3 | hold E | 2 | **2** | 2 |
| 4 | release | -1 | **-1** | **2** |
| 5 | nothing | -1 | -1 | **2** |

`facingLatch` stays `2` for the whole hold — it tracks `dir` for keyboard and
gamepad. What is one-tick is the *struct*, which is discarded and rebuilt every
tick. Entity facing keeps `2` at ticks 4 and 5, which is the property that makes
firing after release aim correctly (§4.2).

Rules:

- `facingLatch` is `0..7` on a tick where a new direction was expressed, `-1`
  otherwise. It is not state and must never be read as PIP's current facing.
- Entity facing updates **only** when `facingLatch !== -1`. It **persists**
  across neutral input, pause, zoom transitions, and the full arrow windup.
- `dir` carries **movement** intent only. `facingLatch` carries **any**
  directional intent. Keyboard and gamepad set both on a held direction; touch
  tap-to-reface (§17.4) sets `facingLatch` alone with `dir = -1`.
- PIP's facing is read from entity facing, never from the struct. Arrow direction
  is entity facing **at the spawn tick** (§4.2).

This is what collapses §3.9 (latched facing) and §17.4 (tap-to-reface) into one
code path instead of two, which is the entire purpose of §17.1.

**Accepted asymmetry — do not "fix" it.** A keyboard tap emits `dir` *and*
`facingLatch` for one tick and therefore drifts ~1 px, exactly as §3.9 requires.
A touch tap emits `facingLatch` only and drifts 0 px, exactly as §17.4 requires.
Both satisfy turn-without-moving. §3.9 specifies the keyboard drift explicitly,
so unifying the two would violate it.

Consequence: a recorded input stream replays identically regardless of which
device produced it, and `tests/input.mjs` (§17.7) tests the touch maths headless
with no DOM.

### 17.2 Floating thumbstick — left zone

Fixed on-screen sticks fail because the thumb cannot find them without looking.
The stick spawns where the thumb lands.

- **Zone**: left 40% of the viewport, full height. Not a visible box.
- **Down**: base origin = touch point. Render base ring + knob at ~64 px
  diameter in *device* px (not logical px — it must be thumb-sized at any DPI).
- **Move**: `v = clamp(touch - origin, maxRadius = 40 device px)`.
- **Deadzone**: 12 device px. Below that, `dir = -1`.
- **Up / pointercancel**: `dir = -1`, stick fades out over 8 ticks.
- **Re-centre drift**: if `|v| > maxRadius`, drag the origin along so the knob
  stays under the thumb. Without this the stick "runs out" mid-corridor and the
  player thinks the game stopped responding.

### 17.3 8-way snapping with hysteresis — the part that decides if it's playable

The game is 8-direction. Raw analog angle must be quantised, and quantisation
without hysteresis is a death sentence: a thumb resting near a 45° boundary
flickers between two sectors every frame, PIP judders, and the player walks into
a corpse.

- Sectors are 45° wide, centred on the 8 compass directions.
- **Hysteresis band: 8°.** Once a sector is latched, the angle must travel 8°
  past the boundary before the sector changes. Latch survives across ticks.
- Re-latch immediately on a fresh touch-down; hysteresis applies only to a
  continuous drag.

### 17.4 Tap-to-reface

SPEC §3.9 requires that a 1-frame directional tap changes facing without moving.
Touch equivalent:

- Touch-down and release inside **10 ticks** with displacement **< deadzone** →
  emit `facingLatch` for the sector of the release vector, emit no `dir`.
- Displacement below deadzone but held longer → same, held.

Without this, mobile players lose the ability to turn and shoot on the spot,
which is a core defensive move in room combat.

### 17.5 Fire — right zone

- **Zone**: right 40% of the viewport, full height, entire area is the button.
  A small button is the wrong shape here; there is nothing to aim with the right
  thumb, so the whole zone should be live.
- A button glyph renders as affordance, but touching anywhere in the zone fires.
- **Armed-state feedback is mandatory.** SPEC §4.2 allows one arrow alive at a
  time, so the button is inert most of the time. Render it dimmed while an arrow
  is in flight and bright when a shot is available. Without this the player
  believes the game is dropping inputs.
- Fire is edge-triggered on pointer-down. Holding does not repeat.

### 17.6 Layout, occlusion, and platform hygiene

- **Multi-touch is required.** Track `pointerId` per zone. Move and fire must
  work simultaneously. A single-pointer implementation is a FAIL.
- **HUD never sits in the bottom corners** — thumbs cover them. Lives, score,
  and intrusion pips pin to the top edge.
- **Use the pillarboxes.** 320×240 is 4:3; a modern phone in landscape leaves
  wide bars either side. Place the control zones in that dead space so they do
  not occlude the play area. Only overlay the canvas when the aspect ratio
  leaves no room, and then at ≤35% opacity.
- `touch-action: none` on the canvas and control layer; `preventDefault` with
  `{ passive: false }`.
- Suppress double-tap zoom, pinch zoom, long-press context menu, and
  pull-to-refresh.
- Respect `env(safe-area-inset-*)` — no control under a notch or home indicator.
- Size with `100dvh`, not `100vh`. iOS Safari does not support the Fullscreen
  API on iPhone, so do not depend on it.
- Scaling: nearest-neighbour always (`imageSmoothingEnabled = false`), but allow
  a **fractional** scale factor on mobile. Integer-only scaling wastes too much
  of a phone screen.
- `pointercancel` and `visibilitychange` must both release all inputs. An
  incoming call that leaves `dir` latched will kill the player.
- Optional haptics via `navigator.vibrate` on death and treasure pickup, behind
  an options toggle. Android only; iOS Safari ignores it. Never required for
  information.

### 17.7 Testing

Add `tests/input.mjs`, headless, no DOM:

- Vector → sector mapping is correct at all 8 cardinal/ordinal angles.
- Hysteresis: a sweep across a sector boundary latches once, not repeatedly.
  Feed an angle oscillating ±4° around a boundary and assert zero sector changes.
- Deadzone: sub-threshold vectors yield `dir = -1`.
- Tap-to-reface: short low-displacement pointer sequence emits `facingLatch` and
  no `dir`.
- Same synthetic pointer stream → identical state hash as the equivalent
  keyboard stream. This is the proof that §17.1 holds.

### 17.8 Balance — do not tune the game for touch

Touch is harder than keyboard. The temptation is to slow monsters or extend the
floor timer on mobile. **Do not.** It makes scores incomparable and quietly
forks the game into two balance states that both then need testing.

Legitimate compensation is input assist that does not touch physics:
8-way hysteresis (§17.3), doorway snap-assist (§4.1), a full-zone fire target
(§17.5). All apply on every device, so there is one game.

Tag stored high scores with the input source (`kbd` / `pad` / `touch`) so the
board stays honest.

### 17.9 Validation

- [ ] Move and fire simultaneously with two thumbs
- [ ] Thumbstick spawns wherever the thumb lands, anywhere in the left zone
- [ ] Thumb resting on a diagonal boundary produces zero judder
- [ ] Quick tap turns PIP without moving him
- [ ] Fire zone visibly dims while an arrow is in flight
- [ ] PIP passes through every 1-tile doorway on floor 1 using touch only
- [ ] Controls sit in the pillarboxes, not over the play area, on a 19.5:9 phone
- [ ] Nothing under the notch or home indicator
- [ ] No zoom, no scroll, no pull-to-refresh, no context menu
- [ ] Backgrounding the tab mid-move releases the input
- [ ] Portrait shows the rotate prompt and pauses
- [ ] HUD fully visible with both thumbs down
- [ ] `tests/input.mjs` green
- [ ] A touch-recorded replay verifies identically to a keyboard replay

---

## APPENDIX A — ORIGINAL REFERENCE MAP (`SPEC-internal`)

> **[v0.6] Design cross-reference. Nominative use for derivation tracking.
> Never reproduce in shipped output or public-facing copy.**

Tier 2 under §0.1: this table may live in `SPEC.md` in a public repo, because it
documents derivation rather than identifying the product. It is Tier 1 material
the moment it appears in `dist/`, a README, or the portfolio card — strip it from
any public listing.

| Original | Ship name | Floor |
|---|---|---|
| Wall Room | `THE SLABS` | 1 |
| Serpent Room | `THE COIL` | 1 |
| Skeleton Room | `THE OSSUARY` | 1 |
| Goblin Room | `THE WARRENS` | 1 |
| Spider Room | `THE WEB` | 2 |
| Dragon Room | `THE FORGE` | 2 |
| Troll Room | `THE SUMP` | 2 |
| Two-Headed Room | `THE FORK` | 2 |
| Genie Room | `THE LAMP` | 3 |
| Demon Room | `THE PIT` | 3 |
| Cyclops Room | `THE EYE` | 3 |
| Bat Room | `THE ROOST` | 3 |

Original protagonist / hall stalker names are deliberately omitted from this table.
