---
doc: contracts
batch: 2026-05-20-refinement
date_ratified: 2026-05-21
status: locked
operator: David Parsonson
---

# Cross-plan contracts (locked)

The 7 refinement plans in this directory had **28 inconsistencies** the
councils flagged ([see INDEX.md / EXECUTION-PLAN.md](./EXECUTION-PLAN.md)).
This document is the **single source of truth** for how those
inconsistencies are resolved. Every plan in this batch is updated to
reference these decisions; if a plan and this doc disagree, **this doc
wins**.

These contracts must be honoured by any initiative sliced from any of
the 7 plans. Changing one of them requires re-checking the others.

## How to read this

Each contract:

- **C-number** is its stable identifier; cross-references in plans use
  `[C7]` etc.
- **Decision** is what's locked in.
- **Rationale** is why (drawn from the council critique).
- **Affects plans** lists the plan numbers whose text must conform.

---

## C1 — Per-project config file

**Decision:** `<project>/.forge/project.json` (project-root, hidden,
namespaced).

**Rationale:** Avoids name collision with `forge.config.json.example`
per-machine config at forge root (ADR 009). `.gitignore` excludes
`.forge/` already; projects carve out exactly this file as tracked via
a `!.forge/project.json` rule. Council 04 escalation [dx] lean.

**Schema** (initial — extend as needed by future refinements):

```json
{
  "demo": {
    "shape": "browser" | "harness" | "cli-diff" | "artifact" | "none",
    "command": ["bash", "-lc", "..."],
    "output": "demo/<initiative-id>/",
    "baseline": "main",
    "preview_command": ["npm", "run", "preview"]
  },
  "quality_gate_cmd": ["npm", "test"]
}
```

**Affects plans:** 04 (rewrite §"Demo contract" + §"Onboarding
contract"); 03 / 06 / 07 (any reference to the file).

## C2 — Demo-shape field name

**Decision:** `demo.shape: browser | harness | cli-diff | artifact | none`
(not `demo.kind`).

**Rationale:** `skills/demo/SKILL.md` already uses `kind: screenshot |
video | harness` at the **checkpoint** level. The project-level field
would collide on `harness` meaning two different things. Council 04 F2.

**Affects plans:** 04 (rename throughout). `skills/demo/SKILL.md`
unchanged — its `kind` stays.

## C3 — Cross-plan artefact contracts

### C3a — `pr-feedback.md` schema

The artefact the review router writes and the dev-loop unifier reads
on a send-back round:

`_queue/in-flight/<initiative-id>.pr-feedback.md`

```markdown
---
round: <int>                       # send-back round number (1, 2, ...)
comments_collected: <int>          # how many comments in this round
cursor: <github-comment-id>        # latest comment id seen
generated_at: <ISO-8601>
---

### @<author> on <path>:<line>      # line-level review comment
<comment body>

### @<author> general               # PR-level comment
<comment body>

### operator-note                   # optional, set via `/forge-review --note`
<operator-provided context>
```

### C3b — Re-entrant unifier mode

Plan 04's dev-loop unifier MUST accept a `--feedback-ref <path>` invocation
parameter. When set, the unifier's brief is augmented with:

> "This is a send-back round. Read `<feedback-ref>` and address each
> comment by file/line. Commit. Push. Do not exceed the iteration cap.
> Do not add scope beyond what the comments request."

Without `--feedback-ref`, the unifier runs in initial-prep mode (first
iteration after per-WI Ralphs). Plan 05's deletion dead-ends without
this mode existing in 04.

### C3c — Cross-plan filename normalisation

Plan 03 currently links `04-developer-loop.md` (3 places) and plan 04
calls PM "plan 02" (2 places). Both wrong. Authoritative names:

| File | Name |
|---|---|
| Plan 01 | `01-brain.md` |
| Plan 02 | `02-architect.md` |
| Plan 03 | `03-project-manager.md` |
| Plan 04 | `04-dev-loop.md` |
| Plan 05 | `05-review.md` |
| Plan 06 | `06-reflect.md` |
| Plan 07 | `07-general-logging-ids.md` (will split — see C18) |

**Affects plans:** 03 (fix `04-developer-loop.md` → `04-dev-loop.md`,
3 occurrences); 04 (fix "PM plan (02)" → "PM plan (03)", 2 occurrences);
05 (rewrite §"Dependencies"); ADR-style cross-references everywhere.

## C4 — Architect-emitted manifest fields (per feature)

The architect MUST emit, per feature in the manifest:

```yaml
features:
  - feature_id: FEAT-1
    title: ...
    gwt:
      - Given ..., when ..., then ...
    depends_on: [<feature_id>]
    quality_gate_cmd: ["go", "test", "./azuredevops/internal/service/release/..."]   # optional; defaults to manifest-level
    non_goals: ["docs", "examples"]                                                   # optional
    hard_constraints: ["must use azdosdkmocks", "single-branch fork"]                 # optional but expected when council flagged a binding constraint
```

The first four fields exist today; the last three are NEW.
`quality_gate_cmd`, `non_goals`, `hard_constraints` are optional and
omitted from serialisation when undefined.

**Rationale:** Plan 03 requires these to score per-WI gate emission;
plan 04 needs `quality_gate_cmd` per-feature to drop down to per-WI.
Without C4, half of plan 03's new bench criteria have nothing to score
against. Council 03 CEO escalation option 3 ("lock cross-plan contracts
before deepening any one plan").

**Affects plans:** 02 (add to deliverables in §"Plan-doc operator
artifact" — these are emitted in the PLAN.md manifest drawer + into
`_queue/pending/<id>.md` on approval); 03 (consumes verbatim); ADR 014
amendment.

## C5 — PM-emitted WI fields (per work item)

Existing fields stay. New optional fields (omit-on-undefined
serialisation):

```yaml
wi_id: WI-1
feature_id: FEAT-1
title: ...
acceptance_criteria:
  - Given ..., when ..., then ...
files_in_scope:
  - path/to/file.ts
depends_on: [<wi_id>]

# NEW (optional):
quality_gate_cmd: ["npm", "test", "--", "tests/x.test.ts"]   # per-WI override
non_goals: ["docs", "the bar component"]
verification_artifact: "tests/x.test.ts"                     # path; must appear in files_in_scope
creates: ["tests/x.test.ts"]                                 # structured marker — files this WI creates from scratch
```

`demo_hook` is NOT a WI field — it lives at **initiative-level only**
(see C15). PM does not author demos.

### C5a — `knownFeatureIds` wiring (the load-bearing fix)

`orchestrator/work-item.ts:validateWorkItem` already rejects unknown
`feature_id` when `knownFeatureIds` is passed (lines 113-115). The bench
harness + `runProjectManager` are NOT passing it today. Promote this
from a confirmation step to a real deliverable:

> Wire `knownFeatureIds: new Set(manifest.features.map(f => f.feature_id))`
> into both `benchmarks/project-manager/score.ts` AND
> `orchestrator/cycle.ts:runProjectManager` before adding any new
> rubric criterion.

That alone closes the WI-8/FEAT-5 hallucination case (intersection-backpressure,
`_logs/2026-05-18T12-01-50_INIT-…/work-items-snapshot/WI-8.md`) at the
validator layer; the `feature_id_in_manifest` bench criterion becomes
belt-and-braces.

### C5b — Hallucinated-FEAT behaviour

Hard error at validator + orchestrator catches and routes back to PM
with a single retry prompt naming the manifest's feature IDs. No silent
strips. Plan 03 Open Q3 option 3.

**Affects plans:** 03 (rewrite §"Required WI fields", §"Sizing
guidance"); ADR 015 amendment; `orchestrator/work-item.ts` (omit-on-undefined
+ round-trip test).

## C6 — Init-ID handle format

**Decision:** `<proj4>#<seq>` (e.g. `traf#7`, `bett#2`).

**Rationale:** One Shift key; doesn't collide with shell path/branch
syntax (`/`, `:`); survives copy-paste; per-project monotonic counter
is collision-free by construction. Council 07 [design] recommended.

**Caveat:** 4-char prefix collisions (future "tracker" project clashing
with "trafficGame") resolved by suffix digit at mint time.

**Affects plans:** 07 (lock in body); 02 / 05 / 06 (slash-command
`argument-hint` updates to `<initiative-id-or-handle>`).

## C7 — Brain-lint scope vocabulary

**Decision:** Plan 01's `brain-lint` enumerates scopes including
`cycle-touched-themes`. Reflect calls
`forge brain lint --scope cycle-touched-themes --cycle <id>`.
The lint walker resolves the file list from that cycle's archive
(`brain/_raw/cycles/<id>.md` + `## Sources` references).

Other scopes supported: `full`, `forge-only`, `project-only`,
`single-file --file <path>` (existing).

**Affects plans:** 01 (extend §"Brain-lint design" with the new scope);
06 (text already matches).

## C8 — Reflection status enum vs sibling field

**Decision:** Keep `reflection_status` ternary (`closed | failed |
skipped`). Add sibling `lint_status: 'clean' | 'flagged' | 'skipped'`
on `CycleResult` (defaulting to `'skipped'`).

**Rationale:** Avoids breaking telemetry consumers that check
`reflection_status === 'closed'`. Council 06 `eng:02-status-enum-expansion`.

**Affects plans:** 06 (rewrite §"Brain-lint integration" failure-handling
table; AC#3); `orchestrator/cycle.ts:CycleResult` extension.

## C9 — Reflect feedback write-timing

**Decision:** `/forge-reflect <id>` writes `user-feedback.md` AND
auto-invokes `forge reflect <id> --rerun`. `--rerun` is default-on.

**Rationale:** Without this, the operator's answers never reach the
brain — the reflector has already exited before the slash command
fires. Council 06 `design:01-slash-command-write-timing` (the biggest
UX gap in the batch). Cost: +1 reflector pass per cycle when the
operator answers questions; acceptable.

**Affects plans:** 06 (rewrite §"Slash-command UX" + Open Q2).

## C10 — Bench handoff module (single canonical)

**Decision:** `benchmarks/_lib/handoff.ts` exposing:

```ts
export function loadArchitectHandoff(fixtureId: string): {
  manifestText: string;
  planDoc: string;
  councilTranscript: string;
};

export function loadPmHandoff(fixtureId: string): {
  workItems: WorkItem[];
  graph: string;
  qualityGateCmd: string[];
};
```

One module, two exports, one source.

### C10a — `downstream_pm_score` frozen-SHA pin

To prevent PM-bench iteration from perturbing architect-bench scores,
the architect bench's `downstream_pm_score` criterion calls a frozen
snapshot of the PM bench rubric:

> `benchmarks/project-manager/scoring.frozen.ts` (a literal git-pinned
> copy, updated explicitly when the PM bench's shape changes — never
> incidentally).

**Affects plans:** 02 (§"Cross-phase contract", §"Benchmark regrounding"
new criterion definition); 03 (§"Cross-phase contract"); 04 (consumes
PM handoff).

## C11 — `initiatives.json` migration (PM bench)

**Decision:** Parse both shapes for one release.

- If `expected.min_work_items` / `max_work_items` /
  `parallel_fraction_at_least` are present, use them and emit a
  deprecation log line.
- If absent, compute the range from manifest topology
  (`feature_count..2*feature_count+2`, ceiling 8 unless `feature_count > 4`).

Drop hardcoded values in a follow-up after the next clean bench pass.

**Affects plans:** 03 (§"Bench redesign" — add migration sub-section).

## C12 — PLAN.md (architect artefact) location

**Decision:** `projects/<project>/_architect/<session-id>/PLAN.md`
(project repo). Promoted from Open Q to Decided.

**Rationale:** The plan is about that project; co-locating with
manifests + worktree state. `.gitignore` carves:
`_architect/_archived/` ignored, `_architect/<session-id>/PLAN.md`
tracked.

**Affects plans:** 02 (delete the self-contradiction between §"Files
touched" and Open Q2).

## C13 — Heartbeat emit site

**Decision:** SDK call wrapper (`loops/ralph/claude-agent.ts`). Sidecar
timer started before `query()`; cleared on result. 15s default cadence;
configurable per-project in `.forge/project.json` via
`logging.heartbeat_seconds`.

**Rationale:** Ralph runner is async-blocked exactly when liveness
matters most (silent SDK call). Emitting from the SDK wrapper sees the
in-flight query. Council 07 `eng:04-heartbeat-emit-site`.

**Affects plans:** 07 (rewrite §"New events to emit" emit-site
column).

## C14 — `cost_tick` emit site

**Decision:** Derived consumer subscribing to the existing `tee` hook
in `orchestrator/logging.ts`. Logger stays dumb / append-only per
ADR-008. Same path `metrics.ts` already uses.

**De-bounce:** 1/s max; only emit if cost changed since last tick.

**Rationale:** Stateful aggregation in the logger violates ADR-008's
single-writer / refs-not-contents discipline. Council 07
`eng:01-event-writer-contract-drift`.

**Affects plans:** 07 (rewrite §"New events to emit"; clarify
emit-site).

## C15 — Recap surface + `demo_hook` ownership

### C15a — Recap surface ownership

- Plan 06 owns `_logs/<id>/recap.md` (durable, gitignored). Always
  written.
- **Recap-as-PR-comment** belongs to plan 04 (which owns PR surface).
  When the unifier (plan 04) closes a cycle, it MAY post the recap as
  a PR comment via `gh pr comment`. Gated by manifest field
  `post_recap_to_pr: true` (default false).

### C15b — `demo_hook` placement

Initiative-level only. Lives in the manifest body (NOT a WI field, NOT
in `.forge/project.json`). One-line string describing how a reviewer
sees the change live. PM does not touch it. The unifier reads it to
inform demo authoring.

**Affects plans:** 04 (§"Demo contract" — add `demo_hook` read);
06 (§"Post-cycle recap surface" — defer PR-comment to plan 04); 03
(remove `demo_hook` from new WI fields).

## C16 — Approve-vs-send-back precedence + cursor atomicity

### C16a — Decision table for `/forge-review <id>` auto-detect

| Latest review-event by `submitted_at` | Branch state since | Action |
|---|---|---|
| `APPROVED` | No new commits since approval | → approval flow |
| `APPROVED` | New commits since approval (forge or operator pushed) | → ignore approval (stale); re-evaluate from prior events |
| `CHANGES_REQUESTED` | (any) | → send-back flow |
| `COMMENTED` only | (any) | → send-back flow (`/forge-review` itself is the intent signal) |
| Multiple reviewers, mixed | Most recent `CHANGES_REQUESTED` wins | → send-back |
| Latest commit author ≠ `forge-bot` | (operator pushed directly to PR branch) | → refuse to enqueue; warn |

### C16b — `review-cursor.json` atomicity

Write to `cursor.json.tmp` then `rename(2)`. On parse failure, treat
as `cursor=0` (idempotent replay beats silent skip).

**Affects plans:** 05 (rewrite §"PR-comment ingest mechanism").

## C17 — `_aliases.json` concurrency

**Decision:** `proper-lockfile` (~80k DL/wk, battle-tested) for mint-time
writes. Reads unlocked.

**Rationale:** Daemon + foreground `forge enqueue` can race. Council 07
`dx:02-aliases-json-concurrency`. Adds one dep — justified vs. hand-rolling
race-free file I/O.

**Affects plans:** 07 (rewrite §"Storage + collision").

## C18 — Plan slicing (internal splits)

Some refinements bundle disjoint concerns. Split internally before
slicing into initiatives:

### C18a — Plan 01 (brain) split

- **01a** = refinements #1–#5 (hygiene). Independent of plan 06. Ships
  in Stage **S1.2**.
- **01b** = refinements #6 (bench-growth pipeline) + #7 (betterado seed).
  Depends on plan 06's reflector emit. Ships in Stage **S5**.

Plan 01 gets a `## Slice boundary` heading between #5 and #6 declaring
this.

### C18b — Plan 02 (architect) split

- **S2A** = plan-doc operator artefact + operator UX (the
  betterado-unblocker).
- **S2B** = bench reground + cross-phase handoff + `benchmarks/_lib/handoff.ts`.

S2A first; S2B informed by what we learn from S2A. Council 02 CEO
escalation option 1.

### C18c — Plan 06 (reflect) split

- **S6A** = lint trigger + retention tagging (curation infra; ACs 1-2).
- **S6B** = slash UX + recap surface (operator-facing; ACs 3-4).

S6A can land independently of S6B; either order acceptable. Council 06
`ceo:01-scope-cohesion`.

### C18d — Plan 07 split into 07a + 07b

- **07a** = logging UX (multi-day, two new deps, bench suite). Ships in
  Stage **S7**.
- **07b** = init-IDs (one-day, zero new deps beyond `proper-lockfile`).
  Ships in Stage **S1.1**.

The plan document `07-general-logging-ids.md` is split into
`07a-logging-ux.md` + `07b-init-ids.md` as part of S0 (this contract
lock). Council 07 `ceo:01-bundled-scope`.

## C19 — Budget mechanisms — remove, don't extend

**Decision:** Refinement scope does NOT add budget mechanisms.
Existing $-based caps are removed. Iteration caps preserved.

Concretely:

| Mechanism | Decision |
|---|---|
| Per-WI $ cap ($1.0 in `developer-loop.ts:42-45`) | **Remove.** Per-WI iteration cap (5) stays. |
| Unifier $ cap ($1.50 in plan 04) | **Never add.** Iteration cap (3) is the only bound. |
| Bench criterion `cost_budget_respected` (0.15) in current dev-loop bench | **Remove.** Re-weight remaining criteria. |
| Bench criterion `cost_within_unifier_budget` (0.10) in plan 04 | **Never add.** Re-weight remaining criteria. |
| Plan 02's `aggregate_budget_declared` (gate) | **Never add.** PLAN.md still surfaces aggregate cost as informational footprint, but no gate, no auto-escalation, no threshold. |
| Plan 02's aggregate-budget auto-escalation (Open Q4) | **Never add.** No `N`. |
| `cost_usd` per-event JSONL logging | **Keep.** This is data, not a budget. |
| `cost_tick` derived consumer (per C14) | **Keep.** This is data, not a gate. |

**Rationale (operator-authored):**

> "We could just remove budgets entirely. I'd rather that than further
> complexity in the budget system given we haven't actually seen
> instances of runaway spend and churn."

Iteration caps already prevent infinite loops. The two real
budget-failure-mode case studies (silent ≈$534 betterado drop, "burned
the budget thrashing" intersection-backpressure cycle) are addressed
upstream by **better PM decomposition** (C5) and the **plan-doc operator
artefact** (S2A) — both surface aggregate cost as visible information,
neither uses a $-threshold gate. The aggregate-footprint line in
PLAN.md is informational only; the operator sees it and decides.

**Affects plans:** 02 (drop `aggregate_budget_declared` from
§"Benchmark regrounding"; downgrade aggregate footprint to
informational; drop Open Q4 entirely); 04 (drop
`cost_within_unifier_budget` from §"Bench redesign"; pull no `$` cap
into unifier; remove "max_cost_usd" from `expected_unifier` JSON
example); 02 (drop §"Risk register" budget mitigation row if any).
Existing per-WI $1.0 cap and `cost_budget_respected` (0.15) bench
criterion both removed as part of S4.

## Quick lookup

For each plan, the C-decisions it must reflect:

| Plan | Affected by |
|---|---|
| 01 | C7, C18a |
| 02 | C4, C10, C10a, C12, C18b, C19 |
| 03 | C3c, C4, C5, C5a, C5b, C10, C11 |
| 04 | C1, C2, C3a, C3b, C3c, C10, C15a, C15b, C19 |
| 05 | C3a, C3c, C6, C16, C16a, C16b, C18d (slash-cmd `argument-hint`) |
| 06 | C7, C8, C9, C15a, C18c |
| 07a / 07b | C6, C13, C14, C17, C18d |

## Change control

This document is frozen for the duration of the 2026-05-20 refinement
batch. If a stage's implementation work surfaces a need to change a C-decision:

1. Stop the stage.
2. Surface the surprise as a brain entry under `brain/forge/themes/`.
3. Reopen this doc + the affected plan(s).
4. Re-confirm with the operator.
5. Resume.

Don't silently adapt a contract during implementation — that's how the
inconsistency catalog grew in the first place.
