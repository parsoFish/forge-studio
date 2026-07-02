# Betterado roadmap run — friction log (2026-07)

> Running log of every issue/hurdle hit while driving the 24-initiative betterado
> framework-migration roadmap through forge (RFP merged 2026-07-01; remainder 2026-07-02+).
> Feeds the post-cycle improvement review. Lens: **minimise/remove bloat and guardrails**;
> re-centre forge on authoring skills, hooks, agents, projects, and flows that automate
> multi-project work.
>
> Entry format: date — phase — symptom — root cause — workaround — de-bloat idea.

## Seeded from the 2026-07-01 session (pre-log)

- **2026-07-01 — architect/PM — under-decomposition.** PM decomposes cover a subset of the
  initiative's "Resources in scope" (dashboard-extension 1/2, core 2/7) while others are
  complete (build 4/4). Root cause: PM plans from the profile checklist, not from an
  enforced coverage contract. Workaround: manual completeness gate before every develop
  hand-off. De-bloat idea: this is a *missing contract*, not a missing guardrail — the
  manifest's "Resources in scope" should flow into the decompose prompt as an explicit
  checklist the PM must map WI-by-WI (or the unifier gate should compare planned WIs vs
  scope, cheap and mechanical). Prefer fixing the prompt/contract over adding a validator
  layer.
- **2026-07-01 — dev-loop — silent live-gate failure burned iterations.** Offline
  `make test` false-passes (acc tests skip without TF_ACC) while the orchestrator's live
  gate failed; failure never reached the agent → iteration-budget exhaustion. Fixed
  (committed f32c1aa): gate failure now written to `.forge/last-gate-failure.md` and the
  prompt reads it first.
- **2026-07-01 — cycle runner — flat flow cost ceiling stopped a saga mid-flight.**
  forge-develop's `costCeilingUsd: 25` stopped the RFP *between* dev-loop and unifier
  ($55 spent); sat 8.4h unnoticed. Fixed durably (65f1d96): ceiling now derives from
  `cost_budget_usd + 40` when not explicitly stamped. De-bloat note: the flat per-flow
  ceiling was a guardrail that outgrew its purpose once initiatives carried real budgets.
- **2026-07-01 — orchestration — architect→develop hand-off is a manual operator step.**
  forge-architect has no on:complete trigger; every decomposed manifest waits for a human
  `POST /api/develop/start`. Deliberate gate for this roadmap (completeness judging), but
  the *mechanism* should be a flow trigger with an optional gate, not a missing feature.
- **2026-07-01 — observability — monitors are session-scoped bash.** Transition tail +
  heartbeat/WEDGE detection had to be hand-rebuilt this session (and will be again next
  session). A cost-ceiling stop sat 8.4h unnoticed before the heartbeat existed. De-bloat
  idea: a tiny `forge watch` (or bridge SSE endpoint the CLI can tail) owned by forge, not
  per-session bash loops.
- **2026-07-01 — PM — max_turns exhaustion on ~50% of decomposes.** Brain-chasing via
  `[[theme]]` links in profile.md burned turns. Workaround: trimmed checklist + raised
  PM_LIVE_MAX_TURNS 50→70. De-bloat note: raising caps is bloat-by-default; the real fix
  was removing the link-chasing incentive. Watch whether 70 is ever actually needed now.

## 2026-07-02 session

- **2026-07-02 — test suite — time-bomb fixtures.** `cli/reflect-reconcile.test.ts` wrote
  2026-06-23 feedback fixtures without injecting the existing `now` seam; on wall-clock
  2026-07-01+ they aged past the 7-day recovery window → 2 failures on a clean checkout.
  Fixed (656d672). De-bloat idea: none needed — seam existed, tests just didn't use it.
- **2026-07-02 — environment — /tmp handoff evaporated.** The session handoff was written
  to /tmp; WSL restart wiped it. Memory file carried the state (redundancy worked).
  Rule: durable handoffs live in memory/plans, never /tmp.
- **2026-07-02 — MAJOR — headroom proxy env leaked into forge's agents.** The daemon and
  bridge, started from a headroom-wrapped operator shell, inherited
  `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` (+ HEADROOM_* vars) → every SDK agent's
  traffic went through the token-compression proxy → agents received compressed tool
  results and burned turns calling `headroom_retrieve` (12 calls in one PM run). Explains
  the ~50% decompose `error_max_turns` rate attributed yesterday to brain-chasing;
  feed + graph-identity failed terminally ("PM emitted zero work items") with 5 brain
  reads and 0 writes. Workaround: restart `forge serve`/`forge studio` with
  `env -u ANTHROPIC_BASE_URL -u ANTHROPIC_CUSTOM_HEADERS -u HEADROOM_*`. De-bloat idea:
  forge should pin the agent env it spawns with (an explicit allowlist at the SDK seam is
  *simpler* than debugging inherited state; alternatively document the incompatibility) —
  and the operator-side lesson: a global proxy wrap is exactly the kind of ambient
  guardrail this run is meant to weed out. **Recurrence:** this exact leak was found and
  "fixed" 2026-06-16 — but the durable strip went into `scripts/verify-cycle.mjs` only,
  so every manual `forge serve` launch since re-imported it. A fix that lives in one
  launcher instead of the spawn seam is a fix that regresses; strong case for pinning
  the agent env inside forge itself.
- **2026-07-02 — PM — brain-chasing persists post-trim.** Even with the trimmed profile,
  failed decomposes show 10-12 `pm.brain-query` calls each (ADR-010 mandates *a* query,
  not a dozen). With the proxy tax removed this may be affordable, but the decompose
  prompt should bound brain reads (e.g. "one scoped query, then plan").
- **2026-07-02 — PM — under-decomposition confirmed at scale: 5 of 11.** Completeness
  fan-out (11 sonnet checkers) verdicts: build/git/policy-branch/security-permissions/
  featuremanagement/notification complete; core (2/7 covered), dashboard-extension
  (headline betterado_extension dropped), workitemtrackingprocess (14 dropped),
  serviceendpoint (15 dropped) thin; pipelines-v2 near-complete (one data-source live
  test missing — patched WI-4 by hand instead of re-decomposing). Pattern: the PM
  under-plans exactly on large scope lists — consistent with turn starvation. Thin four
  requeued with an appended "decomposition completeness contract" note in the body.
  De-bloat idea: the scope→WI mapping check is mechanical; it belongs in the PM's own
  output contract (emit a coverage table; orchestrator diffs it against the scope list —
  cheap, no LLM validator layer).
- **2026-07-02 — PM — re-decomposes complete after env scrub + contract.** dashboard-extension
  (4.4 min, 3 WIs, both resources owned) and core (6.5 min, 9 WIs, 12/12 items owned)
  both re-decomposed COMPLETE on the first clean-env attempt with the appended
  completeness contract. Can't cleanly attribute (env fix and contract landed together),
  but the speed delta (minutes vs max_turns) points at the proxy tax as the dominant cause.
- **2026-07-02 — project contract — live-evidence label collision across WIs.** Every WI's
  standing AC uses the same `CaptureLiveEvidence("acceptance-resource", ...)` label →
  `.forge/live-evidence/acceptance-resource.json` is last-writer-wins across 7 sequential
  WIs in one initiative. Unifier's demo.json may carry evidence for only the final WI's
  resource. Judge-time check for multi-resource initiatives; candidate fix: per-WI label
  suffix in the standing AC boilerplate (project contract, not forge core).
- **2026-07-02 — scheduler — daemon stop mid-decompose lands manifests in failed/.**
  Stopping the daemon with 2 decomposes in flight classified both as failed rather than
  requeuing to pending on next boot. Operator had to move 4 manifests back by hand.
  De-bloat idea: boot reconcile should treat a dead-heartbeat in-flight/failed-by-SIGKILL
  architect cycle as requeue-able (no side effects to lose — decompose is idempotent).
