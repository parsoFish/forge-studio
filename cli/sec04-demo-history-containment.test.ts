/**
 * ACCEPTANCE PINS (SEC-04, bd forge-ebj) — the DEMO-BUILDER HISTORY routes: the
 * reproduced 4th-module escape. Both fold a request-supplied `project` (and `id`)
 * into a `<projectsRoot>/<project>/.forge/demo/history/...` path with NO
 * per-segment containment guard (cli/ui-bridge.ts, handleDemoBuilder):
 *
 *   GET /api/demo-builder/history/<project>       (LIST)
 *     histRoot = join(projectsRoot, project, '.forge','demo','history')
 *     readdirSync(histRoot) + readJsonFile(<id>/meta.json) + existsSync(<id>/DEMO.html)
 *     → NO guard: a traversed OR symlinked history dir is enumerated + its meta disclosed.
 *
 *   GET /api/demo-builder/history/<project>/<id>  (SERVE)
 *     base      = join(projectsRoot, project, '.forge','demo','history') + sep
 *     requested = join(projectsRoot, project, '.forge','demo','history', id, 'DEMO.html')
 *     requested.startsWith(base)               // LEXICAL, self-defeating
 *     → base + requested are built from the SAME untrusted `project`, so a
 *       traversal in `project` sits in BOTH and the check is tautological; and a
 *       SYMLINKED history dir is lexically inside base yet readFileSync follows it
 *       out of root.
 *
 * TWO VECTORS per the brief:
 *   (a) %2F-SMUGGLED TRAVERSED project. The route regexes capture `([^/]+)` per
 *       segment, so a literal "/" must ride as `%2F` and be issued RAW (node:http)
 *       — `fetch()` folds it. A `../../outside` project reaches an out-of-root
 *       `.forge/demo/history`.
 *   (b) SYMLINKED `.forge/demo/history` DIRECTORY. An ordinary in-root project
 *       whose history dir is a symlink to an out-of-root victim tree — plantable
 *       by a plain git commit (git tracks symlinks as 120000 blobs). `readdirSync`
 *       / `readFileSync` follow it.
 *
 * Disclosure is asserted against the ARTIFACT — the out-of-root DEMO.html body and
 * meta.json fields (id / prompt) must NOT appear in the response — never a bare
 * status code. Victims live OUTSIDE both projectsRoot AND forgeRoot (os.tmpdir()).
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
let projectsRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

function encodeSlashes(p: string): string {
  return p.split('/').map(encodeURIComponent).join('%2F');
}

/** Raw HTTP GET issuing EXACTLY `rawPath` on the wire (no normalisation), so the
 *  `%2F` project shapes reach the route encoded rather than folded client-side. */
function rawGet(base: string, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(base);
    const req = httpRequest({ host: u.hostname, port: u.port, path: rawPath, method: 'GET' }, (r) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => resolvePromise({ status: r.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function is4xx(status: number): boolean {
  return status >= 400 && status < 500;
}

/** Plant a locked-demo snapshot at `<histRoot>/<id>/` (DEMO.html + meta.json)
 *  with `sentinel` embedded in BOTH the html body and the meta prompt. */
function plantDemoSnapshot(histRoot: string, id: string, sentinel: string): void {
  const dir = join(histRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'DEMO.html'), `<!doctype html><body>${sentinel}</body>`);
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ locked_at: '2026-08-08T00:00:00.000Z', prompt: sentinel, iterations: 1 }));
}

before(async () => {
  forgeRoot = tmp('sec04-demohist-forge-');
  projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });

  // A real, legitimately-shaped in-root project — the base for the symlinked-dir
  // vectors and the positive controls.
  mkdirSync(join(projectsRoot, 'legit'), { recursive: true });

  const probe = tmp('sec04-demohist-symlink-probe-');
  try {
    symlinkSync(probe, join(projectsRoot, '__symlink_probe__'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(join(projectsRoot, '__symlink_probe__'), { force: true });
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

/** project string that traverses from projectsRoot out to `outside`, asserted to
 *  genuinely step out (first segment is `..`). */
function traversalProject(outside: string): string {
  const rel = relative(projectsRoot, outside);
  assert.equal(rel.split(sep)[0], '..', 'sanity: the traversed project must genuinely step outside projectsRoot');
  return rel;
}

// ---------------------------------------------------------------------------
// Positive controls — MUST pass before AND after any fix.
// ---------------------------------------------------------------------------

test('positive control: LIST + SERVE a real in-root locked demo', async () => {
  const histRoot = join(projectsRoot, 'legit', '.forge', 'demo', 'history');
  plantDemoSnapshot(histRoot, 'real-demo-01', 'LEGIT-DEMO-CONTENT');

  const list = await rawGet(bridgeUrl, `/api/demo-builder/history/legit`);
  assert.equal(list.status, 200, `real history LIST must 200 — got ${list.status}: ${list.body}`);
  assert.ok(list.body.includes('real-demo-01'), 'the real in-root demo id must be listed');

  const serve = await rawGet(bridgeUrl, `/api/demo-builder/history/legit/real-demo-01`);
  assert.equal(serve.status, 200, `real history SERVE must 200 — got ${serve.status}: ${serve.body}`);
  assert.ok(serve.body.includes('LEGIT-DEMO-CONTENT'), 'the real in-root DEMO.html must be served');
});

// ===========================================================================
// LIST — GET /api/demo-builder/history/<project>
// ===========================================================================

test('(RED) LIST with a %2F-smuggled "../.." project enumerates an out-of-root .forge/demo/history', async () => {
  const outside = newOutsideDir('sec04-demohist-list-trav-outside-');
  const SENTINEL = 'PWNED-DEMOHIST-LIST-TRAVERSAL-a11ce';
  plantDemoSnapshot(join(outside, '.forge', 'demo', 'history'), 'victim-demo', SENTINEL);
  const project = traversalProject(outside);

  const r = await rawGet(bridgeUrl, `/api/demo-builder/history/${encodeSlashes(project)}`);
  assert.ok(!r.body.includes(SENTINEL), `a "../.." project enumerated an out-of-root demo history — status ${r.status}: ${r.body}`);
  assert.ok(is4xx(r.status), `a traversed project must be rejected 4xx — got ${r.status}: ${r.body}`);
});

test('(RED) LIST through a symlinked .forge/demo/history dir enumerates an out-of-root snapshot', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-demohist-list-symlink-outside-');
  const SENTINEL = 'PWNED-DEMOHIST-LIST-SYMLINK-b22df';
  // The victim history tree lives entirely outside both roots.
  plantDemoSnapshot(outside, 'victim-demo', SENTINEL);
  // An ordinary in-root project whose history dir is a symlink to it.
  mkdirSync(join(projectsRoot, 'attacker-list', '.forge', 'demo'), { recursive: true });
  symlinkSync(outside, join(projectsRoot, 'attacker-list', '.forge', 'demo', 'history'), 'dir');
  assert.ok(lstatSync(join(projectsRoot, 'attacker-list', '.forge', 'demo', 'history')).isSymbolicLink(),
    'precondition: .forge/demo/history is a symlink');

  const r = await rawGet(bridgeUrl, `/api/demo-builder/history/attacker-list`);
  assert.ok(!r.body.includes(SENTINEL), `readdirSync followed a symlinked history dir and disclosed an out-of-root snapshot — status ${r.status}: ${r.body}`);
});

// ===========================================================================
// SERVE — GET /api/demo-builder/history/<project>/<id>
// ===========================================================================

test('(RED) SERVE with a %2F-smuggled "../.." project serves an out-of-root DEMO.html', async () => {
  const outside = newOutsideDir('sec04-demohist-serve-trav-outside-');
  const SENTINEL = 'PWNED-DEMOHIST-SERVE-TRAVERSAL-c33ef';
  plantDemoSnapshot(join(outside, '.forge', 'demo', 'history'), 'victim-demo', SENTINEL);
  const project = traversalProject(outside);

  const r = await rawGet(bridgeUrl, `/api/demo-builder/history/${encodeSlashes(project)}/victim-demo`);
  assert.ok(!r.body.includes(SENTINEL), `the lexical startsWith(base) is tautological under a traversed project — an out-of-root DEMO.html was served — status ${r.status}: ${r.body}`);
  assert.ok(is4xx(r.status), `a traversed project must be rejected 4xx — got ${r.status}: ${r.body}`);
});

test('(RED) SERVE through a symlinked .forge/demo/history dir serves an out-of-root DEMO.html', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-demohist-serve-symlink-outside-');
  const SENTINEL = 'PWNED-DEMOHIST-SERVE-SYMLINK-d44a0';
  plantDemoSnapshot(outside, 'victim-demo', SENTINEL);
  mkdirSync(join(projectsRoot, 'attacker-serve', '.forge', 'demo'), { recursive: true });
  symlinkSync(outside, join(projectsRoot, 'attacker-serve', '.forge', 'demo', 'history'), 'dir');
  assert.ok(lstatSync(join(projectsRoot, 'attacker-serve', '.forge', 'demo', 'history')).isSymbolicLink(),
    'precondition: .forge/demo/history is a symlink');

  const r = await rawGet(bridgeUrl, `/api/demo-builder/history/attacker-serve/victim-demo`);
  assert.ok(!r.body.includes(SENTINEL), `readFileSync followed a symlinked history dir (lexically inside base) and served an out-of-root DEMO.html — status ${r.status}: ${r.body}`);
  assert.ok(is4xx(r.status), `a symlinked history dir must be rejected 4xx — got ${r.status}: ${r.body}`);
});
