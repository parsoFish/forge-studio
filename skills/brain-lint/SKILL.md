---
name: brain-lint
description: Structural integrity checks on the brain — frontmatter, index sync, source links, staleness, orphans, length cap, contamination, contradictions. Thin invoker of `forge brain lint`.
library: true
phase: brain
surface: unattended
model: claude-haiku-4-5
---

# Brain — Lint

> The single source of truth for what brain-lint does is the executable
> `brain-lint.ts` (CLI: `forge brain lint`). This skill is a
> **thin invoker** — it runs the CLI, parses the output, and writes the
> cycle-scoped report. The rules live in [`brain/LINT.md`](../../brain/LINT.md).

## Single responsibility

Run `forge brain lint` against the brain corpus, write the cycle-scoped
report `_logs/<cycle-id>/brain-lint.md`, and emit the lint event-log
entries below. Do not re-derive checks — the executable owns them.

## Required first action

Invoke the executable. From the forge root:

```bash
forge brain lint --scope <scope> [--project <name>] [--file <path>] [--cycle <id>]
```

Scopes (per CONTRACTS.md C7): `full | forge-only | project-only |
single-file | cycle-touched-themes | cleanup-dry-run`. Default is `full`.

## Inputs

- `brain/` filesystem state.
- Scope flag selecting how much of the corpus to walk.

## Outputs

- stdout from `forge brain lint` — ERRORS / FLAGS / AUTO-FIXES sections + a one-line summary.
- `_logs/<cycle-id>/brain-lint.md` — categorised report (the skill writes this from the executable's output).
- Append a one-line summary entry to `brain/forge-dev/log.md` per the cleanup playbook in plan 01.

## Event-log entries to emit

- `brain-lint.start` — with scope.
- `brain-lint.auto-fix` — one event per auto-fix applied (currently a stub — `--fix` mode is conservative).
- `brain-lint.flag` — one event per ambiguity flagged for human review.
- `brain-lint.error` — one event per rule violation that can't be auto-fixed.
- `brain-lint.end` — summary counts + exit code.

## Process

1. **Invoke the CLI** with the appropriate `--scope`.
2. **Capture stdout** + exit code.
3. **Write the cycle-scoped report** at `_logs/<cycle-id>/brain-lint.md` mirroring the stdout sections.
4. **Append one line** to `brain/forge-dev/log.md` per the cleanup playbook: `## [<date>] lint pass — N error, M flag, K auto-fix`.
5. **Emit the event-log entries** above so the operator can grep cycle logs.

## Constraints

- **Single source of truth.** Do not reimplement any of the checks. If a check needs improving, change `brain-lint.ts` (with a test added first per the test-first discipline used to build it).
- **Never delete content.** Lint may flag or auto-fix structurally (index sync). Deletion is `brain-ingest` territory.
- **Conservative on auto-fix.** When in doubt, flag rather than fix. `--fix` mode is intentionally limited (Tier B remappings stay with the operator per the standing destructive-instruction rule).
- **Idempotent.** Running lint twice in a row produces the same exit code and the same findings (modulo new lint events emitted by the run itself).
