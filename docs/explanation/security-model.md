# The request-path security model

*Explanation.* Why forge treats request-derived filesystem paths as a closed,
enumerated class rather than a bug to fix when found — the escape shapes, the
rules a guard must satisfy, and the ratchet that keeps the enumeration true.

The per-sink enumeration itself is the companion reference page,
[`request-path-sinks.md`](../reference/request-path-sinks.md): every read and
write in `cli/` and `orchestrator/` whose path derives from request data,
classified `guarded` / `unguarded` / `accidentally-safe`. **When the ratchet
tells you to add a row, that is the page it means.**

**Why this document exists.** Between 2026-07 and 2026-08 the same defect was found ten separate times across six initiatives, always opportunistically: a lexical `resolve(base, id).startsWith(base + sep)` containment check on an *unresolved* path. That shape is worthless — `resolve()`/`join()` normalise `..` before the comparison ever runs, and a symlink's own on-disk location is lexically inside the allowed root even when it points somewhere else entirely. Ten instances found by luck means discovery was luck-driven and the class was open-ended. This table closes it: the set of request-derived path sites is now enumerated, so the question "have we found them all?" has an answer that is checked rather than hoped.

The guard those fixes converge on is [`packages/kernel/path-guard.ts`](../../packages/kernel/path-guard.ts). Read its module docstring before using this table — in particular the **CONTRACT** section, which defines the *root-folding* bypass, and the escape-shape catalogue this document classifies against.

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

- **`[exec]`** — an escape was **executed live** against the real HTTP route with byte-level filesystem assertions. Not reasoned about. These live in `packages/knowledge/tests/integration/bridge-studio-kbs-containment.test.ts`, `apps/forge/bridge-studio-sibling-containment.test.ts`, `apps/forge/bridge-studio-flow-trigger-oracle.test.ts`, `packages/knowledge/tests/integration/brain-paths-containment.test.ts`, and (from earlier initiatives) `apps/forge/bridge-studio-write.test.ts` / `apps/forge/bridge-studio-flows.test.ts`.
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
`review-comments.ts`), **`apps/forge/bridge-studio-writes.ts:199-201`** (404 before any
fs call), and **`packages/knowledge/bridge-studio-kbs.ts:788-794`** (`resolve(file) !== file`
rejects). Each states a *rejecting input exists*, which is the classification
bar, but **none has had its caller's handling of that rejection executed** — so
the rejection is `[read]`-verified and the FAILURE HANDLING around it is
explicitly **unverified**, not safe. They are listed here rather than
individually re-marked so the omission is visible in one place instead of being
spread across rows where a reader would have to notice its absence.

## Recorded design assumption — `CycleInput` and the ingest choke point

`packages/flows/scheduler.ts` (the `resolve('projects', m.project)` fallback for a
manifest with no `project_repo_path`) and every consumer that receives a built
`CycleInput` are **not** individually guarded, by design. They are safe **iff every
path by which a manifest reaches disk passes ingest validation** — `writeManifest`,
whose three production callers, as of SEC-03, are `packages/flows/promote-manifests.ts`,
`POST /api/initiatives`, and `packages/flows/mint-triggered-initiative.ts` (added by
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
   ingest callers as of SEC-03: `packages/flows/promote-manifests.ts`,
   `packages/flows/bridge-recovery.ts`'s `POST /api/initiatives`, and
   `packages/flows/mint-triggered-initiative.ts`.
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
   - The `persistManifest*` family in `packages/flows/manifest.ts` — round-trips an
     already-on-disk manifest through `serializeManifest` + `writeFileSync` without
     revalidating anything. As of forge-shc (2026-08-09) this family gains
     `persistManifestCostCeiling`, called from `POST /api/develop/start` on the
     enqueue-produced pending-queue path (`getPaths(queueRoot).pending` joined with
     the initiative id) — the identical path `enqueueDevelopRun` just wrote, so it
     introduces no path surface beyond enqueue's own; it `existsSync`-guards,
     re-parses, re-serialises with a validated numeric `cost_ceiling_usd`, and never
     touches a path-shaped field.
   - `packages/flows/scheduler-dispatch.ts`'s `annotateManifestForRetry` — re-parses
     and re-serialises an already-on-disk manifest, mutating only `retry_count` and
     `previous_failure_modes`; no path-shaped field is touched.
   - `packages/flows/enqueue-flow-run.ts` and `packages/flows/enqueue-plan-run.ts` — each
     re-serialises an already-on-disk manifest to "repoint" it, mutating only
     `flow_id`/`phase` and deleting `resume_from`/`claimed_at`/`claimed_by`; no
     path-shaped field is touched.
   - `packages/flows/bridge-studio-runs.ts`'s `POST /api/runs` — re-serialises an already-on-disk
     manifest, mutating only `origin` (constrained server-side to the literal union
     `'architect' | 'human-directed'`, never the request's raw string).

   **Not class 3, and not an ingest point either — a pre-ingest STAGING tier:**
   `packages/sessions/kinds/architect.ts` writes and amends DRAFT manifests directly into
   `paths.manifestsDir` (`mkdirSync` + `writeFileSync`/`serializeManifest`, multiple
   call sites). This is not a bypass of the choke point: every draft written there is
   later PROMOTED through the class-1 path (`promoteManifests(paths.manifestsDir,
   ...)` — the same `packages/flows/promote-manifests.ts` this section already counts
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
reachable, via relative imports, from `apps/forge/ui-bridge.ts` plus every `cli/bridge-*.ts`,
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
