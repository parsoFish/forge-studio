---
id: contract
name: Contract
kind: file
producer: onboarding-agent
consumer: contract-check
schema: {}
---

# Contract artifact

The signal that the onboarding agent has finished converging a project
against the forge↔project contract (`docs/forge-project-contract.md`) and the
project directory is ready for the REAL, structural preflight check
(`runPreflight`, `cli/preflight.ts`) that `execOnboardPreflight` runs next.

Deliberately **schema-empty** (no `requiredFiles`): unlike the develop flow's
artifacts, this edge does not gate on one fixed on-disk path. The onboarding
agent's actual outputs (`.forge/project.json`, `.forge/contract-compliance-report.json`,
`AGENTS.md`/`CLAUDE.md`, the central `brain/projects/<name>/profile.md`) live
under the project's own repo root (`CycleInput.projectRepoPath`), not the
`.forge/…`/`demo/…`-under-worktree convention `resolveRequiredFile` assumes for
the develop flow's artifacts — asserting a specific path here would either
false-positive against the wrong root or require teaching the generic runtime
guard a second root-resolution convention for one flow. The REAL contract
check is `contract-check`'s own job (`runPreflight` reads the project
directory directly and reports every clause); this artifact exists so the
edge has a registered template (`forge studio lint`'s `artifact/no-template`
rule) and so the flow graph documents the real producer → consumer
relationship, not to duplicate `runPreflight`'s own verdict.

- **Producer:** `onboarding-agent` — converges the project toward
  contract-green (`skills/onboarding-agent/SKILL.md`).
- **Consumer:** `contract-check` — the `onboard-preflight` band's declaration
  carrier; the REAL check is orchestrator-run (`execOnboardPreflight`), not
  agent-run (ADR-036).
