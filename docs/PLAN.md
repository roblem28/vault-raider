# VAULT RAIDER — Implementation Plan (Phase 0)

Derived from `SPEC.md` v0.5 and `CLAUDE.md`. No implementation code exists yet.
`src/`, `tests/`, and `dist/` are present but empty.

**STATUS: approved 2026-07-30. All open items ruled.** Every decision in the
original §1 below is now written into `SPEC.md` as **v0.5** and marked `[v0.5]`,
so the spec — not this plan — is the authority that `fidelity-auditor` and
`softlock-hunter` audit against. `docs/NOTES.md` carries the reasoning and the
section-by-section amendment map. §1 is retained below as the historical record
of what was asked and what was decided; where it differs from SPEC v0.5, the
spec wins.

Rulings that changed or extended what I originally proposed:

- **Collision box and hurt box are separate concepts** (equal in size for PIP,
  8×8 for monsters and WARDENs). I had not raised this. SPEC §4.1.
- **Corpse blocking is tile-occupancy, lethality is AABB.** I had not raised
  this, and an AABB-only corpse would have quietly broken the §3.5 doorway seal.
  SPEC §3.5.
- **`facingLatch` is an event; entity facing is state.** My A4 was the right
  instinct but incomplete — it never said what happens on neutral input, which
  would have reset PIP's facing on key release. SPEC §17.1.1.
- **Fire is edge-detected at the source for all three inputs**, not just touch.
  SPEC §9.
- **The input recorder ships at M1**, not M9 with the test. SPEC §12.1.2.
- **`build.py` also fails on `export default` and off-MANIFEST imports**, not
  just duplicate identifiers. SPEC §13.

---

## 1. Conflicts and deviations — RESOLVED, retained as historical record

### 1.1 CONFLICT — `player.hitbox` (SPEC §6 vs SPEC §4.1)

SPEC contradicts itself. §6 `TUNING` still carries the v0.2 line:

```js
player: { speedRoom: 1.00, speedFloor: 1.10, hitbox: 8, ... }
```

§4.1 [v0.4] explicitly corrects this to a **6×6** room hitbox and states the 8×8
value is unplayable in a 1-tile doorway. CLAUDE.md agrees with 6.

Separately, one scalar cannot express the spec: §4.1's table gives PIP a **4×4**
hitbox in floor view and **6×6** in room view.

**My reading:** §4.1 is the later, explicitly-marked correction and it wins over
the §6 code block. I intend to replace the scalar with two values:

```js
player: { ..., hitboxFloor: 4, hitboxRoom: 6, ... }
```

and delete `hitbox`. Flagging rather than guessing, per instructions.

### 1.2 DEVIATION REQUEST — three files not in the §13 layout

§13's file list predates §17 (touch) and does not name a module for scene
drawing or persistence. I want to add exactly three:

| File | Why | SPEC |
|---|---|---|
| `src/core/touchmath.js` | §17.7 requires the touch maths be tested **headless with no DOM**. Sector snapping, hysteresis, deadzone, and tap detection must therefore live in a pure module with zero DOM contact. `core/input.js` keeps the DOM binding. | §17.2–17.4, §17.7 |
| `src/game/render.js` | `core/gfx.js` is canvas/viewport/blit primitives. Scene composition (floor view, room view, HUD, stick overlay) is game knowledge and does not belong in a core module. Merging them makes `gfx.js` the largest file in the project. | §2, §11, §17.6 |
| `src/core/persist.js` | localStorage behind try/catch (§11) and high-score tagging by input source (§17.8). Arrives at M9; listed now so all deviations are on one page. | §11, §17.8 |

If you'd rather hold the line on §13 exactly, say so and I'll fold `render.js`
into `gfx.js` and `touchmath.js` into `input.js` — but `touchmath.js` folding
costs the headless test in §17.7, so I recommend against that one specifically.

### 1.3 EXTENSION — constants §6 does not list

CLAUDE.md bans magic numbers in logic files, but §6's `TUNING` block is missing
values that §4, §8, and §17 specify in prose. I will add these to
`src/data/tuning.js` with the prose values verbatim, and log each in NOTES.md.
No invented numbers — every one is quoted from SPEC:

- `player.snapAssistWindowPx: 2`, `player.snapAssistStepPx: 1` (§4.1 doorway snap)
- `zoom.durationTicks: 24` (§8)
- `touch.knobDiameterDevicePx: 64`, `maxRadiusDevicePx: 40`, `deadzoneDevicePx: 12`,
  `fadeOutTicks: 8`, `hysteresisDeg: 8`, `sectorWidthDeg: 45`, `tapMaxTicks: 10`,
  `moveZoneFrac: 0.40`, `fireZoneFrac: 0.40`, `overlayMaxOpacity: 0.35` (§17.2–17.6)
- `a11y.maxLuminanceStepPerFrame: 0.10`, `maxFlashHz: 3` (§11)

### 1.4 AMBIGUITIES — my reading, logged in NOTES.md, raise at checkpoint

| # | Ambiguity | My reading |
|---|---|---|
| A1 | `scoring.treasureByFloor` has 3 entries but floors run to 9+ | Index by `layoutIndex`, matching how §6 indexes `floorTimerSec` and `speedMul`. Floor 4 scores as floor 1. |
| A2 | §4.3 "`+1` per full 3-floor cycle" — cycle boundaries unstated | `count = countByLayout[layoutIndex] + floor((floorNumber - 1) / 3)`. Floors 1–3 → +0, 4–6 → +1, 7–9 → +2. |
| A3 | §2 "Floor 10+ replays floor 9" — does speed keep rising? | No. Clamp `floorNumber` to 9 for layout, `floorSpeedMul`, warden count, and timer. §6's `floorSpeedMul` array has exactly 9 entries, which supports the clamp. |
| A4 | §17.1 struct has both `dir` and `facingLatch`; keyboard sets what? | **`facingLatch` = any directional intent; `dir` = movement intent only.** Keyboard/gamepad set both on a held direction. Touch tap-to-reface (§17.4) sets `facingLatch` alone. Game code reads facing from `facingLatch` exclusively — this is what makes §3.9 and §17.4 the same code path. |
| A5 | §12.1 `determinism.mjs` "final state hash" — over what? | FNV-1a 32-bit over a canonical numeric serialisation of the full game state, defined once in `hashGameState()` so the test cannot drift from the implementation. |

### 1.5 Non-blocking nits in CLAUDE.md

"The four mechanics that are always getting broken" lists six, and "All four
tests must pass" lists five commands (`input.mjs` included). Cosmetic; no action
unless you want the file edited.

---

## 2. Module list — exports, responsibility, SPEC section

Named exports only. No default exports. Every top-level identifier is unique
across all of `src/` (see §4).

### `src/data/tuning.js` — §1, §6
The only place constants live.
```
export const TUNING          // §6 block + §1.3 extensions above
export const DIRS            // 8 unit vectors, index 0..7 = N,NE,E,SE,S,SW,W,NW
export const DIR_NEUTRAL     // -1
export const GAME_PHASES     // §8 state machine names
export const ARCHETYPES      // §4.4 CRAWLER..BLINKER
export const TILE_CHARS      // '#' wall, '.' floor, etc. for §7.1/§7.2 masks
```

### `src/core/rng.js` — §1 (RNG), §12.1 (hashing)
Seeded xorshift32. The only randomness source in the project.
```
export function createRng(seed)        // -> { nextU32, nextFloat, nextInt, getState, setState, clone }
export function hashValues(seed, nums) // FNV-1a 32-bit, for state hashing
```

### `src/core/touchmath.js` — §17.2, §17.3, §17.4, §17.7
Pure. No DOM, no `window`. This is what `tests/input.mjs` imports.
```
export function createStickState()
export function stickDown(stick, x, y, tick)
export function stickMove(stick, x, y, tick)      // incl. re-centre drift §17.2
export function stickUp(stick, tick)              // -> tap-to-reface decision §17.4
export function vectorToSector(dx, dy)            // -> 0..7
export function applyHysteresis(prevSector, dx, dy) // §17.3, 8° band
export function stickSample(stick)                // -> { dir, facingLatch }
```

### `src/core/input.js` — §9, §17.1, §17.5, §17.6
**The only module game logic reads for input.** Three sources, one struct.
```
export function createInputHub()
export function setKeyboardKey(hub, code, isDown)   // pure; called by binding
export function pollGamepads(hub, navigatorRef)     // §9: polled in update, never event-driven
export function feedTouchPointer(hub, evtLike)      // routes to touchmath by zone/pointerId
export function sampleInput(hub, tick)              // -> { dir, fire, facingLatch }  §17.1
export function releaseAllInput(hub)                // pointercancel / visibilitychange §17.6
export function encodeInputFrame(sample)            // -> int, for replay/determinism
export function decodeInputFrame(int)
export function createInputRecorder()               // §12.1.2 — headless, ships at M1
export function recordInputFrame(rec, sample)
export function createInputPlayer(stream)           // replays a recorded stream
export function bindKeyboardInput(hub, target)      // DOM. Called only from main.js
export function bindTouchInput(hub, element)        // DOM. Called only from main.js
```
**`fire` is edge-detected at the source, inside `input.js`, before the struct is
built — for all three sources** (§9, §17.5). Keyboard auto-repeat must not
produce repeated fire events. Edge-detecting downstream would be a second input
path and would break §17.1.

**`facingLatch` is a one-tick EVENT, not state** (§17.1.1). PIP's persistent
entity facing lives in `entities.js` and updates only when `facingLatch !== -1`.
The struct is never read as PIP's current facing.

The recorder/player pair ships at **M1** alongside the encode/decode functions,
not at M9 when `determinism.mjs` is written (§12.1.2).

### `src/core/loop.js` — §1, §14 M1
Fixed 60 Hz accumulator, 5-substep cap, `maxFrameSec` clamp, interpolated render.
Clock and scheduler injected so it runs headless in tests.
```
export function createLoop(opts)   // { update, render, now, schedule }
export function advanceAccumulator(acc, frameSec)  // pure; the tab-away clamp lives here
```

### `src/data/floors.js` — §7.1
Three floor layouts: 40×30 masks, barriers, warden routes, room doors, stairs.
```
export const FLOOR_LAYOUTS   // length 3, schema §7.1
```

### `src/data/rooms.js` — §5, §7.2
Twelve room definitions, ship names only.
```
export const ROOM_DEFS       // keyed by room id, schema §7.2
export const ROOM_IDS_BY_FLOOR
```

### `src/data/sprites.data.js` — §7.3
Base64 2bpp sprite payloads, hand-authored.
```
export const SPRITE_DEFS
```

### `src/game/collision.js` — §3.5, §4.1, §4.5, §14 M2
Axis-separated resolution. Tile queries. Doorway snap-assist.
```
export function aabbOverlap(a, b)
export function tileAtPx(mask, px, py)
export function isSolidTile(ch)
export function isTileOccupiedByCorpse(room, tx, ty)  // §3.5 — PIP only
export function moveAxisSeparated(box, dx, dy, mask, blockers)
export function applyDoorwaySnap(box, dir, mask)   // §4.1, all input sources alike
```
**Collision box and hurt box are two separate queries** (§4.1). Movement tests
the collision box against tiles; damage tests the hurt box via `aabbOverlap`.
They are equal in size for PIP and must stay separately named.

**Corpse blocking is TILE-OCCUPANCY, lethality is AABB** (§3.5). Movement treats
a corpse's whole 8×8 tile as solid to PIP — same path as a wall tile, via
`isTileOccupiedByCorpse`, never via `aabbOverlap`. PIP's 6×6 box would otherwise
squeeze through the 2 px of slack in an 8 px doorway and delete the seal.

### `src/game/scoring.js` — §6
```
export function createScoreState()
export function awardMonsterKill(score, archetype)
export function awardTreasure(score, layoutIndex)
export function computeFloorClearBonus(remainSec, floorTimerSec)  // §6 formula, verbatim
export function checkExtraLife(score)
```

### `src/game/entities.js` — §4.2, §4.4, §4.5, §3.5–3.8, §3.10–3.11
PIP, arrow, six monster archetypes, corpses, hazards.
```
export function createPlayer(x, y)
export function updatePlayer(player, input, ctx)     // §17.1.1, see below
export function fireArrow(room, player)              // windupTicks §4.2
export function updateArrow(room, ctx)               // one alive, ever §3.8
export function spawnMonster(room, def, rng)
export function updateMonsters(room, ctx)
export function monsterDodgeCheck(monster, arrow, rng)  // diagonal ×0.5 §3.10, §4.4
export function createCorpse(x, y, tick)
export function updateCorpses(room, ctx)             // decayPhases §4.5
export function shootCorpse(room, corpse)            // CORPSE_SHOT_MODE §3.6
export function updateHazards(room, ctx)
```
**PIP's `facing` is persistent entity STATE and lives here** (§17.1.1), not in
the input struct. `updatePlayer` writes it only when `input.facingLatch !== -1`;
it persists across neutral input, pause, zoom, and the arrow windup. `fireArrow`
reads `player.facing` **at the spawn tick** — not at the fire-input tick, not
from the struct — which is what makes §4.2's re-aim-during-windup work.

### `src/game/room.js` — §2, §3.3, §3.7, §3.12, §5
```
export function createRoomRuntime(roomDef, layoutIndex, rng)
export function enterRoom(state, roomId, doorSide)
export function updateRoom(state, input)
export function exitRoom(state, door)
export function pickupTreasure(state)                // triggers spawnOnPickup §3.12
export function sealRoom(state, roomId)              // permanent §2.4
export function spawnIntrusionWarden(state)          // §3.3
export function resetUnlootedRoom(state, roomId)     // §4.1 death handling
```

### `src/game/floor.js` — §2, §4.3, §3.1–3.2, §3.4
```
export function floorDescriptorFor(floorNumber)      // layout/speed/warden count; A2, A3
export function createFloorRuntime(descriptor, rng)
export function updateFloor(state, input)
export function tickFloorTimer(state)                // §3.4 — called from updateGame, every phase
export function updateWardens(state, ctx)            // pursuit bias §4.3; pathing stays bad
export function checkDoorEntry(state)
export function isStairsUnlocked(state)
```

### `src/game/state.js` — §8, §4.1 (death), §12.1
Root state, phase machine, the single update entry point, the state hash.
```
export function createGameState(seed)
export function updateGame(state, input)             // tickFloorTimer FIRST, then phase dispatch
export function transitionPhase(state, phase)
export function applyPlayerDeath(state)              // §4.1 — the M5 critical path
export function startFloor(state, floorNumber)       // the ONLY place the floor timer resets
export function hashGameState(state)                 // A5
```

### `src/core/sprites.js` — §7.3
```
export function decodeSpriteBitmap(def)   // pure, base64 -> Uint8Array indices
export function buildSpriteAtlas(defs)    // needs canvas; behind init
export function getSprite(atlas, name)
export function swapPalette(atlas, name, pal)
```

### `src/core/gfx.js` — §1, §17.6
Canvas, integer scaling on desktop, fractional on mobile, pillar/letterbox.
```
export function initGfx(canvas)
export function computeViewport(cssW, cssH, allowFractional)  // pure, testable
export function resizeGfx(gfx)
export function gfxBeginFrame(gfx)
export function gfxFillRect(gfx, x, y, w, h, color)
export function gfxDrawSprite(gfx, sprite, x, y)
export function gfxEndFrame(gfx)
```

### `src/core/audio.js` — §10
```
export function createAudio()
export function initAudioOnGesture(audio)   // §10 — lazy AudioContext, never at load
export function playCue(audio, cue)
export function setThemeTempo(audio, speedMul)
export function setMasterVolume(audio, v)
export function muteAudio(audio, on)
```

### `src/core/persist.js` — §11, §17.8
```
export function loadPersisted()             // try/catch; Safari private mode throws
export function savePersisted(data)
export function recordHighScore(score, inputSource)   // 'kbd' | 'pad' | 'touch' §17.8
```

### `src/game/render.js` — §2, §11, §17.6
```
export function renderFrame(gfx, state, alpha)
export function renderFloorView(gfx, state, alpha)
export function renderRoomView(gfx, state, alpha)
export function renderHud(gfx, state)       // top edge only §17.6
export function renderTouchOverlay(gfx, state)
export function renderZoom(gfx, state, alpha)
```

### `src/main.js` — wiring only, no game logic
```
export function bootVaultRaider()
```

### `src/index.html`, `src/styles.css` — §13, §9, §17.6
Shell with `<!--INLINE_CSS-->` / `<!--INLINE_JS-->` markers. Viewport meta,
`touch-action: none`, `100dvh`, `env(safe-area-inset-*)`.

### `build.py` — §13
Ordered MANIFEST, strips `import`/`export`, inlines CSS+JS, writes
`dist/index.html`. **Adds a guard**: fails the build on any duplicate top-level
identifier across the MANIFEST, so §4's rule is enforced rather than trusted.

---

## 3. Data flow

```
        keyboard events ─┐
        gamepad poll ────┼──> core/input.js hub ──> sampleInput(hub, tick)
        pointer events ──┘         (touchmath.js for the touch source only)
                                            │
                                            ▼
                          { dir: 0..7|-1, fire: bool, facingLatch: 0..7|-1 }
                                            │   ← the ONLY thing game logic sees (§17.1)
                                            ▼
   core/loop.js ── update(tick) ──> game/state.js  updateGame(state, input)
                                            │
                                            ├─ 1. tickFloorTimer(state)   ← EVERY phase.
                                            │     Floor view, room view, zoom, death.
                                            │     Resets only in startFloor(). (§3.4)
                                            │
                                            └─ 2. phase dispatch (§8)
                                                  FLOOR_VIEW  -> game/floor.js updateFloor
                                                  ROOM_VIEW   -> game/room.js  updateRoom
                                                                   -> entities.js
                                                                   -> collision.js
                                                                   -> scoring.js
                                                  ZOOM_IN/OUT -> non-interactive lerp
                                                  DEATH       -> applyPlayerDeath
                                            │
   core/loop.js ── render(alpha) ──> game/render.js ──> core/gfx.js ──> canvas
                                            └────────> core/audio.js (cues)
```

Two invariants this shape exists to protect:

1. **`tickFloorTimer` is called before phase dispatch, unconditionally.** There
   is no code path in which the timer is skipped, paused, or reset outside
   `startFloor()`. That is §3.4 and it is structural, not a convention.
2. **`applyPlayerDeath` is one function in one file.** Corpse clear, unlooted
   reset, looted preservation, and "do not touch the timer" all live together
   so `softlock-hunter` has a single thing to audit (§4.1, CLAUDE.md #3).

Dependency direction is strictly one-way — `data → core primitives → game →
render → main`. No game module imports `render.js`, `audio.js`, or `gfx.js`.
That is what keeps every test-imported module DOM-free.

---

## 4. Build invariants

`build.py` concatenates into a single module scope, so:

- **Unique top-level identifiers everywhere.** Convention: exported names carry
  a module-distinctive stem (`gfxFillRect`, `stickDown`, `rngNextFloat`).
  Internal helpers get the same treatment — no bare `clamp` in two files.
- **`build.py` fails the build on all three CLAUDE.md rules** (§13), which were
  previously enforced by trust alone: any duplicate top-level identifier across
  the MANIFEST, any `export default`, and any `import` naming a file outside the
  MANIFEST.
- **No top-level execution that reads another file's binding.** Data files
  declare literals; every cross-module reference happens inside a function body.
  This makes MANIFEST order a convenience, not a TDZ landmine.
- **MANIFEST order:**
  `tuning → rng → touchmath → input → loop → sprites.data → floors → rooms →
   collision → scoring → entities → room → floor → state → sprites → gfx →
   audio → persist → render → main`

---

## 5. Tests → modules (§12.1, §17.7)

| Test | Imports | Asserts | Arrives |
|---|---|---|---|
| `tests/winnability.mjs` | `data/rooms.js`, `data/tuning.js` | BFS door→treasure→door on all 12 tilemaps, monsters ignored (§3.13) | M3 (1 room), full at M7 |
| `tests/determinism.mjs` | `game/state.js`, `core/input.js`, `core/rng.js` | Same seed + recorded input stream → identical `hashGameState` twice. Greps `src/` for `Math.random`. | M3 |
| `tests/timer.mjs` | `game/state.js`, `game/floor.js` | Floor timer monotonic across enter/exit/enter; unchanged by death; unchanged by zoom | M3, hardened at M5 |
| `tests/floors.mjs` | `data/floors.js` | Spawn reaches 4 doors + stairs on corridor mask; every waypoint on a floor tile | M3 |
| `tests/input.mjs` | `core/touchmath.js`, `core/input.js` | 8 sector angles, hysteresis sweep = zero changes, deadzone, tap-to-reface, **touch stream hash == keyboard stream hash** (§17.7) | M11 |

Every module in the import column is DOM-free at import time by construction
(§3 dependency direction).

---

## 6. Milestone → modules (§14)

| M | Modules first written | Modules extended |
|---|---|---|
| M1 | `tuning`, `rng`, `input` (incl. recorder/player, §12.1.2), `touchmath`(pure core), `loop`, `gfx`, `main`, `index.html`, `styles.css`, `build.py` | — |
| M2 | `floors`(layout 0), `collision`, `floor`, `state`, `entities`(player, arrow, warden), `render` | `input` (hall fire) |
| M3 | `rooms`(THE COIL), `room`, `scoring`(partial), `sprites`, `sprites.data` | `entities` (CRAWLER, corpse, treasure), `floor` (timer, intrusion), `audio` (siren) |
| M4 | — | `rooms` (4× floor 1), `room` (sealing), `floor` (stairs, descend) |
| M5 | — | `state` (`applyPlayerDeath`), `room` (`resetUnlootedRoom`) |
| M6 | — | `entities` (BOUNCER, DROPPER, STALKER, BRUTE, BLINKER) |
| M7 | — | `rooms` (all 12), `floors` (layouts 1–2), shaped rooms, trap-on-pickup |
| M8 | — | `scoring`, `render` (HUD) |
| M11 | — | `input` (`bindTouchInput`), `touchmath` (full), `render` (overlay), `styles.css` |
| M9 | `persist` | `audio` (full), `a11y` options, `render` (reducedFlash, hatched corpses) |
| M10 | — | `state` (ATTRACT, INTRO_WALK), `input` (gamepad), `floor` (floors 4–9) |

M11 sits before M9 deliberately, per your Phase 2b instruction, so the
accessibility pass covers the touch layer.

---

## 7. What I do not build

No npm, no package.json, no bundler, no framework, no dependencies. No
`Math.random`. No grid other than 8 px / 40×30. No features, refactors, or
polish beyond the milestone in flight. The strings `Venture`, `Winky`, and
`Hallmonster` appear nowhere in `src/`, `dist/`, or repo metadata — Appendix A
stays in `SPEC.md` and is never copied into a README, card, or commit message.
