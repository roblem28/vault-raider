# VAULT RAIDER â€” project rules

Venture-style arcade dungeon crawler. `SPEC.md` in the repo root is authoritative
for all mechanics, tuning, and acceptance criteria. Read it before any task.
When this file and SPEC.md conflict, SPEC.md wins â€” report the conflict.

## Hard rules

- No npm, no package.json, no dependencies, no bundler, no framework.
- `Math.random` is BANNED. Seeded xorshift32 in `src/core/rng.js` only.
  `tests/determinism.mjs` greps for it and fails the build.
- ES modules, NAMED EXPORTS ONLY, no default exports, unique top-level
  identifiers across every file in `src/`.
- Modules imported by `tests/` must not touch `window`, `document`, or
  `AudioContext` at import time. DOM access lives behind an explicit `init()`.
- All constants live in `src/data/tuning.js`. No magic numbers in logic files.
- Tile size is 8px. Every map is 40x30 tiles = 320x240px. No other grid exists.
- Never ship the strings `Venture`, `Winky`, or `Hallmonster`. Ship names are
  VAULT RAIDER / PIP / WARDEN. Never copy assets or data from any ROM or emulator set.

## The four mechanics that are always getting broken

1. The intrusion clock is per-FLOOR. It does not reset on room exit, on death,
   or during zoom transitions.
2. Corpses are lethal to PIP, block PIP only, and can seal a doorway.
3. On death: clear all corpses, reset unlooted rooms, keep looted status, and
   DO NOT touch the floor timer. Skipping the corpse clear softlocks the run.
   Resetting the timer creates a suicide-farm exploit.
4. Facing latches on directional input in the same frame, independent of whether
   movement actually happened. Never derive facing from realized displacement.
5. Keyboard, gamepad, and touch all reduce to ONE per-tick input struct before
   any game code sees them (SPEC Â§17.1). This abstraction exists from M1. Touch
   is a third source, never a second code path â€” a second path breaks replay
   determinism.
6. PIP's room hitbox is 6x6, not 8x8. Tiles are 8px, so 8x8 leaves zero
   tolerance in a 1-tile doorway. Never raise it without re-checking every
   1-tile gap. Never scale the collision hitbox for touch.

## Build and test

```powershell
python -m http.server 8000     # dev server, run from src\
python build.py                # emit dist\index.html
node tests\winnability.mjs
node tests\determinism.mjs
node tests\timer.mjs
node tests\floors.mjs
node tests\input.mjs
```

All four tests must pass before any commit that touches `src/`.

## Delegation policy

Implementation happens in the main session â€” it needs continuous context.
Subagents are for verification and self-contained work. Subagents cannot talk
to each other; everything they need must be in this file or in the prompt they
are given, including explicit file paths.

Required delegation gates:

- After each milestone: `fidelity-auditor`, then `game-feel-critic` (M3+).
- Before any commit touching `src/`: `test-engineer` to confirm tests green.
- Before M5 sign-off: `softlock-hunter`.
- Before M9 sign-off: `a11y-reviewer`.
- Before every push and before the portfolio PR: `ip-compliance-reviewer`.

### When `deploy-agent` is required

REQUIRED for:

- Anything that changes remote state: push, PR, merge, Netlify.
- Any commit touching `src/` or `dist/`.

NOT required for local-only git on `docs/`, `SPEC.md`, `CLAUDE.md`, or
`.claude/` when I hand you the exact command.

The gate exists so tests and IP review run before code ships. A docs commit has
nothing to gate.

## Milestones

See SPEC.md Â§14. Do not build ahead of the current milestone. Stop at the
checkpoint after M1, M2, and M3 and wait for my go.