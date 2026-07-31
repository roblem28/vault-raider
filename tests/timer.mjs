// VAULT RAIDER - the per-FLOOR intrusion clock. SPEC v0.7 sections 3.4, 4.1.
//
// This is the mechanic CLAUDE.md lists first among "always getting broken", and
// both failure modes are exploits rather than crashes:
//   - resetting the timer on death is a suicide-farm exploit
//   - resetting it on room exit deletes the game's central scoring tension
//
// M2 covers what exists: monotonic across ticks, unchanged by death, unchanged
// by respawn, and reset ONLY by starting a new floor. The room enter/exit and
// zoom-transition cases join at M3 when rooms exist.
//
// Zero dependencies. Node only, no DOM.

import { TUNING, DIR_NEUTRAL, GAME_PHASES } from '../src/data/tuning.js';
import {
  createGameState, updateGame, applyPlayerDeath, startFloor, hashGameState
} from '../src/game/state.js';
import { floorElapsedSec } from '../src/game/floor.js';

let failures = 0;

function assert(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${detail || ''}`}`);
}

function check(name, actual, expected) {
  assert(name, actual === expected, `expected ${expected}, got ${actual}`);
}

const NEUTRAL = { dir: DIR_NEUTRAL, fire: false, facingLatch: DIR_NEUTRAL };
const SEED = 0x5641554c;

function run(state, ticks, input) {
  for (let i = 0; i < ticks; i++) updateGame(state, input || NEUTRAL);
}

console.log('# the flags that must not drift');
{
  check('DEATH_RESETS_FLOOR_TIMER is false', TUNING.flags.DEATH_RESETS_FLOOR_TIMER, false);
  check('DEATH_CLEARS_CORPSES is true', TUNING.flags.DEATH_CLEARS_CORPSES, true);
  check('HALL_FIRE_ENABLED is true', TUNING.flags.HALL_FIRE_ENABLED, true);
}

console.log('\n# monotonic: one tick in, one tick on the clock');
{
  const state = createGameState(SEED, 0);
  check('starts at zero', state.floor.elapsedTicks, 0);
  run(state, 100);
  check('100 ticks -> 100', state.floor.elapsedTicks, 100);
  run(state, 500);
  check('600 ticks -> 600', state.floor.elapsedTicks, 600);
  assert('elapsed seconds tracks ticks',
    Math.abs(floorElapsedSec(state.floor) - 600 * TUNING.dt) < 1e-9);
}

console.log('\n# UNCHANGED BY DEATH - the suicide-farm guard');
{
  const state = createGameState(SEED, 0);
  run(state, 300);
  const before = state.floor.elapsedTicks;
  const livesBefore = state.floor.player.lives;

  applyPlayerDeath(state);

  check('timer is untouched by the death itself', state.floor.elapsedTicks, before);
  check('a life was lost', state.floor.player.lives, livesBefore - 1);
  check('phase is PLAYER_DEATH', state.phase, GAME_PHASES.PLAYER_DEATH);

  // The death freeze must keep ticking the clock, not pause it.
  const freeze = state.deathFreezeTicks;
  run(state, freeze + 1);
  check('timer kept running through the death freeze',
    state.floor.elapsedTicks, before + freeze + 1);
  check('respawned into FLOOR_VIEW', state.phase, GAME_PHASES.FLOOR_VIEW);
  assert('respawn granted invulnerability', state.floor.player.invulnTicks > 0);

  // And it must not rewind on respawn either.
  const afterRespawn = state.floor.elapsedTicks;
  run(state, 60);
  check('timer still climbing after respawn', state.floor.elapsedTicks, afterRespawn + 60);
}

console.log('\n# a real contact death, not just the function call');
{
  const state = createGameState(SEED, 0);
  run(state, 120);
  const before = state.floor.elapsedTicks;

  // Park a WARDEN on PIP. Contact is checked against hurt boxes (section 4.1).
  state.floor.player.invulnTicks = 0;
  state.floor.wardens[0].x = state.floor.player.x;
  state.floor.wardens[0].y = state.floor.player.y;
  const lives = state.floor.player.lives;

  updateGame(state, NEUTRAL);

  check('contact killed PIP', state.floor.player.lives, lives - 1);
  check('timer unchanged by a contact death', state.floor.elapsedTicks, before + 1);
}

console.log('\n# invulnerability actually protects');
{
  const state = createGameState(SEED, 0);
  run(state, 60);
  state.floor.player.invulnTicks = 60;
  state.floor.wardens[0].x = state.floor.player.x;
  state.floor.wardens[0].y = state.floor.player.y;
  const lives = state.floor.player.lives;
  updateGame(state, NEUTRAL);
  check('no life lost while invulnerable', state.floor.player.lives, lives);
}

console.log('\n# UNCHANGED BY ZOOM TRANSITIONS (section 8)');
{
  // Section 8: "The floor intrusion timer keeps running during zooms." A zoom
  // is 24 non-interactive ticks each way; pausing the clock across them would
  // hand the player free reconnaissance time twice per room visit.
  const state = createGameState(SEED, 0);
  state.floor.wardens.length = 0;
  run(state, 60);

  // Walk PIP onto the coil door to trigger the zoom for real, rather than
  // setting the phase by hand - the point is that the REAL path keeps ticking.
  const p = state.floor.player;
  p.x = 10 * TUNING.tile + 2;
  p.y = 4 * TUNING.tile + 2;
  p.prevX = p.x;
  p.prevY = p.y;
  const down = { dir: 4, facingLatch: 4, fire: false };
  let guard = 0;
  while (state.phase === GAME_PHASES.FLOOR_VIEW && guard++ < 200) updateGame(state, down);
  check('walking onto a door begins the zoom', state.phase, GAME_PHASES.ROOM_ZOOM_IN);

  const atZoomStart = state.floor.elapsedTicks;
  const zoomTicks = TUNING.zoom.durationTicks;
  run(state, zoomTicks);
  check('the clock ran through every tick of ROOM_ZOOM_IN',
    state.floor.elapsedTicks, atZoomStart + zoomTicks);
  check('and the zoom completed into the room', state.phase, GAME_PHASES.ROOM_VIEW);

  // And again on the way out.
  const inRoom = state.floor.elapsedTicks;
  run(state, 120);
  check('the clock keeps running inside the room',
    state.floor.elapsedTicks, inRoom + 120);
}

console.log('\n# reset happens ONLY on a new floor');
{
  const state = createGameState(SEED, 0);
  run(state, 400);
  assert('clock is running', state.floor.elapsedTicks === 400);
  startFloor(state, 1);
  check('a new floor resets the clock', state.floor.elapsedTicks, 0);
  check('and advances the floor index', state.floorIndex, 1);
}

console.log('\n# lives run out -> GAME OVER, clock still not rewound');
{
  const state = createGameState(SEED, 0);
  run(state, 200);
  let guard = 0;
  while (state.floor.player.lives > 0 && guard++ < 10) {
    applyPlayerDeath(state);
    run(state, state.deathFreezeTicks + 1);
  }
  check('phase is GAME_OVER', state.phase, GAME_PHASES.GAME_OVER);
  assert('clock never rewound across every death', state.floor.elapsedTicks > 200);
}

console.log('\n# determinism: same seed + same input stream -> same hash');
{
  const a = createGameState(SEED, 0);
  const b = createGameState(SEED, 0);
  // A scripted stream that moves, turns, and fires.
  const script = [];
  for (let i = 0; i < 400; i++) {
    const dir = (i % 40 < 20) ? 2 : 4;
    script.push({ dir, facingLatch: dir, fire: i % 37 === 0 });
  }
  for (const s of script) updateGame(a, s);
  for (const s of script) updateGame(b, s);
  check('identical final hash', hashGameState(a), hashGameState(b));
  assert('the hash is not trivially zero', hashGameState(a) !== 0);

  // A different stream must diverge, or the hash proves nothing.
  const c = createGameState(SEED, 0);
  for (const s of script) updateGame(c, { ...s, dir: 6, facingLatch: 6 });
  assert('a different input stream produces a different hash',
    hashGameState(c) !== hashGameState(a));
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} tests/timer.mjs`);
process.exit(failures === 0 ? 0 : 1);
