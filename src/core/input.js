// VAULT RAIDER - unified input model. SPEC v0.6 sections 9, 17.1, 17.1.1.
//
// THE ONLY THING GAME LOGIC READS FOR INPUT.
//
// Three sources (keyboard, gamepad, touch), ONE per-tick struct, ONE consumer:
//
//     { dir: 0..7 | -1,          MOVEMENT intent only
//       fire: bool,              EDGE, detected at the source (section 9)
//       facingLatch: 0..7 | -1 } EVENT: a direction was expressed this tick
//
// Two rules that this file exists to enforce, both from section 17.1.1:
//
//   1. facingLatch is an EVENT with a one-tick lifetime. It is NOT state, and
//      must never be read as PIP's current facing. PIP's persistent entity
//      facing lives on the entity and updates only when facingLatch !== -1.
//
//   2. fire is edge-detected HERE, at the source, before the struct is built -
//      for all three sources, not just touch. Keyboard auto-repeat fires
//      keydown continuously while a key is held; a held gamepad button is level
//      too. Edge-detecting downstream in game code would be a second input path
//      and would break section 17.1.
//
// Sources are generic. A source is added by calling registerInputSource and
// then pushing intent through setSourceIntent / setSourceFireHeld. There is no
// per-source branch anywhere in the reduction, which is what makes touch a
// third SOURCE at M11 rather than a second PATH.
//
// No DOM access at import time. The bind* functions touch the DOM only when
// called, and only main.js calls them. Safe to import from tests/.

import { DIR_NEUTRAL, KEY_BINDINGS } from '../data/tuning.js';

export const INPUT_SOURCE_IDS = { KEYBOARD: 'kbd', GAMEPAD: 'pad', TOUCH: 'touch' };

export const INPUT_NEUTRAL_SAMPLE = Object.freeze({
  dir: DIR_NEUTRAL, fire: false, facingLatch: DIR_NEUTRAL
});

// Bit widths for encodeInputFrame. A sector is stored as sector+1 so that
// DIR_NEUTRAL (-1) becomes 0 and the whole frame packs into 9 bits.
const INPUT_SECTOR_BIAS = 1;
const INPUT_SECTOR_MASK = 0xf;
const INPUT_FACING_SHIFT = 4;
const INPUT_FIRE_BIT = 1 << 8;

export function createInputHub() {
  return { sources: [], byId: new Map(), tick: 0 };
}

export function registerInputSource(hub, id) {
  if (hub.byId.has(id)) return hub.byId.get(id);
  const source = {
    id,
    order: hub.sources.length,
    moveSector: DIR_NEUTRAL,
    faceSector: DIR_NEUTRAL,
    fireHeld: false,
    firePrev: false,
    lastIntentTick: -1
  };
  hub.sources.push(source);
  hub.byId.set(id, source);
  return source;
}

// The generic intent setter. Every source funnels through this.
//
// moveSector: 0..7 to move, DIR_NEUTRAL for none.
// faceSector: 0..7 to express a direction, DIR_NEUTRAL for none.
//
// Keyboard and gamepad pass the same sector for both on a held direction.
// Touch tap-to-reface (section 17.4) passes moveSector = DIR_NEUTRAL with a
// real faceSector - that asymmetry is the whole reason these are two arguments.
export function setSourceIntent(hub, id, moveSector, faceSector) {
  const source = hub.byId.get(id);
  if (!source) return;

  // lastIntentTick advances only when the intent CHANGES, never merely because
  // the setter was called again with the same values.
  //
  // This keeps arbitration symmetric between event-driven and polled sources.
  // Keyboard pushes intent on keydown/keyup transitions; gamepad (section 9)
  // must be polled every tick. If a re-poll refreshed the timestamp, a held
  // gamepad direction would out-rank a keyboard direction the player was
  // actively using, purely because one source repeats itself and the other
  // does not. "Most recently active" has to mean most recently CHANGED.
  const changed = moveSector !== source.moveSector || faceSector !== source.faceSector;
  source.moveSector = moveSector;
  source.faceSector = faceSector;

  const hasIntent = moveSector !== DIR_NEUTRAL || faceSector !== DIR_NEUTRAL;
  if (changed && hasIntent) source.lastIntentTick = hub.tick;
}

export function setSourceFireHeld(hub, id, held) {
  const source = hub.byId.get(id);
  if (!source) return;
  source.fireHeld = !!held;
}

// pointercancel and visibilitychange must both land here (section 17.6). An
// incoming call that leaves dir latched will kill the player.
export function releaseAllInput(hub) {
  for (const source of hub.sources) {
    source.moveSector = DIR_NEUTRAL;
    source.faceSector = DIR_NEUTRAL;
    source.fireHeld = false;
    // firePrev is deliberately NOT cleared. Clearing it would let a button
    // still physically held at the moment focus returns read as a fresh edge.
  }
}

// Reduce all sources to the one struct.
//
// MUST be called exactly once per tick: it advances each source's edge-detection
// state. Calling it twice in a tick silently eats a fire edge.
export function sampleInput(hub) {
  let fire = false;
  let winner = null;

  for (const source of hub.sources) {
    // Edge detection, at the source, before the struct is built.
    if (source.fireHeld && !source.firePrev) fire = true;
    source.firePrev = source.fireHeld;

    const hasIntent =
      source.moveSector !== DIR_NEUTRAL || source.faceSector !== DIR_NEUTRAL;
    if (!hasIntent) continue;

    // Most recently active source wins; ties break by registration order so the
    // result is deterministic regardless of Map iteration details.
    if (
      winner === null ||
      source.lastIntentTick > winner.lastIntentTick ||
      (source.lastIntentTick === winner.lastIntentTick && source.order < winner.order)
    ) {
      winner = source;
    }
  }

  hub.tick++;

  if (winner === null) return { dir: DIR_NEUTRAL, fire, facingLatch: DIR_NEUTRAL };
  return { dir: winner.moveSector, fire, facingLatch: winner.faceSector };
}

// Cardinal key bits -> sector. ax and ay are each -1, 0, or 1; ay is screen
// space, so -1 is North. Opposed keys cancel before they reach here.
export function cardinalToSector(ax, ay) {
  if (ax === 0 && ay === 0) return DIR_NEUTRAL;
  if (ax === 0) return ay < 0 ? 0 : 4;
  if (ay === 0) return ax > 0 ? 2 : 6;
  if (ax > 0) return ay < 0 ? 1 : 3;
  return ay < 0 ? 7 : 5;
}

// --- replay ---------------------------------------------------------------
// A frame packs into 9 bits, so a recorded stream is a plain array of small
// ints and needs no serialisation format.

export function encodeInputFrame(sample) {
  const dir = (sample.dir + INPUT_SECTOR_BIAS) & INPUT_SECTOR_MASK;
  const face = (sample.facingLatch + INPUT_SECTOR_BIAS) & INPUT_SECTOR_MASK;
  return dir | (face << INPUT_FACING_SHIFT) | (sample.fire ? INPUT_FIRE_BIT : 0);
}

export function decodeInputFrame(packed) {
  return {
    dir: (packed & INPUT_SECTOR_MASK) - INPUT_SECTOR_BIAS,
    facingLatch: ((packed >> INPUT_FACING_SHIFT) & INPUT_SECTOR_MASK) - INPUT_SECTOR_BIAS,
    fire: (packed & INPUT_FIRE_BIT) !== 0
  };
}

// Recorder and player ship at M1, not at M9 when determinism.mjs is written
// (section 12.1.2). Headless, DOM-free, and source-agnostic: a stream recorded
// from touch replays identically to the keyboard equivalent, which is the
// property tests/input.mjs asserts at M11.
export function createInputRecorder() {
  return { frames: [] };
}

export function recordInputFrame(recorder, sample) {
  recorder.frames.push(encodeInputFrame(sample));
  return sample;
}

export function createInputPlayer(frames) {
  return { frames, index: 0 };
}

// Past the end of the stream a player returns neutral forever rather than
// throwing, so a replay can run longer than it was recorded.
export function playInputFrame(player) {
  if (player.index >= player.frames.length) return { ...INPUT_NEUTRAL_SAMPLE };
  return decodeInputFrame(player.frames[player.index++]);
}

// --- DOM bindings ---------------------------------------------------------
// Called only from main.js. Never at import time.

export function bindKeyboardInput(hub, target, windowRef, doc) {
  registerInputSource(hub, INPUT_SOURCE_IDS.KEYBOARD);
  const held = new Set();

  const codeIn = (list, code) => list.indexOf(code) !== -1;

  function refresh() {
    let ax = 0;
    let ay = 0;
    // Opposed keys cancel rather than latching whichever arrived last.
    for (const code of held) {
      if (codeIn(KEY_BINDINGS.up, code)) ay -= 1;
      if (codeIn(KEY_BINDINGS.down, code)) ay += 1;
      if (codeIn(KEY_BINDINGS.left, code)) ax -= 1;
      if (codeIn(KEY_BINDINGS.right, code)) ax += 1;
    }
    ax = Math.sign(ax);
    ay = Math.sign(ay);
    const sector = cardinalToSector(ax, ay);
    // Keyboard expresses movement and facing together (section 17.1.1).
    setSourceIntent(hub, INPUT_SOURCE_IDS.KEYBOARD, sector, sector);

    let firing = false;
    for (const code of held) if (codeIn(KEY_BINDINGS.fire, code)) firing = true;
    // Level, not edge. sampleInput does the edge detection - which is what makes
    // keyboard auto-repeat harmless here.
    setSourceFireHeld(hub, INPUT_SOURCE_IDS.KEYBOARD, firing);
  }

  function isGameKey(code) {
    return codeIn(KEY_BINDINGS.up, code) || codeIn(KEY_BINDINGS.down, code) ||
      codeIn(KEY_BINDINGS.left, code) || codeIn(KEY_BINDINGS.right, code) ||
      codeIn(KEY_BINDINGS.fire, code);
  }

  function onKeyDown(e) {
    if (!isGameKey(e.code)) return;
    // section 9: stop page scroll and button re-activation.
    e.preventDefault();
    held.add(e.code);
    refresh();
  }

  function onKeyUp(e) {
    if (!isGameKey(e.code)) return;
    e.preventDefault();
    held.delete(e.code);
    refresh();
  }

  function onRelease() {
    held.clear();
    releaseAllInput(hub);
  }

  target.addEventListener('keydown', onKeyDown, { passive: false });
  target.addEventListener('keyup', onKeyUp, { passive: false });
  // A key held while the tab loses focus never delivers its keyup.
  windowRef.addEventListener('blur', onRelease);
  // visibilitychange is dispatched at the DOCUMENT, not at window. It does
  // bubble, so a window listener happens to work - but document is the
  // specified target, and this binding is the template that bindGamepadInput
  // (M10) and bindTouchInput (M11) will copy. Bind it where the spec puts it.
  doc.addEventListener('visibilitychange', onRelease);

  return function unbindKeyboardInput() {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    windowRef.removeEventListener('blur', onRelease);
    doc.removeEventListener('visibilitychange', onRelease);
  };
}
