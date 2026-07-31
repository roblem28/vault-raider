// VAULT RAIDER - entities. SPEC v0.7 sections 3.2, 3.8, 3.9, 4.1, 4.2, 4.3.
//
// M2 scope: PIP in floor view, the arrow, and the WARDEN. Monsters and corpses
// arrive at M3/M6.
//
// No DOM access. Safe to import from tests/.

import {
  TUNING, DIRS, DIR_NEUTRAL, DIR_COUNT, GEOM, UNSTICK, ARCHETYPE
} from '../data/tuning.js';
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
  // prevX/prevY exist so the arrow INTERPOLATES like every other actor. It was
  // the one thing rendering un-interpolated next to lerped monsters and PIP,
  // which made a clean miss look like a rendering glitch - on the single object
  // that precision aiming is judged against.
  // `id` increments per spawn so a monster can tell one shot from the next
  // (section 4.4 [v0.9]). Without it, "already rolled for this arrow" cannot be
  // expressed and the roll silently reverts to per-tick.
  return {
    alive: false, x: 0, y: 0, prevX: 0, prevY: 0,
    dir: 2, windup: 0, pending: false, id: 0
  };
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
      arrow.id++;
      // Section 4.2: direction is PIP's PERSISTENT ENTITY FACING at the SPAWN
      // tick - not the fire-input tick, and never the input struct. This is
      // what makes re-aiming during the 4-tick windup work.
      arrow.dir = player.facing;
      const size = TUNING.player.hitboxFloor;
      arrow.x = player.x + size / 2;
      arrow.y = player.y + size / 2;
      // Spawn with prev == current so the first rendered frame does not lerp
      // in from wherever the last arrow died.
      arrow.prevX = arrow.x;
      arrow.prevY = arrow.y;
    }
    return;
  }
  if (!arrow.alive) return;

  arrow.prevX = arrow.x;
  arrow.prevY = arrow.y;
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

// pureChase: section 4.3's intrusion mode. An intruding WARDEN "switches to
// PURE chase" - it does not roll against pursuit bias at all. Reusing the
// patrol path unchanged left the intruder targeting its own spawn door on ~10%
// of ticks forever, because bias caps at pursuitBiasCap (0.9) and can never
// reach 1.0. That is patrol behaviour with a one-point route, not hunting.
export function updateWarden(warden, player, mask, elapsedSec, speedMul, rng, pureChase) {
  warden.prevX = warden.x;
  warden.prevY = warden.y;

  const size = TUNING.warden.hurtbox;

  // warden.speedMul already carries the layout's warden multiplier from
  // floorDescriptorFor; speedMul is the floor speed. Do not re-apply
  // TUNING.warden.speedMul here or it compounds.
  const speed = warden.speedMul * speedMul;

  // Each tick, with probability bias, step toward PIP instead of the waypoint.
  // The roll is consumed either way so that RNG consumption order - and
  // therefore replay determinism - does not depend on which mode is active.
  const roll = rng.nextFloat();
  const chase = pureChase ? true : roll < wardenPursuitBias(elapsedSec);

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

// --- PIP in room view ------------------------------------------------------

export function updatePlayerRoom(player, input, tiles, speedMul, blockedTiles) {
  player.prevX = player.x;
  player.prevY = player.y;

  // Section 3.9: same rule as floor view, same order. Facing first, from input,
  // regardless of whether the move lands.
  if (input.facingLatch !== DIR_NEUTRAL) player.facing = input.facingLatch;
  if (input.dir === DIR_NEUTRAL) return;

  const size = TUNING.player.hitboxRoom;
  const d = DIRS[input.dir];
  const speed = TUNING.player.speedRoom * speedMul;
  const dx = d.dx * speed;
  const dy = d.dy * speed;

  // 6x6 box in an 8px gap is 1px of slack per side. This is where snap-assist
  // finally earns its place, or fails to - tests/rooms.mjs measures which.
  const snapped = applyDoorwaySnap(player.x, player.y, size, size, dx, dy, tiles, blockedTiles);
  const moved = moveAxisSeparated(snapped.x, snapped.y, size, size, dx, dy, tiles, blockedTiles);
  player.x = moved.x;
  player.y = moved.y;
}

// --- CRAWLER ---------------------------------------------------------------
//
// Section 4.4: perimeter / wall-following, predictable, LOW dodge, 1 HP.
// "Corners PIP in dead ends." Predictability is the point - it is the floor-1
// teaching monster and must be readable at a glance.

// Per-archetype behaviour lives in ONE table so M6 adds entries rather than
// editing updateMonster. Section 4.4 defines six archetypes; two exist.
// Anything not listed falls back to CRAWLER movement and is flagged
// `placeholder`, which tests assert on so it cannot ship silently.
export const MONSTER_BEHAVIOUR = {
  CRAWLER: 'wallFollow',
  BOUNCER: 'ricochet'
};

export function createMonster(def, rng) {
  return {
    type: def.type,
    behaviour: MONSTER_BEHAVIOUR[def.type] || 'wallFollow',
    placeholder: !MONSTER_BEHAVIOUR[def.type],
    dodge: def.dodge,
    hp: 1,
    x: tileCenterPx(def.tx) - TUNING.monster.hurtbox / 2,
    y: tileCenterPx(def.ty) - TUNING.monster.hurtbox / 2,
    prevX: 0,
    prevY: 0,
    // Wall-following state. Starts heading East, keeping its left hand on the
    // wall; handedness alternates by spawn parity so four CRAWLERs do not all
    // circulate the same way.
    dir: 2,
    hand: (def.tx + def.ty) % 2 === 0 ? 1 : -1,
    // Ricochet components for BOUNCER (section 4.4). Seeded from spawn parity
    // so four of them do not all set off in the same direction.
    bounceX: (def.tx % 2 === 0) ? 1 : -1,
    bounceY: (def.ty % 2 === 0) ? 1 : -1,
    alive: true,
    // Section 4.4 [v0.9]: the dodge roll happens ONCE per arrow per monster, on
    // first entry into the lookahead window. This holds the id of the arrow
    // already rolled for, so a monster cannot re-roll every tick.
    dodgedArrowId: -1,
    spawnTx: def.tx,
    spawnTy: def.ty,
    seed: rng.nextU32()
  };
}

export function monsterHurtBox(monster) {
  return { x: monster.x, y: monster.y, w: TUNING.monster.hurtbox, h: TUNING.monster.hurtbox };
}

// Turn order for a wall-follower: try to turn toward the wall-hand first, then
// straight on, then away, then reverse. That is what produces perimeter runs
// and dead-end cornering rather than random drift.
function crawlerTurnOrder(dir, hand) {
  const right = (dir + 2 * hand + DIR_COUNT) % DIR_COUNT;
  const left = (dir - 2 * hand + DIR_COUNT) % DIR_COUNT;
  return [right, dir, left, (dir + 4) % DIR_COUNT];
}

export function updateMonster(monster, tiles, speedMul) {
  if (!monster.alive) return;
  monster.prevX = monster.x;
  monster.prevY = monster.y;
  if (monster.behaviour === 'ricochet') return updateBouncer(monster, tiles, speedMul);

  const size = TUNING.monster.hurtbox;
  const speed = TUNING.player.speedRoom * speedMul * ARCHETYPE.crawlerSpeedFrac;

  for (const candidate of crawlerTurnOrder(monster.dir, monster.hand)) {
    const d = DIRS[candidate];
    const moved = moveAxisSeparated(
      monster.x, monster.y, size, size, d.dx * speed, d.dy * speed, tiles, null
    );
    if (moved.x !== monster.x || moved.y !== monster.y) {
      monster.x = moved.x;
      monster.y = moved.y;
      monster.dir = candidate;
      return;
    }
  }
  // Fully boxed in. Reverse and try again next tick.
  monster.dir = (monster.dir + 4) % DIR_COUNT;
}

export function monsterTouchesPlayer(monster, player) {
  if (!monster.alive) return false;
  const p = playerHurtBox(player, true);
  const m = monsterHurtBox(monster);
  return aabbOverlap(p.x, p.y, p.w, p.h, m.x, m.y, m.w, m.h);
}

// Section 4.4 [v0.9]: ONE roll per arrow per monster, taken the first time that
// arrow is inside dodgeLookahead and aligned to the monster's axis.
//
// dodgeSkill values are PER-SHOT probabilities. Rolling every tick compounded
// them: a 3.5px/tick arrow spends ~7 ticks in a 24px window, turning LOW 0.15
// into 68%, MED 0.45 into 98.5%, and HIGH 0.80 into 99.999% - unhittable rather
// than hard. Only LOW shipped at M3, so only LOW was ever observed; BRUTE and
// BLINKER at HIGH would have surfaced it at M6 as "the game is broken".
export function monsterDodgeCheck(monster, arrow, rng, tiles) {
  if (!monster.alive || !arrow.alive) return false;
  // Already resolved this arrow. Not a re-roll, not a second chance.
  if (monster.dodgedArrowId === arrow.id) return false;

  const mx = monster.x + TUNING.monster.hurtbox / 2;
  const my = monster.y + TUNING.monster.hurtbox / 2;
  const dist = Math.hypot(arrow.x - mx, arrow.y - my);
  if (dist > TUNING.arrow.dodgeLookahead) return false;

  const shot = DIRS[arrow.dir];
  const aligned = shot.diagonal
    ? true
    : (shot.dx !== 0 ? Math.abs(arrow.y - my) < TUNING.tile : Math.abs(arrow.x - mx) < TUNING.tile);
  if (!aligned) return false;

  // Committed: this monster has now had its one roll against this arrow,
  // whichever way it goes.
  monster.dodgedArrowId = arrow.id;

  const skill = TUNING.dodgeSkill[monster.dodge];
  const chance = skill * (shot.diagonal ? TUNING.monster.diagonalDodgeMul : 1.0);
  if (rng.nextFloat() >= chance) return false;

  // Sidestep one tile perpendicular to the shot. Section 4.4 [v1.0]: try the
  // chosen direction, then THE OPPOSITE ONE.
  //
  // Single-direction sidestep let room geometry silently scale the dodge tier,
  // because a blocked sidestep was eaten in silence. Measured, HIGH (0.80):
  //   open hall, 3+ tiles tall   0.808
  //   2-tall lane (THE COIL)     0.402   - one side is always wall
  //   1-tall corridor            0.000   - a DEAD mechanic, tier meaningless
  // At 0.000 a BLINKER and a CRAWLER are identical, which is worse than either
  // extreme. Retrying the opposite direction restores the label wherever the
  // monster has anywhere at all to go.
  //
  // Both blocked is a legitimate failure: the geometry genuinely gave it
  // nowhere. The roll is still spent - dodgedArrowId was committed above - so
  // this is one dodge attempt, not two.
  const perp = shot.dx !== 0 ? { dx: 0, dy: 1 } : { dx: 1, dy: 0 };
  const size = TUNING.monster.hurtbox;
  const firstSign = rng.nextFloat() < 0.5 ? -1 : 1;

  for (const sign of [firstSign, -firstSign]) {
    const moved = moveAxisSeparated(
      monster.x, monster.y, size, size,
      perp.dx * TUNING.tile * sign, perp.dy * TUNING.tile * sign, tiles, null
    );
    if (moved.x !== monster.x || moved.y !== monster.y) {
      monster.x = moved.x;
      monster.y = moved.y;
      return true;
    }
  }
  return false;
}

// Section 4.4 BOUNCER: erratic diagonal ricochet, unpredictable, hit by luck.
// Travels on a diagonal and reflects off whatever it meets, resolving each axis
// separately so a wall on one axis flips only that component - which is what
// makes the path read as a ricochet rather than a bounce-straight-back.
function updateBouncer(monster, tiles, speedMul) {
  const size = TUNING.monster.hurtbox;
  const speed = TUNING.player.speedRoom * speedMul * ARCHETYPE.bouncerSpeedFrac;
  const d = DIRS[monster.dir];

  const stepX = moveAxisSeparated(monster.x, monster.y, size, size, d.dx * speed, 0, tiles, null);
  if (stepX.x === monster.x && d.dx !== 0) monster.bounceX = -monster.bounceX;
  else monster.x = stepX.x;

  const stepY = moveAxisSeparated(monster.x, monster.y, size, size, 0, d.dy * speed, tiles, null);
  if (stepY.y === monster.y && d.dy !== 0) monster.bounceY = -monster.bounceY;
  else monster.y = stepY.y;

  // Re-derive the 8-way sector from the current signs. Diagonal only, so a
  // BOUNCER never settles into an axis-aligned crawl.
  monster.dir = bounceSector(monster.bounceX, monster.bounceY);
}

function bounceSector(sx, sy) {
  if (sx > 0) return sy < 0 ? 1 : 3;
  return sy < 0 ? 7 : 5;
}

// --- Hazards ---------------------------------------------------------------
//
// Section 4.5 SLIDING_BARRIER: an electrified segment on a fixed sweep period.
// Contact kills. Pure timing.
//
// Written as a GENERAL hazard system, not a THE SLABS special case - THE FORGE
// and the floor-2/3 rooms inherit it at M7 by adding entries to a room's
// `hazards` array with no code change here.
//
// Position is a pure function of the room tick, so it is deterministic and
// needs no state of its own beyond the tick: a triangle wave over periodTicks,
// which gives a constant sweep speed and a hard reversal rather than the
// ease-in-out of a sine. Section 11 also wants a steady sweep with no strobe.
export function hazardOffsetTiles(hazard, roomTicks) {
  const period = hazard.periodTicks;
  const t = ((roomTicks + hazard.phaseTicks) % period) / period;
  const tri = t < 0.5 ? t * 2 : 2 - t * 2;
  return tri * hazard.travel;
}

export function hazardBox(hazard, roomTicks) {
  const off = hazardOffsetTiles(hazard, roomTicks) * TUNING.tile;
  return {
    x: hazard.tx * TUNING.tile + (hazard.axis === 'x' ? off : 0),
    y: hazard.ty * TUNING.tile + (hazard.axis === 'y' ? off : 0),
    w: hazard.tw * TUNING.tile,
    h: hazard.th * TUNING.tile
  };
}

export function hazardTouchesPlayer(hazard, roomTicks, player) {
  const b = hazardBox(hazard, roomTicks);
  const p = playerHurtBox(player, true);
  return aabbOverlap(p.x, p.y, p.w, p.h, b.x, b.y, b.w, b.h);
}

// --- Corpses ---------------------------------------------------------------
//
// Section 3.5, and the reason section 4.1's death handling exists.
//
// BLOCKING IS TILE-OCCUPANCY. LETHALITY IS AABB. They are two different tests
// and must not be collapsed: PIP's collision box is 6x6, so an AABB-only corpse
// leaves 2px of slack in an 8px doorway and PIP squeezes past - which silently
// deletes the doorway seal this mechanic exists to create.

export function createCorpse(x, y) {
  return {
    // Snapped to the tile it occupies, because occupancy is the blocking rule.
    tx: Math.floor((x + TUNING.monster.hurtbox / 2) / TUNING.tile),
    ty: Math.floor((y + TUNING.monster.hurtbox / 2) / TUNING.tile),
    phase: 0,
    phaseTicks: 0
  };
}

export function corpseTileKey(corpse) {
  return corpse.tx + ',' + corpse.ty;
}

// Corpses block PIP ONLY. Monsters and WARDENs walk through them
// Section 3.5: monsters and WARDENs walk through corpses. Enforced
// structurally - neither mover is given the blocked-tile set at all.
export function corpseBlockedTiles(room) {
  const set = new Set();
  for (const corpse of room.corpses) set.add(corpseTileKey(corpse));
  return set;
}

export function updateCorpses(room) {
  const phaseTicks = Math.round(TUNING.corpse.phaseSec / TUNING.dt);
  for (let i = room.corpses.length - 1; i >= 0; i--) {
    const corpse = room.corpses[i];
    corpse.phaseTicks++;
    if (corpse.phaseTicks >= phaseTicks) {
      corpse.phaseTicks = 0;
      corpse.phase++;
      if (corpse.phase >= TUNING.corpse.decayPhases) room.corpses.splice(i, 1);
    }
  }
}

// Section 3.6, CONTESTED between two sources. Both modes implemented; decided
// by playtest, not argument.
export function shootCorpse(room, corpse) {
  if (TUNING.flags.CORPSE_SHOT_MODE === 'RESET_ALL') {
    for (const c of room.corpses) { c.phase = 0; c.phaseTicks = 0; }
  } else {
    corpse.phase = 0;
    corpse.phaseTicks = 0;
  }
}

export function corpseAtPixel(room, px, py) {
  const tx = Math.floor(px / TUNING.tile);
  const ty = Math.floor(py / TUNING.tile);
  for (const corpse of room.corpses) {
    if (corpse.tx === tx && corpse.ty === ty) return corpse;
  }
  return null;
}

// Lethality is AABB against PIP's hurt box, NOT tile occupancy.
export function corpseTouchesPlayer(corpse, player) {
  const p = playerHurtBox(player, true);
  return aabbOverlap(
    p.x, p.y, p.w, p.h,
    corpse.tx * TUNING.tile, corpse.ty * TUNING.tile, TUNING.tile, TUNING.tile
  );
}
