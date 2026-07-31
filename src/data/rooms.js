// VAULT RAIDER - room definitions. SPEC v0.8 sections 5, 7.2.
//
// M3 ships THE COIL only. The other eleven rooms arrive at M4 and M7.
//
// Tilemap is 30 rows of 40 chars at 8px - the same grid as floor view
// (section 1). PIP's collision box in room view is 6x6, so a 1-tile gap leaves
// only 1px of slack per side. The three pinch shortcuts below are deliberate:
// they are the geometry doorway snap-assist (section 4.1) exists for, and until
// M3 that code had never executed. See tests/rooms.mjs.
//
// Validated by tests/rooms.mjs and tests/winnability.mjs.
// No DOM access. Safe to import from tests/.

export const ROOM_DEFS = {
  coil: {
    id: 'coil',
    shipName: 'THE COIL',
    layoutIndex: 0,
    // Serpentine: four 2-tall lanes joined alternately at the ends, with
    // 1-tile pinch shortcuts through the middle. CRAWLERs wall-follow, so a
    // room made of long walls gives them something to be predictable against.
    tiles: [
      '##########.#############################',
      '##########.#############################',
      '##########.#############################',
      '###..................................###',
      '###..................................###',
      '####################.##############..###',
      '####################.##############..###',
      '####################.##############..###',
      '####################.##############..###',
      '###..................................###',
      '###..................................###',
      '###..#######.###########################',
      '###..#######.###########################',
      '###..#######.###########################',
      '###..#######.###########################',
      '###..................................###',
      '###..................................###',
      '############################.######..###',
      '############################.######..###',
      '############################.######..###',
      '############################.######..###',
      '###..................................###',
      '###..................................###',
      '############################.###########',
      '############################.###########',
      '############################.###########',
      '############################.###########',
      '############################.###########',
      '############################.###########',
      '############################.###########'
    ],
    doors: [
      { tx: 10, ty: 0, side: 'N' },
      { tx: 28, ty: 29, side: 'S' }
    ],
    // safeTile: standing on the pickup point makes PIP unkillable (section 3.7).
    // Camping to let monsters drift away is INTENDED, not an exploit.
    treasure: { tx: 20, ty: 21, type: 'goblet', safeTile: true },
    // Section 5, floor 1: 4x CRAWLER, LOW dodge, no trap on pickup.
    spawnOnEntry: [
      { type: 'CRAWLER', tx: 6, ty: 3, dodge: 'LOW' },
      { type: 'CRAWLER', tx: 33, ty: 9, dodge: 'LOW' },
      { type: 'CRAWLER', tx: 6, ty: 15, dodge: 'LOW' },
      { type: 'CRAWLER', tx: 33, ty: 21, dodge: 'LOW' }
    ],
    spawnOnPickup: [],
    hazards: []
  }
};

export const ROOM_IDS_BY_FLOOR = [
  ['slabs', 'coil', 'ossuary', 'warrens'],
  ['web', 'forge', 'sump', 'fork'],
  ['lamp', 'pit', 'eye', 'roost']
];

// Which doors exist, so floor view can pick the entry door matching the side
// PIP approached from. Falls back to the first door.
export function roomEntryDoor(roomDef, preferredSide) {
  for (const door of roomDef.doors) {
    if (door.side === preferredSide) return door;
  }
  return roomDef.doors[0];
}
