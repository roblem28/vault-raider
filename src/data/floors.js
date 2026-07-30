// VAULT RAIDER - floor layouts. SPEC v0.7 section 7.1.
//
// M2 ships layout 0 only. Layouts 1 and 2 arrive at M7.
//
// Mask is 30 rows of 40 chars, '#' wall, '.' floor. Tile is 8 px, so this is
// exactly 320x240 - the one grid (section 1).
//
// Geometry, so a future edit does not break it by accident:
//   - Ring corridor 2 tiles wide. Warden route 1 rides the OUTER lane
//     (x=3, y=3, x=36, y=26), which is why every barrier below blocks the
//     INNER lane only. A barrier across an outer lane would seal a patrol
//     route and strand a WARDEN.
//   - Central vertical corridor x=20..21 carries warden route 2 and reaches
//     the stairs at (20,15).
//   - Each room door is a 1-TILE notch. These are the tight gaps that
//     section 4.1's 6x6 hitbox and doorway snap-assist exist for. Do not widen
//     them to "fix" movement feel - fix the assist instead.
//   - Barriers are baked into the mask as wall, not carried as a separate
//     array. See docs/NOTES.md M2-D1.
//
// Validated by tests/floors.mjs: spawn reaches all 4 doors and the stairs,
// and every warden waypoint sits on a floor tile.
//
// No DOM access. Safe to import from tests/.

export const FLOOR_LAYOUTS = [
  {
    id: 'floor1',
    layoutIndex: 0,
    spawn: { tx: 5, ty: 25 },
    mask: [
      '########################################',
      '########################################',
      '########################################',
      '###..................................###',
      '###.........#####.......####.........###',
      '###..#####.#########..######.######..###',
      '###..#####.#########..######.######..###',
      '###..#####.#########..######.######..###',
      '###..###############..#############..###',
      '###..###############..#############..###',
      '###..###############..#############..###',
      '###..###############..#############..###',
      '###.################..##############.###',
      '###.################..##############.###',
      '###.################..##############.###',
      '###.################..##############.###',
      '###.################..##############.###',
      '###..###############..#############..###',
      '###..###############..#############..###',
      '###..###############..#############..###',
      '###..###############..#############..###',
      '###..###############..#############..###',
      '###..#####.#########..######.######..###',
      '###..#####.#########..######.######..###',
      '###..#####.#########..######.######..###',
      '###.........#####.......####.........###',
      '###..................................###',
      '########################################',
      '########################################',
      '########################################'
    ],
    wardenRoutes: [
      { waypoints: [[3, 3], [36, 3], [36, 26], [3, 26]], startIdx: 0 },
      { waypoints: [[20, 3], [20, 26]], startIdx: 1 }
    ],
    rooms: [
      { id: 'coil', door: { tx: 10, ty: 7 }, rect: [6, 7, 9, 6] },
      { id: 'ossuary', door: { tx: 28, ty: 7 }, rect: [24, 7, 9, 6] },
      { id: 'slabs', door: { tx: 10, ty: 22 }, rect: [6, 17, 9, 6] },
      { id: 'warrens', door: { tx: 28, ty: 22 }, rect: [24, 17, 9, 6] }
    ],
    stairs: { tx: 20, ty: 15, lockedUntilAllLooted: true }
  }
];

// SPEC section 2.1 - ONE clamp, ONE place. Every value that escalates with
// depth derives from effectiveFloorIndex. Clamping anywhere else is a defect.
export function floorDescriptorFor(floorIndex, tuning) {
  const effectiveFloorIndex = Math.min(floorIndex, tuning.maxFloorIndex);
  const layoutIndex = effectiveFloorIndex % tuning.layoutCount;
  return {
    floorIndex,                 // raw: display and score accumulation ONLY
    effectiveFloorIndex,
    layoutIndex,
    layout: FLOOR_LAYOUTS[layoutIndex % FLOOR_LAYOUTS.length],
    speedMul: tuning.floorSpeedMul[effectiveFloorIndex],
    floorTimerSec: tuning.warden.floorTimerSec[layoutIndex],
    wardenSpeedMul: tuning.warden.speedMul[layoutIndex],
    wardenCount: tuning.warden.countByLayout[layoutIndex] +
      Math.floor(effectiveFloorIndex / tuning.layoutCount),
    treasureValue: tuning.scoring.treasureByFloor[layoutIndex]
  };
}
