// VAULT RAIDER - floor view. SPEC v0.7 sections 2, 3.2, 3.4, 4.3.
//
// Floor view is EVASION. Room view (M3) is combat under a clock.
//
// No DOM access. Safe to import from tests/.

import { TUNING } from '../data/tuning.js';
import { FLOOR_LAYOUTS, floorDescriptorFor } from '../data/floors.js';
import {
  createPlayer, createArrowState, createWarden, requestFire,
  updatePlayerFloor, updateArrow, updateWarden, wardenTouchesPlayer
} from './entities.js';

export function createFloorRuntime(floorIndex, rng) {
  const descriptor = floorDescriptorFor(floorIndex, TUNING);
  const layout = descriptor.layout;

  const wardens = [];
  for (let i = 0; i < descriptor.wardenCount; i++) {
    // More WARDENs than routes on deep floors: reuse routes, offset the start
    // waypoint so they do not stack on one another.
    const route = layout.wardenRoutes[i % layout.wardenRoutes.length];
    // Alternating handedness so two WARDENs wedged on the same barrier scrape
    // around it opposite ways rather than trailing each other.
    wardens.push(createWarden({
      waypoints: route.waypoints,
      startIdx: route.startIdx + Math.floor(i / layout.wardenRoutes.length)
    }, descriptor.wardenSpeedMul, i % 2 === 0 ? 1 : -1));
  }

  return {
    descriptor,
    layout,
    mask: layout.mask,
    player: createPlayer(layout.spawn.tx, layout.spawn.ty),
    arrow: createArrowState(),
    wardens,
    // Per-FLOOR intrusion clock (section 3.4). Set ONLY here, at floor start.
    elapsedTicks: 0,
    // Room seal state (section 2.4) and live room runtimes, keyed by room id.
    // `looted` survives death; `rooms` does not, for unlooted rooms (4.1).
    looted: {},
    rooms: {},
    rng
  };
}

// SPEC 3.4 - THE central scoring tension.
//
// Called from updateGame BEFORE phase dispatch, on EVERY phase: floor view,
// room view, zoom transitions, and death. There is deliberately no condition
// on this function and no caller may add one. It resets only when a new floor
// starts, which is createFloorRuntime and nowhere else.
export function tickFloorTimer(floor) {
  floor.elapsedTicks++;
}

export function floorElapsedSec(floor) {
  return floor.elapsedTicks * TUNING.dt;
}

export function updateFloor(floor, input) {
  const speedMul = floor.descriptor.speedMul;

  // Corpses block PIP only (section 3.5) and do not exist until M3, so the
  // blocked-tile set is null here. WARDENs are never passed one - they are
  // unblockable by corpses by definition (section 3.5).
  updatePlayerFloor(floor.player, input, floor.mask, speedMul, null);

  // Section 3.2: hall firing is enabled and useless. The arrow is real.
  if (input.fire && TUNING.flags.HALL_FIRE_ENABLED) {
    requestFire(floor.arrow);
  }
  updateArrow(floor.arrow, floor.player, floor.mask);

  const elapsed = floorElapsedSec(floor);
  for (const warden of floor.wardens) {
    updateWarden(warden, floor.player, floor.mask, elapsed, speedMul, floor.rng);
  }

  // Contact kills unless PIP is in respawn invulnerability.
  if (floor.player.invulnTicks > 0) {
    floor.player.invulnTicks--;
    return { death: false };
  }
  for (const warden of floor.wardens) {
    if (wardenTouchesPlayer(warden, floor.player, false)) return { death: true };
  }
  return { death: false };
}

export function respawnPlayerOnFloor(floor) {
  const spawn = floor.layout.spawn;
  const fresh = createPlayer(spawn.tx, spawn.ty);
  floor.player.x = fresh.x;
  floor.player.y = fresh.y;
  floor.player.prevX = fresh.x;
  floor.player.prevY = fresh.y;
  floor.player.facing = fresh.facing;
  floor.player.invulnTicks = Math.round(TUNING.player.respawnInvulnSec / TUNING.dt);
  // Arrow does not survive a death.
  floor.arrow.alive = false;
  floor.arrow.pending = false;
}

// Which room door is PIP standing on, if any. Returns the room entry with its
// id and side so state.js can begin the zoom.
export function doorUnderPlayer(floor) {
  const size = TUNING.player.hitboxFloor;
  const cx = Math.floor((floor.player.x + size / 2) / TUNING.tile);
  const cy = Math.floor((floor.player.y + size / 2) / TUNING.tile);
  for (const room of floor.layout.rooms) {
    if (room.door.tx === cx && room.door.ty === cy) {
      // Side is which way PIP steps back OUT onto the corridor.
      const side = room.door.ty < TUNING.gridH / 2 ? 'N' : 'S';
      return { id: room.id, tx: room.door.tx, ty: room.door.ty, side };
    }
  }
  return null;
}

export function isStairsUnlocked(floor) {
  const rooms = floor.layout.rooms;
  for (const room of rooms) if (!floor.looted[room.id]) return false;
  return true;
}

export function floorLayoutCount() {
  return FLOOR_LAYOUTS.length;
}
