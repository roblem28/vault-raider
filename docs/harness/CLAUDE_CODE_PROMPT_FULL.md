# Claude Code — VAULT RAIDER master orchestration prompt

## Before you paste this

```powershell
cd C:\Projects\vault-raider

# Preflight - all three must be healthy
gh auth status
node --version        # >= 14, needed for the .mjs tests
python --version

# Bootstrap. Creates .claude/agents/ BEFORE Claude Code starts, and copies
# vault-raider-spec-v0.4.md into place as SPEC.md automatically.
powershell -ExecutionPolicy Bypass -File .\vault-raider-bootstrap.ps1

claude
```

Safe to re-run the bootstrap. It only overwrites files it owns (`CLAUDE.md`,
`.claude\*`, `PROVENANCE.md`, `netlify.toml`, `.gitignore`) and never touches
`src\`, `tests\`, `dist\`, or an existing `SPEC.md`.

Inside Claude Code, confirm the harness loaded before doing anything else:

```
/doctor
```

You should see seven project agents: `fidelity-auditor`, `game-feel-critic`,
`softlock-hunter`, `test-engineer`, `a11y-reviewer`, `ip-compliance-reviewer`,
`deploy-agent`. If any are missing, exit and relaunch — the agents directory has
to exist at session start.

Then paste everything below the line.

---

Build VAULT RAIDER, a Venture-style arcade dungeon crawler. `SPEC.md` in this
directory is authoritative; `CLAUDE.md` holds the project rules and the
delegation policy. Read both in full before writing any code. Where this prompt
conflicts with SPEC.md, SPEC.md wins — flag the conflict rather than guessing.

## How we work

- **Implementation stays in this main session.** The milestones share too much
  context to farm out. Subagents are for verification, testing, and deployment.
- **You have seven project subagents.** Use them at the gates defined in
  `CLAUDE.md`. Do not skip a gate because you are confident.
- Subagents start with fresh context and cannot talk to each other. When you
  delegate, put the explicit file paths, the milestone number, and the specific
  question in the prompt. "Review the code" is a wasted invocation.
- Run reviewers in parallel when their findings are independent —
  `fidelity-auditor` and `a11y-reviewer` do not need each other's output.
  Run them sequentially when one depends on the other, e.g. `test-engineer`
  green before `ip-compliance-reviewer` before `deploy-agent`.
- When a reviewer reports a FAIL, fix it and re-run that reviewer. Do not
  proceed to the next milestone with an open FAIL.
- If a reviewer and I disagree, tell me. Do not silently side with either.

## Phase 0 — plan

Write to `docs/PLAN.md`: the module list with each file's exports, the data flow
between them, and which SPEC section each module implements. Then **stop and show
me the plan.** No implementation code until I approve it.

## Phase 1 — M1 through M3 (engine + vertical slice)

Build M1, M2, M3 from SPEC.md §14. Scope for M3 is one room only (`THE COIL`).

**M1 carries a requirement that cannot be retrofitted.** SPEC §17.1: keyboard,
gamepad, and touch must all reduce to one per-tick input struct before any game
code reads them. Build that abstraction now even though touch does not arrive
until M11. Bolting touch on later as a second path breaks replay determinism and
means rewriting the input layer.

Checkpoint and wait for my go after M1 and again after M2.

At the end of M3, before you report done:

1. `test-engineer` — create all four tests and get them green
2. `fidelity-auditor` — audit against SPEC §3
3. `game-feel-critic` — the full input/loop/collision review
4. Fix every FAIL, re-run the reviewer that raised it

Then report and stop. **M3 is the feel gate (SPEC §12.3).** I play it before
any content work starts. Do not begin M4 until I say the gate passed.

## Phase 2 — M4 through M8 (content + systems)

After the feel gate passes, build M4 → M8. Per milestone: implement, run
`test-engineer`, run `fidelity-auditor`, fix, commit via `deploy-agent`.

Additional gates:

- End of M5 (death handling): `softlock-hunter`. This is the milestone where
  softlocks live. Treat a HYPOTHESIS finding as worth investigating, not as a
  pass.
- End of M7 (all 12 rooms): `test-engineer` must show `winnability.mjs` green
  across all twelve, then `fidelity-auditor` again.

## Phase 2b — M11 (touch)

Mobile is in scope, not a stretch goal. Build M11 per SPEC §17 after M8.

- The floating thumbstick, 8-way hysteresis, and tap-to-reface are the three
  things that decide whether it is playable. Read §17.2–§17.4 carefully.
- `test-engineer` adds `tests/input.mjs` per §17.7 — including the assertion
  that a synthetic touch stream hashes identically to the keyboard equivalent.
- `game-feel-critic` and `a11y-reviewer` both have touch sections. Run both.
- **Do not tune game balance for touch** (§17.8). Compensate with input assists
  that apply on every device, so there is only ever one game.
- I test this on a real phone in landscape against the §17.9 checklist. A
  desktop browser's device emulator does not count as a pass.

## Phase 3 — M9, M10, first deploy

1. Build M9 and M10.
2. `a11y-reviewer` — fix every BLOCKER before proceeding. Photosensitivity
   findings are not negotiable, and touch targets below 44x44 CSS px are
   blockers too.
3. `test-engineer` — all five green (including `input.mjs`).
4. `python build.py` — confirm `dist/index.html` is a single file with zero
   external requests.
5. `ip-compliance-reviewer` — must return SAFE TO PUSH.
6. `deploy-agent` — commit, push `main` to `roblem28/vault-raider`, report the
   commit SHA.

**Netlify site creation is mine to do, not yours.** After the push, print exact
instructions for me covering both paths:

- Netlify UI: Add new project → import `roblem28/vault-raider` → publish
  directory `dist` → build command empty → site name `vault-raider`
- CLI equivalent: the `netlify` commands I would run, noting that I authenticate
  myself

Two things to state explicitly in those instructions:

- The site name must be `vault-raider`, because the portfolio proxy rule targets
  `https://vault-raider.netlify.app`. A different name breaks Phase 4.
- The new site must be on the **same Netlify team** as the portfolio site.
  Netlify blocks proxy rewrites between sites on different teams.

Then wait. Once I confirm `https://vault-raider.netlify.app/` is live, continue.

## Phase 4 — boblemieux.ai/games/vault-raider

Only after I confirm `https://vault-raider.netlify.app/` is live.

Target URL: **`https://boblemieux.ai/games/vault-raider`**, served by a Netlify
proxy rewrite. Read SPEC.md §16 in full first — it has the topology, the exact
`netlify.toml` blocks, and the constraints. `deploy-agent` handles all of it and
its own definition carries the step-by-step under "Repo B".

Order of operations:

1. **Proxy rule first, card second.** Get the rewrite working and verify the URL
   serves the game before touching any portfolio UI code. If the proxy is broken,
   a card pointing at it is worse than no card.
2. **Discover the card pattern before writing any of it.** The portfolio already
   has cards for Critter Count, Tiny Traveler, the weather map, the USAspending
   explorer, and the FEC explorer. Grep for those names — whatever file matches
   is the card source. Report the file, the verbatim field names on an existing
   entry, how ordering works, how images are referenced, and whether links are
   `next/link` or plain anchors. Then tell me your intended change and wait.
   Do not invent a new card shape.
3. `npm run build` must pass locally.
4. `ip-compliance-reviewer` against the portfolio diff.
5. Branch → push → PR → report the preview URL at
   `deploy-preview-{PR#}--boblemieuxai.netlify.app` → **stop.** I review
   previews. Do not merge.

Hard constraints:

- **Do not copy the game into the portfolio repo.** Proxy only.
- If `netlify.toml` already exists in the portfolio, APPEND the redirect blocks.
  Do not reformat or reorder anything already there. Redirect precedence is
  order-dependent — if an existing rule could match `/games/*`, report the
  conflict rather than resolving it yourself.
- Card links to `/games/vault-raider`, never to the `netlify.app` URL.
- Never name the original arcade game anywhere in the portfolio.

After I merge, verify: the proxied URL serves the game with the address bar still
showing `boblemieux.ai`. If it flips to `netlify.app`, the rule is redirecting
rather than rewriting — check `status = 200` and `force = true`.

## Standing rules

- Commit per milestone with the milestone number in the message.
- Maintain `docs/NOTES.md`: every assumption, every SPEC ambiguity, every tuning
  value you deviated from and why. Update it as you go, not at the end.
- Never weaken a test to make it pass.
- Never add features, refactors, or polish I did not ask for.
- If SPEC.md is ambiguous, implement your best reading, log it in
  `docs/NOTES.md`, and raise it at the next checkpoint. Do not invent silently.
- If you find yourself about to write `Math.random`, stop — use `src/core/rng.js`.

Begin with Phase 0. Show me the plan.
