# Request-path sinks — the enumeration

*Reference.* Every filesystem read/write in `cli/` and `orchestrator/` whose
path derives, in whole or in part, from request data, each classified
`guarded` / `unguarded` / `accidentally-safe`.

**This is the page the ratchet means.** When `scripts/check-request-path-sinks.mjs`
reports a new sink or a new caller, add its row here. The model behind the
classifications — the escape shapes, what a guard must satisfy, the standing
rules — is [`security-model.md`](../explanation/security-model.md); read it
before adding a row.

## Summary

**A ROW is the auditable unit.** Where several `file:line` locations share one
mechanism and one fix, they are listed inside a single row — the `file:line`
column names each of them. These counts are row counts, so they can be checked
against the tables by counting; a count of line references could not be.

| | Rows |
|---|---|
| Classified rows below | 61 |
| — `guarded` | 16 |
| — guarded, new in M4-projects (S3 "Rebuild contract" — `reset.ts` becomes bridge-reachable, no new mechanism) | 1 |
| — fixed in this sweep (all were `unguarded`) | 12 |
| — fixed later in SEC-02 (`forge-d1f`) | 3 |
| — fixed later in R4-16 (the four `/start` routes' `projectRepoPath`) | 1 |
| — fixed later in SEC-03 | 4 |
| — guarded, new in R4-17 (the onboarding session's contract-stages surface) | 2 |
| — guarded, new in R4-21 T3 (the `deriveFilePackage` recursive walk + the authoring-session start route) | 2 |
| — guarded, new in W6-B4 (the generic session-affordance write endpoint) | 1 |
| — `unguarded`, filed for follow-up | 10 |
| — `accidentally-safe` (accident named on each) | 9 |
| — not request-derived, new in M5-A (the PM's rejected-set quarantine, bead `forge-8vfn.6.1`; the class read moved out of `executor-deps.ts`, spec §5 item 9) | 2 |
| `[unver]` items, listed separately and never counted safe | 7 |
| bd issues filed | 4 (1 closed: `forge-d1f` by SEC-02; `forge-q80` PARTLY addressed by SEC-03 — its `POST /api/studio/projects` items are fixed, its `packageDir`/zip-slip and community-index items are not, so it stays open) |

Verification markers, counted as ROWS CARRYING a marker (not as marker
occurrences — a row may carry more than one where it covers several routes):
**30 rows carry `[exec]`** (live repro executed), **24 carry `[read]`**
(classified by reading), and exactly **one row carries both** (the
`/demo/`+`/fragment/` row, where the escape is `[exec]` and the
no-plant-primitive-found reasoning is `[read]`). 30 + 24 − 1 = **53**, the
classified-row total. Reconciled by recounting every row, not by arithmetic on
the previous revision's figures.

**Two count defects in the previous revision, found by that recount and stated
rather than quietly overwritten** — the same failure mode SEC-01's adversarial
review found in this exact document before, which is why the recount is
mandatory: it claimed 24 `[exec]` / 25 `[read]` for the pre-SEC-03 49 rows
(the two were transposed — the real figures were 25 / 24), and it claimed 10
`[unver]` items when the `[unver]` bullet list had only 6. SEC-02 moved three
`forge-d1f` rows from `[read]` to `[exec]` by reproducing each escape live
before fixing it; SEC-03 moved a fourth (`POST /api/studio/projects`) the same
way and added two genuinely NEW rows rather than reclassifying existing ones
(`mint-triggered-initiative.ts`'s choke-point bypass; the `/demo/`+`/fragment/`
GET routes, split out of the row that previously lumped them in with
`/file/`+`/history/`, re-assessed live, and then FIXED — see below; and one new
`unguarded` row for `GET /api/demo-builder/sessions`, which that fix's caller
enumeration surfaced and deliberately did not close). SEC-03 also moved the
four `/start` routes' `projectRepoPath` row out of "unguarded, filed" — R4-16
had fixed it and the row still said otherwise.

---

## Table 1 — `cli/`

### Guarded (the R2-09 write routes + this sweep)

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `apps/forge/bridge-studio-writes.ts:337,586` | `mkdirSync`/`writeFileSync` | `PUT /api/studio/agents/:slug` param `slug` | guarded `[exec]` | `resolveGuardedPath(toSkillsDir(forgeRoot), [slug,'SKILL.md'])`. Rejects: symlinked `skills/<slug>` dir or leaf, cross-agent symlink, hardlinked `SKILL.md` (`nlink!==1`), dangling symlink at any segment. |
| `apps/forge/bridge-studio-writes.ts:801,880` | `writeFileSync` | `PUT /api/studio/projects/:id` | guarded `[exec]` | `resolveGuardedPath(projectRoot, ['.forge','project.json'])`; `projectRoot` is disk-scanned by `discoverProjects`, `id` only *selects* it and is never folded into the root. |
| `apps/forge/bridge-studio-writes.ts:923,1048` | `writeFileSync` | `PUT /api/studio/flows/:id` | guarded `[exec]` | Same guard, root `studio/flows`. |
| `packages/library/bridge-studio-skills.ts:136,147` | `mkdirSync`/`writeFileSync` | `POST /api/studio/skills` body-derived `slug` | guarded `[exec]` | Same guard, root `skills/`. |
| `cli/bridge-studio-instructions.ts:85` | existence probe only | `POST /api/studio/agents/:slug/instructions-draft` | guarded `[exec]` | Same guard; never reads content past the check. |
| `packages/agents/materials-staging.ts:74,75` (`stageMaterials`) | `mkdirSync`/`writeFileSync` | `POST /api/agents/:slug/run` body `materials[].filename` | guarded `[exec]` | R6-04-F2 WI-1, the agent-kickoff upload seam. `resolveGuardedPath(runDir, ['materials', filename])` — `runDir` is trusted (config `logsRoot` + server-minted `runId`), and the untrusted `filename` is its OWN segment, never folded into the root. **Two-phase check-then-write**: phase 1 resolves and containment-checks every entry with zero side effects, phase 2 writes only after all pass, so a refusal on entry N leaves entries 1..N-1 unwritten. Refusal text names no filesystem path. Pinned by `packages/agents/tests/unit/materials-staging.test.ts` (8 ATs) against a controlled `runDir`: directory-symlink, file-symlink and hardlinked-leaf all refused with the planted outside file byte-unchanged, plus the negative-space assertion that nothing is written on refusal. **Reachability, stated honestly:** those three plant shapes are NOT wire-reachable through this route today — `runId` is server-minted per request, so a caller cannot pre-plant anything under it; they are pinned at the unit level, where planting is possible. The precondition that would make them live is a route accepting a caller-supplied run id. Charset-wise the route's own `MATERIAL_FILENAME_RE` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`) already refuses every traversal shape before the guard is reached — the guard is the second layer, not the only one, and each layer is pinned separately rather than one being credited for the other's rejections.  **W8-C2a (bead `forge-qn8`) — three NEW sink calls in this module, classified here per this document's own "one sink, many entry points" completeness rule, and the reason `scripts/request-path-sinks.baseline.txt` grows for the first time in this lane.** `detectVolumeCaseFolding` adds `writeFileSync` (1 -> 2), `statSync` (0 -> 2) and `unlinkSync` (0 -> 1). **No request-derived path reaches any of the three.** The probe's own path is `join(dir, '.forge-case-probe-' + randomBytes(8).toString('hex') + '-AbCdEf')` — a server-generated random name under the SAME trusted, caller-created `runDir` the guarded write above already uses; the caller-supplied `materials[].filename` is not involved, and the marker is `unlinkSync`'d in a `finally`. Why the surface had to grow at all: the duplicate-target check keyed a `Set` on the literal `realPath`, so on a case-folding volume two entries differing only in case resolved to one file, passed as distinct strings, and the second silently clobbered the first — a full overwrite, never covered by the "zero partial writes" guarantee. Deciding that correctly requires asking the filesystem, and every correct way of asking is an fs call; a `process.platform` branch would be a guess (a case-sensitive volume mounts on macOS, a folding one on Linux). The alternative considered and rejected was leaving the bug open. |
| `packages/factory/class-profiles.ts` (`readChangeClass`) | `readFileSync` 1 | NOT a bridge route — the phase executor's dependency wiring (`packages/factory/phases/executor-deps.ts`) and the dev-loop (`packages/factory/phases/developer-loop.ts`) | **not request-derived** `[read]` | **A MOVE, not new surface, and the reason the baseline changes in two places at once: `executor-deps.ts readFileSync` 2 -> 1, `class-profiles.ts readFileSync` 0 -> 1.** Byte-for-byte the same call this row's first caller already made (`parseManifest(readFileSync(input.manifestPath, 'utf8')).class`), relocated so the dev-loop can read the class too without a SECOND independent manifest read — two reads of one field being two answers the moment one of them grows a fallback (spec §5 item 9). `input.manifestPath` is the cycle's own manifest: the scheduler resolves it at claim time from `_queue/`, and every bridge route that starts a cycle passes a path already containment-checked by `manifest-path-guard.ts`. No caller-supplied component is joined here — the function takes the resolved path and reads it. Classified `[read]`, not `[exec]`: no escape shape was planted because no request-derived component reaches the sink, and the guard that would have to fail first (`isContainedProjectRepoPath`/the manifest path guard) is pinned by its own tests. **The precondition that would make this live** is a route accepting a caller-supplied manifest path, which is what those guards exist to refuse. Deliberately NOT best-effort: an unreadable manifest throws, because running a gate profile under a guessed class is worse than refusing to run. |
| `packages/kernel/project-layout.ts` (`recordMintedRemote`) | `existsSync` 1 → 2, `mkdirSync` 0 → 1, `readFileSync` 0 → 1, `writeFileSync` 0 → 1 | NOT a bridge route directly — reached from `POST /api/studio/projects/create` via `packages/projects/project-create.ts`'s `mintRemote` | **not request-derived** `[read+write]` | **Bead `forge-8vfn.6.11.29` — four new sinks in a module that was previously almost pure paths, and the reason the baseline grows here.** The path is `mintedRemotesManifestPath(forgeRoot)` = `resolve(forgeRoot, '_logs', 'minted-remotes.json')`: **every segment is a literal except `forgeRoot`, which is the server's own install root** (`ctx.forgeRoot` / `FORGE_ROOT`), never caller input. The one caller-influenced value, `nameWithOwner`, is written **into the file as CONTENT** and never joined into the path — so no request-derived component reaches any of the four sinks, and no escape shape was planted because there is no untrusted segment to plant one in. **Why the surface had to grow at all:** `sweepStoryRemotes` has always required a creation manifest as the first of its two independent conditions, and **nothing ever wrote one** — its "refuse an unlisted repo" guard was being proven against a list that could never hold anything, so a story run that minted `parsoFish/story-s2` leaked it (`6.11.2`, reopened). Recording the mint is what makes the delete possible at all; the alternative considered and rejected was leaving every minting run to leak a repository. **Why HERE and not in `packages/projects`:** the file's SHAPE is a contract between two packages — projects appends, `scripts/stories` reads — and a second implementation of the append is how they would come to disagree about it. **Deliberately best-effort:** the writer swallows its own errors, because a project creation must not fail because its bookkeeping did; the failure is not silent in the way that matters, since an unrecorded remote is one the sweep then REFUSES to delete — the safe direction. **The precondition that would make this live** is a caller-supplied `forgeRoot`, which no route accepts. |
| `packages/factory/phases/pm-rejected-set.ts` (`quarantineRejectedSet`) | `existsSync` 2, `readdirSync` 1, `mkdirSync` 1, `renameSync` 1, `writeFileSync` 1 | NOT a bridge route — the project-manager PHASE's failure path (`packages/factory/phases/project-manager.ts`) | `accidentally-safe` -> **not request-derived** `[read]` | **New module, bead forge-8vfn.6.1 (P0), and the reason the baseline grows here.** No caller-supplied value reaches any of the five sinks. The single input is `workItemsDir` = `resolve(input.worktreePath, '.forge', 'work-items')` — the SAME directory this phase already reads with `readWorkItemsFromDir` and writes with `writeDecompositionDoc`, so the module adds operations to an existing trusted root rather than a new taint path. `worktreePath` arrives on the manifest the scheduler annotates at claim time and is containment-checked upstream by `isContainedWorktreePath`. The destination is `join(dirname(workItemsDir), 'work-items-rejected-<ISO stamp>')` — no external component; the stamp is generated here and collision-suffixed. Every moved entry name comes from `readdirSync` of that same directory, i.e. server-enumerated, never caller-supplied. Classified `[read]`, not `[exec]`: the containment property asserted by `pm-rejected-set-quarantine.test.ts` is that a rejected set stops satisfying `hasWorkItemFiles`, which is the DEFECT this closes; no escape shape was planted against these paths because no request-derived component reaches them. **The precondition that would make this live** is a route that accepts a caller-supplied worktree path — which is exactly what `isContainedWorktreePath` exists to refuse. |
| `apps/forge/ui-bridge.ts:1250` (`POST /api/agents/:slug/run`, materials branch) | `mkdirSync` | URL param `slug` → server-minted `runId` | guarded `[exec]` | R6-04-F2 WI-1. Creates the run's own directory (`join(ctx.logsRoot, runId)`) so staging has somewhere to write. Both components are trusted — `logsRoot` is config-derived and `runId` is `_agent-${slug}-${newRunStamp()}` where `slug` passed `SAFE_AGENT_SLUG_RE` **and** `resolveDispatchableAgent`. `isSafeRunId(runId)` is nevertheless applied defensively before the `mkdirSync`, mirroring the SAME check this file already runs on this SAME value at `spawnAgentDispatch` (~1789) and the run-status route (~1118) — **guard symmetry**, added after review found the new sink was the only one of the three to skip it. Not an exploitable hole either way; the value of the check is that a future edit to `newRunStamp()` or `SAFE_AGENT_SLUG_RE` cannot silently make this the one unguarded site. Refuses into the route's existing 500 path (a server-minted id failing its own safety check is a server anomaly, not operator error), never a 400. |
| `apps/forge/ui-bridge.ts` (`GET /api/agents/runs/:runId`, run-existence check) | `resolveGuardedPath` (was bare `existsSync`) | URL param `runId` | guarded `[exec]` | R6-04 D22 (existence probe), **hardened R6-06 round 6**: `runId` is charset-gated by `isSafeRunId` earlier in the same handler, but charset alone does not stop a *planted* `_logs/<runId>` directory symlink (the same shape as the history route's escape 1, below) — a request with a runId that happens to match a poisoned entry's name would previously have followed it via plain `existsSync`. Replaced with `resolveGuardedPath(ctx.logsRoot, [runId])`; a rejected guard and a genuinely absent directory both collapse into the same 404, never a distinguishable outcome. `deriveStandaloneRunState` (used by both this route and the history route's standalone rows, D3.5 shared-derivation) now reads `events.jsonl` through the SAME guarded choke point internally — see the two new rows below. Verified by the full pre-existing `apps/forge/ui-bridge-agent-run.test.ts`/`apps/forge/ui-bridge-agent-run-ceiling.test.ts` suites (404-on-missing, 200-dispatched-no-events, 200-with-events, `lines`-cap/tail behaviour) all staying green post-fix, 122/122. |
| `packages/sessions/bridge-studio-sessions.ts:150-169` (now delegates to `packages/kernel/path-guard.ts`) | `resolveGuardedPath` (was `realpathSync` ×2, hand-rolled) | `GET /api/studio/sessions/:kind/:sessionId?project=` | guarded `[exec]` | **Retraction, this row (R6-06 round 6):** the previous revision's description — "realpaths both the parent and the candidate and compares resolved strings, scoped to the specific parent" — was true of the code but omitted a load-bearing defect nobody had attacked: the OLD `resolveSafeSessionDir` computed `realpathSync(join(projectsRoot, project, kindDirName))` FIRST and used THAT as its own comparison baseline. When `kindDirName` (the `_<kind>` dir) itself was a symlink, the baseline was already the escaped location, making the "containment" check tautological — it could never fail for that shape. Proven by a standalone repro script BEFORE the fix (see `apps/forge/ui-bridge-agent-history-containment.test.ts`'s own header, "ADVERSARIAL FINDING"): `resolveSafeSessionDir` returned a victim project's real session path as "safe" for a malicious project whose `_<kind>` dir was a relative directory symlink to it — the R6-06 P0. AT-47 (this file's existing symlink test) never caught it because AT-47's fixture symlinks the *sessionId* leaf, not the *kindDirName* parent — a narrower shape the old tautological check happened to still catch (the parent stayed real, so the baseline stayed honest). **Fix:** delegates to `resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId])` — every one of the three arrives as its own `segments[]` element, never folded into `root`, so the per-segment identity walk checks `kindDirName`'s own identity independently of `sessionId`'s. `resolveGuardedPath` itself was attacked directly before being wired in (root-folding misuse, an intermediate-segment directory symlink used correctly, a hardlinked leaf, and legitimate near-miss names — see the R6-06 task report for the four executed results) rather than assumed correct because it was the repo's named guard. AT-47 (sessionId-leaf symlink) and AT-59 (status.json-leaf symlink, a separate choke point — `safeReadFileInSession`, unchanged by this fix) both still pass; hardlink gap on `status.json` remains the disclosed, accepted residual documented in `session-transcript.ts`'s own header for THIS route — R6-06's own history route (rows below) holds a stricter bar for its own `status.json` read, via a different, purpose-built choke point, precisely because that acceptance was written for a lower-sensitivity read path. |
| `apps/forge/ui-bridge.ts` (`GET /api/agents/:slug/history`, standalone-path rows: `collectStandaloneRows`, `deriveStandaloneRunState`, `readSessionCostUsd`) | `resolveGuardedPath` (was bare `existsSync`/`statSync`/`readFileSync` via `parseEventsJsonl`) | `_logs/` entry NAMES read by `readdirSync` (never the route's own `slug`, per D5) | guarded `[exec]` | **New route, R6-06 WI-1; hardened round 6.** `entry` (a standalone run's directory name) and `` _${kind}-${sessionId} `` (a session's log-dir name) both reach `events.jsonl` through the shared `parseGuardedEventsJsonl(root, entryName)` — `resolveGuardedPath(root, [entryName, 'events.jsonl'])` — catching a symlinked entry directory, a symlinked `events.jsonl` leaf, and a hardlinked `events.jsonl` leaf (`nlink!==1`) in one choke point. `root` (`logsRoot`) is the fixed, config-derived constant; the untrusted name is always its own `segments[]` element. A rejected guard and a genuinely-absent `events.jsonl` (the ordinary "dispatched, no events yet" state) collapse into the identical `null` — no oracle. **Verified `[exec]`** by `apps/forge/ui-bridge-agent-history-containment.test.ts` escapes 1/2/3 (directory symlink, file symlink, hardlink respectively) — each plants a poisoned entry ALONGSIDE a legitimate sibling for the same slug and asserts an exact row count plus the outside sentinel value's total absence from the response body and its byte-identity before/after the request; the false-rejection control (same file, run last, after every poisoned fixture already exists) proves an ordinary standalone run is still found. |
| `apps/forge/ui-bridge.ts` (`GET /api/agents/:slug/history`, session-path rows: `collectSessionRows` via new `readGuardedSessionStatus`) | `resolveGuardedPath` (was bare `readSessionStatus`, `packages/sessions/interactive-session.ts`) | `project`/`sessionId` entry NAMES read by `readdirSync` under `ctx.projectsRoot`/`kindDir` | guarded `[exec]` | **New route, R6-06 WI-1; hardened round 6.** The prior direct `readSessionStatus(join(kindDir, sessionId))` call was a plain `existsSync`/`readFileSync` with zero identity or nlink check — the exact function `packages/sessions/bridge-studio-sessions.ts`'s own header calls out this shape of route for NOT using. Replaced with `readGuardedSessionStatus(projectsRoot, project, kindDirName, sessionId)` → `resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId, 'status.json'])`, catching a symlinked `_<kind>` dir (the P0 shape, one segment earlier than the leaf), a symlinked `status.json` leaf, and a hardlinked `status.json` leaf, all in one call — a stricter bar than `safeReadFileInSession`'s accepted hardlink residual (row above), deliberately: this route's own task brief names the hardlink case as one of six MUST-CLOSE escapes. **Verified `[exec]`** by the same test file's escapes 4 (P0 — malicious project's symlinked `_<kind>` dir; oracle is exact attribution COUNT, not bare absence, since the realistic git-plantable fixture makes the victim project's own real directory a second, LEGITIMATE contributor of the same session id — see that test's own header for why a plain "sentinel absent" oracle does not apply here), 5 (status.json file symlink), and 6 (status.json hardlink) — each with a legitimate sibling session in the same project/kind asserted present, and the false-rejection control proving an ordinary session is still found after every escape fixture exists in the same tree. |
| `packages/sessions/bridge-studio-lifecycle.ts` (`readSessionLifecycleFacts` → `guardedMtime`) | `statSync` | `GET /api/studio/sessions` rows + `GET /api/studio/sessions/:kind/:sessionId` (`project`/`kind`/`sessionId`) | guarded `[exec]` | **New in W7-A2 (session lifecycle).** `statSync` is called ONLY on `resolveGuardedPath(root, segments).realPath` — the guard's own output (`root` = the config-derived `projectsRoot` / `logsRoot`, every request-derived id its OWN `segments[]` element: `[project, '_<kind>', sessionId, 'status.json']` and `['_<kind>-<sid>', '.heartbeat' \| 'events.jsonl' \| 'stderr.log' \| 'turn.pid']`), never a raw join; a rejected or absent path yields `null` (no oracle). Reads mtimes only — no bytes. Verified `[exec]` by `packages/sessions/tests/integration/bridge-studio-lifecycle.test.ts` (the operator's crashed/stalled fixtures derive the right state; the AT-47 symlinked-session-dir shape 404s on cancel with the victim `status.json` byte-unchanged). |
| `apps/forge/ui-bridge.ts` (`GET /api/agents/runs/recent` → `collectRecentAgentRuns`, standalone half) | `existsSync`/`readdirSync` on the ROOT itself, then `resolveGuardedPath` per entry (via `parseGuardedEventsJsonl`) | none from the request — the route takes only `?limit` (an integer, range-checked); the enumerated `_logs/` entry NAMES are the untrusted values | guarded `[exec]` | **New in W7-B5 (agents-03/04/39, the aggregate recent-runs route).** The only path this function builds from a caller value is none: `limit` never reaches a path, and the standalone half enumerates the fixed, config-derived `logsRoot` itself (`existsSync(logsRoot) ? readdirSync(logsRoot) : []`, throw-tolerant) exactly as `collectStandaloneRows` already does — the two new sink counts in `scripts/check-request-path-sinks.mjs` are that one enumeration pair. Each enumerated `entry` is an untrusted NAME read off disk, so the read of its `events.jsonl` goes through the SAME `parseGuardedEventsJsonl(logsRoot, entry)` choke point (`resolveGuardedPath(logsRoot, [entry, 'events.jsonl'])`) that closes the symlinked-dir / symlinked-leaf / hardlinked-leaf shapes for the per-agent history route; a rejected guard and a genuinely-absent `events.jsonl` collapse into the identical `null` (no oracle, and no row — an unattributable run is dropped, never fabricated). Attribution is exact-match on the run's own events (`standaloneRunSlug`, D4), never a directory-name prefix guess. Verified `[exec]` by `apps/forge/ui-bridge-agent-runs-w7b5.test.ts` (`recent:` cases — a standalone dispatch appears with its OWN slug/status/cost; the flow half stays one row per run). |
| `apps/forge/ui-bridge.ts` (`buildFlowNodeToSlug`, serving `GET /api/agents/runs/recent`) | `existsSync`/`readdirSync` over the FLOW REGISTRY dir, then `loadFlowDefinition` per flow | none — no request value reaches any path here | accidentally-safe (no request-derived component) `[exec]` | **New in W7-B5 review round 1.** The recent-runs route resolves a run’s participating agents through the run’s OWN flow (node ids are unique per flow, not globally — inverting the global slug→nodeId map attributed runs of one flow to another flow’s agent). Building that per-flow map walks `<forgeRoot>/studio/flows/*/flow.yaml`: `forgeRoot` is the config-derived install root and every path component below it is an on-disk NAME from `readdirSync` plus the fixed literal `flow.yaml` — the route’s only caller-supplied values are `?limit` (an integer, range-checked) and `?kind` (one of three literals), neither of which is ever joined into a path. Byte-for-byte the same enumeration shape `orchestrator/run-model.ts`’s `buildAgentSlugToNodeId` has always used for the same directory; a malformed flow is skipped rather than sinking the map, and an unreadable registry degrades to no attribution (never a fabricated one). The two new `existsSync` + one new `readdirSync` counts in `scripts/check-request-path-sinks.mjs` are exactly this walk. Verified `[exec]` by `apps/forge/ui-bridge-agent-runs-w7b5.test.ts`’s node-id-collision case (two flows declaring the same node id each keep their own agent). |
| `packages/sessions/bridge-studio-lifecycle.ts` (`isTurnAlive`) | `readFileSync` | none — the argument is `/proc/<pid>/cmdline` where `pid` is an integer parsed (`/^\d+$/`) from a `guardedReadFile(logsRoot, ['_<kind>-<sid>', 'turn.pid'])` read | guarded `[exec]` | **New in W7-A2.** A kernel pseudo-file, not a project/request-derived path: `pid` is a validated integer, never a request string, and the read is used only to prove the process's argv carries this session id before `killTrackedTurn` may signal it (fail-closed ownership check — an unreadable `/proc` or a mismatch reads `false`, so a stranger's pid named in a planted `turn.pid` is never signalled). Verified `[exec]` by `packages/sessions/tests/integration/bridge-studio-lifecycle.test.ts` ("turn.pid pointing at a pid whose argv does NOT carry the session id is never signalled"). |
| `packages/sessions/bridge-studio-sessions.ts` (`findSessionProject`) | `readdirSync` | none — enumerates the config-derived `projectsRoot` (trusted root, never request data); the request-derived `sessionId` only SELECTS via `resolveGuardedPath(projectsRoot, [name, '_<kind>', sessionId])` per candidate | guarded `[exec]` | **New in W7-A2** (deep links without `?project=`, cancel without `body.project`). Mirrors `collectStudioSessionIndexRows`' own trusted-root enumeration exactly; every enumerated name is additionally re-validated by `invalidProjectReason` before the guarded probe. Zero hits → 404, ≥2 → 409 (never naming the candidates). Verified `[exec]` by `packages/sessions/tests/integration/bridge-studio-lifecycle.test.ts` (dot-anchor resolution, not-found, ambiguous). |
| `packages/sessions/session-readability.ts` (`parseGuardedEventsJsonl`, `resolveLegacySession`) | `resolveGuardedPath` (the guard's own `realPath` is the only thing `readFileSync` ever sees) | `GET /api/studio/sessions/:kind/:sessionId` (the LEGACY arm), and the four pre-existing `apps/forge/ui-bridge.ts` call sites that now import this helper instead of holding a private copy | guarded `[exec]` | **New in W8-F6 (bead forge-6gv.27).** `parseGuardedEventsJsonl` MOVED here verbatim from `apps/forge/ui-bridge.ts` (rows above) so the legacy-session read path and those four call sites share ONE guarded parse rather than two copies — the sink is not new, it relocated, and `check-request-path-sinks` records it as `apps/forge/ui-bridge.ts readFileSync 8 -> 7` plus this file at 1. `resolveLegacySession` resolves `<logsRoot>/_<kind>-<sessionId>` and its `events.jsonl` leaf through `resolveGuardedPath` with `logsRoot` (fixed, config-derived) as `root` and the log-dir NAME and the literal `events.jsonl` as their OWN `segments[]` elements — never folded into `root`. `_${kind}-${sessionId}` is ONE directory-entry name (the hyphen is a character in the name, not a separator), so the per-segment identity walk plus the `nlink === 1` leaf check close the symlinked-dir, symlinked-leaf and hardlinked-leaf shapes in one place. Every rejection returns the same bare `{ok:false}` / `null` a genuinely-absent log dir returns — no reason string escapes, so this is not an existence oracle outside `logsRoot`. Verified `[exec]` by `packages/sessions/tests/unit/session-readability.test.ts` AT-F6-18/19/20 (directory symlink, `events.jsonl` file symlink, hardlinked `events.jsonl` respectively — each plants a secret marker OUTSIDE the guarded root and asserts the marker's total absence from the returned value AND the outside file's byte-identity before/after) and AT-F6-21/22 (a `..` and a `/`-embedding `sessionId`, called directly because a real HTTP client normalises both away before the server sees them), plus `packages/sessions/bridge-studio-sessions.test.ts` AT-F6-R7, which drives the symlinked-leaf escape over the REAL wire and asserts the marker never appears anywhere in the raw 404 response text. |
| `packages/sessions/bridge-studio-architect.ts` (`GET /api/architect/file/:project/:sessionId/*name`) | `resolveGuardedPath` (the guard's own `realPath` is the only thing `readFileSync` ever sees) | `project` / `sessionId` / the trailing file NAME, each its own `segments[]` element under the fixed `projectsRoot` | guarded `[exec]` | **New in M4's session-routes carve — the sink is not new, it RELOCATED.** The five `/api/architect/*` arms moved verbatim out of `apps/forge/ui-bridge.ts` into this package, and `check-request-path-sinks` records the move as `apps/forge/ui-bridge.ts readFileSync 7 -> 6` plus this file at 1: one sink leaves, one arrives, the population is conserved. Nothing about the guard changed in the move — the route still resolves through `resolveGuardedPath` and reads only `guarded.realPath`, so the per-segment identity walk and the `nlink === 1` leaf check still close the symlinked-dir, symlinked-leaf and hardlinked-leaf shapes at the same choke point. Worth stating because a relocation is exactly when a guard silently stops applying: the walker proved it still reaches this module (it reported the new pair rather than a bare disappearance from the host), and `check-raw-fs-guarded` independently scanned 65 modules where it scanned 64 before. |
| `packages/agents/bridge-agents-{run-state,history-rows,slug}.ts` (the five carved `/api/agents/*` routes) | `resolveGuardedPath` / `guardedReadFile` (unchanged choke points), plus root-level `existsSync`/`readdirSync` enumeration | `_logs/` and `projects/` entry NAMES read by `readdirSync` (never a route's own `slug` or `runId`, per D5), and the server-minted `runId` for the run-dir `mkdirSync` | guarded `[exec]` | **New in M4's agents-routes carve — every one of these sinks RELOCATED; not one is new.** The five handlers and the sixteen helper declarations behind them moved verbatim out of `apps/forge/ui-bridge.ts` into `packages/agents`, and the walker records the move as a conserved population, kind for kind: `apps/forge/ui-bridge.ts` `existsSync` 18→12, `readdirSync` 9→4, `mkdirSync` 3→2, `readFileSync` 3→2, `statSync` 5→4 — **−14 in the host** — against `bridge-agents-history-rows.ts` `existsSync` +6 / `readdirSync` +5 / `readFileSync` +1, `bridge-agents-run-state.ts` `statSync` +1 and `bridge-agents-slug.ts` `mkdirSync` +1 — **+14 in the package**. Host-minus-package is **0**, which is the evidence the carve is a MOVE rather than a copy (COMMON §15.73); the guard reported the shrink as five *tightenable* lines, which are green from one direction and are exactly where a half-updated baseline hides (§15.72), so both directions were read. Nothing about any guard changed in transit: `parseGuardedEventsJsonl` is now INJECTED rather than imported (the package is rank 3 and may not reach `@forge/sessions`), but it is the same function, supplied at `apps/forge/routes.ts` — and `resolveGuardedPath`/`guardedReadFile` are imported from `@forge/kernel` DIRECTLY and deliberately not injected, because an injected containment guard is a guard a caller can replace. The rows above describing these sinks under `apps/forge/ui-bridge.ts` remain accurate about the behaviour; only the file holding them changed. |
| `packages/agents/bridge-agents-studio.ts` (`GET /api/studio/agents`, `PUT`/`DELETE /api/studio/agents/:slug`) | `resolveGuardedPath` / `guardedFile` / `guardedWriteFile` (unchanged choke points) | URL param `slug`, gated by `SLUG_RE` + `isReservedId` before any path is built | guarded `[exec]` | **New in M4's agents-routes carve, second family — again a RELOCATION, not a new sink.** The roster GET moved from `apps/forge/bridge-studio.ts` and the upsert/delete block from `apps/forge/bridge-studio-writes.ts`; the walker records the move as a conserved population: `apps/forge/bridge-studio-writes.ts` `existsSync` 4→1, `readFileSync` 3→1, `mkdirSync` 3→2, `rmSync` 2→1, `writeFileSync` 2→1 — **−8 in the host** — against `bridge-agents-studio.ts` +3/+2/+1/+1/+1 = **+8 in the package**. Host-minus-package **0**. `PUT` and `DELETE` still share ONE handler and therefore ONE slug validation and ONE `resolveGuardedPath` containment check, exactly as the single `if (agentMatch)` block did: splitting them into two handlers would have duplicated a containment guard, which COMMON §15.47 names as a security-invariant breach rather than a smaller change. The body reaches the handler as `ctx.readBody()` (T1 ruling 30) and the DELETE arm never calls it, matching the host's own control flow. This carve minted **no** boundary row: everything the block needed was already a `packages/agents` export, a `@forge/kernel` export, or a legal rank-3 → rank-2 `@forge/library` import — only `validateAgent` and the Flow-kind pair are injected, and they are the two halves of the registry split still outstanding. |
| `packages/sessions/bridge-studio-instructions.ts` (`GET /api/instructions/file/:project/:sessionId/*name`) | `resolveGuardedPath` (only `guarded.realPath` reaches `readFileSync`) | `project` / `sessionId` / the trailing file NAME, each its own `segments[]` element under the fixed `projectsRoot` | guarded `[exec]` | **M4 session-routes carve — relocated, not new.** The instructions family moved verbatim into this package and the walker records it as `apps/forge/ui-bridge.ts readFileSync 6 -> 5` plus this file at 1: conserved, one for one. The guard is untouched by the move — same `resolveGuardedPath` choke point, same per-segment identity walk and `nlink === 1` leaf check. Its sibling row for the architect family, immediately above, was the same relocation one commit earlier. |
| `packages/sessions/bridge-studio-kickoff.ts` (the four session-MINTING routes: `POST /api/studio/onboarding/start`, `GET /api/studio/projects/:project/onboarding/active`, `POST /api/studio/authoring/start` (L12), `POST /api/studio/kbs/:kbId/cleanup/start` (K10)) | `resolveGuardedPath` / `guardedWriteFile` / `guardedSessionDir`, plus the two session writers' own `mkdirSync` + `writeFileSync` under a guard-resolved dir | `project` / `sessionId` / `kbId`, each its own `segments[]` element under the fixed `projectsRoot` or `logsRoot` | guarded `[exec]` | **M4 session-routes carve — relocated, not new, and conserved sink for sink.** The four minting routes and the two session writers (`writeOnboardingSession`, `writeAuthoringSession`) moved verbatim out of `apps/forge/ui-bridge.ts`. The walker records the move exactly: `mkdirSync 7 -> 3` in the host plus 4 here, `realpathSync 2 -> 0` plus 2 here, `writeFileSync 4 -> 0` plus 4 here — every sink accounted for on both sides, and `1346` total sink calls repo-wide unchanged. No guard was touched by the move. Worth stating for the raw-fs allowlist too: those 8 rows could NOT be re-paired by line order, because the carve appends the two writers AFTER the arms and so reverses their order relative to the host; they were re-paired by sink kind AND enclosing function instead. |
| `packages/sessions/bridge-studio-demo.ts` (the eleven `/api/demo-builder/*` routes) | mixed — `resolveGuardedPath` / `guardedFile` on the generation and history servers; the `/demo/` and `/fragment/` servers remain LEXICAL, unchanged | `project` / `sessionId` / `element` / generation number and filename | **carried mixed**: generation + history guarded `[exec]`; `/demo/` and `/fragment/` still unguarded `[read]` per the pre-existing row against bd `forge-28o` | **M4 session-routes carve — relocated, not new, conserved:** `existsSync 27 -> 26` and `readFileSync 5 -> 4` in the host, plus 1 each here; 1346 total sink calls repo-wide unchanged. **A carve changes no guard, and this one deliberately did not fix the lexical containment on `/demo/` and `/fragment/`** — that is a real pre-existing finding (the self-defeating `requested.startsWith(base)` idiom where both operands are built from the same untrusted segments), and fixing it inside a move would hide a security change in a refactor. It moves with its row intact and its caveat restated in the module header. |
| `packages/sessions/bridge-studio-session-index.ts` (`GET /api/studio/sessions`, plus the four per-kind readers it aggregates) | `resolveGuardedPath` / `guardedSessionDir` on every session dir it enumerates | `project` and `sessionId` as directory ENTRY NAMES read by `readdirSync`, never a route parameter — the index takes no untrusted input of its own | guarded `[exec]` | **M4 session-routes carve, final block — relocated and conserved:** `existsSync 26 -> 18` and `readdirSync 17 -> 9` in the host plus 8 each here, `readFileSync 4 -> 3` plus 1, with 1346 total sink calls repo-wide unchanged. This module carved LAST because it aggregates all four families' readers, so it could not move until they had. It is also the least request-derived surface in the carve: the route has no path parameters at all, and every name it touches comes from a `readdirSync` of a trusted root rather than from the URL. The `orchestrator/project-brain-builder-runner.ts mkdirSync 1 -> 0` tightening in the same run is that runner's shell losing its last reachable sink as the reader moved — handoff K21's own row shrinking as a side effect. |
| `orchestrator/studio/session-transcript.ts:149-171,189-213` | `readFileSync`/`readdirSync` | session dir from the guard above | guarded `[read]` | Real `realpathSync` containment on both dir and joined path; only fixed literal filenames accepted, never a client-supplied one. |
| `orchestrator/studio/hook-library.ts:164-198` | boundary + realpath | `hook.yaml`'s own `script:` field | guarded `[read]` | `resolveHookScriptPath` rejects literal *and* percent-decoded traversal. Note it does **not** protect against the hook *directory* being a symlink — that was a separate finding, fixed below. |
| `orchestrator/studio/hook-runtime.ts:190,194` (`readFileSync(scriptPath)`, `spawnSync('bash',[scriptPath])`) | script read + **process spawn** | any route that spawns an agent, via `packages/agents/studio/hook-dispatch.ts` | guarded `[read]` for containment · `[exec]` for the approval refusal | **W8-B6 ADDED THIS REACHABILITY DELIBERATELY, and it is the only row in this table that ends in an `execve`.** Before W8-B6 `runHookScript` had zero production callers, so both sinks scored a baseline of 0 in `scripts/check-request-path-sinks.mjs`; wiring hook dispatch into the seven claude spawn sites makes them reachable from every agent-spawning route. Three independent gates, none of them relaxed by the wiring. (1) `hookDir(id)` calls `assertSkillSlug` before any path is built, so the id is a validated single segment `[read]`. (2) `def.script` is contained by `resolveHookScriptPath` — the row directly above `[read]`. (3) `runHookScript` refuses unless `hookRunState(forgeRoot,id).runnable`, i.e. an operator approval whose ledger entry still hash-matches the current script bytes, permissions and trigger. **The refusal is `[exec]`**: `orchestrator/studio/hook-dispatch.test.ts` binds an unapproved hook to a real fixture agent, fires the real callback, and asserts the side-effect file the hook script would have written is ABSENT — and a second case approves a hook, edits its script afterwards, fires, and asserts the same absence. Dispatch calls `runHookScript` unmodified and passes **no** `parentEnv`, so `buildHookChildEnv`'s narrow `HOOK_ENV_BASE_ALLOWLIST` (never `AGENT_ENV_ALLOWLIST`) still governs the child env — pinned live by `hook-dispatch.test.ts`'s canary, which sets a var in the parent at dispatch time and asserts it is `ABSENT` in the child. **Hardened in the same lane, 2026-08-24, after a hostile review of this exact row's sinks (W8-B6 FIX-1):** the fence is a TWO-layer composition and was enforced on one. `HOOK_ENV_BASE_ALLOWLIST` closed the base, but `buildHookChildEnv` copied every `permissions.env` name out of the real `process.env` into `buildChildEnv`'s `overrides`, which apply unconditionally by design — so a manifest that simply *asked* for `ANTHROPIC_API_KEY` got the real value, proven with a real spawned child. `HOOK_ENV_CREDENTIAL_EXCLUSIONS` is now consulted by BOTH layers and the refusal is emitted as a `hook-env-grant-refused` event; and gate (3) got materially stronger, because `computeVerdict` now blocks on ANY `critical` finding (the older env-read + network-egress PAIRING was evadable through the egress detector's own documented blind spots — `/dev/tcp/`, `python3 -c`, `ssh`, `dig`, all of which are now detected), so a secret-shaped grant costs an explicit, reasoned `overrideHookBlock` instead of a one-click approve. **Standing limit, unchanged and inherited from `hook-runtime.ts`'s own header:** `permissions.read`/`permissions.network` are declared and statically scanned but NOT enforced at spawn, and file writes are not modelled at all. Making a hook fire does not change that — but it does mean an operator who authors, approves and binds a hook is now running that code for real, which is the whole point and must be read as such. |
| `packages/library/bridge-studio-community.ts:349` | recursive read | `GET /api/studio/community/:kind/:id` | guarded `[read]` | `vendoredPackageDir` does a real realpath + boundary check on the id directory. |
| `orchestrator/enqueue-flow-run.ts:78`, `orchestrator/enqueue-plan-run.ts:84`, `packages/flows/bridge-studio-runs.ts:678-717` | read/write | body `initiativeId` / `initiativeIds[]` | guarded `[read]` | `INIT_ID_RE = /^INIT-\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/` structurally forbids `/`, `\`, `.` — a genuine rejecting input exists. Charset-only: no realpath, so a *pre-planted* symlink at a validly-shaped id is not detected. |
| `orchestrator/review-comments.ts:79,94-105` | `readFileSync`/`writeFileSync` | `/api/review-comments/:cycleId` | guarded `[read]` | `SAFE_CYCLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/`, enforced twice. Charset-only, same realpath caveat. |
| `orchestrator/project-create.ts:115-167` (now `packages/projects/project-create.ts`) | `mkdirSync`/`writeFileSync` | `POST` body `name`, `appType` | guarded `[read]` | `SLUG_RE` on the slugified name; `appType` must be a member of a `readdirSync`-derived allowlist. **Ruling 38 fix (c), M4-projects-reset (existsSync 0->1, readFileSync 1->2, writeFileSync 2->3):** `stampAppType` (`packages/projects/project-create.ts`, new) reads then rewrites `.forge/project.json` — the same file `copyTemplate` just wrote seconds earlier — under `stagingProjectDir`, patching in `manifest.appType` (the SAME already-`readdirSync`-allowlisted value this row already covers) so it is persisted rather than discarded. The `existsSync` is `stampAppType`'s own early return on that identical path: a template is not required to ship a `.forge/project.json`, and a bare-template scaffold legitimately produces none (`apps/forge/cli-create.test.ts:140` pins that create as `scaffolded` + not-hard-green, which is the preflight's verdict to report and not a create failure). Boolean probe, no bytes flow through it, same path expression as the read and write beside it. No new request-derived component: the path is `join(stagingProjectDir, '.forge', 'project.json')`, and `stagingProjectDir` is the SAME server-built `.staging-<id>-<rand>` directory (`SLUG_RE`-validated `id` + server entropy `<rand>`) every other write in this function already targets. This is the root fix for the PR #289 defect `reset.ts`'s own drift-report rows document (`packages/projects/reset.ts`'s `AppTypeUnresolvedError`): before this, `appType` was validated at creation and then thrown away, so nothing on disk ever recorded which starter a project was scaffolded from. |
| `apps/forge/bridge-studio-writes.ts:199-201` | `mkdirSync`/`openSync` | body `clauseId` | guarded `[read]` | Must equal a server-computed `report.clauses` entry; 404 before any fs call otherwise. |
| `orchestrator/studio/template-library.ts:519-531` | recursive read | `GET` scaffold `:id` | guarded `[read]` | `id` must match a name the server's own `listProjectStarters` `readdirSync` produced. |
| `orchestrator/project-create.ts` (W7-B6) | `execFileSync('git', init/add/commit)` ×3 | `POST /api/studio/projects/create` body `name` (slugified) | guarded `[read]` | Fixed argv (no request-derived tokens beyond the commit message's already-`SLUG_RE`-validated `id` + allowlisted `appType`); `cwd` is the server-built `.staging-<id>-<rand>` under the config-resolved projectsRoot — `id` passes `SLUG_RE` + `isReservedId` before any path construction, `<rand>` is server entropy. `stdio:'ignore'`, no shell. |
| `orchestrator/project-create.ts` (W7-B6, projects-35) | `lstatSync` ×2 | same route | guarded `[read]` | Read-only existence probes on `projects/<id>` + `brain/projects/<id>` (fixed roots, `SLUG_RE`-validated id) whose ONLY consequence is a fail-safe REFUSAL — the create never deletes or writes through either probe (the old `rmSync` reconcile these replace was the projects-35 data-loss defect). |
| `packages/projects/project-create.ts` `mintRemote` (M5-B s7, bead `forge-8vfn.6.11.2`, operator ruling 168) | `execFileSync('gh', auth status / repo create)` ×1 site (`execFileSync` 3 -> 4) | `POST /api/studio/projects/create` body `name` (slugified -> `id`) | guarded `[read]` | **The first OUTWARD-FACING sink in this document, and it is called out as a different KIND of consequence rather than filed beside the local ones.** Every other row here can at worst read or write inside the host; this one creates a repository on github.com under a server-constant account. It therefore runs ONLY when the caller passes `remote.create === true` — absent that, no `gh` process is spawned at all and this file's behaviour is byte-identical to before. Fixed argv, no shell (`execFileSync` never invokes one). Two request-derived elements, both bounded: `id`, which passes `SLUG_RE` + `isReservedId` before any path construction and rides as `<account>/<id>` in a single argv element; and `cwd`/`--source`, which is **`resolveGuardedPath(projectsRoot, [id]).realPath`** — a fixed root with `id` as its own segment, requiring genuine per-segment realpath identity, never a lexical `join`. A path that does not resolve inside `projectsRoot`, or does not exist, throws before `gh` is invoked. `gh auth status` runs FIRST and a failure throws naming gh, so an unauthenticated host produces a loud refusal rather than a silent local-only project (the bead's own park). **ORDERING IS PART OF THE CONTAINMENT ARGUMENT:** the remote is minted LAST, after every local step has succeeded, because the create's unwind can `rmSync` a staged directory and CANNOT delete a GitHub repository — deletion needs a dedicated operator token this lane does not hold, so a remote minted before a local failure would be an unremovable orphan. Pinned by `packages/projects/tests/unit/project-create-remote.test.ts`, including a pin that a manifest failing validation makes ZERO `gh` calls. |
| `apps/forge/bridge-studio-writes.ts` `scaffoldContractArtifacts` (W7-B6, projects-11; review F4 three-way rule) | `realpathSync` ×3, `execFileSync('git', rev-parse) ×2` | `POST /api/studio/projects` body `repoPath` (via `projectRoot`) | guarded `[read]` | Identity COMPARISONS only, deciding whether to `git init`: probe 1 (`--show-toplevel`, cwd=`projectRoot`) vs realpath(`projectRoot`) detects an own-repo; probe 2 (`--show-toplevel`, cwd=`forgeRoot` — a TRUSTED server-config path, not request-derived) distinguishes "enclosed by forge's own work tree" (init) from "enclosed by the operator's real clone" (skip — never nest a `.git` inside their repo, review F4). Fixed argv, no shell; `projectRoot` was already validated by the caller's `isContainedProjectRepoPath` before this function runs, and nothing is read or written through the realpathed values. |
| `apps/forge/bridge-studio-writes.ts` `scaffoldContractArtifacts` + `checkContractArtifactContainment` (W7-FIX-B-PROJ, born-contract-green) | `existsSync` ×2, `writeFileSync` ×1 | `POST /api/studio/projects` body `repoPath` (via `projectRoot`) | guarded `[exec]` | The C2 hygiene `.gitignore` written ONLY on the two branches that `git init` a repo from nothing, ONLY when absent (never clobbers an operator file). Both `existsSync` calls are boolean "already there, skip" probes; the write goes through `resolveGuardedPath(projectRoot, ['.gitignore']).realPath`, which rejects a symlinked or dangling leaf (the SEC-03 Finding-B roadmap.md idiom, mirrored — a dangling symlink at `.gitignore` reads absent to `existsSync` but is refused by the guard before the write). Content is server-constant (`SCRATCH_PATHS` + `SCAFFOLD_BUILD_OUTPUT_IGNORES`, both exported by `packages/projects/preflight.ts`); the Phase-1 pure pre-check gained the matching `.gitignore` guard so no write on the route can be attempted before every path it may touch is proven safe. Review round (W7-FIX-B-PROJ F2): the pre-check's `.gitignore` guard is CONDITIONAL on the shared `needsGitInit` predicate — the exact condition under which the scaffold writes the file — so an own-repo / operator-enclosed checkout (whose `.gitignore` is never written, dangling symlink or not) is no longer false-rejected; check/write parity is kept by both sites calling the same predicate. |
| `apps/forge/bridge-studio-writes.ts` `scaffoldContractArtifacts` (W7-D fix round, projects-37) | `execFileSync('git', add/commit)` ×2 | `POST /api/studio/projects` body `repoPath` (via `projectRoot`), body `name` | guarded `[read]` | The initial commit the onboard path was missing — the greenfield sibling (`orchestrator/project-create.ts`, row above) has always made one, and the asymmetry is what left an UNBORN repo whose every subsequent Studio write 500'd (projects-37, S1). Runs ONLY on the branch that just `git init`'d a repo from nothing, gated by the same `repoInited` flag the `init` itself sets, so it can never touch an operator's own checkout. Fixed argv, no shell (`execFileSync` never invokes one); the only request-derived bytes are `cwd: projectRoot` — the SAME already-audited value the `git init` at this site uses, validated by the caller's `isContainedProjectRepoPath` before this function runs — and `name`, which rides as a single argv element inside the commit MESSAGE and never reaches a path, a shell or an env var. Identity is passed per-invocation (`-c user.name=forge -c user.email=forge@localhost -c commit.gpgsign=false`) so an unattended host with no global git identity still commits, and `stdio:'ignore'` keeps request text out of the server log. Best-effort by design: a git failure is swallowed because `ensureStudioBranch`'s unborn guard (`orchestrator/project-repo-tx.ts`) is the real fix and backstops it — a git hiccup must not fail an otherwise-good onboarding. Pinned `[exec]` by `apps/forge/onboard-first-save.test.ts` (the FIRST `PUT /api/studio/projects/:id` after a from-nothing onboard returns 200). |
| `packages/projects/preflight.ts` `checkC2` (W7-FIX-B-PROJ review F1) | `lstatSync` ×1 | bridge preflight routes (via the validated project dir) | guarded `[read]` | Boolean "does the dir-shaped scratch path exist as a NON-directory" probe on `join(dir, pathArg)` — `dir` is the route-validated project dir and `pathArg` comes from the server-constant `SCRATCH_PATHS`, never from the request. `lstat` deliberately (not `stat`): a symlink at e.g. `.forge/work-items` is a link object to git, so dir-only ignore patterns never match it and the sentinel-child probe alone would false-PASS C2 while `git add -A` swept the stray entry into the PR. The probe's only consequence is adding the path itself to the `git check-ignore` probe set — a fail-safe strictly toward REFUSAL (C2 violation), never a read/write through the path; a throwing `lstat` (absent path, ancestor-is-a-file) falls back to the sentinel child alone. Pinned by `packages/projects/preflight.test.ts` (stray-FILE red pin, symlink pin, real-dir green-lock). |
| `packages/projects/preflight.ts` `checkC1` (W8-A1, bead forge-7pa / regate projects-12) | `existsSync` ×1, `readFileSync` ×1 | bridge preflight routes (via the validated project dir) | guarded `[read]` | `join(dir, 'package.json')` — `dir` is the route-validated project dir (`runPreflight` resolves it once and every clause receives that same value) and the leaf is the **server constant** `'package.json'`; nothing from the request reaches the join, so no `..`, `/` or `\` can be introduced at this site. Same shape and same trust boundary as the `checkC2` row directly above. The read is content-bearing (unlike `checkC2`'s boolean probe) but its only consequence is a C1 verdict: the parsed JSON is inspected for a `scripts` key and then discarded — nothing is echoed back and nothing is written. A throwing or malformed read fails **closed** (C1 `pass:false` with the parse error in the detail), never open, so a hostile filesystem condition can only cost a false rejection. The declared gate command is **never executed** — this closes the ancestor-`package.json` false-green without adding an exec sink. Pinned by `packages/projects/preflight.test.ts` (no-package.json red pin, missing-script pin, malformed-JSON fail-closed pin, and a `go test ./...` negative control proving the rule is scoped to package-manager gates). |
| `apps/forge/bridge-studio-writes.ts` `needsPackageJsonScaffold` + `scaffoldContractArtifacts` (W8-A1, bead forge-7pa) | `existsSync` ×1, `writeFileSync` ×1 | `POST /api/studio/projects` body `repoPath` (via `projectRoot`) | guarded `[exec]` | The scaffold's CONDITIONAL FOURTH write target, mirroring the C2 hygiene `.gitignore` precedent exactly. A minimal `package.json` is written only when the declared quality gate is package-manager-shaped, no `package.json` exists, AND `needsGitInit` is true — i.e. only when the scaffold is itself establishing the repo; an operator's own checkout is never written into. All three conjuncts live in ONE predicate (`needsPackageJsonScaffold`) called by both the Phase-1 pure pre-check and the write site, so check/write parity cannot drift — the same single-predicate rule review F2 imposed on `.gitignore`. The `existsSync` is a boolean probe on `join(projectRoot, 'package.json')`: `projectRoot` is `isContainedProjectRepoPath`-validated at the route and the leaf is a server constant, so nothing request-derived reaches the join. The write goes through `resolveGuardedPath(projectRoot, ['package.json']).realPath`, which refuses a symlinked or dangling leaf — pinned by a test that plants a `package.json` symlink pointing OUTSIDE the project root and asserts the outside target is **byte-unchanged**, not merely that the response was non-200. Content is server-constructed (name/version/private + the one script the declared gate names); the `test` script body is npm's own `echo "Error: no test specified" && exit 1`, chosen because it exits NON-ZERO — a placeholder that exited 0 would recreate the false green this whole change closes, one layer down. Implementation note worth keeping: `needsGitInit` is evaluated ONCE, before the scaffold's own `git init` side effect, and the boolean is reused at the write site — recomputing it after `git init` would silently answer false and disable the scaffold for the exact from-nothing case it exists to serve. |

### Fixed in this sweep

| file:line | op | request field | was | evidence |
|---|---|---|---|---|
| `orchestrator/brain-paths.ts:74` (`resolveKbBrainDir`) | `existsSync` | `:id` on every `/api/studio/kbs/*` route | unguarded `[exec]` | `resolve()` + `existsSync()`, no realpath, no identity, no `nlink`, on **both** candidate roots. The choke point for the whole KB family. Now `resolveGuardedPath` on each root with `kbId` as its own segment. |
| `orchestrator/kb-graph.ts` themes/`_raw`/`_guidance`/`INDEX.md`/node-leaf joins | `readdirSync`/`readFileSync` | `GET /api/studio/kbs/:id`, `/nodes/:nodeId` | unguarded `[exec]` | Bare `join()` off an unresolved kb dir. A **real** `brain/<id>/` whose `themes` was a symlink leaked outside theme bodies into the graph response. Now every nested join goes through a `guardedKbPath` helper. |
| `packages/knowledge/bridge-studio-kbs.ts` guidance route | `mkdirSync`/`writeFileSync` | `POST /api/studio/kbs/:id/guidance` | unguarded `[exec]` | **Arbitrary file WRITE.** A real `brain/<id>/` with `_guidance ->` outside wrote the attacker's payload outside `brain/`, 200 OK. Both "guards" compared a string against itself. |
| `packages/knowledge/bridge-studio-kbs.ts` bootstrap route | `writeFileSync` | `POST /api/studio/kbs/:id/bootstrap` | unguarded `[exec]` | **Arbitrary file CREATE.** `existsSync` is `stat`-based so a *dangling* `profile.md` symlink read as absent, and `writeFileSync`'s default `O_CREAT` (no `O_NOFOLLOW`) created the file at the outside path. The guard's probe is `lstat`-based, so a dangling link is now routed into the realpath check instead. |
| `packages/knowledge/bridge-studio-kbs.ts` create / delete / nodes / detail routes | `mkdirSync`/`rmSync`/reads | `POST /api/studio/kbs`, `DELETE /:id`, `GET /:id`, `GET /:id/nodes/:nodeId` | unguarded `[exec]` | Vacuous `startsWith` checks at six locations across these routes plus guidance and bootstrap. Three built a `kbDir` the route never used and are **deleted** rather than kept as false assurance; the rest are **replaced** by a real guard. Each was verified genuinely vacuous before removal — SLUG_RE already forbids every character that could make the comparison false. |
| `apps/forge/bridge-studio-writes.ts:1010` (`flowProjectOf`) | `readFileSync` | `PUT /api/studio/flows/:id` body `triggers[].target.ref` | unguarded `[exec]` | bd `forge-b2k`. **Existence oracle** (a read, not a write): `ref` comes from the request *body* and the route's `SLUG_RE` gate covers the URL param only. Now `SLUG_RE` + guard, with every rejection returning `undefined` so a rejected and an absent flow are indistinguishable — an oracle closes only when those two cases cannot be told apart. |
| `apps/forge/bridge-studio.ts:618` | `readFileSync` | `GET /api/studio/flows/:id` | unguarded `[exec]` | Guard symmetry: the `PUT` sibling was hardened, this `GET` was not — a symlinked `studio/flows/<id>` disclosed an outside `flow.yaml`. |
| `packages/library/bridge-studio-skills.ts:230,269` | `readFileSync`, `approveSkillDraft` | `GET /api/studio/skills/:id`, `POST /:id/approve` | unguarded `[exec]` | **Arbitrary file WRITE** on the approve route: confirmed live mutating a `SKILL.md` outside the repo through a symlinked `skills/<id>`. Resolved via `skillPath()` = `assertSkillSlug` (charset only) + bare `join()`. |
| `packages/library/bridge-studio-hooks.ts:245,259-261,280,306,342` | `mkdirSync`/`writeFileSync`/`readFileSync` | `POST /api/studio/hooks`, `/:id/approve`, `/:id/override`, `GET /:id` | unguarded `[exec]` | **Arbitrary file WRITE** on create: confirmed live writing `hook.yaml` + `scripts/run.sh` into a symlinked outside dir. `hookDir`/`hookYamlPath` are `assertSkillSlug` + bare `join()`. |
| `packages/knowledge/bridge-studio-kbs.ts:87-116` (`loadKbDescriptors`/`pushFrom`) | `existsSync`/`readFileSync` | `GET /api/studio/kbs` | unguarded `[exec]` | Found by the **attack-the-guard round**, after the fixes above had landed. `subDirs`' dirent filter blocks a symlinked kb DIRECTORY but says nothing about the LEAF: a genuinely real `brain/<id>/` whose `kb.yaml` was a symlink returned the outside file's `name`/`desc` verbatim in a 200. The sweep had closed every KB route except the list route, against the very file it was built to protect. Now guarded on both roots, with `INDEX.md` / `themes` / `_raw` independently guarded. |
| `packages/kernel/path-guard.ts:213-272` | (the guard itself) | any caller with a multi-segment tail | unguarded `[exec]` | A defect **inside the ratified guard**, found by the attack round. `isSafeSegment` ran lazily inside the walk, but the walk BREAKS at the first absent segment and reassembles the rest with a bare `join()` — so segments past the break were never inspected and a later `..` was normalised away: `['idA','nonexistent','..','..','idB','kb.yaml']` returned `{ok:true, exists:false}` pointing at a **different, genuinely existing** object. Cross-object escape re-entering through create-mode, and it falsified the module's own comment. Check hoisted to cover all segments. Not reachable from any current call site — a latent defect in shared infrastructure, **not** a closed escape. |
| `orchestrator/studio/hook-scan.ts:364-367` (`readHookScriptBody`), `packages/library/bridge-studio-hooks.ts:119,303,335` | `readFileSync` | `GET /api/studio/hooks`, `POST /:id/approve`, `/:id/override` | unguarded `[exec]` | Two coupled faults, **not** disclosure — `loadHookDefinition` already rejects an escaping `script:`, and `sanitizeError` redacts paths. (1) The script read used a bare `join()`, so the dangling-symlink and hardlink shapes `resolveHookScriptPath` cannot see were unguarded. (2) `hookRunState` throwing for ONE hook inside the listing route's bare `.map()` blanked the operator's **entire** hook library behind a 500 — an element-level fault becoming a collection-level failure — while approve/override surfaced that same throw as a distinguishable 500 where every other route returns 404, a working oracle for "an id exists here and its script escapes". Read now guarded; per-entry fault isolation restored; oracle collapsed into 404. |

Each fix keeps the charset check as an independent **first layer** and adds containment as the second — the guard module deliberately never validates slug shape. Rejections collapse into the same 404 as a genuinely unknown object so the routes are not probes for which ids are planted.

### Unguarded — filed, not fixed (a different containment design is required)

| file:line | op | request field | class | evidence / why not mechanical |
|---|---|---|---|---|
| `apps/forge/ui-bridge.ts:1533,1813,2261,2316` and ~14 sibling session routes | `mkdirSync`/`writeFileSync` | body `project`, `sessionId` | unguarded `[read]` | `architectSessionDir(projectsRoot, body.project, sessionId)` with only a truthiness check — `SAFE_PROJECT_NAME_RE` exists in the same file and is never applied. A `..`-bearing `project` escapes `projectsRoot` and `mkdirSync(recursive:true)` creates it. → bd `forge-28o` |
| `apps/forge/ui-bridge.ts:1719-1720,2000-2001,2505-2506` (line numbers current as of SEC-03; the original audit's `1500,1774,2145,2210` shifted as R4-16 inserted code above them) | `existsSync`/`readFileSync` | `GET /api/architect/file/:project/:sid/:filename`, `GET /api/instructions/file/:project/:sid/:filename`, `GET /api/demo-builder/history/:project/:id` | unguarded `[read]` | Self-defeating idiom: `base` **and** `requested` are both built from the same unvalidated `project`/`sessionId` (`project`/`id` for the history route), so `requested.startsWith(base)` bakes the taint into both operands and cannot fail for traversal inside those segments — it CAN, correctly, fail for traversal inside the trailing `filename`/`id` component alone, which does NOT feed `base`. The guard must run on the *inputs*, not on two paths built from them. **`demo-builder fragment` (`/demo/` and `/fragment/`) is SPLIT OUT of this row** — SEC-03's Deliverable-B severity re-assessment (below) found it is a materially different, and worse, shape than this one, not an instance of it. → bd `forge-28o` |
| `apps/forge/ui-bridge.ts:781,818,853,904,2468,2489` | `readFileSync`/`writeFileSync` | `GET /api/events/:cycleId`, `/graph/`, `/work-item/`, `/artifact/`, `POST /api/reflect/:cycleId/answer` | **fixed (SEC-04, bd `forge-ebj`)** `[read]` | `cycleId` is `decodeURIComponent`'d with no validation on most of these (the `/artifact/` route alone charset-gates it). `POST /api/reflect/:cycleId/answer` is a **write**. → bd `forge-2zz`  **CLOSED — re-derived against HEAD during W8-C2a (bead `forge-2zz`); this row was stale.** The whole `cycleId` family now routes through the guard: `apps/forge/ui-bridge.ts` carries `resolveGuardedPath`/`guardedReadFile` call sites at `:1788`, `:1826`, `:1859`, `:1899` and `:1973`, each with an in-line comment citing "SEC-04 (bd `forge-ebj`)" and naming the exact defect it closed (a `cycleId` folded raw into a base, or a lexical `startsWith` that could not fail). The `POST /api/reflect/:cycleId/answer` write named above is among them. |
| `orchestrator/studio/skill-library.ts:500-537,613-631`, `orchestrator/studio/community-install.ts:163-176` | `readdirSync`/`writeFileSync` | `POST /api/studio/skills/install` body **`packageDir`**; community install | unguarded `[read]` | Two problems. (1) `packageDir` *is* the containment root — a raw client string with no allowlist tying it to any forge directory, so any server-local path can be named and copied into `skills/<id>/`. (2) The install loop writes N entries whose own relative sub-paths are joined onto the destination — the classic zip-slip shape, needing **per-entry** verification, not one call. → bd `forge-q80` |
| `packages/knowledge/bridge-studio-kbs.ts:788-794` | spawn arg | `POST /api/studio/kbs/:id/maintenance` body `file` | **fixed (W8-C2a, bead `forge-2zz`)** `[read]` | Client supplies a full absolute path; `resolve(file) !== file → reject` blocks `..` but does no realpath. `segments[]` requires single-component names, so this needs a request-shape change (`{kbId, relPath}`), not a guard call. → bd `forge-2zz`  **CLOSED — and this row's stated reason for deferring it was wrong.** It claimed a `{kbId, relPath}` request-shape change was required because "`segments[]` requires single-component names". Splitting a relative path on the separator and passing each component as its own segment is exactly how the guard is meant to be used for nested paths (`packages/library/skill-staging.ts` already does it), so no contract change was needed and **no `forge-ui` file was touched**. The route still accepts the client's full absolute `file`; server-side it keeps the `abs !== file` rejection (which refuses a path that is not what it declares), then relativises against the fixed `brain/` root and re-resolves through `resolveGuardedPath`. It is the guard's own `realPath` that reaches `spawnBrainFix`, never the caller's string — reusing the validated string would leave a TOCTOU window for no benefit. The escape this closes is an already-normalised path through a **symlinked intermediate** under `brain/` reaching a spawned `brain fix --file` that WRITES. Pinned by an AT that reads the outside file's bytes before and after and asserts byte-equality, and proves non-dispatch by asserting no `_brainfix-*` run dir appeared — pre-fix one did. |
| `apps/forge/bridge-studio.ts:471`, `packages/knowledge/bridge-studio-kbs.ts:151`, `apps/forge/bridge-studio.ts:389` | `readFileSync` | `GET /api/runs/:id/phases/:node/log`, `/kbs/:id/fix-agent/:runId`, preflight fix-agent | **fixed (W8-C2a, bead `forge-2zz`)** `[read]` | Lexical `resolve+startsWith`. The phase-log route does not charset-gate `runId` at all, unlike every sibling in that file. Exploitability needs a pre-planted symlink under `_logs/`; no HTTP-reachable primitive to plant one was found, so severity is low — but the checks provide no containment. → bd `forge-2zz`  **CLOSED — all three upgraded, not risk-accepted.** Each now routes through `resolveGuardedPath`'s per-segment realpath identity walk, with the trusted root fixed and the untrusted id entering only as its own `segments[]` element. `readBrainFixState` (`packages/knowledge/bridge-studio-kbs.ts`) and `readPreflightFixState` (`apps/forge/bridge-studio.ts`) resolve the fixed `<forgeRoot>/_logs` root with the prefixed run-dir name and `events.jsonl` as two separate segments, then read the guard's own `realPath`; a rejection collapses into the same fail-soft `running` a not-yet-started run reports, deliberately, so the route is not a probe oracle. The phase-log route guards BOTH branches (the literal-id probe and the `findRun`-resolved fallback) and keeps its 400/404 split unchanged. **Two holes, not one:** besides the symlink-blindness this row described, that route's `([^/]+)` regex matches the RAW url while `decodeURIComponent` runs AFTER it, so `%2F..%2F` became a separator only once the regex had approved the match — the percent-encoded-traversal shape, reachable only via a raw request and invisible to any normalising client. `resolveGuardedPath` rejects a separator-bearing segment, closing it structurally. Pinned by `apps/forge/bridge-studio-residual-containment.test.ts` (12 ATs, 5 genuinely red first), including a hand-built-socket wire-level test for the encoded shape and non-regression cases for legitimate ids containing `.`, `-` and a leading `..`. Consequence for the ratchet: the seven `scripts/check-raw-fs-guarded.mjs` allowlist rows these sinks required were **deleted**, not remapped — 73 residuals to 69. |
| `orchestrator/project-config.ts:305-308,326-328` | `existsSync`/`readFileSync` | `PUT /api/studio/projects/:id` → real `projectRoot` + `AGENTS.md` / `.forge/quality_gate_cmd` | **fixed (W8-C2a re-derivation)** `[read]` | A symlinked `.forge` directory or leaf is followed, three lines from a sibling call that closes exactly that shape. Mechanical, but outside this sweep's route set and reached from the scheduler too. → bd `forge-2zz`. **Completeness note (R2-08-F3):** the new `resolveProjectIdForRepo` (same file; called from `packages/flows/bridge-hooks.ts`'s signature-verified `/api/hooks/:hookId` route, resolving `pr-merged`/`issue-raised` deliveries to a project id) calls `loadProjectConfig` — and therefore this SAME gap — once per DISCOVERED project, not just the addressed one, since resolution scans the whole roster looking for a `repo:` match. The request-derived value (the payload's `repo` string, `REPO_RE`-validated at extraction) is only ever COMPARED against each project's declared `repo:`; it is never used to build a path or select which directory gets scanned (`discoverProjects` enumerates real, pre-existing directories regardless of the payload). A NEW caller reaching the pre-existing gap, named per the "one sink, many entry points" completeness rule below, not a new finding — `scripts/check-request-path-sinks.mjs` shows no baseline drift from this addition because `resolveProjectIdForRepo` composes already-tracked functions (`loadProjectConfig`, `discoverProjects`, `resolveProjectsDir`) rather than adding new raw sink calls of its own.  **CLOSED — re-derived against HEAD during W8-C2a (bead `forge-2zz`), and this row was carrying a false claim until now.** `orchestrator/project-config.ts` imports `guardedReadFile` at `:20` and all three reads go through it: `loadProjectConfig` at `:279` (`guardedReadFile(projectRoot, PROJECT_CONFIG_REL_PATH.split('/'))`), `readAgentInstructionsFile` at `:329`, `readQualityGateSidecar` at `:351` — the per-segment realpath identity walk, so the symlinked-`.forge` shape this row describes now returns null and is treated as absent. Recorded here rather than only in campaign state: a disclosure that outlives its defect is as misleading as one that was never written, and this table is the artifact a future reader actually consults. |
| `orchestrator/studio/community-index.ts:271-274,310-323` | `readFileSync` | `GET /api/studio/community/:kind/:id` | unguarded `[read]` | Fixed-filename direct reads bypass the dirent-walk protection the rest of that module gets — a leaf-symlinked `SKILL.md`/`hook.yaml` inside an otherwise dir-guarded package is followed. → bd `forge-q80` |
| `packages/flows/bridge-studio-runs.ts:559,598,603` | `readFileSync`/`writeFileSync` | `POST /api/plan-verdict` body `project`, `sessionId` | unguarded `[read]` | `project` **is** `SLUG_RE`-gated and `sessionId` `SAFE_ID_RE`-gated here (materially stronger than the `ui-bridge.ts` equivalents), but `_architectSessionDir` is still a bare `join()` with no realpath. → bd `forge-28o` |
| `apps/forge/ui-bridge.ts:2284,2289,2313,2321` (`GET /api/demo-builder/sessions`, via `listDemoSessions`) | `existsSync`/`readdirSync` | `status.project_repo_path` read off each session's `status.json` | unguarded `[read]` | Found by SEC-03 WI-6's caller enumeration and deliberately NOT fixed there — stated rather than silently declared covered. The route takes no `project`/`sessionId` parameter, so it is not reachable by a routing escape, and it only probes existence and lists filenames (booleans and names, never file CONTENT). A forged value reaching it needs the same on-disk write precondition as the row above. Fixing it belongs with the session-status trust question as a whole, not inside a two-route content fix. → bd `forge-28o` |

### Fixed in SEC-04 — full-path (leaf-inclusive) containment across every request-derived fs sink, + a mechanical lint

**This is the row that closes the whole "Unguarded — filed, not fixed" table
above** (except the two items whose fix is a *request-shape* change, not a guard
call — see the residuals below). SEC-04 began as "guard the unguarded session
route family" and, after two adversarial re-attacks reopened the class one layer
down each time (an architect module a file away, then a symlinked *leaf* inside an
already-guarded *dir*), was re-scoped to its true shape: **contain the full opened
file path — the leaf included — at every request/project-derived filesystem sink,
across all modules, enforced mechanically.**

**The primitive.** `guardedFile(root, segments, 'read'|'write'|'readdir')` +
`guardedReadFile`/`guardedWriteFile`/`guardedReadDir` (`packages/kernel/path-guard.ts`)
route the *entire* path — every directory segment **and the leaf filename** — through
the existing `resolveGuardedPath` (per-segment realpath identity, `nlink===1` leaf
check, fail-closed, no missing-vs-escape oracle). The caller passes a trusted,
config-derived `root` (`projectsRoot`/`logsRoot`/`forgeRoot`) and every
request-derived id (`project`, `sessionId`, `cycleId`, filename, and
`project_repo_path`) as its own `segments[]` element — never folded into `root`.
~100 sink sites across `apps/forge/ui-bridge.ts`, the architect/instructions/project-brain/
demo runners, `bridge-studio*`, `metrics`, `contract-stages`, and `project-config`
were routed onto it. Guarded leaf siblings (`guardedReadSessionStatus`,
`guardedReadStatus`, …) carry the shared readers.

**A fourth primitive, M4: `guardedRename(root, fromSegments, toSegments)`**
(`packages/kernel/path-guard.ts`), added for the project-contract reset, which
relocates a managed project's skill directories to the layout the resolver
actually reads — every path derived from a request-supplied project id. It
resolves **both endpoints independently** through `resolveGuardedPath`, each
component its own segment: the destination is never built by `join()`ing off
the verified source or off `root`, which is the shape this document names five
times as the recurring defect. Check-then-act, the two-phase ordering
`seedProjectBrain` was fixed into — both endpoints validated with zero writes,
`renameSync` only after both pass, so a rejection leaves nothing moved at
either end. It **refuses** an existing destination rather than clobbering it
(unlike `guardedWriteFile`, whose contract is to overwrite a leaf), does not
create the destination's parent (a caller needing one creates it through its
own guarded call, so that directory is itself guarded), and adds no
copy-then-delete `EXDEV` fallback — a copy loop would be a second, unguarded
write path with none of a rename's atomicity. Its `renameSync` call takes
`resolveGuardedPath`'s own blessed output on both sides, the same shape
`guardedWriteFile`'s `writeFileSync` already has, and is classified **guarded**
(`scripts/request-path-sinks.baseline.txt`, `packages/kernel/path-guard.ts
renameSync 1` — the ratchet flagged it on introduction, in the PR that
introduced it, which is the ratchet working). Pinned by 13 containment cases in
`packages/kernel/path-guard-rename.test.ts`, every one written RED first:
`..` on each side, an absolute-shaped segment on each side, a symlinked source
dir, a symlinked destination parent, a symlinked intermediate on each side, a
dangling destination leaf, the clobber refusal with a source-survives
assertion, a percent-encoded segment proved to stay literal, and a recursive
before/after filesystem snapshot proving a rejection changes nothing anywhere
under `root`.

**The rows this closes** (all reproduced then re-confirmed contained by execution):
the session-route family (`architectSessionDir`/`instructionsSessionDir`/
`projectBrainSessionDir` bare joins; the `/start` unconditioned writes; the
self-defeating `/file` `startsWith(base)` idiom; the AT-47 symlinked `_<kind>` list
routes) → **`forge-28o`**; the `POST /api/plan-verdict` bare `_architectSessionDir`
→ **`forge-28o`**; `listDemoSessions` and the `readSessionStatus`/`readStatus`
symlink sweep (~17 callers, the generic-`<T>`-syntax callers a naïve grep missed)
→ **`forge-9vv`**; the `cycleId` family (`events`/`graph`/`work-item`/`artifact`/
`reflect` read **and** write) → **`forge-2zz`** (fs-sink rows); the `demo-builder/
history` LIST+SERVE arbitrary read (a fourth module neither early commit touched);
and `project-config.ts`'s `.forge/project.json` + `AGENTS.md` + `.forge/quality_gate_cmd`
leaf reads (reached from the verdict send-back **and** the scheduler) → **`forge-2zz`**.

**The mechanical guarantee** (`forge-uie`, and its generalisation). Two ratchets now
guard the class rather than a one-time sweep: (1) `scripts/check-request-path-sinks.mjs`
gained caller-counting over a designated-unguarded-function set (a *new caller* of an
unguarded shared reader in *any* file now trips it — the blind spot that let R6-06
ship a cross-project read); (2) **`scripts/check-raw-fs-guarded.mjs`** — a new
taint-triggered def-use lint (wired into CI) that **fails any `readFileSync`/
`writeFileSync`/`readdirSync`/`existsSync`/`statSync`/`mkdirSync` on a request-derived
path not produced by the guard**, across 22 handling modules. Its taint model covers
body/params/query/req heads, bare-name binding-wins ids, **url-derived ids**
(`decodeURIComponent(url.match(re)[n])`, `url.split()`), and **interprocedural
leaf-append** through a bare dir param (`sessionDir`/`projectRoot`/…). It currently
reports **0 unguarded sinks**; every residual is on an explicit, reasoned,
line-keyed allowlist. That 0-findings — not a hand re-attack — is the completeness
proof going forward.

**Residuals, disclosed not silent** (each an allowlist row, none a wire-reachable
escape). **Amended W8-C2a (2026-08-23) — two of the three items this paragraph listed
are now closed, and the paragraph is corrected rather than left standing:**

- ~~the `_logs/<id>/…` event-read family (phase-log, preflight/brain-fix state) is
  symlink-blind behind charset/lexical gates~~ — **CLOSED.** The phase-log route,
  `readBrainFixState` and `readPreflightFixState` all resolve through
  `resolveGuardedPath` now; the phase-log route also turned out to carry a
  percent-encoded-traversal hole this paragraph never mentioned. Their seven
  allowlist rows were deleted. The *rest* of the family named here (session stats,
  work-item snapshot) is untouched by that work and remains a disclosed residual —
  same safety argument, that no route lets an attacker plant a symlink under
  forge-owned `_logs`.
- ~~the `POST /api/studio/kbs/:id/maintenance` `file` arg … needs a
  `{kbId, relPath}`-style contract change, not a guard call~~ — **CLOSED, and that
  reasoning was wrong.** Splitting a relative path into per-component segments is
  how the guard is meant to handle nested paths, so it took no contract change and
  no client edit. See the Table-2 row above.
- the `skills/install` `packageDir` **remains open** under **`forge-q80`** (SEC-05's
  lane) — genuinely a request-shape problem, unaffected by the above.
- the guard still inherits a documented check-then-use TOCTOU window (needs an
  `O_NOFOLLOW` atomic open Node does not ergonomically expose). The `projects/<name>` *directory
entry* being itself a symlink stays the guard's stated `root`-is-trusted contract
residual — not wire-reachable, since an in-repo git commit controls a project's
*contents*, never its enclosing directory entry.

### Extended in R1-06 — KB `op=consolidate` / KB-create sinks (`[read]`)

R1-06 added `POST /api/studio/kbs/:id/maintenance` `op=consolidate` (deterministic
+ agent-tier drain of a KB's `checkProjectBrainIndexes` findings) and a hand-off
session write on KB create. Every new fs sink these introduced was swept against
`scripts/check-raw-fs-guarded.mjs` (all in `packages/knowledge/bridge-studio-kbs.ts` unless noted)
and `scripts/check-request-path-sinks.mjs`; none is request-body-steerable:

- **Consolidate index-append (`ensureLinkedAt`, `packages/knowledge/brain-fix-auto.ts`), called
  from `applyDeterministicConsolidateFixes`** — writes into the category-index
  path returned by `consolidateTargetFile(forgeRoot, f)`, which parses
  `resolve(forgeRoot, m[1])` out of a `checkProjectBrainIndexes` **Finding's own
  `message`** (`packages/knowledge/brain-lint.ts:337-407`) — never the request body. Tracing that
  finding's construction: `projectDir = join(projectsRoot, name)` where `name` is
  `readdirSync`-enumerated (a real directory forge itself created, most recently
  via the KB-create route's own `resolveGuardedPath`-contained scaffold below —
  never an attacker string), and `indexFile` is one of four LITERAL filenames
  (`CATEGORY_TO_INDEX_FILE[cat]`, `cat` itself constrained by
  `ALLOWED_CATEGORIES.has(cat)`). LINTER-DERIVED, server-enumerated path;
  `scopeFindingsToKb`/`findingUnderDir` additionally confine every finding this
  loop touches to the dispatching KB's own `resolveKbBrainDir`-resolved dir
  (realpath-identity comparison, not a lexical prefix) before it ever reaches
  `ensureLinkedAt`. `packages/knowledge/brain-fix-auto.ts` is not itself in
  `check-raw-fs-guarded.mjs`'s scanned-module list (a shared helper, not a
  request handler); its `existsSync`/`readFileSync`/`writeFileSync` growth (+1
  each of the first two, tracked by the sink-count ratchet) is this same
  call, `--write`-accepted below.
- **KB-create scaffold `mkdirSync(join(kbDir,'themes'|'_raw'))`**
  (`packages/knowledge/bridge-studio-kbs.ts:993-994`) — `kbDir = kbGuard.realPath` from
  `resolveGuardedPath(brainBase, [id])`, and the route 409s on `kbGuard.exists`
  before this runs, so it only ever mkdirs a FRESH, just-created dir; the
  appended leaves are literals. Allowlisted (`check-raw-fs-guarded.mjs`,
  CREATE-LITERAL-SUBDIR) — unchanged from the pre-R1-06 site, just line-drifted
  by earlier insertions in the same file.
- **KB-create hand-off session write** (`guardedWriteSessionStatus(projectsRoot,
  [sessionProject, '_project-brain', sessionId], …)`,
  `packages/knowledge/bridge-studio-kbs.ts:1028-1041`) — routes through
  `guardedFile(projectsRoot, [...segments, 'status.json'], 'write')`
  (`packages/sessions/interactive-session.ts:303-314`; the write-root fence those lines
  discuss now lives in `packages/sessions/session-write-fence.ts` — M5-A split, ruling 192),
  a GUARD_PRODUCERS-listed
  guard-terminal call; the checker sees no raw sink at this call site at all.
  `sessionId = newProjectBrainSessionId()` is server-generated;
  `sessionProject` is either a real `discoverProjects`-verified project id or a
  dot-prefixed `KB_SEEDING_ANCHOR_PREFIX + id` where `id` is the already-
  `resolveGuardedPath`-proven-contained KB id from the same create route.
- **Consolidate-run log dir/writes** — `writeConsolidateTerminalEvent` /
  `writeConsolidateErrorTerminalEvent` (`packages/knowledge/bridge-studio-kbs.ts:252-296`,
  `mkdirSync`/`appendFileSync` on `join(forgeRoot,'_logs','_brainfix-'+runId)`)
  and the brain-fix turn's own heartbeat dir (`packages/sessions/kinds/fix-turn.ts`
  since M4 ports 5–6; was `brain-fix-runner.ts`, and the path in this row was
  stale at `orchestrator/` before that),
  newly reachable from the bridge because `bridge-studio-kbs.ts` now imports
  `runBrainFixTurn` directly instead of only spawning it as a subprocess via
  `apps/forge/cli.ts`). Both take a bare `runId` parameter — a name on the
  raw-fs-guarded lint's curated taint list — but at every call site the actual
  value is TRUSTED AT CONSTRUCTION: the outer `runId` is
  `` `${kbId}-consolidate-${Date.now().toString(36)}` ``
  (`packages/knowledge/bridge-studio-kbs.ts:1316`), built from a `kbId` already `SLUG_RE`-gated
  at the `op=consolidate` route (line 1229, blocks `/` and `..`) plus a
  server timestamp; `runBrainFixTurn` receives `` `${runId}__${i}` `` — the same
  trusted value with a literal group-index suffix. Same construction class as
  the pre-existing, already-allowlisted `fix-agent` runId
  (`` `${kbId}-${Date.now().toString(36)}` ``, `spawnBrainFix`'s own logDir
  create) — the raw-fs-guarded lint does not also flag that sibling only
  because it reaches its sink through `p.runId`, a member expression outside
  the scan's curated bare-name list, not because the value differs. Allowlisted
  in `check-raw-fs-guarded.mjs`; the brain-fix turn's own sinks are outside that
  lint's scanned-module list (same shared-helper reasoning as
  `brain-fix-auto.ts` above) but are covered by the same trust argument and the
  sink-count ratchet, `--write`-accepted below.

  **M4 ruling 86 moved the cost read-back OUT of this package, and again the
  census is 1:1.** `readBrainFixTurnCostUsd` — which encodes the brain-fix
  TURN's log layout, not the drain's — now lives at the assembly
  (`apps/forge/brain-fix-turn.ts`) beside the turn's binding, because knowledge
  (rank 2) may not import sessions (rank 4) and the drain takes the turn by
  injection. `packages/knowledge/bridge-studio-kb-drain.ts` therefore loses its
  `existsSync` and `readFileSync` rows (its `node:fs` import went with them)
  and `apps/forge/brain-fix-turn.ts` gains exactly those two. The trust
  argument is unchanged and travels with the function: `subRunId` is always
  synthesized by the drain as `` `${runId}__r${round}__${i}` ``, never the
  route's own `runId`, so no curated taint-list name reaches the sink.
  Host-minus-package diffs to zero (§15.75).

  **M4 ports 5–6 (ruling 60) moved these, and the census is 1:1 with one
  genuine reduction.** `brain-fix-runner.ts` carried three sinks
  (`mkdirSync`/`readFileSync`/`writeFileSync` = 1 each);
  `packages/sessions/kinds/fix-turn.ts` now carries two — the `mkdirSync` for
  the cycle dir and the `readFileSync` for the skill prompt, each moved
  unchanged. The third is GONE, not relocated: the hand-rolled throttled
  heartbeat write was replaced by the spine's existing `makeHeartbeatWriter`
  (`packages/sessions/interactive-session.ts:912`), whose `writeFileSync` was
  already baselined — so the site is shared rather than duplicated and the
  total falls by one. `preflight-fix-runner.ts` held no baselined row and its
  identity module holds no sink. Host-minus-package diffs to zero on the two
  that moved (§15.75).

None of the four is a new *unguarded* sink: the index-append and the log-dir
writes are TRUSTED-AT-CONSTRUCTION (server/linter-derived, not request-body
derived), the scaffold mkdir is an unchanged already-allowlisted
CREATE-LITERAL-SUBDIR, and the session write is fully guard-terminal.

### Extended in W6-B12 — KB drain-to-green (`op`-less `/drain` routes, `[read]`)

W6-B12 added `packages/knowledge/bridge-studio-kb-drain.ts` (a NEW module, picked up
automatically by `check-raw-fs-guarded.mjs`'s `cli/bridge-studio*.ts` glob):
`POST /api/studio/kbs/:id/drain` (dispatch), `GET /api/studio/kbs/:id/drain/:runId`
(one run's status), and `GET /api/studio/kbs/:id/drain` (active-or-latest
reattach) — an iterate-to-green drain loop over a KB's `forge brain lint`
findings, built on the SAME per-kbId serialization queue (`enqueueConsolidate`)
and the SAME `runBrainFixTurn` per-finding agent dispatch the existing
`op=consolidate` path (R1-06, above) already uses. Every new fs sink is in this
one new file:

- **`writeKbDrainStatus`/`readKbDrainStatus`** (`_logs/_kb-drain-<runId>/status.json`,
  `mkdirSync`+`writeFileSync` / `existsSync`+`readFileSync`) — SAME
  TRUSTED-AT-CONSTRUCTION class as `writeConsolidateTerminalEvent`/
  `readBrainFixState` above: both helpers take a bare `runId` parameter (the
  raw-fs-guarded lint's curated taint-list name), but at every real call site
  the value is either freshly minted by `POST .../drain` as
  `` `${kbId}-drain-${Date.now().toString(36)}` `` (`kbId` already `SLUG_RE`-gated
  at that same route, strictly before this is ever called), or read back via
  `` isSafeRunId(runId) && runId.startsWith(`${kbId}-drain-`) `` at the two GET
  routes — charset AND kbId-prefix gated, never trusted on charset alone (a
  syntactically-valid but foreign-kb runId is treated identically to an unknown
  one: the same generic 404, no oracle on which check failed). `_kb-drain-<runId>`
  is a single validated path segment under trusted `forgeRoot/_logs`.
  Allowlisted in `check-raw-fs-guarded.mjs`.
- **`findKbDrainRuns`** (`readdirSync`/`existsSync` on `_logs/`, filtered to this
  kb's own `_kb-drain-<kbId>-drain-*` prefix) — NOT flagged at all: the local
  variable is literally named `logsRoot` (a `TRUSTED_ROOTS` name), and the
  per-entry `readFileSync` inside it goes through `readKbDrainStatus` with a
  `runId` reconstructed from a `readdirSync`-ENUMERATED directory name, never a
  caller-supplied string — same "server-enumerated names, holding no client
  string" class as `packages/flows/metrics.ts`'s `listCycles` (used by the pre-existing
  `GET /:id/ingest-activity` route, `packages/knowledge/bridge-studio-kbs.ts`).
- **`readBrainFixTurnCostUsd`** (`existsSync`/`readFileSync` on
  `_logs/_brainfix-<subRunId>/events.jsonl`, reading back a real agent turn's
  own `cost_usd` for the drain's running cost-ceiling total) — NOT flagged:
  `subRunId` is never request-derived, always synthesized in-loop as
  `` `${runId}__r${round}__${i}` `` (never the route's own `runId` bound
  directly), so no curated taint-list name reaches it.

None of the five is a new *unguarded* sink: the status-file read/write pair is
TRUSTED-AT-CONSTRUCTION (server-minted or charset+prefix-gated, never raw
request-body derived), and the two enumeration helpers reach their sinks only
through server-enumerated names or a purely-synthesized sub-id — never a raw
caller string. `--write`-accepted below (baseline: `existsSync` 0→3, `mkdirSync`
0→1, `readdirSync` 0→1, `readFileSync` 0→2, `writeFileSync` 0→1, all in this one
new file).

**Review-fix addendum (atomicity, `renameSync` 0→1).** A reviewer pass on this
branch flagged `writeKbDrainStatus`'s plain `writeFileSync` onto the FINAL
`status.json` path as a torn-read risk: the GET routes above are polled by a
separate caller turn every ~100-250ms while the in-flight drain writes a new
snapshot every round, and a `writeFileSync` is not one atomic syscall for a
multi-field JSON blob — a concurrent reader could observe a partially-written
file. Fixed to this repo's own established convention
(`packages/flows/bridge-studio-runs.ts`'s manifest-move: `writeFileSync(tmpPath, …)` then
`renameSync(tmpPath, toPath)`): `writeKbDrainStatus` now writes to
`` `${finalPath}.tmp` `` first, then `renameSync`s it onto `finalPath`.
`renameSync` is not in `RAW_FS_SINKS` (`check-raw-fs-guarded.mjs` only tracks
the six `readFileSync|writeFileSync|readdirSync|existsSync|statSync|mkdirSync`
names), so this needs no new ALLOWLIST row there — but it IS a new sink name
for `check-request-path-sinks.mjs`'s ratchet (a plain call-count tripwire, no
dataflow). The `tmpPath`/`finalPath` construction carries the IDENTICAL
TRUSTED-AT-CONSTRUCTION `runId` trust chain as the `writeFileSync` row directly
above (same function, same call, same `logDir`) — not a new taint source, just
a new sink NAME the ratchet had not seen from this file before.
`--write`-accepted (baseline: `renameSync` 0→1, `packages/knowledge/bridge-studio-kb-drain.ts`
only).

### Fixed in R4-16 — the four `/start` routes' `projectRepoPath`

Recorded here because leaving the row below in "unguarded" after R4-16 shipped
its fix would have been a false claim in a permanent artifact. Found by SEC-03's
re-read of the branch, not by anything that watches for it — which is precisely
the gap `scripts/check-request-path-sinks.mjs` now covers for NEW sinks and
still does not cover for a row whose status changed under it.

| file:line (as audited) | op | request field | class | how it was closed |
|---|---|---|---|---|
| `apps/forge/ui-bridge.ts:1539,1808,2259,2311` (+ the sessions they seed) | `writeFileSync`/`readFileSync` | `POST /api/{architect,instructions,project-brain,demo-builder}/start` body **`projectRepoPath`** | **fixed** `[exec]` | Was accepted **verbatim** — not a slug resolving under a trusted root but an arbitrary absolute path, then *persisted* into `status.json` as ground truth for the rest of the session (the agent's `cwd`, the target of `ensureStudioBranch`/`commitStudioChange`, the base for every artifact write). Closed by `invalidProjectRepoPath` (`apps/forge/ui-bridge.ts:1610`), which delegates to the SHIPPED `isContainedProjectRepoPath` (`packages/flows/manifest-path-guard.ts`, SEC-02) — reuse, not a new check. Four routes, not three: round 4 found `POST /api/project-brain/start` had zero containment while its three siblings called the guard, and round 4 also closed a fails-open `''` case where the validator returned "not invalid" for the empty string and the call sites' `??` default could never substitute for it. |

### Fixed in SEC-02 — manifest-carried path fields (`forge-d1f`)

The three rows below were filed rather than fixed in the containment sweep because
a per-read-site guard is whack-a-mole when one unvalidated value is written ONCE and
consumed unchecked by a dozen modules. SEC-02 closed them at the **write point**.
`file:line` references are as-audited (pre-fix), because that is what they document.

| file:line (as audited) | op | request field | class | how it was closed |
|---|---|---|---|---|
| `packages/flows/forge-requeue.ts:209`, `orchestrator/requeue-resume.ts:68-189`, `packages/flows/bridge-studio-runs.ts:185,327,474`, `packages/flows/bridge-recovery.ts:96,111` | **`rmSync(recursive)`**, reads, writes | `POST /api/initiatives` body manifest → frontmatter `worktree_path`, `project_repo_path`, `cycle_id`, `project` | **fixed** `[exec]` | Was the campaign's most severe finding: an **unconditional recursive delete** of an attacker-named directory, reached via `POST /api/recovery/:id/requeue` (`resumeFromDemo` defaults false → `preserveWorktree` false). Reproduced live against a planted sentinel — the route returned `200 {"ok":true,"worktreeRemoved":true}` while destroying it. Closed by `packages/flows/manifest-path-guard.ts` at the ingest choke point (`writeManifest`, whose only two production callers are `orchestrator/promote-manifests.ts` and `POST /api/initiatives`), plus an independent assertion inside `runRequeue` ahead of `inferRequeueResume` and the destructive block — so a manifest reaching disk by any other route is still caught. The lexical `resolve().startsWith()` checks in the approve/send-back branches were replaced with real per-segment identity containment. |
| `orchestrator/flow-artifacts.ts:167-171`, `packages/kernel/logging.ts:124-138` | `mkdirSync`/`writeFileSync`/`appendFileSync` | `manifest.cycle_id` | **fixed** `[exec]` | `resolve(logsRoot, cycleId)` normalised a poisoned id straight past `logsRoot`. Ingest validation alone proved **insufficient**: the adversarial round showed the verdict handler reads its manifest from disk, never from an ingest body, and a traversing `cycle_id` really did write `artifacts/verdict.json` (and an `events.jsonl`) outside both `logsRoot` and the forge root. Closed at ingest AND with an `isSafeCycleId` check in both verdict branches before any cycleId-derived path is built. |
| `packages/flows/bridge-recovery.ts:56,86,96,107` | `existsSync`/`readFileSync` | `GET /api/recovery/:id` | **fixed** `[exec]` | `INIT_ID_RE`-gated, lexical join only; `recoveryInspect` additionally returned `prDraftChars`, an arbitrary-file-length oracle. Both `recoveryInspect` and `recoveryAbandon` (which runs `git -C <projectRepoPath> branch -D` / `push origin --delete`) now gate on the containment helpers, reusing their existing response shapes. |

### Fixed in SEC-03 — project-CREATE containment, the mint choke-point violation, and the demo-builder GET routes

Two more sites, closed in this initiative. The first was previously filed as
`unguarded [read]` in the table above (moved here, not duplicated — see the count
reconciliation in the Summary). The second had no prior row at all: it was found by
applying this document's own "Completeness rule" (below) to the manifest-write
choke point, not by luck.

| file:line (as audited) | op | request field | class | how it was closed |
|---|---|---|---|---|
| `apps/forge/bridge-studio-writes.ts:679-737` | `mkdirSync`/`writeFileSync` | `POST /api/studio/projects` body `name`, `repoPath` | **fixed** `[exec]` | Two independent defects, both closed in one pass. (1) The lexical `resolve(projectRoot).startsWith(resolve(forgeRoot)+sep)` check on an UNRESOLVED path — the exact worthless shape this document's own introduction names — is replaced by `isContainedProjectRepoPath` (`packages/flows/manifest-path-guard.ts`, itself built on `resolveGuardedPath`), which requires genuine per-segment realpath identity under `<forgeRoot>/projects/` specifically, not merely "somewhere under forgeRoot". Live-reproduced before the fix: a real `git init` + `.forge/project.json` + `roadmap.md` + `brain/profile.md` written OUTSIDE the forge root, with the route returning `200 {"ok":true}`. (2) A missing existence check let a fresh, non-colliding `name` whose `repoPath` pointed at an ALREADY-ONBOARDED project silently overwrite that project's `.forge/project.json` wholesale — including `testProcess.local.cmd`, the quality-gate command forge later **executes**. `existsSync(join(projectRoot,'.forge','project.json'))` now 400s before either side effect runs. Both defects pinned by 13 ATs in `apps/forge/bridge-studio-project-create-containment.test.ts`. → bd `forge-q80` (partially closed — this was one of three rows filed under it; the `skill-library.ts`/`community-install.ts`/`community-index.ts` rows remain open).  **SEC-03 round 2 — the fix shipped its own instance (BLOCKER, adversarial round).** `isContainedProjectRepoPath` verifies `projectRoot` and NOTHING BENEATH IT, so every subsequent `mkdirSync`/`writeFileSync` built its path with a plain `join()`/`resolve()` off that verified root. A genuinely real, honestly-contained `projects/<id>` — the clone-then-onboard workflow — whose NESTED `.forge` was a symlink wrote `project.json`, including the `testProcess.local.cmd` forge later EXECUTES, at an attacker-chosen path outside forgeRoot, `200 {"ok":true}`. Escape shape #4, already closed on the sibling PUT and not reused here. Closed by routing `.forge/project.json`, `roadmap.md` and `<artifactRoot>/brain/profile.md` through `resolveGuardedPath` with `projectRoot` as the trusted root and every component its own segment, with a rejection throwing rather than skipping. **The general principle, recurred five times in this campaign: validating a root does not validate what you write beneath it.** **SEC-03 round 2 corrected an overclaim in an earlier revision of this very row.** It said the four sub-shapes that had been blocked by accident (live, non-dangling leaf symlinks at `project.json`, `roadmap.md` and `brain/profile.md`, blocked by three distinct `existsSync` idempotency checks that know nothing about symlinks; and a hardlinked `project.json`, blocked by the fresh-onboard clobber refusal) "all now fail containment on their own". The adversarial round DISPROVED that by swapping the pre-fix file back and re-running: those four ATs passed byte-identically, so the new guard is not what fires for them. The claim is not repaired by reordering — running the guard ahead of the existence probe is exactly what produced the round-2 MAJOR false-rejection (an ordinary in-repo HARDLINKED `roadmap.md`, no write intended, failed the whole onboard). So the honest statement, which is also the stronger one: **containment applies to every path this route actually WRITES, and every "the entry already exists" shape is structurally unreachable as a write, because this fresh-onboard route never writes over an existing entry.** A hardlink is by definition an existing dirent, so it can never reach a write here — which is precisely why the sibling `PUT /api/studio/projects/:id`, which MERGES into an existing `project.json`, genuinely needs `resolveGuardedPath`'s `nlink === 1` leaf check while this route does not. Removing the idempotency/clobber checks would reopen those four shapes; they are load-bearing and now say so. The four ATs are kept as regression locks, labelled property-not-mechanism. The route's new `mkdirSync` was flagged by `scripts/check-request-path-sinks.mjs` (baseline `mkdirSync` 6 -> 7) on the ratchet's first real use, in the same PR that introduced it. **SEC-03 round 3 — a THIRD instance in this same row, and a fourth false claim about failure behaviour.** An earlier revision said this route fails cleanly before any write, and the greenfield sibling was told to match it. Executed rather than read, that was false: `seedProjectBrain` now THROWS (this WI made it able to), and BOTH create paths called it after they had already written — greenfield after `copyTemplate` had produced a complete template-sourced project including `.forge/project.json`, onboard after `mkdirSync(projectRoot)` and `scaffoldContractArtifacts` had produced a real git-initialised directory with `roadmap.md` and a local `brain/profile.md`. The API returned 400 while `discoverProjects` adopted the directory on the next list: an **adopted-but-disowned project**, an operator told "not created" who then finds it in their library. Closed by ORDERING on both paths — `seedProjectBrain` now runs before every project-directory write, and because it validates all of its own per-segment guards before performing any of its own writes it is a genuine pre-write validation, not a partial one. Compensating cleanup was explicitly rejected: delete-on-failure is a strictly worse contract than never-write. Residual inconsistency, stated: a later unrelated write failure leaves an orphaned `brain/projects/<id>` stub with no project — never listed, since `discoverProjects` scans only `projects/`, and skipped idempotently by a retried create. Pinned `[exec]` by three ATs across `apps/forge/bridge-studio-project-create-containment.test.ts`, `apps/forge/bridge-studio-write.test.ts` and `orchestrator/project-create.test.ts`, one of which drives `GET /api/studio/projects` to prove the LISTING consequence rather than only the filesystem one. |
| `orchestrator/mint-triggered-initiative.ts` (previously no row) | `mkdirSync`/`writeFileSync` (direct, pre-fix) | `PUT /api/studio/flows/:id` body `project` → background flow-trigger sweep → minted manifest's `project` / `project_repo_path` | **fixed** `[exec]` | The finding was the choke-point bypass itself: this module wrote a queue manifest with `serializeManifest` + `writeFileSync` directly, never calling `writeManifest` — the SSOT ingest choke point the "Recorded design assumption" section below names. Reachability was proven live end-to-end, not argued: `validateFlow` never checked `flow.project`'s shape, and `PUT /api/studio/flows/:id` persists `body.project` verbatim (`200 {"ok":true,...,"findings":[]}` for `project: "../../<outside-dir>"`, confirmed on disk in `flow.yaml`). `mintTriggeredInitiative` then does `join(resolveProjectsDir(...), flow.project)` — `path.join()`, not `path.resolve()`, so the working escape shape is a relative `..`-traversal — and, with the target pre-existing, wrote a real manifest straight to `_queue/pending/` carrying `project_repo_path` genuinely outside `forgeRoot`, bypassing `writeManifest`/`assertManifestPathFields` entirely and landing exactly in the sinks SEC-02 closed (`runRequeue`'s `rmSync(recursive)`, `finalize-merged.ts`, `drain-fix-loop.ts`'s `git -C <path>` + `spawnSync`, `orchestrator/scheduler.ts`). Closed by routing through `writeManifest` (now class 1 — see "Recorded design assumption" below), plus a defence-in-depth ERROR-level `project/shape` finding added to `validateFlow` (`orchestrator/studio/validate.ts`) as the charset first layer, built on `isSafeProjectName` (the exact predicate the choke point itself uses, imported rather than re-derived, so the two layers cannot drift apart) — error level, not a warning, because a warning here would be the "declared data fails open" shape this campaign has repeatedly found and closed. Pinned by `orchestrator/mint-triggered-containment.test.ts`. A second, latent defect surfaced while wiring this fix: the mint's `queueRoot` defaulted to the bare relative `'_queue'` (i.e. `<process.cwd()>/_queue`), while `writeManifest` re-derives `forgeRoot` as `dirname(resolve(queueRoot))` to run its own containment check — a daemon whose `cwd` was not `forgeRoot` at the moment of a trigger-fired mint would validate containment against the WRONG root. Now anchored explicitly on the caller's already-resolved `forgeRoot` rather than a bare relative default. (No pre-existing bd — this row did not exist in any form before SEC-03.) |
| `apps/forge/ui-bridge.ts:2333-2368` (`GET /api/demo-builder/demo/:project/:sid`), `2373-2409` (`GET /api/demo-builder/fragment/:project/:sid/:element`) | `existsSync`/`readFileSync` | `project`, `sessionId` (URL path segments) + `status.project_repo_path` (read from disk) | **fixed** `[exec]` | Carried from the R4-16 review and folded into SEC-03 by T1 ruling; R4-16 rated this LOW on the premise that reaching a poisoned `project_repo_path` required first escaping session-dir containment. That premise is now doubly obsolete. First, the premise itself was already wrong the way R4-16's own `/start` finding showed (an attacker could supply `projectRepoPath` directly) — but that specific route is now fixed: reading `/api/{architect,instructions,demo-builder,project-brain}/start` on this branch confirms all four now gate `projectRepoPath` through `isContainedProjectRepoPath` before ever persisting it. Second, and this is the re-assessment's actual finding: **`/demo/` and `/fragment/` don't need a poisoned `project_repo_path` at all.** They are the two demo-builder GET routes explicitly named as OUT OF SCOPE in the code comment directly above the `/generation/` route ("The sibling /demo/ and /fragment/ GET routes above remain OUT OF SCOPE for this round... rely solely on a lexical startsWith(base) check... a real gap, filed as an evidenced follow-up") — unlike the `/generation/` route and the five POST routes (start/brief/feedback/lock/abandon), which all resolve their session dir through `resolveDemoSessionDir` (realpath identity containment under the specific project's own resolved dir), `/demo/` and `/fragment/` validate `project`/`sessionId` for **non-emptiness only** (`if (!project \|\| !sessionId)`) and pass them straight into a bare `join()`. **Live-reproduced** (ad-hoc probe script mirroring the `apps/forge/bridge-studio-sibling-containment.test.ts` idiom — real `startBridge({forgeRoot, port:0})`, a `status.json` planted directly on disk at `<escaped-dir>/_demo/x/status.json` with `project_repo_path` pointing at a third, wholly outside "attacker repo" directory; probe deleted after use, not left as a permanent AT, since this document is the only file T3 may edit): `GET /api/demo-builder/fragment/..%2F..%2F<escaped-dir>/x/evil` → `200`, response body contains the planted `PWNED-FRAGMENT-CONTENT`; `GET /api/demo-builder/demo/..%2F..%2F<escaped-dir>/x` → `200 PWNED-DEMO-CONTENT` verbatim. The percent-encoded `%2F` survives the route's own `url.slice(prefix).split('/')` (split runs on the RAW, still-encoded URL) and only becomes a literal `/` afterwards, in the subsequent `.map(decodeURIComponent)` — the classic encoded-slash traversal bypass. Independently of the traversal, `/demo/`'s `requested.startsWith(base)` check is a **guard that cannot fail** (this document's own definition of `unguarded`, see "How to read the classifications" above): `DEMO_HTML_REL_PATH` is the fixed literal `.forge/demo/DEMO.html`, so `requested` is ALWAYS exactly `base + 'DEMO.html'` for every possible `status.project_repo_path`, poisoned or not — it cannot reject anything. `/fragment/`'s equivalent check is NOT vacuous in the same way: it correctly rejects a traversing `element` (the one input that actually participates in the base/requested comparison), so this route's containment is real for `element` alone, vacuous for `project`/`sessionId`. **Bound of what was verified, kept honest per this document's own rule ("a conclusion you did not execute is a lead, not a proven exploit"):** full exploitability against content fully outside the forge tree, from a single request with nothing pre-staged, additionally requires a `_demo/<sid>/status.json`-shaped file to already be reachable via traversal from `ctx.projectsRoot` — an HTTP-only chain to plant one there (with no local pre-seeding) was searched for and NOT found: the demo-builder family's own five write routes are correctly closed (`resolveDemoSessionDir` cannot create outside `projectsRoot`, confirmed by reading); the sibling architect/instructions/project-brain `/start` routes' OWN session-dir join (`architectSessionDir` et al., row above, bd `forge-28o`) is unguarded for `body.project` in the identical shape and DOES permit an arbitrary-path `mkdirSync`+`writeFileSync`, but always under a different, hardcoded subdirectory name (`_architect`/`_instructions`/`_project-brain`, never `_demo`) — so it does not, on inspection, chain into this specific route. The remaining unguarded writers in this table (`packageDir` install, KB-maintenance `file`) were not each individually checked against this exact shape — recorded `[unver]` below, not assumed safe. A symlinked session directory (the R4-16 round-2 BLOCKER shape) would defeat this identically to the traversal above and was not separately tested — redundant to prove, since these two routes apply NO containment of any kind, lexical or realpath, to `project`/`sessionId`, unlike the routes `resolveDemoSessionDir` DOES cover. **Verdict: severity raised from LOW to MODERATE.** The containment failure is now `[exec]`-proven rather than `[read]`-argued, and — unlike the finding it was carried from — it no longer depends on any OTHER route's field being poisoned; it stands on its own two unvalidated URL segments. It is not rated higher only because no HTTP-only plant chain for the precondition was found despite a genuine search. **How it was closed (SEC-03 WI-6, 13 ATs in `apps/forge/bridge-studio-demo-builder-containment.test.ts`, 9 of them RED first):** two independent halves, either alone insufficient. (A) both routes now resolve their session dir through `resolveDemoSessionDir` — the choke point in the same file that the five sibling POSTs and the GET generation route already used — so `project`/`sessionId` are charset-validated before any `join` and the resolved dir is realpath-proved inside THIS project's own dir (identity, not membership: an AT drives a cross-project symlink that a `projectsRoot`-wide check would wrongly accept). (B) the vacuous `requested.startsWith(base)` check is DELETED — a guard that cannot fail is not a guard, and keeping it would have been decoration — and `status.project_repo_path` is validated as a VALUE with the shipped `isContainedProjectRepoPath`, on both routes (`/fragment/` carried the identical tautology in that field; its `element` component was already safe and is untouched, pinned by a non-regression AT). `invalidProjectRepoPath` was deliberately not reused as-is: its empty-string early return means "absent, use the caller's default", correct for a request body at write time and wrong for a mandatory field already persisted. The choke point's own docstring claimed to be the ONLY caller of `demoSessionDir` — it was not, and that overstatement is what let these two routes be written past it; it now claims only what is true. |
| `orchestrator/project-brain-seed.ts:157-188` (`seedProjectBrain`), `packages/kernel/project-layout.ts` (`projectBrainDir`/`projectThemesDir`; audited at `orchestrator/brain-paths.ts:55,60`, moved to `packages/knowledge/brain-paths.ts` by the M3 package cutover and to kernel by M4's layout PR — the guard is unchanged, only its home) | `mkdirSync`/`writeFileSync` | `POST /api/studio/projects` body `name` -> the slugified `projectId` | **fixed** `[exec]` | Found by the SECOND adversarial round, reachable from the SAME route two calls after the Defect-5 fix, in the module SEC-01 had already hardened once — `projectBrainDir`/`projectThemesDir` are `resolveKbBrainDir`'s unguarded siblings. `seedProjectBrain` wrote `kb.yaml`, `profile.md` and `themes/README.md` through bare `join()`s and `mkdirSync`'d `themes/` recursively through a symlinked segment before any write. `projectId` is `SLUG_RE`-validated, so the vector is a pre-planted symlink, not a traversing id. **All FIVE shapes reproduced live, none accidentally safe** (ATs 24-28): `brain/projects/<id>` as a symlinked dir; `brain/projects/<id>/themes` as a symlinked dir with `<id>` itself real; and dangling symlinks at `kb.yaml`, `profile.md` and `themes/README.md`. Contrast the Defect-5 round, where 4 of 8 sub-shapes were blocked by accident — this function has no `existsSync` in front of the directory shapes, and its per-file probe is `stat`-based so a dangling link reads as absent. Closed with ONE choke point across all three writes: `resolveGuardedPath` rooted at the fixed `<forgeRoot>/brain/projects` with `projectId` and every component below it as their OWN `segments[]` elements. The two directory shapes are why guarding `brain/projects/<id>` alone would not have been enough — the same "validating a root does not validate what you write beneath it" principle, one level deeper. **Failure behaviour, verified per claim and NOT inherited from this row's `[exec]` tag** (see the methodology rule on per-claim verification): an earlier revision of this sentence said "both callers fail closed: the route returns a generic 400 before writing `.forge/project.json`" — the same claim the project-create row above spends a paragraph disproving. It was wrong for the same reason and survived the first retroactive sweep because that sweep was per-ROW-TAG, and this row's `[exec]` was earned by a different claim (the five escape shapes). What is true, executed: a containment rejection returns 400 and, after SEC-03 round 4's two-phase fix, leaves nothing on disk in EITHER `projects/` or `brain/projects/` on either route. The intermediate round-3 ordering fix did NOT achieve that — it moved a WRITING call earlier, which relocated the orphan rather than removing it: an unrelated later failure left a complete `brain/projects/<id>/kb.yaml`, and because `loadKbDescriptors` scans `brain/projects/` as a second containment root the operator got a **phantom KB bound to a project they were told was never created** — invisible to `discoverProjects` and undetected by `forge studio lint` and `forge brain lint`. Closed by separating the CHECK from the WRITE: phase 1 resolves and containment-checks every path either route will write — `projectRoot`, the contract artifacts, and all three `brain/projects/<id>` targets — performing no request-derived write of any kind, so a rejection leaves nothing in either `projects/` or `brain/projects/`; phase 2 writes, with `seedProjectBrain` restored to its original position. `brainSeedTargets()` is private and `seedProjectBrain` itself calls the pure checker, so the pre-check and the seed cannot drift apart. **Verified by execution on both routes and both failure kinds** — a containment rejection and an unrelated EACCES: `projects/<id>` absent, `brain/projects/<id>` absent, and neither `GET /api/studio/projects` nor `GET /api/studio/kbs` lists it. Two pre-existing lint gaps were measured live in the process and filed rather than assumed: `forge studio lint`'s KB scan never recurses into `brain/projects/<id>/` (bd `forge-8kq`), and `forge brain lint` skips any `brain/projects/<name>/` whose `themes/` holds only a README with no check cross-referencing `discoverProjects` (bd `forge-4qf`) — so nothing today would notice an orphaned project brain however it arose. **RESIDUAL, disclosed precisely because the wording matters** (bd `forge-4on`, P1): the "absent on both failure kinds" statement above is accurate **only for the two failure points actually EXECUTED** — a containment rejection in phase 1, and an EACCES on the project `mkdirSync`. It is NOT a claim that no failure anywhere can orphan anything. Project create is **not transactional**: phase 1 validates and phase 2 writes, so a failure arriving BETWEEN them — or a filesystem change racing the window, bounded in practice by a subprocess spawn (`git init`) or a multi-file copy (`copyTemplate`) — can still leave an orphaned project directory or brain stub. **No test in this diff exercises that race.** Three consecutive review rounds each fixed an orphan-consistency defect and each fix reopened it one layer down (ordering → phantom KB → this TOCTOU), which is diagnostic rather than unlucky: orphan-consistency is a DIFFERENT problem from containment and cannot be solved by reordering. The fix shape is transactional create (stage-then-atomic-move) or a reconcile/GC pass — filed as its own initiative, explicitly NOT a sixth patch here. Containment itself is closed at every layer: `seedProjectBrain`'s own re-check rejects and the write to a symlink target never happens, confirmed by probe. The residual is operator-facing consistency, recoverable by deleting a directory, and — since round 4's retrofit — visible in BOTH `GET /api/studio/projects` and `GET /api/studio/kbs`. |

### Guarded in R4-17 — the onboarding session's contract-stages surface

Three new sink sites, all introduced by this initiative (R4-17, T3/WI-1 and
the round-1 fix-round, T3/WI-3) and flagged by
`scripts/check-request-path-sinks.mjs` on first use — the ratchet working
exactly as designed, catching its own initiative's new surface before merge.
None reopens a shape this document has already closed.

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/projects/contract-stages.ts` (`resolveContainedProjectDir`, exported) | `realpathSync` ×2 | `GET /api/studio/sessions/onboarding/:sessionId?project=`, `GET /api/studio/projects/:id/contract-stages`, and — directly, by import, since the round-1 BLOCKER fix on the row below — `POST /api/studio/onboarding/start` — all feed `projectId`/`project` | guarded `[read]` | `SLUG_RE` + length cap first (rejects before any fs call — AT-25). Then `realpathSync(join(projectsRoot, projectId))` compared against `realpathSync(projectsRoot)` with a `startsWith(root + sep)` boundary check — the SAME shape as `resolveSafeSessionDir` (`packages/sessions/bridge-studio-sessions.ts`, row above), **deliberately NOT** `resolveGuardedPath`/`isContainedProjectRepoPath`: those two enforce a STRICTER per-segment IDENTITY check that rejects a symlinked `<root>/<id>` pointing at a DIFFERENT real object under the SAME root even when that object is legitimate — this module's own AT-28 (a false-rejection control) requires exactly that shape to be ACCEPTED (a relative symlink resolving back inside `projectsRoot`), so the stricter guard is the wrong tool here, not an oversight. See `packages/projects/contract-stages.ts`'s own module header for the full note. Verified by DIRECT-EXECUTION tests in `packages/projects/contract-stages.test.ts` (AT-27: a real symlink escaping to an outside directory never surfaces its content; AT-28: the false-rejection control is accepted; AT-25: a non-slug id is rejected before any lookup; AT-29: two projectIds never cross-contaminate) — not an HTTP-route-level probe, so classified `[read]` per this document's own convention (mirrors `orchestrator/studio/session-transcript.ts`'s identical `[read]` classification at the row above, despite THAT module's own AT-35/36/37 also being direct-execution symlink tests, not HTTP probes). **Completeness note:** the `contract`/`instructions`/`secrets`/`demo` rows read `.forge/project.json` via `orchestrator/project-config.ts`'s `loadProjectConfig`, which internally calls `readAgentInstructionsFile`/`readQualityGateSidecar` — both already filed `unguarded [read]` → `forge-2zz` in Table 2 above. This module is a NEW caller reaching that pre-existing, already-tracked gap; not a new finding, but named here per the "one sink, many entry points" completeness rule. D3 (names-only secrets) is enforced structurally — `secrets.env` is never opened anywhere in this module, pinned by `packages/projects/contract-stages.test.ts` AT-12's sentinel-value plant. |
| `packages/projects/contract-stages.ts` (`deriveRoadmapRow`) | `existsSync` | none directly — reaches this sink only through `projectId`, already `SLUG_RE` + length-cap validated and `resolveContainedProjectDir`-proved by `deriveContractStages` before ANY row-deriver, including this one, is ever called | guarded `[read]` | New in the round-1 fix round (item 3, T2 ruling — the roadmap row's C4 divergence made visible: `packages/projects/preflight.ts`'s `checkC4` fails HARD unless BOTH `roadmap.md` AND `brain/projects/<id>/profile.md` exist, but this row previously only ever looked at `roadmap.md`). `deriveRoadmapRow` now reports `existsSync(join(projectBrainDir(forgeRoot, projectId), 'profile.md'))` as a presence FACT in the row's `detail`/`source` — never a verdict (`status` stays presence-of-roadmap.md only, D11). `forgeRoot` is a fixed, trusted constant, never request-derived; `projectId` is the identical value already charset- and containment-validated upstream — no `..`, `/`, or `\` can reach this join, so no NEW containment logic was needed at this specific call, only a guarded read (wrapped in try/catch, so a hostile filesystem condition fails closed to `absent` rather than throwing — never a hostile PATH, since the path is already charset-clean by the time this runs). `existsSync` is boolean-only regardless: even in the counterfactual where upstream containment somehow failed, this call could leak nothing beyond a presence/absence fact, never file content — the same fact/verdict boundary D11 already draws elsewhere in this module. Flagged by `scripts/check-request-path-sinks.mjs` (baseline `packages/projects/contract-stages.ts existsSync` 0 -> 1) on this fix's first use. Pinned by `packages/projects/contract-stages.test.ts` AT-30 (profile present), AT-31 (profile absent — the C4 divergence itself), AT-32 (roadmap.md absent, both profile states). |
| `apps/forge/ui-bridge.ts` (`POST /api/studio/onboarding/start`) | `realpathSync` ×2 + `resolveContainedProjectDir`, `mkdirSync` ×2, `writeFileSync` ×2 | body `project` (+ `inputs`) | guarded `[exec]` | `project` is `SLUG_RE` + length-cap validated (reusing `invalidGenerationProjectReason`, the same helper the demo-generation routes already use) before any fs call. **Round-1 adversarial review found a BLOCKER here, reproduced live:** the project directory was previously resolved with a bare `realpathSync(join(ctx.projectsRoot, project))` — this resolves symlinks but never checks the result lands inside `ctx.projectsRoot`. Planting `<projectsRoot>/evilproj -> <dir outside projectsRoot>` and `POST`ing `{project:"evilproj"}` returned `200`, with `status.json` and `prompt.md` written outside `projectsRoot` and the agent spawned against it. **Closed by IMPORT, not a second implementation:** the route now calls `resolveContainedProjectDir` (`packages/projects/contract-stages.ts`), the identical function the sibling `GET /api/studio/projects/:id/contract-stages` route already calls — one guard, two call sites, not two guards. **Round-2 adversarial review then found that fix incomplete, and disproved a claim this row previously made.** The previous revision said "`sessionId` is generated by this route's OWN code … so the join itself cannot introduce a further escape." True of `sessionId`; **false of `_onboarding`.** A legitimately-contained project whose `_onboarding` entry is a SYMLINK redirects both writes: `mkdirSync(recursive:true)` transparently follows a symlinked intermediate segment, and `status.json` + `prompt.md` were reproduced landing outside `projectsRoot` from a project that passed containment. The reachability is not theoretical — a managed project is a CHECKED-OUT REPO, so a commit carrying a symlink named `_onboarding` is attacker-supplied content. This is "validating a root does not validate what you write beneath it", one level deeper than the round-1 fix, **found in the round that fixed the same class one level up** — the sixth self-inflicted instance in this campaign. **Closed (round-2, the DIRECTORIES only — see the round-3 correction below, this same row)** by creating and realpath-verifying `_onboarding` BEFORE the session dir is created beneath it, then realpath-verifying the session dir in turn. A pre-existing REAL `_onboarding` directory (every onboarding run after the first) passes unchanged — only one whose realpath leaves the verified project dir is refused. **The sentence that followed here, in the round-2 revision of this row, claimed "the guard now runs at every level that is written, not only at the root." That claim was FALSE the moment it was written, and stayed false through round 2's own review: it verified the two DIRECTORY levels (`_onboarding`, the session dir) and said nothing true about the two FILE levels beneath them (`status.json`, `prompt.md`) — those were written with a bare `writeFileSync(path, data, 'utf8')`, no exclusive-create flag, no containment check of any kind. Round-3 adversarial review reproduced exactly this: `newArchitectSessionId()` (below) has only ONE-SECOND granularity, so a session-id directory was guessable well enough to pre-plant, with its two leaf files as symlinks to an outside target, ahead of the real request — 100% hit rate over a 4-second candidate window. `mkdirSync(sessionDir, {recursive:true})` silently reused the pre-existing planted directory and both `writeFileSync` calls followed the planted symlinks. The seventh self-inflicted instance of "validating a root does not validate what you write beneath it" in this campaign, and the second false claim in this exact cell — see the round-3 fix and its own three closes, appended at the end of this row.** **Executed:** AT-11 plants the symlinked `_onboarding` and asserts non-2xx AND that nothing was written at the symlink target; AT-12 is the accept control (a real pre-existing `_onboarding` still succeeds), alongside AT-4 (no `_onboarding` at all). **Executed, both directions:** `apps/forge/ui-bridge-onboarding-start.test.ts` AT-7 plants the exact symlink above and asserts non-2xx AND nothing written at the escape target; AT-8 (the false-rejection control) plants a RELATIVE symlink resolving back INSIDE `projectsRoot` and asserts it is still accepted, with the session landing at the real target — proving the fix is containment, not a blanket symlink ban. D5's separate guarantee — that a caller-supplied `projectRepoPath` has ZERO effect, because the route has no such field to read at all — remains executed live by AT-3, unaffected by this fix. AT-1/AT-2 additionally pin that a malformed/unknown `project` is rejected (400/404) before any `_onboarding` directory is created anywhere. **Retracted claim, this row, previous revision:** an earlier revision said this shape was "an improvement over the legacy architect/instructions/project-brain `/start` siblings' unguarded `architectSessionDir`-shaped join…, not a repeat of that gap." Round-1 adversarial review disproved that by execution: calling `realpathSync` and never checking where the result landed is not an improvement over an unguarded join — it is the same unguarded-join gap wearing a symlink-resolving disguise. "Validating a root does not validate what you write beneath it" does not even reach this case, because the root itself was never validated either. Six consecutive review rounds in this campaign have now found a false claim in this document, every one about what happens on failure — the round-2 pair (this row's `_onboarding`-directories claim and the `writeSessionTerminalPhase` "provably a no-op" claim below) plus this row's OWN round-2 "every level that is written" claim (corrected above), the sixth. The last three (both round-2 claims and this one) were all written by the orchestrator ruling on the round before it; this one is corrected by the fix-round implementer under the round-3 ruling, not by the orchestrator itself, so the ruling this time is: verify the correction by execution before writing it down, which is exactly what AT-13/14/15/17 below do. **Ratchet delta for this row (round 2): `apps/forge/ui-bridge.ts` `mkdirSync` 7→8 and `realpathSync` 2→4, all four from the round-2 write-beneath-the-root fix (the `_onboarding` parent's own `mkdirSync` + the two new `realpathSync` verifications).** No unguarded sink was added: every one of the four IS the guard. **Round-3 adversarial review finding and fix (the leaf-write gap the round-2 claim above wrongly said was already closed).** `newArchitectSessionId()` (`apps/forge/ui-bridge.ts`, shared by five routes — architect, instructions, project-brain, demo-builder, and this one) produced `YYYY-MM-DDTHH-mm-ss` — ISO-8601 truncated to ONE-SECOND granularity, zero entropy. Reviewer pre-created `<projectsRoot>/<project>/_onboarding/<guessed-second>/` with `status.json` and `prompt.md` as symlinks to an outside sentinel, spanning a 5-candidate, 4-second wall-clock window around the request — 100% hit rate. `mkdirSync(sessionDir, {recursive:true})` silently reused the pre-existing planted directory (no realpath escape, so the round-2 directory-level check above still PASSED) and `writeFileSync(path, data, 'utf8')` followed both planted symlinks straight through to the outside target. **T2 ruling: THREE independent closes, because a defence that only works because another one also works is one defence.** (1) `mkdirSync(sessionDir)` with **no** `recursive` — a pre-existing entry at this exact path, symlink or a real-but-empty directory, is now a hard `EEXIST` error rather than a silent reuse. (2) Both leaf writes now pass `{flag:'wx'}` (`O_CREAT` + `O_EXCL`) — an existing path at the leaf, symlink included, fails the `open()` with `EEXIST` instead of being followed and written through. (3) `newArchitectSessionId()` now appends an 8-hex-char `randomBytes(4)` suffix after the timestamp — kept `SAFE_ID_RE`-valid (hex is a subset of its charset) and still chronologically sortable (the fixed-width timestamp prefix dominates comparison across different seconds; the suffix only breaks ties within the same second). Because this helper is shared, all five spawn-family `/start` routes gained the fix in one place, not four gaps left open behind the one that got adversarially reviewed. The two directory-level closes (1, 2) were extracted into an EXPORTED function, `writeOnboardingSession` (`apps/forge/ui-bridge.ts`), taking an EXPLICIT `sessionId` rather than generating one internally — so the exclusive-create defences can be exercised directly, since close (3) makes the id genuinely unguessable and therefore un-pre-plantable through the route itself going forward (see the disclosed limitation in `apps/forge/ui-bridge-onboarding-start.test.ts`'s AT-13/14/15 header). **Executed, real filesystem objects, never a status code alone (per this document's own verification rule):** AT-13 and AT-14 (`apps/forge/ui-bridge-onboarding-start.test.ts`) each pre-plant all 5 candidate session-id directories spanning the request's wall-clock window with `status.json`/`prompt.md` respectively as symlinks to an outside sentinel file, and assert the sentinel is byte-unchanged after the request — proving closes (1)/(2) together, outcome-based so the assertion holds regardless of which of the two closes is the one that actually fires (both do: the pre-existing directory trips close (1) before close (2) is ever reached, disclosed in the test's own header, not silently assumed). AT-15 pins close (1) ALONE: the 5 candidate directories are pre-planted real and EMPTY (no symlink at all), and the test asserts they stay empty — if close (1) alone regressed to `recursive:true` while close (2) remained, an empty pre-staked directory would be silently reused and populated with fresh, non-colliding files (no `EEXIST` from `'wx'`, since nothing exists yet to collide with), so this assertion depends on close (1) alone. AT-17 pins close (3): two starts fired back-to-back for the same project, well within the same wall-clock second, produce different session ids, each still matching `SAFE_ID_RE`. AT-16 is the accept control (mirrors AT-8/AT-12's shape): a project with a real, earlier onboarding session already present — the shape every second run has — still succeeds, lands in its own distinct dir, and leaves the earlier session untouched. **Disclosed limitation, not silently assumed away (mirrors this document's own AT-13/14/15 header in the test file):** once close (3) ships, AT-13/14/15's pre-planting technique can no longer coincide with the route's real target — their assertions stay TRUE post-fix, but only VACUOUSLY, since the route simply never touches the planted candidates rather than being refused. They remain valid RED-now proofs for this round's fix, not perpetual regression sentinels for closes (1)/(2) in isolation. `writeOnboardingSession`'s export exists so a follow-up unit test against a fixed, injected id — closing exactly this gap — can be added independently of route-level id-guessing; not added in this round because the round's scope was landing the three closes and their route-level proof, not authoring a new test file. **Ratchet delta for this row (round 3): `apps/forge/ui-bridge.ts` `realpathSync` 4→3** (the sessionDir-level realpath check from round 2 is no longer needed — close (1)'s exclusive, non-recursive `mkdirSync` on a `SAFE_ID_RE`-valid, single-segment `sessionId` cannot itself escape the already-verified `onboardingParent`, so re-verifying with `realpathSync` afterward would be redundant, not a second defence). **`mkdirSync` stays 8 and `writeFileSync` stays 11 — closes (1) and (2) are option changes on the SAME call sites (`{recursive:true}` removed from one `mkdirSync`; `{flag:'wx'}` added to both `writeFileSync` calls), invisible to a sink-count ratchet that tracks calls, not their arguments.** This is disclosed here precisely because the ratchet cannot catch it: a future edit that quietly drops the `'wx'` flag or restores `{recursive:true}` on the session-dir `mkdirSync` would not move any number `scripts/check-request-path-sinks.mjs` tracks — AT-13/14/15 are the regression lock for that, not the sink count. |

**Not ratchet-tracked, guarded regardless:** `packages/agents/agent-run.ts`'s
`writeSessionTerminalPhase` (the `--session-dir` write `forge agent dispatch`
performs, D7) is invisible to `scripts/check-request-path-sinks.mjs` — that
script's entry set is `apps/forge/ui-bridge.ts` + `cli/bridge-*.ts`, and
`agent-run.ts` is reached only as a spawned CLI subprocess argv, never via a
relative import from those entry files (confirmed:
`findReachableModules().includes('packages/agents/agent-run.ts')` is `false` on this
branch). `sessionDir` there is always OUR OWN already-created,
already-realpath-verified directory (built by the route above, threaded
through `spawnAgentDispatch`'s optional 6th argument), not raw request
text — **but round-1 adversarial review found the write path made NO use of
that fact.** `writeSessionTerminalPhase` had no containment reference at all
and unconditionally wrote `status.json` into whatever `sessionDir` string it
was handed, so its guarantee depended ENTIRELY on the route above having
validated the directory first — "one sink, many entry points" — pinned RED by
AT-9 (`apps/forge/ui-bridge-onboarding-start.test.ts`) before the fix. **Closed** by
resolving `projectsRoot` inside `writeSessionTerminalPhase`
(`resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)))`
— see the round-3 correction immediately below for why the `loadConfig(...)`
argument was added; `apps/forge/bridge-studio.ts` makes the identical call) and
refusing the write when
`realpathSync(sessionDir)` does not land inside `realpathSync(projectsRoot)`
— the same realpath + `startsWith(root + sep)` boundary shape used throughout
this initiative, not reused verbatim because this call site's `sessionDir`
arrives as a single already-composed absolute path (a CLI flag), not
components to join. The pre-existing status.json-symlink-escape guard
(refusing to follow `status.json` if it escapes the now-verified `sessionDir`
via a symlink) is unchanged.

**Round-3 adversarial review found a THIRD, independent `projectsRoot`
disagreement, and a cwd-fragility root cause underneath the round-2 fix
directly above.** `packages/flows/manifest-path-guard.ts`'s `isContainedProjectRepoPath`
— the guard `POST /api/verdict` / `POST /api/runs/:id/gates/verdict` (both the
approve branch, `packages/flows/bridge-studio-runs.ts:222`, and the send-back branch,
`:390`), `orchestrator/finalize-merged.ts:301`, `orchestrator/drain-fix-loop.ts:136`
and `packages/flows/bridge-recovery.ts` all call on `project_repo_path` before using it —
never went through `resolveProjectsDir` at all: it hardcoded
`join(opts.forgeRoot, 'projects')` directly. Under a configured
`FORGE_PROJECTS_DIR`/`forge.config.json`'s `projectsDir`, this guard checks
containment against the OLD default root while every producer on this same
page (the paragraph above, `ctx.projectsRoot`, `resolveProjectsDir` generally)
correctly resolves the CONFIGURED one — so a legitimately-produced
`project_repo_path` under a configured root would be wrongly REJECTED by this
guard, and **a configured `projectsDir` could break cycle approval entirely.**
Separately, and this is the root cause the round-2 "Closed" sentence above
never noticed: `loadConfig()`'s no-arg default (`packages/kernel/config.ts`) is
`resolve('forge.config.json')` — resolved against `process.cwd()`, not
`forgeRoot` — and it fails SOFT to `{}` when nothing is found there. A caller
running from a different cwd than `forgeRoot` (any subprocess, any daemon
started from an unexpected directory) would silently get the untouched
DEFAULT root back even with a real `forge.config.json` sitting right in
`forgeRoot`. `resolveProjectsDir`'s own docstring calls itself "the single
source of truth for the projects root"; a hardcode one level down and a
cwd-dependent load one level up both contradicted that. **Closed, one concept
one resolution:** `isContainedProjectRepoPath` (and `isContainedWorktreePath`'s
identical `projects/` fallback branch) now resolve through `resolveProjectsDir`
too, and EVERY `loadConfig()` call on this projects-root-resolution path now
passes `defaultConfigPath(forgeRoot)` (`packages/kernel/config.ts`, new) — a
forge-root-anchored path — instead of relying on the cwd-relative default. A
repo-wide sweep for `resolveProjectsDir(..., loadConfig())` found eleven more
call sites carrying the identical cwd-fragility, all fixed the same way:
`apps/forge/bridge-studio-writes.ts` (×4), `apps/forge/studio-lint.ts`,
`packages/sessions/bridge-studio-sessions.ts`, `packages/knowledge/bridge-studio-kbs.ts`,
`apps/forge/bridge-studio.ts` (×4), and `orchestrator/mint-triggered-initiative.ts`
(the last of these already had its own row above, for an unrelated
choke-point-bypass defect — this is a second, independent fix to the same
file). Four remaining bare `loadConfig()` calls
(`orchestrator/scheduler.ts`, `orchestrator/demo-fix-loop.ts`,
`orchestrator/gate-fix-loop.ts`, `packages/flows/bridge-studio-runs.ts:560`) were
deliberately left unchanged: all four resolve `notify`/scheduler config only,
never `projectsRoot` — a different concept, out of this fix's scope — and are
named here, not silently left off this list, so the omission is visible
rather than assumed away. **Verified, `[read]` per this document's own
convention** (direct execution against the guard function with real
symlink/config-file fixtures, not the live HTTP route — mirrors row 220's
`resolveContainedProjectDir` ATs above): `orchestrator/manifest-path-fields.test.ts`'s
pin-5-item-2 tests prove the configured root is honoured (accept under the new
root, reject the stale default once a different root is configured), prove
that resolution no longer depends on `process.cwd()` (the same
`process.chdir()`-based proof technique as this same file's own Finding-3
tests, immediately above pin 5 in that file), and — the ACCEPT control that
matters most — prove the DEFAULT configuration (no env var, no config file)
resolves BYTE-IDENTICALLY to before this fix, since that is the only
configuration every existing test and every real deployment today actually
uses.

**The boundary is `projectsRoot`, matching the route's own — and the history
of that choice is worth recording, because it got it wrong THREE times, each time
instructively.** `POST /api/studio/onboarding/start` is the only real sender of
`--session-dir` and always creates `sessionDir` under
`<projectsRoot>/<project>/_onboarding/<sessionId>`, so a `projectsRoot` guard is
a no-op for every legitimate caller. **A previous revision of this row said that
was "provably a no-op … (measured, not assumed)". It was assumed, and round-2
adversarial review disproved it by execution.** `apps/forge/ui-bridge.ts` computed
`ctx.projectsRoot` as a hardcoded `resolve(forgeRoot,'projects')` — the ONE
module of eight that never consulted config, while 23 sites elsewhere resolve
through `resolveProjectsDir`, which honours `FORGE_PROJECTS_DIR` and
`forge.config.json`'s documented `projectsDir`. With that config set, the
producer and this guard resolved DIFFERENT roots, the containment check failed
against a legitimately-created session dir, and the terminal-phase write was
silently refused — **a finished run reading `phase:"running"` forever.** Closed
by making `ctx.projectsRoot` resolve through `resolveProjectsDir` too.

**A previous revision of this sentence then claimed that made the producer and
the guard "ONE value rather than two independent resolutions that coincide only
in the default configuration". Round-4 adversarial review disproved that as
well — the seventh consecutive round of this campaign to find a false claim in
this document, and the fourth of those written by the orchestrator.** They were
never one value. They were two evaluations of the same expression, at different
times, against a mutable file on disk: `isContainedProjectRepoPath` /
`isContainedWorktreePath` re-read `forge.config.json` on EVERY call, while
`startBridge` evaluates it ONCE at server start and holds the result for the
process's lifetime. Identical expressions agree only while their inputs never
move, and a live `forge.config.json` edit against a running daemon — an ordinary
action against a system explicitly designed to run unattended between human
interaction points — separates them again, false-rejecting legitimate
approve/finalize/requeue paths for the rest of that process's uptime.
**The round-4 fix is therefore not a third attempt at making two resolutions
agree; it removes the second resolution. The root is PASSED
(`ProjectsRootOpt.projectsRoot`, honoured verbatim, no config read), not
re-derived** — and it is threaded at every snapshot-holding entry point, because
a parameter no production caller passes is dead code that leaves the defect live.
A supplied root that is not a non-empty ABSOLUTE path is REFUSED rather than
silently fallen back from (`resolve()` on a relative root anchors to
`process.cwd()`, the exact dependence the round-3 fix removed); that refusal
branch is itself pinned, by mutation, in `orchestrator/manifest-path-fields.test.ts`
(pin 8) — round 5 found it live, correct and pinned by nothing, which is the same
"a guard that cannot fail is not a guard" rule turned on a guard's own refusal
path.

**GUARD MECHANISM CLOSED, PRODUCER WIRING NOT YET CLOSED (bead forge-c6h /
R4-17 round-4)** — disclosed precisely rather than rounded up to a flat
"closed": the guard-side fix described below is complete and tested, but the
one real caller that actually exercises this defect (`POST /api/studio/
onboarding/start`) was not yet rewired to use it — see the "Disclosure, not
overclaim" paragraph below for exactly what remains. The same divergence
survived ACROSS PROCESSES at `writeSessionTerminalPhase` (`packages/agents/agent-run.ts:194`), and
the round-4 sweep did not reach it at the time this row was first written. The bridge creates the session dir under
its snapshot root and spawns `forge agent dispatch --session-dir <abs>` as a
detached subprocess; that subprocess re-derives the projects root at write time
(`:204`) and has no snapshot to be handed. **Reproduced `[exec]`** by driving the
real `cmdAgentDispatch` against a temp forge root with a session dir at
`<root>/projects/p/_onboarding/s`: with the default config the terminal phase is
written (`phase:"failed"`), and with `projectsDir` pointing at a different root it
is **silently not written at all** (`phase:"running"`) — the round-2 BLOCKER's
exact symptom, reached by a different mechanism. Severity is MODERATE, not
BLOCKER, on two measured grounds. First the precondition is genuinely narrow: the
`FORGE_PROJECTS_DIR` facet does **not** diverge, because `spawnAgentDispatch`
(`apps/forge/ui-bridge.ts`) passes no `env` option and the child therefore inherits the
parent's environment verbatim (verified by reading the spawn call) — so this needs
a `forge.config.json` edit landing inside one run's window, not merely a
configured `projectsDir`. Second, the guard fails **closed**: it refuses the
write, so the failure direction is a false rejection and an operator-visible,
recoverable stale `phase`, never a write outside the root. Not fixed in the
original R4-17 round-4 sweep, because the only fix consistent with that
round's own ruling is to PASS the bridge's snapshot into the subprocess (a new
`--projects-root` flag on `agent dispatch`), which makes the guard's own root
an argv input and deserved its own acceptance tests and review round rather
than a tail-of-batch edit.

**The fix, landed**: `forge agent dispatch` gained `--projects-root <abs>`
(`packages/agents/agent-run.ts`'s `parseAgentDispatchArgs`/`checkProjectsRootFlag`). When
present it is validated at the argv boundary — must be an ABSOLUTE path
(a relative one is rejected, never silently resolved against `cwd`/
`forgeRoot`); must EXIST and be a DIRECTORY; must be CONTAINED within
`forgeRoot` (the same realpath + `startsWith(root + sep)` shape used
throughout this document) — and on ANY rejection the dispatch fails loudly
(stderr + exit 2) BEFORE any project resolution or dispatch attempt, never
falling back to the derived root (the exact silent-fallback shape that would
have reintroduced this defect). When accepted, the validated, realpath-resolved
root is threaded into `writeSessionTerminalPhase` as `trustedProjectsRoot` and
honoured VERBATIM — no `forge.config.json`/env re-derivation for that call at
all. Omitting the flag leaves every existing caller byte-identical to before.
`apps/forge/ui-bridge.ts`'s `spawnAgentDispatch` (and its pure argv builder,
`buildAgentDispatchArgs`) now thread the bridge's own snapshot `ctx.projectsRoot`
through as this flag on the generic `POST /api/agents/:slug/run` call site
(`:2782`). **Disclosure, not overclaim**: that specific call site never passes
`--session-dir` (it is `undefined` there), so the new flag is inert on it —
`POST /api/studio/onboarding/start`'s call site (`:5384`), the ONE real
producer of `--session-dir` and therefore the actual repro path this row
describes, was NOT rewired to pass `--projects-root` in this pass (a
fenced-off region of the same file this round); it still relies on
`writeSessionTerminalPhase`'s self-resolving default. The CLI-side mechanism
and its accept/reject contract are fully landed and tested; wiring the
onboarding-start call site is the one remaining step to close the loop for
its real-world trigger.
Pinned by `packages/agents/agent-run-dispatch.test.ts` (the bead forge-c6h characterization
test, which keeps the pre-fix divergence pinned WITHOUT the flag as a permanent
regression control; the bead forge-c6h fix test, ACCEPT with the flag; REJECT
tests for a relative path, a path outside `forgeRoot` — asserted via a planted
sentinel file proven byte-unchanged, "the most important test" for this fix —
and a non-existent path; and an ACCEPT control for a valid, contained root) and
`apps/forge/ui-bridge-agent-dispatch-projects-root.test.ts` (the argv-builder seam:
`buildAgentDispatchArgs` emits the flag, and the parse/build round-trip through
`parseAgentDispatchArgs` survives it unchanged). **A guard that resolves its
root differently from the producer of the thing it guards is a false-rejection
generator** — the failure mode is invisible, because a refused write looks
exactly like a run that has not finished. The
first fix round nevertheless used the WIDER `forgeRoot`, for one reason only:
the `packages/agents/agent-run-dispatch.test.ts` AT-D7 fixtures then built their session
dirs under `<forgeRoot>/_logs/…`, and a `projectsRoot` boundary refused them.
**T2 ruled that the rule stands and the FIXTURE was the incomplete thing** —
the R2-10 gate precedent, where a fail-closed registry check broke a synthetic
`tmpRoot()` and the fixture was corrected rather than the rule. `forgeRoot`
would have accepted a `status.json` write anywhere in the forge tree —
`brain/`, `skills/`, `studio/`, `docs/`, `.git/` — which no caller needs. The
fixtures were re-homed to the real `<projectsRoot>/<project>/_onboarding/<sid>`
shape the route actually produces, and the boundary narrowed to match.
**The named failure mode, kept because it is the inverse of the
accidental-pass family: a production guard widened until a test fixture's
convenient location fit, rather than a test corrected to production's real
shape.**

**Executed, three ways.** AT-9 plants a `--session-dir` OUTSIDE `forgeRoot`
entirely (an OS temp directory) with a pre-existing `status.json` carrying a
sentinel value, drives `cmdAgentDispatch` with an unknown slug (forcing the
failure path, `writeSessionTerminalPhase(..., 'failed')`), and asserts the
sentinel file is byte-identical afterwards — the write never happened.
**AT-D7-4** is the narrowing's own pin: a `sessionDir` INSIDE `forgeRoot` but
OUTSIDE `projectsRoot` (under `<forgeRoot>/_logs/…`) is refused, asserted on
the FILESYSTEM (the planted `status.json` keeps its pre-run phase), because an
exit code cannot distinguish "refused" from "wrote it and carried on". AT-D7-1/
AT-D7-2 are the ACCEPT controls (the write does happen, on both success and
failure, for a `sessionDir` under a real `projectsRoot`), and AT-D7-3 pins D6
(omitting `--session-dir` touches no session `status.json` anywhere,
byte-identical to before this flag existed — unaffected, since the containment
check only runs when the flag is given).

### Guarded in R4-21 — the authoring-session finalize route (SUPERSEDED — see "Guarded in R4-21 phase 2" below)

**Superseded, 2026-08-11 (R4-21 phase 2, WI-2, D5, `_wave5/unit-specs/R4-21-phase2.md`).**
The rows immediately below described the PHASE-1 wire contract: a
client-supplied `entries`/`upstream` (skill) or `name`/`description`/`on`/
`scriptBody`/`matcher`/`permissions` (hook) body, staged through
`packages/library/skill-staging.ts` / written directly by `finalizeHook`. That contract —
and the `finalizeSkill`/`finalizeHook` functions these rows name — no longer
exist. The route now reads `{project, sessionId, kind, id}` ONLY and sources
the installed bytes from a SERVER-LANDED package (see the new section below).
Rows kept for history; do not use them to reason about the current route.

One new file, `packages/library/bridge-studio-authoring.ts` (`POST /api/studio/authoring/finalize`,
the creation-agent authoring session's save path), flagged by
`scripts/check-request-path-sinks.mjs` on first use (baseline 0 -> `mkdirSync`
2, `rmSync` 1, `writeFileSync` 2) — the ratchet working exactly as designed on
a brand-new file. The route composes two EXISTING, already-guarded write
paths rather than inventing a third; no new containment shape is introduced.

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/library/bridge-studio-authoring.ts:153` (`finalizeSkill`) | `mkdirSync` | none — `stagingRoot = resolve(ctx.forgeRoot, '_skill-staging')` | guarded `[read]` | Fixed, config-derived root, no request data in the path at all — byte-identical rationale and call shape to `packages/library/bridge-studio-skills.ts`'s `POST /api/studio/skills/install` route's own `mkdirSync(stagingRoot, {recursive:true})` (same constant, same purpose: the private staging root must exist before `resolveGuardedPath` can realpath it). |
| `packages/library/bridge-studio-authoring.ts:179` (`finalizeSkill`, `finally`) | `rmSync` | none — `sourceId` is SERVER-MINTED (`newSourceId()`, a timestamp + 4 random base36 chars), never derived from the request body | guarded `[read]` | Cleans exactly `<stagingRoot>/<sourceId>` on both success and throw; mirrors `packages/library/bridge-studio-skills.ts`'s identical `finally`-block cleanup. `force:true` makes it a no-op when staging never wrote (an early body-validation 400). |
| `packages/library/bridge-studio-authoring.ts:153` (`finalizeSkill`, via `stageSkillPackage`) then `installSkillPackage` | (per-entry containment, inside `packages/library/skill-staging.ts` / `orchestrator/studio/skill-library.ts`) | body `id`, `entries[].path`, `upstream.source`/`ref` | guarded `[read]` | **New caller of an existing, already-guarded primitive — "one sink, many entry points."** `finalizeSkill` re-validates the request body shape (mirrors `POST /api/studio/skills/install`'s own inline checks: non-empty `id`; `entries` a non-empty array of `{path, contentBase64}` with no absolute or `..`-containing `path`, capped at 1 MiB decoded; `upstream.source` required) and then calls the SAME `stageSkillPackage(stagingRoot, sourceId, entries)` and `installSkillPackage({forgeRoot, id, packageDir, upstream})` the `/install` route calls — both already carry their own realpath-based per-segment containment (`resolveGuardedPath`/`guardedFile`), documented at this table's `packages/library/bridge-studio-skills.ts:136,147`-style rows above. No new validation or write logic was written for this path; RED-4b/RED-4d (`packages/library/bridge-studio-authoring.test.ts`) exercise the missing-`SKILL.md`, traversal-`entry.path`, over-cap, and symlinked-`skills/<id>`-directory shapes through THIS route and pass, confirming the shared guard fires identically from the new call site. |
| `packages/library/bridge-studio-authoring.ts:290-292` (`finalizeHook`) | `mkdirSync`, `writeFileSync` ×2 | body `id`/`name` (slug derivation), `on`, `scriptBody`, `matcher?` | guarded `[read]` | Byte-identical shape to `packages/library/bridge-studio-hooks.ts`'s `POST /api/studio/hooks` route (the `unguarded [exec]` rows above are that route's PRE-fix history; its current code — read at the time this row was written — resolves both destinations via `resolveGuardedPath(hooksDir(forgeRoot), [slug, 'hook.yaml'])` / `[slug, 'scripts', 'run.sh']` before any write, refusing on `!guard.ok` and 409-ing on a pre-existing `hook.yaml`). This route re-states the identical two `resolveGuardedPath` calls and writes only through their returned `realPath`s — never a fresh `join()`. `FORBIDDEN_HOOK_BINDING_KEYS` is checked before any of this runs, so a binding-key body 400s before any fs call. Pinned by RED-4c (`packages/library/bridge-studio-authoring.test.ts`) for the write shape and the binding-key rejection; RED-4d covers the symlinked-directory escape for the sibling skill path (the hook path's containment is the SAME `resolveGuardedPath` call already covered by this table's existing rows for that function — not re-executed against this specific route in this round). |

### Guarded in R4-21 phase 2 (WI-2, D5) — finalize becomes the operator COMMIT act; `packages/sessions/interactive-runner.ts` + `interactive-finalizers.ts` become bridge-reachable

`packages/library/bridge-studio-authoring.ts` was REWRITTEN (see the superseded section
above): the wire contract narrows to `{project, sessionId, kind, id}`, and the
route now (1) guarded-reads/writes the session's own `status.json`
(`packages/sessions/interactive-session.ts`'s `guardedReadSessionStatus`/
`guardedWriteSessionStatus` — already-guarded siblings, no new primitive),
(2) DYNAMICALLY imports `packages/sessions/interactive-runner.ts` and runs ONE
`committing` turn through `runInteractiveTurn` (the SAME spine `forge agent
run` dispatches to — R4-22 WI-3, already audited for its OWN containment in
that module's header), and (3) reads the LANDED package back out through
`resolveGuardedPath(forgeRoot, ['_interactive-library', id, ...])` before
installing it. `scripts/check-request-path-sinks.mjs` flagged two
consequences of step (2), both expected and both already-guarded:

- **`packages/library/bridge-studio-authoring.ts` itself tightened** (fewer raw sinks, not
  more): the old inline `_skill-staging` mkdir/rmSync pair is gone (`mkdirSync`
  2→1, `rmSync` 1→0) — the one remaining `mkdirSync` is
  `finalizeHookFromLanded`'s `mkdirSync(dirname(scriptGuard.realPath))`,
  writing only through a `resolveGuardedPath`-returned `realPath`.
- **`packages/sessions/interactive-runner.ts` and `orchestrator/
  interactive-finalizers.ts` become reachable from a bridge route for the
  FIRST time** (baseline 0 for every sink in both files) — before this WI,
  both modules were reachable only from `packages/agents/agent-run.ts` (a CLI entry
  point, not an HTTP route), so the ratchet had never scanned them. The
  dynamic `import('../packages/sessions/interactive-runner.ts')` inside
  `runFinalize` makes the WHOLE file (and its own static import of
  `interactive-finalizers.ts`) reachable per this ratchet's file-level
  reachability model — not a claim that the finalize route's ONE `committing`
  turn executes every function in either file (it does not: e.g.
  `readSkillPrompt`'s `readFileSync` only runs on the `agent`-step path,
  never on `committing`).

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `orchestrator/interactive-finalizers.ts` (`discoverStagingEntries`) | `realpathSync`, `readdirSync`, `lstatSync` | none directly — `sessionDir` is the CALLER's already-SEC-04-guarded value (`packages/library/bridge-studio-authoring.ts` → `runInteractiveTurn`'s own preamble, `resolveGuardedPath(projectsRoot, [project, '_authoring', sessionId])`); every discovered entry is re-verified through `resolveGuardedPath(sessionDir, ['staging', ...relParts])` BEFORE this file ever `readdirSync`s into it | guarded `[read]` | `realpathSync(stagingRoot)` resolves the trusted `<sessionDir>/staging` literal (no request field folded in); `readdirSync`/`lstatSync` only run on paths that already passed the per-segment identity walk (this module's own header — "the guard check on the entry itself runs before any recursion into it"). No new containment primitive; reuses `resolveGuardedPath` on both source and destination sides, as the module's own extensive header documents (already audited when R4-22 WI-2 landed this file). |
| `orchestrator/interactive-finalizers.ts` (`copyStagingToLibrary`) | `mkdirSync` | none — `dirname(destPath)`, where `destPath` is `resolveGuardedPath(libraryRoot, [packageId, ...relParts]).realPath`; `packageId` is request-derived (the finalize route's `id`) but rides as its OWN guarded segment, never folded into `libraryRoot` | guarded `[read]` | `mkdirSync` only ever creates a directory UNDER an already-guard-verified `realPath` — never a fresh `join()` on unresolved input. |
| `orchestrator/interactive-finalizers.ts` (`readValidatedStagedFile`/`writeValidatedLibraryFile`) | `openSync` ×2 | same `srcRealPath`/`destPath` as above | guarded `[read]` | The TOCTOU-closing fd-reopen the module's own header documents at length: `O_NOFOLLOW` (both) and `O_EXCL` (write side) make the `openSync` call itself fail on a symlink swapped in between the Phase-1 guard check and this Phase-2 use — the containment mechanism IS this call's own flags, not a separate check preceding it. |
| `packages/sessions/interactive-runner.ts` (`listWrittenFiles`) | `lstatSync`, `readdirSync` | `guarded.realPath`, where `guarded = resolveGuardedPath(sessionDir, segments)` inside the SAME function, for every `turnSpec.phases[].writes` entry | guarded `[read]` | Identical shape to the `interactive-finalizers.ts` walk above — the guard check runs before recursion, and these two sinks only ever see an already-identity-verified `realPath`. Not reachable from the finalize (`committing`) step in practice (`listWrittenFiles` is called from the `agent`-step branch, `runAgentStyleStep`) — counted here because file-level reachability, not per-function reachability, is what the ratchet measures. |
| `packages/sessions/interactive-runner.ts` (`runFinalizeStep`) | `mkdirSync` | none — `libraryRootGuard.realPath`, where `libraryRootGuard = resolveGuardedPath(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME])`; `forgeRoot` is config-derived, never request data | guarded `[read]` | GUARD-TERMINAL create: only runs when the dedicated `_interactive-library/` root does not exist yet (a fresh forge install), and only creates the already-guard-verified `realPath` — never a fresh root. **This IS on the finalize (`committing`) path** — the one sink among this section's rows that the route's own turn actually executes. |
| `packages/sessions/interactive-runner.ts` (`readSkillPrompt`) | `readFileSync` | `skillPath(agentId)`, where `agentId = descriptor.agent` — a value from the trusted, server-loaded `studio/session-kinds.yaml` descriptor, never from the HTTP request body | guarded `[read]` | Fixed, config-derived path (the agent's own `SKILL.md` under the real forge install) — no request data reaches this call at all. Not reachable from the finalize (`committing`) step (see the file-level-vs-per-function note above); documented for completeness since the ratchet counts the whole file. |

### Not request-path sinks at all in W8-B4/WI-5 — `removeInstallLedgerEntry`'s FIXED-path writes

`scripts/check-request-path-sinks.mjs` flagged `orchestrator/studio/skill-install-ledger.ts`
(`mkdirSync` 1→2, `writeFileSync` 1→2) after WI-5 added `removeInstallLedgerEntry` — the
delete-side inverse of `writeInstallLedgerEntry` that library-35 needed. The scanner's
reachability heuristic is FILE-level: the module is reachable from a bridge route that
carries a request-derived `id`, so every new fs sink in it is reported. Classified below
after reading both new lines.

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `orchestrator/studio/skill-install-ledger.ts` (`removeInstallLedgerEntry`) | `mkdirSync` | **none** | not-request-derived `[read]` | The argument is `join(forgeRoot, 'studio')` — a constant sub-path of the TRUSTED root, with no request-derived component. Byte-identical to `writeInstallLedgerEntry`'s own `mkdirSync` two functions above, which is already baselined at 1 for exactly this reason. |
| `orchestrator/studio/skill-install-ledger.ts` (`removeInstallLedgerEntry`) | `writeFileSync` | **none** | not-request-derived `[read]` | The argument is `ledgerPath(forgeRoot)` — a FIXED path (`studio/installed-skills.yaml`). The request-derived `id` reaches this function but is used ONLY as a `Map` key (`ledger.has(id)` / `ledger.delete(id)`); it never enters a path expression, so no traversal shape exists to guard. A traversal-shaped id simply matches no row and the function returns early. Byte-identical in shape to `writeInstallLedgerEntry`'s `writeFileSync`, already baselined at 1. |

Accepted by a **surgical two-row edit** to `scripts/request-path-sinks.baseline.txt`, not
`--write` — the same discipline WI-3 used in the section below, so the accepted growth is
exactly the two rows reasoned about here and nothing else rides along.

### Guarded in W8-B4/WI-3 — `kind:'template'` finalize + the library-37 landed-copy cleanup fix

Two consequences of this WI, both flagged by `scripts/check-request-path-sinks.mjs`
on `packages/library/bridge-studio-authoring.ts` (baseline `rmSync` 0→1, `writeFileSync`
2→3) — no new containment PRIMITIVE, both compose already-guarded pieces.

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/library/bridge-studio-authoring.ts` (`finalizeTemplateFromLanded`, new) | `writeFileSync` | `id` (the finalize route's own path segment, already SLUG_RE-validated by `invalidTemplateIdReason` before this line runs) | guarded `[read]` | The template-write half of `kind:'template'`. `category` is read from the LANDED, DRAFTED `template.md`'s own frontmatter (never a request-body field — the hook arm's posture) purely to pick `WRITABLE_CATEGORY_DIRS[category]`, then the write target is resolved through `resolveGuardedPath(resolve(forgeRoot, ...dirSegments), [leaf])`, `leaf` = `${id}.md` — the SAME guarded choke point `packages/library/bridge-studio-templates.ts`'s `POST /api/studio/templates` route already uses (`writableCategoryOrReason`, `WRITABLE_CATEGORY_DIRS`, `invalidTemplateContentReason` are imported from that file, not re-implemented) — and the write targets only `targetGuard.realPath`, never a fresh `join()`. `project-scaffold` is refused (400, `SCAFFOLD_READONLY`, the SAME constant that route returns) before any write is attempted. |
| `packages/library/bridge-studio-authoring.ts` (`runFinalize`, new `finally`) | `rmSync` | `id` (SAME already-validated segment as above) | guarded `[read]` | **library-37 fix** (wave-8 regate finding): `_interactive-library/<id>/` — step 5's `copyStagingToLibrary` landing target — is an internal staging→landing bridge, never a durable record, and was previously never cleaned up on ANY outcome, making it a hidden id LEDGER (a leftover ghost from one attempt permanently 409-blocked every later attempt under the same id, even after the original session correctly reverted and even where no REAL library ever held that id). Removed in a `finally` after every attempt (success OR failure), through `resolveGuardedPath(ctx.forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id])` — the SAME guard step 6 already uses to READ this same directory — writing only `cleanupGuard.realPath`, guarded by both `.ok` and `.exists` before the call. Best-effort (a secondary cleanup failure is swallowed, never masking the already-sent response) and does NOT weaken the real id-collision check: each `kind`-specific install step (`finalizeSkillFromLanded`/`finalizeHookFromLanded`/`finalizeTemplateFromLanded`) still 409s on a genuine REAL-library collision, naming that holder — only the GHOST-dir-based preflight (a blind `_interactive-library/<id>` existence check that ran BEFORE any real-library lookup) was removed. `[exec]`-verified: `packages/library/bridge-studio-authoring-finalize.test.ts`'s P8-1 (re-corrected), WI3-5-b, and WI3-5-c. |

### Guarded in R4-21 T3 — the `deriveFilePackage` recursive walk (BLOCKER-1) + the authoring-session start route (BLOCKER-2)

An adversarial-review pass on R4-21 found two confirmed blockers, both fixed
in the same round. Fixing them grew `scripts/check-request-path-sinks.mjs`'s
tracked sink counts (`apps/forge/ui-bridge.ts`: `mkdirSync` 5→7, `realpathSync` 1→2,
`writeFileSync` 2→4; `orchestrator/studio/session-transcript.ts`: `readdirSync`
1→2, `realpathSync` 4→6) — the ratchet firing exactly as designed on two new
call sites, neither of which introduces a new containment SHAPE.

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `orchestrator/studio/session-transcript.ts` (`listDirEntriesTyped`, new) | `readdirSync` (`{withFileTypes:true}`), `realpathSync` ×2 | session dir + a `package/`-relative subpath built entirely from EARLIER `readdirSync` entry names (never a request field directly) | guarded `[read]` | BLOCKER-1 fix: `deriveFilePackage` previously scanned only the TOP LEVEL of `package/` via the existing `listDirEntries` (flat, extension-filtered) + a per-name `safeReadFileInSession` read — a nested file (e.g. `package/scripts/run.sh`) has a DIRECTORY as its top-level entry, and `readFileSync` on a directory threw `EISDIR`, caught, silently dropping the entry (declared-data-fails-open). `listDirEntriesTyped` is `listDirEntries`'s realpath-containment guard verbatim (same two `realpathSync` calls, same `startsWith(realSessionDir + sep)` boundary, same "escaping/missing directory ⇒ `[]`, treated as absent" contract) with `Dirent[]` returned instead of filtered name strings, so the new recursive walker (`walkPackageFiles`) can tell a REAL subdirectory (`entry.isDirectory()`) from everything else (a plain file, or a symlink of any kind — `fs.Dirent`'s type check never reports a symlink as `isDirectory()`/`isFile()`) without a second stat call. Only a real directory is descended; every other entry — including a symlink to a file OR a directory, in-bounds or escaping — is attempted ONLY through the pre-existing `safeReadFileInSession` choke point, which fails closed on any escape exactly as it already does for the flat `manifests/`/`themes/` scans. No new containment PRIMITIVE was written; the recursion is bounded by the existing `MAX_PACKAGE_FILES`/`MAX_PACKAGE_BYTES` caps (`orchestrator/studio/skill-library.ts`) reused as a soft read-side DoS bound. Pinned by `orchestrator/studio/session-transcript.test.ts`'s RED-2d (nested file surfaces) and RED-2e (a symlink nested inside a `package/` subdirectory pointing outside `sessionDir` contributes no file, with a real sibling positive control) — RED-2d was RED before this fix (the nested file was silently dropped), GREEN after. |
| `apps/forge/ui-bridge.ts` (`POST /api/studio/authoring/start`, new) + `writeAuthoringSession` | `mkdirSync` ×2, `realpathSync` ×1, `writeFileSync` ×2 | body `project` (session-scratch container only — see below), server-generated `sessionId`/`runId` | guarded `[read]` | BLOCKER-2 fix: the launcher this route backs had no start mechanism at all before this fix. Byte-for-byte the SAME shape as the already-guarded `POST /api/studio/onboarding/start` row (Table 1, "Guarded in R4-17"): `project` is `SLUG_RE`+length-cap validated (`invalidGenerationProjectReason`) BEFORE any fs call, then resolved through the SAME `resolveContainedProjectDir` (`packages/projects/contract-stages.ts`) that route already calls — by import, not a second implementation. `sessionId` is server-generated (`newArchitectSessionId()`), never request-derived. The `_authoring` parent is created (`mkdirSync(authoringParent, {recursive:true})`) and realpath-re-verified (`realpathSync` + `startsWith(realProjectDir + sep)`) BEFORE the session dir is created beneath it — "validating a root does not validate what you write beneath it," the same lesson the onboarding row documents for a project repo that could carry a committed symlink named `_authoring`. `writeAuthoringSession` (mirrors `writeOnboardingSession`) then applies the SAME three independent closes: exclusive directory create (no `recursive` — a pre-existing entry, including a symlink, is a hard `EEXIST`), and both leaf writes (`status.json`, `prompt.md`) use `{flag:'wx'}` (`O_CREAT\|O_EXCL`), never following an existing symlink. No new validation or containment logic was written for this route — every check is a call into an existing, already-guarded primitive. **Disclosed, not a containment gap:** the route's own `spawnAgentDispatch(forgeRoot, 'creation-agent', ...)` call will be refused inside the detached child process on a REAL (non-dry-bridge) run, because `creation-agent` declares `surface: interactive` and no dedicated bounded-turn runner exists yet for it — a functional gap (the session never actually gets a drafted package), not a security one; see the route's own comment in `apps/forge/ui-bridge.ts` and the T3 report for the follow-up this implies. |

### Guarded in W6-B4 — the generic session-affordance write endpoint (ADR-043 2026-08-15 amendment §1)

`cli/bridge-studio-affordances.ts` (new) owns `POST /api/studio/sessions/:kind/:sessionId/:affordance` — the un-deferred `POST …/sessions/:kind/:sessionId/:affordance` write endpoint ADR-043's original §Consequences paragraph named as future work, "every path routes through the resolveGuardedPath/guardedReadDir choke point with the isSafeRunId ratchet." This row is a NET-ZERO addition on `scripts/check-request-path-sinks.mjs`'s own ratchet — `node scripts/check-request-path-sinks.mjs` PASSED with no `--write` needed, because the new file calls **zero** raw fs sinks and **zero** `DESIGNATED_UNGUARDED_FUNCTIONS` directly:

- `kind` resolves against `loadSessionKinds` (structural parse only, no fs sink of its own beyond the already-audited yaml read).
- `sessionId` is checked with `isSafeRunId` (`packages/agents/run-agent.ts`) BEFORE any fs call, THEN the session dir is resolved with `resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId])` — the SAME per-segment identity guard `packages/sessions/bridge-studio-sessions.ts`'s GET sibling uses, with `project` validated via that file's own exported `invalidProjectReason` (reused, not re-derived — keeps the KB-seeding dot-anchor carve-out defined in exactly one place).
- Every status.json read/write goes through `guardedReadSessionStatus`/`guardedWriteSessionStatus` (`packages/sessions/interactive-session.ts`); the instructions-answer branch's `answers.json` read/write goes through `guardedReadFile`/`guardedWriteFile` (`packages/kernel/path-guard.ts`) — the SAME leaf-inclusive guarded siblings every bespoke per-kind route already uses, imported directly, never re-implemented.
- kb-cleanup's approve delegates WHOLESALE to `approveKbCleanup` (`packages/knowledge/bridge-studio-kbs.ts`) — see the CONCURRENCY subsection immediately below for why this is no longer a thin `enqueueConsolidate`/`runBrainConsolidateNow` pass-through, and no new raw sink either way: `approveKbCleanup` itself makes zero raw fs calls, only calls into already-audited `guardedReadSessionStatus`/`guardedWriteSessionStatus`/`enqueueConsolidate`/`runBrainConsolidateNow`.
- authoring's approve delegates WHOLESALE to `runFinalize` (`packages/library/bridge-studio-authoring.ts`, exported for this file, unchanged body) — already fully audited above ("Guarded in R4-21 phase 2"); this route only validates the wire-shape of `{verdict, kind, id}` before handing off, adding no new fs call on that path.

`cli/bridge-studio-affordances.ts` was verified reachable by `check-request-path-sinks.mjs`'s own reachability walker (it is a direct relative import of `apps/forge/ui-bridge.ts`) and reported ZERO sink rows for it in `scripts/request-path-sinks.baseline.txt` — the honest zero-new-sinks outcome of "delegate to the same underlying write+spawn helpers rather than reimplement," not an unscanned blind spot.

`spawnAgentTurn` (`apps/forge/ui-bridge.ts`, module-private) is INJECTED into this route via `AffordanceRouteContext.spawnAgentTurn` (passed by reference from the one place it is defined) rather than imported — `bridge-studio-*.ts` modules never import FROM `ui-bridge.ts` (verified: `grep -rn "from '\\./ui-bridge" cli/*.ts` finds only `apps/forge/forge-watch.ts`'s unrelated `startBridge` import, never a `bridge-studio-*.ts` file), so this preserves that one-way import-direction rule instead of introducing a cycle. This mirrors `SessionsRouteContext`'s pre-existing `ensureSessionTail` injection (`packages/sessions/bridge-studio-sessions.ts`) for the identical reason.

**CONCURRENCY — a check-then-await-then-write RACE was live-reproduced and closed in the SAME batch (adversarial-review round), disclosed explicitly rather than folded silently into the row above.** The initial cut of kb-cleanup's approve (both here AND in the pre-existing bespoke `POST /api/studio/kbs/:id/cleanup/apply`, `apps/forge/ui-bridge.ts`) ran: read `status.json` -> check `phase === 'awaiting-approval'` -> `await enqueueConsolidate(...)` -> write `phase:'applied'`. `enqueueConsolidate` serializes the DRAIN per kbId (so two RUNNING drains never corrupt the same on-disk category-index file concurrently) but does nothing to stop a SECOND caller from being enqueued in the first place — two concurrent approves against the SAME session both read `awaiting-approval` (both pass the check) before either write landed, so both proceeded to `enqueueConsolidate`. `[exec]` repro: two concurrent `POST` requests against one session produced two independent `runBrainConsolidateNow` runs (two distinct `runId`s, two `_logs/_brainfix-<runId>/` dirs) for what should have been ONE approved action. This is the general **check-then-act-across-an-await** class — any handler that reads a guard condition, then `await`s something, then acts on the (possibly stale) condition is vulnerable, regardless of how well the READ or the WRITE is individually guarded; SEC-04's containment guards (`resolveGuardedPath` et al.) say nothing about it, because the escaped VALUE here is never a filesystem path — it is a stale in-memory belief about `status.phase`.

Fix: `approveKbCleanup` (`packages/knowledge/bridge-studio-kbs.ts`) makes the read-check-claim span **synchronous** — the status read, the phase/kb_id checks, and a write of an intermediate `phase:'applying'` all happen with ZERO `await` between them, BEFORE the one real await (`enqueueConsolidate`'s drain). Node's single-threaded event loop never preempts a synchronous span, so a second concurrent caller can only ever observe this function's state either before the claim started (and then runs the SAME synchronous span itself, landing after the first caller's write) or after it landed (reading `'applying'`, not `'awaiting-approval'`) — never mid-claim. The second caller therefore 409s before ever calling `enqueueConsolidate` or minting a `runId`. `studio/session-kinds.yaml` gained one new, `next`-unreachable phase (`applying`, `step: terminal`, mirroring how `applied` has always been unreachable via `next`) purely so `deriveSessionAffordances` correctly derives zero affordances while a claim is in flight — not a new containment primitive, a state-machine label for an existing one. Both the generic route (this file) and the bespoke `/cleanup/apply` route now call the ONE shared `approveKbCleanup` — the duplicated, independently-racy choreography that used to exist in each is deleted, not merely mirrored twice with the fix pasted into both. `[exec]`-verified: `apps/forge/bridge-studio-affordances.test.ts`'s RACE-1 (this route) and RACE-2 (the bespoke route) each fire two concurrent approves against one session and assert exactly one 200 + one 409, exactly one `_brainfix-<runId>` dir, and the session ending at `applied` (never stuck at `applying`) — deterministic assertions, not timing-based (contrast `apps/forge/ui-bridge-kb-cleanup.test.ts`'s pre-existing AT-9/AT-10, which had to fall back to timing because THAT fix — DEFECT A, cross-kbId serialization via `enqueueConsolidate` — has no non-timing signal available; the SAME-session double-claim race this section describes is a different property and gets a non-flaky, existence/count-based proof instead).

**Named, not silently accidental: the SAME "no await between read and write" shape makes instructions'/demo's verdict and instructions' answer handlers race-safe TODAY, without a claim-phase fix.** None of `handleInstructionsAnswer` / `handleInstructionsVerdict` / `handleDemoVerdict` (`cli/bridge-studio-affordances.ts`) contains an `await` between the caller's `status` read and its own `guardedWriteSessionStatus` write, so each is atomic by the same Node-event-loop argument above — accidental in the sense that nothing PREVENTS a future edit from adding an await there (exactly how kb-cleanup's now-fixed race was introduced), so each carries its own "SYNC INVARIANT" code comment naming this explicitly, plus one summary paragraph in the file's own header. Authoring's approve needed no such fix or comment beyond a cross-reference: `runFinalize` (`packages/library/bridge-studio-authoring.ts`) already re-reads status.json itself and writes its own atomic claim (`phase:'committing'`) before its one await — the shape `approveKbCleanup` was built to match, not a new pattern.

**Hardening (adversarial-review round, disclosed alongside, not a containment fix):** `answers[]` (the instructions question-form write) gained a 64-entry count cap and an 8 KiB per-field (`question`/`answer`) size cap, both returning 400 naming the exceeded cap before any write — no upstream caller bounded either dimension, and an unbounded interview transcript flows into the agent's next prompt verbatim. `[exec]`-verified: `apps/forge/bridge-studio-affordances.test.ts`'s HARDEN-1/2/3 (over the count cap, over the field-size cap, and exactly at both caps — the last a false-positive guard, not just a true-positive one).

**Live symlink escape, closing a coverage gap rather than a defect:** `packages/sessions/bridge-studio-sessions.ts`'s GET sibling already has AT-47-style symlinked-session-dir coverage; this file's own POST route had none until this round. `[exec]`-verified: `apps/forge/bridge-studio-affordances.test.ts`'s SEC-SYMLINK plants `<projectsRoot>/<project>/_instructions/<sessionId>` as a symlink to a victim session dir OUTSIDE the project (carrying a secret marker) and asserts 404, no marker anywhere in the response body, and the victim session byte-unchanged on disk — `resolveGuardedPath`'s existing per-segment identity walk (no new guard code) catches it at the `sessionId` segment, the same mechanism the GET sibling already relies on.

### Guarded in W6-B11 — the aggregate sessions-index route (`GET /api/studio/sessions`)

`handleStudioSessionsIndex` + `collectStudioSessionIndexRows` (both new, `apps/forge/ui-bridge.ts`) back the aggregate in-flight-sessions index. This row is the reason `scripts/check-request-path-sinks.mjs`'s baseline grew (`existsSync` 25→27, `readdirSync` 13→15, `readFileSync` 7→8) — every new sink is the SAME shape `collectSessionRows` (Table 1, row "`apps/forge/ui-bridge.ts` (`GET /api/agents/:slug/history`...)") already established and this audit already classified `guarded [exec]`, not a new containment design:

- The four legacy kinds (architect/instructions/demo/project-brain) contribute **zero** new sinks — they reuse `listArchitectSessions`/`listInstructionsSessions`/`listDemoSessions`/`listProjectBrainSessions` verbatim, the SAME already-audited readers the existing per-kind list routes call.
- Every OTHER registry kind (onboarding, authoring, kb-cleanup, and any future kind with no bespoke list route) falls through to a generic directory scan, mirroring `collectSessionRows`'s own shape exactly: `existsSync(ctx.projectsRoot)` + `readdirSync(ctx.projectsRoot)` enumerate REAL, server-discovered project directory names under the FIXED, config-derived `projectsRoot` (never request-derived — this route takes no path segments at all, so there is no `kind`/`project`/`sessionId` request input to taint anything with); `existsSync(kindDir)` + `readdirSync(kindDir, {withFileTypes:true})` do the same one level down, where `kindDir` is `join(projectsRoot, enumeratedProjectName, "_" + descriptor.id)` — `descriptor.id` is a registry id from `loadSessionKinds` (never a request field), and `enumeratedProjectName` is a name `readdirSync` itself just returned, not a client-supplied string. Both `readdirSync` calls are the FILTER-PREDICATE-FP + READDIR-ENUM shape the existing row already documents: the value flowing into the sink is a server-enumerated name, not client input riding through a taint-source variable name.
- The per-session LEAF read (`readGuardedSessionIndexSummary`, new) is where a genuinely session-scoped value (`sessionId`, drawn from the just-enumerated dirent names) reaches a file read — and it goes through `resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId, 'status.json'])` first; the ONE `readFileSync` call in this function reads `guarded.realPath` — the guard's OWN resolved output, guard-terminal on its face (nothing but a `PathGuardOk` carries that field), never the raw joined candidate. This is the identical `readGuardedSessionStatus`/`guardedReadSessionStatus` pattern the row above and `packages/sessions/interactive-session.ts` already established, just returning a couple more fields (`modelTier`, a best-effort `updatedAt`) off the SAME guarded read.
- `terminal` is derived via `isTerminalPhase` (`packages/sessions/bridge-studio-sessions.ts`, exported by this WI) and `needsYou` via the pre-existing `deriveSessionAffordances` — neither touches the filesystem; both are pure derivations over the already-guarded-read `phase` string and the registry descriptor.

**Traversal surface, stated plainly:** this route has NONE from the request itself — `GET /api/studio/sessions[?active=1]` carries no `kind`/`project`/`sessionId` path or body field for an attacker to poison; every id the collector touches is either a registry id (`loadSessionKinds`) or a name the filesystem itself just enumerated. The escape shape this audit's "kind ids from registry only" framing calls out (a caller choosing which kind/session to read) simply does not exist on this route — it always walks the FULL registry × FULL on-disk project set, capped to the newest 200 rows (`SESSION_INDEX_MAX_ROWS`) after the fact, never gated by a caller-chosen selector.

`[exec]`-verified: `apps/forge/ui-bridge-sessions-index.test.ts`'s symlink-escape test plants a REAL victim session under a genuine project (`victimproj`) and a SYMLINK at an unrelated attacker project's `_kb-cleanup/evil-session` pointing at it — the victim's own row surfaces exactly once, attributed to `victimproj`; the attacker project contributes no row at all, `resolveGuardedPath`'s per-segment identity walk refusing the symlinked leaf at the guarded read, the same mechanism every other guarded sibling in this table relies on.

Baseline accepted via `node scripts/check-request-path-sinks.mjs --write` — the three-line delta above, no other file's counts changed.

### Guarded in W7-A4 — the ONE KB-site enumeration (`packages/knowledge/kb-sites.ts`) + the derived project→KB binding

W7-A4 (findings knowledge-03 / projects-34) moved the "where may a `kb.yaml` live" walk out of `loadKbDescriptors` (`packages/knowledge/bridge-studio-kbs.ts`) into a leaf, `packages/knowledge/kb-sites.ts`, so the project roster (`loadProjectsWithMeta`, `apps/forge/bridge-studio.ts`) can DERIVE a project's `kb` from the descriptor whose `binding: { kind: project, ref }` names it without importing the KB route module back (an ESM cycle). This row is the reason `scripts/check-request-path-sinks.mjs`'s baseline changed (`packages/knowledge/kb-sites.ts` `existsSync` 0→2, `readdirSync` 0→1; `packages/knowledge/bridge-studio-kbs.ts` `existsSync` 5→4 — the same sinks, relocated, not new surface):

- `kbSites(forgeRoot)` is `subDirs(brain/)` + `subDirs(brain/projects/)` — `existsSync` + `readdirSync(dir, {withFileTypes:true})` over the two FIXED, `forgeRoot`-derived containment roots (ADR 035). Neither call takes a request-derived value: both routes that consume it (`GET /api/studio/kbs`, `GET /api/studio/projects`) carry no path segment at all, and every name that flows out is a name the filesystem itself just enumerated (READDIR-ENUM + FILTER-PREDICATE-FP, dot-prefixed dirs skipped). It is byte-for-byte the `subDirs` shape `loadKbDescriptors` already carried and this audit already classified (Table 1, `loadKbDescriptors`/`pushFrom` row) — the function moved files, the surface did not grow.
- Each site is returned as `{ base, name }` — the fixed root and the directory's own name as a separate segment, never a pre-joined path — so both callers re-enter the guard with the id as its own identity-checked segment: `resolveGuardedPath(base, [name, 'kb.yaml'])`. `projectKbBindings` reads ONLY `guard.realPath` (guard-terminal), and additionally refuses a descriptor whose `id` is not its directory name or fails `KB_ID_RE` (a listed id must be routable — the same rule `loadKbDescriptors` now applies before listing). Nothing derived here is ever written back; the binding is recomputed from the descriptors on every roster read.

Baseline accepted via `node scripts/check-request-path-sinks.mjs --write` — the three-line delta above, no other file's counts changed.

### Accidentally-safe — the accident is the protection, and nothing knows it

These are **not** fixed. Each is blocked by a side effect of unrelated code; a refactor of that unrelated code removes the protection silently. Every one carries a regression-lock test with the accident named in a comment.

| file:line | route | the accident, named |
|---|---|---|
| `packages/knowledge/bridge-studio-kbs.ts:519` | `POST /api/studio/kbs` (create) | `existsSync` **follows** the symlink and returns 409 before the write; a *dangling* link makes recursive `mkdirSync` fail `EEXIST`. Either way no write reaches the target. `[exec]` |
| `packages/knowledge/bridge-studio-kbs.ts:568` | `DELETE /api/studio/kbs/:id` | `rmSync` on a symlink unlinks the **pointer only** — POSIX/Node never descend into the target. Verified three ways, target byte-identical each time. A UX footgun (reports success while only vanishing a pointer), not a vulnerability. `[exec]` |
| `packages/knowledge/bridge-studio-kbs.ts:87-116` (`subDirs`, feeding `loadKbDescriptors`) | `GET /api/studio/kbs`, whole-KB detail | `readdirSync(..., {withFileTypes:true}).filter(e => e.isDirectory())` — `isDirectory()` is **false for a symlink**, so a symlinked `brain/<id>` DIRECTORY is never discovered. Blocks the pure slug-symlink shape *only*. The nested shapes went straight through it (that is how the write hole survived), and so did a symlinked `kb.yaml` LEAF — see the fixed row above. The dirent filter is retained, but it is no longer what protects this route. `[exec]` |
| `orchestrator/kb-graph.ts:94-101` (`walkMdFiles`) | `_raw` recursive walk | Same dirent-type filter: `isDirectory()` **and** `isFile()` are both false for a symlinked entry, so a symlink cannot enter the result set. **Residual, stated:** a *hardlinked* `.md` deep inside a real `_raw/` tree is a genuine regular file and passes this filter. `[exec]` |
| `orchestrator/skill-path.ts` / `hook-library.ts` nested package walks | skills/hooks detail | Same dirent-type filter on the recursive walk. Note this protected only the *nested* entries — the top-level dir and the fixed-filename direct reads had no such protection, which is what this sweep fixed. `[read]` |
| `packages/flows/bridge-recovery.ts:121`, `packages/flows/bridge-studio-runs.ts:715,717` | requeue / run start | `renameSync` on a symlink source moves the **link**, not the target, and atomically replaces a destination dirent rather than writing through it. `rmSync` likewise never dereferences. `[read]` |
| `packages/flows/bridge-studio-runs.ts:739` | `POST /api/runs/:id/resume` | `resumeFromDemo` was **hardcoded `true`** at this call site, so the destructive `rmSync` branch was structurally unreachable *from here* — the accident was the flag, not a guard on `worktree_path`, and the same function reached from `/api/recovery/:id/requeue` **was** exploitable. **No longer load-bearing:** SEC-02 put a real containment assertion on the value inside `runRequeue` itself, so this row is now genuinely guarded and the hardcoded flag is redundant rather than protective. `[exec]` |
| `apps/forge/bridge-studio.ts:734-808` | project preflight / repo-status / roadmap | `id` is used only as an equality-filter key against server-`readdirSync`-derived ids; it never reaches a `join`. `[read]` |
| `orchestrator/flow-run-requests.ts:77` | `POST /api/hooks/:hookId` | The path's only variable component is read from the matched flow's own `flow.yaml` (operator config), not from the HTTP payload; payload fields are written as JSON *content* only. `[read]` |

### `[unver]` — never claimed safe

- `packages/flows/metrics.ts::summariseCycle` reached from `GET /api/cost/:cycleId` with an unvalidated `cycleId` — downstream fs behaviour not traced.
- `ctx.rerunReflector({cycleId})` at `apps/forge/ui-bridge.ts:2507` — downstream fs behaviour not traced.
- The `brain fix --file <abs>` child process spawned by the KB maintenance route — the child's own path handling not read.
- Hardlink vectors at the KB routes: the guidance leaf filename is timestamp-generated (unguessable to pre-plant) and the only fixed-name write requires its parent not to pre-exist. Recorded **unverified-as-inapplicable**, not safe.
- `orchestrator/kb-health.ts` shares `resolveKbBrainDir` (now fixed) but is reflector-internal; no HTTP route reaches it today. Flagged for future exposure.
- Whether a symlink can be planted through the HTTP surface **alone** for each "pre-plant" precondition above, versus requiring local checkout access. The structural defects are confirmed by reading; the end-to-end plant-then-exploit chain was established only where marked `[exec]`. `forge-wze`'s urgency rests on R3-07's community-install path making planted third-party content a live vector.
- Whether an HTTP-only chain (no local pre-seeding) exists to plant a `_demo/<sid>/status.json`-shaped FILE — an ordinary file, no symlink required — outside `<forgeRoot>/projects/`, which the SEC-03 Deliverable-B `/demo/`/`/fragment/` re-assessment above depends on for exploitability against content fully outside the forge tree. Checked and ruled out: the demo-builder family's own five write routes (`resolveDemoSessionDir`) and the architect/instructions/project-brain `/start` routes' unguarded `project` param (writes land under a different, hardcoded subdirectory name, never `_demo`). NOT checked against this specific shape: the remaining unguarded writers in this table (`packageDir` install, KB-maintenance `file`).

---

## Table 2 — `orchestrator/`

`orchestrator/` has no HTTP surface of its own; every request-derived path reaches it across the `cli/` → `orchestrator/` boundary. Its sites are therefore listed in Table 1 alongside the route that feeds them, with the `orchestrator/` file named in the `file:line` column. The `orchestrator/`-owned sites are:

| file | sites | class |
|---|---|---|
| `orchestrator/brain-paths.ts` | `resolveKbBrainDir` | **fixed** |
| `orchestrator/kb-graph.ts` | themes / `_raw` / `_guidance` / `INDEX.md` / node-leaf / `listPendingGuidance` / `deleteGuidanceFile` | **fixed** |
| `orchestrator/studio/session-transcript.ts` | `safeReadFileInSession`, `listDirEntries`, `listDirEntriesTyped` (R4-21 T3, BLOCKER-1 fix — `deriveFilePackage`'s recursive `package/` walk) | guarded |
| `orchestrator/studio/hook-library.ts` | `resolveHookScriptPath`; `hookDir` / `hookYamlPath` | guarded; the latter two **fixed at the call sites** |
| `orchestrator/skill-path.ts` | `skillPath` / `skillDir`; **`loadSkillTurnPrompt`'s `readFileSync` (new, R4-23)** | **fixed at the call sites**; the new read is `accidentally-safe`-by-construction — see the R4-23 note below |
| `orchestrator/project-config.ts` | `readAgentInstructionsFile`, `readQualityGateSidecar` | unguarded → `forge-2zz` |
| `orchestrator/studio/skill-library.ts`, `community-install.ts`, `community-index.ts` | package install/read | unguarded → `forge-q80` |
| `orchestrator/requeue-resume.ts`, `flow-artifacts.ts`, `logging.ts` | manifest-carried `worktree_path` / `cycle_id` | **fixed in SEC-02** (`forge-d1f`) |
| `orchestrator/mint-triggered-initiative.ts` | mints a queue manifest from a flow's `project` field (background flow-trigger sweep, fed by `PUT /api/studio/flows/:id`) | **fixed in SEC-03** — previously bypassed `writeManifest` entirely; see "Fixed in SEC-03" above |
| `orchestrator/review-comments.ts`, `enqueue-*.ts`, `project-create.ts` | charset-gated | guarded |
| `packages/agents/agent-dispatch.ts` (`discoverStagedMaterials`) | `readdirSync` on `<logsRoot>/<runId>/materials` — lists staged materials so their references reach the agent prompt. **Supersedes the "no request-derived path" row below for `agent-dispatch.ts`** (R6-04 WI-1). `runId` is server-minted (`_agent-<slug>-<stamp>`, from a `SAFE_AGENT_SLUG_RE`-validated slug) and `logsRoot` is config-derived, so nothing request-supplied reaches this call site; read-only listing, errno discriminated (ENOENT silent, anything else surfaced) rather than swallowed. | guarded `[exec]` |
| `orchestrator/studio/connection-library.ts`, `daemon.ts`, `agent-dispatch.ts` | — | no request-derived path reaches a filesystem call |
| `packages/kernel/studio-object.ts` (the generic studio-object loader, M4-agents §4) | `readFileSync` ×2 — `readFrontmatter` and `loadStudioObject`, the two reads that shape a frontmatter document | **RELOCATED, not new.** Both reads moved VERBATIM out of `orchestrator/studio/registry.ts`'s Agent kind when the loaders were split out of the registry module; the guard reports them as `packages/kernel/studio-object.ts readFileSync 0 -> 2` alongside the matching non-failing `tighten: orchestrator/studio/registry.ts readFileSync 2 -> 0`, which is the same two sinks under a new file key. Same callers and the same trust chain as before the move: `listAgentDefinitions(skillsDir)` walks `listSkillMdDirs`, a readdir enumeration, and appends the literal `SKILL.md`; `loadAgentDefinition(skillMdPath)` is handed a slug-resolved path by surfaces that guard the slug upstream. The loader itself folds nothing into the path — it reads exactly the string it is given — so the containment question is unchanged and lives with each caller, as it did in the registry. Note the guard fails only on the GROWTH half and reports the SHRINK as a non-failing tightenable line, so reading the failure list alone would accept a baseline in which these two sinks appear twice. |
| `packages/agents/spawn-marker.ts` (the per-run spawn marker, bead `forge-8vfn.5.50`) | `readdirSync('/proc')` + `statSync('/proc/<pid>')` + `readFileSync('/proc/<pid>/environ')` — the marker sweep that finds a process this run spawned; `mkdirSync(<logsRoot>/<runId>)` + `appendFileSync(<logsRoot>/<runId>/agent-run.marker)` + `readFileSync` of the same leaf — the run's own record of its token | no request-derived path reaches these sinks. The three `/proc` paths are built from INTEGER pids the module enumerated from `/proc` itself (`/^\d+$/`-filtered, `Number.parseInt`ed) or from an injected test seam — no caller-supplied string is ever folded into them, and the sweep is keyed on uid + a whole `FORGE_AGENT_RUN_MARKER=<token>` environ entry, never on a name or argv pattern (COMMON §15.17). The marker file's path is `resolve(logsRoot, runId)` + a FIXED leaf, with `logsRoot` config-derived and `runId` re-checked by `isSafeRunId` INSIDE `recordRunMarker` — defence in depth over `runAgent`'s own `assertSafeRunId`, so the write does not inherit its containment from its caller (COMMON §15.19); an unsafe id is refused before any I/O, pinned by `packages/agents/spawn-marker.test.ts`. The read (`readRunMarker`) takes a directory the caller enumerated and appends the same fixed leaf; it never throws, because it runs inside the story reaper's teardown. The directory is created because a `lifecycle: 'caller'` run injects its own logger, so nothing else has necessarily made `<logsRoot>/<runId>`; the file is APPENDED because several `runAgent` calls legitimately share one run directory (a cycle's PM and reflector both pass `runId: cycleId`) and overwriting would retire the earlier phase's token while its children were alive. `scripts/check-request-path-sinks.mjs` flagged all five as new (`readdirSync` 0→1, `readFileSync` 0→2, `statSync` 0→1, `mkdirSync` 0→1, `appendFileSync` 0→1) the moment the module became reachable from the bridge through `run-agent.ts`. |
| `orchestrator/daemon.ts` (`markStopping`, W7-FIX-A3 A3-07) | `mkdirSync(<forgeRoot>/_logs/daemon)` + `writeFileSync(<forgeRoot>/_logs/daemon/stopping, String(pid))` — the stop marker `daemonState` folds into `stopping:true` while the signalled pid is alive | no request-derived path reaches these sinks. Both paths come from `daemonPaths(forgeRoot)`: the config-derived `forgeRoot` joined with FIXED literal segments (`_logs`, `daemon`, `stopping`); the written CONTENT is the pid read back from the trusted pid file (`readPid`), never a request field. Reachable from `POST /api/scheduler/stop` (`apps/forge/ui-bridge.ts`), which passes the server-configured `ctx.forgeRoot`, never a body/query value. `scripts/check-request-path-sinks.mjs` flagged the grown `mkdirSync`/`writeFileSync` counts (3→4, 2→3); same shape as the pre-existing pid-file sinks in this module. |
| `apps/forge/bridge-studio.ts` (the phase-log route's literal-id probe, W7-FIX-A3 round-2 finding 11) | `existsSync(<logsRoot>/<runId>/events.jsonl)` — decides whether the id has its OWN log dir, so the `findRun` queue walk (which re-parses the active run's event log, refetched per WebSocket event) is skipped | unguarded `[read]`, accidentally-safe on containment: the probed value is the SAME lexically resolved path the pre-existing `eventsPath` sinks on this route use, and its `startsWith(safeLogsBase + sep)` containment check runs in the same `&&` expression BEFORE the probe. Boolean only — no bytes flow through it (the read below is the pre-existing `readFileSync(eventsPath)`), and it discloses nothing a caller could not already learn from this route's own 404. It inherits the SAME disclosed residual as its siblings — a lexical check is symlink-blind under `_logs/` (bd `forge-2zz`) — and adds no new class. `scripts/check-request-path-sinks.mjs` flagged the grown `existsSync` count (9 -> 10).  **SUPERSEDED — W8-C2a (bead `forge-2zz`): this sink no longer exists.** The literal-id `existsSync` probe was replaced by `literalGuard.exists` when the route moved onto `resolveGuardedPath`, so the "accidentally-safe on containment" argument above is now moot rather than merely improved — there is no lexical check left to be symlink-blind. The performance behaviour the row exists to explain is preserved: the guard resolves the literal id FIRST and `findRun` still runs only when that misses. This row's `scripts/check-raw-fs-guarded.mjs` allowlist entry was deleted, not remapped. |
| `orchestrator/run-model-derive.ts` (`deriveArtifacts`'s verdict probe, W7-B7 artifact-plan-11) | `existsSync(<logDir>/artifacts/verdict.json)` — decides whether the run's verdict artifact exists (the trail chip + `artifactsReady['verdict']`) | unguarded `[read]`, accidentally-safe on containment: `logDir` is the SAME `join(logsRoot, <cycleId>)` value every pre-existing sink in this function already probes (`PLAN.html`, `work-items-snapshot/`, `pr-description.md`, `demo.json` — seven sibling `existsSync` calls, all in the baseline), joined with two FIXED literal segments (`artifacts`, `verdict.json`). Boolean only — no bytes flow (the verdict body is served by the separately guarded `/api/artifact` route via `guardedReadFile`). It inherits the same disclosed residual as its siblings — the cycle-id path is lexical, symlink-blind under `_logs/` — and adds no new class. `scripts/check-request-path-sinks.mjs` flagged the grown `existsSync` count (7 -> 8). |
| `orchestrator/daemon.ts` (`clearStoppingMarker`, W7-FIX-A3 round-2 finding 9) | `rmSync(<forgeRoot>/_logs/daemon/stopping)` — drops the stop marker whenever a pid file is written (`writePidFile`, i.e. every `spawnServeDetached`) or cleared (`clearPidFile`), so a reused pid can never inherit a finished drain | no request-derived path reaches this sink. The path comes from `daemonPaths(forgeRoot)`: the config-derived `forgeRoot` joined with FIXED literal segments (`_logs`, `daemon`, `stopping`) — identical to the `markStopping` row above, and the call takes no argument but `forgeRoot`. Reachable from `POST /api/scheduler/start` / `/stop` (`apps/forge/ui-bridge.ts`), both passing the server-configured `ctx.forgeRoot`, never a body/query value; existence-checked then removed inside a `try` (best-effort, never throws into the route). `scripts/check-request-path-sinks.mjs` flagged the grown `existsSync` + `rmSync` counts (6 -> 7, 3 -> 4) — the probe and the removal, both on that one fixed path; same shape as the pre-existing pid-file/pause-flag sinks in this module. |
| `orchestrator/studio/registry.ts` (`communitySkillsFromRegistry`'s `existsSync`, W6-CR-1) | `existsSync` on `<forgeRoot>/studio/community/registry.yaml` | no request-derived path reaches this sink. `communityRegistryPath(forgeRoot)` joins the config-derived `forgeRoot` with three FIXED literal segments (`studio`, `community`, `registry.yaml`) — no request/caller-supplied id or name is ever folded in. Reachable from two bridge routes (`GET /api/studio/community/...` via `packages/library/bridge-studio-community.ts`, `GET /api/studio/catalog` via `apps/forge/bridge-studio.ts`), both calling it with the SAME server-configured `forgeRoot`, never a request field. `scripts/check-request-path-sinks.mjs` flagged this as a new/grown `existsSync` count in this file (baseline `1` -> `2`) the moment a second bridge route (`bridge-studio.ts`) started reaching the already-existing W6-CR-1 registry loader; the sink itself is unchanged, only its reachable-caller count grew. |
| `orchestrator/finalize-merged.ts` | manifest-carried `worktree_path` / `project_repo_path` / `cycle_id` → `confirmMerge`, `pendingFixWorkItems`, `createLogger`, `writeVerdictJson`, `CycleInput` | **fixed in SEC-02**. This row previously read "no request-derived path reaches a filesystem call" and was WRONG: the merge-confirmation sweep reads all three fields off a `ready-for-review/` manifest into the same sinks as the verdict handler, from a different entry point. |
| `orchestrator/drain-fix-loop.ts` | manifest-carried `worktree_path` / `project_repo_path` / `cycle_id` → `spawnSync(git, {cwd})`, `pendingFixWorkItems`, `createLogger`, and a full `CycleInput` re-entering `runCycle({resumeFrom:'develop'})` | **fixed in SEC-02**. Absent from this table entirely until the entry-point sweep found it. The worst instance in the WI: an unattended daemon sweep re-running a whole cycle (dev-loop, PM, demo, adversarial-review) against an attacker-chosen worktree and repo path. |
| `orchestrator/flow-run-requests.ts` | `drainFlowRunRequests`'s `rmSync(path, …)` calls in its skip branches (`skipped-malformed` / `skipped-no-initiative` / `skipped-concurrency`, and **`skipped-out-of-scope`, added R2-08-F1** — the new per-project trigger-scoping skip) | no request-derived path reaches this sink. `path` in every one of these branches is the literal file path returned by `listFlowRunRequests`'s own `readdirSync(flowRunsDir(queueRoot))` enumeration — it is never built by concatenating `req.target.ref`, `req.eventProject`, `req.projects`, `req.triggeredBy`, or any other request/trigger-carried field into a path. The R2-08-F1 out-of-scope check itself is a pure string-identity comparison (`req.projects.includes(req.eventProject)`) with no path construction at all — the fifth `rmSync` call is the same shape as the four pre-existing sibling calls, not a new kind of site. (The row above at `orchestrator/flow-run-requests.ts:77`, in Table 1, covers the DIFFERENT `writeFileSync` call in `stageFlowRunRequest` — that one does have a request-adjacent path component, the target flow's own `flow.yaml`-declared ref, and is classified `accidentally-safe` there.) |

**Root-folding: zero instances.** Every `resolveGuardedPath` call site — the five from R2-09 and the nine added by this sweep — passes a fixed, config-derived `root` and puts each untrusted id in `segments[]`. This was verified call site by call site as a named review checklist line, because the two forms differ by one pair of brackets and only one is safe.

---

## Later sweeps — rows added after the original tables

### Extended in M2 — the `@forge/kernel` move, and the sinks it made VISIBLE

The M2 kernel quarry moved five modules out of `cli/` and `orchestrator/` into
`packages/kernel/`, and taught this lint's walker two new things: `packages/`
and `apps/` are inside `WALK_ALLOWED_PREFIXES`, and a `@forge/<pkg>` bare
specifier resolves to `packages/<pkg>/index.ts`.

**Why the walker had to learn that.** The only edge from the legacy trees into a
package is `orchestrator/_pkg/<pkg>.ts`, which re-exports a BARE specifier. The
walker followed relative specifiers only, so it stopped dead at the shim. The
measured consequence: `packages/kernel/path-guard.ts` — the containment guard this
lint exists to backstop — moved to `packages/kernel/path-guard.ts`, its six raw
fs sinks silently became `tighten … -> 0` rows, and **both this ratchet and
`check-raw-fs-guarded.mjs` went on reporting PASS with the guard entirely
outside their universe**. A lint that loses sight of its subject when the
subject moves is worse than no lint, because it still says green.

**Eleven rows are a rename and nothing more** — same file, same sinks, same
counts, new path: `packages/kernel/path-guard.ts` → `packages/kernel/path-guard.ts`
(6), `packages/kernel/config.ts` → `packages/kernel/config.ts` (2),
`packages/kernel/logging.ts` → `packages/kernel/logging.ts` (3). Re-keyed rather
than `--write`-accepted, so the debt keeps its history.

**Four rows are genuinely new to this lint, and none is request-derived.**
`packages/kernel/init.ts` (`execSync` 1, `existsSync` 2, `mkdirSync` 1,
`writeFileSync` 1) had **no** baseline rows before, because it was not reachable
from any request-handling entry. It is reachable now only because
`packages/kernel/index.ts` is a barrel and `orchestrator/_pkg/kernel.ts`
re-exports it wholesale, so any reachable legacy module that wanted `logging`
now drags `init` into the static reachable set. The reachability is an
over-approximation; the sinks themselves are not request-derived:

- **`runInit(root)` has exactly one caller** — `apps/forge/cli.ts:176`, which
  passes the module constant `FORGE_ROOT`. No route, no handler, and no
  request-derived value reaches it.
- **`execSync('gh auth status', { stdio: 'ignore' })`** is a fixed literal with
  no interpolation of any kind.
- **`mkdirSync` / `existsSync` / `writeFileSync`** operate on `layoutDirs(root)`
  and `join(root, 'forge.config.json')` — literal leaf names under that same
  constant root.

Classification: **accidentally-safe by call-site, not by guard** — the accident
named explicitly, per this document's own rule. If `runInit` ever gains a
second caller that passes a request-derived root, every one of these four
becomes live and must be guarded; that is the precondition to watch.

### Extended in R4-19-F2 — the two new brain-lint checks (`[read]`)

R4-19-F2 added `checkDanglingEdges` and `checkDuplicateThemes` to
`packages/knowledge/brain-lint.ts` (see `FULL_SCOPE_CHECKS`). Both grew the sink counts the
ratchet tracks for that file — `existsSync` 19 → 21 and `readdirSync` 8 → 10,
`--write`-accepted below — and **neither new site is request-derived**:

- **`collectAllThemeSlugs(brainRoot)`** builds the slug universe a
  `related_themes` entry is resolved against. Its root is the FIXED
  `join(forgeRoot, 'brain')`; the segments beneath it are either literals
  (`THEME_SUBDIRS` × `themes`, `projects`) or directory names enumerated by
  `readdirSync` from the filesystem itself. No caller-supplied value reaches a
  path here, and nothing is written — the function only reads directory entries
  and keeps their basenames. This is the identical shape (fixed `brain/` root +
  `readdirSync`-enumerated project dir names + literal leaves) already audited
  for `checkProjectBrainIndexes` in the R1-06 section above.
- **The `related_themes` entries themselves are never used as paths.** An entry
  is normalised to a bare slug and tested for MEMBERSHIP in the pre-computed
  slug `Set` — it is never joined onto a root, never `resolve`d, and never
  opened. A theme file carrying `related_themes: ['../../etc/passwd']` therefore
  produces an ordinary dangling-edge FLAG, not a filesystem access. That is the
  containment property to preserve: if a future change ever resolves an entry to
  a path in order to report a better fix hint, it becomes a genuine
  theme-content-derived sink and needs `resolveGuardedPath` plus its own row here.
- **`duplicateThemeFindings` performs no filesystem access of its own** — it is a
  pure function over an already-read file list and its parsed frontmatter.

The per-KB entry point, `lintThemeFiles(forgeRoot, files)`, now emits both checks
over a caller-supplied file list. That list reaches it from
`buildKbHealth`/the consolidate drain via `listOwnThemeFiles(brainDir)`, where
`brainDir` is `resolveKbBrainDir(forgeRoot, kbId)`'s output — the per-segment
realpath-identity walk, not a lexical prefix check — so the request-derived `kbId`
is already confined at that choke point before any theme file is read.

---

### M4-library PR 2 — three baseline rows RE-KEYED, no new sink surface

The skill-path module was split three ways and the child-env seam moved to
kernel. Three `(file, sink)` rows changed path and nothing else: the code, the
guard in front of it and the call count are byte-identical either side.

| was | is now | sink | why it moved |
|---|---|---|---|
| `packages/agents/skill-path.ts` | `packages/library/skill-path.ts` | `existsSync` 1, `readdirSync` 1 | the `skills/` tree walk (`listSkillMdDirs`) is the Skill kind's layout, which spec §3.1 gives library; `agents` (rank 3) may import library (rank 2), never the reverse |
| `packages/projects/project-create.ts` (`readdirSync` 3) | `packages/kernel/config.ts` (`readdirSync` 1) + `project-create.ts` (`readdirSync` 2) | `readdirSync` | `listProjectStarters` is a layout fact beside `resolveProjectsDir`; `packages/library/studio/template-library.ts` surfaces project scaffolds as a template kind and may not import projects (SAME rank is a violation, `b >= a`) |

**The proof that this is a re-key and not growth is the guard's own total: 1,340
sink calls before and 1,340 after.** `(file, sink)` rows go 513 → 514 and the
baseline file 516 → 517 lines, both because one `readdirSync` site separated
from two siblings into its own file. Accepted by hand-editing the four affected
lines, NOT by `--write`: bead `forge-8vfn.5.19` records that `--write` harvests
unrelated baseline slack, and five tightenable lines belonging to other lanes
(`packages/flows/fix-work-items.ts`, `packages/knowledge/brain-lint.ts`) were
deliberately left un-harvested.

The guard classification is unchanged and is restated here rather than assumed:
every one of these sites resolves a path from a **slug-validated** id —
`assertSkillSlug` refuses `/`, `\`, `.`, `..`, the empty string and anything
over 100 characters before a join happens — and the walk sites take a
**directory** argument that is composed from a fixed root, never from request
bytes. `assertSkillSlug` itself moved to `@forge/kernel/ids.ts` in the same PR;
`packages/kernel/ids.test.ts` pins which shapes it rejects, so the move cannot
quietly widen it.

### R4-23 — `loadSkillTurnPrompt`'s `readFileSync` (`orchestrator/skill-path.ts`)

R4-23 consolidated the four legacy interactive runners' private `loadSkillPrompt`
helpers into one shared, fail-loud loader in `orchestrator/skill-path.ts`. That
moved a `readFileSync` FROM those runner files INTO this one, so
`check-request-path-sinks` reports `orchestrator/skill-path.ts readFileSync:
baseline 0 -> now 1` alongside `tighten` rows removing the same sink from
`packages/sessions/instructions-runner.ts` and its siblings. It is a relocation, not
new surface, and the baseline is accepted on that basis.

Classification: **no request-derived path reaches this sink.** Two arguments feed
the read and neither is request-supplied:

- `name` — a skill directory slug, and it is `assertSkillSlug`-validated inside
  `skillPath` before any join. That guard is this module's whole reason for
  existing (see the module header): it rejects `.`, `..`, `/`, `\`, the empty
  string and any id over `MAX_SKILL_ID_LENGTH`, so a `name` can never collapse,
  escape, or reach outside `<root>/skills/`. Every call site passes a
  **hardcoded string literal** (`'instructions-creator'`, `'demo-builder'`,
  `'project-brain-builder'`, `'architect'`) — no route, CLI flag, or manifest
  field selects it.
- `skillPromptPath` — the pre-existing test/DI seam every runner already carried
  on its own `RunXTurnInput` type. Its only non-test callers are the runners
  themselves, which never populate it in production; the golden-capture harness
  and the per-runner suites point it at their own `mkdtemp` fixture files.

`root` defaults to this module's own `FORGE_ROOT` and is never fed an untrusted
id (no root-folding). The read is therefore of the same class as the existing
`skillPath`/`skillDir` row above: contained by the slug guard at the one
resolution point, with the leaf a fixed literal (`SKILL.md`).

Residual, disclosed rather than claimed away: like every other read in this
family the loader is **symlink-blind** — a symlinked `skills/<name>/SKILL.md`
inside a checkout would be followed. Planting it requires write access to the
forge repo itself, which is strictly more privilege than the read grants, and it
is the same residual the pre-R4-23 per-runner `readFileSync` calls carried. The
one behavioural change is in the opposite direction from a weakening: those
helpers **failed open** on an unreadable file (returning a one-line default
prompt); the shared loader throws.

---

### W6-P2 — `statWalkFingerprint`'s `readdirSync`/`statSync` (`packages/knowledge/kb-lint-summary.ts`, `[read]`)

W6-P2 (ADR 044, read-path memoization) added `statWalkFingerprint(forgeRoot)` to
`packages/knowledge/kb-lint-summary.ts`, memoizing `runBrainLint({ scope: 'full' })` behind a
cheap stat-walk key. `check-request-path-sinks` reports `packages/knowledge/kb-lint-summary.ts
readdirSync: baseline 0 -> now 1` and `statSync: baseline 0 -> now 1`,
`--write`-accepted below.

**Round 2 (reviewer-flagged, same day):** the first version walked only
`brain/` and `_queue/done/`, matching `checkStaleness`'s 4-prefix allowlist
(`docs/`/`orchestrator/`/`skills/`/`loops/`) but missing that
`checkSourceLinks` (`packages/knowledge/brain-lint.ts:513`) resolves a theme's relative
markdown-link targets (`resolve(dirname(themeFile), relLink)`) with NO prefix
filter at all — real theme content today already climbs `../../../` out of
`brain/cycles/themes/` to cite `PRINCIPLES.md`, `ARCHITECTURE.md`, `cli/`,
`docs/`, `forge-ui/`, `orchestrator/`, `scripts/`, and `.github/` (grep-
verified). That domain is unbounded by design — a theme author can cite any
relative path — so a curated root list is provably incomplete and would rot
the next time a theme cites a new top-level path `checkSourceLinks` can
already resolve today. `statWalkFingerprint` now walks `forgeRoot` itself
(see the completeness table in its own doc comment, packages/knowledge/kb-lint-summary.ts,
for the per-check enumeration this is derived from), skipping only:
`node_modules`/`.git` (anywhere, dir or file), and the top-level
`_logs`/`projects`/`.forge` plus `_queue`'s non-`done` siblings (gitignored
runtime/managed-project state no check reads and that grows without bound
over a campaign). Measured at ~2200 files, ~11ms median.

Classification: **no request-derived path reaches either sink.**
`statWalkFingerprint` takes exactly one argument, `forgeRoot` — the same
trusted, server-configured root every other function in this file already
receives; no caller (`attachKbLintSummaries`, `runBrainConsolidateNow`,
`buildKbHealth`, `computeAgentCleanupFindings`, or the `POST
/api/studio/kbs/:id/maintenance` `op:'lint'` branch) ever threads a request-
derived id, kbId, or file path into it. `forgeRoot` itself is the only literal
root; every path below it is built by recursing into names `readdirSync`
itself enumerates from the filesystem, never from caller input, filtered
through a fixed, hardcoded exclude-list — not through anything request- or
theme-content-derived. This is the identical shape already audited for
`collectAllThemeSlugs` in the R4-19-F2 section above (fixed root +
`readdirSync`-enumerated names + no caller-supplied segment), one level more
contained even: unlike `buildKbHealth`/`computeAgentCleanupFindings`, which
resolve a request-derived `kbId` through `resolveKbBrainDir`'s realpath choke
point before reading anything, `statWalkFingerprint` never receives a `kbId`
at all — walking wider (whole-forgeRoot vs. brain/-only) does not change WHO
can influence WHICH path gets walked, which stays "nobody, ever."

`runBrainLintFullFresh` (added same round, W6-P2 round 2 — the
`runBrainConsolidateNow` post-mutation re-lint reviewer-flagged separately)
calls the exact same `statWalkFingerprint`/`runBrainLint` pair as
`runBrainLintFullMemoized`, just unconditionally — no new sink, no new
classification needed.

Residual, disclosed rather than claimed away: symlink-blind, same as every
other whole-tree walk in this family (`readThemeFiles`,
`collectAllThemeSlugs`) — a symlinked directory anywhere under the walked
tree would be walked if `entry.isDirectory()` reported it as one (it does
not: `Dirent.isDirectory()` reflects the link itself under `withFileTypes`,
not its target, so a symlinked directory is simply skipped, narrower than the
residual it mirrors rather than wider). Everything under `forgeRoot` this
walk now reaches (`docs/`, `orchestrator/`, `cli/`, `scripts/`, `.github/`,
top-level files, etc.) is read-only here (never written) and is either
checked-in repo content or the same gitignored, operator-owned `_queue/done/`
content `checkReflectorLoss` (`packages/knowledge/brain-lint.ts`) already reads unguarded
today — no new trust boundary is crossed, only a wider READ of the same
trust class.

---

### W6-P3 — the production-build freshness scan (`apps/forge/forge-watch.ts`)

W6-P3 made `forge studio` serve a production Next.js build (`next build` once,
skipped when the existing output is already fresh, then `next start`) by
default instead of `next dev`; `--dev` keeps the previous path. This grew the
sink counts the ratchet tracks for `apps/forge/forge-watch.ts` — `readdirSync` 0 → 1,
`statSync` 0 → 2, `spawn` 2 → 4 (`--write`-accepted alongside this entry).
**None of the four new call sites is request-derived:**

- **`scanNewestSourceMtime`/`newestMtimeMs`** (`readdirSync` ×1, `statSync` ×1
  in the recursive walk) stat the forge-ui workspace's own source tree. Every
  path scanned is built from a FIXED root — `uiDir`, itself
  `resolve(forgeRoot, 'forge-ui')`, where `forgeRoot` is the CLI's own install
  root (`apps/forge/cli.ts`'s `FORGE_ROOT`, resolved from `import.meta.dirname`
  at process start — never a request/HTTP input) — plus a small, literal set of
  subpath names (`app`, `components`, `lib`, `package.json`,
  `next.config.mjs`). No caller-supplied value reaches any path built here; the
  walk only follows entries the filesystem itself enumerates beneath that fixed
  root — the identical shape already audited for `collectAllThemeSlugs` in the
  R4-19-F2 section above.
- **`readBuildStampMs`** (`statSync` ×1 as of the initial cut) reads the mtime of
  `resolve(uiDir, '.next', 'BUILD_ID')` — the same fixed `uiDir` root plus two
  literal path segments. No request-derived input reaches it.
- **The two new `spawn` calls** (`next build`'s child on a stale/missing build,
  `next start`'s child on the default production path) run
  `npm run {build,start} --workspace forge-ui [-- -p <uiPort>]` via the pure,
  unit-tested `buildUiSpawnArgs`/`startUiSpawnArgs`. `uiPort` is `forge
  studio`'s own `--ui-port` CLI flag — an operator-typed argv value on their
  own machine at process-launch time, the identical shape as the pre-existing
  `next dev` spawn already in the baseline — never an HTTP request field; the
  rest of the argv is a literal string array.

**Why this file is walked at all despite carrying no bridge-reachable runtime
code:** `apps/forge/ui-bridge.ts` imports only a **type** from it
(`import type { BridgeIdentity } from './forge-watch.ts'`). The ratchet's
reachability walker is a line-based import scanner that does not distinguish
`import type` from a value import (a documented limit — see "What it provably
cannot do" above), so it treats the type-only edge as a reachability edge.
There is no runtime call path from any bridge route into `apps/forge/forge-watch.ts`
— it is the foreground `forge studio` launcher itself, never spawned by nor
reachable from the bridge process.

**Extended, same day (round 2 review fix) — `readFileSync` 0 → 1, `rmSync`
0 → 1, `writeFileSync` 1 → 2, `statSync` 2 → 1 (a tighten — never fails —
`--write`-accepted alongside this entry).** Round 1's `readBuildStampMs`
trusted `.next/BUILD_ID`'s own mtime as the freshness stamp; review found
that unsound — `next build` writes `BUILD_ID` roughly two-thirds through its
pipeline, before static generation/export finishes, so a build that fails
LATE still leaves a fresh-looking stamp over broken/incomplete output. The
fix replaces it with forge's OWN stamp file, changing which sinks the three
stamp functions use — same fixed-root shape, same "no request-derived input"
conclusion, restated per-function:

- **`readBuildStampMs`** (now `readFileSync` ×1, `statSync` no longer used
  here) reads `resolve(uiDir, '.next', 'FORGE_BUILD_OK')` — the same fixed
  `uiDir` root plus two literal path segments as the row above; only the sink
  changed (mtime read → content read), not the path shape.
- **`clearBuildStamp`** (`rmSync` ×1, new) deletes that same fixed path,
  called before every build attempt starts.
- **`writeBuildStamp`** (`writeFileSync` ×1, new — the file's second
  `writeFileSync` call site alongside the pre-existing `writeReadyFile`) writes
  to that same fixed path, called only after the build child has exited 0.

All three resolve the identical fixed `<uiDir>/.next/FORGE_BUILD_OK` path —
`uiDir` is `resolve(forgeRoot, 'forge-ui')` as above, never request-derived;
the leaf segments `.next` and `FORGE_BUILD_OK` are literals. No caller-
supplied value reaches any of the three.

### Guarded in W6-CR-3 — `commitRegistryDraft`'s temp+rename commit write

> **RETIRED IN W8-B5b — the three sinks below NO LONGER EXIST.** The
> `community-refresh` agent session kind was retired and its `committing`-phase
> finalizer `commitRegistryDraft` deleted with it; the registry is now written
> by the deterministic, LLM-free `runCommunityRefresh`
> (`packages/library/community-refresh-run.ts`), whose own sinks are audited further down
> this document. **This section is kept, not deleted, on purpose:** an audit
> record is a record of what was examined and what was concluded, and deleting
> it would erase the evidence that these sinks were ever reasoned about — which
> is exactly what a reader checking the ratchet's history needs. Read everything
> below as past tense.

`orchestrator/interactive-finalizers.ts` grew three new tracked sinks
(`writeFileSync` 0→1, `renameSync` 0→1, `unlinkSync` 0→1) — the
`community-refresh` session's `committing`-phase finalizer,
`commitRegistryDraft` (ADR-043 §5), which commits an operator-**approved**
draft of `studio/community/registry.yaml` onto the real file. Reachable from
`cli/bridge-studio-affordances.ts`'s generic verdict route
(`handleCommunityRefreshVerdict`'s `approve` arm, via the dynamically-imported
`runInteractiveTurn` → `resolveFinalizer('commitRegistryDraft')`) — the same
file-level reachability model as the R4-22 WI-2 row above (`interactive-
finalizers.ts` was already ratchet-tracked before this WI; this is new sinks
inside an already-reachable file, not a newly-reachable file).

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `orchestrator/interactive-finalizers.ts` (`commitRegistryDraft`) | `writeFileSync` | none — `tempPath = join(dirname(destPath), '.registry.yaml.tmp-<random>')`, where `destPath = resolveGuardedPath(forgeRoot, ['studio','community','registry.yaml']).realPath`; the random suffix is `randomBytes(6)` generated IN-PROCESS, never request-derived | guarded `[read]` | `dirname(destPath)` is a directory the guard already identity-verified; the leaf filename is a fixed literal prefix plus server-generated entropy, never a caller-supplied string — there is no path segment here an attacker can influence at all. |
| `orchestrator/interactive-finalizers.ts` (`commitRegistryDraft`) | `renameSync` | none — both arguments are `tempPath` (as above) and `destPath` (the same already-guarded `realPath` used throughout the rest of this function, e.g. `draftGuard`/`registryGuard`) | guarded `[read]` | `renameSync` only ever moves the just-written temp file (created by the `writeFileSync` row above, same directory) onto the guard-verified destination — the atomic swap step of a check-then-write-then-atomically-publish sequence, not a caller-influenced path operation. |
| `orchestrator/interactive-finalizers.ts` (`commitRegistryDraft`) | `unlinkSync` | none — `tempPath`, identical to the `writeFileSync` row | guarded `[read]` | Best-effort cleanup ONLY on the `renameSync` failure path (orphaned-temp-file removal); wrapped in its own `try/catch` so a failed cleanup never masks the real error. Same non-request-derived path as the write. |

**Why a temp+rename write here, unlike `copyStagingToLibrary`'s `O_EXCL`
create-only writes above:** `copyStagingToLibrary` installs a package into a
NEW, never-before-existing destination (`O_EXCL` refuses to overwrite
anything). `commitRegistryDraft` REPLACES an EXISTING file — the live
`studio/community/registry.yaml` — so `O_EXCL` is the wrong primitive (it
would refuse the very file this function exists to update); atomic
`rename(2)` over a same-directory temp file is the standard way to replace a
file's contents without ever leaving readers of the real path observing a
partial write, and needs no new containment shape beyond the guard this
function already resolves `destPath` through.

`node scripts/check-request-path-sinks.mjs --write` accepted this delta —
`scripts/request-path-sinks.baseline.txt` now records
`orchestrator/interactive-finalizers.ts` `writeFileSync`/`renameSync`/
`unlinkSync` at 1 each.

### New mechanism, W6-CR-3 review round 2 (bead forge-eip) — the `writeRoots` `canUseTool` fence on interactive agent turns

**Not a raw fs sink — neither `check-request-path-sinks.mjs` nor
`check-raw-fs-guarded.mjs` scans for this, and neither ever will**, so it is
disclosed here by hand rather than by a ratchet delta. Both scripts scan
request-handling TypeScript source for calls into node's own `fs` module;
this mechanism operates one layer up, inside the Claude Agent SDK's OWN
tool-execution permission gate (`options.canUseTool`, invoked by the SDK
itself before a `Write`/`Edit`/`MultiEdit`/`NotebookEdit` tool call ever
reaches whatever `fs` primitive the SDK's own tool implementation uses
internally) — there is no `fs` call site in forge's own source for either
ratchet to find.

**The gap this closes (found live during review, `skills/community-refresh/
SKILL.md`):** a `SKILL.md`'s `allowed-tools`/`disallowed-tools` frontmatter
is a tool-NAME allowlist — it decides which tool NAMES an agent may invoke
at all, never what PATH a permitted tool may target. `community-refresh`
grants `Write` (needed to draft `staging/registry.yaml`) and denies `Edit`;
the SKILL.md's own prose used to claim this meant the agent "has no write
access to `registryPath`/`hubsPath`… `Edit` is not in your tool set" — FALSE:
`Write` alone, with no path restriction at all, can target ANY absolute
path the agent names, including the live `studio/community/registry.yaml`
`registryPath` itself carries verbatim in the turn's own prompt (`buildTurnPrompt`,
`packages/sessions/interactive-runner.ts`, inlines the WHOLE session status as
JSON — `registryPath`/`hubsPath` included). A model steered by untrusted
content it fetches (a WebFetch/WebSearch result telling it to "save a
verified copy directly to the registry") had a real, unfenced path straight
to the live source of truth, bypassing the entire draft/evidence/approve/
commit pipeline this whole session kind exists to enforce.

**The fix — a REAL, per-call fence in the shared spine, not a
community-refresh-specific patch:** `packages/sessions/interactive-session.ts`'s
`runAgentTurn` gained an optional `writeRoots: readonly string[]` parameter.
When supplied (and non-empty), it installs `options.canUseTool` — a
synchronous callback the SDK invokes before every `Write`/`Edit`/
`MultiEdit`/`NotebookEdit` call executes. The callback:

- Passes every OTHER tool through unmodified (never gates reads).
- Extracts the tool's target path (`file_path`/`notebook_path`/`path`,
  mirroring `packages/agents/ralph/claude-agent.ts`'s own `FILE_MODIFYING_TOOLS`/
  `extractPath` — kept as an independent literal, not imported, so this
  spine file's only cross-subsystem edge stays the pre-existing type-only
  one) — a missing/malformed path field is a hard DENY (fail closed).
- Resolves `realpathSync(dirname(candidate))` + the literal basename (the
  file itself may not exist yet — a `Write` creating a new file) and checks
  it lands under one of `writeRoots`' OWN realpath-resolved locations. A
  parent directory that fails to resolve at all is a hard DENY — every
  `writeRoots` entry is pre-provisioned by the caller before the turn
  starts (see below), so a write naming a not-yet-existing intermediate
  directory below an already-provisioned root has no legitimate reason to
  exist.
- `packages/sessions/interactive-runner.ts`'s `runAgentStyleStep` derives
  `writeRoots` from the CURRENT phase row's OWN declared `writes:` entries
  (never a hardcoded `staging` literal — `resolveWriteRoots`), resolving
  each through the SAME `resolveGuardedPath` containment guard every other
  write in that file uses, GUARD-TERMINAL `mkdirSync`'d into existence if
  absent (mirrors `runFinalizeStep`'s own `libraryRootGuard` pattern) — so
  the fence always has a REAL, already-existing root to realpath at turn
  start, never a not-yet-created path a symlink could race into being
  ahead of the agent's very first write.

**Generic, not one-kind-specific:** because this lives in the shared spine
and is DERIVED from each phase row's own `writes:` field, it applies
identically to every `turnSpec`-bearing session kind that reaches
`runAgentStyleStep` — `authoring`'s `staging/`, `kb-cleanup`'s `plan/`, and
`community-refresh`'s `staging/` all get the SAME real, per-call
enforcement from this one change. `writeRoots` is optional and additive
(ADR-042 disclose-not-park: an additive-optional parameter on an exported
function) — every pre-existing caller of `runAgentTurn` that does not pass
it gets byte-identical prior behaviour (no `canUseTool` installed at all).

**Does this reopen ADR 020 ("interactivity is file-based handoff… NOT SDK
`canUseTool` interception")?** No — that ruling is about never using
`canUseTool` to PAUSE a turn for operator interactivity (file-based
handoff, `questions.json`/`answers.json`, owns that). This fence never
pauses anything: it is a synchronous, silent allow/deny decided entirely
from the real filesystem, structurally the same shape as every other
containment guard in this document — not a reopening of that decision, a
different concern the ruling never addressed.

**Tests** (both TDD-first, before the production change was accepted as
correct): `orchestrator/interactive-session.test.ts` pins the pure
`makeWriteRootCanUseTool` factory directly — allows a new file inside the
root, allows an edit to an existing file inside the root, denies a path
outside the root (the `registryPath` shape), denies a symlink-out, denies a
missing path field, passes non-gated tools through, and proves
`runAgentTurn` installs (or, when `writeRoots` is absent, does NOT install)
the callback on the REAL `options` bag a `queryFn` receives.
`orchestrator/interactive-runner.test.ts` adds the integration-shaped
proof: the REAL, checked-in `community-refresh` descriptor drives a full
`runInteractiveTurn`, and the `canUseTool` the run actually built denies a
`Write` to the session's own real `registryPath` while still allowing the
legitimate `staging/` write.

**`check-request-path-sinks.mjs` delta (3 rows, all guarded) — this ratchet
DOES scan the fence's own implementation (it is plain TypeScript calling
`fs`, unlike the SDK-internal execution the fence gates):**

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `orchestrator/interactive-finalizers.ts` (`loadCommunityRefreshEvidence`) | `readFileSync` | `evidencePath`, where `evidencePath = resolveGuardedPath(sessionDir, ['staging','evidence.json']).realPath` — the SAME already-guarded path `commitRegistryDraft` resolves for `registry.yaml` | guarded `[read]` | Identical shape to the existing `registry.yaml` read this file already had — a guard-verified `realPath`, never a fresh join. |
| `packages/sessions/interactive-runner.ts` (`resolveWriteRoots`) | `mkdirSync` | none — `guarded.realPath`, where `guarded = resolveGuardedPath(sessionDir, [dirName])`; `dirName` is a phase row's OWN declared `writes:` entry (forge-authored `studio/session-kinds.yaml` data, never request data) | guarded `[read]` | GUARD-TERMINAL create: mirrors `runFinalizeStep`'s pre-existing `libraryRootGuard` mkdir exactly — only creates the already-guard-verified `realPath`, only when it does not exist yet (a session's `staging/`/`plan/` before the agent's first write). |
| `packages/sessions/interactive-session.ts` (`isUnderWriteRoot`) | `realpathSync` | `dirname(candidatePath)`, where `candidatePath` is the GATED tool's own input (`file_path`/`notebook_path`/`path`) — request/model-derived, but resolved for IDENTITY, never used to build a write path directly (the resolved result is only ever COMPARED against `realWriteRoots`, never opened) | guarded `[read]` | This IS the containment check itself — a `realpathSync` failure (ENOENT/ELOOP/permission) is treated as a hard DENY (see the mechanism write-up above), never as "not created yet, allow it". No write happens through this call; it is read-only identity resolution feeding a boolean decision. |
| `packages/sessions/interactive-session.ts` (`makeWriteRootCanUseTool`) | `realpathSync` | `root`, one of the CALLER-supplied `writeRoots` (trusted, already-guard-verified by `resolveWriteRoots` above — never request data at this layer) | guarded `[read]` | Resolved ONCE per turn, at fence-construction time, purely to pin the comparison baseline `isUnderWriteRoot` checks candidates against; a root that fails to resolve here is dropped from the effective allow-set (fail that ONE root closed), never treated as a reason to skip the check entirely. |

`node scripts/check-request-path-sinks.mjs --write` accepted this delta —
`scripts/request-path-sinks.baseline.txt` now also records
`orchestrator/interactive-finalizers.ts` `readFileSync` at 1,
`packages/sessions/interactive-runner.ts` `mkdirSync` at 2 (up from 1 — the
pre-existing `libraryRootGuard` row plus this new one), and
`packages/sessions/interactive-session.ts` `realpathSync` at 2.

### Guarded in W6-B14 — two reattach-discovery GET routes (close-the-fragile-poll-loop batch)

Two new `[exec]` sinks, both routed through `resolveGuardedPath`/`guardedReadDir`
from the outset (no unguarded-then-fixed round for either — new code, not a
retrofit):

- **`packages/knowledge/bridge-studio-kbs.ts` — `GET /api/studio/kbs/:id/consolidate/active`
  (`mkdirSync` ×1, `check-request-path-sinks.mjs` baseline 6 → 7 for this
  file).** The `op=consolidate` maintenance branch now stakes out its run's
  log dir *synchronously*, before the fire-and-forget `runBrainConsolidateNow`
  call: `` resolveGuardedPath(ctx.forgeRoot, ['_logs', `_brainfix-${runId}`]) ``,
  `mkdirSync(guarded.realPath, {recursive:true})` only if `guarded.ok`. `runId`
  is `${kbId}-consolidate-${Date.now().toString(36)}` — `kbId` is `SLUG_RE`-
  gated a few lines above (so the compound name cannot itself carry a `/`),
  but the whole string is still request-derived text, hence routed through the
  guard rather than trusted by construction the way `spawnBrainFix`'s sibling
  `mkdirSync(logDir, ...)` a few lines above already is (that one predates
  this guard's introduction and is a pre-existing, separately-audited row).
  Without this, `GET .../consolidate/active` (the new discovery route itself,
  below) could not see a just-dispatched run for the whole window before
  `runBrainConsolidateNow` reaches its own terminal write — a client that
  dispatched, then immediately reloaded, would see "no run" instead of
  "watching".
- **`apps/forge/ui-bridge.ts` — `GET /api/studio/projects/:id/onboarding/active`**
  (new route; reads via `guardedReadDir`, `existsSync`/`readdirSync` counts
  unchanged in the baseline since neither raw sink is called). Reattach
  discovery for `OnboardWithAgent` (forge-ui): finds a project's most recent
  `_onboarding/<sessionId>` and reads its `status.json` back. `project` is
  request-derived (a URL path segment); `_onboarding` is a fixed literal, but
  — per this doc's own established reasoning for the SAME directory's WRITE
  side (`writeOnboardingSession`'s guard, "Guarded in R4-17" section above) —
  a `_onboarding` entry beneath an otherwise-contained project dir is still
  attacker-supplied content (a checked-out repo can commit a symlink named
  `_onboarding`), so the LISTING is routed through `guardedReadDir(ctx.
  projectsRoot, [project, '_onboarding'])` rather than a raw `existsSync`+
  `readdirSync` off `join(realProjectDir, '_onboarding')` (the shape this
  route's first draft used, caught by `check-raw-fs-guarded`/
  `check-request-path-sinks`/the two `projects-root-fold-*` scanners before
  landing). Each candidate `sessionId` is then read via the pre-existing
  `guardedReadSessionStatus(projectsRoot, [project, '_onboarding', sessionId])`
  — the SAME choke point `listInstructionsSessions`'s per-session reads
  already use, unchanged by this addition.

`scripts/request-path-sinks.baseline.txt` regenerated (`--write`) for the
`packages/knowledge/bridge-studio-kbs.ts` `mkdirSync` count only — the `apps/forge/ui-bridge.ts`
addition introduces a new *route*, not a new raw sink (both its fs calls go
through the guard).

### W7-FIX-A2 — sticky cancel + the Bash fence (three new `[read]`-class sinks, all guarded)

Post-land sweep fixes to W7-A2 (findings W7A2-01/03/08 in
`_wave7/lanes/review-sweep-A2.json`). `check-request-path-sinks.mjs` delta
(3 rows, all guarded):

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/sessions/bridge-studio-lifecycle.ts` (`guardedReadFileTail`) | `openSync` + `readSync` (+ a second `statSync`) | none — `guarded.realPath`, where `guarded = resolveGuardedPath(logsRoot, ['_<kind>-<sid>', 'stderr.log'])`; the request-derived `kind`/`sessionId` are their OWN `segments[]` elements exactly as the sibling `guardedReadFile` call this replaces (W7A2-08: only the LAST `STDERR_TAIL_BYTES` are read, per index row per poll, instead of the whole file) | guarded `[read]` | The `openSync`/`statSync`/`readSync` trio operates on the guard's OWN output (`realPath` — nothing but a `PathGuardOk` carries that field); a rejected or absent path returns `null` before any fd is opened; the fd is closed in `finally`. Same containment as the `guardedMtime` row above (W7-A2). Verified `[exec]` by `packages/sessions/tests/integration/bridge-studio-lifecycle.test.ts` (the operator's crashed fixtures still surface the runner's last non-stack line; the AT-47 symlinked-session-dir shape still 404s). |
| `orchestrator/bash-fence.ts` (`realish`) | `realpathSync` | the resolved candidate of a `Bash` tool call's OWN command text — a redirection target / write-utility operand / `dd of=` / `cd` operand (model-derived, request-shaped), resolved for IDENTITY only: walked up to its deepest EXISTING ancestor's realpath + the literal remainder, then COMPARED against the turn's already-realpath'd `writeRoots`; never opened, never written through | guarded `[read]` | This IS the Bash half of the write-root containment check (bead forge-w08 — the sibling of `isUnderWriteRoot`'s row above): a `realpathSync` that fails all the way to the filesystem root yields `null` → DENY. Only reachable when a fenced kind opts into `turnSpec.bashFence: inspect` (`authoring` today); every other fenced kind denies Bash outright and never reaches this sink. Verified `[exec]` by `orchestrator/bash-fence.test.ts` (an in-root symlink to an outside dir cannot be written through; relative escapes and normalised traversal are denied; the REAL `authoring` descriptor through `runInteractiveTurn` denies an out-of-root `printf > file`). |

`node scripts/check-request-path-sinks.mjs --write` accepted this delta —
`scripts/request-path-sinks.baseline.txt` now records
`packages/sessions/bridge-studio-lifecycle.ts` `openSync` at 1 and `statSync` at 2, and
`orchestrator/bash-fence.ts` `realpathSync` at 1.

Also in this lane, not a sink change: `guardedWriteSessionStatus`
(`packages/sessions/interactive-session.ts`) — the ONE session-status write seam
— now refuses (returns `null`, file byte-unchanged) any write that would
move an on-disk `cancelled` phase to a different phase (`cancelledPhaseWins`,
W7A2-01); `packages/agents/agent-run.ts`'s `writeSessionTerminalPhase` rides that seam
instead of `guardedWriteFile` (same guard, plus the sticky rule); and
`spawnAgentDispatch` (`apps/forge/ui-bridge.ts`) writes the dispatch child's pid to
`_logs/_<kind>-<sid>/turn.pid` through `guardedWriteFile(join(forgeRoot,
'_logs'), [sessionLogDirName(kind, sid), 'turn.pid'])`, with `kind`/`sid`
derived from the route's ALREADY-validated `sessionDir` (never request text)
and `sid` re-checked by `isSafeRunId`.

### W7-B4 — library-authoring write surface (skills/hooks/templates edit+delete, agent/flow delete, starter materialise)

The ratchet fired on this lane's own diff (14 grown `(file, sink)` pairs across
five modules) — every row below was classified before `--write` accepted the
new baseline.

| Site | Sink | Request-derived input | Class | Rationale |
|---|---|---|---|---|
| `packages/library/bridge-studio-skills.ts` PUT `:id` (read+rewrite `SKILL.md`) | `readFileSync`, `writeFileSync` | URL `:id` | guarded `[read]` | Two-layer: `skillPath(id)` shape assert, then `resolveGuardedPath(skillsDir, [id, 'SKILL.md'])`; both fs calls use only `pathGuard.realPath`. `isStudioAgent` exclusion runs BEFORE the write so the route cannot rewrite an agent. Traversal-shaped ids are 400d — executed by `packages/library/bridge-studio-authoring.test.ts` ("traversal 400") against the live route `[exec]` for that rejection claim. |
| `packages/library/bridge-studio-skills.ts` DELETE `:id` | `rmSync` | URL `:id` | guarded `[read]` | Removes `dirname(pathGuard.realPath)` — the parent of the guard's OWN resolved leaf, never a fresh `join()`; `id` is its own guard segment (no root-folding). 409-refused while `usedBy` is non-empty (derived at request time from the same listing the UI renders). |
| `packages/library/bridge-studio-hooks.ts` PUT `:id` | `writeFileSync` ×2 | URL `:id`, body `scriptBody` | guarded `[read]` | `locateHook` = `hookYamlPath(id)` shape assert + `resolveGuardedPath(hooksDir, [id, 'hook.yaml'])` (`ok && exists`) + `hookScriptIsContained`; yaml write targets `located.yamlPath` (the guard's realPath), script write targets a second `resolveGuardedPath(hooksDir, [id, ...scriptSegments]).realPath`. Hash change on rewrite honestly re-enters needs-review (no approval laundering). |
| `packages/library/bridge-studio-hooks.ts` DELETE `:id` | `rmSync` | URL `:id` | guarded `[read]` | `rmSync(dirname(located.yamlPath))` — dirname-of-guarded-leaf, same shape as the skills DELETE row. 409 while `carriedBy` is non-empty. |
| `orchestrator/studio/hook-package.ts` `readHookPackage` (W8-F2) | `readdirSync`, `readFileSync`, `statSync` | URL `:id` (hook slug), reached from `GET/POST /api/studio/hooks*` via `hookRunState`/`scanHookPackage`, and from `GET /api/studio/community/hook/:id`'s pre-install preview | guarded `[read]` | Three-layer. (1) `hookDir(id, forgeRoot)` runs `assertSkillSlug` before any path is built. (2) The package ROOT is obtained as `guardedFile(hooksDir(forgeRoot), [id], 'readdir')` — `id` rides as its OWN segment, never folded into the root (that would make containment tautological), and the guard's per-segment realpath identity walk means a `studio/hooks/<id>` that is itself a symlink out of the tree yields `null` and the package reads as absent. The recursive `readdirSync` walks only from that blessed real root and descends only through `entry.isDirectory()` dirents, so it can never traverse a symlinked subdirectory. (3) EVERY leaf is re-guarded with `guardedFile(hooksDir, [id, ...relPath.split('/')], 'read')` (identity walk + `nlink === 1`), so a hardlinked leaf — which `realpathSync` is structurally blind to — never surfaces its bytes; `readFileSync`/`statSync` only ever receive that returned `realPath`. A dirent that is neither a regular file nor a directory (symlink, socket, fifo) THROWS rather than being skipped: a silently-skipped entry would be un-hashed by `hashHookPackage`, i.e. an add-a-file escape past the approval fingerprint. Byte/file caps are re-checked from `st.size` BEFORE the read. Same shape as `community-index.ts`'s already-audited `readVendoredPackage` row. |
| `packages/library/bridge-studio-authoring.ts` `enumerateLandedHookFiles` + the hook copy (W8-F2) | `readdirSync`, `mkdirSync` ×2, `writeFileSync` | body `id` (package id) under the fixed `_interactive-library` landing root | guarded `[read]` | READ side: every directory is listed from `guardedFile(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id, ...relParts], 'readdir')`'s realPath and every leaf read through `guardedReadFile` on the same segment list — `id` is its own segment against the fixed `forgeRoot`. A non-regular staged entry, a leaf that fails the guarded read, or a breach of the shared `MAX_PACKAGE_FILES`/`MAX_PACKAGE_BYTES` caps is a 400 NAMING the entry — never a silent subset (the defect this row exists to close: the route used to read exactly two hardcoded paths and drop the rest). WRITE side: two-phase, mirroring `installCommunityHookPackage` — every destination is blessed with `guardedFile(hooksDir(forgeRoot), [id, ...relParts], 'write')` BEFORE any write, so a rejection never leaves a partial install; `mkdirSync`/`writeFileSync` only ever receive a blessed `realPath` (or `dirname` of one). |
| `orchestrator/studio/hook-scan.ts` `revokeHookApproval` (+ its `readHookLedgerRevoked` read) | `existsSync`, `readFileSync` | none in the PATH — `id` is a Map KEY into the ledger, never a path segment | guarded `[read]` | Ledger lives at the fixed `studio/hook-approvals.yaml` under `forgeRoot`; the request-derived `id` selects an entry inside the parsed document. Path is config-derived, byte-identical shape to the approve/override ledger rows above. |
| `packages/library/bridge-studio-templates.ts` staging (`invalidTemplateContentReason`) | `mkdirSync`, `writeFileSync`, `rmSync` | body/URL `id` as the staging LEAF (`${id}.md`) | guarded `[read]` | Staging root is the fixed `resolve(forgeRoot, '_template-staging')`; the leaf-append rides an id that has ALREADY passed `invalidTemplateIdReason` (`SLUG_RE` — rejects `/`, `\`, `.`, `..`, uppercase, whitespace, over-length) at every one of the three call sites (create, duplicate-source, PUT), so no separator or dotted segment can reach the `join`. `finally`-block `rmSync` of the whole staging dir mirrors `_skill-staging`'s audited row. Charset-gate-then-join is the `INIT_ID_RE`-family pattern, disclosed as such (not a realpath guard). |
| `packages/library/bridge-studio-templates.ts` POST create / PUT `:id` / DELETE `:id` | `writeFileSync` ×2, `rmSync` | body/URL `id` | guarded `[read]` | All three fs calls use only `targetGuard.realPath` from `resolveGuardedPath(resolve(forgeRoot, ...WRITABLE_CATEGORY_DIRS[category]), [leaf])` — fixed root (category is an enum check, `project-scaffold` refused 400), leaf = `${slug-validated id}.md` on create or the on-disk entry's own `definitionRef` basename (server-derived) on PUT/DELETE. DELETE 409-refused while `usedBy` non-empty. |
| `apps/forge/bridge-studio-writes.ts` `materializeReferencedStarterAgents` | `cpSync` | flow-body node `agent` names — as SELECTORS only | guarded `[read]` | Request-derived names never form a path: they are intersected against `listStarterAgents(forgeRoot)` (a server-side enumeration of `studio/starters/agents/`), and only a matching starter's OWN `slug` reaches the copy — source is the fixed starters dir + that server slug, destination is `resolveGuardedPath(skillsDir, [starter.slug]).realPath`, skipped when it already exists (existing roster agent wins). |
| `apps/forge/bridge-studio-writes.ts` agents DELETE `:slug` / flows DELETE `:id` | `rmSync` ×2, `readFileSync` (`originalRaw` fast-path read) | URL `:slug` / `:id` | guarded `[read]` | Both deletes remove `dirname(pathGuard.realPath)` where `pathGuard` is the route's existing `resolveGuardedPath` over the slug/id segment; the `originalRaw` read only ever passes `pathGuard.realPath`. Agents DELETE is 409-refused while any flow node or session-kind descriptor references the slug (traversal 400 executed by the pinned wire test); flows DELETE refuses seeds (403) and in-flight runs (423) before any fs mutation. |
| `apps/forge/bridge-studio-writes.ts` catalog probe (`existsSync(catalogPathEarly)`) | `existsSync` | none | guarded `[read]` | Constant `join(forgeRoot, 'studio', 'catalog.yaml')` — no request data in the path; counted here only because the ratchet keys on per-file sink totals. |
| `packages/library/bridge-studio-catalog.ts` catalog probe (`existsSync(catalogPath)`) | `existsSync` | none | guarded `[read]` | Constant `join(resolve(ctx.forgeRoot), 'studio', 'catalog.yaml')` — no request data in the path, byte-identical in shape to the `bridge-studio-writes.ts` row above. **MOVED, not new** (M4-library 6d): this is the `GET /api/studio/catalog` arm's own probe, which lived in `apps/forge/bridge-studio.ts` until the route joined `packages/library/routes.ts`. The ratchet keys on per-file totals, so one file's count fell as another's rose — `apps/forge/bridge-studio.ts existsSync 7 -> 6` against `packages/library/bridge-studio-catalog.ts existsSync 0 -> 1`, host minus package = ZERO. The sink is unchanged; only its owning file is. |

**W7-B4 review round — one new sink.** Review finding 7 (a corrupted authored
flow.yaml answered 500 and could never be deleted from Studio) adds a single
`readFileSync` to the flow DELETE arm of `apps/forge/bridge-studio-writes.ts`
(`readFileSync(flowYamlPath, 'utf8')`, `apps/forge/bridge-studio-writes.ts` sink count
3 -> 4). Class: **guarded `[read]`**. `flowYamlPath` is `pathGuard.realPath`
from `resolveGuardedPath(resolve(forgeRoot,'studio','flows'), [id, 'flow.yaml'])`
— the same realpath-identity guard the rest of that route already runs, with
the request-derived `id` as its OWN segment and a `SLUG_RE` shape gate ahead of
it. The read happens only after `pathGuard.exists`, and its result is used for
a single regex seed-probe (`/^\s*origin:\s*seed\s*$/m`) whose only outcome is
a 403 — no bytes are returned to the caller.

**Merge reconciliation (W7-B4 x main post-W7-B6 #188).** Merging `parsoFish/main`
into this lane put BOTH branches' newly-audited sites in the same module:
`apps/forge/bridge-studio-writes.ts` `existsSync` grew 14 -> 15. The 15th site is not a
new one — it is the union of this section's rows (`sessionKindAgentRefs`'s
`existsSync(file)` on `studio/session-kinds.yaml`, the agent/flow DELETE probes)
with the community-registry rows main landed in the same file. Every site in the
merged file is classified by one of the two sections; no site arrived
unclassified, and the ratchet baseline was re-accepted at 15 on that basis.

### W7-B2 — KB active-job derivation (`packages/knowledge/kb-job-state.ts`, two new `[read]`-class sinks, both accidentally-safe by construction)

The ONE per-KB "a mutating job is running" derivation (knowledge-05) that
both the bridge's 409s and the UI's action-group gate consume.
`check-request-path-sinks.mjs` delta (1 file, `readFileSync` 0 → 2):

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/knowledge/kb-job-state.ts` (`readJsonFile`, via `findLiveDrain`) | `readFileSync` | none reaches the path — the request-derived `kbId` is used ONLY as a string PREFIX FILTER over `readdirSync(forgeRoot/_logs)`'s own enumerated entry names; the path read is `join(forgeRoot, '_logs', name, 'status.json')` where `name` is a server-enumerated directory entry, never caller text | accidentally-safe `[read]` | `kbId` never appears in any `join()`; a hostile `kbId` can at most fail every `startsWith` and select nothing. Verified `[exec]` by `packages/knowledge/tests/integration/bridge-studio-kbs-w7.test.ts` (active-job gate pins) and the drain-route 409 pins in `packages/knowledge/tests/unit/bridge-studio-kb-drain-w7.test.ts`. |
| `packages/knowledge/kb-job-state.ts` (`consolidateRunning`) | `readFileSync` | none — `runId` at both call sites is sliced from the SAME `readdirSync` enumeration (`name.slice('_brainfix-'.length)` after a `startsWith('_brainfix-<kbId>-consolidate-')` filter); `_brainfix-<runId>/events.jsonl` is a re-join of the enumerated name | accidentally-safe `[read]` | Same enumeration-only trust chain as the row above; the parse is line-tolerant JSON with no bytes surfaced to the caller beyond a boolean/kind. |

`node scripts/check-request-path-sinks.mjs --write` accepted this delta —
`scripts/request-path-sinks.baseline.txt` now records `packages/knowledge/kb-job-state.ts`
`readFileSync` at 2.

### W8-B2 — the KB drain's edit-soundness audit (agent-written link targets)

Wave-8 lane B2 (bead `forge-d8l` / `knowledge-36`). `packages/knowledge/kb-drain-edit-soundness.ts`
is a NEW module reached from `POST /api/studio/kbs/:id/drain`. It asks whether a
structurally-shaped edit is SOUND — does it delete a resolvable graph edge, or
introduce a link target that resolves to nothing.

The security-relevant input is a shape this audit had not carried before: a
**markdown link target extracted from file content an AGENT wrote during the
turn**. It is not request text, but it is untrusted text that reaches
`resolve()`, and a brain theme legitimately links anywhere inside the repo
(`../../../docs/decisions/…`, `_logs/…` — `checkStaleness` exists precisely
because they do), so `brain/` is too narrow a containment root and `forgeRoot`
is the right one.

**W8-F1 amendment (2026-08-28).** Two further sinks arrive in this module with
the derived-scope gate: a `realpathSync` on the fixed brain root (a comparison,
not a target) and a second `rmSync` in the last-resort `restoreFromSnapshot`.
Both are classified in the table below. Baseline delta: `realpathSync` 0 → 1,
`rmSync` 1 → 2.

**W8-F1 review-round-2 amendment (2026-08-28).** Three more, all classified below:
`packages/knowledge/brain-lint.ts` `existsSync` 21 → 22 and `readdirSync` 10 → 11 (the slug
universe now walks every `brain/*/themes`, so an operator-created KB's edges are
visible to the audit), and `packages/knowledge/bridge-studio-kbs.ts` `readFileSync` 3 → 4 (the
draft re-audit at approve time). `packages/knowledge/kb-drain-edit-soundness.ts` `rmSync` goes
back DOWN 2 → 1: the unreachable `restoreFromSnapshot` was deleted.

`check-request-path-sinks.mjs` delta: **487 → 490**, three rows, all in the new
module and all the SAME revert that already lived in
`packages/knowledge/bridge-studio-kb-drain.ts`. The lane's first cut added three *different*
sinks (an `existsSync` probe, plus `mkdirSync`/`writeFileSync` for the repair
write); those were routed through `packages/kernel/path-guard.ts` instead and cost
nothing. The three below arrived later, when adversarial round 1 moved the gate
off the drain's call site and onto the turn itself: `revertChange` came with it,
so the same three sinks now appear under the new file's name. The drain keeps
`revertProseChanges` for its own prose lane, which is why the old rows did not
fall by three.

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/knowledge/kb-drain-edit-soundness.ts` (`revertChange`) | `mkdirSync`, `writeFileSync`, `rmSync` | none — `relPath` is a directory entry name from `snapshotKbFiles`'s own `readdirSync` walk of the trusted `brainDir`, and that walk skips symlinks entirely (`entry.isFile()` is false for one), so no `..` and no link can enter | accidentally-safe `[read]` | Identical trust chain to `revertProseChanges` (`packages/knowledge/bridge-studio-kb-drain.ts`), which this is a relocation of and which has carried the same classification since W7-B2. Deliberately NOT routed through `guardedWriteFile`: the revert is the RECOVERY path, and a guard that can refuse it would leave the agent's rejected content on disk — the one outcome the gate exists to prevent. |

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/knowledge/kb-drain-edit-soundness.ts` (`linkResolves`) | existence probe via `resolveGuardedPath` | an agent-written markdown/wikilink TARGET, resolved against the edited file's own directory | guarded `[exec]` | `resolve()` normalises the `..` a legitimate cross-directory theme link is full of, so the guard receives a clean segment list; a target that climbed out of `forgeRoot` yields a leading `..` segment `isSafeSegment` rejects, and `resolveGuardedPath` realpath-walks the existing prefix so a symlinked ancestor cannot smuggle the probe outside either. **The rejecting input exists and is executed**: `cli/kb-drain-edit-soundness.test.ts`'s `[exec] a link target that climbs OUT of forgeRoot…` plants a real file outside the repo, points a link at it, and asserts the edit is refused AND the outside file is byte-unchanged. Its paired test asserts a legitimate repo-internal `..` link still resolves, so the guard is not "cannot fail". A rejection is reported as "does not resolve", which makes the gate MORE restrictive — the safe direction. |
| `packages/knowledge/kb-drain-edit-soundness.ts` (`guardAgentKbEdits`) | `guardedWriteFile` | `relPath` from `snapshotKbFiles`'s own walk of the trusted `brainDir`; the CONTENT is agent-influenced | guarded `[read]` | Not request text — `relPath` is a directory entry name from our own `readdirSync` walk, and `snapshotKbFiles` skips symlinks entirely (`entry.isFile()` is false for one). Routed through `guardedWriteFile(brainDir, relPath.split('/'), …)` anyway, because this is a fix turn WRITING agent-influenced content and the guard costs nothing. On a guard refusal the `&amp;&amp;` chain in `guardAgentKbEdits` short-circuits into `revertChange`, which restores `c.before`; the revert is a raw `writeFileSync` on the same snapshot-derived path, so the guard cannot block the restore. That asymmetry — guarded repair, unguarded revert — is what makes the recovery reachable, and it is recorded here rather than asserted as a failure-behaviour claim, which this document admits only with `[exec]` evidence. **No test injects a `guardedWriteFile` refusal**; this row is `[read]` and must not be read as more. |
| `packages/knowledge/kb-drain-edit-soundness.ts` (`realBrainRoot`, W8-F1) | `realpathSync` | none — the argument is `brainRootDir(forgeRoot)` = `join(forgeRoot, 'brain')`, a fixed forgeRoot-derived literal with no request-, agent- or id-derived component | accidentally-safe `[read]` | Added by W8-F1, which made the gate's scope DERIVED rather than caller-supplied. The resolved value is used only for a `startsWith` containment COMPARISON against `resolveKbBrainDir`'s already-realpath'd answer — it never becomes the target of a read or a write. Both sides of that comparison must be realpath'd or the check is defeated by a symlinked `/tmp` (which is why the resolution exists at all). A `realpathSync` failure is caught and falls back to the lexical path, under which nothing resolves inside the KB dir either, so the scope check fails CLOSED. |
| `packages/knowledge/brain-lint.ts` (`collectThemeSlugTargets`, W8-F1) | `existsSync`, `readdirSync` | none — the argument is `brainRoot`, which every caller derives as `join(forgeRoot, 'brain')`; the directory NAMES it enumerates are filesystem entries, never request text, and each is passed to `addDir(join(brainRoot, name, 'themes'))` with no caller-supplied component | accidentally-safe `[read]` | Added by W8-F1 so the audit's slug universe covers a KB scaffolded at `brain/<id>/themes/` by `POST /api/studio/kbs` — previously only `cycles`, `forge-dev` and `projects/*` were walked, so an edge deletion in an operator-created KB read as "a genuinely dangling entry may go". Read-only enumeration, identical in shape to the `projects/` walk immediately below it (which has carried this classification since ADR 035) and to `readThemeFiles`. Entries beginning `.` are skipped, matching `checkProjectBrainIndexes`. |
| `packages/knowledge/bridge-studio-kbs.ts` (`approveKbCleanup` draft re-audit, W8-F1) | `readFileSync` | `w.target`, derived from `status.draft_apply[].file` — session content | guarded `[read]` | The path is the SAME `w.target` the write below it uses, and it has already passed this function's own containment gate strictly before this point: `resolve(forgeRoot, file)` then `target.startsWith(brainDir + sep)` where `brainDir` is `resolveKbBrainDir`'s realpath-verified answer, with the boundary itself refused. The read is the re-audit that makes the write safe — it compares the parked draft against the file's CURRENT bytes so a draft that went stale (an edge added to the theme since it was minted) is refused instead of applied over. Reading a path already proven contained, in order to decide whether to write it, adds no surface the write did not already have. |
| `packages/knowledge/kb-drain-edit-soundness.ts` (`restoreFromSnapshot`, W8-F1) | `rmSync` | none — `relPath` keys come from `snapshotKbFiles`'s own `readdirSync` walk of the trusted brain root, which skips symlinks entirely (`entry.isFile()` is false for one), so no `..` and no link can enter | accidentally-safe `[read]` | Identical trust chain to the `revertChange` row above; this is the same recovery shape one layer out. Reached only when `diffKbSnapshot` itself throws, i.e. the gate cannot tell what changed — the last-resort disposal that puts the tree back the way the pre-turn snapshot holds it. Deliberately NOT routed through a guard, for the reason the `revertChange` row already records: the restore is the RECOVERY path, and a guard that can refuse it would leave the agent's rejected content on disk, which is the one outcome the gate exists to prevent. Per-file failures are collected into `KbEditGateResult.errors` and surfaced on the drain row rather than thrown. |

### W7-B3 — community registry CRUD + index meta (fixed-path sinks; one guarded read)

Wave-7 lane B3 (community; bead forge-bzt.8). `check-request-path-sinks.mjs`
delta (8 rows across 3 files) — the headline fact for every new fs sink in
the two bridge files: **no request-derived value ever becomes a path
segment.** The routes' `:id` is `assertSkillSlug`-validated and then used
ONLY to match parsed registry rows in memory; every fs operation targets the
ONE fixed, forge-root-derived registry path.

| file | op(s) | request field | class | evidence |
|---|---|---|---|---|
| `apps/forge/bridge-studio-writes.ts` (`mutateCommunityRegistry`) | `existsSync` + `mkdirSync` + `writeFileSync` + `renameSync` + `unlinkSync` | none — `destPath = communityRegistryPath(ctx.forgeRoot)` (a fixed literal under the trusted forge root); `tempPath` is a sibling `.registry.yaml.tmp-<server-random>` (`randomBytes`, never request text). The URL `:id` / body `item.id` never reach a path: they are slug-validated (`assertSkillSlug`) and matched against `loadCommunityRegistry`'s parsed rows in memory only. | fixed-path (accidentally-safe by construction) | Temp-then-rename with a re-parse through `loadCommunityRegistry` before the rename — a document the ONE loader refuses never replaces the real file; refused mutations (`null` from `mutate`) write nothing at all. Verified `[exec]` by `apps/forge/bridge-community-registry-crud.test.ts` (CRUD-8: a traversal-shaped id 400s with the file byte-identical; CRUD-2/6: 409/404 leave the file byte-identical). |
| `packages/library/bridge-studio-community.ts` (`communityIndexMeta`, the registry-row GET) | `existsSync` ×2 (new) + `execFileSync` (new) | none — both `existsSync` calls probe the SAME fixed `communityRegistryPath(forgeRoot)`; `execFileSync('git', ['status','--porcelain','--','studio/community/registry.yaml'], {cwd: forgeRoot})` is a FIXED argv + FIXED literal path with `shell:false` semantics (execFileSync never invokes a shell) — no request-derived byte reaches argv, env, or cwd. The row GET's `:id` is `assertSkillSlug`-validated and used only for in-memory row matching. | fixed-path / fixed-argv | A git failure (non-repo root) degrades to `registryDirty: null` — an honest unknown, never a fabricated clean and never an error channel that echoes request data. Verified `[exec]` by `packages/library/bridge-studio-community.test.ts` (the three W7-B3 meta tests: null outside a repo, false→true across a real commit + modify). |
| `orchestrator/studio/skill-library.ts` (`installSkillPackage`) | `readFileSync` (+1) | none — the read target is `guardedFile(skillsDir(forgeRoot), [id, 'SKILL.md'], 'read')`'s OWN non-null return (the guard's resolved real path; `id` rode as its own `segments[]` element) | guarded `[read]` | The read exists to tell a MANAGED occupancy (provenance block → honest `alreadyInstalled`) from an unrelated local skill (no provenance → throw, `present-unmanaged`) — closing library-31's laundered false success. Read-only either way; the victim file is byte-unchanged on refusal (pinned by `skill-library.test.ts` W7-B3 row). |

`node scripts/check-request-path-sinks.mjs --write` accepted this delta.

### W7-B2 code-review round — the approve-path consolidate's log-dir stake-out (one new `[exec]`-class sink, guarded)

`approveKbCleanup` (`packages/knowledge/bridge-studio-kbs.ts`) minted a
`` `${kbId}-consolidate-${stamp}` `` runId and enqueued
`runBrainConsolidateNow` **without** staking out `_logs/_brainfix-<runId>/`,
which that function only creates at its own terminal write — so for the whole
run (real agent turns, minutes) `deriveKbActiveJob` could not see it and the
knowledge-05 mutual gate had a hole for exactly this dispatch path. The fix
adds the same synchronous stake-out the sibling `op=consolidate` maintenance
route has carried since W6-B14. `check-request-path-sinks.mjs` delta (1 file,
`mkdirSync` 8 → 9):

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/knowledge/bridge-studio-kbs.ts` (`approveKbCleanup`, consolidate path) | `mkdirSync` | `runId` — server-minted as `` `${kbId}-consolidate-${Date.now().toString(36)}` ``; `kbId` comes from the SESSION's own `status.kb_id` (read through `guardedReadSessionStatus`), never from the URL | guarded `[exec]` | Routed through `resolveGuardedPath(forgeRoot, ['_logs', '_brainfix-<runId>'])` and created only on `.ok` — byte-identical to the `op=consolidate` route's own stake-out (the W6-B14 row above), same fixed root, same single compound segment. Verified `[exec]` by `packages/knowledge/tests/unit/kb-drain-structural.test.ts`'s "the consolidate path stakes its log dir SYNCHRONOUSLY" pin, which asserts `deriveKbActiveJob` reports THIS dispatch's runId in the same tick. |

`node scripts/check-request-path-sinks.mjs --write` accepted this delta —
`scripts/request-path-sinks.baseline.txt` now records `packages/knowledge/bridge-studio-kbs.ts`
`mkdirSync` at 9.

### W7 FIX-B-KB — the shared lenient theme parser (`packages/knowledge/theme-frontmatter.ts`, one relocated `[read]`-class sink)

The one lenient theme-frontmatter parser moved out of `packages/knowledge/brain-lint.ts`'s
private `parseTheme` into the new leaf module `packages/knowledge/theme-frontmatter.ts`, so
the lint checks and the deterministic fixers (`packages/knowledge/brain-fix-auto.ts`) share a
single parse derivation (they used to disagree: the fixer's strict copy
refused unquoted-colon themes the lint fallback accepted, so consolidate could
never clear the finding it was dispatched for). `check-request-path-sinks.mjs`
delta: `packages/knowledge/theme-frontmatter.ts` `readFileSync` 0 → 1, with the SAME sink
count DROPPING in both former hosts (`packages/knowledge/brain-lint.ts` `readFileSync` 5 → 4,
`packages/knowledge/brain-fix-auto.ts` `readFileSync` 4 → 3) — a relocation, net −1, not new
surface:

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/knowledge/theme-frontmatter.ts` (`parseThemeFile`) | `readFileSync` | none directly — `file` is always a server-enumerated theme path: `readThemeFiles`/`listOwnThemeFiles` walks (the latter through `guardedReadDir` over `resolveKbBrainDir`), or a lint Finding's own `file` (constructed from those same walks), or `op=fix-agent`'s body path which the route validates absolute-under-`brain/` before dispatch | accidentally-safe (unchanged) | Byte-identical read+parse logic relocated from `packages/knowledge/brain-lint.ts:241-294`; neither module is in `check-raw-fs-guarded.mjs`'s scanned-module list (shared helpers, not request handlers), and every caller's path provenance is unchanged by the move. The parse now always passes gray-matter an options object — cache-bypass, a correctness fix (poisoned-cache empty frontmatter), no fs-surface change. |

`node scripts/check-request-path-sinks.mjs --write` accepted this delta —
`scripts/request-path-sinks.baseline.txt` records the relocation (and the two
tightened rows).

### W7-C2 — the generic revise turn's feedback read (`packages/sessions/interactive-runner.ts`, one new `[read]`-class sink, guarded)

The revise verdict (ADR-043 2026-08-21 amendment §1) sends a generic-spine
session back to its drafting phase; the next turn's prompt must carry the
operator's `feedback.md` the same way the two bespoke runners' prompts always
have. `check-request-path-sinks.mjs` delta: `packages/sessions/interactive-runner.ts`
`readFileSync` 1 → 2.

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/sessions/interactive-runner.ts` (`readOperatorFeedback`) | `readFileSync` | none directly — `sessionDir` is the runner's own already-resolved session directory (derived upstream through `resolveGuardedPath(projectRoot, [kindDir, sessionId])`, the SEC-04 containment segment), and the leaf rides `resolveGuardedPath(sessionDir, ['feedback.md'])` before the read | guarded | Mirrors `readFeedback` in `packages/sessions/instructions-runner.ts` / `packages/sessions/demo-builder-runner.ts` (both `guardedReadFile` over the same leaf name): an escaping symlinked `feedback.md` collapses to `null` == absent — never read, never inlined into the prompt. |

`node scripts/check-request-path-sinks.mjs --write` accepted this delta —
`scripts/request-path-sinks.baseline.txt` now records
`packages/sessions/interactive-runner.ts` `readFileSync` at 2.

### W7-C2 T1 review (P0-2 / finding A5) — the revise feedback becomes CONSUME-ONCE (`packages/sessions/interactive-runner.ts`, one new `[write]`-class sink, guarded)

`readOperatorFeedback` (the row immediately above) runs on EVERY `step: agent`
turn, not only the one a revise triggered, and nothing cleared `feedback.md`
after it had been folded into a prompt — so round 1's corrections kept riding
round 2's and round 3's prompts, silently steering turns the operator never
aimed. The fix deletes the file once a turn has actually consumed it, which
adds one delete sink. `check-request-path-sinks.mjs` delta:
`packages/sessions/interactive-runner.ts` `rmSync` 0 → 1.

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `packages/sessions/interactive-runner.ts` (`clearOperatorFeedback`) | `rmSync` | none directly — the SAME `resolveGuardedPath(sessionDir, ['feedback.md'])` choke point `readOperatorFeedback` uses one line earlier, on the SAME already-resolved session directory (derived upstream through `resolveGuardedPath(projectRoot, [kindDir, sessionId])`, the SEC-04 containment segment) | guarded `[write]` | The delete only ever targets `guarded.realPath` from a per-segment identity walk that has already returned `ok && exists`; an escaping symlinked `feedback.md` resolves outside the session dir, `guarded.ok` is false, and NOTHING is unlinked — the escape can never be followed to an out-of-root delete. Runs strictly AFTER `runAgentTurn` resolves, so a turn that threw leaves the note in place for the retry, and is skipped entirely when no feedback was read (`operatorFeedback === null`). A failed unlink is logged, never swallowed: an unconsumed note WILL re-steer the next turn and the operator must be able to see why. Pinned by `orchestrator/interactive-runner.test.ts`'s C2-FIX-A5-2 (turn 1 carries the words and the file is gone; turn 2's prompt does not carry them). |
| `packages/sessions/kinds/kind-turn.ts` (`withOperatorFeedback`) | `rmSync` | none directly — the SAME `resolveGuardedPath(sessionDir, ['feedback.md'])` choke point, on the SAME already-resolved session directory (derived one screen earlier through `resolveGuardedPath(projectRoot, [kindDir, sessionId])`, the SEC-04 containment segment the driver applies before any read) | guarded `[write]` | **M4 ruling 60 (2026-09-03), the ports' consume-once.** Identical mechanics and identical guarantees to the `interactive-runner.ts` row above — the delete only ever targets a `guarded.realPath` that already returned `ok && exists`, so an escaping symlinked `feedback.md` resolves outside the session dir, `guarded.ok` is false, and NOTHING is unlinked. Two differences, both narrowing: the READ goes through `guardedReadFile(projectRoot, [...dirSegments, 'feedback.md'])` (the per-segment form) rather than a bare read, and the clear is inside a CLOSURE (`withOperatorFeedback`) rather than a separate call, so a ported kind cannot consume the note and forget to clear it. Runs strictly after the wrapped step RESOLVES — a turn that threw leaves the note for the retry — and is skipped entirely when no feedback was read. A failed unlink is logged, never swallowed. Consumers today: the `instructions` and `demo` kinds, whose bespoke runners read `feedback.md` and never cleared it. |

`node scripts/check-request-path-sinks.mjs --write` accepted this delta —
`scripts/request-path-sinks.baseline.txt` now records
`packages/sessions/interactive-runner.ts` `rmSync` at 1.

### W8-B5 WI-3 — the deterministic community refresh becomes bridge-reachable (five fixed-path sinks in ONE new module)

Wave-8 lane B5, exit rows E1 + E7 (bead `forge-6gv.9`). `POST
/api/studio/community/refresh` and `forge community refresh` share ONE
load → refresh → write implementation (`packages/library/community-refresh-run.ts`), so
that module becomes reachable from a bridge route and its five fs sinks
enter the scan.

**The delta is structurally unavoidable, and that is the first thing to
say about it.** Any route that writes a file necessarily puts write sinks in
a route-reachable module: in a NEW module they are new `(file, sink)` pairs,
in an EXISTING one they are grown counts. There is no implementation of E7
that leaves the baseline at 490 rows. The question the audit has to answer is
therefore not "can this be avoided" but "can any request-derived byte reach
any of these paths", and the answer is no — by construction, not by
validation:

> **The refresh route takes no parameters and reads no request body.** Its URL
> is the literal `/api/studio/community/refresh` (no `:id`, no query it reads,
> no JSON body it parses). There is no request-derived value in scope anywhere
> in the arm, so there is nothing that *could* be folded into a path. The CLI
> verb's argv is likewise never a path: the only flag it accepts is
> `--dry-run`, and anything else exits 2 before the runner is called.

| file | op(s) | request field | class | evidence |
|---|---|---|---|---|
| `packages/library/community-refresh-run.ts` (`runCommunityRefresh`) | `existsSync` | none — `communityRegistryPath(opts.forgeRoot)`, a fixed `studio/community/registry.yaml` literal under the trusted forge root (`orchestrator/studio/registry.ts`) | fixed-path (accidentally-safe by construction) | The probe answers "is there a registry to refresh at all"; a missing file is the typed `registry-missing` refusal and NOTHING is created (`packages/library/community-refresh-cmd.test.ts` R8 asserts the file still does not exist afterwards). |
| `packages/library/community-refresh-run.ts` (`writeRegistryAtomically`) | `mkdirSync` + `writeFileSync` | none — `dirname(destPath)` / a sibling `.registry.yaml.tmp-<server-random>` whose suffix is `randomBytes(6).toString('hex')`, never request text | fixed-path | The same temp-then-rename idiom `mutateCommunityRegistry` (`apps/forge/bridge-studio-writes.ts`, W7-B3 row above) already uses on the same file, extracted into the shared runner rather than re-invented per surface. |
| `packages/library/community-refresh-run.ts` (`writeRegistryAtomically`) | `renameSync` | none — same two fixed paths | fixed-path | The rename happens ONLY after `loadCommunityRegistry(tempPath)` re-parses the candidate through the ONE loader: a document the loader refuses never replaces the real registry. |
| `packages/library/community-refresh-run.ts` (`writeRegistryAtomically`) | `unlinkSync` | none — the temp sibling this function itself just created | fixed-path | Best-effort cleanup on a failed round-trip, so a refused write leaves no debris beside the real registry. It can only ever target the path this function minted. |

**Two properties this audit row exists to record, both `[exec]`-verified:**

1. **A refused refresh writes nothing at all.** A missing/invalid `GH_TOKEN`,
   an exhausted rate limit, and a pass in which every upstream failed each
   leave the registry BYTE-IDENTICAL — asserted on the bytes, not on the exit
   code, in `packages/library/community-refresh-cmd.test.ts` (R1/R2/R3/R4/R6) and through
   the real bridge in `packages/library/bridge-studio-community-refresh.test.ts`
   (B1/B2/B3/B4/B6). Stamping `meta.lastRefresh` on an unverified pass would
   make an unchecked registry read as freshly verified — the
   `declared-data-fails-open` shape, here closed on the write decision itself.
2. **The credential never reaches a path, a log, a response or a written
   byte.** `GH_TOKEN` is read once (`packages/library/community-refresh-run.ts`), passed as
   a parameter into the fetch core, and used only as an `Authorization`
   header. It is deliberately absent from `AGENT_ENV_ALLOWLIST`
   (`orchestrator/spawn-env.ts`), so no spawned agent child ever sees it.
   Pinned by C6/C7 (no output stream, not even a 12-char prefix) and B2 (not
   in the response body).

**Dry-bridge:** this is the FIRST bridge route in forge's history that calls a
third-party API, so `DryBridgeAction` gains `network` and the route is
classified `refuse` / `guard: 'route'` in `BRIDGE_ROUTE_CLASSIFICATION`
(`cli/dry-bridge.ts`). Under `FORGE_DRY_BRIDGE=1` it answers the typed 409
before any request is attempted — a harness run can neither spend the
operator's GitHub rate limit nor write live upstream numbers into the
repo-tracked registry (B6).

Baseline delta pending: 5 new rows (`packages/library/community-refresh-run.ts` ×
`existsSync` / `mkdirSync` / `renameSync` / `unlinkSync` / `writeFileSync`,
each at count 1), 490 → 495. Accept with
`node scripts/check-request-path-sinks.mjs --write`.

### M4-knowledge H8 — five baseline rows RE-KEYED behind the `KbBackend` seam, no new sink surface

Four measured per-KB read sites (`kb-lint-summary.ts:68,140`, `kb-health.ts:97,164`)
resolved a KB's brain directory for themselves and then read it, bypassing the
`KbBackend` seam SPEC.md §4 names as the only per-KB read path. The resolution
and the reads moved behind the seam; the two lint/health modules now receive a
backend rather than constructing one. No read gained a new argument, a new root
or a new caller — each moved intact into the implementation of the interface
method that answers the same question.

| was | is now | sink | why it moved |
|---|---|---|---|
| `packages/knowledge/kb-health.ts` (`listFreshThemeFiles`) | `packages/knowledge/kb-backend.ts` (`FilesystemKbBackend.freshThemeFiles`) | `existsSync` 1, `readdirSync` 1, `statSync` 1 | enumerating a KB's own fresh themes is a per-KB read; behind the seam it is one method, and a non-filesystem backend answers it its own way |
| `packages/knowledge/kb-health.ts` (`kbYamlPathFor`) | `packages/knowledge/kb-backend.ts` (`FilesystemKbBackend.descriptorPath`) | `existsSync` 1 | the descriptor lookup is per-KB; resolved per call rather than cached, so a KB that loses its `kb.yaml` while a backend is held answers null |
| `packages/knowledge/kb-lint-summary.ts` (`findingUnderDir`) | `packages/knowledge/brain-paths.ts` (`pathUnderDir`) | `existsSync` 1, `realpathSync` 1 | the containment comparison is now shared by `findingUnderDir` and `KbBackend.contains`, so a KB's read scope and its WRITE scope cannot drift apart — the defect class the original comment already records |

**The proof that this is a re-key and not growth is the guard's own total: 1,340
sink calls before and 1,340 after.** `(file, sink)` rows go 528 → 527 and the
baseline file 531 → 530 lines, both because `kb-health.ts`'s `existsSync` 2 split
into a `kb-backend.ts` 2 that absorbed one and a `brain-paths.ts` 1 → 2 that
absorbed the other. Accepted by hand-editing the affected lines, NOT by
`--write`: bead `forge-8vfn.5.19` records that `--write` harvests unrelated
baseline slack, and the five tightenable lines belonging to other lanes
(`packages/flows/fix-work-items.ts` ×3, `packages/knowledge/brain-lint.ts` ×2 —
the latter recorded at this lane's pin as pre-existing) were deliberately left
un-harvested and are unchanged either side of this PR.

The guard classification is unchanged and is restated here rather than assumed.
Every one of these sites still resolves through `resolveKbBrainDir`, the KB
family's single containment choke point (`resolveGuardedPath` on both candidate
roots, `kbId` always its own `segments[]` element) — the seam moved WHO calls it,
not WHAT it checks. `FilesystemKbBackend` calls it per method rather than caching
a directory, so a KB that stops resolving stops answering; the guard cannot be
outlived by a held backend. Nothing hands the resolved root back out: the
interface exposes containment (`contains`, `ownsTheme`), placement, the descriptor
path and the fresh-theme list, and deliberately no `root()` — a caller holding the
root could read around the seam, which is the bypass this change removes.

`packages/knowledge/tests/contract/kb-backend-conformance.test.ts` pins the
behaviour with content assertions against a seeded brain, including the
prefix-sibling case (`alpha-two` must never fold into `alpha`) that was a live
cross-KB WRITE defect, and CONF-8a asserts the two modules resolve no KB brain
directory of their own. Both were positive-controlled: restoring the substring
form of `contains` fails CONF-1a/1b, and restoring the self-resolution in
`kb-lint-summary.ts` fails CONF-7a/8a.

### Relocated in M4 PR 4b — the KB surface splits five ways (no new surface)

`packages/knowledge/bridge-studio-kbs.ts` was 2,068 lines holding the whole KB
surface behind one `handleStudioKbRoutes` if-chain. PR 4b carved its eleven
routes into `packages/knowledge/routes.ts`'s table and split the module under
the 800-line cap. **Every row above that cites `packages/knowledge/bridge-studio-kbs.ts` or
`packages/knowledge/bridge-studio-kbs.ts` still records what was found, and
where it was found at the time.** Those citations are deliberately NOT rewritten:
a line number in a historical finding is part of the record, and a sed over them
would turn a description of the past into a claim about the present. This
section is the forwarding address.

| sinks that were in `bridge-studio-kbs.ts` | now live in |
|---|---|
| `writeConsolidateTerminalEvent` / `writeConsolidateErrorTerminalEvent` (`mkdirSync` ×2, `appendFileSync` ×2), `runBrainConsolidateNow`, `enqueueConsolidate`, the deterministic consolidate fixes | `bridge-studio-kb-consolidate.ts` |
| the roster / resolve-node / node-article / KB-detail reads | `bridge-studio-kb-routes-read.ts` |
| create (`mkdirSync`/`writeFileSync`), delete (`rmSync`), guidance (`guardKbTail`) | `bridge-studio-kb-routes-lifecycle.ts` |
| `spawnBrainFix` (`spawn`, `mkdirSync`, `openSync`), `readBrainFixState`, the consolidate-reattach and ingest-activity reads, the five-op maintenance POST | `bridge-studio-kb-routes-maintenance.ts` |
| `loadKbDescriptors`, `subDirs`, `buildKbHealth`, `approveKbCleanup`, `computeAgentCleanupFindings` | `bridge-studio-kbs.ts` (retained base) |

**It is a relocation, and that was measured rather than asserted.** Every sink
kind conserves exactly across the split — `appendFileSync` 2→2, `existsSync`
5→2+2+1, `mkdirSync` 9→2+2+3+2, `openSync` 1→1, `readFileSync` 4→1+1+1+1,
`readdirSync` 5→2+2+1, `rmSync` 2→2, `spawn` 1→1, `writeFileSync` 3→1+2 — and
`check-request-path-sinks` reports the same 1,340 total sink calls either side.
The guard classification of each site is unchanged; only its file is.

**The split blinded `check-raw-fs-guarded` first, and that is the part worth
remembering.** Tier-1 scope is derived from an HTTP-plumbing text signal, so
moving the sinks into modules that no longer carry it dropped them to tier 2,
where `runId` is excluded — four audited residuals silently stopped suppressing
and the check still reported PASS. Measured: **92 residual sinks before the
split, 88 after.** A residual count that FALLS after a carve is a blinded
scanner, not progress. The five heirs are named in `EXPLICIT_MODULES` (the
remedy that script documents for exactly this case, and the same one the drain
carve needed one PR earlier), which restores 92, and all 24 re-keyed allowlist
rows were paired to findings by sink kind and order from a real
`node scripts/check-raw-fs-guarded.mjs --json` run — never by arithmetic.

### Relocated in M4-knowledge s5 — `listCycles` moves DOWN to kernel (two sink pairs, no new surface)

`listCycles` lived in `packages/flows/metrics.ts` (rank 5) while
`packages/knowledge` (rank 2) needed it to walk `_logs/<cycleId>/events.jsonl`
for `GET /:id/ingest-activity` — an upward import the allow-graph forbids. Ruling
57: the symbol moves down to `@forge/kernel` (`log-cycles.ts`) and `metrics.ts`
re-exports it, so no caller changes.

| sink | was | now |
|---|---|---|
| `existsSync` | `packages/flows/metrics.ts` 1 | `packages/kernel/log-cycles.ts` 1 |
| `readdirSync` | `packages/flows/metrics.ts` 1 | `packages/kernel/log-cycles.ts` 1 |

**Measured, not asserted:** `check-request-path-sinks` reported the two source
pairs `1 -> 0` as *tightenable* and the two destination pairs `0 -> 1` as new, in
the same run — a 1:1 relocation with the totals unchanged. `--write` was run only
after that pairing was read, and its diff checked to touch these four rows and
nothing else (a previous carve in this campaign swept a third lane's rows into
its own `--write`).

**The classification is unchanged, and it was already written down.** The
"`findKbDrainRuns`" bullet above files `listCycles` under *server-enumerated
names, holding no client string*: its argument is a `logsRoot` (a `TRUSTED_ROOTS`
name, config-derived), it returns directory names the server enumerated, and
knowledge's caller feeds each one back as its OWN guarded segment
(`guardedReadFile(ctx.logsRoot, [cycleId, 'events.jsonl'])`) rather than folding
it into a root. Moving the function between packages changes none of that — the
same reasoning now lives one rank lower, where more callers can reach it without
importing upward.

`isSafeRunId` moved in the same commit and is NOT in this table: it is a charset
predicate with no fs sink at all.

### M4-projects — "Rebuild contract" becomes bridge-reachable (`packages/projects/reset.ts`, four sink pairs, all guard-terminal, no new mechanism)

S3 (1.0.md §3): `packages/projects/routes.ts` gained two new rows, `POST
/api/studio/projects/:id/contract-reset` (dry-run) and `.../contract-reset/apply`
(apply), both dispatching into a new `packages/projects/bridge-studio-project-reset.ts`,
which calls `reset.ts`'s `computeContractDrift`/`applyContractReset` — code that
already existed (a prior PR) and was already exercised only via `forge project
reset` (`apps/forge/cli.ts` → `cmdProjectReset`), never via an HTTP route. Wiring
it into the route table makes `reset.ts` reachable from a bridge route for the
FIRST time, so `check-request-path-sinks.mjs` reports four (file, sink) pairs
as NEW rather than grown: `mkdirSync` (0→2), `readFileSync` (0→1), `statSync`
(0→1), `writeFileSync` (0→1). **No new write mechanism was introduced by this
carve** — `reset.ts` itself is unchanged; only its reachability grew, exactly
the "M2 — the `@forge/kernel` move" and "M4 PR 4b" precedent above (a module
becoming visible to the scan is not the same finding as a module growing a
new sink).

All four are **guarded `[read]`** — classified by reading `reset.ts`, not a
live repro (the mechanism is the SAME `resolveGuardedPath` choke point this
document already covers at dozens of other sites):

| sink | site | request-derived component | guard |
|---|---|---|---|
| `statSync` | `computeContractDrift` (`reset.ts:414`), `statSync(dir)` where `dir = resolve(projectDir)` | `projectDir` | The route handler (`bridge-studio-project-reset.ts`'s `resolveProjectRootForReset`) resolves the URL's `:id` segment via `resolveGuardedPath(projectsDir, [id])` FIRST — mirroring `cmdProjectReset`'s own resolution exactly (reset.ts's header explains why: `resolveGuardedPath`, never a lexical `startsWith` check) — and hands `computeContractDrift` the guard's `.realPath`, never the raw `id`. `statSync` here only confirms the ALREADY-GUARDED path is a directory; the CLI entry point (`cmdProjectReset`) does the identical resolve-then-stat. |
| `mkdirSync` ×2 | `ensureForgeSkillsDir` (`reset.ts:525`) and `applyContractReset`'s `.forge` ensure (`reset.ts:602`) | the project root (from the same guarded `:id` resolution above) | Both calls run on `guarded.realPath` / `forgeDirGuard.realPath` — `resolveGuardedPath(dir, ['.forge','skills'])` / `resolveGuardedPath(dir, ['.forge'])`, `dir` already the guard-terminal project root. Guard-terminal on its face (nothing but a `PathGuardOk` carries `.realPath` here). |
| `readFileSync` | `applyContractReset` (`reset.ts:584`), reading the existing `.forge/project.json` before merging | the project root | `guarded.realPath` from `resolveGuardedPath(dir, PROJECT_CONFIG_REL_PATH.split('/'))` — same pattern. |
| `writeFileSync` | `applyContractReset` (`reset.ts:608`), writing the merged `.forge/project.json` | the project root | Same `guarded.realPath` the read above validated; the write never re-derives a path from the request. |

`check-raw-fs-guarded.mjs` (the dataflow-aware sibling this ratchet explicitly
defers to — see this doc's own intro) already reported **0 unguarded** with
these four sites in scope, confirming the classification rather than
substituting for it. `scripts/request-path-sinks.baseline.txt` accepts the new
counts via `--write` in the same PR that adds this section, per this
document's own rule ("When `check-request-path-sinks.mjs` reports a new sink
or a new caller, add its row here").

### M4-agents — bead `forge-8vfn.5.22`: the eleven agent-adapter rows, classified

**Why these eleven were never classified.** The adapters (`packages/agents/_adapters/*`) and the Ralph
runtime (`packages/agents/ralph/*`) entered this ratchet's scope only at M3, when the per-spawn runtime
was carved into `packages/agents` and became reachable from a bridge route. They arrived as eleven
`(file, sink, count)` rows with no verdict beside them — a baseline that records a shape and asserts
nothing about it. This section is the missing verdict, read at each call site on 2026-09-04.

**The finding that shapes every row: none of these eleven sinks takes a path from a request.** They take
a path from the RUN — the worktree the dispatch created — or from a closed set of literals. The
containment question at this seam is therefore not "is the URL segment guarded" (there is no URL segment)
but "is the run's own root the one the dispatch chose", which is bead `5.37`'s question and was closed in
s1 by pinning cwd and re-anchoring `FORGE_ROOT` on kernel's.

| # | row | site(s) | what actually reaches the sink | verdict |
|---|---|---|---|---|
| 1 | `_adapters/aider/index.ts execFile 1` | `:158` | `AIDER_BIN` + `AIDER_BASE_FLAGS` (module constants), `--model <model>`, `--message <message>` — `message` is prompt TEXT already read into memory. `cwd: worktreePath` | **`[exec]` argv form, no shell.** No path occupies an argv position at all; the only path is the `cwd`, which is the run's own worktree. |
| 2 | `_adapters/aider/index.ts execFileSync 4` | `:205` `--version`; `:291` `git rev-parse --verify <candidate>`; `:312` `git diff --name-only <baseBranch>...HEAD`; `:323` `git status --porcelain` | `candidate` iterates the literal `['main','master']`; `baseBranch` is `resolveBaseBranch`'s return, which is one of those same two literals or a throw | **`[safe-const]`.** A closed literal set — no external value reaches argv. |
| 3 | `_adapters/aider/index.ts readFileSync 1` | `:345` | `promptPath` from the `AgentInvocation` contract, built by the Ralph runner as `join(input.worktreePath, 'PROMPT.md')` | **`[read]` run-derived root, FIXED leaf.** |
| 4 | `_adapters/gemini/index.ts readFileSync 1` | `:409` | same `promptPath` contract | **`[read]`** — same as #3. |
| 5 | `ralph/claude-agent.ts readFileSync 1` | `:223` | same `promptPath` contract | **`[read]`** — same as #3. |
| 6 | `ralph/claude-agent.ts existsSync 1` | `:510` | `extractPath(input)` where `input` is **the agent's own tool-use payload** | **`[unver]` — the one row here that is not run-derived, and it is stated rather than absorbed.** This is the only sink in the eleven whose path comes from the AGENT. It is an existence probe and nothing else: the boolean picks the label `'modify'` vs `'add'` for a `file_change` event. No content is read, nothing is written, and the path is not re-used downstream. The exposure is therefore a mislabelled history row, not a filesystem reach — but it is agent-controlled input reaching `existsSync`, and a future edit that used `filePath` for anything more would change that without touching this line. |
| 7 | `ralph/runner.ts existsSync 3` | `:373`, `:386`, `:395` | `join(input.worktreePath, 'PROMPT.md' \| 'AGENT.md' \| 'fix_plan.md')` (`runner.ts:191-193`) | **`[safe-const]` leaf, run-derived root.** Each leaf is a hardcoded literal. |
| 8 | `ralph/runner.ts readFileSync 3` | `:374`, `:387` co-located `*.tmpl`; `:383` `input.workItemSpecPath` | the two templates resolve through `join(import.meta.dirname, …)` — reading files that ship BESIDE the module, which is correct usage and not root arithmetic; `workItemSpecPath` is manifest-declared | **`[read]`**, and the `import.meta.dirname` use here is deliberately distinguished from the depth-coupled `'..'` chains bead 5.37 removed: it never walks upward. |
| 9 | `ralph/runner.ts writeFileSync 3` | `:375`, `:388`, `:396` | the same three fixed leaves under the run's worktree | **`[write]` run-derived root, FIXED leaf.** |
| 10 | `ralph/stop-conditions.ts execFileSync 9` | `:292` `git -C <worktreePath> rev-parse`; `:436` `execFileSync(head, rest, { cwd: worktreePath })`; `:572`/`:574`/`:577` status/add/commit; `:597` diff; `:623` rev-parse; `:665`/`:671` count/diff | `head`/`rest` are `const [head, ...rest] = cmd` where `cmd: readonly string[]` — an **already-tokenised** gate command from the work item | **`[exec]` argv form, no shell.** The gate command is declared data, split before it arrives; nothing is interpolated into a shell string, so there is no injection position. |
| 11 | `ralph/stop-conditions.ts readFileSync 2` | `:289` `resolve(worktreePath, 'secrets.env')`; `:296` `resolve(mainRoot, 'secrets.env')` | a FIXED leaf under a run-derived root, and under the main checkout root discovered via `git rev-parse --git-common-dir` | **`[read]`, and the most sensitive row of the eleven** because the file is credentials. Both roots are run/repo-derived and the leaf is constant, so no caller can redirect the read; the row is recorded here so that a future change making either root caller-supplied is visibly a change to a credential read. |

**What this section does NOT claim.** It is a reading of eleven call sites, not a dataflow proof — the
same limit this document's own intro states for every table in it. `check-raw-fs-guarded.mjs`, the
dataflow-aware sibling, reports these files' residual unchanged and **0 unguarded**; that corroborates
the classification rather than substituting for it. Row 6 is left `[unver]` on purpose: "an existence
probe is harmless" is an argument about today's use of the boolean, not about the input, and this
document's job is to record the input.

### Relocated in M4-sessions s5 — the demo generation snapshot store (one sink pair, no new surface)

The row-37 affordance carve moved the demo kind's two generic-affordance arms
into `packages/sessions/kinds/demo-builder.ts`, which would have crossed the
800-line cap; the split it carries (ruling 87 clause 2) takes the on-disk
generation layout — `DEMO_KIND_DIR`, the `generations/<n>/` filenames, and the
three guarded readers/writers that walk them — into
`packages/sessions/kinds/demo-session-store.ts`.

**One pair moves, and the census is conserved**, which is the reading that
matters here (§15.73): `packages/sessions/kinds/demo-builder.ts mkdirSync`
falls **5 → 4** and `packages/sessions/kinds/demo-session-store.ts mkdirSync`
rises **0 → 1**. Host-minus-package on this PR is **zero** — no sink was added,
removed, or re-shaped.

The site itself is unchanged and still guard-terminal:
`guardedGenerationWritePath` resolves the leaf through `guardedFile(root, segs,
'write')`, THROWS when the leaf escapes (fail closed, the runner contract), and
only then `mkdirSync`s the parent of a path the guard has already accepted. The
`mkdirSync` never sees a request-derived string the guard did not resolve.

### M4-flows PR 4 — ten rows made VISIBLE by giving the two lints one entry seed (beads 5.34 / 5.48)

No sink moved, changed shape or was added. Ten `(file, sink)` rows appear
because `check-request-path-sinks.mjs` could not previously **see** the modules
they live in.

The two sibling request-path lints derived their scope from the same function,
`listEntryModules`, and that function read one hand-written tree name: every
`ui-bridge.ts` / `bridge-*.ts` under `cli/`. Two consequences, both measured on
`85351d12`:

- **A module no bridge module imports was invisible to this lint no matter how
  many sinks it grew.** `check-raw-fs-guarded.mjs` compensated with its own
  `EXPLICIT_MODULES` hand list, so the two lints disagreed about their own
  scope by exactly **four of that list's thirty modules** — `agent-run.ts`,
  `agent-dispatch-cmd.ts`, `find-session-project.ts` and
  `kinds/project-brain.ts`. A planted sink in `agent-run.ts` fired on one lint
  and not the other, on the same line. That is bead `forge-8vfn.5.48`.
- **The seed was one carve away from emptying itself.** `listEntryModules`
  returned four modules, all under `cli/`, and the M4 host carve moves all four
  into `apps/forge/`. Because this lint fails only on GROWTH, the seed going to
  zero would have taken 605 rows to 0 and still reported PASS. That is bead
  `forge-8vfn.5.34`, and it is why the fix had to land before the carve.

The seed is now derived from three sources, none of them a hand-written
directory list: the bridge host in whichever of `cli/` or `apps/forge/` holds
it; every `packages/<pkg>/routes.ts`, found by globbing `packages/`, so a
package that carves its routes tomorrow is picked up with no edit to the
script; and one `DISPATCH_ENTRY_MODULES` declaration for the CLI dispatch
entries, consumed by **both** lints so they cannot drift apart again. Entry
modules go 4 → 12 and reachable modules 295 → 303.

| file | sinks now baselined | classification |
|---|---|---|
| `packages/agents/agent-dispatch-cmd.ts` | `existsSync` 3, `realpathSync` 5, `statSync` 2 | already audited under the full model by `check-raw-fs-guarded` (`EXPLICIT_MODULES`), 0 unguarded — the CLI dispatch entry's `--project` id rides `resolveGuardedPath` as a segment `[read]` |
| `packages/agents/agent-run.ts` | `existsSync` 2 | already audited, 0 unguarded — bead 5.48's named module `[read]` |
| `packages/agents/find-session-project.ts` | `existsSync` 3, `readdirSync` 1, `statSync` 1 | already audited, 0 unguarded — boolean `status.json` / `PLAN.md` probes under a `readdir`-enumerated `projects/*` `[read]` |
| `packages/sessions/kinds/project-brain.ts` | `mkdirSync` 1 | already audited, 0 unguarded |
| `packages/agents/band-agent-run.ts` | `existsSync` 3, `readFileSync` 1 | **newly audited by anything** — see below |

**Nine of the ten belong to modules `check-raw-fs-guarded` has been auditing
all along with zero unguarded findings, so they are counts, not new risk.**

`packages/agents/band-agent-run.ts` is the exception and the reason this PR is
worth reading twice: it is reachable from `agent-run.ts`, so the shared seed
brings it into tier-1 scope, and it had been in **neither** lint's full model.
Under that model its two `existsSync` sites read as tainted via `initiativeId`.
They are **accidentally-safe**, and the classification was reached by reading
the code rather than by assuming the count was benign:

- `SAFE_INITIATIVE_RE` (`band-agent-run.ts:75`) is
  `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, and `:196` **throws** on a miss before
  either join is reached. That class requires a leading alphanumeric and admits
  no path separator, so `..`, `.`, `a/b` and any absolute path are all
  rejected — probed against the real regex, not inferred from its name.
- `dir` on both lines comes from the config-derived queue paths
  (`paths.inFlight` / `pending` / `readyForReview` / `failed` / `done` /
  `merged`), never from the caller, and the leaf is always `<id>.md`.

Both are recorded as audited residuals in `check-raw-fs-guarded.mjs`'s
allowlist (residuals 91 → 93, each with the reason above) rather than fixed,
because `packages/agents/band-agent-run.ts` is agents-owned by `QUARRY.md` and
a flows lane may not edit it beyond a repoint. The structural fix — route both
through `guardedFile(dir, [`${initiativeId}.md`], 'read')`, so the invariant is
held by the guard rather than by a regex three hundred lines up — is filed for
its owner.

**Scope conservation, asserted rather than assumed** (§15.85: a scanner's count
falling after a pure move is the blinded-scanner tell): `check-raw-fs-guarded`
goes 79 + 384 → 80 + 383. Exactly one module crossed from the tier-2 sweep into
the tier-1 full model, it is named above, and the **total scanned is conserved
at 463**.

### M4-flows Task 13 — one baseline row RE-KEYED, no new sink surface

The Flow kind's registry moved out of `orchestrator/studio/registry.ts` into
`packages/flows/studio/flow-registry.ts` (ADR 028 §1: the package that owns the
flow engine owns loading its definitions). `listFlowIds`'s `readdirSync` is the
only raw-fs sink in the moved block and it is byte-identical.

| was | is now | sink | why it moved |
|---|---|---|---|
| `orchestrator/studio/registry.ts` | `packages/flows/studio/flow-registry.ts` | `readdirSync` 1 | the Flow kind is flows'; the scan is `studio/flows/*` under a caller-supplied `forgeRoot`, unchanged |

Measured with `node scripts/check-request-path-sinks.mjs`: main at `92c388a7`
reports **309 reachable modules / 603 (file,sink) rows / 1,364 calls / baseline
604 lines**; this branch reports **310 / 603 / 1,364 / 604**. Rows and calls are
IDENTICAL — the row changed path and nothing else. The single reachable-module
increase is the new file itself; `registry.ts` stays reachable as a re-export
hub until the host carve deletes it.

Accepted by hand-editing the one affected line, NOT by `--write`: the checker
also reports two tightenable lines in `packages/sessions/studio/session-kinds.ts`
(`existsSync 1 → 0`, `readFileSync 2 → 1`) from sessions' #369, and `--write`
would sweep another lane's slack into this PR (bead `forge-8vfn.5.19`). The
baseline stays in `LC_ALL=C` order (#365).

### M4-flows Task 9 — one baseline row RE-KEYED, no new sink surface

`orchestrator/flow-runner.ts` was carved into `packages/flows/flow-runner.ts`
(QUARRY owns it to `flows`, disposition `rewritten`). One `(file, sink)` row
changed path and nothing else.

| was | is now | sink | why it moved |
|---|---|---|---|
| `orchestrator/flow-runner.ts` | `packages/flows/flow-runner.ts` | `readFileSync` 1 | the runner is flows' runtime; `SPEC.md` §2 puts the Station engine in the package, and the move is what lets it stop importing `orchestrator/` |

**The proof that this is a re-key and not growth is the guard's own totals,
re-derived from the checker rather than quoted: 604 `(file, sink)` rows and
1,366 sink calls, unchanged across the move.**

> **Correction (M4-flows s2).** This paragraph first read "605 rows and 1,371
> sink calls before, and 605 / 1,371 after". Neither figure was measured on the
> tree the sentence describes.
>
> - **605** was `wc -l` of the baseline FILE, not a row count. At `544f6621` one
>   of its lines, `packages/sessions/kinds/architect-plan.ts existsSync 4`, had
>   matched nothing live since sessions' #362 and was reported as tightenable, so
>   the checker found **604** rows against a **605**-line baseline. Sessions' #366
>   has since harvested that line: at `4b337b69` the baseline is **604** lines and
>   the row count is unchanged at **604**.
> - **1,371** was measured during M4-flows PR 4 and carried forward without
>   re-deriving. The #362 fix (`existsSync 4 → 0`, `mkdirSync 2 → 1`) took the
>   call total to **1,366**, where it remains.
>
> The conservation CLAIM was and is true — the row changed path and nothing else
> — but the evidence quoted for it came from two different trees. Measured with
> `node scripts/check-request-path-sinks.mjs`: at `544f6621`, **304 reachable
> modules / 604 rows / 1,366 calls / baseline 605 lines**; at `4b337b69`,
> **308 / 604 / 1,366 / baseline 604** — the reachable count and the baseline
> move with other lanes' carves, the two invariants do not. Quote the invariant
> and the SHA it was measured at, never a bare absolute.
>
> Also recorded here so the next lane does not revert it: **#365 re-sorted
> `scripts/request-path-sinks.baseline.txt` into `LC_ALL=C` order.** A re-sort
> under a different locale is a whole-file diff that hides the real change.

Reachable modules go 303 → 304: `packages/flows/flow-fanout.ts`, the fan-out
predicate extracted from `orchestrator/studio/validate.ts` in the same move, is
now reachable from the runner. It carries no fs sink, so it adds no row.

The classification is unchanged and is restated rather than assumed: the read is
`flowPathForId`'s `<forgeRoot>/studio/flows/<flowId>/flow.yaml`, where `flowId`
is a registry-resolved flow id and the root is now kernel's `FORGE_ROOT` rather
than a hand-counted `'..'` chain — strictly tighter than before the move.

### Relocated in M4-sessions s6 (exit row 5, PR B1) — four splits, nine sink pairs, no new surface

Four `packages/sessions` production files came under the 800-line cap by
splitting along the one cycle-free seam each had. Nine `(file, sink)` pairs move
with the code they belong to; **not one sink is added, removed or re-shaped**:

```
bridge-studio-sessions.ts   readdirSync 1 -> 0      session-resolution.ts            readdirSync 0 -> 1
interactive-runner.ts       lstatSync   1 -> 0      interactive-agent-step.ts        lstatSync   0 -> 1
interactive-runner.ts       mkdirSync   2 -> 0      interactive-agent-step.ts        mkdirSync   0 -> 2
interactive-runner.ts       readdirSync 1 -> 0      interactive-agent-step.ts        readdirSync 0 -> 1
interactive-runner.ts       readFileSync 2 -> 0     interactive-agent-step.ts        readFileSync 0 -> 2
interactive-runner.ts       rmSync      1 -> 0      interactive-agent-step.ts        rmSync      0 -> 1
session-transcript.ts       readdirSync 2 -> 0      session-artifact-derivers.ts     readdirSync 0 -> 2
session-transcript.ts       readFileSync 1 -> 0     session-artifact-derivers.ts     readFileSync 0 -> 1
session-transcript.ts       realpathSync 6 -> 0     session-artifact-derivers.ts     realpathSync 0 -> 6
```

**Total sink CALLS are conserved exactly: 1,366 at merged main, 1,366 here** —
the reading that matters (§15.73), because a "verbatim" move that quietly copies
rather than moves shows up here and nowhere else. Reachable modules 304 → 308
and `check-raw-fs-guarded`'s sweep 376 → 380: the four new modules in both, which
is the direction §15.85 asks for. `(file, sink)` rows are 604 on both sides; the
full-model tier stays at 80 modules and the allowlisted residual at 91, unmoved.

Every figure was measured on a disposable worktree at merged main and on this
head, and measured FOUR times, because four sibling merges moved the ground
under it while this one PR was in flight:

| measured at | calls | modules | raw-fs sweep | staled by |
|---|---|---|---|---|
| `b3f728c0` | 1,349 | 295 → 299 | — | flows #359, #363 |
| `79462612` | 1,366 | 303 → 307 | 383 → 387 | flows #365 |
| `d99afd04` | 1,366 | 304 → 308 | 384 → 388 | flows #367 |
| `544f6621` | **1,366** | **304 → 308** | **376 → 380** | current |

The invariants never moved: calls conserved, rows equal, +4 modules and +4 swept
for the four new files. Only the absolutes did. A conservation claim re-based
rather than re-measured proves conservation against a tree that no longer
exists (§15.88, §15.105 — the sibling-merge rule reaches a lane's measurements,
not only its pins).

The six `realpathSync` calls are `safeReadFileInSession`'s realpath-guarded
choke point. It travelled with the derivers because eleven call sites in that
module use it; it remains the ONE guarded read path for a session dir, and the
parent imports it back rather than growing a second one.

#### A stale-loose ratchet on the file this PR splits, closed in passing

Two baseline rows for `kinds/architect-plan.ts` — `existsSync 4` and
`mkdirSync 2` — described a file that has had **0 and 1** since #362 replaced the
archive helper's raw calls with `resolveGuardedPath`. #362 tightened the code and
left the ratchet loose; the checker reports that as `tighten:`, which does not
fail, so it survives every gate. The rows now read the truth (`existsSync`
deleted, `mkdirSync 1`), and the baseline's 605 lines become 604 — exactly the
604 rows the scanner finds, so declared and measured agree for the first time.

**Why it is fixed here rather than filed:** a ratchet that permits four
`existsSync` calls in a file containing none will pass a regression that adds
four. Proven, not asserted — the same planted regression (one raw `existsSync`
on a `sessionId`-derived path inside `archiveSessionDir`) run against both
baselines: **tightened → FAIL** (`existsSync: baseline 0 -> now 1`, exit 1);
**loose → PASS** (exit 0, reported only as a `tighten:` hint). Recording that as
a residual for a later session, on the one file this PR is splitting, is the
declared-data-fails-open shape ruling 102 was written for. No code changed.

### M5-A — one new sink, guarded at the sink: `git check-ignore` for ADR 051's third `creates:` rule

| file | sink | count | classification |
|---|---|---|---|
| `packages/flows/phases/gitignored-creates.ts` | `spawnSync` | 1 | **guarded** |

**What the sink is.** ADR 051 decision 5 adds a third `creates:` rule to the
ADR 037 spec compiler: a path under a gitignored directory can never appear in
the diff the required-paths check reads, so that check passes on its *absence*
and the work is graded done against invisible evidence. Answering "does git see
this path?" means running `git -C <worktree> check-ignore --stdin`, and
`<worktree>` reaches the compiler from a manifest — request-derived.

**Why it is `guarded`, and guarded HERE.** The module calls
`isContainedWorktreePath` — the same predicate `writeManifest`'s choke point
uses — before it spawns anything, and an uncontained root yields the EMPTY set,
so the rule declines rather than running git in a directory nobody sanctioned.
The check lives at the sink rather than only at the caller deliberately: a
caller-side check protects today's caller, and this module's next caller would
inherit nothing. Proven by a test that hands the module a REAL repository
outside the sanctioned roots whose `.gitignore` would otherwise match, and
asserts the empty set.

**The paths themselves are not an argv surface.** They go to git over STDIN, so
a `creates:` entry beginning with `-` is a pathname to `--stdin`, never an
option. That is why the batched `--stdin` form was chosen over one
`check-ignore -q <path>` per entry — one process for a set of any size, and no
path ever reaches argv.

### Relocated in M5-A — `project-manager.ts` split under the 800-line cap (six sink pairs, no new surface)

| file | sink | before | after |
|---|---|---|---|
| `packages/factory/phases/project-manager.ts` | `existsSync` | 3 | 1 |
| `packages/factory/phases/project-manager.ts` | `readFileSync` | 4 | 2 |
| `packages/factory/phases/project-manager.ts` | `readdirSync` | 1 | **row deleted** |
| `packages/factory/phases/project-manager.ts` | `writeFileSync` | 2 | 1 |
| `packages/factory/phases/pm-prompt-context.ts` | `existsSync` / `readFileSync` / `readdirSync` | — | 2 / 2 / 1 |
| `packages/factory/phases/pm-decomposition-doc.ts` | `writeFileSync` | — | 1 |

**No new surface — every pair is CONSERVED across the move**, and the arithmetic
is asserted per sink rather than eyeballed: `existsSync` 3 = 1 + 2,
`readFileSync` 4 = 2 + 2, `readdirSync` 1 = 0 + 1, `writeFileSync` 2 = 1 + 1.
The checker's own total agrees — **1,365 sink calls before and after**. The
`readdirSync` row is DELETED from the parent rather than left at zero, because a
ratchet that permits a call in a file containing none will pass a regression that
adds one (ruling 102's shape).

**Why the file was split at all:** `project-manager.ts` stood at 859 against the
800-line cap with a baseline exemption, and M5-A exit row 8 requires it split by
concern, *never baselined*. The two seams are one-way and read in one direction:
`pm-prompt-context.ts` is what the PM prompt is BUILT FROM (the worktree reads
and the brain read, before the turn), `pm-decomposition-doc.ts` is the artifact
the pass WRITES after its set is validated. **The file-size exemption is deleted,
not re-keyed** — the file is 687 lines and the baseline drops from 66 rows to 65.

### Guarded in M5-A (spec §5 item 1) — the class's merge-boundary VERB becomes bridge-reachable

Three new `(file, sink)` pairs, and the growth is a real new capability rather
than a widened rule: the merge boundary now runs the initiative's CHANGE CLASS's
verb, so `docs` initiatives are checked by `forge gate docs` over the markdown
their own branch changed. `packages/factory/gates/docs-gate.ts` existed and was
reachable only from the CLI; wiring it into `executor-deps.ts` puts it on a
bridge-reachable path for the first time.

| site | sink | request-derived input | class | guard |
|---|---|---|---|---|
| `packages/factory/phases/merge-boundary.ts` | `execFileSync` | `input.worktreePath` as `cwd` | guarded `[exec]` | fixed argv (`git diff --name-only main...HEAD`), no request-derived argument; `cwd` is the cycle's own worktree, the same shape `phases/integrate.ts`'s `gitCapture` already carries |
| `packages/factory/gates/docs-gate.ts` | `existsSync` (2) | the markdown paths in the branch diff | guarded `[read]` | every path is resolved by `changedMarkdownFiles` through `guardedFile(worktreePath, rel.split('/'), 'read')` — the worktree is a FIXED root, each path segment is its own element, and a path that will not resolve inside it is DROPPED rather than read. The gate is only ever handed an already-contained absolute path |
| `packages/factory/gates/docs-gate.ts` | `readFileSync` (1) | as above | guarded `[read]` | as above; the same resolution, one call site upstream, so the gate has no unguarded entry point of its own |

**Why the guard is upstream rather than inside the gate.** `docs-gate.ts` is also
the CLI verb's implementation (`forge gate docs <path...>`), where the paths are
the operator's own argv and a worktree root does not exist. Pushing containment
into the gate would mean inventing a root for the CLI case; resolving at the one
bridge-reachable caller keeps the gate a pure checker and puts the guard where
the untrusted root actually is.
