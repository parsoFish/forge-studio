---
plan: 01-brain
councilled_at: 2026-05-21
critics: ceo, eng, design, dx
---

# Council review — 01-brain

## Headline

The plan is well-grounded in concrete corpus evidence and proposes the simplest credible fix (one executable, one scrubber, one generator, one bench-growth gate). Main risk is scope: refinements #6 (bench-growth pipeline) and #7 (betterado seed) sit awkwardly inside a "make brain-lint executable + clean the rot" arc and may deserve to be sliced as a second refinement.

## Mechanical flags (auto-applicable)

### `ceo:scope-bundling`
**Issue:** Refinements #1–#5 are one coherent story ("brain hygiene as code"). Refinements #6 and #7 are a different story ("bench evolves with cycles"). Bundling them risks one half blocking the other at slicing time.
**Proposed fix:** Note in the plan header that #1–#5 ship as one initiative bundle and #6–#7 ship as a second initiative bundle gated on plan 06 (reflect). Keep the plan file unified but mark the boundary.

### `eng:acceptance-#5-unverifiable-as-stated`
**Issue:** Acceptance for refinement #5 ("clean run after one operator pass") doesn't enumerate what counts as the operator pass. The category remapping (`snapshot → reference`, `process → operation`) is open question #1 — so acceptance depends on an unresolved decision.
**Proposed fix:** Rephrase acceptance #5 as "category whitelist enforced; hard-fail on writes; existing 6 violations either remapped (per resolved open question #1) or whitelisted; lint exits clean." Resolution path is explicit even if the decision is still open.

### `eng:staleness-mechanism-underspecified`
**Issue:** Refinement #2 says "use `git log -- <path>` cheap check" but the brain cites *project* paths (e.g. `CampaignLevels.ts` lives under `projects/trafficGame/`, gitignored at forge level). Running `git log` from the forge root will return empty for every project file — the check needs to run against the project's own git tree.
**Proposed fix:** Add a one-line note: "staleness check resolves the project root via `brain/projects/<n>/profile.md` → cited project repo, then runs `git log` against *that* tree, not forge root."

### `eng:bench-gate-self-reference-risk`
**Issue:** Cleanup playbook step 4 says "Accuracy must stay ≥ 94.4%. If it drops, the cleanup pass is reverted via `git revert`." But if the *cleanup itself* (deleting contamination dirs, regenerating INDEX.md) changes nothing the question set hits on, this gate is no-op. Conversely, if it does drop accuracy, that signals the bench is testing contamination — which would be a bug, not a real regression.
**Proposed fix:** Reframe the gate as "bench must not drop below 94.4% post-cleanup; an unexpected drop is itself a finding (the bench was depending on rot)."

### `eng:contradiction-check-heuristic-fragile`
**Issue:** `checkContradictions` description ("titles containing the same key noun phrase but one ending `-pattern.md` and another `-antipattern.md`") is a thin heuristic. The campaign-graph staleness case wouldn't be caught by this — it was code-vs-theme contradiction, not pattern/antipattern naming.
**Proposed fix:** Downgrade `checkContradictions` from "check" to "warn-only stretch goal" in §Brain-lint design, and explicitly state that the staleness check (#2) is the load-bearing contradiction defence.

### `dx:script-location-inconsistency`
**Issue:** Plan puts `scripts/brain-scrub-test-contamination.ts` under `scripts/` but `orchestrator/brain-lint.ts`, `orchestrator/brain-index.ts`, `orchestrator/brain-bench-promote.ts` under `orchestrator/`. The repo already has a `scripts/` dir (untracked per git status) — but the scrubber is one-shot, while the others are cycle-lifecycle members.
**Proposed fix:** Either move the scrubber under `orchestrator/` (consistent surface) or note explicitly: "one-shot ops scripts live in `scripts/`; recurring cycle hooks live in `orchestrator/`." Document the rule once.

### `dx:no-docs-callout`
**Issue:** Plan touches `brain/LINT.md`, `brain/INDEX.md`, `brain/log.md`, three SKILL.md files, and adds CLI subcommands (`forge brain lint`, `forge brain index`, `forge brain bench:promote`). No mention of updating `CLAUDE.md` "Build & test" section or any operator runbook with the new subcommands.
**Proposed fix:** Add to acceptance criteria: "CLAUDE.md `Build & test` block lists `forge brain lint`, `forge brain index --write`, `forge brain bench:promote --cycle <id>` with one-line descriptions."

## Escalations (taste decisions for the operator)

### [CEO] Should this plan ship as one initiative or two?
- **One bundle (everything)** — preserves the narrative ("brain is now hygienic + evolves"); maximum operator leverage per review window.
- **Two bundles (#1–#5 first, #6–#7 after plan 06 lands)** — lower-risk slicing; #6 has a hard dependency on plan 06 (reflector emits candidates) that doesn't bind #1–#5; lets the hygiene fixes ship even if bench-growth design needs more taste passes.
- **Three bundles (#1+#3+#4 hygiene, #2+#5 enforcement, #6+#7 evolution)** — finest-grained but probably over-engineered for a refinement that's already conservative in size.

### [Eng] Open question #1 — first-class `snapshot` / `process` categories, or remap?
- **Add to whitelist** — `architecture-snapshot` and `test-stack-and-gates` are arguably distinct from `reference` (point-in-time vs evergreen). Cost: bigger ontology, more drift surface.
- **Remap to `reference` / `operation`** — keeps the ontology at 5 categories per current `LINT.md`; loses the snapshot-vs-evergreen distinction; forces snapshots to carry their date in the title (already true: `2026-05-17-as-built-snapshot.md`).
- **Add `snapshot` only, remap `process`** — `snapshot` is a real kind in this corpus (architecture, as-built); `process` is just a misnamed `operation`.

### [Eng] Open question #3 — staleness signal: live `git log` or stored hash?
- **Live `git log` per cited path** — zero new state in the brain; quadratic-ish but corpus is small (estimate ~60 themes × ~3 cited files each = 180 calls per lint run, sub-second on local).
- **Stored content hash in frontmatter** — `O(1)` lint, requires hash on every write (mechanism in `brain-ingest`/reflector); brain frontmatter grows; theme rewrites get noisy git diffs.
- **Stored mtime + path-only existence check** — cheapest; misses "file exists but the cited symbol/line is gone" cases (the actual campaign-graph failure mode).

### [Eng/CEO] Open question #6 — seed betterado bench now, or wait?
- **Seed 2 questions now (current plan)** — the project is most fragile during cold-start; bench coverage catches dev-loop / PM regressions before they cost a cycle. Cost: artificial questions until real cycles run.
- **Wait until first betterado reflector cycle** — questions are organic, derived from real `brain-query.gap` events; bench has zero coverage during the fragile window.
- **Seed 1 question now (single hard constraint), grow via mechanism #6** — hybrid; covers the riskiest known constraint (single-branch model) without over-investing in synthetic content.

### [DX] Open question #4 — empty contamination dirs: hard-delete or `_archive/`-move?
- **Hard-delete** — they're verifiably empty (`find -empty | wc -l = 126`), git-untracked, no payload to preserve; the user's destructive-preservation rule is about *payload*, and there is none.
- **Move to `_archive/<date>/`** — keeps the audit trail showing "this is what test contamination looked like before we fixed the boundary"; slightly more honest about the fix's effect.
- **Hard-delete + log the count + commit the boundary fix in the same PR** — provides the audit via the commit, not the filesystem; cleanest end state.

## Per-critic verdict

### CEO
- flags: 1
- escalations: 1
- summary: Strategically aligned (all three north-star questions answered yes). The only real concern is whether #6+#7 sneak a "make the bench evolve" agenda into a hygiene refinement.

### Engineering
- flags: 4
- escalations: 2
- summary: Mechanism is mostly the simplest thing that could work. Staleness check has a real project-vs-forge-git-root bug; contradictions check is thin. Bench-gate semantics need one clarifying sentence. None of these are deal-breakers.

### Design
- flags: 0
- escalations: 0
- summary: Plan is internal-tooling-shaped. Operator-facing surface is three new CLI subcommands and one new lint report format — all introduced consistently and with precedent (`commands/*` refactor in 86473cd). No operator-UX moments are claimed and underspecified.

### DX
- flags: 2
- escalations: 1
- summary: Net-positive for next-month operation: brain-lint exits non-zero in CI = self-enforcing. Minor inconsistency on `scripts/` vs `orchestrator/` placement, and no explicit callout to update `CLAUDE.md` with the new CLI surface.

## Recommended next action for the operator

Approve in principle, but resolve the 4 escalations (one-vs-two-bundles, snapshot/process category, staleness signal, betterado seed) before slicing — they materially change the work-item count and the dependency edge to plan 06. Mechanical flags can be applied in-place during the slice without further review.
