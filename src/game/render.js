// VAULT RAIDER - scene composition. SPEC v0.7 sections 2, 13, 17.6.
//
// Owns WHAT the scene looks like. core/gfx.js owns HOW pixels get to the
// canvas (init, scaling, viewport, blit). Neither is imported by tests/.
//
// Sprites arrive at M3; M2 renders with primitives.

import { TUNING, DIRS, GAME_PHASES } from '../data/tuning.js';
import { intrusionWarningLevel, playerOnSafeTile } from './room.js';
import {
  gfxBeginFrame, gfxFillRect, gfxStrokeRect, gfxDrawDebugText, gfxEndFrame
} from '../core/gfx.js';
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
const PAL_MONSTER = '#40b060';
const PAL_MONSTER_EDGE = '#a8f0c0';
const PAL_CORPSE = '#785060';
const PAL_CORPSE_HATCH = '#c8a0b0';
const PAL_TREASURE = '#f0c840';
const PAL_SAFE = '#2a4a3a';
const PAL_WARN = '#e04030';

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
  switch (state.phase) {
    case GAME_PHASES.ROOM_VIEW:
      renderRoomView(gfx, state, alpha);
      break;
    case GAME_PHASES.ROOM_ZOOM_IN:
    case GAME_PHASES.ROOM_ZOOM_OUT:
      renderZoom(gfx, state, alpha);
      break;
    default:
      renderFloorView(gfx, state, alpha);
      break;
  }
  renderHud(gfx, state);
  gfxEndFrame(gfx);
}

// Section 8: 24-tick scale-lerp of the room rect to full screen. Duration is in
// TICKS, never ms. Non-interactive, and the floor clock keeps running.
export function renderZoom(gfx, state, alpha) {
  const t = Math.min(1, (state.zoomTicks + alpha) / TUNING.zoom.durationTicks);
  const grow = state.phase === GAME_PHASES.ROOM_ZOOM_IN ? t : 1 - t;
  renderFloorView(gfx, state, alpha);
  // Iris: a growing dark frame closing over the floor, so the transition reads
  // as travel rather than a hard cut. Luminance changes gradually - section 11
  // caps full-screen luminance change per frame under reducedFlash.
  const inset = Math.round((1 - grow) * TUNING.logicalW / 2);
  const w = TUNING.logicalW;
  const h = TUNING.logicalH;
  gfxFillRect(gfx, 0, 0, w, Math.max(0, h / 2 - inset * h / w), PAL_VOID);
  gfxFillRect(gfx, 0, h - Math.max(0, h / 2 - inset * h / w), w, Math.max(0, h / 2 - inset * h / w), PAL_VOID);
  gfxFillRect(gfx, 0, 0, Math.max(0, w / 2 - inset), h, PAL_VOID);
  gfxFillRect(gfx, w - Math.max(0, w / 2 - inset), 0, Math.max(0, w / 2 - inset), h, PAL_VOID);
}

export function renderRoomView(gfx, state, alpha) {
  const room = state.room;
  const t = TUNING.tile;

  for (let ty = 0; ty < room.tiles.length; ty++) {
    const row = room.tiles[ty];
    for (let tx = 0; tx < row.length; tx++) {
      if (row[tx] === '.') {
        gfxFillRect(gfx, tx * t, ty * t, t, t, PAL_FLOOR);
      } else {
        const openAbove = ty > 0 && room.tiles[ty - 1][tx] === '.';
        gfxFillRect(gfx, tx * t, ty * t, t, t, openAbove ? PAL_WALL_TOP : PAL_WALL);
      }
    }
  }

  for (const door of room.def.doors) {
    gfxFillRect(gfx, door.tx * t, door.ty * t, t, t, PAL_DOOR);
  }

  // Treasure and its safe tile. Section 3.7 - standing here makes PIP
  // unkillable, so the tile is drawn distinctly rather than left implicit.
  if (!room.treasureTaken) {
    const tr = room.def.treasure;
    if (tr.safeTile) gfxFillRect(gfx, tr.tx * t, tr.ty * t, t, t, PAL_SAFE);
    gfxFillRect(gfx, tr.tx * t + 1, tr.ty * t + 2, t - 2, t - 4, PAL_TREASURE);
    gfxFillRect(gfx, tr.tx * t + 2, tr.ty * t + t - 3, t - 4, 2, PAL_TREASURE);
  }

  // Corpses. Section 11: lethality must NEVER be conveyed by hue alone, so
  // every decay phase carries a diagonal hatch and a broken silhouette.
  for (const corpse of room.corpses) {
    const cx = corpse.tx * t;
    const cy = corpse.ty * t;
    // Section 11: lethality must NEVER be conveyed by hue alone, at EVERY decay
    // phase - and the last phase is when a mistake costs most.
    //
    // Two arithmetic mistakes were made here before this shape survived. A
    // fixed 2px diagonal stride left ONE hatch pixel at the final phase. Then
    // scaling the stride to the span still left only TWO, because letting the
    // box shrink by a pixel per phase makes it 2x2 by phase 3 and a 2x2 box
    // cannot hold three diagonal marks - the geometry, not the stride, was the
    // limit. Counts are asserted in tests/rooms.mjs rather than claimed here.
    const shrink = Math.min(corpse.phase, TUNING.corpse.decayPhases - 2);
    const span = t - shrink * 2;
    gfxFillRect(gfx, cx + shrink, cy + shrink, span, span, PAL_CORPSE);

    const stride = Math.max(1, Math.floor(span / 3));
    for (let i = 0; i < span; i += stride) {
      gfxFillRect(gfx, cx + shrink + i, cy + shrink + (span - 1 - i), 1, 1, PAL_CORPSE_HATCH);
    }
    // The last phase shares a size with the one before it, so it needs a
    // different SHAPE to stay a "distinct broken silhouette": the second
    // diagonal turns the hatch into an X.
    if (corpse.phase >= TUNING.corpse.decayPhases - 1) {
      for (let i = 0; i < span; i += stride) {
        gfxFillRect(gfx, cx + shrink + i, cy + shrink + i, 1, 1, PAL_CORPSE_HATCH);
      }
    }
  }

  for (const monster of room.monsters) {
    if (!monster.alive) continue;
    const mx = Math.round(lerp(monster.prevX, monster.x, alpha));
    const my = Math.round(lerp(monster.prevY, monster.y, alpha));
    const s = TUNING.monster.hurtbox;
    gfxFillRect(gfx, mx, my, s, s, PAL_MONSTER);
    // Distinct silhouette from PIP at 1x, greyscale-safe (section 11).
    gfxFillRect(gfx, mx, my + s - 2, s, 2, PAL_MONSTER_EDGE);
    gfxFillRect(gfx, mx + 1, my + 1, 2, 2, PAL_MONSTER_EDGE);
  }

  if (room.arrow.alive) {
    gfxFillRect(gfx,
      Math.round(lerp(room.arrow.prevX, room.arrow.x, alpha)) - 1,
      Math.round(lerp(room.arrow.prevY, room.arrow.y, alpha)) - 1, 2, 2, PAL_ARROW);
  }

  if (room.intruder) {
    const w = room.intruder;
    const wx = Math.round(lerp(w.prevX, w.x, alpha));
    const wy = Math.round(lerp(w.prevY, w.y, alpha));
    const s = TUNING.warden.hurtbox;
    gfxFillRect(gfx, wx, wy, s, s, PAL_WARDEN);
    gfxFillRect(gfx, wx + 2, wy + 2, 2, 2, PAL_WARDEN_EYE);
    gfxFillRect(gfx, wx + s - 4, wy + 2, 2, 2, PAL_WARDEN_EYE);
  }

  renderPip(gfx, state, alpha, TUNING.player.hitboxRoom,
    playerOnSafeTile(room, state.floor.player));
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
    gfxFillRect(gfx,
      Math.round(lerp(arrow.prevX, arrow.x, alpha)) - 1,
      Math.round(lerp(arrow.prevY, arrow.y, alpha)) - 1, 2, 2, PAL_ARROW);
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

  renderPip(gfx, state, alpha, TUNING.player.hitboxFloor, false);
}

function renderPip(gfx, state, alpha, size, safe) {
  const p = state.floor.player;
  const blinking = p.invulnTicks > 0 &&
    Math.floor(p.invulnTicks / INVULN_BLINK_TICKS) % 2 === 0;
  if (state.phase === GAME_PHASES.GAME_OVER || blinking) return;

  const px = Math.round(lerp(p.prevX, p.x, alpha));
  const py = Math.round(lerp(p.prevY, p.y, alpha));
  gfxFillRect(gfx, px, py, size, size, PAL_PIP);
  // A ring while standing on the safe tile, so invulnerability is visible
  // rather than something the player has to infer (section 11).
  if (safe) {
    gfxStrokeRect(gfx, px - 1.5, py - 1.5, size + 3, size + 3, PAL_TREASURE, 1);
  }
  // Facing indicator. Persists with no keys held - section 17.1.1 made visible,
  // and the fastest way to spot a regression by eye.
  const d = DIRS[p.facing];
  gfxFillRect(gfx,
    Math.round(px + size / 2 + d.dx * FACING_PIP_DIST - FACING_PIP_PX / 2),
    Math.round(py + size / 2 + d.dy * FACING_PIP_DIST - FACING_PIP_PX / 2),
    FACING_PIP_PX, FACING_PIP_PX, PAL_FACING);
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

  // SECTION 11: NO AUDIO-ONLY INFORMATION. The intrusion siren must have a
  // matching persistent on-screen indicator - border pulse plus countdown pips
  // - so a muted or deaf player gets the same warning at the same moment.
  const warn = intrusionWarningLevel(floor.descriptor, elapsed);
  if (warn > 0) {
    // Steady ramp, not a strobe. Nothing may flash above a11y.maxFlashHz.
    const inset = 0;
    gfxStrokeRect(gfx, inset, inset,
      TUNING.logicalW - inset * 2, TUNING.logicalH - inset * 2, PAL_WARN, 1 + Math.round(warn * 2));
    // Countdown pips: one per remaining warning second, top-centre.
    const pips = Math.ceil((1 - warn) * TUNING.warden.intrusionWarnSec);
    for (let i = 0; i < pips; i++) {
      gfxFillRect(gfx, TUNING.logicalW / 2 - 10 + i * 5, HUD_MARGIN + 8, 3, 3, PAL_WARN);
    }
  }
  if (state.room && state.room.intruder) {
    gfxDrawDebugText(gfx, 'WARDEN IN ROOM',
      TUNING.logicalW / 2 - 42, HUD_MARGIN + 8, PAL_WARN, HUD_TEXT_PX);
  }

  if (state.phase === GAME_PHASES.GAME_OVER) {
    gfxDrawDebugText(gfx, 'GAME OVER',
      TUNING.logicalW / 2 - 24, TUNING.logicalH / 2 - 4, PAL_PIP, HUD_TEXT_PX * 2);
  }
}
