---
title: Expression-pinned allowlist — a security-ratchet row must pin the audited thing, not its location
description: A lint/ratchet allowlist row keyed by file+line (or file+count) cannot express "this is the expression I audited" — a same-count substitution passes silently and every unrelated edit above the site forces a resync. Key the row by the audited expression text instead — it survives line drift, rejects a substitute, and its failure modes are DX-shaped (a stale row, an extra finding) rather than silent suppression.
category: pattern
keywords:
  - allowlist
  - ratchet
  - line-pin
  - expression-pin
  - security-lint
  - check-raw-fs-guarded
  - audited-fold
  - same-count-swap
created_at: 2026-08-15
updated_at: 2026-08-15
related_themes:
  - declared-data-fails-open
  - per-kb-health-honesty-na-invariant
---

# Expression-pinned allowlist

`check-raw-fs-guarded`'s projects-root-fold allowlist was keyed by **location** (file + line, later file + count). Two measured failure modes (wave-5 batch H, SEC-H lane, PR #131):

- **Line drift as permanent churn.** Any insertion above an allowlisted sink shifts the pin; PR #127 and three later PRs each paid a "resync the line pins" chore, and mid-flight the desync produced a 19-finding false-red that a concurrent lane had to diagnose. The row's key encoded *where* the audited thing was, which every unrelated edit invalidates.
- **The same-count swap (the silent one).** A location/count row is only consulted when occurrences *exceed* the budget — so swapping the audited fold expression for a *different* fold with the same count passed silently. The fix rounds patched the ranking twice; the class reopened both times. Per the two-reopen stop, the **key** was changed rather than the ranking: a row now pins the audited fold **expression** text.

Why the expression is the right key: an audit approves *a specific expression in a specific file* ("this `join(projectsRoot, body.project)` is guard-derived"). The expression text is the identity of what was audited. Keyed that way, the row survives line drift with no resync, a substitute expression is an immediate finding, and staleness surfaces as a visible "this row matches nothing" — every residual failure mode produces an *extra finding*, never a silent suppression. Mutation-proven on the real modules: renamed-import callee, binding-discovered root, template-literal form, count-surplus, and the same-count swap geometry all exit 1.

**Rule:** when an allowlist exists to record a human/reviewer audit, its key must be the audited artifact itself (expression, declaration, config block), never its coordinates. If the row can stay green while the thing it approved is replaced, the allowlist is a [[declared-data-fails-open]] instance wearing a security costume.
