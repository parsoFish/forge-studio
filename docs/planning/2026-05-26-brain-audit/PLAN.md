# Plan — Tier 4: Brain audit + three-brain restructure

> **Status:** drafted 2026-05-26 by the agent that landed Tiers 1–3
> + verification v3. Handed off to a fresh session for execution.
> **Source manifests:** the operator brief in this section + the prior
> Tier 4 stub at [`../2026-05-25-thin-forge/PLAN.md`](../2026-05-25-thin-forge/PLAN.md)
> (the part captioned "Tier 4 — Brain themes audit (split into a
> separate plan)").
> **Pre-handoff verification baseline:** [`docs/verifications/2026-05-26-cascade-cycle-v3/`](../../verifications/2026-05-26-cascade-cycle-v3/)
> (Tiers 1+2+3 confirmed shipping clean against a real cycle).

## Context

The brain has grown organically over many cycles. Tier 0 deleted three
themes whose *interpretation* was wrong (single-WI bias), but a
holistic audit hasn't happened yet. Beyond the spot-deletes the
operator wants a **structural reshape**: three distinct brains, each
with its own purpose and audience, replacing the current single-
brain-spanning-everything layout.

### The three-brain model (operator's mental model, 2026-05-26)

> "Each context requires a brain and they each need them for different
> reasons."

| # | Brain | Contents | Audience | When read |
|---|---|---|---|---|
| 1 | **forge-dev brain** | Graphify graph of forge project code, prompts, skills, ADRs, planning docs | Developers (human + Claude Code) editing forge itself | Forge-internal development sessions |
| 2 | **cycle-knowledge brain** | Cycle archives, antipatterns surfaced through prior cycles, reflections, cross-cycle patterns, forge-level operational notes | Planning + reflection phases (architect, PM, reflector) inside cycles | Inside a forge cycle |
| 3 | **project-specific brain** (one per project) | Project goals, project structure, project-specific patterns + antipatterns, project profile | Planning phases when working **on that project** | Inside a forge cycle whose initiative targets that project |

Usage matrix:

- **Inside a forge cycle**: planners (architect, PM, reflector) query Brain 2 + Brain 3 of the cycle's project. Dev-loop + reviewer do not query the brain (per [ADR 010](../../decisions/010-brain-first.md)).
- **During forge development**: Brain 1 + Brain 2.
- **Brain 1 is never read during a cycle** — it's a forge-engineer tool.
- **Brain 3 is never read during forge development** — that's a project-specific dev concern, not a forge concern.

## Current state assessment

```
brain/
├── INDEX.md             — navigation, regenerable
├── LINT.md              — lint policy
├── _archive/            — archived material (presumed retired themes)
├── _raw/cycles/         — cycle archives (raw event-log summaries) — keep
├── forge/
│   ├── antipatterns.md  — forge-level antipattern index
│   ├── decisions.md     — links to ADRs
│   ├── operations.md    — operator workflows
│   ├── patterns.md      — forge-level patterns index
│   ├── reference.md     — links to external resources
│   └── themes/          — forge-level themes (the body of Brain 2)
├── graphify-out/        — ONE graph spanning the WHOLE forge tree
│                          (orchestrator/, cli/, skills/, loops/, docs/,
│                          brain/ itself per CLAUDE.md line 115)
├── log.md               — phase closure log (forge dev history)
└── projects/<name>/
    ├── profile.md       — project profile (goals, constraints)
    └── themes/          — per-project themes (Brain 3 content)
```

The issues:

1. **No scope separation.** brain/forge/themes/ and brain/_raw/cycles/ are mixed under the same root as brain/projects/, and the graphify graph spans all of it. A query for "what's the dev-loop SKILL's contract?" can return cycle themes; a query for "what's a good WI shape?" can return forge-internal code symbols.
2. **graphify-out scope.** Currently indexes everything including `brain/` itself, so cycle-knowledge themes show up in code searches and vice versa.
3. **Reflection writes muddle the boundary.** When the reflector emits themes for a cycle on `claude-harness`, it writes BOTH to `brain/projects/claude-harness/themes/` (project-specific) AND occasionally to `brain/forge/themes/` (forge-level). The boundary is enforced by convention, not structure.
4. **brain-query SKILL has no scope parameter.** Every query scans every theme. Pollution noise grows quadratically as themes accumulate.

## Target state

```
brain/
├── INDEX.md                       — top-level navigator (regenerable)
├── LINT.md                        — lint policy (cross-brain)
├── log.md                         — phase closure log (Brain 1 content)
├── forge-dev/                     — BRAIN 1
│   ├── graphify-out/              — graph scoped to forge code + prompts + docs
│   ├── decisions/                 — ADR links + ADR-shaped notes about forge architecture
│   ├── as-built/                  — architecture snapshots
│   └── notes/                     — forge-internal engineering notes
├── cycles/                        — BRAIN 2
│   ├── _raw/                      — raw cycle archives (was brain/_raw/cycles)
│   ├── themes/                    — forge-level patterns + antipatterns surfaced by cycles (was brain/forge/themes/, but trimmed to cycle-derived content)
│   ├── antipatterns.md            — index over themes/ (was brain/forge/antipatterns.md)
│   ├── patterns.md                — same, pattern index
│   ├── operations.md              — operator workflows (was brain/forge/operations.md)
│   └── graphify-out/              — graph scoped to themes + raw cycle archives (lightweight)
└── projects/<name>/               — BRAIN 3 (one per project)
    ├── profile.md                 — unchanged
    ├── themes/                    — unchanged (project-specific themes only)
    └── graphify-out/              — graph scoped to project's own themes + raw cycle slices for that project
```

Notes on the layout:

- `brain/forge/{patterns,antipatterns,operations,decisions,reference}.md` index files: the cycle-derived ones (patterns, antipatterns, operations) move to `brain/cycles/`. `decisions.md` + `reference.md` are forge-engineering aids → move to `brain/forge-dev/`.
- Each brain gets its own `graphify-out/` so the structural graph is scope-clean. Three smaller graphs replace one giant one. Each one is also cheaper to rebuild incrementally.
- `brain/_archive/` (old retired themes) stays at the top level for now; treat as historical reference shared across all three brains.

## Brain-query SKILL update

`skills/brain-query/SKILL.md` must accept a **scope** parameter:

```
brain-query --scope=cycles    "<question>"
brain-query --scope=project --project=trafficGame "<question>"
brain-query --scope=forge-dev "<question>"
```

Convenient aliases the agent uses inside a cycle:

- Planner skills (architect/PM/reflector) default to `scope=cycles,project=<cycle.project>` — a UNION of Brain 2 + the cycle's Brain 3.
- A forge-dev session (no active cycle) defaults to `scope=forge-dev,cycles` — Brain 1 + Brain 2.

When no scope is given and no cycle context is available, default to **all three** and warn (so accidental no-scope queries don't silently miss). The brain-query result should include a `scope` field in its output so the agent can see what was actually searched.

`brain-graph` SKILL (`skills/brain-graph/SKILL.md`) similarly takes the
scope and consults the right `graphify-out/` directory.

## Content audit (carries the prior Tier 4 stub)

After the structural reshape lands, sweep the THEMES content per the earlier Tier 4 stub:

1. **Misleading interpretations.** Tier 0 dropped 3 themes (single-WI-bias). Likely more. Each remaining theme is reviewed against the question: *"Was this an overgeneralisation of one observation, or a durable lesson with cross-cycle evidence?"* Delete or rewrite the overgeneralisations.
2. **Stale themes.** Themes documenting behaviour that has since changed (e.g. wedged-detection — gone in Tier 2; benchmarks — gone in Tier 0). Either delete (if the behaviour is fully gone) or rewrite with the new state.
3. **Reference integrity.** After moves + deletes, sweep for broken `[[name]]` links, `cited_by` frontmatter entries, sibling-theme back-refs, INDEX.md state.

Carry **don't churn cycle archives** rule from the prior stub: `brain/cycles/_raw/` are raw observations + the durable source. Themes are interpretations OF the raw observations; those are what's audited.

## Migration plan (ordered)

Each step lands in its own commit so the operator can stop after any step.

### Step 0 — Snapshot + decide retention

- `git tag brain-pre-restructure` on the current commit (a recoverable anchor).
- Walk `brain/_archive/` to confirm what's there; either keep or merge into the new structure.
- Decide whether to start fresh on a graphify graph or carry forward (probably fresh — graphify is cheap to rebuild and the scope changes are large).

### Step 1 — Brain-query scope plumbing (no content moves yet)

- Add a `scope` parameter to `skills/brain-query/SKILL.md` + the underlying brain-query implementation (look for the CLI helper that drives it; it lives somewhere under `cli/` or in the skill's runtime — locate before changing).
- Add the same to `skills/brain-graph/SKILL.md`.
- Default behaviour for missing scope: WARN + search all (preserves current behaviour during migration).
- New tests covering scope routing.

### Step 2 — Directory restructure

Move files according to the target layout above. Use `git mv` so history is preserved. Don't change content; this is purely structural.

- `brain/_raw/cycles/` → `brain/cycles/_raw/`
- `brain/forge/themes/` → `brain/cycles/themes/`
- `brain/forge/{patterns,antipatterns,operations}.md` → `brain/cycles/`
- `brain/forge/{decisions,reference}.md` → `brain/forge-dev/`
- `brain/projects/` stays in place
- Create empty `brain/forge-dev/{decisions,as-built,notes}/` skeleton
- `brain/graphify-out/` will be replaced by three per-brain dirs in Step 3 — leave the old one in place for fallback in this step, but stop trusting it.

### Step 3 — Per-brain graphify rebuilds

Run `safishamsi/graphify` against each brain's content separately:

- `brain/forge-dev/graphify-out/` — indexes `orchestrator/`, `cli/`, `skills/`, `loops/`, `docs/`, `ARCHITECTURE.md`, `PRINCIPLES.md`, `brain/forge-dev/`. **Excludes** `brain/cycles/` + `brain/projects/`.
- `brain/cycles/graphify-out/` — indexes `brain/cycles/`. **Excludes** code + projects.
- `brain/projects/<name>/graphify-out/` — one per project, indexes `brain/projects/<name>/`.

The current post-commit hook that runs `graphify update .` needs updating to refresh ALL three. Either:

a) Three hook invocations (simpler but slower commits)
b) A wrapper script `scripts/brain-graphify-all.sh` invoked by one hook
c) Defer graphify to a periodic cron (graphs are useful but not load-bearing for cycles per the brain-query SKILL's "graph fills the gap forge has been carrying manually via related_themes" line)

Recommend (b).

Delete the old `brain/graphify-out/` once the three replacements are healthy.

### Step 4 — Update CLAUDE.md + ADRs

- CLAUDE.md "## graphify" section: update path from `brain/graphify-out/` to the three new locations; explain the three-brain model.
- ADR 010 (brain-first) may need a small amendment noting the three-brain scope-routing.
- Possibly a new ADR for the three-brain model — borderline. The operator can decide; **default: no new ADR**, just amend 010.

### Step 5 — Content audit (the original Tier 4 stub)

Per "Content audit" above. This is the longest step, but it's safer to do AFTER the structural reshape because:

1. Moves done in Step 2 may surface themes that "felt important" but are now obviously project-specific (move them out of cycles into projects/).
2. The graphify rebuild in Step 3 surfaces orphan themes (no inbound references) — easy delete candidates.

Land trims in small batches (≤10 themes per commit) so a future operator can bisect.

### Step 6 — Reference integrity sweep

After Step 5:

- Grep all `[[name]]` links + `cited_by:` frontmatter for broken pointers.
- Regenerate `brain/INDEX.md` (`forge brain index --write`).
- Run `forge brain lint` — every check should pass.

### Step 7 — Reflector hand-off update

Reflector currently writes themes to `brain/forge/themes/` AND `brain/projects/<name>/themes/`. Update the reflector invocation (`orchestrator/reflector-invocation.ts`) + the reflector SKILL so it writes:

- Cycle-level patterns → `brain/cycles/themes/`
- Project-specific patterns → `brain/projects/<name>/themes/`

The split is the reflector's call — same as today, just with the new paths.

## Validation procedure

The operator wants concrete proof that the brain restructure improves something measurable, not just feels tidier. Two-track validation:

### Track A — Re-run the verification initiative

Re-run `INIT-2026-05-26-claude-trail-verify-cascade-v3` (or a v4 sibling with the same shape) AFTER the restructure lands. Compare against the [v3 baseline](../../verifications/2026-05-26-cascade-cycle-v3/):

| Metric | V3 baseline | V4 target | Why this measures brain quality |
|---|---|---|---|
| PM phase duration (cycle.start → pm.end) | ~4 min | ↓ or = | Faster brain-query (smaller scoped graph + themes) = faster planning |
| PM brain-query count | 5 | ≤ 5 | Targeted queries hit the right themes; fewer fall-through queries needed |
| PM brain-query cost | $0.05 | ↓ or = | Less context to scan per query |
| Cycle outcome | 6 WIs, 5 pass, WI-5 fails on iteration-budget | merge OR clean fail; reflection runs | Restructure must not break cycle correctness |
| Reflector theme placement | mixed forge/projects | clean cycles/ vs projects/ split | Step 7 working |
| Forge-dev brain noise check | unclear | a brain-query for forge code returns no cycle themes; a brain-query for cycle antipatterns returns no code symbols | Direct test of scope isolation |

If the v4 cycle merges AND PM phase is no slower AND scope isolation holds, the restructure is a win.

If v4 takes longer OR cycle outcome regresses, dig in to the diff — likely the scope-routing missed a needed theme.

### Track B — Brain-query precision/recall mini-bench

If Track A is hard to attribute (cycle behaviour is multi-factor),
fall back to a controlled bench. The next agent designs this if
needed — outline:

- Pick **10 questions** the planner would realistically ask, each
  paired with the human-curated set of "themes that should match".
  Examples:
  - "What antipatterns do we know about PM hidden coupling?"
  - "What does the brain say about per-WI sizing?"
  - "What's the unifier's composed gate composed of?"
  - "What patterns has trafficGame surfaced about overlay rendering?"
- For each question, run `brain-query --scope=<right-scope>` and
  `brain-query --scope=<wrong-scope>` (negative control).
- Score precision (returned themes / curated relevant) + recall
  (curated relevant / all relevant in brain).
- Compare against the same questions on the **old** brain
  layout (use the `brain-pre-restructure` git tag for the baseline).

Aim: precision should rise (less noise from cross-scope themes);
recall should be ≥ baseline (no relevant themes lost). If recall
drops, the scope routing is too tight — relax it.

### Track C — Forge-dev session smoke test

A quick informal check that the forge-dev brain is useful on its own
turf: ask the brain (via brain-query in `scope=forge-dev`) a question
about forge code — e.g. "where is the iter-0 must-fail check
implemented?" — and confirm the result is the code file, not a cycle
theme. This is the strongest signal that the scope split is working.

## Anti-goals (carry from prior plan)

- **Don't replace the synthetic guidance with new synthetic guidance.** The replacement for "Cap at ~5 features" is brain-query for past successful initiative shapes, NOT "Cap at ~10 features".
- **Don't delete the durable principles.** Examples that stay:
  - "Consult the brain before starting work" (planner phases only).
  - "Emit structured events to the JSONL event log on every skill invocation."
  - "Use git worktrees for parallel work units."
  - "Don't re-invent a job queue / worker pool / process isolator" (ADRs 011-013).
  - "Spawn agents as Claude Code skills via the SDK, not CLI subprocesses."
  - "Use markdown artifacts to flow data between phases."
  - The five PRINCIPLES.md items.
- **Don't churn brain themes that record raw cycle observations.** `brain/cycles/_raw/` is raw data — keep all. Themes are interpretations OF the raw observations; those are what's audited.

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Theme moves break inbound `[[name]]` links across project + cycle themes | Medium | Step 6 (reference integrity sweep) catches all of these |
| graphify scope misconfiguration creates a brain that's silently missing files | Medium | Step 3 outputs file count + node count; eyeball + assert > 0 nodes per brain |
| Reflector hand-off update breaks the next live cycle's theme placement | Medium | Track A (run a cycle after Step 7) is the regression check |
| brain-query default-to-all-scopes warning is too noisy | Low | Make the warning a single-line + suppress with `--scope=all` explicit |
| Content audit deletes themes that turn out to be load-bearing | Medium | Land trims in small batches (≤10 themes per commit) so git revert is cheap |
| `brain-pre-restructure` git tag forgotten | Low | Step 0 makes this explicit before any moves |

## Open questions for the next agent

1. **Where does `brain/log.md` belong?** It's the phase closure log — historical forge dev artifact. Probably `brain/forge-dev/log.md`. Confirm with operator if uncertain.
2. **`brain/_archive/`** — keep at top level, move into a brain, or delete? Walk its contents first.
3. **`brain/forge/{decisions,reference}.md` content** — confirm these are forge-engineering aids (Brain 1) and not cycle-pattern docs. If the latter, move to `brain/cycles/`.
4. **Graphify scope for projects** — should each project's `graphify-out/` index include the project's source code (under `projects/<name>/`) too, or only `brain/projects/<name>/`? Operator's "project structure resource" comment suggests including some code structure. Worth a one-line confirmation.
5. **brain-query default scope when invoked outside a cycle context** — strict (require explicit scope) or permissive (default to all-three + warn)? Start permissive.
6. **The reflector's "cycle-level vs project-specific" split policy** — formalize as a rule the reflector follows, OR keep agent-discretion with a brain-query at the time of writing? Probably the latter (less rigid).
7. **Validation Track A vs Track B selection** — Track A first (cheap to run). Fall back to Track B if Track A signals are too noisy to attribute to the restructure.

## Out of scope

- Bench replacement (Tier 5; the rebuild-from-scratch self-bench operator idea lives in the [parent thinning plan](../2026-05-25-thin-forge/PLAN.md) under "Open question — bench replacement").
- Per-WI live agent-flow tier in the UI (separate UI thread).
- Adding NEW themes proactively. The audit removes/edits; new themes come from real cycles + the reflector.

## Estimated session shape

The next agent should expect roughly:

- Step 0 + Step 1 (scope plumbing): 1–2 hours, mostly skill + SKILL.md edits + tests
- Step 2 (directory moves): 30 min, mechanical
- Step 3 (graphify rebuilds): 1 hour, including testing the post-commit hook
- Step 4 (CLAUDE.md + ADR updates): 30 min
- Step 5 (content audit): 2–4 hours; the bulk of the work
- Step 6 (reference integrity): 1 hour
- Step 7 (reflector hand-off update): 30 min
- Track A re-run + Track C smoke: 1 hour real-cycle wait + capture + commit
- Total: about a full session

If time gets tight, the priority order is: 0, 1, 2, 3, 7, Track A (skipping 4 + 5 + 6 if needed). The structural reshape + reflector hand-off update is the load-bearing change; the content audit can land later.
