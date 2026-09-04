#!/usr/bin/env node
/**
 * check-raw-fs-guarded.mjs — SEC-04 def-use lint: every project/request-derived
 * raw fs path in a request-handling module must be produced by the containment
 * guard, not raw-joined.
 *
 * SIBLING of scripts/check-request-path-sinks.mjs, NOT a replacement. That
 * script is a line-count RATCHET (its own header spends 70 lines stating it does
 * NO dataflow — `writeFileSync('/tmp/known', x)` and
 * `writeFileSync(join(root, req.params.id), x)` count identically). This script
 * is the dataflow dimension the ratchet explicitly disclaims: it reads the PATH
 * ARGUMENT of each raw fs sink and fails when that path is a project/request-
 * derived value that did NOT come out of the guard.
 *
 * THE RULE (taint-source trigger, not a prove-trusted whitelist). In each
 * module in scope — TIER 1, the declared request-handling surface, DERIVED (see
 * `targetModules`) from the bridge entry modules + the reachability walk + the
 * explicit spawn-boundary list, never from a filename glob — for every call to
 * one of six raw fs sinks —
 *
 *     readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync
 *
 * — take the first argument (the path) and, by a BOUNDED SAME-FUNCTION def-use
 * scan, FAIL it when the path is REQUEST/PROJECT-DERIVED and did NOT come out of
 * the guard. Concretely, a sink is a FINDING when either:
 *
 *   (1) TAINTED-UNGUARDED — a governing identifier of the path resolves (same
 *       function) to a request-derived SOURCE — an HTTP member (`body.*`,
 *       `params.*`, `query.*`, `req.*`), a curated request-derived id name
 *       (sessionId, slug, cycleId, runId, initiativeId, repoPath,
 *       project_repo_path, projectId), or a URL-DERIVED root (`url`, `rawUrl`, and
 *       anything BINDING-WINS launders out of them — `decodeURIComponent(m[1])`
 *       where `m = url.match(re)`, `url.split('/')[k]`) — and the path is NOT
 *       guard-terminal.
 *
 *   (2) LEAF-APPEND-BELOW-GUARD — the path appends onto a guard-produced value
 *       (`join(<g>, 'leaf')`, `` `${g}/leaf` ``, `resolve(<g>, x)`), so the
 *       guard vetted the DIR but the appended leaf rides raw. This is the exact
 *       SEC-04 defect and fires regardless of taint tokens.
 *
 * A path is GUARD-TERMINAL (always SAFE) when the value the sink opens IS the
 * guard's own output: `<g>`, `<g>.realPath`, `dirname(<g>)`, or
 * `dirname(<g>.realPath)`, where `<g>` is bound (this function) from a guard
 * producer — guardedFile / resolveGuardedPath / guardedReadFile /
 * guardedWriteFile / guardedReadDir. A `.realPath` member is guard-terminal on
 * its face (nothing but a PathGuardOk carries that field here); `dirname()`
 * walks UP toward the root, staying contained.
 *
 * WHY A TAINT TRIGGER, NOT "PROVE EVERY PATH TRUSTED". A prove-trusted polarity
 * fires on `existsSync(logsRoot)` and on every `let x; try{ x=readdirSync(root)}`
 * enumeration loop (server-enumerated names, holding no client string), forcing
 * a 100-row allowlist that trains blind regeneration — the exact anti-pattern
 * the sibling ratchet's header and the immutable-gates skill warn against. The
 * INTERPROCEDURAL case a taint trigger cannot see in-function — a helper
 * `f(dir){ existsSync(dir) }` whose caller built `dir` from a request id — is
 * covered by the sibling ratchet's caller-count dimension ONLY for the
 * functions someone has NAMED in DESIGNATED_UNGUARDED_FUNCTIONS — a
 * hand-maintained list, so a brand-new helper of the same shape is not caught
 * there automatically either (W8-F5 review: the original wording read as "this
 * class is closed"; it is closed only for the functions already enumerated).
 * The two scripts are complementary: the
 * ratchet counts callers of designated dir-builders; THIS lint proves the
 * in-function def-use from a request source to a raw leaf.
 *
 * A finding is cleared only two ways: route the FULL path (leaf included)
 * through guardedFile / guardedReadFile / guardedWriteFile / guardedReadDir /
 * resolveGuardedPath (making it guard-terminal), or add an EXPLICIT, reasoned
 * ALLOWLIST row (file+line+reason) — an audited-trusted residual (a CLI-arg-only
 * non-HTTP sink, an internal tail/state path, a legacy manual realpath-contained
 * site, or a boolean-only existence probe). Never a silent skip: an
 * un-allowlisted finding fails the build.
 *
 * ============================================================================
 * WHAT THIS LINT PROVABLY DOES NOT COVER (read before trusting a green run)
 * ============================================================================
 * This is a heuristic def-use scan over text, not a type-checked dataflow
 * engine. Honest limits (an over-claimed lint is worse than none):
 *   - SAME-FUNCTION, BOUNDED. Binding resolution walks UP from the sink to the
 *     nearest `const`/`let`/`for-of` binding, stopping at a column-0 `}` or a
 *     column-0 `function`/`const`/`export` (a top-level boundary) or after
 *     BACKSCAN_LIMIT lines. Only `const`/`let`/`for-of` DECLARATIONS bind; a bare
 *     reassignment (`x = ...` after `let x;`) is not tracked — deliberately, so
 *     the request taint model does not chase every enumeration loop; the missed
 *     direction is a request id laundered through a bare reassignment, which is
 *     rare in these modules and belongs to the sibling ratchet's remit.
 *   - TAINT SOURCES ARE A CURATED NAME LIST. A request id flowing under a name
 *     NOT in REQUEST_TAINT (below) is a false negative. The list names the
 *     request-derived ids these modules actually use; it errs toward the HTTP
 *     member forms (`body.*`/`params.*`/…) which are unambiguous. A value
 *     laundered THROUGH A RETURN of another function is not followed — only the
 *     five named guard producers sanitize.
 *   - CRUDE COMMENT/STRING HANDLING. A sink token on a comment line (leading
 *     //, *, /*) or import line is skipped; string/template contents are blanked
 *     for structure. A sink name typed inside a multi-line prose comment whose
 *     continuation lines do not start with * can be mis-scanned (same crude
 *     filter the sibling ratchet documents).
 *   - NAMESPACE / ALIASED SINKS ARE INVISIBLE. `fs.readFileSync(...)`,
 *     `const r = readFileSync; r(...)` evade the unqualified `\bNAME(` match —
 *     every module in scope uses named bare imports, which is what this sees.
 *   - fs/promises IS NOT COVERED. Only the synchronous names above.
 *   - SCOPE IS DERIVED, AND THE SECOND TIER IS RESTRICTED (W8-F5, bead
 *     forge-6gv.23 — the C4 refutation: two BYTE-IDENTICAL tainted modules, only
 *     the `bridge-studio`-named one was scanned). Coverage is now two tiers.
 *     TIER 1 (`targetModules`, full model): bridge ENTRY modules + every
 *     bridge-REACHABLE module carrying the HTTP-plumbing signal + the explicit
 *     spawn-boundary list. TIER 2 (`sweepModules`): every OTHER non-test module
 *     under `cli/`, `orchestrator/`, `packages/` and `apps/`, UNAMBIGUOUS only
 *     — a value read off an HTTP request MEMBER (`body.*`/`params.*`/`query.*`/
 *     `req.*`/`request.*`), a raw leaf below a guard producer's output, or one
 *     of the SEVEN bare ids in `SWEEP_MODEL.bareTaint` (never server-enumerated
 *     outside the declared surface). `id` joined for bead 5.36 with the fresh
 *     numbers G10 requires: re-derived on `5ddd7ecc`, after 5.32 took
 *     `test-fixtures/` out of the sweep, it surfaces exactly FOUR sites in
 *     three packages — one fixed at the source (`mint-triggered-initiative.ts`,
 *     via `guardedFile`), three audited as residuals in
 *     check-raw-fs-guarded.allowlist.mjs. Before 5.32 it was eight, four of
 *     them in one fixture file. So in tier 2 a request
 *     value laundered through one of the FOUR EXCLUDED bare ids (`cycleId`,
 *     `initiativeId`, `repoPath`, `runId`) or through an unresolved dir-param
 *     leaf-append is NOT reported — those rules are calibrated for request
 *     handlers, and over the whole tree the full model reports 108 findings at
 *     `c0093918`, nearly all server-built ids, i.e. an allowlist that would
 *     train blind regeneration. CONCRETELY, the shape this does NOT catch: a
 *     brand-new DELEGATE HELPER outside the declared surface whose route caller
 *     hands it a request id under one of those four names, by plain parameter.
 *     Bring such a helper into `EXPLICIT_MODULES` (that is what those rows are
 *     for) or give it the HTTP-plumbing signal. A module outside the four walk
 *     roots (`loops/`, `scripts/`) is scanned by neither tier.
 *   - TIER 1's ENTRY half was name-shaped until bead 5.34; `listEntryModules`
 *     now derives host, route tables and dispatch entries structurally.
 *   - TIER 1's reachability half inherits the sibling walker's limits: only
 *     RELATIVE imports inside the walked trees are followed, so a module
 *     reached across a process-spawn boundary (the interactive runners) or
 *     through a bare-package specifier is in tier 1 only because
 *     `EXPLICIT_MODULES` lists it. An UNREACHABLE new route module (nothing
 *     imports it yet) is covered by tier 2 only, i.e. by the member shape.
 *
 * Treat a green run as "no request-derived raw fs path escaped the guard among
 * the sinks and shapes this scan can see", never as a containment proof.
 *
 * Usage:
 *   node scripts/check-raw-fs-guarded.mjs            # check, exit 1 on findings
 *   node scripts/check-raw-fs-guarded.mjs --json     # machine-readable findings
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// W8-F5: the SIBLING's reachability walk is reused verbatim to derive this
// lint's scope. There is exactly ONE import-graph walker in scripts/, and it
// lives in check-request-path-sinks.mjs (both scripts import it main-guarded,
// so importing it has no side effects).
import { findReachableModules, listEntryModules, DISPATCH_ENTRY_MODULES } from './check-request-path-sinks.mjs';
// Ruling 106: the audited-residual LEDGER (ALLOWLIST + the fold rows, with
// their charters and line-drift history) lives in its own data module. Both
// are re-exported below so every consumer's import path is unchanged.
import { ALLOWLIST, PROJECTS_ROOT_FOLD_ALLOWLIST } from './check-raw-fs-guarded.allowlist.mjs';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The raw fs sinks whose FIRST argument is a filesystem path. W7-C3
 *  (forge-i9w): `openSync` joins — the fd-based family's PATH dimension is
 *  entirely carried by the open (readSync/writeSync/fstatSync/closeSync take
 *  an fd, not a path, so listing them would be noise, not coverage). An
 *  openSync with O_NOFOLLOW on a guard-produced path is guard-terminal like
 *  any other sink — the flags are a containment mechanism, credited, never
 *  blanket-flagged. */
export const RAW_FS_SINKS = [
  // Buffer-API reads/writes and directory creation (the original six).
  'readFileSync', 'writeFileSync', 'readdirSync', 'existsSync', 'statSync', 'mkdirSync',
  // fd-based family (W7-C3, forge-i9w) — see the note above.
  'openSync',
  // W8-C2a (forge-5kh): the MUTATING families. Every one of these was proven
  // blind by probe — a module carrying them on the SAME request-derived path
  // that openSync is caught on passed silently. These are the sinks that
  // DELETE and OVERWRITE, so their absence was the most consequential half of
  // the gap, not the least.
  'appendFileSync',      // append (write)
  'renameSync',          // rename/move  — TWO paths, see SINK_PATH_ARG_INDICES
  'rmSync', 'rmdirSync', // remove
  'unlinkSync',          // remove
  'cpSync', 'copyFileSync', // copy      — TWO paths
  'symlinkSync',         // link create  — path is arg 1, NOT arg 0
  'createWriteStream',   // streaming write
];

/** PATH ARGUMENT POSITIONS, as DATA rather than an assumption baked into the
 *  scanner. Every sink not named here is a first-argument sink (`[0]`).
 *
 *  W8-C2a (forge-5kh). The original seven sinks all took their path first, so
 *  a `firstArg`-only scan was correct by accident. The mutating families break
 *  that:
 *    - `renameSync(oldPath, newPath)`, `cpSync(src, dest)`,
 *      `copyFileSync(src, dest)` — BOTH arguments are real filesystem paths.
 *      The DESTINATION is where bytes land, so a first-argument-only scan
 *      reports clean on the more dangerous half of a move/copy.
 *    - `symlinkSync(target, path)` — argument 0 is the string the link will
 *      POINT AT (this process never opens it); argument 1 is the path actually
 *      created on disk. Scanning argument 0 here is not partial coverage, it is
 *      the wrong answer: it flags a value that is never opened and misses the
 *      one that is.
 *
 *  DELIBERATELY NOT IN RAW_FS_SINKS, with cause:
 *    - `realpathSync` / `lstatSync` — `realpathSync` IS the containment
 *      primitive these modules call in order to CONTAIN a path (every manual-
 *      containment site is built on it), and `lstatSync` is its symlink-aware
 *      companion in exactly those sites. Flagging them fires on the code doing
 *      the right thing, which is the prove-trusted polarity this file's own
 *      header rejects because it forces a large allowlist and trains blind
 *      regeneration.
 *    - the fd-consuming half (`readSync`/`writeSync`/`fstatSync`/`closeSync`) —
 *      takes a descriptor, not a path; the path dimension is carried entirely
 *      by the `openSync` that produced the fd (see the RAW_FS_SINKS note).
 *    - `fs/promises` and namespace-qualified calls — unchanged pre-existing
 *      limits, stated in the header's WHAT THIS PROVABLY DOES NOT COVER. */
export const SINK_PATH_ARG_INDICES = {
  renameSync: [0, 1],
  cpSync: [0, 1],
  copyFileSync: [0, 1],
  symlinkSync: [1],
};


/** Guard producers — a binding assigned from any of these (or a `.realPath`
 *  member) sanitizes the path for its OWN value (guard-terminal). See the
 *  header's (G) clause; a leaf raw-appended BELOW such a value is NOT covered. */
export const GUARD_PRODUCERS = [
  'guardedFile',
  'resolveGuardedPath',
  'guardedReadFile',
  'guardedWriteFile',
  'guardedReadDir',
  // W8-C2a (forge-5kh). `resolveKbBrainDir` (orchestrator/brain-paths.ts:97) is
  // a guard producer in fact, not by courtesy: it passes `kbId` as its OWN
  // `segments[]` element to `resolveGuardedPath` against two fixed
  // forgeRoot-derived roots, and returns `dirname(guarded.realPath)` — the
  // identity-verified real directory — or null. Three allowlist rows
  // (kbs.ts pinned-guidance existsSync/readdirSync and the DELETE-route
  // existsSync) each hand-wrote that exact sentence as their audited reason;
  // naming the producer here makes the scanner KNOW it instead, and those three
  // rows were deleted as the dead weight they became. A prose reason repeated
  // in three places is a stale copy waiting to happen.
  //
  // This grants it EXACTLY the semantics the other five have — no more: a value
  // bound from it is guard-terminal, and an INLINE leaf appended below it still
  // fires as `leaf-append` (pinned by F9). The via-const-binding blind spot
  // (`const g = join(d, 'x'); readdirSync(g)`) is a PRE-EXISTING, uniform limit
  // of `identIsGuardBound` shared by all six producers — measured, not
  // introduced here — and is stated in the header's DOES-NOT-COVER section.
  'resolveKbBrainDir',
];

/** Path-combinator names that are safe scaffolding, not taint. `dirname` is
 *  special-cased in guard-terminal detection (walks UP). */
const PATH_HELPERS = new Set(['join', 'resolve', 'dirname', 'basename', 'normalize', 'relative']);

/** Request-derived member HEADS — an identifier chain whose head is one of these
 *  (`body.project`, `params.id`, `req.url`, …) is an HTTP request source. These
 *  are unambiguous: nothing config-derived is named `body`/`params`/`query`/`req`
 *  in these modules. */
export const REQUEST_TAINT_HEADS = new Set(['body', 'params', 'query', 'req', 'request']);

/** Request-derived BARE id names as used in these modules. Curated tight: each
 *  is a value that flows from a route param/body into a path here and is never a
 *  server-enumerated name. `sessionDir`/`project`/`dir` are deliberately EXCLUDED
 *  (ambiguous with `for (const project of readdirSync(root))` loop vars and with
 *  already-guarded dir params — the sibling ratchet's caller dimension owns the
 *  interprocedural session-dir case). Adding a name here fires the lint on every
 *  path built from it, so it must be genuinely request-derived. */
export const REQUEST_TAINT_BARE = new Set([
  'sessionId',
  'slug',
  'cycleId',
  'runId',
  'initiativeId',
  'repoPath',
  'project_repo_path',
  'projectId',
  // URL-DERIVED request roots (SEC-04 taint blind-spot #a). `rawUrl` is the raw
  // request URL — the standard bridge handler param; `url` is its path portion
  // (`const url = pathOnly(rawUrl)`). Every request id in these modules is
  // laundered out of one of the two: `const id = decodeURIComponent(m[1])` where
  // `m = url.match(re)`, or `const seg = url.split('/')[k]`. Because taint is
  // BINDING-WINS, seeding the two URL roots is sufficient — the
  // id → decodeURIComponent → match → url → rawUrl chain resolves through the
  // intermediate bindings with NO per-shape special-casing of match/decode/split.
  // A `url` bound from a NON-request value stays clean (binding-wins classifies by
  // RHS); only an UNRESOLVED `url`/`rawUrl` (the handler param) or one bound off
  // the request falls through to tainted. WHY BARE, NOT HEADS: a member off the
  // URL (`url.length`) is not itself a path, so unlike `body`/`params` these seed
  // at the base and defer to binding-wins.
  'url',
  'rawUrl',
]);
// Deliberately EXCLUDED, with cause (each is dominantly SERVER-enumerated in
// these modules, so tainting the bare name mis-fires while adding nothing a real
// request path lacks): `filename`/`initId` (iterated from `listInFlight` /
// log-dir scans; where a REQUEST id like `initiativeId` builds a filename the
// taint flows through THAT binding instead). `sessionDir`/`project`/`dir` (loop
// vars / already-guarded dir params — the sibling ratchet's caller dimension
// owns those). Taint reaches a value bound from any of these only when the
// binding's OWN governing ids are request-derived (binding-wins; see
// identIsTainted).

/** Trusted taint-STOP roots — an identifier whose head is one of these can never
 *  be tainted (config/const-derived at boot). Short-circuits the taint walk;
 *  NOT used to prove a path safe (a non-tainted path passes by default). */
const TRUSTED_ROOTS = new Set(['logsRoot', 'projectsRoot', 'forgeRoot', 'FORGE_ROOT', '__dirname', 'queuePaths', 'ctx']);

/** Dir-shaped PARAMETER names (the INTERPROCEDURAL leaf-append vector). A helper
 *  `f(<dir>){ readFileSync(join(<dir>,'leaf')) }` whose caller built `<dir>` from
 *  a request id is the exact SEC-04 shape the architect module — and
 *  `loadProjectConfig(projectRoot)` (`join(projectRoot,'.forge','project.json')`) —
 *  shipped: the taint is laundered through the caller's `join`, so the bare param
 *  carries no in-function taint token and the request-taint scan cannot see it
 *  (which is WHY these names are NOT in REQUEST_TAINT_BARE — tainting the bare
 *  name would mis-fire on every `existsSync(<dir>)` probe). This set powers a
 *  SEPARATE rule (dirParamLeafAppend) that fires ONLY when a LEAF is appended onto
 *  such a param AND the param is UNRESOLVED (a function parameter / import —
 *  `findBinding` null; the value came from the caller) — never on the bare dir
 *  itself, and never on a locally-RESOLVED dir (`const dir = resolve(<trusted>)`
 *  is request-independent, has a binding, and does not fire). A guard-bound base
 *  is NOT here (identIsGuardBound already owns leaf-append-below-a-guard).
 *  Broadened beyond `sessionDir` (SEC-04 taint blind-spot #b) to the dir-shaped
 *  names these modules pass a caller-built directory under; `repoPath` is ALSO in
 *  REQUEST_TAINT_BARE (taint dominates — it fires even on a bare probe), listed
 *  here for completeness of the dir-param vector. */
export const DIR_PARAM_NAMES = new Set([
  'sessionDir',
  'projectRoot',
  'projectDir',
  'dir',
  'root',
  'base',
  'repoPath',
]);

/** Modules the import-graph walk structurally CANNOT reach, kept explicit.
 *  Every row states why the walker cannot see it (a process-spawn boundary, or
 *  a delegated helper whose request-derived arguments arrive by parameter). */
export const EXPLICIT_MODULES = [
  // R4-22 WI-2: the FINALIZERS registry's sole row today, copyStagingToLibrary
  // — session-derived staging paths + a request-derived packageId both reach fs
  // writes; same class as the legacy interactive runners below.
  'packages/sessions/interactive-finalizers.ts',
  // R4-22 WI-3 (ADR-043 §2): the generic interactive-turn spine, and the four
  // legacy runners. They cannot be reached by the reachability walk (that walk
  // follows relative imports from the bridge entry points; the
  // cli/agent-run.ts -> runInteractiveTurn dispatch crosses a PROCESS-SPAWN
  // boundary), so this list is the only mechanism that lints them. Session-
  // derived (kindDir, sessionId) and finalizer-bound (packageId) paths reach fs
  // sinks in every one.
  // Bead 5.48: the four CLI-dispatch entries that sat here are now the sibling's `DISPATCH_ENTRY_MODULES` — one declaration, consumed by both lints.
  'packages/sessions/interactive-session.ts',
  'packages/sessions/interactive-runner.ts',
  'packages/sessions/kinds/architect.ts',
  'packages/sessions/kinds/instructions.ts',
  'packages/sessions/kinds/demo-builder.ts',
  'packages/agents/band-agent-run.ts', // shared seed; two safe sites allowlisted
  // M4 §4 step 2: carving this module's routes out took its HTTP-plumbing
  // signal with them, dropping it to tier 2 where `runId` is excluded; ten
  // audited residuals silently stopped suppressing (89->78) while the check
  // still said PASS. The tier-2 note above names this exact blind spot.
  'packages/knowledge/bridge-studio-kb-drain.ts',
  // M4 PR 4b: the same blind spot one file over. Splitting `bridge-studio-kbs.ts`
  // five ways moved its sinks into modules with no HTTP-plumbing signal left:
  // measured 92 residuals before, 88 after, four silently unsuppressed and the
  // check still PASS. A falling count after a carve is a blinded scanner.
  'packages/knowledge/bridge-studio-kbs.ts',
  'packages/knowledge/bridge-studio-kb-consolidate.ts',
  'packages/knowledge/bridge-studio-kb-routes-read.ts',
  'packages/knowledge/bridge-studio-kb-routes-lifecycle.ts',
  'packages/knowledge/bridge-studio-kb-routes-maintenance.ts',
  // M4 PR 5, the same shape a third time: the drain split moved its status/log
  // writes into heirs with no route plumbing; residuals fell 92 -> 81, 0 findings.
  'packages/knowledge/kb-drain-model.ts',
  'packages/knowledge/kb-drain-store.ts',
  // M4 projects carve, this blind spot a FOURTH time: pure scaffold helpers
  // (reached from bridge-studio-project-onboard.ts's POST /api/studio/projects with a
  // request-derived projectRoot) carrying no HTTP-plumbing token by design.
  'packages/projects/project-contract-scaffold.ts',
  // CLI-side operator surfaces that take the same project/initiative ids the
  // routes do, reached by `forge <verb>` rather than by an HTTP dispatch.
  'packages/flows/metrics.ts',
  'packages/projects/contract-stages.ts',
  'packages/sessions/kinds/architect-plan.ts',
  // Not a request handler itself — the shared config-loader HELPER that
  // multiple request routes DELEGATE their `.forge/project.json` read to
  // (bridge-studio-runs verdict send-back -> loadProjectConfig(projectRepoPath),
  // contract-stages, preflight). It is the interprocedural leaf-append SITE for
  // blind-spot #b: `join(projectRoot, '.forge', 'project.json')` on an
  // unresolved param, invisible unless the helper's own body is scanned.
  'packages/projects/project-config.ts',
  // SEC-05 q80 (FORWARD DEFENSE): the skill-package install + vendored-read
  // helpers the /api/studio/skills/install and community-install/index routes
  // DELEGATE their per-entry filesystem walk to. The request-derived `id` and
  // package entry paths flow into these bodies by parameter.
  'packages/library/studio/skill-install.ts', 'packages/library/studio/skill-package.ts', 'packages/library/studio/skill-trust.ts', 'packages/library/bridge-studio-authoring-hook.ts', 'packages/library/bridge-studio-authoring-template.ts',
  'packages/library/studio/community-install.ts',
  'packages/library/studio/community-index.ts',
];

/** The HTTP-plumbing signal: a module that speaks the bridge's request/response
 *  protocol. Deliberately keyed on the PLUMBING (the node:http handler types and
 *  the bridge's own request helpers), never on a bare `body`/`req` token — a PR
 *  body, a markdown body and a domain `req` object all carry those names, and
 *  scoping on them drags the engine in (measured: +86 findings, all mis-fires of
 *  the curated bare-id list in modules where those ids are server-built). */
const HTTP_PLUMBING_RE = /(?<![.\w$])(?:IncomingMessage|ServerResponse)\b|(?<![.\w$])(?:sendJson|readJson|pathOnly|allowedOrigin|refuseDryBridge)\s*[(,}]/;

/** Repo-relative non-test `.ts` files under the four walk roots. */
function allSourceModules(root) {
  const out = [];
  const walk = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      // Bead 5.32: `test-fixtures/` is not production. check-owner's
      // productionFiles() has excluded it since M2 and this walk did not, so
      // the two guards disagreed and eight fixture modules were swept as
      // request-handling surface. Scope contract: check-raw-fs-guarded.scope.test.ts.
      if (entry.name === 'node_modules' || entry.name === 'test-fixtures' || entry.name.startsWith('.')) continue;
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) out.push(next);
    }
  };
  // M2: packages/ + apps/ joined — the kernel move took the guard out of cli/.
  for (const root of ['cli', 'orchestrator', 'packages', 'apps']) walk(root);
  return out.sort();
}

/**
 * TIER 1 — the DECLARED request-handling surface, scanned with the full taint
 * model. Three DERIVATIONS, no filename glob (W8-F5, bead forge-6gv.23):
 *
 *   1. every bridge ENTRY module, from the sibling walker's own
 *      `listEntryModules` (`cli/ui-bridge.ts` + non-test `cli/bridge-*.ts`) —
 *      until W8-F5 this lint saw only the `cli/bridge-studio*` subset, which is
 *      how `cli/bridge-recovery.ts` (four routes, `renameSync`/`rmSync` on
 *      `:id`-derived paths) shipped for two waves outside the dataflow gate;
 *   2. every module REACHABLE from those entries (the sibling's import walk)
 *      that carries the HTTP-plumbing signal — a delegated route helper is a
 *      request handler wherever it lives and whatever it is called;
 *   3. `EXPLICIT_MODULES` — the process-spawn-boundary and by-parameter
 *      delegates the walk structurally cannot see.
 *
 * Scope may only GROW: `check-raw-fs-guarded.test.ts` G5 pins every module the
 * pre-W8-F5 hand list covered, so a derivation that silently drops one fails.
 */
export function targetModules(root = FORGE_ROOT) {
  // Bead 5.34: no `hasCli` gate — it read an absent `cli/` as "no entries".
  const entries = listEntryModules(root);
  const reachable = findReachableModules(root);
  const plumbing = reachable.filter((rel) => {
    const abs = join(root, rel);
    return existsSync(abs) && HTTP_PLUMBING_RE.test(readFileSync(abs, 'utf8'));
  });
  const all = new Set([...EXPLICIT_MODULES, ...DISPATCH_ENTRY_MODULES, ...entries, ...plumbing]);
  return [...all].filter((m) => existsSync(join(root, m))).sort();
}

/**
 * TIER 2 — the SWEEP: every other non-test module under the four walk roots,
 * scanned for the UNAMBIGUOUS shape only (a value read off an HTTP request
 * MEMBER — `body.*`/`params.*`/`query.*`/`req.*`/`request.*` — or a raw leaf
 * appended below a guard producer's output, reaching a raw fs sink).
 *
 * WHY A RESTRICTED MODEL AND NOT THE FULL ONE. The full model's curated BARE id
 * list (`runId`, `repoPath`, `initiativeId`, …) is calibrated FOR request
 * handlers, where those names carry route values. In the engine those same names
 * are server-built, so running the full model over the whole tree reports 108
 * findings at `c0093918` — which could only ship as ~108 allowlist rows, the
 * "trains blind regeneration" anti-pattern this file's own charter rejects. The
 * member shape has no benign reading: nothing in this repo reads a filesystem
 * path off a `params.`/`query.`/`req.` member that is not a request value.
 *
 * This is the tier that makes the gate name-blind: a NEW module handling request
 * data is scanned wherever it lives, whatever it is called, and whether or not
 * anything imports it yet.
 */
export function sweepModules(root = FORGE_ROOT) {
  const declared = new Set(targetModules(root));
  return allSourceModules(root).filter((m) => !declared.has(m));
}

/**
 * The taint model used in the sweep. HTTP members are always on; the BARE id
 * list is restricted to the names that are never server-enumerated outside the
 * declared surface, and the dir-param leaf rule stays off.
 *
 * WHY A RESTRICTED BARE LIST RATHER THAN NONE (W8-F5 adversarial review). With
 * NO bare names, a delegate helper that a route calls by plain PARAMETER —
 * `export function handleSessionRead(sessionId) { readFileSync(join(LOGS_ROOT,
 * sessionId, 'e.jsonl')) }` — is invisible, which is the C4 defect one
 * abstraction level down from where it was fixed. WHY NOT THE FULL LIST:
 * measured over the 164 swept modules at this tree, each name's MARGINAL cost
 * (all of them engine sites where the id is SERVER-built) is `cycleId` +24,
 * `initiativeId` +17, `repoPath` +4, `runId` +3 — versus `sessionId` +0,
 * `project_repo_path` +0, `url` +0, `rawUrl` +0, `slug` +1, `projectId` +2.
 * The four expensive names stay TIER-1-only; that residue is disclosed in the
 * limits section above and tracked as a bead, never hidden.
 *
 * EXPORTED so the test that pins the sweep's calibration drives THIS object
 * rather than a private copy — a pin that rebuilds the model it is testing
 * cannot notice the model changing under it.
 */
export const SWEEP_MODEL = {
  // Bead 5.36: `id` was absent and is the COMMONEST name for a request-derived
  // id here — every unguarded site in PR #291's findings used it, so none was
  // knowingly allowlisted, all were simply out of scope.
  bareTaint: new Set(['id', 'sessionId', 'slug', 'projectId', 'project_repo_path', 'url', 'rawUrl']),
  dirParams: new Set(),
};

const BACKSCAN_LIMIT = 400;

// ---------------------------------------------------------------------------
// Structural cleaning — blank comments + string/template contents so brace and
// argument scanning see code only. Line-aligned (length within a line may
// shrink; newlines preserved) — offsets are NOT preserved, so all consumers use
// the cleaned text uniformly for structure and the ORIGINAL only for reporting.
// ---------------------------------------------------------------------------
function cleanStructure(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let state = 'code'; // code | line-comment | block-comment | sq | dq | tpl
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line-comment'; out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block-comment'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 'sq'; out += ' '; i += 1; continue; }
      if (c === '"') { state = 'dq'; out += ' '; i += 1; continue; }
      if (c === '`') { state = 'tpl'; out += ' '; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'line-comment') {
      if (c === '\n') { state = 'code'; out += '\n'; i += 1; continue; }
      out += ' '; i += 1; continue;
    }
    if (state === 'block-comment') {
      if (c === '*' && c2 === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1; continue;
    }
    if (state === 'sq' || state === 'dq') {
      const q = state === 'sq' ? "'" : '"';
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === q) { state = 'code'; out += ' '; i += 1; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1; continue;
    }
    // tpl — blank string chars but KEEP the identifiers inside ${ ... } by
    // dropping back to code between the braces (so join(`${x}/y`) still exposes x).
    if (state === 'tpl') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === '`') { state = 'code'; out += ' '; i += 1; continue; }
      if (c === '$' && c2 === '{') {
        // copy through until matching } at code level
        out += '  '; i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const d = text[i];
          if (d === '{') depth += 1;
          else if (d === '}') { depth -= 1; if (depth === 0) { out += ' '; i += 1; break; } }
          out += d === '\n' ? '\n' : d;
          i += 1;
        }
        continue;
      }
      out += c === '\n' ? '\n' : ' '; i += 1; continue;
    }
  }
  return out;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function offsetToLine(starts, off) {
  // binary search
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo; // 0-based line index
}

/** Extract the balanced first argument text starting at `open` (index of the
 *  char right after the sink's `(`), from the CLEANED text. Returns the arg
 *  substring (trimmed) or null. */
function argAt(cleaned, open, index) {
  let depth = 0;
  let i = open;
  const n = cleaned.length;
  let argIdx = 0;
  let start = i;
  for (; i < n; i++) {
    const c = cleaned[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break; // closing ) of the sink call
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      if (argIdx === index) return cleaned.slice(start, i).trim();
      argIdx += 1;
      start = i + 1;
    }
  }
  // Ran out of arguments before reaching `index` — the call has fewer args than
  // the sink's path positions describe (a 1-arg rmSync-style call, or a
  // malformed/multi-line shape the cleaner collapsed). Absent, not empty.
  if (argIdx !== index) return '';
  return cleaned.slice(start, i).trim();
}

/** Governing identifiers / member-expressions of a path expression: every
 *  identifier chain not immediately followed by `(` (a call — a helper name),
 *  drawn from the CLEANED expression (literals already blanked). Returns array
 *  of { full, head }. */
function governingIdents(expr) {
  const out = [];
  const re = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(\()?/g;
  let m;
  while ((m = re.exec(expr))) {
    const full = m[1];
    const isCall = m[2] === '(';
    const head = full.split('.')[0];
    if (isCall && !full.includes('.')) continue; // a bare call like join(...) — helper name, skip
    if (isCall && PATH_HELPERS.has(head)) continue;
    out.push({ full, head, isCall });
  }
  return out;
}

/** Find the nearest binding of `name` at or above line `fromLine` (0-based) in
 *  the cleaned lines, within the same top-level function (stop at a column-0 `}`
 *  or column-0 function/const/export boundary), bounded by BACKSCAN_LIMIT.
 *  Returns { kind:'const'|'let'|'for', rhs } or null. */
const BOUNDARY_RE = /^(\}|(export\s+)?(async\s+)?function\b|(export\s+)?(const|let)\s)/;
function findBinding(cleanedLines, name, fromLine) {
  const nameRe = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(.+?);?\\s*$`);
  const forRe = new RegExp(`\\bfor\\s*\\(\\s*(?:const|let)\\s+${name}\\s+of\\s+(.+?)\\s*\\)`);
  // DESTRUCTURED for-of — `for (const [dir, status] of coll)` /
  // `for (const { initId } of coll)` binds `name` as an ELEMENT of `coll`. Such a
  // var is a SERVER-enumerated loop var, NOT a caller-supplied param: without this
  // it reads as `findBinding === null` (unresolved), which mis-fires the dir-param
  // rule on a leaf-append below a trusted loop var (e.g. `join(dir, file)` over a
  // trusted `stateDirs`). Binding it to the collection lets the taint/dir-param
  // checks classify it by the collection's origin (trusted ⇒ no finding), the
  // same no-false-positive discipline the simple-for-of case (A7) already has.
  const forDestrRe = new RegExp(`\\bfor\\s*\\(\\s*(?:const|let)\\s*[\\[{][^\\]}]*\\b${name}\\b[^\\]}]*[\\]}]\\s+of\\s+(.+?)\\s*\\)`);
  // DESTRUCTURED DECLARATION (W8-F5) — `const { runId } = body;`,
  // `const { target: { ref } } = req.body;`, `const [first] = parts;` bind `name`
  // as a MEMBER of the RHS. Without this the name reads as UNRESOLVED (i.e. "a
  // caller-supplied parameter") and only the curated BARE id list could catch
  // it — which the sweep model deliberately empties, so
  // `const { runId } = body` would evade the very member rule that
  // `body.runId` trips. Binding-wins then classifies it by the RHS: a trusted
  // RHS stays clean, a request member taints. Nested patterns are covered
  // because the char class spans the inner braces (no `=`/`;` inside them).
  const destrRe = new RegExp(`(?:const|let)\\s*[\\[{][^=;]*\\b${name}\\b[^=;]*[\\]}]\\s*=\\s*(.+?);?\\s*$`);
  const declHereRe = new RegExp(`(?:const|let)\\s+${name}\\b|\\bfor\\s*\\(\\s*(?:const|let)\\s*[\\[{]?[^\\]})]*\\b${name}\\b`);
  const limit = Math.max(0, fromLine - BACKSCAN_LIMIT);
  for (let i = fromLine; i >= limit; i--) {
    const line = cleanedLines[i];
    const forM = forRe.exec(line);
    if (forM) return { kind: 'for', rhs: forM[1].trim() };
    const forDestrM = forDestrRe.exec(line);
    if (forDestrM) return { kind: 'for', rhs: forDestrM[1].trim() };
    const m = nameRe.exec(line);
    if (m) return { kind: 'const', rhs: m[1].trim() };
    const destrM = destrRe.exec(line);
    if (destrM) return { kind: 'const', rhs: destrM[1].trim() };
    // Boundary: a column-0 structural line that ISN'T our own binding stops the
    // walk (we've left the enclosing function). Checked AFTER the binding tests
    // so the enclosing function's own leading `const`/`function` line, if it
    // binds `name`, is still consulted.
    if (i < fromLine && BOUNDARY_RE.test(line) && !declHereRe.test(line)) break;
  }
  return null;
}

function rhsIsGuardProducer(rhs) {
  for (const g of GUARD_PRODUCERS) {
    if (new RegExp(`(?<![.\\w$])${g}\\s*\\(`).test(rhs)) return true;
  }
  // rhs is essentially `<x>.realPath` (a PathGuardOk member destructure/read)
  const stripped = rhs.replace(/\.realPath\b/, '');
  if (/(?<![.\w$])[A-Za-z_$][\w$]*\.realPath\b/.test(rhs) && !/[([]/.test(stripped)) return true;
  return false;
}

/** Does the value produced by identifier/member `full` (head `head`) at `line`
 *  come from the guard? `.realPath` on its face, or a binding assigned from a
 *  guard producer. Bounded. */
function identIsGuardBound(full, head, line, cleanedLines, depth = 0) {
  if (full.endsWith('.realPath')) return true;
  if (depth > 6) return false;
  const binding = findBinding(cleanedLines, head, line);
  if (!binding) return false;
  if (rhsIsGuardProducer(binding.rhs)) return true;
  // a binding that simply aliases another guard-bound identifier
  const idents = governingIdents(binding.rhs);
  if (idents.length === 1 && !binding.rhs.includes('(')) {
    return identIsGuardBound(idents[0].full, idents[0].head, line, cleanedLines, depth + 1);
  }
  return false;
}

/** Does the value produced by identifier/member `full` at `line` resolve to a
 *  request-derived SOURCE (a taint token, or a binding that draws on one)?
 *  Bounded recursion via `depth`. Guard-bound values are NOT tainted (the guard
 *  is a sanitizer); trusted roots short-circuit to not-tainted. */
function identIsTainted(full, head, line, cleanedLines, depth = 0, bare = REQUEST_TAINT_BARE) {
  if (REQUEST_TAINT_HEADS.has(head)) return true; // body./params./query./req. — always a request source
  if (TRUSTED_ROOTS.has(head)) return false;
  if (depth > 6) return false; // fail toward NOT-tainted at the bound (documented: curated list is the guarantee)
  // BINDING-WINS. A locally-bound value is classified by its RHS, not by its
  // name: `const sessionId = newArchitectSessionId()` is SERVER-generated and
  // NOT tainted even though `sessionId` is a request-id name; taint reaches it
  // only if the RHS's own governing ids are request-derived. Only an UNRESOLVED
  // identifier (a function param / import — the value came from the caller,
  // typically the route) falls back to the curated bare request-id list.
  const binding = findBinding(cleanedLines, head, line);
  if (binding) {
    if (rhsIsGuardProducer(binding.rhs)) return false; // guarded → sanitized
    for (const id of governingIdents(binding.rhs)) {
      if (identIsTainted(id.full, id.head, line, cleanedLines, depth + 1, bare)) return true;
    }
    return false;
  }
  return bare.has(full) || bare.has(head);
}

/** Is the whole path expression guard-terminal? `<g>`, `<g>.realPath`,
 *  `dirname(<g>)`, `dirname(<g>.realPath)` where `<g>` is guard-bound — nothing
 *  appended BELOW the blessed path. */
function isGuardTerminal(expr, line, cleanedLines) {
  let e = expr.trim();
  const dm = /^dirname\(\s*(.+?)\s*\)$/.exec(e);
  if (dm) e = dm[1].trim();
  if (/^[A-Za-z_$][\w$]*\.realPath$/.test(e)) return true;
  if (/^[A-Za-z_$][\w$]*$/.test(e)) return identIsGuardBound(e, e, line, cleanedLines);
  return false;
}

/** Is the path expression a LEAF-APPEND onto an UNRESOLVED dir-shaped PARAM
 *  (DIR_PARAM_NAMES)? Returns the base param name (a finding) or null. Handles the
 *  two live shapes:
 *    - INLINE:  `join(projectRoot, 'x')` / `resolve(sessionDir, x)` at the sink.
 *    - VIA-CONST: `const p = join(projectRoot, file); readFileSync(p)` — resolve
 *      the sink's bare ident through ONE binding to reach the inline join.
 *  A bare `<dir>` with NOTHING appended (`existsSync(projectRoot)`) returns null —
 *  the dir itself is the sibling ratchet's remit, only the appended LEAF is this
 *  rule's. A param is "unresolved" iff findBinding is null (it came from the
 *  caller — a function parameter/import); a locally-RESOLVED base (`const dir =
 *  resolve(<trusted>)`, findBinding non-null) is request-independent and does NOT
 *  match; a guard-bound base is deliberately NOT matched here (identIsGuardBound
 *  already flags leaf-append below a guard). Template `${dir}/leaf` is NOT covered
 *  (cleanStructure blanks the literal tail outside `${}`); the modules in scope
 *  use join()/resolve(). */
function dirParamLeafAppend(expr, line, cleanedLines, depth = 0, dirParams = DIR_PARAM_NAMES) {
  if (depth > 6) return null;
  const e = expr.trim();
  // inline join/resolve whose FIRST arg is a bare ident + at least one more segment
  const m = /^(?:join|resolve)\(\s*([A-Za-z_$][\w$]*)\s*,/.exec(e);
  if (m) {
    const base = m[1];
    if (dirParams.has(base) && !TRUSTED_ROOTS.has(base) && findBinding(cleanedLines, base, line) === null) {
      return base;
    }
    return null;
  }
  // sink opens a bare ident — follow ONE binding to a join/resolve (via-const shape)
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const binding = findBinding(cleanedLines, e, line);
    if (binding) return dirParamLeafAppend(binding.rhs, line, cleanedLines, depth + 1, dirParams);
  }
  return null;
}

/** Analyze one module's text; return findings [{ file, line, sink, path, why }].
 *  `model` selects the taint sources: the default is the FULL model used on the
 *  declared request-handling surface; the sweep passes `SWEEP_MODEL` (HTTP
 *  members only — see sweepModules for why). */
export function analyzeModule(text, relFile, model = {}) {
  const bare = model.bareTaint ?? REQUEST_TAINT_BARE;
  const dirParams = model.dirParams ?? DIR_PARAM_NAMES;
  const cleaned = cleanStructure(text);
  const cleanedLines = cleaned.split('\n');
  const origLines = text.split('\n');
  const starts = lineStarts(cleaned);
  const findings = [];
  const sinkRe = new RegExp(`(?<![.\\w$])(${RAW_FS_SINKS.join('|')})\\s*\\(`, 'g');
  let m;
  while ((m = sinkRe.exec(cleaned))) {
    const sink = m[1];
    const openIdx = m.index + m[0].length; // char after `(`
    const lineIdx = offsetToLine(starts, m.index); // 0-based
    const orig = origLines[lineIdx] ?? '';
    const trimmed = orig.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('import')) continue;
    // W8-C2a (forge-5kh): a sink may carry MORE THAN ONE path argument, and its
    // path may not be argument 0 at all. Positions come from data
    // (SINK_PATH_ARG_INDICES), defaulting to first-argument.
    for (const argIndex of SINK_PATH_ARG_INDICES[sink] ?? [0]) {
      const path = argAt(cleaned, openIdx, argIndex);
      if (!path) continue;
      // GUARD-TERMINAL — the sink opens the guard's own output. Always safe.
      if (isGuardTerminal(path, lineIdx, cleanedLines)) continue;
      const idents = governingIdents(path);
      if (idents.length === 0) continue; // pure literal path
      // (2) LEAF-APPEND — a guard-bound value with something appended below it
      // (path is not guard-terminal, yet a governing ident is guard-bound).
      let guardBase = null;
      let taintTok = null;
      for (const id of idents) {
        if (!guardBase && identIsGuardBound(id.full, id.head, lineIdx, cleanedLines)) guardBase = id.full;
        if (!taintTok && identIsTainted(id.full, id.head, lineIdx, cleanedLines, 0, bare)) taintTok = id.full;
    }
    // (3) DIR-PARAM LEAF-APPEND — the interprocedural shape: a leaf appended onto
    // an unresolved dir-shaped param (the caller laundered the request id into
    // the dir). Fires only when guardBase/taintTok did not already catch it.
    const dirParamBase = !guardBase && !taintTok ? dirParamLeafAppend(path, lineIdx, cleanedLines, 0, dirParams) : null;
    if (!guardBase && !taintTok && !dirParamBase) continue; // request-independent → safe
    const kind = guardBase ? 'leaf-append' : taintTok ? 'tainted' : 'dir-param-leaf-append';
    const why = guardBase
      ? `leaf-append below guarded value "${guardBase}" — the appended leaf is NOT guarded (route the FULL path incl. leaf through guardedFile)`
      : taintTok
        ? `request/project-derived path via "${taintTok}" reaches raw ${sink} unguarded`
        : `leaf-append onto unresolved dir-shaped param "${dirParamBase}" — the caller's dir may be contained but the appended leaf rides raw (route the FULL path incl. leaf through guardedFile / the guarded sibling)`;
    findings.push({ file: relFile, line: lineIdx + 1, sink, path: path.replace(/\s+/g, ' ').slice(0, 120), kind, why });
    }
  }
  return findings;
}


export { ALLOWLIST, PROJECTS_ROOT_FOLD_ALLOWLIST };

function keyOf(f) {
  return `${f.file}:${f.line}`;
}

/**
 * Suppress findings that carry an EXPLICIT allowlist entry (file+line). Returns
 * { kept, suppressed, stale, mistargeted }:
 *  - kept        = findings that FAIL the build (no valid allowlist entry).
 *  - suppressed  = findings cleared by a valid, reasoned entry.
 *  - stale       = allowlist entries matching NO finding (line drift / a fixed
 *                  sink) — reported as a warning, never a failure (fail-safe: a
 *                  stale entry cannot hide a real finding, it only lingers).
 *  - mistargeted = an entry whose line HAS a finding but of a DIFFERENT sink
 *                  than recorded — the finding is KEPT (fails closed), because a
 *                  drifted entry must not silently bless a different sink.
 * An entry with an empty/whitespace reason is rejected (its finding is kept).
 */
export function applyAllowlist(findings, allowlist = ALLOWLIST) {
  const byKey = new Map(allowlist.map((a) => [`${a.file}:${a.line}`, a]));
  const kept = [];
  const suppressed = [];
  const mistargeted = [];
  const usedKeys = new Set();
  for (const f of findings) {
    const a = byKey.get(keyOf(f));
    if (!a) { kept.push(f); continue; }
    if (!a.reason || !a.reason.trim()) {
      kept.push({ ...f, why: `${f.why} [ALLOWLIST ENTRY AT ${keyOf(f)} HAS NO REASON — rejected]` });
      continue;
    }
    const auditedSinks = a.sinks ?? (a.sink ? [a.sink] : null);
    if (auditedSinks && !auditedSinks.includes(f.sink)) {
      // The line drifted onto a different sink than was audited — do NOT bless it.
      mistargeted.push({ entry: a, found: f });
      kept.push({ ...f, why: `${f.why} [allowlist entry at ${keyOf(f)} audited "${auditedSinks.join('|')}", found "${f.sink}" — mistargeted, not suppressed]` });
      continue;
    }
    usedKeys.add(keyOf(f));
    suppressed.push({ ...f, reason: a.reason });
  }
  const stale = allowlist.filter((a) => !usedKeys.has(`${a.file}:${a.line}`));
  return { kept, suppressed, stale, mistargeted };
}

// ===========================================================================
// PROJECTS-ROOT-FOLD RULE (SEC-07, hardened) — the dimension the def-use scan
// above is structurally blind to. The def-use lint proves a request-derived
// raw fs path came out of the guard; it CANNOT see a value folded into the
// guard's ROOT (`resolve('projects', projectArg)` / `join(projectsRoot, id)`),
// because folding an untrusted id into `root` makes every downstream
// `resolveGuardedPath(root, segs)` tautological — `realpathSync(root)`
// resolves the untrusted value with NO identity check (see
// cli/studio-path-guard.ts's CONTRACT). This rule flags a re-introduced fold
// and fails the build; the untrusted value must ride as a guarded SEGMENT:
// resolveGuardedPath(projectsRoot,[value]).
//
// COUNT-AWARE, folded-token-keyed allowlist (file + folded), NOT line-keyed —
// an audited residual survives line drift, but only up to its AUDITED
// occurrence count (see PROJECTS_ROOT_FOLD_ALLOWLIST + the runLint wiring
// below); a surplus occurrence beyond that count is a fresh, un-audited fold
// and fails the build on its own.
// ===========================================================================

/** Modules where an untrusted `--project`/`body.project`-shaped value could be
 *  folded into a projects root. Scanned by scanProjectsRootFold below.
 *  UNCHANGED by this hardening pass: folds inside bridge/route modules that
 *  reach an fs sink are already caught by the def-use lint above (a route
 *  handler's raw-fs call is itself a finding there, independent of whether
 *  its path came from a fold); this list stays scoped to the CLI/orchestrator
 *  entry points where a projects-root fold can slip past that scan because
 *  the sink call lives in a different function than the fold. */
export const PROJECTS_ROOT_FOLD_MODULES = [
  'packages/agents/find-session-project.ts',
  'apps/forge/cli.ts',
  'packages/agents/agent-dispatch.ts',
  'packages/flows/scheduler.ts',
];

// ---------------------------------------------------------------------------
// cleanForFold — a line-aligned lexical cleaner, NOT a JS parser. It walks the
// text one character at a time and: blanks `//` and `/* */` comments (every
// continuation line, not just ones starting with `*` — the base rule's crude
// per-line comment filter was the source of a false positive there); replaces
// the CONTENTS of every `'...'`/`"..."` string with an equal-length canonical
// fill (`'projects'` padded with trailing spaces when the content itself is a
// projects-root spelling, blank spaces otherwise) so a fold shape merely
// quoted inside prose or a help string cannot match while a genuine
// `'projects'` root literal still can; and keeps a template literal's raw text
// verbatim except for neutralizing `(`/`'`/`)`/`"` (so raw path text like
// `` `projects/${x}` `` cannot be mistaken for a nested string) while copying
// its `${...}` interpolations through as live code. Every transformation is
// character-for-character length-preserving and newline-preserving, so line
// numbers computed against the cleaned text line up with the ORIGINAL file.
// ---------------------------------------------------------------------------
function cleanForFold(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let state = 'code';
  let buf = '';
  const flushString = (quote) => {
    const inner = buf.replace(/^\.\//, '').replace(/\/+$/, '');
    const canon = ROOT_NAME_RE.test(normalizeName(inner)) ? 'projects' : '';
    const padded = (canon + ' '.repeat(Math.max(0, buf.length - canon.length))).slice(0, buf.length);
    out += quote + padded + quote;
    buf = '';
  };
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 'sq'; buf = ''; i += 1; continue; }
      if (c === '"') { state = 'dq'; buf = ''; i += 1; continue; }
      if (c === '`') { state = 'tpl'; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i += 1; continue; }
      out += ' '; i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1; continue;
    }
    if (state === 'sq' || state === 'dq') {
      const q = state === 'sq' ? "'" : '"';
      if (c === '\\') { buf += '  '; i += 2; continue; }
      if (c === q) { state = 'code'; flushString(q); i += 1; continue; }
      buf += c === '\n' ? '\n' : c; i += 1; continue;
    }
    // Template literal: raw text kept, quote/paren characters neutralized so
    // they can't desync a later scan; `${...}` interpolations are copied as code.
    if (state === 'tpl') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === '`') { state = 'code'; out += c; i += 1; continue; }
      if (c === '$' && c2 === '{') {
        out += '${'; i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const d = text[i];
          if (d === '{') depth += 1;
          else if (d === '}') { depth -= 1; if (depth === 0) { out += '}'; i += 1; break; } }
          out += d === '\n' ? '\n' : d;
          i += 1;
        }
        continue;
      }
      out += "('\")".includes(c) ? ' ' : (c === '\n' ? '\n' : c);
      i += 1; continue;
    }
  }
  return out;
}

// A normalized name pattern for a PROJECTS root -- case- and separator-
// insensitive, covering the projects.../proj... family (projects, projectsRoot,
// projectsDir, projectsBase, projectsPath, projectsHome, projRoot, projBase,
// projDir, PROJECTS_ROOT, ...). Deliberately narrower than a bare `proj`
// prefix: a SINGULAR per-project root (`projectRoot`, `projectDir`,
// `projectRepoPath`) names one project's own directory, not the projects
// collection, and must stay OUT of this class -- folding a request-derived
// value into a single project's own root is a different (and differently
// reviewed) shape.
const ROOT_NAME_RE = /^(?:projects(?:root|dir|base|path|home)?|proj(?:root|dir|base|path|home))$/;
function normalizeName(tok) {
  return String(tok).toLowerCase().replace(/[^a-z]/g, '');
}
function tailOf(expr) {
  // Member expressions are classified by their TAIL (`ctx.projectsRoot` reads
  // as a projects root because the tail segment does), which is also why a
  // computed/bracket property access (`ctx[key]`) is NOT modeled here -- there
  // is no static tail to read.
  return expr.trim().split('.').pop();
}
function literalIsProjectsRoot(quotedLiteral) {
  const inner = quotedLiteral.slice(1, -1).replace(/^\.\//, '').replace(/\/+$/, '');
  return ROOT_NAME_RE.test(normalizeName(inner));
}
function identIsProjectsRootName(expr) {
  return ROOT_NAME_RE.test(normalizeName(tailOf(expr)));
}

// Fold-capable callee names beyond the bare `join`/`resolve` tokens: a
// renamed `node:path` import (`import { resolve as r } from 'node:path'`) and
// a local variable alias (`const r = resolve;`). Matched against the CLEANED
// text so an alias merely typed in a comment or string is invisible; the
// import's module specifier is re-checked against the ORIGINAL source line
// (the cleaner canonicalizes string contents away) to keep this to path-module
// imports only, not e.g. a same-named export from an unrelated module.
function calleeNames(cleaned, origLines) {
  const names = new Set(['join', 'resolve']);
  const importRe = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"]/g;
  let m;
  while ((m = importRe.exec(cleaned))) {
    const lineIdx = cleaned.slice(0, m.index).split('\n').length - 1;
    const rawStmt = origLines.slice(lineIdx, lineIdx + m[0].split('\n').length).join('\n');
    if (!/from\s*['"](?:node:)?path['"]/.test(rawStmt)) continue;
    for (const part of m[1].split(',')) {
      const alias = /([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/.exec(part);
      if (alias && (alias[1] === 'join' || alias[1] === 'resolve')) names.add(alias[2]);
    }
  }
  const aliasRe = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(join|resolve)\s*;/g;
  while ((m = aliasRe.exec(cleaned))) names.add(m[1]);
  return names;
}

// Identifiers BOUND to a projects-root expression, name-agnostic -- this is
// the binding half of root recognition: `const anyBase = resolve('projects')`
// or `const anyBase = join(forgeRoot, 'projects')` makes `anyBase` a projects
// root under ANY name, because its value traces back to one. A binding is
// root-producing iff its LAST call argument is itself a projects root
// (literal or a known root identifier) -- anything appended AFTER a root is a
// SEGMENT, i.e. the call itself is a fold (reported), never a new root. Two
// passes let a root bind transitively off another just-discovered root within
// the same scan.
function rootIdents(cleaned, callees) {
  const roots = new Set();
  const calleeAlt = [...callees].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const bindRe = new RegExp(
    `(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:[\\w$]+\\.)*(?:${calleeAlt})\\(([^)]*)\\)`,
    'g',
  );
  for (let pass = 0; pass < 2; pass++) {
    bindRe.lastIndex = 0;
    let m;
    while ((m = bindRe.exec(cleaned))) {
      const args = m[2].split(',').map((a) => a.trim()).filter(Boolean);
      if (args.length === 0) continue;
      const last = args[args.length - 1];
      const lastIsRoot =
        (/^['"][^'"]*['"]$/.test(last) && literalIsProjectsRoot(last)) ||
        (/^[A-Za-z_$][\w$.]*$/.test(last) && (identIsProjectsRootName(last) || roots.has(tailOf(last))));
      if (lastIsRoot) roots.add(m[1]);
    }
  }
  return roots;
}

function isRootExpr(expr, roots) {
  const e = expr.trim();
  if (/^['"][^'"]*['"]$/.test(e)) return literalIsProjectsRoot(e);
  if (/^[A-Za-z_$][\w$.]*$/.test(e)) return identIsProjectsRootName(e) || roots.has(tailOf(e));
  return false;
}

/**
 * Scan `text` for a projects-root FOLD -- an untrusted value passed as the
 * SEGMENT argument to a `join`/`resolve`-shaped call (or a `` `root/${x}` ``
 * template) whose ROOT argument is a projects root -- in two shapes:
 *
 *   (1) CALL form: `<callee>(<rootExpr>, <segment>)`, multi-line tolerant, the
 *       callee being `join`/`resolve`, a renamed import of either, a local
 *       alias, or a namespace/member form (`path.join(...)`).
 *   (2) TEMPLATE form: `` `projects/${x}` `` (a literal root prefix) or
 *       `` `${projectsRoot}/${x}` `` (an interpolated root prefix).
 *
 * The ROOT argument is recognized by NAME (the `projects...`/`proj...`
 * pattern family -- see ROOT_NAME_RE -- matched on a string literal, a bare
 * identifier, or a member expression's TAIL, e.g. `ctx.projectsRoot`) OR by
 * BINDING (an identifier under ANY name whose value traces back to a
 * projects-root call or a literal `'projects'` path segment -- see
 * rootIdents). A string-literal segment (a fixed name) and a single-arg root
 * resolution (no segment) produce NO finding. Comments and string-literal
 * contents are excluded from scanning by cleanForFold, not by a per-line
 * prefix filter -- a fold merely quoted in a string or mentioned in
 * block-comment prose (with or without a leading `*` on the continuation
 * line) is not scanned as code.
 * Returns [{ file, line, folded, why }] over the ORIGINAL lines.
 *
 * PROVABLE LIMITS (a lexical tripwire, not dataflow -- an over-claimed
 * ratchet is worse than none). This hardening pass closes four blind spots
 * the base rule's own header disclosed: (a) FOLD-CALLEE beyond the bare
 * `join`/`resolve` token -- a renamed import binding, a local variable alias,
 * and a namespace/member-form callee are now all covered; (b) PROJECTS-ROOT
 * beyond the three literal spellings -- a root is now recognized both by NAME
 * (any `projects...`/`proj...`-family spelling, including through a member
 * tail) AND by BINDING (an identifier whose value traces to a projects-root
 * call or a literal `'projects'` segment, under any name); (c)
 * TEMPLATE-LITERAL folds, previously unhandled entirely; (d) MULTI-LINE call
 * forms, previously single-line only. A round-2 adversarial pass added (e) a
 * folded SEGMENT wrapped in ONE level of call (`decodeURIComponent(seg)`,
 * `basename(id)`, `String(body.project)` -- the ordinary request-path shape
 * here, and previously invisible because the segment had to be a bare
 * identifier chain). The allowlist is also now COUNT-AWARE and
 * ANCHOR-ATTRIBUTED (see PROJECTS_ROOT_FOLD_ALLOWLIST + runLint) rather than an
 * unbounded token key.
 *
 * What remains uncovered, honestly: a value laundered through a HELPER
 * FUNCTION'S RETURN (`function getRoot(){ return resolve('projects'); }` then
 * `const anyBase = getRoot();`) -- the binding pass models a direct call
 * assignment, not an interprocedural return; a COMPUTED/DYNAMIC property
 * access (`ctx[key]` or `obj['proj' + 'ectsRoot']`) -- root recognition reads
 * a member expression's static TAIL, so there is nothing to read off a
 * bracket expression; a root bound through a SHAPE the binding pass does not
 * model -- e.g. destructuring under a different name (`const { projectsRoot:
 * pr } = ctx;` then `resolve(pr, x)`) is invisible, since only a direct
 * `const X = <callee>(...)` assignment is traced; a segment wrapped in MORE
 * than one level of call (`join(root, decode(normalize(x)))`) -- exactly one
 * level is modelled; and modules OUTSIDE PROJECTS_ROOT_FOLD_MODULES (unchanged
 * by this pass -- see the list's own comment for why bridge/route modules are
 * covered by the def-use lint instead).
 *
 * Two properties that fail LOUD rather than blind, disclosed so nobody reads a
 * finding as a proof: root-binding discovery (rootIdents) is FILE-WIDE, not
 * per-function -- a name classified as a projects root by a binding in one
 * function makes an unrelated same-named variable elsewhere in that file read as
 * a root too, which can produce a false positive (an extra build failure
 * demanding an audited row), never a missed fold. And the cleaner
 * (cleanForFold) is a STATE MACHINE OVER TEXT, not a JS parser: a regex literal
 * containing a quote character (e.g. `` /'/ ``) can desync its quote-tracking
 * for the remainder of the file -- that one CAN hide a later fold, and no
 * in-scope module contains such a literal today. The per-site guard contract +
 * the sibling caller-count ratchet remain the backstop for anything this
 * lexical scan cannot see.
 */
/** The audited-SITE key: the fold EXPRESSION itself, whitespace-normalized, as
 *  seen in the cleaned view (so comment/string noise is already gone and a
 *  multi-line call collapses to one line). This is what an allowlist row pins,
 *  because a LOCATION cannot be pinned honestly -- see the allowlist docstring.
 *  Truncated so a pathological expression cannot bloat the report.
 *
 *  TWO HONEST CONSEQUENCES, both of which fail toward an EXTRA finding (a row
 *  stops matching) and never toward a silent suppression:
 *   - Normalization only COLLAPSES runs of whitespace. It does not add or remove
 *     a lone space, rewrite quote style, or absorb a trailing comma -- so a
 *     purely cosmetic reformat of an audited line (a formatter run, a
 *     single-to-double quote change, wrapping the call across lines) stops
 *     matching its row and trips the ratchet until the row is updated. Treat an
 *     audited fold line as format-locked, or expect to re-copy its site.
 *   - The site is taken from the CLEANED view, where a string-literal root is
 *     canonicalized to `projects` and padded to its original length. For the
 *     ordinary spelling (`'projects'`) the cleaned text equals the source, which
 *     is why the shipped rows are hand-writable; for an unusual spelling
 *     (`'ProjectsRoot'`) the recorded site carries that padding and cannot be
 *     transcribed from source by eye -- run the scanner and copy what it
 *     reports. */
function normalizeSite(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Reduce a captured folded-SEGMENT expression to the untrusted value it
 *  governs: a bare identifier chain is itself; one level of call wrapping
 *  (`decodeURIComponent(seg)`) yields the first identifier chain INSIDE the
 *  call, so the reported token names the value rather than the wrapper. Returns
 *  null when the expression contains no identifier at all (a wrapped literal,
 *  e.g. `basename('fixed')`) -- not a fold. */
function foldedTokenOf(expr) {
  const e = expr.trim();
  if (/^[A-Za-z_$][\w$.]*$/.test(e)) return e;
  const call = /^[A-Za-z_$][\w$.]*\s*\(\s*([^()]*)\s*\)$/.exec(e);
  if (!call) return null;
  const inner = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(call[1]);
  return inner ? inner[0] : null;
}

export function scanProjectsRootFold(text, relFile) {
  const cleaned = cleanForFold(text);
  const origLines = text.split('\n');
  const callees = calleeNames(cleaned, origLines);
  const roots = rootIdents(cleaned, callees);
  const out = [];
  const lineOf = (idx) => cleaned.slice(0, idx).split('\n').length;
  const why = 'untrusted value folded into a projects root — pass it as a guarded segment (resolveGuardedPath(projectsRoot,[value])) or add an audited allowlist row';

  // (1) call form -- multi-line tolerant (`\s` matches newlines). The folded
  // SEGMENT is captured either as a bare identifier chain OR as one level of
  // call wrapping around one (`decodeURIComponent(seg)`, `basename(id)`,
  // `String(body.project)`) -- the ordinary request-path shape in this
  // codebase, and a shape the first cut of this rule missed entirely because it
  // required a bare chain. `foldedTokenOf` below reduces the captured
  // expression to the untrusted value it governs, so the reported `folded`
  // names that value and not the wrapper.
  const calleeAlt = [...callees].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const SEG = `(?:[A-Za-z_$][\\w$.]*\\s*\\(\\s*[^()]*\\s*\\)|[A-Za-z_$][\\w$.]*)`;
  const callRe = new RegExp(
    `(?<![.\\w$])(?:[\\w$]+\\.)*(?:${calleeAlt})\\(\\s*((?:['"][^'"]*['"])|[A-Za-z_$][\\w$.]*)\\s*,\\s*(${SEG})\\s*[),]`,
    'g',
  );
  let m;
  while ((m = callRe.exec(cleaned))) {
    if (!isRootExpr(m[1], roots)) continue;
    const folded = foldedTokenOf(m[2]);
    if (folded === null) continue; // wrapper with no identifier inside (a literal) -- not a fold
    out.push({ file: relFile, line: lineOf(m.index), folded, site: normalizeSite(m[0]), why });
  }

  // (2) template form: `` `projects/${x}` `` or `` `${projectsRoot}/${x}` ``.
  const tplRe = /`([^`]*)`/g;
  while ((m = tplRe.exec(cleaned))) {
    const body = m[1];
    const litPrefix = /^\s*\.?\/?([A-Za-z0-9_.-]+)\//.exec(body);
    const interpPrefix = /^\s*\$\{\s*([A-Za-z_$][\w$.]*)\s*\}\s*\//.exec(body);
    let rest = '';
    if (interpPrefix && isRootExpr(interpPrefix[1], roots)) {
      rest = body.slice(interpPrefix[0].length);
    } else if (litPrefix && isRootExpr(`'${litPrefix[1]}'`, roots)) {
      rest = body.slice(litPrefix[0].length);
    } else {
      continue;
    }
    const fm = /\$\{\s*([A-Za-z_$][\w$.]*)\s*\}/.exec(rest);
    if (fm) out.push({ file: relFile, line: lineOf(m.index), folded: fm[1], site: normalizeSite(m[0]), why });
  }
  return out;
}


export function runLint({ root = FORGE_ROOT, modules = null, sweep = null, allowlist = ALLOWLIST } = {}) {
  const mods = modules ?? targetModules(root);
  const all = [];
  for (const rel of mods) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    all.push(...analyzeModule(readFileSync(abs, 'utf8'), rel));
  }
  // TIER 2 — the name-blind sweep. Explicit `modules` still selects the tier-1
  // set only (unit tests drive a hand-picked list); `sweep` overrides the
  // derived sweep set the same way. FOOTGUN, named (W8-F5 review): passing
  // `modules` WITHOUT `sweep` yields zero tier-2 coverage — deliberate, so a
  // unit test can isolate tier 1, and visible in the result (`swept: 0`). The
  // production entry point is `main()`'s `runLint({})`, which derives both and
  // is pinned live by the test suite; a new caller wanting the whole gate must
  // call it the same way.
  const sweptMods = sweep ?? (modules ? [] : sweepModules(root));
  for (const rel of sweptMods) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    for (const f of analyzeModule(readFileSync(abs, 'utf8'), rel, SWEEP_MODEL)) all.push({ ...f, scope: 'sweep' });
  }
  const { kept, suppressed, stale, mistargeted } = applyAllowlist(all, allowlist);

  // --- projects-root-fold dimension (count-aware, folded-token-keyed) ---
  const foldFindings = [];
  for (const rel of PROJECTS_ROOT_FOLD_MODULES) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    foldFindings.push(...scanProjectsRootFold(readFileSync(abs, 'utf8'), rel));
  }
  // Each (file, SITE) pair gets an audited occurrence BUDGET (row.count). A
  // finding is suppressed only when its own normalized fold EXPRESSION equals
  // an audited site in the same file, and only within that budget: a fold whose
  // expression differs -- even one capturing the same folded token -- is a
  // fresh, un-audited site and is kept at ITS OWN line. See the allowlist's
  // docstring for the two positional keying schemes this replaced and why.
  const foldSeenByKey = new Map();
  const keptFold = [];
  for (const f of foldFindings) {
    const row = PROJECTS_ROOT_FOLD_ALLOWLIST.find((a) => a.file === f.file && a.site === f.site);
    if (!row) {
      const tokenRow = PROJECTS_ROOT_FOLD_ALLOWLIST.find((a) => a.file === f.file && a.folded === f.folded);
      keptFold.push(tokenRow
        ? { ...f, why: `${f.why} [${f.file} has an audited row for the token "${f.folded}", but it pins the expression \`${tokenRow.site}\` — this line folds a different expression (\`${f.site}\`) and is NOT covered by that audit]` }
        : f);
      continue;
    }
    const key = `${row.file}\u0000${row.site}`;
    const seen = (foldSeenByKey.get(key) ?? 0) + 1;
    foldSeenByKey.set(key, seen);
    if (seen <= row.count) continue; // within the audited budget -- suppressed
    keptFold.push({
      ...f,
      why: `audited occurrence budget exceeded in ${row.file} for the expression \`${row.site}\` (audited count: ${row.count}, this file now holds ${seen}) — a fresh, un-audited occurrence; route it through resolveGuardedPath, or raise the row's count only after auditing THIS occurrence too`,
    });
  }
  // A fold-allowlist row whose audited budget is NOT fully consumed (fewer
  // real occurrences than its `count`) is STALE -- reported non-fatally,
  // mirroring the line-keyed allowlist's existing stale handling. (`line`
  // carries a token marker so main()'s `${s.file}:${s.line}` print stays
  // readable.) The real tree must report zero stale fold rows.
  const foldStale = PROJECTS_ROOT_FOLD_ALLOWLIST
    .filter((a) => (foldSeenByKey.get(`${a.file}\u0000${a.site}`) ?? 0) < a.count)
    .map((a) => ({ file: a.file, line: `fold:${a.folded}` }));

  return {
    findings: [...kept, ...keptFold],
    suppressed,
    stale: [...stale, ...foldStale],
    mistargeted,
    scanned: mods.length,
    swept: sweptMods.length,
    total: all.length + foldFindings.length,
  };
}

function main() {
  const asJson = process.argv.includes('--json');
  const r = runLint({});
  if (asJson) {
    console.log(JSON.stringify(r, null, 2));
    return r.findings.length ? 1 : 0;
  }
  for (const s of r.stale) {
    console.warn(`check-raw-fs-guarded: STALE allowlist entry (suppresses nothing — line drift or a fixed sink) — ${s.file}:${s.line}`);
  }
  for (const m of r.mistargeted) {
    console.warn(`check-raw-fs-guarded: MISTARGETED allowlist entry — ${m.entry.file}:${m.entry.line} audited "${m.entry.sink}" but the line now holds "${m.found.sink}" (not suppressed; re-audit).`);
  }
  if (r.findings.length) {
    console.error(`check-raw-fs-guarded: FAIL — ${r.findings.length} unguarded request-derived raw fs sink(s) across ${r.scanned} request-handling module(s) + ${r.swept} swept module(s):`);
    for (const f of r.findings) {
      const label = f.folded !== undefined ? `projects-root-fold [${f.folded}]` : `${f.sink}(${f.path})`;
      console.error(`  ✗ ${f.file}:${f.line} ${label} — ${f.why}`);
    }
    console.error('');
    console.error('Each must be either:');
    console.error('  1. Routed through the guard (leaf included):');
    console.error('       guardedFile(TRUSTED_ROOT, [...request-derived segments, leaf], mode) — or guardedReadFile/guardedWriteFile/guardedReadDir.');
    console.error('       The request-derived id is a SEGMENT; never fold it into the trusted root.');
    console.error('  2. Or added to the ALLOWLIST in scripts/check-raw-fs-guarded.allowlist.mjs (file+line+reason) if it is an audited-trusted residual.');
    return 1;
  }
  console.log(`check-raw-fs-guarded: PASS — ${r.scanned} request-handling module(s) scanned (full model) + ${r.swept} swept for the unambiguous request shapes, ${r.suppressed.length} allowlisted residual(s), 0 unguarded request-derived raw fs sinks`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// `process.exitCode`, never `process.exit()` — this `--json` document is ~313 KB
// and exiting truncates an undrained pipe (scripts/guard-stdout-flush.test.ts).
if (isMain) process.exitCode = main();
