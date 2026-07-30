// VAULT RAIDER - input model. SPEC v0.6 sections 9, 17.1, 17.1.1.
//
// SPEC 17.7 defines this file's M11 contents (touch maths: sector mapping,
// hysteresis, deadzone, tap-to-reface, and the touch-vs-keyboard stream hash).
// Seeded at M1 with the source-agnostic assertions, because the arbitration fix
// in setSourceIntent had zero regression coverage and M1 is the milestone whose
// mistakes cannot be retrofitted. test-engineer extends this at M11.
//
// Zero dependencies. Node only, no DOM.

import { DIR_NEUTRAL } from '../src/data/tuning.js';
import {
  createInputHub, registerInputSource, setSourceIntent, setSourceFireHeld,
  sampleInput, releaseAllInput, cardinalToSector,
  encodeInputFrame, decodeInputFrame, INPUT_SOURCE_IDS
} from '../src/core/input.js';

let failures = 0;

function assert(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${detail || ''}`}`);
}

function check(name, actual, expected) {
  assert(name, actual === expected, `expected ${expected}, got ${actual}`);
}

const KBD = INPUT_SOURCE_IDS.KEYBOARD;
const PAD = INPUT_SOURCE_IDS.GAMEPAD;

console.log('# sector mapping, all 8 directions plus neutral');
{
  const cases = [
    ['N', 0, -1, 0], ['NE', 1, -1, 1], ['E', 1, 0, 2], ['SE', 1, 1, 3],
    ['S', 0, 1, 4], ['SW', -1, 1, 5], ['W', -1, 0, 6], ['NW', -1, -1, 7]
  ];
  for (const [name, ax, ay, expected] of cases) {
    check(`${name} -> sector ${expected}`, cardinalToSector(ax, ay), expected);
  }
  check('no input -> DIR_NEUTRAL', cardinalToSector(0, 0), DIR_NEUTRAL);
}

console.log('\n# fire is an EDGE detected at the source, for ANY source (section 9)');
{
  // Not keyboard-specific: the same generic path must hold for a polled source.
  for (const id of [KBD, PAD]) {
    const hub = createInputHub();
    registerInputSource(hub, id);
    setSourceFireHeld(hub, id, true);
    const a = sampleInput(hub);
    const b = sampleInput(hub);
    const c = sampleInput(hub);
    assert(`${id}: held fire yields exactly one edge`,
      a.fire === true && b.fire === false && c.fire === false,
      `${a.fire}/${b.fire}/${c.fire}`);

    setSourceFireHeld(hub, id, false);
    sampleInput(hub);
    setSourceFireHeld(hub, id, true);
    assert(`${id}: release then re-press yields a new edge`, sampleInput(hub).fire === true);
  }
}

console.log('\n# ARBITRATION: recency means most recently CHANGED, not most recently polled');
{
  // THE regression test for the setSourceIntent fix.
  //
  // Section 9 requires gamepad to be polled every tick. Before the fix,
  // lastIntentTick advanced on every setSourceIntent call, so a held gamepad
  // direction refreshed its timestamp continuously and would out-rank a
  // keyboard direction the player had actually just pressed.
  //
  // ORDERING IS LOAD-BEARING. The pad must keep re-polling AFTER the keyboard
  // press, on strictly later ticks. An earlier draft of this test polled the
  // pad only before the keypress, which left both sources on the same
  // lastIntentTick - the registration-order tie-break then handed the win to
  // the keyboard and the test passed against the BROKEN implementation too.
  // Verified: this version fails pre-fix and passes post-fix.
  const hub = createInputHub();
  registerInputSource(hub, KBD);
  registerInputSource(hub, PAD);

  setSourceIntent(hub, PAD, 0, 0);              // pad North - its one real change
  sampleInput(hub);
  setSourceIntent(hub, KBD, 2, 2);              // keyboard East - a real change, later

  // Now the pad keeps being polled every tick with an UNCHANGED value, exactly
  // as section 9 requires of a gamepad. Pre-fix this walks its timestamp past
  // the keyboard's and steals the arbitration.
  for (let i = 0; i < 8; i++) {
    setSourceIntent(hub, PAD, 0, 0);
    sampleInput(hub);
  }
  setSourceIntent(hub, PAD, 0, 0);

  const winner = sampleInput(hub);
  check('keyboard beats a gamepad that has only been re-polled', winner.dir, 2);
  check('facingLatch comes from the same winning source', winner.facingLatch, 2);
}

console.log('\n# ARBITRATION: re-expressing the SAME direction after neutral counts as fresh');
{
  // The edge case: a source releases and then presses the same key again. The
  // comparison target is the live stored value, which releaseAllInput has set
  // to neutral - so the re-press must register as a change.
  const hub = createInputHub();
  registerInputSource(hub, KBD);
  registerInputSource(hub, PAD);

  setSourceIntent(hub, KBD, 2, 2);              // keyboard East
  sampleInput(hub);
  releaseAllInput(hub);                          // everything to neutral
  sampleInput(hub);
  setSourceIntent(hub, PAD, 0, 0);              // pad North becomes most recent
  sampleInput(hub);
  setSourceIntent(hub, KBD, 2, 2);              // keyboard re-presses East

  check('re-press after neutral wins over an older source', sampleInput(hub).dir, 2);
}

console.log('\n# ARBITRATION: a source holding an unchanged direction still reports it');
{
  // Freezing lastIntentTick must not make a held direction stop working when
  // it is the only source with intent.
  const hub = createInputHub();
  registerInputSource(hub, PAD);
  setSourceIntent(hub, PAD, 4, 4);
  let last = null;
  for (let i = 0; i < 10; i++) {
    setSourceIntent(hub, PAD, 4, 4);            // unchanged re-poll
    last = sampleInput(hub);
  }
  check('held direction still reported after 10 unchanged polls', last.dir, 4);
}

console.log('\n# facingLatch is an EVENT; movement and facing are separable (17.1.1)');
{
  const hub = createInputHub();
  registerInputSource(hub, KBD);

  setSourceIntent(hub, KBD, 2, 2);
  const held = sampleInput(hub);
  assert('held direction emits both dir and facingLatch',
    held.dir === 2 && held.facingLatch === 2);

  // 17.1.1's counter-example table: facingLatch stays non-neutral for the whole
  // hold. It is the struct that is per-tick, not the latch value.
  const held2 = sampleInput(hub);
  check('facingLatch persists across a sustained hold', held2.facingLatch, 2);

  setSourceIntent(hub, KBD, DIR_NEUTRAL, DIR_NEUTRAL);
  const released = sampleInput(hub);
  assert('release drives the struct neutral',
    released.dir === DIR_NEUTRAL && released.facingLatch === DIR_NEUTRAL);

  // Tap-to-reface shape (17.4). Expressible at M1 with no touch code existing.
  setSourceIntent(hub, KBD, DIR_NEUTRAL, 6);
  const reface = sampleInput(hub);
  assert('facing without movement is expressible',
    reface.dir === DIR_NEUTRAL && reface.facingLatch === 6);
}

console.log('\n# release clears intent without manufacturing a fire edge (17.6)');
{
  const hub = createInputHub();
  registerInputSource(hub, KBD);
  setSourceIntent(hub, KBD, 4, 4);
  setSourceFireHeld(hub, KBD, true);
  sampleInput(hub);                              // consumes the real edge
  releaseAllInput(hub);
  const after = sampleInput(hub);
  check('dir cleared', after.dir, DIR_NEUTRAL);
  check('facingLatch cleared', after.facingLatch, DIR_NEUTRAL);
  check('no phantom fire edge', after.fire, false);
}

console.log('\n# the struct is exactly three fields, whatever the source count');
{
  const hub = createInputHub();
  registerInputSource(hub, KBD);
  registerInputSource(hub, PAD);
  registerInputSource(hub, INPUT_SOURCE_IDS.TOUCH);
  const keys = Object.keys(sampleInput(hub)).sort().join(',');
  check('one struct shape', keys, 'dir,facingLatch,fire');
}

console.log('\n# frame codec round-trips every reachable combination');
{
  let bad = 0;
  for (let d = -1; d < 8; d++) {
    for (let f = -1; f < 8; f++) {
      for (const fire of [true, false]) {
        const r = decodeInputFrame(encodeInputFrame({ dir: d, facingLatch: f, fire }));
        if (r.dir !== d || r.facingLatch !== f || r.fire !== fire) bad++;
      }
    }
  }
  check('all 162 combinations round-trip', bad, 0);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} tests/input.mjs`);
process.exit(failures === 0 ? 0 : 1);
