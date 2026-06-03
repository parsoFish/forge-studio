---
plan: 02-architect
councilled_at: 2026-05-21
critics: ceo, eng, design, dx
---

# Council review — 02-architect

## Headline

The plan diagnoses the betterado-20-drop pathology accurately and proposes the right primitive (PLAN.md as the architect's PR-shaped artifact). Scope is honest, but it bundles two large refinements (operator-facing plan-doc loop + bench reground) into one initiative and leaves four real taste decisions in the operator's lap.

## Mechanical flags (auto-applicable)

### `eng:downstream-pm-score-circularity`
**Issue:** `downstream_pm_score` (0.30 weight in "Benchmark regrounding") chains the architect bench into the PM bench at score time. If the PM bench is itself being refined (per "Dependencies on other refinement plans"), this couples two unstable rubrics and any PM-bench regression silently degrades the architect score. The plan does not state which bench's contract is pinned.
**Proposed fix:** Pin `downstream_pm_score` to a frozen PM-bench rubric snapshot (`benchmarks/project-manager/scoring.frozen.ts` or git SHA) so PM-bench iteration doesn't perturb architect scores. Note the snapshot SHA in the acceptance test.

### `eng:plan-md-location-collision`
**Issue:** Section "Plan-doc operator artifact → Location" plants `projects/<project>/_architect/` inside the project repo, but `Open questions #2` flags this as unresolved. The "Files touched" list already commits to the project-repo location. The escalation and the chosen implementation contradict.
**Proposed fix:** Either remove the location from "Files touched" until open question #2 is answered, or downgrade #2 from an open question to a documented decision with rationale (it's already implicitly decided).

### `eng:parity-gate-missing-from-acceptance`
**Issue:** "Acceptance criteria for THIS refinement → Round-trip artifact" requires manifest parity with the current architect for an approved PLAN.md. The bench's new B1/B2 fixtures must FAIL the current SKILL.md (per "Benchmark regrounding → Acceptance test"). These two acceptance tests reference different fixture sets — B1/B2 vs. "the same fixture". The parity gate's fixture isn't named.
**Proposed fix:** Name the parity-gate fixture explicitly (likely one of the original 8 synthetic ones, kept as a regression anchor) and note that B1/B2 are explicitly NOT parity gates.

### `dx:cli-naming-asymmetry`
**Issue:** "Operator UX → step 4" introduces `forge architect-commit <session-id>`. Other forge CLIs are noun-first (`forge enqueue`, `forge review <id>`, `forge preflight`). `architect-commit` is verb-suffixed and breaks the pattern.
**Proposed fix:** Rename to `forge architect commit <session-id>` (subcommand under `architect`) or `forge plan-commit <session-id>`. The existing `forge review <id>` is the closest precedent — match its shape.

## Escalations (taste decisions for the operator)

### [ceo] Should this plan be sliced into two initiatives?

The plan bundles **(A) operator plan-doc + comment loop** and **(B) bench regrounding with B1/B2 + cross-phase handoff** into one refinement. A is a UX change to one skill; B is a rubric rewrite that touches `benchmarks/architect/`, `benchmarks/project-manager/`, and a new shared `benchmarks/_lib/`. They have different risk profiles and different reviewers (operator vs. forge-internal).
- **Slice now — A first, B second** — Plan-doc loop unblocks the betterado run this week. B can be informed by what we learn from A (e.g., is `aggregate_budget_declared` actually visible enough as a PLAN.md section, or does it need to be a bench gate?). Lower per-initiative cost; honors "one concern per PR".
- **Slice now — B first, A second** — Bench discrimination is the load-bearing claim; without B1/B2 we can't prove A actually helps. Risk: B's value is hard to see without A's artifact.
- **Keep bundled** — They share the council-transcript artifact; splitting forces double-touching `skills/architect-llm-council/SKILL.md`. Cheaper aggregate spend if the bundling holds.

### [design] Local-edit vs PR comments as the default surface (echoes open Q1)

The plan defaults to local-edit `<!-- review: -->` HTML comments and makes PR mode opt-in. PR-as-sole-review-window is the proven loop for the reviewer phase. The architect runs out-of-cycle, often pre-remote.
- **Local-edit default, `--via-pr` opt-in** (current plan choice) — Universal; works on first session of a new project. Drawback: two surfaces to maintain; HTML-comment parsing is hand-rolled.
- **PR-default, fail loudly if no remote** — One review loop across the whole product. Forces remote-first which is a real friction tax on early-stage projects.
- **PR-only, but on the forge repo not the project repo** — PLAN.md is a forge artifact; the forge repo always has a remote. Drawback: review thread lives away from the project tree.

### [ceo] Aggregate-budget auto-escalation threshold (echoes open Q4)

The plan flags ≈$534 as the failure mode but doesn't pick an N for auto-revise. Without a number, "operator must explicitly OK the spend" is aspirational.
- **N = $100** — Conservative; forces explicit OK on any multi-initiative session. Likely too noisy for a normal architect run.
- **N = $250** — Roughly two single-initiative cycles' worth. Catches the betterado drop, rare otherwise.
- **N = dynamic (median of last 5 sessions × 3)** — Self-tuning; degrades to fixed N before any history exists. Best fit for "preserve unattended operation" but more code.
- **No auto-escalation; PLAN.md surfaces the number, operator decides** — Simplest. Trusts the operator. Reverts to today's failure mode if operator skims.

### [dx] PLAN.md retention policy (echoes open Q5)

Plan defers this. Audit trail value compounds over time; disk cost is real for projects with many architect sessions.
- **Keep forever in `_architect/`** — Audit gold. Encourage `.gitignore` of the dir if the project doesn't want it committed.
- **Keep last N (e.g., 10) per project, archive older** — Bounded. Requires a sweeper (more orchestrator surface — flag against north-star).
- **Keep approved sessions forever, rejected/superseded sessions for 30 days** — Distinguishes signal from noise. Slightly more logic.

## Per-critic verdict

### CEO
- flags: 0
- escalations: 2
- summary: The "most leveraged refinement right now" claim is plausible — the betterado drop is the concrete failure that motivated the plan and the plan-doc artifact is the smallest thing that could have caught it. But the plan bundles two refinements with different blast radii. North-star check: A (plan-doc) preserves unattended operation by giving the operator a single inspect/iterate moment; B (bench regrounding) preserves it by hardening the gate. Both pass. Surface-area check: B grows `benchmarks/_lib/` (new), which is shared infra — acceptable.

### Engineering
- flags: 3
- escalations: 0
- summary: Mechanism is mostly the simplest thing — a markdown file + HTML comments + a CLI to parse them. The HTML-comment parsing is hand-rolled and could be a flag, but it's <50 lines and aligns with the "no new external deps" acceptance criterion, so it earns its place. Cross-plan deps are explicit (PM bench, brain-freshness preflight, pr-as-window extraction) and acyclic. Migrations are clean — old skill writes to `_queue/pending/`, new skill writes to `_architect/`, and `architect-commit approve` produces the same file shape (parity-tested). Council-transcript-as-section is the right answer to the "critiques get lost" diagnosis.

### Design
- flags: 0
- escalations: 1
- summary: Operator flow is mapped end-to-end (entry → comments → re-trigger → approve), which is exactly the bar the plan-doc artifact should clear. Discoverability is handled by step 4's terminal print. Failure states are handled (`reject` → archive). The one real design tension is the default surface (local-edit vs PR); the plan picks local-edit-default for the right reason (universal) but doesn't surface how the two modes converge UX-wise — if a project graduates from local-only to remote mid-program, the operator's muscle memory shifts. Worth one escalation, not a flag.

### DX
- flags: 1
- escalations: 1
- summary: Easier to operate next month — a single PLAN.md per session is a real auditability win over chasing N manifests + a transient transcript. No new external deps (gh and editor already required). Migration of forge's own surface is well-handled: the slash command's terminal step changes, but the CLI gains a new subcommand rather than rewriting an existing one. One naming flag (CLI shape inconsistency); retention escalation is real but boundable.

## Recommended next action for the operator

Resolve the CEO escalation first (slice or bundle), then pick N for aggregate-budget auto-escalation. Apply the four mechanical flags inline. Treat local-edit-vs-PR-default as a v1 decision the plan already makes — promote open Q1 from "open" to "decided, revisit after one real cycle".
