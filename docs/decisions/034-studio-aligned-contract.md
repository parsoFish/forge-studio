# ADR 034 — Studio-aligned project contract: unified readiness, artifactRoot, history convention

**Status:** Accepted — 2026-06-17

**Extends:** [ADR-017](./017-forge-project-contract.md) (the original preflight
contract). ADR-017 remains the authority for the derivation of C1–C6 from the
trafficGame arc; this ADR records the Studio-driven additions and the unified
readiness model.

**Relates to:** ADR-027 (Studio object model — introduces the five project fields
this ADR promotes to contract status); ADR-033 (first-flow UX — establishes
in-UI onboarding and the `ContractReadiness` panel this ADR defines).

---

## Context

ADR-017 (2026-05-17, amended 2026-05-31) defined the forge↔project contract as a
set of preflight clauses (C1–C8, DEMO, BRAIN) checked by `forge preflight`.
ADR-027 (2026-06-13) introduced the Studio object model and extended
`.forge/project.json` with five new first-class fields: `northStar`,
`instructions`, `demoProcess`, `skills`, and `kb`. ADR-033 (2026-06-16) built the
`ContractReadiness` panel in the project builder UI, which checks these five fields
independently of `forge preflight`.

By June 2026 the contract existed in two separate places that were checked
separately and could contradict each other:

1. **`forge preflight`** — checked C1–C8 + DEMO + BRAIN against the filesystem.
   A project could be preflight-green but have no `northStar`, empty
   `demoProcess`, no bound skills, and no KB.

2. **`ContractReadiness` UI panel** — checked the five Studio fields only. A
   project could be "Studio-ready" (all five filled in) but have a broken
   `quality_gate_cmd` or an un-ignored forge scratch dir.

The result: "is this project contract-ready?" had two different answers depending
on which surface you asked. Neither was the whole truth. A flow run could be
blocked by preflight even after the UI declared the project ready, or vice versa.

Commit 1ba05f6 (2026-06-17) closed the gap by making `ContractReadiness` combine
both checks: `data-flow-ready="true"` now requires all five Studio-field checks
AND zero failing HARD preflight clauses. This ADR records the unified model, the
promotion of `artifactRoot` to a first-class contract element, and the
development-history convention that `artifactRoot` enables.

---

## Decision

### 1. The contract is ONE unified surface with two faces

The forge↔project contract has two faces that converge into a single readiness
verdict:

**Face A — Studio object fields** (in `.forge/project.json`, edited in the UI):
`northStar`, `instructions`, `demoProcess`, `skills`, `kb`. These describe the
project as an authoring object — its identity, its agent directives, its demo
protocol, its bound tooling.

**Face B — Operational clauses** (checked by `forge preflight`): C1–C9, DEMO,
ARTIFACTS, BRAIN. These describe the project as an execution substrate — the
structural properties that make unattended development safe.

A project is **flow-ready** only when both faces pass. The `ContractReadiness`
component enforces this:

```
allReady = uiAllReady && preflightOk
data-flow-ready = allReady ? "true" : "false"
```

Where `uiAllReady` is all five Studio-field checks green, and `preflightOk` is
`preflight !== null && hardFailures.length === 0`.

### 2. Studio-field requirements (Face A)

Each Studio field has a minimum readiness threshold:

| Field | Threshold | Rationale |
|-------|-----------|-----------|
| `northStar` | Non-empty, ≤ 140 chars | The planner's primary objective anchor |
| `instructions` | Non-empty string | Project-specific PM directives; absence = no constraints |
| `demoProcess` | ≥ 1 capture + ≥ 1 verify step | Closes the `demo.skill` gap (ADR-027); evidence must be non-trivial |
| `skills` | ≥ 1 bound slug | Confirms intentional tooling selection |
| `kb` | Non-null string | Confirms Brain 3 is wired; planners read through the KB seam |

These are validated in `ContractReadiness.tsx` (UI) and structurally in
`validateProjectConfig` (loader throws on type violations; UI-level emptiness is
the business-level check). The `demoProcess` requirement supercedes the
previously open `demo.skill` gap in `docs/known-gaps.md`.

### 3. `artifactRoot` is a first-class contract element

`artifactRoot` (type: clean relative path string, default `"."`, optional) is the
project-relative subdirectory under which a project's **committed** forge artifacts
live:

- `<artifactRoot>/brain/` — Brain 3 (the project's KB)
- `<artifactRoot>/history/<initiative-id>/` — the development history store

> **Amended by [ADR 035](./035-forge-owned-central-artifacts.md) (2026-06-20):** Brain 3 and durable history are now **forge-owned and central** (`brain/projects/<name>/` + `_logs/<cycleId>/artifacts/`); `artifactRoot` now scopes only the in-repo in-PR demo (`<artifactRoot>/history/<id>/demo`) and project skills (`<artifactRoot>/skills/`). The `<artifactRoot>/brain` paths in this section (and the preflight C4/BRAIN note below) describe the pre-035 model.

**What it does NOT affect:** runtime/session scratch (`.forge/work-items/`,
`_architect/`, `demo/<id>/`). Scratch location is unchanged regardless of
`artifactRoot`.

**Validation:** `parseArtifactRoot` rejects leading `/`, leading `\`, `..`
segments, and backslashes. The empty string and `"."` are both normalised to
`undefined` (callers default to `"."`). Existing projects without the field
continue to work exactly as before.

**Usage in preflight (C4, BRAIN):** `cli/preflight.ts` reads `artifactRoot` via
`readArtifactRoot(dir)` (`orchestrator/brain-paths.ts`) and constructs brain
paths as `<artifactRoot>/brain/profile.md` and `<artifactRoot>/brain/themes/`.

**Why it matters:** before `artifactRoot`, every project was required to expose
`brain/` at its root. A project that wanted to namespace its forge artifacts
(e.g. a project where the repo root is shared with other tooling) had no clean
option. `artifactRoot: "forge"` lets such a project gather `forge/brain/` and
`forge/history/` under a single visible subtree without any special forge logic.

### 4. Development-history convention

Every initiative should leave a **browsable, committed record** at
`<artifactRoot>/history/<initiative-id>/` containing:

- `plan.md` — the initiative brief and approach as authored by the architect/PM
- `demo/` — the demo evidence produced by the unifier (the output of `demoProcess` steps)
- `verdict.json` — the operator's approve/send-back verdict (`_logs/<cycleId>/artifacts/verdict.json` is the live write; the project copy is the committed record)

This is a **convention, not forge hard-code**. Forge provides:
- The `artifactRoot` path as a consistent anchor.
- The `demoProcess` field describing how to populate `demo/`.
- The `verdict.json` write (via `writeVerdictJson` in `flow-runner`) as a durable log.

The project's own `instructions` field and `AGENTS.md` direct agents to write
`plan.md` and copy `demo/` into the worktree before committing. The convention
lands in the PR and is committed to the project repo, building a browsable history
of what forge built and why. This fulfils the operator goal "showcase the history
of project development through plans and demos" without adding forge-side coupling
to a specific directory structure.

### 5. Readiness convergence is the single gate

The flow engine's `claim-time gate` (ADR-011, scheduler) consults the preflight
verdict; the Studio UI's `ContractReadiness` panel is the operator-facing view of
the same gate. Both must be green. The `data-flow-ready` attribute is the
machine-readable signal for the e2e harness (`scripts/e2e-journey.mjs` checks it).

---

## Consequences

**Positive:**

- "Is this project contract-ready?" now has one answer, visible in one place, with
  one enforcement point per face. The bifurcation between Studio UI and preflight
  is closed.
- The `demoProcess` requirement closes the `demo.skill` known-gap (tracked since
  2026-05-31): live-external demo evidence is now declared in a typed, validated
  structure rather than a prose `AGENTS.md` convention.
- `artifactRoot` is backwards-compatible: no existing `project.json` needs to
  change. The field is optional; `"."` is the identity default.
- The history convention creates a per-project, git-native record of forge's work
  that is inspectable without access to `_logs/` (which is gitignored).
- The unified enforcement table in `docs/forge-project-contract.md` is now the
  single reference; operators no longer need to reconcile two sources.

**Negative / accepted trade-offs:**

- The five Studio-field checks in `ContractReadiness` are currently UI-only (not
  re-run at claim time in the scheduler). Accepted: the scheduler's preflight gate
  (C1–C8 + DEMO) is sufficient to block an unready project; the Studio-field
  checks are an authoring-time UX gate, not a runtime safety gate. If a project
  bypasses the UI (e.g. by hand-editing `project.json`), it may pass the scheduler
  but fail in the PM (no `instructions`) or unifier (empty `demoProcess`). This
  is an accepted trade-off; promoting Studio-field checks to the scheduler is a
  future hardening step.
- The history convention is advisory: forge cannot enforce that a project's agents
  actually write `history/<id>/plan.md` without a post-commit check that doesn't
  exist yet. A project whose `instructions` omit the convention silently skips it.
- C9 and the C1b discrimination check remain hand-verified at onboarding; no
  machine-check is added here. Tracked in `docs/known-gaps.md`.

---

## Alternatives considered

**Keep Studio fields and preflight as separate independent gates.** Rejected. The
two-gate model is the current state that this ADR fixes: an operator sees "Studio
ready" and then hits a preflight hard-fail mid-cycle, or sees "preflight green"
and then gets an empty `demoProcess` at review time. Neither gate alone is
sufficient; combining them is the minimal change.

**Enforce `artifactRoot` as required (no default).** Rejected. Every existing
managed project (`betterado`, `claude-trail`) uses the legacy `brain/` at root
layout. Making the field required would break C4 for every existing project.

**Hard-code the history convention as forge code (`history/<id>/` written by the
flow runner).** Rejected. This would make the convention non-optional for every
project and would require forge to decide what goes in `plan.md` — a document
whose content is the architect/PM's responsibility. Keeping it as a convention
enforced by the project's own `instructions` preserves the project-side authoring
model (ADR-024: phases are agents composing skills; the project's skills own the
project's conventions).

---

## References

- [`docs/forge-project-contract.md`](../forge-project-contract.md) — the unified contract document (rewritten by this ADR).
- [ADR-017](./017-forge-project-contract.md) — the original contract (C1–C6 derivation from trafficGame). This ADR extends it; ADR-017 is not superseded.
- [ADR-027](./027-studio-object-model.md) — the Studio object model that introduced the five project fields.
- [ADR-033](./033-studio-first-flow-ux.md) — first-flow UX; the `ContractReadiness` panel.
- [`orchestrator/project-config.ts`](../../orchestrator/project-config.ts) — `ProjectConfig` type + `validateProjectConfig` + `parseArtifactRoot`.
- [`cli/preflight.ts`](../../cli/preflight.ts) — operational-clause enforcement; reads `artifactRoot` via `readArtifactRoot`.
- [`forge-ui/components/studio/project-builder/ContractReadiness.tsx`](../../forge-ui/components/studio/project-builder/ContractReadiness.tsx) — the unified readiness panel (`data-flow-ready`).
- [`orchestrator/brain-paths.ts`](../../orchestrator/brain-paths.ts) — `readArtifactRoot` (the `artifactRoot` resolver used by both preflight and the brain loader).
