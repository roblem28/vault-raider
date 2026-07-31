// VAULT RAIDER - root state and phase machine. SPEC v0.7 sections 8, 4.1, 12.1.1.
//
// updateGame is THE single update entry point. Its shape carries two invariants
// that CLAUDE.md lists as the mechanics that keep getting broken:
//
//   1. tickFloorTimer runs BEFORE phase dispatch, unconditionally, on every
//      phase. There is no code path that skips, pauses, or resets it.
//   2. applyPlayerDeath is one function in one file, so the corpse clear,
//      unlooted-room reset, and "do not touch the timer" rule are auditable as
//      a single thing.
//
// No DOM access. Safe to import from tests/.

import { TUNING, GAME_PHASES } from '../data/tuning.js';
import { createRng, hashValues } from '../core/rng.js';
import {
  createFloorRuntime, tickFloorTimer, updateFloor,
  respawnPlayerOnFloor, floorElapsedSec, doorUnderPlayer,
  isStairsUnlocked, playerOnStairs
} from './floor.js';
import {
  createRoomRuntime, updateRoom, roomEntryPosition, resetUnlootedRoom
} from './room.js';
import { ROOM_DEFS } from '../data/rooms.js';

export function createGameState(seed, floorIndex) {
  const rng = createRng(seed);
  const state = {
    seed,
    rng,
    tick: 0,
    phase: GAME_PHASES.FLOOR_VIEW,
    phaseTicks: 0,
    score: 0,
    floorIndex: floorIndex || 0,
    floor: null,
    deathFreezeTicks: 0,
    gameOver: false,
    // Room view. Section 8: FLOOR_VIEW <-> ROOM_ZOOM_IN -> ROOM_VIEW -> ZOOM_OUT.
    room: null,
    pendingRoomId: null,
    pendingDoor: null,
    // Zoom is measured in TICKS, never in ms (section 8).
    zoomTicks: 0,
    // Saved so PIP returns to the floor door he entered by.
    floorReturn: null
  };
  startFloor(state, state.floorIndex);
  return state;
}

// THE ONLY PLACE THE FLOOR TIMER RESETS. Not on room exit, not on death,
// not during a zoom transition (section 3.4).
export function startFloor(state, floorIndex) {
  state.floorIndex = floorIndex;
  state.floor = createFloorRuntime(floorIndex, state.rng);
  transitionPhase(state, GAME_PHASES.FLOOR_VIEW);
}

export function transitionPhase(state, phase) {
  state.phase = phase;
  state.phaseTicks = 0;
}

export function updateGame(state, input) {
  state.tick++;
  state.phaseTicks++;

  // 1. The per-FLOOR intrusion clock. UNCONDITIONAL. Every phase, always.
  //    Do not wrap this in a condition. Do not move it below the dispatch.
  tickFloorTimer(state.floor);

  // 2. Phase dispatch.
  switch (state.phase) {
    case GAME_PHASES.FLOOR_VIEW: {
      const result = updateFloor(state.floor, input);
      if (result.death) { applyPlayerDeath(state); break; }
      // Touching an unlooted room door begins the zoom.
      const door = doorUnderPlayer(state.floor);
      if (door && !state.floor.looted[door.id] && ROOM_DEFS[door.id]) {
        beginRoomZoomIn(state, door);
        break;
      }
      // Section 2.5: all four rooms looted unlocks the stairwell. This is the
      // single largest softlock surface in the game - if any room can become
      // permanently unlootable, the stairs never open. Guarded by
      // tests/floors.mjs and by the corpse clear in applyPlayerDeath.
      if (playerOnStairs(state.floor) && isStairsUnlocked(state.floor)) {
        transitionPhase(state, GAME_PHASES.FLOOR_CLEAR_BONUS);
      }
      break;
    }
    case GAME_PHASES.ROOM_ZOOM_IN: {
      // Non-interactive. The floor clock keeps running through it - that is
      // handled above, unconditionally, and must not be special-cased here.
      state.zoomTicks++;
      if (state.zoomTicks >= TUNING.zoom.durationTicks) enterRoom(state);
      break;
    }
    case GAME_PHASES.ROOM_VIEW: {
      const result = updateRoom(
        state.room, state.floor.player, state.floor.arrow, input,
        state.floor.descriptor, floorElapsedSec(state.floor)
      );
      if (result.death) { applyPlayerDeath(state); break; }
      if (result.exitDoor) beginRoomZoomOut(state);
      break;
    }
    case GAME_PHASES.ROOM_ZOOM_OUT: {
      state.zoomTicks++;
      if (state.zoomTicks >= TUNING.zoom.durationTicks) leaveRoom(state);
      break;
    }
    case GAME_PHASES.FLOOR_CLEAR_BONUS: {
      // The bonus MATHS is M8 (section 6's formula). M4 owns the transition
      // only, so the floor advances and the clock resets exactly once, in
      // startFloor. Awarding zero here rather than guessing a number.
      if (state.phaseTicks >= TUNING.zoom.durationTicks) {
        startFloor(state, state.floorIndex + 1);
      }
      break;
    }
    case GAME_PHASES.PLAYER_DEATH: {
      state.deathFreezeTicks--;
      if (state.deathFreezeTicks <= 0) {
        if (state.floor.player.lives > 0) {
          respawnPlayerOnFloor(state.floor);
          transitionPhase(state, GAME_PHASES.FLOOR_VIEW);
        } else {
          state.gameOver = true;
          transitionPhase(state, GAME_PHASES.GAME_OVER);
        }
      }
      break;
    }
    case GAME_PHASES.GAME_OVER:
    default:
      break;
  }
}

// --- room transitions ------------------------------------------------------
//
// Section 8: 24-tick scale-lerp, non-interactive, measured in TICKS never ms.
// THE FLOOR INTRUSION TIMER KEEPS RUNNING THROUGHOUT. That is guaranteed
// structurally by tickFloorTimer sitting above the phase dispatch, not by
// anything in these functions - do not add a pause here.

// An arrow in flight does not survive a view change. Section 3.8 allows exactly
// ONE alive; carrying a hall arrow into a room would mean either two in flight
// or a projectile at hall coordinates on a different map. Clearing it also
// stops the transition being used to bank a shot.
function clearArrowOnViewChange(state) {
  state.floor.arrow.alive = false;
  state.floor.arrow.pending = false;
}

export function beginRoomZoomIn(state, door) {
  clearArrowOnViewChange(state);
  state.pendingRoomId = door.id;
  state.pendingDoor = door;
  state.floorReturn = { x: state.floor.player.x, y: state.floor.player.y };
  state.zoomTicks = 0;
  transitionPhase(state, GAME_PHASES.ROOM_ZOOM_IN);
}

export function enterRoom(state) {
  const roomId = state.pendingRoomId;
  // An unlooted room that was already entered this life keeps its state; a
  // fresh one is built. Section 4.1's death handling resets unlooted rooms.
  if (!state.floor.rooms[roomId]) {
    const def = ROOM_DEFS[roomId];
    const entryDoor = def.doors[0];
    state.floor.rooms[roomId] = createRoomRuntime(roomId, entryDoor, state.rng);
  }
  state.room = state.floor.rooms[roomId];
  const pos = roomEntryPosition(state.room.def, state.room.entryDoor);
  state.floor.player.x = pos.x;
  state.floor.player.y = pos.y;
  state.floor.player.prevX = pos.x;
  state.floor.player.prevY = pos.y;
  transitionPhase(state, GAME_PHASES.ROOM_VIEW);
}

export function beginRoomZoomOut(state) {
  clearArrowOnViewChange(state);
  state.zoomTicks = 0;
  transitionPhase(state, GAME_PHASES.ROOM_ZOOM_OUT);
}

export function leaveRoom(state) {
  // Section 2.4: treasure taken -> room PERMANENTLY sealed.
  if (state.room && state.room.treasureTaken) {
    state.floor.looted[state.room.id] = true;
    state.score += state.floor.descriptor.treasureValue;
  }
  state.room = null;
  // Back to the floor door PIP came in by, nudged clear so he does not
  // immediately re-trigger the zoom.
  const back = state.floorReturn;
  const door = state.pendingDoor;
  const size = TUNING.player.hitboxFloor;
  if (door && door.side) {
    const out = door.side === 'N' ? { dx: 0, dy: -1 } : { dx: 0, dy: 1 };
    state.floor.player.x = (door.tx + out.dx) * TUNING.tile + (TUNING.tile - size) / 2;
    state.floor.player.y = (door.ty + out.dy) * TUNING.tile + (TUNING.tile - size) / 2;
  } else if (back) {
    state.floor.player.x = back.x;
    state.floor.player.y = back.y;
  }
  state.floor.player.prevX = state.floor.player.x;
  state.floor.player.prevY = state.floor.player.y;
  state.pendingRoomId = null;
  state.pendingDoor = null;
  transitionPhase(state, GAME_PHASES.FLOOR_VIEW);
}

// SPEC 4.1 death handling. M2 implements the parts that exist.
//
// THE TIMER IS NOT TOUCHED HERE. Resetting or reducing it is a suicide-farm
// exploit (TUNING.flags.DEATH_RESETS_FLOOR_TIMER must stay false).
//
// M5 adds: clear all corpses on the floor, reset unlooted rooms to entry spawn
// state, keep looted rooms looted. Those hooks do not exist yet because
// corpses and rooms do not. The marker below is where they go.
export function applyPlayerDeath(state) {
  const player = state.floor.player;
  player.lives--;

  // SECTION 4.1, and the reason it exists. Skipping either half of this
  // softlocks the run: a corpse decaying in the ONLY doorway of an unlooted
  // room makes the stairs permanently unreachable.
  //
  // CLEAR ALL CORPSES on the floor, and RESET every UNLOOTED room to its entry
  // spawn state. LOOTED ROOMS STAY LOOTED and are never rebuilt.
  for (const roomId of Object.keys(state.floor.rooms)) {
    if (state.floor.looted[roomId]) continue;
    resetUnlootedRoom(state.floor.rooms[roomId]);
  }
  // A room in progress is abandoned; PIP respawns at the floor entrance.
  state.room = null;
  state.pendingRoomId = null;
  state.pendingDoor = null;

  // Deliberately NOT here, ever: any write to state.floor.elapsedTicks.
  // TUNING.flags.DEATH_RESETS_FLOOR_TIMER must stay false - true is a
  // suicide-farm exploit.

  state.deathFreezeTicks = Math.round(TUNING.player.deathFreezeSec / TUNING.dt);
  transitionPhase(state, GAME_PHASES.PLAYER_DEATH);
}

// SPEC 12.1.1 - the determinism hash. tests/determinism.mjs imports THIS
// rather than reimplementing it, so test and implementation cannot drift.
//
// Included: anything whose omission could hide a divergence that changes what
// happens in the game. Excluded: render interpolation, audio, cosmetics.
export function hashGameState(state) {
  const nums = [];
  nums.push(state.rng.getState(), state.tick, phaseCode(state.phase));
  // deathFreezeTicks gates WHEN respawn fires. Harmless to omit today because
  // respawn writes fixed values, but M5 makes the result of respawn depend on
  // floor state, so include it now rather than remember to later.
  nums.push(state.deathFreezeTicks);

  const floor = state.floor;
  nums.push(floor.elapsedTicks, floor.descriptor.floorIndex);

  const p = floor.player;
  nums.push(p.x, p.y, p.facing, p.lives, p.invulnTicks);

  const a = floor.arrow;
  nums.push(a.alive ? 1 : 0, a.x, a.y, a.dir, a.windup, a.pending ? 1 : 0, a.id);

  // Corner-clipping state changes where a WARDEN goes next, so omitting it
  // could hide a divergence (section 12.1.1 inclusion test).
  //
  // Routed through ONE helper deliberately. The room intruder is the same
  // entity shape driven by the same updateWarden, and hashing it inline meant
  // it silently got 2 of these 11 fields while patrol WARDENs got all 11. Two
  // hand-maintained copies of an entity's hash is how that happens; there is
  // now only one.
  for (const w of floor.wardens) pushWardenState(nums, w);

  // Room looted flags, in a stable order.
  for (const room of floor.layout.rooms) nums.push(floor.looted[room.id] ? 1 : 0);

  // Live room state. Everything here steers what happens next: monster
  // positions, corpse decay phases (a corpse is lethal terrain until it
  // vanishes), the in-room arrow, and whether a WARDEN has intruded.
  nums.push(state.zoomTicks, state.room ? 1 : 0);
  for (const room of floor.layout.rooms) {
    const r = floor.rooms[room.id];
    if (!r) { nums.push(0); continue; }
    // r.ticks drives every SLIDING_BARRIER position (section 4.5). THE SLABS
    // has no monsters and no corpses, so without this its entire per-room hash
    // contribution is three constant booleans and two replays could diverge on
    // where the barriers are while hashing identical.
    nums.push(1, r.treasureTaken ? 1 : 0, r.intruder ? 1 : 0, r.ticks);
    for (const m of r.monsters) {
      nums.push(m.x, m.y, m.dir, m.hp, m.alive ? 1 : 0, m.dodgedArrowId);
    }
    for (const c of r.corpses) nums.push(c.tx, c.ty, c.phase, c.phaseTicks);
    // No per-room arrow to hash: there is one arrow and it is hashed above
    // with the rest of the floor state.
    if (r.intruder) pushWardenState(nums, r.intruder);
  }

  nums.push(state.score);
  // NOT included: prevX/prevY (render interpolation only), phaseTicks where it
  // is cosmetic, and anything derived rather than stored.
  return hashValues(0, nums);
}

// THE one place a WARDEN's hashable state is enumerated. Every WARDEN - patrol
// or room intruder - goes through here, so a field added to one is added to all.
function pushWardenState(nums, w) {
  nums.push(w.x, w.y, w.routeIdx,
    w.checkTicks, w.minX, w.maxX, w.minY, w.maxY,
    w.slideTicks, w.slideAxis, w.slideSign);
}

const PHASE_ORDER = Object.keys(GAME_PHASES);

function phaseCode(phase) {
  const i = PHASE_ORDER.indexOf(phase);
  return i < 0 ? PHASE_ORDER.length : i;
}

export function gameElapsedSec(state) {
  return floorElapsedSec(state.floor);
}
