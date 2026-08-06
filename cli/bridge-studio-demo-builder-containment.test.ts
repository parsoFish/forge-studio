/**
 * ACCEPTANCE TESTS (SEC-03, T3, appended round) — Defect 4: `GET
 * /api/demo-builder/demo/<project>/<sid>` and `GET
 * /api/demo-builder/fragment/<project>/<sid>/<element>`
 * (cli/ui-bridge.ts ~2333-2409) bypass `resolveDemoSessionDir` — the shipped
 * choke point (~1477) that (a) validates `project`/`sessionId` with the
 * length-cap-then-charset contract BEFORE any fs call, and (b) proves real
 * realpath containment inside THIS project's own resolved dir. Both routes
 * instead do:
 *   const rest = url.slice(prefix.length).split('/').map(decodeURIComponent);
 *   const [project, sessionId] = rest;
 *   if (!project || !sessionId) { ...400... }   // truthiness ONLY
 *   demoSessionDir(join(ctx.projectsRoot, project), sessionId)
 * — the campaign's headline pattern verbatim: the guard exists, five POST
 * siblings + the GET generation route call it, these two never did (the
 * module's own docstring at ~1426-2432 discloses this as a stated, unfixed
 * gap: "The sibling /demo/ and /fragment/ GET routes above remain OUT OF
 * SCOPE for this round").
 *
 * WIRE-LEVEL RULE (R4-16): `split('/')` runs on the RAW url BEFORE
 * `decodeURIComponent` — a percent-encoded `%2F` survives the split and only
 * becomes `/` afterwards, so it is invisible to the split and reaches
 * `join()`. Every traversal AT below issues a RAW request via `node:http`
 * directly (never `fetch()`, which goes through a URL parser this campaign
 * does not trust to preserve `%2F` verbatim) — `http.request({path})` sends
 * the given string on the wire unmodified. Each test's own assertions (the
 * planted sentinel bytes actually being served) are the proof of what the
 * server received; a hole would read as safe if the encoding got normalised
 * away client-side, so behaviour is the check, not a log line.
 *
 * Live reproduction (measured before writing these tests):
 *   GET /api/demo-builder/fragment/..%2F..%2F<outside>/x/evil -> 200, serves
 *     the planted PWNED-FRAGMENT-CONTENT bytes.
 *   GET /api/demo-builder/demo/..%2F..%2F<outside>/x          -> 200, serves
 *     the planted PWNED-DEMO-CONTENT bytes.
 * Chain: unvalidated project/sessionId escape projectsRoot -> an
 * attacker-planted status.json is read -> its `project_repo_path` is fully
 * attacker-chosen -> the route reads/serves
 * `<attackerPath>/.forge/demo/DEMO.html` or
 * `<attackerPath>/.forge/demo/fragments/<element>.html`.
 *
 * "Guard that cannot fail" (docs/security-request-path-audit.md's own
 * vocabulary; cli/studio-path-guard.ts's docstring names the same class):
 * `/demo/`'s only check is
 *   base = join(status.project_repo_path, '.forge', 'demo') + sep
 *   requested = join(status.project_repo_path, DEMO_HTML_REL_PATH)
 *   requested.startsWith(base)
 * — both built from the SAME untrusted `project_repo_path`, so this is true
 * BY CONSTRUCTION for every possible value. Pinned structurally below
 * (no HTTP involved) alongside a live demonstration that a status.json
 * reached via a completely ORDINARY, non-traversing, non-symlinked
 * project/sessionId pair still defeats it — the trust hole is one layer
 * below the routing escape (the field inside status.json), which is why a
 * routing-only fix is necessary but the guard-shape itself is also named.
 *
 * MEASURED (not assumed) on the `fragment` route's `element` component: see
 * the dedicated test/comment near the bottom.
 *
 * Binding rules applied throughout: property assertions, not status codes;
 * mandatory positive controls (pass before AND after any fix, said so in
 * each comment); real sentinel bytes planted at every target; at least one
 * AT per containment claim through the real route via `startBridge`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';

import { startBridge } from './ui-bridge.ts';
import { DEMO_HTML_REL_PATH } from '../orchestrator/demo-builder-runner.ts';
import type { DemoBuilderStatus } from '../orchestrator/demo-builder-runner.ts';

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

/** Percent-encode a path so every literal "/" becomes "%2F" — the R4-16
 *  smuggling shape: `split('/')` on the raw url never sees these as
 *  boundaries, only `decodeURIComponent` (which runs AFTER the split)
 *  reveals them. */
function encodeSlashes(p: string): string {
  return p.split('/').map(encodeURIComponent).join('%2F');
}

/** Raw HTTP GET issuing EXACTLY `rawPath` as the request-target — `node:http`
 *  sends the `path` option verbatim on the wire (no URL-parser
 *  normalisation), unlike `fetch()`. This is how the R4-16 %2F shapes below
 *  are proven to reach the server encoded, not decoded client-side. */
function rawGet(base: string, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(base);
    const req = httpRequest(
      { host: u.hostname, port: u.port, path: rawPath, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function plantStatus(sessionDir: string, status: DemoBuilderStatus): void {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2));
}

function makeStatus(overrides: Partial<DemoBuilderStatus> & { project: string; project_repo_path: string }): DemoBuilderStatus {
  return {
    session_id: 'sid',
    phase: 'awaiting-review',
    iteration: 1,
    prompt: '',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function plantDemoHtml(repoPath: string, content: string): void {
  const dir = join(repoPath, '.forge', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'DEMO.html'), content);
}

function plantFragment(repoPath: string, element: string, content: string): void {
  const dir = join(repoPath, '.forge', 'demo', 'fragments');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${element}.html`), content);
}

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

before(async () => {
  forgeRoot = tmp('demo-builder-containment-');
  projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });

  // A real, legitimately onboarded project (used by the positive controls
  // and the "guard cannot fail" demonstration).
  mkdirSync(join(projectsRoot, 'legit-project'), { recursive: true });
  plantDemoHtml(join(projectsRoot, 'legit-project'), 'REAL-DEMO-CONTENT-4f81c');
  plantFragment(join(projectsRoot, 'legit-project'), 'hero', 'REAL-FRAGMENT-CONTENT-9b03e');
  plantStatus(
    join(projectsRoot, 'legit-project', '_demo', 'legit-session'),
    makeStatus({ session_id: 'legit-session', project: 'legit-project', project_repo_path: join(projectsRoot, 'legit-project') }),
  );

  // A second real project, used ONLY as the cross-project symlink target —
  // its OWN demo content must never be reachable through a DIFFERENT
  // project's route.
  mkdirSync(join(projectsRoot, 'victim-project'), { recursive: true });
  plantDemoHtml(join(projectsRoot, 'victim-project'), 'VICTIM-PROJECT-DEMO-CONTENT-2e77a');
  plantFragment(join(projectsRoot, 'victim-project'), 'panel', 'VICTIM-PROJECT-FRAGMENT-CONTENT-6c19f');
  plantStatus(
    join(projectsRoot, 'victim-project', '_demo', 'victim-session'),
    makeStatus({ session_id: 'victim-session', project: 'victim-project', project_repo_path: join(projectsRoot, 'victim-project') }),
  );
  mkdirSync(join(projectsRoot, 'attacker-project', '_demo'), { recursive: true });

  // Probe symlink availability once.
  const probeDir = tmp('demo-builder-symlink-probe-');
  try {
    symlinkSync(probeDir, join(projectsRoot, '__symlink_probe__'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(join(projectsRoot, '__symlink_probe__'), { force: true });
  rmSync(probeDir, { recursive: true, force: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Positive controls (mandatory) — MUST pass before AND after any fix.
// ---------------------------------------------------------------------------

test('positive control (passes before AND after any fix): GET /api/demo-builder/demo/<legit>/<legit> serves the real DEMO.html', async () => {
  const res = await fetch(`${bridgeUrl}/api/demo-builder/demo/legit-project/legit-session`);
  const text = await res.text();
  assert.equal(res.status, 200, `expected the legitimate demo route to succeed — got ${res.status}: ${text}`);
  assert.equal(text, 'REAL-DEMO-CONTENT-4f81c');
});

test('positive control (passes before AND after any fix): GET /api/demo-builder/fragment/<legit>/<legit>/<element> serves the real fragment', async () => {
  const res = await fetch(`${bridgeUrl}/api/demo-builder/fragment/legit-project/legit-session/hero`);
  const text = await res.text();
  assert.equal(res.status, 200, `expected the legitimate fragment route to succeed — got ${res.status}: ${text}`);
  assert.ok(text.includes('REAL-FRAGMENT-CONTENT-9b03e'), `expected the real fragment content in the (possibly wrapped) body — got: ${text}`);
});

// ---------------------------------------------------------------------------
// DEFECT 4, shape: %2F-encoded ".." traversal in `project`.
// ---------------------------------------------------------------------------

test('(RED) [Defect 4, %2F traversal in project, /demo/ route] a raw request with project="..%2F..%2F<outside>" serves the attacker-planted DEMO.html', async () => {
  const outside = newOutsideDir('demo-builder-project-traversal-demo-outside-');
  plantStatus(join(outside, '_demo', 'x'), makeStatus({ session_id: 'x', project: 'irrelevant', project_repo_path: outside }));
  plantDemoHtml(outside, 'PWNED-DEMO-CONTENT-a1f30');

  const rel = relative(projectsRoot, outside);
  assert.ok(rel.split(sep)[0] === '..', 'sanity: the traversal string must genuinely step outside projectsRoot');
  const rawPath = `/api/demo-builder/demo/${encodeSlashes(rel)}/x`;

  const { status, body } = await rawGet(bridgeUrl, rawPath);
  assert.ok(
    !body.includes('PWNED-DEMO-CONTENT-a1f30'),
    `the response must NEVER contain the outside sentinel — resolveDemoSessionDir (the shipped choke point) is never called on this route, so a %2F-smuggled ".." in "project" escapes projectsRoot entirely — status ${status}: ${body}`,
  );
});

test('(RED) [Defect 4, %2F traversal in project, /fragment/ route] a raw request with project="..%2F..%2F<outside>" serves the attacker-planted fragment', async () => {
  const outside = newOutsideDir('demo-builder-project-traversal-fragment-outside-');
  plantStatus(join(outside, '_demo', 'x'), makeStatus({ session_id: 'x', project: 'irrelevant', project_repo_path: outside }));
  plantFragment(outside, 'evil', 'PWNED-FRAGMENT-CONTENT-b2e41');

  const rel = relative(projectsRoot, outside);
  const rawPath = `/api/demo-builder/fragment/${encodeSlashes(rel)}/x/evil`;

  const { status, body } = await rawGet(bridgeUrl, rawPath);
  assert.ok(
    !body.includes('PWNED-FRAGMENT-CONTENT-b2e41'),
    `the response must NEVER contain the outside sentinel — status ${status}: ${body}`,
  );
});

// ---------------------------------------------------------------------------
// DEFECT 4, shape: %2F-encoded ".." traversal in `sessionId` (project stays a
// legitimately-shaped, real slug — only the SECOND segment is poisoned).
// ---------------------------------------------------------------------------

test('(RED) [Defect 4, %2F traversal in sessionId, /demo/ route] a raw request with a real project but sessionId="..%2F..%2F..%2F..%2F<outside>" serves attacker content', async () => {
  const outside = newOutsideDir('demo-builder-session-traversal-demo-outside-');
  plantStatus(join(outside, '_demo', 'ignored'), makeStatus({ session_id: 'ignored', project: 'irrelevant', project_repo_path: outside }));
  plantDemoHtml(outside, 'PWNED-DEMO-CONTENT-SESSIONID-c3f52');

  // demoSessionDir(join(projectsRoot,'legit-project'), sessionId) =
  // join(projectsRoot,'legit-project','_demo', sessionId) — compute the
  // EXACT relative string that lands back on `outside/_demo/ignored`.
  const demoDir = join(projectsRoot, 'legit-project', '_demo');
  const relToSession = relative(demoDir, join(outside, '_demo', 'ignored'));
  const rawPath = `/api/demo-builder/demo/legit-project/${encodeSlashes(relToSession)}`;

  const { status, body } = await rawGet(bridgeUrl, rawPath);
  assert.ok(
    !body.includes('PWNED-DEMO-CONTENT-SESSIONID-c3f52'),
    `the response must NEVER contain the outside sentinel — a %2F-smuggled ".." in "sessionId" alone (a genuinely real project) escapes projectsRoot just as effectively as poisoning "project" — status ${status}: ${body}`,
  );
});

test('(RED) [Defect 4, %2F traversal in sessionId, /fragment/ route] a raw request with a real project but sessionId="..%2F..%2F..%2F..%2F<outside>" serves attacker content', async () => {
  const outside = newOutsideDir('demo-builder-session-traversal-fragment-outside-');
  plantStatus(join(outside, '_demo', 'ignored'), makeStatus({ session_id: 'ignored', project: 'irrelevant', project_repo_path: outside }));
  plantFragment(outside, 'evil', 'PWNED-FRAGMENT-CONTENT-SESSIONID-d4a63');

  const demoDir = join(projectsRoot, 'legit-project', '_demo');
  const relToSession = relative(demoDir, join(outside, '_demo', 'ignored'));
  const rawPath = `/api/demo-builder/fragment/legit-project/${encodeSlashes(relToSession)}/evil`;

  const { status, body } = await rawGet(bridgeUrl, rawPath);
  assert.ok(
    !body.includes('PWNED-FRAGMENT-CONTENT-SESSIONID-d4a63'),
    `the response must NEVER contain the outside sentinel — status ${status}: ${body}`,
  );
});

// ---------------------------------------------------------------------------
// DEFECT 4, shape: symlinked session directory whose NAME legitimately
// passes SAFE_ID_RE but resolves outside the project (R4-16 round-2 Finding
// B shape) — no %2F needed, plain segments, plain fetch().
// ---------------------------------------------------------------------------

test('(RED) [Defect 4, symlinked session dir, /demo/ route] a legitimately-named session dir that is really a symlink to an outside dir serves attacker content', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('demo-builder-symlink-demo-outside-');
  plantStatus(outside, makeStatus({ session_id: 'symlinked-session', project: 'legit-project', project_repo_path: outside }));
  plantDemoHtml(outside, 'PWNED-DEMO-CONTENT-SYMLINK-e5b74');
  symlinkSync(outside, join(projectsRoot, 'legit-project', '_demo', 'symlinked-session'), 'dir');

  const res = await fetch(`${bridgeUrl}/api/demo-builder/demo/legit-project/symlinked-session`);
  const text = await res.text();
  assert.ok(
    !text.includes('PWNED-DEMO-CONTENT-SYMLINK-e5b74'),
    `the response must NEVER contain the outside sentinel — "symlinked-session" legitimately passes SAFE_ID_RE (string validation alone cannot see what it resolves to on disk) — status ${res.status}: ${text}`,
  );
});

test('(RED) [Defect 4, symlinked session dir, /fragment/ route] a legitimately-named session dir that is really a symlink to an outside dir serves attacker content', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('demo-builder-symlink-fragment-outside-');
  plantStatus(outside, makeStatus({ session_id: 'symlinked-session-2', project: 'legit-project', project_repo_path: outside }));
  plantFragment(outside, 'evil', 'PWNED-FRAGMENT-CONTENT-SYMLINK-f6c85');
  symlinkSync(outside, join(projectsRoot, 'legit-project', '_demo', 'symlinked-session-2'), 'dir');

  const res = await fetch(`${bridgeUrl}/api/demo-builder/fragment/legit-project/symlinked-session-2/evil`);
  const text = await res.text();
  assert.ok(
    !text.includes('PWNED-FRAGMENT-CONTENT-SYMLINK-f6c85'),
    `the response must NEVER contain the outside sentinel — status ${res.status}: ${text}`,
  );
});

// ---------------------------------------------------------------------------
// DEFECT 4, shape: cross-project symlink — a session dir under ONE project's
// _demo/ symlinked to a DIFFERENT REAL project's _demo/<session> under the
// SAME projectsRoot. A projectsRoot-wide check would wrongly accept this
// (the target genuinely IS under projectsRoot); the choke point is scoped to
// THIS project's own resolved dir specifically (R2-10's AT-47 shape).
// ---------------------------------------------------------------------------

test('(RED) [Defect 4, cross-project symlink, /demo/ route] attacker-project aliasing victim-project must not serve victim content through the WRONG project route', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  symlinkSync(
    join(projectsRoot, 'victim-project', '_demo', 'victim-session'),
    join(projectsRoot, 'attacker-project', '_demo', 'cross-session'),
    'dir',
  );

  const res = await fetch(`${bridgeUrl}/api/demo-builder/demo/attacker-project/cross-session`);
  const text = await res.text();
  assert.ok(
    !text.includes('VICTIM-PROJECT-DEMO-CONTENT-2e77a'),
    `victim-project's real DEMO.html must NEVER be reachable through attacker-project's route — "somewhere under projectsRoot" is not the guarantee; "under THIS project's own dir" is — status ${res.status}: ${text}`,
  );
});

test('(RED) [Defect 4, cross-project symlink, /fragment/ route] attacker-project aliasing victim-project must not serve victim content through the WRONG project route', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  symlinkSync(
    join(projectsRoot, 'victim-project', '_demo', 'victim-session'),
    join(projectsRoot, 'attacker-project', '_demo', 'cross-session-2'),
    'dir',
  );

  const res = await fetch(`${bridgeUrl}/api/demo-builder/fragment/attacker-project/cross-session-2/panel`);
  const text = await res.text();
  assert.ok(
    !text.includes('VICTIM-PROJECT-FRAGMENT-CONTENT-6c19f'),
    `victim-project's real fragment must NEVER be reachable through attacker-project's route — status ${res.status}: ${text}`,
  );
});

// ---------------------------------------------------------------------------
// "Guard that cannot fail" — /demo/'s base/requested check is tautological.
// Part 1: structural proof (no HTTP) that NO value of project_repo_path can
// make it reject. Part 2: a live demonstration that even a completely
// ORDINARY, non-traversing, non-symlinked project/sessionId pair (reached
// with zero routing tricks) still defeats it, because the trust hole is one
// layer BELOW the routing escape — the untrusted field inside status.json.
// ---------------------------------------------------------------------------

// NOT a RED acceptance pin (relabelled per binding rule 1, same reasoning as
// the SEC-03 project-create file's already-passing ".."-traversal tests): this
// characterizes a structural PROPERTY of the base/requested expression itself
// (it is tautological for ANY value, by construction) — that property is true
// TODAY and remains true even after routing project/sessionId through
// resolveDemoSessionDir (a routing fix does not change what this ONE
// expression evaluates to; it only changes whether an attacker can ever reach
// a status.json whose project_repo_path is untrusted). Kept as a standing,
// VERIFIED characterization — documentation with a real assertion behind it,
// not a comment — companioned by the live test right after it, which IS a RED
// acceptance pin on the actual reachability.
test('structural characterization (true always — documents the guard SHAPE, not the routing defect): the /demo/ route\'s base/requested check is true BY CONSTRUCTION for every project_repo_path — no input makes it reject', () => {
  const candidates = [
    '/etc',
    '/tmp/completely-unrelated-dir',
    'C:\\Windows\\System32',
    '',
    '/a/b/c/../../..',
    outsideDirs[0] ?? tmp('guard-cannot-fail-probe-'),
  ];
  for (const x of candidates) {
    // EXACT replica of cli/ui-bridge.ts's guard expression (~2347-2349).
    const base = join(x, '.forge', 'demo') + sep;
    const requested = join(x, DEMO_HTML_REL_PATH);
    assert.ok(
      requested.startsWith(base),
      `expected the guard to be unconditionally true (i.e. "cannot fail") for project_repo_path=${JSON.stringify(x)} — both "base" and "requested" are built from the SAME untrusted value, so this can never discriminate a legitimate path from an attacker-chosen one`,
    );
  }
});

test('(RED) ["guard that cannot fail", live] a completely ordinary, non-traversing, non-symlinked project/sessionId pair still serves whatever project_repo_path names — no routing trick required', async () => {
  const outside = newOutsideDir('demo-builder-guard-cannot-fail-outside-');
  plantDemoHtml(outside, 'PWNED-DEMO-CONTENT-GUARDCANNOTFAIL-g7d96');
  // Ordinary, plain, SAFE_ID_RE-legal session dir directly under the real
  // legit-project — no ".." anywhere, no symlink anywhere. The only thing
  // wrong is the CONTENT of status.json, which the route trusts blindly.
  plantStatus(
    join(projectsRoot, 'legit-project', '_demo', 'guard-cannot-fail-session'),
    makeStatus({ session_id: 'guard-cannot-fail-session', project: 'legit-project', project_repo_path: outside }),
  );

  const res = await fetch(`${bridgeUrl}/api/demo-builder/demo/legit-project/guard-cannot-fail-session`);
  const text = await res.text();
  assert.ok(
    !text.includes('PWNED-DEMO-CONTENT-GUARDCANNOTFAIL-g7d96'),
    `an ordinary, non-escaping project/sessionId pair must never be able to serve arbitrary outside content via a status.json field the route trusts unchecked — status ${res.status}: ${text}`,
  );
});

// ---------------------------------------------------------------------------
// MEASURED (not assumed): the fragment route's `element` component.
// ---------------------------------------------------------------------------
//
// Unlike `project`/`sessionId` (used to build the SESSION DIR that is read
// for status.json), `element` is folded into `requested` via
// `join(project_repo_path,'.forge','demo','fragments', \`${element}.html\`)`
// — and `path.join()` FULLY NORMALISES the entire joined string, including
// any ".." smuggled into `element` via the same %2F-split-before-decode
// mechanism. Measured live below: a %2F-smuggled traversal in `element`
// aimed at a sentinel file OUTSIDE `fragments/` (and outside the project
// entirely) is REJECTED by the existing `requested.startsWith(base)` check,
// because that check runs on the fully-`join()`-normalised `requested` —
// unlike `/demo/`'s tautological check above, THIS base/requested pair has
// genuine discriminating power: `base` is fixed relative to
// `project_repo_path`, only `requested` folds in the untrusted `element`.
// This mirrors the SEC-03 finding on POST /api/studio/projects' plain
// ".."-traversal shapes: a lexical check on an ALREADY-RESOLVED path
// legitimately catches a plain (non-symlink) traversal. Pinned as a
// non-regression test, not a RED one, per binding rule 1 (a test that
// already passes today is not an acceptance pin for a defect).
// ---------------------------------------------------------------------------

test('non-regression (passes today; must keep passing after any fix): a %2F-smuggled ".." traversal in the fragment route\'s `element` component is ALREADY rejected — join() normalises it before the base/requested comparison runs', async () => {
  const outside = newOutsideDir('demo-builder-element-traversal-outside-');
  writeFileSync(join(outside, 'pwned.html'), 'PWNED-ELEMENT-CONTENT-h8e07');

  const fragmentsDir = join(projectsRoot, 'legit-project', '.forge', 'demo', 'fragments');
  const relDir = relative(fragmentsDir, outside);
  const element = relDir ? join(relDir, 'pwned') : 'pwned'; // "${element}.html" reassembles to the exact real file
  const rawPath = `/api/demo-builder/fragment/legit-project/legit-session/${encodeSlashes(element)}`;

  const { status, body } = await rawGet(bridgeUrl, rawPath);
  assert.ok(
    !body.includes('PWNED-ELEMENT-CONTENT-h8e07'),
    `expected the existing base/requested check (on the fully join()-normalised "requested") to already reject a ".."-traversal smuggled into "element" — got ${status}: ${body}`,
  );
});
