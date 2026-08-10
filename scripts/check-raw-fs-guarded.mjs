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
 * request-handling module (MODULES below), for every call to one of six raw fs
 * sinks —
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
 * ALREADY covered by the sibling ratchet's caller-count dimension
 * (DESIGNATED_UNGUARDED_FUNCTIONS). The two scripts are complementary: the
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
 *
 * Treat a green run as "no request-derived raw fs path escaped the guard among
 * the sinks and shapes this scan can see", never as a containment proof.
 *
 * Usage:
 *   node scripts/check-raw-fs-guarded.mjs            # check, exit 1 on findings
 *   node scripts/check-raw-fs-guarded.mjs --json     # machine-readable findings
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The six raw fs sinks whose FIRST argument is a filesystem path. */
export const RAW_FS_SINKS = ['readFileSync', 'writeFileSync', 'readdirSync', 'existsSync', 'statSync', 'mkdirSync'];

/** Guard producers — a binding assigned from any of these (or a `.realPath`
 *  member) sanitizes the path for its OWN value (guard-terminal). See the
 *  header's (G) clause; a leaf raw-appended BELOW such a value is NOT covered. */
export const GUARD_PRODUCERS = [
  'guardedFile',
  'resolveGuardedPath',
  'guardedReadFile',
  'guardedWriteFile',
  'guardedReadDir',
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

/** Request-handling modules in scope. The explicit singletons plus every
 *  non-test cli/bridge-studio*.ts (the `cli/bridge-studio*.ts` glob in the
 *  charter). Computed against `root` so a fixture tree supplies its own. */
export function targetModules(root = FORGE_ROOT) {
  const explicit = [
    'cli/ui-bridge.ts',
    'cli/metrics.ts',
    'cli/contract-stages.ts',
    'cli/agent-run.ts',
    'cli/architect-plan.ts',
    'orchestrator/interactive-session.ts',
    // R4-22 WI-2: the FINALIZERS registry's sole row today,
    // copyStagingToLibrary — session-derived staging paths + a
    // request-derived packageId both reach fs writes; same class as the
    // legacy interactive runners above.
    'orchestrator/interactive-finalizers.ts',
    // R4-22 WI-3 (ADR-043 §2): the generic interactive-turn spine. It cannot
    // be reached by check-request-path-sinks.mjs's reachability walker (that
    // script follows relative imports from the bridge entry points; the
    // cli/agent-run.ts -> runInteractiveTurn dispatch crosses a process-spawn
    // boundary, so this module is structurally outside that walk) — this
    // manual list is therefore the ONLY mechanism that lints it. Same class
    // as the four legacy runners above: session-derived (kindDir, sessionId)
    // and finalizer-bound (packageId) paths reach fs sinks.
    'orchestrator/interactive-runner.ts',
    'orchestrator/architect-runner.ts',
    'orchestrator/instructions-runner.ts',
    'orchestrator/project-brain-builder-runner.ts',
    'orchestrator/demo-builder-runner.ts',
    // Not a request handler itself — the shared config-loader HELPER that
    // multiple request routes DELEGATE their `.forge/project.json` read to
    // (bridge-studio-runs verdict send-back -> loadProjectConfig(projectRepoPath),
    // contract-stages, preflight). It is the interprocedural leaf-append SITE for
    // blind-spot #b: `join(projectRoot, '.forge', 'project.json')` on an
    // unresolved param, invisible unless the helper's own body is scanned.
    'orchestrator/project-config.ts',
    // SEC-05 q80 (FORWARD DEFENSE): the skill-package install + vendored-read
    // helpers the /api/studio/skills/install and community-install/index routes
    // DELEGATE their per-entry filesystem walk to. Not request handlers
    // themselves — the request-derived `id` and package entry paths flow into
    // these bodies, so the guarded-sink scan must cover them going forward.
    // (This scope-add is standing forward coverage; it does NOT catch the q80
    // install defect — the per-entry-containment unit pins do.)
    'orchestrator/studio/skill-library.ts',
    'orchestrator/studio/community-install.ts',
    'orchestrator/studio/community-index.ts',
  ];
  const cliDir = join(root, 'cli');
  const glob = [];
  if (existsSync(cliDir)) {
    for (const f of readdirSync(cliDir)) {
      if (f.startsWith('bridge-studio') && f.endsWith('.ts') && !f.endsWith('.test.ts')) glob.push(`cli/${f}`);
    }
  }
  const all = new Set([...explicit, ...glob]);
  return [...all].filter((m) => existsSync(join(root, m))).sort();
}

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
function firstArg(cleaned, open) {
  let depth = 0;
  let i = open;
  const n = cleaned.length;
  const start = i;
  for (; i < n; i++) {
    const c = cleaned[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break; // closing ) of the sink call
      depth -= 1;
    } else if (c === ',' && depth === 0) break; // end of first argument
  }
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
function identIsTainted(full, head, line, cleanedLines, depth = 0) {
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
      if (identIsTainted(id.full, id.head, line, cleanedLines, depth + 1)) return true;
    }
    return false;
  }
  return REQUEST_TAINT_BARE.has(full) || REQUEST_TAINT_BARE.has(head);
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
function dirParamLeafAppend(expr, line, cleanedLines, depth = 0) {
  if (depth > 6) return null;
  const e = expr.trim();
  // inline join/resolve whose FIRST arg is a bare ident + at least one more segment
  const m = /^(?:join|resolve)\(\s*([A-Za-z_$][\w$]*)\s*,/.exec(e);
  if (m) {
    const base = m[1];
    if (DIR_PARAM_NAMES.has(base) && !TRUSTED_ROOTS.has(base) && findBinding(cleanedLines, base, line) === null) {
      return base;
    }
    return null;
  }
  // sink opens a bare ident — follow ONE binding to a join/resolve (via-const shape)
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const binding = findBinding(cleanedLines, e, line);
    if (binding) return dirParamLeafAppend(binding.rhs, line, cleanedLines, depth + 1);
  }
  return null;
}

/** Analyze one module's text; return findings [{ file, line, sink, path, why }]. */
export function analyzeModule(text, relFile) {
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
    const path = firstArg(cleaned, openIdx);
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
      if (!taintTok && identIsTainted(id.full, id.head, lineIdx, cleanedLines)) taintTok = id.full;
    }
    // (3) DIR-PARAM LEAF-APPEND — the interprocedural shape: a leaf appended onto
    // an unresolved dir-shaped param (the caller laundered the request id into
    // the dir). Fires only when guardBase/taintTok did not already catch it.
    const dirParamBase = !guardBase && !taintTok ? dirParamLeafAppend(path, lineIdx, cleanedLines) : null;
    if (!guardBase && !taintTok && !dirParamBase) continue; // request-independent → safe
    const kind = guardBase ? 'leaf-append' : taintTok ? 'tainted' : 'dir-param-leaf-append';
    const why = guardBase
      ? `leaf-append below guarded value "${guardBase}" — the appended leaf is NOT guarded (route the FULL path incl. leaf through guardedFile)`
      : taintTok
        ? `request/project-derived path via "${taintTok}" reaches raw ${sink} unguarded`
        : `leaf-append onto unresolved dir-shaped param "${dirParamBase}" — the caller's dir may be contained but the appended leaf rides raw (route the FULL path incl. leaf through guardedFile / the guarded sibling)`;
    findings.push({ file: relFile, line: lineIdx + 1, sink, path: path.replace(/\s+/g, ' ').slice(0, 120), kind, why });
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
export const ALLOWLIST = [
  // ---- cli/agent-run.ts — CLI subcommand handler (non-HTTP) ----
  { file: 'cli/agent-run.ts', line: 674, sink: 'existsSync',
    reason: 'CLI-ARG + BOOL-PROBE: findSessionProject(sessionId) — sessionId is a `forge <verb>` CLI argument (operator trust boundary), NOT an HTTP request; both existsSync calls are boolean status.json/PLAN.md probes under readdir-enumerated projects/*, no bytes read/written through the path. (Line-drift remap from 551 — R4-22 WI-5 inserted the ADR-043 dispatch fork + its two helpers earlier in the file, then its post-review --project segment-guard added 20 more lines; all purely additive. Same function, same guard, byte-for-byte unchanged — verified by diffing main:cli/agent-run.ts@549-553 against the current @672-676.)' },

  // ---- cli/bridge-studio-kbs.ts ----
  { file: 'cli/bridge-studio-kbs.ts', line: 224, sink: 'existsSync',
    reason: 'LOG-READ: readBrainFixState — runId is SAFE_ID_RE-gated at the GET route (line 1271) before this helper; `_brainfix-<runId>/events.jsonl` is a single validated segment under trusted forgeRoot/_logs; boolean existence probe. (Line-drift remap from 223 — R6-08 WI-1 inserted code earlier in the file; same function, same guard, unchanged.)' },
  { file: 'cli/bridge-studio-kbs.ts', line: 226, sink: 'readFileSync',
    reason: 'LOG-READ: same as line 224 — reads only the internal brain-fix event log; SAFE_ID_RE (route 1271) blocks / and .. (symlink-blind residual disclosed in openConcerns). (Line-drift remap from 225.)' },
  { file: 'cli/bridge-studio-kbs.ts', line: 259, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE (R1-06 WI-3, TRUSTED-AT-CONSTRUCTION): writeConsolidateTerminalEvent — the bare `runId` PARAM matches the taint-list name, but at its ONLY call site (line 549, inside runBrainConsolidateNow) the actual value is server-built as `${kbId}-consolidate-${Date.now().toString(36)}`, where kbId is SLUG_RE-gated at the POST /api/studio/kbs/:id/maintenance route (line 1322) strictly before consolidate dispatch (line 1423); `_brainfix-<runId>` is a single segment under trusted forgeRoot/_logs. Same construction class as the already-allowlisted fix-agent runId (`${kbId}-${Date.now().toString(36)}`, spawnBrainFix\'s own logDir mkdirSync a few lines above) — this scan does not also flag that one only because it reaches its sink via `p.runId`, a member expression outside the curated bare-name list, not because the value differs. (Line-drift remap from 258 — R6-08 WI-1 inserted code earlier in the file.)' },
  { file: 'cli/bridge-studio-kbs.ts', line: 287, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE (R1-06 WI-3, TRUSTED-AT-CONSTRUCTION): writeConsolidateErrorTerminalEvent — same runId construction and same trust chain as line 259 (writeConsolidateTerminalEvent); this is the crash-path terminal-event sibling, called from the same runBrainConsolidateNow with the identical `runId` binding. (Line-drift remap from 286.)' },

  // ---- cli/bridge-studio-runs.ts ----
  { file: 'cli/bridge-studio-runs.ts', line: 120, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE: _spawnArchitectTurn — sessionId is SAFE_ID_RE-gated at line 116 (early return); `_architect-<sessionId>` single segment under trusted forgeRoot/_logs.' },
  { file: 'cli/bridge-studio-runs.ts', line: 181, sink: 'existsSync',
    reason: 'QUEUE-PROBE: initiativeId is INIT_ID_RE-gated at line 162 BEFORE any path construction (C1); both probes are boolean under trusted ctx.queueRoot.' },
  { file: 'cli/bridge-studio-runs.ts', line: 188, sink: 'existsSync',
    reason: 'QUEUE-PROBE: manifestPath ternary — INIT_ID_RE-validated (line 162) `<id>.md` under trusted queueRoot; boolean.' },
  { file: 'cli/bridge-studio-runs.ts', line: 191, sink: 'readFileSync',
    reason: 'QUEUE-READ: reads a manifest at join(queueRoot, {in-flight|ready-for-review}, <INIT_ID_RE id>.md) — validated single segment under trusted queueRoot.' },
  { file: 'cli/bridge-studio-runs.ts', line: 215, sink: 'existsSync',
    reason: 'WORKTREE-GUARDED: approveWorktreePath is validated by isContainedWorktreePath (per-segment realpath containment, manifest-path-guard) at line ~208, strictly BEFORE this existence probe (SEC-02 round-5 ordering).' },
  { file: 'cli/bridge-studio-runs.ts', line: 366, sink: 'readFileSync',
    reason: 'QUEUE-READ: send-back manifest read at the same INIT_ID_RE-validated `<id>.md` under trusted queueRoot as line 191.' },
  { file: 'cli/bridge-studio-runs.ts', line: 406, sink: 'existsSync',
    reason: 'WORKTREE-GUARDED: worktreePath validated by isContainedWorktreePath at line ~390 before this probe (guard symmetry with the approve branch).' },
  { file: 'cli/bridge-studio-runs.ts', line: 427, sink: 'existsSync',
    reason: 'WORKTREE-GUARDED: boolean package.json probe under worktreePath, already isContainedWorktreePath-validated above.' },
  { file: 'cli/bridge-studio-runs.ts', line: 797, sink: 'existsSync',
    reason: 'QUEUE-PROBE: filename = `${initiativeId}.md`, initiativeId INIT_ID_RE-gated at line 789; boolean under trusted queuePaths.inFlight.' },
  { file: 'cli/bridge-studio-runs.ts', line: 801, sink: 'existsSync',
    reason: 'QUEUE-PROBE: as line 797, trusted queuePaths.done.' },
  { file: 'cli/bridge-studio-runs.ts', line: 807, sink: 'existsSync',
    reason: 'QUEUE-PROBE: as line 797, trusted queuePaths.pending.' },
  { file: 'cli/bridge-studio-runs.ts', line: 817, sink: 'existsSync',
    reason: 'QUEUE-PROBE: candidate = join(<trusted queuePaths.readyForReview|failed>, INIT_ID_RE filename); boolean.' },
  { file: 'cli/bridge-studio-runs.ts', line: 833, sink: 'writeFileSync',
    reason: 'QUEUE-WRITE: tmpPath = join(queuePaths.pending, `${initiativeId}.md`) + ".tmp"; INIT_ID_RE-validated single segment under trusted queuePaths.pending (atomic write-then-rename), no traversal possible.' },

  // ---- cli/bridge-studio-writes.ts ----
  { file: 'cli/bridge-studio-writes.ts', line: 854, sink: 'existsSync',
    reason: 'PROJECTROOT-GUARDED: projectRoot is validated by isContainedProjectRepoPath (manifest-path-guard, per-segment realpath) at line 835; this is a boolean duplicate-project probe.' },
  { file: 'cli/bridge-studio-writes.ts', line: 919, sinks: ['existsSync', 'mkdirSync'],
    reason: 'PROJECTROOT-GUARDED: SEC-03 Defect-5 create-mode — projectRoot proven contained by isContainedProjectRepoPath (line 835) AND Phase-1 checkContractArtifactContainment; `if (!existsSync(projectRoot)) mkdirSync(projectRoot, {recursive})` — BOTH sinks on this line ride that proof (the in-file writeup is definitive).' },

  // ---- cli/bridge-studio.ts ----
  { file: 'cli/bridge-studio.ts', line: 418, sink: 'existsSync',
    reason: 'LOG-READ: readPreflightFixState — runId SAFE_ID_RE-gated at the GET route (line 884); `_preflight-fix-<runId>/events.jsonl` single validated segment under trusted forgeRoot/_logs; boolean. (Line-drift remap from 411 — R1-06 added a single import + a small loadAllFlows change earlier in the file, +7 lines; same function, same guard, unchanged.)' },
  { file: 'cli/bridge-studio.ts', line: 420, sink: 'readFileSync',
    reason: 'LOG-READ: as line 418 — internal preflight-fix event log only (symlink-blind residual disclosed in openConcerns). (Line-drift remap from 413.)' },

  // ---- cli/ui-bridge.ts ----
  { file: 'cli/ui-bridge.ts', line: 446, sink: 'existsSync',
    reason: 'LOG-TAIL: ensureTailFor(cycleId) — boolean guard before establishing a READ-ONLY setInterval tail of <logsRoot>/<cycleId>/events.jsonl; cycleId is an internal broadcast cycle id, path under trusted logsRoot.' },
  { file: 'cli/ui-bridge.ts', line: 744, sink: 'existsSync',
    reason: 'BOOL-PROBE: existsSync(reviewCommentsPath(logsRoot, cycleId)) — boolean "does the sidecar exist" only; the paired writeReviewComments(logsRoot, cycleId) enforces containment and throws (→500, never writes) on a traversal cycleId; route params are isSafeCycleId-gated (lines 1876/1886/1900).' },
  { file: 'cli/ui-bridge.ts', line: 1095, sink: 'existsSync',
    reason: 'FILTER-PREDICATE-FP + READDIR-ENUM: kindDir = join(ctx.projectsRoot, <readdir-enumerated project>, `_${descriptor.id}`); `slug` (the taint) appears ONLY in the `.filter(d => d.agent === slug)` predicate that SELECTS descriptors — it is never part of the path VALUE (a server-side session-kind registry id is). Boolean.' },
  { file: 'cli/ui-bridge.ts', line: 1098, sink: 'readdirSync',
    reason: 'FILTER-PREDICATE-FP + READDIR-ENUM: as line 1095 — enumerates sessionIds under the registry-derived kindDir.' },
  { file: 'cli/ui-bridge.ts', line: 1701, sink: 'existsSync',
    reason: 'BOOL-PROBE: existsSync(join(ctx.projectsRoot, body.project)) — body.project is SAFE_PROJECT_NAME_RE-validated immediately above (line 1653); boolean 404-gate, no bytes flow.' },
  { file: 'cli/ui-bridge.ts', line: 2036, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE: spawnAgentTurn — sessionId isSafeRunId-gated at line 1986 (SAFE_RUN_ID_RE + explicit .. check); `_<logPrefix>-<sessionId>` under trusted forgeRoot/_logs.' },
  { file: 'cli/ui-bridge.ts', line: 2437, sink: 'mkdirSync',
    reason: 'LOGDIR-CREATE: sibling spawn helper — sessionId/runId isSafeRunId-gated before this log-dir create under trusted forgeRoot/_logs.' },
  { file: 'cli/ui-bridge.ts', line: 3406, sink: 'mkdirSync',
    reason: 'EXCLUSIVE-CREATE: onboarding — sessionId SAFE_ID_RE-gated at line 3356; mkdirSync(sessionDir) has NO recursive flag, so a pre-existing entry (incl. a symlink) is a hard EEXIST, never reused/followed.' },
  { file: 'cli/ui-bridge.ts', line: 3407, sink: 'writeFileSync',
    reason: 'EXCLUSIVE-CREATE: status.json write with flag `wx` (O_EXCL) — never follows an existing symlink; parent sessionDir just exclusively created (line 3362), sessionId SAFE_ID_RE-gated.' },
  { file: 'cli/ui-bridge.ts', line: 3415, sink: 'writeFileSync',
    reason: 'EXCLUSIVE-CREATE: prompt.md write with flag `wx` (O_EXCL) — same exclusive-create discipline as line 3363.' },
  { file: 'cli/ui-bridge.ts', line: 3973, sink: 'mkdirSync',
    reason: 'MANUAL-CONTAIN: onboardingParent = join(realProjectDir, "_onboarding") where realProjectDir is realpathSync-resolved; this mkdir is immediately followed by realpathSync + startsWith(realProjectDir + sep) re-verification (lines 3930-3932) that refuses a symlinked _onboarding.' },
  { file: 'cli/ui-bridge.ts', line: 4042, sink: 'existsSync',
    reason: 'BOOL-PROBE: existsSync(join(repoPath, ".forge","demo","demo.lock.json")) picks the create/update mode default; body.project was already proven contained by resolveDemoSessionDir above; boolean-only, no bytes flow.' },

  // ---- orchestrator/interactive-session.ts ----
  { file: 'orchestrator/interactive-session.ts', line: 243, sink: 'existsSync',
    reason: 'RETAINED-RAW-PRIMITIVE: readSessionStatus(sessionDir) — a DESIGNATED_UNGUARDED_FUNCTION superseded by the leaf-guarded sibling guardedReadSessionStatus(projectsRoot, dirSegments). NO production route calls the raw primitive (every session route resolves projectsRoot+segments through resolveGuardedPath and uses the guarded sibling — see the in-file SEC-04 notes). Boolean probe on join(sessionDir, file); a future raw caller trips the sibling caller-count ratchet.' },
  { file: 'orchestrator/interactive-session.ts', line: 245, sink: 'readFileSync',
    reason: 'RETAINED-RAW-PRIMITIVE: readSessionStatus(sessionDir) — same as line 243; reads only after the existsSync probe, only from an already-guarded dir handed by the (now guarded-sibling-only) call path. Superseded primitive kept as the base + for tests.' },
  { file: 'orchestrator/interactive-session.ts', line: 262, sink: 'writeFileSync',
    reason: 'RETAINED-RAW-PRIMITIVE: writeSessionStatus(sessionDir) — a DESIGNATED_UNGUARDED_FUNCTION superseded by the leaf-guarded guardedWriteSessionStatus. NO production route writes through the raw primitive; a future reachable caller trips the sibling ratchet.' },

  // ---- orchestrator/architect-runner.ts ----
  { file: 'orchestrator/architect-runner.ts', line: 1407, sink: 'existsSync',
    reason: 'RETAINED-RAW-PRIMITIVE: readStatus(sessionDir) — superseded by the leaf-guarded sibling guardedReadStatus(projectsRoot, dirSegments). listArchitectSessions now routes the status.json LEAF through guardedReadStatus, so NO production caller hands a request-derived dir to the raw primitive (the remaining callers are architect-runner.test.ts constructing their own trusted tmp dirs). readStatus is a DESIGNATED_UNGUARDED_FUNCTION — a future reachable caller trips the sibling caller-count ratchet (check-request-path-sinks). Boolean probe on join(sessionDir, "status.json").' },
  { file: 'orchestrator/architect-runner.ts', line: 1409, sink: 'readFileSync',
    reason: 'RETAINED-RAW-PRIMITIVE: readStatus(sessionDir) — same as line 1407; reads status.json only after the existsSync probe, and only from test-supplied trusted dirs (production uses the leaf-guarded guardedReadStatus). Superseded primitive, kept as the base + for tests.' },
  { file: 'orchestrator/architect-runner.ts', line: 1418, sink: 'writeFileSync',
    reason: 'RETAINED-RAW-PRIMITIVE: writeStatus(sessionDir) — superseded by the leaf-guarded guardedWriteStatus. NO production caller (the runner writes via writeArchitectStatus → guardedWriteStatus); only architect-runner.test.ts calls the raw primitive on its own trusted tmp dirs. A future reachable caller trips the sibling ratchet.' },
  { file: 'orchestrator/architect-runner.ts', line: 1596, sink: 'existsSync',
    reason: 'LOG-READ: readArchitectSessionStats — `_architect-<sessionId>/events.jsonl` single segment under resolve(logsRoot) (trusted); sessionId is the architect session id (SAFE_ID_RE convention at creation); best-effort stats (returns null on any error). Boolean.' },
  { file: 'orchestrator/architect-runner.ts', line: 1598, sink: 'readFileSync',
    reason: 'LOG-READ: as line 1596 — reads only the internal architect event log for cost/duration stats (symlink-blind residual disclosed in openConcerns).' },

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
  { file: 'cli/bridge-studio.ts', line: 526, sink: 'readFileSync',
    reason: 'LOG-READ (SEC-04 residual #2, disposed UNIFORMLY with the _logs log-read family — kbs.ts:223/225, bridge-studio.ts:418/420, architect-runner.ts:1596/1598): phase-log GET /api/runs/<runId>/phases/<node>/log reads readFileSync(resolve(logsRoot, runId, "events.jsonl")). runId is URL-derived but behind a lexical resolve()+startsWith(logsRoot+sep) gate (line 509) that BLOCKS .. traversal (resolve normalizes, startsWith rejects escape) — symlink-BLIND like the SAFE_ID_RE-gated family, same residual class. NOT wire-reachable: the _logs/<runId> symlink precondition is unplantable via any route (nothing writes attacker-chosen symlinks under _logs). Allowlisted (not guarded) so the whole _logs event-read family stays uniform — no split treatment; the migrate-to-guardedFile follow-up for the family is echoed in openConcerns. (Line-drift remap from 519.)' },
  { file: 'cli/bridge-studio.ts', line: 513, sink: 'existsSync',
    reason: 'LOG-READ (SEC-04 residual #2, boolean pair of line 526): existsSync(eventsPath) on the same lexically-resolved, .. -blocked, symlink-blind URL-derived path — boolean 404 probe, no bytes flow. Same disclosed-_logs-symlink residual as line 526; uniform with the log-read family. (Line-drift remap from 506.)' },
  // ---- GUARD-NEXT: route the FULL path (incl. leaf) through the guard ----
  { file: 'cli/bridge-studio.ts', line: 1243, sink: 'readFileSync',
    reason: 'GUARD-NEXT (SEC-04, caught by broadened dir-param): tryReadWorkItemDir(dir) reads readFileSync(join(dir, file)); its callers pass snapshotDir=join(logsRoot, cycleId, "work-items-snapshot") and liveDir=join(forgeRoot, "_worktrees", initId, ".forge","work-items") — the DIR is built from request-derived cycleId/initId by lexical join with NO realpath containment (the WI-*.md leaf is readdir-enumerated). Symlink-blind coverage gap (full route-reachability not traced this stage). NEXT: route the dir+leaf through guardedReadDir/guardedReadFile; delete when guarded. (Line-drift remap from 1236 — unrelated pre-existing gap, unchanged by R1-06; still open.)' },
  // ---- RETAIN: contained by a mechanism the scanner can\'t see (confirm next stage) ----
  { file: 'cli/bridge-studio-kbs.ts', line: 1232, sink: 'existsSync',
    reason: 'RETAIN (contained + boolean): DELETE /api/studio/kbs/:id — id is URL-derived (newly tainted) but SLUG_RE-gated earlier in the route (blocks / and ..), and dir = resolveKbBrainDir(forgeRoot, id) runs the per-segment realpath identity walk (choke-point containment; see resolveKbBrainDir + resolveGuardedPath in orchestrator/brain-paths.ts) returning null on any escape; existsSync(dir) is a boolean 404 probe, no bytes flow. Same manifest-path-guard category as the isContainedWorktreePath rows above. (Line-drift remap from 1120 — R6-08 4on\'s buildKbHealth rewrite (listOwnThemeFiles/CHECK_SCOPE) inserted ~112 lines earlier in the file; same function, same guard, unchanged.)' },
  { file: 'cli/bridge-studio-kbs.ts', line: 1157, sink: 'mkdirSync',
    reason: 'CREATE-LITERAL-SUBDIR: kbDir = kbGuard.realPath (resolveGuardedPath) and the route 409s if kbGuard.exists, so this runs only create-mode on a FRESH dir; the appended leaf `themes` is a literal — a just-created dir cannot host a pre-planted symlink. (Line-drift remap from 1045 — R6-08 4on, same cause as the row above.)' },
  { file: 'cli/bridge-studio-kbs.ts', line: 1158, sink: 'mkdirSync',
    reason: 'CREATE-LITERAL-SUBDIR: as line 1157, literal `_raw` subdir under the freshly-created guarded kbDir. (Line-drift remap from 1046 — R6-08 4on.)' },
  { file: 'cli/ui-bridge.ts', line: 1832, sink: 'mkdirSync',
    reason: 'RETAIN (isSafeRunId-gated logdir-create): runId = `_agent-${slug}-${newRunStamp()}` with slug URL-derived (newly tainted), but isSafeRunId(runId) (SAFE_RUN_ID_RE + explicit .. check) THROWS at line 1781 BEFORE this recursive mkdir of the run\'s own log dir under trusted ctx.logsRoot — the SAME deliberate guard-symmetry check its already-allowlisted siblings at 1992/2393 carry.' },
  { file: 'cli/bridge-studio-writes.ts', line: 141, sink: 'existsSync',
    reason: 'RETAIN (boolean probe — MUST NOT guard): checkContractArtifactContainment(projectRoot) — projectRoot isContainedProjectRepoPath-validated at the route (line 835, per the 854/919 rows) before this Phase-1 checker; existsSync(join(projectRoot, ".forge","project.json")) is a boolean gate that RUNS resolveGuardedPath when the file is ABSENT (no bytes flow). Guarding an idempotent existence probe would false-reject; newly visible only because projectRoot is now a dir-shaped param.' },
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

export function runLint({ root = FORGE_ROOT, modules = null, allowlist = ALLOWLIST } = {}) {
  const mods = modules ?? targetModules(root);
  const all = [];
  for (const rel of mods) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    all.push(...analyzeModule(readFileSync(abs, 'utf8'), rel));
  }
  const { kept, suppressed, stale, mistargeted } = applyAllowlist(all, allowlist);
  return { findings: kept, suppressed, stale, mistargeted, scanned: mods.length, total: all.length };
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
    console.error(`check-raw-fs-guarded: FAIL — ${r.findings.length} unguarded request-derived raw fs sink(s) in ${r.scanned} request-handling module(s):`);
    for (const f of r.findings) {
      console.error(`  ✗ ${f.file}:${f.line} ${f.sink}(${f.path}) — ${f.why}`);
    }
    console.error('');
    console.error('Each must be either:');
    console.error('  1. Routed through the guard (leaf included):');
    console.error('       guardedFile(TRUSTED_ROOT, [...request-derived segments, leaf], mode) — or guardedReadFile/guardedWriteFile/guardedReadDir.');
    console.error('       The request-derived id is a SEGMENT; never fold it into the trusted root.');
    console.error('  2. Or added to the ALLOWLIST in scripts/check-raw-fs-guarded.mjs (file+line+reason) if it is an audited-trusted residual.');
    return 1;
  }
  console.log(`check-raw-fs-guarded: PASS — ${r.scanned} modules scanned, ${r.suppressed.length} allowlisted residual(s), 0 unguarded request-derived raw fs sinks`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main());
