/**
 * Initiative manifest — the shape of one unit of work, and the SSOT for it.
 *
 * MOVED HERE FROM `packages/flows/manifest.ts` (M4-sessions s3, T1 ruling 81),
 * following this package's own established pattern: the DEFINITION lives in
 * contracts and the original module re-exports it, so there is exactly one
 * definition and every existing importer keeps working unchanged.
 *
 * WHY IT BELONGS IN CONTRACTS. A manifest is not a flows concept that other
 * packages borrow — it is the shared shape flows, factory and sessions all
 * read and write. Leaving the type in flows made `packages/sessions` (rank 4)
 * naming it a layer-order violation, which no amount of injecting the manifest
 * FUNCTIONS could close, because `check-boundaries` counts type-only imports
 * too. The alternative on the table was a structural duplicate of this shape
 * inside sessions guarded by a conformance test; that would have been a
 * ~40-line copy of another package\'s type with a scheduled deletion date.
 * Lifting it is the fix that leaves nothing behind.
 *
 * The manifest FUNCTIONS stay in `packages/flows/manifest.ts`: they read and
 * write the filesystem, which this package may never do (see index.ts\'s
 * header). Only the shape lives here.
 */

export type ManifestPhase = 'pending' | 'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed';
/**
 * G6 (closes finding I6): every initiative declares whether forge produced
 * it autonomously (`architect` — the out-of-cycle architect decomposed a
 * vision into right-sized initiatives) or the operator hand-directed the
 * work through the pipeline (`human-directed` — deliberate structural
 * surgery routed through forge, e.g. the trafficGame
 * `simplification-{tests,source,arch}` initiatives).
 *
 * The two modes have *different* success criteria: autonomous cycles are
 * judged on convergence-without-intervention; hand-directed cycles on
 * whether the specified work landed. Recording them identically pollutes
 * the autonomy signal (brain theme `human-directed-work-as-initiatives`).
 * Metrics and the reflector separate the cohorts on this field so "did
 * forge get more autonomous" stays answerable.
 *
 * Defaults to `architect` when absent (back-compat for manifests authored
 * before this field existed — NOT a feature flag, just a schema default).
 */
/** `triggered` = born from an external trigger fire (cron/webhook — ADR-041). */
export type InitiativeOrigin = 'architect' | 'human-directed' | 'triggered';
export type InitiativeManifest = {
  initiative_id: string;       // INIT-<YYYY-MM-DD>-<slug>
  /**
   * W6-RV-1 (mock finding I3), additive-optional field per ADR-042's
   * disclose-not-park rule: an explicit author-supplied title, read
   * straight off frontmatter. `initiativeTitle()` (packages/flows/manifest.ts) is the ONE display
   * derivation every surface uses (W7-A4 / W7-FIX-A4): this field when
   * present, else the body's first level-1 `# ` heading, else the
   * initiative id — never a `##` section heading. Every manifest PRODUCER
   * writes it (`buildManifest` from `DraftInitiative.title`,
   * `mintTriggeredInitiative` from the trigger + flow), so it is absent only
   * on hand-authored manifests or ones written before W7-FIX-A4. Exposed
   * here (rather than re-parsing frontmatter a second time downstream) so a
   * polled endpoint like the roadmap builder never parses the same manifest
   * buffer twice.
   */
  title?: string;
  project: string;
  project_repo_path: string;
  created_at: string;          // ISO-8601
  iteration_budget: number;    // > 0
  cost_budget_usd: number;     // > 0
  /**
   * Optional per-run cycle cost ceiling (USD). When present, overrides the
   * flow's `costCeilingUsd` for THIS run only (see flow-runner runFlow). Lets a
   * single initiative carry a higher ceiling than the shared seed flow without
   * mutating the flow file. Absent = use the flow's ceiling. The
   * `FORGE_COST_CEILING_USD` env var takes precedence over this when set.
   */
  cost_ceiling_usd?: number;   // > 0 when present
  phase: ManifestPhase;
  /**
   * G6: autonomous-vs-hand-directed cohort tag. Defaults to `architect`
   * when the frontmatter omits it (legacy manifests).
   */
  origin: InitiativeOrigin;
  /**
   * F-25: initiative-level dependencies. Each entry is another initiative_id
   * that must be in `_queue/done/` before the scheduler may claim this one.
   * Empty / absent = no prerequisites. Distinct from `depends_on` on individual
   * work-items, which orders WIs WITHIN this initiative.
   */
  depends_on_initiatives?: string[];
  /**
   * F-27: number of times this manifest has been auto-retried by the
   * scheduler after a recoverable failure. Used as a cap (`MAX_AUTO_RETRIES`)
   * to prevent infinite retry loops. Annotated by the scheduler on each
   * recovery; humans can also reset it manually if they amend the manifest
   * and want to give it another shot.
   */
  retry_count?: number;
  /**
   * F-27: list of failure modes that have previously caused this manifest
   * to be auto-retried. If the same mode shows up retry_count + 1 times,
   * that's strong evidence the issue isn't transient — the next failure
   * stops in `failed/` regardless of the mode's nominal `recoverable: true`.
   */
  previous_failure_modes?: string[];
  /**
   * R4-05-F2: work_item_ids produced by the plan agent's decomposition,
   * written back once decomposition completes. Distinct from a WI's own
   * depends_on (which orders WIs within the initiative).
   */
  specs?: string[];
  body: string;                // markdown initiative spec
  /**
   * Optional per-project quality-gate command. Used by both the dev-loop
   * (Ralph stop condition) and the reviewer (orchestrator-side gate). When
   * absent, falls back to `npm test` if `package.json` exists in the
   * worktree, else `true` (no-op gate). Single source of truth — both phases
   * use the same command, eliminating drift (F-04 / F-06).
   *
   * Examples:
   *   ['npm', 'test']
   *   ['pytest', '-q']
   *   ['cargo', 'test', '--all']
   *   ['bats', 'tests/']
   */
  quality_gate_cmd?: string[];
  /**
   * Resume a stalled/redirected cycle from a sub-phase, reusing the preserved
   * worktree + branch rather than re-running the full cycle from scratch.
   * Two distinct callers set this field, for two distinct reasons:
   *   - `'demo'` — ADR 019 (successor develop flow, R4-10-F6): crash / env-failure
   *     recovery when every WI is already `complete`. Skips architect/PM/per-WI
   *     dev-loop and resumes at the `demo` node — the post-develop band that is
   *     the flow's declared `resumable` re-entry point (dev→demo→review) — reusing
   *     the completed per-WI commits. Set by `forge requeue --resume-from=demo`.
   *     (Was `'unifier'` before the topology cutover retired that node.)
   *   - `'develop'` — ADR 040: review send-back re-entry. The PM phase
   *     rebases onto main and skips (no re-decomposition); the dev loop
   *     RUNS (prior WIs re-verify cheaply via the iter-0 already-complete
   *     shortcut, new review-fix WIs build); then the post-develop spine
   *     re-presents. Set by `persistManifestSendBack` under the verdict
   *     handler's manifest lock.
   * Absent ⇒ normal full cycle.
   */
  resume_from?: 'demo' | 'develop';
  /**
   * ADR 040: send-back round counter. Incremented by the review verdict
   * handler (`persistManifestSendBack`) each time review feedback compiles
   * into fix work-items and re-dispatches the develop agent. Absent ⇒ no
   * send-back has happened yet. Checked against `review.maxSendBackRounds`
   * (config, default 6) to bound the loop.
   */
  review_rounds?: number;
  /**
   * cascade-v4 #7: a throwaway / verification cycle (e.g. `verify-cycle.mjs`
   * frozen-SHA routine runs) should NOT pollute the durable brain. When
   * `disposable: true`, the reflector skips its theme + cycle-archive writes
   * (it still runs closure/merge); the durable brain accretes only from real
   * initiatives. Absent / false ⇒ normal reflection.
   */
  disposable?: boolean;
  // Optional runtime fields written by the scheduler
  claimed_at?: string;
  claimed_by?: string;
  worktree_path?: string;
  /**
   * ADR 026: the durable cycle id for this initiative, persisted on the manifest
   * at FIRST claim (`runCycle` mints it once). Every later re-entry — a crash-
   * recovery resume, the review→unifier drain, or the merge finalizer — threads
   * this SAME id so the initiative stays on ONE `_logs/<cycleId>` dir. Reusing
   * it is what dissolves the three release-folder defects (cost/status lineage
   * blanks, sibling cycle on send-back, WI hexes disappearing): one cycleId ⇒
   * one event log ⇒ one cost rollup ⇒ one set of hexes. Absent on legacy
   * manifests (the finalizer falls back to the latest matching `_logs` dir).
   */
  cycle_id?: string;
  /**
   * The Studio flow this initiative runs under (ADR-028 / J5). The run-model
   * associates the run with this flow so it surfaces under `/flows/<flow_id>` in
   * the monitor. S8/DEC-3 retired the forge-cycle monolith + its implicit
   * default: every NEW manifest names a flow (architect → forge-architect,
   * develop → forge-develop; W7-C1 retired the reflect flow wrapper —
   * reflection is a standalone post-merge agent run), and runCycle
   * throws on a missing/unknown flow_id (no fallback). Only historical `done/`
   * manifests may lack it; they are never re-run.
   */
  flow_id?: string;
  /**
   * P4: architect session id from the in-UI architect runner that produced this
   * manifest. Stamped during `runFinalizeStep` so the cycle's event log can emit
   * real architect start/end events (grounding the architect hex in actual data
   * rather than a synthetic mock). Absent when the manifest was created without
   * an in-UI architect session (legacy / hand-authored manifests).
   */
  architect_session_id?: string;
  /**
   * P4: total cost (USD) accrued by the architect session that produced this
   * manifest, summed from its `_logs/_architect-<sid>/events.jsonl`. When
   * present, `runCycle` emits a real architect end event with this cost so the
   * architect hex shows an accurate cost pill instead of a hardcoded mock value.
   */
  architect_cost_usd?: number;
  /**
   * P4: wall-clock duration (ms) of the architect session, computed as
   * `last started_at − first started_at` across the session event log. Emitted
   * alongside `architect_cost_usd` in the cycle's architect end event.
   */
  architect_duration_ms?: number;
  /**
   * R2-08-F4 (ADR-027 amendment): trigger provenance for a MINTED run
   * (cron / webhook / agent-complete origination only — chaining and merged
   * dispatch never mint a manifest, so their provenance is derived instead
   * from the run's own `*.trigger-firing` event; see run-model.ts). Persisted
   * ONCE at mint time (`mintTriggeredInitiative`) from the staged
   * `FlowRunRequest` that minted this run — never authored, never re-derived
   * from `body` prose. `trigger_kind`/`trigger_source` are always written
   * together (both absent, or both present); `trigger_scope` is present only
   * when the firing event resolved to a project — absent means unresolved
   * (the run model reports that as `scope: null`, never a fabricated
   * default).
   */
  trigger_kind?: string;
  trigger_source?: string;
  trigger_scope?: string;
};