// VAULT RAIDER - determinism hash completeness. SPEC v1.1 sections 12.1, 12.1.1.
//
// THE THIRD unenforced rule to get a test. The PRNG ban got determinism.mjs;
// cross-references got refs.mjs; this is hashGameState.
//
// The pattern it exists to kill has now happened twice:
//   M3 - WARDEN corner-clip fields (checkTicks/min/max/slide*) steered movement
//        and were absent from the hash.
//   M4 - room.ticks drives every SLIDING_BARRIER position, and THE SLABS has no
//        monsters or corpses, so its whole per-room contribution was three
//        constant booleans.
// Both times: a new field that steers behaviour, added to state, never added to
// the hash. Resolving to be careful did not work twice, so it is mechanical now.
//
// HOW IT WORKS - mutation, so the test verifies itself:
//   - walk the live game-state tree and collect every leaf path
//   - perturb each leaf and require the hash to CHANGE
//   - unless the path is on the EXCLUSIONS registry below, in which case
//     require the hash NOT to change
//   - a path on neither side FAILS until somebody classifies it
//
// That catches both directions. A behaviour field missing from the hash fails.
// A cosmetic field wrongly IN the hash also fails, because that makes replays
// brittle for nothing.
//
// Zero dependencies. Node only, no DOM.

import { TUNING, GAME_PHASES } from '../src/data/tuning.js';
import { ROOM_DEFS } from '../src/data/rooms.js';
import { createGameState, updateGame, hashGameState } from '../src/game/state.js';
import { createRoomRuntime } from '../src/game/room.js';
import { createCorpse, createMonster, createWarden } from '../src/game/entities.js';

let failures = 0;

function assert(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${detail || ''}`}`);
}

// --- THE EXCLUSION REGISTRY -------------------------------------------------
//
// Path patterns that must NOT affect the hash, each with the reason. `#` stands
// for any array index. Anything here is a claim that the field is cosmetic,
// derived, or constant - and the test enforces that claim too, so a field
// listed here that DOES affect the hash fails just as loudly.
const EXCLUSIONS = [
  // Render interpolation. Read only by render.js to lerp between ticks.
  ['floor.player.prevX', 'render interpolation only'],
  ['floor.player.prevY', 'render interpolation only'],
  ['floor.arrow.prevX', 'render interpolation only'],
  ['floor.arrow.prevY', 'render interpolation only'],
  ['floor.wardens.#.prevX', 'render interpolation only'],
  ['floor.wardens.#.prevY', 'render interpolation only'],
  ['floor.rooms.#.monsters.#.prevX', 'render interpolation only'],
  ['floor.rooms.#.monsters.#.prevY', 'render interpolation only'],
  ['floor.rooms.#.intruder.prevX', 'render interpolation only'],
  ['floor.rooms.#.intruder.prevY', 'render interpolation only'],

  // Constant for the whole run. The RNG's evolving state is hashed instead.
  ['seed', 'constant for the run; rng.getState() is hashed instead'],

  // Derived from, and redundant with, something already hashed.
  ['gameOver', 'redundant with phase === GAME_OVER'],
  ['floorIndex', 'hashed via floor.descriptor.floorIndex'],
  ['floor.player.alive', 'redundant with phase and lives; never read'],
  ['floor.rooms.#.id', 'static room identity, not state'],

  // Per-instance configuration, fixed at spawn and never mutated. Changing one
  // means authoring a different room, not reaching a different game state.
  ['floor.wardens.#.speedMul', 'fixed at spawn from the floor descriptor'],
  ['floor.rooms.#.monsters.#.type', 'fixed at spawn from room data'],
  ['floor.rooms.#.monsters.#.behaviour', 'fixed at spawn from room data'],
  ['floor.rooms.#.monsters.#.placeholder', 'fixed at spawn from room data'],
  ['floor.rooms.#.monsters.#.speedFrac', 'fixed at spawn from room data'],
  ['floor.rooms.#.monsters.#.dodge', 'fixed at spawn from room data'],
  ['floor.rooms.#.monsters.#.spawnTx', 'fixed at spawn from room data'],
  ['floor.rooms.#.monsters.#.spawnTy', 'fixed at spawn from room data'],
  ['floor.rooms.#.monsters.#.seed', 'drawn once at spawn, never re-read'],
  ['floor.rooms.#.monsters.#.hand', 'fixed at spawn from tile parity'],
  ['floor.rooms.#.intruder.speedMul', 'fixed at spawn from the floor descriptor'],

  // Bookkeeping the hash reaches by another route.
  ['floorReturn.x', 'overwritten from the door on every room exit'],
  ['floorReturn.y', 'overwritten from the door on every room exit']
];

const EXCLUDED = new Map(EXCLUSIONS.map(([p, why]) => [p, why]));

// Containers that are shared static DATA, not per-run state. Walking into them
// would perturb the room and floor definitions every other test reads.
const STATIC_KEYS = new Set([
  'layout', 'def', 'descriptor', 'rng', 'mask', 'tiles', 'waypoints',
  'entryDoor', 'doors', 'treasure', 'hazards', 'spawnOnEntry', 'spawnOnPickup',
  'room', 'pendingDoor'
]);

function walk(node, prefix, out) {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${prefix}.${i}`, out));
    return out;
  }
  if (typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (STATIC_KEYS.has(key)) continue;
      if (typeof node[key] === 'function') continue;
      walk(node[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  if (typeof node === 'number' || typeof node === 'boolean' || typeof node === 'string') {
    out.push(prefix);
  }
  return out;
}

// `#` stands for any array index AND any room key - floor.rooms is keyed by
// room id, not by index, so numeric generalisation alone misses it.
const generalise = (path) => path
  .replace(/\.\d+/g, '.#')
  .replace(/(^|\.)rooms\.[^.]+/g, '$1rooms.#');

function getAt(root, path) {
  return path.split('.').reduce((o, k) => (o === undefined ? o : o[k]), root);
}

function setAt(root, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  const parent = parts.reduce((o, k) => o[k], root);
  parent[last] = value;
}

function perturb(v) {
  if (typeof v === 'number') return v + 1;
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'string') return v + 'X';
  return v;
}

// A state rich enough that every branch of the hash is populated: a room open
// with monsters, a corpse, an intruder, a live arrow, and wardens on the floor.
function richState() {
  const state = createGameState(0x57A7E, 0);
  const room = createRoomRuntime('coil', ROOM_DEFS.coil.doors[0], state.rng);
  room.corpses.push(createCorpse(20 * TUNING.tile, 21 * TUNING.tile));
  room.monsters.push(createMonster(
    { type: 'BOUNCER', tx: 20, ty: 3, dodge: 'MED', speedFrac: 1.1 }, state.rng
  ));
  room.intruder = createWarden({ waypoints: [[10, 0]], startIdx: 0 }, 1, 1);
  room.ticks = 33;
  state.floor.rooms.coil = room;
  state.room = room;
  state.phase = GAME_PHASES.ROOM_VIEW;
  state.floor.arrow.alive = true;
  state.floor.arrow.x = 100;
  state.floor.arrow.y = 100;
  state.floor.arrow.id = 4;
  state.pendingRoomId = 'coil';
  state.floorReturn = { x: 10, y: 20 };
  state.deathFreezeTicks = 3;
  state.zoomTicks = 5;
  state.run.score = 400;
  updateGame(state, { dir: -1, facingLatch: -1, fire: false });
  return state;
}

const state = richState();
const paths = walk(state, '', []);
console.log(`# ${paths.length} state leaves found`);
assert('the state tree is populated enough to be meaningful', paths.length > 40);

const base = hashGameState(state);
assert('the baseline hash is not trivially zero', base !== 0);

const missing = [];
const spurious = [];
const unclassified = [];

for (const path of paths) {
  const generic = generalise(path);
  const before = getAt(state, path);
  setAt(state, path, perturb(before));
  const changed = hashGameState(state) !== base;
  setAt(state, path, before);

  if (EXCLUDED.has(generic)) {
    if (changed) spurious.push(`${generic} - excluded as "${EXCLUDED.get(generic)}" but DOES affect the hash`);
  } else if (!changed) {
    missing.push(generic);
  }
}

// Dedupe generalised paths for readable output.
const uniq = (a) => [...new Set(a)];

assert('every behaviour-steering field reaches the hash',
  missing.length === 0,
  `${uniq(missing).length} unhashed and unexcluded: ${uniq(missing).slice(0, 10).join(', ')}`);

assert('every excluded field is genuinely absent from the hash',
  spurious.length === 0,
  uniq(spurious).slice(0, 6).join('; '));

// The registry must not rot: an exclusion for a path that no longer exists is a
// stale claim, and hides the field if it ever comes back under the same name.
{
  const live = new Set(paths.map(generalise));
  const stale = EXCLUSIONS.map(([p]) => p).filter((p) => !live.has(p));
  assert('no exclusion names a path that no longer exists',
    stale.length === 0, `stale: ${stale.join(', ')}`);
}

console.log(`\n# exclusion registry: ${EXCLUSIONS.length} paths classified cosmetic/derived/static`);

// And the harness itself must be able to fail, or none of the above means
// anything.
{
  const probe = richState();
  const h = hashGameState(probe);
  probe.floor.player.x += 1;
  assert('the harness detects a change it should detect', hashGameState(probe) !== h);
  probe.floor.player.x -= 1;
  probe.floor.player.prevX += 1;
  assert('and ignores one it should ignore', hashGameState(probe) === h);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} tests/statehash.mjs`);
process.exit(failures === 0 ? 0 : 1);
