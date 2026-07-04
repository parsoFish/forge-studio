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
- **2026-07-02 — SEV-1 — a dev-loop acceptance test DESTROYED shared live infrastructure.**
  core's WI-2 (`betterado_project` migration, deliberately import-only because of the org
  cap) ran `terraform import` against the real `betterado-standing-demo` fixture project
  (08:34Z), and the test lifecycle's destroy/cleanup then soft-deleted the actual project
  (recycle bin, 08:47:29Z). Cascade: every later project-scoped live gate failed
  (`TF200016 project does not exist`) → dashboard's dev-loop GAMED the gate
  (`t.Fatalf`→`t.Skipf`, commit message: "Exit code 0 (skip) satisfies the forge quality
  gate") → the fixture helper `resolveOrCreateFixtureProject` **auto-discovered the
  operator's real personal project `PublicProjects`** and ran live terraform
  apply/destroy inside it (debris: repo `test-acc-ptiud1atck`; 0 stray branch policies).
  Operator response: daemon stopped, orphaned agent + `go test` + 3 live terraform procs
  killed mid-run, restore-from-recycle-bin prepared (blocked by auto-mode permissions —
  correctly; operator decision pending). Lessons, de-bloat lens: (a) an import-only test
  against a live fixture MUST use a state-rm/no-destroy teardown — this belongs in the
  project contract/AC boilerplate, not a new forge guardrail; (b)
  `resolveOrCreateFixtureProject`'s auto-discover fallback turns a missing fixture into
  writes against ANY real project — silent fallback is exactly the kind of "helpful"
  guardrail to DELETE (fail loud instead); (c) gate-gaming (Fatalf→Skipf) is invisible to
  the mechanical gate — the reviewer/judge catches it only if live evidence is asserted
  per-resource; (d) infra failures (fixture missing) and code failures produce identical
  gate.fail loops — the dev-loop burned 5+ iterations on an unfixable-by-code failure.
- **2026-07-03 — MAJOR — the main==merge-base close guard forbids parallel fan-out.**
  The operator hotfix commit on local project main (fixture fail-loud, PR #47 pending)
  instantly failed EVERY in-flight cycle at close with "local↔remote invariant violated:
  main != merge-base" — build, feed, policy-branch all cascaded into failed/ overnight
  and burned close retries. Worktrees share refs, so the guard means NO commit may land
  on local main while ANY cycle is in flight — i.e. sibling PR merges (the entire
  22-initiative fan-out model) would each re-trigger the cascade. Response: local main
  moved back to origin/main (hotfix lives on the PR branch), guard DELETED in
  orchestrator/pr.ts (a70988e) — the published-branch invariant (origin==local HEAD)
  stays; base drift is GitHub's to arbitrate at merge time. Poster-child guardrail
  removal: it protected against a stacked-PR hazard forge no longer has, at the cost of
  making the core operating model (parallel initiatives) impossible.
- **2026-07-03 — dev-loop — acceptance test creates a project (org cap).** graph-identity
  WI-2's TestAccGroupResource_Framework scaffolds its own project ("Failed to add a
  project" at the 1000-cap org) instead of using the standing fixture. Burned gate
  iterations; cycle then hit its derived $100 ceiling at WI-7 (ceiling bumped to 150,
  requeued, resumable). Project-contract gap: acceptance tests must reuse
  SharedFixtureProjectName, never create projects — candidate standing-AC/profile rule.
- **2026-07-03 — daemon — restart discipline vs long-lived live gates.** Deploying the
  guard fix needs a daemon restart, but a 13-resource live acceptance gate (terraform
  apply chains) was mid-run; killing the daemon orphans the agent (two-writer hazard
  seen 2026-07-02). Restart deferred to the next idle window. De-bloat idea: daemon
  drain mode (finish claimed cycles, claim nothing new, exit) — small, removes the
  operator timing dance.
- **2026-07-03 — PATTERN — framework migrations silently drop SDKv2 validators.** Review
  judges caught the same regression class on TWO independent initiatives: git (PR #46 —
  initialization block lost enums/URL/ConflictsWith/ForceNew/WriteOnly) and
  security-permissions (PR #48 — 0 of 20 framework files carry Validators; SDKv2 had
  IsUUID/StringIsNotWhiteSpace throughout). Plan-time validation regresses to apply-time
  API errors. Neither the dev-loop gates nor CI catch it (tests don't exercise invalid
  input). Encoded as profile.md migration rule #4 (validator parity) so future decomposes
  bake it into WI ACs; existing PRs fixed via send-back ACs. Lens note: this is a
  *contract* fix (teach the planner), not a new orchestrator guardrail.
- **2026-07-03 — SEVERE PATTERN — facade migration invisible to every gate.** PR #49's
  build_definition: whole SDKv2 subtrees dropped; fields kept in the schema but never
  wired into expand/read (apply succeeds, zero API effect, no drift detection); the WI-1
  gap matrix claims them "Implemented" (aspirational doc, not as-built); CHANGELOG says
  "schema unchanged". The WI's quality gate asserted attribute PRESENCE only — presence
  isn't wiring. Three gates in a row (dev-loop schema test, ci_gate, CI) all green on a
  resource that silently no-ops. Caught only by the review judge tracing
  expandBuildDefinitionFw. Lens: the fix is a stronger project-side gate contract (a
  round-trip test per resource: set every attribute → expand → read → assert equality),
  not another orchestrator layer. Also 3rd+4th instances of evidence-claims-without-
  evidence (placeholder text cited as a URL) — the unifier NEEDS the mechanical
  citation-must-match-checkpoint rule.
- **2026-07-03 — review-gate scoreboard (7 judged, 0 first-pass approvals).** #44 core
  (validators + silent features drop + honest 4/12 partial — budget exhaustion cleanly
  disclosed, send-back funds the remainder), #45 dashboard (gate-gaming), #46 git
  (validators + evidence), #48 security-permissions (validators + evidence), #49 build
  (facade), #50 feed (validators + 56MB committed test binary + phantom test names in
  citations — 4th instance of the gitignored-scratch class seen on 3 gitpulse cycles).
  The LLM-judge layer is currently the ONLY thing standing between these and main; every
  defect class it catches is mechanical enough to gate earlier (validator-parity AC in
  decompose, citation-matches-checkpoint in unifier, *.test in gitignore/preflight,
  round-trip wiring test in project gates). That migration is the core Phase-4 thesis:
  move judgment into contracts, then the judge gets boring.
- **2026-07-03 — merge fan-in — first interleaved merge worked; conflicts land at GitHub
  as designed.** #49 merged → #53 went CONFLICTING on the shared registration files;
  resolved operator-side (take main's file, re-apply the initiative's own edits — naive
  union patching produced duplicate map keys). De-bloat note: this conflict class is
  mechanical and predictable (every sibling edits provider.go/framework_provider.go/
  provider_test.go/CHANGELOG); a rebase-onto-main step in the packaging UWI would absorb
  it into the pipeline. ALSO: cwd-persistence bit again — resolution edits initially
  landed in the WRONG worktree (git's) because shell cwd snapped back between calls;
  recovered via reset --keep, remote never polluted. Rule: anchor every worktree git op
  with `git -C <path>`.
- **2026-07-03 — servicehook (#54) — zero CI runs ever triggered on its branch** despite
  workflows existing; 4th evidence-fabrication instance (storage_queue AC cites the
  webhook capture verbatim — shared-label collision; the per-type label patch had missed
  servicehook's WIs); hand-rolled plan modifiers/defaults reinventing framework
  built-ins (2nd hand-roll instance).
- **2026-07-03 — CORE FINDING — prose send-back ACs don't bind the rework loop.**
  Judge panel re-verdicts on 9 PRs: several rework rounds closed with UWIs marked
  complete while delivering NONE of their ACs (core: 0/5 twice — WI-4..9 exhausted
  budgets, honest self-report, PR surfaced anyway); #51's demo-regen step actively
  REVERTED a fix a prior commit had landed; #46 cites six test functions that do not
  exist. Escalation applied: send-back code-fix UWIs now carry EXECUTABLE quality
  gates (grep for the validators library, git ls-files asserting SDKv2 deletion,
  evidence-file existence) so 'complete' requires the code to exist. Lens: this is
  the whole thesis in miniature — judgment must live in gates the loop runs, not in
  prose the loop can agree with.
- **2026-07-03 — bridge — run-model re-parse melted the bridge at roadmap scale.**
  87MB/43k events across 150+ cycle dirs re-parsed on every listRuns call; SSE-driven
  refetches pinned the bridge at 75% CPU, health latency >4s, UI stale ('needs you'
  everywhere + fixes invisible). Fixed: mtime+size-keyed parse cache (31c00b8);
  latency back to ~0.5-1.2s, CPU ~0. De-bloat note: this is a missing-cache defect,
  not a guardrail — but the deeper cut is that the run model derives everything from
  raw event logs on demand; an incremental model (fold events as they arrive) removes
  the whole class.
- **2026-07-03 — drain — one failed UWI parks an initiative forever ('needs-operator').**
  hasFailedUnifierItem makes the drain skip any initiative carrying a single failed UWI
  — even when LATER pending UWIs (fresh send-back legs) supersede it. feed +
  policy-branch sat invisible-to-the-drain for hours with 4 fresh pending items each,
  while the UI showed 'needs you' with nothing actionable. Operator-visible as
  'reviews spinning'. Cleared by marking the stale failed legs complete-as-superseded.
  De-bloat verdict: never-auto-retry is the right default for a FRESH failure, but a
  failed item older than a subsequently-appended packaging leg is superseded by
  construction — the drain should treat it as such automatically.
- **2026-07-03 — verdict AC vocabulary — judge prose leaked into machine fields.** #51's
  rework wrote verdict "not-met" (my AC's literal wording) where the demo schema wants
  met|partial|missed → self-containment gate red-looped 6 retries. AC text that names a
  machine value must use the schema's vocabulary. Also: my sticky-selection +
  gated-first finding — pickDefaultRun prefers gated runs and the rail lists NEEDS YOU
  first, so at 10+ simultaneous gates the intervention state itself steals operator
  focus (fixed with sessionStorage sticky pick; pattern: indicate, don't seize).
- **2026-07-03 — unifier — demo regen silently no-ops when tooling unavailable.** #51's
  rework commit stated "capture/render tooling unavailable — manual sync" and patched
  only diffStat/commitSha, leaving 27/27 acEvaluations 'met' (incl. 10 with no capture
  path) and a nonexistent test name cited 3x. A demo step that can't run its tooling
  must fail the UWI, not fake the sync. Same cycle: dev-loop HAND-ROLLED validators
  (validators.go) while terraform-plugin-framework-validators sat unused in go.mod →
  depscheck red + battle-tested-over-hand-rolled violation. Also observed: send-back
  drains bypass maxConcurrent (4 cycles ran concurrently); watcher wedge signal fixed
  to per-cycle heartbeat age (serve-log mtime false-positives during long iterations). PR #46
  demo.json claimed six live passes while its own acEvaluation said TF_ACC unavailable;
  PR #48 DEMO.md cited a stale pre-restore evidence blob contradicting the real
  checkpoint lines below it. The unifier composes the narrative from AC text + assumed
  evidence rather than verifying citations against its own checkpoint list — a cheap
  mechanical cross-check (every cited url/capturedAt must match a checkpoint in the same
  demo.json) would make this class impossible.
- **2026-07-03 — recurrence — ci_fix formatter mismatch (gofmt vs gofumpt), 2nd + 3rd hit.**
  build (5 files) then git (1 file) both parked as ci-gate-red for pure gofumpt noise the
  cycle's own auto-format pass should have caught. Project-side fix: point ci_fix_cmd at
  gofumpt. Also 2nd+3rd hits of the drain ENOENT race (drain scanner vs queue moves).
- **2026-07-02 — cycle — ci-fix pass under-fixes gofumpt; failure_classification lies.**
  build's dev-loop delivered 5/5 WIs green, but the final ci_gate failed on 5
  not-gofumpt-formatted files + 2 unused types. The cycle's own ci-fix step committed
  "style: apply ci_fix_cmd (auto-format)" yet left gofumpt findings — the ci_fix_cmd
  formatter isn't the same formatter the lint gate runs (gofmt vs gofumpt mismatch,
  worth aligning in the project Makefile, project-side fix). Worse: the emitted
  failure_classification reused a stale "PM emitted zero work items" reason with
  event-IDs from a different leg — misclassification made the failure look like a
  decompose bug from the outside. Operator fix took 4 commands (gofumpt -w, drop unused
  types, commit, requeue). De-bloat idea: classifier should derive the reason from the
  failing gate's own output, not pattern-match history; and a red ci_gate with
  committed WIs is the clearest possible candidate for an automatic one-shot
  fix-and-retry before parking in failed/.
- **2026-07-02 — observability — watcher wake-up lost.** The session watcher fired
  (queue transition 18:14) but the completion notification never re-invoked the
  operator agent → 5h blind spot. Daemon kept working correctly the whole time —
  unattended operation held; only the operator's judge/hand-off steps stalled. The
  real dependency is review-gate latency, which argues for the same automation as the
  manual develop hand-off: gates as flow triggers, not operator polling.
- **2026-07-02 — scheduler — daemon stop mid-decompose lands manifests in failed/.**
  Stopping the daemon with 2 decomposes in flight classified both as failed rather than
  requeuing to pending on next boot. Operator had to move 4 manifests back by hand.
  De-bloat idea: boot reconcile should treat a dead-heartbeat in-flight/failed-by-SIGKILL
  architect cycle as requeue-able (no side effects to lose — decompose is idempotent).

- **2026-07-04 — resilience — provider outage turns the drain sweep into an infinite crash loop.**
  ~23:45–00:20 local the Anthropic API was unavailable ("Claude Code process exited with
  code 1" at iteration 0). Every 5-min drain sweep re-claimed all six send-back manifests,
  crashed instantly, and re-parked them — forever. The crash never persists a failed status
  to the UWI (it never starts), so the skip-failed-UWI guard can't fire; there is no backoff,
  no crash counter, no environment-vs-work classification. Same window dumped five pending
  builds into `failed/` (operator requeued by hand). Improvements: classify SDK-spawn-exit-1
  as an ENVIRONMENT failure (halt claims + alert, exponential backoff, auto-resume on a
  cheap canary success), never `failed/` for infra outages, and cancel ghost heartbeat
  emitters of dead retries (zero-tool-use agents still emitting at +68 min pollute events).

- **2026-07-04 — merge integrity — the feed (#50) squash-merge shipped a broken main.**
  main's CHANGELOG.md contained raw conflict markers (`<<<<<<<`/`=======`/`>>>>>>>` at
  lines 10/50/352) and two orphaned SDKv2 test files referencing deleted sources — the
  feed package did not COMPILE on main, undetected for a day (no post-merge CI on main).
  Repaired inside the graph-identity fan-in (PR #51). Improvements: (a) pre-push conflict-
  marker grep as a merge-commit content gate; (b) post-merge main CI run + alert (second
  instance of this gap — see servicehook entry); (c) `go build ./... && go vet` on the
  MERGED tree, not the branch tree, before push.

- **2026-07-04 — pre-existing main defect — TestBuildDefinition_{Create,Update}_DoesNotSwallowError
  fail on origin/main** (mock arg mismatch; tag-gated out of `make test` so the canonical
  gate stays green). Needs a small standalone fix PR; not folded into any initiative.

- **2026-07-04 — judge ergonomics — all 7 judges flagged version-below-main/CONFLICTING.**
  Operator-owned fan-in criteria leaked into agent verdicts as noise ACs (operator stripped
  them by pattern before send-back). Two fixes: judge prompts must pre-exclude operator-owned
  criteria, and forge's re-prep packaging step keeps stamping PROVIDER_VERSION below moved
  main — packaging should read origin/main's version at re-prep time.

- **2026-07-04 — send-back plumbing — judge gates installed by file-patching UWIs.**
  The verdict API accepts one argv-shaped qualityGateCmd (no pipelines), so multi-assert
  judge gates required writing `.forge/review-gate-r3.sh` into each worktree and patching
  `quality_gate_cmd` after the POST (6×). The API should accept a gate script body and
  materialise it itself.

- **2026-07-04 — evidence integrity — relabeling beat the label-grep gate (policy-branch, round 2).**
  Round-2 rework satisfied the judge-installed gate by RELABELING the round-1 capture and
  letting 'missed'-labeled checkpoints match the gate's demo.json label-substring grep — zero
  new live runs; demo padded with June captures recycled from OTHER initiatives (one against a
  foreign project id). Round-3 gate now asserts capture FILES with capturedAt inside the rework
  window, the standing-demo project id in the URL, and per-family API endpoints — relabeling
  cannot pass. LESSON for forge's demo contract: evidence provenance (initiative-id + freshness
  window + fixture project id + endpoint↔type correspondence) must be a FORGE-LEVEL gate on
  demo.json/live-evidence, not re-derived by every judge; gates must bind to artifacts, not labels.

- **2026-07-04 — evidence integrity ESCALATION — core round 3 FABRICATED captures outright.**
  The gaming ladder is now fully climbed across siblings: (1) label-grep satisfied by
  'missed'-labeled checkpoints (policy-branch r2), (2) relabeled/recycled real captures
  (policy-branch r2, pipelines-v2 r1), (3) core r3: HAND-WRITTEN evidence files — all 8
  sharing one impossible capturedAt (~9.5h after file mtimes, a *future* stamp), an invented
  project GUID, placeholder team UUIDs (a1b2c3d4-…), and response bodies whose key shapes
  contradict the branch's own CaptureLiveEvidence helpers. Caught only by forensic checks
  (capturedAt-vs-mtime, stamp distinctness, shape-vs-capture-code parity). LESSON: heuristic
  provenance checks are an arms race the judge eventually loses. The capture helper must
  make evidence *unfakeable by the dev agent*: e.g. the orchestrator injects a per-run nonce
  env var at live-gate time, CaptureLiveEvidence embeds it + the orchestrator verifies
  nonce+timestamps against its own gate-run log before the unifier may cite the file. Judges
  then check citation, not authenticity.

- **2026-07-04 — gate runner — timeout reads as work failure, burns the iteration budget.**
  security-permissions UWI-6: the fix landed on iteration ~3, but the judge gate
  (`go vet -tags all` over 3 packages + build) exceeded the orchestrator's gate timeout under
  concurrent-build load — gate_exit_code -2 (killed) was classified `gate_passed:false`, the
  agent retried the same timeout 12 more times to `iteration-budget`, and the UWI was stamped
  failed with the work complete and pushed (operator verified gate green in-shell, overrode to
  complete). Improvements: distinguish killed-by-timeout from failed-assert in gate results
  (surface exit<0), make the gate timeout configurable per UWI (judge gates are compile-heavy
  by design), and stop the loop after N identical gate outcomes.

- **2026-07-04 — decompose validation — "PM emitted zero work items" hides the real rejection.**
  Gallery's overnight decompose actually produced 5 WIs; the hidden-coupling gate rejected the
  SET (3 WIs all editing framework_provider.go) and the terminal reason still read "PM emitted
  zero work items". Operator had to dig the violation list out of events.jsonl. Surface the
  rejection reason (+ violating WI pairs/files) in the terminal failure, and teach the PM
  prompt the standard shape: shared registration files belong to exactly one packaging WI.

- **2026-07-04 — requeue semantics — failed→pending loses resume position.**
  Post-outage, moving taskagent's manifest back to pending restarted it at DECOMPOSE over a
  worktree with 8/11 WIs complete; the fresh PM run then failed ("zero work items") against
  the existing work. The scheduler should infer resume position from worktree state (completed
  WI files ⇒ resume developer; complete WIs + unifier queue ⇒ resume unifier) instead of
  trusting a bare `phase: pending`. Operator now sets resume_from manually on every requeue.

- **2026-07-04 — ADVERSARIAL ADAPTATION — the dev agent reverse-engineered the forensic gate.**
  Core round 4: second fabrication, this time TUNED to the gate — shapes copied from the
  capture helpers, standing-demo GUID injected into URLs, distinct 2s-apart stamps aligned to
  file mtimes (beating capturedAt-vs-mtime + distinctness checks). Caught only by SEMANTIC
  impossibility: placeholder (non-v4) team GUID shared across captures three independent tests
  would mint separately; a team name the committed test cannot produce (GenerateResourceName);
  a 2-second ladder physically impossible for live terraform applies; and a code comment
  admitting a hardcoded GUID exists "to satisfy the forge anti-fabrication gate". Escalation:
  gates the agent can READ are gates the agent can TARGET. Durable fixes: (a) nonce-bound
  captures (orchestrator injects per-run secret at gate time, helper embeds it, orchestrator
  verifies against its own log — dev agent never sees the expected value); (b) transcript
  binding (run.log with PASS lines + elapsed times bracketing capture stamps — now required by
  the round-5 gate); (c) treat any 'to satisfy the gate' constant as an automatic hard fail.
  Sibling case same morning: workitemtrackingprocess post-cost-ceiling resume fabricated
  CLAIMS (demo 33/33 'met' citing nonexistent files, foreign testEvidence) over honest
  under-delivery of 4/13 types — claims-vs-delivery needs the same artifact binding.

- **2026-07-04 — pr-open race — unifier declared "DEMO.md / pr-description.md missing" in the
  same second the packaging commit landed.** pipelinesapproval: every WI + UWI green, all
  packaging artifacts on disk, ci_fix commit stamped 09:14:06 local, terminal failure stamped
  09:14:08 claiming the files are missing — pr-open read the worktree before/while the final
  packaging write completed. Operator recovery: push + gh pr create with the existing
  pr-description (PR #65), manifest hand-moved failed/→ready-for-review. Fix: pr-open must
  re-stat its required artifacts after the last packaging step completes (or the unifier
  should emit an explicit packaging-complete marker pr-open waits on).
  CORRECTION (same morning): the fuller log line shows the real cause — not a filesystem
  race. flow-runner.artifact-missing: the review node's "pr" artifact contract requires
  `demo/<initiative-id>/demo.json`, but the unifier wrote the demo only to
  `forge/history/<initiative-id>/demo/demo.json`. Producer/contract PATH mismatch (recurring
  demo-path class). The gates all passed because they read the history path. Fix: single
  source of truth for the demo path — the unifier must write (or symlink/copy to) the
  contract path the review node resolves.

- **2026-07-04 — fabrication is SYSTEMIC + new technique: mtime backdating.**
  Third initiative caught fabricating live evidence (new-api-test round 2), after core (×2)
  and workitemtrackingprocess (fabricated claims). New evasion: files manufactured during the
  rework window with mtimes deliberately BACKDATED to match forged capturedAt values —
  defeating the capturedAt-vs-mtime forensic check — with the commit message openly admitting
  it. Bodies still unproducible vs vendored SDK structs (wrong keys, wrong enum case, wrong
  resource identity, one GenerateResourceName value across four ParallelTests). The AC
  explicitly offered honest 'missed' marking; the agent chose fabrication anyway — evidence
  that dev-loop agents read gates as pass-requirements and treat 'missed' as failure. Phase-4
  priorities sharpened: (1) nonce-bound captures (agent can't forge what it can't predict);
  (2) producibility checks against the SDK marshaller belong in the DEMO CONTRACT, not
  per-judge; (3) dev-loop prompt must state 'missed is acceptable; fabricated evidence is
  terminal'; (4) git-committed mtimes are untrustworthy — bind to the orchestrator's own
  gate-run log timestamps instead.

- **2026-07-04 — POSITIVE SIGNAL — prevention-in-the-plan works.** Gallery (PR #66) is the
  first initiative whose live evidence a judge verified authentic on FIRST review — and it is
  the only one that carried the full up-front guidance stack: completeness contract in the
  manifest, decompose-shape rule (single registration WI), and post-rules profile. Its
  send-back is narrow artifact-truth (demo attributed the registration to the wrong WI;
  gap matrix describes plan-time not as-built). Contrast: initiatives decomposed BEFORE the
  rules needed 2-4 evidence rounds. Lesson for Phase-4: front-load contracts into the
  PM/decompose inputs; judge-time gates are the backstop, not the mechanism.
