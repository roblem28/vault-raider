# Claude Code prompt — VAULT RAIDER M1–M3 (vertical slice)

## Setup first (PowerShell, run before pasting)

```powershell
mkdir C:\Projects\vault-raider
cd C:\Projects\vault-raider
git init
# copy the spec in as SPEC.md, then:
claude
```

Then paste everything below the line into Claude Code.

---

You are building the M1–M3 vertical slice of VAULT RAIDER, a Venture-style arcade dungeon crawler. `SPEC.md` in this directory is authoritative. Read it fully before writing any code. Where this prompt and SPEC.md conflict, SPEC.md wins — flag the conflict instead of guessing.

## Scope — build exactly this, nothing more

M1, M2, and M3 from SPEC.md §14. Concretely:

- Fixed 60 Hz loop with clamped accumulator (`maxFrameSec 0.25`, `maxSubsteps 5`), interpolated render, 320×240 logical canvas integer-scaled and letterboxed.
- Seeded xorshift32 RNG. `Math.random` must not appear anywhere in `src/`.
- Input layer: keyboard (arrows/WASD/Space/P/Esc/M) + Gamepad polled inside the update step. **Facing latches on directional input in the same frame, independent of realized movement** (SPEC §3.9) — this is the single most important input requirement.
- Floor view: one floor (`floor1`), 40×30 tile mask at 8 px, axis-separated collision, 2 WARDENs on waypoint routes with growing pursuit bias, death on contact, **hall firing enabled and useless** (arrows pass through WARDENs).
- One room only: `THE COIL` — 4× `CRAWLER`, Goblet treasure, no pickup trap.
- Zoom in/out transitions, 24 ticks, non-interactive, **floor timer keeps running through them**.
- Arrow: one alive at a time, 4-tick windup, 8-dir, diagonal shots halve dodge odds.
- `CRAWLER` with `LOW` dodge tier.
- Corpses: 4 decay phases × 2.5 s, lethal to PIP, block PIP only, `CORPSE_SHOT_MODE` flag honored.
- Treasure pickup + safe-tile invulnerability.
- Per-floor intrusion timer, 4 s warning siren (visual + audio placeholder), WARDEN room entry.
- Minimal HUD: lives, score stub, intrusion countdown pips.

## Explicitly out of scope for this pass

Rooms 2–12, floors 2–9, other archetypes, hazards, scoring bonuses, extra lives, attract mode, intro walk, high scores, full audio suite, accessibility options. Do not build ahead.

## Architecture — non-negotiable

Follow SPEC.md §13 exactly.

- ES modules under `src/`, **named exports only**, no default exports, unique top-level identifiers across all files.
- No npm, no package.json, no dependencies, no bundler. `build.py` (stdlib only) inlines `src/` into `dist/vault-raider.html` as one `<script type="module">` plus inlined CSS, driven by an explicit ordered `MANIFEST` list.
- Any module imported by `tests/` must not touch `window`, `document`, or `AudioContext` at import time. Keep all DOM access behind an explicit `init()` call. Game logic must be testable headless in Node.
- Constants live only in `src/data/tuning.js`. No magic numbers in logic files.
- Every module gets a 3-line header comment: purpose, exports, SPEC section reference.

## Deliverables

1. `src/` tree per SPEC §13 with M1–M3 scope implemented.
2. `build.py` producing a working `dist/vault-raider.html` with zero external network requests.
3. `tests/winnability.mjs` — BFS door → treasure → door on `THE COIL`. Structure it to iterate all 12 rooms later.
4. `tests/timer.mjs` — floor timer monotonic across room enter/exit/enter, unchanged by simulated death, unchanged by zoom.
5. `tests/determinism.mjs` — same seed + recorded input stream → identical state hash twice; plus a `Math.random` grep over `src/` that fails on any hit.
6. `PROVENANCE.md` per SPEC §0.
7. `NOTES.md` — every assumption you made, every SPEC ambiguity you hit, and every tuning value you deviated from.

## Acceptance criteria — verify each yourself before reporting done

Run and report actual output for:

```powershell
python build.py
node tests\winnability.mjs
node tests\timer.mjs
node tests\determinism.mjs
```

All four must pass. Then confirm by inspection:

- [ ] `dist\vault-raider.html` is a single file, no external requests, opens from `file://` without console errors
- [ ] Loop runs 60 update ticks/sec regardless of display refresh; a simulated 30 s frame gap produces no burst of catch-up steps
- [ ] A 1-frame directional tap against a wall changes PIP's facing with no displacement
- [ ] Exactly one arrow can exist at any time
- [ ] Firing in the hall spawns a real arrow that passes through a WARDEN without effect
- [ ] Floor timer does not reset when leaving and re-entering `THE COIL`
- [ ] Standing on the treasure tile makes PIP unkillable
- [ ] A corpse in the room's only doorway blocks PIP and can kill him
- [ ] Shooting a corpse resets its decay phase per the flag
- [ ] `grep -r "Math.random" src/` returns nothing

## Working method

- Plan first. Write the module list, exports, and data flow to `NOTES.md`. **Stop and show me the plan before writing implementation code.**
- Then build in this order: M1 loop/RNG/input → M1 render/scale → M2 floor collision → M2 WARDEN → M2 hall fire → M3 zoom → M3 arrow/CRAWLER/dodge → M3 corpses → M3 treasure → M3 intrusion timer → tests → build.py.
- Checkpoint after M1 and again after M2: run what exists, tell me what is verifiable, and wait for my go before continuing.
- If a mechanic in SPEC.md is ambiguous, do not invent behavior silently — implement the reading you think is right, log it in `NOTES.md`, and call it out in your checkpoint message.
- Commit at each milestone: `git commit -m "M1: loop, rng, input"` etc.
- Do not add features, polish, or refactors I did not ask for.

Begin with the plan.
