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
node tests\winnability.mjs     # M3
node tests\determinism.mjs     # M2 - also greps src/ for the banned PRNG
node tests\timer.mjs           # M2
node tests\floors.mjs          # M2
node tests\loop.mjs            # M1
node tests\input.mjs           # M1, touch assertions added at M11
```

**All SIX tests must pass** before any commit that touches `src/`. The comment
against each is the milestone it landed at; `winnability.mjs` is the only one
not yet written.

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

### Commit when the CODE is green, BEFORE the heavy review gates

Order is: implement → tests green → `build.py` clean → `ip-compliance-reviewer`
→ **commit and push** → then `fidelity-auditor`, `game-feel-critic`, and the
rest. Fixes from the gates are a follow-up commit.

Gates are re-runnable; an hour of uncommitted work on one machine is not. Three
connections dropped during this project, one of them killing two review agents
mid-run simultaneously. **A dropped connection must cost a re-run, never a
rebuild.**

The commit message must say which gates had NOT yet run at that SHA, so the
history stays honest about what was actually verified.

### Run review gates SEQUENTIALLY, not in parallel

Parallel gates double the blast radius of one dropped connection. At M3
`fidelity-auditor` and `game-feel-critic` were launched together and both died
on the same disconnect, losing both sets of findings. Sequential costs
wall-clock time and saves a full re-run.

### Containment check — after EVERY subagent invocation

```powershell
git status --porcelain
```

Anything modified outside `.claude/agent-memory/` that the subagent was not
explicitly asked to change is a **containment breach**. Report it, revert it,
and log it in `docs/NOTES.md`. Do not silently absorb it into your next commit.

Why this exists rather than a prompt constraint: `memory: project` grants an
agent `Write` and `Edit` so it can write its memory files, and that grant is not
scoped to the memory directory. A "read-only" line in an agent's prompt is
therefore decorative — the tool list wins. This check is verifiable and catches
the next stray write from any agent, without depending on anyone noticing.

`softlock-hunter` is already contained by `isolation: worktree` and legitimately
needs `Write`. Leave it alone.

## Standing rules

### A regression test is not done when it passes

It is done when it has been **shown to FAIL against the defect it guards**.
Revert the fix, watch the test fail, restore the fix, watch it pass.

This is not ceremony. The M1 input-arbitration test passed against the reverted
fix — registration order was deciding the assertion, not recency — and would
have been a false negative trusted for eleven more milestones. A test that
cannot fail is a comment with a runtime cost.

### Instrument before hypothesising

When behaviour is wrong and the cause is not obvious, **write the probe that
shows what is actually happening before proposing a fix.**

At M2 a stationary PIP was unkillable. I proposed two plausible causes and
implemented both; neither helped, and the second made it worse. A tick-by-tick
probe printing position, stall counters and slide state found the real cause on
the first run — the greedy chaser's *small* off-axis pull was consuming each
tick before the *large* escape axis was ever tried.

Two failed hypotheses cost more than the probe would have. This pairs with the
mutation-testing rule above: both are about refusing to trust a plausible story
over evidence.

### Do not assert completeness — state a checkable invariant

SPEC §6 claimed to be "complete" and was wrong twice. Replaced with: *any value
a logic file needs must exist in §6 before that file is written.* That is
checkable at the moment it matters; "complete" is only checkable by omniscience.

Applies to any claim of the form "all X are Y".

### Challenge findings that contradict their own evidence

Two `fidelity-auditor` findings were withdrawn under challenge in M1 alone — one
grepped, got the hit, then wrote a conclusion contradicting its own grep output.
Reviewers are not oracles. Verify a finding before acting on it, and push back
when the evidence does not support it.

Log every withdrawn finding in `docs/NOTES.md`. If the withdrawal rate stays
high, the agent file needs rewriting, and that decision needs the data.

## Milestones

See SPEC.md Â§14. Do not build ahead of the current milestone. Stop at the
checkpoint after M1, M2, and M3 and wait for my go.