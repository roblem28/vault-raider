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
  respawnPlayerOnFloor, floorElapsedSec
} from './floor.js';

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
    gameOver: false
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
      if (result.death) applyPlayerDeath(state);
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

  // --- M5 goes here: clear corpses, reset unlooted rooms, keep looted ---
  // Deliberately NOT here, ever: any write to state.floor.elapsedTicks.

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
  nums.push(a.alive ? 1 : 0, a.x, a.y, a.dir, a.windup, a.pending ? 1 : 0);

  // Corner-clipping state changes where a WARDEN goes next, so omitting it
  // could hide a divergence (section 12.1.1 inclusion test).
  for (const w of floor.wardens) {
    nums.push(w.x, w.y, w.routeIdx,
      w.checkTicks, w.minX, w.maxX, w.minY, w.maxY,
      w.slideTicks, w.slideAxis, w.slideSign);
  }

  // Room looted flags, in a stable order.
  for (const room of floor.layout.rooms) nums.push(floor.looted[room.id] ? 1 : 0);

  nums.push(state.score);
  // NOT included: prevX/prevY (render interpolation only), phaseTicks where it
  // is cosmetic, and anything derived rather than stored.
  return hashValues(0, nums);
}

const PHASE_ORDER = Object.keys(GAME_PHASES);

function phaseCode(phase) {
  const i = PHASE_ORDER.indexOf(phase);
  return i < 0 ? PHASE_ORDER.length : i;
}

export function gameElapsedSec(state) {
  return floorElapsedSec(state.floor);
}
