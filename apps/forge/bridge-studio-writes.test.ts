/**
 * ACCEPTANCE TESTS (SEC-05 / forge-4on, P1) — the greenfield create route is
 * NON-TRANSACTIONAL, end-to-end through the real bridge.
 *
 * The defect lives in `scaffoldGreenfieldProject` (orchestrator/project-create.ts),
 * which is reached ONLY via `POST /api/studio/projects/create` (the greenfield
 * route — cli/bridge-studio-writes.ts:732). `POST /api/studio/projects` is the
 * ONBOARD route and does NOT call `scaffoldGreenfieldProject`; the containment
 * ATs for that route live in cli/bridge-studio-project-create-containment.test.ts.
 * These two ATs drive the /create route because that is the surface the defect
 * is reachable from.
 *
 * Phase 2 of `scaffoldGreenfieldProject` writes copyTemplate → seedProjectBrain
 * → runPreflight with NO unwind on a throw between the first write and the last.
 * A tail throw after `seedProjectBrain` wrote `brain/projects/<id>/kb.yaml`
 * leaves a PHANTOM KB: `loadKbDescriptors` (cli/bridge-studio-kbs.ts:132-133)
 * walks `brain/projects/` as its own containment root, so GET /api/studio/kbs
 * lists that `<id>` even though the operator was told the create FAILED. The
 * half-created `projects/<id>` is likewise adopted by `discoverProjects`, so GET
 * /api/studio/projects lists it too. Both are RED at base below.
 *
 * INJECTION (both tests): pre-create `brain/projects/<id>/themes` read-only, so
 * `seedProjectBrain` writes `kb.yaml` + `profile.md` into the writable `<id>`
 * dir and then throws EACCES writing `themes/README.md` — the tail-most
 * reproducible Phase-2 throw (runPreflight is a pure non-throwing reporter).
 *
 * THE RULED FIX these pin: stage-then-atomic-move (staging dirs on the same fs,
 * renameSync into place on full success, `.forge/.create-complete` written LAST,
 * a pre-create/boot reconcile sweeping marker-less `projects/<id>` and orphan
 * `brain/projects/<id>`). Under that fix the first attempt either fully succeeds
 * (staging sidesteps the partial-write window; reconcile sweeps the pre-plant)
 * or fails clean with no orphan — either way the assertions below are GREEN. NOT
 * a reordering.
 *
 * Assertions are on the LISTING ARTIFACT (does the failed create appear in the
 * kbs/projects surface), never on a status code, and every injection is proven
 * armed (the themes dir is really unwritable) before the verdict is read.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';
import { projectStartersDir } from '@forge/projects/project-create.ts';

const REAL_ROOT = process.cwd();

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

/** True iff creating a child under `dir` is actually blocked in this uid (a
 *  0o500 chmod bites). False when the probe write SUCCEEDS (root bypass) → the
 *  caller skips rather than false-fail. Cleans up its own probe. */
function writeIsBlocked(dir: string): boolean {
  const probe = join(dir, `.__wprobe_${Math.random().toString(36).slice(2)}`);
  try {
    mkdirSync(probe);
    rmSync(probe, { recursive: true, force: true });
    return false;
  } catch {
    return true;
  }
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'sec05-4on-writes-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });
  // The greenfield /create route scaffolds from the real starter library under
  // <forgeRoot>/studio/starters/projects/ — copy it in so a NORMAL create 200s.
  const startersDest = join(forgeRoot, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(REAL_ROOT), startersDest, { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function postCreate(body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${bridgeUrl}/api/studio/projects/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function listIds(path: string, key: 'projects' | 'kbs'): Promise<string[]> {
  const res = await fetch(`${bridgeUrl}${path}`);
  const json = (await res.json()) as Record<string, Array<{ id: string }>>;
  return (json[key] ?? []).map((e) => e.id);
}

/** Arm the tail-failure injection for `id`: a read-only themes/ under a writable
 *  brain/projects/<id>. Returns false (already restored) if 0o500 does not bite
 *  (root env) so the caller can skip. */
function armTailFailure(id: string): boolean {
  const themesDir = join(forgeRoot, 'brain', 'projects', id, 'themes');
  mkdirSync(themesDir, { recursive: true });
  chmodSync(themesDir, 0o500);
  if (!writeIsBlocked(themesDir)) {
    chmodSync(themesDir, 0o755);
    return false;
  }
  return true;
}

/** Clear the injection: restore perms and remove the pre-planted brain dir so a
 *  retry (base) is unblocked by the transient and (fix) has no leftover to trip. */
function clearInjection(id: string): void {
  const brainDir = join(forgeRoot, 'brain', 'projects', id);
  const themesDir = join(brainDir, 'themes');
  try { chmodSync(themesDir, 0o755); } catch { /* already gone */ }
  rmSync(brainDir, { recursive: true, force: true });
}

test('AT-4on-4 (RED) [SEC-05 4on] a FAILED greenfield create must not leave a phantom KB in GET /api/studio/kbs; the create stays retryable', async (t) => {
  const id = 'phantom-kb-probe';
  const brainDir = join(forgeRoot, 'brain', 'projects', id);
  try {
    if (!armTailFailure(id)) { t.skip('chmod 0o500 does not block writes (running as root?)'); return; }
    assert.ok(!existsSync(join(brainDir, 'kb.yaml')), 'precondition: no kb.yaml before the create');

    const first = await postCreate({ name: id, appType: 'typescript-cli', northStar: 'ship the thing' });

    if (first.status !== 200) {
      // The operator was told the create FAILED — it must not have leaked a KB.
      // RED at base: seedProjectBrain wrote brain/projects/<id>/kb.yaml before
      // throwing on themes/README.md, so GET /api/studio/kbs lists the phantom.
      const kbs = await listIds('/api/studio/kbs', 'kbs');
      assert.ok(
        !kbs.includes(id),
        `a FAILED create (status ${first.status}) left a phantom KB "${id}" listed by GET /api/studio/kbs — got: ${JSON.stringify(kbs)}`,
      );

      // ...and the create must be reachable to success on retry once the
      // transient is cleared. RED at base: the projects/<id> orphan → 400
      // "already exists".
      clearInjection(id);
      const second = await postCreate({ name: id, appType: 'typescript-cli', northStar: 'ship the thing' });
      assert.equal(second.status, 200, `the retry after a failed create must succeed — got ${second.status}: ${second.text}`);
    }

    // End state (both first-succeeded and retry-succeeded paths): exactly one
    // real KB for <id>, never zero and never a phantom duplicate.
    const kbsFinal = await listIds('/api/studio/kbs', 'kbs');
    assert.equal(kbsFinal.filter((k) => k === id).length, 1, `exactly one KB must be listed for the created project — got: ${JSON.stringify(kbsFinal)}`);
  } finally {
    clearInjection(id);
  }
});

test('AT-4on-6 (RED) [SEC-05 4on] a FAILED greenfield create appears in NEITHER GET /api/studio/projects NOR GET /api/studio/kbs; retry lands a single clean project', async (t) => {
  const id = 'both-surfaces-probe';
  try {
    if (!armTailFailure(id)) { t.skip('chmod 0o500 does not block writes (running as root?)'); return; }

    const first = await postCreate({ name: id, appType: 'typescript-cli', northStar: 'ship the thing' });

    if (first.status !== 200) {
      // RED at base on BOTH surfaces: the half-created projects/<id> is adopted
      // by discoverProjects AND the phantom brain/projects/<id>/kb.yaml by
      // loadKbDescriptors — a create the operator was told FAILED.
      const projects = await listIds('/api/studio/projects', 'projects');
      const kbs = await listIds('/api/studio/kbs', 'kbs');
      assert.ok(!projects.includes(id), `a FAILED create (status ${first.status}) left an orphan project "${id}" in GET /api/studio/projects — got: ${JSON.stringify(projects)}`);
      assert.ok(!kbs.includes(id), `a FAILED create (status ${first.status}) left a phantom KB "${id}" in GET /api/studio/kbs — got: ${JSON.stringify(kbs)}`);

      clearInjection(id);
      const second = await postCreate({ name: id, appType: 'typescript-cli', northStar: 'ship the thing' });
      assert.equal(second.status, 200, `the retry after a failed create must succeed — got ${second.status}: ${second.text}`);
    }

    // End state: exactly one project AND one KB for <id> — the two surfaces agree.
    const projectsFinal = await listIds('/api/studio/projects', 'projects');
    const kbsFinal = await listIds('/api/studio/kbs', 'kbs');
    assert.equal(projectsFinal.filter((p) => p === id).length, 1, `exactly one project must be listed for the created id — got: ${JSON.stringify(projectsFinal)}`);
    assert.equal(kbsFinal.filter((k) => k === id).length, 1, `exactly one KB must be listed for the created id — got: ${JSON.stringify(kbsFinal)}`);
  } finally {
    clearInjection(id);
  }
});
