---
name: project-scoped-review
description: Audit a managed project's actual end state — code, tests, docs, release surface — against the roadmap/initiative intents that were supposed to produce it, hunting drift (promised-but-absent capabilities, orphaned/half-landed work, doc/code contradictions, silent scope cuts).
phase: audit
surface: operator-triggered
library: true
purpose: Compare a project's real end state to its stated intents (done initiatives, brain themes, doc claims) and report drift, classified delivered / drifted / missing / contradicted, every claim backed by file:line evidence.
composition:
  skills: []
  tools: []
  mcps: []
  hooks: [event-log]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: advisory
interactivity: Operator-triggered, on demand against one named project. Fully autonomous once launched — asks no questions, never blocks mid-run.
allowed-tools: [Read, Grep, Glob, Write]
disallowed-tools: [Edit, MultiEdit, NotebookEdit, Bash, WebFetch, WebSearch]
budgets: {}
---

# Project-Scoped Review

## Single responsibility

Audit ONE project's real end state against what it was supposed to become, and
report the drift. This codifies — as a re-runnable skill — the method the
2026-07 holistic review's end-state audit ran by hand (that worked example is preserved
in git history at `docs/investigations/2026-07-holistic-review/endstate-audit.md`; audit
outputs are written to the gitignored `docs/investigations/` working area, not committed). That audit found a genuinely-shipped, CI-green, fully-migrated
release that STILL had a silently-dead auth path and a broken protocol
manifest — gaps invisible to per-initiative review because no single
initiative owned "does the finished thing actually work end to end." This
skill is that missing check, made repeatable.

Not a planner, not a dev-loop, not a gate. A read-only analyst that runs
**after** work has landed, over the checked-out project tree plus forge's
records of what was promised.

## Why no execution tools

This skill is deliberately Read/Grep/Glob/Write only — no `Bash`, no network
tools. It cannot run `go build`, `go test`, `git describe`, `gh api`, or hit a
live endpoint. Where the source audit used a live command to settle a claim,
this skill instead:

- reads checked-in evidence (test files, CI workflow definitions, committed
  release manifests, CHANGELOG entries, `.git/refs/tags/*` and
  `.git/packed-refs` as plain files) and cites it, or
- if no static evidence resolves the claim, classifies it `unverifiable` and
  names the exact command a human or a Bash-enabled follow-up should run
  (§ Output contract, section 3) — it never asserts a verdict it cannot back
  with a file:line.

This mirrors `architect-completeness-critic` (judges text it's given, invents
nothing) and `project-brain-builder` (Read/Grep/Glob/Write, no Bash) — critics
that report, not agents that act.

## Inputs

Supplied in the launch prompt (the concrete transport — CLI flag, Studio form
— is out of this skill's scope; this is the interface contract):

- **project** (required) — a managed project id. Resolves to two locations,
  both inside the forge repo:
  - the working tree: `projects/<project>/` (code, tests, docs, release
    artifacts — read-only)
  - Brain 3: `brain/projects/<project>/` (`profile.md`, `themes/*.md`,
    `kb.yaml`) — the durable record of what forge already learned about this
    project
- **scope** (optional) — an initiative id, a list of initiative ids, or a date
  range narrowing which intents to audit. Default: every manifest in
  `_queue/done/` whose `project:` frontmatter matches, plus every theme file
  under `brain/projects/<project>/themes/`.

## Brain access — advisory, project-scoped only

Per [`brain/forge-dev/themes/brain-read-policy.md`](../../brain/forge-dev/themes/brain-read-policy.md):
planners (architect / PM / reflector) read Brain 1 + Brain 2 mandatorily; this
skill is not a planner. It may — advisory, not mandatory — read the target
project's own Brain 3 (`brain/projects/<project>/themes/*.md` +
`profile.md`) for prior-known context and to cross-check whether a past
reflection already flagged the same drift. It MUST NOT read Brain 1
(`brain/forge-dev/`) or Brain 2 (`brain/cycles/`) — forge-wide/cross-cycle
conventions are the planners' concern, not this skill's.

## Method

Distilled from the endstate-audit's four moves; run in order.

### 1. Inventory intents

Build one row per claim, each with its own source `file:line`:

- **Initiative manifests** — every `_queue/done/<initiative-id>.md` in scope:
  the stated GOAL, SCOPE (in), and each acceptance criterion.
- **Brain themes** — every `brain/projects/<project>/themes/*.md` in scope:
  any claim of a pattern, decision, or "this now works" statement.
- **Doc/release claims** — `projects/<project>/README.md`, `CHANGELOG.md`,
  `docs/**`, and any registry/release manifest (e.g.
  `terraform-registry-manifest.json`-shaped files): anything phrased as a
  present-tense capability claim ("supports X", "released", "N/N complete").

Do not paraphrase claims away from their source wording — quote or closely
paraphrase, and keep the exact `file:line`.

### 2. Verify each claim against the working tree

For each inventoried claim, look for confirming or contradicting evidence:

- **Code presence** — `Grep`/`Glob` for the claimed symbol, resource, schema
  attribute, or file; `Read` the surrounding lines to confirm it is *reached*
  (registered, wired, called), not merely declared or orphaned in dead code.
- **Test coverage** — does a test file assert the claimed behavior? Cite the
  test file:line. Absence of any asserting test is itself worth recording,
  not silently skipped.
- **Release/CI surface** — read committed CI workflow YAML, release manifests,
  checksums/signatures, and CHANGELOG entries directly. A tag ref file
  existing under `.git/refs/tags/` or `.git/packed-refs` is evidence a tag was
  cut locally; it is NOT evidence of a push or a published release — say so
  rather than overclaiming (the source audit's own headline correction was
  exactly this local-vs-remote distinction).
- **Internal consistency** — cross-reference every doc/theme claim against
  every OTHER doc/theme claim about the same surface. A CHANGELOG block that
  leads with "removed X" but still lists ten entries saying "served through
  X" below is a **drifted** finding on its own, independent of the code.
- **Execution-only claims** — if settling the claim requires running a
  command (`go build`, `go vet`, `go test`, `terraform validate`, a live API
  call), do not guess the outcome from proxies. Classify `unverifiable` and
  record the exact command.

### 3. Classify

Each claim gets exactly one verdict:

| Verdict | Meaning |
|---|---|
| `delivered` | Evidence confirms the claim; no contradiction found. |
| `drifted` | Partially true, stale, or internally inconsistent (works, but the record about it doesn't match, or matches only part of the original scope). |
| `missing` | Promised (initiative AC, theme, or doc claim); no evidence found anywhere in the working tree. |
| `contradicted` | Doc/schema/theme actively disagrees with what the code does (e.g., an attribute is declared and documented but never read). |
| `unverifiable` | Settling it requires executing a command this skill cannot run. Name the command. |

No claim may be classified without a citable `file:line` (or, for `missing`,
the search performed and its empty result — e.g. "grepped `<pattern>` across
`<dir>`, zero matches").

### 4. Prioritize the follow-up backlog

Rank `missing` and `contradicted` findings above `drifted`, ranked further by
user-impact: a silently-broken advertised capability (auth path never wired,
protocol mismatch that breaks first use) outranks a doc-hygiene mismatch
(stale CHANGELOG section header). Use the source audit's P0/P1/P2… ranking
convention as the model.

## Output contract

Write ONE markdown report per run:

```
docs/investigations/<YYYY-MM-DD>-<project>-endstate-review.md
```

If a report already exists for the same project and date (a same-day rerun),
write `-2`, `-3`, … — never overwrite a prior run's report. Required
structure (mirrors the source audit):

```markdown
# <project> — End-State Review (<YYYY-MM-DD>)

## 0. Scope
Project, initiative(s)/date range audited, which companion docs were read
(manifests / themes / README / CHANGELOG / release manifest — list each with
its path).

## 1. Scorecard
| # | Claim | Source (file:line) | Verdict | Evidence (file:line) |
One row per inventoried claim from Method §1-3. `Verdict` is exactly one of
the five values above.

## 2. Follow-up backlog
| Rank | Item | Why | Owner |
Ranked per Method §4. `Owner` is a plain description of who'd pick it up
(project work vs. a forge process fix) — do not invent a formal ownership
taxonomy beyond that distinction.

## 3. Unverifiable by this skill
One bullet per `unverifiable` claim: the claim, why it can't be settled by
Read/Grep/Glob, and the exact command a human or Bash-enabled follow-up
should run to close it.
```

## Event-log entries to emit

- `project-scoped-review.start`
- `project-scoped-review.claim-inventoried` (per claim added in §1)
- `project-scoped-review.claim-classified` (per verdict in §3)
- `project-scoped-review.report-written`
- `project-scoped-review.end`

## Constraints

- **Read-only over the project and the brain.** Never edit project code,
  never touch `_queue/`, never write brain theme files, never run a command
  or reach the network. The only file this skill writes is its own report.
- **No vibes.** Every scorecard row carries a `file:line` (or a documented
  empty-search) in both the Source and Evidence columns. A finding without
  one does not go in the report.
- **One report per run; never overwrite a prior run.** Reports accumulate as
  a history of a project's drift over time, same as
  `brain/cycles/_raw/` accumulates cycle archives.
- **Not a planner.** No Brain 1 (`brain/forge-dev/`), no Brain 2
  (`brain/cycles/`). Advisory reads of the target project's own Brain 3 only.
- **Not wired into any flow.** Launched directly by the operator against a
  named project, not dispatched by another phase and not a node on
  `forge-architect` / `forge-develop` / `forge-reflect`. No invocation module
  exists for it — it is registered for the composable roster (discoverability
  + a future generic on-demand launcher), not for in-cycle dispatch.
