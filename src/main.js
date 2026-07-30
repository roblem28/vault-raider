// VAULT RAIDER - boot and wiring. SPEC v0.7 section 14.
//
// Wiring only. No game logic lives here, and no constants either - the M1
// debug scaffolding and its module-local palette are gone as of M2.

import {
  createInputHub, bindKeyboardInput, sampleInput,
  createInputRecorder, recordInputFrame
} from './core/input.js';
import { createLoop } from './core/loop.js';
import { initGfx, resizeGfx } from './core/gfx.js';
import { createGameState, updateGame } from './game/state.js';
import { renderFrame } from './game/render.js';

// Fixed boot seed. Deterministic across reloads, which is what makes a
// recorded input stream replayable (section 12.1.2). A per-run seed arrives
// with the high-score table at M9.
const BOOT_SEED = 0x5641554c;

export function bootVaultRaider(doc, win) {
  const canvas = doc.getElementById('vr-canvas');
  const gfx = initGfx(canvas, false);

  const hub = createInputHub();
  bindKeyboardInput(hub, win, win, doc);

  // Every session records its input stream. Determinism is a v1 requirement
  // (section 15), so the recorder runs from M1 rather than being retrofitted.
  const recorder = createInputRecorder();
  const state = createGameState(BOOT_SEED, 0);

  function fitCanvas() {
    resizeGfx(gfx, win.innerWidth, win.innerHeight, win.devicePixelRatio);
  }
  fitCanvas();
  win.addEventListener('resize', fitCanvas);

  const loop = createLoop({
    // performance.now() is milliseconds; the loop works in seconds. This is a
    // unit conversion, not a tuning value, so it stays inline.
    now: () => win.performance.now() / 1000,
    schedule: (cb) => win.requestAnimationFrame(cb),
    update: () => {
      // sampleInput is called EXACTLY once per tick. It advances edge detection.
      const input = sampleInput(hub);
      recordInputFrame(recorder, input);
      updateGame(state, input);
    },
    render: (alpha) => renderFrame(gfx, state, alpha)
  });

  loop.start();
  return { loop, hub, gfx, state, recorder };
}

// Guarded so importing main.js under Node (build checks, tooling) does not
// touch the DOM.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  bootVaultRaider(document, window);
}
