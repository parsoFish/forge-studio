---
id: work-items
name: Work Items
kind: file
producer: project-manager
consumer: developer-ralph
schema:
  requiredFiles:
    - .forge/work-items/
  requiredFields:
    - work_item_id
    - initiative_id
    - depends_on
    - acceptance_criteria
    - files_in_scope
    - quality_gate_cmd
---

# Work-items artifact contract

One `WI-<n>.md` file per atomic unit of work, plus `_graph.md` (the dependency DAG). Schema is
locked in [ADR 015](../../docs/decisions/015-work-item-format.md) and enforced by
`orchestrator/work-item.ts:validateWorkItem` before dev dispatch — invalid work items fail the
cycle. Every WI carries a discriminating `quality_gate_cmd` (no shell pipelines; must fail before
the work exists and pass only when the ACs are met).

- **Producer:** project-manager (sole decomposer/sizer).
- **Consumer:** developer-ralph (fan-out, one agent per WI in its worktree).
