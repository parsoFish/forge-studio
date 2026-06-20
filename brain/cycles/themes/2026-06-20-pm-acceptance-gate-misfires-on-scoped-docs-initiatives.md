---
title: "PM acceptance gate misfires on docs-only initiatives"
description: "Blanket 'must include TF_ACC acceptance WI' rule causes 4+ PM retries when the initiative explicitly scopes out live acceptance testing (e.g. docs/examples-only changes)."
category: antipattern
created_at: 2026-06-20
updated_at: 2026-06-20
---

## What happened

Cycle 2026-06-20T05-12-11 (terraform-provider-betterado, INIT-2026-06-19-framework-docs-examples):
- PM ran 5 times. First 4 produced WIs but were rejected by the acceptance-gate check with: `"no acceptance work item: this project requires ≥1 WI whose quality_gate_cmd targets 'acceptancetests'"`
- The initiative manifest explicitly stated live TF_ACC was out of scope ("Re-validating live acceptance tests — covered in initiatives 2, 3, 4").
- The PM resolved it on attempt 5 by dropping the acceptance WI entirely — the gate allowed this once the PM recognised the initiative was doc-only.
- Waste: ~4 PM retries × ~$0.74 = ~$3 + ~18 minutes wall time.

## Root cause

The project profile's acceptance-gate check is blanket — it applies to every initiative regardless of whether the initiative manifest explicitly exempts live TF_ACC. The PM must infer the exemption from prose in the manifest and must do so correctly on the first try.

## Pattern to avoid

Don't design acceptance gates as blanket project-level rules that PM must re-interpret per initiative. The PM does not reliably carry that reasoning across retries without explicit signals.

## Mitigations (options)

1. **Manifest flag** — add `skip_acceptance_wi: true` to the manifest YAML for initiatives that are explicitly not touching live-testable behaviour. The gate reads this flag and skips the check.
2. **Initiative-type classification** — architect tags initiatives as `type: docs | feature | refactor | migration`; acceptance gate only fires for `feature` and `migration`.
3. **Current workaround** — PM eventually self-corrects; cost is 3-4 retries. Acceptable only if PM retry cost is low and frequency is infrequent.

## Would this apply to a different project?

Yes. Any project with a blanket acceptance-gate requirement will exhibit this pattern when a docs-only initiative lands. This is a forge-machinery lesson.

## Sources

- `_logs/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples/events.jsonl` — events 34-35 (pm.error, acceptance_gate_violation); events 58-60 (second PM attempt brain-query). PM error text: `"no acceptance work item: this project requires ≥1 WI whose quality_gate_cmd targets 'acceptancetests'"`
- `/home/parso/forge/brain/cycles/_raw/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples.md`
