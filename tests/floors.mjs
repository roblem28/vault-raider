// VAULT RAIDER - floor data. SPEC v0.7 section 12.1.
//
// Asserts, for EVERY floor layout:
//   - spawn reaches all 4 room doors and the stairs on the corridor mask
//   - every warden waypoint sits on a floor tile
//
// Seeded at M2 because it guards the mask created at M2; test-engineer owns the
// suite from M3. Layouts 1 and 2 arrive at M7 and this file will cover them
// with no change - it iterates FLOOR_LAYOUTS.
//
// Zero dependencies. Node only, no DOM.

import { TUNING, TILE_CHARS, GAME_PHASES } from '../src/data/tuning.js';
import { FLOOR_LAYOUTS, floorDescriptorFor } from '../src/data/floors.js';
import { createGameState, updateGame, applyPlayerDeath } from '../src/game/state.js';
import { isStairsUnlocked, playerOnStairs } from '../src/game/floor.js';
import { ROOM_DEFS } from '../src/data/rooms.js';
import { advanceAccumulator } from '../src/core/loop.js';

let failures = 0;

function assert(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${detail || ''}`}`);
}

function check(name, actual, expected) {
  assert(name, actual === expected, `expected ${expected}, got ${actual}`);
}

function isFloor(mask, tx, ty) {
  if (ty < 0 || ty >= mask.length) return false;
  const row = mask[ty];
  if (tx < 0 || tx >= row.length) return false;
  return row[tx] === TILE_CHARS.FLOOR;
}

// 4-connected flood fill. Tile-based and monster-agnostic, per section 12.1.
function reachableFrom(mask, sx, sy) {
  const seen = new Set();
  if (!isFloor(mask, sx, sy)) return seen;
  const queue = [[sx, sy]];
  seen.add(sx + ',' + sy);
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of steps) {
      const nx = x + dx;
      const ny = y + dy;
      const key = nx + ',' + ny;
      if (!seen.has(key) && isFloor(mask, nx, ny)) {
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
  }
  return seen;
}

console.log(`# ${FLOOR_LAYOUTS.length} floor layout(s)`);

for (const layout of FLOOR_LAYOUTS) {
  console.log(`\n## ${layout.id} (layoutIndex ${layout.layoutIndex})`);

  // Grid shape. Section 1: one grid, 40x30, no other grid exists.
  check(`${layout.id}: mask has gridH rows`, layout.mask.length, TUNING.gridH);
  let badRow = -1;
  for (let i = 0; i < layout.mask.length; i++) {
    if (layout.mask[i].length !== TUNING.gridW) { badRow = i; break; }
  }
  assert(`${layout.id}: every row is gridW chars`, badRow === -1,
    badRow >= 0 ? `row ${badRow} is ${layout.mask[badRow].length}` : '');

  let badChar = null;
  for (let ty = 0; ty < layout.mask.length; ty++) {
    for (const ch of layout.mask[ty]) {
      if (ch !== TILE_CHARS.WALL && ch !== TILE_CHARS.FLOOR) { badChar = ch; break; }
    }
    if (badChar) break;
  }
  assert(`${layout.id}: mask uses only '#' and '.'`, badChar === null,
    badChar ? `found ${JSON.stringify(badChar)}` : '');

  // Spawn must itself be standable.
  assert(`${layout.id}: spawn is a floor tile`,
    isFloor(layout.mask, layout.spawn.tx, layout.spawn.ty),
    `${layout.spawn.tx},${layout.spawn.ty}`);

  const reach = reachableFrom(layout.mask, layout.spawn.tx, layout.spawn.ty);

  // THE guard: every door and the stairs reachable from spawn.
  check(`${layout.id}: has 4 rooms`, layout.rooms.length, 4);
  for (const room of layout.rooms) {
    const key = room.door.tx + ',' + room.door.ty;
    assert(`${layout.id}: door '${room.id}' reachable from spawn`,
      reach.has(key), `door at ${key}`);
    assert(`${layout.id}: door '${room.id}' is a floor tile`,
      isFloor(layout.mask, room.door.tx, room.door.ty), key);
  }

  const stairsKey = layout.stairs.tx + ',' + layout.stairs.ty;
  assert(`${layout.id}: stairs reachable from spawn`,
    reach.has(stairsKey), `stairs at ${stairsKey}`);

  // Every warden waypoint on a floor tile - a waypoint inside a wall strands
  // a patrol permanently, since section 4.3 forbids giving WARDENs pathfinding.
  let wp = 0;
  for (let r = 0; r < layout.wardenRoutes.length; r++) {
    const route = layout.wardenRoutes[r];
    assert(`${layout.id}: route ${r} startIdx in range`,
      route.startIdx >= 0 && route.startIdx < route.waypoints.length,
      `startIdx ${route.startIdx} of ${route.waypoints.length}`);
    for (const [tx, ty] of route.waypoints) {
      wp++;
      assert(`${layout.id}: route ${r} waypoint ${tx},${ty} on floor`,
        isFloor(layout.mask, tx, ty));
    }
  }
  console.log(`     ${wp} waypoints checked, ${reach.size} tiles reachable`);

  // A waypoint on a floor tile is not enough: it must be reachable from the
  // route's own start, or a WARDEN walks into a wall and stops forever.
  for (let r = 0; r < layout.wardenRoutes.length; r++) {
    const route = layout.wardenRoutes[r];
    const start = route.waypoints[route.startIdx];
    const routeReach = reachableFrom(layout.mask, start[0], start[1]);
    let allConnected = true;
    for (const [tx, ty] of route.waypoints) {
      if (!routeReach.has(tx + ',' + ty)) allConnected = false;
    }
    assert(`${layout.id}: route ${r} waypoints are mutually reachable`, allConnected);
  }

  // --- section 7.1.1 floor-authoring invariants ---------------------------

  // 2. Only the door tile of a rect may be floor.
  for (const room of layout.rooms) {
    const [rx, ry, rw, rh] = room.rect;
    let strayFloor = null;
    for (let ty = ry; ty < ry + rh; ty++) {
      for (let tx = rx; tx < rx + rw; tx++) {
        if (isFloor(layout.mask, tx, ty) &&
            !(tx === room.door.tx && ty === room.door.ty)) {
          strayFloor = tx + ',' + ty;
        }
      }
    }
    assert(`${layout.id}: room '${room.id}' rect is solid except its door`,
      strayFloor === null, `floor tile at ${strayFloor}`);
  }

  // 1. The door lies ON the rect perimeter, never inside it. This is the exact
  //    defect SPEC 7.1's own example carried until v0.8.
  for (const room of layout.rooms) {
    const [rx, ry, rw, rh] = room.rect;
    const { tx, ty } = room.door;
    const inside = tx >= rx && tx < rx + rw && ty >= ry && ty < ry + rh;
    const onEdge = inside &&
      (tx === rx || tx === rx + rw - 1 || ty === ry || ty === ry + rh - 1);
    assert(`${layout.id}: door '${room.id}' is on the rect perimeter`,
      onEdge, `door ${tx},${ty} vs rect ${room.rect.join(',')}`);
  }

  // 2b. The door must actually touch corridor, or the room is unreachable.
  for (const room of layout.rooms) {
    const { tx, ty } = room.door;
    const [rx, ry, rw, rh] = room.rect;
    let touchesCorridor = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx;
      const ny = ty + dy;
      const outsideRect = nx < rx || nx >= rx + rw || ny < ry || ny >= ry + rh;
      if (outsideRect && isFloor(layout.mask, nx, ny)) touchesCorridor = true;
    }
    assert(`${layout.id}: door '${room.id}' touches corridor outside its rect`,
      touchesCorridor, `door ${tx},${ty}`);
  }

  // 3. No rect may contain a waypoint, or any tile on the straight segment
  //    between consecutive waypoints. A rect over a patrol line strands a
  //    WARDEN, and section 4.3 forbids the pathfinding that would free it.
  {
    const patrolTiles = new Set();
    for (const route of layout.wardenRoutes) {
      for (let i = 0; i < route.waypoints.length; i++) {
        const [ax, ay] = route.waypoints[i];
        const [bx, by] = route.waypoints[(i + 1) % route.waypoints.length];
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
        for (let s = 0; s <= steps; s++) {
          const t = steps === 0 ? 0 : s / steps;
          patrolTiles.add(`${Math.round(ax + (bx - ax) * t)},${Math.round(ay + (by - ay) * t)}`);
        }
      }
    }
    for (const room of layout.rooms) {
      const [rx, ry, rw, rh] = room.rect;
      let clash = null;
      for (let ty = ry; ty < ry + rh; ty++) {
        for (let tx = rx; tx < rx + rw; tx++) {
          if (patrolTiles.has(tx + ',' + ty)) clash = tx + ',' + ty;
        }
      }
      assert(`${layout.id}: room '${room.id}' rect clears every patrol line`,
        clash === null, `patrol tile ${clash} inside rect`);
    }
  }

  // 4. Rects do not overlap each other.
  for (let i = 0; i < layout.rooms.length; i++) {
    for (let j = i + 1; j < layout.rooms.length; j++) {
      const [ax, ay, aw, ah] = layout.rooms[i].rect;
      const [bx, by, bw, bh] = layout.rooms[j].rect;
      const overlap = ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
      assert(`${layout.id}: rects '${layout.rooms[i].id}' and '${layout.rooms[j].id}' do not overlap`,
        !overlap);
    }
  }
}

console.log('\n# EVERY 1-tile gap is passable, every approach, 60 and 30 Hz');
{
  // Section 4.1: a 1-tile gap is 8 px and PIP's collision box is 4 px in floor
  // view (6 px in room view), so there is only 2 px of slack per side. This is
  // the geometry snap-assist exists for, and the geometry a latent softlock
  // hides in - `winnability.mjs` cannot catch it because its BFS is tile-based
  // and does not model the hitbox at all.
  //
  // THREE dimensions, not one:
  //   1. every 1-tile gap tile on the mask (not just room doors - barriers
  //      create 1-tile lanes too)
  //   2. every cardinal approach whose entry tile is actually floor
  //   3. every sub-pixel alignment across the tile, at 60 Hz AND 30 Hz
  //
  // 30 Hz is the case that matters: the loop runs 2 substeps per frame there,
  // and the worry is that a doubled step carries PIP across an 8 px aperture
  // without ever occupying it. Driven through advanceAccumulator so the real
  // multi-substep path is exercised rather than assumed.
  const OFFSETS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  const RATES = [60, 30];
  const DIRS_BY_NAME = { N: [0, -1, 0], S: [0, 1, 4], E: [1, 0, 2], W: [-1, 0, 6] };
  const MAX_FRAMES = 120;
  const T = TUNING.tile;
  const BOX = TUNING.player.hitboxFloor;

  for (const layout of FLOOR_LAYOUTS) {
    // Room door tiles are excluded from BOTH gaps and approaches. Standing on
    // one begins the zoom into that room, so a traversal starting or ending
    // there measures the room-entry path, not the doorway geometry.
    //
    // This bit at M4: three more Floor-1 rooms became live, so three doors that
    // had previously been inert floor tiles started triggering zooms and 54 of
    // 1368 combinations "failed". Nothing about the geometry had changed.
    const isRoomDoor = (tx, ty) =>
      layout.rooms.some((r) => r.door.tx === tx && r.door.ty === ty);

    // A 1-tile gap: a floor tile walled on both sides of one axis.
    const gaps = [];
    for (let ty = 0; ty < layout.mask.length; ty++) {
      for (let tx = 0; tx < layout.mask[ty].length; tx++) {
        if (!isFloor(layout.mask, tx, ty) || isRoomDoor(tx, ty)) continue;
        const vert = !isFloor(layout.mask, tx - 1, ty) && !isFloor(layout.mask, tx + 1, ty);
        const horz = !isFloor(layout.mask, tx, ty - 1) && !isFloor(layout.mask, tx, ty + 1);
        if (vert || horz) gaps.push({ tx, ty });
      }
    }

    let tested = 0;
    let skipped = 0;
    const failed = [];

    for (const gap of gaps) {
      for (const [name, [dx, dy, dir]] of Object.entries(DIRS_BY_NAME)) {
        // The approach tile sits opposite the direction of travel.
        const ax = gap.tx - dx;
        const ay = gap.ty - dy;
        if (!isFloor(layout.mask, ax, ay) || isRoomDoor(ax, ay)) { skipped++; continue; }

        for (const offset of OFFSETS) {
          for (const hz of RATES) {
            tested++;
            const state = createGameState(0xF100 + gap.tx, layout.layoutIndex);
            // WARDENs would kill PIP mid-traversal and confound the result.
            state.floor.wardens.length = 0;
            const p = state.floor.player;
            // Centred along the axis of travel, swept across the perpendicular.
            if (dx === 0) {
              p.x = ax * T + offset;
              p.y = ay * T + (T - BOX) / 2;
            } else {
              p.x = ax * T + (T - BOX) / 2;
              p.y = ay * T + offset;
            }
            p.prevX = p.x;
            p.prevY = p.y;

            const input = { dir, facingLatch: dir, fire: false };
            let acc = 0;
            let reached = false;
            for (let f = 0; f < MAX_FRAMES && !reached; f++) {
              const step = advanceAccumulator(acc, 1 / hz);
              acc = step.accumulator;
              for (let s = 0; s < step.steps; s++) {
                updateGame(state, input);
                const cx = Math.floor((p.x + BOX / 2) / T);
                const cy = Math.floor((p.y + BOX / 2) / T);
                if (cx === gap.tx && cy === gap.ty) { reached = true; break; }
              }
            }
            if (!reached) {
              failed.push(`(${gap.tx},${gap.ty}) from ${name} off=${offset} ${hz}Hz`);
            }
          }
        }
      }
    }

    assert(`${layout.id}: every 1-tile gap passable from every approach`,
      failed.length === 0,
      `${failed.length} of ${tested} failed, e.g. ${failed.slice(0, 4).join('; ')}`);
    console.log(`     ${gaps.length} gap tiles, ${tested} combinations tested ` +
      `(${OFFSETS.length} offsets x ${RATES.length} rates), ${skipped} approaches N/A (wall behind)`);
  }
}

console.log('\n# no barrier grants PERMANENT immunity (section 4.3.1)');
{
  // Barriers are PIP's only defensive tool, and section 4.3 forbids giving
  // WARDENs pathfinding - so they are meant to navigate badly. But "badly" must
  // not mean "never". A layout where a stationary PIP is untouchable is a
  // level-design defect, not intended difficulty.
  //
  // Measured at M2 before the fix: PIP stood at the floor-1 spawn for 600 s
  // untouched while a WARDEN logged 29523 ticks on a single tile.
  //
  // The bound is deliberately loose. Worst observed catch is ~48 s; this asserts
  // 120 s so that ordinary bad navigation never makes the suite flaky. It is
  // guarding against infinity, not policing pursuit efficiency.
  const LIMIT_TICKS = 120 * 60;
  const SEEDS = [0xBEEF, 0xABCD, 0x1234, 0x5555, 0xDEAD, 0x0F0F];
  const NEUTRAL = { dir: -1, fire: false, facingLatch: -1 };

  for (const layout of FLOOR_LAYOUTS) {
    let worst = 0;
    const never = [];
    for (const seed of SEEDS) {
      const state = createGameState(seed, layout.layoutIndex);
      let caught = -1;
      for (let i = 0; i < LIMIT_TICKS; i++) {
        const lives = state.run.lives;
        updateGame(state, NEUTRAL);
        if (state.run.lives < lives) { caught = i; break; }
      }
      if (caught < 0) never.push(seed.toString(16));
      else worst = Math.max(worst, caught);
    }
    assert(`${layout.id}: a WARDEN reaches a stationary PIP on every seed`,
      never.length === 0, `never caught on seed(s) ${never.join(', ')}`);
    console.log(`     worst catch ${(worst / 60).toFixed(1)}s of ${LIMIT_TICKS / 60}s budget`);
  }
}

console.log('\n# M4: seal all four rooms, unlock the stairs, descend (section 2)');
{
  // The milestone's own validation: loot floor 1, descend. Driven through the
  // REAL path - walk onto each door, zoom, take the treasure, walk out, zoom -
  // rather than setting looted flags by hand, because the flags are the thing
  // under test.
  const state = createGameState(0x4004, 0);
  state.floor.wardens.length = 0;
  const p = state.floor.player;
  const T = TUNING.tile;
  p.invulnTicks = 1e9;

  const run = (n, input) => { for (let i = 0; i < n; i++) updateGame(state, input); };
  const NEUTRAL = { dir: -1, facingLatch: -1, fire: false };

  check('stairs start locked', isStairsUnlocked(state.floor), false);

  // The gate must actually hold in updateGame's dispatch, not merely in the
  // isStairsUnlocked() helper read in isolation - walk PIP onto the stairs
  // tile itself, before any room is looted, and confirm the phase does NOT
  // advance to FLOOR_CLEAR_BONUS. Every check below this point only visits
  // the stairs AFTER all four rooms are looted, so without this the gate in
  // state.js's FLOOR_VIEW dispatch (`playerOnStairs && isStairsUnlocked`)
  // could be deleted entirely and nothing in this suite would notice.
  {
    const st0 = FLOOR_LAYOUTS[0].stairs;
    p.x = st0.tx * T + 1;
    p.y = st0.ty * T + 1;
    p.prevX = p.x;
    p.prevY = p.y;
    assert('early stairs check: PIP is actually standing on the stairs tile',
      playerOnStairs(state.floor));
    updateGame(state, NEUTRAL);
    check('stepping on LOCKED stairs does not start the floor clear',
      state.phase, GAME_PHASES.FLOOR_VIEW);
  }

  for (const room of FLOOR_LAYOUTS[0].rooms) {
    // Teleport to the door, which the passability matrix already proves is
    // walkable; this test is about sealing, not traversal.
    p.x = room.door.tx * T + (T - TUNING.player.hitboxFloor) / 2;
    p.y = room.door.ty * T + (T - TUNING.player.hitboxFloor) / 2;
    p.prevX = p.x;
    p.prevY = p.y;
    updateGame(state, NEUTRAL);
    assert(`${room.id}: touching the door begins the zoom`,
      state.phase === GAME_PHASES.ROOM_ZOOM_IN, `phase ${state.phase}`);
    run(TUNING.zoom.durationTicks + 1, NEUTRAL);
    assert(`${room.id}: zoom landed in the room`, state.phase === GAME_PHASES.ROOM_VIEW);

    // Take the treasure, then leave by a door.
    const def = ROOM_DEFS[room.id];
    p.x = def.treasure.tx * T + 1;
    p.y = def.treasure.ty * T + 1;
    updateGame(state, NEUTRAL);
    check(`${room.id}: treasure taken`, state.floor.rooms[room.id].treasureTaken, true);

    p.x = def.doors[0].tx * T + 1;
    p.y = def.doors[0].ty * T + 1;
    updateGame(state, NEUTRAL);
    run(TUNING.zoom.durationTicks + 2, NEUTRAL);
    check(`${room.id}: back on the floor`, state.phase, GAME_PHASES.FLOOR_VIEW);
    check(`${room.id}: PERMANENTLY sealed`, state.floor.looted[room.id], true);
  }

  check('all four looted -> stairs unlock', isStairsUnlocked(state.floor), true);

  // A sealed room must not re-open when PIP walks over its door again.
  const first = FLOOR_LAYOUTS[0].rooms[0];
  p.x = first.door.tx * T + 1;
  p.y = first.door.ty * T + 1;
  updateGame(state, NEUTRAL);
  check('a sealed room does not re-open', state.phase, GAME_PHASES.FLOOR_VIEW);

  // Descend.
  const clockBefore = state.floor.elapsedTicks;
  const st = FLOOR_LAYOUTS[0].stairs;
  p.x = st.tx * T + 1;
  p.y = st.ty * T + 1;
  updateGame(state, NEUTRAL);
  check('standing on unlocked stairs starts the floor clear',
    state.phase, GAME_PHASES.FLOOR_CLEAR_BONUS);
  assert('the clock kept running into the bonus phase',
    state.floor.elapsedTicks > clockBefore);

  run(TUNING.zoom.durationTicks + 2, NEUTRAL);
  check('descended to floor 2', state.floorIndex, 1);
  check('back in floor view', state.phase, GAME_PHASES.FLOOR_VIEW);
  // Section 3.4: startFloor is the ONLY reset, and a descent is exactly that.
  assert('the floor clock reset for the new floor, and only here',
    state.floor.elapsedTicks < clockBefore, `${state.floor.elapsedTicks}`);
  check('the new floor starts unlooted', isStairsUnlocked(state.floor), false);
}

console.log('\n# floor descriptor indexing (section 2.1)');
{
  // One clamp, one place. Floor 10+ replays floor 9.
  const d0 = floorDescriptorFor(0, TUNING);
  check('floor 1 layoutIndex', d0.layoutIndex, 0);
  check('floor 1 warden count', d0.wardenCount, 2);
  check('floor 1 speedMul', d0.speedMul, 1.00);
  check('floor 1 treasure', d0.treasureValue, 400);

  const d8 = floorDescriptorFor(8, TUNING);
  check('floor 9 effectiveFloorIndex', d8.effectiveFloorIndex, 8);
  check('floor 9 warden count', d8.wardenCount, 6);

  // The clamp.
  const d99 = floorDescriptorFor(99, TUNING);
  check('floor 100 clamps to effectiveFloorIndex 8', d99.effectiveFloorIndex, 8);
  check('floor 100 keeps raw floorIndex for display', d99.floorIndex, 99);
  check('floor 100 speedMul equals floor 9', d99.speedMul, d8.speedMul);
  check('floor 100 warden count equals floor 9', d99.wardenCount, d8.wardenCount);

  // Warden count per cycle: floors 1-3 give 2/3/4, floors 7-9 give 4/5/6.
  const counts = [0, 1, 2, 6, 7, 8].map((i) => floorDescriptorFor(i, TUNING).wardenCount);
  assert('warden counts 2,3,4 then 4,5,6', counts.join(',') === '2,3,4,4,5,6', counts.join(','));

  // Treasure indexed by LAYOUT, no cycle multiplier.
  const treasures = [0, 3, 6].map((i) => floorDescriptorFor(i, TUNING).treasureValue);
  assert('treasure is 400 on floors 1, 4 and 7', treasures.join(',') === '400,400,400',
    treasures.join(','));
}

console.log('\n# SECTION 4.1 [v1.2]: RUN state survives a descent, FLOOR state does not');
{
  // M5 EXPLOIT 1, and the most serious defect found in the milestone. `lives`
  // was a field on the player object, the player object is built by
  // createFloorRuntime, and startFloor replaces the whole floor runtime - so
  // walking down the stairs reset lives to 3. Game over was per-FLOOR, not
  // per-RUN. Nothing punished dying, so the intrusion clock stopped mattering.
  //
  // Not caught earlier because the M4 descent test sets invulnTicks to 1e9 to
  // reach the stairs alive, which makes it structurally incapable of observing
  // a lives bug. See docs/NOTES.md.
  //
  // Mutation-verified: putting `lives: TUNING.player.startingLives` back on
  // createPlayer and reading it from there fails the first assertion below.
  const NEUTRAL = { dir: -1, facingLatch: -1, fire: false };
  const state = createGameState(0x5171, 0);
  state.floor.wardens.length = 0;

  // Lose two of three lives on floor 1.
  for (let d = 0; d < 2; d++) {
    applyPlayerDeath(state);
    let guard = 0;
    while (state.phase !== GAME_PHASES.FLOOR_VIEW && guard++ < 600) {
      updateGame(state, NEUTRAL);
    }
  }
  check('two deaths leave one life', state.run.lives, 1);

  // Bank some score and move the extra-life threshold, so this covers all of
  // run state and not just the field that broke.
  state.run.score = 1234;
  state.run.nextExtraLifeAt = 40000;

  // Clear the floor and take the stairs.
  for (const room of state.floor.layout.rooms) state.floor.looted[room.id] = true;
  const size = TUNING.player.hitboxFloor;
  const stairs = state.floor.layout.stairs;
  const p = state.floor.player;
  p.x = stairs.tx * TUNING.tile + (TUNING.tile - size) / 2;
  p.y = stairs.ty * TUNING.tile + (TUNING.tile - size) / 2;
  p.prevX = p.x; p.prevY = p.y;
  p.invulnTicks = 1e9;

  const timerBefore = state.floor.elapsedTicks;
  let guard = 0;
  while (state.floorIndex === 0 && guard++ < 600) updateGame(state, NEUTRAL);
  check('the stairs advanced the floor', state.floorIndex, 1);

  // RUN-scoped: must survive.
  check('lives SURVIVE the descent', state.run.lives, 1);
  check('score SURVIVES the descent', state.run.score, 1234);
  check('the extra-life threshold SURVIVES the descent', state.run.nextExtraLifeAt, 40000);

  // FLOOR-scoped: must be rebuilt. The clock resetting here is correct and is
  // the one reset section 3.4 allows - startFloor and nowhere else.
  assert('the floor clock DID reset on the new floor',
    state.floor.elapsedTicks < timerBefore,
    `was ${timerBefore}, now ${state.floor.elapsedTicks}`);
  check('the new floor has no looted rooms', Object.keys(state.floor.looted).length, 0);

  // And the structural guarantee, not just the symptom: the floor-scoped player
  // has no lives field at all, so there is nowhere for this bug to come back.
  assert('createPlayer exposes NO lives field to be reset',
    state.floor.player.lives === undefined,
    `player.lives is ${state.floor.player.lives}`);

  // Run out the last life: game over is per-RUN.
  applyPlayerDeath(state);
  guard = 0;
  while (state.phase !== GAME_PHASES.GAME_OVER && guard++ < 600) updateGame(state, NEUTRAL);
  check('losing the last life on floor 2 ends the RUN', state.phase, GAME_PHASES.GAME_OVER);
  assert('gameOver is set', state.gameOver === true);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} tests/floors.mjs`);
process.exit(failures === 0 ? 0 : 1);
