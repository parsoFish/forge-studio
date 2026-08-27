---
title: "A scope filter wrapped around a sound audit re-ships the class the audit would catch"
description: "Wave 8's exit gate refuted the claim that the drain's deleted-edge class 'cannot recur': the audit logic held under every shape tried, but two filters wrapped around it — an edit-class filter that skipped 'prose' edits, and a snapshot scoped to one brain dir while the agent wrote anywhere — each alone re-shipped forge-d8l a fourth time, through the instrument built to catch it. Verify the wrapper, not the core."
category: antipattern
keywords:
  - edit-soundness
  - scope-filter
  - declared-data-fails-open
  - drain-to-green
  - adversarial-review
  - derive-status-dont-store-it
related_themes: [2026-08-22-verifier-without-a-repro-produces-agreement, 2026-08-28-a-pin-that-reads-the-checkouts-git-history-is-environment-shaped]
created_at: "2026-08-28"
updated_at: "2026-08-28"
---

## What happened

Wave 8's B2 lane closed `forge-d8l` — drain-to-green deleting a real brain
edge whose target exists — with an edit-soundness audit (`cli/kb-drain-edit-
soundness.ts`) and a pin that went RED under mutation. The lane's claim, in the
module header, was that the class "cannot recur" through the two operator paths
it named.

The C4 exit gate's hostile refuter re-ran the pin (it bit: 7 → 4 under
mutation) and then attacked what was **around** the audit rather than the audit:

- `auditKbEdit` returned `[]` for any edit whose class was not `structural`,
  and `classifyKbEdit` demoted an edit to `prose` the moment its body changed.
  Deleting a real `related_themes` edge **while rewording one sentence** audited
  as `{unsound: 0, refused: 0}` — an affirmative all-clear with the edge gone.
  (`length.soft-cap`, the modal finding, is definitionally "condense the prose".)
- The snapshot was `resolveKbBrainDir(kbId)` — one directory — while the agent
  ran with `cwd = forgeRoot` and an unfenced `Edit`. An edge deleted in a
  sibling brain dir was never in the diff, so never audited. Reproduced through
  the real `runKbDrain`, not a probe harness.

Either filter alone was enough. The fix lane (F1) then found a **fifth** escape
red-first (a turn that deleted a brain file had no `after` graph, and `[]`
meant "may land") and its reviewer found nine more with runnable repros —
including `approveKbCleanup` applying a parked draft with no audit at all, and
operator-created KBs (`brain/<id>`) sitting outside the slug universe the
audit walked.

## Why it matters

"Cannot recur" was a claim about the audit, and the audit was fine. Every
escape was a **caller's ability to get the scope wrong**: a class the audit
was told not to look at, a directory it was told not to snapshot, a path that
never reached it. Detection was never the problem; the wrapper let inputs
around it.

This is `declared-data-fails-open` one layer up: the class field and the scope
parameter were declared, surfaced and honoured — and their existence was the
hole.

## The pattern that holds

- **One audit function with no class filter.** Class decides draft-vs-auto-
  apply, never whether soundness is checked.
- **Scope derived, not supplied.** `snapshotBrainTree` has no scope parameter to
  get wrong; the fence and the audit share one definition of "where the agent
  may write", extracted from the spawn seam so both spawn paths use it.
- **A gate that cannot represent an unaudited turn.** `editAudit` is required on
  the gate result; a turn without one is unrepresentable, not "may land".
- **Reviewer brief: attack the enumeration of callers and the filters, not the
  core.** List every caller of the gate and every parameter that narrows it;
  a test that stubs the gate is not a gate test.

## Where it applies next

Any guard with a parameter that narrows what it looks at (a kind allowlist, a
root directory, a module list, a filename glob) — the same wave found the shape
in `check-raw-fs-guarded`'s filename-scoped list (F5) and in a hook approval
that hashed only the declared entry script (F2).
