---
name: Bug report
about: Report a defect in forge itself (not in a managed project)
title: "fix: <short description>"
labels: bug
---

## What broke

<!-- One or two sentences: what did you expect vs. what happened. -->

## Failing gate / harness output

<!-- Paste the relevant failure — `npm run build`, `npm test`, `npm run ui:journey`,
     `npm run verify:cycle`, or a phase/cycle log excerpt. Include the command you ran. -->

```text
<paste output here>
```

## `forge studio lint` / `forge brain lint` state

<!-- Run both and paste the tail of each — a surprising number of "bugs" are
     actually a stale studio definition or a brain structural-integrity
     violation, not an orchestrator defect. -->

```text
$ forge studio lint


$ forge brain lint

```

## Repro steps

1.
2.
3.

## Environment

- forge commit / version:
- Node version (`node --version`):
- OS:

## Scope

<!-- Which of the three scopes does this touch? See docs/repo-map.md -->

- [ ] Scope 1 — framework/orchestration (`orchestrator/`, `cli/`, `loops/`, `forge-ui/`)
- [ ] Scope 2 — cycles/agents/flows (`skills/`, `studio/`, `brain/forge-dev/`, `brain/cycles/`)
- [ ] Scope 3 — a managed project (`projects/`, `brain/projects/`)
