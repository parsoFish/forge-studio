# R5 — Hardening & operability

> Mission: safety, integrity and hygiene for the platform and its harnesses —
> the dry-bridge seam, the env-pin at the spawn seam, cost integrity, the
> edit-lock fix, the known-gaps residue, the demo/harness backlog, and SSOT
> reconciliation. Scope boundary: pure Scope-1 work
> ([docs/repo-map.md](../repo-map.md)) plus doc hygiene; no new product
> capability lives here — items that grew into capabilities are owned by
> R1–R4 and only *cross-referenced* from R5-05.

**Status vocabulary:** implemented | in-progress | planned | deferred. All
initiatives in this file are planned as of 2026-07-17.

**Why R5 leads the driving order (Q6-A):** the 2026-07-16 incident — the
bridge ran a real $0.58 finalize turn and self-merged forge PR #23 with the
operator's gh token during a ui:journey run — proved the harness/real boundary
is enforced only at `spawn()` sites. Every roadmap session after this one runs
through that same bridge; R5-01/R5-02 close the class before new agent
surfaces (R2/R4) multiply it.

## As-built baseline (implemented)

### R5-B1 Harness-side incident mitigations (2026-07-16)

`scripts/lib/journey-daemon-guard.mjs` (`assertNoLiveDaemon`, escape hatch
`FORGE_E2E_AUTOKILL_DAEMON=1`); `scripts/e2e-journey.mjs` finalize
neutralisation (strips `releaseProcess` from the grounding project for the
run), seeded review worktree git-init'd as a no-remote sandbox, `git restore`
of the `projects/<name>` subtree in cleanup. Harness side of known-gaps §4.10
is closed; the **platform** side is R5-01.

### R5-B2 Spawn-site guard

`FORGE_ARCHITECT_NO_SPAWN` covers `spawn()` sites only — not in-process
real-agent/real-git bridge paths (the R5-01 gap).

### R5-B3 Standing harnesses

`scripts/verify-cycle.mjs` (ADR-022: outcome-only real-cycle gate, tiered
frozen-SHA routine / greenfield release; betterado live tier + live-REST demo
gate); journeys-as-data (`scripts/e2e-journey.mjs` + `scripts/journeys/`,
journey-sync skill keeps UI changes and journeys in one PR); dead-path sweep
(`scripts/e2e-deadpaths.mjs`).

### R5-B4 Crash classification + self-heal

`classifyCycleFailure` environment-failure detection + `inferRequeueResume`
at the requeue boundary (ADR-019 amendment 2026-07-11,
`orchestrator/requeue-resume.ts`); `ensureWatch` self-heal absorbs the
un-root-caused watch SIGKILLs (known-gaps §4.5).

### R5-B5 Cost pipeline

Shared aggregation in `orchestrator/event-cost.ts` (the double-count defect
was fixed twice — 2026-06-08 in `cli/metrics.ts`, re-found 2026-07-10 in
`per_skill` + `run-model-derive.ts` — hence R5-03's regression-guard posture);
phase-aware aggregation is a named invariant
(`brain/forge-dev/themes/cost-event-phase-aware-aggregation-rule.md`).

### R5-B6 Brain/doc lint

`forge brain lint` (9 checks incl. `checkProjectBrainIndexes`), brain-path
SSOT `orchestrator/brain-paths.ts`; brain-index walks the ADR-035 central
layout as of PR #26 (`464eabd`, 2026-07-17) — which is why known-gaps §4.3(c)
is stale (R5-07 strikes it).

### R5-B7 SSOT reconciliation shipped (R5-07, 2026-07-17)

ADR 038 (`docs/decisions/038-north-star-platform-and-ootb.md`) records the
two-level north star; strike-list amendments landed in CLAUDE.md, README.md,
ARCHITECTURE.md, MVUS (`docs/product/minimum-viable-user-story.md`),
`docs/forge-studio-market-and-differentiation.md`, `docs/repo-map.md`, and
the roadmap index. F1–F7 reconciliation: known-gaps §1/§4.3(c) struck with
provenance, ADR-024 completion statement single-sourced, journey count
canonicalized to 10 (swap-runtime folded into `agents`), verify-cycle ground
single-sourced to gitpulse (ADR 022 ground-swap amendment), CLAUDE.md
`brain/forge-dev/log.md` + `studio/README.md` paths fixed, C7 collision +
theme staleness noted (brain lint 0/0), MVUS cites R4-11-F4.

### R5-B8 Dry-bridge seam shipped (R5-01, 2026-07-17)

`FORGE_DRY_BRIDGE=1` harness-mode seam (`cli/dry-bridge.ts`): a typed
`BRIDGE_ROUTE_CLASSIFICATION` table (`refuse | stub-actions | exempt-local |
read-only`) covering every bridge route, consulted by every real-acting path
in `cli/ui-bridge.ts` + `cli/bridge-studio-*.ts` + `cli/bridge-recovery.ts`.
Refusals are HTTP 409 + JSONL event; verdict-approve and the spawn/reflect
routes are `stub-actions` (state bookkeeping proceeds, the agent turn / merge /
finalize skipped with a `dryBridge:{skipped:[…]}` marker + event), preserving
the ui:journey emulation contract. F2 drift guard
(`cli/dry-bridge-coverage.test.ts`) statically derives the route set from the
dispatch sources (auto-discovered from `cli/`) and reds on both an unclassified
real route and a classified-but-unguarded `refuse` row. F3 post-run boundary
(`scripts/lib/post-run-boundary.mjs`, via the guaranteed-to-run
`runBoundaryCheck` helper) captures git HEAD/tree + open-PR state before/after
`ui:journey` and `verify:cycle` (forge repo only), always prints a boundary
report, and fails the run on any un-exempted mutation; gh degrade is a surfaced
skip, never a silent pass. Journeys synced (`flows-run` reflect beat).
Spawn-suppression is red-on-regression (per-family no-log-dir assertions). A
companion fix (`orchestrator/project-repo-tx.ts` `isGitRepo` guard) stops the
studio-write path checking out a branch in a managed project nested inside the
forge repo without its own `.git` — which had been moving the forge HEAD during
harness runs, the exact class F3 now catches.

### R5-B9 G8 env-pin shipped (R5-02, 2026-07-18)

The recurring headroom/`ANTHROPIC_BASE_URL` leak (theme
`env-leak-must-be-fixed-at-spawn-seam-not-launcher.md`, 3× recurrence) is closed
at the seam. `orchestrator/spawn-env.ts` — `AGENT_ENV_ALLOWLIST` (14 explicit
names; proxy/headroom/`ANTHROPIC_BASE_URL` excluded, `ANTHROPIC_API_KEY`
retained) + `buildChildEnv` with a `MAX_ENV_OVERRIDE_KEYS` cap — is applied at
`orchestrator/pinned-sdk-query.ts`, the single SDK-query boundary every agent
spawn passes (F1). A **default-deny** structural lock
(`orchestrator/pinned-sdk-query.enforce.test.ts`) flags any import of a
child-spawning SDK export (`query`, `unstable_v2_*`) outside the wrapper across
`orchestrator/` + `loops/` + `cli/` + `scripts/*.mjs`, covering all five launch
paths so a new bypassing path can't ship silently. Gate children strip each
project's declared `ci_gate_unset_env` in `runGateCapturing` + `runShellGate`
(F2), with a PATH/HOME/SHELL blocklist at the `project-config` boundary.

### R5-B10 Flow edit-lock verified (R5-04, 2026-07-18)

The flow edit-lock proof artifact exists and is green:
`cli/bridge-studio-flows.test.ts` ("PUT /api/studio/flows/locked-flow → 423 when
a run with that flowId is active") proves an operator-authored **non-seed** flow
(`locked-flow`, `origin: studio`) whose in-flight manifest carries a real
`flow_id` is locked against edits — the write returns `423 Locked` and
`flow.yaml` is byte-unchanged. The lock predicate is
`cli/bridge-studio-writes.ts:774-786` (`r.flowId === id && r.status === 'active'`);
the run's `flowId` is manifest-derived since S8/DEC-3 (`orchestrator/run-model.ts`,
`FALLBACK_FLOW_ID='unknown'` applies to pre-S8 manifests only). The test was
authored with the S8/DEC-3 fix (commit `d0a186f`, 2026-06-21) — it pre-dates this
roadmap, so R5-04's "proof artifact missing" note was an oversight; no new test
was needed.

## Planned initiatives

### R5-01 Dry-bridge seam

- **Status:** implemented (2026-07-17 — as-built facts in R5-B8)  ·  **Wave:** 0 — **the first implementation session of the set**
- **Depends on:** —
- **Depended on by:** R2-01 (new spawn surfaces born inside the seam),
  R2-04-F3 (trigger paths guard-covered), R3-03 *(soft — hook execution leans
  on the same rails)*, R1-04-F2 (anything added to the finalize path sits
  behind this guard), R4-05-F4 (standalone-planner dispatch), R4-11-F5 (rerun
  spawn path)
- **Context:** known-gaps §4.10 open platform tail + memory
  `feedback_bridge_real_agent_surfaces`: three bridge surfaces trigger real
  agents/real git with **no env guard** — (1) in-process `runReleaseFinalize`
  + the real `gh pr merge` beside it in the verdict-approve branch
  (`cli/bridge-studio-runs.ts`; wiring `cli/ui-bridge.ts`), (2)
  `spawnBrainFix` (`cli/bridge-studio-kbs.ts`, KB lint-resolution route), (3)
  `POST /api/scheduler/start` (boots the real daemon). Incident 2026-07-16
  (see header). Fix direction per known-gaps: extend the guard contract to
  ALL real-agent/real-git paths, or a first-class `FORGE_DRY_BRIDGE=1`.
- **Features:**
  - **R5-01-F1 First-class harness-mode contract.** One seam
    (`FORGE_DRY_BRIDGE=1` or the extended `FORGE_ARCHITECT_NO_SPAWN`
    contract) consulted by **every** bridge path that can spawn an agent, run
    real git/gh, or boot the daemon — the three known surfaces plus an
    audited enumeration of the rest. Dry mode returns typed stub results
    (never silent success). ACs: with the seam set, verdict-approve performs
    no finalize/merge, brain-fix does not spawn, scheduler/start refuses; each
    refusal is an explicit typed response + event.
  - **R5-01-F2 Route-coverage drift guard.** A test enumerating bridge routes
    against the guard's coverage table so a new real-acting route cannot ship
    unguarded (same pattern as the M0 derive no-drift lock). ACs: adding an
    unguarded real-acting route turns the suite red.
  - **R5-01-F3 Post-run state checks in harnesses.** After any harness run:
    assert `git log -1`/`git status` clean AND PR state unchanged (the
    incident's self-merge was only caught by inspection — memory: "post-run
    checks must include PR state"). ACs: ui:journey + verify:cycle emit a
    post-run boundary report; a seeded stray commit/PR mutation fails the run.
- **Session sizing:** 1 session (the seam + guard test), +1 if the route audit
  surfaces more paths.
- **Out of scope:** harness-side mitigations (R5-B1, shipped); merge-authority
  policy itself (unchanged — ADR-021 approve-IS-merge; the seam guards
  *harness* contexts, not the operator's real approve).

### R5-02 G8 env-pin at the spawn seam

- **Status:** implemented (2026-07-18 — as-built facts in R5-B9)  ·  **Wave:** 0 (second session, or rides with R5-01)
- **Depends on:** —
- **Depended on by:** R2-01 (the runnable primitive inherits the pinned
  seam), R3-03 *(soft)*
- **Context:** `brain/forge-dev/themes/env-leak-must-be-fixed-at-spawn-seam-not-launcher.md`:
  the headroom-proxy `ANTHROPIC_BASE_URL` leak recurred **three times**
  (2026-06-16 scoped fix in verify-cycle; 2026-07-02 ~50% decompose max-turns
  failures misattributed to brain-chasing; 2026-07-11 via an unscrubbed-shell
  bridge) because each fix landed at a launcher, not the seam. Forge spawns
  from the daemon, the bridge, verify-cycle, e2e-journey, and direct CLI —
  the pin must live where all five inherit it. Related trap: per-WI gates
  inherit `process.env` (TF_ACC=1 ran live acc on a docs cycle —
  `framework-migration-capstone-arc` theme).
- **Features:**
  - **R5-02-F1 Allowlist/scrub at the shared SDK spawn boundary.** One
    allowlist applied where every agent spawn passes (the PhaseAgentSpec /
    SDK invocation seam); proxy/env pollution (ANTHROPIC_BASE_URL etc.)
    cannot reach children from any launcher. ACs: a deliberately polluted
    parent env spawns a clean child in a regression test covering all five
    launch paths.
  - **R5-02-F2 Gate env hygiene.** `runGateCapturing` (and per-WI gate
    spawns) strip each project's declared `ci_gate_unset_env` vars — closes
    the TF_ACC inheritance workaround. ACs: a gate run with TF_ACC=1 in the
    parent and TF_ACC in `ci_gate_unset_env` executes with it unset.
- **Session sizing:** 1 session.
- **Out of scope:** headroom tooling itself (user-global, not forge);
  dry-bridge semantics (R5-01 — different seam, same safety wave). Also
  deliberately not covered (surfaced by the 2026-07-18 review, deferred as a
  G8-scope-widening follow-up): `orchestrator/phases/orchestrated-capture.ts`
  `runOrchestratorCommand` (demo-capture) defaults to unscrubbed `process.env`
  — it is neither an SDK-agent spawn nor a gate, so it sits outside G8's
  allowlist/gate-strip contract; revisit if a leak ever surfaces through it.

### R5-03 Cost integrity

- **Status:** planned  ·  **Wave:** opportunistic (first session that touches metrics)
- **Depends on:** —
- **Context:** Two structural defects: (a) the architect logs `cost_usd: 0` on
  every completion event — real spend is invisible by construction, so any
  cost-based decision undercounts the architect
  (`cost-event-phase-aware-aggregation-rule` theme; corpus
  `_queue/done/INIT-2026-07-11-cli-sort-flag.md` shows `architect_cost_usd: 0`
  as *correct out-of-cycle accounting* — the fix must record architect spend
  without polluting cycle ceilings, per known-gaps §2's clarification); (b)
  cost double-counting recurred after being fixed (R5-B5) — attribution needs
  a single-source guard, not a third fix.
- **Features:**
  - **R5-03-F1 Architect cost visibility.** Architect turns emit real cost
    events into an out-of-cycle bucket surfaced in Studio (session cost on the
    interview screen; excluded from cycle ceilings, included in totals). ACs:
    a real architect session shows non-zero recorded spend; cycle-ceiling
    behaviour unchanged.
  - **R5-03-F2 Single-source attribution guard.** All cost consumers
    provably route through `orchestrator/event-cost.ts`; a regression test
    forbids per-consumer re-aggregation (the class of both prior defects);
    the phase-aware rule is asserted as a named invariant test. ACs: a
    synthetic event stream totals identically through every consumer
    (metrics CLI, run-model, UI meta).
- **Session sizing:** 1 session.
- **Out of scope:** pricing/model catalog upkeep (`studio/catalog.yaml`
  models); budget policy changes (ADR-009: new knobs need ADRs).

### R5-04 Flow edit-lock verification (re-scoped 2026-07-17)

- **Status:** implemented (2026-07-18 — proof pre-exists; as-built in R5-B10)  ·  **Wave:** 1 (small; must precede the first second
  live flow — R3-02's generator flow, R2-03-F4's test flow, and R4-10 all
  guarantee that condition)
- **Depends on:** — · **Depended on by:** R3-02 *(soft)*, R4-10 *(soft)* —
  both ship second live flows (adversarial review E7)
- **Context:** **The originally-planned fix is already shipped** (adversarial
  review A3): run-model has derived `flowId` from `manifest.flow_id` since
  S8/DEC-3 (`orchestrator/run-model.ts` — `FALLBACK_FLOW_ID='unknown'` is a
  pre-S8 fallback only) and the edit-lock predicate documents it
  (`cli/bridge-studio-writes.ts:760-765`). known-gaps §1 is stale — struck via
  R5-07-F1. What's genuinely missing is the proof artifact, and the real
  residual gap in this area (operator-authored flows have no enqueue path at
  all) is owned by **R2-04-F1**, cross-referenced there.
- **Features:**
  - **R5-04-F1 Verification test.** Unit test proving a run of an
    operator-authored (non-seed) flow id locks its definition against edits.
    ACs: test exists and is green; known-gaps §1 struck with the S8/DEC-3
    citation (rides R5-07-F1).
    - **Done 2026-07-18:** the proof already existed and is green —
      `cli/bridge-studio-flows.test.ts` (commit `d0a186f`, authored with the
      S8/DEC-3 fix), which pre-dates this roadmap. No new test authored (a
      duplicate would be a review defect); as-built in R5-B10, known-gaps §1
      already struck.
- **Session sizing:** trivial — fold into any adjacent session before wave 3.
- **Out of scope:** operator-authored flow *enqueue* (R2-04-F1); builder UX
  around locked flows (existing surface).

### R5-05 Known-gaps residue

- **Status:** planned  ·  **Wave:** opportunistic
- **Depends on:** — (individual items below carry their own conditions)
- **Context:** The remaining open known-gaps items that are genuinely
  Scope-1 residue — kept here as one initiative with per-item features so
  known-gaps and this roadmap stay reconciled (index §1). **Cross-reference-only
  items (specs live with their owners):** PM `domain` field (§4.6) →
  **R4-05-F7**; UI-created skills invisible to the palette (§4.11) + skills
  management (§4b.1/§4b.8) → **R3-01**; KB-seam loose ends §4.3(a)/(b)/(d) →
  **R1-01/R1-02/R4-02-F3**; KB scope-at-creation (§4b.2/3) → **R1-01**;
  recovery-tab removal (§4b.4) → **R4-11-F3**; flow artifact-set cleanup
  (§4b.5) → **R2-05**; skillPath resolver (§6) → **R3-01**.
- **Features:**
  - **R5-05-F1 brain-index module-cache staleness.** `brain-index.ts` is
    module-cached — a long `forge serve` sees stale indexes until restart
    (`brain-read-policy` theme). Invalidate per cycle or document the
    restart contract. ACs: a mid-daemon brain edit is visible to the next
    cycle's planner, or the limitation is documented where planners read.
  - **R5-05-F2 Watch SIGKILL: root-cause or document.** 3× external SIGKILL
    mid-dev-loop, suspected WSL2 memory pressure, absorbed by self-heal
    (§4.5). Capture evidence on next occurrence (dmesg/oom-killer check in
    the watch's exit handler); else document the absorption as the accepted
    posture. ACs: next occurrence yields a cause line in the log, or the
    posture note lands in operations docs.
  - **R5-05-F3 Concurrency default bump (gated).** Raise
    `FORGE_DEV_WI_CONCURRENCY` default from 1 only after a multi-cycle soak
    proves the concurrent dispatcher (§4.2). Pairs naturally with R2-03's
    spike evidence. ACs: soak evidence recorded; default changed in one
    place (`config.ts resolveDevWiConcurrency`).
  - **R5-05-F4 brain-ingest haiku A/B (§3).** Standalone A/B — sonnet vs
    haiku on one archived cycle under `brain/_raw/cycles/`, theme diff +
    operator sign-off — next time brain-ingest runs manually. Explicitly NOT
    a verify:cycle. ACs: comparison artifact + a keep/revert decision line.
  - **R5-05-F5 Deferred-defects verification sweep.** Memory
    `project_forge_deferred_defects` items (b) reviewer transient-crash
    unclassified / (c) dependents branch from stale local main are plausibly
    subsumed by later crash-classification + worktree-sync work — verify
    against current code and either close with citations or spec the fix
    here. ACs: both items carry a dated closed/open verdict with file
    references.
  - **R5-05-F6 demos/verify artifact policy (§4.8).** Decide
    keep/commit/clean for untracked `demos/verify/<handle>/` gate artifacts.
    ACs: decision recorded; harness implements it.
- **Session sizing:** each feature ≤half a session; bundle opportunistically.
- **Out of scope:** everything in the cross-reference list above (owned
  elsewhere); betterado items (known-gaps §5, Scope-3 — index §7).

### R5-06 Demo/harness backlog

- **Status:** planned  ·  **Wave:** opportunistic (natural bundle: one demo-polish session)
- **Depends on:** — (items 8/9 unblock fully only with R3-01 surfaces)
- **Context:** known-gaps §4b.6–15 (operator's demo/clip notes from the PR #24
  review) + standing opportunistic targets from memory
  (`project_iteration_refinement_targets`). The journeys are BOTH the demo and
  the UI regression gate — every item lands via the journey-sync contract.
- **Features:**
  - **R5-06-F1 Clip mechanics (§4b.6/7/10).** Cursor visible + click
    highlights; all typing progressive; advanced options showcased wherever a
    surface has them; fix sticky-header artifacts in fullPage captures
    (scroll-to-top or unstick at capture). ACs: re-rendered clips show all
    three; no header mid-frame in any full-page frame.
  - **R5-06-F2 Truthful clips (§4b.8/9/12/14).** skill-edit clip shows a real
    skill edit (needs R3-01's editing surface — until then narrate the
    limitation); pbrain-generate clip reaches a seeded brain; add a
    my-first-flow first-run clip; hex-detail frames show realistic streaming
    log lines in the drawer. ACs: each named clip demonstrates the named
    thing.
  - **R5-06-F3 Fixture re-grounding (§4b.13/15).** run-plan-gate's seeded
    PLAN.html re-grounded on a recent real architect session; review-section
    demo evidence re-synced to an actual betterado-cycle demo artifact
    (corpus-grounded seeds rule). ACs: fixtures cite their source artifacts
    in comments.
  - **R5-06-F4 Gallery depth (§4b.11).** Per-item functional descriptions in
    the gallery — text+images+video sufficient for any agent working on
    forge to spot story beats and drift. ACs: every journey section carries a
    functional description beyond its narration.
  - **R5-06-F5 Opportunistic operability targets.** (memory, standing —
    smallest intervention wins, never sub-systems): PLAN.html ≥1 HTML-native
    element (visual dep graph / highlighted manifest preview — feeds R2-05's
    dynamic surfaces). The human-readable-logs and initiative-handle items
    **relocated to R6-02** (2026-07-17 coverage review — they are
    operator-surface platform work, not harness content). ACs: lands only
    when a session already touches the surface.
- **Session sizing:** 1-2 bundled sessions (F1-F4); F5 rides along.
- **Out of scope:** demo *agent* behaviour (R4-07); architect re-run surface
  (R4-11-F5 — its journey coverage lands here).

### R5-07 SSOT reconciliation

- **Status:** implemented (2026-07-17 — as-built facts in R5-B7)  ·  **Wave:** 0 (rides along with R5-01/R5-02 — cheap, stops drift compounding under the new roadmap set)
- **Depends on:** —
- **Context:** The stale/contradictory doc statements this planning session's
  review surfaced. Pure doc hygiene: strike, reconcile, single-source. Each
  fix cites its evidence; `forge brain lint` + link checks stay green.
- **Features:**
  - **R5-07-F1 Strike resolved known-gaps entries.** §4.3(c) brain-index
    pre-ADR-035 walk — fixed by PR #26 (`464eabd`); **§1 flow edit-lock —
    fixed by S8/DEC-3** (run-model stamps `manifest.flow_id`; verification
    test = R5-04-F1); annotate rather than delete (living-doc rule: strike
    with date + commit). ACs: known-gaps shows both struck with provenance.
  - **R5-07-F2 ADR-024 completion statement.** Reconcile the double-booking:
    ADR-024's landed notes (five PhaseAgentSpec migrations done, 2026-06-13)
    vs CLAUDE.md ("not yet complete"). Record the agreed definition: spec
    migration done; artifact migration = R4-01 (this set). One statement,
    both docs point at it. ACs: CLAUDE.md and ADR-024 no longer contradict.
  - **R5-07-F3 Journey count.** CLAUDE.md says "10 user-story journeys" while
    listing 11 names; operator-journey.md says 11; MEMORY says 10. Canonical:
    count the files in `scripts/journeys/`, fix every citation. ACs: one
    number everywhere.
  - **R5-07-F4 Verify-ground identity.** One canonical sentence for the
    verify-cycle grounds (CLAUDE.md says default=mdtoc; verify-cycle-ideas
    README says the corpus targets gitpulse; betterado = live tier). ACs:
    CLAUDE.md + docs/verify-cycle-ideas/README.md agree.
  - **R5-07-F5 Path + naming fixes.** CLAUDE.md `brain/log.md` → the real
    `brain/forge-dev/log.md`; `studio/README.md` contents list (`kb/` doesn't
    exist; `artifact-templates/`, `demo-elements/`, `demo/` omitted). ACs:
    paths resolve.
  - **R5-07-F6 Two-C7 collision + theme staleness.** Record the C7 clause-id
    collision (external-resource vs holistic-metrics) in both themes with a
    pointer to R1-D1's fresh-clause-id rule; fix `brain-read-policy` theme's
    pre-ADR-035 Brain-3 location and the onboarding-contract theme's stale
    "C6 open" frontmatter; note known-gaps §4.4 (architect+PM collapse) as
    superseded by the Q2-B architect/plan split. ACs: themes carry dated
    correction notes; brain lint green.
  - **R5-07-F7 MVUS ↔ Q4 note.** Amend MVUS's cross-project observability
    line to point at the Q4 slim-strip decision (R4-11-F4) so the requirement
    and its deliberate thin shape stay linked. ACs: MVUS cites R4-11-F4.
  - **R5-07-F8 North-star reframe lands (operator decision 4, 2026-07-17 —
    wave 0, rides the first session).** Mint the **north-star ADR** (next
    free number): the two-level mission — **Scope 1 = a modular platform for
    building the ideas machine or any other agentic flow** (SWE-focused for
    now by explicit operator choice; future = connectors to other kinds of
    systems, not built in advance), **Scope 2 OOTB = the ideas machine**
    (where MVUS lives). R4-01-F1's later ships-as-artifact ADR
    cross-references this one rather than originating the split. Strike-list
    (adversarial review D1/D2/E9): `CLAUDE.md` line 3 + north-star section
    rewritten two-level (the instruction layer must stop biasing sessions
    against Scope-1 generality); `README.md:5` gains the platform/content
    distinguishing sentence; `ARCHITECTURE.md` header note ("the phases below
    are the shipped OOTB suite riding the engine/seams" — full rewrite rides
    R4-01); **MVUS re-scoped in place** — preamble retitled "canonical vision
    for the shipped OOTB suite (Scope 2)", keep/cull rule bounded to Scope-2
    content, §3's unifier text replaced with the Q3-B successors (demo agent
    + adversarial review + orchestrator merge-boundary gate ⚑);
    `docs/forge-studio-market-and-differentiation.md` dated amendment at §2
    (the reframe is the internal engineering north star; external positioning
    keeps the four §3.4 qualifiers until non-SWE connectors exist);
    `docs/repo-map.md` Scope-1 line names the target as "any agentic flow";
    roadmap `README.md` §1 + §8 updated with the reframe, dated. ACs: ADR
    merged; every strike-list doc amended with a dated note; no orientation
    doc still teaches the single-level vision.
- **Session sizing:** 1 session (or folded into wave 0's second session).
- **Out of scope:** any code change (pure docs); roadmap-set upkeep itself
  (index §5 maintenance contract governs that).

## Deferred

*None.* R5 is the residue absorber — new findings append as features under
R5-05/R5-06 (or new initiatives with the next free ID) per the index §5
maintenance contract; nothing currently carries a deferral condition.

## Change log

- 2026-07-17 — Roadmap created (initial forge-dev roadmap planning session).
  Locked inputs: Q6-A (wave 0 = R5-01 → R5-02, R5-07 rides along; R5-03..06
  opportunistic). Cross-roadmap edges recorded: R2-01 ← R5-01,R5-02 (safety
  precedes new spawn surfaces) · R2-04-F3 ← R5-01 · R3-03 ← R5-01,R5-02
  (soft) · cross-reference-only items pointed at R4-05-F7 / R3-01 / R1-01 /
  R4-11-F3 / R2-05.
- 2026-07-17 — Adversarial-review amendment pass. R5-04 re-scoped to a
  verification test — the planned fix already shipped in S8/DEC-3 (A3), moved
  to wave 1 with edges to R3-02/R4-10 (E7); R5-07-F1 gained the known-gaps §1
  strike; **R5-07-F8 added** (operator decision 4): the north-star reframe ADR
  + orientation-doc strike-list incl. the MVUS Scope-2 re-scope (D1/D2/E9);
  R5-01 dep-by extended with R4-05-F4.
- 2026-07-17 — **R5-07 implemented** (branch `docs/r5-07-ssot`): ADR 038
  minted (F8 north-star reframe + strike-list) and the F1–F7 reconciliation
  sweep landed; status planned → implemented, as-built facts absorbed into
  R5-B7.
- 2026-07-18 — **R5-02 implemented** (branch `fix/r5-02-env-pin`): the G8 env
  allowlist at the shared SDK spawn seam (F1) + `ci_gate_unset_env` gate-child
  strip (F2) landed, with a default-deny structural lock covering all five
  launch paths; status planned → implemented, as-built facts absorbed into
  R5-B9. The env-leak theme's G8 marked resolved. A spec/quality + security
  review pair found and closed the `unstable_v2_*` enforce-lock bypass before
  merge.
- 2026-07-18 — **R5-01 implemented** (branch `fix/r5-01-dry-bridge`): the
  `FORGE_DRY_BRIDGE` seam (F1), route-coverage drift guard (F2), and harness
  post-run boundary checks (F3) landed; status planned → implemented, as-built
  facts absorbed into R5-B8. A whole-branch adversarial review + security
  review produced a documented follow-up tail — see known-gaps §7. A real
  `ui:journey` proof exposed two defects the diff-reviews couldn't (F3's
  boundary check never firing; the harness moving the forge HEAD via a
  studio-write branch checkout on a nested project) — both fixed and re-proven
  green before merge.
- 2026-07-18 — **R5-04 implemented** (rider, branch
  `docs/r5-04-edit-lock-verified`): the edit-lock verification proof already
  existed and is green (`cli/bridge-studio-flows.test.ts`, commit `d0a186f`
  with the S8/DEC-3 fix) — it pre-dates this roadmap, so the "proof artifact
  missing" framing was an oversight. No new test was authored (a duplicate
  would be a review defect); status planned → implemented, as-built in R5-B10.
  known-gaps §1 was already struck (R5-07-F1).
