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

## Summary

| | Count |
|---|---|
| Sites enumerated | 78 |
| `guarded` | 14 |
| `unguarded` | 49 |
| `accidentally-safe` | 9 |
| `[unver]` | 6 |
| Fixed in this sweep | 13 |
| Filed for follow-up (need a different containment design) | 4 bd issues |

Executed live (`[exec]`): 24 sites. The remaining rows are `[read]`.

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
| `cli/bridge-studio-kbs.ts` create / delete / nodes / detail routes | `mkdirSync`/`rmSync`/reads | `POST /api/studio/kbs`, `DELETE /:id`, `GET /:id`, `GET /:id/nodes/:nodeId` | unguarded `[exec]` | Five vacuous `startsWith` checks. Two guarded the real create path; three built a `kbDir` they never used. The unused ones are **deleted** rather than kept as false assurance. |
| `cli/bridge-studio-writes.ts:1010` (`flowProjectOf`) | `readFileSync` | `PUT /api/studio/flows/:id` body `triggers[].target.ref` | unguarded `[exec]` | bd `forge-b2k`. **Existence oracle** (a read, not a write): `ref` comes from the request *body* and the route's `SLUG_RE` gate covers the URL param only. Now `SLUG_RE` + guard, with every rejection returning `undefined` so a rejected and an absent flow are indistinguishable — an oracle closes only when those two cases cannot be told apart. |
| `cli/bridge-studio.ts:618` | `readFileSync` | `GET /api/studio/flows/:id` | unguarded `[exec]` | Guard symmetry: the `PUT` sibling was hardened, this `GET` was not — a symlinked `studio/flows/<id>` disclosed an outside `flow.yaml`. |
| `cli/bridge-studio-skills.ts:230,269` | `readFileSync`, `approveSkillDraft` | `GET /api/studio/skills/:id`, `POST /:id/approve` | unguarded `[exec]` | **Arbitrary file WRITE** on the approve route: confirmed live mutating a `SKILL.md` outside the repo through a symlinked `skills/<id>`. Resolved via `skillPath()` = `assertSkillSlug` (charset only) + bare `join()`. |
| `cli/bridge-studio-hooks.ts:245,259-261,280,306,342` | `mkdirSync`/`writeFileSync`/`readFileSync` | `POST /api/studio/hooks`, `/:id/approve`, `/:id/override`, `GET /:id` | unguarded `[exec]` | **Arbitrary file WRITE** on create: confirmed live writing `hook.yaml` + `scripts/run.sh` into a symlinked outside dir. `hookDir`/`hookYamlPath` are `assertSkillSlug` + bare `join()`. |

Each fix keeps the charset check as an independent **first layer** and adds containment as the second — the guard module deliberately never validates slug shape. Rejections collapse into the same 404 as a genuinely unknown object so the routes are not probes for which ids are planted.

### Unguarded — filed, not fixed (a different containment design is required)

| file:line | op | request field | class | evidence / why not mechanical |
|---|---|---|---|---|
| `cli/ui-bridge.ts:1539,1808,2259,2311` (+ the sessions they seed) | `writeFileSync`/`readFileSync` | `POST /api/{architect,instructions,project-brain,demo-builder}/start` body **`projectRepoPath`** | unguarded `[read]` | Accepted **verbatim** — not a slug resolving under a trusted root but an arbitrary absolute path, then *persisted* into `status.json` as ground truth for the rest of the session. `resolveGuardedPath` assumes `<root>/<id>`; it has no answer for "the client handed me the whole path". Needs an allowlist against `discoverProjects()`, or the field removed. → bd `forge-28o` |
| `cli/ui-bridge.ts:1533,1813,2261,2316` and ~14 sibling session routes | `mkdirSync`/`writeFileSync` | body `project`, `sessionId` | unguarded `[read]` | `architectSessionDir(projectsRoot, body.project, sessionId)` with only a truthiness check — `SAFE_PROJECT_NAME_RE` exists in the same file and is never applied. A `..`-bearing `project` escapes `projectsRoot` and `mkdirSync(recursive:true)` creates it. → bd `forge-28o` |
| `cli/ui-bridge.ts:1500,1774,2145,2210` | `existsSync`/`readFileSync` | `GET /api/{architect,instructions}/file/:project/:sid/:filename`, demo-builder fragment/history | unguarded `[read]` | Self-defeating idiom: `base` **and** `requested` are both built from the same unvalidated `project`/`sessionId`, so `requested.startsWith(base)` bakes the taint into both operands and cannot fail for traversal inside those segments. The guard must run on the *inputs*, not on two paths built from them. → bd `forge-28o` |
| `cli/ui-bridge.ts:781,818,853,904,2468,2489` | `readFileSync`/`writeFileSync` | `GET /api/events/:cycleId`, `/graph/`, `/work-item/`, `/artifact/`, `POST /api/reflect/:cycleId/answer` | unguarded `[read]` | `cycleId` is `decodeURIComponent`'d with no validation on most of these (the `/artifact/` route alone charset-gates it). `POST /api/reflect/:cycleId/answer` is a **write**. → bd `forge-2zz` |
| `cli/forge-requeue.ts:209`, `orchestrator/requeue-resume.ts:68-189`, `cli/bridge-studio-runs.ts:185,327,474`, `cli/bridge-recovery.ts:96,111` | **`rmSync(recursive)`**, reads, writes | `POST /api/initiatives` body manifest → frontmatter `worktree_path`, `project_repo_path`, `cycle_id` | unguarded `[read]` | Highest severity of the filed set: an **unconditional recursive delete** of a directory named in an attacker-supplied manifest, reached via `POST /api/recovery/:id/requeue` (`resumeFromDemo` defaults false → `preserveWorktree` false). The `worktree_path` check elsewhere is lexical-on-unresolved. Per-read-site guarding is whack-a-mole; these fields must be validated **at manifest write time**. → bd `forge-d1f` |
| `orchestrator/studio/skill-library.ts:500-537,613-631`, `orchestrator/studio/community-install.ts:163-176` | `readdirSync`/`writeFileSync` | `POST /api/studio/skills/install` body **`packageDir`**; community install | unguarded `[read]` | Two problems. (1) `packageDir` *is* the containment root — a raw client string with no allowlist tying it to any forge directory, so any server-local path can be named and copied into `skills/<id>/`. (2) The install loop writes N entries whose own relative sub-paths are joined onto the destination — the classic zip-slip shape, needing **per-entry** verification, not one call. → bd `forge-q80` |
| `cli/bridge-studio-writes.ts:679-737` | `mkdirSync`/`writeFileSync` | `POST /api/studio/projects` body **`repoPath`** | unguarded `[read]` | The final `writeFileSync` of `.forge/project.json` has **no existence check at all**, so a fresh non-colliding `name` with `repoPath` aimed at another onboarded project clobbers that project's config — including the `quality_gate_cmd` forge later executes. A path guard proves "under the root"; it cannot prove "not already someone else's project". Application-level invariant. → bd `forge-q80` |
| `cli/bridge-studio-kbs.ts:788-794` | spawn arg | `POST /api/studio/kbs/:id/maintenance` body `file` | unguarded `[read]` | Client supplies a full absolute path; `resolve(file) !== file → reject` blocks `..` but does no realpath. `segments[]` requires single-component names, so this needs a request-shape change (`{kbId, relPath}`), not a guard call. → bd `forge-2zz` |
| `cli/bridge-studio.ts:471`, `cli/bridge-studio-kbs.ts:151`, `cli/bridge-studio.ts:389` | `readFileSync` | `GET /api/runs/:id/phases/:node/log`, `/kbs/:id/fix-agent/:runId`, preflight fix-agent | unguarded `[read]` | Lexical `resolve+startsWith`. The phase-log route does not charset-gate `runId` at all, unlike every sibling in that file. Exploitability needs a pre-planted symlink under `_logs/`; no HTTP-reachable primitive to plant one was found, so severity is low — but the checks provide no containment. → bd `forge-2zz` |
| `orchestrator/project-config.ts:305-308,326-328` | `existsSync`/`readFileSync` | `PUT /api/studio/projects/:id` → real `projectRoot` + `AGENTS.md` / `.forge/quality_gate_cmd` | unguarded `[read]` | A symlinked `.forge` directory or leaf is followed, three lines from a sibling call that closes exactly that shape. Mechanical, but outside this sweep's route set and reached from the scheduler too. → bd `forge-2zz` |
| `orchestrator/flow-artifacts.ts:167-171`, `orchestrator/logging.ts:124-138` | `mkdirSync`/`writeFileSync`/`appendFileSync` | `manifest.cycle_id` | unguarded `[read]` | `resolve(logsRoot, cycleId)` normalises a poisoned id straight past `logsRoot`. Same manifest-validation root cause. → bd `forge-d1f` |
| `orchestrator/studio/community-index.ts:271-274,310-323` | `readFileSync` | `GET /api/studio/community/:kind/:id` | unguarded `[read]` | Fixed-filename direct reads bypass the dirent-walk protection the rest of that module gets — a leaf-symlinked `SKILL.md`/`hook.yaml` inside an otherwise dir-guarded package is followed. → bd `forge-q80` |
| `cli/bridge-studio-runs.ts:559,598,603` | `readFileSync`/`writeFileSync` | `POST /api/plan-verdict` body `project`, `sessionId` | unguarded `[read]` | `project` **is** `SLUG_RE`-gated and `sessionId` `SAFE_ID_RE`-gated here (materially stronger than the `ui-bridge.ts` equivalents), but `_architectSessionDir` is still a bare `join()` with no realpath. → bd `forge-28o` |
| `cli/bridge-recovery.ts:56,86,96,107` | `existsSync`/`readFileSync` | `GET /api/recovery/:id` | unguarded `[read]` | `INIT_ID_RE`-gated, lexical join only. → bd `forge-d1f` |

### Accidentally-safe — the accident is the protection, and nothing knows it

These are **not** fixed. Each is blocked by a side effect of unrelated code; a refactor of that unrelated code removes the protection silently. Every one carries a regression-lock test with the accident named in a comment.

| file:line | route | the accident, named |
|---|---|---|
| `cli/bridge-studio-kbs.ts:519` | `POST /api/studio/kbs` (create) | `existsSync` **follows** the symlink and returns 409 before the write; a *dangling* link makes recursive `mkdirSync` fail `EEXIST`. Either way no write reaches the target. `[exec]` |
| `cli/bridge-studio-kbs.ts:568` | `DELETE /api/studio/kbs/:id` | `rmSync` on a symlink unlinks the **pointer only** — POSIX/Node never descend into the target. Verified three ways, target byte-identical each time. A UX footgun (reports success while only vanishing a pointer), not a vulnerability. `[exec]` |
| `cli/bridge-studio-kbs.ts:87-113` (`loadKbDescriptors`) | `GET /api/studio/kbs`, whole-KB detail | `readdirSync(..., {withFileTypes:true}).filter(e => e.isDirectory())` — `isDirectory()` is **false for a symlink**, so a symlinked `brain/<id>` is never discovered. Blocks the pure slug-symlink shape *only*; the nested shapes went straight through it, which is how the write hole survived. `[exec]` |
| `orchestrator/kb-graph.ts:94-101` (`walkMdFiles`) | `_raw` recursive walk | Same dirent-type filter: `isDirectory()` **and** `isFile()` are both false for a symlinked entry, so a symlink cannot enter the result set. **Residual, stated:** a *hardlinked* `.md` deep inside a real `_raw/` tree is a genuine regular file and passes this filter. `[exec]` |
| `orchestrator/skill-path.ts` / `hook-library.ts` nested package walks | skills/hooks detail | Same dirent-type filter on the recursive walk. Note this protected only the *nested* entries — the top-level dir and the fixed-filename direct reads had no such protection, which is what this sweep fixed. `[read]` |
| `cli/bridge-recovery.ts:121`, `cli/bridge-studio-runs.ts:715,717` | requeue / run start | `renameSync` on a symlink source moves the **link**, not the target, and atomically replaces a destination dirent rather than writing through it. `rmSync` likewise never dereferences. `[read]` |
| `cli/bridge-studio-runs.ts:739` | `POST /api/runs/:id/resume` | `resumeFromDemo` is **hardcoded `true`** at this call site, so the destructive `rmSync` branch is structurally unreachable *from here*. The accident is the hardcoded flag, not a guard on `worktree_path` — the same function reached from `/api/recovery/:id/requeue` **is** exploitable (filed as `forge-d1f`). `[read]` |
| `cli/bridge-studio.ts:734-808` | project preflight / repo-status / roadmap | `id` is used only as an equality-filter key against server-`readdirSync`-derived ids; it never reaches a `join`. `[read]` |
| `orchestrator/flow-run-requests.ts:77` | `POST /api/hooks/:hookId` | The path's only variable component is read from the matched flow's own `flow.yaml` (operator config), not from the HTTP payload; payload fields are written as JSON *content* only. `[read]` |

### `[unver]` — never claimed safe

- `cli/metrics.ts::summariseCycle` reached from `GET /api/cost/:cycleId` with an unvalidated `cycleId` — downstream fs behaviour not traced.
- `ctx.rerunReflector({cycleId})` at `cli/ui-bridge.ts:2507` — downstream fs behaviour not traced.
- The `brain fix --file <abs>` child process spawned by the KB maintenance route — the child's own path handling not read.
- Hardlink vectors at the KB routes: the guidance leaf filename is timestamp-generated (unguessable to pre-plant) and the only fixed-name write requires its parent not to pre-exist. Recorded **unverified-as-inapplicable**, not safe.
- `orchestrator/kb-health.ts` shares `resolveKbBrainDir` (now fixed) but is reflector-internal; no HTTP route reaches it today. Flagged for future exposure.
- Whether a symlink can be planted through the HTTP surface **alone** for each "pre-plant" precondition above, versus requiring local checkout access. The structural defects are confirmed by reading; the end-to-end plant-then-exploit chain was established only where marked `[exec]`. `forge-wze`'s urgency rests on R3-07's community-install path making planted third-party content a live vector.

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
| `orchestrator/requeue-resume.ts`, `flow-artifacts.ts`, `logging.ts` | manifest-carried `worktree_path` / `cycle_id` | unguarded → `forge-d1f` |
| `orchestrator/review-comments.ts`, `enqueue-*.ts`, `project-create.ts` | charset-gated | guarded |
| `orchestrator/studio/connection-library.ts`, `daemon.ts`, `agent-dispatch.ts`, `finalize-merged.ts` | — | no request-derived path reaches a filesystem call |

**Root-folding: zero instances.** Every `resolveGuardedPath` call site — the five from R2-09 and the nine added by this sweep — passes a fixed, config-derived `root` and puts each untrusted id in `segments[]`. This was verified call site by call site as a named review checklist line, because the two forms differ by one pair of brackets and only one is safe.

---

## Standing rule

Any new route, or any change to an existing one, that turns request data into a filesystem path must add its row here and route through `resolveGuardedPath` with a fixed root and the untrusted id as its own segment. A charset regex is the first layer, never the containment. If a site cannot be expressed as `<fixed root>/<segments...>`, that is the signal it needs a design decision rather than a guard call — file it rather than force-fitting.
