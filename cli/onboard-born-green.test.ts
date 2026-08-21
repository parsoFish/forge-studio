/**
 * W7-FIX-B-PROJ — route-level "born contract-green" pin (R1-03-F1).
 *
 * The stand-up-create A0 journey beat encodes the invariant: creating a
 * project from nothing through POST /api/studio/projects (name + north star +
 * quality gate — the onboarding form) yields a project with ZERO failing hard
 * clauses, so the form navigates straight to the project page. W7-B6's
 * (correct) own-repo git-init exposed that the onboard scaffold never
 * established C2 hygiene in the project's own repo: the freshly-inited repo
 * had no .gitignore, every scratch path probed "not ignored", and every
 * from-scratch project was born hard-failing.
 *
 * This pins the whole route: ready === true, failingClauses === [], and the
 * scaffolded .gitignore on disk.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'onboard-born-green-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  // The projects root must exist for the route's realpath containment guard
  // (in the real forge root it always does).
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  ({ url: bridgeUrl, close: closeServer } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeServer) await closeServer();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('POST /api/studio/projects: a from-scratch project is born contract-green on the hard clauses (R1-03-F1)', async () => {
  const { status, json } = await post('/api/studio/projects', {
    name: 'Journey Fresh Shape',
    northStar: 'A tiny, checkable slice of real value, stood up from nothing.',
    qualityGateCmd: 'npm test',
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.id, 'journey-fresh-shape');

  const failing = json.failingClauses as Array<{ id: string; detail: string }>;
  assert.deepEqual(
    failing,
    [],
    `zero hard clauses may fail at birth — got: ${JSON.stringify(failing)}`,
  );
  assert.equal(json.ready, true, 'ready must be true — the UI navigates straight to the project page on it');

  // The scaffold evidence: own repo + the C2-covering .gitignore beside it.
  const projectDir = join(forgeRoot, 'projects', 'journey-fresh-shape');
  assert.ok(existsSync(join(projectDir, '.git')), 'the project must own its git repo (W7-B6 projects-11)');
  assert.ok(existsSync(join(projectDir, '.gitignore')), 'the scaffold must write the C2 .gitignore when it creates the repo');
});

test('POST /api/studio/projects: an existing own-repo checkout with a dangling-symlink .gitignore is NOT rejected (review F2)', async () => {
  // W7-FIX-B-PROJ review F2: the pure pre-check guarded `.gitignore` on
  // EVERY existing-dir onboard, but the scaffold only writes it on the
  // branches that CREATE the repo (needsInit). An own-repo checkout carrying
  // `.gitignore -> <missing target>` (a dotfiles symlink after a machine
  // move) reads as "absent" to the symlink-following existsSync, reached
  // resolveGuardedPath (which lstats the link), and false-rejected the WHOLE
  // onboard with 400 — for a write that was never going to happen. The
  // pre-check must guard only the paths the route may WRITE (this file's own
  // Finding-B rule): needsInit=false paths never write .gitignore.
  //
  // The checkout dir's basename deliberately differs from the project id:
  // discoverProjects lists ANY slug-named dir under projects/ (config or
  // not), so an id equal to the dir name would trip the duplicate-id 409
  // before ever reaching the containment pre-check under test.
  const projectRoot = join(forgeRoot, 'projects', 'legacy-checkout');
  mkdirSync(projectRoot, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: projectRoot, stdio: 'ignore' });
  symlinkSync(join(projectRoot, 'missing-dotfiles-target'), join(projectRoot, '.gitignore'));

  const { status, json } = await post('/api/studio/projects', {
    name: 'Legacy Own Repo',
    northStar: 'Onboard an existing checkout without touching its files.',
    qualityGateCmd: 'npm test',
    repoPath: 'projects/legacy-checkout',
  });
  assert.equal(status, 200, `onboard must not 400 over a .gitignore it will never write — got ${status}: ${JSON.stringify(json)}`);
  assert.equal(json.ok, true);

  // The operator's dangling symlink is their file — still a link, untouched.
  const st = lstatSync(join(projectRoot, '.gitignore'));
  assert.ok(st.isSymbolicLink(), 'the operator .gitignore symlink must be left exactly as it was');
});
