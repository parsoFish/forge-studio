#!/usr/bin/env node
/**
 * check-request-path-sinks.mjs — no-new-unguarded-sinks RATCHET.
 *
 * Why this exists: docs/security-request-path-audit.md enumerates every
 * request-derived filesystem path in cli/ and orchestrator/ as of one point
 * in time. The same defect shape (a request-derived path reaching an fs/git
 * call with no real containment) was found TWELVE times across seven
 * initiatives despite that document existing — discovery stayed luck-driven
 * because nothing forced a re-check when a NEW call site appeared. This
 * script is that force: it counts calls to a fixed list of filesystem/
 * process sinks in every module reachable from a bridge HTTP route, and
 * fails the build the moment a NEW (file, sink) pair appears or an existing
 * one's call count goes UP, until a human looks at it and updates the
 * baseline. It never goes down on its own.
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
 * Step 1 — REACHABILITY. Entry modules = cli/ui-bridge.ts plus every
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

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_BASELINE_PATH = join(FORGE_ROOT, 'scripts/request-path-sinks.baseline.txt');

const WALK_ALLOWED_PREFIXES = ['cli/', 'orchestrator/'];

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

// `(?<![.\\w$])` — unqualified calls only. See the header's "ONLY UNQUALIFIED
// CALLS ARE COUNTED" limit for the measurement behind this trade.
const SINK_MATCHERS = SINK_NAMES.map((name) => ({ name, re: new RegExp(`(?<![.\\w$])${name}\\s*\\(`, 'g') }));

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
  const fromDir = dirname(fromRelFile);
  let target = join(fromDir, spec).split('\\').join('/');
  if (!extname(target)) target = `${target}.ts`;
  if (!target.endsWith('.ts')) return null;
  if (!WALK_ALLOWED_PREFIXES.some((p) => target.startsWith(p))) return null;
  return target;
}

function listEntryModules(root) {
  const cliDir = join(root, 'cli');
  const out = [];
  for (const f of readdirSync(cliDir)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
    if (f === 'ui-bridge.ts' || f.startsWith('bridge-')) out.push(`cli/${f}`);
  }
  return out.sort();
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
    const lines = readFileSync(absFile, 'utf8').split('\n');
    const counts = new Map();
    for (const line of lines) {
      if (isCommentLine(line)) continue;
      for (const { name, re } of SINK_MATCHERS) {
        re.lastIndex = 0;
        let m;
        let n = 0;
        while ((m = re.exec(line))) n += 1;
        if (n > 0) counts.set(name, (counts.get(name) ?? 0) + n);
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

function printFailureGuidance() {
  console.error('');
  console.error('A new or grown (file, sink) pair means request-derived-path surface may have grown. Before accepting this:');
  console.error('  1. Route the path through a guard:');
  console.error("       - resolveGuardedPath(root, segments) from cli/studio-path-guard.ts — FIXED root, every untrusted id its own segments[] element (never folded into root).");
  console.error('       - or isContainedProjectRepoPath / isContainedWorktreePath / isSafeCycleId from cli/manifest-path-guard.ts.');
  console.error('  2. Add a row to docs/security-request-path-audit.md classifying the new site guarded / unguarded / accidentally-safe, per that doc\'s own rules.');
  console.error('  3. Re-run with --write to accept the new baseline:');
  console.error('       node scripts/check-request-path-sinks.mjs --write');
  console.error('');
}

/**
 * Run the check (or `--write` the baseline). Root and baseline path are
 * injectable so tests can point this at a temp fixture tree instead of the
 * real repo. Returns a process exit code; never calls process.exit itself.
 */
export function runCheck({ root = FORGE_ROOT, baselinePath = DEFAULT_BASELINE_PATH, write = false } = {}) {
  const { reachable, rows } = analyze(root);
  const totalCalls = rows.reduce((sum, r) => sum + r.count, 0);

  if (write) {
    writeFileSync(baselinePath, formatBaseline(rows));
    console.log(
      `check-request-path-sinks: baseline written — ${reachable.length} reachable modules, ${rows.length} (file,sink) rows, ${totalCalls} total sink calls`
    );
    return 0;
  }

  if (!existsSync(baselinePath)) {
    console.error(`check-request-path-sinks: FAIL — no baseline at ${baselinePath}`);
    console.error('Run: node scripts/check-request-path-sinks.mjs --write');
    return 1;
  }

  const baselineRows = parseBaseline(readFileSync(baselinePath, 'utf8'));
  const { failures, tighten } = compareBaseline(rows, baselineRows);

  if (tighten.length) {
    console.log(`check-request-path-sinks: ${tighten.length} tightenable line${tighten.length === 1 ? '' : 's'} (sink count dropped or a sink disappeared — never a regression):`);
    for (const t of tighten) {
      console.log(`  tighten: ${t.file} ${t.sink} ${t.baselineCount} -> ${t.count}`);
    }
    console.log('  These do not fail the check. Run --write if you want the baseline to reflect them.');
  }

  if (failures.length) {
    console.error(
      `check-request-path-sinks: FAIL (${failures.length} new or grown sink${failures.length === 1 ? '' : 's'} reachable from a bridge route)`
    );
    for (const f of failures) {
      console.error(`  ✗ ${f.file} ${f.sink}: baseline ${f.baselineCount} -> now ${f.count}`);
    }
    printFailureGuidance();
    return 1;
  }

  console.log(
    `check-request-path-sinks: PASS — ${reachable.length} reachable modules, ${rows.length} (file,sink) rows, ${totalCalls} total sink calls, baseline ${baselineRows.length} lines`
  );
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const write = process.argv.includes('--write');
  process.exit(runCheck({ write }));
}
