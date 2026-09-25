# `@forge/knowledge` — design

## The one seam: `KbBackend`

Every **per-KB** read and write goes through `KbBackend` (`kb-backend.ts`). That sentence
is narrower than the one `SPEC.md` §4 carried before M4, and it is narrower on purpose:
the old wording — *"Every read and write of a knowledge base goes through `KbBackend`"* —
was **false at twenty measured sites**, a guarantee enforced nowhere. A contract that no
implementation can violate is not a contract, and the campaign's recurring defect is
exactly that shape: declared data whose declaration nothing checks. The replacement is
smaller in words and larger in force — it says only what is true, and
`packages/knowledge/tests/contract/kb-backend-conformance.test.ts` holds it with content assertions against
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

## The session-readability port (M7-C U8, bead forge-u8y2)

`SessionReadabilityProbe` (`kb-drain-model.ts`) is how the runs ledger
(`listKbRuns`'s cleanup rows) and the drain status
(`withReadableDraftSessions`'s `perFinding[].draftSession`) reach the real
`sessionIsReadable` (`packages/sessions/session-resolution.ts`) without importing
`@forge/sessions` (rank 2 may not import rank 4) — same rank problem, same
shape, as the session-status port above. It is declared STRUCTURALLY rather
than imported, shaped to match the real function argument-for-argument
(`projectsRoot, logsRoot, kind, sessionId, project?`) so the assembly
(`apps/forge/routes.ts`) binds it directly, no wrapper to drift out of step.
`project` is a HINT, not a claim — `sessionIsReadable` only trusts a real
`_<kind>/<sessionId>` dir it finds under it, same as that function's own
`?project=` handling.

**REQUIRED on `KnowledgeRouteDeps`, and on `withReadableDraftSessions`,
`listKbRuns` and all three raw route handlers — no optional-with-a-permissive-
default anywhere in the chain.** The first cut made the port OPTIONAL
(mirroring `KbDrainTailDeps`'s legitimate optionality) with an implicit
"keep every pointer" default when absent; a code-review round called that out
as the exact fail-open fallback shape CLAUDE.md forbids, and the shape that
let these pointers go unchecked in the first place (W8-F6). Every route test
that constructs `knowledgeRoutes({...})` now declares one explicitly: a stub
that throws where the test never reaches the runs/drain routes, `() => true`
where it drives the real polling path. `handleStudioKbDrainRoutes` — the
pre-carve dispatcher kept alive only to give `runFixTurn` et al. an optional-
parameter excuse — turned out to have no live caller anywhere in the repo
(checked by grep, not assumed) and was deleted in the same pass, which is
what let the three raw handlers' own trailing parameter go required too: with
no caller left that supplies fewer arguments, there is nothing left for an
absent-probe refusal helper to guard against.

## Brain-write lease (forge-ler4)

`brain-write-lease.ts` is the ONE lock a brain-writing turn takes, so the
daemon's reflector and a Studio KB job (drain / consolidate / `forge brain
fix`) can never have their writes to the SAME `brain/` tree misattributed to
each other.

**The race.** `kb-drain-edit-soundness.ts`'s `guardAgentKbEdits` decides what a
turn wrote by diffing a filesystem snapshot taken before the turn against the
tree after it, and a turn takes minutes. Any OTHER process's brain/ write
inside that window is indistinguishable from the turn's own; for a path
INSIDE the turn's own KB the gate disposes of it on snapshot evidence alone
(`revertChange` — an rmSync for a file the write CREATED). Meanwhile
`packages/stations/phases/reflector.ts` writes brain themes from the daemon on
exactly the same tree, and `deriveKbActiveJob` (kb-job-state.ts) gates KB jobs
PER-KB — it takes no account of the reflector at all. An operator clicking
"Drain to green" while a cycle reflects is entirely reachable, and nothing
serialises the two. See `kb-drain-edit-soundness.ts`'s own
`outOfScopeNotDisposed` for the operator-facing half of this.

**Why `proper-lockfile`.** Already a direct dependency and this repo's
established primitive for exactly this shape — one directory locked, ELOCKED
translated to a named error class: `community-registry-lock.ts` (the same
two-writer mutex problem), the verdict lock in
`packages/flows/bridge-studio-runs.ts`, `packages/flows/drain-fix-loop.ts`,
`packages/flows/manifest.ts`. Nothing new is introduced. Retry budget and
stale-mtime constants mirror `community-registry-lock.ts`'s exactly, for the
same reasons stated there.

**Scope.** The lease wraps ONE brain-writing turn at a time: the reflector's
own SDK spawn plus its post-exit brain writes (retention frontmatter patch,
per-KB health), and — the shared choke point for the drain's round loop,
`runBrainConsolidateNow`, and `forge brain fix` alike — `runBrainFixTurn`
(`packages/sessions/kinds/brain-fix.ts`). W8-F1's own precedent: "guarding a
call site closes a door; guarding the turn closes the class." It does NOT
additionally wrap the drain's own extra re-audit around its injectable
`runFixTurn` seam (`bridge-studio-kb-drain.ts` — defence against a
test-stubbed turn bypassing the real gate): that diff runs synchronously
around the lease-protected call with no `await` in between, so its residual
window is microseconds of glue code, not the minutes-long spawn this bead is
about.

**Lock target.** `brainRootDir(forgeRoot)` — the SAME `<forgeRoot>/brain` the
edit-soundness gate snapshots, reused rather than re-derived so the two can
never disagree about which tree they mean. Both writers already require it to
exist before they may legitimately write anything under it, so the lease does
not create it — a lease that then fails to acquire must not leave a directory
behind the refusal.

**Stale-lock reclaim.** `BRAIN_WRITE_LEASE_STALE_MS` (15s) is the bound: a
live holder self-refreshes the lock's mtime every `stale / 2` ms
(`proper-lockfile`'s own `update` mechanism) for as long as it holds the
lease, so 15s only needs to cover the gap BETWEEN refreshes, not a whole
multi-minute spawn. A holder that crashes instead of releasing stops
refreshing; the NEXT `acquireBrainWriteLease` call sees an mtime older than
the bound and reclaims the lock (removes it, then acquires) instead of
refusing forever. Covered by
`packages/knowledge/tests/unit/brain-write-lease.test.ts`'s stale-lock test
(mkdir's an orphaned lock directory, backdates its mtime past the bound with
`utimesSync`, then asserts the next acquire succeeds).

**Test-only lock relocation.** `acquireBrainWriteLease(forgeRoot, {
lockfilePath })` lets a caller point the PHYSICAL lock file somewhere
private while `forgeRoot` still names the conceptual target `proper-lockfile`
validates exists — production call sites pass nothing and get the unchanged
default (`${brainRootDir(forgeRoot)}.lock`). `runReflector` resolves its OWN
`forgeRoot` from `import.meta.dirname`, deliberately not injectable (always
the real repo checkout — `reflector-spawn-capture.test.ts`'s own header), so
every test that reaches it targets the SAME real `brain/`. Reproduced
pre-fix: `reflector.test.ts` + `reflector-write-lease.test.ts` +
`reflector-spawn-capture.test.ts` run together in one `node --test`
invocation (each test FILE is its own process) — 8/10 reds,
`'failed' !== 'closed'` (brain-write-lease-contention). `ReflectorDeps`
carries the fix as `acquireBrainWriteLease` (mirrors its existing
`sdkQuery`/`brainLint`/`kbHealth` injectables); each of those three test
files now wires it to `reflector-lease-test-fixture.ts`'s
`acquireIsolatedReflectorLease`, which gives that FILE its own private
physical lock. Proven at the disk level in
`brain-write-lease.test.ts` (custom path used, default path left untouched)
rather than by holding two concurrent leases in one process — that hits
`proper-lockfile`'s own per-process `locks` bookkeeping singleton
(`lib/lockfile.js`) and breaks `release()`, an artifact that never occurs
across `node --test`'s per-file worker processes.

