---
name: forge-onboard-project
description: Bring any code project up to the forge↔Studio project contract so forge can develop it unattended at roadmap scale. Use before pointing forge at a new or not-yet-primed managed project. Works for any form — UI app, HTTP API, library, CLI, monorepo, infra provider — by authoring the project as a Studio object, mapping each operational contract invariant onto that project's shape, then validating (forge preflight + UI readiness) and handing off a roadmap-scale initiative. The contract spec is docs/reference/project-contract.md (ADR-034).
library: true
---

# Onboard a project to the forge↔Studio contract

Forge develops a project as an **unattended loop** (plan → change → verify →
package → review → merge) with no human in the inner loop. Onboarding makes the
guarantees a human would otherwise provide **structurally true of the project**.
Those guarantees are the contract in `docs/reference/project-contract.md` (ADR-034) —
read it first; this skill operationalises *getting a project there*.

The contract now has **two faces that must both be green**:
- **Face A — the Studio object** (`.forge/project.json`, authored/edited in the UI
  project builder, checked by `ContractReadiness`): `northStar`, `instructions`,
  `demoProcess`, `skills`, `kb`.
- **Face B — the operational clauses** (`forge preflight`), grouped by the six
  processes (test / demo / instructions / release / build / kb) — see the
  process table in `docs/reference/project-contract.md` for the clause map.

A project is **flow-ready** only when both are satisfied (the UI's
`data-flow-ready` requires all five Studio-field checks AND zero failing hard
preflight clauses). Don't shrink the eventual initiative to dodge a gap — fix the
gap; the target is roadmap-scale decomposition.

## Procedure

### Step 0 — Secrets, before anything else
If the project carries any creds/secret file, **gitignore it and verify by exit
code** (`git check-ignore -q <file>`). Map its keys to the env vars the app reads;
prove them with one read-only live call.

### Step 1 — Choose the committed-artifact home (`artifactRoot`)
Decide where the project's COMMITTED forge artifacts live. `artifactRoot` now scopes
**only** the in-repo demo + project-action skills — default, shape, path rules and
the ADR 035 forge-owned/central split are the `artifactRoot` field's own contract
(`docs/schemas/project-config.schema.json`, enforced by `validateProjectConfig`).
Runtime scratch (`_architect/`, worktree `demo/<id>/`, `.forge/` runtime dir) stays
gitignored regardless.

### Step 2 — Author the project as a Studio object (Face A)
Set in `.forge/project.json` (or via the UI project builder):
- `northStar` — one-line mission (≤140 chars).
- `instructions` — positive standing directives ("what TO do") injected into every
  agent; reference the project's conventions, the skill paths, and the history
  convention.
- `demoProcess` — typed steps with ≥1 `capture` and ≥1 `verify` (a `present` is
  good too) describing how the behavioural delta is shown.
- `skills` — the project-action skill slugs (Step 6).
- `kb` — the bound knowledge base id (the project brain).
ContractReadiness checks these five; all must pass for flow-ready.

### Step 3 — Assess the operational clauses (Face B)
Run `forge preflight <project>`. Then **manually check the
facets preflight does not enforce**:
- C1 *discrimination*: run the gate on a clean tree — it must **fail** (no work
  yet). If it passes, it's hollow and is rejected at iter-0.
- C2 *hermeticity*: build, then `git status` — anything but intended source is a gap.
- C1b *CI alignment*: the per-WI gate must be the CI command or a strict subset it
  subsumes (`testProcess.ci.cmd`) — never narrower than the project's merge bar.
- DEMO *fidelity*: run the demo on baseline vs HEAD and eyeball that it captures the
  delta, not just that a shape exists.
- C9 *fixtures*: non-default values for every field under test, create/update
  verified via a separate read-back call.
Record every gap; the rest closes them.

### Step 4 — Truthful done-signal (C1)
A gate that is fast, deterministic, green at HEAD, and **scoped to the unit of
change** (empty ⇒ fail / real-work ⇒ pass). Map to the form (UI render test • API
contract test • library/CLI unit test • monorepo package-scoped gate — never a
repo-wide wildcard). Declare as ONE command in the `.forge/quality_gate_cmd`
sidecar and/or `testProcess.local.cmd` in `.forge/project.json` (precedence rule:
`docs/schemas/project-config.schema.json`). Verify fail-then-pass by hand. If one command cannot
express the gate, commit a gate script authored from
the [Gate scripts](../../docs/reference/project-contract.md#gate-scripts)
section of the project contract — never
bare `! cmd` asserts (errexit-exempt: their failures silently don't fail the
gate).

### Step 5 — Hermetic change-capture (C2)
`.gitignore` so `git add -A` captures only intended source: forge scratch (the
exact path list — `SCRATCH_PATHS` — is `forge preflight`'s C2 check, ADR 017),
build artifacts + generated output (binaries, bundles, coverage). Never a
blanket `.forge/` line: `.forge/project.json`, `.forge/quality_gate_cmd`, and
`.forge/skills/` (`TRACKED_CONFIG_PATHS`) must stay trackable — C2 fails a
`.gitignore` that ignores any of them, no `git add --force` needed (operator
ruling 92). Acceptance: clean build ⇒ `git status` shows nothing but intended
source.

### Step 6 — Project-action skills (under `.forge/skills/<id>/`)
Capture the project's recurring actions as skills forge agents read by path:
e.g. scaffold a resource, explore an API, run the demo, refactor a schema. The
resolver scans the fixed path `.forge/skills/<id>/SKILL.md` — one level deep,
regardless of `artifactRoot`. Bind them via `skills` in `.forge/project.json`
and reference their paths in the agent-instruction file. These are the
"consistent actions forge takes" on this project.

### Step 7 — Prime the brain & roadmap (C4)
Author `roadmap.md` (project root); the brain profile is **forge-owned and central**
at `brain/projects/<name>/profile.md` (+ any `themes/`) in the forge repo (ADR 035),
not authored in the project repo. **Correct stale facts** (renamed paths, dead conventions) — a
wrong brain misleads the planner worse than an absent one. The profile is the
queryable structure the PM/architect reads first.

### Step 8 — Untouchables, merge model, instruction file (C5/C6/C8)
An operator-owned `AGENTS.md` (canonical single source; legacy projects may keep a
`CLAUDE.md`) at the project root with **exact build/test/lint invocations near the
top** + positive directives + the skill paths + the history convention. Forge never
auto-authors it *unattended* — the Studio **instructions-creator** drafts it through
an operator-confirmed interview (the human approves before it is written and owns
the result; the Studio `instructions` field binds to this one file). Confirm a
GitHub remote and that PRs won't need to stack.

### Step 9 — Committed development-history convention
Every initiative leaves a browsable record: only the in-PR demo evidence lands at
`<artifactRoot>/history/<initiative-id>/demo/` in the project repo, while the plan
(`plan.md`) + verdict + durable history are **forge-owned** in `_logs/<cycleId>/artifacts/`
(ADR 035). The project's `instructions` + agents write the demo into the worktree as
part of the work so it lands in the PR and is committed.
This is a project-side convention (forge does not hard-code it) — state it in the
instruction file and back it with a `present` `demoProcess` step.

### Step 10 — Demo-ability (the demo declaration drives capture)
The review phase must *show* the operator the one behavioural delta. Declare
`demoProcess` in `.forge/project.json` with ≥1 `capture` step and ≥1 `verify`
step describing what evidence to record and what assertion makes it non-trivial.
`demoProcess` is the SOLE cycle-time demo input: **each `capture` step's
inline-code span (`` `like this` ``) IS the command the integrate band runs**
before/after, so it must name a real, bare-argv command — no shell
metacharacters (pipes, redirects, `&&`, backticks, globs, …), since capture
spawns it directly with no shell. `forge preflight`'s `DEMO-SKILL` clause
checks exactly this: that at least one `capture` step yields such a command —
never that any generated file exists. **Confirm `forge preflight <project>`
reports `DEMO-SKILL` ✓ — i.e. at least one capture step names a drivable
command — before considering onboarding done.**

Optionally, run the `demo-builder` session afterwards to author a presentation
composer (`.forge/skills/demo-design/SKILL.md`) that renders a rich,
Forge-styled HTML view of each initiative's captured evidence for the Studio
demo page — it assesses the right presentation form (portal/browser
screenshot opportunistically when a renderable surface exists, harness
metrics when a measurement command exists, live external API round-trip when
the code calls a live system, JSON-diff/notes-only by default). That composer
is presentation guidance ONLY, never a cycle input — bead forge-mfv5.2.8
tracks folding the session's own output into the `demoProcess` declaration
more directly.

### Step 11 — External-resource model (C7, only if needed)
If behaviour can only be verified live: a creds-free in-loop gate (mocks/in-process)
plus a confirmation layer (create→confirm→destroy, prefixed/randomized names,
orphan sweep, creds out-of-band → env). Make the per-WI testing contract structural
via three `.forge/project.json` fields — `testProcess.acceptance.{match,required,
requiresEnv}`, `standing_work_item_acs`, `testProcess.ci.unsetEnv` — each field's
exact contract is `docs/schemas/project-config.schema.json` (C7, ADR 017 amendment
2026-05-31).
Compose the project linter into the live-acc per-WI gate (its gate is the acceptance
test, which omits lint). Enforce C9 on the live tier: UUID-prefixed resources,
teardown on success AND failure, a `PreCheck` that `t.Fatal`s on absent creds, a
read-back assertion on every written field.

### Step 11.5 — Release process & CI release workflow (C10, only if the project releases)
If the project ships versioned releases (a library, CLI, provider, or any package
consumers depend on a version of), opt into the release flow by declaring
**`releaseProcess`** in `.forge/project.json` (see
`studio/starters/project.json.example`; each field's exact contract —
including that tag/publish are CI's job, never a forge step kind — is
`docs/schemas/project-config.schema.json`, C10):
- **`changelogPath`** — the changelog file (default `CHANGELOG.md`). Seed it with a
  `## [Unreleased]` heading if absent.
- **`steps`** — at minimum a `changelog`/`in-cycle` step (the DRAFT every WI writes)
  and the `pre-merge` steps the finaliser runs (doc regen, version bump). Map each
  to the project's real tool (the `command`).
- **`versionFile` / `docsDir`** — where the version lives and where docs live.

Then **install the release CI workflow**: copy
`studio/starters/release-workflow.yml.example` to
`<project>/.github/workflows/release.yml`, fill the two TODO knobs (how to read the
committed version; optional publish). The forge release-finalizer commits
the finalised changelog + version bump to the PR branch before merge; the workflow
tags + releases on merge.

Map the release process: draft (in-cycle) + finalise (pre-merge) + the CI workflow
must all be present for the clause to be satisfied.

### Step 12 — Validate, then hand off roadmap-scale
Both faces green: `forge preflight` passes (hard clauses) AND the UI readiness shows
flow-ready; the gate verified fail-then-pass on a clean tree; a hermetic build. Then
give forge a **multi-feature, roadmap-scale** initiative (the roadmap decomposed).
Watch the first cycle; if it misbehaves, diagnose the contract gap rather than
narrowing scope.

## Done = the project meets both faces of the contract
A project that is flow-ready (preflight hard clauses + the five Studio-field checks),
its committed forge artifacts homed under `<artifactRoot>/`, the brain accurate, the
history convention in place — ready for forge to decompose roadmap-scale work.
