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
  },
  // THE SLABS - the only pure-timing room in the game. No monsters at all, so
  // the 1-tile door corridors are free here: the dodge-dead rule only binds
  // where monsters live. Tallest run 26, widest 34, narrowest 1 (door only).
  //
  // TENSION: cross four sweeping electrified barriers with no combat option.
  // The only resource is timing, and the floor clock is running the whole time.
  slabs: {
    id: 'slabs',
    shipName: 'THE SLABS',
    layoutIndex: 0,
    tiles: [
      '##########.#############################',
      '##########.#############################',
      '##########.#############################',
      '##########.#############################',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###.........#..............#.........###',
      '###.........#..............#.........###',
      '###.........#..............#.........###',
      '###.........#..............#.........###',
      '###.........#..............#.........###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###.........#..............#.........###',
      '###.........#..............#.........###',
      '###.........#..............#.........###',
      '###.........#..............#.........###',
      '###.........#..............#.........###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '############################.###########',
      '############################.###########',
      '############################.###########',
      '############################.###########',
    ],
    doors: [
      { tx: 10, ty: 0, side: 'N' },
      { tx: 28, ty: 29, side: 'S' }
    ],
    treasure: { tx: 20, ty: 14, type: 'coin', safeTile: true },
    spawnOnEntry: [],
    spawnOnPickup: [],
    // Section 4.5 SLIDING_BARRIER: electrified segment on a fixed sweep period,
    // contact kills, pure timing. Periods are deliberately coprime-ish so the
    // four never settle into a single rhythm the player can memorise as one
    // pattern.
    hazards: [
      { type: 'SLIDING_BARRIER', tx: 6, ty: 6, tw: 1, th: 5, axis: 'x', travel: 8, periodTicks: 150, phaseTicks: 0 },
      { type: 'SLIDING_BARRIER', tx: 20, ty: 6, tw: 1, th: 5, axis: 'x', travel: 6, periodTicks: 130, phaseTicks: 40 },
      { type: 'SLIDING_BARRIER', tx: 6, ty: 19, tw: 1, th: 5, axis: 'x', travel: 8, periodTicks: 170, phaseTicks: 80 },
      { type: 'SLIDING_BARRIER', tx: 20, ty: 19, tw: 1, th: 5, axis: 'x', travel: 6, periodTicks: 110, phaseTicks: 20 }
    ]
  },

  // THE OSSUARY - an open chamber with four pillars. BOUNCERs ricochet
  // diagonally and need room to do it; nothing a monster can reach is narrower
  // than 3. Tallest run 22, widest 34, narrowest in monster space 22.
  //
  // TENSION: the monsters move unpredictably and the room is open, so you
  // cannot plan a route and there is nowhere to break line of sight. You react,
  // or you leave.
  ossuary: {
    id: 'ossuary',
    shipName: 'THE OSSUARY',
    layoutIndex: 0,
    tiles: [
      '############################.###########',
      '############################.###########',
      '############################.###########',
      '############################.###########',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###......####..............####......###',
      '###......####..............####......###',
      '###......####..............####......###',
      '###......####..............####......###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###......####..............####......###',
      '###......####..............####......###',
      '###......####..............####......###',
      '###......####..............####......###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '##########.#############################',
      '##########.#############################',
      '##########.#############################',
      '##########.#############################',
    ],
    doors: [
      { tx: 28, ty: 0, side: 'N' },
      { tx: 10, ty: 29, side: 'S' }
    ],
    treasure: { tx: 20, ty: 14, type: 'ring', safeTile: true },
    spawnOnEntry: [
      { type: 'BOUNCER', tx: 6, ty: 6, dodge: 'LOW' },
      { type: 'BOUNCER', tx: 33, ty: 6, dodge: 'LOW' },
      { type: 'BOUNCER', tx: 6, ty: 23, dodge: 'LOW' },
      { type: 'BOUNCER', tx: 33, ty: 23, dodge: 'LOW' }
    ],
    spawnOnPickup: [],
    hazards: []
  },

  // THE WARRENS - five fast BOUNCERs in less room. Four dividers cut the
  // chamber into loosely-joined cells with 4-wide gaps; still never below 3
  // where a monster can go. Tallest run 30, widest 34, narrowest in monster
  // space 8.
  //
  // TENSION: the same unpredictability as THE OSSUARY with more bodies and
  // less room to be wrong in. The treasure sits dead centre, so every route in
  // is also the route out, and every second inside raises the odds that one of
  // them crosses it.
  warrens: {
    id: 'warrens',
    shipName: 'THE WARRENS',
    layoutIndex: 0,
    tiles: [
      '####################.###################',
      '####################.###################',
      '####################.###################',
      '####################.###################',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###..................................###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '###..........###........###..........###',
      '####################.###################',
      '####################.###################',
      '####################.###################',
      '####################.###################',
    ],
    doors: [
      { tx: 20, ty: 0, side: 'N' },
      { tx: 20, ty: 29, side: 'S' }
    ],
    treasure: { tx: 20, ty: 14, type: 'chest', safeTile: true },
    // Section 5 specifies 5x BOUNCER (FAST) here, against THE OSSUARY's plain
    // four. speedFrac is the section 7.2 per-spawn override - without it these
    // were byte-identical to THE OSSUARY's and the "fast" qualifier was a lie.
    spawnOnEntry: [
      { type: 'BOUNCER', tx: 6, ty: 6, dodge: 'LOW', speedFrac: 1.10 },
      { type: 'BOUNCER', tx: 33, ty: 6, dodge: 'LOW', speedFrac: 1.10 },
      { type: 'BOUNCER', tx: 6, ty: 23, dodge: 'LOW', speedFrac: 1.10 },
      { type: 'BOUNCER', tx: 33, ty: 23, dodge: 'LOW', speedFrac: 1.10 },
      { type: 'BOUNCER', tx: 20, ty: 20, dodge: 'LOW', speedFrac: 1.10 }
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
