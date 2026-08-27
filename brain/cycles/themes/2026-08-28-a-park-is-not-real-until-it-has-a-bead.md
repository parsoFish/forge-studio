---
title: "A park is not real until it has a bead"
description: "Two wave-8 parks existed only in lane prose — five projects-index rows a lane declared 'parked to their own initiative' (no such bead was ever created) and three child bug clusters a lane never mentioned in its ledger. Both survived only because their parent bead happened to stay open. The same wave later recovered 46 exit-gate S3s into 22 beads; the remedy is mechanical: a park is minted as a bead before the lane that parked it returns."
category: operation
keywords:
  - beads
  - park-point
  - tiered-orchestration
  - ledger
  - residue
related_themes: [2026-08-22-verifier-without-a-repro-produces-agreement, 2026-08-28-scope-filters-reship-the-class-a-sound-audit-catches]
created_at: "2026-08-28"
updated_at: "2026-08-28"
---

## What happened

Wave 8's C3 lane took one of six rows of a P1 bug cluster (`forge-6gv.13.1`)
and declared the other five "parked to their own initiative". No initiative,
no bead. The five rows lived inside the parent bead's description and would
have evaporated with one careless `bd close`. Wave-B's B1 lane returned with
three child bug clusters that its ledger never mentioned at all.

Both were found during the crash-recovery pass that re-derived every lane's
state from files — not from a report. Both were then recorded on the beads
themselves, including a co-ownership warning (`projects-12` is the same family
as an already-landed fix and must be re-derived against merged main, never
re-implemented blind).

The exit gate repeated the lesson at scale: 46 S3 findings across 11 verifier
claims would have lived in a gitignored campaign JSON forever. A worker minted
them into 22 P3 beads, folding 17 into existing open beads by note and merging
7 duplicates, before any lane was spawned to fix the S1/S2s.

## The rule

- **A park is an artifact, not a sentence.** The lane that parks produces the
  bead (with the repro, the file:line, and who co-owns it), names it in
  `return.json`, and only then returns.
- **Re-derive a bead's STATE, not just its producer's existence.** The
  exit-criteria rule ("every row names a grep-proven producer") does not ask
  whether the bead is still open — one wave-8 pack cited two already-closed
  beads for exactly that reason.
- **Drain write-only backlogs at batch OPEN, as a blocking gate.** Campaign
  state that is not in the tracker is not state.

## Why it matters

Campaign directories are gitignored. A permanent artifact may never cite a
path inside one. The tracker is the only place a park survives a context
death, a session kill, or a successor with no chat history — and wave 8 had
all three.
