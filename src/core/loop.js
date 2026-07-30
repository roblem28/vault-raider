// VAULT RAIDER - fixed-timestep loop. SPEC v0.6 sections 1, 14 (M1).
//
// Fixed 60 Hz accumulator, 5-substep cap, clamped frame time, interpolated
// render. Identical behaviour at 60 / 120 / 144 Hz, and no time-skip burst
// after the tab has been backgrounded (section 12.2).
//
// The clock and the scheduler are injected so the loop runs headless under
// Node. No DOM access at import time. Safe to import from tests/.

// SCHEDULER is imported ONLY here. It is not a simulation constant - see the
// block above its declaration in tuning.js. No code reachable from update()
// may read it.
import { TUNING, SCHEDULER } from '../data/tuning.js';

// Pure. This is the whole timing rule, isolated so it can be tested without
// running a real loop.
//
// THE ACCUMULATOR IS DRAINED, NOT CARRIED, WHEN THE SUBSTEP CAP IS HIT.
// Carrying the remainder is the classic spiral-of-death bug: after a 30 s
// background, the leftover time is still owed, so the next frames run capped
// too and the game fast-forwards through the backlog instead of dropping it.
// Draining discards unsimulated time deliberately - a backgrounded game loses
// wall-clock time, which is correct, rather than replaying it in a burst.
export function advanceAccumulator(accumulator, frameSec) {
  // Clamped on BOTH sides. The upper bound is the tab-away guard; the lower
  // bound guards a backward clock. performance.now() is monotonic, so a
  // negative delta should be impossible - but an injected clock in a test or a
  // future replay driver is not bound by that, and an unclamped negative would
  // silently drive the accumulator down and under-count steps.
  const clamped = Math.min(Math.max(frameSec, 0), TUNING.maxFrameSec);
  let acc = accumulator + clamped;
  // Epsilon so a value a few ulps short of a whole step still counts as one.
  // See SCHEDULER in tuning.js for why 144 Hz needs this, and why it is safe.
  let steps = Math.floor((acc + SCHEDULER.accumulatorEpsilonSec) / TUNING.dt);

  if (steps > TUNING.maxSubsteps) {
    steps = TUNING.maxSubsteps;
    acc = 0;
  } else {
    // The epsilon can push acc a hair below zero; alpha must not go negative.
    acc = Math.max(0, acc - steps * TUNING.dt);
  }

  return { steps, accumulator: acc, alpha: acc / TUNING.dt };
}

// opts: { update(tick), render(alpha), now(), schedule(cb) }
//
// now() returns seconds. schedule(cb) queues the next frame and returns a
// handle. Both are injected: main.js passes performance.now and
// requestAnimationFrame, tests pass a synthetic clock and a manual pump.
export function createLoop(opts) {
  const loop = {
    running: false,
    accumulator: 0,
    tick: 0,
    lastTime: 0,
    handle: null,
    // Diagnostics for the M1 validation: substeps taken on the most recent
    // frame, and the rendered-frame counter.
    lastSteps: 0,
    frames: 0
  };

  function frame() {
    if (!loop.running) return;

    const time = opts.now();
    const frameSec = time - loop.lastTime;
    loop.lastTime = time;

    const advanced = advanceAccumulator(loop.accumulator, frameSec);
    loop.accumulator = advanced.accumulator;
    loop.lastSteps = advanced.steps;

    for (let i = 0; i < advanced.steps; i++) {
      opts.update(loop.tick);
      loop.tick++;
    }

    opts.render(advanced.alpha);
    loop.frames++;

    loop.handle = opts.schedule(frame);
  }

  loop.start = function startLoop() {
    if (loop.running) return;
    loop.running = true;
    loop.lastTime = opts.now();
    loop.accumulator = 0;
    loop.handle = opts.schedule(frame);
  };

  loop.stop = function stopLoop() {
    loop.running = false;
  };

  // Drive one frame by hand. Used by tests and by nothing else.
  loop.pump = frame;

  return loop;
}
