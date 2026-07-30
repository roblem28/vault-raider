// VAULT RAIDER - seeded RNG. SPEC v0.6 section 1.
//
// The platform PRNG is BANNED project-wide. tests/determinism.mjs greps src/
// for its name and fails the build on any hit - which is why that name is not
// written out anywhere in this directory, including in comments like this one.
// This file is the only randomness source in the project.
//
// xorshift32: same seed in, same sequence out, on every platform. All ops are
// 32-bit integer ops, so there is no float-rounding divergence to worry about.
//
// No DOM access. Safe to import from tests/.

// xorshift32 has one degenerate state: 0 maps to 0 forever. Any caller passing
// a zero seed gets this instead. Arbitrary non-zero constant.
export const RNG_FALLBACK_SEED = 0x9e3779b9;

const RNG_SHIFT_A = 13;
const RNG_SHIFT_B = 17;
const RNG_SHIFT_C = 5;
const RNG_U32_DIVISOR = 4294967296;   // 2^32, converts u32 to [0, 1)

export const FNV_OFFSET_BASIS = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;

export function createRng(seed) {
  let state = (seed >>> 0) || RNG_FALLBACK_SEED;

  function nextU32() {
    let x = state;
    x ^= (x << RNG_SHIFT_A) >>> 0;
    x ^= x >>> RNG_SHIFT_B;
    x ^= (x << RNG_SHIFT_C) >>> 0;
    state = x >>> 0;
    return state;
  }

  return {
    nextU32,
    // [0, 1)
    nextFloat() { return nextU32() / RNG_U32_DIVISOR; },
    // [0, n)
    nextInt(n) { return (nextU32() % n) >>> 0; },
    getState() { return state; },
    setState(s) { state = (s >>> 0) || RNG_FALLBACK_SEED; },
    clone() { return createRng(state); }
  };
}

// FNV-1a 32-bit over a stream of numbers. Used by hashGameState (SPEC 12.1.1).
// Non-integer values are folded through their raw IEEE-754 bits so that a
// sub-pixel position difference cannot hash equal.
export function hashValues(seed, nums) {
  const scratch = new DataView(new ArrayBuffer(8));
  let h = (seed >>> 0) || FNV_OFFSET_BASIS;
  for (let i = 0; i < nums.length; i++) {
    const v = nums[i];
    if (Number.isInteger(v)) {
      h = hashU32Into(h, v >>> 0);
    } else {
      scratch.setFloat64(0, v);
      h = hashU32Into(h, scratch.getUint32(0));
      h = hashU32Into(h, scratch.getUint32(4));
    }
  }
  return h >>> 0;
}

function hashU32Into(h, u32) {
  let acc = h >>> 0;
  for (let byte = 0; byte < 4; byte++) {
    acc ^= (u32 >>> (byte * 8)) & 0xff;
    acc = Math.imul(acc, FNV_PRIME) >>> 0;
  }
  return acc >>> 0;
}
