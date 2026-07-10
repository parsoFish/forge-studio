---
title: live-acc-wi-in-docs-only-initiative — PM adding a live-acc WI to a doc-only initiative creates a guaranteed-fail WI
description: When an initiative's scope is purely documentation/analysis (no schema or CRUD change), a live-acc WI is planning waste — it fails immediately on env-missing or verifies behaviour that didn't change. Operator explicitly flagged this as a forge problem.
category: antipattern
created_at: 2026-06-08T00:00:00.000Z
updated_at: 2026-06-08T00:00:00.000Z
---

## What happened

In `INIT-2026-06-08-release-definition-schema-audit`, the PM included WI-3: "Run existing `TestAccReleaseDefinition_basic` acceptance test to verify no regressions." The initiative was documentation-only (gap matrix + roadmap). WI-3 `gate.errored` immediately (`reject_reason: live-env-missing`, 0 iterations, $0). Outcome: `status: failed` on the dev-loop; PR opened with a failed WI; operator accepted as-is.

Operator free-form: "forge shouldn't force live acceptance criteria for an initiative [of this type]."

## Why it happens

The PM skill default strategy includes a live-acc verification WI when the initiative spec mentions an existing resource (release definition). The PM does not detect that the initiative scope is doc-producing only and emits a live-acc WI by analogy with implementation initiatives.

## Cost

- $0 at WI-3 runtime (fast-fail guard works — confirmed here).
- Planning waste: the WI is in the manifest, runs the gate check, emits `gate.errored`, leaves `status:failed` in the dev-loop summary.
- Operator confusion: PR opened with a failed WI; operator must know this is a non-risk failure.
- WI count inflated: the operator rated this decomposition "too many" WIs.

## Fix direction

1. **PM classification**: detect initiatives where all WIs output only markdown/doc files with no schema/CRUD change. Suppress live-acc WI generation for `docs-only` initiatives.
2. **Manifest annotation**: operator can annotate `no_live_acc: true` on a `docs-only` initiative; PM respects it.
3. **Architect signal**: if the architect marks the initiative as `type: investigation`, PM skips live-acc WI pattern.

## Related

- `brain/cycles/themes/2026-06-20-pm-acceptance-gate-misfires-on-scoped-docs-initiatives.md` — same antipattern class; 4+ PM retries for an explicit docs/examples-only initiative.
- `brain/cycles/themes/2026-06-08-audit-initiative-vs-architect-phase.md` — broader question of whether doc-producing audits fit as standalone cycles at all.

## Sources

- `_logs/2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit/events.jsonl` (line 167: `gate.errored`, WI-3, `reject_reason: live-env-missing`)
- `_logs/2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit/user-feedback.md`
- `/home/parso/forge/brain/cycles/_raw/2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit.md`
