# Request-derived filesystem path audit

*Reference.* A finite enumeration of every filesystem read/write in `cli/` and `orchestrator/` whose path derives, in whole or in part, from request data — each one classified `guarded` / `unguarded` / `accidentally-safe`.

**Why this document exists.** Between 2026-07 and 2026-08 the same defect was found ten separate times across six initiatives, always opportunistically: a lexical `resolve(base, id).startsWith(base + sep)` containment check on an *unresolved* path. That shape is worthless — `resolve()`/`join()` normalise `..` before the comparison ever runs, and a symlink's own on-disk location is lexically inside the allowed root even when it points somewhere else entirely. Ten instances found by luck means discovery was luck-driven and the class was open-ended. This table closes it: the set of request-derived path sites is now enumerated, so the question "have we found them all?" has an answer that is checked rather than hoped.

The guard those fixes converge on is [`cli/studio-path-guard.ts`](../cli/studio-path-guard.ts). Read its module docstring before using this table — in particular the **CONTRACT** section, which defines the *root-folding* bypass, and the escape-shape catalogue this document classifies against.

## Escape shapes

| Shape | Mechanism |
|---|---|
| dir symlink | `<root>/<id>` is itself a symlink pointing outside the root |
| file symlink | the containing directory is real; the leaf file is a symlink |
| cross-object | `<id>` symlinks to a **different real object under the same root** — every "is it under root" check reports this as contained while the wrong object is read or overwritten |
| hardlink leaf | a genuine non-symlink directory entry sharing an inode with an outside file; `realpathSync` is structurally blind to it |
| `..`-normalisation | traversal segments in the id |
| escape-and-return | a string that leaves the root and comes back |
| **root-folding** | an untrusted id concatenated into a guard's `root` argument instead of passed as its own `segments[]` element. `root` receives **no** identity check, so this is a total bypass — the "guard that cannot fail" shape relocated to the root parameter |

## How to read the classifications — and what is actually verified

Three labels, applied strictly:

- **`guarded`** — a guard is named, *and* an input exists that makes it return false. **A guard that cannot fail is not a guard**: if no rejecting input can be constructed, the site is classified `unguarded`, however defensive the code looks.
- **`unguarded`** — no effective containment. This includes every lexical `resolve(...).startsWith(...)` check on an unresolved path.
- **`accidentally-safe`** — reachable, but blocked by a side effect of unrelated code. **The accident is always named.** These are the most fragile rows in the table: nothing about the blocking code is aware it is load-bearing for security, so an unrelated refactor can silently remove the protection.

**Verification status is not uniform, and the difference matters.** Rows are marked:

- **`[exec]`** — an escape was **executed live** against the real HTTP route with byte-level filesystem assertions. Not reasoned about. These live in `cli/bridge-studio-kbs-containment.test.ts`, `cli/bridge-studio-sibling-containment.test.ts`, `cli/bridge-studio-flow-trigger-oracle.test.ts`, `orchestrator/brain-paths-containment.test.ts`, and (from earlier initiatives) `cli/bridge-studio-write.test.ts` / `cli/bridge-studio-flows.test.ts`.
- **`[read]`** — classified by reading the code and its call chain. Structurally sound, but **no live repro was executed**. A `[read]` row is a lead, not a proven exploit.
- **`[unver]`** — could not be definitively classified. **Never treated as safe.**

No row is marked safe on the strength of an argument alone. Where a site was believed safe but not tested, it is `[unver]`.

**Failure-behaviour claims are `[exec]`-only** (SEC-03, adopted after three
consecutive adversarial rounds each found a false claim in THIS document, and all
three were about the same thing — what happens on failure). Any claim that a site
*fails closed*, *refuses*, *does not write*, *is caught*, *rejects before the
write*, or *is already guarded by a sibling* must carry `[exec]` and be verified
by execution — a **pre-fix file swap** (`git show <base>:<path>`, re-run, observe
which mechanism actually fires) or a live probe. Never `[read]`. Reading code
tells you what a function *intends*; only execution tells you what its CALLER
does with the throw. The three false claims were: a filed row still marked
`unguarded` after R4-16 had fixed it; "all four now fail containment on their
own", disproved by a pre-fix swap that showed those ATs passing byte-identically
against the old code; and a claimed fail-before-write parity that in fact left a
half-created project on disk while the API said 400.

**A row's marker certifies the CLAIM THAT EARNED IT, not every sentence in the row.** Rows here are long, and a `[read]`/`[exec]` tag sits at row granularity while the prose makes several independent claims. SEC-03 round 4 found a failure-behaviour claim that survived the first retroactive sweep for exactly this reason: it sat inside a row whose `[exec]` tag had been earned by a *different* claim, so a per-row-tag sweep never looked at it. **Failure-behaviour claims are therefore verified PER CLAIM**, and a sweep that filters on row tags is not a sweep.

Applied retroactively: the `[read]` rows below that make a failure-behaviour
claim are **`orchestrator/studio/hook-library.ts:164-198`** (rejects literal and
percent-decoded traversal), the **`INIT_ID_RE`/`SAFE_CYCLE_ID_RE` charset rows**
(`enqueue-flow-run`/`enqueue-plan-run`/`bridge-studio-runs`,
`review-comments.ts`), **`cli/bridge-studio-writes.ts:199-201`** (404 before any
fs call), and **`cli/bridge-studio-kbs.ts:788-794`** (`resolve(file) !== file`
rejects). Each states a *rejecting input exists*, which is the classification
bar, but **none has had its caller's handling of that rejection executed** — so
the rejection is `[read]`-verified and the FAILURE HANDLING around it is
explicitly **unverified**, not safe. They are listed here rather than
individually re-marked so the omission is visible in one place instead of being
spread across rows where a reader would have to notice its absence.

## Summary

**A ROW is the auditable unit.** Where several `file:line` locations share one
mechanism and one fix, they are listed inside a single row — the `file:line`
column names each of them. These counts are row counts, so they can be checked
against the tables by counting; a count of line references could not be.

| | Rows |
|---|---|
| Classified rows below | 55 |
| — `guarded` | 14 |
| — fixed in this sweep (all were `unguarded`) | 12 |
| — fixed later in SEC-02 (`forge-d1f`) | 3 |
| — fixed later in R4-16 (the four `/start` routes' `projectRepoPath`) | 1 |
| — fixed later in SEC-03 | 4 |
| — guarded, new in R4-17 (the onboarding session's contract-stages surface) | 2 |
| — `unguarded`, filed for follow-up | 10 |
| — `accidentally-safe` (accident named on each) | 9 |
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
| `cli/bridge-studio-writes.ts:337,586` | `mkdirSync`/`writeFileSync` | `PUT /api/studio/agents/:slug` param `slug` | guarded `[exec]` | `resolveGuardedPath(toSkillsDir(forgeRoot), [slug,'SKILL.md'])`. Rejects: symlinked `skills/<slug>` dir or leaf, cross-agent symlink, hardlinked `SKILL.md` (`nlink!==1`), dangling symlink at any segment. |
| `cli/bridge-studio-writes.ts:801,880` | `writeFileSync` | `PUT /api/studio/projects/:id` | guarded `[exec]` | `resolveGuardedPath(projectRoot, ['.forge','project.json'])`; `projectRoot` is disk-scanned by `discoverProjects`, `id` only *selects* it and is never folded into the root. |
| `cli/bridge-studio-writes.ts:923,1048` | `writeFileSync` | `PUT /api/studio/flows/:id` | guarded `[exec]` | Same guard, root `studio/flows`. |
| `cli/bridge-studio-skills.ts:136,147` | `mkdirSync`/`writeFileSync` | `POST /api/studio/skills` body-derived `slug` | guarded `[exec]` | Same guard, root `skills/`. |
| `cli/bridge-studio-instructions.ts:85` | existence probe only | `POST /api/studio/agents/:slug/instructions-draft` | guarded `[exec]` | Same guard; never reads content past the check. |
| `cli/materials-staging.ts:74,75` (`stageMaterials`) | `mkdirSync`/`writeFileSync` | `POST /api/agents/:slug/run` body `materials[].filename` | guarded `[exec]` | R6-04-F2 WI-1, the agent-kickoff upload seam. `resolveGuardedPath(runDir, ['materials', filename])` — `runDir` is trusted (config `logsRoot` + server-minted `runId`), and the untrusted `filename` is its OWN segment, never folded into the root. **Two-phase check-then-write**: phase 1 resolves and containment-checks every entry with zero side effects, phase 2 writes only after all pass, so a refusal on entry N leaves entries 1..N-1 unwritten. Refusal text names no filesystem path. Pinned by `cli/materials-staging.test.ts` (8 ATs) against a controlled `runDir`: directory-symlink, file-symlink and hardlinked-leaf all refused with the planted outside file byte-unchanged, plus the negative-space assertion that nothing is written on refusal. **Reachability, stated honestly:** those three plant shapes are NOT wire-reachable through this route today — `runId` is server-minted per request, so a caller cannot pre-plant anything under it; they are pinned at the unit level, where planting is possible. The precondition that would make them live is a route accepting a caller-supplied run id. Charset-wise the route's own `MATERIAL_FILENAME_RE` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`) already refuses every traversal shape before the guard is reached — the guard is the second layer, not the only one, and each layer is pinned separately rather than one being credited for the other's rejections. |
| `cli/ui-bridge.ts:1250` (`POST /api/agents/:slug/run`, materials branch) | `mkdirSync` | URL param `slug` → server-minted `runId` | guarded `[exec]` | R6-04-F2 WI-1. Creates the run's own directory (`join(ctx.logsRoot, runId)`) so staging has somewhere to write. Both components are trusted — `logsRoot` is config-derived and `runId` is `_agent-${slug}-${newRunStamp()}` where `slug` passed `SAFE_AGENT_SLUG_RE` **and** `resolveDispatchableAgent`. `isSafeRunId(runId)` is nevertheless applied defensively before the `mkdirSync`, mirroring the SAME check this file already runs on this SAME value at `spawnAgentDispatch` (~1789) and the run-status route (~1118) — **guard symmetry**, added after review found the new sink was the only one of the three to skip it. Not an exploitable hole either way; the value of the check is that a future edit to `newRunStamp()` or `SAFE_AGENT_SLUG_RE` cannot silently make this the one unguarded site. Refuses into the route's existing 500 path (a server-minted id failing its own safety check is a server anomaly, not operator error), never a 400. |
| `cli/ui-bridge.ts` (`GET /api/agents/runs/:runId`, run-existence check) | `existsSync` | URL param `runId` | guarded `[exec]` | R6-04 D22. Probes `<logsRoot>/<runId>` to distinguish "no such run" (404) from "a dispatched run whose first event has not landed" (200). `runId` IS request-derived here, and `isSafeRunId(runId)` charset-gates it earlier in the same handler (the pre-existing guard at ~line 1118, unchanged) — same treatment as the sibling routes in this file. Probe only: it reads no content and creates nothing. Existence-probe, not a write, so per this document's own rule the containment bar is the charset gate rather than a realpath identity walk. |
| `cli/bridge-studio-sessions.ts:150-169` | `realpathSync` ×2 | `GET /api/studio/sessions/:kind/:sessionId?project=` | guarded `[read]` | `resolveSafeSessionDir` realpaths both the parent and the candidate and compares resolved strings, scoped to the specific parent. Hardlink gap on the nested `status.json` is disclosed in that module's own header — a stated gap, not a silent one. |
| `orchestrator/studio/session-transcript.ts:149-171,189-213` | `readFileSync`/`readdirSync` | session dir from the guard above | guarded `[read]` | Real `realpathSync` containment on both dir and joined path; only fixed literal filenames accepted, never a client-supplied one. |
| `orchestrator/studio/hook-library.ts:164-198` | boundary + realpath | `hook.yaml`'s own `script:` field | guarded `[read]` | `resolveHookScriptPath` rejects literal *and* percent-decoded traversal. Note it does **not** protect against the hook *directory* being a symlink — that was a separate finding, fixed below. |
| `cli/bridge-studio-community.ts:349` | recursive read | `GET /api/studio/community/:kind/:id` | guarded `[read]` | `vendoredPackageDir` does a real realpath + boundary check on the id directory. |
| `orchestrator/enqueue-flow-run.ts:78`, `orchestrator/enqueue-plan-run.ts:84`, `cli/bridge-studio-runs.ts:678-717` | read/write | body `initiativeId` / `initiativeIds[]` | guarded `[read]` | `INIT_ID_RE = /^INIT-\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/` structurally forbids `/`, `\`, `.` — a genuine rejecting input exists. Charset-only: no realpath, so a *pre-planted* symlink at a validly-shaped id is not detected. |
| `orchestrator/review-comments.ts:79,94-105` | `readFileSync`/`writeFileSync` | `/api/review-comments/:cycleId` | guarded `[read]` | `SAFE_CYCLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/`, enforced twice. Charset-only, same realpath caveat. |
| `orchestrator/project-create.ts:115-167` | `mkdirSync`/`writeFileSync` | `POST` body `name`, `appType` | guarded `[read]` | `SLUG_RE` on the slugified name; `appType` must be a member of a `readdirSync`-derived allowlist. |
| `cli/bridge-studio-writes.ts:199-201` | `mkdirSync`/`openSync` | body `clauseId` | guarded `[read]` | Must equal a server-computed `report.clauses` entry; 404 before any fs call otherwise. |
| `orchestrator/studio/template-library.ts:519-531` | recursive read | `GET` scaffold `:id` | guarded `[read]` | `id` must match a name the server's own `listProjectStarters` `readdirSync` produced. |

### Fixed in this sweep

| file:line | op | request field | was | evidence |
|---|---|---|---|---|
| `orchestrator/brain-paths.ts:74` (`resolveKbBrainDir`) | `existsSync` | `:id` on every `/api/studio/kbs/*` route | unguarded `[exec]` | `resolve()` + `existsSync()`, no realpath, no identity, no `nlink`, on **both** candidate roots. The choke point for the whole KB family. Now `resolveGuardedPath` on each root with `kbId` as its own segment. |
| `orchestrator/kb-graph.ts` themes/`_raw`/`_guidance`/`INDEX.md`/node-leaf joins | `readdirSync`/`readFileSync` | `GET /api/studio/kbs/:id`, `/nodes/:nodeId` | unguarded `[exec]` | Bare `join()` off an unresolved kb dir. A **real** `brain/<id>/` whose `themes` was a symlink leaked outside theme bodies into the graph response. Now every nested join goes through a `guardedKbPath` helper. |
| `cli/bridge-studio-kbs.ts` guidance route | `mkdirSync`/`writeFileSync` | `POST /api/studio/kbs/:id/guidance` | unguarded `[exec]` | **Arbitrary file WRITE.** A real `brain/<id>/` with `_guidance ->` outside wrote the attacker's payload outside `brain/`, 200 OK. Both "guards" compared a string against itself. |
| `cli/bridge-studio-kbs.ts` bootstrap route | `writeFileSync` | `POST /api/studio/kbs/:id/bootstrap` | unguarded `[exec]` | **Arbitrary file CREATE.** `existsSync` is `stat`-based so a *dangling* `profile.md` symlink read as absent, and `writeFileSync`'s default `O_CREAT` (no `O_NOFOLLOW`) created the file at the outside path. The guard's probe is `lstat`-based, so a dangling link is now routed into the realpath check instead. |
| `cli/bridge-studio-kbs.ts` create / delete / nodes / detail routes | `mkdirSync`/`rmSync`/reads | `POST /api/studio/kbs`, `DELETE /:id`, `GET /:id`, `GET /:id/nodes/:nodeId` | unguarded `[exec]` | Vacuous `startsWith` checks at six locations across these routes plus guidance and bootstrap. Three built a `kbDir` the route never used and are **deleted** rather than kept as false assurance; the rest are **replaced** by a real guard. Each was verified genuinely vacuous before removal — SLUG_RE already forbids every character that could make the comparison false. |
| `cli/bridge-studio-writes.ts:1010` (`flowProjectOf`) | `readFileSync` | `PUT /api/studio/flows/:id` body `triggers[].target.ref` | unguarded `[exec]` | bd `forge-b2k`. **Existence oracle** (a read, not a write): `ref` comes from the request *body* and the route's `SLUG_RE` gate covers the URL param only. Now `SLUG_RE` + guard, with every rejection returning `undefined` so a rejected and an absent flow are indistinguishable — an oracle closes only when those two cases cannot be told apart. |
| `cli/bridge-studio.ts:618` | `readFileSync` | `GET /api/studio/flows/:id` | unguarded `[exec]` | Guard symmetry: the `PUT` sibling was hardened, this `GET` was not — a symlinked `studio/flows/<id>` disclosed an outside `flow.yaml`. |
| `cli/bridge-studio-skills.ts:230,269` | `readFileSync`, `approveSkillDraft` | `GET /api/studio/skills/:id`, `POST /:id/approve` | unguarded `[exec]` | **Arbitrary file WRITE** on the approve route: confirmed live mutating a `SKILL.md` outside the repo through a symlinked `skills/<id>`. Resolved via `skillPath()` = `assertSkillSlug` (charset only) + bare `join()`. |
| `cli/bridge-studio-hooks.ts:245,259-261,280,306,342` | `mkdirSync`/`writeFileSync`/`readFileSync` | `POST /api/studio/hooks`, `/:id/approve`, `/:id/override`, `GET /:id` | unguarded `[exec]` | **Arbitrary file WRITE** on create: confirmed live writing `hook.yaml` + `scripts/run.sh` into a symlinked outside dir. `hookDir`/`hookYamlPath` are `assertSkillSlug` + bare `join()`. |
| `cli/bridge-studio-kbs.ts:87-116` (`loadKbDescriptors`/`pushFrom`) | `existsSync`/`readFileSync` | `GET /api/studio/kbs` | unguarded `[exec]` | Found by the **attack-the-guard round**, after the fixes above had landed. `subDirs`' dirent filter blocks a symlinked kb DIRECTORY but says nothing about the LEAF: a genuinely real `brain/<id>/` whose `kb.yaml` was a symlink returned the outside file's `name`/`desc` verbatim in a 200. The sweep had closed every KB route except the list route, against the very file it was built to protect. Now guarded on both roots, with `INDEX.md` / `themes` / `_raw` independently guarded. |
| `cli/studio-path-guard.ts:213-272` | (the guard itself) | any caller with a multi-segment tail | unguarded `[exec]` | A defect **inside the ratified guard**, found by the attack round. `isSafeSegment` ran lazily inside the walk, but the walk BREAKS at the first absent segment and reassembles the rest with a bare `join()` — so segments past the break were never inspected and a later `..` was normalised away: `['idA','nonexistent','..','..','idB','kb.yaml']` returned `{ok:true, exists:false}` pointing at a **different, genuinely existing** object. Cross-object escape re-entering through create-mode, and it falsified the module's own comment. Check hoisted to cover all segments. Not reachable from any current call site — a latent defect in shared infrastructure, **not** a closed escape. |
| `orchestrator/studio/hook-scan.ts:364-367` (`readHookScriptBody`), `cli/bridge-studio-hooks.ts:119,303,335` | `readFileSync` | `GET /api/studio/hooks`, `POST /:id/approve`, `/:id/override` | unguarded `[exec]` | Two coupled faults, **not** disclosure — `loadHookDefinition` already rejects an escaping `script:`, and `sanitizeError` redacts paths. (1) The script read used a bare `join()`, so the dangling-symlink and hardlink shapes `resolveHookScriptPath` cannot see were unguarded. (2) `hookRunState` throwing for ONE hook inside the listing route's bare `.map()` blanked the operator's **entire** hook library behind a 500 — an element-level fault becoming a collection-level failure — while approve/override surfaced that same throw as a distinguishable 500 where every other route returns 404, a working oracle for "an id exists here and its script escapes". Read now guarded; per-entry fault isolation restored; oracle collapsed into 404. |

Each fix keeps the charset check as an independent **first layer** and adds containment as the second — the guard module deliberately never validates slug shape. Rejections collapse into the same 404 as a genuinely unknown object so the routes are not probes for which ids are planted.

### Unguarded — filed, not fixed (a different containment design is required)

| file:line | op | request field | class | evidence / why not mechanical |
|---|---|---|---|---|
| `cli/ui-bridge.ts:1533,1813,2261,2316` and ~14 sibling session routes | `mkdirSync`/`writeFileSync` | body `project`, `sessionId` | unguarded `[read]` | `architectSessionDir(projectsRoot, body.project, sessionId)` with only a truthiness check — `SAFE_PROJECT_NAME_RE` exists in the same file and is never applied. A `..`-bearing `project` escapes `projectsRoot` and `mkdirSync(recursive:true)` creates it. → bd `forge-28o` |
| `cli/ui-bridge.ts:1719-1720,2000-2001,2505-2506` (line numbers current as of SEC-03; the original audit's `1500,1774,2145,2210` shifted as R4-16 inserted code above them) | `existsSync`/`readFileSync` | `GET /api/architect/file/:project/:sid/:filename`, `GET /api/instructions/file/:project/:sid/:filename`, `GET /api/demo-builder/history/:project/:id` | unguarded `[read]` | Self-defeating idiom: `base` **and** `requested` are both built from the same unvalidated `project`/`sessionId` (`project`/`id` for the history route), so `requested.startsWith(base)` bakes the taint into both operands and cannot fail for traversal inside those segments — it CAN, correctly, fail for traversal inside the trailing `filename`/`id` component alone, which does NOT feed `base`. The guard must run on the *inputs*, not on two paths built from them. **`demo-builder fragment` (`/demo/` and `/fragment/`) is SPLIT OUT of this row** — SEC-03's Deliverable-B severity re-assessment (below) found it is a materially different, and worse, shape than this one, not an instance of it. → bd `forge-28o` |
| `cli/ui-bridge.ts:781,818,853,904,2468,2489` | `readFileSync`/`writeFileSync` | `GET /api/events/:cycleId`, `/graph/`, `/work-item/`, `/artifact/`, `POST /api/reflect/:cycleId/answer` | unguarded `[read]` | `cycleId` is `decodeURIComponent`'d with no validation on most of these (the `/artifact/` route alone charset-gates it). `POST /api/reflect/:cycleId/answer` is a **write**. → bd `forge-2zz` |
| `orchestrator/studio/skill-library.ts:500-537,613-631`, `orchestrator/studio/community-install.ts:163-176` | `readdirSync`/`writeFileSync` | `POST /api/studio/skills/install` body **`packageDir`**; community install | unguarded `[read]` | Two problems. (1) `packageDir` *is* the containment root — a raw client string with no allowlist tying it to any forge directory, so any server-local path can be named and copied into `skills/<id>/`. (2) The install loop writes N entries whose own relative sub-paths are joined onto the destination — the classic zip-slip shape, needing **per-entry** verification, not one call. → bd `forge-q80` |
| `cli/bridge-studio-kbs.ts:788-794` | spawn arg | `POST /api/studio/kbs/:id/maintenance` body `file` | unguarded `[read]` | Client supplies a full absolute path; `resolve(file) !== file → reject` blocks `..` but does no realpath. `segments[]` requires single-component names, so this needs a request-shape change (`{kbId, relPath}`), not a guard call. → bd `forge-2zz` |
| `cli/bridge-studio.ts:471`, `cli/bridge-studio-kbs.ts:151`, `cli/bridge-studio.ts:389` | `readFileSync` | `GET /api/runs/:id/phases/:node/log`, `/kbs/:id/fix-agent/:runId`, preflight fix-agent | unguarded `[read]` | Lexical `resolve+startsWith`. The phase-log route does not charset-gate `runId` at all, unlike every sibling in that file. Exploitability needs a pre-planted symlink under `_logs/`; no HTTP-reachable primitive to plant one was found, so severity is low — but the checks provide no containment. → bd `forge-2zz` |
| `orchestrator/project-config.ts:305-308,326-328` | `existsSync`/`readFileSync` | `PUT /api/studio/projects/:id` → real `projectRoot` + `AGENTS.md` / `.forge/quality_gate_cmd` | unguarded `[read]` | A symlinked `.forge` directory or leaf is followed, three lines from a sibling call that closes exactly that shape. Mechanical, but outside this sweep's route set and reached from the scheduler too. → bd `forge-2zz` |
| `orchestrator/studio/community-index.ts:271-274,310-323` | `readFileSync` | `GET /api/studio/community/:kind/:id` | unguarded `[read]` | Fixed-filename direct reads bypass the dirent-walk protection the rest of that module gets — a leaf-symlinked `SKILL.md`/`hook.yaml` inside an otherwise dir-guarded package is followed. → bd `forge-q80` |
| `cli/bridge-studio-runs.ts:559,598,603` | `readFileSync`/`writeFileSync` | `POST /api/plan-verdict` body `project`, `sessionId` | unguarded `[read]` | `project` **is** `SLUG_RE`-gated and `sessionId` `SAFE_ID_RE`-gated here (materially stronger than the `ui-bridge.ts` equivalents), but `_architectSessionDir` is still a bare `join()` with no realpath. → bd `forge-28o` |
| `cli/ui-bridge.ts:2284,2289,2313,2321` (`GET /api/demo-builder/sessions`, via `listDemoSessions`) | `existsSync`/`readdirSync` | `status.project_repo_path` read off each session's `status.json` | unguarded `[read]` | Found by SEC-03 WI-6's caller enumeration and deliberately NOT fixed there — stated rather than silently declared covered. The route takes no `project`/`sessionId` parameter, so it is not reachable by a routing escape, and it only probes existence and lists filenames (booleans and names, never file CONTENT). A forged value reaching it needs the same on-disk write precondition as the row above. Fixing it belongs with the session-status trust question as a whole, not inside a two-route content fix. → bd `forge-28o` |

### Fixed in R4-16 — the four `/start` routes' `projectRepoPath`

Recorded here because leaving the row below in "unguarded" after R4-16 shipped
its fix would have been a false claim in a permanent artifact. Found by SEC-03's
re-read of the branch, not by anything that watches for it — which is precisely
the gap `scripts/check-request-path-sinks.mjs` now covers for NEW sinks and
still does not cover for a row whose status changed under it.

| file:line (as audited) | op | request field | class | how it was closed |
|---|---|---|---|---|
| `cli/ui-bridge.ts:1539,1808,2259,2311` (+ the sessions they seed) | `writeFileSync`/`readFileSync` | `POST /api/{architect,instructions,project-brain,demo-builder}/start` body **`projectRepoPath`** | **fixed** `[exec]` | Was accepted **verbatim** — not a slug resolving under a trusted root but an arbitrary absolute path, then *persisted* into `status.json` as ground truth for the rest of the session (the agent's `cwd`, the target of `ensureStudioBranch`/`commitStudioChange`, the base for every artifact write). Closed by `invalidProjectRepoPath` (`cli/ui-bridge.ts:1610`), which delegates to the SHIPPED `isContainedProjectRepoPath` (`cli/manifest-path-guard.ts`, SEC-02) — reuse, not a new check. Four routes, not three: round 4 found `POST /api/project-brain/start` had zero containment while its three siblings called the guard, and round 4 also closed a fails-open `''` case where the validator returned "not invalid" for the empty string and the call sites' `??` default could never substitute for it. |

### Fixed in SEC-02 — manifest-carried path fields (`forge-d1f`)

The three rows below were filed rather than fixed in the containment sweep because
a per-read-site guard is whack-a-mole when one unvalidated value is written ONCE and
consumed unchecked by a dozen modules. SEC-02 closed them at the **write point**.
`file:line` references are as-audited (pre-fix), because that is what they document.

| file:line (as audited) | op | request field | class | how it was closed |
|---|---|---|---|---|
| `cli/forge-requeue.ts:209`, `orchestrator/requeue-resume.ts:68-189`, `cli/bridge-studio-runs.ts:185,327,474`, `cli/bridge-recovery.ts:96,111` | **`rmSync(recursive)`**, reads, writes | `POST /api/initiatives` body manifest → frontmatter `worktree_path`, `project_repo_path`, `cycle_id`, `project` | **fixed** `[exec]` | Was the campaign's most severe finding: an **unconditional recursive delete** of an attacker-named directory, reached via `POST /api/recovery/:id/requeue` (`resumeFromDemo` defaults false → `preserveWorktree` false). Reproduced live against a planted sentinel — the route returned `200 {"ok":true,"worktreeRemoved":true}` while destroying it. Closed by `cli/manifest-path-guard.ts` at the ingest choke point (`writeManifest`, whose only two production callers are `orchestrator/promote-manifests.ts` and `POST /api/initiatives`), plus an independent assertion inside `runRequeue` ahead of `inferRequeueResume` and the destructive block — so a manifest reaching disk by any other route is still caught. The lexical `resolve().startsWith()` checks in the approve/send-back branches were replaced with real per-segment identity containment. |
| `orchestrator/flow-artifacts.ts:167-171`, `orchestrator/logging.ts:124-138` | `mkdirSync`/`writeFileSync`/`appendFileSync` | `manifest.cycle_id` | **fixed** `[exec]` | `resolve(logsRoot, cycleId)` normalised a poisoned id straight past `logsRoot`. Ingest validation alone proved **insufficient**: the adversarial round showed the verdict handler reads its manifest from disk, never from an ingest body, and a traversing `cycle_id` really did write `artifacts/verdict.json` (and an `events.jsonl`) outside both `logsRoot` and the forge root. Closed at ingest AND with an `isSafeCycleId` check in both verdict branches before any cycleId-derived path is built. |
| `cli/bridge-recovery.ts:56,86,96,107` | `existsSync`/`readFileSync` | `GET /api/recovery/:id` | **fixed** `[exec]` | `INIT_ID_RE`-gated, lexical join only; `recoveryInspect` additionally returned `prDraftChars`, an arbitrary-file-length oracle. Both `recoveryInspect` and `recoveryAbandon` (which runs `git -C <projectRepoPath> branch -D` / `push origin --delete`) now gate on the containment helpers, reusing their existing response shapes. |

### Fixed in SEC-03 — project-CREATE containment, the mint choke-point violation, and the demo-builder GET routes

Two more sites, closed in this initiative. The first was previously filed as
`unguarded [read]` in the table above (moved here, not duplicated — see the count
reconciliation in the Summary). The second had no prior row at all: it was found by
applying this document's own "Completeness rule" (below) to the manifest-write
choke point, not by luck.

| file:line (as audited) | op | request field | class | how it was closed |
|---|---|---|---|---|
| `cli/bridge-studio-writes.ts:679-737` | `mkdirSync`/`writeFileSync` | `POST /api/studio/projects` body `name`, `repoPath` | **fixed** `[exec]` | Two independent defects, both closed in one pass. (1) The lexical `resolve(projectRoot).startsWith(resolve(forgeRoot)+sep)` check on an UNRESOLVED path — the exact worthless shape this document's own introduction names — is replaced by `isContainedProjectRepoPath` (`cli/manifest-path-guard.ts`, itself built on `resolveGuardedPath`), which requires genuine per-segment realpath identity under `<forgeRoot>/projects/` specifically, not merely "somewhere under forgeRoot". Live-reproduced before the fix: a real `git init` + `.forge/project.json` + `roadmap.md` + `brain/profile.md` written OUTSIDE the forge root, with the route returning `200 {"ok":true}`. (2) A missing existence check let a fresh, non-colliding `name` whose `repoPath` pointed at an ALREADY-ONBOARDED project silently overwrite that project's `.forge/project.json` wholesale — including `testProcess.local.cmd`, the quality-gate command forge later **executes**. `existsSync(join(projectRoot,'.forge','project.json'))` now 400s before either side effect runs. Both defects pinned by 13 ATs in `cli/bridge-studio-project-create-containment.test.ts`. → bd `forge-q80` (partially closed — this was one of three rows filed under it; the `skill-library.ts`/`community-install.ts`/`community-index.ts` rows remain open).  **SEC-03 round 2 — the fix shipped its own instance (BLOCKER, adversarial round).** `isContainedProjectRepoPath` verifies `projectRoot` and NOTHING BENEATH IT, so every subsequent `mkdirSync`/`writeFileSync` built its path with a plain `join()`/`resolve()` off that verified root. A genuinely real, honestly-contained `projects/<id>` — the clone-then-onboard workflow — whose NESTED `.forge` was a symlink wrote `project.json`, including the `testProcess.local.cmd` forge later EXECUTES, at an attacker-chosen path outside forgeRoot, `200 {"ok":true}`. Escape shape #4, already closed on the sibling PUT and not reused here. Closed by routing `.forge/project.json`, `roadmap.md` and `<artifactRoot>/brain/profile.md` through `resolveGuardedPath` with `projectRoot` as the trusted root and every component its own segment, with a rejection throwing rather than skipping. **The general principle, recurred five times in this campaign: validating a root does not validate what you write beneath it.** **SEC-03 round 2 corrected an overclaim in an earlier revision of this very row.** It said the four sub-shapes that had been blocked by accident (live, non-dangling leaf symlinks at `project.json`, `roadmap.md` and `brain/profile.md`, blocked by three distinct `existsSync` idempotency checks that know nothing about symlinks; and a hardlinked `project.json`, blocked by the fresh-onboard clobber refusal) "all now fail containment on their own". The adversarial round DISPROVED that by swapping the pre-fix file back and re-running: those four ATs passed byte-identically, so the new guard is not what fires for them. The claim is not repaired by reordering — running the guard ahead of the existence probe is exactly what produced the round-2 MAJOR false-rejection (an ordinary in-repo HARDLINKED `roadmap.md`, no write intended, failed the whole onboard). So the honest statement, which is also the stronger one: **containment applies to every path this route actually WRITES, and every "the entry already exists" shape is structurally unreachable as a write, because this fresh-onboard route never writes over an existing entry.** A hardlink is by definition an existing dirent, so it can never reach a write here — which is precisely why the sibling `PUT /api/studio/projects/:id`, which MERGES into an existing `project.json`, genuinely needs `resolveGuardedPath`'s `nlink === 1` leaf check while this route does not. Removing the idempotency/clobber checks would reopen those four shapes; they are load-bearing and now say so. The four ATs are kept as regression locks, labelled property-not-mechanism. The route's new `mkdirSync` was flagged by `scripts/check-request-path-sinks.mjs` (baseline `mkdirSync` 6 -> 7) on the ratchet's first real use, in the same PR that introduced it. **SEC-03 round 3 — a THIRD instance in this same row, and a fourth false claim about failure behaviour.** An earlier revision said this route fails cleanly before any write, and the greenfield sibling was told to match it. Executed rather than read, that was false: `seedProjectBrain` now THROWS (this WI made it able to), and BOTH create paths called it after they had already written — greenfield after `copyTemplate` had produced a complete template-sourced project including `.forge/project.json`, onboard after `mkdirSync(projectRoot)` and `scaffoldContractArtifacts` had produced a real git-initialised directory with `roadmap.md` and a local `brain/profile.md`. The API returned 400 while `discoverProjects` adopted the directory on the next list: an **adopted-but-disowned project**, an operator told "not created" who then finds it in their library. Closed by ORDERING on both paths — `seedProjectBrain` now runs before every project-directory write, and because it validates all of its own per-segment guards before performing any of its own writes it is a genuine pre-write validation, not a partial one. Compensating cleanup was explicitly rejected: delete-on-failure is a strictly worse contract than never-write. Residual inconsistency, stated: a later unrelated write failure leaves an orphaned `brain/projects/<id>` stub with no project — never listed, since `discoverProjects` scans only `projects/`, and skipped idempotently by a retried create. Pinned `[exec]` by three ATs across `cli/bridge-studio-project-create-containment.test.ts`, `cli/bridge-studio-write.test.ts` and `orchestrator/project-create.test.ts`, one of which drives `GET /api/studio/projects` to prove the LISTING consequence rather than only the filesystem one. |
| `orchestrator/mint-triggered-initiative.ts` (previously no row) | `mkdirSync`/`writeFileSync` (direct, pre-fix) | `PUT /api/studio/flows/:id` body `project` → background flow-trigger sweep → minted manifest's `project` / `project_repo_path` | **fixed** `[exec]` | The finding was the choke-point bypass itself: this module wrote a queue manifest with `serializeManifest` + `writeFileSync` directly, never calling `writeManifest` — the SSOT ingest choke point the "Recorded design assumption" section below names. Reachability was proven live end-to-end, not argued: `validateFlow` never checked `flow.project`'s shape, and `PUT /api/studio/flows/:id` persists `body.project` verbatim (`200 {"ok":true,...,"findings":[]}` for `project: "../../<outside-dir>"`, confirmed on disk in `flow.yaml`). `mintTriggeredInitiative` then does `join(resolveProjectsDir(...), flow.project)` — `path.join()`, not `path.resolve()`, so the working escape shape is a relative `..`-traversal — and, with the target pre-existing, wrote a real manifest straight to `_queue/pending/` carrying `project_repo_path` genuinely outside `forgeRoot`, bypassing `writeManifest`/`assertManifestPathFields` entirely and landing exactly in the sinks SEC-02 closed (`runRequeue`'s `rmSync(recursive)`, `finalize-merged.ts`, `drain-fix-loop.ts`'s `git -C <path>` + `spawnSync`, `orchestrator/scheduler.ts`). Closed by routing through `writeManifest` (now class 1 — see "Recorded design assumption" below), plus a defence-in-depth ERROR-level `project/shape` finding added to `validateFlow` (`orchestrator/studio/validate.ts`) as the charset first layer, built on `isSafeProjectName` (the exact predicate the choke point itself uses, imported rather than re-derived, so the two layers cannot drift apart) — error level, not a warning, because a warning here would be the "declared data fails open" shape this campaign has repeatedly found and closed. Pinned by `orchestrator/mint-triggered-containment.test.ts`. A second, latent defect surfaced while wiring this fix: the mint's `queueRoot` defaulted to the bare relative `'_queue'` (i.e. `<process.cwd()>/_queue`), while `writeManifest` re-derives `forgeRoot` as `dirname(resolve(queueRoot))` to run its own containment check — a daemon whose `cwd` was not `forgeRoot` at the moment of a trigger-fired mint would validate containment against the WRONG root. Now anchored explicitly on the caller's already-resolved `forgeRoot` rather than a bare relative default. (No pre-existing bd — this row did not exist in any form before SEC-03.) |
| `cli/ui-bridge.ts:2333-2368` (`GET /api/demo-builder/demo/:project/:sid`), `2373-2409` (`GET /api/demo-builder/fragment/:project/:sid/:element`) | `existsSync`/`readFileSync` | `project`, `sessionId` (URL path segments) + `status.project_repo_path` (read from disk) | **fixed** `[exec]` | Carried from the R4-16 review and folded into SEC-03 by T1 ruling; R4-16 rated this LOW on the premise that reaching a poisoned `project_repo_path` required first escaping session-dir containment. That premise is now doubly obsolete. First, the premise itself was already wrong the way R4-16's own `/start` finding showed (an attacker could supply `projectRepoPath` directly) — but that specific route is now fixed: reading `/api/{architect,instructions,demo-builder,project-brain}/start` on this branch confirms all four now gate `projectRepoPath` through `isContainedProjectRepoPath` before ever persisting it. Second, and this is the re-assessment's actual finding: **`/demo/` and `/fragment/` don't need a poisoned `project_repo_path` at all.** They are the two demo-builder GET routes explicitly named as OUT OF SCOPE in the code comment directly above the `/generation/` route ("The sibling /demo/ and /fragment/ GET routes above remain OUT OF SCOPE for this round... rely solely on a lexical startsWith(base) check... a real gap, filed as an evidenced follow-up") — unlike the `/generation/` route and the five POST routes (start/brief/feedback/lock/abandon), which all resolve their session dir through `resolveDemoSessionDir` (realpath identity containment under the specific project's own resolved dir), `/demo/` and `/fragment/` validate `project`/`sessionId` for **non-emptiness only** (`if (!project \|\| !sessionId)`) and pass them straight into a bare `join()`. **Live-reproduced** (ad-hoc probe script mirroring the `cli/bridge-studio-sibling-containment.test.ts` idiom — real `startBridge({forgeRoot, port:0})`, a `status.json` planted directly on disk at `<escaped-dir>/_demo/x/status.json` with `project_repo_path` pointing at a third, wholly outside "attacker repo" directory; probe deleted after use, not left as a permanent AT, since this document is the only file T3 may edit): `GET /api/demo-builder/fragment/..%2F..%2F<escaped-dir>/x/evil` → `200`, response body contains the planted `PWNED-FRAGMENT-CONTENT`; `GET /api/demo-builder/demo/..%2F..%2F<escaped-dir>/x` → `200 PWNED-DEMO-CONTENT` verbatim. The percent-encoded `%2F` survives the route's own `url.slice(prefix).split('/')` (split runs on the RAW, still-encoded URL) and only becomes a literal `/` afterwards, in the subsequent `.map(decodeURIComponent)` — the classic encoded-slash traversal bypass. Independently of the traversal, `/demo/`'s `requested.startsWith(base)` check is a **guard that cannot fail** (this document's own definition of `unguarded`, see "How to read the classifications" above): `DEMO_HTML_REL_PATH` is the fixed literal `.forge/demo/DEMO.html`, so `requested` is ALWAYS exactly `base + 'DEMO.html'` for every possible `status.project_repo_path`, poisoned or not — it cannot reject anything. `/fragment/`'s equivalent check is NOT vacuous in the same way: it correctly rejects a traversing `element` (the one input that actually participates in the base/requested comparison), so this route's containment is real for `element` alone, vacuous for `project`/`sessionId`. **Bound of what was verified, kept honest per this document's own rule ("a conclusion you did not execute is a lead, not a proven exploit"):** full exploitability against content fully outside the forge tree, from a single request with nothing pre-staged, additionally requires a `_demo/<sid>/status.json`-shaped file to already be reachable via traversal from `ctx.projectsRoot` — an HTTP-only chain to plant one there (with no local pre-seeding) was searched for and NOT found: the demo-builder family's own five write routes are correctly closed (`resolveDemoSessionDir` cannot create outside `projectsRoot`, confirmed by reading); the sibling architect/instructions/project-brain `/start` routes' OWN session-dir join (`architectSessionDir` et al., row above, bd `forge-28o`) is unguarded for `body.project` in the identical shape and DOES permit an arbitrary-path `mkdirSync`+`writeFileSync`, but always under a different, hardcoded subdirectory name (`_architect`/`_instructions`/`_project-brain`, never `_demo`) — so it does not, on inspection, chain into this specific route. The remaining unguarded writers in this table (`packageDir` install, KB-maintenance `file`) were not each individually checked against this exact shape — recorded `[unver]` below, not assumed safe. A symlinked session directory (the R4-16 round-2 BLOCKER shape) would defeat this identically to the traversal above and was not separately tested — redundant to prove, since these two routes apply NO containment of any kind, lexical or realpath, to `project`/`sessionId`, unlike the routes `resolveDemoSessionDir` DOES cover. **Verdict: severity raised from LOW to MODERATE.** The containment failure is now `[exec]`-proven rather than `[read]`-argued, and — unlike the finding it was carried from — it no longer depends on any OTHER route's field being poisoned; it stands on its own two unvalidated URL segments. It is not rated higher only because no HTTP-only plant chain for the precondition was found despite a genuine search. **How it was closed (SEC-03 WI-6, 13 ATs in `cli/bridge-studio-demo-builder-containment.test.ts`, 9 of them RED first):** two independent halves, either alone insufficient. (A) both routes now resolve their session dir through `resolveDemoSessionDir` — the choke point in the same file that the five sibling POSTs and the GET generation route already used — so `project`/`sessionId` are charset-validated before any `join` and the resolved dir is realpath-proved inside THIS project's own dir (identity, not membership: an AT drives a cross-project symlink that a `projectsRoot`-wide check would wrongly accept). (B) the vacuous `requested.startsWith(base)` check is DELETED — a guard that cannot fail is not a guard, and keeping it would have been decoration — and `status.project_repo_path` is validated as a VALUE with the shipped `isContainedProjectRepoPath`, on both routes (`/fragment/` carried the identical tautology in that field; its `element` component was already safe and is untouched, pinned by a non-regression AT). `invalidProjectRepoPath` was deliberately not reused as-is: its empty-string early return means "absent, use the caller's default", correct for a request body at write time and wrong for a mandatory field already persisted. The choke point's own docstring claimed to be the ONLY caller of `demoSessionDir` — it was not, and that overstatement is what let these two routes be written past it; it now claims only what is true. |
| `orchestrator/project-brain-seed.ts:157-188` (`seedProjectBrain`), `orchestrator/brain-paths.ts:55,60` (`projectBrainDir`/`projectThemesDir`) | `mkdirSync`/`writeFileSync` | `POST /api/studio/projects` body `name` -> the slugified `projectId` | **fixed** `[exec]` | Found by the SECOND adversarial round, reachable from the SAME route two calls after the Defect-5 fix, in the module SEC-01 had already hardened once — `projectBrainDir`/`projectThemesDir` are `resolveKbBrainDir`'s unguarded siblings. `seedProjectBrain` wrote `kb.yaml`, `profile.md` and `themes/README.md` through bare `join()`s and `mkdirSync`'d `themes/` recursively through a symlinked segment before any write. `projectId` is `SLUG_RE`-validated, so the vector is a pre-planted symlink, not a traversing id. **All FIVE shapes reproduced live, none accidentally safe** (ATs 24-28): `brain/projects/<id>` as a symlinked dir; `brain/projects/<id>/themes` as a symlinked dir with `<id>` itself real; and dangling symlinks at `kb.yaml`, `profile.md` and `themes/README.md`. Contrast the Defect-5 round, where 4 of 8 sub-shapes were blocked by accident — this function has no `existsSync` in front of the directory shapes, and its per-file probe is `stat`-based so a dangling link reads as absent. Closed with ONE choke point across all three writes: `resolveGuardedPath` rooted at the fixed `<forgeRoot>/brain/projects` with `projectId` and every component below it as their OWN `segments[]` elements. The two directory shapes are why guarding `brain/projects/<id>` alone would not have been enough — the same "validating a root does not validate what you write beneath it" principle, one level deeper. **Failure behaviour, verified per claim and NOT inherited from this row's `[exec]` tag** (see the methodology rule on per-claim verification): an earlier revision of this sentence said "both callers fail closed: the route returns a generic 400 before writing `.forge/project.json`" — the same claim the project-create row above spends a paragraph disproving. It was wrong for the same reason and survived the first retroactive sweep because that sweep was per-ROW-TAG, and this row's `[exec]` was earned by a different claim (the five escape shapes). What is true, executed: a containment rejection returns 400 and, after SEC-03 round 4's two-phase fix, leaves nothing on disk in EITHER `projects/` or `brain/projects/` on either route. The intermediate round-3 ordering fix did NOT achieve that — it moved a WRITING call earlier, which relocated the orphan rather than removing it: an unrelated later failure left a complete `brain/projects/<id>/kb.yaml`, and because `loadKbDescriptors` scans `brain/projects/` as a second containment root the operator got a **phantom KB bound to a project they were told was never created** — invisible to `discoverProjects` and undetected by `forge studio lint` and `forge brain lint`. Closed by separating the CHECK from the WRITE: phase 1 resolves and containment-checks every path either route will write — `projectRoot`, the contract artifacts, and all three `brain/projects/<id>` targets — performing no request-derived write of any kind, so a rejection leaves nothing in either `projects/` or `brain/projects/`; phase 2 writes, with `seedProjectBrain` restored to its original position. `brainSeedTargets()` is private and `seedProjectBrain` itself calls the pure checker, so the pre-check and the seed cannot drift apart. **Verified by execution on both routes and both failure kinds** — a containment rejection and an unrelated EACCES: `projects/<id>` absent, `brain/projects/<id>` absent, and neither `GET /api/studio/projects` nor `GET /api/studio/kbs` lists it. Two pre-existing lint gaps were measured live in the process and filed rather than assumed: `forge studio lint`'s KB scan never recurses into `brain/projects/<id>/` (bd `forge-8kq`), and `forge brain lint` skips any `brain/projects/<name>/` whose `themes/` holds only a README with no check cross-referencing `discoverProjects` (bd `forge-4qf`) — so nothing today would notice an orphaned project brain however it arose. **RESIDUAL, disclosed precisely because the wording matters** (bd `forge-4on`, P1): the "absent on both failure kinds" statement above is accurate **only for the two failure points actually EXECUTED** — a containment rejection in phase 1, and an EACCES on the project `mkdirSync`. It is NOT a claim that no failure anywhere can orphan anything. Project create is **not transactional**: phase 1 validates and phase 2 writes, so a failure arriving BETWEEN them — or a filesystem change racing the window, bounded in practice by a subprocess spawn (`git init`) or a multi-file copy (`copyTemplate`) — can still leave an orphaned project directory or brain stub. **No test in this diff exercises that race.** Three consecutive review rounds each fixed an orphan-consistency defect and each fix reopened it one layer down (ordering → phantom KB → this TOCTOU), which is diagnostic rather than unlucky: orphan-consistency is a DIFFERENT problem from containment and cannot be solved by reordering. The fix shape is transactional create (stage-then-atomic-move) or a reconcile/GC pass — filed as its own initiative, explicitly NOT a sixth patch here. Containment itself is closed at every layer: `seedProjectBrain`'s own re-check rejects and the write to a symlink target never happens, confirmed by probe. The residual is operator-facing consistency, recoverable by deleting a directory, and — since round 4's retrofit — visible in BOTH `GET /api/studio/projects` and `GET /api/studio/kbs`. |

### Guarded in R4-17 — the onboarding session's contract-stages surface

Three new sink sites, all introduced by this initiative (R4-17, T3/WI-1 and
the round-1 fix-round, T3/WI-3) and flagged by
`scripts/check-request-path-sinks.mjs` on first use — the ratchet working
exactly as designed, catching its own initiative's new surface before merge.
None reopens a shape this document has already closed.

| file:line | op | request field | class | evidence |
|---|---|---|---|---|
| `cli/contract-stages.ts` (`resolveContainedProjectDir`, exported) | `realpathSync` ×2 | `GET /api/studio/sessions/onboarding/:sessionId?project=`, `GET /api/studio/projects/:id/contract-stages`, and — directly, by import, since the round-1 BLOCKER fix on the row below — `POST /api/studio/onboarding/start` — all feed `projectId`/`project` | guarded `[read]` | `SLUG_RE` + length cap first (rejects before any fs call — AT-25). Then `realpathSync(join(projectsRoot, projectId))` compared against `realpathSync(projectsRoot)` with a `startsWith(root + sep)` boundary check — the SAME shape as `resolveSafeSessionDir` (`cli/bridge-studio-sessions.ts`, row above), **deliberately NOT** `resolveGuardedPath`/`isContainedProjectRepoPath`: those two enforce a STRICTER per-segment IDENTITY check that rejects a symlinked `<root>/<id>` pointing at a DIFFERENT real object under the SAME root even when that object is legitimate — this module's own AT-28 (a false-rejection control) requires exactly that shape to be ACCEPTED (a relative symlink resolving back inside `projectsRoot`), so the stricter guard is the wrong tool here, not an oversight. See `cli/contract-stages.ts`'s own module header for the full note. Verified by DIRECT-EXECUTION tests in `cli/contract-stages.test.ts` (AT-27: a real symlink escaping to an outside directory never surfaces its content; AT-28: the false-rejection control is accepted; AT-25: a non-slug id is rejected before any lookup; AT-29: two projectIds never cross-contaminate) — not an HTTP-route-level probe, so classified `[read]` per this document's own convention (mirrors `orchestrator/studio/session-transcript.ts`'s identical `[read]` classification at the row above, despite THAT module's own AT-35/36/37 also being direct-execution symlink tests, not HTTP probes). **Completeness note:** the `contract`/`instructions`/`secrets`/`demo` rows read `.forge/project.json` via `orchestrator/project-config.ts`'s `loadProjectConfig`, which internally calls `readAgentInstructionsFile`/`readQualityGateSidecar` — both already filed `unguarded [read]` → `forge-2zz` in Table 2 above. This module is a NEW caller reaching that pre-existing, already-tracked gap; not a new finding, but named here per the "one sink, many entry points" completeness rule. D3 (names-only secrets) is enforced structurally — `secrets.env` is never opened anywhere in this module, pinned by `cli/contract-stages.test.ts` AT-12's sentinel-value plant. |
| `cli/contract-stages.ts` (`deriveRoadmapRow`) | `existsSync` | none directly — reaches this sink only through `projectId`, already `SLUG_RE` + length-cap validated and `resolveContainedProjectDir`-proved by `deriveContractStages` before ANY row-deriver, including this one, is ever called | guarded `[read]` | New in the round-1 fix round (item 3, T2 ruling — the roadmap row's C4 divergence made visible: `cli/preflight.ts`'s `checkC4` fails HARD unless BOTH `roadmap.md` AND `brain/projects/<id>/profile.md` exist, but this row previously only ever looked at `roadmap.md`). `deriveRoadmapRow` now reports `existsSync(join(projectBrainDir(forgeRoot, projectId), 'profile.md'))` as a presence FACT in the row's `detail`/`source` — never a verdict (`status` stays presence-of-roadmap.md only, D11). `forgeRoot` is a fixed, trusted constant, never request-derived; `projectId` is the identical value already charset- and containment-validated upstream — no `..`, `/`, or `\` can reach this join, so no NEW containment logic was needed at this specific call, only a guarded read (wrapped in try/catch, so a hostile filesystem condition fails closed to `absent` rather than throwing — never a hostile PATH, since the path is already charset-clean by the time this runs). `existsSync` is boolean-only regardless: even in the counterfactual where upstream containment somehow failed, this call could leak nothing beyond a presence/absence fact, never file content — the same fact/verdict boundary D11 already draws elsewhere in this module. Flagged by `scripts/check-request-path-sinks.mjs` (baseline `cli/contract-stages.ts existsSync` 0 -> 1) on this fix's first use. Pinned by `cli/contract-stages.test.ts` AT-30 (profile present), AT-31 (profile absent — the C4 divergence itself), AT-32 (roadmap.md absent, both profile states). |
| `cli/ui-bridge.ts` (`POST /api/studio/onboarding/start`) | `realpathSync` ×2 + `resolveContainedProjectDir`, `mkdirSync` ×2, `writeFileSync` ×2 | body `project` (+ `inputs`) | guarded `[exec]` | `project` is `SLUG_RE` + length-cap validated (reusing `invalidGenerationProjectReason`, the same helper the demo-generation routes already use) before any fs call. **Round-1 adversarial review found a BLOCKER here, reproduced live:** the project directory was previously resolved with a bare `realpathSync(join(ctx.projectsRoot, project))` — this resolves symlinks but never checks the result lands inside `ctx.projectsRoot`. Planting `<projectsRoot>/evilproj -> <dir outside projectsRoot>` and `POST`ing `{project:"evilproj"}` returned `200`, with `status.json` and `prompt.md` written outside `projectsRoot` and the agent spawned against it. **Closed by IMPORT, not a second implementation:** the route now calls `resolveContainedProjectDir` (`cli/contract-stages.ts`), the identical function the sibling `GET /api/studio/projects/:id/contract-stages` route already calls — one guard, two call sites, not two guards. **Round-2 adversarial review then found that fix incomplete, and disproved a claim this row previously made.** The previous revision said "`sessionId` is generated by this route's OWN code … so the join itself cannot introduce a further escape." True of `sessionId`; **false of `_onboarding`.** A legitimately-contained project whose `_onboarding` entry is a SYMLINK redirects both writes: `mkdirSync(recursive:true)` transparently follows a symlinked intermediate segment, and `status.json` + `prompt.md` were reproduced landing outside `projectsRoot` from a project that passed containment. The reachability is not theoretical — a managed project is a CHECKED-OUT REPO, so a commit carrying a symlink named `_onboarding` is attacker-supplied content. This is "validating a root does not validate what you write beneath it", one level deeper than the round-1 fix, **found in the round that fixed the same class one level up** — the sixth self-inflicted instance in this campaign. **Closed (round-2, the DIRECTORIES only — see the round-3 correction below, this same row)** by creating and realpath-verifying `_onboarding` BEFORE the session dir is created beneath it, then realpath-verifying the session dir in turn. A pre-existing REAL `_onboarding` directory (every onboarding run after the first) passes unchanged — only one whose realpath leaves the verified project dir is refused. **The sentence that followed here, in the round-2 revision of this row, claimed "the guard now runs at every level that is written, not only at the root." That claim was FALSE the moment it was written, and stayed false through round 2's own review: it verified the two DIRECTORY levels (`_onboarding`, the session dir) and said nothing true about the two FILE levels beneath them (`status.json`, `prompt.md`) — those were written with a bare `writeFileSync(path, data, 'utf8')`, no exclusive-create flag, no containment check of any kind. Round-3 adversarial review reproduced exactly this: `newArchitectSessionId()` (below) has only ONE-SECOND granularity, so a session-id directory was guessable well enough to pre-plant, with its two leaf files as symlinks to an outside target, ahead of the real request — 100% hit rate over a 4-second candidate window. `mkdirSync(sessionDir, {recursive:true})` silently reused the pre-existing planted directory and both `writeFileSync` calls followed the planted symlinks. The seventh self-inflicted instance of "validating a root does not validate what you write beneath it" in this campaign, and the second false claim in this exact cell — see the round-3 fix and its own three closes, appended at the end of this row.** **Executed:** AT-11 plants the symlinked `_onboarding` and asserts non-2xx AND that nothing was written at the symlink target; AT-12 is the accept control (a real pre-existing `_onboarding` still succeeds), alongside AT-4 (no `_onboarding` at all). **Executed, both directions:** `cli/ui-bridge-onboarding-start.test.ts` AT-7 plants the exact symlink above and asserts non-2xx AND nothing written at the escape target; AT-8 (the false-rejection control) plants a RELATIVE symlink resolving back INSIDE `projectsRoot` and asserts it is still accepted, with the session landing at the real target — proving the fix is containment, not a blanket symlink ban. D5's separate guarantee — that a caller-supplied `projectRepoPath` has ZERO effect, because the route has no such field to read at all — remains executed live by AT-3, unaffected by this fix. AT-1/AT-2 additionally pin that a malformed/unknown `project` is rejected (400/404) before any `_onboarding` directory is created anywhere. **Retracted claim, this row, previous revision:** an earlier revision said this shape was "an improvement over the legacy architect/instructions/project-brain `/start` siblings' unguarded `architectSessionDir`-shaped join…, not a repeat of that gap." Round-1 adversarial review disproved that by execution: calling `realpathSync` and never checking where the result landed is not an improvement over an unguarded join — it is the same unguarded-join gap wearing a symlink-resolving disguise. "Validating a root does not validate what you write beneath it" does not even reach this case, because the root itself was never validated either. Six consecutive review rounds in this campaign have now found a false claim in this document, every one about what happens on failure — the round-2 pair (this row's `_onboarding`-directories claim and the `writeSessionTerminalPhase` "provably a no-op" claim below) plus this row's OWN round-2 "every level that is written" claim (corrected above), the sixth. The last three (both round-2 claims and this one) were all written by the orchestrator ruling on the round before it; this one is corrected by the fix-round implementer under the round-3 ruling, not by the orchestrator itself, so the ruling this time is: verify the correction by execution before writing it down, which is exactly what AT-13/14/15/17 below do. **Ratchet delta for this row (round 2): `cli/ui-bridge.ts` `mkdirSync` 7→8 and `realpathSync` 2→4, all four from the round-2 write-beneath-the-root fix (the `_onboarding` parent's own `mkdirSync` + the two new `realpathSync` verifications).** No unguarded sink was added: every one of the four IS the guard. **Round-3 adversarial review finding and fix (the leaf-write gap the round-2 claim above wrongly said was already closed).** `newArchitectSessionId()` (`cli/ui-bridge.ts`, shared by five routes — architect, instructions, project-brain, demo-builder, and this one) produced `YYYY-MM-DDTHH-mm-ss` — ISO-8601 truncated to ONE-SECOND granularity, zero entropy. Reviewer pre-created `<projectsRoot>/<project>/_onboarding/<guessed-second>/` with `status.json` and `prompt.md` as symlinks to an outside sentinel, spanning a 5-candidate, 4-second wall-clock window around the request — 100% hit rate. `mkdirSync(sessionDir, {recursive:true})` silently reused the pre-existing planted directory (no realpath escape, so the round-2 directory-level check above still PASSED) and `writeFileSync(path, data, 'utf8')` followed both planted symlinks straight through to the outside target. **T2 ruling: THREE independent closes, because a defence that only works because another one also works is one defence.** (1) `mkdirSync(sessionDir)` with **no** `recursive` — a pre-existing entry at this exact path, symlink or a real-but-empty directory, is now a hard `EEXIST` error rather than a silent reuse. (2) Both leaf writes now pass `{flag:'wx'}` (`O_CREAT` + `O_EXCL`) — an existing path at the leaf, symlink included, fails the `open()` with `EEXIST` instead of being followed and written through. (3) `newArchitectSessionId()` now appends an 8-hex-char `randomBytes(4)` suffix after the timestamp — kept `SAFE_ID_RE`-valid (hex is a subset of its charset) and still chronologically sortable (the fixed-width timestamp prefix dominates comparison across different seconds; the suffix only breaks ties within the same second). Because this helper is shared, all five spawn-family `/start` routes gained the fix in one place, not four gaps left open behind the one that got adversarially reviewed. The two directory-level closes (1, 2) were extracted into an EXPORTED function, `writeOnboardingSession` (`cli/ui-bridge.ts`), taking an EXPLICIT `sessionId` rather than generating one internally — so the exclusive-create defences can be exercised directly, since close (3) makes the id genuinely unguessable and therefore un-pre-plantable through the route itself going forward (see the disclosed limitation in `cli/ui-bridge-onboarding-start.test.ts`'s AT-13/14/15 header). **Executed, real filesystem objects, never a status code alone (per this document's own verification rule):** AT-13 and AT-14 (`cli/ui-bridge-onboarding-start.test.ts`) each pre-plant all 5 candidate session-id directories spanning the request's wall-clock window with `status.json`/`prompt.md` respectively as symlinks to an outside sentinel file, and assert the sentinel is byte-unchanged after the request — proving closes (1)/(2) together, outcome-based so the assertion holds regardless of which of the two closes is the one that actually fires (both do: the pre-existing directory trips close (1) before close (2) is ever reached, disclosed in the test's own header, not silently assumed). AT-15 pins close (1) ALONE: the 5 candidate directories are pre-planted real and EMPTY (no symlink at all), and the test asserts they stay empty — if close (1) alone regressed to `recursive:true` while close (2) remained, an empty pre-staked directory would be silently reused and populated with fresh, non-colliding files (no `EEXIST` from `'wx'`, since nothing exists yet to collide with), so this assertion depends on close (1) alone. AT-17 pins close (3): two starts fired back-to-back for the same project, well within the same wall-clock second, produce different session ids, each still matching `SAFE_ID_RE`. AT-16 is the accept control (mirrors AT-8/AT-12's shape): a project with a real, earlier onboarding session already present — the shape every second run has — still succeeds, lands in its own distinct dir, and leaves the earlier session untouched. **Disclosed limitation, not silently assumed away (mirrors this document's own AT-13/14/15 header in the test file):** once close (3) ships, AT-13/14/15's pre-planting technique can no longer coincide with the route's real target — their assertions stay TRUE post-fix, but only VACUOUSLY, since the route simply never touches the planted candidates rather than being refused. They remain valid RED-now proofs for this round's fix, not perpetual regression sentinels for closes (1)/(2) in isolation. `writeOnboardingSession`'s export exists so a follow-up unit test against a fixed, injected id — closing exactly this gap — can be added independently of route-level id-guessing; not added in this round because the round's scope was landing the three closes and their route-level proof, not authoring a new test file. **Ratchet delta for this row (round 3): `cli/ui-bridge.ts` `realpathSync` 4→3** (the sessionDir-level realpath check from round 2 is no longer needed — close (1)'s exclusive, non-recursive `mkdirSync` on a `SAFE_ID_RE`-valid, single-segment `sessionId` cannot itself escape the already-verified `onboardingParent`, so re-verifying with `realpathSync` afterward would be redundant, not a second defence). **`mkdirSync` stays 8 and `writeFileSync` stays 11 — closes (1) and (2) are option changes on the SAME call sites (`{recursive:true}` removed from one `mkdirSync`; `{flag:'wx'}` added to both `writeFileSync` calls), invisible to a sink-count ratchet that tracks calls, not their arguments.** This is disclosed here precisely because the ratchet cannot catch it: a future edit that quietly drops the `'wx'` flag or restores `{recursive:true}` on the session-dir `mkdirSync` would not move any number `scripts/check-request-path-sinks.mjs` tracks — AT-13/14/15 are the regression lock for that, not the sink count. |

**Not ratchet-tracked, guarded regardless:** `cli/agent-run.ts`'s
`writeSessionTerminalPhase` (the `--session-dir` write `forge agent dispatch`
performs, D7) is invisible to `scripts/check-request-path-sinks.mjs` — that
script's entry set is `cli/ui-bridge.ts` + `cli/bridge-*.ts`, and
`agent-run.ts` is reached only as a spawned CLI subprocess argv, never via a
relative import from those entry files (confirmed:
`findReachableModules().includes('cli/agent-run.ts')` is `false` on this
branch). `sessionDir` there is always OUR OWN already-created,
already-realpath-verified directory (built by the route above, threaded
through `spawnAgentDispatch`'s optional 6th argument), not raw request
text — **but round-1 adversarial review found the write path made NO use of
that fact.** `writeSessionTerminalPhase` had no containment reference at all
and unconditionally wrote `status.json` into whatever `sessionDir` string it
was handed, so its guarantee depended ENTIRELY on the route above having
validated the directory first — "one sink, many entry points" — pinned RED by
AT-9 (`cli/ui-bridge-onboarding-start.test.ts`) before the fix. **Closed** by
resolving `projectsRoot` inside `writeSessionTerminalPhase`
(`resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)))`
— see the round-3 correction immediately below for why the `loadConfig(...)`
argument was added; `cli/bridge-studio.ts` makes the identical call) and
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
directly above.** `cli/manifest-path-guard.ts`'s `isContainedProjectRepoPath`
— the guard `POST /api/verdict` / `POST /api/runs/:id/gates/verdict` (both the
approve branch, `cli/bridge-studio-runs.ts:222`, and the send-back branch,
`:390`), `orchestrator/finalize-merged.ts:301`, `orchestrator/drain-fix-loop.ts:136`
and `cli/bridge-recovery.ts` all call on `project_repo_path` before using it —
never went through `resolveProjectsDir` at all: it hardcoded
`join(opts.forgeRoot, 'projects')` directly. Under a configured
`FORGE_PROJECTS_DIR`/`forge.config.json`'s `projectsDir`, this guard checks
containment against the OLD default root while every producer on this same
page (the paragraph above, `ctx.projectsRoot`, `resolveProjectsDir` generally)
correctly resolves the CONFIGURED one — so a legitimately-produced
`project_repo_path` under a configured root would be wrongly REJECTED by this
guard, and **a configured `projectsDir` could break cycle approval entirely.**
Separately, and this is the root cause the round-2 "Closed" sentence above
never noticed: `loadConfig()`'s no-arg default (`orchestrator/config.ts`) is
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
passes `defaultConfigPath(forgeRoot)` (`orchestrator/config.ts`, new) — a
forge-root-anchored path — instead of relying on the cwd-relative default. A
repo-wide sweep for `resolveProjectsDir(..., loadConfig())` found eleven more
call sites carrying the identical cwd-fragility, all fixed the same way:
`cli/bridge-studio-writes.ts` (×4), `cli/studio-lint.ts`,
`cli/bridge-studio-sessions.ts`, `cli/bridge-studio-kbs.ts`,
`cli/bridge-studio.ts` (×4), and `orchestrator/mint-triggered-initiative.ts`
(the last of these already had its own row above, for an unrelated
choke-point-bypass defect — this is a second, independent fix to the same
file). Four remaining bare `loadConfig()` calls
(`orchestrator/scheduler.ts`, `orchestrator/demo-fix-loop.ts`,
`orchestrator/gate-fix-loop.ts`, `cli/bridge-studio-runs.ts:560`) were
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
adversarial review disproved it by execution.** `cli/ui-bridge.ts` computed
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

**NOT CLOSED, disclosed rather than silently assumed away — the same divergence
survives ACROSS PROCESSES at `writeSessionTerminalPhase` (`cli/agent-run.ts:194`),
and the round-4 sweep did not reach it.** The bridge creates the session dir under
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
(`cli/ui-bridge.ts`) passes no `env` option and the child therefore inherits the
parent's environment verbatim (verified by reading the spawn call) — so this needs
a `forge.config.json` edit landing inside one run's window, not merely a
configured `projectsDir`. Second, the guard fails **closed**: it refuses the
write, so the failure direction is a false rejection and an operator-visible,
recoverable stale `phase`, never a write outside the root. Not fixed in R4-17
because the only fix consistent with the round-4 ruling is to PASS the bridge's
snapshot into the subprocess (a new `--projects-root` flag on `agent dispatch`),
which makes the guard's own root an argv input and deserves its own acceptance
tests and review round rather than a tail-of-batch edit. **A guard that resolves its
root differently from the producer of the thing it guards is a false-rejection
generator** — the failure mode is invisible, because a refused write looks
exactly like a run that has not finished. The
first fix round nevertheless used the WIDER `forgeRoot`, for one reason only:
the `cli/agent-run-dispatch.test.ts` AT-D7 fixtures then built their session
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

### Accidentally-safe — the accident is the protection, and nothing knows it

These are **not** fixed. Each is blocked by a side effect of unrelated code; a refactor of that unrelated code removes the protection silently. Every one carries a regression-lock test with the accident named in a comment.

| file:line | route | the accident, named |
|---|---|---|
| `cli/bridge-studio-kbs.ts:519` | `POST /api/studio/kbs` (create) | `existsSync` **follows** the symlink and returns 409 before the write; a *dangling* link makes recursive `mkdirSync` fail `EEXIST`. Either way no write reaches the target. `[exec]` |
| `cli/bridge-studio-kbs.ts:568` | `DELETE /api/studio/kbs/:id` | `rmSync` on a symlink unlinks the **pointer only** — POSIX/Node never descend into the target. Verified three ways, target byte-identical each time. A UX footgun (reports success while only vanishing a pointer), not a vulnerability. `[exec]` |
| `cli/bridge-studio-kbs.ts:87-116` (`subDirs`, feeding `loadKbDescriptors`) | `GET /api/studio/kbs`, whole-KB detail | `readdirSync(..., {withFileTypes:true}).filter(e => e.isDirectory())` — `isDirectory()` is **false for a symlink**, so a symlinked `brain/<id>` DIRECTORY is never discovered. Blocks the pure slug-symlink shape *only*. The nested shapes went straight through it (that is how the write hole survived), and so did a symlinked `kb.yaml` LEAF — see the fixed row above. The dirent filter is retained, but it is no longer what protects this route. `[exec]` |
| `orchestrator/kb-graph.ts:94-101` (`walkMdFiles`) | `_raw` recursive walk | Same dirent-type filter: `isDirectory()` **and** `isFile()` are both false for a symlinked entry, so a symlink cannot enter the result set. **Residual, stated:** a *hardlinked* `.md` deep inside a real `_raw/` tree is a genuine regular file and passes this filter. `[exec]` |
| `orchestrator/skill-path.ts` / `hook-library.ts` nested package walks | skills/hooks detail | Same dirent-type filter on the recursive walk. Note this protected only the *nested* entries — the top-level dir and the fixed-filename direct reads had no such protection, which is what this sweep fixed. `[read]` |
| `cli/bridge-recovery.ts:121`, `cli/bridge-studio-runs.ts:715,717` | requeue / run start | `renameSync` on a symlink source moves the **link**, not the target, and atomically replaces a destination dirent rather than writing through it. `rmSync` likewise never dereferences. `[read]` |
| `cli/bridge-studio-runs.ts:739` | `POST /api/runs/:id/resume` | `resumeFromDemo` was **hardcoded `true`** at this call site, so the destructive `rmSync` branch was structurally unreachable *from here* — the accident was the flag, not a guard on `worktree_path`, and the same function reached from `/api/recovery/:id/requeue` **was** exploitable. **No longer load-bearing:** SEC-02 put a real containment assertion on the value inside `runRequeue` itself, so this row is now genuinely guarded and the hardcoded flag is redundant rather than protective. `[exec]` |
| `cli/bridge-studio.ts:734-808` | project preflight / repo-status / roadmap | `id` is used only as an equality-filter key against server-`readdirSync`-derived ids; it never reaches a `join`. `[read]` |
| `orchestrator/flow-run-requests.ts:77` | `POST /api/hooks/:hookId` | The path's only variable component is read from the matched flow's own `flow.yaml` (operator config), not from the HTTP payload; payload fields are written as JSON *content* only. `[read]` |

### `[unver]` — never claimed safe

- `cli/metrics.ts::summariseCycle` reached from `GET /api/cost/:cycleId` with an unvalidated `cycleId` — downstream fs behaviour not traced.
- `ctx.rerunReflector({cycleId})` at `cli/ui-bridge.ts:2507` — downstream fs behaviour not traced.
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
| `orchestrator/studio/session-transcript.ts` | `safeReadFileInSession`, `listDirEntries` | guarded |
| `orchestrator/studio/hook-library.ts` | `resolveHookScriptPath`; `hookDir` / `hookYamlPath` | guarded; the latter two **fixed at the call sites** |
| `orchestrator/skill-path.ts` | `skillPath` / `skillDir` | **fixed at the call sites** |
| `orchestrator/project-config.ts` | `readAgentInstructionsFile`, `readQualityGateSidecar` | unguarded → `forge-2zz` |
| `orchestrator/studio/skill-library.ts`, `community-install.ts`, `community-index.ts` | package install/read | unguarded → `forge-q80` |
| `orchestrator/requeue-resume.ts`, `flow-artifacts.ts`, `logging.ts` | manifest-carried `worktree_path` / `cycle_id` | **fixed in SEC-02** (`forge-d1f`) |
| `orchestrator/mint-triggered-initiative.ts` | mints a queue manifest from a flow's `project` field (background flow-trigger sweep, fed by `PUT /api/studio/flows/:id`) | **fixed in SEC-03** — previously bypassed `writeManifest` entirely; see "Fixed in SEC-03" above |
| `orchestrator/review-comments.ts`, `enqueue-*.ts`, `project-create.ts` | charset-gated | guarded |
| `orchestrator/agent-dispatch.ts` (`discoverStagedMaterials`) | `readdirSync` on `<logsRoot>/<runId>/materials` — lists staged materials so their references reach the agent prompt. **Supersedes the "no request-derived path" row below for `agent-dispatch.ts`** (R6-04 WI-1). `runId` is server-minted (`_agent-<slug>-<stamp>`, from a `SAFE_AGENT_SLUG_RE`-validated slug) and `logsRoot` is config-derived, so nothing request-supplied reaches this call site; read-only listing, errno discriminated (ENOENT silent, anything else surfaced) rather than swallowed. | guarded `[exec]` |
| `orchestrator/studio/connection-library.ts`, `daemon.ts`, `agent-dispatch.ts` | — | no request-derived path reaches a filesystem call |
| `orchestrator/finalize-merged.ts` | manifest-carried `worktree_path` / `project_repo_path` / `cycle_id` → `confirmMerge`, `pendingFixWorkItems`, `createLogger`, `writeVerdictJson`, `CycleInput` | **fixed in SEC-02**. This row previously read "no request-derived path reaches a filesystem call" and was WRONG: the merge-confirmation sweep reads all three fields off a `ready-for-review/` manifest into the same sinks as the verdict handler, from a different entry point. |
| `orchestrator/drain-fix-loop.ts` | manifest-carried `worktree_path` / `project_repo_path` / `cycle_id` → `spawnSync(git, {cwd})`, `pendingFixWorkItems`, `createLogger`, and a full `CycleInput` re-entering `runCycle({resumeFrom:'develop'})` | **fixed in SEC-02**. Absent from this table entirely until the entry-point sweep found it. The worst instance in the WI: an unattended daemon sweep re-running a whole cycle (dev-loop, PM, demo, adversarial-review) against an attacker-chosen worktree and repo path. |
| `orchestrator/flow-run-requests.ts` | `drainFlowRunRequests`'s `rmSync(path, …)` calls in its skip branches (`skipped-malformed` / `skipped-no-initiative` / `skipped-concurrency`, and **`skipped-out-of-scope`, added R2-08-F1** — the new per-project trigger-scoping skip) | no request-derived path reaches this sink. `path` in every one of these branches is the literal file path returned by `listFlowRunRequests`'s own `readdirSync(flowRunsDir(queueRoot))` enumeration — it is never built by concatenating `req.target.ref`, `req.eventProject`, `req.projects`, `req.triggeredBy`, or any other request/trigger-carried field into a path. The R2-08-F1 out-of-scope check itself is a pure string-identity comparison (`req.projects.includes(req.eventProject)`) with no path construction at all — the fifth `rmSync` call is the same shape as the four pre-existing sibling calls, not a new kind of site. (The row above at `orchestrator/flow-run-requests.ts:77`, in Table 1, covers the DIFFERENT `writeFileSync` call in `stageFlowRunRequest` — that one does have a request-adjacent path component, the target flow's own `flow.yaml`-declared ref, and is classified `accidentally-safe` there.) |

**Root-folding: zero instances.** Every `resolveGuardedPath` call site — the five from R2-09 and the nine added by this sweep — passes a fixed, config-derived `root` and puts each untrusted id in `segments[]`. This was verified call site by call site as a named review checklist line, because the two forms differ by one pair of brackets and only one is safe.

---

## Recorded design assumption — `CycleInput` and the ingest choke point

`orchestrator/scheduler.ts` (the `resolve('projects', m.project)` fallback for a
manifest with no `project_repo_path`) and every consumer that receives a built
`CycleInput` are **not** individually guarded, by design. They are safe **iff every
path by which a manifest reaches disk passes ingest validation** — `writeManifest`,
whose three production callers, as of SEC-03, are `orchestrator/promote-manifests.ts`,
`POST /api/initiatives`, and `orchestrator/mint-triggered-initiative.ts` (added by
SEC-03 — previously bypassed the choke point entirely; see "Fixed in SEC-03" above).

This is written down rather than left as silence so nobody later reads the absence of
a row as evidence of coverage. The condition is load-bearing: SEC-02 itself found
THREE consumers (`runRequeue`, `applyReviewVerdict`, and the two sweeps) that read
manifests which had **not** necessarily come through ingest, and each needed its own
assertion; SEC-03 found a FOURTH writer that bypassed the choke point on the write
side instead (`mint-triggered-initiative.ts`, now closed — moved into class 1 below).
Writers of manifest frontmatter fall into exactly three classes, and the third is
real — the taxonomy is stated in full so it cannot be read as exhaustive when it is
not:

1. **Routes through `writeManifest`** — validated at ingest. Three production
   ingest callers as of SEC-03: `orchestrator/promote-manifests.ts`,
   `cli/bridge-recovery.ts`'s `POST /api/initiatives`, and
   `orchestrator/mint-triggered-initiative.ts`.
2. **Carries its own assertion** — `runRequeue`, `applyReviewVerdict`,
   `finalize-merged.ts`, `drain-fix-loop.ts`. These read manifests that did not
   necessarily come through ingest, so each guards at its own boundary.
3. **Writes a value that is TRUSTED AT CONSTRUCTION, and revalidates nothing** —
   these do not derive the value from request data at all, so there is nothing to
   validate against `forgeRoot`. The complete set, as of SEC-03's entry-point sweep
   (previously this list named only the first two):
   - `orchestrator/scheduler.ts:749`'s
     `annotateManifest(manifestPath, { worktree_path: wtHandle.path })`, a raw
     frontmatter regex edit that bypasses `writeManifest` entirely. Safe because
     `wtHandle.path` is `resolve(worktreesRoot, initiativeId)` — computed by forge
     from config plus an already-pattern-gated id, never client-derived.
   - The `persistManifest*` family in `orchestrator/manifest.ts` — round-trips an
     already-on-disk manifest through `serializeManifest` + `writeFileSync` without
     revalidating anything.
   - `orchestrator/scheduler-dispatch.ts`'s `annotateManifestForRetry` — re-parses
     and re-serialises an already-on-disk manifest, mutating only `retry_count` and
     `previous_failure_modes`; no path-shaped field is touched.
   - `orchestrator/enqueue-flow-run.ts` and `orchestrator/enqueue-plan-run.ts` — each
     re-serialises an already-on-disk manifest to "repoint" it, mutating only
     `flow_id`/`phase` and deleting `resume_from`/`claimed_at`/`claimed_by`; no
     path-shaped field is touched.
   - `cli/bridge-studio-runs.ts`'s `POST /api/runs` — re-serialises an already-on-disk
     manifest, mutating only `origin` (constrained server-side to the literal union
     `'architect' | 'human-directed'`, never the request's raw string).

   **Not class 3, and not an ingest point either — a pre-ingest STAGING tier:**
   `orchestrator/architect-runner.ts` writes and amends DRAFT manifests directly into
   `paths.manifestsDir` (`mkdirSync` + `writeFileSync`/`serializeManifest`, multiple
   call sites). This is not a bypass of the choke point: every draft written there is
   later PROMOTED through the class-1 path (`promoteManifests(paths.manifestsDir,
   ...)` — the same `orchestrator/promote-manifests.ts` this section already counts
   as a `writeManifest` caller), and the fields the architect writes at the drafting
   stage (initiative id, title, acceptance criteria, body prose) never include a
   path-shaped field — `project_repo_path`/`worktree_path`/`cycle_id` are added later,
   at promotion, not here.

Class 3 is the fragile one: its safety is a property of the *caller*, so a future
change that lets request data reach one of those constructed values removes the
protection with nothing in the writer to notice. A new writer must land in class 1 or
2, or explicitly argue its way into class 3 and say why.

---

## Completeness rule — one surface, many observers

**Sweep for the other surfaces that OBSERVE the state you claim to have cleaned
up.** This is the mirror of the sink rule below, and SEC-03 round 4 paid for it:
a create-route rejection was proven to leave nothing behind because every
acceptance test checked `GET /api/studio/projects` — and none checked
`GET /api/studio/kbs`. A complete, valid `brain/projects/<id>/kb.yaml` was being
left on disk, `loadKbDescriptors` scans `brain/projects/` as a second
containment root, and the operator got a **phantom KB bound to a project they
had been told was never created**: invisible to `discoverProjects`, undetected
by `forge studio lint` and `forge brain lint`, and strictly worse than the
visible half-created directory it had replaced.

We had been rigorous about enumerating every CALLER of a sink. The same
discipline applies to READERS of state: before claiming an operation left
nothing behind, enumerate every listing, lint, graph and index that reads the
directories it could have touched, and assert on each. A cleanup claim verified
through one observer is verified for that observer only.

## Completeness rule — one sink, many entry points

**For every module in this table, sweep the siblings its own documentation names.**

SEC-02 was saved by this twice. The filing named ONE entry point (an HTTP ingest
route). Adversarial review found a second (the HTTP verdict handler, which reads its
manifest from disk and therefore never sees ingest validation at all). The
entry-point sweep found a third and fourth: two background daemon sweeps,
`finalize-merged.ts` and `drain-fix-loop.ts` — and `drain-fix-loop.ts`'s own docstring
calls it "a sibling of `finalize-merged`", while this table tracked one and not the
other.

The generalisable failure: **acceptance tests pin the entry point they know about.**
Guarding a sink is not finished when the route that discovered it goes green. Before
closing any containment work, enumerate every caller of every sink touched and state
each one's status individually — a caller you did not check is "not checked", never
"covered".

---

## Mechanical backstop — the no-new-unguarded-sinks ratchet (SEC-03)

`scripts/check-request-path-sinks.mjs` — wired into `npm test` via
`scripts/check-request-path-sinks.test.ts`, and into CI as its own step
(`.github/workflows/ci.yml`, "Request-path sinks ratchet check") — is a checked-in
ratchet against `scripts/request-path-sinks.baseline.txt`. It walks every module
reachable, via relative imports, from `cli/ui-bridge.ts` plus every `cli/bridge-*.ts`,
counts calls to a fixed list of fs/process sinks (`writeFileSync`, `readFileSync`,
`mkdirSync`, `rmSync`, `spawn`, `execSync`, etc. — 24 names total) per reachable file,
and fails the build the moment a NEW `(file, sink)` pair appears or an existing pair's
call count goes UP versus the baseline. It never tightens the wrong way on its own — a
count drop or a disappearing pair passes silently, since removing a sink is never a
regression; `--write` regenerates the baseline and still requires a human to look at
the diff before it is committed.

**What it covers.** It forces a stop-and-look the moment a NEW request-derived-path
*shape* appears anywhere reachable from a bridge HTTP route in `cli/`/`orchestrator/`
— a new file entering the reachable set, or a new/growing sink call inside a file
already in it. That is precisely the discovery gap this document's own introduction
names: "the same defect was found ten separate times across six initiatives, always
opportunistically... discovery was luck-driven."

**What it provably cannot do — stated here in substance because an audit or lint that
overstates its own rigour is worse than none (the script's own header states this
explicitly, and states it first):**

- **No dataflow.** It cannot tell a request-derived path from a hardcoded constant —
  `writeFileSync('/tmp/known-safe-file', x)` counts identically to
  `writeFileSync(join(root, req.params.id), x)`. A human (or this document) still has
  to make that call for every new line the ratchet flags.
- **Aliased or dynamically-dispatched sinks are invisible.** `const w = writeFileSync`,
  `fs[name](...)`, and a sink re-exported under a new local name all evade the
  `\bNAME\(` match.
- **`fs/promises` is not tracked** — only the synchronous `node:fs` names plus
  `child_process`. A promise-based rewrite of a guarded site produces zero signal.
- **A guarded site that becomes unguarded through an edit to its GUARD produces no
  signal at all.** The ratchet key is `(file, sink, count)` — pure call-site
  bookkeeping, not "is this call preceded by a guard call". Gutting
  `resolveGuardedPath` itself, while leaving the sink call and surrounding line count
  unchanged, is invisible to this script.
- **Only UNQUALIFIED calls are counted** (`(?<![.\w$])NAME\(`) — a receiver-qualified
  call (`fs.writeFileSync(...)`, any namespace import) is invisible. This is a
  deliberate, measured trade documented in the script's own header (every sink call in
  `cli/`+`orchestrator/` today is a named import called bare; counting `.`-qualified
  calls too would flag ordinary `regex.exec()` calls and train an author to blind
  `--write` past the noise — the failure mode that destroys a ratchet's value).
- **The comment filter is line-based, not a real parser**, and string literals are
  never parsed at all — a sink name appearing inside a string can be over-counted, but
  reachability itself (which files get walked) is exact for the import forms followed.
- **Reachability only follows relative static/dynamic imports with string-literal
  specifiers**, restricted to files under `cli/`/`orchestrator/`. Bare-specifier (npm
  package) imports are never followed.

**Tying this to the Standing rule below.** Until SEC-03, the obligation to guard a new
request-derived path and add its row here was enforced by discipline alone — reading
this document and remembering to check it. The ratchet is a mechanical backstop *on
top of* that discipline, not a replacement for it: a green run means "the known
reachable sink surface has not grown since the baseline was last accepted", never "the
reachable surface is safe". It is a **call-shape tripwire, not a proof** — the actual
judgment of guarded/unguarded/accidentally-safe for any given site is, and remains,
this document's job, row by row.

## Standing rules

**Guard the paths you WRITE, not the paths you merely test for existence**
(SEC-03 round 2). A containment verdict must never abort an operation that was
not going to write. The first version of SEC-03's own fix ran
`resolveGuardedPath` ahead of an idempotency probe, and because that guard
rejects any leaf with `nlink !== 1`, an ordinary IN-REPO hardlinked `roadmap.md`
— nothing outside the forge root, no write intended — failed the entire onboard
with a message naming a traversal that had not occurred. A security check that
breaks a legitimate workflow is, for the operator it stops, worse than the hole
it closes. Probe existence first; guard only the path you are about to write
through. A dangling symlink still reads as absent to a `stat`-based probe, so it
still reaches the guard and is still rejected — the escape stays closed.

**Validating a root does not validate what you write beneath it** (SEC-03
Defect 5; the fifth time in this campaign a containment fix shipped its own
containment bug). `isContainedProjectRepoPath(projectRoot)` answers one question
— is this directory contained? — and says nothing about `<projectRoot>/anything`.
Once a root is proved, hand it to `resolveGuardedPath(root, [segment, …])` with
every component you intend to write as its own element, and write through the
`realPath` it returns rather than building a second, unguarded path for the same
write.

Any new route, or any change to an existing one, that turns request data into a filesystem path must add its row here and route through `resolveGuardedPath` with a fixed root and the untrusted id as its own segment. A charset regex is the first layer, never the containment. If a site cannot be expressed as `<fixed root>/<segments...>`, that is the signal it needs a design decision rather than a guard call — file it rather than force-fitting.

Since SEC-03, `scripts/check-request-path-sinks.mjs` (above) gives this rule a mechanical backstop in CI and `npm test` — but the backstop only proves the reachable sink surface has not silently grown; the obligation to guard the site and add its row here remains entirely on the author, never the tool.
