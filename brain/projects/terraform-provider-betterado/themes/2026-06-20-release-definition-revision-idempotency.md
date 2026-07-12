---
title: release_definition framework resource has a `revision` idempotency bug (surfaced once acc tests could run live)
description: TestAccReleaseDefinition_basic fails live on revision — no-op re-plan shows `revision = N -> (known after apply)` (Step 4, non-empty plan). UseStateForUnknown fixes the no-op but breaks the update step (Step 6 "inconsistent result after apply") because ADO bumps revision on every update. Needs a proper Read/flatten + plan design, not a one-line modifier. NOT yet fixed.
category: antipattern
keywords: [revision, idempotency, useforstateunknown, plan-modifier, "inconsistent result after apply", release_definition, no-op-replan]
related_themes: [framework-migration-index]
created_at: 2026-06-20
updated_at: 2026-06-20
---

# release_definition `revision` idempotency bug

Surfaced 2026-06-20 the moment acc tests could run live again (after pointing the
release fixture at the persistent `betterado-standing-demo` project — see
[[2026-06-20-ado-org-project-limit-blocks-test-creates]]). #30's "live-proven"
claim was from a transient dev state; the merged resource has the defect.

## Symptom

`TestAccReleaseDefinition_basic` against live ADO:

- **Step 4 (no-op re-plan, no modifier):** `non-refresh plan was not empty` —
  ```
  ~ betterado_release_definition.test
      ~ revision = 2 -> (known after apply)   # only attr; "9 unchanged hidden"
  Plan: 0 to add, 1 to change, 0 to destroy.
  ```
  `revision` is `schema.Int64Attribute{ Computed: true }` with NO plan modifier, so
  every plan re-computes it as "(known after apply)" → perpetual diff.

## Why the obvious fix is insufficient

Adding `UseStateForUnknown` to `revision` fixes Step 4 (no-op) but then **Step 6
fails: "Provider produced inconsistent result after apply."** ADO increments the
revision on every update, so during an update the plan pins `revision` to the
prior state value while apply returns the new one → inconsistent. `revision` is a
server-incremented value: it must be Unknown *during an update* (so the new value
is accepted) yet stable *on a no-op*. `UseStateForUnknown` can't distinguish the
two.

## Proper fix (TODO — not yet done)

Needs design, not a one-liner. Options:
- A custom plan modifier that sets `revision` Unknown only when the resource is
  otherwise changing (a planned update), else keeps prior state.
- Or fix the underlying Read/flatten so a true no-op does not mark the resource
  for update at all (investigate why Step 4 marks update-in-place when only the
  computed `revision` differs — a non-computed attribute may be round-tripping
  imperfectly and `revision` is just the visible symptom).
- Mirror whatever `task_group` does — `TestAccTaskGroup_basic/_withGapFields` pass
  idempotency live, so task_group's revision/Read handling is the reference.

## Status

Test setup (standing-demo) shipped; this resource fix is a separate follow-up.
task_group acc tests are GREEN live; release_definition is RED on this bug.
