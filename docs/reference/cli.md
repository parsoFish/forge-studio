# Forge CLI reference

> Committed equivalent of `forge --help`. Forge Studio (the bridge/UI,
> [ADR 031](../decisions/031-studio-consolidation.md)) is the **sole operator
> surface**; the CLI is scaffolding, the unattended daemon, and phase/skill entry
> points. Regenerate this page from `forge --help` whenever the surface changes.

## `forge --help`

```
forge — autonomous multi-agent orchestrator

Usage:
  forge init                              Scaffold a runnable install (forge.config.json + _queue/ layout) and check the environment
  forge studio [--bridge-only] [--no-open] [--bridge-port <n>] [--ui-port <n>] [--ready-file <path>]
                                          Bring up the forge operator UI — the SOLE operator surface (DEC-6).
                                          Run a cycle, review/approve, recover a stuck initiative, inspect cost +
                                          events + artifacts: all in the browser. Foreground (Ctrl-C quits).
                                          Defaults: bridge=4123, ui=4124 (fixed ports — re-runs take over any
                                          previous forge process so a pinned browser tab auto-reconnects).
  forge studio lint                       Validate studio definitions (agents/flows/catalog/kb); exit non-zero on errors

S9/DEC-6: the CLI is retired as the operator surface. Cycle management, review, and
recovery (cycle / enqueue / metrics / review / report / log / requeue) now live in the
UI + the bridge API (POST /api/runs, /api/verdict, /api/recovery/:id, /api/initiatives).
Run `forge studio` and drive everything from the browser.

For phase-implementation guidance see docs/phases/. For decisions see docs/decisions/.
```

## Other verbs (daemon, scaffolding, phase entry points)

Beyond the operator surface above, the CLI dispatcher (`orchestrator/cli.ts`) also
resolves these. They are used by the scheduler, in CI/headless runs, and for manual
phase invocation — not day-to-day operator commands.

| Verb | Purpose |
|---|---|
| `forge serve [--once]` | Run the unattended scheduler in the foreground (the daemon). `--once` drains a single claim and exits — CI/headless. |
| `forge preflight <project>` | Check a managed project against the forge↔project contract ([ADR 034](../decisions/034-studio-aligned-contract.md)). |
| `forge brain lint` | Structural integrity checks on `brain/` (exit non-zero on errors). |
| `forge brain index [--write]` | Regenerate `brain/INDEX.md` from the filesystem (`--write` persists it). |
| `forge architect` | Architect-phase entry point (the interactive ideation runner). |
| `forge instructions` | Run the `instructions-creator` skill to author a project's `AGENTS.md`. |
| `forge demo-builder` | Run the `demo-builder` skill to author a project's demo-generation machinery. |
| `forge demo` | Demo-phase entry point (author/inspect a cycle's demo bundle). |
| `forge project-brain` | Run the `project-brain-builder` skill to author a managed project's initial brain. |

Retired verbs (`cycle`, `enqueue`, `metrics`, `review`, `report`, `log`, `requeue`,
`status`) now live in the UI + bridge API — see the retirement note in `forge --help`
above and [CHANGELOG.md](../../CHANGELOG.md).
