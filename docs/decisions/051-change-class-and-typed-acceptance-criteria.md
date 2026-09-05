# ADR 051 — Change class is a typed manifest field; acceptance criteria are typed frontmatter

**Status:** Accepted (operator decision 2026-09-05, as drafted, including the disclosed `packages/sessions` repoint).
**Date:** 2026-09-05
**References:** spec §5 items 1, 2, 3, 8, 9; [`docs/roadmaps/1.0.md`](../roadmaps/1.0.md) §4 M5 Lane A, §5 H7; [ADR 037](./037-compiled-wi-contracts.md) (compiled work-item contracts); [ADR 024](./024-phases-as-subagents-invoking-skills.md) (phases as subagents invoking skills); [ADR 036](./036-orchestrator-owned-gate-execution.md) (orchestrator-owned gate execution); [ADR 048](./048-deletable-example-factory.md) (deletable example factory).
**The table this ADR governs is data, not prose:** `packages/factory/class-profiles.ts`, held to its shape by `packages/factory/class-profiles.contract.test.ts`.

## Context

Two things the develop flow depends on are untyped today, and both fail the same way: they are *declared* in one place and
*interpreted* in several.

1. **The kind of change.** Nothing in a manifest says whether an initiative is code, docs, config or infra. Every phase
   infers it. `packages/projects/gate-recipes.ts` infers a *language* from build-manifest presence and hands the project
   manager a gate template — so a docs initiative in a Go repo is handed a Go test recipe. The project manager appends the
   project's `standing_work_item_acs` to every work item regardless of what the work item is. The measured consequence is
   spec §5 item 9's target being unreachable: a docs initiative pays code-path prices because it runs the code path.
2. **Acceptance criteria.** They are prose in the manifest body, recovered by regex. `extractGwtBlocks()` parses four
   different shapes the architect has emitted over time (YAML keys, bolded markdown, inline triples, `### AC-N` headings) —
   the test file carries a case per shape, each added after a real run produced something the parser did not expect. A
   criterion that fails to parse does not error; it silently is not there, and the review agent then cannot return a per-AC
   verdict on it because it never saw it.

Both are the declared-data-fails-open shape: a field that is parsed and surfaced but enforced nowhere.

## Decision

**1. `class` is a typed, required manifest field.** `class: code | docs | config | infra`. The architect sets it; the plan
gate presents it to the operator for confirmation; every work item **inherits** it and may not override it. A manifest
without a resolvable class is a validation error at the plan gate, not a default.

**2. One data table maps class → gate profile.** The columns are fixed by spec §5 item 1 (iter-0 fail-first, required-paths
source, which `testProcess.*` runs at the merge boundary, capture, review lenses, reflect, single-WI allowed); the values
are the operator's. Every phase reads the table. A phase that branches on a class name instead is a conformance-test
failure, because a re-derived profile is a profile that can drift from the table it claims to obey.

**3. `acceptance_criteria` is typed frontmatter,** an array of `{given, when, then}`, shared by the architect (writes it),
the project manager (compiles it into work items), the review agent (returns a verdict per entry) and PLAN.html (renders
it). `extractGwtBlocks` is deleted, along with the regex shapes it accommodated. **An AC that does not parse is an error,
not an absence** — this is the whole point of the change, and it is what makes a per-AC verdict a complete statement rather
than a statement about whatever happened to parse.

**4. The plan gate enforces three things it currently only displays:** the class is confirmed; a body prescribing work-item
sizing or a `quality_gate_cmd` is flagged (the lane check, spec §5 item 3); and the manifest's class is one the target flow
declares it accepts (spec §5 item 8 — a flow registers its accepted classes, and the pair is checked before spend).

**5. `creates:` under a gitignored path is a project-manager validation error** (spec §5 item 3). It is stated here because
it is the same failure in a third place: a work item that claims to create a file git will never see produces a green
required-paths check against a diff that cannot contain it.

**6. The four class-blind standing acceptance criteria are cut** (spec §5 *Rebuild or cut*), replaced by the class profile's
review lenses. A project keeps `standing_work_item_acs` for criteria that are genuinely project-wide; the four that shipped
as defaults are not, and appending them to a docs work item is how a docs initiative acquired code-shaped obligations.

## Consequences

- **Breaking, deliberately.** A manifest without `class` and typed `acceptance_criteria` does not pass the plan gate. There
  are no legacy users; no compatibility path is provided and none should be added.
- `packages/sessions` is touched to delete `extractGwtBlocks` and repoint PLAN.html at the typed field — a **repoint**,
  disclosed in the PR title, not a redesign of the sessions spine.
- `packages/projects/gate-recipes.ts`'s language detection is retired; what survives of it (the per-language *traps* prose)
  becomes the `code` profile's guidance, if it is kept at all.
- A docs initiative becomes measurable against spec §5 item 9's price: it runs the docs profile, which is the thing being
  priced.
- **Enforced by:** the class-table conformance test, the typed-AC schema tests (a malformed AC is an error with its
  location), the plan-gate lane check test, and the project-manager validation-error test for a gitignored `creates:`. Each
  is red-first against the tree that preceded it; none is a new lint script — they are tests of the code that already runs.

## Alternatives considered

- **Infer the class from the diff.** Rejected: the class must be known *before* the work happens, because it selects the
  gates the work is judged by. Inferring it after is grading your own homework.
- **Keep `extractGwtBlocks` as a fallback for untyped manifests.** Rejected under the no-fallback rule, and because a
  fallback that silently succeeds is precisely the defect being closed.
- **A fifth class (`test`, `release`, `chore`).** Rejected for 1.0: four classes with real, distinct gate profiles is a
  table; more classes without distinct profiles is a label. G3 (a second factory assembled from data) is where new classes
  earn their place.
