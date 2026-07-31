// VAULT RAIDER - collision. SPEC v0.7 sections 3.5, 4.1, 4.5.
//
// TWO SEPARATE CONCEPTS, and they must stay separate (section 4.1):
//   - COLLISION box: tested against tiles, resolves movement.
//   - HURT box: tested against other actors via aabbOverlap, deals death.
// They are equal in size for PIP and are still two named values, so a feel-gate
// change to one cannot silently move the other.
//
// Corpse blocking is TILE-OCCUPANCY, never AABB (section 3.5). That path
// arrives with corpses at M3; isTileBlocked already takes the hook so movement
// has exactly one place to consult it.
//
// No DOM access. Safe to import from tests/.

import { TUNING, TILE_CHARS, GEOM } from '../data/tuning.js';

export function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function isSolidChar(ch) {
  return ch !== TILE_CHARS.FLOOR;
}

export function tileAt(mask, tx, ty) {
  if (ty < 0 || ty >= mask.length) return TILE_CHARS.WALL;
  const row = mask[ty];
  if (tx < 0 || tx >= row.length) return TILE_CHARS.WALL;
  return row[tx];
}

export function tileAtPx(mask, px, py) {
  return tileAt(mask, Math.floor(px / TUNING.tile), Math.floor(py / TUNING.tile));
}

// Single consultation point for "is this tile solid to PIP right now".
// blockedTiles is an optional Set of "tx,ty" keys - corpses at M3 (section 3.5).
export function isTileBlocked(mask, tx, ty, blockedTiles) {
  if (isSolidChar(tileAt(mask, tx, ty))) return true;
  if (blockedTiles && blockedTiles.has(tx + ',' + ty)) return true;
  return false;
}

// Does an axis-aligned box overlap any blocked tile?
export function boxHitsTiles(mask, x, y, w, h, blockedTiles) {
  const tx0 = Math.floor(x / TUNING.tile);
  const ty0 = Math.floor(y / TUNING.tile);
  // Tile intervals are half-open; see GEOM in tuning.js.
  const eps = GEOM.boxEdgeEpsilonPx;
  const tx1 = Math.floor((x + w - eps) / TUNING.tile);
  const ty1 = Math.floor((y + h - eps) / TUNING.tile);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isTileBlocked(mask, tx, ty, blockedTiles)) return true;
    }
  }
  return false;
}

// AXIS-SEPARATED resolution. X is resolved fully, then Y independently.
//
// This is what lets PIP slide along a wall instead of stopping dead when a
// diagonal input drives him into it. Resolving both axes together would make
// every diagonal approach to a corridor wall a full stop, which is the classic
// "sticky corner" arcade movement bug.
//
// Returns the resolved position plus which axes were blocked.
export function moveAxisSeparated(x, y, w, h, dx, dy, mask, blockedTiles) {
  let nx = x;
  let ny = y;
  let blockedX = false;
  let blockedY = false;

  if (dx !== 0) {
    const tryX = x + dx;
    if (boxHitsTiles(mask, tryX, y, w, h, blockedTiles)) {
      // Snap flush to the wall rather than leaving a sub-pixel gap, so repeated
      // taps into a wall cannot accumulate drift.
      nx = dx > 0
        ? Math.ceil((x + w) / TUNING.tile) * TUNING.tile - w
        : Math.floor(x / TUNING.tile) * TUNING.tile;
      if (boxHitsTiles(mask, nx, y, w, h, blockedTiles)) nx = x;
      blockedX = true;
    } else {
      nx = tryX;
    }
  }

  if (dy !== 0) {
    const tryY = y + dy;
    if (boxHitsTiles(mask, nx, tryY, w, h, blockedTiles)) {
      ny = dy > 0
        ? Math.ceil((y + h) / TUNING.tile) * TUNING.tile - h
        : Math.floor(y / TUNING.tile) * TUNING.tile;
      if (boxHitsTiles(mask, nx, ny, w, h, blockedTiles)) ny = y;
      blockedY = true;
    } else {
      ny = tryY;
    }
  }

  return { x: nx, y: ny, blockedX, blockedY };
}

// Doorway snap-assist, SPEC section 4.1. REQUIRED, not a nicety.
//
// Slack alone is not enough to make a 1-tile gap enterable: the player must
// otherwise be near-pixel-perfect on the perpendicular axis. When PIP is moving
// toward a gap and is within snapAssistWindowPx of alignment, nudge him
// snapAssistStepPx per tick toward it.
//
// Applies identically to every input source, so it cannot desync a replay.
// Returns the corrected position.
export function applyDoorwaySnap(x, y, w, h, dx, dy, mask, blockedTiles) {
  const win = TUNING.player.snapAssistWindowPx;
  const step = TUNING.player.snapAssistStepPx;
  let nx = x;
  let ny = y;

  // CARDINAL ONLY, and this is deliberate - MEASURED, not assumed.
  //
  // game-feel-critic flagged the `dy === 0` / `dx === 0` guards as a blind spot
  // that denied diagonal approaches any assist. That was a reasonable
  // hypothesis and it is wrong: extending the assist to diagonals COLLAPSED the
  // entry window from 924/1436 to 444/1436. On a diagonal both nudges fire, each
  // validated against the pre-nudge position, so the combined result is never
  // checked and the two corrections fight each other into walls.
  //
  // The deeper reason it is not needed: a diagonal already corrects on both
  // axes as it travels, so it self-aligns. Measured un-assisted diagonal entry
  // is 64.3% against 30.9% assisted. Diagonals do not want help.
  //
  // tests/rooms.mjs sweeps diagonal approaches specifically to keep this
  // measured rather than argued.
  if (dx !== 0 && dy === 0) {
    const centerY = y + h / 2;
    const target = (Math.floor(centerY / TUNING.tile) + 0.5) * TUNING.tile;
    const delta = target - centerY;
    if (delta !== 0 && Math.abs(delta) <= win) {
      const move = Math.sign(delta) * Math.min(step, Math.abs(delta));
      // Only assist if it actually unblocks the direction of travel.
      if (!boxHitsTiles(mask, x + dx, y + move, w, h, blockedTiles)) ny = y + move;
    }
  } else if (dy !== 0 && dx === 0) {
    const centerX = x + w / 2;
    const target = (Math.floor(centerX / TUNING.tile) + 0.5) * TUNING.tile;
    const delta = target - centerX;
    if (delta !== 0 && Math.abs(delta) <= win) {
      const move = Math.sign(delta) * Math.min(step, Math.abs(delta));
      if (!boxHitsTiles(mask, x + move, y + dy, w, h, blockedTiles)) nx = x + move;
    }
  }

  return { x: nx, y: ny };
}

export function tileCenterPx(t) {
  return t * TUNING.tile + TUNING.tile / 2;
}
