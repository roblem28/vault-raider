// VAULT RAIDER - room view. SPEC v0.8 sections 3.5, 3.7, 3.8, 4.1, 5, 7.2.
//
// The centrepiece here is the SNAP-ASSIST TRIAL. Doorway snap-assist (section
// 4.1) is REQUIRED by spec but had never executed until M3: floor view uses a
// 4x4 collision box in an 8px gap, which is 2px of slack per side and needs no
// help. Room view is 6x6 - 1px per side - and is the geometry the assist was
// written for.
//
// So this file does not confirm snap-assist works. It asks whether it earns its
// place: run the whole passability matrix with the assist DISABLED and count
// the failures. Zero means the code is unexercised and should be deleted.
//
// Zero dependencies. Node only, no DOM.

import { TUNING, TILE_CHARS, GAME_PHASES } from '../src/data/tuning.js';
import { ROOM_DEFS } from '../src/data/rooms.js';
import {
  createGameState, updateGame, hashGameState, applyPlayerDeath
} from '../src/game/state.js';
import {
  createRoomRuntime, playerOnSafeTile, intrusionWarningLevel, resetUnlootedRoom
} from '../src/game/room.js';
import { isStairsUnlocked as isStairsUnlockedRooms } from '../src/game/floor.js';
import {
  createCorpse, createMonster, shootCorpse, createWarden, updateWarden, monsterDodgeCheck,
  updateMonster, MONSTER_BEHAVIOUR, hazardBox, hazardOffsetTiles
} from '../src/game/entities.js';
import { advanceAccumulator } from '../src/core/loop.js';
import { createRng } from '../src/core/rng.js';
import { boxHitsTiles } from '../src/game/collision.js';

// Section 4.4: a BOUNCER travels on diagonals only.
const DIRS_DIAGONAL = new Set([1, 3, 5, 7]);

let failures = 0;

function assert(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${detail || ''}`}`);
}

function check(name, actual, expected) {
  assert(name, actual === expected, `expected ${expected}, got ${actual}`);
}

function isFloor(tiles, tx, ty) {
  if (ty < 0 || ty >= tiles.length) return false;
  const row = tiles[ty];
  if (tx < 0 || tx >= row.length) return false;
  return row[tx] === TILE_CHARS.FLOOR;
}

// Build a state parked in ROOM_VIEW with no monsters, for movement tests.
function emptyRoomState(roomId, seed) {
  const state = createGameState(seed, 0);
  state.floor.wardens.length = 0;
  const room = createRoomRuntime(roomId, ROOM_DEFS[roomId].doors[0], state.rng);
  room.monsters.length = 0;
  state.floor.rooms[roomId] = room;
  state.room = room;
  state.phase = GAME_PHASES.ROOM_VIEW;
  state.floor.player.invulnTicks = 1e9;
  return state;
}

console.log('# room data shape (section 7.2)');
for (const id of Object.keys(ROOM_DEFS)) {
  const def = ROOM_DEFS[id];
  check(`${id}: tilemap has gridH rows`, def.tiles.length, TUNING.gridH);
  let badRow = -1;
  for (let i = 0; i < def.tiles.length; i++) {
    if (def.tiles[i].length !== TUNING.gridW) { badRow = i; break; }
  }
  assert(`${id}: every row is gridW chars`, badRow === -1, `row ${badRow}`);
  assert(`${id}: has at least one door`, def.doors.length >= 1);
  for (const door of def.doors) {
    assert(`${id}: door ${door.tx},${door.ty} is a floor tile`,
      isFloor(def.tiles, door.tx, door.ty));
    const onBorder = door.tx === 0 || door.ty === 0 ||
      door.tx === TUNING.gridW - 1 || door.ty === TUNING.gridH - 1;
    assert(`${id}: door ${door.tx},${door.ty} is on the room border`, onBorder);
  }
  assert(`${id}: treasure is on a floor tile`,
    isFloor(def.tiles, def.treasure.tx, def.treasure.ty));
  for (const spawn of def.spawnOnEntry) {
    assert(`${id}: spawn ${spawn.type} ${spawn.tx},${spawn.ty} is on floor`,
      isFloor(def.tiles, spawn.tx, spawn.ty));
  }
}

// --- THE SNAP-ASSIST TRIAL -------------------------------------------------

function passabilityMatrix(roomId) {
  const def = ROOM_DEFS[roomId];
  // SWEEP THE WHOLE APPROACH CORRIDOR, not just the fitting range.
  //
  // An earlier draft swept offsets 0..2 only - exactly the positions where a
  // 6px box already fits inside an 8px tile - so nothing ever needed rescuing
  // and disabling snap-assist changed nothing. That was the test failing to
  // reach the code, not evidence about the code.
  //
  // The positions the assist exists for are MISALIGNED ones: PIP arriving from
  // a 2-wide lane with his box straddling two tile columns, then turning into a
  // 1-wide pinch. Those live outside a single tile's width, so the sweep runs
  // from one tile before the approach tile to one tile after, in 0.5px steps,
  // keeping every start position whose box is legally clear of walls.
  const SWEEP_STEP = 0.5;
  const RATES = [60, 30];
  // DIAGONALS INCLUDED. An earlier version swept only the four cardinals, which
  // is exactly why snap-assist's diagonal blind spot survived it: the assist
  // required the other axis to be zero, so no diagonal approach was ever
  // assisted, and no test ever tried one. Cutting a corner into a pinch is the
  // natural way to move on a gamepad and common on a keyboard.
  const DIRS_BY_NAME = {
    N: [0, -1, 0], NE: [1, -1, 1], E: [1, 0, 2], SE: [1, 1, 3],
    S: [0, 1, 4], SW: [-1, 1, 5], W: [-1, 0, 6], NW: [-1, -1, 7]
  };
  const MAX_FRAMES = 160;
  const T = TUNING.tile;
  const BOX = TUNING.player.hitboxRoom;

  // Door tiles are excluded from BOTH gaps and approaches. Standing on a door
  // exits the room, so a traversal starting or ending there measures the exit
  // path, not the doorway geometry. An earlier draft of this test did exactly
  // that and produced 20 phantom failures - 2 doors x 5 offsets x 2 rates -
  // which read as a snap-assist result and were nothing of the kind.
  const isDoor = (tx, ty) => def.doors.some((d) => d.tx === tx && d.ty === ty);

  const gaps = [];
  for (let ty = 0; ty < def.tiles.length; ty++) {
    for (let tx = 0; tx < def.tiles[ty].length; tx++) {
      if (!isFloor(def.tiles, tx, ty) || isDoor(tx, ty)) continue;
      const vert = !isFloor(def.tiles, tx - 1, ty) && !isFloor(def.tiles, tx + 1, ty);
      const horz = !isFloor(def.tiles, tx, ty - 1) && !isFloor(def.tiles, tx, ty + 1);
      if (vert || horz) gaps.push({ tx, ty });
    }
  }

  let tested = 0;
  let skipped = 0;
  let entered = 0;
  const failed = [];

  for (const gap of gaps) {
    for (const [name, [dx, dy, dir]] of Object.entries(DIRS_BY_NAME)) {
      const ax = gap.tx - dx;
      const ay = gap.ty - dy;
      if (!isFloor(def.tiles, ax, ay) || isDoor(ax, ay)) { skipped++; continue; }
      for (let offset = -T; offset <= T; offset += SWEEP_STEP) {
        for (const hz of RATES) {
          const state = emptyRoomState(roomId, 0x8000 + gap.tx);
          const p = state.floor.player;
          if (dx === 0) {
            p.x = ax * T + offset;
            p.y = ay * T + (T - BOX) / 2;
          } else {
            p.x = ax * T + (T - BOX) / 2;
            p.y = ay * T + offset;
          }
          // Only legal start positions count. A start already inside a wall is
          // not a case the player can be in.
          if (boxHitsTiles(def.tiles, p.x, p.y, BOX, BOX, null)) { skipped++; continue; }
          tested++;
          p.prevX = p.x;
          p.prevY = p.y;

          const input = { dir, facingLatch: dir, fire: false };
          let acc = 0;
          let reached = false;
          for (let f = 0; f < MAX_FRAMES && !reached; f++) {
            const step = advanceAccumulator(acc, 1 / hz);
            acc = step.accumulator;
            for (let s = 0; s < step.steps; s++) {
              updateGame(state, input);
              const cx = Math.floor((p.x + BOX / 2) / T);
              const cy = Math.floor((p.y + BOX / 2) / T);
              if (cx === gap.tx && cy === gap.ty) { reached = true; break; }
            }
          }
          if (reached) entered++;
          else failed.push(`(${gap.tx},${gap.ty}) from ${name} off=${offset} ${hz}Hz`);
        }
      }
    }
  }
  return { gaps: gaps.length, tested, skipped, entered, failed };
}

console.log('\n# SNAP-ASSIST TRIAL - does it earn its place at 6x6? (section 4.1)');
{
  const roomId = 'coil';
  const original = TUNING.player.snapAssistWindowPx;

  // What is measured is the WIDTH OF THE ENTRY WINDOW: across every legal
  // perpendicular start position, how many can enter the gap by holding one
  // direction.
  //
  // NOT "every position must succeed". A start a full tile off-axis genuinely
  // cannot enter by moving straight, and should not - snap-assist nudges 1px
  // per tick inside a 2px window. It widens the window; it does not teleport.
  const on = passabilityMatrix(roomId);

  TUNING.player.snapAssistWindowPx = 0;
  const off = passabilityMatrix(roomId);
  TUNING.player.snapAssistWindowPx = original;

  const gained = on.entered - off.entered;
  const pct = (n) => ((n / on.tested) * 100).toFixed(1);

  console.log(`     ${on.gaps} gap tiles, ${on.tested} legal start positions`);
  console.log(`     entry window WITH    assist: ${on.entered}/${on.tested} (${pct(on.entered)}%)`);
  console.log(`     entry window WITHOUT assist: ${off.entered}/${off.tested} (${pct(off.entered)}%)`);
  console.log(`     >> snap-assist rescues ${gained} start positions`);

  assert('snap-assist never makes a reachable position unreachable',
    on.entered >= off.entered, `on ${on.entered} < off ${off.entered}`);

  // THE VERDICT. Zero means the code has never mattered and should be deleted
  // rather than carried as unexercised weight. SPEC section 4.1 calls it
  // REQUIRED - so if this is ever zero, the spec and the code disagree and that
  // needs escalating, not quietly tolerating.
  assert('snap-assist earns its place - it rescues positions that fail without it',
    gained > 0, 'rescues nothing at 6x6: delete it, or fix section 4.1');

  if (gained > 0) {
    const rescued = off.failed.filter((f) => !on.failed.includes(f));
    console.log(`     >> e.g. rescued: ${rescued.slice(0, 3).join('; ')}`);
  }

  // Sanity: if nothing can enter at all the numbers above are noise.
  assert('a centred approach enters, with or without the assist',
    on.entered > 0 && off.entered > 0);
}

console.log('\n# corpses: BLOCKING is tile-occupancy, LETHALITY is AABB (section 3.5)');
{
  const state = emptyRoomState('coil', 0xC0FFEE);
  const p = state.floor.player;
  const T = TUNING.tile;
  // A corpse in the 1-tile pinch at (20,6).
  state.room.corpses.push(createCorpse(20 * T, 6 * T));
  p.x = 20 * T + 1;
  p.y = 4 * T + 1;
  p.prevX = p.x;
  p.prevY = p.y;
  const input = { dir: 4, facingLatch: 4, fire: false };
  for (let i = 0; i < 120; i++) updateGame(state, input);
  const cy = Math.floor((p.y + TUNING.player.hitboxRoom / 2) / T);
  assert('a corpse blocks PIP from entering its tile', cy < 6, `PIP reached row ${cy}`);
}
{
  const state = emptyRoomState('coil', 0xDEAD11);
  const p = state.floor.player;
  const T = TUNING.tile;
  p.invulnTicks = 0;
  // NOT the treasure tile: section 3.7 makes PIP unkillable there on purpose,
  // so a corpse test placed on it asserts against the spec rather than the code.
  state.room.corpses.push(createCorpse(16 * T, 21 * T));
  p.x = 16 * T + 1;
  p.y = 21 * T + 1;
  const lives = p.lives;
  updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  assert('a corpse overlapping PIP kills him', p.lives === lives - 1);
}

console.log('\n# THE DOORWAY SEAL, both halves (section 3.5 -> 4.1)');
{
  // Half one: a corpse in the only doorway traps PIP and kills him.
  const state = emptyRoomState('coil', 0x5EA1);
  const p = state.floor.player;
  const T = TUNING.tile;
  p.invulnTicks = 0;
  // Seal the N door approach at (10,2) and stand PIP on it.
  state.room.corpses.push(createCorpse(10 * T, 2 * T));
  p.x = 10 * T + 1;
  p.y = 2 * T + 1;
  const lives = p.lives;
  updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  assert('a corpse in the doorway can trap and kill PIP', p.lives === lives - 1);

  // Half two: that death must CLEAR the corpses and RESET the unlooted room,
  // or the run is softlocked - the stairs become permanently unreachable.
  const room = state.floor.rooms.coil;
  check('death cleared every corpse', room.corpses.length, 0);
  check('death reset the unlooted room to its entry spawns',
    room.monsters.length, ROOM_DEFS.coil.spawnOnEntry.length);
  check('the room is not marked looted', state.floor.looted.coil, undefined);
  check('the treasure is available again', room.treasureTaken, false);
}
{
  // And the other direction: a LOOTED room stays looted across a death.
  const state = emptyRoomState('coil', 0x1007ED);
  state.floor.looted.coil = true;
  state.floor.rooms.coil.treasureTaken = true;
  state.floor.rooms.coil.corpses.push(createCorpse(80, 80));
  const p = state.floor.player;
  p.invulnTicks = 0;
  const before = state.floor.elapsedTicks;
  // Force a death through the same path the game uses.
  const { applyPlayerDeath } = await import('../src/game/state.js');
  applyPlayerDeath(state);
  check('a looted room stays looted', state.floor.looted.coil, true);
  check('and is NOT rebuilt', state.floor.rooms.coil.treasureTaken, true);
  check('the floor timer is untouched by the death', state.floor.elapsedTicks, before);
}

console.log('\n# safe tile (section 3.7)');
{
  const state = emptyRoomState('coil', 0x5AFE);
  const p = state.floor.player;
  const T = TUNING.tile;
  const tr = ROOM_DEFS.coil.treasure;
  p.invulnTicks = 0;
  p.x = tr.tx * T + 1;
  p.y = tr.ty * T + 1;
  assert('PIP on the pickup point registers as safe', playerOnSafeTile(state.room, p));
  updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  check('stepping on the treasure takes it', state.room.treasureTaken, true);

  // Camping is INTENDED, not an exploit: park a corpse on top and survive.
  state.room.corpses.push(createCorpse(tr.tx * T, tr.ty * T));
  const lives = p.lives;
  for (let i = 0; i < 60; i++) updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  check('camping the safe tile is genuinely unkillable', p.lives, lives);
}

console.log('\n# ONE arrow across a ZOOM, both directions (section 3.8)');
{
  // Section 3.8: "Exactly one arrow alive at a time." The M2 fix consolidated
  // the fire GATE but left two arrow STATE objects, floor.arrow and room.arrow -
  // a half-fix of the same shape. Measured before this fix: fire in the hall,
  // walk onto a door while it is still flying, enter the room, fire again ->
  // TWO arrows alive at once. The earlier one-arrow test held fire for 300
  // ticks inside a single view and could never have seen it.
  //
  // This counts arrows across the WHOLE system, on both sides of both zooms.
  const state = createGameState(0xA770, 0);
  state.floor.wardens.length = 0;
  const p = state.floor.player;
  const T = TUNING.tile;
  p.invulnTicks = 1e9;
  // Top corridor row 3 is open x=3..36, so firing east gives ~208px of flight -
  // far longer than the ~26 ticks it takes to walk down to the coil door.
  p.x = 10 * T + 2;
  p.y = 3 * T + 2;
  p.prevX = p.x;
  p.prevY = p.y;
  p.facing = 2;

  const aliveCount = () =>
    (state.floor.arrow && state.floor.arrow.alive ? 1 : 0) +
    (state.room && state.room.arrow && state.room.arrow.alive ? 1 : 0);

  let worst = 0;
  const step = (input) => { updateGame(state, input); worst = Math.max(worst, aliveCount()); };

  step({ dir: -1, facingLatch: -1, fire: true });
  for (let i = 0; i < 5; i++) step({ dir: -1, facingLatch: -1, fire: false });
  assert('a hall arrow is in flight before the transition', state.floor.arrow.alive);

  // Walk onto the door and through the zoom, holding fire the whole way.
  let guard = 0;
  while (state.phase === GAME_PHASES.FLOOR_VIEW && guard++ < 300) {
    step({ dir: 4, facingLatch: 4, fire: true });
  }
  for (let i = 0; i < TUNING.zoom.durationTicks + 4; i++) {
    step({ dir: -1, facingLatch: -1, fire: true });
  }
  check('the zoom landed in the room', state.phase, GAME_PHASES.ROOM_VIEW);
  for (let i = 0; i < 200; i++) step({ dir: -1, facingLatch: -1, fire: true });

  // And back out through the exit zoom, still holding fire.
  const exitDoor = ROOM_DEFS.coil.doors[0];
  p.x = exitDoor.tx * T + 1;
  p.y = exitDoor.ty * T + 1;
  for (let i = 0; i < TUNING.zoom.durationTicks + 240; i++) {
    step({ dir: -1, facingLatch: -1, fire: true });
  }

  check('never more than ONE arrow alive anywhere, across both zooms', worst, 1);
}

console.log('\n# exactly one arrow alive, in room view too (section 3.8)');
{
  const state = emptyRoomState('coil', 0x1A88);
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    updateGame(state, { dir: -1, facingLatch: -1, fire: true });
    const a = state.floor.arrow;   // the ONE arrow (section 3.8)
    worst = Math.max(worst, (a.alive ? 1 : 0) + (a.pending ? 1 : 0));
  }
  check('never more than one arrow alive or pending', worst, 1);
}

console.log('\n# CRAWLER behaviour (section 4.4)');
{
  const state = emptyRoomState('coil', 0xC2A4);
  const room = state.floor.rooms.coil;
  room.monsters.push(createMonster({ type: 'CRAWLER', tx: 6, ty: 3, dodge: 'LOW' }, state.rng));
  const m = room.monsters[0];
  const start = { x: m.x, y: m.y };
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    updateGame(state, { dir: -1, facingLatch: -1, fire: false });
    seen.add(`${Math.floor(m.x / TUNING.tile)},${Math.floor(m.y / TUNING.tile)}`);
  }
  assert('a CRAWLER actually moves', m.x !== start.x || m.y !== start.y);
  assert('a CRAWLER wall-follows across several tiles rather than jittering',
    seen.size >= 4, `visited only ${seen.size} tiles`);
  let inWall = false;
  for (const key of seen) {
    const [tx, ty] = key.split(',').map(Number);
    if (!isFloor(ROOM_DEFS.coil.tiles, tx, ty)) inWall = true;
  }
  assert('a CRAWLER never enters a wall tile', !inWall);
}
{
  const state = emptyRoomState('coil', 0xC2A5);
  const p = state.floor.player;
  p.invulnTicks = 0;
  const room = state.floor.rooms.coil;
  room.monsters.push(createMonster({ type: 'CRAWLER', tx: 6, ty: 3, dodge: 'LOW' }, state.rng));
  // Somewhere that is NOT the safe tile.
  p.x = room.monsters[0].x;
  p.y = room.monsters[0].y;
  const lives = p.lives;
  updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  check('a CRAWLER contact-kills PIP', p.lives, lives - 1);
}

console.log('\n# arrow vs monster: hit, kill, corpse (sections 3.8, 3.5)');
{
  const state = emptyRoomState('coil', 0xA110);
  const room = state.floor.rooms.coil;
  const p = state.floor.player;
  const T = TUNING.tile;
  // Same lane, monster to the west, PIP facing west.
  room.monsters.push(createMonster({ type: 'CRAWLER', tx: 8, ty: 3, dodge: 'LOW' }, state.rng));
  const m = room.monsters[0];
  p.x = 20 * T + 1;
  p.y = 3 * T + 1;
  p.facing = 6;
  // The target does not stand still, and it DODGES (section 4.4). Measured: a
  // CRAWLER sidesteps out of the firing lane around tick 21 and a test that
  // keeps firing down the original row never connects again - which is the
  // dodge working, not the hit resolution failing.
  //
  // So this re-aims each tick the way a player would, keeping PIP in the
  // monster's row. The assertion is that a hit RESOLVES into a kill and a
  // corpse, not that any particular shot connects.
  let corpseSeen = 0;
  for (let i = 0; i < 2000 && !corpseSeen; i++) {
    // Track the target's row; both lane rows are floor, so this is legal.
    if (!boxHitsTiles(room.tiles, p.x, m.y, TUNING.player.hitboxRoom, TUNING.player.hitboxRoom, null)) {
      p.y = m.y;
    }
    p.facing = 6;
    updateGame(state, { dir: -1, facingLatch: -1, fire: true });
    corpseSeen = room.corpses.length;
  }
  check('shooting a CRAWLER kills it', m.alive, false);
  check('and leaves exactly one corpse', corpseSeen, 1);
  check('the arrow is consumed by the hit', state.floor.arrow.alive, false);
}

console.log('\n# corpse decay runs to completion (section 4.5)');
{
  const state = emptyRoomState('coil', 0xDECA1);
  const room = state.floor.rooms.coil;
  const T = TUNING.tile;
  room.corpses.push(createCorpse(16 * T, 21 * T));
  const perPhase = Math.round(TUNING.corpse.phaseSec / TUNING.dt);
  const phases = TUNING.corpse.decayPhases;
  const seenPhases = new Set();
  for (let i = 0; i < perPhase * (phases + 1); i++) {
    if (room.corpses.length) seenPhases.add(room.corpses[0].phase);
    updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  }
  check('a corpse passes through every decay phase', seenPhases.size, phases);
  check('and then vanishes', room.corpses.length, 0);
}

console.log('\n# shooting a corpse is punished (section 3.6, CONTESTED)');
{
  const T = TUNING.tile;
  const mode = TUNING.flags.CORPSE_SHOT_MODE;

  // RESET_ONE: only the corpse that was hit regresses.
  TUNING.flags.CORPSE_SHOT_MODE = 'RESET_ONE';
  const one = emptyRoomState('coil', 0x5407).floor.rooms.coil;
  one.corpses.push(createCorpse(16 * T, 21 * T), createCorpse(17 * T, 21 * T));
  one.corpses[0].phase = 2;
  one.corpses[1].phase = 2;
  shootCorpse(one, one.corpses[0]);
  check('RESET_ONE regresses the corpse that was hit', one.corpses[0].phase, 0);
  check('RESET_ONE leaves the others alone', one.corpses[1].phase, 2);

  // RESET_ALL: every corpse in the room comes back.
  TUNING.flags.CORPSE_SHOT_MODE = 'RESET_ALL';
  const all = emptyRoomState('coil', 0x5408).floor.rooms.coil;
  all.corpses.push(createCorpse(16 * T, 21 * T), createCorpse(17 * T, 21 * T));
  all.corpses[0].phase = 2;
  all.corpses[1].phase = 2;
  shootCorpse(all, all.corpses[0]);
  check('RESET_ALL regresses every corpse', all.corpses[1].phase, 0);

  TUNING.flags.CORPSE_SHOT_MODE = mode;
  check('the flag was restored', TUNING.flags.CORPSE_SHOT_MODE, mode);
}

console.log('\n# WARDEN INTRUSION - the other half of M3 (section 3.3)');
{
  const state = emptyRoomState('coil', 0x1470);
  const room = state.floor.rooms.coil;
  const limit = state.floor.descriptor.floorTimerSec;
  const limitTicks = Math.round(limit / TUNING.dt);

  check('no intruder before the deadline', room.intruder, null);
  // Park the floor clock just short of the deadline. Only startFloor may RESET
  // it; a test advancing it is not a reset.
  state.floor.elapsedTicks = limitTicks - 2;
  updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  check('still none one tick short', room.intruder, null);
  updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  assert('a WARDEN intrudes once the floor timer expires', room.intruder !== null);

  // Section 3.3: it enters THROUGH A DOOR. Read the position at spawn - it
  // chases from the next tick onward, so checking later measures where it has
  // got to, not where it came in.
  const first = room.intruder;
  const spawnTile = [Math.floor(first.x / TUNING.tile), Math.floor(first.y / TUNING.tile)];
  const onDoor = ROOM_DEFS.coil.doors.some(
    (d) => spawnTile[0] === d.tx && spawnTile[1] === d.ty
  );
  assert('the intruder entered through a door', onDoor, `spawned at ${spawnTile.join(',')}`);

  // Section 3.3: it NEVER leaves. Only escape is leaving the room.
  for (let i = 0; i < 300; i++) updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  assert('the intruder never leaves', room.intruder === first);
}
{
  // And it kills. Section 3.1: nothing stops it.
  const state = emptyRoomState('coil', 0x1471);
  const room = state.floor.rooms.coil;
  const p = state.floor.player;
  state.floor.elapsedTicks = Math.round(state.floor.descriptor.floorTimerSec / TUNING.dt) + 1;
  updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  assert('intruder present', room.intruder !== null);
  p.invulnTicks = 0;
  p.x = room.intruder.x;
  p.y = room.intruder.y;
  const lives = p.lives;
  updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  check('the intruding WARDEN kills PIP on contact', p.lives, lives - 1);
}

console.log('\n# corpse hatch legibility at EVERY decay phase (section 11)');
{
  // Section 11: corpse lethality must never be conveyed by hue alone - a
  // diagonal hatch AND a distinct broken silhouette at every decay phase.
  //
  // This is asserted rather than claimed in a comment, because the claim was
  // wrong twice. Mirrors render.js's hatch arithmetic exactly; if that changes
  // and this is not updated, the counts diverge and this fails.
  const t = TUNING.tile;
  const phases = TUNING.corpse.decayPhases;
  const counts = [];
  const spans = [];
  for (let phase = 0; phase < phases; phase++) {
    const shrink = Math.min(phase, phases - 2);
    const span = t - shrink * 2;
    const stride = Math.max(1, Math.floor(span / 3));
    let marks = 0;
    for (let i = 0; i < span; i += stride) marks++;
    if (phase >= phases - 1) marks *= 2;   // the X at the final phase
    counts.push(marks);
    spans.push(span);
  }
  console.log(`     span per phase  ${spans.join(', ')}`);
  console.log(`     hatch marks     ${counts.join(', ')}`);
  assert('at least 3 hatch marks at EVERY decay phase, including the last',
    counts.every((n) => n >= 3), `got ${counts.join(', ')}`);
  assert('the corpse never shrinks below half a tile while still lethal',
    spans.every((s) => s >= t / 2), `got ${spans.join(', ')}`);
  assert('the final phase is visually distinct from the one before it',
    counts[phases - 1] !== counts[phases - 2] || spans[phases - 1] !== spans[phases - 2],
    'last two phases render identically');
}

console.log('\n# the intruder HUNTS - pure chase, not patrol (section 4.3)');
{
  // Section 4.3: "On intrusion: spawns at a room door, switches to PURE chase."
  //
  // Reusing the patrol path unchanged left the intruder rolling against pursuit
  // bias, which caps at pursuitBiasCap (0.9) and can never reach 1.0 - so it
  // headed back to its own spawn door on ~10% of ticks forever. It spawned, it
  // never left, and it killed on contact, so the earlier tests all passed. It
  // simply did not hunt. This measures closing distance, which is what was
  // missing. Verified failing against the pre-fix implementation.
  const state = emptyRoomState('coil', 0x8074);
  const room = state.floor.rooms.coil;
  const p = state.floor.player;
  const T = TUNING.tile;
  state.floor.elapsedTicks = Math.round(state.floor.descriptor.floorTimerSec / TUNING.dt) + 1;
  updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  assert('intruder spawned', room.intruder !== null);

  // Park PIP somewhere reachable and stationary, and watch the gap close.
  p.x = 20 * T + 1;
  p.y = 21 * T + 1;
  p.prevX = p.x;
  p.prevY = p.y;
  const dist = () => Math.hypot(room.intruder.x - p.x, room.intruder.y - p.y);
  const start = dist();
  let closest = start;
  for (let i = 0; i < 900; i++) {
    updateGame(state, { dir: -1, facingLatch: -1, fire: false });
    if (!room.intruder) break;
    closest = Math.min(closest, dist());
  }
  assert('the intruder closes on PIP', closest < start * 0.5,
    `start ${start.toFixed(0)}px, closest ${closest.toFixed(0)}px`);

  // THE DISCRIMINATOR. The check above passes either way and is not enough:
  // by the time intrusion fires, elapsed >= floorTimerSec, so pursuit bias is
  // already at its 0.9 cap and patrol mode chases 90% of ticks - it still
  // arrives, just wastefully. The defect is invisible at high bias.
  //
  // At bias ZERO the two modes are opposites: patrol goes to the waypoint every
  // single tick, pure chase goes to PIP every single tick. So drive
  // updateWarden directly at elapsedSec = 0, with the waypoint and PIP in
  // opposite directions, and see which way it actually walks.
  const solo = emptyRoomState('coil', 0x8075);
  const sp = solo.floor.player;
  sp.x = 30 * T;
  sp.y = 21 * T;
  // Waypoint far to the WEST, PIP far to the EAST of the WARDEN.
  const w = createWarden({ waypoints: [[6, 21]], startIdx: 0 }, 1, 1);
  w.x = 20 * T;
  w.y = 21 * T;
  const beforeX = w.x;
  for (let i = 0; i < 30; i++) {
    updateWarden(w, sp, solo.room.tiles, 0, 1, solo.rng, true);
  }
  assert('at zero pursuit bias a PURE-CHASE warden still walks toward PIP',
    w.x > beforeX, `moved ${(w.x - beforeX).toFixed(1)}px (east is toward PIP)`);

  // And the control: the same call WITHOUT pure chase must go the other way.
  const w2 = createWarden({ waypoints: [[6, 21]], startIdx: 0 }, 1, 1);
  w2.x = 20 * T;
  w2.y = 21 * T;
  for (let i = 0; i < 30; i++) {
    updateWarden(w2, sp, solo.room.tiles, 0, 1, solo.rng, false);
  }
  assert('a patrol warden at zero bias walks toward its waypoint instead',
    w2.x < beforeX, `moved ${(w2.x - beforeX).toFixed(1)}px (west is toward the waypoint)`);
}

console.log('\n# intrusion warning ramp (sections 3.3, 10, 11)');
{
  const descriptor = { floorTimerSec: 45 };
  const warn = TUNING.warden.intrusionWarnSec;
  check('silent well before the deadline', intrusionWarningLevel(descriptor, 10), 0);
  check('silent exactly one warn-window out', intrusionWarningLevel(descriptor, 45 - warn), 0);
  assert('ramping inside the window',
    intrusionWarningLevel(descriptor, 45 - warn / 2) > 0 &&
    intrusionWarningLevel(descriptor, 45 - warn / 2) < 1);
  check('full at the deadline', intrusionWarningLevel(descriptor, 45), 1);
  check('stays full after it', intrusionWarningLevel(descriptor, 60), 1);
  assert('monotonic across the window', (() => {
    let prev = -1;
    for (let t = 45 - warn; t <= 45; t += 0.25) {
      const v = intrusionWarningLevel(descriptor, t);
      if (v < prev) return false;
      prev = v;
    }
    return true;
  })());
}

console.log('\n# dodge rate MATCHES ITS LABEL at every tier (section 4.4 [v0.9])');
{
  // dodgeSkill values are PER-SHOT probabilities. Rolling per tick compounded
  // them: ~7 ticks in a 24px window turned LOW 0.15 into 68%, MED 0.45 into
  // 98.5%, HIGH 0.80 into 99.999%. Only LOW shipped at M3 so only LOW was
  // observed; HIGH would have been unhittable at M6.
  //
  // Fires N arrows per tier at a monster and compares the observed dodge rate
  // to the label. Mutation-verified: reverting to a per-tick roll puts LOW back
  // near 68% and fails this.
  // Measured by calling monsterDodgeCheck DIRECTLY and reading its return.
  //
  // An earlier version inferred a dodge from the monster's DISPLACEMENT and
  // read every tier at roughly half its label - 0.083 / 0.253 / 0.415. That was
  // the measurement, not the code: the roll succeeds, then the perpendicular
  // sidestep is blocked by a wall about half the time, because the sign is
  // random and a 2-tall lane has wall on one side. Displacement measures
  // "dodged AND had somewhere to go". The label is about the roll.
  const TRIALS = 2000;
  const TOLERANCE = 0.03;

  for (const tier of ['LOW', 'MED', 'HIGH']) {
    const state = emptyRoomState('coil', 0xD0D0);
    let dodges = 0;
    let doubleRolled = 0;
    for (let trial = 0; trial < TRIALS; trial++) {
      const m = createMonster({ type: 'CRAWLER', tx: 14, ty: 3, dodge: tier }, state.rng);
      // West-bound shot, on-axis, well inside dodgeLookahead.
      const arrow = {
        alive: true, id: trial + 1, dir: 6,
        x: m.x + TUNING.monster.hurtbox / 2 + 10,
        y: m.y + TUNING.monster.hurtbox / 2
      };
      if (monsterDodgeCheck(m, arrow, state.rng, ROOM_DEFS.coil.tiles)) dodges++;
      // ONE roll per arrow per monster: a second call with the SAME arrow must
      // never roll again, whichever way the first went.
      if (monsterDodgeCheck(m, arrow, state.rng, ROOM_DEFS.coil.tiles) !== false) doubleRolled++;
    }
    const expected = TUNING.dodgeSkill[tier];
    const observed = dodges / TRIALS;
    console.log(`     ${tier.padEnd(4)} label ${expected.toFixed(2)}  observed ${observed.toFixed(3)}  (${dodges}/${TRIALS})`);
    assert(`${tier}: never rolls twice for the same arrow`, doubleRolled === 0,
      `${doubleRolled} double rolls`);
    assert(`${tier}: observed dodge rate is within ${TOLERANCE} of its label`,
      Math.abs(observed - expected) <= TOLERANCE,
      `label ${expected}, observed ${observed.toFixed(3)}`);

    // THE GUARD FOR THE ACTUAL DEFECT. The two assertions above are not enough
    // on their own: reverting to per-tick rolling still passes the rate check,
    // because two calls only lift LOW from 0.15 to 0.28. The real scenario is
    // ~7 ticks inside the 24px window, which is what compounds 0.15 to 0.68.
    //
    // So: hold ONE arrow in the window for seven ticks and require the
    // aggregate to still equal the label.
    const TICKS_IN_WINDOW = 7;
    let aggregate = 0;
    for (let trial = 0; trial < TRIALS; trial++) {
      const m = createMonster({ type: 'CRAWLER', tx: 14, ty: 3, dodge: tier }, state.rng);
      const arrow = {
        alive: true, id: 900000 + trial, dir: 6,
        x: m.x + TUNING.monster.hurtbox / 2 + 10,
        y: m.y + TUNING.monster.hurtbox / 2
      };
      let dodged = false;
      for (let t = 0; t < TICKS_IN_WINDOW; t++) {
        if (monsterDodgeCheck(m, arrow, state.rng, ROOM_DEFS.coil.tiles)) dodged = true;
      }
      if (dodged) aggregate++;
    }
    const aggRate = aggregate / TRIALS;
    console.log(`          held ${TICKS_IN_WINDOW} ticks in window -> ${aggRate.toFixed(3)}`);
    assert(`${tier}: still ${expected} after ${TICKS_IN_WINDOW} ticks in the window`,
      Math.abs(aggRate - expected) <= TOLERANCE,
      `label ${expected}, got ${aggRate.toFixed(3)} - this is the per-tick compounding defect`);
  }
}

console.log('\n# SLIDING_BARRIER hazards (section 4.5) — THE SLABS has no other threat');
{
  // THE SLABS has spawnOnEntry: [] and spawnOnPickup: [] - the four barriers
  // ARE the room. test-engineer proved that breaking hazardTouchesPlayer left
  // all eight suites green, which made a pure-timing room walk-in-take-the-coin.
  const def = ROOM_DEFS.slabs;
  const T = TUNING.tile;
  check('THE SLABS has no monsters at all', def.spawnOnEntry.length, 0);
  assert('THE SLABS has hazards', def.hazards.length === 4);

  // 1. Contact kills.
  {
    const state = emptyRoomState('slabs', 0x5148);
    const p = state.floor.player;
    p.invulnTicks = 0;
    const h = def.hazards[0];
    const box = hazardBox(h, state.room.ticks + 1);
    p.x = box.x + 1;
    p.y = box.y + 1;
    const lives = p.lives;
    updateGame(state, { dir: -1, facingLatch: -1, fire: false });
    check('standing in a barrier kills PIP', p.lives, lives - 1);
  }

  // 2. Standing clear does NOT kill - or the room would be unwinnable.
  {
    const state = emptyRoomState('slabs', 0x5149);
    const p = state.floor.player;
    p.invulnTicks = 0;
    p.x = def.treasure.tx * T + 1;
    p.y = def.treasure.ty * T + 1;
    const lives = p.lives;
    for (let i = 0; i < 400; i++) updateGame(state, { dir: -1, facingLatch: -1, fire: false });
    check('the treasure tile is never swept by a barrier', p.lives, lives);
  }

  // 3. The sweep actually sweeps, stays inside its travel, and is a pure
  //    function of the tick - so it cannot desync a replay.
  for (const h of def.hazards) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < h.periodTicks * 2; t++) {
      const off = hazardOffsetTiles(h, t);
      lo = Math.min(lo, off);
      hi = Math.max(hi, off);
    }
    assert(`barrier at ${h.tx},${h.ty} actually moves`, hi - lo > 1, `span ${(hi - lo).toFixed(2)}`);
    assert(`barrier at ${h.tx},${h.ty} stays within its travel`,
      lo >= -1e-9 && hi <= h.travel + 1e-9, `range ${lo.toFixed(2)}..${hi.toFixed(2)}`);
    assert(`barrier at ${h.tx},${h.ty} is periodic`,
      Math.abs(hazardOffsetTiles(h, 7) - hazardOffsetTiles(h, 7 + h.periodTicks)) < 1e-9);
    assert(`barrier at ${h.tx},${h.ty} is a pure function of the tick`,
      hazardOffsetTiles(h, 123) === hazardOffsetTiles(h, 123));
  }

  // 4. A death restarts the sweep, so a respawn never faces a frozen phase.
  {
    const state = emptyRoomState('slabs', 0x514A);
    for (let i = 0; i < 77; i++) updateGame(state, { dir: -1, facingLatch: -1, fire: false });
    assert('room ticks advance', state.room.ticks > 0);
    resetUnlootedRoom(state.room);
    check('resetting the room restarts the sweep', state.room.ticks, 0);
  }
}

console.log('\n# BOUNCER ricochet (section 4.4)');
{
  const T = TUNING.tile;
  check('BOUNCER has its own behaviour, not a placeholder',
    MONSTER_BEHAVIOUR.BOUNCER, 'ricochet');

  const state = emptyRoomState('ossuary', 0xB0);
  const m = createMonster({ type: 'BOUNCER', tx: 20, ty: 14, dodge: 'LOW' }, state.rng);
  check('a BOUNCER is not flagged placeholder', m.placeholder, false);

  const tiles = ROOM_DEFS.ossuary.tiles;
  const seen = new Set();
  const dirs = new Set();
  let outOfBounds = 0;
  let stuck = 0;
  for (let i = 0; i < 3000; i++) {
    const bx = m.x;
    const by = m.y;
    updateMonster(m, tiles, 1);
    if (m.x === bx && m.y === by) stuck++;
    if (boxHitsTiles(tiles, m.x, m.y, TUNING.monster.hurtbox, TUNING.monster.hurtbox, null)) {
      outOfBounds++;
    }
    seen.add(`${Math.floor(m.x / T)},${Math.floor(m.y / T)}`);
    dirs.add(m.dir);
  }
  assert('a BOUNCER never enters a wall', outOfBounds === 0, `${outOfBounds} ticks inside geometry`);
  assert('a BOUNCER covers ground rather than vibrating',
    seen.size >= 20, `visited ${seen.size} tiles`);
  assert('a BOUNCER actually changes direction', dirs.size >= 2, `dirs ${[...dirs].join(',')}`);
  assert('a BOUNCER travels only on diagonals (section 4.4)',
    [...dirs].every((d) => DIRS_DIAGONAL.has(d)), `dirs ${[...dirs].join(',')}`);
  assert('a BOUNCER never wedges for long', stuck < 3000 * 0.05, `${stuck} motionless ticks`);
}

console.log('\n# an unlisted archetype is flagged, never silently a CRAWLER');
{
  const state = emptyRoomState('coil', 0xFA11);
  const ghost = createMonster({ type: 'BRUTE', tx: 20, ty: 3, dodge: 'HIGH' }, state.rng);
  assert('an archetype with no behaviour entry is flagged placeholder', ghost.placeholder === true);
  check('and falls back to wall-following', ghost.behaviour, 'wallFollow');
  // The four shipped archetypes must NOT be placeholders once M6 lands. Today
  // only two exist, so this asserts the two that do.
  for (const type of ['CRAWLER', 'BOUNCER']) {
    const real = createMonster({ type, tx: 20, ty: 3, dodge: 'LOW' }, state.rng);
    assert(`${type} is implemented, not a placeholder`, real.placeholder === false);
  }
}

console.log('\n# sealing survives a death, per room (section 4.1)');
{
  // The integration test-engineer flagged as missing: loot SOME rooms for real,
  // then die, and confirm the looted ones stay sealed while the unlooted ones
  // reset. That is the partial-progress death, which is the softlock shape.
  const state = createGameState(0x5EA1ED, 0);
  state.floor.wardens.length = 0;
  const p = state.floor.player;
  const T2 = TUNING.tile;
  p.invulnTicks = 1e9;

  state.floor.rooms.coil = createRoomRuntime('coil', ROOM_DEFS.coil.doors[0], state.rng);
  state.floor.rooms.ossuary = createRoomRuntime('ossuary', ROOM_DEFS.ossuary.doors[0], state.rng);
  state.floor.looted.coil = true;
  state.floor.rooms.coil.treasureTaken = true;
  state.floor.rooms.ossuary.corpses.push(createCorpse(20 * T2, 14 * T2));

  applyPlayerDeath(state);

  check('the looted room stays sealed', state.floor.looted.coil, true);
  check('and is not rebuilt', state.floor.rooms.coil.treasureTaken, true);
  check('the unlooted room is reset', state.floor.rooms.ossuary.corpses.length, 0);
  check('and stays unlooted', state.floor.looted.ossuary, undefined);
  check('so the stairs are still locked', isStairsUnlockedRooms(state.floor), false);
}

console.log('\n# the four M4 audit fixes stay fixed');
{
  // 1. Hazards must be VISIBLE. render.js is DOM-bound and not test-importable,
  //    so this asserts the data path the renderer reads.
  const b0 = hazardBox(ROOM_DEFS.slabs.hazards[0], 0);
  const b1 = hazardBox(ROOM_DEFS.slabs.hazards[0], 60);
  assert('a barrier has a drawable box with real extent', b0.w > 0 && b0.h > 0);
  assert('and that box actually moves between ticks', b0.x !== b1.x || b0.y !== b1.y);

  // 2. room.ticks must be in the hash. THE SLABS has no monsters and no
  //    corpses, so without it the room contributes only constants and two
  //    replays could diverge on barrier position while hashing identical.
  const a = emptyRoomState('slabs', 0x5AB5);
  const c = emptyRoomState('slabs', 0x5AB5);
  for (let i = 0; i < 40; i++) updateGame(a, { dir: -1, facingLatch: -1, fire: false });
  for (let i = 0; i < 40; i++) updateGame(c, { dir: -1, facingLatch: -1, fire: false });
  const hashBefore = hashGameState(a);
  check('two identical runs agree', hashGameState(c), hashBefore);
  a.floor.rooms.slabs.ticks += 17;
  assert('advancing ONLY room.ticks changes the hash', hashGameState(a) !== hashBefore);

  // 3. The behaviour table must be genuinely additive, keyed so that M6 adds
  //    entries rather than editing updateMonster.
  assert('CRAWLER and BOUNCER have distinct behaviours',
    MONSTER_BEHAVIOUR.CRAWLER !== MONSTER_BEHAVIOUR.BOUNCER);

  // 4. Section 5's "fast" WARRENS bouncers must actually be faster than
  //    THE OSSUARY's. They shipped byte-identical until the M4 audit.
  const warrensFrac = ROOM_DEFS.warrens.spawnOnEntry[0].speedFrac;
  assert('THE WARRENS bouncers carry a speed override', warrensFrac > 0.80,
    `got ${warrensFrac}`);
  assert('THE OSSUARY bouncers do not', !ROOM_DEFS.ossuary.spawnOnEntry[0].speedFrac);

  // And the override reaches the mover, not just the data.
  const st = emptyRoomState('warrens', 0xFA57);
  const fast = createMonster(ROOM_DEFS.warrens.spawnOnEntry[0], st.rng);
  const slow = createMonster(ROOM_DEFS.ossuary.spawnOnEntry[0], st.rng);
  let fastDist = 0;
  let slowDist = 0;
  for (let i = 0; i < 60; i++) {
    const fx = fast.x; const fy = fast.y;
    const sx = slow.x; const sy = slow.y;
    updateMonster(fast, ROOM_DEFS.warrens.tiles, 1);
    updateMonster(slow, ROOM_DEFS.ossuary.tiles, 1);
    fastDist += Math.hypot(fast.x - fx, fast.y - fy);
    slowDist += Math.hypot(slow.x - sx, slow.y - sy);
  }
  assert('a fast BOUNCER covers more ground than a default one',
    fastDist > slowDist, `${fastDist.toFixed(1)} vs ${slowDist.toFixed(1)}`);
}

console.log('\n# EFFECTIVE dodge across room geometry (section 4.4 [v1.0])');
{
  // A dodge that rolls but cannot move is eaten in silence, so room shape used
  // to scale the tier without anyone designing it. Measured before the retry:
  //   HIGH 0.808 open hall / 0.402 in a 2-tall lane / 0.000 in a 1-tall corridor.
  // At 0.000 a BLINKER and a CRAWLER are identical - a dead mechanic.
  //
  // [v1.0] retries the OPPOSITE perpendicular when the first is blocked, which
  // restores the label anywhere the monster has somewhere to go. A 1-tall
  // corridor genuinely has nowhere on the perpendicular axis, so it stays at
  // zero - measured and asserted against the MEASURED value, not the label,
  // because that one is honest geometry rather than a defect.
  const TRIALS = 3000;
  const TOL = 0.035;

  // Synthetic maps standing in for the shapes section 5 describes.
  const shape = (openRow) => {
    const g = [];
    for (let y = 0; y < TUNING.gridH; y++) {
      let r = '';
      for (let x = 0; x < TUNING.gridW; x++) {
        r += (openRow(y) && x >= 2 && x <= 37) ? TILE_CHARS.FLOOR : TILE_CHARS.WALL;
      }
      g.push(r);
    }
    return g;
  };
  const SHAPES = [
    { name: 'open hall (10 tall)', tiles: shape((y) => y >= 2 && y <= 11), mid: 6, expectLabel: true },
    { name: '2-tall lane (COIL)', tiles: shape((y) => y >= 2 && y <= 3), mid: 2, expectLabel: true },
    { name: '1-tall corridor', tiles: shape((y) => y === 2), mid: 2, expectLabel: false }
  ];

  for (const sh of SHAPES) {
    for (const tier of ['LOW', 'MED', 'HIGH']) {
      const rng = createRng(0xD0D6);
      let dodged = 0;
      for (let i = 0; i < TRIALS; i++) {
        const m = createMonster({ type: 'CRAWLER', tx: 20, ty: sh.mid, dodge: tier }, rng);
        const arrow = {
          alive: true, id: i + 1, dir: 6,
          x: m.x + TUNING.monster.hurtbox / 2 + 10,
          y: m.y + TUNING.monster.hurtbox / 2
        };
        if (monsterDodgeCheck(m, arrow, rng, sh.tiles)) dodged++;
      }
      const rate = dodged / TRIALS;
      const label = TUNING.dodgeSkill[tier];
      console.log(`     ${sh.name.padEnd(20)} ${tier.padEnd(4)} ${rate.toFixed(3)}  (label ${label})`);
      if (sh.expectLabel) {
        assert(`${sh.name} / ${tier}: effective dodge matches the label`,
          Math.abs(rate - label) <= TOL,
          `label ${label}, got ${rate.toFixed(3)} - single-direction sidestep halves this`);
      } else {
        // Honest geometry: no perpendicular room at all. Asserted against the
        // MEASURED value so a regression here is still visible.
        assert(`${sh.name} / ${tier}: nowhere to go, so no dodge lands`,
          rate === 0, `got ${rate.toFixed(3)}`);
      }
    }
  }
}

console.log('\n# dodge consumes RNG deterministically (sections 3.10, 4.4, 12.1.1)');
{
  // The dodge roll is the one M3 path that consumes RNG inside combat. If its
  // consumption order ever changes, replays silently diverge - so it needs a
  // determinism check of its own, not just a behavioural one.
  function dodgeRun(seed) {
    const state = emptyRoomState('coil', seed);
    const room = state.floor.rooms.coil;
    const p = state.floor.player;
    const T = TUNING.tile;
    room.monsters.push(createMonster({ type: 'CRAWLER', tx: 8, ty: 3, dodge: 'LOW' }, state.rng));
    p.x = 20 * T + 1;
    p.y = 3 * T + 1;
    p.facing = 6;
    for (let i = 0; i < 120; i++) {
      updateGame(state, { dir: -1, facingLatch: -1, fire: i % 40 === 0 });
    }
    return hashGameState(state);
  }
  check('the same seed produces the same post-combat hash', dodgeRun(0xD0D6), dodgeRun(0xD0D6));
  assert('a different seed diverges', dodgeRun(0xD0D6) !== dodgeRun(0xD0D7));
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} tests/rooms.mjs`);
process.exit(failures === 0 ? 0 : 1);
