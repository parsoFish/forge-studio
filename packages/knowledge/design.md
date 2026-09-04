# `@forge/knowledge` — design

## The one seam: `KbBackend`

Every **per-KB** read and write goes through `KbBackend` (`kb-backend.ts`). That sentence
is narrower than the one `SPEC.md` §4 carried before M4, and it is narrower on purpose:
the old wording — *"Every read and write of a knowledge base goes through `KbBackend`"* —
was **false at twenty measured sites**, a guarantee enforced nowhere. A contract that no
implementation can violate is not a contract, and the campaign's recurring defect is
exactly that shape: declared data whose declaration nothing checks. The replacement is
smaller in words and larger in force — it says only what is true, and
`tests/contract/kb-backend-conformance.test.ts` holds it with content assertions against
a seeded brain, including the prefix-sibling case (`alpha-two` must never fold into
`alpha`) that was a live cross-KB **write** defect.

Cross-brain navigation sits **above** the seam. That exclusion is written down rather
than left as an unlisted exception, because an undocumented exception is how the previous
sentence became untrue.

The interface deliberately exposes no `root()`. It offers containment (`contains`,
`ownsTheme`), placement, the descriptor path and the fresh-theme list. A caller holding
the resolved root could read around the seam, which is the bypass the seam exists to
close. `FilesystemKbBackend` calls `resolveKbBrainDir` per method rather than caching a
directory, so a KB that stops resolving stops answering and the guard cannot be outlived
by a held backend.

## Three graphs, three readerships

[ADR 018](../../docs/decisions/018-three-brain-model.md) scopes the graphs: forge
engineering, cross-cycle patterns (with archives), and one per managed project.
[ADR 035](../../docs/decisions/035-forge-owned-central-artifacts.md) puts the per-project
graph **in this repo**, under forge's ownership rather than the managed project's — which
is why `brain-paths.ts` resolves a project's brain from forge's root and never from the
project checkout.

Who may read what is [ADR 010](../../docs/decisions/010-brain-first.md) **as amended**:
planners and the reflector must read; the dev loop and reviewer must not, because the
planner has already encoded the relevant conventions into the work items. This package
**reports** a violation (`kb-read-policy.ts`) and does not enforce one — enforcement
belongs to the caller that knows which role it is playing, and a package that guessed the
role would be inventing an authority it does not have.

## Routes are a table, and order is the contract

`routes.ts` holds seventeen routes as an ordered, first-match-wins `RouteTable` that
`apps/forge/routes.ts` assembles. The patterns genuinely overlap — `…/drain/cancel` also
matches `…/drain/:runId`; `resolve-node/:nodeId` sits under the prefix the bare `:id` arm
claims — and a table iterated in the wrong order dispatches the **wrong handler and still
returns 200**, which no status assertion catches. `tests/contract/routes-table.test.ts`
therefore pins each colliding URL by dispatching it and asserting which entry claims it.

Two consequences worth stating because they cost real defects to learn:

- Handlers receive the **raw** URL and normalise for themselves. The table hands the raw
  string on purpose so an arm that later needs the query string still has it; a handler
  that forgets `pathOnly` fails its own anchored regex against `?x=1`, declines, and the
  request 404s with nothing red.
- `dryClassification` is a claim about the handler, so where it is a judgement rather
  than a copy of `cli/dry-bridge.ts`, it carries a positive control. The maintenance
  route is one row valued `stub-actions` (T1 ruling 29) because `op` is a **body** field
  and `matches` is `(url) => boolean`; the control proves both directions — the spawning
  op is refused under `FORGE_DRY_BRIDGE=1` and the harmless ones are not.

## What lives elsewhere, and why

The drain and brain-fix runners are a **sessions** kind. This package holds their
knowledge concern — the lint, the scoping, the edit-soundness gate — and the rows that
still cross into `packages/sessions` are listed in `_1.0/handoffs.md` file-for-file
rather than closed by reaching into a package this one may not import (siblings at rank 2
never import each other; a shared symbol goes down to `kernel` or `contracts`).

`POST /api/studio/kbs/:id/cleanup/start` looks like a KB route and is not one: it mints
an interactive session and rides the generic turn spine. It is handed off for the same
reason.

## The session-status port, and why it stays generic

`SessionStatusIoPort` (`kb-drain-model.ts`) is how this package reaches
`guardedReadSessionStatus` / `guardedWriteSessionStatus` without importing
`@forge/sessions`: knowledge is rank 2, sessions is rank 4, so the package
declares the shape and `apps/forge` supplies the functions (M4 ruling 99). The
port-type annotation on the real binding is the drift check between the two
sides, exactly as it is for `KbDrainRunFixTurnFn`.

**Both members are generic, and that is load-bearing.** The real functions are
generic and the one read site instantiates `S` with a real status shape. A port
typed to a concrete object would force a cast at that site — and that site sits
inside `approveKbCleanup`'s SYNC INVARIANT span, where a cast is precisely the
quiet weakening the guard exists to prevent. The port is allowed to be less
convenient than the function; it is not allowed to be less typed.

**Why the pair was not pushed down into kernel instead**, which looks cheaper:
`guardedWriteSessionStatus` enforces the sticky-cancel refusal
(`cancelledPhaseWins`, `CANCELLED_PHASE`), so kernel would inherit sessions'
lifecycle vocabulary — ruling 86's mistake through another door.

**Three functions take it, not ten call sites.** `approveKbCleanup` (via its
existing opts bag), `mintKbCleanupDraftSession` and
`mintProjectBrainSeedingSession`. Each refuses BY NAME when the port is absent
rather than writing a session status through an unguarded path — the discipline
`runFixTurn`'s absence already follows.

