---
title: An initiative is a bundle, not a single work item
description: Size the unit of work as a coherent feature plus its tests in one initiative — not a tests-only split, and not a roadmap dumped as one WI.
category: pattern
created_at: '2026-06-16'
updated_at: '2026-06-16'
---

# Initiative sizing is a bundle

The target unit of work is a **large, coherent chunk**: a feature plus the tests
that prove it, decomposed by the PM into a handful of dependency-ordered work items.

- **Not** a tests-only initiative split from the functionality (the proof and the
  thing-proven belong together).
- **Not** a whole roadmap crammed into one WI (the dev-loop wedges on a 3,000-line
  context).
- **Not** shrunk to a single WI to dodge a contract gap — that is a smell; fix the
  contract instead.

A good initiative reads as one sentence of intent ("bring task groups to the release
resources' proof bar: a live acceptance test + a data source") and decomposes into
2–5 WIs the dev-loop can each finish and gate independently. If the operator is
tempted to shrink scope to make forge succeed, the project is under-contracted, not
the initiative over-sized.

## Sources

- Cross-cycle pattern (work-item sizing, design-is-the-bottleneck).
- The forge↔project contract close ("roadmap-scale, not single-WI").
