---
title: "A verifier brief that does not demand a runnable repro produces agreement, not verification"
description: "Wave 7's ten cluster verifiers returned 146 verdicts and refuted exactly one. A second, hostile pass whose brief demanded a script the agent wrote, ran and pasted the output of confirmed 5 of 14 and DOWNGRADED 9 — every downgrade backed by a reproduction showing a real in-Studio workaround. Same findings, same tree, different brief."
category: pattern
keywords:
  - adversarial-review
  - verification
  - severity
  - agent-brief
  - immutable-gates
related_themes: [2026-08-22-progressive-disclosure-breaks-link-crawlers]
created_at: "2026-08-22"
updated_at: "2026-08-22"
---

## What happened

The wave-7 exit re-gate ran ten explorer agents over Forge Studio, each followed
by an adversarial verifier told to "try to REFUTE" every S1 and S2 finding.
Across all ten clusters those verifiers produced **146 verdicts and refuted
exactly one**.

The wave-7 plan had already predicted this, in writing, from the first pass:
*"the near-zero refute rate says the next verifier brief should demand a
reproduction script per verdict, not a source read."* This is that prediction
being tested.

Fourteen findings survived as open S1. Rather than act on them, a second pass
ran one hostile verifier per finding with a materially different brief:

- **Default position: the finding is WRONG.**
- CONFIRMED requires a script *you wrote*, *ran*, and paste the decisive output
  of — plus a CONTROL probe against a case that should work, so the output
  distinguishes "this is broken" from "everything here is broken".
- NOT-REPRODUCED is an explicitly welcome answer, more valuable than an
  agreeable CONFIRMED.
- Attribution must be proven with `git log -S` / `-L`, because "W7-B6
  regression" and "pre-existing, never fixed" send a fix at different code.
- A named list of things to try first: is the fixture stale? is it a race the
  harness lost? is the control disabled WITH a reason? is a leaked run bricking
  the surface? is the severity right? is it a duplicate?

**Result: 5 CONFIRMED, 9 DOWNGRADED, 0 REFUTED, 0 NOT-REPRODUCED.**

## What that means

Not one finding was fabricated — the explorers were honest. But **nine of
fourteen were mis-rated**, and every downgrade came with a reproduction showing
an in-Studio workaround or a non-blocking blast radius. Two of the five
CONFIRMED were the same defect reached from different clusters, so fourteen
claimed S1 resolved to **four distinct** real ones.

Acting on fourteen would have meant a wave of work, most of it aimed at the
wrong severity. Acting on none would have shipped two loops that genuinely could
not complete.

## Why the first brief failed

"Try to refute it" is an instruction an agent can satisfy by reading the source,
agreeing with the reasoning, and writing CONFIRMED. Nothing in that loop forces
contact with the running system. The second brief made the *artifact* the gate:
no script and no output means no CONFIRMED, and the agent cannot talk its way
past that.

## Rule

A verification pass is only as good as the artifact its brief demands. Ask for a
verdict and you get a verdict; ask for a runnable reproduction and its captured
output and you get verification. Watch the refute rate: **a pass that refutes
almost nothing has not verified anything** — it has agreed.
