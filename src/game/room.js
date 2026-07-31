// VAULT RAIDER - room view. SPEC v0.8 sections 2, 3.3, 3.5, 3.7, 3.12, 5, 7.2.
//
// Room view is COMBAT UNDER A CLOCK. Floor view is evasion. The two-view
// structure is the game.
//
// The clock is NOT owned here. It is per-FLOOR (section 3.4) and ticks in
// state.js before phase dispatch, including while a room is open. Nothing in
// this file may read or write floor.elapsedTicks.
//
// No DOM access. Safe to import from tests/.

import { TUNING, DIRS, DIR_NEUTRAL } from '../data/tuning.js';
import { ROOM_DEFS } from '../data/rooms.js';
import { tileCenterPx, aabbOverlap } from './collision.js';
import {
  requestFire, updateArrow, updatePlayerRoom,
  createMonster, updateMonster, monsterTouchesPlayer, monsterDodgeCheck,
  monsterHurtBox, createCorpse, updateCorpses, corpseBlockedTiles,
  corpseAtPixel, shootCorpse, corpseTouchesPlayer,
  createWarden, updateWarden, wardenTouchesPlayer, playerHurtBox,
  hazardTouchesPlayer
} from './entities.js';

export function createRoomRuntime(roomId, entryDoor, rng) {
  const def = ROOM_DEFS[roomId];
  const monsters = [];
  for (const spawn of def.spawnOnEntry) monsters.push(createMonster(spawn, rng));

  return {
    def,
    id: roomId,
    tiles: def.tiles,
    entryDoor,
    monsters,
    corpses: [],
    // NO arrow here. PIP has ONE bow, so there is ONE arrow, and it lives on
    // the floor runtime alongside PIP because both persist across room entry
    // and exit. A per-view arrow object let PIP fire in the hall, walk into a
    // room while it was still flying, and fire again - two arrows alive at
    // once, which section 3.8 forbids. Measured before the fix.
    treasureTaken: false,
    // Section 3.3: once a WARDEN intrudes it NEVER leaves. The only escape is
    // leaving the room.
    intruder: null,
    // Room-local tick. Hazard sweeps are a pure function of this (section 4.5),
    // so they need no state of their own and stay deterministic.
    ticks: 0,
    rng
  };
}

// PIP enters standing on the door tile, nudged one tile into the room so he is
// not straddling the threshold.
export function roomEntryPosition(def, door) {
  const inward = door.side === 'N' ? { dx: 0, dy: 1 }
    : door.side === 'S' ? { dx: 0, dy: -1 }
      : door.side === 'W' ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
  const size = TUNING.player.hitboxRoom;
  return {
    x: tileCenterPx(door.tx + inward.dx) - size / 2,
    y: tileCenterPx(door.ty + inward.dy) - size / 2
  };
}

// Section 3.7: while standing on the pickup point PIP cannot be killed.
// Camping to let monsters drift away is INTENDED, not a bug to close.
export function playerOnSafeTile(room, player) {
  if (!room.def.treasure.safeTile) return false;
  const t = room.def.treasure;
  const p = playerHurtBox(player, true);
  return aabbOverlap(
    p.x, p.y, p.w, p.h,
    t.tx * TUNING.tile, t.ty * TUNING.tile, TUNING.tile, TUNING.tile
  );
}

function playerOnDoor(room, player) {
  const size = TUNING.player.hitboxRoom;
  const cx = Math.floor((player.x + size / 2) / TUNING.tile);
  const cy = Math.floor((player.y + size / 2) / TUNING.tile);
  for (const door of room.def.doors) {
    if (door.tx === cx && door.ty === cy) return door;
  }
  return null;
}

// Section 3.3: past floorTimerSec a WARDEN enters through a door and hunts.
export function spawnIntrusionWarden(room, descriptor) {
  if (room.intruder) return;
  const door = room.def.doors[room.rng.nextInt(room.def.doors.length)];
  room.intruder = createWarden(
    { waypoints: [[door.tx, door.ty]], startIdx: 0 },
    descriptor.wardenSpeedMul,
    1
  );
}

export function updateRoom(room, player, arrow, input, descriptor, elapsedSec) {
  const speedMul = descriptor.speedMul;
  room.ticks++;

  // Corpses block PIP ONLY, by TILE OCCUPANCY (section 3.5). Monsters and the
  // intruding WARDEN are never given this set.
  const blocked = corpseBlockedTiles(room);
  updatePlayerRoom(player, input, room.tiles, speedMul, blocked);

  if (input.fire) requestFire(arrow);
  updateArrow(arrow, player, room.tiles);

  // Arrow resolution. Order matters: dodge first, then hit.
  if (arrow.alive) {
    for (const monster of room.monsters) {
      monsterDodgeCheck(monster, arrow, room.rng, room.tiles);
    }
    for (const monster of room.monsters) {
      if (!monster.alive) continue;
      const m = monsterHurtBox(monster);
      if (aabbOverlap(arrow.x, arrow.y, 1, 1, m.x, m.y, m.w, m.h)) {
        monster.hp--;
        arrow.alive = false;
        if (monster.hp <= 0) {
          monster.alive = false;
          room.corpses.push(createCorpse(monster.x, monster.y));
        }
        break;
      }
    }
  }
  // Section 3.6: shooting a corpse is punished.
  if (arrow.alive) {
    const hit = corpseAtPixel(room, arrow.x, arrow.y);
    if (hit) {
      shootCorpse(room, hit);
      arrow.alive = false;
    }
  }

  for (const monster of room.monsters) updateMonster(monster, room.tiles, speedMul);
  updateCorpses(room);

  // Section 3.3 intrusion. The clock is per-FLOOR and is read, never written.
  if (!room.intruder && elapsedSec >= descriptor.floorTimerSec) {
    spawnIntrusionWarden(room, descriptor);
  }
  if (room.intruder) {
    // Section 4.3: PURE chase, ignores geometry cost. The trailing `true` is
    // load-bearing - without it the intruder rolls against pursuit bias like a
    // patrol WARDEN and heads back to its spawn door on ~10% of ticks forever.
    // Corpses do not block it (section 3.5).
    updateWarden(room.intruder, player, room.tiles, elapsedSec, speedMul, room.rng, true);
  }

  // Treasure pickup. Section 3.12: trap rooms spawn on PICKUP, not on entry.
  if (!room.treasureTaken) {
    const t = room.def.treasure;
    const p = playerHurtBox(player, true);
    if (aabbOverlap(p.x, p.y, p.w, p.h,
      t.tx * TUNING.tile, t.ty * TUNING.tile, TUNING.tile, TUNING.tile)) {
      room.treasureTaken = true;
      for (const spawn of room.def.spawnOnPickup) {
        room.monsters.push(createMonster(spawn, room.rng));
      }
    }
  }

  // Death checks. The safe tile beats everything (section 3.7).
  let death = false;
  // READ ONLY. The decrement is tickPlayerInvuln in updateGame, unconditional
  // and above the phase dispatch (section 4.1 [v1.2]).
  if (player.invulnTicks > 0) {
    // deliberately empty: invulnerable, no death check runs
  } else if (!playerOnSafeTile(room, player)) {
    for (const monster of room.monsters) {
      if (monsterTouchesPlayer(monster, player)) death = true;
    }
    for (const corpse of room.corpses) {
      if (corpseTouchesPlayer(corpse, player)) death = true;
    }
    if (room.intruder && wardenTouchesPlayer(room.intruder, player, true)) death = true;
    // Section 4.5: hazard contact kills. Pure timing, no counterplay.
    for (const hazard of room.def.hazards) {
      if (hazardTouchesPlayer(hazard, room.ticks, player)) death = true;
    }
  }

  const door = playerOnDoor(room, player);
  return { death, exitDoor: death ? null : door };
}

export function roomTreasureValue(descriptor) {
  return descriptor.treasureValue;
}

// Section 4.1 death handling: unlooted rooms reset to their entry spawn state.
// Looted rooms stay looted, and are never rebuilt.
export function resetUnlootedRoom(room) {
  room.monsters.length = 0;
  for (const spawn of room.def.spawnOnEntry) {
    room.monsters.push(createMonster(spawn, room.rng));
  }
  room.corpses.length = 0;
  room.intruder = null;
  room.treasureTaken = false;
  // Hazard sweeps restart with the room, so a death does not hand the player a
  // barrier frozen mid-cycle.
  room.ticks = 0;
}

export function roomHasIntruder(room) {
  return room.intruder !== null;
}

// Section 3.3 / 10: the siren begins intrusionWarnSec BEFORE entry, and
// section 11 forbids audio-only information - so this drives an on-screen
// indicator too, not just the sound.
export function intrusionWarningLevel(descriptor, elapsedSec) {
  const warn = TUNING.warden.intrusionWarnSec;
  const remain = descriptor.floorTimerSec - elapsedSec;
  if (remain > warn) return 0;
  if (remain <= 0) return 1;
  return 1 - remain / warn;
}

export const ROOM_EXIT_DIRS = DIRS;
export const ROOM_DIR_NEUTRAL = DIR_NEUTRAL;
