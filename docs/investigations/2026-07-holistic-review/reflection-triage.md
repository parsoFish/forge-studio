# Reflection question backlog — triage report

Generated 2026-07-10. Scope: 42 `_logs/*/user-questions.json` files (41 non-empty,
166 question entries — 164 real questions + 2 pseudo-question parse artifacts) +
a from-scratch Step-5 diff of `_queue/done/` vs `brain/cycles/_raw/` (10
completed-but-never-reflected cycles).

**No reflector rerun was triggered at any point during this task.** Only
`_logs/<cycleId>/user-feedback.md` files were written (33 new files, per Step 4),
plus this scratchpad report. `_logs/` is gitignored.

**Headline counts**
- 41 cycles with pending questions → **33 got new answer files written today**
  (99 questions artifact-answered with evidence citations, 35 skipped as
  operator-genuine — of which 2 are pseudo-questions, see §6), and **8 were
  found ALREADY answered on disk** by genuine operator feedback that a buggy
  rerun never consumed (untouched — see §5).
- **41 cycles are ready for a reflector rerun** (33 + 8).
- **10 done-initiatives have no reflection archive at all** (§2) — they need a
  fresh reflector run, not a feedback rerun.

---

## 1. Answer-path mechanics (verified from source, not inferred)

**Where the reflector writes questions:** `orchestrator/phases/reflector.ts` —
Stage 2 of the one-shot reflector agent writes `_logs/<cycleId>/user-questions.md`
(free text, up to 4 `## `-headed questions), then the orchestrator's
`deriveUserQuestionsJson(mdPath, jsonPath)` parses it into the structured
`_logs/<cycleId>/user-questions.json`:
`Array<{ question: string; header: string; options: Array<{label, description}> }>`.

**Where the reflector reads answers:** `orchestrator/reflector-invocation.ts` —
Stage 3 reads `_logs/<cycleId>/user-feedback.md` (pre-populated by the operator)
via `userFeedbackRelPath` in the prompt input. This is decision D5: file-based
Q&A handoff, no live interactivity.

**The exact answer-file format** (confirmed from `cli/ui-bridge.ts`, the
`POST /api/reflect/<cycleId>/answer` handler — this is the format the real
Studio UI writes, so it is the authoritative target format):

```
# Reflection feedback — <cycleId>

## Answers to numbered questions

### <verbatim question text>

<answer text>

### <verbatim question text 2>

_(skipped)_

## Free-form feedback

<freeform text or _(none)_>
```

The `###` heading is the **verbatim question text** (not the header, not a
paraphrase) — including any embedded newlines/"Options:" paragraphs, since the
bridge builds it as `### ${a.question}` with no sanitisation. `<cycleId>` is the
**timestamped log-dir basename** (e.g.
`2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources`).

For this task's writes: artifact-answerable questions got a real cited answer
(friction-doc section, retro/recap quote, brain theme, commit sha, or repo
grep); operator-genuine questions got exactly
`_(skipped — operator input required)_` so each file is one complete, honest
record. Nothing was fabricated to avoid a skip.

**The re-run trigger — three independent paths**, all reaching
`orchestrator/forge-reflect-rerun.ts::rerunReflector({cycleId, logsRoot?, queueRoot?})`
(resolves the manifest across `_queue/{done,ready-for-review,in-flight,failed}/<id>.md`
for both the raw cycleId and the recovered initiativeId):

1. **Bridge POST** `POST /api/reflect/<cycleId>/answer` — writes
   `user-feedback.md` from the request body (would overwrite this task's files
   — do NOT use it for these cycles unless resubmitting the same content),
   then fires `rerunReflector` detached. No age restriction.
2. **Direct invocation** — import and call `rerunReflector({cycleId})`. Reads
   whatever `user-feedback.md` already contains. No age restriction.
3. **Boot-time reconcile** (`cli/reflect-reconcile.ts`, runs at `forge studio`
   bridge startup unless `FORGE_ARCHITECT_NO_SPAWN=1`) — auto-reruns any cycle
   whose `user-feedback.md` mtime is strictly newer than its last
   `reflector.end` event, **within a 7-day window**
   (`RECONCILE_MAX_AGE_MS = 7*24*60*60*1000`).

There is **no standalone CLI command** (`forge reflect --rerun` was retired in
the Model-B consolidation); the bridge and the direct call are the only
triggers besides boot reconcile.

### Re-run recipe

**The 33 newly-answered cycles**: their feedback mtime is today → all qualify
for boot reconcile. **A single `forge studio` restart will automatically rerun
all 33.** Operational warning: that is ~33 paid reflector invocations
(~$0.5–1.5 each, so plausibly $20–50 total) kicked off by one restart, each
writing brain themes — restart deliberately, not casually. To do them
selectively instead, use the direct call per cycle:

```bash
node --experimental-strip-types -e '
import("/home/parso/forge/orchestrator/forge-reflect-rerun.ts").then(({rerunReflector}) =>
  rerunReflector({ cycleId: "<timestamped-cycle-dir-basename>" })
)'
```

**The 8 already-answered anomaly cycles (§5)**: boot reconcile will NOT pick
them up — their feedback mtimes are June/early-July (outside the 7-day window,
and in most cases older than the last `reflector.end` anyway). Either run the
direct call above per cycle, or `touch _logs/<dir>/user-feedback.md` first to
pull them into the reconcile window. Their on-disk answers are genuine operator
input — the rerun will finally consume them properly.

**The 10 unreflected cycles (§2)**: 9 have no feedback file, so reconcile
ignores them — use the direct call (it works fine for a first run; it just
invokes `runReflector` against the done-manifest). The 10th
(artifact-trigger-enhancements) got answers today and reruns with the 33.

Run reruns sequentially, not in parallel — each writes to shared brain files.

---

## 2. Cycles done but with NO reflection archive at all (Step 5, re-derived fresh)

Diffed `_queue/done/*.md` (55 initiative ids) against `brain/cycles/_raw/*`
(66 archives): **10 done initiatives have no archive.** Root causes from each
cycle's own `events.jsonl`:

| # | Initiative | Root cause | Evidence |
|---|---|---|---|
| 1 | `INIT-2026-06-05-environment-templates-spike` | Never invoked — no `reflector.start` at all | `_logs/2026-06-06T06-11-08_.../events.jsonl` |
| 2 | `INIT-2026-06-08-release-definition-artifact-trigger-enhancements` | Budget-exhausted partial — `reflector.end` with `result_subtype: error_max_budget_usd`; retro.md + 1 theme written (`retroWrites:1, themeWrites:1`) but never archived. Also in the Q&A backlog (answers written today). | `_logs/2026-06-08T11-54-58_.../events.jsonl` |
| 3 | `INIT-2026-06-17-release-definition-coverage-gaps` | Never invoked | `_logs/2026-06-18T07-53-10_.../events.jsonl` |
| 4 | `INIT-2026-06-17-release-definition-permissions-coverage` | Never invoked | `_logs/2026-06-18T10-27-18_.../events.jsonl` |
| 5 | `INIT-2026-06-17-release-folder-coverage` | Never invoked | `_logs/2026-06-18T09-50-09_.../events.jsonl` |
| 6 | `INIT-2026-06-17-release-stages-array-refactor` | Never invoked | `_logs/*release-stages-array-refactor/events.jsonl` |
| 7 | `INIT-2026-06-17-task-group-coverage` | Never invoked | `_logs/*task-group-coverage/events.jsonl` |
| 8 | `INIT-2026-06-21-gitpulse-code-churn` | Orphaned — `reflector.start` right after `closure.end`, then nothing (no end/crashed; likely killed by a Studio restart) | `_logs/2026-06-21T02-08-23_.../events.jsonl` |
| 9 | `INIT-2026-07-01-new-api-pipelines-v2` | Budget-exhausted phantom output — `reflector.end` `error_max_budget_usd`; `output_refs` claims retro.md but `retroWrites:0, themeWrites:0` and no retro.md on disk (forge defect: output_refs ≠ persisted). `user-questions.json` is `[]`. | `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelines-v2/events.jsonl` |
| 10 | `INIT-2026-07-01-new-api-test` | Hard crash — `reflector.crashed`, "Claude Code process exited with code 1" | `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-test/events.jsonl` |

---

## 3. Per-cycle Q&A triage table

Legend: **A** = artifact-answered (written today with citation), **G** =
operator-genuine (skipped in file, listed in §4). Status WROTE = new
`user-feedback.md` written today; PRE-ANS = already-answered-on-disk anomaly
(§5, untouched).

| Cycle (log-dir basename) | Qs | A | G | Status |
|---|---|---|---|---|
| 2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources | 4 | — | — | PRE-ANS |
| 2026-06-06T05-30-11_INIT-2026-06-05-release-definition-permissions | 4 | — | — | PRE-ANS |
| 2026-06-06T09-32-34_INIT-2026-06-06-shared-acceptance-fixture | 4 | — | — | PRE-ANS |
| 2026-06-07T03-20-11_INIT-2026-06-07-release-folder-data-source | 4 | — | — | PRE-ANS |
| 2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit | 4 | — | — | PRE-ANS |
| 2026-06-08T11-43-56_INIT-2026-06-08-release-data-sources-completion | 4 | 4 | 0 | WROTE |
| 2026-06-08T11-43-56_INIT-2026-06-08-release-definition-approval-options-gates-comple | 4 | 4 | 0 | WROTE |
| 2026-06-08T11-54-58_INIT-2026-06-08-release-definition-artifact-trigger-enhancements | 4 | 4 | 0 | WROTE (also §2 #2) |
| 2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface | 4 | 4 | 0 | WROTE |
| 2026-06-12T12-19-27_INIT-2026-06-08-release-acceptance-test-fixes | 4 | 4 | 0 | WROTE |
| 2026-06-16T10-06-57_INIT-2026-06-16-task-group-acceptance-and-data-source | 4 | 4 | 0 | WROTE |
| 2026-06-19T06-29-05_INIT-2026-06-19-framework-mux-entrypoint | 4 | 3 | 1 | WROTE |
| 2026-06-19T23-10-22_INIT-2026-06-19-framework-release-definition | 4 | 3 | 1 | WROTE |
| 2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group | 4 | — | — | PRE-ANS |
| 2026-06-20T04-10-33_INIT-2026-06-19-framework-state-upgraders | 4 | 3 | 1 | WROTE |
| 2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples | 4 | 3 | 1 | WROTE |
| 2026-06-21T04-52-20_INIT-2026-06-21-ownership-hotspots-top-flag (gitpulse) | 4 | 2 | 2 | WROTE |
| 2026-06-21T08-01-50_INIT-2026-06-21-json-output-flag (gitpulse) | 4 | 2 | 2 | WROTE |
| 2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta (gitpulse) | 4 | — | — | PRE-ANS |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-build | 4 | 2 | 2 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-core | 4 | 2 | 2 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-dashboard-extension | 4 | 2 | 2 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-feed | 5* | 1 | 4* | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-git | 4 | 1 | 3 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-graph-identity | 4 | 2 | 2 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-member-entitlement | 4 | 2 | 2 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-policy-branch | 4 | 2 | 2 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions | 4 | — | — | PRE-ANS |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-security-permissions | 4 | 4 | 0 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-serviceendpoint | 4 | 4 | 0 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook | 4 | 4 | 0 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-taskagent | 4 | 3 | 1 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki | 4 | 3 | 1 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtracking | 4 | 3 | 1 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-workitemtrackingprocess | 4 | 3 | 1 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover | 4 | 4 | 0 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-new-api-accounts-profile | 4 | 2 | 2 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-new-api-featuremanagement | 4 | 4 | 0 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-new-api-gallery-extensionmanagement | 4 | 4 | 0 | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification | 5* | 3 | 2* | WROTE |
| 2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelinesapproval | 4 | 4 | 0 | WROTE |

\* feed and notification each carry a 5th pseudo-entry — the markdown H1 title
line leaked into the derived JSON as a fake question (see §6). Counted in the
35 skips but not a real operator question.

Totals: written cycles 33 / 134 question entries → **99 artifact-answered, 35
skipped** (33 real operator-genuine + 2 pseudo). Pre-answered cycles 8 / 32
questions (already genuinely answered by the operator). 134 + 32 = 166. ✓

Evidence base used by the answers (each answer carries its own citation):
`docs/investigations/2026-07-betterado-run-friction.md` (the July batch's
primary source — SEV-1 fixture destruction, facade-migration pattern,
validator-parity regressions, gate-gaming/fabrication sagas, per-PR entries),
each cycle's own `retro.md`/`recap.md`/`events.jsonl`, `brain/cycles/_raw/`
archives, brain themes, `_queue/done/` manifests, and `git log`/`git show` in
`projects/terraform-provider-betterado` (PR/commit-level verification).

## 4. Operator-genuine questions (verbatim, grouped by topic)

These 33 real questions were skipped as `_(skipped — operator input required)_`
in the written files. Multiline question texts are joined with " / ". Cycle
names abbreviated to the initiative suffix.

### Topic 1 — Decomposition sizing ("was the N-WI split right?") — 16 questions
The reflector asks this on nearly every July cycle; it is a pure operator
judgment call (the artifacts show what happened, not what you'd have preferred).

- framework-release-definition: "Was the WI decomposition the right size for this initiative?"
- framework-state-upgraders: "Was the WI decomposition right-sized for this initiative? / WI-5 (live acceptance test) cost ~$5.59 — 57% of total cycle cost — entirely in iteration 2 debugging the ADO `GetProjects` API pagination to work around the 1000-project org limit. In hindsight, the WI spec assumed `TF_ACC` tests could create projects freely. A pre-flight check WI (verify org capacity / choose test-project strategy) might have separated this discovery cost. / Options: (a) Right-sized — the live-test WI was appropriately scoped, infra limits are not predictable. (b) Too-few — a "test-env audit" WI should precede any live-create WI. (c) Other."
- migrate-framework-build: "Was the work-item decomposition (5 WIs: gap-matrix, build_folder, build_definition, pipeline_auth+resource_auth, data source) the right granularity for this migration?"
- migrate-framework-core: "Was the 9-WI sequential decomposition the right size?"
- migrate-framework-dashboard-extension: "Was the work-item decomposition the right size for this initiative?"
- migrate-framework-feed: "Were the 6 work items the right granularity for this feed migration?"
- migrate-framework-git: "Was the 6-WI serial decomposition the right size?"
- migrate-framework-graph-identity: "Was the 7-WI decomposition the right size for this initiative (2 resources + 11 data sources across graph + identity packages)?"
- migrate-framework-member-entitlement: "Was the work-item decomposition (5 WIs: gap matrix + 3 resource migrations + docs/cleanup) the right granularity?"
- migrate-framework-policy-branch: "Was the work-item decomposition the right size for this migration?"
- migrate-framework-taskagent: "Was the 11-WI decomposition the right size for the taskagent package migration?"
- migrate-framework-wiki: "Was the 4-WI decomposition (gap-matrix → betterado_wiki → betterado_wiki_page → integration test) the right granularity for this migration?"
- migrate-framework-workitemtracking: "Was the 6-WI decomposition the right granularity for this initiative?"
- migrate-framework-workitemtrackingprocess: "Was the work-item decomposition the right size for a 13-resource + 4-data-source migration?"
- new-api-accounts-profile: "Was the 3-WI decomposition the right size for this initiative?"
- new-api-notification: "Was the 3-WI decomposition (gap matrix → resource → data source + live acc + docs) the right granularity?"

### Topic 2 — Forge-fix prioritisation ("which repeated cost is most worth fixing?") — 10 questions
Each enumerates 2–3 concrete, evidenced pain points and asks the operator to
rank them. The facts are established; the priority is the operator's.
Recurring candidates across these: **SDKv2 dead-file deletion omission (3rd–5th
consecutive cycle)**, **gitignored-scratch-file `git add -f` antipattern**,
**brainReads=0 in ralph sessions**, **PM empty/dropped-scope decompositions
needing multiple runs**, **unifier gate-retry spins (16–19 restarts)**,
**vendor re-exploration per WI**, **`branches-not-in-sync` storms after
concurrent merges**.

- ownership-hotspots-top-flag: "Two patterns repeated across every WI: (1) the dev-loop agent tried `git add fix_plan.md AGENT.md` (gitignored scratch files) and had to retry with `git add -f`, generating a redundant commit attempt per WI (×3 WIs). (2) The unifier spent ~15 Bash probes discovering `forge demo render` conventions before falling back to a manual copy. Which is most worth fixing?"
- json-output-flag: "The gitignored-scratch-file antipattern (`git add fix_plan.md AGENT.md` → fail → retry with `git add -f`) occurred in BOTH WIs, and was already documented after the prior cycle. The SKILL.md fix was never applied. Also, WI-2 attempted to commit the gitignored `demo/pulse-capture.md` before self-correcting. / Which is most worth a forge fix?"
- migrate-framework-build: "Stage 1 found three significant repeated actions: (a) plan-modifier/defaults vendor re-exploration per WI (~30 bash calls each time), (b) AGENT.md/fix_plan.md committed via `git add -f` despite being in `.gitignore`, (c) old SDKv2 files not deleted in any WI (clause 3b skipped — same omission for 3rd cycle in a row). Which is most worth addressing?"
- migrate-framework-core: "The biggest drain was the **UWI-6 live-capture spin**: 19 unifier cycle restarts over ~5 hours because `review-gate-r3.sh` required live evidence for `resource_project_pipeline_settings` that ralph never captured (WI-3 exhausted budget before capturing evidence). The scheduler treated this like any other gate failure and kept requeueing. Which of these is worth a forge fix?"
- migrate-framework-dashboard-extension: "The two most significant repeated costs in this cycle were: (a) PM ran 4 times before producing a correct decomposition — `betterado_extension` was dropped from scope in the first two valid runs, requiring an operator annotation to the manifest to force coverage; (b) the SDKv2 dead-file omission occurred for the 5th consecutive migration cycle — ralph creates framework files and deregisters from provider.go but does not delete the superseded SDKv2 source files, requiring unifier cleanup every cycle. Which is worth a forge fix?"
- migrate-framework-feed: "Three concrete repeated actions and one roadblock dominated this cycle. Which is worth addressing in forge next?"
- migrate-framework-git: "This cycle: (a) 1000-project org cap re-derived 4× by WI-2 ralph (brainReads=0 again, documented in profile.md and brain); (b) `branches-not-in-sync` fired 15× after a concurrent merge advanced main, requiring operator manual rebase + requeue. Which is worth a forge fix or new tool?"
- migrate-framework-graph-identity: "The cycle had two notable repeated-action clusters: (a) PM emitted empty decomposition twice before succeeding on the 3rd attempt ($4 wasted PM cost); (b) WI-6 identity-user acceptance test used a hard-coded "Project Collection Build Service" display name that doesn't exist in this ADO org — took 3 gate.fail iterations to fix by trial-and-error. Which is worth a forge fix or new tool?"
- migrate-framework-member-entitlement: "This cycle had three roadblocks worth evaluating: (a) PM hit max_turns / SIGKILL twice before producing valid WIs — 4 total PM runs; (b) Hidden-coupling rejection on the third PM run (operator had to add a decomposition note); (c) SDKv2 dead files omitted for the 4th consecutive migration cycle — required a second unifier run to clean up. Which is most worth a forge fix or a new tool?"
- migrate-framework-policy-branch: "The two biggest repeated-action costs this cycle were: (a) UWI-6/7 unifier restarted 16 times over ~80 minutes before clearing — likely a flaky live-acceptance or lint retry loop; (b) brainReads=0 across all 13 ralph sessions for the third consecutive cycle. Which is worth a forge fix or new mechanism?"

### Topic 3 — Policy / approval decisions — 2 questions
- framework-mux-entrypoint: "The agent bumped `terraform-plugin-sdk/v2` from v2.38.1 → v2.40.1 to resolve a `GenerateResourceConfig` interface mismatch with `plugin-go@v0.31.0`. Was this acceptable?"
- framework-docs-examples: "The project's acceptance gate fires on every initiative, including docs-only ones, causing ~4 PM retries per cycle. Should the acceptance gate be:" *(verified today: no scoped-gate / skip-acceptance mechanism exists yet in `orchestrator/phases/project-manager.ts` — still an open policy decision)*

### Topic 4 — Open-ended operator observations — 5 questions
- ownership-hotspots-top-flag: "Any other operator notes on this initiative — quality of the analytics modules, test coverage gaps (e.g. acceptance gate not covering ownership/hotspot table rendering), or things to change for the next gitpulse milestone?"
- json-output-flag: "Any other observations about this initiative — the `--json` flag design, the acceptance gate extension, the unifier cost ($2.45 for a 2-WI initiative), or anything else?"
- migrate-framework-feed: "Any other observations, corrections, or direction for the next initiative?"
- migrate-framework-git: "Any other notes on this initiative — things that worked unusually well, things to change, or anything else?"
- new-api-accounts-profile: "Any other observations on this initiative (API shape surprises, unifier performance, operator experience)?"

Grand total real operator-genuine = 33 (16 + 10 + 2 + 5).

## 5. "Already-answered-on-disk" anomaly — 8 cycles (untouched; rerun-only)

These 8 cycles have `user-feedback.md` files containing **genuine, substantive
operator answers** (colloquial first-person prose, project-specific corrections,
even typos) matching the current `user-questions.json` texts verbatim — yet the
questions still sit "pending" and each retro.md's user-feedback section reads
"(no feedback supplied)". Root cause pattern (confirmed on
release-folder-permissions from events.jsonl): a later reflector rerun — most
likely the 2026-06-23/24 boot-reconcile flood and/or budget-capped reruns —
regenerated an identical question set and ended `error_max_budget_usd` (or
otherwise) **without consuming the existing feedback**. Do NOT overwrite these
files; just rerun the reflector (direct call — they are outside the 7-day
reconcile window):

1. 2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources
2. 2026-06-06T05-30-11_INIT-2026-06-05-release-definition-permissions
3. 2026-06-06T09-32-34_INIT-2026-06-06-shared-acceptance-fixture
4. 2026-06-07T03-20-11_INIT-2026-06-07-release-folder-data-source
5. 2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit
6. 2026-06-19T23-10-22_INIT-2026-06-19-framework-task-group
7. 2026-06-22T08-23-03_INIT-2026-06-22-compare-ref-analytics-delta
8. 2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-release-folder-permissions

## 6. Forge defects surfaced by this triage (worth filing)

1. **Feedback-not-consumed rerun** (§5) — a rerun can regenerate identical
   questions and mark retro "no feedback" while genuine operator feedback sits
   on disk. 8 occurrences.
2. **Phantom `output_refs`** — `reflector.end` can claim retro.md in
   `output_refs` when `retroWrites:0` and no file exists
   (new-api-pipelines-v2). Event metadata ≠ persistence.
3. **H1-title-as-question parse defect** — `deriveUserQuestionsJson` leaks the
   `# User Questions — <id>` title line into the JSON array as a pseudo-question
   with empty options (migrate-framework-feed, new-api-notification).
4. **Silent reflector loss** — 6 done cycles never had a reflector invoked at
   all, and 1 was orphaned mid-run with no crash event (§2) — nothing flags
   these; only a done-vs-archive diff finds them.
