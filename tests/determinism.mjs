// VAULT RAIDER - determinism. SPEC v0.7 sections 12.1, 12.1.1, 15.
//
// Two jobs:
//   1. Same seed + same recorded input stream -> identical final state hash
//      across two runs.
//   2. Grep src/ for the banned platform PRNG and fail the build on any hit.
//
// Job 2 is why this file landed at M2 rather than M3 as PLAN.md scheduled: the
// ban is a hard project rule and until this existed NOTHING enforced it. A rule
// with no enforcement is a comment.
//
// Zero dependencies. Node only, no DOM.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { DIR_NEUTRAL } from '../src/data/tuning.js';
import { createGameState, updateGame, hashGameState } from '../src/game/state.js';
import {
  createInputHub, registerInputSource, setSourceIntent, setSourceFireHeld,
  sampleInput, createInputRecorder, recordInputFrame, createInputPlayer,
  playInputFrame, INPUT_SOURCE_IDS
} from '../src/core/input.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

let failures = 0;

function assert(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${detail || ''}`}`);
}

function check(name, actual, expected) {
  assert(name, actual === expected, `expected ${expected}, got ${actual}`);
}

function walkJs(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkJs(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

console.log('# the banned platform PRNG appears nowhere in src/');
{
  // Assembled at runtime so that this file - which lives outside src/ - cannot
  // itself be the thing a future copy of this grep trips over.
  const banned = 'Math' + '.' + 'random';
  const files = walkJs(SRC, []);
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(banned)) hits.push(`${relative(SRC, file)}:${i + 1}`);
    }
  }
  assert(`no banned PRNG in ${files.length} source files`, hits.length === 0,
    hits.join(', '));

  // The matcher must be capable of firing, or a clean result proves nothing.
  // Feed it a line that WOULD be a violation and confirm it is caught.
  const decoy = 'const r = ' + banned + '();';
  assert('the matcher catches a planted violation', decoy.includes(banned));
  assert('and does not fire on innocent code',
    !'const r = rng.nextFloat();'.includes(banned));
}

console.log('\n# same seed + same input stream -> identical hash');
{
  const SEED = 0x5641554c;
  const TICKS = 1200;

  // Build a stream through the real input hub, so this exercises the actual
  // reduction path rather than hand-written structs.
  const hub = createInputHub();
  registerInputSource(hub, INPUT_SOURCE_IDS.KEYBOARD);
  const recorder = createInputRecorder();
  for (let i = 0; i < TICKS; i++) {
    const dir = [2, 2, 4, 4, 0, 6, 6, DIR_NEUTRAL][Math.floor(i / 17) % 8];
    setSourceIntent(hub, INPUT_SOURCE_IDS.KEYBOARD, dir, dir);
    setSourceFireHeld(hub, INPUT_SOURCE_IDS.KEYBOARD, i % 23 === 0);
    recordInputFrame(recorder, sampleInput(hub));
  }
  check('recorded the expected number of frames', recorder.frames.length, TICKS);

  function runStream(frames) {
    const state = createGameState(SEED, 0);
    const player = createInputPlayer(frames);
    for (let i = 0; i < frames.length; i++) updateGame(state, playInputFrame(player));
    return hashGameState(state);
  }

  const a = runStream(recorder.frames);
  const b = runStream(recorder.frames);
  check('two runs of the same stream agree', a, b);
  assert('the hash is not trivially zero', a !== 0);

  // A hash that never changes proves nothing.
  const mutated = recorder.frames.slice();
  mutated[600] = mutated[600] ^ 1;
  assert('a one-frame change diverges', runStream(mutated) !== a);

  // A different seed must diverge too - the RNG has to actually reach state.
  const other = createGameState(SEED + 1, 0);
  const otherPlayer = createInputPlayer(recorder.frames);
  for (let i = 0; i < recorder.frames.length; i++) {
    updateGame(other, playInputFrame(otherPlayer));
  }
  assert('a different seed diverges', hashGameState(other) !== a);
}

console.log('\n# replay is source-agnostic (section 17.1)');
{
  // The same logical stream pushed through a DIFFERENT source id must produce
  // an identical game hash. This is the property that lets a touch-recorded
  // replay verify against a keyboard one at M11.
  const SEED = 0xA5A5;
  function streamFrom(sourceId) {
    const hub = createInputHub();
    registerInputSource(hub, sourceId);
    const rec = createInputRecorder();
    for (let i = 0; i < 600; i++) {
      const dir = [0, 2, 4, 6][Math.floor(i / 31) % 4];
      setSourceIntent(hub, sourceId, dir, dir);
      setSourceFireHeld(hub, sourceId, i % 19 === 0);
      recordInputFrame(rec, sampleInput(hub));
    }
    return rec.frames;
  }
  const kbd = streamFrom(INPUT_SOURCE_IDS.KEYBOARD);
  const touch = streamFrom(INPUT_SOURCE_IDS.TOUCH);
  assert('keyboard and touch produce an identical frame stream',
    JSON.stringify(kbd) === JSON.stringify(touch));

  function hashOf(frames) {
    const state = createGameState(SEED, 0);
    const p = createInputPlayer(frames);
    for (let i = 0; i < frames.length; i++) updateGame(state, playInputFrame(p));
    return hashGameState(state);
  }
  check('and an identical game hash', hashOf(kbd), hashOf(touch));
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} tests/determinism.mjs`);
process.exit(failures === 0 ? 0 : 1);
