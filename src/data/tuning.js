// VAULT RAIDER - tuning constants. SPEC v0.7 section 6.
//
// THE ONLY PLACE CONSTANTS LIVE. No logic file may carry a magic number.
// Values here are transcribed from SPEC section 6; where SPEC states a value
// only in prose the source section is named in a comment.
//
// No DOM access. Safe to import from tests/.

export const TUNING = {
  tile: 8, gridW: 40, gridH: 30,          // 320x240
  logicalW: 320, logicalH: 240, dt: 1 / 60,
  maxSubsteps: 5, maxFrameSec: 0.25,

  // hitbox: 8 deleted at v0.5 - stale v0.2, contradicted section 4.1, and one
  // scalar cannot express two view states. Collision and hurt boxes are
  // separate concepts held at equal size on purpose; see the section 4.1 table.
  player: {
    speedRoom: 1.00, speedFloor: 1.10,
    hitboxFloor: 4, hitboxRoom: 6,        // section 4.1 collision box
    hurtboxFloor: 4, hurtboxRoom: 6,      // section 4.1 hurt box
    spriteFloor: 4, spriteRoom: 12,       // [v0.7] section 4.1, was prose-only
    snapAssistWindowPx: 2,                // section 4.1 doorway snap-assist
    snapAssistStepPx: 1,                  // section 4.1
    startingLives: 3,                     // [v0.7] section 4.1, was prose-only
    deathFreezeSec: 1.5, respawnInvulnSec: 2.0
  },

  // diagonalDodgeMul lives here rather than inside dodgeSkill, because
  // dodgeSkill is a tier map read as dodgeSkill[tier] and must stay pure.
  monster: {
    hurtbox: 8,                           // section 4.1, 4.4 - 8x8 centered
    diagonalDodgeMul: 0.5                 // [v0.7] section 4.4, was prose-only
  },

  arrow: { speed: 3.5, maxAlive: 1, windupTicks: 4, dodgeLookahead: 24 },

  zoom: { durationTicks: 24 },            // section 8 - ticks, never ms

  // section 9. Consumed at M10; here now so M10 cannot hardcode it inline.
  gamepad: { stickDeadzone: 0.35 },

  touch: {                                // section 17.2 - 17.6, device px
    knobDiameterDevicePx: 64,
    maxRadiusDevicePx: 40,
    deadzoneDevicePx: 12,
    fadeOutTicks: 8,
    sectorWidthDeg: 45,
    hysteresisDeg: 8,
    tapMaxTicks: 10,
    moveZoneFrac: 0.40,
    fireZoneFrac: 0.40,
    overlayMaxOpacity: 0.35
  },

  // Per-FLOOR intrusion clock. Never resets on room exit or on death.
  warden: {
    floorTimerSec: [45, 38, 32], intrusionWarnSec: 4,
    speedMul: [0.85, 0.95, 1.05], pursuitBiasRate: 0.02,
    pursuitBiasCap: 0.9,                  // [v0.7] section 4.3, was prose-only
    countByLayout: [2, 3, 4],
    hurtbox: 8                            // section 4.1, 4.3 - no collision box
  },

  corpse: {
    decayPhases: 4, phaseSec: 2.5,
    lethalToPlayer: true, blocksPlayer: true,
    blocksMonsters: false, blocksWarden: false
  },

  floorSpeedMul: [1.00, 1.08, 1.16, 1.24, 1.32, 1.40, 1.50, 1.60, 1.72],

  dodgeSkill: { LOW: 0.15, MED: 0.45, HIGH: 0.80 },

  scoring: {
    monsterKill: {
      CRAWLER: 100, BOUNCER: 150, DROPPER: 200,
      STALKER: 250, BRUTE: 300, BLINKER: 400
    },
    treasureByFloor: [400, 600, 800],
    floorClearBase: 1000,
    // [v0.7] The two terms of the section 6 bonus formula, previously inline
    // literals: mult = base + range * (remain / timer), giving 1.0 .. 5.0.
    floorClearMultBase: 1,
    floorClearMultRange: 4,
    extraLifeEvery: 20000
  },

  flags: {
    HALL_FIRE_ENABLED: true,
    CORPSE_SHOT_MODE: 'RESET_ONE',   // | 'RESET_ALL' - CONTESTED, decide by playtest
    DEATH_RESETS_FLOOR_TIMER: false, // must stay false; true is an exploit
    DEATH_CLEARS_CORPSES: true       // must stay true; false softlocks the run
  },

  a11y: {
    reducedFlash: false, colorblindCorpses: true, masterVolume: 0.7,
    maxLuminanceStepPerFrame: 0.10,       // section 11
    maxFlashHz: 3                         // section 11
  },

  // Floor indexing, SPEC section 2.1. Floor 10+ replays floor 9.
  maxFloorIndex: 8,
  layoutCount: 3
};

// ---------------------------------------------------------------------------
// SCHEDULER CONSTANTS - deliberately NOT part of TUNING.
//
// NOT TRANSCRIBED FROM SPEC. This is the one invented number in the project.
//
// It is segregated here because it is a SCHEDULER constant, not a SIMULATION
// constant, and that distinction is what makes it safe:
//
//   update() always receives a fixed DT. Wall-clock jitter changes WHEN a tick
//   fires, never WHAT happens inside one. Determinism is therefore unaffected -
//   but only while that separation holds.
//
// NO CODE REACHABLE FROM update() MAY READ THIS. If a game rule ever depends on
// it, the scheduler has entered the simulation and the approval is void.
// Only src/core/loop.js may import it.
//
// Cause: IEEE-754. A refresh rate whose frame time does not divide cleanly into
// one second leaves the accumulator a few ulps short of a whole step, so the
// loop runs a permanent one tick behind. 144 Hz is the case that bites - 144
// additions of 1/144 sum to just under 1.0, so the 60th update of every second
// slips a frame, forever (59, 119, 179 ...). A constant phase offset, not
// compounding drift. Far smaller than a tick, far larger than float noise.
//
// See docs/NOTES.md A7. Covered by tests/loop.mjs.
export const SCHEDULER = { accumulatorEpsilonSec: 1e-9 };

// 8-way direction sectors. Index 0..7, clockwise from North.
// Screen space: -y is North. DIR_NEUTRAL is -1.
export const DIR_NEUTRAL = -1;
export const DIR_COUNT = 8;

// Diagonals are normalised so all 8 directions move at the same speed.
// SPEC gives speed as a single px/tick scalar, which only holds if diagonals
// are normalised - see docs/NOTES.md A6.
export const DIAG_UNIT = Math.SQRT1_2;

export const DIRS = [
  { dx: 0, dy: -1, name: 'N', diagonal: false },
  { dx: DIAG_UNIT, dy: -DIAG_UNIT, name: 'NE', diagonal: true },
  { dx: 1, dy: 0, name: 'E', diagonal: false },
  { dx: DIAG_UNIT, dy: DIAG_UNIT, name: 'SE', diagonal: true },
  { dx: 0, dy: 1, name: 'S', diagonal: false },
  { dx: -DIAG_UNIT, dy: DIAG_UNIT, name: 'SW', diagonal: true },
  { dx: -1, dy: 0, name: 'W', diagonal: false },
  { dx: -DIAG_UNIT, dy: -DIAG_UNIT, name: 'NW', diagonal: true }
];

// SPEC section 8 state machine.
export const GAME_PHASES = {
  BOOT: 'BOOT',
  ATTRACT: 'ATTRACT',
  INTRO_WALK: 'INTRO_WALK',
  FLOOR_VIEW: 'FLOOR_VIEW',
  ROOM_ZOOM_IN: 'ROOM_ZOOM_IN',
  ROOM_VIEW: 'ROOM_VIEW',
  ROOM_ZOOM_OUT: 'ROOM_ZOOM_OUT',
  STAIRS: 'STAIRS',
  FLOOR_CLEAR_BONUS: 'FLOOR_CLEAR_BONUS',
  PLAYER_DEATH: 'PLAYER_DEATH',
  GAME_OVER: 'GAME_OVER',
  HIGH_SCORE: 'HIGH_SCORE'
};

// SPEC section 4.4.
export const ARCHETYPES = {
  CRAWLER: 'CRAWLER', BOUNCER: 'BOUNCER', DROPPER: 'DROPPER',
  STALKER: 'STALKER', BRUTE: 'BRUTE', BLINKER: 'BLINKER'
};

// SPEC sections 7.1 / 7.2 mask characters.
export const TILE_CHARS = { WALL: '#', FLOOR: '.' };

// SPEC section 9 keyboard bindings. Device specifics live in the binding layer,
// but the key names themselves are constants and belong here.
export const KEY_BINDINGS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  fire: ['Space', 'KeyJ'],
  pause: ['KeyP', 'Escape'],
  mute: ['KeyM']
};
