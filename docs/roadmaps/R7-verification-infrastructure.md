# R7 — Verification & quality infrastructure

> Mission: the standing verification platform — journeys-as-data, the
> dead-path sweep, verify:cycle and its idea corpus, CI + drift guards, the
> test suite's health, and the promised rebuild of capability benches
> anchored on real cycle artifacts. Scope: `docs/repo-map.md` Scope 1
> (`scripts/`, `.github/`, harness libraries). Feature-coupled harness
> *migrations* stay with their features (e.g. R4-10-F5 owns the verify:cycle
> cutover; R5-06 owns the demo/clip content backlog) — R7 owns the platform
> those migrations run on. Minted 2026-07-17 by the coverage review.

**Status vocabulary:** implemented | in-progress | planned | deferred. All
initiatives in this file are planned/deferred as of 2026-07-17. **Unwaved** —
operator to prioritize against the R1–R5 driving order.

## As-built baseline (implemented)

### R7-B1 Journeys-as-data harness
`scripts/e2e-journey.mjs` over per-journey modules in `scripts/journeys/`
(`defineJourney({id,title,story,beats})`, `scripts/lib/journey-runtime.mjs`);
beats are simultaneously demo scenes and named test cases
(`demos/e2e/results.json`); shared assertion module
(`journey-assertions.mjs`), corpus-grounded fixtures
(`journey-fixtures.mjs` — seeds cite real archived cycle artifacts), daemon
guard (`journey-daemon-guard.mjs`), finalize neutralisation. Gallery + clips
output. The journey count discrepancy (10 vs 11) is R5-07-F3's strike item.

### R7-B2 Dead-path sweep + CI
`scripts/e2e-deadpaths.mjs` (`npm run ui:deadpaths`); GitHub Actions CI with
two proven drift guards (production-repo cleanup campaign, 0.6.0); the full
gate quartet (`npm run build`, `npm test` — 1987 tests, `forge studio lint`,
`forge brain lint`).

### R7-B3 verify:cycle real-capability harness (ADR-022)
`scripts/verify-cycle.mjs` — outcome-only assertions (reached merge,
dev-loop N/N, project quality gate green post-merge, cost ceiling), tiered
frozen-SHA routine / greenfield release, manual gate never CI. Grounds:
mdtoc (creds-free), gitpulse (independent ground + idea corpus in
`docs/verify-cycle-ideas/`), betterado (live-ADO tier + live-REST demo
gate). Ground-identity statement is inconsistent across docs — R5-07-F4's
strike item. Deliberate non-goal recorded: the routine tier does not reset
the remote, so it proves up-to-merge only (brain theme
`2026-07-11-verify-harness-repo-state-traps`).

### R7-B4 The bench vacuum (deliberate, with a promised refill)
Per-phase + e2e benches were **removed 2026-05-25** — they had grown
synthetic rubrics that taught phases toward the bench shape.
`CLAUDE.md`'s standing note: *"Benches will be rebuilt later, anchored on
actual past successful cycle artifacts rather than hand-curated fixtures."*
That promise had no roadmap home until R7-01.

## Planned initiatives

### R7-01 Bench rebuild, corpus-anchored
- **Status:** planned  ·  **Wave:** unsequenced (natural slot: after the R4
  suite stabilizes — the successor pipeline is the thing worth benching)
- **Depends on:** — (soft: R4-10 — bench the successor flow, not the retiring one)
- **Context:** The R7-B4 promise. Anti-goal recorded as a hard constraint:
  **no synthetic rubrics, no hand-curated fixtures, no thresholds that teach
  the phases toward the bench** — the 2026-05-25 removal rationale is the
  design boundary. The corpus exists: `_queue/done/` manifests,
  `brain/_raw/cycles/` archives, real merged-PR cycle logs.
- **Features:**
  - **R7-01-F1 Corpus extraction.** A repeatable extractor turning archived
    successful cycles into bench cases (inputs: real initiative manifest +
    repo SHA; expected: outcome-shaped assertions mirroring verify:cycle's
    style, per phase). ACs: ≥3 bench cases generated from distinct real
    cycles, zero hand-authored fixture content.
  - **R7-01-F2 Phase-level replay bench.** Run a single phase (plan agent /
    develop / demo / review) against a corpus case; score outcomes only.
    ACs: bench runnable per phase; results comparative (vs the archived
    real outcome), never absolute-threshold gates in CI.
  - **R7-01-F3 Regression cadence.** Where the bench lives operationally:
    manual gate beside verify:cycle (not CI), run before pointing a changed
    phase at a real project. ACs: cadence documented; one full run recorded.
- **Session sizing:** ~3 sessions (extractor; replay; cadence + first run).
- **Out of scope:** verify:cycle itself (R7-B3 baseline + R4-10-F5
  migration); synthetic per-phase rubrics (banned).

### R7-02 Journey platform evolution
- **Status:** planned  ·  **Wave:** unsequenced
- **Depends on:** —
- **Context:** The DOM-as-metrics convention was built so "any automation
  (playwright today, LLM-driven UI tests tomorrow) can drive the page"
  (CLAUDE.md) — the *tomorrow* half has no owner. Separately the runner has
  accumulated platform needs distinct from clip content (R5-06): beat-level
  retries, capture-time fixes (§4b.10 sticky-header is content-adjacent but
  the fix is runner machinery), and the port-binding/serialization constraint
  (memory: ui:journey binds global 4123/4124, can reset the tree — commit
  first).
- **Features:**
  - **R7-02-F1 LLM-driven UI test tier.** An agent-driven journey mode: an
    LLM session drives a story through the DOM contract and judges outcomes
    — the convention's stated end state. Research-first (existing agentic
    browser-test harnesses before hand-rolling). ACs: one journey executed
    agent-driven end-to-end; verdict artifact comparable to a scripted run.
  - **R7-02-F2 Runner hardening.** Capture-time machinery fixes (sticky
    header unstick — the mechanism half of §4b.10), beat retry semantics,
    safer worktree/port behaviour (fail loudly when 4123/4124 busy or tree
    dirty rather than resetting). ACs: §4b.10's artifact class gone from
    fresh captures; dirty-tree run refuses instead of resetting.
- **Session sizing:** ~2 sessions.
- **Out of scope:** clip/gallery content (R5-06); journey *authoring* for
  feature work (journey-sync contract, owned by each feature PR).

### R7-03 verify:cycle ground & corpus stewardship
- **Status:** planned  ·  **Wave:** unsequenced (F1 rides R5-07-F4)
- **Depends on:** — (R5-07-F4 supplies the canonical ground statement)
- **Context:** Three grounds with drifting identity docs (R5-07-F4 strikes
  the inconsistency; this initiative keeps it struck), an idea corpus with a
  recorded trap (feature burn: gitpulse gained `--exclude`/`--csv`/tags/
  `--sort` from verify runs — "verify feature absence with grep before
  writing idea files", memory), and deliberate non-goals worth pinning
  (remote-reset rejected; frozen-SHA corpus artifacts ≠ regressions, brain
  theme `forge-studio-build-arc`).
- **Features:**
  - **R7-03-F1 Ground registry.** One documented registry of verify grounds
    (project, tier, creds posture, idea-corpus location, freshness) in
    `docs/verify-cycle-ideas/README.md`, consistent with the R5-07-F4
    canonical statement. ACs: registry exists; CLAUDE.md + ideas README
    agree.
  - **R7-03-F2 Idea-file lifecycle.** Pre-flight grep (feature absence)
    codified into the idea-file authoring recipe; consumed/burned idea files
    marked. ACs: recipe in the README; corpus swept once.
- **Session sizing:** ≤1 session.
- **Out of scope:** the harness engine (R7-B3); gitpulse's own product
  direction (Scope 3, index §7).

### R7-04 CI & drift-guard growth
- **Status:** planned  ·  **Wave:** unsequenced (opportunistic)
- **Depends on:** —
- **Context:** Two drift guards proved the pattern (R7-B2); the amendment
  pass mints more of the class (R5-01-F2 route-coverage guard, R2-02-F2
  composition-derivation conformance, M0-style no-drift locks). The pattern
  — "a test that enumerates a surface against a declared table so additions
  can't ship unregistered" — deserves a named home so each new guard follows
  it rather than reinventing.
- **Features:**
  - **R7-04-F1 Drift-guard pattern doc + inventory.** Name the pattern, list
    the live guards, state when a change must add one. ACs: inventory in
    this file or `docs/reference/`; cited by R5-01-F2's implementation.
  - **R7-04-F2 Gate-time budget.** Keep the full local gate under a stated
    wall-clock budget as the suite grows (1987 tests today); CI sharding
    decision when breached. ACs: budget stated; measured once per campaign.
- **Session sizing:** ≤1 session + ongoing.
- **Out of scope:** individual guards (owned by their initiatives).

## Deferred

*None yet* — new verification-platform findings append here per the index §5
maintenance contract.

## Change log

- 2026-07-17 — Roadmap minted by the coverage review (verification platform
  had fragments in R5-06/R4-10-F5 but no owner; the CLAUDE.md bench-rebuild
  promise was homeless). Seeded from recorded material only: the 2026-05-25
  bench-removal note + rebuild promise, the CLAUDE.md LLM-driven-UI-tests
  intent, ui:journey port/reset constraints, the idea-corpus feature-burn
  trap, ADR-022's tier design. Unwaved pending operator prioritization.
