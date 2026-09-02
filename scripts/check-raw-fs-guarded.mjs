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
 *     under `cli/` and `orchestrator/`, scanned for the UNAMBIGUOUS shapes only
 *     — a value read off an HTTP request MEMBER (`body.*`/`params.*`/`query.*`/
 *     `req.*`/`request.*`), a raw leaf below a guard producer's output, or one
 *     of the six bare ids in `SWEEP_MODEL.bareTaint` (the names that are never
 *     server-enumerated outside the declared surface). So in tier 2 a request
 *     value laundered through one of the FOUR EXCLUDED bare ids (`cycleId`,
 *     `initiativeId`, `repoPath`, `runId`) or through an unresolved dir-param
 *     leaf-append is NOT reported — those rules are calibrated for request
 *     handlers, and over the whole tree the full model reports 108 findings at
 *     `c0093918`, nearly all server-built ids, i.e. an allowlist that would
 *     train blind regeneration. CONCRETELY, the shape this does NOT catch: a
 *     brand-new DELEGATE HELPER outside the declared surface whose route caller
 *     hands it a request id under one of those four names, by plain parameter.
 *     Bring such a helper into `EXPLICIT_MODULES` (that is what those rows are
 *     for) or give it the HTTP-plumbing signal. A module OUTSIDE `cli/` and
 *     `orchestrator/` (`loops/`, `apps/studio/`, `scripts/`) is not scanned by
 *     EITHER tier.
 *   - TIER 1's ENTRY half is still name-shaped one level up: `listEntryModules`
 *     treats `cli/ui-bridge.ts` + `cli/bridge-*.ts` as the HTTP entry points, so
 *     a brand-new top-level dispatcher under a different name, imported by
 *     nothing that already exists, reaches tier 2 only, not the full model.
 *     Adding a whole new dispatcher is a far larger architectural event than
 *     adding a route module (the shape this lint's scope defect was actually
 *     about), but the seam is named here rather than left implied.
 *   - TIER 1's reachability half inherits the sibling walker's limits: only
 *     RELATIVE imports inside `cli/`+`orchestrator/` are followed, so a module
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
import { findReachableModules, listEntryModules } from './check-request-path-sinks.mjs';

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
  'packages/agents/agent-run.ts',
  'packages/sessions/interactive-session.ts',
  'packages/sessions/interactive-runner.ts',
  'packages/sessions/architect-runner.ts',
  'packages/sessions/instructions-runner.ts',
  'orchestrator/project-brain-builder-runner.ts',
  'packages/sessions/demo-builder-runner.ts',
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
  // CLI-side operator surfaces that take the same project/initiative ids the
  // routes do, reached by `forge <verb>` rather than by an HTTP dispatch.
  'packages/flows/metrics.ts',
  'packages/projects/contract-stages.ts',
  'packages/factory/architect-plan.ts',
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

/** Repo-relative non-test `.ts` files under `cli/` and `orchestrator/`. */
function allSourceModules(root) {
  const out = [];
  const walk = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
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
  const hasCli = existsSync(join(root, 'cli'));
  const entries = hasCli ? listEntryModules(root) : [];
  const reachable = hasCli ? findReachableModules(root) : [];
  const plumbing = reachable.filter((rel) => {
    const abs = join(root, rel);
    return existsSync(abs) && HTTP_PLUMBING_RE.test(readFileSync(abs, 'utf8'));
  });
  const all = new Set([...EXPLICIT_MODULES, ...entries, ...plumbing]);
  return [...all].filter((m) => existsSync(join(root, m))).sort();
}

/**
 * TIER 2 — the SWEEP: every other non-test module under `cli/` and
 * `orchestrator/`, scanned for the UNAMBIGUOUS shape only (a value read off an
 * HTTP request MEMBER — `body.*`/`params.*`/`query.*`/`req.*`/`request.*` — or a
 * raw leaf appended below a guard producer's output, reaching a raw fs sink).
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
  bareTaint: new Set(['sessionId', 'slug', 'projectId', 'project_repo_path', 'url', 'rawUrl']),
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

// ---------------------------------------------------------------------------
// ALLOWLIST — audited-trusted residuals. EVERY entry is keyed by file + line +
// a mandatory reason. A finding at (file,line) present here is suppressed; an
// un-allowlisted finding fails the build. An allowlist entry that suppresses
// nothing is reported as STALE (a warning — line drift is expected as code
// moves; a stale entry never fails the gate, but should be pruned/retargeted).
//
// Categories permitted here (charter): CLI-arg-only non-HTTP sinks; a path built
// purely from a trusted constant the name-based scan could not prove; an
// internal tail/state path; a legacy manual realpath+startsWith containment not
// yet migrated to guardedFile; a boolean-only existence probe (no bytes flow).
// ---------------------------------------------------------------------------
// Reason-category tags (documentation prefixes; the guarantee is the per-entry
// prose, not the tag). Every entry names the ACCEPTED mechanism that contains
// the request-derived value — an id-charset gate (SAFE_ID_RE / INIT_ID_RE /
// isSafeRunId / SAFE_PROJECT_NAME_RE / isSafeCycleId), a manifest-path-guard
// (isContainedWorktreePath / isContainedProjectRepoPath), an exclusive create
// (mkdir-no-recursive + O_EXCL `wx`), or manual realpath+startsWith — plus WHY
// that is trusted here even though it is NOT the resolveGuardedPath leaf guard.
// An id-charset gate blocks `/` and `..` (no traversal) but is symlink-BLIND;
// where such a gate is the only containment on a READ/WRITE of internal
// _logs/queue content, the residual symlink exposure is disclosed and echoed in
// openConcerns (a migrate-to-guardedFile follow-up for T1), never hidden.
// LINE-DRIFT REMAP, 2026-08-23 (W8-A1, bead forge-c6h). Fourteen rows were
// re-keyed with NO change to what they audit — the sink, the file and the
// reasoning are byte-identical; only the line number moved, because
// `forge agent dispatch` gained the `--projects-root` flag and its argv
// validator earlier in `cli/agent-run.ts` (+113 lines) and `cli/ui-bridge.ts`
// gained the matching `spawnAgentDispatch`/`buildAgentDispatchArgs` parameter
// and two call-site comments. Verified by re-running this scanner: 73
// allowlisted residuals and 0 unguarded sinks, the same counts as before the
// change — this branch adds no new residual.
//   cli/agent-run.ts  725->838
//   cli/ui-bridge.ts  3102->3106  3103->3107  3528->3545  3529->3546
//                     4704->4721  4705->4722  4713->4730  4756->4773
//                     4757->4774  4773->4790  5345->5362  5545->5568
//                     5841->5864
// This is the fragility bd forge-mlk names: a line-keyed allowlist turns any
// insertion ANYWHERE above a row into a red containment ratchet. In this lane a
// three-line COMMENT in an unrelated function (cli/bridge-studio.ts) reddened
// four tests across two suites before it was noticed. The remap is mechanical
// and safe; the key design is not.
export const ALLOWLIST = [
  // ---- cli/agent-run.ts — CLI subcommand handler (non-HTTP) ----
  { file: 'packages/agents/agent-run.ts', line: 928, sink: 'existsSync',
    reason: 'CLI-ARG + BOOL-PROBE: findSessionProject(sessionId) — sessionId is a `forge <verb>` CLI argument (operator trust boundary), NOT an HTTP request; both existsSync calls are boolean status.json/PLAN.md probes under readdir-enumerated projects/*, no bytes read/written through the path. (Line-drift remap from 695 — SEC-07 added the cmdAgentDispatch --project resolveGuardedPath segment-guard, the isSafeRunId import, and the findSessionProject defensive bound earlier in the file, +23 lines; same function, same probe, byte-for-byte unchanged — verified by sed -n "718p" cli/agent-run.ts.) (Line-drift remap to 725 -- W7-FIX-A2 (W7A2-01): writeSessionTerminalPhase now rides guardedWriteSessionStatus (sticky-cancel seam) — a new import line + the seam comment block earlier in the file, +7 lines; same function, same probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Line-drift remap from 838 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.)' },

  // ---- cli/bridge-studio-kbs.ts ----
  { file: 'packages/knowledge/bridge-studio-kb-consolidate.ts', line: 48, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE (R1-06 WI-3, TRUSTED-AT-CONSTRUCTION): writeConsolidateTerminalEvent — the bare `runId` PARAM matches the taint-list name, but at its ONLY call site (line 515, inside runBrainConsolidateNow) the actual value is server-built as `${kbId}-consolidate-${Date.now().toString(36)}`, where kbId is SLUG_RE-gated at the POST /api/studio/kbs/:id/maintenance route (line 1299) strictly before consolidate dispatch (line 1400); `_brainfix-<runId>` is a single segment under trusted forgeRoot/_logs. Same construction class as the already-allowlisted fix-agent runId (`${kbId}-${Date.now().toString(36)}`, spawnBrainFix\'s own logDir mkdirSync a few lines above) — this scan does not also flag that one only because it reaches its sink via `p.runId`, a member expression outside the curated bare-name list, not because the value differs. (Line-drift remap from 259 — forge-2am moved the findings-scoping + per-check itemization helpers to cli/kb-lint-summary.ts, -34 lines earlier in the file. Further remap from 225 — forge-3oq, same cause as the rows above, +4 lines. Further remap from 229 — forge-3oq review, same relocation as the readBrainFixState rows above, -53 lines.) (Further remap from 176 — UI-H merged parsoFish/main c45e3892 into feat/ui-h-honesty; forge-2am had already moved the findings-scoping + per-check itemization helpers to cli/kb-lint-summary.ts. Sink expression and enclosing function re-verified at the new line: writeConsolidateTerminalEvent.) (Further remap from 178 — W6-P2, same cause as the rows above, +1 line. Further remap from 179 — W6-P2 round 2, same cause as the rows above, +1 line — verified by sed -n "180p" cli/bridge-studio-kbs.ts.) (Line-drift remap from 180 -- W7-A4 (one id rule: KB_ID_RE gates + isReservedId on the create route + kb-sites enumeration in loadKbDescriptors), +1 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Line-drift remap from 181 -- W7-B2 (knowledge-05/22/24/29): kb-job-state import + active-job 409 wiring, create-route collision/seeding-anchor additions, guidance-queue listing and per-KB runs support added above; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 184 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (W8-F1 line-drift remap from 198 — no code change to this sink; the shift comes from the knowledge-42 counters in writeConsolidateTerminalEvent/readBrainFixState and the writeRootFenceOptions extraction above it. Remapped from a `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic (forge-mlk).) (M1-D line-drift remap from 214 — no code change to this sink. cli/bridge-studio-kbs.ts lost the per-KB own-theme lens (the listOwnThemeFiles/ownThemeFindingsLens/unionFindings imports and the union doc block in buildKbHealth) when brain-lint\'s scan was widened to cover brain/projects/*/themes (ADR 035); cli/brain-lint.ts gained themeDirs/themeSubdir/isForgeTheme above findThemeBySlug. Every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 7 matching 1:1, never by arithmetic on the file.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from packages/knowledge/bridge-studio-kbs.ts:210.)' },
  { file: 'packages/knowledge/bridge-studio-kb-consolidate.ts', line: 79, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE (R1-06 WI-3, TRUSTED-AT-CONSTRUCTION): writeConsolidateErrorTerminalEvent — same runId construction and same trust chain as line 176 (writeConsolidateTerminalEvent); this is the crash-path terminal-event sibling, called from the same runBrainConsolidateNow with the identical `runId` binding. (Line-drift remap from 287 — forge-2am, same cause as the row above. Further remap from 253 — forge-3oq, same cause as the rows above. Further remap from 257 — forge-3oq review, same relocation as the rows above, -53 lines.) (Further remap from 204 — UI-H merged parsoFish/main c45e3892 into feat/ui-h-honesty; forge-2am had already moved the findings-scoping + per-check itemization helpers to cli/kb-lint-summary.ts. Sink expression and enclosing function re-verified at the new line: writeConsolidateErrorTerminalEvent.) (Further remap from 206 — W6-P2, same cause as the rows above, +1 line. Further remap from 207 — W6-P2 round 2, same cause as the rows above, +1 line — verified by sed -n "208p" cli/bridge-studio-kbs.ts.) (Line-drift remap from 208 -- W7-A4 (one id rule: KB_ID_RE gates + isReservedId on the create route + kb-sites enumeration in loadKbDescriptors), +1 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Line-drift remap from 209 -- W7-B2 (knowledge-05/22/24/29): kb-job-state import + active-job 409 wiring, create-route collision/seeding-anchor additions, guidance-queue listing and per-KB runs support added above; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 212 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (W8-F1 line-drift remap from 226 — no code change to this sink; the shift comes from the knowledge-42 counters in writeConsolidateTerminalEvent/readBrainFixState and the writeRootFenceOptions extraction above it. Remapped from a `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic (forge-mlk).) (M1-D line-drift remap from 245 — no code change to this sink. cli/bridge-studio-kbs.ts lost the per-KB own-theme lens (the listOwnThemeFiles/ownThemeFindingsLens/unionFindings imports and the union doc block in buildKbHealth) when brain-lint\'s scan was widened to cover brain/projects/*/themes (ADR 035); cli/brain-lint.ts gained themeDirs/themeSubdir/isForgeTheme above findThemeBySlug. Every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 7 matching 1:1, never by arithmetic on the file.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from packages/knowledge/bridge-studio-kbs.ts:241.)' },

  // ---- cli/bridge-studio-runs.ts ----
  { file: 'packages/flows/bridge-studio-runs.ts', line: 120, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE: _spawnArchitectTurn — sessionId is SAFE_ID_RE-gated at line 116 (early return); `_architect-<sessionId>` single segment under trusted forgeRoot/_logs.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 121, sink: 'openSync',
    reason: 'LOGDIR-CREATE (W7-C3 forge-i9w, fd-sink family joins the scan): _spawnArchitectTurn\'s stderr.log append-open — the SAME logDir the mkdirSync row directly above audits (sessionId SAFE_ID_RE-gated at the function head, early return; `_architect-<sessionId>` single segment + literal stderr.log leaf under trusted forgeRoot/_logs). Newly VISIBLE, not newly written: this open predates the sink-list extension.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 181, sink: 'existsSync',
    reason: 'QUEUE-PROBE: initiativeId is INIT_ID_RE-gated at line 162 BEFORE any path construction (C1); both probes are boolean under trusted ctx.queueRoot.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 188, sink: 'existsSync',
    reason: 'QUEUE-PROBE: manifestPath ternary — INIT_ID_RE-validated (line 162) `<id>.md` under trusted queueRoot; boolean.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 191, sink: 'readFileSync',
    reason: 'QUEUE-READ: reads a manifest at join(queueRoot, {in-flight|ready-for-review}, <INIT_ID_RE id>.md) — validated single segment under trusted queueRoot.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 215, sink: 'existsSync',
    reason: 'WORKTREE-GUARDED: approveWorktreePath is validated by isContainedWorktreePath (per-segment realpath containment, manifest-path-guard) at line ~208, strictly BEFORE this existence probe (SEC-02 round-5 ordering).' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 366, sink: 'readFileSync',
    reason: 'QUEUE-READ: send-back manifest read at the same INIT_ID_RE-validated `<id>.md` under trusted queueRoot as line 191.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 406, sink: 'existsSync',
    reason: 'WORKTREE-GUARDED: worktreePath validated by isContainedWorktreePath at line ~390 before this probe (guard symmetry with the approve branch).' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 427, sink: 'existsSync',
    reason: 'WORKTREE-GUARDED: boolean package.json probe under worktreePath, already isContainedWorktreePath-validated above.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 815, sink: 'existsSync',
    reason: 'QUEUE-PROBE: filename = `${initiativeId}.md`, initiativeId INIT_ID_RE-gated at line 789; boolean under trusted queuePaths.inFlight.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 819, sink: 'existsSync',
    reason: 'QUEUE-PROBE: as line 797, trusted queuePaths.done.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 825, sink: 'existsSync',
    reason: 'QUEUE-PROBE: as line 797, trusted queuePaths.pending.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 835, sink: 'existsSync',
    reason: 'QUEUE-PROBE: candidate = join(<trusted queuePaths.readyForReview|failed>, INIT_ID_RE filename); boolean.' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 851, sink: 'writeFileSync',
    reason: 'QUEUE-WRITE: tmpPath = join(queuePaths.pending, `${initiativeId}.md`) + ".tmp"; INIT_ID_RE-validated single segment under trusted queuePaths.pending (atomic write-then-rename), no traversal possible.' },

  // ---- cli/bridge-studio-writes.ts ----
  // W7-B6 code-review round line-drift remap: F4 grew scaffoldContractArtifacts
  // (three-way git-init rule, +26 lines → 880→906, 945→971) and F6 grew the
  // contract-stages 409 hint comment in cli/bridge-studio.ts (1454→1459).
  // Sink expressions + enclosing functions re-verified at the new lines.
  // W7-FIX-B-PROJ line-drift remap (+33): the born-contract-green fix added the
  // .gitignore pre-check to checkContractArtifactContainment (+8 before old
  // line 1408) and the C2 .gitignore scaffold block to scaffoldContractArtifacts
  // (+25). The two rows below moved 1408→1441 and 1473→1506; sink expressions +
  // enclosing functions re-verified at the new lines, guards unchanged —
  // re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.
  // W7-FIX-B-PROJ /code-review round remap: F2 extracted the three-way git-init
  // probe as needsGitInit (shared by the pre-check and the scaffold so the
  // .gitignore guard mirrors the write condition exactly), F3 grew the
  // third-write-target docstrings, F4 single-sourced the scaffold's build-output
  // globs from SCAFFOLD_BUILD_OUTPUT_IGNORES. Rows moved 152→207, 160→220,
  // 280→325, 1441→1486, 1506→1553; every sink expression + enclosing function
  // re-verified at its new line, guards unchanged.
  { file: 'cli/bridge-studio-writes.ts', line: 289, sink: 'existsSync',
    reason: 'PROJECTROOT-GUARDED (W8-A1, bead forge-7pa): needsPackageJsonScaffold — boolean "does package.json already exist" probe. Exactly the .gitignore probe two rows below, one target across: projectRoot is isContainedProjectRepoPath-validated at the route before this Phase-1 checker ever runs, and the leaf is the SERVER CONSTANT \'package.json\' — nothing request-derived reaches the join, so no separator can be introduced. No bytes flow through it: the result is a boolean feeding the shared write/check predicate, and the WRITE it gates goes through resolveGuardedPath(projectRoot, [\'package.json\']).realPath, which rejects a symlinked or dangling leaf (pinned by the outside-target-byte-unchanged test in cli/onboard-package-json-scaffold.test.ts). The probe deliberately answers TRUE for a dangling symlink so an operator file is never clobbered — the guard, not this probe, is what refuses the write. (Line-drift remap from 274 -- forge-hoq: bridge-studio-writes.ts gained isStringArray (+8 lines, before line 209) and the allowedTools/disallowedTools body-read + 400-reject block in the agent PUT merge (+31 lines, before the old `const merged` at 1484), cumulative +8 for rows past both; same function, same guard/probe, source text unchanged -- every row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic on the file.) (Line-drift remap from 282 -- W8-B5: the registry-import block in cli/bridge-studio-writes.ts grew from 1 line to 6 (+5 for every row past it) and parseRegistryItemBody / mutateCommunityRegistry / the registry PUT arm were reshaped for community-registry schema v2 (+18 more, cumulative +23 for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 287 -- W8-B5 review FINDING 1: cli/bridge-studio-writes.ts gained the cli/community-registry-lock.ts import (+1 line, near the studio-path-guard import) and mutateCommunityRegistry was wrapped in the shared registry mutex plus a sendRegistryWriteFailure helper added beside it (+33 more for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged (verified with `git show HEAD:cli/bridge-studio-writes.ts | sed -n "287p"` against `sed -n "288p"` on the current tree) -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.)' },
  { file: 'cli/bridge-studio-writes.ts', line: 338, sink: 'existsSync',
    reason: 'PROJECTROOT-GUARDED: checkContractArtifactContainment — boolean "does .gitignore already exist" probe, gated (review F2) on the SAME needsGitInit predicate the scaffold\'s write uses, so the guard covers exactly the writes that can happen: an own-repo / operator-enclosed checkout never has its .gitignore written and is therefore never guarded (a dangling-symlink .gitignore there no longer false-rejects the onboard), while a would-be-created repo\'s absent .gitignore still runs resolveGuardedPath(projectRoot, [\'.gitignore\']) (rejects a symlinked/dangling leaf) before ANY write is attempted; projectRoot itself was validated by isContainedProjectRepoPath at the route. Same idiom as the .forge/project.json probe two blocks up (W7-FIX-B-PROJ: .gitignore joined the scaffold write set). (Review-round remap from 160 -- W7-FIX-B-PROJ /code-review fixes, see the block note above; same function, guard now deliberately CONDITIONAL per review F2 -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 323 -- forge-hoq: bridge-studio-writes.ts gained isStringArray (+8 lines, before line 209) and the allowedTools/disallowedTools body-read + 400-reject block in the agent PUT merge (+31 lines, before the old `const merged` at 1484), cumulative +8 for rows past both; same function, same guard/probe, source text unchanged -- every row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic on the file.) (Line-drift remap from 331 -- W8-B5: the registry-import block in cli/bridge-studio-writes.ts grew from 1 line to 6 (+5 for every row past it) and parseRegistryItemBody / mutateCommunityRegistry / the registry PUT arm were reshaped for community-registry schema v2 (+18 more, cumulative +23 for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 336 -- W8-B5 review FINDING 1: cli/bridge-studio-writes.ts gained the cli/community-registry-lock.ts import (+1 line, near the studio-path-guard import) and mutateCommunityRegistry was wrapped in the shared registry mutex plus a sendRegistryWriteFailure helper added beside it (+33 more for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged (verified with `git show HEAD:cli/bridge-studio-writes.ts | sed -n "336p"` against `sed -n "337p"` on the current tree) -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.)' },
  { file: 'cli/bridge-studio-writes.ts', line: 486, sink: 'existsSync',
    reason: 'PROJECTROOT-GUARDED: scaffoldContractArtifacts — boolean "already there, skip" idempotency probe for the C2 .gitignore scaffold; the write below it goes through resolveGuardedPath(projectRoot, [\'.gitignore\']).realPath (rejects symlinked/dangling leaves — the SEC-03 Finding-B roadmap.md idiom, mirrored). projectRoot proven contained by the caller (isContainedProjectRepoPath) + Phase-1 checkContractArtifactContainment (W7-FIX-B-PROJ). (Review-round remap from 280 -- W7-FIX-B-PROJ /code-review fixes, see the block note above; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 325 -- projects-37 (S1): scaffoldContractArtifacts now tracks whether THIS call inited the repo (+2 lines) and commits the scaffold at birth so an onboarded project is never left on an unborn HEAD (+25 lines for rows past it); same function, same guard/probe, source text unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 471 -- forge-hoq: bridge-studio-writes.ts gained isStringArray (+8 lines, before line 209) and the allowedTools/disallowedTools body-read + 400-reject block in the agent PUT merge (+31 lines, before the old `const merged` at 1484), cumulative +8 for rows past both; same function, same guard/probe, source text unchanged -- every row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic on the file.) (Line-drift remap from 479 -- W8-B5: the registry-import block in cli/bridge-studio-writes.ts grew from 1 line to 6 (+5 for every row past it) and parseRegistryItemBody / mutateCommunityRegistry / the registry PUT arm were reshaped for community-registry schema v2 (+18 more, cumulative +23 for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 484 -- W8-B5 review FINDING 1: cli/bridge-studio-writes.ts gained the cli/community-registry-lock.ts import (+1 line, near the studio-path-guard import) and mutateCommunityRegistry was wrapped in the shared registry mutex plus a sendRegistryWriteFailure helper added beside it (+33 more for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged (verified with `git show HEAD:cli/bridge-studio-writes.ts | sed -n "484p"` against `sed -n "485p"` on the current tree) -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.)' },
  { file: 'cli/bridge-studio-writes.ts', line: 1852, sink: 'existsSync',
    reason: 'PROJECTROOT-GUARDED: projectRoot is validated by isContainedProjectRepoPath (manifest-path-guard, per-segment realpath) at line 1389; this is a boolean duplicate-project probe. (Line-drift remap from 854 -- W7-A4 (one id rule: PROJECT_ID_RE gates + isReservedId on the agents/projects/flows create routes), +9 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 906 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap from 1174 -- reconciling feat/w7-b4-library-authoring with parsoFish/main post-W7-B6 (#188); same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Review-round remap from 1325 -- W7-B4 review fixes in cli/bridge-studio-writes.ts (agent-DELETE kind-confusion guard, session-kinds fail-closed, flow-DELETE trigger/malformed guards, starter materialisation split into plan+apply); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1408 -- W7-FIX-B-PROJ born-contract-green fix: checkContractArtifactContainment gained the .gitignore pre-check (+8) and scaffoldContractArtifacts the C2 .gitignore scaffold block (+25), cumulative +33 for rows past both; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Review-round remap from 1441 -- W7-FIX-B-PROJ /code-review fixes, see the block note above; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1486 -- agents-44 fix: applyStarterAgentMaterialisation stamps `phase: <slug>` / `library: true` onto the materialised starter SKILL.md via guardedFile/guardedWriteFile (+38 lines) so a starter copied into the live roster is dispatchable; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1524 -- projects-37 (S1): scaffoldContractArtifacts now tracks whether THIS call inited the repo (+2 lines) and commits the scaffold at birth so an onboarded project is never left on an unborn HEAD (+25 lines for rows past it); same function, same guard/probe, source text unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 1735 -- forge-hoq: bridge-studio-writes.ts gained isStringArray (+8 lines, before line 209) and the allowedTools/disallowedTools body-read + 400-reject block in the agent PUT merge (+31 lines, before the old `const merged` at 1484), cumulative +39 for rows past both; same function, same guard/probe, source text unchanged -- every row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic on the file.) (Line-drift remap from 1774 -- W8-B5: the registry-import block in cli/bridge-studio-writes.ts grew from 1 line to 6 (+5 for every row past it) and parseRegistryItemBody / mutateCommunityRegistry / the registry PUT arm were reshaped for community-registry schema v2 (+18 more, cumulative +23 for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 1774 -- W8-B5 WI-3 CORRECTION: the earlier W8-B5 remap moved this row +23, but the real cumulative drift for the rows past parseRegistryItemBody/mutateCommunityRegistry is +28 -- the two TAIL rows were left 5 lines short, which is why `check-raw-fs-guarded` was already FAILING at HEAD 057e32d1 (3 unguarded sinks) and taking 4 node-test cases down with it. Same function, same guard/probe, source text byte-for-byte unchanged -- re-paired to the new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 1802 -- W8-B5 review FINDING 1: cli/bridge-studio-writes.ts gained the cli/community-registry-lock.ts import (+1 line, near the studio-path-guard import) and mutateCommunityRegistry was wrapped in the shared registry mutex plus a sendRegistryWriteFailure helper added beside it (+33 more for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged (verified with `git show HEAD:cli/bridge-studio-writes.ts | sed -n "1802p"` against `sed -n "1836p"` on the current tree) -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.)' },
  { file: 'cli/bridge-studio-writes.ts', line: 1919, sinks: ['existsSync', 'mkdirSync'],
    reason: 'PROJECTROOT-GUARDED: SEC-03 Defect-5 create-mode — projectRoot proven contained by isContainedProjectRepoPath (line 1389) AND Phase-1 checkContractArtifactContainment; `if (!existsSync(projectRoot)) mkdirSync(projectRoot, {recursive})` — BOTH sinks on this line ride that proof (the in-file writeup is definitive). (Line-drift remap from 919 -- W7-A4 (one id rule: PROJECT_ID_RE gates + isReservedId on the agents/projects/flows create routes), +9 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 971 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap from 1239 -- reconciling feat/w7-b4-library-authoring with parsoFish/main post-W7-B6 (#188); same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Review-round remap from 1390 -- W7-B4 review fixes in cli/bridge-studio-writes.ts (agent-DELETE kind-confusion guard, session-kinds fail-closed, flow-DELETE trigger/malformed guards, starter materialisation split into plan+apply); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1473 -- W7-FIX-B-PROJ born-contract-green fix: checkContractArtifactContainment gained the .gitignore pre-check (+8) and scaffoldContractArtifacts the C2 .gitignore scaffold block (+25), cumulative +33 for rows past both; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Review-round remap from 1506 -- W7-FIX-B-PROJ /code-review fixes, see the block note above; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1553 -- agents-44 fix: applyStarterAgentMaterialisation stamps `phase: <slug>` / `library: true` onto the materialised starter SKILL.md via guardedFile/guardedWriteFile (+38 lines) so a starter copied into the live roster is dispatchable; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1591 -- projects-37 (S1): scaffoldContractArtifacts now tracks whether THIS call inited the repo (+2 lines) and commits the scaffold at birth so an onboarded project is never left on an unborn HEAD (+25 lines for rows past it); same function, same guard/probe, source text unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 1802 -- forge-hoq: bridge-studio-writes.ts gained isStringArray (+8 lines, before line 209) and the allowedTools/disallowedTools body-read + 400-reject block in the agent PUT merge (+31 lines, before the old `const merged` at 1484), cumulative +39 for rows past both; same function, same guard/probe, source text unchanged -- every row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic on the file.) (Line-drift remap from 1841 -- W8-B5: the registry-import block in cli/bridge-studio-writes.ts grew from 1 line to 6 (+5 for every row past it) and parseRegistryItemBody / mutateCommunityRegistry / the registry PUT arm were reshaped for community-registry schema v2 (+18 more, cumulative +23 for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 1841 -- W8-B5 WI-3 CORRECTION: the earlier W8-B5 remap moved this row +23, but the real cumulative drift for the rows past parseRegistryItemBody/mutateCommunityRegistry is +28 -- the two TAIL rows were left 5 lines short, which is why `check-raw-fs-guarded` was already FAILING at HEAD 057e32d1 (3 unguarded sinks) and taking 4 node-test cases down with it. Same function, same guard/probe, source text byte-for-byte unchanged -- re-paired to the new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 1869 -- W8-B5 review FINDING 1: cli/bridge-studio-writes.ts gained the cli/community-registry-lock.ts import (+1 line, near the studio-path-guard import) and mutateCommunityRegistry was wrapped in the shared registry mutex plus a sendRegistryWriteFailure helper added beside it (+33 more for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged (verified with `git show HEAD:cli/bridge-studio-writes.ts | sed -n "1869p"` against `sed -n "1903p"` on the current tree) -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.)' },

  // ---- cli/bridge-studio.ts ----

  // ---- cli/ui-bridge.ts ----
  // W7-C3 review (A-M6) line-drift remap: every row below line 1957 is
  // unchanged; the 14 rows at/after it moved +7 because the artifact FILENAME
  // gate was re-cut as a shared DENY predicate (`isSafeSubPath`) with its
  // rationale in comments, earlier in the same file. NO row was widened, no
  // sink changed, no guard changed — re-verified by a direct
  // `node scripts/check-raw-fs-guarded.mjs` run against this tree.
  // (W7-B7 line-drift remap: +2 for lines >49 — the editComment/deleteComment
  // imports — and +38 for lines >2377 — the review-comments /edit + /delete
  // route block. Same sinks, same guards, unchanged; re-verified via a direct
  // `node scripts/check-raw-fs-guarded.mjs` run. cli/bridge-studio-runs.ts
  // entries likewise remapped +18 for lines >748 (recoverInitiativeId) and
  // +20 for lines >889 (gate-branch comment).)
  { file: 'cli/ui-bridge.ts', line: 496, sink: 'existsSync',
    reason: 'LOG-TAIL: ensureTailFor(cycleId) — boolean guard before establishing a READ-ONLY setInterval tail of <logsRoot>/<cycleId>/events.jsonl; cycleId is an internal broadcast cycle id, path under trusted logsRoot. (Line-drift remap from 447 — R4-19-F2 WI-2, +7 lines. Further remap from 454 — W6-B2 review fix added a LEGACY_SESSION_TERMINAL_PHASES import to the top-of-file import block, +1 line; same function, same guard, unchanged — verified by sed -n "455p" cli/ui-bridge.ts.) (Merge remap from 455 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 456 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +2 lines; same function, same guard, unchanged.) (Line-drift remap to 460 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +2 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 461 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 460 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 461 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +1 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 462 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 462 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 466 -- reconciling feat/w7-b3-community (community-registry CRUD + skill-only/server-owned-signals review round in cli/bridge-studio-writes.ts; the community-refresh brief + W7-B3 routes in cli/ui-bridge.ts) with parsoFish/main post-W7-B1/B7; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap to 482 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Line-drift remap from 482 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 490 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 500 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 496 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:497.)' },
  { file: 'cli/ui-bridge.ts', line: 936, sink: 'existsSync',
    reason: 'BOOL-PROBE: existsSync(reviewCommentsPath(logsRoot, cycleId)) — boolean "does the sidecar exist" only; the paired writeReviewComments(logsRoot, cycleId) enforces containment and throws (→500, never writes) on a traversal cycleId; route params are isSafeCycleId-gated. (Line-drift remap from 752 — W6-B2 added ensureSessionTail, +27 lines. Further remap from 779 — W6-B2 review fix, same +1 import-line cause as the row above; same function, same guard, unchanged — verified by sed -n "780p" cli/ui-bridge.ts.) (Merge remap from 780 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 781 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +2 lines; same function, same guard, unchanged.) (Line-drift remap to 785 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +2 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 786 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 785 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 786 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +1 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 787 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 787 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 791 -- reconciling feat/w7-b3-community (community-registry CRUD + skill-only/server-owned-signals review round in cli/bridge-studio-writes.ts; the community-refresh brief + W7-B3 routes in cli/ui-bridge.ts) with parsoFish/main post-W7-B1/B7; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap to 834 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Line-drift remap from 834 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 842 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 940 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 936 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:937.)' },
  { file: 'cli/ui-bridge.ts', line: 1636, sink: 'existsSync',
    reason: 'FILTER-PREDICATE-FP + READDIR-ENUM: kindDir = join(ctx.projectsRoot, <readdir-enumerated project>, `_${descriptor.id}`); `slug` (the taint) appears ONLY in the `.filter(d => d.agent === slug)` predicate that SELECTS descriptors — it is never part of the path VALUE (a server-side session-kind registry id is). Boolean. (Line-drift remap from 1103 — W6-B2, +27 lines. Further remap from 1130 — W6-B2 review fix, same +1 cause as the row above.) (Merge remap from 1131 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 1133 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +2 lines; same function, same guard, unchanged.) (Line-drift remap to 1137 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +2 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 1138 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 1137 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 1138 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +1 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 1139 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 1139 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 1143 -- reconciling feat/w7-b3-community (community-registry CRUD + skill-only/server-owned-signals review round in cli/bridge-studio-writes.ts; the community-refresh brief + W7-B3 routes in cli/ui-bridge.ts) with parsoFish/main post-W7-B1/B7; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap to 1411 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Line-drift remap from 1411 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 1419 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 1643 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 1639 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:1637.)' },
  { file: 'cli/ui-bridge.ts', line: 1639, sink: 'readdirSync',
    reason: 'FILTER-PREDICATE-FP + READDIR-ENUM: as line 1131 — enumerates sessionIds under the registry-derived kindDir. (Line-drift remap from 1106 — W6-B2, +27 lines. Further remap from 1133 — W6-B2 review fix, same +1 cause as the row above.) (Merge remap from 1134 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 1136 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +2 lines; same function, same guard, unchanged.) (Line-drift remap to 1140 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +2 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 1141 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 1140 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 1141 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +1 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Merge remap from 1142 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 1146 -- reconciling feat/w7-b3-community (community-registry CRUD + skill-only/server-owned-signals review round in cli/bridge-studio-writes.ts; the community-refresh brief + W7-B3 routes in cli/ui-bridge.ts) with parsoFish/main post-W7-B1/B7; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 1414 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 1422 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 1646 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 1642 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:1640.)' },  // (SEC-07: the former existsSync(join(ctx.projectsRoot, body.project)) BOOL-PROBE
  // at line 1703 was REPLACED by guardedFile(ctx.projectsRoot, [body.project],
  // 'readdir') — a realpath-identity+existence guard, not a raw sink — so this
  // allowlist row is no longer needed; the sink it audited no longer exists.)
  // W8-A3 (flows-37, 2026-08-23) — LINE-DRIFT REMAP, recorded once here rather
  // than fourteen times inline. THREE edits in `cli/ui-bridge.ts` shifted every
  // later line, one per operator door onto a repoint:
  //   · `POST /api/flows/:id/run`        +7  (~:2875) — the confirmRepoint forward
  //   · `POST /api/initiatives/:id/plan` +10 (~:2830) — the third door, found by
  //                                                     adversarial review round 1
  //   · `POST /api/develop/start`        +10 (~:2258) — the fourth, found by round 2
  //                                                     (no client could confirm
  //                                                     through it at all)
  // A fourth pass followed adversarial review round 3, which replaced the boolean
  // `confirmRepoint` on all three doors with a compare-and-swap
  // (`confirmRepointFrom`) and added the batch refusal on `/api/develop/start`.
  // Cumulative from parsoFish/main a414a423: rows above :2258 unmoved, the row at
  // :2743 shifted +36, every row below :2900 shifted +47. Same sinks, same guards, no audit changed — re-verified by a
  // direct `node scripts/check-raw-fs-guarded.mjs` run each time (PASS, 70
  // allowlisted residuals, the same count this file carried at parsoFish/main
  // a414a423).
  // This is the fourth recorded instance of forge-mlk (P3): a line-keyed
  // allowlist reddens on any edit anywhere earlier in the audited file.
  { file: 'cli/ui-bridge.ts', line: 3492, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE: spawnAgentTurn — sessionId isSafeRunId-gated a few lines above (SAFE_RUN_ID_RE + explicit .. check), unconditionally on the path to it; `_<logPrefix>-<sessionId>` under trusted forgeRoot/_logs. (Line-drift remap from 2064 — W6-B2\'s ensureSessionTail helper + ctx call-site comment, cumulative +32. Further remap from 2096 — W6-B2 review fix\'s exported-SPAWN_AGENT_SPECS doc comment (+10) plus a +1 import line, cumulative +11 more; same function, same guard, unchanged — verified by sed -n "2107p" cli/ui-bridge.ts.) (Merge remap from 2107 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 2109 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +2 lines; same function, same guard, unchanged.) (Line-drift remap to 2370 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 2383 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 2382 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 2386 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 2392 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 1142 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Line-drift remap to 2439 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 2439 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 2489 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 2516 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap from 2569 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 1414 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 3038 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 3076 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 3076 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 3153 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 3487 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 3479 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:3494.)' },
  { file: 'cli/ui-bridge.ts', line: 3493, sink: 'openSync',
    reason: 'LOGDIR-CREATE (W7-C3 forge-i9w, fd-sink family joins the scan): spawnAgentTurn\'s stderr.log append-open — the SAME logDir the mkdirSync row directly above audits (sessionId isSafeRunId-gated a few lines up, unconditional early return; `_<logPrefix>-<sessionId>` single segment + literal stderr.log leaf under trusted forgeRoot/_logs). Newly VISIBLE, not newly written: this open predates the sink-list extension. (Merge remap to 3077 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 3077 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 3154 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 3488 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 3480 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:3495.)' },
  { file: 'cli/ui-bridge.ts', line: 3932, sink: 'openSync',
    reason: 'LOGDIR-CREATE (W7-C3 forge-i9w, fd-sink family joins the scan): spawnAgentDispatch\'s stderr.log append-open — the SAME logDir its sibling mkdirSync row audits (runId isSafeRunId-gated + SAFE_AGENT_SLUG_RE on slug, early return; single runId segment + literal stderr.log leaf under trusted forgeRoot/_logs). Newly VISIBLE, not newly written: this open predates the sink-list extension. (Merge remap to 3503 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 3503 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 3593 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 3927 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 3919 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:3934.)' },
  { file: 'cli/ui-bridge.ts', line: 3931, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE: sibling spawn helper — sessionId/runId isSafeRunId-gated before this log-dir create under trusted forgeRoot/_logs. (Line-drift remap from 2472 — W6-B2, cumulative +32. Further remap from 2504 — W6-B2 review fix, same +11 cause as the row above.) (Merge remap from 2515 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 2517 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +2 lines; same function, same guard, unchanged.) (Line-drift remap to 2778 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 2791 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 2790 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 2794 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 2800 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 2847 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 2847 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 2906 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 2909 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 2936 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap from 2989 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 3458 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 3502 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 3502 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 3592 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 3926 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 3918 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:3933.)' },
  // W7-B6 code-review round line-drift remap (+14): unknownProjectReason grew by
  // the F1 non-id-shape refusal (isSafeSegment-accepted strings failing
  // PROJECT_ID_RE now refuse at the roster guard). The nine rows below moved
  // 4094→4108, 4095→4109, 4103→4117, 4146→4160, 4147→4161, 4163→4177,
  // 4735→4749, 4911→4925, 5174→5188; every sink expression + enclosing
  // function re-verified at the new line, guards unchanged. (Merge remap +38 —
  // parsoFish/main W7-B1/B7 merged into feat/w7-b6-projects moved the same nine
  // rows again: 4108→4146, 4109→4147, 4117→4155, 4160→4198, 4161→4199,
  // 4177→4215, 4749→4787, 4925→4963, 5188→5226; re-verified via a direct
  // check-raw-fs-guarded run against the merged tree.)
  { file: 'cli/ui-bridge.ts', line: 5151, sink: 'mkdirSync',
    reason: 'EXCLUSIVE-CREATE: onboarding — sessionId SAFE_ID_RE-gated a few lines above; mkdirSync(sessionDir) has NO recursive flag, so a pre-existing entry (incl. a symlink) is a hard EEXIST, never reused/followed. (Line-drift remap from 3458 — W6-B2, cumulative +32. Further remap from 3490 — W6-B2 review fix, same +11 cause as the rows above; same function, same guard, unchanged.) (Merge remap from 3501 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 3503 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +62 lines; same function, same guard, unchanged.) (Line-drift remap to 3824 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 3837 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3836 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3841 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 3858 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 3915 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 3915 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 3974 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 3977 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 4004 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap to 4038 -- reconciling fix/w7-a3-loop-closure with parsoFish/main\'s independent, non-overlapping edits earlier in the file (net +19 lines by this point); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap from 4146 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 4624 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 4678 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 4678 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 4768 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 5165 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 5138 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:5153.)' },
  { file: 'cli/ui-bridge.ts', line: 5152, sink: 'writeFileSync',
    reason: 'EXCLUSIVE-CREATE: status.json write with flag `wx` (O_EXCL) — never follows an existing symlink; parent sessionDir just exclusively created, sessionId SAFE_ID_RE-gated. (Line-drift remap from 3459 — W6-B2, cumulative +32. Further remap from 3491 — W6-B2 review fix, same +11 cause as the rows above.) (Merge remap from 3502 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 3504 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +62 lines; same function, same guard, unchanged.) (Line-drift remap to 3825 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 3838 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3837 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3842 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 3859 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 3916 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 3916 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 3975 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 3978 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 4005 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap to 4039 -- reconciling fix/w7-a3-loop-closure with parsoFish/main\'s independent, non-overlapping edits earlier in the file (net +19 lines by this point); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap from 4147 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 4625 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 4679 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 4679 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 4769 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 5166 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 5139 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:5154.)' },
  { file: 'cli/ui-bridge.ts', line: 5160, sink: 'writeFileSync',
    reason: 'EXCLUSIVE-CREATE: prompt.md write with flag `wx` (O_EXCL) — same exclusive-create discipline as the row above. (Line-drift remap from 3467 — W6-B2, cumulative +32. Further remap from 3499 — W6-B2 review fix, same +11 cause as the rows above.) (Merge remap from 3510 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 3512 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +62 lines; same function, same guard, unchanged.) (Line-drift remap to 3833 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 3846 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3845 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3850 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 3867 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 3924 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 3924 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 3983 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 3986 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 4013 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap to 4047 -- reconciling fix/w7-a3-loop-closure with parsoFish/main\'s independent, non-overlapping edits earlier in the file (net +19 lines by this point); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap from 4155 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 4633 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 4687 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 4687 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 4777 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 5174 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 5147 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:5162.)' },
  { file: 'cli/ui-bridge.ts', line: 5203, sink: 'mkdirSync',
    reason: 'EXCLUSIVE-CREATE: authoring — writeAuthoringSession, byte-for-byte the same shape as writeOnboardingSession\'s rows directly above: sessionId SAFE_ID_RE-gated a few lines above; mkdirSync(sessionDir) has NO recursive flag, so a pre-existing entry (incl. a symlink) is a hard EEXIST, never reused/followed. (Line-drift remap from 3504 — W6-B2, cumulative +32. Further remap from 3536 — W6-B2 review fix, same +11 cause as the rows above.) (Merge remap from 3547 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 3549 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +68 lines; same function, same guard, unchanged.) (Line-drift remap to 3876 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 3889 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3888 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3893 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 3910 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 3967 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 3967 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 4026 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 4029 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 4056 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap to 4090 -- reconciling fix/w7-a3-loop-closure with parsoFish/main\'s independent, non-overlapping edits earlier in the file (net +19 lines by this point); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap from 4198 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 4676 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 4730 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 4730 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 4820 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 5217 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 5190 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:5205.)' },
  { file: 'cli/ui-bridge.ts', line: 5204, sink: 'writeFileSync',
    reason: 'EXCLUSIVE-CREATE: authoring status.json write with flag `wx` (O_EXCL) — never follows an existing symlink; parent sessionDir just exclusively created (line 3547), sessionId SAFE_ID_RE-gated. (Line-drift remap from 3505 — W6-B2, cumulative +32. Further remap from 3537 — W6-B2 review fix, same +11 cause as the row above; the write itself also includes `prompt` in the JSON payload per the earlier R4-21 phase 2 WI-2 change, same sink, same guard.) (Merge remap from 3548 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 3550 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +68 lines; same function, same guard, unchanged.) (Line-drift remap to 3877 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 3890 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3889 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3894 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 3911 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 3968 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 3968 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 4027 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 4030 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 4057 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap to 4091 -- reconciling fix/w7-a3-loop-closure with parsoFish/main\'s independent, non-overlapping edits earlier in the file (net +19 lines by this point); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap from 4199 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 4677 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 4731 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 4731 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 4821 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 5218 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 5191 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:5206.)' },
  { file: 'cli/ui-bridge.ts', line: 5220, sink: 'writeFileSync',
    reason: 'EXCLUSIVE-CREATE: authoring prompt.md write with flag `wx` (O_EXCL) — same exclusive-create discipline as line 3548. (Line-drift remap from 3510 — W6-B2, cumulative +32. Further remap from 3542 — W6-B2 review fix, same +11 cause as the row above.) (Merge remap from 3553 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 3555 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +79 lines; same function, same guard, unchanged.) (Line-drift remap to 3893 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 3906 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3905 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 3910 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 3927 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 3984 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 3984 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 4043 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 4046 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 4073 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap to 4107 -- reconciling fix/w7-a3-loop-closure with parsoFish/main\'s independent, non-overlapping edits earlier in the file (net +19 lines by this point); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap from 4215 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 4693 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 4747 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 4747 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 4837 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 5234 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 5207 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:5222.)' },
  { file: 'cli/ui-bridge.ts', line: 5802, sink: 'mkdirSync',
    reason: 'MANUAL-CONTAIN: onboardingParent = join(realProjectDir, "_onboarding") where realProjectDir is realpathSync-resolved; this mkdir is immediately followed by realpathSync + startsWith(realProjectDir + sep) re-verification that refuses a symlinked _onboarding. (Line-drift remap from 4068 — W6-B2, cumulative +32. Further remap from 4100 — W6-B2 review fix, same +11 cause as the rows above; same function, same guard, unchanged — verified by sed -n "4111p" cli/ui-bridge.ts.) (Merge remap from 4111 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 4113 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +87 lines; same function, same guard, unchanged.) (Line-drift remap to 4459 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 4472 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 4471 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 4476 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 4493 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 4550 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 4550 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 4609 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 4612 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 4639 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap to 4673 -- reconciling fix/w7-a3-loop-closure with parsoFish/main\'s independent, non-overlapping edits earlier in the file (net +19 lines by this point); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap from 4787 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 5265 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 5319 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 5319 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 5409 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 5816 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 5789 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:5804.)' },
  { file: 'cli/ui-bridge.ts', line: 6008, sink: 'mkdirSync',
    reason: 'MANUAL-CONTAIN: authoringParent = join(realProjectDir, "_authoring") where realProjectDir is realpathSync-resolved — byte-for-byte the same shape as the onboardingParent row above: this mkdir is immediately followed by realpathSync + startsWith(realProjectDir + sep) re-verification a couple lines below that refuses a symlinked _authoring. (Line-drift remap from 4166 — W6-B2, cumulative +32. Further remap from 4198 — W6-B2 review fix, same +11 cause as the row above.) (Merge remap from 4209 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 4211 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +95 lines; same function, same guard, unchanged.) (Line-drift remap to 4565 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 4578 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 4577 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 4582 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Line-drift remap from 4582 -- merging feat/w6-b14-poll-demotions into parsoFish/main (W6-B14 added a new GET /api/studio/projects/:id/onboarding/active route, reattach discovery, earlier in the file), +70 lines; same function, same guard, unchanged -- verified by sed -n "4652p" cli/ui-bridge.ts against the merged tree.) (Merge remap to 4663 -- W6-B9 merging parsoFish/main post-B14 (B14 remapped this allowlist again); this branch\'s own earlier +11-line /api/instructions/brief byte-cap insertion still applies ahead of this point, so main\'s stated 4652 needed +11 -- re-verified via a direct runLint() run against the merged tree. (Line-drift remap to 4669 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 4726 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 4726 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 4785 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 4788 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 4815 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap to 4849 -- reconciling fix/w7-a3-loop-closure with parsoFish/main\'s independent, non-overlapping edits earlier in the file (net +19 lines by this point); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap from 4963 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 5465 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 5519 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 5519 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 5615 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 6022 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 5995 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:6010.)' },
  { file: 'cli/ui-bridge.ts', line: 6228, sink: 'existsSync',
    reason: 'BOOL-PROBE: existsSync(join(repoPath, ".forge","demo","demo.lock.json")) picks the create/update mode default; boolean-only, no bytes flow — and per this repo\'s standing rule ("guard the paths you WRITE, not the paths you merely probe") it deliberately stays a probe: a guarded read here would false-reject a legitimate project whose `.forge` is a symlink and silently flip its mode. RE-AUDITED (R4-19-F2 resync, not a rubber-stamped remap): `repoPath` is derived by the if/else at (current) lines 4485-4495. The `else` branch (`body.project`) is genuinely guard-derived — `repoPath = resolveGuardedPath(ctx.projectsRoot,[body.project]).realPath`, the guard\'s OWN resolved output, structurally tamper-proof. The `if` branch (`body.projectRepoPath`) is caller-supplied but NOT unguarded: `invalidProjectRepoPath(body.projectRepoPath, {forgeRoot, projectsRoot})` runs at line 4458, strictly before `repoPath` is ever assigned or read, and internally calls `isContainedProjectRepoPath` → `containedUnder` → `resolveGuardedPath` — the SAME real per-segment realpath identity walk the `else` branch uses, just validating the caller\'s string instead of returning a resolved replacement for it. That is the SAME "PROJECTROOT-GUARDED" pattern this file already accepts at cli/bridge-studio-writes.ts:854/919 (validate-the-string-then-reuse-the-ORIGINAL-string, not the guard\'s realPath) — not a weaker, ad-hoc trust. Residual, disclosed honestly: because the branch reuses the caller\'s original string rather than the guard\'s realPath, a symlink swapped between the line-4458 check and this line-4498 use would in principle reopen containment — but no `await` sits between them in this handler (`readJson` already ran at line 4451, before 4458; `resolveDemoSessionDir` at 4468 is synchronous), so there is no scheduling point for such a swap, and even a successful one only flips a boolean create/update default, never reads or writes bytes through the path. Verdict: an acceptable audited residual on the strength of the established PROJECTROOT-GUARDED precedent plus the boolean-only blast radius — not a fresh unguarded hole. (Line-drift remap from 4455 — W6-B2, cumulative +32. Further remap from 4487 — W6-B2 review fix, same +11 cause as the rows above; same function, same probe, byte-for-byte unchanged — verified by sed -n "4498p" cli/ui-bridge.ts.) (Merge remap from 4498 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 4500 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +113 lines; same function, same guard, unchanged.) (Line-drift remap to 4830 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 4843 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 4756 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 4839 -- reconciling feat/w6-b11-sessions-index with parsoFish/main (W6-CR-3 community-refresh: a new SPAWN_AGENT_SPECS entry + the POST /api/studio/community-refresh/start route, both recovered verbatim from the merge after a wholesale conflict-block resolution had dropped them); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Line-drift remap from 4839 -- merging feat/w6-b14-poll-demotions into parsoFish/main (W6-B14 added a new GET /api/studio/projects/:id/onboarding/active route, reattach discovery, earlier in the file), +70 lines; same function, same probe, unchanged -- verified by sed -n "4909p" cli/ui-bridge.ts against the merged tree.) (Merge remap to 4920 -- W6-B9 merging parsoFish/main post-B14 (B14 remapped this allowlist again); this branch\'s own earlier +11-line /api/instructions/brief byte-cap insertion still applies ahead of this point, so main\'s stated 4909 needed +11 -- re-verified via a direct runLint() run against the merged tree. (Line-drift remap to 4926 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Line-drift remap to 4983 -- W7-A3 loop closure (new enqueueFlowRun import +1 near the top of the import block; new POST /api/flows/:id/run route after the plan route, +47; per-session `initiativeIds` derivation inside GET /api/architect/sessions, +10 for rows past it), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap from 4983 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 5042 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 5045 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 5072 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap to 5106 -- reconciling fix/w7-a3-loop-closure with parsoFish/main\'s independent, non-overlapping edits earlier in the file (net +19 lines by this point); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap from 5226 -- reconciling feat/w7-b6-projects with parsoFish/main post-W7-B2/B3; same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 5761 -- reconciling feat/w7-b5-agents-runs with parsoFish/main through W7-B6 (#188). Same rule as this branchs earlier remaps: keep mains rows (they carry its own remaps for the other files) and re-derive every cli/ui-bridge.ts line against the merged tree -- each mapped through a unified diff from mains file with the source text confirmed byte-identical, then re-verified with a direct node scripts/check-raw-fs-guarded.mjs run.) (Merge remap to 5815 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 5815 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 5911 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 6361 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 6215 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:6230.)' },

  // ---- cli/bridge-studio-kb-drain.ts (W6-B12 — KB drain-to-green bridge job) ----  // New module (glob-picked up automatically — targetModules() includes every
  // non-test cli/bridge-studio*.ts). Four sinks, all in the two log-dir
  // read/write helpers `writeKbDrainStatus`/`readKbDrainStatus`, both of which
  // take a bare `runId` parameter — same curated taint-list name, same
  // TRUSTED-AT-CONSTRUCTION class as cli/bridge-studio-kbs.ts's
  // writeConsolidateTerminalEvent/readBrainFixState rows above: at every real
  // call site the value is either freshly minted by POST .../drain as
  // `${kbId}-drain-${Date.now().toString(36)}` (kbId already SLUG_RE-gated at
  // that same route before this is ever called), or read back via
  // isSafeRunId + an explicit `${kbId}-drain-` PREFIX check at the two GET
  // routes (never trusted on charset alone). `_kb-drain-<runId>` is a single
  // validated segment under trusted forgeRoot/_logs. Documented in
  // docs/reference/request-path-sinks.md's "Extended in W6-B12" section. The
  // OTHER raw sinks in this file (findKbDrainRuns' readdirSync/existsSync on
  // `logsRoot`, readBrainFixTurnCostUsd's existsSync/readFileSync on a
  // `subRunId` that is NEVER request-derived — always synthesized as
  // `${runId}__r${round}__${i}`) are not flagged at all: `logsRoot` is a
  // TRUSTED_ROOTS name, and `subRunId` is not a curated taint-list name.
  { file: 'packages/knowledge/kb-drain-store.ts', line: 62, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE (TRUSTED-AT-CONSTRUCTION): writeKbDrainStatus — same construction class as cli/bridge-studio-kbs.ts:180 (writeConsolidateTerminalEvent); runId is server-minted at POST /api/studio/kbs/:id/drain as `${kbId}-drain-${Date.now().toString(36)}` (kbId SLUG_RE-gated there first) or charset+prefix-checked at the two GET routes before this helper is ever reached. (Line-drift remap from 225 -- W7-B2 observable-drain engine (heartbeat + per-transition persist + cancel + structural gate additions above); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (M4 PR 5 split remap: bridge-studio-kb-drain.ts split three ways; the run-status writes, run discovery and cancel flag moved to kb-drain-store.ts. Same sink expression, byte-for-byte unchanged; re-paired by SINK KIND and ORDER from a real --json run, never by arithmetic. Residual total re-verified 92 = 92 pre-split after EXPLICIT_MODULES restored tier-1 scope to the heirs — from packages/knowledge/bridge-studio-kb-drain.ts:318.)' },
  { file: 'packages/knowledge/kb-drain-store.ts', line: 65, sink: 'writeFileSync',
    reason: 'LOGDIR-WRITE (TRUSTED-AT-CONSTRUCTION): writeKbDrainStatus\'s ATOMIC (temp+rename) status write — `tmpPath` is `` `${finalPath}.tmp` `` where `finalPath = join(logDir, "status.json")` and `logDir` carries the SAME runId trust chain as the mkdirSync row immediately above (same function, same call); the reviewer-requested atomicity fix (temp write + renameSync, mirroring cli/bridge-studio-runs.ts\'s manifest-move convention) only changed WHICH leaf name is written first, not the trust chain. (Line-drift remap from 228 -- W7-B2 observable-drain engine (heartbeat + per-transition persist + cancel + structural gate additions above); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (M4 PR 5 split remap: bridge-studio-kb-drain.ts split three ways; the run-status writes, run discovery and cancel flag moved to kb-drain-store.ts. Same sink expression, byte-for-byte unchanged; re-paired by SINK KIND and ORDER from a real --json run, never by arithmetic. Residual total re-verified 92 = 92 pre-split after EXPLICIT_MODULES restored tier-1 scope to the heirs — from packages/knowledge/bridge-studio-kb-drain.ts:321.)' },
  { file: 'packages/knowledge/kb-drain-store.ts', line: 76, sink: 'existsSync',
    reason: 'LOG-READ (TRUSTED-AT-CONSTRUCTION): readKbDrainStatus — mirrors cli/bridge-studio-kbs.ts:145 (readBrainFixState)\'s LOG-READ shape; runId is isSafeRunId + `${kbId}-drain-`-prefix gated at the GET routes before this is called (or server-minted at dispatch time); boolean existence probe. (Line-drift remap from 239 -- W7-B2 observable-drain engine (heartbeat + per-transition persist + cancel + structural gate additions above); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (M4 PR 5 split remap: bridge-studio-kb-drain.ts split three ways; the run-status writes, run discovery and cancel flag moved to kb-drain-store.ts. Same sink expression, byte-for-byte unchanged; re-paired by SINK KIND and ORDER from a real --json run, never by arithmetic. Residual total re-verified 92 = 92 pre-split after EXPLICIT_MODULES restored tier-1 scope to the heirs — from packages/knowledge/bridge-studio-kb-drain.ts:332.)' },
  { file: 'packages/knowledge/kb-drain-store.ts', line: 78, sink: 'readFileSync',
    reason: 'LOG-READ (TRUSTED-AT-CONSTRUCTION): readKbDrainStatus\'s status.json read — same runId trust chain as the existsSync row immediately above (same function, same call), same class as cli/bridge-studio-kbs.ts:147. (Line-drift remap from 241 -- W7-B2 observable-drain engine (heartbeat + per-transition persist + cancel + structural gate additions above); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (M4 PR 5 split remap: bridge-studio-kb-drain.ts split three ways; the run-status writes, run discovery and cancel flag moved to kb-drain-store.ts. Same sink expression, byte-for-byte unchanged; re-paired by SINK KIND and ORDER from a real --json run, never by arithmetic. Residual total re-verified 92 = 92 pre-split after EXPLICIT_MODULES restored tier-1 scope to the heirs — from packages/knowledge/bridge-studio-kb-drain.ts:334.)' },
  { file: 'packages/knowledge/kb-drain-store.ts', line: 154, sink: 'existsSync',
    reason: 'LOG-READ (SERVER-ENUMERATED, W7-B2 knowledge-20): readConsolidateRunRow — its runId comes ONLY from the GET /api/studio/kbs/:id/runs route\'s own readdirSync enumeration of `_logs` dir names (never a request parameter); `_brainfix-<runId>/events.jsonl` is a single enumerated segment under trusted forgeRoot/_logs; boolean existence probe in the same ternary as the read below. (Line-drift remap from 353 -- W7-B2 code-review round: readConsolidateRunRow now reads its terminal event through the shared cli/kb-job-state.ts helpers (parseKbRunEvents / terminalKbRunEvent / firstKbRunEventTs), net +1 lines earlier in the file; same function, same guard, same sink expression, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 354 -- W7-B2 code-review round: readConsolidateRunRow now reads its terminal event through the shared cli/kb-job-state.ts helpers (parseKbRunEvents / terminalKbRunEvent / firstKbRunEventTs), net +1 lines earlier in the file; same function, same guard, same sink expression, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (M4 PR 5 split remap: bridge-studio-kb-drain.ts split three ways; the run-status writes, run discovery and cancel flag moved to kb-drain-store.ts. Same sink expression, byte-for-byte unchanged; re-paired by SINK KIND and ORDER from a real --json run, never by arithmetic. Residual total re-verified 92 = 92 pre-split after EXPLICIT_MODULES restored tier-1 scope to the heirs — from packages/knowledge/bridge-studio-kb-drain.ts:410.)' },
  { file: 'packages/knowledge/kb-drain-store.ts', line: 155, sink: 'readFileSync',
    reason: 'LOG-READ (SERVER-ENUMERATED, W7-B2 knowledge-20): readConsolidateRunRow\'s events.jsonl read — same server-enumerated runId as the existsSync row immediately above (same expression), same class as cli/bridge-studio-kbs.ts:151 (readBrainFixState). (M4 PR 5 split remap: bridge-studio-kb-drain.ts split three ways; the run-status writes, run discovery and cancel flag moved to kb-drain-store.ts. Same sink expression, byte-for-byte unchanged; re-paired by SINK KIND and ORDER from a real --json run, never by arithmetic. Residual total re-verified 92 = 92 pre-split after EXPLICIT_MODULES restored tier-1 scope to the heirs — from packages/knowledge/bridge-studio-kb-drain.ts:411.)' },
  { file: 'packages/knowledge/kb-drain-store.ts', line: 281, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE (TRUSTED-AT-CONSTRUCTION, W7-B2 knowledge-14): requestKbDrainCancel — its runId comes ONLY from findActiveKbDrainRun\'s server-side readdirSync enumeration of `_kb-drain-*` dir names at the POST .../drain/cancel route (kbId itself KB_ID_RE-gated there first) or from the in-process drain loop\'s own server-minted runId; `_kb-drain-<runId>` single segment under trusted forgeRoot/_logs. (Line-drift remap from 492 -- W7-B2 code-review round: readConsolidateRunRow now reads its terminal event through the shared cli/kb-job-state.ts helpers (parseKbRunEvents / terminalKbRunEvent / firstKbRunEventTs), net -11 lines earlier in the file; same function, same guard, same sink expression, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (M4 PR 5 split remap: bridge-studio-kb-drain.ts split three ways; the run-status writes, run discovery and cancel flag moved to kb-drain-store.ts. Same sink expression, byte-for-byte unchanged; re-paired by SINK KIND and ORDER from a real --json run, never by arithmetic. Residual total re-verified 92 = 92 pre-split after EXPLICIT_MODULES restored tier-1 scope to the heirs — from packages/knowledge/bridge-studio-kb-drain.ts:537.)' },
  { file: 'packages/knowledge/kb-drain-store.ts', line: 282, sink: 'writeFileSync',
    reason: 'LOGDIR-WRITE (TRUSTED-AT-CONSTRUCTION, W7-B2 knowledge-14): requestKbDrainCancel\'s cancel.json flag write — same runId trust chain as the mkdirSync row immediately above (same function, same call). (Line-drift remap from 493 -- W7-B2 code-review round: readConsolidateRunRow now reads its terminal event through the shared cli/kb-job-state.ts helpers (parseKbRunEvents / terminalKbRunEvent / firstKbRunEventTs), net -11 lines earlier in the file; same function, same guard, same sink expression, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (M4 PR 5 split remap: bridge-studio-kb-drain.ts split three ways; the run-status writes, run discovery and cancel flag moved to kb-drain-store.ts. Same sink expression, byte-for-byte unchanged; re-paired by SINK KIND and ORDER from a real --json run, never by arithmetic. Residual total re-verified 92 = 92 pre-split after EXPLICIT_MODULES restored tier-1 scope to the heirs — from packages/knowledge/bridge-studio-kb-drain.ts:538.)' },
  { file: 'packages/knowledge/kb-drain-store.ts', line: 286, sink: 'existsSync',
    reason: 'LOG-READ (TRUSTED-AT-CONSTRUCTION, W7-B2 knowledge-14): isKbDrainCancelRequested — boolean probe of the cancel flag, called from the drain loop with its OWN server-minted runId (and from the cancel route with the enumerated one, per the :488 row); no bytes flow. (Line-drift remap from 497 -- W7-B2 code-review round: readConsolidateRunRow now reads its terminal event through the shared cli/kb-job-state.ts helpers (parseKbRunEvents / terminalKbRunEvent / firstKbRunEventTs), net -11 lines earlier in the file; same function, same guard, same sink expression, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (M4 PR 5 split remap: bridge-studio-kb-drain.ts split three ways; the run-status writes, run discovery and cancel flag moved to kb-drain-store.ts. Same sink expression, byte-for-byte unchanged; re-paired by SINK KIND and ORDER from a real --json run, never by arithmetic. Residual total re-verified 92 = 92 pre-split after EXPLICIT_MODULES restored tier-1 scope to the heirs — from packages/knowledge/bridge-studio-kb-drain.ts:542.)' },

  // ---- orchestrator/interactive-session.ts ----
  { file: 'packages/sessions/interactive-session.ts', line: 768, sink: 'existsSync',
    reason: 'RETAINED-RAW-PRIMITIVE: readSessionStatus(sessionDir) — a DESIGNATED_UNGUARDED_FUNCTION superseded by the leaf-guarded sibling guardedReadSessionStatus(projectsRoot, dirSegments). NO production route calls the raw primitive (every session route resolves projectsRoot+segments through resolveGuardedPath and uses the guarded sibling — see the in-file SEC-04 notes). Boolean probe on join(sessionDir, file); a future raw caller trips the sibling caller-count ratchet. (Further remap from 279 — W6-B1 review round 2 factored the shared makeThinkingSink/makeReasoningSink pair (+ the row-cap/coalescing fix) into this file earlier in the file, +160 lines; same function, same guard, byte-unchanged. Sink expression and enclosing function re-verified at the new line: readSessionStatus.) (Line-drift remap from 439 -- W6-CR-3 review round 2, the writeRoots canUseTool fence (bead forge-eip) inserted earlier in the file, +157 lines; same function, same guard, unchanged.) (Line-drift remap to 619 -- W7-A2 session lifecycle: new lifecycle/cancel imports + the LEGACY_SESSION_AWAITS/WORKING tables + CANCELLED_PHASE (cli/bridge-studio.ts), the fence-mode block in runAgentTurn (orchestrator/interactive-session.ts), and the cancel dispatch + turn.pid write + events 200-empty branch (cli/ui-bridge.ts) shifted later lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Line-drift remap to 686 -- W7-FIX-A2: the Bash-fence policy types (BashFenceMode/BashFenceOptions), FENCE_STRIPPED_TOOLS and the Bash branch in makeWriteRootCanUseTool, plus CANCELLED_PHASE/cancelledPhaseWins at the status-write seam, inserted earlier in the file, +67 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 686 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 706 — W8-B6 wired the hook-dispatch seam into this file\'s spawn options bag. RE-PAIRED BY SINK IDENTITY, NOT ARITHMETIC: the sink expression at the new line is byte-identical to the one at 706 in 1df6727e, and the enclosing function is unchanged (readSessionStatus); verified with `git show 1df6727e:<file> | sed -n \'706p\'` against `sed -n \'715p\' <file>`.) (Line-drift remap from 715 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (W8-F1 line-drift remap from 719 — no code change to this sink; the shift comes from the knowledge-42 counters in writeConsolidateTerminalEvent/readBrainFixState and the writeRootFenceOptions extraction above it. Remapped from a `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic (forge-mlk).)' },
  { file: 'packages/sessions/interactive-session.ts', line: 770, sink: 'readFileSync',
    reason: 'RETAINED-RAW-PRIMITIVE: readSessionStatus(sessionDir) — same as line 439; reads only after the existsSync probe, only from an already-guarded dir handed by the (now guarded-sibling-only) call path. Superseded primitive kept as the base + for tests. (Further remap from 281 — W6-B1 review round 2 factored the shared makeThinkingSink/makeReasoningSink pair (+ the row-cap/coalescing fix) into this file earlier in the file, +160 lines; same function, same guard, byte-unchanged. Sink expression and enclosing function re-verified at the new line: readSessionStatus.) (Line-drift remap from 441 -- W6-CR-3 review round 2, the writeRoots canUseTool fence (bead forge-eip) inserted earlier in the file, +157 lines; same function, same guard, unchanged.) (Line-drift remap to 621 -- W7-A2 session lifecycle: new lifecycle/cancel imports + the LEGACY_SESSION_AWAITS/WORKING tables + CANCELLED_PHASE (cli/bridge-studio.ts), the fence-mode block in runAgentTurn (orchestrator/interactive-session.ts), and the cancel dispatch + turn.pid write + events 200-empty branch (cli/ui-bridge.ts) shifted later lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Line-drift remap to 688 -- W7-FIX-A2: the Bash-fence policy types (BashFenceMode/BashFenceOptions), FENCE_STRIPPED_TOOLS and the Bash branch in makeWriteRootCanUseTool, plus CANCELLED_PHASE/cancelledPhaseWins at the status-write seam, inserted earlier in the file, +67 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 688 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 708 — W8-B6 wired the hook-dispatch seam into this file\'s spawn options bag. RE-PAIRED BY SINK IDENTITY, NOT ARITHMETIC: the sink expression at the new line is byte-identical to the one at 708 in 1df6727e, and the enclosing function is unchanged (readSessionStatus); verified with `git show 1df6727e:<file> | sed -n \'708p\'` against `sed -n \'717p\' <file>`.) (Line-drift remap from 717 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (W8-F1 line-drift remap from 721 — no code change to this sink; the shift comes from the knowledge-42 counters in writeConsolidateTerminalEvent/readBrainFixState and the writeRootFenceOptions extraction above it. Remapped from a `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic (forge-mlk).)' },
  { file: 'packages/sessions/interactive-session.ts', line: 787, sink: 'writeFileSync',
    reason: 'RETAINED-RAW-PRIMITIVE: writeSessionStatus(sessionDir) — a DESIGNATED_UNGUARDED_FUNCTION superseded by the leaf-guarded guardedWriteSessionStatus. NO production route writes through the raw primitive; a future reachable caller trips the sibling ratchet. (Further remap from 298 — W6-B1 review round 2 factored the shared makeThinkingSink/makeReasoningSink pair (+ the row-cap/coalescing fix) into this file earlier in the file, +160 lines; same function, same guard, byte-unchanged. Sink expression and enclosing function re-verified at the new line: writeSessionStatus.) (Line-drift remap from 458 -- W6-CR-3 review round 2, the writeRoots canUseTool fence (bead forge-eip) inserted earlier in the file, +157 lines; same function, same guard, unchanged.) (Line-drift remap to 638 -- W7-A2 session lifecycle: new lifecycle/cancel imports + the LEGACY_SESSION_AWAITS/WORKING tables + CANCELLED_PHASE (cli/bridge-studio.ts), the fence-mode block in runAgentTurn (orchestrator/interactive-session.ts), and the cancel dispatch + turn.pid write + events 200-empty branch (cli/ui-bridge.ts) shifted later lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Line-drift remap to 705 -- W7-FIX-A2: the Bash-fence policy types (BashFenceMode/BashFenceOptions), FENCE_STRIPPED_TOOLS and the Bash branch in makeWriteRootCanUseTool, plus CANCELLED_PHASE/cancelledPhaseWins at the status-write seam, inserted earlier in the file, +67 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 705 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 725 — W8-B6 wired the hook-dispatch seam into this file\'s spawn options bag. RE-PAIRED BY SINK IDENTITY, NOT ARITHMETIC: the sink expression at the new line is byte-identical to the one at 725 in 1df6727e, and the enclosing function is unchanged (writeSessionStatus); verified with `git show 1df6727e:<file> | sed -n \'725p\'` against `sed -n \'734p\' <file>`.) (Line-drift remap from 734 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (W8-F1 line-drift remap from 738 — no code change to this sink; the shift comes from the knowledge-42 counters in writeConsolidateTerminalEvent/readBrainFixState and the writeRootFenceOptions extraction above it. Remapped from a `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic (forge-mlk).)' },

  // ---- orchestrator/architect-runner.ts ----
  { file: 'packages/sessions/architect-runner.ts', line: 1498, sink: 'existsSync',
    reason: 'RETAINED-RAW-PRIMITIVE: readStatus(sessionDir) — superseded by the leaf-guarded sibling guardedReadStatus(projectsRoot, dirSegments). listArchitectSessions now routes the status.json LEAF through guardedReadStatus, so NO production caller hands a request-derived dir to the raw primitive (the remaining callers are architect-runner.test.ts constructing their own trusted tmp dirs). readStatus is a DESIGNATED_UNGUARDED_FUNCTION — a future reachable caller trips the sibling caller-count ratchet (check-request-path-sinks). Boolean probe on join(sessionDir, "status.json"). (Further remap from 1427 — W6-B1 review round 2 replaced this file\'s inline onText/onThinking closures with two calls to the shared makeReasoningSink/makeThinkingSink (interactive-session.ts), -30 lines earlier in the file; same function, same guard, byte-unchanged. Sink expression and enclosing function re-verified at the new line: readStatus.) (Line-drift remap from 1397 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +16 lines; same function, same guard, unchanged.) (Line-drift remap from 1413 — W7-FIX-A4 (W7A4-01) added the `title` threading comment + const inside buildManifest, +7 lines earlier in the file; same function, same guard, unchanged.) (Line-drift remap from 1420 — W7-FIX-A4 review round 1: the typeof-string guard on d.title + comment inside buildManifest, +3 lines earlier in the file; same function, same guard, unchanged — re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1461 — W7-C3 slugify deref-guard comments (knownSlugs set + buildManifest), +4 lines earlier in the file; same function, same guard, unchanged — re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1465 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 1466 — W8-B6 wired the hook-dispatch seam into this file\'s spawn options bag. RE-PAIRED BY SINK IDENTITY, NOT ARITHMETIC: the sink expression at the new line is byte-identical to the one at 1466 in 1df6727e, and the enclosing function is unchanged (readStatus); verified with `git show 1df6727e:<file> | sed -n \'1466p\'` against `sed -n \'1498p\' <file>`.)' },
  { file: 'packages/sessions/architect-runner.ts', line: 1500, sink: 'readFileSync',
    reason: 'RETAINED-RAW-PRIMITIVE: readStatus(sessionDir) — same as line 1397; reads status.json only after the existsSync probe, and only from test-supplied trusted dirs (production uses the leaf-guarded guardedReadStatus). Superseded primitive, kept as the base + for tests. (Further remap from 1429 — W6-B1 review round 2 replaced this file\'s inline onText/onThinking closures with two calls to the shared makeReasoningSink/makeThinkingSink (interactive-session.ts), -30 lines earlier in the file; same function, same guard, byte-unchanged. Sink expression and enclosing function re-verified at the new line: readStatus.) (Line-drift remap from 1399 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +16 lines; same function, same guard, unchanged.) (Line-drift remap from 1415 — W7-FIX-A4 (W7A4-01), same +7 cause as the row above; same function, same guard, unchanged.) (Line-drift remap from 1422 — W7-FIX-A4 review round 1: the typeof-string guard on d.title + comment inside buildManifest, +3 lines earlier in the file; same function, same guard, unchanged — re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1463 — W7-C3 slugify deref-guard comments, +4; same function, same guard, unchanged — re-verified via a direct lint run.) (Line-drift remap from 1467 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 1468 — W8-B6 wired the hook-dispatch seam into this file\'s spawn options bag. RE-PAIRED BY SINK IDENTITY, NOT ARITHMETIC: the sink expression at the new line is byte-identical to the one at 1468 in 1df6727e, and the enclosing function is unchanged (readStatus); verified with `git show 1df6727e:<file> | sed -n \'1468p\'` against `sed -n \'1500p\' <file>`.)' },
  { file: 'packages/sessions/architect-runner.ts', line: 1509, sink: 'writeFileSync',
    reason: 'RETAINED-RAW-PRIMITIVE: writeStatus(sessionDir) — superseded by the leaf-guarded guardedWriteStatus. NO production caller (the runner writes via writeArchitectStatus → guardedWriteStatus); only architect-runner.test.ts calls the raw primitive on its own trusted tmp dirs. A future reachable caller trips the sibling ratchet. (Further remap from 1438 — W6-B1 review round 2 replaced this file\'s inline onText/onThinking closures with two calls to the shared makeReasoningSink/makeThinkingSink (interactive-session.ts), -30 lines earlier in the file; same function, same guard, byte-unchanged. Sink expression and enclosing function re-verified at the new line: writeStatus.) (Line-drift remap from 1408 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +16 lines; same function, same guard, unchanged.) (Line-drift remap from 1424 — W7-FIX-A4 (W7A4-01), same +7 cause; same function, same guard, unchanged.) (Line-drift remap from 1431 — W7-FIX-A4 review round 1: the typeof-string guard on d.title + comment inside buildManifest, +3 lines earlier in the file; same function, same guard, unchanged — re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1472 — W7-C3 slugify deref-guard comments, +4; same function, same guard, unchanged — re-verified via a direct lint run.) (Line-drift remap from 1476 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 1477 — W8-B6 wired the hook-dispatch seam into this file\'s spawn options bag. RE-PAIRED BY SINK IDENTITY, NOT ARITHMETIC: the sink expression at the new line is byte-identical to the one at 1477 in 1df6727e, and the enclosing function is unchanged (writeStatus); verified with `git show 1df6727e:<file> | sed -n \'1477p\'` against `sed -n \'1509p\' <file>`.)' },
  { file: 'packages/sessions/architect-runner.ts', line: 1687, sink: 'existsSync',
    reason: 'LOG-READ: readArchitectSessionStats — `_architect-<sessionId>/events.jsonl` single segment under resolve(logsRoot) (trusted); sessionId is the architect session id (SAFE_ID_RE convention at creation); best-effort stats (returns null on any error). Boolean. (Further remap from 1616 — W6-B1 review round 2 replaced this file\'s inline onText/onThinking closures with two calls to the shared makeReasoningSink/makeThinkingSink (interactive-session.ts), -30 lines earlier in the file; same function, same guard, byte-unchanged. Sink expression and enclosing function re-verified at the new line: readArchitectSessionStats.) (Line-drift remap from 1586 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +16 lines; same function, same guard, unchanged.) (Line-drift remap from 1602 — W7-FIX-A4 (W7A4-01), same +7 cause; same function, same guard, unchanged.) (Line-drift remap from 1609 — W7-FIX-A4 review round 1: the typeof-string guard on d.title + comment inside buildManifest, +3 lines earlier in the file; same function, same guard, unchanged — re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1650 — W7-C3 slugify deref-guard comments, +4; same function, same guard, unchanged — re-verified via a direct lint run.) (Line-drift remap from 1654 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 1655 — W8-B6 wired the hook-dispatch seam into this file\'s spawn options bag. RE-PAIRED BY SINK IDENTITY, NOT ARITHMETIC: the sink expression at the new line is byte-identical to the one at 1655 in 1df6727e, and the enclosing function is unchanged (readArchitectSessionStats); verified with `git show 1df6727e:<file> | sed -n \'1655p\'` against `sed -n \'1687p\' <file>`.)' },
  { file: 'packages/sessions/architect-runner.ts', line: 1689, sink: 'readFileSync',
    reason: 'LOG-READ: as line 1586 — reads only the internal architect event log for cost/duration stats (symlink-blind residual disclosed in openConcerns). (Further remap from 1618 — W6-B1 review round 2 replaced this file\'s inline onText/onThinking closures with two calls to the shared makeReasoningSink/makeThinkingSink (interactive-session.ts), -30 lines earlier in the file; same function, same guard, byte-unchanged. Sink expression and enclosing function re-verified at the new line: readArchitectSessionStats.) (Line-drift remap from 1588 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +16 lines; same function, same guard, unchanged.) (Line-drift remap from 1604 — W7-FIX-A4 (W7A4-01), same +7 cause; same function, same guard, unchanged.) (Line-drift remap from 1611 — W7-FIX-A4 review round 1: the typeof-string guard on d.title + comment inside buildManifest, +3 lines earlier in the file; same function, same guard, unchanged — re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1652 — W7-C3 slugify deref-guard comments, +4; same function, same guard, unchanged — re-verified via a direct lint run.) (Line-drift remap from 1656 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 1657 — W8-B6 wired the hook-dispatch seam into this file\'s spawn options bag. RE-PAIRED BY SINK IDENTITY, NOT ARITHMETIC: the sink expression at the new line is byte-identical to the one at 1657 in 1df6727e, and the enclosing function is unchanged (readArchitectSessionStats); verified with `git show 1df6727e:<file> | sed -n \'1657p\'` against `sed -n \'1689p\' <file>`.)' },

  // =========================================================================
  // SEC-04 lint-completion — NEWLY-ENUMERATED sinks. Each row below is a sink
  // the COMPLETED lint now catches (url-derived taint + broadened dir-param +
  // project-config.ts in scope) that the prior lint MISSED. Two honest classes:
  //   • GUARD-NEXT — a real symlink-blind / raw-leaf READ (or its boolean pair)
  //     with no realpath containment; delete the row when the sink is guarded.
  //   • RETAIN — already contained by a mechanism the scanner cannot see (an
  //     id-charset gate + realpath choke-point, isSafeRunId, a boolean-only
  //     existence probe that MUST NOT be guarded lest it false-reject an
  //     idempotent skip, or a symlink-BLIND internal _logs event-log READ whose
  //     only containment is an id-charset/lexical-startsWith gate — the
  //     disclosed-_logs-symlink residual, disposed UNIFORMLY with the rest of
  //     the log-read family below, never a split treatment); sibling-consistent
  //     with the existing rows.
  //
  // SEC-04 residual #1 (loadProjectConfig, orchestrator/project-config.ts) is
  // now GUARDED (guardedReadFile(projectRoot, ['.forge','project.json'])) — its
  // former GUARD-NEXT rows are deleted (the sinks no longer exist), pinned by
  // cli/sec04-loadprojectconfig-containment.test.ts.
  // ---- RETAIN: symlink-blind internal _logs event-log reads (disclosed residual) ----
  // ---- GUARD-NEXT: route the FULL path (incl. leaf) through the guard ----
  // ---- RETAIN: contained by a mechanism the scanner can\'t see (confirm next stage) ----
  // ---- W8-C2a (forge-5kh): sites made VISIBLE by the mutating-sink families ----
  // Every row below audits a call that existed unchanged before this lane and
  // was invisible only because its sink name was not in RAW_FS_SINKS. Each one
  // is the SECOND HALF of a write whose FIRST half already carries an audited
  // row a few lines above it, so the trust chain is not newly asserted here —
  // it is the same chain, re-verified at the sibling line. None is a new hole;
  // none is a rubber stamp either: each names its sibling row explicitly so a
  // future reader can check the pair moves together.
  { file: 'packages/knowledge/kb-drain-store.ts', line: 66, sink: 'renameSync',
    reason: 'LOGDIR-WRITE, ATOMIC-RENAME HALF (TRUSTED-AT-CONSTRUCTION): writeKbDrainStatus\'s `renameSync(tmpPath, finalPath)` is the completing half of the temp+rename atomic write whose `writeFileSync(tmpPath, ...)` carries the audited row at line 265, one line above; BOTH arguments are derived from the SAME `logDir = kbDrainLogDir(forgeRoot, runId)` that the audited `mkdirSync` row at line 262 covers, and BOTH leaves are literals (`status.json` and that name + `.tmp`) — no request data reaches either leaf. `runId` is server-built as `${kbId}-drain-${Date.now().toString(36)}` with `kbId` KB_ID_RE-gated at the route strictly before the drain dispatches, or read back at the GET routes via `isSafeRunId` PLUS an explicit `${kbId}-drain-` prefix check (never charset alone) — the construction documented in this module\'s own kbDrainLogDir docstring and in docs/reference/request-path-sinks.md. Two findings land on this line because renameSync carries two path arguments (SINK_PATH_ARG_INDICES); this single row audits both, and both are the same value family. Rename does not widen the blast radius over the writeFileSync already accepted at 265: it moves a file the same call just created, within the same directory, to a literal sibling name. (M4 PR 5 split remap: bridge-studio-kb-drain.ts split three ways; the run-status writes, run discovery and cancel flag moved to kb-drain-store.ts. Same sink expression, byte-for-byte unchanged; re-paired by SINK KIND and ORDER from a real --json run, never by arithmetic. Residual total re-verified 92 = 92 pre-split after EXPLICIT_MODULES restored tier-1 scope to the heirs — from packages/knowledge/bridge-studio-kb-drain.ts:322.)' },
  { file: 'packages/knowledge/bridge-studio-kb-consolidate.ts', line: 59, sink: 'appendFileSync',
    reason: 'LOGDIR-APPEND (TRUSTED-AT-CONSTRUCTION): writeConsolidateTerminalEvent\'s `appendFileSync(join(logDir, \'events.jsonl\'), ...)` writes into the very directory whose `mkdirSync(logDir)` carries the audited row at line 184, eight lines above and in the SAME function — same `logDir = join(forgeRoot, \'_logs\', `_brainfix-${runId}`)`, same `runId` trust chain (server-built `${kbId}-consolidate-${Date.now().toString(36)}`, kbId SLUG_RE-gated at POST /api/studio/kbs/:id/maintenance strictly before consolidate dispatch). The appended LEAF is the string literal `events.jsonl`: no request-derived value reaches it, so this is not the SEC-04 leaf-append shape, it is the write the audited mkdir exists to make possible. Content is a server-serialized JSON event, never client bytes. (Line-drift remap from 192 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (W8-F1 line-drift remap from 206 — no code change to this sink; the shift comes from the knowledge-42 counters in writeConsolidateTerminalEvent/readBrainFixState and the writeRootFenceOptions extraction above it. Remapped from a `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic (forge-mlk).) (M1-D line-drift remap from 225 — no code change to this sink. cli/bridge-studio-kbs.ts lost the per-KB own-theme lens (the listOwnThemeFiles/ownThemeFindingsLens/unionFindings imports and the union doc block in buildKbHealth) when brain-lint\'s scan was widened to cover brain/projects/*/themes (ADR 035); cli/brain-lint.ts gained themeDirs/themeSubdir/isForgeTheme above findThemeBySlug. Every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 7 matching 1:1, never by arithmetic on the file.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from packages/knowledge/bridge-studio-kbs.ts:221.)' },
  { file: 'packages/knowledge/bridge-studio-kb-consolidate.ts', line: 86, sink: 'appendFileSync',
    reason: 'LOGDIR-APPEND (TRUSTED-AT-CONSTRUCTION): writeConsolidateErrorTerminalEvent — byte-for-byte the same shape as the row above for line 192, in the error-terminal sibling function, whose own `mkdirSync(logDir)` carries the audited row at line 212 seven lines above. Same logDir construction, same runId trust chain, same literal `events.jsonl` leaf, same server-serialized content. Both this call and the mkdir above it are wrapped in try/catch by design (a terminal event that never lands would otherwise leave the run reporting \'running\' forever) — the catch swallows an fs error, never a containment decision. (Line-drift remap from 219 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (W8-F1 line-drift remap from 233 — no code change to this sink; the shift comes from the knowledge-42 counters in writeConsolidateTerminalEvent/readBrainFixState and the writeRootFenceOptions extraction above it. Remapped from a `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic (forge-mlk).) (M1-D line-drift remap from 252 — no code change to this sink. cli/bridge-studio-kbs.ts lost the per-KB own-theme lens (the listOwnThemeFiles/ownThemeFindingsLens/unionFindings imports and the union doc block in buildKbHealth) when brain-lint\'s scan was widened to cover brain/projects/*/themes (ADR 035); cli/brain-lint.ts gained themeDirs/themeSubdir/isForgeTheme above findThemeBySlug. Every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 7 matching 1:1, never by arithmetic on the file.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from packages/knowledge/bridge-studio-kbs.ts:248.)' },
  { file: 'packages/flows/bridge-studio-runs.ts', line: 852, sink: 'renameSync',
    reason: 'QUEUE-WRITE, ATOMIC-RENAME HALF: the requeue route\'s `renameSync(tmpPath, toPath)` completes the temp+rename atomic manifest move whose `writeFileSync(tmpPath, ...)` carries the audited row at line 851, one line above. `toPath = join(queuePaths.pending, filename)` and `tmpPath = toPath + \'.tmp\'`, where `filename` is `${initiativeId}.md` and `initiativeId` is INIT_ID_RE-gated earlier in the route before any path construction — a single validated segment under the trusted, config-derived `queuePaths.pending`, exactly the basis the sibling row and the four QUEUE-PROBE rows above it already stand on. Two findings land here because renameSync carries two path arguments; this row audits both, and both are the same `toPath` value.' },
  { file: 'packages/knowledge/bridge-studio-kb-routes-lifecycle.ts', line: 227, sink: 'mkdirSync',
    reason: 'CREATE-LITERAL-SUBDIR: kbDir = kbGuard.realPath (resolveGuardedPath) and the route 409s if kbGuard.exists, so this runs only create-mode on a FRESH dir; the appended leaf `themes` is a literal — a just-created dir cannot host a pre-planted symlink. (Line-drift remap from 1157 — R4-19-F2 WI-2, same +69 cause as the row above.) (Further remap from 1226 — UI-H merged parsoFish/main c45e3892 into feat/ui-h-honesty; forge-2am had already moved the findings-scoping + per-check itemization helpers to cli/kb-lint-summary.ts. Sink expression and enclosing function re-verified at the new line: handleStudioKbRoutes create-mode literal `themes` subdir.) (Further remap from 1117 — W6-P2, same cause as the rows above, +1 line. Further remap from 1118 — W6-P2 round 2, same cause as the row above, +6 lines — verified by sed -n "1124p" cli/bridge-studio-kbs.ts.) (Merge remap: parsoFish/main P1+B1 merged into feat/w6-p2-kb-lint-memo, unchanged — same cause as the row above.) (Merge remap to 1245 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9 own cli/bridge-studio-kbs.ts remap composing with this branch own parsoFish/main merge, which independently touched earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Line-drift remap from 1245 -- W7-A4 (one id rule: KB_ID_RE gates + isReservedId on the create route + kb-sites enumeration in loadKbDescriptors), +6 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Line-drift remap from 1251 — W7-FIX-A4 (W7A4-04), same +21 cause as the DELETE row; same route, same guard, unchanged.) (Line-drift remap from 1272 -- W7-B2 (knowledge-05/22/24/29): kb-job-state import + active-job 409 wiring, create-route collision/seeding-anchor additions, guidance-queue listing and per-KB runs support added above; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1392 -- W7-B2 code-review round: approveKbCleanup\'s draft-write try/catch + failure surfacing and the approve-path consolidate\'s synchronous _brainfix log-dir stake-out added +37 lines earlier in the file; same function, same guard, same sink expression, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1429 -- W7 FIX-B-KB: themeDescription cache-bypass comment added +3 lines earlier in the file; same function, same guard, same sink expression, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap: W7-FIX-B-PROJ (fix/w7-bfix-projects) merged with parsoFish/main\'s W7-FIX-B-KB (#196); the two branches touched disjoint regions of cli/bridge-studio-kbs.ts, so main\'s already-remapped line carries through unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 1432 -- W7-C2 T1 review: cli/ui-bridge.ts\'s spawnAgentTurn now RETURNS a SpawnTurnOutcome instead of swallowing (A7) and the per-kind broadcast mapping was hoisted into one shared local (A12); cli/bridge-studio-kbs.ts\'s approveKbCleanup writes the finalized produce-pointer (P0-4). Same function, same guard/probe, byte-for-byte unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1443 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (W8-F1 line-drift remap from 1457 — no code change to this sink; the shift comes from the knowledge-42 counters in writeConsolidateTerminalEvent/readBrainFixState and the writeRootFenceOptions extraction above it. Remapped from a `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic (forge-mlk).) (M1-D line-drift remap from 1507 — no code change to this sink. cli/bridge-studio-kbs.ts lost the per-KB own-theme lens (the listOwnThemeFiles/ownThemeFindingsLens/unionFindings imports and the union doc block in buildKbHealth) when brain-lint\'s scan was widened to cover brain/projects/*/themes (ADR 035); cli/brain-lint.ts gained themeDirs/themeSubdir/isForgeTheme above findThemeBySlug. Every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 7 matching 1:1, never by arithmetic on the file.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from packages/knowledge/bridge-studio-kbs.ts:1484.) (PR 4b round 2: the project-brain session mint moved from the lifecycle route into bridge-studio-kbs.ts so the split keeps ONE sessions boundary row instead of two; same sink, same guard, re-paired from a real --json run — from packages/knowledge/bridge-studio-kb-routes-lifecycle.ts:255.)' },
  { file: 'packages/knowledge/bridge-studio-kb-routes-lifecycle.ts', line: 228, sink: 'mkdirSync',
    reason: 'CREATE-LITERAL-SUBDIR: as line 1226, literal `_raw` subdir under the freshly-created guarded kbDir. (Line-drift remap from 1158 — R4-19-F2 WI-2, same +69 cause as the row above.) (Further remap from 1227 — UI-H merged parsoFish/main c45e3892 into feat/ui-h-honesty; forge-2am had already moved the findings-scoping + per-check itemization helpers to cli/kb-lint-summary.ts. Sink expression and enclosing function re-verified at the new line: handleStudioKbRoutes create-mode literal `_raw` subdir.) (Further remap from 1118 — W6-P2, same cause as the rows above, +1 line. Further remap from 1119 — W6-P2 round 2, same cause as the row above, +6 lines — verified by sed -n "1125p" cli/bridge-studio-kbs.ts.) (Merge remap: parsoFish/main P1+B1 merged into feat/w6-p2-kb-lint-memo, unchanged — same cause as the row above.) (Merge remap to 1246 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9 own cli/bridge-studio-kbs.ts remap composing with this branch own parsoFish/main merge, which independently touched earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Line-drift remap from 1246 -- W7-A4 (one id rule: KB_ID_RE gates + isReservedId on the create route + kb-sites enumeration in loadKbDescriptors), +6 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Line-drift remap from 1252 — W7-FIX-A4 (W7A4-04), same +21 cause; same route, same guard, unchanged.) (Line-drift remap from 1273 -- W7-B2 (knowledge-05/22/24/29): kb-job-state import + active-job 409 wiring, create-route collision/seeding-anchor additions, guidance-queue listing and per-KB runs support added above; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1393 -- W7-B2 code-review round: approveKbCleanup\'s draft-write try/catch + failure surfacing and the approve-path consolidate\'s synchronous _brainfix log-dir stake-out added +37 lines earlier in the file; same function, same guard, same sink expression, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1430 -- W7 FIX-B-KB: themeDescription cache-bypass comment added +3 lines earlier in the file; same function, same guard, same sink expression, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap: W7-FIX-B-PROJ (fix/w7-bfix-projects) merged with parsoFish/main\'s W7-FIX-B-KB (#196); the two branches touched disjoint regions of cli/bridge-studio-kbs.ts, so main\'s already-remapped line carries through unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 1433 -- W7-C2 T1 review: cli/ui-bridge.ts\'s spawnAgentTurn now RETURNS a SpawnTurnOutcome instead of swallowing (A7) and the per-kind broadcast mapping was hoisted into one shared local (A12); cli/bridge-studio-kbs.ts\'s approveKbCleanup writes the finalized produce-pointer (P0-4). Same function, same guard/probe, byte-for-byte unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1444 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (W8-F1 line-drift remap from 1458 — no code change to this sink; the shift comes from the knowledge-42 counters in writeConsolidateTerminalEvent/readBrainFixState and the writeRootFenceOptions extraction above it. Remapped from a `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic (forge-mlk).) (M1-D line-drift remap from 1508 — no code change to this sink. cli/bridge-studio-kbs.ts lost the per-KB own-theme lens (the listOwnThemeFiles/ownThemeFindingsLens/unionFindings imports and the union doc block in buildKbHealth) when brain-lint\'s scan was widened to cover brain/projects/*/themes (ADR 035); cli/brain-lint.ts gained themeDirs/themeSubdir/isForgeTheme above findThemeBySlug. Every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 7 matching 1:1, never by arithmetic on the file.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from packages/knowledge/bridge-studio-kbs.ts:1485.) (PR 4b round 2: the project-brain session mint moved from the lifecycle route into bridge-studio-kbs.ts so the split keeps ONE sessions boundary row instead of two; same sink, same guard, re-paired from a real --json run — from packages/knowledge/bridge-studio-kb-routes-lifecycle.ts:256.)' },
  { file: 'cli/bridge-studio-writes.ts', line: 325, sink: 'existsSync',
    reason: 'RETAIN (boolean probe — MUST NOT guard): checkContractArtifactContainment(projectRoot, forgeRoot) — projectRoot isContainedProjectRepoPath-validated at the route (line 835, per the 854/919 rows) before this Phase-1 checker; existsSync(join(projectRoot, ".forge","project.json")) is a boolean gate that RUNS resolveGuardedPath when the file is ABSENT (no bytes flow). Guarding an idempotent existence probe would false-reject; newly visible only because projectRoot is now a dir-shaped param. (Merge remap from 148 -- reconciling feat/w7-b4-library-authoring with parsoFish/main post-W7-B6 (#188); same function, same guard/probe, unchanged -- re-verified against the merged tree via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Review-round remap from 150 -- W7-B4 review fixes in cli/bridge-studio-writes.ts (agent-DELETE kind-confusion guard, session-kinds fail-closed, flow-DELETE trigger/malformed guards, starter materialisation split into plan+apply); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Review-round remap from 152 -- W7-FIX-B-PROJ /code-review fixes (needsGitInit extraction + docstrings above this function grew the file, and the signature gained forgeRoot for the shared predicate), see the bridge-studio-writes block note; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap: W7-FIX-B-PROJ merged with parsoFish/main\'s W7-FIX-B-KB (#196), which never touched cli/bridge-studio-writes.ts; line 207 with the forgeRoot-carrying signature is UNCHANGED by the merge -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 310 -- forge-hoq: bridge-studio-writes.ts gained isStringArray (+8 lines, before line 209) and the allowedTools/disallowedTools body-read + 400-reject block in the agent PUT merge (+31 lines, before the old `const merged` at 1484), cumulative +8 for rows past both; same function, same guard/probe, source text unchanged -- every row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, never by arithmetic on the file.) (Line-drift remap from 318 -- W8-B5: the registry-import block in cli/bridge-studio-writes.ts grew from 1 line to 6 (+5 for every row past it) and parseRegistryItemBody / mutateCommunityRegistry / the registry PUT arm were reshaped for community-registry schema v2 (+18 more, cumulative +23 for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.) (Line-drift remap from 323 -- W8-B5 review FINDING 1: cli/bridge-studio-writes.ts gained the cli/community-registry-lock.ts import (+1 line, near the studio-path-guard import) and mutateCommunityRegistry was wrapped in the shared registry mutex plus a sendRegistryWriteFailure helper added beside it (+33 more for rows past them). Same function, same guard/probe, source text byte-for-byte unchanged (verified with `git show HEAD:cli/bridge-studio-writes.ts | sed -n "323p"` against `sed -n "324p"` on the current tree) -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs` run, never by arithmetic on the file.)' },
  // ---- GUARD-NEXT: route the FULL path (incl. leaf) through the guard ----
  { file: 'cli/bridge-studio.ts', line: 1693, sink: 'readFileSync',
    reason: 'GUARD-NEXT (SEC-04, caught by broadened dir-param): tryReadWorkItemDir(dir) reads readFileSync(join(dir, file)); its callers pass snapshotDir=join(logsRoot, cycleId, "work-items-snapshot") and liveDir=join(forgeRoot, "_worktrees", initId, ".forge","work-items") — the DIR is built from request-derived cycleId/initId by lexical join with NO realpath containment (the WI-*.md leaf is readdir-enumerated). Symlink-blind coverage gap (full route-reachability not traced this stage). NEXT: route the dir+leaf through guardedReadDir/guardedReadFile; delete when guarded. (Line-drift remap from 1236 — unrelated pre-existing gap, unchanged by R1-06; still open. Further remap from 1243 — forge-3oq, +11 lines cumulative; still open. Further remap from 1254 — forge-3oq review, +4 lines; still open. Further remap from 1258 — W6-B2 review fix, same +24 cause as the rows above; same tryReadWorkItemDir call, same open gap, unchanged.) (Merge remap from 1282 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Merge remap from 1287 - parsoFish/main P1/B1/P2 merged into feat/w6-rv1-initiative-detail: W6-RV-1s title-source work (mock finding I3 + its later perf-fix review round, net +33 over this branchs pre-merge base — the title-derivation helpers landed and the second matter() re-parse they briefly required was then removed) is additive with the unrelated main-side shift above; same tryReadWorkItemDir call, same open gap, unchanged - verified by sed -n "1320p" cli/bridge-studio.ts against the merged tree.) (Line-drift remap from 1320 — W6-CR-1, +5 lines cumulative: +1 from the new communitySkillsFromRegistry import near the top of the file, +4 from the /api/studio/catalog routes community-skills doc comment expanding as part of the catalog.communitySkills -> communitySkillsFromRegistry(ctx.forgeRoot) migration; same tryReadWorkItemDir call, same open gap, unchanged — verified by sed -n "1325p" cli/bridge-studio.ts.) (Merge remap: parsoFish/main W6-RV-2 (B-prime completion-time canvas — completedAtByInitiative helper + RoadmapInitiative.completedAt/RoadmapWorkItem doc comments) merged concurrently with W6-CR-1 both editing earlier parts of this file independently; the two branches\' line-drift remaps (+5 W6-CR-1, +34 W6-RV-2) compose rather than collide — same tryReadWorkItemDir call, same open gap, unchanged — re-verified by sed -n "1359p" cli/bridge-studio.ts against the merged tree.) (Line-drift remap to 1367 -- W7-A3 loop closure: findRun in cli/bridge-studio.ts gained an 8-line doc comment (initiativeId fallback, the stable run handle); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap from 1367 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Merge remap from 1410 -- W7-A4 (identity + not-found hygiene) merged with parsoFish/main (post-W7-A3); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 1398 -- W7-FIX-A3 loop-closure regressions (the phase-log route resolves the run through findRun before building eventsPath, +9 lines above); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 1407 -- W7-FIX-A3 round-2 finding 2: the GET /api/runs/<id> 404 branch now carries the guarded `_logs/<id>` existence probe (`onDisk`), +11 lines earlier in the file; same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Line-drift remap from 1418 -- W7-FIX-A3 round-2 findings 5+11 in cli/bridge-studio.ts: loadAllFlows stopped swallowing a thrown readdirSync into [] (+3 lines) and the phase-log route probes the literal `_logs/<runId>/events.jsonl` before falling back to findRun (+15 lines for rows past it). Same function, same sink expression, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 1438 -- reconciling fix/w7-a3-loop-closure (W7-FIX-A3 round-2 findings 5+11 above) with parsoFish/main\'s independent W7-FIX-A2 (W7A2-01) CANCELLED_PHASE relocation to the orchestrator status-write seam (+5 net lines earlier in the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 1446 -- reconciling with fix/w7-a4-identity\'s own W7-FIX-A4 review round 1 kb:null fix (+8 lines earlier in the file, independent edit region in loadProjectsWithMeta), applied on top of the above during the wave-A merge of parsoFish/main; same function, same guard, unchanged -- re-verified by `grep -n readPreflightFixState cli/bridge-studio.ts` and sed -n "527,536p" cli/bridge-studio.ts against the merged tree.) (Line-drift remap from 1459 -- W8-C2a: cli/bridge-studio.ts + cli/bridge-studio-kbs.ts routed the four forge-2zz residual-containment sites through resolveGuardedPath (+14 in kbs.ts above these rows), and orchestrator/interactive-session.ts gained the additive-optional disallowedTools parameter (forge-eip), shifting architect-runner.ts and interactive-session.ts rows below it. Same function, same sink expression, byte-for-byte unchanged -- every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 15 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 1500 -- W8-C3: cli/bridge-studio.ts gained the derived ProjectConfigHealth type + deriveConfigHealth + deriveProjectLocalSkills and their use inside loadProjectsWithMeta, all EARLIER in the file (+104 lines). Same function (tryReadWorkItemDir), same sink expression `readFileSync(join(dir, file))`, byte-for-byte unchanged -- it is the ONLY occurrence of that expression in the file at BOTH the old and new SHA (`git show d17b4251:cli/bridge-studio.ts | grep -n` returns exactly line 1500; the working tree returns exactly 1604), so the re-pairing is unambiguous and was made by matching the sink, never by arithmetic on the file.) (Line-drift remap from 1604 -- W8-C3 review round 1 (S1): deriveConfigHealth gained the sidecar pre-validation the orchestrator\'s own loadProjectConfig performs (readQualityGateSidecar + injectSidecarIntoTestProcess through the guard\'s verified realpath), plus the widened import block and the explanatory header, all EARLIER in the file (+50 lines). Same function (tryReadWorkItemDir), same sink expression `readFileSync(join(dir, file))`, byte-for-byte unchanged -- it remains the ONLY occurrence of that expression in the file at BOTH SHAs (`git show 6011294b:cli/bridge-studio.ts | grep -n` returns exactly 1604; the working tree returns exactly 1654), so the re-pairing is unambiguous and was made by matching the sink, never by arithmetic on the file.) (Line-drift remap from 1654 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.)' },
  // ---- RETAIN: contained by a mechanism the scanner can\'t see (confirm next stage) ----
  // W7-C3 line-drift remap (+12): the /api/artifact filename charset gate
  // (bd forge-0u4) added 12 lines at ~1943; every cli/ui-bridge.ts row below
  // shifts +12 — same functions, same guards, unchanged; re-verified via a
  // direct `node scripts/check-raw-fs-guarded.mjs` run.
  { file: 'cli/ui-bridge.ts', line: 3122, sink: 'mkdirSync',
    reason: 'RETAIN (isSafeRunId-gated logdir-create): runId = `_agent-${slug}-${newRunStamp()}` with slug URL-derived (newly tainted), but isSafeRunId(runId) (SAFE_RUN_ID_RE + explicit .. check) THROWS a few lines above BEFORE this recursive mkdir of the run\'s own log dir under trusted ctx.logsRoot — the SAME deliberate guard-symmetry check its already-allowlisted siblings at (now) 2107/2515 carry. (Line-drift remap from 1841 — W6-B2\'s ensureSessionTail helper + ctx call-site comment, cumulative +32. Further remap from 1873 — W6-B2 review fix\'s +1 import line, same cause as the cli/ui-bridge.ts rows above.) (Merge remap from 1874 - parsoFish/main B2 session-tails merged into feat/w6-p1-run-list-cache shifted earlier-file line counts; same function, same guard, unchanged - verified against the merged tree.) (Line-drift remap from 1876 -- the feat/w6-b5-model-seam merge with parsoFish/main (W6-B5 kickoff model-tier seam combined with mains own concurrent ui-bridge.ts/architect-runner.ts edits), +2 lines; same function, same guard, unchanged.) (Line-drift remap to 2130 -- W6-B11 (GET /api/studio/sessions aggregate sessions-index route + the isTerminalPhase panel-table widening it reuses), +240 lines; same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.) (Merge remap to 2143 -- reconciling feat/w6-b11-sessions-index (this branch own +240/+242 shift) with parsoFish/main (W6-CR-2/B10/B12/B13 cumulative, non-overlapping shifts to earlier parts of the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree.) (Merge remap to 2142 -- reconciling feat/w6-b11-sessions-index with parsoFish feat/w6-b8-migrate-cleanup-authoring fix-round commit d5dafa6f (W6-B9: deletes the dead /cleanup/apply route + its approveKbCleanup import, -1 line before that deletion point, and the route handler body itself further down the file); same function, same guard, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree. (Line-drift remap to 2148 -- W6-B6 fix (new GET /api/studio/agents/:slug/capability route: a new import line near the top of the import block, +1 line, plus a new dispatch-chain call + its comment block after the instructions-draft route, +5 lines; net +6 for this row), same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs --json` run.)) (Merge remap from 2149 -- W7-A3 (feat/w7-a3-loop-closure) merged with parsoFish/main; same function, same guard, unchanged -- verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 2199 -- W7-FIX-A3 loop-closure regressions (POST /api/scheduler/start clears .paused (+6), /stop marks the signalled pid (+5), and POST /api/flows/:id/run refuses a done/ initiative (+16) -- cumulative for rows past each edit); same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Line-drift remap from 2209 -- W7-FIX-A3 round-2 fixes in cli/ui-bridge.ts: the scheduler start/stop routes grew the fresh-spawn-only setPaused branch + the already-stopping short-circuit (+24 lines before this sink), and POST /api/flows/:id/run dropped its inlined done/ pre-check onto the allowFinishedSource option on enqueueFlowRun (-9 lines). Same function, same sink expression, unchanged -- re-verified via `node scripts/check-raw-fs-guarded.mjs --json`.) (Merge remap from 2235 -- reconciling feat/w7-b3-community (community-registry CRUD + skill-only/server-owned-signals review round in cli/bridge-studio-writes.ts; the community-refresh brief + W7-B3 routes in cli/ui-bridge.ts) with parsoFish/main post-W7-B1/B7; same function, same guard/probe, unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run against the merged tree.) (Line-drift remap from 2699 -- W7-C2 T1 review: cli/ui-bridge.ts\'s spawnAgentTurn now RETURNS a SpawnTurnOutcome instead of swallowing (A7) and the per-kind broadcast mapping was hoisted into one shared local (A12); cli/bridge-studio-kbs.ts\'s approveKbCleanup writes the finalized produce-pointer (P0-4). Same function, same guard/probe, byte-for-byte unchanged -- re-verified via a direct `node scripts/check-raw-fs-guarded.mjs` run.) (Merge remap to 2727 -- landing feat/w7-c3-polish onto parsoFish/main post-W7-C2 (#198): the C2 cli/ui-bridge.ts edits (spawnAgentTurn returning SpawnTurnOutcome, the hoisted per-kind broadcast mapping, the revise feedback gate) and the C3 /api/artifact isSafeSubPath filename gate shift earlier-file line counts independently. Every row re-derived from a direct `node scripts/check-raw-fs-guarded.mjs --json` run against the merged tree and matched to its finding by sink + path expression; same function, same guard, source text unchanged.) (Line-drift remap from 2727 -- W7-D1: cli/ui-bridge.ts gained the module-scope LEGACY_ROOT_ARTIFACT constant + its header after the imports (+8 lines) and the GET /api/artifact legacy cycle-log-root fallback inside the route (+18 more), so rows above the route moved +8 and rows below +26; same function, same sink expression, unchanged -- each row re-paired to its new line by sink kind and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 18 matching 1:1, never by arithmetic on the file.) (Line-drift remap from 2779 -- W8-A2 (ON-7): cli/ui-bridge.ts gained servedFileHeaders (7 served-file routes hardened), the four bespoke session-list routes wired to deriveSessionLifecycleFor, the sessionStaleMs helper, and the standalone-run stalled derivation; cli/agent-run.ts gained the turn-throw catch. Same function, same sink expression, byte-for-byte unchanged. Re-paired by SINK IDENTITY (file+sink+path-expression), not arithmetic: base-vs-current runLint with an EMPTY allowlist reports 70 residual sinks on BOTH sides, ZERO new and ZERO removed identities, so all 65 rows matched 1:1.) (Line-drift remap from 3113 -- W8-B5b: the community-refresh SESSION KIND was retired; cli/ui-bridge.ts lost its POST /api/studio/community-refresh/start route + spawn-spec entry and orchestrator/interactive-session.ts comments were rewritten, moving every row past them. Same function, same sink, source text unchanged -- re-paired by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run (21 findings vs 21 stale rows, 1:1, zero new and zero removed sink identities), never by arithmetic on the file.) (Line-drift remap from 3109 -- W8-F6 (bead forge-6gv.27), re-derived AFTER merging parsoFish/main dc731c0a (F3 #221, F5 #222, F1 #223): cli/session-readability.ts was added as an import leaf, the private parseGuardedEventsJsonl in cli/ui-bridge.ts moved into it and its four call sites re-imported, the sessions-index href routed through sessionShellHref, and handleStudioRoutes wired with the injected sessionIsReadable probe; cli/bridge-studio.ts gained StudioRunsContext + withReadableSessionPointers above these rows. Same function, same sink expression, byte-for-byte unchanged -- all 19 stale rows re-paired to the 19 reported findings by SINK IDENTITY (file + the exact source-line text of the enclosing statement, parsoFish/main vs the merged tree), verified 19 of 19 with ZERO mismatches, never by arithmetic on the file. The widened W8-F5 sweep (165 extra modules) reports NO finding in the new cli/session-readability.ts: its one readFileSync reads the realPath that resolveGuardedPath itself returned.) (M4 PR 4b line-drift/split remap: bridge-studio-kbs.ts split five ways and cli/ui-bridge.ts lost the handleStudioKbRoutes import + call (-2). Same sink expression, byte-for-byte unchanged; every row re-paired by SINK KIND and ORDER from a real node scripts/check-raw-fs-guarded.mjs --json run, 24 of 24 matching 1:1, never by arithmetic. Residual total re-verified 92 = 92 pre-split, after EXPLICIT_MODULES restored tier-1 scope to the split heirs — from cli/ui-bridge.ts:3124.)' },
  // ---- cli/bridge-recovery.ts (NEW IN SCOPE, W8-F5) ----
  // This whole file — four live bridge routes, two of them destructive
  // (`renameSync` into failed/, `rmSync` of verdict sidecars) — sat OUTSIDE the
  // SEC-04 dataflow lint for two waves because its basename is `bridge-recovery`,
  // not `bridge-studio`. Entry-derived scope brought it in; every sink below was
  // then AUDITED (not remapped, not inherited): the id-charset gate is
  // `INIT_ID_RE.test(id)` with an early 400 at cli/bridge-recovery.ts:182 (GET
  // inspect), :196 (POST abandon) and :212 (POST requeue) — BEFORE any path
  // construction — and the manifest-sourced paths are gated by
  // isContainedWorktreePath / isContainedProjectRepoPath (SEC-02, forge-d1f).
  // recoveryInspect/recoveryAbandon have NO other production caller (`grep -rn
  // "recoveryInspect\|recoveryAbandon" --include=*.ts` = this file + its test),
  // so the route-level gate is the complete entry enumeration. INIT_ID_RE
  // (`/^INIT-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$/`) blocks `/`
  // and `..` but is symlink-BLIND — the same disclosed residual the other
  // INIT_ID_RE rows in this list carry (migrate-to-guardedFile follow-up).
  { file: 'packages/flows/bridge-recovery.ts', line: 69, sink: 'existsSync',
    reason: 'ID-CHARSET GATE + BOOL-PROBE: locate() probes `join(<queue state dir>, `${initiativeId}.md`)` across the six trusted getPaths(ctx.queueRoot) dirs. `initiativeId` is INIT_ID_RE-gated at every route entry (:182/:196/:212, early 400) and is a single segment; the probe is boolean (no bytes flow through this path).' },
  { file: 'packages/flows/bridge-recovery.ts', line: 99, sink: 'readFileSync',
    reason: 'ID-CHARSET GATE: recoveryInspect reads `located.path`, which is locate()\'s own output — a trusted queue-state dir joined with the INIT_ID_RE-gated `<id>.md` leaf (:69), never a caller-supplied path. Same construction the allowlisted cli/bridge-studio-runs.ts INIT_ID_RE rows audit.' },
  { file: 'packages/flows/bridge-recovery.ts', line: 110, sink: 'existsSync',
    reason: 'MANIFEST-PATH-GUARD + BOOL-PROBE: `wt` is the manifest\'s worktree_path, and this existsSync sits INSIDE `if (wt && wtContained && existsSync(wt))` — `wtContained` is isContainedWorktreePath(wt, {forgeRoot, projectsRoot, initiativeId}) evaluated on the line above (SEC-02 forge-d1f). The scanner cannot see that predicate as a guard producer; the containment is real and short-circuits before the probe.' },
  { file: 'packages/flows/bridge-recovery.ts', line: 116, sinks: ['existsSync', 'readFileSync'],
    reason: 'MANIFEST-PATH-GUARD: `prPath = join(wt, ".forge", "pr-description.md")` — two LITERAL leaf segments under a `wt` already proven contained by isContainedWorktreePath in the enclosing branch condition (:108-109). The read only measures `.length` (prDraftChars); the guard is what stops the arbitrary-file-length oracle SEC-02 closed.' },
  { file: 'packages/flows/bridge-recovery.ts', line: 127, sink: 'readFileSync',
    reason: 'ID-CHARSET GATE: recoveryAbandon\'s manifest read of `located.path` — identical construction and identical gate to the :99 row (locate() output, INIT_ID_RE-gated leaf under a trusted queue dir).' },
  { file: 'packages/flows/bridge-recovery.ts', line: 142, sink: 'existsSync',
    reason: 'MANIFEST-PATH-GUARD + BOOL-PROBE: `projectRepoPath` is the manifest\'s project_repo_path; recoveryAbandon RETURNS EARLY at :137-139 unless isContainedProjectRepoPath(projectRepoPath, {forgeRoot, projectsRoot}) holds, so the probe is unreachable for an out-of-bounds path. Boolean only — it gates the git invocations below, which take the same proven path.' },
  { file: 'packages/flows/bridge-recovery.ts', line: 143, sink: 'existsSync',
    reason: 'MANIFEST-PATH-GUARD + BOOL-PROBE: `wt` — recoveryAbandon returns early at :133-135 unless isContainedWorktreePath holds (SEC-02 forge-d1f, "refuse the whole abandon rather than run git -C <wt> against an out-of-bounds path"). Boolean only.' },
  { file: 'packages/flows/bridge-recovery.ts', line: 152, sink: 'renameSync',
    reason: 'ID-CHARSET GATE (both path arguments): source `located.path` is locate()\'s INIT_ID_RE-gated output (see :99); destination `join(failedDir, `${initiativeId}.md`)` is the trusted getPaths(ctx.queueRoot).failed dir plus the same INIT_ID_RE-gated single segment. This is the queue state move the recovery route exists to perform; both endpoints stay inside queueRoot by charset.' },
  { file: 'packages/flows/bridge-recovery.ts', line: 157, sinks: ['existsSync', 'rmSync'],
    reason: 'ID-CHARSET GATE: `p = join(inFlight, `${initiativeId}${suffix}`)` where `suffix` iterates a LITERAL array ([".verdict-prompt.md", ".verdict-response.md"]) and `inFlight` is the trusted getPaths(ctx.queueRoot).inFlight. INIT_ID_RE-gated id, single segment, no recursion on the rm (`{force:true}` only) — a stale-sidecar cleanup, not a tree delete.' },

  // ---- orchestrator/flow-run-requests.ts (NEW IN SCOPE, W8-F5 sweep tier) ----
  { file: 'packages/flows/flow-run-requests.ts', line: 147, sink: 'writeFileSync',
    reason: 'GUARD ADDED IN THIS LANE, then audited: `target.ref` reaches the staged filename `flow-run-<ref>-<ts>.json`. UNGUARDED this escaped — measured at c0093918, `ref: "../../../../pwned"` wrote `<tmpdir>/pwned-<ts>.json`, outside the queue root entirely. W8-F5 added the FLOW_ID_RE gate (exported from orchestrator/enqueue-flow-run.ts, where the SAME value was already described as "a path-traversal guard on the flow ref") at the head of stageFlowRunRequest, throwing before mkdirSync; `ts` is an ISO timestamp with `[:.]` replaced. Residual: the leaf is charset-gated rather than guardedFile-produced, and the gate is symlink-blind — pinned red-first by orchestrator/flow-run-requests.test.ts ("stageFlowRunRequest REFUSES a target ref that is not a flow-id slug").' },

  // ---- orchestrator/mint-triggered-initiative.ts (NEW IN SCOPE, W8-F5 sweep tier) ----
  { file: 'packages/flows/mint-triggered-initiative.ts', line: 133, sink: 'existsSync',
    reason: 'GUARD ADDED IN THIS LANE + BOOL-PROBE: `projectRepoPath = join(resolveProjectsDir(forgeRoot, cfg), flow.project)`. The taint root is `req.target.ref`, which W8-F5 now FLOW_ID_RE-gates at the function head (early typed `{status:"error"}`) before it is folded into `studio/flows/<ref>/flow.yaml`; `flow.project` is then a field of that operator-authored, studio-lint-validated flow definition (config trust boundary), and the sink is a boolean existence probe whose false branch returns an error. Pinned by orchestrator/mint-triggered-initiative.test.ts ("mintTriggeredInitiative REFUSES a target ref that is not a flow-id slug").' },
  { file: 'packages/flows/mint-triggered-initiative.ts', line: 226, sink: 'mkdirSync',
    reason: 'SERVER-MINTED ID: `artDir = join(logsRoot, cycleId, "artifacts")` where `cycleId = readManifestCycleId(manifestPath) ?? initiativeId` — both are SERVER-minted (mintAndPersistManifestCycleId at :219; `initiativeId` is built at :167 from validated tokens only, `INIT-<date>-<idToken(origin)>-<idToken(flowId)>-<hms>`, and is INIT_ID_RE-valid by construction — this module\'s header states the posture: "the initiative id is generated from VALIDATED fields only (never payload free-text)"). No request string reaches this path; `logsRoot` is the trusted opts/forgeRoot-derived root.' },
  { file: 'packages/flows/mint-triggered-initiative.ts', line: 227, sink: 'writeFileSync',
    reason: 'SERVER-MINTED ID + LITERAL LEAF: `join(artDir, "trigger-payload.json")` — the literal artifact leaf under the same server-minted artDir audited on the line above. The PAYLOAD is untrusted webhook data, but it is written as DATA (JSON.stringify of the typed payload, read-as-data downstream); it never contributes a path segment.' },

  // ---- W8-F5 round 2: the sweep's restricted BARE id list (review response) ----
  // Widening SWEEP_MODEL.bareTaint to the six never-server-enumerated names
  // closed the delegate-helper shape an adversarial review demonstrated (a route
  // passing `sessionId` to a helper by plain parameter). It surfaced exactly
  // three more sinks tree-wide; both files were read and audited here.
  { file: 'packages/knowledge/brain-lint-theme-paths.ts', line: 129, sink: 'existsSync',
    reason: 'BOOL-PROBE + REPO-CONTENT id: findThemeBySlug builds `join(brainRoot, sub, "themes", `${slug}.md`)` over the two literal THEME_SUBDIRS under the trusted brainRoot. `slug` is a WIKILINK parsed out of a brain markdown file (cli/brain-lint.ts:520 `for (const slug of wikilinks)`) — repo content at the operator/agent trust boundary, never an HTTP value; this module is a CLI lint (`node cli/brain-lint.ts`) and holds no route. The sink is boolean-only (the result decides a lint finding; no bytes are read through the path), so the residual is a link like `[[../../x]]` learning whether a path exists — disclosed, not hidden, and bounded by the fact that whoever authored the wikilink already had repo write access. (M1-D line-drift remap from 225 — no code change to this sink. cli/bridge-studio-kbs.ts lost the per-KB own-theme lens (the listOwnThemeFiles/ownThemeFindingsLens/unionFindings imports and the union doc block in buildKbHealth) when brain-lint\'s scan was widened to cover brain/projects/*/themes (ADR 035); cli/brain-lint.ts gained themeDirs/themeSubdir/isForgeTheme above findThemeBySlug. Every row re-paired to its new line by SINK KIND and ORDER from a real `node scripts/check-raw-fs-guarded.mjs --json` run, all 7 matching 1:1, never by arithmetic on the file.) (M1-D line-drift remap from 318 — no code change to this sink; findThemeBySlug and its `existsSync(candidate)` are byte-identical. The shift is the three lines removed above it when checkContradictions was cut (its header-comment entry, its FULL_SCOPE_CHECKS row and its CHECK_SCOPE row). Re-paired from a real `node scripts/check-raw-fs-guarded.mjs` run and verified with `sed -n 315p cli/brain-lint.ts`, never by arithmetic.) (M4 split remap from brain-lint.ts:315 — `findThemeBySlug` and its `existsSync(candidate)` moved BYTE-IDENTICAL into brain-lint-theme-paths.ts when brain-lint.ts was split under the 800-line cap. Same function, same sink expression, same trust argument; re-paired from a real `node scripts/check-raw-fs-guarded.mjs` run and verified with `sed -n 129p`, never by arithmetic.)' },
  { file: 'packages/knowledge/project-brain-seed.ts', line: 240, sink: 'mkdirSync',
    reason: 'TRUSTED-AT-CONSTRUCTION (the module says so at the sink): checkProjectBrainSeedContainment materialises `brainProjectsRoot`, a forgeRoot-derived directory with NO request-derived segment — the in-file comment directly above states it, and `resolveGuardedPath` (used two lines below for every real target) requires its root to exist. The taint the scan sees is `projectId` reaching brainSeedTargets(), whose per-target segments ARE guarded on the very next lines; the root itself carries none of it.' },
  { file: 'packages/knowledge/project-brain-seed.ts', line: 243, sink: 'existsSync',
    reason: 'BOOL-PROBE IMMEDIATELY BEFORE THE GUARD: `if (existsSync(target.absPath)) continue` is the idempotent skip in the SAME loop whose next statement is `resolveGuardedPath(brainProjectsRoot, target.segments)` with a hard throw on failure — this is the containment checker itself. The probe reads no bytes and creates nothing; every path that proceeds past it is guard-verified per segment.' },

];

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
  'packages/agents/agent-run.ts',
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

/**
 * COUNT-AWARE, SITE-PINNED audited residuals -- public-repo-safe, defensive
 * facts only. A row pins the audited fold EXPRESSION (`site`, whitespace-
 * normalized as the scan sees it) in a file, plus the `count` of occurrences of
 * that expression the audit covered. A finding is suppressed only when its own
 * normalized expression EQUALS an audited `site` in the same file, and only up
 * to that row's budget; everything else is kept and fails the build.
 *
 * WHY AN EXPRESSION AND NOT A LOCATION. Two earlier cuts of this rule keyed the
 * audit positionally and both leaked in the same direction. A pure (file,
 * folded-token) key with a count let ANY future fold reusing that token be
 * absorbed. Adding the audited LINE as a nearest-wins attribution anchor fixed
 * the common insert-above case but not the class: with occurrences still within
 * budget the anchor was never consulted at all, so deleting the audited fold and
 * introducing a DIFFERENT one that happened to capture the same token elsewhere
 * in the file passed silently -- the ratchet reporting audit coverage for a line
 * nobody had looked at. Line numbers cannot express "this is the thing I
 * audited"; the source text can, and it is also what survives drift, which was
 * the original reason the rows were not line-keyed.
 *
 * WHAT THIS STILL DOES NOT DISTINGUISH (disclosed, not hidden): a row audits an
 * EXPRESSION, not a scope. An identical fold expression appearing elsewhere in
 * the SAME file is covered by the same row (bounded by `count`), even though the
 * reason prose names the function the audit read. Moving an audited fold into a
 * different function therefore needs the row's reason re-read by a human; the
 * ratchet cannot see function boundaries. `count` must equal the MEASURED number
 * of occurrences, or the row goes stale (reported non-fatally, same as the
 * line-keyed allowlist's stale handling) -- the real tree must report zero stale
 * fold rows.
 */
export const PROJECTS_ROOT_FOLD_ALLOWLIST = [
  {
    file: 'apps/forge/cli.ts',
    folded: 'target',
    site: "resolve('projects', target)",
    count: 1,
    reason:
      "resolvePreflightProjectDir dual-mode name-or-path resolver — target is a project NAME or an explicit path, both existsSync-checked; out of the folded-untrusted-name class. Measured: exactly one occurrence in the real tree, orchestrator/cli.ts:791 (`const asManaged = resolve('projects', target);`), inside resolvePreflightProjectDir.",
  },
  {
    file: 'packages/flows/scheduler.ts',
    folded: 'm.project',
    site: "resolve('projects', m.project)",
    count: 1,
    reason:
      "scheduler manifest fallback (m.project_repo_path || resolve(projects,m.project)); the resulting repo path is contained at the write choke point by isContainedProjectRepoPath (cli/manifest-path-guard.ts). Measured: exactly one occurrence in the real tree, orchestrator/scheduler.ts:897 (`projectRepoPath: m.project_repo_path || resolve('projects', m.project),`).",
  },
  {
    file: 'packages/agents/agent-run.ts',
    folded: 'name',
    site: 'join(projectsDir, name)',
    count: 1,
    reason:
      "findSessionProject readdir loop — name is a readdirSync(projectsDir)-enumerated real in-tree directory name, not caller-supplied; join builds a candidate to probe. Measured: exactly one occurrence in the real tree, cli/agent-run.ts:708 (`const candidate = join(projectsDir, name);`), inside findSessionProject's readdir loop.",
  },
];

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
    console.error('  2. Or added to the ALLOWLIST in scripts/check-raw-fs-guarded.mjs (file+line+reason) if it is an audited-trusted residual.');
    return 1;
  }
  console.log(`check-raw-fs-guarded: PASS — ${r.scanned} request-handling module(s) scanned (full model) + ${r.swept} swept for the unambiguous request shapes, ${r.suppressed.length} allowlisted residual(s), 0 unguarded request-derived raw fs sinks`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main());
