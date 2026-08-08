/**
 * ACCEPTANCE PINS (SEC-04, bd forge-ebj) — the CYCLE-ID route family. Six bridge
 * routes fold a request-supplied `cycleId` straight into a `_logs/<cycleId>/...`
 * path with NO per-segment containment guard (they predate the SEC-04 sweep):
 *
 *   GET  /api/events/<cycleId>        → join(logsRoot, cycleId, 'events.jsonl')      (ui-bridge.ts)
 *   GET  /api/cost/<cycleId>          → summariseCycle(cycleId, logsRoot)            (metrics.ts)
 *   GET  /api/artifact/<cid>/<file>   → join(logsRoot, cid, 'artifacts', file)       (ui-bridge.ts)
 *   GET  /api/work-item/<cid>/<wiId>  → join(logsRoot, cid, 'work-items-snapshot', ..)(ui-bridge.ts)
 *   GET  /api/reflect/<cycleId>       → join(logsRoot, cycleId)/user-questions.json  (ui-bridge.ts)
 *   POST /api/reflect/<cycleId>/answer→ writeFileSync(join(dir,'user-feedback.md'))  (ui-bridge.ts)
 *
 * TWO ESCAPE VECTORS per route, per the brief:
 *
 *   (a) %2F-SMUGGLED TRAVERSAL. `cycleId` is `decodeURIComponent`'d, so a literal
 *       "/" must ride as `%2F` and be issued RAW (node:http) — `fetch()` would
 *       fold it client-side. events / cost / reflect(GET/answer) take the WHOLE
 *       remainder as cycleId, so a multi-level `../../..` escapes `_logs` entirely.
 *       (artifact + work-item `decodeURIComponent` the whole tail THEN split on the
 *       first "/", so cycleId cannot itself carry a slash — see each below.)
 *
 *   (b) SYMLINKED LEAF / DIR. A genuinely in-root `_logs/<cid>/` whose leaf
 *       (events.jsonl / user-questions.json / user-feedback.md / WI-<n>.md /
 *       artifacts/<file>) — or whose own directory — is a SYMLINK to an
 *       out-of-root victim. `existsSync`+`readFileSync`/`writeFileSync`/`readdir`
 *       all FOLLOW the link. This is the leaf-symlink family the dir-level guard
 *       cannot see; artifact's own `requested.startsWith(safeBase)` is lexical and
 *       passes a symlinked leaf straight through.
 *
 * artifact ALSO carries a shipped charset guard on cycleId (`/^[A-Za-z0-9._-]+$/`
 * + `.includes('..')`) — so its `%2F`/`..` traversal is ALREADY closed (asserted
 * GREEN below, to mark it not-the-RED-vector); its live hole is the symlinked leaf.
 *
 * Every disclosure/overwrite is asserted against the ARTIFACT (sentinel bytes /
 * byte-identical victim), never merely a status code. Victims live OUTSIDE both
 * projectsRoot AND forgeRoot (under os.tmpdir()); preconditions asserted by
 * execution first (immutable-gates false-negative discipline).
 *
 * RED-ON-CURRENT-CODE: every `(RED)` FAILS at this HEAD.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  lstatSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';

import { startBridge } from './ui-bridge.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

let forgeRoot: string;
let logsRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

/** Percent-encode every "/" as "%2F" so a multi-segment traversal survives as a
 *  SINGLE encoded cycleId until the route's own `decodeURIComponent`. */
function encodeSlashes(p: string): string {
  return p.split('/').map(encodeURIComponent).join('%2F');
}

/** Raw HTTP issuing EXACTLY `rawPath` on the wire (no URL-parser normalisation)
 *  — the only way the `%2F` shapes reach the server encoded, not folded away. */
function rawRequest(
  base: string,
  opts: { method: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(base);
    const req = httpRequest(
      { host: u.hostname, port: u.port, path: opts.path, method: opts.method, headers: opts.headers },
      (r) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => resolvePromise({ status: r.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

function is4xx(status: number): boolean {
  return status >= 400 && status < 500;
}

/** A valid work-item markdown (parseWorkItem needs work_item_id + initiative_id
 *  frontmatter) whose BODY carries a sentinel — a 200 echoing it proves a read. */
function workItemMd(sentinel: string): string {
  return `---\nwork_item_id: WI-1\ninitiative_id: INIT-victim\n---\n${sentinel}\n`;
}

before(async () => {
  forgeRoot = tmp('sec04-cycleid-forge-');
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  logsRoot = join(forgeRoot, '_logs');
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });

  const probe = tmp('sec04-cycleid-symlink-probe-');
  try {
    symlinkSync(probe, join(logsRoot, '__symlink_probe__'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(join(logsRoot, '__symlink_probe__'), { force: true });
  rmSync(probe, { recursive: true, force: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  process.env.FORGE_DRY_BRIDGE = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

/** cycleId that traverses from logsRoot out to `outside`, asserted to genuinely
 *  step out (first segment is `..`). */
function traversalCycleId(outside: string): string {
  const rel = relative(logsRoot, outside);
  assert.equal(rel.split(sep)[0], '..', 'sanity: the traversal cycleId must genuinely step outside logsRoot');
  return rel;
}

// ---------------------------------------------------------------------------
// Positive controls — MUST pass before AND after any fix.
// ---------------------------------------------------------------------------

test('positive control: GET /api/events/<real cycle> returns the in-root events', async () => {
  const cid = 'real-events-cycle';
  mkdirSync(join(logsRoot, cid), { recursive: true });
  writeFileSync(join(logsRoot, cid, 'events.jsonl'), JSON.stringify({ initiative_id: 'i', phase: 'architect', skill: 's', event_type: 'start' }) + '\n');
  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/events/${cid}` });
  assert.equal(r.status, 200, `real events must return 200 — got ${r.status}: ${r.body}`);
});

test('positive control: GET /api/work-item/<real>/WI-1 returns the in-root work item', async () => {
  const cid = 'real-wi-cycle';
  mkdirSync(join(logsRoot, cid, 'work-items-snapshot'), { recursive: true });
  writeFileSync(join(logsRoot, cid, 'work-items-snapshot', 'WI-1.md'), workItemMd('LEGIT-WI-BODY'));
  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/work-item/${cid}/WI-1` });
  assert.equal(r.status, 200, `real work item must return 200 — got ${r.status}: ${r.body}`);
  assert.ok(r.body.includes('LEGIT-WI-BODY'), 'the real work-item body should be served');
});

test('positive control: POST /api/reflect/<real>/answer writes user-feedback.md in root', async () => {
  const cid = 'real-reflect-cycle';
  mkdirSync(join(logsRoot, cid), { recursive: true });
  const r = await rawRequest(bridgeUrl, {
    method: 'POST', path: `/api/reflect/${cid}/answer`, headers: CSRF,
    body: JSON.stringify({ answers: [], freeform: 'ok' }),
  });
  assert.equal(r.status, 200, `real reflect answer must return 200 — got ${r.status}: ${r.body}`);
  assert.ok(existsSync(join(logsRoot, cid, 'user-feedback.md')), 'feedback must land in the real in-root cycle dir');
});

// ===========================================================================
// GET /api/events/<cycleId>
// ===========================================================================

test('(RED) GET /api/events with a %2F-smuggled "../.." cycleId discloses an out-of-root events.jsonl', async () => {
  const outside = newOutsideDir('sec04-events-trav-outside-');
  const SENTINEL = 'PWNED-EVENTS-TRAVERSAL-a11ce';
  writeFileSync(join(outside, 'events.jsonl'), JSON.stringify({ initiative_id: SENTINEL, phase: 'architect', skill: 's', event_type: 'start' }) + '\n');
  const cid = traversalCycleId(outside);

  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/events/${encodeSlashes(cid)}` });
  assert.ok(!r.body.includes(SENTINEL), `a "../.." cycleId served an out-of-root events.jsonl — status ${r.status}: ${r.body}`);
  assert.ok(is4xx(r.status), `a traversal cycleId must be rejected 4xx — got ${r.status}: ${r.body}`);
});

test('(RED) GET /api/events with a symlinked events.jsonl leaf discloses an out-of-root file', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-events-leaf-outside-');
  const SENTINEL = 'PWNED-EVENTS-LEAF-b22df';
  writeFileSync(join(outside, 'victim-events.jsonl'), JSON.stringify({ initiative_id: SENTINEL, phase: 'architect', skill: 's', event_type: 'start' }) + '\n');
  const cid = 'events-leaf-cycle';
  mkdirSync(join(logsRoot, cid), { recursive: true });
  symlinkSync(join(outside, 'victim-events.jsonl'), join(logsRoot, cid, 'events.jsonl'), 'file');
  assert.ok(lstatSync(join(logsRoot, cid, 'events.jsonl')).isSymbolicLink(), 'precondition: events.jsonl is a symlink');

  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/events/${cid}` });
  assert.ok(!r.body.includes(SENTINEL), `a symlinked events.jsonl leaf served out-of-root content — status ${r.status}: ${r.body}`);
});

// ===========================================================================
// GET /api/cost/<cycleId>
// ===========================================================================

test('(RED) GET /api/cost with a %2F-smuggled "../.." cycleId aggregates an out-of-root events.jsonl', async () => {
  const outside = newOutsideDir('sec04-cost-trav-outside-');
  // A single authoritative 'end' cost event → total_cost_usd = 42.42 IFF read.
  writeFileSync(join(outside, 'events.jsonl'), JSON.stringify({ initiative_id: 'v', phase: 'architect', skill: 's', event_type: 'end', cost_usd: 42.42 }) + '\n');
  const cid = traversalCycleId(outside);

  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/cost/${encodeSlashes(cid)}` });
  let totalUsd: unknown = null;
  try { totalUsd = (JSON.parse(r.body) as { totalUsd?: unknown }).totalUsd; } catch { /* non-JSON body */ }
  assert.notEqual(totalUsd, 42.42, `a "../.." cycleId aggregated cost from an out-of-root events.jsonl — status ${r.status}: ${r.body}`);
});

// ===========================================================================
// GET /api/artifact/<cycleId>/<filename>
// ===========================================================================

test('GREEN control: GET /api/artifact rejects a "../" cycleId via the shipped charset guard (NOT the RED vector)', async () => {
  // artifact `decodeURIComponent`s the tail THEN splits on the first "/", so a
  // single "%2E%2E" decodes to `..` and the charset/`.includes('..')` guard
  // rejects it. This documents that artifact's TRAVERSAL is already closed — the
  // symlinked leaf below is its live hole.
  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/artifact/%2E%2E/etc-passwd` });
  assert.ok(is4xx(r.status), `artifact must reject a "../" cycleId (shipped guard) — got ${r.status}: ${r.body}`);
});

test('(RED) GET /api/artifact with a symlinked leaf inside a real artifacts dir serves an out-of-root file', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-artifact-leaf-outside-');
  const SENTINEL = 'PWNED-ARTIFACT-LEAF-c33ef';
  writeFileSync(join(outside, 'secret.txt'), SENTINEL);
  const cid = 'artifact-leaf-cycle';
  mkdirSync(join(logsRoot, cid, 'artifacts'), { recursive: true });
  symlinkSync(join(outside, 'secret.txt'), join(logsRoot, cid, 'artifacts', 'evil.txt'), 'file');
  assert.ok(lstatSync(join(logsRoot, cid, 'artifacts', 'evil.txt')).isSymbolicLink(), 'precondition: the artifact leaf is a symlink');

  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/artifact/${cid}/evil.txt` });
  assert.ok(!r.body.includes(SENTINEL), `the lexical startsWith(safeBase) check passed a symlinked leaf — an out-of-root artifact was served — status ${r.status}: ${r.body}`);
  assert.ok(is4xx(r.status), `a symlinked artifact leaf must be rejected 4xx — got ${r.status}: ${r.body}`);
});

// ===========================================================================
// GET /api/work-item/<cycleId>/<wiId>
// ===========================================================================

test('(RED) GET /api/work-item with a symlinked cycleId DIRECTORY discloses an out-of-root work item', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-wi-dir-outside-');
  const SENTINEL = 'PWNED-WORKITEM-DIRSYMLINK-d44a0';
  mkdirSync(join(outside, 'work-items-snapshot'), { recursive: true });
  writeFileSync(join(outside, 'work-items-snapshot', 'WI-1.md'), workItemMd(SENTINEL));
  // A `_logs/<cid>` that is itself a symlink to the out-of-root victim dir.
  symlinkSync(outside, join(logsRoot, 'wi-dir-cycle'), 'dir');

  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/work-item/wi-dir-cycle/WI-1` });
  assert.ok(!r.body.includes(SENTINEL), `a symlinked _logs/<cycleId> dir served an out-of-root work item — status ${r.status}: ${r.body}`);
  assert.ok(is4xx(r.status), `a symlinked cycleId dir must be rejected 4xx — got ${r.status}: ${r.body}`);
});

test('(RED) GET /api/work-item with a symlinked WI-<n>.md leaf discloses an out-of-root work item', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-wi-leaf-outside-');
  const SENTINEL = 'PWNED-WORKITEM-LEAF-e55b1';
  writeFileSync(join(outside, 'victim-WI.md'), workItemMd(SENTINEL));
  const cid = 'wi-leaf-cycle';
  mkdirSync(join(logsRoot, cid, 'work-items-snapshot'), { recursive: true });
  symlinkSync(join(outside, 'victim-WI.md'), join(logsRoot, cid, 'work-items-snapshot', 'WI-1.md'), 'file');
  assert.ok(lstatSync(join(logsRoot, cid, 'work-items-snapshot', 'WI-1.md')).isSymbolicLink(), 'precondition: the WI leaf is a symlink');

  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/work-item/${cid}/WI-1` });
  assert.ok(!r.body.includes(SENTINEL), `a symlinked WI-1.md leaf served an out-of-root work item — status ${r.status}: ${r.body}`);
  assert.ok(is4xx(r.status), `a symlinked WI leaf must be rejected 4xx — got ${r.status}: ${r.body}`);
});

// ===========================================================================
// GET /api/reflect/<cycleId>
// ===========================================================================

test('(RED) GET /api/reflect with a %2F-smuggled "../.." cycleId discloses out-of-root user-questions.json', async () => {
  const outside = newOutsideDir('sec04-reflect-get-trav-outside-');
  const SENTINEL = 'PWNED-REFLECT-QUESTION-f66c2';
  writeFileSync(join(outside, 'user-questions.json'), JSON.stringify([{ question: SENTINEL }]));
  const cid = traversalCycleId(outside);

  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/reflect/${encodeSlashes(cid)}` });
  assert.ok(!r.body.includes(SENTINEL), `a "../.." cycleId disclosed an out-of-root user-questions.json — status ${r.status}: ${r.body}`);
  assert.ok(is4xx(r.status), `a traversal cycleId must be rejected 4xx — got ${r.status}: ${r.body}`);
});

test('(RED) GET /api/reflect with a symlinked user-questions.json leaf discloses an out-of-root file', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-reflect-get-leaf-outside-');
  const SENTINEL = 'PWNED-REFLECT-QUESTION-LEAF-a77d3';
  writeFileSync(join(outside, 'victim-questions.json'), JSON.stringify([{ question: SENTINEL }]));
  const cid = 'reflect-get-leaf-cycle';
  mkdirSync(join(logsRoot, cid), { recursive: true });
  symlinkSync(join(outside, 'victim-questions.json'), join(logsRoot, cid, 'user-questions.json'), 'file');
  assert.ok(lstatSync(join(logsRoot, cid, 'user-questions.json')).isSymbolicLink(), 'precondition: user-questions.json is a symlink');

  const r = await rawRequest(bridgeUrl, { method: 'GET', path: `/api/reflect/${cid}` });
  assert.ok(!r.body.includes(SENTINEL), `a symlinked user-questions.json leaf disclosed out-of-root content — status ${r.status}: ${r.body}`);
});

// ===========================================================================
// POST /api/reflect/<cycleId>/answer  (WRITE)
// ===========================================================================

test('(RED) POST /api/reflect/<..>/answer with a %2F-smuggled "../.." cycleId overwrites an out-of-root user-feedback.md', async () => {
  const outside = newOutsideDir('sec04-reflect-answer-trav-outside-');
  const victim = join(outside, 'user-feedback.md');
  writeFileSync(victim, 'ORIGINAL-VICTIM-FEEDBACK-BYTES-b88e4');
  const before = readFileSync(victim);
  const cid = traversalCycleId(outside); // dir must exist for the route to proceed

  const r = await rawRequest(bridgeUrl, {
    method: 'POST', path: `/api/reflect/${encodeSlashes(cid)}/answer`, headers: CSRF,
    body: JSON.stringify({ answers: [], freeform: 'PWNED-FEEDBACK-c99f5' }),
  });
  assert.ok(
    readFileSync(victim).equals(before),
    `a "../.." cycleId let reflect-answer overwrite an out-of-root user-feedback.md — status ${r.status}: ${r.body}`,
  );
  assert.ok(is4xx(r.status), `a traversal cycleId must be rejected 4xx — got ${r.status}: ${r.body}`);
});

test('(RED) POST /api/reflect/<..>/answer with a symlinked user-feedback.md leaf overwrites an out-of-root victim', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-reflect-answer-leaf-outside-');
  const victim = join(outside, 'victim-feedback.md');
  writeFileSync(victim, 'ORIGINAL-VICTIM-FEEDBACK-LEAF-d00a6');
  const before = readFileSync(victim);
  const cid = 'reflect-answer-leaf-cycle';
  mkdirSync(join(logsRoot, cid), { recursive: true });
  symlinkSync(victim, join(logsRoot, cid, 'user-feedback.md'), 'file');
  assert.ok(lstatSync(join(logsRoot, cid, 'user-feedback.md')).isSymbolicLink(), 'precondition: user-feedback.md is a symlink');

  const r = await rawRequest(bridgeUrl, {
    method: 'POST', path: `/api/reflect/${cid}/answer`, headers: CSRF,
    body: JSON.stringify({ answers: [], freeform: 'PWNED-FEEDBACK-LEAF-e11b7' }),
  });
  assert.ok(
    readFileSync(victim).equals(before),
    `writeFileSync followed the symlinked user-feedback.md leaf and overwrote an out-of-root victim — status ${r.status}: ${r.body}`,
  );
});
