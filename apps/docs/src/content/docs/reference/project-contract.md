---
title: Project contract
description: "What a project must provide before forge works on it unattended: .forge files, test tiers, preflight clauses, and what forge preflight reports."
type: reference
owner: parsoFish
last_verified: 2026-10-09
covers: [packages/projects/**, apps/forge/cli.ts, studio/starters/**]
---

The project contract is what a project provides so forge can develop it unattended. `forge preflight <project>` checks it.

## Shape

A project has two faces and one verdict.

- **Authoring face.** The fields you declare in `.forge/project.json`: north star, instructions, demo process, bound skills, bound Knowledge. Studio shows these in the project builder.
- **Operational face.** The preflight clauses. Studio marks a project flow-ready only when both faces pass.

Hard clauses decline the run: forge refuses to start and names the clause. Advisory clauses warn and never change the verdict. A claim needs the same verdict Studio shows, including `DEPS` (the gate command is runnable at head): a project Studio marks not flow-ready is refused, naming each failing field or clause. The authoring face needs a north star of at most 140 characters, instructions, a demo with at least one capture and one verify step, at least one bound skill, and bound Knowledge.

What a project provides:

| What | Where |
|---|---|
| Contract configuration | `.forge/project.json` in the project |
| Gate command sidecar (optional) | `.forge/quality_gate_cmd` |
| Project-local skills (optional) | `.forge/skills/<id>/SKILL.md` |
| A roadmap | `roadmap.md` in the project root |
| An instruction file | `AGENTS.md` or `CLAUDE.md` in the project root |
| A `.gitignore` covering forge scratch | project root |
| A Knowledge profile | `brain/projects/<name>/profile.md` in the forge checkout |

The Knowledge profile is forge-owned. Adding the project in Studio creates it.

## Fields

The fields of `.forge/project.json` are in that file's schema; the project builder in Studio edits them. The ones the contract depends on:

| Field | Type | Default | Description |
|---|---|---|---|
| `northStar` | string, at most 140 chars | none | One-line objective. Required for Studio readiness. |
| `instructions` | string | none | Standing rules for every planning prompt. Required for readiness. |
| `demoProcess` | list | none | Steps of kind `capture`, `verify`, `present`. Needs at least one `capture` and one `verify`. |
| `skills` | list of slugs | none | Skills bound to the project. Required for readiness. |
| `kb` | string or null | none | Bound Knowledge base id. Required for readiness. |
| `testProcess.local.cmd` | argument list | none | The fast per-work-item gate. Required. |
| `testProcess.local.perWorkItem` | argument list | none | Template with one `{package}` placeholder for a work item's omitted gate. |
| `testProcess.local.timeoutMs` | number | 30 min | Gate timeout. `FORGE_GATE_TIMEOUT_MS` wins. |
| `testProcess.ci` | map | none | The full CI mirror: `cmd`, `fixCmd`, `unsetEnv`, `timeoutMs`. |
| `testProcess.acceptance` | map | none | The live tier: `match`, `requiresEnv`. |
| `buildProcess` | map | none | `local` build command and `remote` CI workflow path. |
| `releaseProcess` | map | none | Opt-in release steps, `changelogPath`, `versionFile`, `docsDir`. |
| `artifactRoot` | relative path | `.` | Where the in-repo demo is written. |
| `repo` | `owner/name` | none | Maps GitHub events to this project. |

### Test tiers

| Tier | Key | What it is | Runs |
|---|---|---|---|
| Local | `testProcess.local` | One command that is green at HEAD, fast, and needs no live system. | After each work-item iteration. |
| CI | `testProcess.ci` | Your full CI command. It may chain commands. | Once, as the final gate before a PR opens, with `unsetEnv` variables stripped. |
| Acceptance | `testProcess.acceptance` | A live-system suite, for projects whose behaviour only a real system can prove. | As a work item's own gate. Planning fails if the change class requires this tier and no work item carries a gate containing `match`. A gate that runs with a `requiresEnv` variable unset errors instead of passing. |

### Preflight clauses

| Clause | Kind | Passes when |
|---|---|---|
| `C1` | hard | A gate exists: one command, no `&&`, `;` or pipes, no `playwright`, `cypress`, `e2e` or `integration` in it. A package-manager gate needs a `package.json` with that script. |
| `C2` | hard | Scratch files (`.forge/work-items/`, `.forge/.create-complete`, `.forge/live-evidence/`, `.forge/preflight.json`, `AGENT.md`, `PROMPT.md`, `fix_plan.md`) is not tracked and is ignored, and `.forge/project.json`, `.forge/quality_gate_cmd` and `.forge/skills/` are not ignored. Checked with git, not file text. |
| `C4` | hard | `roadmap.md` and the Knowledge profile both exist. |
| `SKILLS` | hard | Every declared skill resolves to a `SKILL.md` in `.forge/skills/<id>/`, the forge `skills/` directory, or under `artifactRoot`, and a project-local one is tracked by git. |
| `DEPS` | hard | A gate that needs `node_modules` has it provisioned. |
| `C1b` | advisory | `testProcess.ci` is declared. |
| `C5` | advisory | A `CLAUDE.md`, `AGENTS.md`, `.forge/constraints.md` or `CONSTRAINTS.md` exists. |
| `C6` | advisory | `origin` is a GitHub remote. |
| `C7` | advisory | Informational. Enforced at planning, not here. |
| `C8` | advisory | `AGENTS.md` or `CLAUDE.md` exists and mentions the gate command. |
| `C10` | advisory | A declared `releaseProcess` has its changelog, version and docs paths. |
| `DEMO`, `DEMO-SKILL`, `DEMO-ALIGN` | advisory | The demo process has capture and verify steps, drives a runnable command, and references the test process. |
| `BUILD`, `ARTIFACTS` | advisory | A declared build workflow exists; build output is ignored by git. |
| `BRAIN` | advisory | The Knowledge profile is filled in, not the all-TODO stub forge seeds, and Knowledge themes cite source paths that still exist. |

`forge preflight`, Studio's Contract Readiness verdict and the claim check all include `DEPS`.

## Examples

A minimal `.forge/project.json` that passes the authoring-face and gate checks:

```json
{
  "name": "demoproj",
  "northStar": "A small demo project.",
  "instructions": "Run npm test before finishing.",
  "demoProcess": [
    { "kind": "capture", "text": "Capture the test output before the change." },
    { "kind": "verify", "text": "Run npm test and show it passing." }
  ],
  "skills": [],
  "kb": null,
  "testProcess": { "local": { "cmd": ["npm", "test"] } }
}
```

Check a project by name (under `projects/`) or by path:

```bash
forge preflight demoproj
```

Output, abridged:

```text
forge preflight — demoproj  (/path/to/demoproj)

  PASS  C1 Fast, trustworthy quality gate
        testProcess.local.cmd: "npm test" (single command, no slow-suite marker)
  WARN  C1b CI merge-boundary net (testProcess.ci)
        no testProcess.ci declared — ...
  FAIL  C4 Machine-readable architecture context
        missing brain/projects/<name>/profile.md ...

CONTRACT NOT MET — forge declines. Failing hard clause(s): C4.
```

## Limits

- `forge preflight` exits 0 when every hard clause passes, 1 when one fails, and 2 for a missing or unknown project. Warnings never change the exit code.
- Every run appends a `preflight.verdict` line to `_logs/preflight/verdicts.jsonl`.
- Preflight reads files and git. It never runs your gate.
- A `.forge/project.json` that fails to load fails `C1` with the load error.
- Flat gate keys such as `quality_gate_cmd` in the JSON are rejected; declare `testProcess`.
- A project that declares no skills passes `SKILLS`.
