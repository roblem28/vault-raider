// VAULT RAIDER - entities. SPEC v0.7 sections 3.2, 3.8, 3.9, 4.1, 4.2, 4.3.
//
// M2 scope: PIP in floor view, the arrow, and the WARDEN. Monsters and corpses
// arrive at M3/M6.
//
// No DOM access. Safe to import from tests/.

import { TUNING, DIRS, DIR_NEUTRAL, GEOM, UNSTICK } from '../data/tuning.js';
import {
  moveAxisSeparated, applyDoorwaySnap, aabbOverlap, tileCenterPx
} from './collision.js';

// --- PIP -------------------------------------------------------------------

export function createPlayer(tx, ty) {
  return {
    // Position is the top-left of the COLLISION box, not the sprite.
    x: tileCenterPx(tx) - TUNING.player.hitboxFloor / 2,
    y: tileCenterPx(ty) - TUNING.player.hitboxFloor / 2,
    prevX: 0,
    prevY: 0,
    // PERSISTENT entity facing (section 17.1.1). NOT the input struct's
    // facingLatch, which is a one-tick event. Starts East.
    facing: 2,
    lives: TUNING.player.startingLives,
    invulnTicks: 0,
    alive: true
  };
}

export function playerBox(player, inRoom) {
  const s = inRoom ? TUNING.player.hitboxRoom : TUNING.player.hitboxFloor;
  return { x: player.x, y: player.y, w: s, h: s };
}

// Hurt box is a SEPARATE query from the collision box (section 4.1), even
// though the two are currently the same size.
export function playerHurtBox(player, inRoom) {
  const s = inRoom ? TUNING.player.hurtboxRoom : TUNING.player.hurtboxFloor;
  return { x: player.x, y: player.y, w: s, h: s };
}

export function updatePlayerFloor(player, input, mask, speedMul, blockedTiles) {
  player.prevX = player.x;
  player.prevY = player.y;

  // Section 3.9 / 17.1.1: facing latches on directional INPUT, in the same
  // frame, whether or not movement was possible. Never derived from realized
  // displacement. This assignment happens BEFORE movement on purpose - moving
  // it below the collision resolution would reintroduce exactly that bug.
  if (input.facingLatch !== DIR_NEUTRAL) player.facing = input.facingLatch;

  if (input.dir === DIR_NEUTRAL) return;

  const size = TUNING.player.hitboxFloor;
  const d = DIRS[input.dir];
  const speed = TUNING.player.speedFloor * speedMul;
  const dx = d.dx * speed;
  const dy = d.dy * speed;

  const snapped = applyDoorwaySnap(player.x, player.y, size, size, dx, dy, mask, blockedTiles);
  const moved = moveAxisSeparated(
    snapped.x, snapped.y, size, size, dx, dy, mask, blockedTiles
  );
  player.x = moved.x;
  player.y = moved.y;
}

// --- Arrow -----------------------------------------------------------------
//
// Section 3.8: exactly ONE alive at a time, no separate cooldown. Rate of fire
// is gated purely by "is an arrow alive?", so a long miss is a long vulnerable
// window. Section 3.2: firing in the hall is allowed and USELESS - the arrow is
// real, travels, and passes straight through WARDENs. That is an intended
// newbie trap, not a bug to fix.

export function createArrowState() {
  return { alive: false, x: 0, y: 0, dir: 2, windup: 0, pending: false };
}

// THE one fire gate. Floor view and (from M3) room view both call this rather
// than each keeping a copy - section 3.8 is "exactly one arrow alive, ever", and
// two independently-maintained gates is how that stops being true.
export function requestFire(arrow) {
  // Ignored while an arrow lives or a windup is already running. No separate
  // cooldown exists, by design: a long miss IS the punishment.
  if (arrow.alive || arrow.pending) return false;
  arrow.pending = true;
  arrow.windup = TUNING.arrow.windupTicks;
  return true;
}

export function updateArrow(arrow, player, mask) {
  if (arrow.pending) {
    arrow.windup--;
    if (arrow.windup <= 0) {
      arrow.pending = false;
      arrow.alive = true;
      // Section 4.2: direction is PIP's PERSISTENT ENTITY FACING at the SPAWN
      // tick - not the fire-input tick, and never the input struct. This is
      // what makes re-aiming during the 4-tick windup work.
      arrow.dir = player.facing;
      const size = TUNING.player.hitboxFloor;
      arrow.x = player.x + size / 2;
      arrow.y = player.y + size / 2;
    }
    return;
  }
  if (!arrow.alive) return;

  const d = DIRS[arrow.dir];
  arrow.x += d.dx * TUNING.arrow.speed;
  arrow.y += d.dy * TUNING.arrow.speed;

  if (arrow.x < 0 || arrow.y < 0 ||
      arrow.x >= TUNING.logicalW || arrow.y >= TUNING.logicalH) {
    arrow.alive = false;
    return;
  }
  // Despawns on wall. Deliberately does NOT test WARDENs (section 3.2).
  const tx = Math.floor(arrow.x / TUNING.tile);
  const ty = Math.floor(arrow.y / TUNING.tile);
  const row = mask[ty];
  if (!row || row[tx] !== '.') arrow.alive = false;
}

// --- WARDEN ----------------------------------------------------------------
//
// Section 3.1: invulnerable. Not killable, slowable, or divertible.
// Section 4.3: deliberately POOR at navigating corridor barriers. Barriers are
// PIP's only defensive tool. DO NOT add pathfinding here - the bad navigation
// is the mechanic, not a defect.

export function createWarden(route, speedMul, handedness) {
  const wp = route.waypoints[route.startIdx % route.waypoints.length];
  return {
    x: tileCenterPx(wp[0]) - TUNING.warden.hurtbox / 2,
    y: tileCenterPx(wp[1]) - TUNING.warden.hurtbox / 2,
    prevX: 0,
    prevY: 0,
    waypoints: route.waypoints,
    routeIdx: route.startIdx % route.waypoints.length,
    speedMul,
    // Corner-clipping state (section 4.3.1). Affects behaviour, so all of it is
    // in the determinism hash. slideSign is fixed HANDEDNESS, set once here and
    // never re-rolled - see updateWarden.
    checkTicks: 0,
    // Seeded to the spawn position, not 0, or the first wedge window measures a
    // span from the origin and can never trip.
    minX: tileCenterPx(wp[0]) - TUNING.warden.hurtbox / 2,
    maxX: tileCenterPx(wp[0]) - TUNING.warden.hurtbox / 2,
    minY: tileCenterPx(wp[1]) - TUNING.warden.hurtbox / 2,
    maxY: tileCenterPx(wp[1]) - TUNING.warden.hurtbox / 2,
    slideTicks: 0,
    slideAxis: 0,
    slideSign: handedness < 0 ? -1 : 1
  };
}

export function wardenHurtBox(warden) {
  return { x: warden.x, y: warden.y, w: TUNING.warden.hurtbox, h: TUNING.warden.hurtbox };
}

// bias = min(pursuitBiasCap, pursuitBiasRate * elapsedSec)   [section 4.3]
export function wardenPursuitBias(elapsedSec) {
  return Math.min(TUNING.warden.pursuitBiasCap, TUNING.warden.pursuitBiasRate * elapsedSec);
}

export function updateWarden(warden, player, mask, elapsedSec, speedMul, rng) {
  warden.prevX = warden.x;
  warden.prevY = warden.y;

  const size = TUNING.warden.hurtbox;

  // warden.speedMul already carries the layout's warden multiplier from
  // floorDescriptorFor; speedMul is the floor speed. Do not re-apply
  // TUNING.warden.speedMul here or it compounds.
  const speed = warden.speedMul * speedMul;

  // Each tick, with probability bias, step toward PIP instead of the waypoint.
  const chase = rng.nextFloat() < wardenPursuitBias(elapsedSec);

  let targetX;
  let targetY;
  if (chase) {
    targetX = player.x + TUNING.player.hitboxFloor / 2;
    targetY = player.y + TUNING.player.hitboxFloor / 2;
  } else {
    const wp = warden.waypoints[warden.routeIdx];
    targetX = tileCenterPx(wp[0]);
    targetY = tileCenterPx(wp[1]);
  }

  const cx = warden.x + size / 2;
  const cy = warden.y + size / 2;
  const ddx = targetX - cx;
  const ddy = targetY - cy;

  if (!chase && Math.abs(ddx) < speed && Math.abs(ddy) < speed) {
    warden.routeIdx = (warden.routeIdx + 1) % warden.waypoints.length;
    return;
  }

  // Greedy axis stepping, no pathfinding. This is what makes a WARDEN snag on
  // a barrier corner - the intended behaviour per section 4.3.
  const zero = GEOM.zeroStepEpsilonPx;
  const stepX = Math.abs(ddx) < zero ? 0 : Math.sign(ddx) * Math.min(speed, Math.abs(ddx));
  const stepY = Math.abs(ddy) < zero ? 0 : Math.sign(ddy) * Math.min(speed, Math.abs(ddy));

  // DOMINANT AXIS FIRST. moveAxisSeparated always resolves X before Y, which is
  // correct for PIP but wrong for a chaser: a WARDEN one tile north-west of a
  // barrier has a large southward pull and a small eastward one, and X-first
  // spends the tick on the small eastward step straight back into the trap
  // before the southward escape is ever attempted. Measured: warden 0 logged
  // 29523 ticks on a single tile. Resolving the axis it most needs first is
  // still greedy and still has no pathfinding - it just stops the tie-break
  // from actively working against it.
  const yFirst = Math.abs(ddy) > Math.abs(ddx);
  let greedy;
  if (yFirst) {
    greedy = moveAxisSeparated(warden.x, warden.y, size, size, 0, stepY, mask, null);
    greedy = moveAxisSeparated(greedy.x, greedy.y, size, size, stepX, 0, mask, null);
  } else {
    greedy = moveAxisSeparated(warden.x, warden.y, size, size, stepX, 0, mask, null);
    greedy = moveAxisSeparated(greedy.x, greedy.y, size, size, 0, stepY, mask, null);
  }
  // Would the DOMINANT axis alone move? This, not "did anything move", is what
  // ends a slide.
  //
  // Measured: aborting on any greedy movement makes the slide useless. A WARDEN
  // pinned north-west of a barrier still has a small viable eastward step, so
  // one tick of sliding is immediately undone by greed dragging it back east -
  // it never travels the ~8 px needed to clear the barrier column. Resuming
  // only when the blocked axis opens up gives the slide room to work, while
  // still snapping back to the chase the instant the obstacle is cleared.
  const dominantOnly = yFirst
    ? moveAxisSeparated(warden.x, warden.y, size, size, 0, stepY, mask, null)
    : moveAxisSeparated(warden.x, warden.y, size, size, stepX, 0, mask, null);
  const dominantMoves = dominantOnly.x !== warden.x || dominantOnly.y !== warden.y;

  // COMMITTED SLIDE (section 4.3.1). Runs only while greed is genuinely stuck.
  //
  // Aborting the slide the moment greed becomes viable again is load-bearing.
  // A fixed-duration slide that ignores the target throughout was measured and
  // fails: in a 2-tile corridor the WARDEN slides one tile, hits the far wall,
  // reverses, and bounces inside the corridor for the whole slide instead of
  // resuming its approach the instant it clears the obstacle.
  if (warden.slideTicks > 0 && !dominantMoves) {
    warden.slideTicks--;
    const slideSpeed = warden.speedMul * speedMul;
    const sx = warden.slideAxis === 0 ? warden.slideSign * slideSpeed : 0;
    const sy = warden.slideAxis === 1 ? warden.slideSign * slideSpeed : 0;
    const slid = moveAxisSeparated(warden.x, warden.y, size, size, sx, sy, mask, null);
    if (slid.x === warden.x && slid.y === warden.y) {
      warden.slideSign = -warden.slideSign;   // walled that way too
    }
    warden.x = slid.x;
    warden.y = slid.y;
    resetWedgeWindow(warden);
    return;
  }

  warden.slideTicks = 0;
  warden.x = greedy.x;
  warden.y = greedy.y;

  // WEDGE DETECTION (section 4.3.1).
  //
  // Measures the SPAN of motion over a window - the bounding box the WARDEN
  // stayed inside - not net displacement and not "was this tick blocked".
  // Both simpler metrics were measured and both fail:
  //   - "blocked this tick" never fires, because a WARDEN pinned on a barrier
  //     still succeeds on one axis most ticks.
  //   - net displacement never fires against an OSCILLATION: bouncing between
  //     two adjacent tiles is 8 px of travel, so the endpoints of a window
  //     routinely sit further apart than any sane threshold.
  // Warden 1 logged 30883 visits to a single tile over 600 s while passing
  // both checks. A span check catches standstill and oscillation alike, and
  // normal patrol covers ~38 px per window so it never false-positives.
  warden.minX = Math.min(warden.minX, warden.x);
  warden.maxX = Math.max(warden.maxX, warden.x);
  warden.minY = Math.min(warden.minY, warden.y);
  warden.maxY = Math.max(warden.maxY, warden.y);
  warden.checkTicks++;

  if (warden.checkTicks >= UNSTICK.afterTicks) {
    const span = Math.max(warden.maxX - warden.minX, warden.maxY - warden.minY);
    if (span < UNSTICK.minSpanPx) {
      // Slide perpendicular to whichever axis it most wanted to travel.
      warden.slideAxis = Math.abs(ddx) > Math.abs(ddy) ? 1 : 0;
      warden.slideTicks = UNSTICK.slideTicks;
    }
    resetWedgeWindow(warden);
  }
}

function resetWedgeWindow(warden) {
  warden.checkTicks = 0;
  warden.minX = warden.x;
  warden.maxX = warden.x;
  warden.minY = warden.y;
  warden.maxY = warden.y;
}

// Section 3.1: nothing kills a WARDEN. Contact kills PIP.
export function wardenTouchesPlayer(warden, player, inRoom) {
  const p = playerHurtBox(player, inRoom);
  const w = wardenHurtBox(warden);
  return aabbOverlap(p.x, p.y, p.w, p.h, w.x, w.y, w.w, w.h);
}
