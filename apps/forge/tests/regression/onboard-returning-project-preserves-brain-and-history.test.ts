/**
 * forge-mfv5.2.6 — a RETURNING project through the real onboarding route.
 *
 * The bead's question: a project can have a forge-owned Brain 3
 * (`brain/projects/<name>/`, SPEC §4) and a real `forge/history/<initiative-id>/`
 * convention from prior merged forge initiatives, while carrying NO
 * `.forge/project.json` — trafficGame is the real case named in the bead.
 * Measured on 591f75a2: `checkProjectBrainSeedContainment` /
 * `seedProjectBrain` (`packages/knowledge/project-brain-seed.ts` ~:232-249,
 * ~:300-329) only ever probe the SAME-id brain path with a plain
 * `existsSync` per fixed target (`kb.yaml`, `profile.md`, `themes/README.md`)
 * before writing — never a duplicate-id write, never a directory listing of
 * `themes/` — and `handleProjectsOnboard`
 * (`packages/projects/bridge-studio-project-onboard.ts` ~:295-309, ~:347-349)
 * 409s on a duplicate id ONLY when the discovered directory already has a
 * `.forge/project.json`, and separately 400s a `repoPath` that already has
 * one — neither ever inspects `forge/history/`, which this ROUTE never
 * touches at all. Nothing in either module enumerates or duplicates an
 * existing Brain 3 under a second id. This test drives the REAL onboarding
 * path — `handleProjectsOnboard`, wired with the REAL `seedProjectBrain` /
 * `checkProjectBrainSeedContainment` (`apps/forge/routes.ts`'s
 * `seedBrain: seedProjectBrain, checkBrainSeedContainment:
 * checkProjectBrainSeedContainment`, both from `@forge/knowledge`) via the
 * real HTTP bridge (`startBridge`, same pattern as
 * `onboard-born-green.test.ts`) — to pin the answer with evidence rather than
 * leave it "probably fine."
 *
 * Ground: `tests/stories/grounds/node-returning-no-contract` (its own
 * `PROVENANCE.md` records the real, corpus-grounded `forge/history/` slice
 * and the SYNTHETIC Brain 3 stub). This test copies that fixture's `seed/`
 * into a tmp forge root's `projects/returning-cli/` and its `brain/` into
 * the SAME tmp forge root's `brain/projects/returning-cli/` — the "set up a
 * brain root" pattern `packages/knowledge/tests/unit/project-brain-seed.test.ts`
 * already uses (a bare `mkdtempSync` forge root, `brain/projects/<id>/`
 * populated directly) — never touching the real, checked-in
 * `brain/projects/trafficGame/` this bead is actually about.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { startBridge } from '../../ui-bridge.ts';

const GROUND = join(import.meta.dirname, '..', '..', '..', '..', 'tests', 'stories', 'grounds', 'node-returning-no-contract');
const PROJECT_ID = 'returning-cli';

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

/** Every REGULAR file under `dir`, as `{relPath: contentBuffer}` — a byte-level
 *  snapshot, not a listing, so "survives byte-identical" is provable rather
 *  than merely "still exists". */
function snapshotFiles(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const p = join(abs, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) out.set(relative(dir, p), readFileSync(p));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'onboard-returning-project-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  ({ url: bridgeUrl, close: closeServer } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeServer) await closeServer();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('a returning project (real Brain 3 + real forge/history/, no .forge/) onboards without clobbering either, and gets a contract', async () => {
  // Arrange: the fixture's seed/ IS the project directory — a bare checkout
  // with forge/history/ already on disk and no .forge/ anywhere (the ground's
  // own PROVENANCE.md confirms this directly). The fixture's brain/ IS the
  // project's pre-existing, forge-owned Brain 3 — placed at the exact path
  // `seedProjectBrain` reads/writes (`brain/projects/<id>/`), the same way
  // `project-brain-seed.test.ts` plants a hand-authored profile.md before
  // asserting it survives.
  const projectRoot = join(forgeRoot, 'projects', PROJECT_ID);
  const brainRoot = join(forgeRoot, 'brain', 'projects', PROJECT_ID);
  cpSync(join(GROUND, 'seed'), projectRoot, { recursive: true });
  cpSync(join(GROUND, 'brain'), brainRoot, { recursive: true });

  assert.equal(existsSync(join(projectRoot, '.forge', 'project.json')), false, 'arrange: the ground must carry no contract, or this test proves nothing');
  assert.equal(existsSync(join(brainRoot, 'kb.yaml')), true, 'arrange: the pre-existing Brain 3 must already be on disk');
  assert.equal(existsSync(join(projectRoot, 'forge', 'history')), true, 'arrange: the pre-existing forge/history/ must already be on disk');

  const historyBefore = snapshotFiles(join(projectRoot, 'forge', 'history'));
  const brainBefore = snapshotFiles(brainRoot);
  assert.ok(historyBefore.size > 0, 'arrange: forge/history/ must carry real files');
  assert.ok(brainBefore.size >= 4, 'arrange: the pre-existing Brain 3 must carry kb.yaml + profile.md + 2 theme pages');

  // Act: the real onboarding route, the real seedProjectBrain, the real
  // checkProjectBrainSeedContainment — no fakes anywhere in this call.
  const { status, json } = await post('/api/studio/projects', {
    name: PROJECT_ID,
    northStar: 'Re-onboard a returning project without losing its brain or its history.',
    qualityGateCmd: 'echo ok',
  });

  // Assert 3: the contract is produced, same as for any unonboarded project.
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
  assert.equal(json.ok, true);
  assert.equal(json.id, PROJECT_ID);
  assert.ok(existsSync(join(projectRoot, '.forge', 'project.json')), 'the onboard must produce .forge/project.json, same as any unonboarded project');

  // Assert 1: the existing Brain 3 survives byte-identical — not overwritten,
  // not duplicated under another id, not re-seeded.
  const brainAfter = snapshotFiles(brainRoot);
  for (const [relPath, before_] of brainBefore) {
    assert.ok(brainAfter.has(relPath), `Brain 3 file ${relPath} vanished after onboarding`);
    assert.deepEqual(brainAfter.get(relPath), before_, `Brain 3 file ${relPath} was NOT byte-identical after onboarding — it was overwritten or re-seeded`);
  }
  // Not duplicated under another id: exactly one directory under
  // brain/projects/, named for THIS project and no other.
  const brainProjectsDirs = readdirSync(join(forgeRoot, 'brain', 'projects'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(brainProjectsDirs, [PROJECT_ID], 'the existing Brain 3 must not be duplicated under a second id');
  // The route's own report on the pre-existing fixed targets: skipped, not
  // (re-)created — `seedProjectBrain`'s idempotent-per-file contract, proven
  // through the real response, not merely asserted of the module in isolation.
  const brainSeedFiles = json.brainSeed as Array<{ path: string; action: string }>;
  const byPath = new Map(brainSeedFiles.map((f) => [f.path, f.action]));
  assert.equal(byPath.get(`brain/projects/${PROJECT_ID}/kb.yaml`), 'skipped-existing');
  assert.equal(byPath.get(`brain/projects/${PROJECT_ID}/profile.md`), 'skipped-existing');

  // Assert 2: the project's forge/history/ survives untouched — same files,
  // same bytes.
  const historyAfter = snapshotFiles(join(projectRoot, 'forge', 'history'));
  assert.deepEqual([...historyAfter.keys()].sort(), [...historyBefore.keys()].sort(), 'forge/history/ gained or lost files during onboarding');
  for (const [relPath, before_] of historyBefore) {
    assert.deepEqual(historyAfter.get(relPath), before_, `forge/history/${relPath} was modified during onboarding`);
  }

  // The project directory itself must still be the one on disk (never moved,
  // renamed or re-created elsewhere).
  assert.ok(statSync(projectRoot).isDirectory());
});
