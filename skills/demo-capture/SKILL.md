---
name: demo-capture
description: Optional, unifier-triggered media capture for a structured demo (ADR 021). When a project's change is visual (demo.shape "browser"), capture before/after screenshots and back-fill them into the unifier's demo.json. Best-effort — never blocks the demo gate or a cycle.
phase: developer-loop
surface: unattended
model: claude-sonnet-4-6
---

# Demo capture

## Single responsibility

Fill the **optional** before/after media of a structured demo. The unifier
authors the structured `demo/<initiative-id>/demo.json` (the contract, per
[ADR 021](../../docs/decisions/021-local-review-and-unified-demo.md)); this
skill captures screenshots for the **visual** case and merges them into that
same `demo.json`, then re-renders `DEMO.md`/`DEMO.html`.

This skill is **not** the demo author — `demo.json` already exists when it runs.
It only adds media. It is invoked **explicitly by the unifier when relevant**
(the project's `demo.shape` is `browser`), never on every cycle. The structured
core (essence + before/after notes + metrics + diffstat) stands on its own;
media is an enhancement.

## When to invoke

The unifier invokes this **only** when the change is visually demonstrable
(`.forge/project.json` `demo.shape: "browser"`) AND `demo.json` already has its
checkpoints authored. For `harness` / `cli-diff` / `artifact` / `none` shapes,
do NOT invoke — those demos are notes/metrics only.

## How it runs

One command, from the worktree root:

```
forge demo capture <initiative-id>
```

It:
1. Runs the two-worktree (baseline `main` vs changed `HEAD`) + Playwright
   capture (`generateComparisonDemo`) into `demo/<initiative-id>/.capture/`.
2. Reads the captured `before/<label>.png` + `after/<label>.png` and merges them
   (as inline `data:` URIs, size-capped) into the matching `demo.json`
   checkpoints by `label` (unmatched captures are appended).
3. Re-runs `forge demo render <initiative-id>` to regenerate `DEMO.md` +
   `DEMO.html` with the media.

## Inputs

- `demo/<initiative-id>/demo.json` (authored by the unifier — must exist).
- The project repo at `main` and the initiative branch `HEAD` (built per the
  project's build command).

## Outputs

- `demo/<initiative-id>/demo.json` — updated in place with checkpoint media.
- Regenerated `demo/<initiative-id>/DEMO.md` + `DEMO.html`.
- `demo/<initiative-id>/.capture/` — the raw capture bundle (not required to be
  committed; the inlined media in demo.json is the source of truth).

## Constraints

- **Best-effort, never fatal.** Any failure (no buildable web app, missing
  Playwright, capture error) logs and exits 0 — the structured demo + the gate
  do not depend on media. `demo.json` is left notes-only.
- **No remote media.** Only inline `data:` URIs are merged; `validateDemoModel`
  rejects scheme-bearing/remote image refs.
- **Does not re-author content.** It must not edit captions, notes, metrics, or
  the diffstat — only `beforeImage`/`afterImage`.

## Event-log entries to emit

- `demo-capture.start` — capture begun for `<initiative-id>`.
- `demo-capture.merged` — N checkpoints gained media.
- `demo-capture.skipped` — best-effort skip (with reason).
