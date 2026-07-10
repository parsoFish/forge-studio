# Cost Autopsy — forge betterado roadmap (2026-07-01 → 2026-07-10)

Mechanical derivation from `_logs/*/events.jsonl`. Every number below is
computed by a script against raw event data; scripts and intermediate
outputs live alongside this report in the scratchpad. No number in this
report is an estimate unless explicitly labeled "estimate" or "theme-cited".

Deliverables:
- This report: `/tmp/claude-1000/-home-parso-forge/29cfec14-7c52-4a4d-b8b0-b4e040409bed/scratchpad/cost-autopsy.md`
- Raw per-cycle ledger: `/tmp/claude-1000/-home-parso-forge/29cfec14-7c52-4a4d-b8b0-b4e040409bed/scratchpad/cost-ledger.csv` (26 rows: 24 roadmap cycles + architect row + header)

---

## 0. Methodology — the double-counting trap, verified

### 0.1 The rule

`cost_usd` is populated on **multiple event types**, and naively summing
every row double- (or triple-) counts. Verified by inspecting
`event_type` distributions on `serviceendpoint`, `git`, and `taskagent`:

- **Phases that run in an iteration loop** (`developer-loop`,
  `unifier`): each iteration emits its own `iteration`-type event
  carrying that iteration's `cost_usd`. The phase **also** emits a
  final `end`-type event whose `cost_usd` **restates the iteration
  sum** (a rollup, not additional spend). Developer-loop additionally
  emits **one `end` event per work item** (`metadata.work_item_id`
  present) *and* one phase-level rollup `end` event
  (`work_item_id` absent) whose cost again restates the per-WI sum.
  So there are **three** overlapping places cost appears for these
  phases: per-iteration, per-WI-end, and phase-rollup-end.
- **Phases with no iteration loop** (`project-manager`, `architect`,
  `review-loop`, `closure`, `release-finalize`, `reflection`,
  `orchestrator`): cost lands only on `end` (and, as found in §4.1
  below, sometimes on a terminal `error` event when the phase is
  rejected before completing).

**Correct rule** (matches `cli/metrics.ts::aggregate()`, lines 103-116):
for each phase, if it has ≥1 `iteration` event, sum **only**
`iteration`-type `cost_usd`; otherwise sum **all** events' `cost_usd`
(so a terminal `error` event's cost is captured for non-looping
phases — this matters, see §4.1).

### 0.2 Verified against the task's reference numbers

For `migrate-framework-serviceendpoint`:
- All-rows-summed (naive): **$205.xx** — confirms the task's ~$205 reference.
- End-events-only (task's suggested check): **$132.63** — confirmed exactly.
- **Correct rule (iteration-or-all, phase-aware): $79.90.**

The end-events-only number is *itself still an overcount* relative to
the correct rule, because developer-loop's phase-rollup `end` event
restates the per-WI `end` sum (both counted → 2x on top of the
iteration-vs-end duplication already present). This is a **deeper
trap than the one named in the task brief** — "sum only `end` events"
is not safe either.

### 0.3 Cross-check against canonical tooling

- **`cli/metrics.ts::aggregate()`** (`total_cost_usd`, `per_phase`):
  ran the real function directly (`node --experimental-strip-types`)
  against `serviceendpoint`. Output: `total_cost_usd = 79.90`,
  matching my independently-coded rule exactly. **This part of the
  canonical tool is correct.**
- **`cli/metrics.ts` `per_skill[skill].cost_usd`** (line ~120): sums
  `cost_usd` across **all** events for that skill unconditionally —
  **this field is buggy**. For `serviceendpoint` it reports
  `developer-ralph` cost inflated ~3x and `developer-unifier` ~2x
  versus the correct per-phase figures. Anything reading `per_skill`
  (rather than `per_phase`) from this tool is getting wrong numbers.
- **`orchestrator/run-model-derive.ts::buildNodeMeta()` (~line 145)**:
  `events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0)` — same bug
  shape as `per_skill`, confirmed by manual arithmetic cross-check
  against the validated per-phase totals. **This is the function that
  feeds Studio's phase-hex cost badges** (`data-phase-cost-usd` in
  `forge-ui`), so **the cost shown live in Studio for
  developer-loop/unifier phase hexes is inflated 2-3x** versus the
  true spend. This is a real, load-bearing forge defect independent
  of this audit's own totals (which use the correct rule throughout).

### 0.4 A gap this audit found beyond the brief

Architect-phase `cost_usd` is **0 on every single `end` event**,
across all 24 roadmap cycles and the standalone
`_architect-2026-07-01T08-18-02` authoring session. Architect/interview
LLM spend is **never logged** by forge. Every total in this report
therefore **systematically excludes true architect cost** — it is not
zero, it is simply not captured anywhere in `_logs`. This is a
pre-existing instrumentation gap, not a computation artifact of this
audit.

### 0.5 A second methodological gap found while re-deriving waste (§4)

The "pass count" per phase (used for the first-pass/rework split in
Task 1) is defined as the number of non-per-WI `end` events for that
phase. This **undercounts** true retries when an earlier attempt is
terminated by an `error` event rather than an `end` event — concretely,
when the orchestrator's hidden-coupling gate **rejects** a
project-manager decomposition, that failed attempt shows up as an
`error` event, not an `end` event, so it doesn't register as a second
"pass" even though its cost is (correctly) included in the phase
total. Confirmed on two cycles (`git`, `graph-identity` — see §4.1).
The dollar totals are unaffected (the correct-rule sum already
captures `error`-event cost for non-looping phases per §0.1); only the
pass-count / rework-split *columns* in the ledger undercount PM-phase
retries specifically. Task 4's PM-waste table below uses a
start-event-boundary re-derivation that does not have this blind spot.

---

## 1. Task 1 — Per-cycle roadmap ledger (24 initiatives)

Full detail (including all 9 phases' cost+passes) is in
`cost-ledger.csv`. Selected columns below, sorted by total cost
descending. "Rework" = cost after that phase's first non-per-WI `end`
event (see §0.5 caveat for PM specifically — treat PM rework % here as
a lower bound).

| Initiative | Total | First-pass | Rework | Rework % | Wall-clock span |
|---|---:|---:|---:|---:|---|
| migrate-framework-taskagent | $92.26 | $50.65 | $41.61 | 45.1% | 07-01 → 07-05 |
| migrate-framework-core | $85.88 | $21.04 | $64.84 | 75.5% | 07-01 → 07-05 |
| migrate-framework-graph-identity | $79.91 | $44.86 | $35.05 | 43.9% | 07-01 → 07-03 |
| migrate-framework-serviceendpoint | $79.90 | $46.07 | $33.83 | 42.3% | 07-01 → 07-03 |
| migrate-framework-workitemtrackingprocess | $71.50 | $19.31 | $52.19 | 73.0% | 07-01 → 07-05 |
| migrate-framework-policy-branch | $71.08 | $49.78 | $21.30 | 30.0% | 07-01 → 07-04 |
| migrate-framework-security-permissions | $62.13 | $34.95 | $27.18 | 43.8% | 07-01 → 07-04 |
| migrate-framework-workitemtracking | $59.98 | $46.57 | $13.41 | 22.4% | 07-01 → 07-04 |
| migrate-framework-git | $54.49 | $30.30 | $24.19 | 44.4% | 07-01 → 07-03 |
| migrate-framework-feed | $53.15 | $36.49 | $16.66 | 31.3% | 07-01 → 07-03 |
| new-api-pipelines-v2 | $51.94 | $35.03 | $16.91 | 32.6% | 07-01 → 07-04 |
| migrate-framework-dashboard-extension | $42.87 | $19.39 | $23.48 | 54.8% | 07-01 → 07-03 |
| migrate-framework-build | $40.03 | $21.87 | $18.16 | 45.4% | 07-01 → 07-03 |
| mux-free-cutover | $37.70 | $37.70 | $0.00 | 0.0% | 07-05 → 07-09 |
| new-api-test | $35.40 | $3.44 | $31.96 | 90.3% | 07-01 → 07-04 |
| new-api-accounts-profile | $35.25 | $5.63 | $29.62 | 84.0% | 07-01 → 07-04 |
| migrate-framework-release-folder-permissions | $35.00 | $7.85 | $27.15 | 77.6% | 07-01 → 07-02 |
| migrate-framework-wiki | $28.73 | $25.35 | $3.38 | 11.8% | 07-01 → 07-03 |
| new-api-notification | $27.16 | $14.07 | $13.09 | 48.2% | 07-01 → 07-04 |
| migrate-framework-servicehook | $26.10 | $15.73 | $10.37 | 39.7% | 07-01 → 07-03 |
| migrate-framework-member-entitlement | $22.25 | $16.77 | $5.48 | 24.6% | 07-01 → 07-03 |
| new-api-gallery-extensionmanagement | $14.31 | $8.34 | $5.97 | 41.7% | 07-01 → 07-05 |
| new-api-pipelinesapproval | $13.86 | $11.76 | $2.10 | 15.2% | 07-03 → 07-05 |
| new-api-featuremanagement | $13.69 | $13.69 | $0.00 | 0.0% | 07-01 → 07-03 |
| **_architect-2026-07-01T08-18-02** (roadmap authoring) | **$0.00** | — | — | — | 07-01 08:18→08:39 |

The architect authoring session (25th row, per the task's instruction)
carries **$0.00 logged cost** — consistent with §0.4: architect
`cost_usd` is never populated, so even the session that drafted the
entire 24-initiative roadmap shows zero direct spend in the event log.
Real cost was incurred; it is simply unrecorded.

---

## 2. Task 2 — Roadmap totals

```
N = 24 cycles
TOTAL   = $1,134.57
MEDIAN  = $41.45
MEAN    = $47.27
MIN     = $13.69  (new-api-featuremanagement)
MAX     = $92.26  (migrate-framework-taskagent)
```

### Top 5 most expensive, one-line cause each

1. **migrate-framework-taskagent — $92.26.** Dev-loop dominates
   ($77.03 of $92.26, 6 passes, 44.8% dev-loop rework) — the single
   largest raw dev-loop spend in the roadmap; one PM attempt was
   rejected/retried ($4.65 PM total, partial waste).
2. **migrate-framework-core — $85.88.** Unifier-driven: $64.18 of
   $85.88 sits in the unifier phase across 7 passes and 52 unifier
   `start` events, including a 38-event tight crash-loop burst
   (confirmed $0 direct cost on the burst itself — see §4.2). Dev-loop
   itself was cheap and clean ($17.86, 26 tiny passes, 0% rework),
   consistent with PM feeding small incremental batches. This is the
   most unifier-expensive cycle in the roadmap.
3. **migrate-framework-graph-identity — $79.91.** PM ran 3 attempts
   before landing a valid decomposition ($4.01 total PM cost, $2.52 of
   it wasted on 2 rejected/error-terminated attempts — brain theme
   `2026-07-01-pm-empty-decomposition-large-initiative.md`), plus
   27.5% dev-loop rework on top.
4. **migrate-framework-serviceendpoint — $79.90.** Dead SDKv2 helper
   functions (`findServiceEndpointByName`, `validateScopeLevel` caught
   by `go build`; `validateServiceEndpoint`,
   `dataSourceGenBaseSchema`, `dataSourceGetBaseServiceEndpoint` caught
   by golangci-lint) forced a full second dev-loop pass across all 10
   WIs — brain theme
   `2026-07-03-unifier-go-build-catches-dead-sdkv2-helpers.md`; dev
   rework is exactly $10.76 of the phase's $52.73.
5. **migrate-framework-workitemtrackingprocess — $71.50.** Dev-loop
   itself carries 70.6% rework (highest dev-loop rework % of the top
   5) — the dominant driver is repeated dev-loop iteration, not PM or
   unifier overhead.

---

## 3. Task 3 — Blended reconciliation vs REFINEMENT-PLAN §1's "$926 / 53 initiatives / 44 merged"

Computed by streaming all `_logs/*/events.jsonl` (139 dirs total; 137
carry an events.jsonl, 2 do not), attributing each dir to a project via
`_queue/{done,_archived,pending,failed,in-flight,ready-for-review}/*.md`
frontmatter plus name-based heuristics for dirs absent from queue
manifests.

| Scope | Method | Dirs | Unique initiatives | Total $ |
|---|---|---:|---:|---:|
| All `_logs` (everything, all projects) | correct rule | 137 | — | **$1,470.68** |
| All `_logs` | naive all-rows | 137 | — | $3,364.00 |
| All `_logs` | end-events-only | 137 | — | $1,907.95 |
| betterado only, all-time (through 07-10) | correct rule | 80 | 60 | $1,431.36 |
| betterado only, all-time | naive all-rows | 80 | 60 | $3,289.10 |
| **betterado only, as-of 07-04 cutoff** | **correct rule** | **74** | **54** | **$1,115.85** |
| betterado only, post-07-04 (new spend since the plan doc) | correct rule | 6 | — | $315.51 |

**Reconciliation:** REFINEMENT-PLAN §1 states betterado ≈ $926 across
53 initiatives (44 merged), as of 07-04. This audit's as-of-07-04,
betterado-scoped, correct-rule total is **$1,115.85 across 54 unique
initiatives** — the initiative count matches almost exactly (54 vs 53),
but the dollar figure is **+20.5% ($189.85) higher** than the plan's
figure.

**Does the plan's method double-count?** No evidence that it does — if
anything the opposite: $926 is *lower* than my correct-rule number,
whereas double-counting would push a total *up* (both the naive and
end-only comparison methods above land well above $926, at $3,289 and
presumably a similarly-inflated end-only betterado subtotal). The most
plausible explanation, not independently confirmed from event data
alone: **the plan's $926 scopes to the 44 *merged* initiatives**, not
all 53/54 *attempted* ones — cost from initiatives that were run but
not yet merged (still building, sent back, or abandoned) as of 07-04
would be excluded from a "$926 across 53 (44 merged)" framing if $926
itself was computed only over the merged subset while the "53" count
was reported for context. This audit did not have per-initiative
merge-status timestamps in scope to verify this exactly; it is offered
as the most consistent explanation for a real, unspeculative gap
between the two numbers, not a confirmed root cause.

**Spot-check note:** the plan also cites `serviceendpoint` at "$59.76."
This audit's validated (cross-checked against live `cli/metrics.ts`)
figure for the same cycle is **$79.90**. No combination of phase
subtractions from the validated total lands on $59.76 exactly, so this
is flagged as an **open, unresolved discrepancy** — likely a stale
snapshot or a differently-scoped manual estimate in the original doc —
rather than evidence of a flaw in this audit's method (which is
independently validated against the live tool, §0.3).

---

## 4. Task 4 — Waste re-tally

### 4.1 PM wasted-attempt cost (re-derived precisely; corrects §1's "5 themes, ~$7–10")

Method: bucket each cycle's `project-manager`-phase events into
"attempts" bounded by `start` events; an attempt's cost is real
whether it terminates in `end` (accepted) or `error` (rejected by the
orchestrator's hidden-coupling/decomposition gate). "Waste" = sum of
all but the *last* (accepted) attempt, per cycle.

```
TOTAL PM cost, all 24 cycles: $67.92
TOTAL PM waste (rejected/non-final attempts): $30.30
Cycles affected: 16 of 24 (67%)
```

Top wasted-attempt cycles:

| Initiative | Attempts | PM waste | Detail |
|---|---:|---:|---|
| new-api-gallery-extensionmanagement | 5 | $3.30 | 3 rejected attempts (2 error, 1 zero-cost) before landing |
| migrate-framework-dashboard-extension | 3 | $3.10 | 1 rejected + 1 accepted-but-superseded |
| migrate-framework-feed | 3 | $2.92 | 2 rejected attempts |
| migrate-framework-taskagent | 4 | $2.92 | 1 rejected + 1 zero-cost + 1 rejected |
| migrate-framework-servicehook | 4 | $2.59 | 2 rejected + 1 zero-cost |
| migrate-framework-graph-identity | 3 | $2.52 | 2 rejected attempts (theme-documented) |
| migrate-framework-workitemtracking | 3 | $2.33 | 2 rejected attempts |
| migrate-framework-member-entitlement | 4 | $2.06 | 2 rejected + 1 zero-cost |
| migrate-framework-git | 2 | $0.91 | hidden-coupling gate rejection, theme-documented |

**Correction of §1:** the plan's PM-waste table cites 4 dollar figures
totaling ~$6.65 ("$1.45 + $0.89 + $1.11 + $3.20") across "5 themes,"
estimated at ~$7–10. The precise re-derivation above finds PM-waste in
**16 of 24 cycles**, totaling **$30.30** — roughly **3–4x** the plan's
estimate. Two spot-checks against theme docs:

- `migrate-framework-git`: theme
  `2026-07-03-pm-hidden-coupling-gate-forces-serial-chain.md` describes
  the rejection but states "PM cost doubled (~$2 → ~$4 for the full PM
  phase)." The precise event-log figure is: rejected attempt $0.91 +
  accepted attempt $1.11 = **$2.02 total**, not ~$4 — the theme
  overstated this specific instance's cost by roughly 2x.
- `migrate-framework-graph-identity`: theme
  `2026-07-01-pm-empty-decomposition-large-initiative.md` estimates
  "two wasted PM runs ~$4 total (at $2/run typical cost)." The precise
  figure is **$4.01 total PM cost across 3 attempts, $2.52 wasted** —
  the theme's *total* estimate is a good match, but it undercounts the
  attempt count (3, not 2) and conflates "total PM cost" with "wasted
  cost" (only $2.52, not the full $4.01, was actually wasted).

### 4.2 Unifier restart loops (corrects §1's "16-restart loops, ~$16–32, 2 occurrences")

Method: detect tight bursts of consecutive `unifier`-phase `start`
events (`metadata.resumed: true`), each followed by an `error` event
with `message: 'unifier.failed'` /
`failure_class: 'dev-loop-unifier-crashed'` (crash-before-first-tool —
`tool_use_count: 0`). Checked `cost_usd` on every event inside each
burst window.

| Initiative | Unifier starts | Longest tight burst | Burst span | **Burst-window direct cost** | Cycle's total unifier cost |
|---|---:|---:|---:|---:|---:|
| migrate-framework-core | 52 | 38 | 1.43 hr | **$0.00** | $64.18 |
| migrate-framework-security-permissions | 48 | 36 | 1.32 hr | **$0.00** | $30.63 |
| migrate-framework-policy-branch | 46 | 38 | 1.47 hr | **$0.00** | $25.90 |
| migrate-framework-workitemtracking | 42 | 36 | 1.31 hr | **$0.00** | $17.21 |
| new-api-notification | 42 | 34 | 1.24 hr | **$0.00** | $9.65 |
| new-api-pipelines-v2 | 40 | 34 | 1.24 hr | **$0.00** | $21.55 |
| migrate-framework-git (separate 15-fire branches-not-in-sync loop) | — | 15 fires | ~45 min | **$0.00** | $25.28 |

Exhaustive inspection of one full burst window (11,758 events,
`policy-branch`): event-type counts were
`agent_heartbeat: 11487, log: 186, start: 38, tool_use: 29, error: 18`
— **zero events with nonzero `cost_usd`** anywhere in the burst.
Crash-before-first-tool means no model call is billed.

**Correction of §1:** the plan cites this pattern at "2 themes,
~$8–16 each (~$16–32 total)." Mechanically, this crash-loop signature
(≥30-event tight burst of resumed unifier starts, each ending in a
zero-tool-use crash) appears in **at least 6 roadmap cycles**, not 2 —
**3x the claimed occurrence count** — but the direct dollar cost of
the burst windows themselves is **$0.00 in every case checked**, not
$8–16/occurrence. The plan's per-occurrence dollar estimate appears to
conflate the *cycle's total unifier cost* (which is real and often
large — e.g. core's $64.18) with the *cost of the crash-loop burst
specifically* (which is $0). The wall-clock/operator-attention cost of
these loops is real (documented separately in
`2026-07-03-unifier-branches-not-in-sync-concurrent-merge.md`: "15
fires × ~3 min = ~45 minutes of wall-clock waste" for the git cycle)
but that is **not an LLM-spend dollar figure** and should not be
reported as one.

### 4.3 Dead-SDKv2-files recurrence (partial verification of §1's "7 consecutive cycles, ~$25–35")

One instance precisely confirmed: `migrate-framework-serviceendpoint`
— dev-loop rework of exactly **$10.76** (20.4% of $52.73 dev-loop
cost), matching the theme narrative
(`2026-07-03-unifier-go-build-catches-dead-sdkv2-helpers.md`) of a
forced full second dev-loop pass across all 10 WIs.

Searching all 28 `2026-07-0*` theme files for SDKv2/dead-file content
found only this single roadmap-window instance with a clear "dead
SDKv2 helper functions" narrative matching §1's description; no
theme-doc evidence was found in this corpus for 6 further instances.
**This audit can confirm 1 of the claimed 7 instances precisely
($10.76) and cannot independently verify the other 6 within the
available theme-doc citations** — either they weren't written up as
distinct brain themes, or (consistent with the pattern found in §4.1
and §4.2) the claimed occurrence count in §1 is itself an
overstatement. Reported honestly as unverified rather than assumed.

### 4.4 Re-derivation / dev-loop rework (broad measure vs §1's narrow "~10–15% of dev spend")

```
DEV-LOOP ONLY across all 24 cycles: total = $636.86, rework = $197.98, rework % = 31.1%
```

One theme-cited instance confirmed precisely:
`migrate-framework-release-folder-permissions` —
`2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas.md`
cites "5 iterations, ~$3.8" of duplicate-resource-type re-derivation
cost, against a cycle whose dev-loop total is $29.46 with **87.1%
rework** ($25.66) — the cited $3.8 is a small slice of a much larger
rework total for this specific cycle (whose dev-loop was effectively
discarded and rerun almost entirely, per the theme's own account: "the
entire first dev-loop run was discarded").

This 31.1% figure is **not a clean apples-to-apples comparison** with
§1's "~10-15% of dev spend" claim: this audit's number is *all*
post-first-completion dev-loop cost (re-derivation of known gotchas,
gate-failure fix rounds, dead-file cleanup, everything), a strict
superset of "re-derivation of already-known brain constraints"
specifically. §1's narrower claim cannot be isolated from cost data
alone — the event schema does not tag *why* a given dev-loop iteration
happened. Directionally, 31.1% (broad) being roughly 2-3x §1's 10-15%
(narrow) is consistent with re-derivation being one contributing
subset of a larger rework bucket, not a contradiction.

### 4.5 Evidence-fabrication arms race — not independently quantifiable

§1 cites this class as "multi-$ rework rounds" sourced from the
friction log, not from a specific dollar figure. The event schema has
no field distinguishing "iteration N re-did work because of
fabricated evidence" from any other iteration. This audit **cannot
quantify this class from cost-event data alone** and reports it as
unquantifiable rather than guessing a number.

### 4.6 Corrected waste total

Two lenses, deliberately not summed into one number because they
measure different things:

- **Narrow/conservative** (PM wasted attempts + dev-loop
  post-first-pass rework, which subsumes the one confirmed
  dead-SDKv2 instance — §4.1 + §4.4, not double-counted):
  **$30.30 + $197.98 = $228.28**, or **20.1% of the $1,134.57 roadmap
  total.**
- **Broad** (all-phase, any cost after that phase's first completion,
  from the Task 1 ledger's `rework_cost_usd` column, summed across all
  24 cycles — includes legitimate multi-round unifier gate-fix work,
  not just avoidable waste): **$517.93**, or **45.7%** of roadmap
  total.

Unifier crash-loop bursts contribute **$0** to either dollar figure
(§4.2) — their cost is wall-clock/operator-attention, not LLM spend,
and is excluded from both totals above to avoid inventing a number
where the event log shows none.

### 4.7 Summary: §1 claims this audit contradicts

| §1 claim | This audit's finding | Direction |
|---|---|---|
| PM waste: 5 themes, ~$7–10 | 16 of 24 cycles, $30.30 | **Undercounted ~3–4x** |
| Unifier restart loops: 2 occurrences, ~$16–32 total | ≥6 cycles show the pattern; **$0** direct cost per occurrence | **Occurrence count undercounted 3x; dollar cost overstated (should be ~$0, not $16-32)** |
| Dead-SDKv2 files: 7 consecutive cycles, ~$25–35 | 1 of 7 confirmed at $10.76; 6 unverifiable from theme corpus | **Not independently confirmable; partial match only** |
| Re-derivation: ~10–15% of dev spend | 31.1% dev-loop-wide rework (broader definition, not directly comparable) | **Directionally consistent, narrower claim not isolable from cost data** |
| serviceendpoint: "$59.76" | Validated at $79.90 (cross-checked live against `cli/metrics.ts`) | **Contradicted, unresolved** |
| Betterado total: ≈$926 (53 init., 44 merged), as of 07-04 | $1,115.85 across 54 initiatives, as of 07-04 | **+20.5% higher; initiative count matches closely** |

---

## 5. Task 5 — Cost over time (merge order = last event timestamp)

| Last-event (UTC) | Initiative | Total | Rework % |
|---|---|---:|---:|
| 07-02 07:18 | release-folder-permissions | $35.00 | 78% |
| 07-03 04:27 | build | $40.03 | 45% |
| 07-03 04:57 | member-entitlement | $22.25 | 25% |
| 07-03 08:32 | dashboard-extension | $42.87 | 55% |
| 07-03 09:13 | featuremanagement | $13.69 | 0% |
| 07-03 10:19 | git | $54.49 | 44% |
| 07-03 10:51 | servicehook | $26.10 | 40% |
| 07-03 11:12 | wiki | $28.73 | 12% |
| 07-03 11:49 | serviceendpoint | $79.90 | 42% |
| 07-03 11:54 | feed | $53.15 | 31% |
| 07-03 14:43 | graph-identity | $79.91 | 44% |
| 07-04 01:09 | policy-branch | $71.08 | 30% |
| 07-04 01:09 | security-permissions | $62.13 | 44% |
| 07-04 01:09 | workitemtracking | $59.98 | 22% |
| 07-04 01:09 | pipelines-v2 | $51.94 | 33% |
| 07-04 01:09 | test | $35.40 | 90% |
| 07-04 01:09 | accounts-profile | $35.25 | 84% |
| 07-04 01:09 | notification | $27.16 | 48% |
| 07-05 03:11 | pipelinesapproval | $13.86 | 15% |
| 07-05 03:15 | gallery-extensionmanagement | $14.31 | 42% |
| 07-05 03:23 | core | $85.88 | 75% |
| 07-05 03:45 | workitemtrackingprocess | $71.50 | 73% |
| 07-05 03:49 | taskagent | $92.26 | 45% |
| 07-09 22:07 | mux-free-cutover | $37.70 | 0% |

**Data-quality caveat:** 7 cycles (policy-branch through notification)
share the **exact same** `max_ts` of `2026-07-04T01:09:49.838Z` — too
precise to be organic simultaneous completion. This looks like a
batch scheduler/reconcile touch (e.g., a boot-reconcile sweep) stamping
a shared final event across multiple cycles at once, not their true
last-real-work time. Their relative order among themselves in the
table above is not meaningful; the cluster's position relative to
cycles before/after it is.

**Trend verdict: mixed, not a clean downward trend.** The data does
**not** support a clean "cost/rework fell as run-fixes landed"
narrative. The final wave to complete (core, workitemtrackingprocess,
taskagent — all last-event 07-05) contains **3 of the roadmap's 5 most
expensive cycles and 2 of its 3 highest-rework-% cycles** (75% and
73%), i.e. the tail end is *worse*, not better, than the early batch.
The one clear positive data point is `mux-free-cutover`
(07-05 → 07-09): $37.70, single-pass, **0% rework** — the cleanest
cycle in the entire roadmap. But it is N=1, ran four days later and
detached from the main batch (consistent with REFINEMENT-PLAN's own
Phase-0 plan to hold it separately), and cannot be generalized into "the
fixes worked." Taken as a whole, mechanically-measured rework% across
the roadmap is noisy and initiative-dependent (0% to 90%) with no
visible correlation to completion time; the operator-run-gate and
demo-contract fixes referenced as landing "~07-04" do not show up as a
step-change in the cost/rework data before vs. after that date.

---

## Appendix: files

- Report: `cost-autopsy.md` (this file)
- Ledger: `cost-ledger.csv`
- Supporting scripts/intermediate data (scratchpad, not deliverables):
  `analyze_ledger.py`, `build_csv.py`, `run_metrics.mjs`, `reconcile.py`,
  `burst_detect.py`, `ledger.json`, `reconcile_summary.json`,
  `final_ledger_summary.txt`, `pm_waste_check.txt`,
  `crashloop_cost_check.txt`, `crashloop_cost_check2.txt`,
  `git_pm_all.txt`, `burst_detect_out.txt`
