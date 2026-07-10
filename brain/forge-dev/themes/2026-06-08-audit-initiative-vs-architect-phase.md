---
title: audit-initiative-vs-architect-phase — investigation cycles may belong in architect phase, not as standalone worktree PRs
description: Operator questioned whether audit/investigation initiatives (enumerate SDK fields, write gap matrix) fit better as architect-phase groundwork rather than standalone forge cycles consuming a worktree and PR slot.
category: decision
created_at: 2026-06-08T00:00:00.000Z
updated_at: 2026-06-08T00:00:00.000Z
---

## Context

The `INIT-2026-06-08-release-definition-schema-audit` initiative was a pure documentation/analysis cycle: read the ADO SDK `models.go`, enumerate all fields vs the Terraform schema, write a gap matrix and prioritised roadmap. The deliverable was two markdown docs committed via PR.

After the cycle completed, operator provided free-form feedback: "I'm also curious whether an initiative like this can actually fit into forge or whether this sort of investigation makes more sense in the architect phase to allow accurate grounded initiatives purely based around implementation."

## Forces

**In favour of architect-phase placement:**
- Audit output (gap matrix, roadmap) is most useful BEFORE the architect writes an implementation plan. If the architect runs the audit inline, the resulting implementation initiatives are directly grounded in the gap matrix — no separate worktree PR needed.
- Audit work doesn't change provider behaviour, so the PR/merge/review overhead is pure overhead.
- The architect phase already does deep codebase reading (`brain-query`, file reads, SDK inspection). The gap matrix work (read `models.go`, diff against schema) is structurally identical to architect exploration.

**In favour of standalone forge-cycle:**
- Audits produce persistent artefacts (`docs/` committed files) that need to live in the repo and be version-controlled.
- A standalone cycle uses the existing forge gate mechanism to enforce doc quality (line-count tests, etc.).
- Separate cycle → separate event log → reflectable, cost-trackable unit of work.

## Recommendation

- **For exploration-only audits** (no committed files needed, output is only to architect context): run inside the architect phase.
- **For doc-producing audits** (committed gap matrix, roadmap, schema spec): standalone forge cycle is appropriate, but **omit any live-acc WI** (docs-only initiatives have no behaviour to verify).
- The PM should classify an initiative as `docs-only` when all WIs produce only markdown/doc files and emit no schema/CRUD changes. A `docs-only` classification should suppress live-acc WI generation.

## Related

- `brain/cycles/themes/2026-06-20-pm-acceptance-gate-misfires-on-scoped-docs-initiatives.md` — the broader antipattern of PM adding live-acc ACs to scoped-docs initiatives.

## Sources

- `_logs/2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit/user-feedback.md` (operator free-form)
- `/home/parso/forge/brain/cycles/_raw/2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit.md`
