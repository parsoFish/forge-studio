# Skills

> **Scope 2 — cycles / agents / flows** ([repo map](../docs/repo-map.md)). Every "agent" in forge is a Claude Code skill. See [ADR 003](../docs/decisions/003-skills-not-self-baked-agents.md).

## How to use

Skills are designed to be invoked from two surfaces:

1. **Interactive Claude Code session** — the user types `/architect` or `/reflector` in a Claude Code session and the skill takes over for that phase.
2. **Programmatic via the orchestrator** — `orchestrator/cycle.ts` and `loops/ralph/runner.ts` invoke skills via the Claude Agent SDK in unattended runs.

Both surfaces use the same `SKILL.md` — that file is the contract.

## Skill inventory (24 skills)

Skills group by their role in the autonomous cycle. The `library` frontmatter flag
marks whether an agent is surfaced in Studio's OOTB agent-builder library; internal
system skills carry `library: false`.

### Architect
| Skill | Surface | Purpose |
|---|---|---|
| [`architect`](./architect/SKILL.md) | interactive | Ideation session → a PLAN the operator reviews (carries the LLM-Council critic chain) |
| [`architect-completeness-critic`](./architect-completeness-critic/SKILL.md) | unattended | Adversarial completeness review of drafted manifests before they queue |
| [`instructions-creator`](./instructions-creator/SKILL.md) | interactive | Author a project's `AGENTS.md` |

### Project manager
| Skill | Surface | Purpose |
|---|---|---|
| [`project-manager`](./project-manager/SKILL.md) | unattended | Initiative → dependency-ordered work-item specs |

### Developer loop
| Skill | Surface | Purpose |
|---|---|---|
| [`developer-ralph`](./developer-ralph/SKILL.md) | unattended | Launch the Ralph loop for one work item |
| [`pre-impl-interview`](./pre-impl-interview/SKILL.md) | interactive | Interview the developer on a WI spec before any code |
| [`demo`](./demo/SKILL.md) | unattended | The demo contract every change must satisfy |
| [`handoff`](./handoff/SKILL.md) | both | Compress a session into a transfer document |

### Unifier
| Skill | Surface | Purpose |
|---|---|---|
| [`developer-unifier`](./developer-unifier/SKILL.md) | unattended | Treat the initiative as one PR; prove ACs; author demo + PR body |
| [`demo-builder`](./demo-builder/SKILL.md) | interactive | Author a project's reusable demo-generation skill |

### Review & audit
| Skill | Surface | Purpose |
|---|---|---|
| [`project-scoped-review`](./project-scoped-review/SKILL.md) | operator-triggered | Audit a project's end state vs the intents that produced it |

### Release finalisation
| Skill | Surface | Purpose |
|---|---|---|
| [`release-finalizer`](./release-finalizer/SKILL.md) | both | Finalise the release on the PR branch before merge |
| [`changelog-semver`](./changelog-semver/SKILL.md) | unattended | Compute the semver bump + finalised changelog entry |
| [`doc-updater`](./doc-updater/SKILL.md) | unattended | Refresh the docs a change touched |

### Reflection & brain
| Skill | Surface | Purpose |
|---|---|---|
| [`reflector`](./reflector/SKILL.md) | both | End-of-cycle retrospective → brain |
| [`brain-ingest`](./brain-ingest/SKILL.md) | unattended | Append raw sources; create/update theme pages |
| [`brain-lint`](./brain-lint/SKILL.md) | unattended | Brain structural integrity (invokes `forge brain lint`) |
| [`brain-query`](./brain-query/SKILL.md) | unattended | Brain lookup; the mandated first action of every planner |
| [`brain-fix`](./brain-fix/SKILL.md) | unattended | Apply one targeted fix to clear a brain-lint finding |

### Project onboarding (scope 3)
| Skill | Surface | Purpose |
|---|---|---|
| [`forge-onboard-project`](./forge-onboard-project/SKILL.md) | interactive | Bring a project up to the forge↔project contract |
| [`preflight-fix`](./preflight-fix/SKILL.md) | unattended | Apply one operator-approved preflight contract fix |
| [`project-brain-builder`](./project-brain-builder/SKILL.md) | unattended | Author a managed project's initial brain |
| [`demo-design`](./demo-design/SKILL.md) | operator-triggered | Generate per-project demo machinery |

### Maintenance
| Skill | Surface | Purpose |
|---|---|---|
| [`cruft-sweep`](./cruft-sweep/SKILL.md) | interactive | Rule-based, directory-by-directory cruft cleanup |

## Authoring conventions

Every `SKILL.md` follows the same shape:

```markdown
---
name: <skill-name>
description: <one-line>
phase: brain | architect | project-manager | developer-loop | review-loop | reflection
surface: interactive | unattended | both
model: claude-opus-4-7 | claude-sonnet-4-6 | claude-haiku-4-5 | default
---

# <Skill name>

## Single responsibility
<One paragraph.>

## Required first action
Invoke `brain-query` with: ...

## Inputs
- ...

## Outputs
- ...

## Event-log entries to emit
- ...

## Process
<Step-by-step. Brief.>
```

## Adding a new skill

1. Create `skills/<name>/SKILL.md` following the shape above.
2. Add a row to the inventory table here.
3. If it's used by the orchestrator, register it in `orchestrator/cycle.ts`.
4. Validate behaviour against real merged cycles (the `benchmarks/` harnesses were removed 2026-05-25).
