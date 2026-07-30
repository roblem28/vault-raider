// VAULT RAIDER - scheduler timing. SPEC v0.6 sections 1, 14 (M1), 12.2.
//
// Seeded at M1 to cover SCHEDULER.accumulatorEpsilonSec (docs/NOTES.md A7).
// test-engineer owns the suite from M3; this file exists so a timing
// regression at M6 cannot hide until someone runs the game on a 90 Hz phone.
//
// Every assertion is an EXACT integer count. No tolerances - a tolerance here
// would hide exactly the one-tick-behind bug this file was written for.
//
// Zero dependencies. Node only, no DOM.

import { TUNING, SCHEDULER } from '../src/data/tuning.js';
import { advanceAccumulator, createLoop } from '../src/core/loop.js';
import { createRng } from '../src/core/rng.js';
import {
  createInputRecorder, recordInputFrame, createInputPlayer, playInputFrame
} from '../src/core/input.js';

let failures = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  expected ${expected}, got ${actual}`}`);
}

function assert(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${detail || ''}`}`);
}

// Run a sequence of frame deltas through the accumulator and total the updates.
function runFrames(deltas) {
  let acc = 0;
  let steps = 0;
  for (let i = 0; i < deltas.length; i++) {
    const r = advanceAccumulator(acc, deltas[i]);
    acc = r.accumulator;
    steps += r.steps;
    if (r.alpha < 0 || r.alpha >= 1) {
      failures++;
      console.log(`FAIL alpha out of range at frame ${i}: ${r.alpha}`);
    }
  }
  return { steps, accumulator: acc };
}

function constantRate(hz, seconds) {
  const deltas = new Array(hz * seconds).fill(1 / hz);
  return runFrames(deltas).steps;
}

console.log('# sustained constant refresh rates');
for (const hz of [30, 48, 60, 72, 90, 120, 144, 165, 240]) {
  check(`${hz}Hz for 1s -> 60 updates`, constantRate(hz, 1), 60);
}

console.log('\n# long-run: no accumulated offset over 10 minutes');
// 36000 updates = 600 s * 60. This is the assertion that would have caught the
// original 144 Hz defect, which was a permanent one-tick offset rather than
// compounding drift - a short test can miss it, a wrong-by-one test cannot.
check('90Hz for 600s -> 36000 updates', constantRate(90, 600), 36000);
check('144Hz for 600s -> 36000 updates', constantRate(144, 600), 36000);

console.log('\n# 30Hz sustained exercises the multi-substep path');
{
  // At 30 Hz each frame owes 2 updates. Confirms the cap is not clipping
  // legitimate multi-step frames.
  let acc = 0;
  let sawTwo = false;
  let total = 0;
  for (let i = 0; i < 30; i++) {
    const r = advanceAccumulator(acc, 1 / 30);
    acc = r.accumulator;
    total += r.steps;
    if (r.steps === 2) sawTwo = true;
    if (r.steps > TUNING.maxSubsteps) { failures++; console.log(`FAIL substep cap exceeded: ${r.steps}`); }
  }
  check('30Hz for 1s -> 60 updates', total, 60);
  assert('30Hz actually takes 2 substeps per frame', sawTwo);
}

console.log('\n# JITTER - real hardware is VRR, not a clean constant');
{
  // Randomised deltas in [1/240, 1/48] over 60 simulated seconds.
  // Seeded RNG, so a failure here is reproducible rather than flaky.
  const rng = createRng(0x5eed1234);
  const minDelta = 1 / 240;
  const maxDelta = 1 / 48;
  const targetSec = 60;

  let elapsed = 0;
  const deltas = [];
  while (elapsed < targetSec) {
    let d = minDelta + rng.nextFloat() * (maxDelta - minDelta);
    if (elapsed + d > targetSec) d = targetSec - elapsed;   // land exactly on 60.000s
    deltas.push(d);
    elapsed += d;
  }
  const { steps } = runFrames(deltas);
  check('jittered VRR deltas over 60s -> 3600 updates', steps, 3600);
  console.log(`     (${deltas.length} frames, mean ${(1 / (targetSec / deltas.length)).toFixed(1)}Hz)`);
}

console.log('\n# stall: drain, no catch-up burst, immediate resync');
{
  const stall = advanceAccumulator(0, 5);
  check('5s stall is capped at maxSubsteps', stall.steps, TUNING.maxSubsteps);
  check('5s stall DRAINS the accumulator', stall.accumulator, 0);

  // The burst test. If the accumulator carried the 5 s debt, the frames after
  // the stall would each run capped until the backlog cleared.
  let acc = stall.accumulator;
  let after = 0;
  for (let i = 0; i < 60; i++) {
    const r = advanceAccumulator(acc, 1 / 60);
    acc = r.accumulator;
    after += r.steps;
  }
  check('60 frames after a 5s stall -> exactly 60 updates', after, 60);

  // SPEC 12.2: tab away 30 s and return with no time-skip burst.
  const bg = advanceAccumulator(0, 30);
  check('30s background is capped', bg.steps, TUNING.maxSubsteps);
  check('30s background DRAINS', bg.accumulator, 0);
}

console.log('\n# frame time is clamped before it reaches the accumulator');
{
  const huge = advanceAccumulator(0, 3600);
  check('a 1-hour frame still yields only maxSubsteps', huge.steps, TUNING.maxSubsteps);
  assert('maxFrameSec is 0.25', TUNING.maxFrameSec === 0.25);
  assert('maxSubsteps is 5', TUNING.maxSubsteps === 5);
}

console.log('\n# scheduler/simulation separation (NOTES A7 condition b)');
{
  assert('SCHEDULER is a separate export from TUNING',
    SCHEDULER && typeof SCHEDULER.accumulatorEpsilonSec === 'number');
  assert('the epsilon did not leak into TUNING',
    TUNING.accumulatorEpsilonSec === undefined);
  assert('epsilon is far below one tick',
    SCHEDULER.accumulatorEpsilonSec < TUNING.dt / 1000,
    `${SCHEDULER.accumulatorEpsilonSec} vs dt ${TUNING.dt}`);

  // The load-bearing property: update() must not be able to observe wall-clock
  // jitter. Drive the loop with wildly irregular frame deltas and assert that
  // update() sees nothing but consecutive tick indices - no delta, no time.
  const seenArgs = [];
  const deltas = [1 / 240, 1 / 30, 1 / 144, 0.2, 1 / 60, 1 / 90];
  let clock = 0;
  let feed = 0;
  const loop = createLoop({
    now: () => clock,
    schedule: () => null,
    update: (...args) => { seenArgs.push(args); },
    render: () => {}
  });
  loop.running = true;
  loop.lastTime = 0;
  for (const d of deltas) {
    clock += d;
    feed++;
    loop.pump();
  }
  assert('update() is called with exactly one argument',
    seenArgs.every((a) => a.length === 1),
    `saw arities ${[...new Set(seenArgs.map((a) => a.length))].join(',')}`);
  assert('that argument is a consecutive tick index, not a delta',
    seenArgs.every((a, i) => a[0] === i),
    `first mismatch near ${JSON.stringify(seenArgs.slice(0, 4))}`);
  // Exactly 8, hand-traced. An exact count, not "> 0" - the previous version
  // compared a counter against the loop that incremented it, which structurally
  // could not fail.
  //
  // The 0.2 s frame is the interesting one, and it is why 8 rather than 16:
  // 0.2 < maxFrameSec (0.25) so the FRAME TIME is not clamped, but it owes 12
  // ticks, which exceeds maxSubsteps (5) - so the substep cap fires and drains.
  // Two limits, and only the second one bites here. Per-frame trace:
  //   1/240 -> 0   (acc 0.00417)
  //   1/30  -> 2   (acc 0.00417)
  //   1/144 -> 0   (acc 0.01111)
  //   0.2   -> 5   CAPPED, acc DRAINED to 0
  //   1/60  -> 1   (acc ~0)
  //   1/90  -> 0   (acc 0.01111)
  check('irregular deltas produce the exact tick count', seenArgs.length, 8);
  check('the loop consumed every frame', feed, deltas.length);
}

console.log('\n# backward clock: negative deltas cannot drive the accumulator down');
{
  const neg = advanceAccumulator(0, -1);
  check('a negative frame yields no steps', neg.steps, 0);
  check('a negative frame leaves the accumulator at zero', neg.accumulator, 0);
  assert('alpha stays in range on a negative frame', neg.alpha >= 0 && neg.alpha < 1, `${neg.alpha}`);

  // A backward jump mid-run must not eat accumulated time.
  const primed = advanceAccumulator(0, 1 / 120);          // half a tick banked
  const after = advanceAccumulator(primed.accumulator, -5);
  check('a backward jump does not consume banked time', after.accumulator, primed.accumulator);
  check('a backward jump yields no steps', after.steps, 0);

  // And the run recovers to exactly 60/sec immediately afterwards.
  let acc = after.accumulator;
  let steps = 0;
  for (let i = 0; i < 60; i++) {
    const r = advanceAccumulator(acc, 1 / 60);
    acc = r.accumulator;
    steps += r.steps;
  }
  check('60 frames after a backward clock -> 60 updates', steps, 60);
}

console.log('\n# replay bypasses the scheduler entirely (NOTES A7 condition b)');
{
  // If replay ever routed through requestAnimationFrame, the scheduler would
  // enter the simulation and the epsilon approval would be void. This drives a
  // recorded stream with NO createLoop, NO now(), NO schedule() - a bare for
  // loop - and asserts it reproduces the recording exactly.
  const rec = createInputRecorder();
  const scripted = [
    { dir: 2, facingLatch: 2, fire: true },
    { dir: 2, facingLatch: 2, fire: false },
    { dir: -1, facingLatch: -1, fire: false },
    { dir: 5, facingLatch: 5, fire: true },
    { dir: -1, facingLatch: 3, fire: false }
  ];
  for (const s of scripted) recordInputFrame(rec, s);

  const player = createInputPlayer(rec.frames);
  const replayed = [];
  for (let tick = 0; tick < scripted.length; tick++) replayed.push(playInputFrame(player));

  assert('a recorded stream replays with no loop, clock, or scheduler',
    JSON.stringify(replayed) === JSON.stringify(scripted),
    JSON.stringify(replayed));

  // Same stream, replayed twice, must be identical - no hidden time dependency.
  const p2 = createInputPlayer(rec.frames);
  const again = scripted.map(() => playInputFrame(p2));
  assert('replay is repeatable', JSON.stringify(again) === JSON.stringify(replayed));
  check('replay consumed every recorded frame', rec.frames.length, scripted.length);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} tests/loop.mjs`);
process.exit(failures === 0 ? 0 : 1);
