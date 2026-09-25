#!/usr/bin/env node
/**
 * check-request-path-sinks.mjs — no-new-unguarded-sinks RATCHET.
 *
 * Why this exists: docs/reference/request-path-sinks.md enumerates every
 * request-derived filesystem path in the repo as of one point in time. The
 * same defect shape (a request-derived path reaching an fs/git call with no
 * real containment) was found TWELVE times across seven initiatives despite
 * that document existing — discovery stayed luck-driven because nothing
 * forced a re-check when a NEW call site appeared. This script is that force:
 * it counts calls to a fixed list of filesystem/process sinks in every module
 * reachable from a request-path ENTRY (see `listEntryModules`), and fails the
 * build the moment a NEW (file, sink) pair appears or an existing one's call
 * count goes UP, until a human looks at it and updates the baseline. It never
 * goes down on its own.
 *
 * The header used to say "in cli/ and orchestrator/" and "reachable from a
 * bridge HTTP route". Both were stale and the second was load-bearing: the
 * package move put the subject under packages/, and a scope that is only ever
 * a bridge route cannot see a CLI dispatch entry — which is precisely how a
 * planted sink in packages/agents/agent-run.ts stayed invisible here while
 * the sibling lint caught it on the same line (bead forge-8vfn.5.48).
 *
 * ============================================================================
 * WHAT THIS RATCHET DOES NOT COVER (read this before trusting a green run)
 * ============================================================================
 *
 * This is explicitly NOT static analysis, dataflow analysis, or a security
 * proof. It is a line-count tripwire, on the same "prove-or-warn, one
 * actionable line per failure" model as scripts/check-docs-claims.mjs. It
 * proves nothing about whether any given path is guarded — only that the
 * SHAPE of the reachable code (which files, which sinks, how many calls) has
 * not grown since the baseline was last accepted. Specifically:
 *
 *   - NO DATAFLOW. It cannot tell a request-derived path from a hardcoded
 *     constant. `writeFileSync('/tmp/known-safe-file', x)` counts exactly
 *     the same as `writeFileSync(join(root, req.params.id), x)`. A human (or
 *     the audit doc) still has to make that call for every new line.
 *   - ALIASED / DYNAMICALLY-DISPATCHED SINKS ARE INVISIBLE. `const w =
 *     writeFileSync; w(...)`, `fs[name](...)`, `fs['writeFileSync'](...)`,
 *     or re-exporting a sink under a new local name all evade the `\bNAME\(`
 *     match entirely. The regex matches a literal identifier immediately
 *     followed by `(` — nothing more.
 *   - `fs/promises` AND `fs.promises.*` ARE NOT IN THE SINK LIST. Only the
 *     synchronous `node:fs` names below (plus child_process) are tracked.
 *     A promise-based rewrite of a guarded site produces zero signal here.
 *   - A GUARDED SITE THAT BECOMES UNGUARDED THROUGH AN EDIT TO ITS GUARD
 *     PRODUCES NO SIGNAL. The ratchet key is (file, sink, count) — pure
 *     call-site bookkeeping, not "is this call preceded by a guard". Gutting
 *     `resolveGuardedPath` itself, or removing a guard call while leaving the
 *     sink call and its surrounding line count unchanged, is invisible.
 *   - MODULES REACHED ONLY THROUGH A NON-LITERAL DYNAMIC IMPORT
 *     (`import(someVariable)`) ARE NOT WALKED — only `import('./literal.ts')`
 *     string literals are followed. Anything inside node_modules is never
 *     walked (this repo takes no new dependencies; the sink surface it cares
 *     about is first-party code).
 *   - ONLY UNQUALIFIED CALLS ARE COUNTED. The match is
 *     `(?<![.\w$])NAME\s*\(`, so a call on a receiver — `someRegex.exec(line)`,
 *     `fs.writeFileSync(p, b)`, `child_process.exec(cmd)` — is NOT counted.
 *     This is a deliberate trade, measured before it was made: every sink
 *     call in `cli/` + `orchestrator/` today is a named import called bare,
 *     while 29 of 30 `.`-qualified occurrences are `RegExp.prototype.exec()`
 *     and the thirtieth is inside a comment. Counting them made a plain
 *     `re.exec(...)` added anywhere in a bridge-reachable file fail the
 *     ratchet, which trains an author to re-run `--write` without reading —
 *     the failure mode that destroys a ratchet's value. The cost is a real
 *     blind spot: a NAMESPACE-imported sink (`import * as fs`, then
 *     `fs.writeFileSync(...)`) is invisible to this check. If you introduce
 *     that style, this ratchet does not see your sink — use named imports,
 *     which is what every module in these two directories already does.
 *   - THE COMMENT FILTER IS LINE-BASED, NOT A REAL PARSER. It skips lines
 *     whose FIRST non-whitespace characters are `//`, `*`, or `/*`. A
 *     multi-line `/* ... *␀/` block whose continuation lines do not start
 *     with `*` will have its inner lines scanned as code (a sink name typed
 *     inside prose inside such a comment would be counted). It does not
 *     parse string literals at all, so a sink name appearing inside a string
 *     (e.g. an error message quoting `"writeFileSync failed"`) is also
 *     counted — a crude, deliberately-stated over-count risk, never an
 *     under-count of REACHABLE files (reachability itself is exact for the
 *     import forms it follows; see below).
 *   - REACHABILITY ONLY FOLLOWS RELATIVE STATIC/DYNAMIC IMPORTS WITH STRING
 *     LITERALS (`import ... from './x.ts'`, `export ... from '../y/z.ts'`,
 *     `import('./x.ts')`), restricted to files under cli/ and orchestrator/.
 *     Bare-specifier imports (npm packages) are not followed — correct,
 *     since this repo takes no new external filesystem-touching deps without
 *     an ask-first — but if that policy ever changes, this script would not
 *     know.
 *
 * An audit or lint that overstates its own rigour is worse than none — a
 * real finding from this campaign. Treat a green run as "the known reachable
 * surface has not grown", never as "the reachable surface is safe".
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * Step 1 — REACHABILITY. Entry modules = apps/forge/ui-bridge.ts plus every
 * cli/bridge-*.ts that is not a *.test.ts. From those, walk relative imports
 * transitively (`import … from './x.ts'`, `import … from '../y/z.ts'`,
 * `export … from '…'`, and `import('…')` with a string literal), restricted
 * to files under cli/ and orchestrator/, skipping *.test.ts. The result is
 * the set of modules reachable from a bridge route.
 *
 * Step 2 — SINK ENUMERATION. In each reachable module, count calls to this
 * FIXED, explicitly-listed set of filesystem/process sinks:
 *
 *   writeFileSync, appendFileSync, mkdirSync, rmSync, rmdirSync, unlinkSync,
 *   renameSync, copyFileSync, cpSync, openSync, readFileSync, readdirSync,
 *   existsSync, statSync, lstatSync, realpathSync, symlinkSync,
 *   createWriteStream, createReadStream, spawnSync, execFileSync, execSync,
 *   spawn, execFile, exec
 *
 * Matched on an UNQUALIFIED call shape (`(?<![.\w$])NAME\s*\(`), line by
 * line, skipping lines that are comments (leading `//`, `*`, `/*`) per the
 * crude filter documented above. String contents are never parsed.
 *
 * Step 3 — THE RATCHET. Baseline file scripts/request-path-sinks.baseline.txt
 * (checked in, sorted, one line per `<repo-relative-path> <sinkName>
 * <count>`).
 *   - FAIL (exit 1) when a (file, sink) pair is present in the code but
 *     ABSENT from the baseline, or its count EXCEEDS the baseline count.
 *   - PASS with a `tighten:` notice (exit 0) when a count DROPS or a pair
 *     disappears — removing a sink is never a security regression, and
 *     forcing a baseline edit on every deletion trains people to regenerate
 *     blindly.
 *   - `--write` regenerates the baseline from the current tree and exits 0.
 *
 * Usage:
 *   node scripts/check-request-path-sinks.mjs           # check, exit 1 on new/grown sinks
 *   node scripts/check-request-path-sinks.mjs --write    # regenerate the baseline
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGNATED_UNGUARDED_FUNCTIONS, countDesignatedCallers, CALLER_SINK_SUFFIX } from './check-request-path-sinks-callers.mjs';

// Caller-count dimension re-exported unchanged (same names, same behaviour) —
// split into check-request-path-sinks-callers.mjs under the 800-line cap; see
// that file's own header for the full CALLER-COUNT DIMENSION documentation.
export { DESIGNATED_UNGUARDED_FUNCTIONS, countDesignatedCallers };

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_BASELINE_PATH = join(FORGE_ROOT, 'scripts/request-path-sinks.baseline.txt');
export const DEFAULT_DOC_PATH = join(FORGE_ROOT, 'docs/reference/request-path-sinks.md');

/**
 * The trees this walk may enter. `packages/` and `apps/` joined in M2: the
 * kernel move took `cli/studio-path-guard.ts` — the containment guard this
 * lint exists to watch — to `packages/kernel/path-guard.ts`, and with only
 * `cli/` and `orchestrator/` here the guard's own six raw fs sinks silently
 * became "tighten" rows and both ratchets went on reporting PASS. A lint that
 * loses sight of its subject when the subject moves is worse than no lint,
 * because it still says green.
 */
const WALK_ALLOWED_PREFIXES = ['cli/', 'orchestrator/', 'packages/', 'apps/'];

/**
 * A workspace package specifier — `@forge/kernel` -> `packages/kernel/index.ts`.
 * The ONLY edge from the legacy tree into a package is
 * `orchestrator/_pkg/<pkg>.ts`, which re-exports a BARE specifier. A walker
 * that follows relative specifiers only stops dead at that shim, so every
 * package would sit outside this lint's universe forever.
 */
const WORKSPACE_SPEC_RE = /^@forge\/([^/]+)(\/.*)?$/;

/** Fixed, explicit sink list — see header. Do not derive this from any
 *  runtime introspection of node:fs / node:child_process; it must stay a
 *  literal list a reader can audit in one glance. */
export const SINK_NAMES = [
  'writeFileSync',
  'appendFileSync',
  'mkdirSync',
  'rmSync',
  'rmdirSync',
  'unlinkSync',
  'renameSync',
  'copyFileSync',
  'cpSync',
  'openSync',
  'readFileSync',
  'readdirSync',
  'existsSync',
  'statSync',
  'lstatSync',
  'realpathSync',
  'symlinkSync',
  'createWriteStream',
  'createReadStream',
  'spawnSync',
  'execFileSync',
  'execSync',
  'spawn',
  'execFile',
  'exec',
];

/**
 * IMPORT-BOUND SINK MATCHING (bead forge-8vfn.5.19, problem 1).
 *
 * Measured false positive: `const exec = executors[kind] ?? execUnknown;
 * await exec(ctx)` in packages/factory/phases/executor-table.ts was reported
 * as a new 'exec' sink purely because the CALL SITE NAME matched — 'exec' is
 * a local const, never node:child_process's. Had a lane run --write there, a
 * fake sink would have entered the baseline permanently.
 *
 * Fix: a sink name only counts when THIS FILE's own imports bind that local
 * name to the real node:fs/node:child_process export of the same name —
 * never a bare-name match against a local function, a destructured
 * property, or a parameter. `sinkRegexesFor` below is built PER FILE, same
 * discipline as `callRegexesFor` for the designated-caller dimension: the set
 * of names a call site may use is a property of that file's imports, not a
 * fixed literal.
 *
 * Deliberately NOT extended to member calls (`fs.readFileSync(...)`) even
 * though such a call, if `fs` is a real `node:fs` namespace import, DOES
 * resolve to a real sink — the header's "ONLY UNQUALIFIED CALLS ARE COUNTED"
 * trade stays in force; see that measurement. This fix closes the
 * false-positive direction (an unrelated local counted as a sink), not the
 * false-negative one (a real sink invisible because it's namespace-qualified
 * or aliased through a re-export) — both pre-existing, disclosed limits.
 */
const SINK_MODULE_RES = [/^node:fs$/, /^fs$/, /^node:child_process$/, /^child_process$/];

/** Local names each SINK_NAME is callable under IN THIS FILE, restricted to
 *  names actually imported from a real node:fs / node:child_process module
 *  specifier (aliased or not) — never a same-named local declaration, a
 *  destructure off some other object, or a parameter. Returns a
 *  Map<localName, canonicalSinkName>. */
function importedSinkLocals(text) {
  const bound = new Map();
  const sinkNameSet = new Set(SINK_NAMES);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!SINK_MODULE_RES.some((re) => re.test(m[2]))) continue;
    for (const part of m[1].split(',')) {
      const [imported, local] = part.split(/\s+as\s+/).map((x) => x.trim());
      if (sinkNameSet.has(imported)) bound.set(local || imported, imported);
    }
  }
  return bound;
}

/** Call-site regexes for THIS file: one per (localName -> canonicalSink)
 *  binding, matched unqualified exactly as before (`(?<![.\w$])`). A file
 *  with no fs/child_process import at all yields an empty array — cheap,
 *  and correct: nothing in it can be a real sink call. */
function sinkRegexesFor(text) {
  return [...importedSinkLocals(text).entries()].map(([local, canonical]) => ({
    canonical,
    re: new RegExp(`(?<![.\\w$])${local}\\s*\\(`, 'g'),
  }));
}

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** Relative-import specifiers this module cares about: static `from '...'`
 *  (covers `import x from`, `import {a} from`, `export {a} from`,
 *  `export * from`), bare side-effect `import '...'`, and string-literal
 *  dynamic `import('...')`. Only specifiers starting with `.` are collected
 *  — bare package specifiers are never followed (see header). */
const IMPORT_SPEC_RES = [
  /\bfrom\s+['"](\.[^'"]+)['"]/g,
  /^\s*import\s+['"](\.[^'"]+)['"]/gm,
  /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  /\bfrom\s+['"](@forge\/[^'"]+)['"]/g,
  /\bimport\(\s*['"](@forge\/[^'"]+)['"]\s*\)/g,
];

function extractRelativeImportSpecs(text) {
  const specs = new Set();
  for (const re of IMPORT_SPEC_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) specs.add(m[1]);
  }
  return specs;
}

/** Resolve a relative import spec seen inside `fromRelFile` (itself a
 *  repo-relative path using forward slashes) to a repo-relative target path.
 *  Appends `.ts` when the spec carries no extension (this repo's own
 *  convention is to always write the extension explicitly, but this keeps
 *  the walker honest if that ever lapses). Returns null if the resolved
 *  target falls outside cli/ or orchestrator/, or isn't a `.ts` file. */
function resolveImportTarget(fromRelFile, spec) {
  const pkg = WORKSPACE_SPEC_RE.exec(spec);
  if (pkg) {
    const target = `packages/${pkg[1]}/${pkg[2] ? pkg[2].slice(1) : 'index.ts'}`;
    return target.endsWith('.ts') ? target : `${target}.ts`;
  }
  const fromDir = dirname(fromRelFile);
  let target = join(fromDir, spec).split('\\').join('/');
  if (!extname(target)) target = `${target}.ts`;
  if (!target.endsWith('.ts')) return null;
  if (!WALK_ALLOWED_PREFIXES.some((p) => target.startsWith(p))) return null;
  return target;
}

/**
 * The trees a bridge host may live in. `cli/` is where it lives today and
 * `apps/forge/` is where the M4 host carve puts it; naming BOTH is what stops
 * the carve silently emptying this seed. A tree that is absent is skipped, not
 * an error — the point is that the derivation does not care which one holds
 * the host (bead forge-8vfn.5.34).
 */
const HOST_TREES = ['cli', 'apps/forge'];

/**
 * Modules that receive request-derived input but that NO bridge module
 * imports, so the reachability walk below can never find them: the CLI
 * dispatch entries. `forge agent run` parses argv and drives the same
 * project/session/run identifiers a route would.
 *
 * This is the list bead forge-8vfn.5.48 is about. It lived only in
 * `check-raw-fs-guarded.mjs`'s `EXPLICIT_MODULES`, so the two sibling lints
 * disagreed about their own scope: measured on `b3f728c0`, four of that
 * script's thirty modules were unreachable from this walk and therefore
 * invisible here while the sibling audited them. A planted sink in
 * `packages/agents/agent-run.ts` was caught by one lint and not the other, on
 * the same line. Declared HERE, once, and consumed by both.
 */
export const DISPATCH_ENTRY_MODULES = [
  'packages/agents/agent-dispatch-cmd.ts',
  'packages/agents/agent-run.ts',
  'packages/agents/find-session-project.ts',
  'packages/sessions/kinds/project-brain.ts',
];

/**
 * The HTTP + dispatch ENTRY modules both request-path lints seed from.
 *
 * Three sources, none of them a hand-written directory list (bead
 * forge-8vfn.5.34 — a guard scoped by a hand list went blind the last time the
 * tree moved, and this one would have gone blind at the host carve):
 *
 *   1. the bridge host — `ui-bridge.ts` and every non-test `bridge-*.ts`, in
 *      whichever of HOST_TREES holds it;
 *   2. every `packages/<pkg>/routes.ts` — the carved route tables, discovered
 *      by globbing `packages/`, so a package carving its routes tomorrow is
 *      picked up with no edit here;
 *   3. DISPATCH_ENTRY_MODULES, above.
 *
 * Exported so the SIBLING dataflow lint (check-raw-fs-guarded.mjs) seeds its
 * declared request-handling surface from the SAME derivation, instead of
 * maintaining a second and differently-wrong list of its own.
 */
export function listEntryModules(root) {
  const out = new Set();
  for (const tree of HOST_TREES) {
    const dir = join(root, tree);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      if (f === 'ui-bridge.ts' || f.startsWith('bridge-')) out.add(`${tree}/${f}`);
    }
  }
  const packagesDir = join(root, 'packages');
  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir)) {
      const rel = `packages/${pkg}/routes.ts`;
      if (existsSync(join(root, rel))) out.add(rel);
    }
  }
  for (const rel of DISPATCH_ENTRY_MODULES) {
    if (existsSync(join(root, rel))) out.add(rel);
  }
  return [...out].sort();
}

/** Step 1 — reachability. Returns the sorted array of repo-relative module
 *  paths reachable (transitively) from the bridge entry modules, excluding
 *  *.test.ts. */
export function findReachableModules(root = FORGE_ROOT) {
  const entries = listEntryModules(root);
  const visited = new Set();
  const queue = [...entries];
  for (const e of entries) visited.add(e);

  while (queue.length) {
    const relFile = queue.shift();
    const absFile = join(root, relFile);
    if (!existsSync(absFile)) continue;
    const text = readFileSync(absFile, 'utf8');
    for (const spec of extractRelativeImportSpecs(text)) {
      const target = resolveImportTarget(relFile, spec);
      if (!target) continue;
      if (target.endsWith('.test.ts')) continue;
      if (visited.has(target)) continue;
      if (!existsSync(join(root, target))) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  return [...visited].sort();
}

/** Step 2 — sink enumeration. Returns a sorted array of
 *  { file, sink, count } rows, one per (file, sink) pair with count > 0. */
export function countSinks(root, reachableFiles) {
  const rows = [];
  for (const relFile of reachableFiles) {
    const absFile = join(root, relFile);
    if (!existsSync(absFile)) continue;
    const text = readFileSync(absFile, 'utf8');
    const matchers = sinkRegexesFor(text);
    if (!matchers.length) continue; // no fs/child_process import at all — nothing here can be a real sink
    const lines = text.split('\n');
    const counts = new Map();
    for (const line of lines) {
      if (isCommentLine(line)) continue;
      for (const { canonical, re } of matchers) {
        re.lastIndex = 0;
        let m;
        let n = 0;
        while ((m = re.exec(line))) n += 1;
        if (n > 0) counts.set(canonical, (counts.get(canonical) ?? 0) + n);
      }
    }
    for (const [sink, count] of counts) rows.push({ file: relFile, sink, count });
  }
  rows.sort((a, b) => (a.file === b.file ? a.sink.localeCompare(b.sink) : a.file.localeCompare(b.file)));
  return rows;
}

/** Full analysis: reachability + sink enumeration in one call. */
export function analyze(root = FORGE_ROOT) {
  const reachable = findReachableModules(root);
  const rows = countSinks(root, reachable);
  return { reachable, rows };
}

export function formatBaseline(rows) {
  return rows.map((r) => `${r.file} ${r.sink} ${r.count}`).join('\n') + (rows.length ? '\n' : '');
}

const BASELINE_LINE_RE = /^(.*) (\S+) (\d+)$/;

export function parseBaseline(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = BASELINE_LINE_RE.exec(line);
    if (!m) continue;
    rows.push({ file: m[1], sink: m[2], count: Number(m[3]) });
  }
  return rows;
}

function rowKey(r) {
  return `${r.file}\u0000${r.sink}`;
}

/** Step 3 — the ratchet. Compares current rows against baseline rows.
 *  Returns { failures, tighten }: failures = new-or-grown pairs (FAIL
 *  exit 1); tighten = dropped-or-vanished pairs (PASS, informational). */
export function compareBaseline(currentRows, baselineRows) {
  const curMap = new Map(currentRows.map((r) => [rowKey(r), r]));
  const baseMap = new Map(baselineRows.map((r) => [rowKey(r), r]));
  const failures = [];
  const tighten = [];

  for (const [key, cur] of curMap) {
    const base = baseMap.get(key);
    if (!base) {
      failures.push({ file: cur.file, sink: cur.sink, count: cur.count, baselineCount: 0 });
    } else if (cur.count > base.count) {
      failures.push({ file: cur.file, sink: cur.sink, count: cur.count, baselineCount: base.count });
    } else if (cur.count < base.count) {
      tighten.push({ file: cur.file, sink: cur.sink, count: cur.count, baselineCount: base.count });
    }
  }
  for (const [key, base] of baseMap) {
    if (!curMap.has(key)) {
      tighten.push({ file: base.file, sink: base.sink, count: 0, baselineCount: base.count });
    }
  }

  const byFileSink = (a, b) => (a.file === b.file ? a.sink.localeCompare(b.sink) : a.file.localeCompare(b.file));
  failures.sort(byFileSink);
  tighten.sort(byFileSink);
  return { failures, tighten };
}

function printFailureGuidance(failures) {
  const callerFailures = failures.filter((f) => f.sink.endsWith(CALLER_SINK_SUFFIX));
  const sinkFailures = failures.filter((f) => !f.sink.endsWith(CALLER_SINK_SUFFIX));

  if (sinkFailures.length) {
    console.error('');
    console.error('A new or grown (file, sink) pair means request-derived-path surface may have grown. Before accepting this:');
    console.error('  1. Route the path through a guard:');
    console.error("       - resolveGuardedPath(root, segments) from cli/studio-path-guard.ts — FIXED root, every untrusted id its own segments[] element (never folded into root).");
    console.error('       - or isContainedProjectRepoPath / isContainedWorktreePath / isSafeCycleId from cli/manifest-path-guard.ts.');
    console.error('  2. Add a row to docs/reference/request-path-sinks.md classifying the new site guarded / unguarded / accidentally-safe, per that doc\'s own rules.');
    console.error('  3. Re-run with --write to accept the new baseline:');
    console.error('       node scripts/check-request-path-sinks.mjs --write');
    console.error('');
  }

  if (callerFailures.length) {
    console.error('');
    console.error('A new or grown `<fn>@caller` row means a reachable file gained a call to a DESIGNATED UNGUARDED function (one that resolves a session dir with no containment of its own — see DESIGNATED_UNGUARDED_FUNCTIONS). This is the SEC-04 cross-file hole: the caller carries no raw sink, so the per-file sink ratchet never sees it. Before accepting this:');
    console.error('  1. Route the request-derived project + sessionId through the guard, do NOT bare-join them:');
    console.error('       - resolveSafeSessionDir(projectsRoot, project, kindDirName, sessionId) from cli/bridge-studio-sessions.ts (delegates to resolveGuardedPath — per-segment identity + charset + symlink containment; returns null on ANY escape).');
    console.error('       - Hand the GUARDED dir to readSessionStatus / writeSessionStatus; never a raw join(root, project, sessionId).');
    console.error('  2. Add a row to docs/reference/request-path-sinks.md classifying the new caller guarded / unguarded / accidentally-safe.');
    console.error('  3. Re-run with --write to accept the new baseline:');
    console.error('       node scripts/check-request-path-sinks.mjs --write');
    console.error('');
  }
}

/**
 * Whether `relFile` has ANY classification text in the audit doc — a coarse,
 * FILE-level check, not a per-sink one (M7 findings row 25's "unless the doc
 * classification exists" clause). The doc's rows are freeform narrative
 * prose keyed to file paths (see docs/reference/request-path-sinks.md), not
 * a machine-parseable (file, sink) index, so per-sink matching would be
 * exactly the kind of audit that overstates its own rigour the header warns
 * against. Coarse is a deliberate, stated trade: false-negative-safe (a file
 * the doc has never mentioned always refuses) at the cost of not catching a
 * SECOND, undocumented sink kind added to an ALREADY-documented file — the
 * same "prove-or-warn" model the rest of this ratchet uses.
 */
export function docClassifiesFile(docText, relFile) {
  return docText.includes(relFile);
}

/**
 * Doc-derived classification census — replaces
 * docs/reference/request-path-sinks.md's hand-maintained "## Summary" table,
 * which was the single highest-conflict edit across M7-C (measured: 6
 * collisions in one day, because every PR touched both a table row there AND
 * appended its own new section at the end). Rather than a hand-typed number
 * that can silently drift from the rows actually written below it, this
 * scans the doc's OWN classification-table rows (`file:line | op | field |
 * class | evidence`) and buckets each by its own `class` cell, plus tallies
 * the `[exec]`/`[read]`/`[unver]` verification markers wherever they occur.
 *
 * INFORMATIONAL ONLY, never a gate — printed every run, never compared
 * against a stored figure. The doc's rows are freeform narrative prose (see
 * its own structure: 70+ ad hoc section headings, arbitrarily long evidence
 * cells), not a machine-parseable (file, sink) index, so treating a count
 * derived from it as pass/fail-worthy would be exactly the kind of audit
 * that overstates its own rigour — this file's own header already names
 * that failure mode. A live, always-current print removes the churn (there
 * is no longer a stale number IN the doc to disagree with reality) without
 * pretending to verify prose it cannot reliably parse.
 */
const DOC_TABLE_ROW_RE = /^\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)\|\s*$/;

export function countDocClassifications(docText) {
  const byClass = { guarded: 0, unguarded: 0, accidentallySafe: 0, notRequestDerived: 0, other: 0 };
  const byMarker = { exec: 0, read: 0, unver: 0 };
  let totalRows = 0;
  for (const line of docText.split('\n')) {
    if (/^\|\s*-{2,}/.test(line)) continue; // markdown table separator row
    const m = DOC_TABLE_ROW_RE.exec(line);
    if (!m) continue;
    const classCell = m[4].trim();
    if (!classCell || classCell.toLowerCase() === 'class') continue; // empty cell or the header row itself
    totalRows += 1;
    const lc = classCell.toLowerCase();
    if (lc.includes('not request-derived')) byClass.notRequestDerived += 1;
    else if (lc.includes('accidentally-safe')) byClass.accidentallySafe += 1;
    else if (/\bunguarded\b/.test(lc)) byClass.unguarded += 1;
    else if (/\bguarded\b/.test(lc)) byClass.guarded += 1;
    else byClass.other += 1;
    if (line.includes('[exec]')) byMarker.exec += 1;
    if (line.includes('[read]')) byMarker.read += 1;
    if (line.includes('[unver]')) byMarker.unver += 1;
  }
  return { totalRows, byClass, byMarker };
}

/** Prints the doc census line every runCheck call (check or --write). A
 *  missing doc reads as zero rows rather than throwing — this is
 *  informational, never a gate, so an absent doc must never take the whole
 *  check down. */
function printDocCensus(docPath) {
  const docText = existsSync(docPath) ? readFileSync(docPath, 'utf8') : '';
  const { totalRows, byClass, byMarker } = countDocClassifications(docText);
  console.log(
    `check-request-path-sinks: doc census (${docPath}) — ${totalRows} classified row${totalRows === 1 ? '' : 's'} ` +
      `(guarded ${byClass.guarded}, unguarded ${byClass.unguarded}, accidentally-safe ${byClass.accidentallySafe}, not-request-derived ${byClass.notRequestDerived}, other ${byClass.other}); ` +
      `markers: [exec] ${byMarker.exec}, [read] ${byMarker.read}, [unver] ${byMarker.unver}`
  );
}

/** `--write`'s own body, split out so runCheck stays readable. Prints every
 *  row the regenerated baseline changes (bead forge-8vfn.5.19 problem 2) —
 *  `grown`/`dropped` are compareBaseline(newRows, priorRows)'s own output,
 *  reused rather than re-derived.
 *
 *  M7 findings row 25's other half: --write must never RAISE a row (a grown
 *  or brand-new pair) unless the audit doc already classifies that file —
 *  otherwise --write is exactly the tool that lets an undocumented growth
 *  sail into the baseline unread. Tightening (dropping) never needs doc
 *  backing, per this ratchet's own existing rule that a lower count is never
 *  a regression, so only `grown` is gated. Refuses (no write) and returns 1
 *  if any grown row's file lacks doc coverage — EXCEPT when no baseline
 *  existed yet (`hadPriorBaseline` false): the very first --write is
 *  establishing ground truth wholesale, not raising anything incrementally,
 *  so every row in it reads as "new" against an empty prior baseline and the
 *  gate would otherwise block the initial capture entirely. */
function writeBaseline({ baselinePath, docPath, rows, grown, dropped, reachableCount, totalCalls, hadPriorBaseline }) {
  const docText = existsSync(docPath) ? readFileSync(docPath, 'utf8') : '';
  const undocumented = hadPriorBaseline ? grown.filter((g) => !docClassifiesFile(docText, g.file)) : [];
  if (undocumented.length) {
    console.error(
      `check-request-path-sinks: --write REFUSED — ${undocumented.length} row(s) would RAISE the baseline with no classification in ${docPath}:`
    );
    for (const u of undocumented) console.error(`  ✗ ${u.file} ${u.sink}: ${u.baselineCount} -> ${u.count}`);
    console.error('  Add a row to docs/reference/request-path-sinks.md classifying the new/grown site first (M7 findings row 25 — --write never raises an undocumented row).');
    return 1;
  }

  if (grown.length || dropped.length) {
    console.log(
      `check-request-path-sinks: --write is changing ${grown.length + dropped.length} existing row(s) — read every line before committing (bead forge-8vfn.5.19: --write regenerates the WHOLE baseline, it is not a re-key):`
    );
    for (const g of grown) console.log(`  raise:  ${g.file} ${g.sink}: ${g.baselineCount} -> ${g.count}`);
    for (const d of dropped) console.log(`  ${d.count === 0 ? 'remove' : 'lower '}: ${d.file} ${d.sink}: ${d.baselineCount} -> ${d.count}`);
  }
  writeFileSync(baselinePath, formatBaseline(rows));
  console.log(
    `check-request-path-sinks: baseline written — ${reachableCount} reachable modules, ${rows.length} (file,sink) rows, ${totalCalls} total sink calls`
  );
  return 0;
}

/**
 * Run the check (or `--write` the baseline). Root and baseline path are
 * injectable so tests can point this at a temp fixture tree instead of the
 * real repo. Returns a process exit code; never calls process.exit itself.
 */
export function runCheck({ root = FORGE_ROOT, baselinePath = DEFAULT_BASELINE_PATH, docPath = DEFAULT_DOC_PATH, write = false } = {}) {
  const { reachable, rows: sinkRows } = analyze(root);
  // Combine the raw-sink rows with the caller-count dimension into ONE row
  // stream. Both key on (file, sink, count) and flow through compareBaseline /
  // formatBaseline unchanged — the `@caller` suffix is what distinguishes them.
  const callerRows = countDesignatedCallers(root, reachable);
  const rows = [...sinkRows, ...callerRows].sort((a, b) =>
    a.file === b.file ? a.sink.localeCompare(b.sink) : a.file.localeCompare(b.file)
  );
  const totalCalls = rows.reduce((sum, r) => sum + r.count, 0);
  printDocCensus(docPath);

  if (write) {
    // bead forge-8vfn.5.19, problem 2: --write is not a re-key — it
    // regenerates the WHOLE baseline from the current tree, so accepting one
    // intended row silently rewrites every other row that has drifted since
    // the baseline was last written (measured: cli/brain-lint.ts existsSync
    // 22->20, orchestrator/fix-work-items.ts's three rows deleted outright).
    // Fix: print every row that changes, so nothing is silently absorbed —
    // a human reads this before committing the regenerated file.
    const hadPriorBaseline = existsSync(baselinePath);
    const priorRows = hadPriorBaseline ? parseBaseline(readFileSync(baselinePath, 'utf8')) : [];
    const { failures: grown, tighten: dropped } = compareBaseline(rows, priorRows);
    return writeBaseline({ baselinePath, docPath, rows, grown, dropped, reachableCount: reachable.length, totalCalls, hadPriorBaseline });
  }

  if (!existsSync(baselinePath)) {
    console.error(`check-request-path-sinks: FAIL — no baseline at ${baselinePath}`);
    console.error('Run: node scripts/check-request-path-sinks.mjs --write');
    return 1;
  }

  const baselineRows = parseBaseline(readFileSync(baselinePath, 'utf8'));
  const { failures, tighten } = compareBaseline(rows, baselineRows);

  // M7 findings row 25: growth-only baselines never tighten themselves — a
  // stale-HIGH row (baseline above the real count, e.g. "pr.ts execFileSync
  // baselined 5, real 2") used to pass forever because `tighten` was
  // informational-only. It now FAILS, with the exact figure, same as growth.
  if (tighten.length) {
    console.error(
      `check-request-path-sinks: FAIL (${tighten.length} stale baseline row${tighten.length === 1 ? '' : 's'} — real count below baseline; M7 findings row 25, a stale-HIGH row must not pass forever)`
    );
    for (const t of tighten) {
      console.error(`  ✗ stale: ${t.file} ${t.sink}: baseline ${t.baselineCount} -> now ${t.count}`);
    }
    console.error('  Run: node scripts/check-request-path-sinks.mjs --write   (tightening never needs doc backing — a lower count is never a regression)');
  }

  if (failures.length) {
    console.error(
      `check-request-path-sinks: FAIL (${failures.length} new or grown sink${failures.length === 1 ? '' : 's'} reachable from a bridge route)`
    );
    for (const f of failures) {
      console.error(`  ✗ ${f.file} ${f.sink}: baseline ${f.baselineCount} -> now ${f.count}`);
    }
    printFailureGuidance(failures);
  }

  if (tighten.length || failures.length) return 1;

  console.log(
    `check-request-path-sinks: PASS — ${reachable.length} reachable modules, ${rows.length} (file,sink) rows, ${totalCalls} total sink calls, baseline ${baselineRows.length} lines`
  );
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const write = process.argv.includes('--write');
  // `process.exitCode`, never `process.exit()` — a FAIL list is unbounded and a
  // piped reader would lose its tail.
  process.exitCode = runCheck({ write });
}
