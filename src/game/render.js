// VAULT RAIDER - scene composition. SPEC v0.7 sections 2, 13, 17.6.
//
// Owns WHAT the scene looks like. core/gfx.js owns HOW pixels get to the
// canvas (init, scaling, viewport, blit). Neither is imported by tests/.
//
// Sprites arrive at M3; M2 renders with primitives.

import { TUNING, DIRS, GAME_PHASES } from '../data/tuning.js';
import { gfxBeginFrame, gfxFillRect, gfxDrawDebugText, gfxEndFrame } from '../core/gfx.js';
import { floorElapsedSec } from './floor.js';

// Palette. Per-floor palette swapping arrives with the sprite atlas at M3.
const PAL_VOID = '#05050a';
const PAL_WALL = '#2a2a44';
const PAL_WALL_TOP = '#3c3c60';
const PAL_FLOOR = '#12121e';
const PAL_ROOM = '#1e1a2e';
const PAL_DOOR = '#c8a020';
const PAL_STAIRS = '#40c880';
const PAL_PIP = '#f8f0c0';
const PAL_FACING = '#e04030';
const PAL_ARROW = '#f8f0c0';
const PAL_WARDEN = '#d02040';
const PAL_WARDEN_EYE = '#f8f0c0';
const PAL_HUD = '#8090b0';

const HUD_TEXT_PX = 6;
const HUD_MARGIN = 3;
const FACING_PIP_PX = 2;
const FACING_PIP_DIST = 5;

// DERIVED from the a11y flash cap, never hardcoded (section 11: nothing in the
// game may flash above maxFlashHz). A literal 4 here was a 7.5 Hz blink - over
// the cap, and the cap already existed in tuning.js unconsulted. One full
// on/off cycle spans two of these, hence the 2.
const INVULN_BLINK_TICKS = Math.ceil(1 / (TUNING.a11y.maxFlashHz * 2 * TUNING.dt));

function lerp(a, b, t) { return a + (b - a) * t; }

export function renderFrame(gfx, state, alpha) {
  gfxBeginFrame(gfx, PAL_VOID);
  renderFloorView(gfx, state, alpha);
  renderHud(gfx, state);
  gfxEndFrame(gfx);
}

export function renderFloorView(gfx, state, alpha) {
  const floor = state.floor;
  const t = TUNING.tile;

  // Mask. Wall tops get a lighter edge so corridors read as corridors at 1x.
  for (let ty = 0; ty < floor.mask.length; ty++) {
    const row = floor.mask[ty];
    for (let tx = 0; tx < row.length; tx++) {
      if (row[tx] === '.') {
        gfxFillRect(gfx, tx * t, ty * t, t, t, PAL_FLOOR);
      } else {
        const openAbove = ty > 0 && floor.mask[ty - 1][tx] === '.';
        gfxFillRect(gfx, tx * t, ty * t, t, t, openAbove ? PAL_WALL_TOP : PAL_WALL);
      }
    }
  }

  // Room blocks and their doors.
  for (const room of floor.layout.rooms) {
    const [rx, ry, rw, rh] = room.rect;
    gfxFillRect(gfx, rx * t, ry * t, rw * t, rh * t, PAL_ROOM);
    gfxFillRect(gfx, room.door.tx * t, room.door.ty * t, t, t,
      floor.looted[room.id] ? PAL_WALL : PAL_DOOR);
  }

  // Stairs.
  const st = floor.layout.stairs;
  gfxFillRect(gfx, st.tx * t + 1, st.ty * t + 1, t - 2, t - 2, PAL_STAIRS);

  // Arrow. Real and useless in the hall (section 3.2) - drawn so the player
  // can see it pass straight through a WARDEN.
  const arrow = floor.arrow;
  if (arrow.alive) {
    gfxFillRect(gfx, Math.round(arrow.x) - 1, Math.round(arrow.y) - 1, 2, 2, PAL_ARROW);
  }

  // WARDENs.
  for (const w of floor.wardens) {
    const wx = Math.round(lerp(w.prevX, w.x, alpha));
    const wy = Math.round(lerp(w.prevY, w.y, alpha));
    const s = TUNING.warden.hurtbox;
    gfxFillRect(gfx, wx, wy, s, s, PAL_WARDEN);
    // Distinct silhouette, not hue alone (section 11 contrast requirement).
    gfxFillRect(gfx, wx + 2, wy + 2, 2, 2, PAL_WARDEN_EYE);
    gfxFillRect(gfx, wx + s - 4, wy + 2, 2, 2, PAL_WARDEN_EYE);
  }

  // PIP.
  const p = floor.player;
  const blinking = p.invulnTicks > 0 &&
    Math.floor(p.invulnTicks / INVULN_BLINK_TICKS) % 2 === 0;
  if (state.phase !== GAME_PHASES.GAME_OVER && !blinking) {
    const px = Math.round(lerp(p.prevX, p.x, alpha));
    const py = Math.round(lerp(p.prevY, p.y, alpha));
    const s = TUNING.player.hitboxFloor;
    gfxFillRect(gfx, px, py, s, s, PAL_PIP);
    // Facing indicator. Persists with no keys held - that is section 17.1.1
    // made visible, and the fastest way to spot a regression by eye.
    const d = DIRS[p.facing];
    gfxFillRect(gfx,
      Math.round(px + s / 2 + d.dx * FACING_PIP_DIST - FACING_PIP_PX / 2),
      Math.round(py + s / 2 + d.dy * FACING_PIP_DIST - FACING_PIP_PX / 2),
      FACING_PIP_PX, FACING_PIP_PX, PAL_FACING);
  }
}

export function renderHud(gfx, state) {
  // Section 17.6: HUD pins to the TOP edge. Never the bottom corners - thumbs
  // cover them on a phone.
  const floor = state.floor;
  const elapsed = floorElapsedSec(floor);
  const limit = floor.descriptor.floorTimerSec;
  const left = Math.max(0, limit - elapsed);

  const line = 'FLOOR ' + (floor.descriptor.floorIndex + 1) +
    '   LIVES ' + floor.player.lives +
    '   SCORE ' + state.score +
    '   CLOCK ' + left.toFixed(1);
  gfxDrawDebugText(gfx, line, HUD_MARGIN, HUD_MARGIN, PAL_HUD, HUD_TEXT_PX);

  if (state.phase === GAME_PHASES.GAME_OVER) {
    gfxDrawDebugText(gfx, 'GAME OVER',
      TUNING.logicalW / 2 - 24, TUNING.logicalH / 2 - 4, PAL_PIP, HUD_TEXT_PX * 2);
  }
}
