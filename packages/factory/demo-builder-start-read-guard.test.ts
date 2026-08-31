/**
 * forge-4vt — POST /api/demo-builder/start must contain the request-supplied
 * `project` segment STRUCTURALLY before it reaches the demo-lock read used to
 * default `mode`: the `repoPath` the read is built from must BE the output
 * of the shared containment guard, not merely computed AFTER some other
 * guard happens to run earlier in the handler.
 *
 * WHY A SOURCE / STRUCTURAL GATE (not a route-behaviour test): the read
 * result (whether `.forge/demo/demo.lock.json` exists at the folded
 * `repoPath`) feeds only the local `mode` default — two requests differing
 * only in whether that read escaped `projectsRoot` return the SAME shape of
 * response (200, `{ok:true,sessionId,mode}`), so there is no wire-observable
 * oracle for "did the read escape". A call-record spy is not available
 * either: this repo has empirically verified (see
 * cli/instructions-start-read-guard.test.ts's own header, and the spawn note
 * in cli/ui-bridge-authoring-start.test.ts) that node:test's `mock.method`
 * cannot redefine ui-bridge's named ESM imports.
 *
 * This handler is a SUBTLER case than the instructions/start precedent it
 * mirrors (forge-osz, cli/instructions-start-read-guard.test.ts). There, NO
 * guard preceded the read at all. Here, a containment guard —
 * `resolveDemoSessionDir`, which itself calls `resolveGuardedPath(projectsRoot,
 * [project, '_demo', sessionId])` — DOES run earlier in this very block and
 * DOES reject an out-of-root `project` today. But `repoPath` is
 * independently RE-DERIVED a few lines later via `body.projectRepoPath ||
 * join(ctx.projectsRoot, body.project)` — a raw fold that never consumes the
 * earlier guard's output. Today's safety is an accident of SOURCE ORDER, not
 * a data dependency: a refactor that moves the demo-lock read earlier, drops
 * `resolveDemoSessionDir`, or short-circuits it on some new fast path would
 * silently reopen the read even though the raw-fold line itself never
 * changed. The only honest, RED-at-base assertion is therefore structural:
 * the value the read is built from must literally BE the guard's own output,
 * and the raw fold must be gone — the same shape
 * cli/instructions-start-read-guard.test.ts and
 * roadmap-serpentine-retired.test.ts use to pin the ABSENCE of a code shape.
 *
 * RED-AT-BASE: inside the `/api/demo-builder/start` block, `repoPath` is
 * built via a raw `join(ctx.projectsRoot, body.project)` fold, and no
 * `resolveGuardedPath(ctx.projectsRoot, [body.project])` call appears
 * anywhere in the block before the demo-lock read. This file FAILS there.
 *
 * GREEN CONDITION (this file's expiry): `body.project` is passed through
 * `resolveGuardedPath(ctx.projectsRoot, [body.project])` (or an equivalent
 * call whose `realPath` becomes `repoPath`) BEFORE the demo-lock read, and
 * the raw `join(ctx.projectsRoot, body.project)` fold is gone from the block.
 *
 * Part 2 (behaviour positive controls, wire-level via a real `startBridge`)
 * proves the create/update mode-default contract survives that refactor —
 * the thing most at risk when `repoPath`'s derivation changes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../cli/ui-bridge.ts';

// ===========================================================================
// Part 1 — source-ordering pin (RED at base).
// ===========================================================================

const SRC = readFileSync(join(import.meta.dirname, '..', '..', 'cli', 'ui-bridge.ts'), 'utf8');

/** Extract the POST /api/demo-builder/start handler block: from its route
 *  match to the next handler (POST /api/demo-builder/brief). */
function demoBuilderStartBlock(src: string): string {
  const startMarker = "url === '/api/demo-builder/start'";
  const endMarker = "url === '/api/demo-builder/brief'";
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, 'could not locate the /api/demo-builder/start handler');
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, 'could not bound the /api/demo-builder/start handler');
  return src.slice(start, end);
}

/** The demo-lock read may today be a raw `existsSync(...)`, or (after a fix
 *  that routes the leaf itself through the guarded-leaf family) a
 *  `guardedFile(...)`/`guardedReadFile(...)` call — find whichever shape is
 *  actually present, earliest occurrence first. */
const READ_SINK_PATTERNS = ['existsSync(', 'guardedFile(', 'guardedReadFile('];
function firstReadSinkIndex(block: string): number {
  let idx = -1;
  for (const pattern of READ_SINK_PATTERNS) {
    const i = block.indexOf(pattern);
    if (i >= 0 && (idx === -1 || i < idx)) idx = i;
  }
  return idx;
}

// The containment guard on the untrusted project segment — the SAME
// resolveGuardedPath choke point the sibling /start routes (and
// resolveDemoSessionDir itself) use.
const GUARD_RE = /resolveGuardedPath\(\s*ctx\.projectsRoot\s*,\s*\[\s*body\.project\s*\]\s*\)/;

// The raw fold this defect is named for: `body.project` joined directly onto
// the trusted root, bypassing any guard's output.
const RAW_FOLD_RE = /join\(\s*ctx\.projectsRoot\s*,\s*body\.project\s*\)/;

test('demo-builder/start: a read sink exists in the handler (sanity anchor)', () => {
  const block = demoBuilderStartBlock(SRC);
  const readIdx = firstReadSinkIndex(block);
  assert.ok(readIdx >= 0, 'expected a demo-lock read (existsSync/guardedFile/guardedReadFile) in the handler (sanity)');
});

test('demo-builder/start: the demo.lock.json mode-default probe is present (sanity anchor)', () => {
  const block = demoBuilderStartBlock(SRC);
  assert.ok(
    block.includes('demo.lock.json'),
    'expected the handler to still probe for .forge/demo/demo.lock.json to default "mode" (sanity — a renamed/removed probe would silently pass the containment checks below for the wrong reason)',
  );
});

test('demo-builder/start: body.project must NOT be raw-folded into ctx.projectsRoot', () => {
  const block = demoBuilderStartBlock(SRC);
  assert.ok(
    !RAW_FOLD_RE.test(block),
    'found a raw join(ctx.projectsRoot, body.project) fold in the /api/demo-builder/start block — repoPath must never be derived this way, even though resolveDemoSessionDir happens to run earlier in source today: containment must be structural (the guard\'s own output), not accidental source order',
  );
});

test('demo-builder/start: body.project must be contained via resolveGuardedPath before the demo-lock read', () => {
  const block = demoBuilderStartBlock(SRC);
  const readIdx = firstReadSinkIndex(block);
  assert.ok(readIdx >= 0, 'expected a demo-lock read in the handler (sanity)');

  const guardMatch = GUARD_RE.exec(block);
  assert.ok(
    guardMatch,
    'body.project is not contained via resolveGuardedPath(ctx.projectsRoot, [body.project]) anywhere in the handler — repoPath is derived without that guard\'s output, so containment depends entirely on resolveDemoSessionDir continuing to run earlier in source, which is not structural',
  );
  assert.ok(
    guardMatch.index < readIdx,
    'body.project is contained only AFTER the demo-lock read — the guard must precede the read',
  );
});

// ===========================================================================
// Part 2 — behaviour positive controls (must pass BEFORE and AFTER the fix).
// Wire-level, mirroring cli/bridge-studio-demo-builder-containment.test.ts's
// harness (ephemeral port, temp projectsRoot, no SDK spawn).
// ===========================================================================

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

let forgeRoot: string;
let projectsRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const CSRF_HEADERS = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

function repoDir(project: string): string {
  return join(projectsRoot, project);
}

function plantProject(project: string): void {
  mkdirSync(repoDir(project), { recursive: true });
}

function plantDemoLock(project: string): void {
  const dir = join(repoDir(project), '.forge', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'demo.lock.json'), JSON.stringify({ locked: true }, null, 2));
}

async function postStart(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}/api/demo-builder/start`, {
    method: 'POST',
    headers: CSRF_HEADERS,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Sorted recursive listing of everything under `root` — used to prove a
 *  rejected /start call creates NOTHING under projectsRoot at all. */
function snapshotTree(root: string): string[] {
  try {
    return (readdirSync(root, { recursive: true }) as string[]).sort();
  } catch {
    return [];
  }
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'demo-builder-start-read-guard-'));
  projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });

  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('positive control (passes before AND after any fix): a legitimate project WITHOUT demo.lock.json defaults mode to "create"', async () => {
  plantProject('proj-create-default');
  assert.ok(existsSync(repoDir('proj-create-default')), 'sanity: the project directory must exist before the request');
  assert.ok(
    !existsSync(join(repoDir('proj-create-default'), '.forge', 'demo', 'demo.lock.json')),
    'sanity: no demo.lock.json must exist yet',
  );

  const { status, json } = await postStart({ project: 'proj-create-default' });
  assert.equal(status, 200, `expected 200 for a legitimate project, got ${status}: ${JSON.stringify(json)}`);
  assert.equal(json.mode, 'create', `expected mode to default to "create" when no demo.lock.json exists, got: ${JSON.stringify(json)}`);
});

test('positive control (passes before AND after any fix): the same project WITH demo.lock.json defaults mode to "update"', async () => {
  plantProject('proj-update-default');
  plantDemoLock('proj-update-default');
  assert.ok(
    existsSync(join(repoDir('proj-update-default'), '.forge', 'demo', 'demo.lock.json')),
    'sanity: demo.lock.json must exist before the request',
  );

  const { status, json } = await postStart({ project: 'proj-update-default' });
  assert.equal(status, 200, `expected 200 for a legitimate project, got ${status}: ${JSON.stringify(json)}`);
  assert.equal(json.mode, 'update', `expected mode to default to "update" when demo.lock.json exists, got: ${JSON.stringify(json)}`);
});

test('positive control (passes before AND after any fix): an explicit body.mode overrides the demo.lock.json probe default, in both directions', async () => {
  // demo.lock.json PRESENT (probe would default to "update") but body.mode
  // explicitly says "create" — the explicit value must win.
  plantProject('proj-explicit-create');
  plantDemoLock('proj-explicit-create');
  const overrideToCreate = await postStart({ project: 'proj-explicit-create', mode: 'create' });
  assert.equal(overrideToCreate.status, 200, `expected 200, got ${overrideToCreate.status}: ${JSON.stringify(overrideToCreate.json)}`);
  assert.equal(
    overrideToCreate.json.mode,
    'create',
    `explicit mode:"create" must win over the demo.lock.json-present probe default ("update"), got: ${JSON.stringify(overrideToCreate.json)}`,
  );

  // demo.lock.json ABSENT (probe would default to "create") but body.mode
  // explicitly says "update" — the explicit value must win.
  plantProject('proj-explicit-update');
  const overrideToUpdate = await postStart({ project: 'proj-explicit-update', mode: 'update' });
  assert.equal(overrideToUpdate.status, 200, `expected 200, got ${overrideToUpdate.status}: ${JSON.stringify(overrideToUpdate.json)}`);
  assert.equal(
    overrideToUpdate.json.mode,
    'update',
    `explicit mode:"update" must win over the demo.lock.json-absent probe default ("create"), got: ${JSON.stringify(overrideToUpdate.json)}`,
  );
});

test('positive control (passes before AND after any fix): a traversing/out-of-root project value is rejected with 400 and creates NOTHING under projectsRoot', async () => {
  const before_ = snapshotTree(projectsRoot);

  const { status, json } = await postStart({ project: '..' });
  assert.equal(status, 400, `a traversing project value must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
  assert.ok(String(json.error ?? '').length > 0, `error must be present, got: ${JSON.stringify(json)}`);

  const after_ = snapshotTree(projectsRoot);
  assert.deepEqual(after_, before_, 'the projectsRoot tree must be byte-for-byte unchanged after a rejected /start — nothing may be created');
});
