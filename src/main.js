// VAULT RAIDER - boot and wiring. SPEC v0.6 section 14 (M1).
//
// Wiring only. No game logic lives here.
//
// M1 SCAFFOLDING NOTICE: mainDebugState and mainRenderDebug below are the
// milestone's stated validation artifact - the "debug rect at exactly 60 Hz"
// from section 14. They are NOT the game. M2 replaces them with game/state.js
// and game/render.js. The debug entity carries a persistent `facing` field
// specifically to demonstrate section 17.1.1: facing survives key release.

import { TUNING, DIRS, DIR_NEUTRAL } from './data/tuning.js';
import {
  createInputHub, bindKeyboardInput, sampleInput,
  createInputRecorder, recordInputFrame
} from './core/input.js';
import { createLoop } from './core/loop.js';
import { initGfx, resizeGfx, gfxBeginFrame, gfxFillRect, gfxStrokeRect, gfxDrawDebugText, gfxEndFrame } from './core/gfx.js';

const MAIN_BG_COLOR = '#101018';
const MAIN_FIELD_COLOR = '#1c1c2c';
const MAIN_PIP_COLOR = '#f8f0c0';
const MAIN_FACING_COLOR = '#e04030';
const MAIN_TEXT_COLOR = '#8090b0';
const MAIN_FIRE_FLASH_TICKS = 8;
const MAIN_DEBUG_SIZE = 6;
const MAIN_FACING_LEN = 6;
const MAIN_TEXT_SIZE = 6;
const MAIN_FPS_WINDOW = 30;

export function createMainDebugState() {
  return {
    x: TUNING.logicalW / 2,
    y: TUNING.logicalH / 2,
    prevX: TUNING.logicalW / 2,
    prevY: TUNING.logicalH / 2,
    // PERSISTENT entity facing (section 17.1.1). Starts East. Updated only when
    // facingLatch !== -1; never cleared on neutral input.
    facing: 2,
    fireFlash: 0,
    ticks: 0,
    lastSample: { dir: DIR_NEUTRAL, fire: false, facingLatch: DIR_NEUTRAL }
  };
}

export function updateMainDebug(state, input) {
  state.prevX = state.x;
  state.prevY = state.y;

  // facingLatch is an EVENT. Read it, do not store it. Entity facing persists.
  if (input.facingLatch !== DIR_NEUTRAL) state.facing = input.facingLatch;

  // dir is MOVEMENT intent, and is independent of facing.
  if (input.dir !== DIR_NEUTRAL) {
    const d = DIRS[input.dir];
    const speed = TUNING.player.speedFloor * TUNING.floorSpeedMul[0];
    state.x += d.dx * speed;
    state.y += d.dy * speed;
  }

  const half = MAIN_DEBUG_SIZE / 2;
  state.x = Math.max(half, Math.min(TUNING.logicalW - half, state.x));
  state.y = Math.max(half, Math.min(TUNING.logicalH - half, state.y));

  if (input.fire) state.fireFlash = MAIN_FIRE_FLASH_TICKS;
  else if (state.fireFlash > 0) state.fireFlash--;

  state.lastSample = input;
  state.ticks++;
}

function mainRenderDebug(gfx, state, alpha, loop, fps) {
  gfxBeginFrame(gfx, MAIN_BG_COLOR);
  gfxFillRect(gfx, 0, 0, TUNING.logicalW, TUNING.logicalH, MAIN_FIELD_COLOR);

  // Interpolated render: draw between the last two simulated positions.
  const x = state.prevX + (state.x - state.prevX) * alpha;
  const y = state.prevY + (state.y - state.prevY) * alpha;
  const half = MAIN_DEBUG_SIZE / 2;

  gfxFillRect(gfx, Math.round(x - half), Math.round(y - half),
    MAIN_DEBUG_SIZE, MAIN_DEBUG_SIZE,
    state.fireFlash > 0 ? MAIN_FACING_COLOR : MAIN_PIP_COLOR);

  // Facing indicator. Persists with no keys held - that is the point of it.
  const d = DIRS[state.facing];
  gfxStrokeRect(gfx,
    Math.round(x + d.dx * MAIN_FACING_LEN) - 1,
    Math.round(y + d.dy * MAIN_FACING_LEN) - 1,
    2, 2, MAIN_FACING_COLOR, 1);

  const s = state.lastSample;
  const lines = [
    'M1 DEBUG  tick ' + state.ticks,
    'fps ' + fps.toFixed(1) + '  substeps ' + loop.lastSteps,
    'dir ' + s.dir + '  face(evt) ' + s.facingLatch + '  fire ' + (s.fire ? 1 : 0),
    'entity facing ' + state.facing + ' ' + DIRS[state.facing].name
  ];
  for (let i = 0; i < lines.length; i++) {
    gfxDrawDebugText(gfx, lines[i], 4, 4 + i * (MAIN_TEXT_SIZE + 2), MAIN_TEXT_COLOR, MAIN_TEXT_SIZE);
  }

  gfxEndFrame(gfx);
}

export function bootVaultRaider(doc, win) {
  const canvas = doc.getElementById('vr-canvas');
  const gfx = initGfx(canvas, false);

  const hub = createInputHub();
  bindKeyboardInput(hub, win, win, doc);

  // Every session records its input stream. Determinism is a v1 requirement
  // (section 15), so the recorder runs from M1 rather than being retrofitted.
  const recorder = createInputRecorder();
  const state = createMainDebugState();

  let fps = 0;
  let fpsFrames = 0;
  let fpsLast = 0;

  function fitCanvas() {
    resizeGfx(gfx, win.innerWidth, win.innerHeight, win.devicePixelRatio);
  }
  fitCanvas();
  win.addEventListener('resize', fitCanvas);

  const loop = createLoop({
    now: () => win.performance.now() / 1000,
    schedule: (cb) => win.requestAnimationFrame(cb),
    update: () => {
      // sampleInput is called EXACTLY once per tick. It advances edge detection.
      const input = sampleInput(hub);
      recordInputFrame(recorder, input);
      updateMainDebug(state, input);
    },
    render: (alpha) => {
      fpsFrames++;
      const t = win.performance.now();
      if (t - fpsLast >= MAIN_FPS_WINDOW * 16) {
        fps = (fpsFrames * 1000) / (t - fpsLast);
        fpsFrames = 0;
        fpsLast = t;
      }
      mainRenderDebug(gfx, state, alpha, loop, fps);
    }
  });

  loop.start();
  return { loop, hub, gfx, state, recorder };
}

// Guarded so that importing main.js under Node (build checks, tooling) does not
// try to touch the DOM.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  bootVaultRaider(document, window);
}
