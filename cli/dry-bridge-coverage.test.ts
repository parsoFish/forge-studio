// R5-01-F2 — route-coverage drift guard.
//
// Motivation: `BRIDGE_ROUTE_CLASSIFICATION` in cli/dry-bridge.ts is a hand-written
// table (refuse | stub-actions | exempt-local | read-only) that every real-acting
// bridge route must be listed in. Nothing stops a future PR from adding a new
// route to the bridge's dispatch chain without adding a matching table row — that
// silent gap is exactly the kind of drift that caused the 2026-07-16 incident this
// seam exists to prevent. This file derives the *actual* route set straight from
// the bridge's dispatch source (there is no structured route registry to import —
// see cli/dry-bridge.ts task history) and asserts it 1:1 against the table, in
// both directions, so an unclassified OR a stale entry turns the suite red.
//
// Derivation mechanism (static, comment-stripped, line-based regex scan — no AST
// dependency, matching the style of orchestrator/pinned-sdk-query.enforce.test.ts):
//
//   1. Track function boundaries (`function name(`) to scope method gates per
//      function.
//   2. Track function-level method gates of the shape
//      `if (method !== 'X'[ && method !== 'Y']) return false;`. A single-value
//      gate resolves every un-annotated route inside that function to that
//      method; a two-value gate resolves to ambiguous ('*'); no gate (or a
//      differently-shaped gate, e.g. wrapping a block instead of an early
//      return — the CSRF check in ui-bridge.ts is deliberately NOT matched)
//      also resolves to '*'.
//   3. Track `const xMatch = url.match(/regex/)` assignments, canonicalizing the
//      regex source into a route-shaped string (strip ^/$, un-escape \/, replace
//      flat capture groups with :id).
//   4. On any `if (...)` line, resolve the route via (in combination): a literal
//      `url === '...'` (possibly several per line, e.g. `a || b`), a same-line
//      `url.startsWith('prefix')[ + url.endsWith('suffix')]` pair, or a
//      previously-registered match-var referenced by name.
//   5. Every route whose resolved method is GET is dropped — GET is blanket-
//      covered by the table's single `{ method: 'GET', route: '*' }` row.
//
// Known failure mode / accepted precision limits (documented per the task's
// design constraints, mirroring pinned-sdk-query's own "known limitation"
// stance rather than claiming full soundness):
//
//   - Only three dispatch shapes are recognised (literal, startsWith/endsWith,
//     match-var-by-name). A genuinely novel 4th shape (a switch, a lookup
//     table, an inline `.match()` never bound to a name) would silently NOT be
//     picked up. All six files this guard scans were audited by hand against
//     this list at write time and contain no other shape. Dispatch *files*
//     are auto-discovered from cli/ by naming convention (ui-bridge.ts +
//     bridge-*.ts, tests excluded), so a new dispatch file following the
//     convention is scanned automatically — over-scanning a non-dispatch
//     match is harmless (zero candidates) or visibly red, never silent — and
//     a containment test pins the known six as a floor so a narrowed
//     discovery filter also goes red. (A dispatch file named entirely outside
//     that convention would still dodge the scan; naming review carries that
//     residue.)
//   - Two reconciliation special cases are required because the real dispatch
//     multiplexes on more than the URL: the `/api/runs/:id/gates/:id` double
//     placeholder (gateId is 'plan' | 'verdict', chosen by URL suffix in the
//     table but by the same regex capture group in code) is satisfied by any
//     table row under `/api/runs/:id/gates/`; and the KB-maintenance route's
//     `op` body field multiplexing means multiple ` (op=...)`-suffixed table
//     rows legitimately collapse onto one derived candidate. Both are
//     many-to-one matches, which the existential (some()) matching below
//     supports natively without extra bookkeeping.
//   - `RouteClassification.method` cannot express DELETE (its union is
//     'GET' | 'POST' | 'PUT' | '*'); the one DELETE route is instead encoded as
//     a `(delete)`-suffixed route string with `method: 'POST'`. This guard
//     detects that suffix and overrides the effective method to DELETE for
//     matching purposes — a real modelling gap in the table worth tightening
//     separately, not fixed here to keep this change minimal and behaviour-
//     preserving.
//
// Task A-finalfix FIX 4: direction 1/2 above only prove a route STRING is
// classified and that classification corresponds to SOME real dispatch line
// — they say nothing about whether that classification is actually enforced.
// A future `guard: 'route'` refuse row whose handler never actually calls
// `refuseDryBridge` would pass both directions silently (the route text
// exists in both places; nothing checks the handler body). A third test below
// closes that specific window: for every `guard: 'route'` refuse row, the
// scanned dispatch sources must contain a `refuseDryBridge(` call carrying
// that row's verbatim `route` string. So the remaining silent windows are, in
// combination: (a) the 4th-dispatch-shape / off-convention-filename gaps
// above, AND (b) classification-vs-guard-site divergence for anything this
// guard does NOT scan for a call site — currently only `guard: 'route'` refuse
// rows are checked this way; `guard: 'spawn-helper'` stub-actions rows (whose
// enforcement is an inline `|| isDryBridge()` OR inside a private spawn
// helper, not a named call this static scan can grep for) and un-guarded
// `stub-actions` rows (verdict-approve, reflect-answer — enforced via
// `emitDryBridgeSkip`/`dryBridgeAgentTurnMarker` call sites with no fixed
// argument shape to grep) are NOT parity-checked here; their red-on-regression
// coverage instead lives in the per-route unit tests
// (cli/ui-bridge-dry-spawn.test.ts, cli/ui-bridge-reflect.test.ts, FIX 3).
// Review carries that residual divergence risk. Scanner-precision limits
// beyond dispatch-shape (two-value method gates collapsing to the ambiguous
// '*', the inline-regex-literal requirement for match-var routes, the
// DELETE-as-POST-suffix encoding above) are likewise accepted, documented
// residue — owner R7 (docs/roadmaps/R7-verification-infrastructure.md).
//
// Both directions are asserted: every derived real route must have a table
// entry (direction 1 — the AC's "unclassified route" case), and every table
// entry must correspond to a real derived route (direction 2 — no stale
// entries). This second direction is not hypothetical: it caught a genuinely
// stale row (`PUT /api/studio/kbs/:id`, no dispatch code anywhere) during this
// task's own development, which was removed as part of landing this guard.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIDGE_ROUTE_CLASSIFICATION, type RouteClassification } from './dry-bridge.ts';

const CLI_DIR = dirname(fileURLToPath(import.meta.url));
const DRY_BRIDGE_TABLE_PATH = 'cli/dry-bridge.ts';

// The dispatch-file set is DERIVED from the cli/ directory, not hand-listed:
// ui-bridge.ts plus every bridge-*.ts, tests excluded. Over-scanning a
// non-dispatch file that happens to match is harmless (zero candidates) or
// visibly red (unclassified candidates) — never silent. The containment test
// below pins the currently-known dispatch files as a floor so an accidental
// narrowing of this filter also goes red.
function discoverDispatchFiles(): readonly string[] {
  return readdirSync(CLI_DIR)
    .filter((f) => !f.endsWith('.test.ts'))
    .filter((f) => f === 'ui-bridge.ts' || (f.startsWith('bridge-') && f.endsWith('.ts')))
    .sort();
}

// Floor, not ceiling: discovery must always include at least these.
const KNOWN_DISPATCH_FILES = [
  'bridge-recovery.ts',
  'bridge-studio-kbs.ts',
  'bridge-studio-runs.ts',
  'bridge-studio-writes.ts',
  'bridge-studio.ts',
  'ui-bridge.ts',
] as const;

type DerivedCandidate = { route: string; method: string; file: string; line: number };

// Adapted from orchestrator/pinned-sdk-query.enforce.test.ts's stripComments —
// duplicated locally to keep this guard self-contained, matching that file's
// own precedent of not sharing a cross-cutting helper module for a single
// small function.
function stripComments(source: string): string {
  let out = '';
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        out += '  ';
        i += 1;
      } else if (ch === '/' && next === '*') {
        state = 'block';
        out += '  ';
        i += 1;
      } else if (ch === "'") {
        state = 'single';
        out += ch;
      } else if (ch === '"') {
        state = 'double';
        out += ch;
      } else if (ch === '`') {
        state = 'template';
        out += ch;
      } else {
        out += ch;
      }
    } else if (state === 'line') {
      out += ch === '\n' ? '\n' : ' ';
      if (ch === '\n') state = 'code';
    } else if (state === 'block') {
      out += ch === '\n' ? '\n' : ' ';
      if (ch === '*' && next === '/') {
        out += ' ';
        i += 1;
        state = 'code';
      }
    } else if (state === 'single' || state === 'double' || state === 'template') {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"') || (state === 'template' && ch === '`')) {
        state = 'code';
      }
    }
  }
  return out;
}

const FUNCTION_BOUNDARY_RE = /^(?:export )?(?:async )?function\s+\w+/;
const GATE_RE = /^\s*if\s*\(\s*method\s*!==\s*'([A-Z]+)'(?:\s*&&\s*method\s*!==\s*'([A-Z]+)')?\s*\)\s*return\s+false;/;
const MATCH_ASSIGN_RE = /^\s*const\s+(\w+)\s*=\s*url\.match\(\/(.+?)\/\)/;
const IF_LINE_RE = /(^|\s)if\s*\(/;
const EXPLICIT_METHOD_RE = /method\s*===\s*'([A-Z]+)'/;
const LITERAL_URL_RE = /url\s*===\s*'([^']+)'/g;
const STARTS_WITH_RE = /url\.startsWith\('([^']+)'\)/;
const ENDS_WITH_RE = /url\.endsWith\('([^']+)'\)/;

function canonicalizeRegexSource(src: string): string {
  let r = src;
  if (r.startsWith('^')) r = r.slice(1);
  if (r.endsWith('$')) r = r.slice(0, -1);
  r = r.replace(/\\\//g, '/');
  r = r.replace(/\([^()]*\)/g, ':id');
  return r;
}

function extractDispatchCandidates(source: string, fileLabel: string): DerivedCandidate[] {
  const lines = stripComments(source).split('\n');
  const candidates: DerivedCandidate[] = [];
  const matchVars = new Map<string, string>();
  let gate: Set<string> | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    const lineNum = i + 1;

    if (FUNCTION_BOUNDARY_RE.test(lineText)) {
      gate = null;
      continue;
    }
    const gateMatch = GATE_RE.exec(lineText);
    if (gateMatch) {
      gate = new Set([gateMatch[1], gateMatch[2]].filter((v): v is string => Boolean(v)));
      continue;
    }
    const assignMatch = MATCH_ASSIGN_RE.exec(lineText);
    if (assignMatch) {
      matchVars.set(assignMatch[1], canonicalizeRegexSource(assignMatch[2]));
      continue;
    }
    if (!IF_LINE_RE.test(lineText)) continue;

    const explicit = EXPLICIT_METHOD_RE.exec(lineText);
    let method: string;
    if (explicit) {
      method = explicit[1];
    } else if (gate && gate.size === 1) {
      method = [...gate][0];
    } else {
      method = '*'; // ambiguous multi-value gate, or no gate at all
    }
    if (method === 'GET') continue; // blanket-covered by the table's wildcard GET row

    LITERAL_URL_RE.lastIndex = 0;
    let lm: RegExpExecArray | null;
    while ((lm = LITERAL_URL_RE.exec(lineText))) {
      candidates.push({ route: lm[1], method, file: fileLabel, line: lineNum });
    }

    const sw = STARTS_WITH_RE.exec(lineText);
    if (sw) {
      const ew = ENDS_WITH_RE.exec(lineText);
      const route = ew ? `${sw[1]}:id${ew[1]}` : `${sw[1]}:id`;
      candidates.push({ route, method, file: fileLabel, line: lineNum });
    }

    for (const [varName, route] of matchVars) {
      if (new RegExp(`\\b${varName}\\b`).test(lineText)) {
        candidates.push({ route, method, file: fileLabel, line: lineNum });
      }
    }
  }
  return candidates;
}

type TableCanonical = { route: string; method: string };

function canonicalizeTableRow(row: RouteClassification): TableCanonical {
  const isDeleteSuffixed = / \(delete\)$/.test(row.route);
  const route = row.route
    .replace(/ \(delete\)$/, '')
    .replace(/ \(op=[^)]*\)$/, '')
    .replace(/:[A-Za-z][A-Za-z0-9]*/g, ':id');
  return { route, method: isDeleteSuffixed ? 'DELETE' : row.method };
}

const GATES_DOUBLE_ID_ROUTE = '/api/runs/:id/gates/:id';
const GATES_ROUTE_PREFIX = '/api/runs/:id/gates/';

function routeTextsEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  // The gates route multiplexes plan/verdict via a URL capture group in code
  // but via two distinct suffixed table rows — see header comment.
  if (a === GATES_DOUBLE_ID_ROUTE && b.startsWith(GATES_ROUTE_PREFIX)) return true;
  if (b === GATES_DOUBLE_ID_ROUTE && a.startsWith(GATES_ROUTE_PREFIX)) return true;
  return false;
}

function methodsEquivalent(a: string, b: string): boolean {
  return a === '*' || b === '*' || a === b;
}

function loadAllCandidates(): DerivedCandidate[] {
  const all: DerivedCandidate[] = [];
  for (const relFile of discoverDispatchFiles()) {
    const source = readFileSync(join(CLI_DIR, relFile), 'utf8');
    all.push(...extractDispatchCandidates(source, `cli/${relFile}`));
  }
  return all;
}

test('every derived non-GET bridge route is covered by BRIDGE_ROUTE_CLASSIFICATION (direction 1)', () => {
  const tableCanonical = BRIDGE_ROUTE_CLASSIFICATION.map(canonicalizeTableRow);
  const offenders: string[] = [];

  for (const c of loadAllCandidates()) {
    const covered = tableCanonical.some(
      (t) => routeTextsEquivalent(c.route, t.route) && methodsEquivalent(c.method, t.method),
    );
    if (!covered) {
      offenders.push(
        `${c.file}:${c.line} — ${c.method} ${c.route} has no entry in BRIDGE_ROUTE_CLASSIFICATION ` +
          `(${DRY_BRIDGE_TABLE_PATH}); classify it there (refuse | stub-actions | exempt-local | read-only) before merging.`,
      );
    }
  }

  assert.deepEqual(offenders, [], `unclassified/unguarded bridge routes found:\n${offenders.join('\n')}`);
});

test('every BRIDGE_ROUTE_CLASSIFICATION entry corresponds to a real dispatch route (direction 2, no stale entries)', () => {
  const allCandidates = loadAllCandidates();
  const offenders: string[] = [];

  for (const row of BRIDGE_ROUTE_CLASSIFICATION) {
    if (row.method === 'GET' && row.route === '*') continue; // deliberate blanket row, not one dispatch line
    const canonical = canonicalizeTableRow(row);
    const found = allCandidates.some(
      (c) => routeTextsEquivalent(c.route, canonical.route) && methodsEquivalent(c.method, canonical.method),
    );
    if (!found) {
      offenders.push(
        `${DRY_BRIDGE_TABLE_PATH}: "${row.method} ${row.route}" (classification=${row.classification}) has no ` +
          'corresponding real dispatch route found in the scanned bridge files — stale table entry?',
      );
    }
  }

  assert.deepEqual(offenders, [], `stale BRIDGE_ROUTE_CLASSIFICATION entries found:\n${offenders.join('\n')}`);
});

test('sanity: the derivation scan finds a non-trivial number of real routes (guard is not vacuous)', () => {
  const total = loadAllCandidates().length;
  assert.ok(total > 35, `expected > 35 derived non-GET routes across the scanned dispatch files, got ${total}`);
});

test('sanity: dispatch-file discovery contains every currently-known dispatch file', () => {
  const discovered = discoverDispatchFiles();
  const missing = KNOWN_DISPATCH_FILES.filter((f) => !discovered.includes(f));
  assert.deepEqual(
    missing,
    [],
    `dispatch-file discovery lost known bridge dispatch files: ${missing.join(', ')} — was the cli/ filename filter in this test narrowed?`,
  );
});

// ---------------------------------------------------------------------------
// FIX 4 — classification-vs-guard-site parity: a `guard: 'route'` refuse row
// is only load-bearing if the handler it describes actually calls
// refuseDryBridge(...) with that verbatim route. Scans the comment-stripped
// source for every `refuseDryBridge(` call and pulls its `route: '...'`
// argument regardless of whether the call is single-line or (as with
// bridge-studio-kbs.ts's fix-agent op) spans multiple lines/arguments.
// ---------------------------------------------------------------------------
const REFUSE_CALL_RE = /refuseDryBridge\(\s*res\s*,\s*origin\s*,\s*\{[^}]*?\broute:\s*'([^']+)'/gs;

function extractRefuseDryBridgeRoutes(source: string): Set<string> {
  const stripped = stripComments(source);
  const routes = new Set<string>();
  REFUSE_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REFUSE_CALL_RE.exec(stripped))) {
    routes.add(m[1]);
  }
  return routes;
}

test("every guard:'route' refuse row has a matching refuseDryBridge( call site (FIX 4: classified-but-unguarded routes must not pass silently)", () => {
  const guardedRefuseRows = BRIDGE_ROUTE_CLASSIFICATION.filter(
    (r) => r.classification === 'refuse' && r.guard === 'route',
  );
  assert.ok(guardedRefuseRows.length > 0, "sanity: expected at least one guard:'route' refuse row to exist");

  const calledRoutes = new Set<string>();
  for (const relFile of discoverDispatchFiles()) {
    const source = readFileSync(join(CLI_DIR, relFile), 'utf8');
    for (const route of extractRefuseDryBridgeRoutes(source)) calledRoutes.add(route);
  }

  const offenders: string[] = [];
  for (const row of guardedRefuseRows) {
    if (!calledRoutes.has(row.route)) {
      offenders.push(
        `${DRY_BRIDGE_TABLE_PATH}: "${row.method} ${row.route}" is classified refuse/guard:'route' but no ` +
          "refuseDryBridge( call site carrying that verbatim route string was found across the scanned " +
          'dispatch files — a classification-vs-guard-site divergence (this row can pass direction-1/2 above ' +
          'purely because the route text exists somewhere, while its own handler never actually refuses).',
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `guard:'route' rows with no matching refuseDryBridge( call site:\n${offenders.join('\n')}`,
  );
});

test('fixture: extractRefuseDryBridgeRoutes matches a single-line refuseDryBridge( call', () => {
  const src = [
    "async function handleFoo(req, res, url, method, origin, ctx) {",
    "  refuseDryBridge(res, origin, { route: '/api/thing/:id/resume', method, action: 'git-remote', logsRoot: ctx.logsRoot });",
    '}',
  ].join('\n');
  assert.deepEqual(extractRefuseDryBridgeRoutes(src), new Set(['/api/thing/:id/resume']));
});

test('fixture: extractRefuseDryBridgeRoutes matches a multi-line refuseDryBridge( call (the bridge-studio-kbs.ts fix-agent shape)', () => {
  const src = [
    "async function handleFoo(req, res, url, method, origin, ctx) {",
    '  refuseDryBridge(res, origin, {',
    "    route: '/api/studio/kbs/:id/maintenance (op=fix-agent)', method, action: 'spawn-agent', logsRoot: ctx.logsRoot,",
    '  });',
    '}',
  ].join('\n');
  assert.deepEqual(
    extractRefuseDryBridgeRoutes(src),
    new Set(['/api/studio/kbs/:id/maintenance (op=fix-agent)']),
  );
});

test('fixture: literal url match with explicit method is extracted', () => {
  const src = "async function handleFoo(req, res) {\n  if (method === 'POST' && url === '/api/thing') {\n    return true;\n  }\n}\n";
  const c = extractDispatchCandidates(src, 'fixture.ts');
  assert.deepEqual(c.map((x) => [x.method, x.route]), [['POST', '/api/thing']]);
});

test('fixture: GET routes are excluded (blanket wildcard coverage)', () => {
  const src = "async function handleFoo(req, res) {\n  if (method === 'GET' && url === '/api/thing') {\n    return true;\n  }\n}\n";
  assert.deepEqual(extractDispatchCandidates(src, 'fixture.ts'), []);
});

test('fixture: a single-value function gate resolves the method for un-annotated routes', () => {
  const src = [
    'async function handleFoo(req, res, url, method) {',
    "  if (method !== 'POST') return false;",
    "  if (url === '/api/thing') {",
    '    return true;',
    '  }',
    '}',
  ].join('\n');
  const c = extractDispatchCandidates(src, 'fixture.ts');
  assert.deepEqual(c.map((x) => [x.method, x.route]), [['POST', '/api/thing']]);
});

test('fixture: a multi-value function gate resolves un-annotated routes as ambiguous', () => {
  const src = [
    'async function handleFoo(req, res, url, method) {',
    "  if (method !== 'PUT' && method !== 'POST') return false;",
    '  const thingMatch = url.match(/^\\/api\\/thing\\/([^/]+)$/);',
    '  if (thingMatch) {',
    '    return true;',
    '  }',
    '}',
  ].join('\n');
  const c = extractDispatchCandidates(src, 'fixture.ts');
  assert.deepEqual(c.map((x) => [x.method, x.route]), [['*', '/api/thing/:id']]);
});

test('fixture: startsWith+endsWith on the same line builds a :id-bracketed route', () => {
  const src = [
    'async function handleFoo(req, res, url, method) {',
    "  if (method === 'POST' && url.startsWith('/api/review-comments/') && url.endsWith('/resolve')) {",
    '    return true;',
    '  }',
    '}',
  ].join('\n');
  const c = extractDispatchCandidates(src, 'fixture.ts');
  assert.deepEqual(c.map((x) => [x.method, x.route]), [['POST', '/api/review-comments/:id/resolve']]);
});

test('fixture: two url literals ORed on one line each get their own candidate', () => {
  const src = [
    'async function handleFoo(req, res, url, method) {',
    "  if (method === 'POST' && (url === '/api/a' || url === '/api/b')) {",
    '    return true;',
    '  }',
    '}',
  ].join('\n');
  const c = extractDispatchCandidates(src, 'fixture.ts').map((x) => [x.method, x.route]);
  assert.deepEqual(
    c.sort((x, y) => x[1].localeCompare(y[1])),
    [['POST', '/api/a'], ['POST', '/api/b']],
  );
});

test('fixture: a block-bodied method check (e.g. the CSRF gate shape) is not tracked as a function gate', () => {
  const src = [
    'async function handleFoo(req, res, url, method) {',
    "  if (method !== 'GET' && method !== 'OPTIONS') {",
    '    if (!true) { return; }',
    '  }',
    "  if (url === '/api/thing') {",
    '    return true;',
    '  }',
    '}',
  ].join('\n');
  const c = extractDispatchCandidates(src, 'fixture.ts');
  // no gate recognised -> ambiguous '*', not silently excluded as GET.
  assert.deepEqual(c.map((x) => [x.method, x.route]), [['*', '/api/thing']]);
});
