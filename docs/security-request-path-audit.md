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
| Classified rows below | 53 |
| — `guarded` | 14 |
| — fixed in this sweep (all were `unguarded`) | 12 |
| — fixed later in SEC-02 (`forge-d1f`) | 3 |
| — fixed later in R4-16 (the four `/start` routes' `projectRepoPath`) | 1 |
| — fixed later in SEC-03 | 4 |
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
| `orchestrator/project-brain-seed.ts:157-188` (`seedProjectBrain`), `orchestrator/brain-paths.ts:55,60` (`projectBrainDir`/`projectThemesDir`) | `mkdirSync`/`writeFileSync` | `POST /api/studio/projects` body `name` -> the slugified `projectId` | **fixed** `[exec]` | Found by the SECOND adversarial round, reachable from the SAME route two calls after the Defect-5 fix, in the module SEC-01 had already hardened once — `projectBrainDir`/`projectThemesDir` are `resolveKbBrainDir`'s unguarded siblings. `seedProjectBrain` wrote `kb.yaml`, `profile.md` and `themes/README.md` through bare `join()`s and `mkdirSync`'d `themes/` recursively through a symlinked segment before any write. `projectId` is `SLUG_RE`-validated, so the vector is a pre-planted symlink, not a traversing id. **All FIVE shapes reproduced live, none accidentally safe** (ATs 24-28): `brain/projects/<id>` as a symlinked dir; `brain/projects/<id>/themes` as a symlinked dir with `<id>` itself real; and dangling symlinks at `kb.yaml`, `profile.md` and `themes/README.md`. Contrast the Defect-5 round, where 4 of 8 sub-shapes were blocked by accident — this function has no `existsSync` in front of the directory shapes, and its per-file probe is `stat`-based so a dangling link reads as absent. Closed with ONE choke point across all three writes: `resolveGuardedPath` rooted at the fixed `<forgeRoot>/brain/projects` with `projectId` and every component below it as their OWN `segments[]` elements. The two directory shapes are why guarding `brain/projects/<id>` alone would not have been enough — the same "validating a root does not validate what you write beneath it" principle, one level deeper. **Failure behaviour, verified per claim and NOT inherited from this row's `[exec]` tag** (see the methodology rule on per-claim verification): an earlier revision of this sentence said "both callers fail closed: the route returns a generic 400 before writing `.forge/project.json`" — the same claim the project-create row above spends a paragraph disproving. It was wrong for the same reason and survived the first retroactive sweep because that sweep was per-ROW-TAG, and this row's `[exec]` was earned by a different claim (the five escape shapes). What is true, executed: a containment rejection returns 400 and, after SEC-03 round 4's two-phase fix, leaves nothing on disk in EITHER `projects/` or `brain/projects/` on either route. The intermediate round-3 ordering fix did NOT achieve that — it moved a WRITING call earlier, which relocated the orphan rather than removing it: an unrelated later failure left a complete `brain/projects/<id>/kb.yaml`, and because `loadKbDescriptors` scans `brain/projects/` as a second containment root the operator got a **phantom KB bound to a project they were told was never created** — invisible to `discoverProjects` and undetected by `forge studio lint` and `forge brain lint`. Closed by separating the CHECK from the WRITE: phase 1 resolves and containment-checks every path either route will write, with zero side effects; phase 2 writes. |

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
| `orchestrator/studio/connection-library.ts`, `daemon.ts`, `agent-dispatch.ts` | — | no request-derived path reaches a filesystem call |
| `orchestrator/finalize-merged.ts` | manifest-carried `worktree_path` / `project_repo_path` / `cycle_id` → `confirmMerge`, `pendingFixWorkItems`, `createLogger`, `writeVerdictJson`, `CycleInput` | **fixed in SEC-02**. This row previously read "no request-derived path reaches a filesystem call" and was WRONG: the merge-confirmation sweep reads all three fields off a `ready-for-review/` manifest into the same sinks as the verdict handler, from a different entry point. |
| `orchestrator/drain-fix-loop.ts` | manifest-carried `worktree_path` / `project_repo_path` / `cycle_id` → `spawnSync(git, {cwd})`, `pendingFixWorkItems`, `createLogger`, and a full `CycleInput` re-entering `runCycle({resumeFrom:'develop'})` | **fixed in SEC-02**. Absent from this table entirely until the entry-point sweep found it. The worst instance in the WI: an unattended daemon sweep re-running a whole cycle (dev-loop, PM, demo, adversarial-review) against an attacker-chosen worktree and repo path. |

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
