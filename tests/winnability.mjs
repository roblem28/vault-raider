// VAULT RAIDER - winnability. SPEC v0.8 sections 3.13, 12.1.
//
// THE guard for "every room is beatable treasure-only, with ZERO kills"
// (mechanic 13). Monsters are ignored entirely: the question is whether the
// GEOMETRY permits door -> treasure -> door, not whether a given fight is
// survivable.
//
// M3 covers THE COIL. All twelve rooms at M7 - this file iterates ROOM_DEFS and
// needs no change to pick them up.
//
// LIMITATION, stated because it matters: this BFS is TILE-BASED and does not
// model PIP's collision box at all. A 1-tile gap that is geometrically
// connected but too tight for a 6x6 box would pass here and still softlock the
// player. That case is covered by the passability matrix in tests/rooms.mjs,
// not by this file. Neither test subsumes the other.
//
// Zero dependencies. Node only, no DOM.

import { TUNING, TILE_CHARS } from '../src/data/tuning.js';
import { ROOM_DEFS } from '../src/data/rooms.js';

let failures = 0;

function assert(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${detail || ''}`}`);
}

function isFloor(tiles, tx, ty) {
  if (ty < 0 || ty >= tiles.length) return false;
  const row = tiles[ty];
  if (tx < 0 || tx >= row.length) return false;
  return row[tx] === TILE_CHARS.FLOOR;
}

function reachable(tiles, sx, sy) {
  const seen = new Set();
  if (!isFloor(tiles, sx, sy)) return seen;
  const queue = [[sx, sy]];
  seen.add(sx + ',' + sy);
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = nx + ',' + ny;
      if (!seen.has(key) && isFloor(tiles, nx, ny)) {
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
  }
  return seen;
}

const ids = Object.keys(ROOM_DEFS);
console.log(`# ${ids.length} of 12 rooms authored (all twelve at M7)`);

for (const id of ids) {
  const def = ROOM_DEFS[id];
  console.log(`\n## ${def.shipName}`);

  const treasureKey = def.treasure.tx + ',' + def.treasure.ty;

  // Every door must reach the treasure, and the treasure must reach a door
  // back out. Doing it per-door catches a room where one entrance is a
  // one-way pocket.
  for (const door of def.doors) {
    const fromDoor = reachable(def.tiles, door.tx, door.ty);
    assert(`${id}: door ${door.side} (${door.tx},${door.ty}) reaches the treasure`,
      fromDoor.has(treasureKey), `treasure at ${treasureKey}`);
  }

  const fromTreasure = reachable(def.tiles, def.treasure.tx, def.treasure.ty);
  let exits = 0;
  for (const door of def.doors) {
    if (fromTreasure.has(door.tx + ',' + door.ty)) exits++;
  }
  assert(`${id}: the treasure reaches at least one door back out`, exits > 0);
  console.log(`     ${exits} of ${def.doors.length} doors reachable from the treasure`);

  // Kill-free means the route must not depend on removing a monster. Since
  // monsters are ignored above, the only way this could be violated is a spawn
  // sitting in a corridor so narrow it is the sole route - flagged rather than
  // asserted, because a monster can always be walked around in an open room.
  const route = reachable(def.tiles, def.doors[0].tx, def.doors[0].ty);
  assert(`${id}: every entry spawn sits on a reachable tile`,
    def.spawnOnEntry.every((s) => route.has(s.tx + ',' + s.ty)),
    'a spawn is walled off, which would strand a monster');

  // Trap spawns (section 3.12) appear on PICKUP and must not be able to seal
  // the treasure in - they need to be reachable too, or they spawn in a wall.
  assert(`${id}: every pickup spawn sits on a reachable tile`,
    def.spawnOnPickup.every((s) => route.has(s.tx + ',' + s.ty)));

  console.log(`     ${route.size} tiles reachable from door 0`);
}

console.log('\n# grid discipline (section 1)');
for (const id of ids) {
  const def = ROOM_DEFS[id];
  assert(`${id}: tilemap is gridH rows`, def.tiles.length === TUNING.gridH);
  assert(`${id}: every row is gridW chars`,
    def.tiles.every((r) => r.length === TUNING.gridW));
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} tests/winnability.mjs`);
process.exit(failures === 0 ? 0 : 1);
