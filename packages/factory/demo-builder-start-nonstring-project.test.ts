/**
 * ACCEPTANCE TEST (forge-01u, wire level) — `POST /api/demo-builder/start`
 * must reject a structurally invalid `project` (any non-string JSON shape,
 * e.g. an array) with its ORDINARY 400 rejection, never a 500.
 *
 * The route (`apps/forge/ui-bridge.ts`, ~L4180) calls `resolveDemoSessionDir`,
 * which calls `resolveGuardedPath(projectsRoot, [project, '_demo',
 * sessionId])` (`cli/studio-path-guard.ts`). `project` is typed
 * `project?: string` in the handler's local cast of the parsed JSON body,
 * but that is a compile-time-only annotation — nothing validates the
 * runtime shape of an arbitrary caller-supplied JSON value before it
 * reaches the guard. A JSON array survives the route's own
 * `!body.project` truthiness check (a non-empty array is truthy) and the
 * guard's own `SLUG_RE` project-shape check (`RegExp.test` coerces its
 * argument to a string first — `String(['abc'])` is `'abc'`, a
 * SLUG_RE-legal value), then reaches `resolveGuardedPath` as a non-string
 * `segments[0]`, which throws (see `packages/kernel/studio-path-guard-nonstring-segment.test.ts`
 * for the unit-level pin of the underlying defect). The route's own
 * `catch` block turns that uncaught exception into a 500 — the WRONG
 * SHAPE for a structurally invalid request, which must be a 400.
 *
 * HARNESS: copied verbatim from the established containment-test pattern
 * (`apps/forge/bridge-studio-demo-builder-containment.test.ts`,
 * `apps/forge/sec04-projectbrain-demo-containment.test.ts`) — `startBridge` on an
 * ephemeral port against a temp `projectsRoot`, `fetch()` with the
 * mandatory `x-forge-csrf` header for every state-changing POST.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../apps/forge/ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' } as const;

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Recursive, sorted listing of every entry under `root` — used to prove a
 *  rejected (or errored) request created NO session directory anywhere. */
function snapshotTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      out.push(r);
      if (entry.isDirectory()) walk(join(dir, entry.name), r);
    }
  };
  if (existsSync(root)) walk(root, '');
  return out.sort();
}

let forgeRoot: string;
let projectsRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${bridgeUrl}${path}`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
}

before(async () => {
  forgeRoot = tmp('demo-start-nonstring-project-');
  projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });

  // A real, legitimately onboarded project — the positive control.
  mkdirSync(join(projectsRoot, 'legit-project'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Positive control — MUST pass before AND after any fix.
// ---------------------------------------------------------------------------

test('positive control (passes before AND after any fix): POST /api/demo-builder/start with a legitimate string project succeeds (200)', async () => {
  const before = snapshotTree(projectsRoot);
  const res = await post('/api/demo-builder/start', { project: 'legit-project' });
  const body = (await res.json()) as { ok?: boolean; sessionId?: string; error?: string };
  assert.equal(res.status, 200, `expected a legitimate project to succeed — got ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, `expected {ok:true} in the response body — got ${JSON.stringify(body)}`);
  assert.equal(typeof body.sessionId, 'string', `expected a sessionId string in the response — got ${JSON.stringify(body)}`);
  assert.ok(body.sessionId!.length > 0, 'expected a non-empty sessionId');
  // A NEW session dir must have been created for the legitimate request —
  // proves the before/after snapshot technique used below actually detects
  // session-directory creation, not just a no-op comparison.
  const after = snapshotTree(projectsRoot);
  assert.notDeepEqual(after, before, 'expected a new session directory to be created for a legitimate, accepted project');
});

// ---------------------------------------------------------------------------
// RED cases — a structurally invalid `project` must yield 400, never 500,
// and must never create a session directory.
// ---------------------------------------------------------------------------

test('(RED at base — currently 500) POST /api/demo-builder/start with project=["abc"] (a JSON array) must be rejected 400, not 500', async () => {
  const before = snapshotTree(projectsRoot);
  const res = await post('/api/demo-builder/start', { project: ['abc'] });
  const body = (await res.json().catch(() => ({}))) as { error?: string };

  assert.notEqual(
    res.status,
    500,
    `a structurally invalid (non-string) "project" must never surface as a 500 — got 500: ${JSON.stringify(body)}. ` +
      `The route's resolveDemoSessionDir -> resolveGuardedPath call throws a raw TypeError from path.join() on a non-string segment, ` +
      `caught only by the route's generic catch block.`,
  );
  assert.equal(res.status, 400, `expected a 400 rejection for a non-string "project" — got ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(typeof body.error, 'string', `expected a JSON body with a string "error" property — got ${JSON.stringify(body)}`);
  assert.ok(body.error!.length > 0, 'expected a non-empty error message');

  assert.deepEqual(snapshotTree(projectsRoot), before, 'a rejected request must never create a session directory anywhere under projectsRoot');
});

test('POST /api/demo-builder/start with project={} (a JSON object) must be rejected 400, not 500', async () => {
  const before = snapshotTree(projectsRoot);
  const res = await post('/api/demo-builder/start', { project: {} });
  const body = (await res.json().catch(() => ({}))) as { error?: string };

  assert.notEqual(res.status, 500, `a structurally invalid "project" must never surface as a 500 — got 500: ${JSON.stringify(body)}`);
  assert.equal(res.status, 400, `expected a 400 rejection for a non-string "project" — got ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(typeof body.error, 'string', `expected a JSON body with a string "error" property — got ${JSON.stringify(body)}`);
  assert.ok(body.error!.length > 0, 'expected a non-empty error message');

  assert.deepEqual(snapshotTree(projectsRoot), before, 'a rejected request must never create a session directory anywhere under projectsRoot');
});

test('POST /api/demo-builder/start with project=42 (a JSON number) must be rejected 400, not 500', async () => {
  const before = snapshotTree(projectsRoot);
  const res = await post('/api/demo-builder/start', { project: 42 });
  const body = (await res.json().catch(() => ({}))) as { error?: string };

  assert.notEqual(res.status, 500, `a structurally invalid "project" must never surface as a 500 — got 500: ${JSON.stringify(body)}`);
  assert.equal(res.status, 400, `expected a 400 rejection for a non-string "project" — got ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(typeof body.error, 'string', `expected a JSON body with a string "error" property — got ${JSON.stringify(body)}`);
  assert.ok(body.error!.length > 0, 'expected a non-empty error message');

  assert.deepEqual(snapshotTree(projectsRoot), before, 'a rejected request must never create a session directory anywhere under projectsRoot');
});
