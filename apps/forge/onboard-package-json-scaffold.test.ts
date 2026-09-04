/**
 * w8-a1 (bd forge-7pa) — the onboarding `package.json` scaffold pin.
 *
 * packages/projects/preflight.ts's checkC1 was tightened on this branch: a quality gate
 * whose first token is npm/yarn/pnpm/npx/bun/bunx now FAILS unless the
 * project dir itself contains a package.json (and, where the command maps to
 * a script name, that script exists) — without one, npm's own ancestor-
 * package.json walk resolves the command against an ENCLOSING package.json
 * (forge's own root, for a project living under forge's `projects/`), a
 * false green on the wrong repo entirely. Tightening C1 exposed the other
 * half of the defect: `POST /api/studio/projects` (the onboarding form's own
 * route) accepts `qualityGateCmd: 'npm test'` — the form's own default for a
 * JS project — scaffolds the project from nothing, and never wrote a
 * package.json. `apps/forge/onboard-born-green.test.ts` states the headline
 * invariant (a from-scratch project is born contract-green); this file pins
 * the scaffold behaviour that closes it, plus the negative control, the
 * never-clobber rule, the script-name derivation, and a containment pin in
 * the `.gitignore` precedent's style.
 *
 * `needsPackageJsonScaffold`'s third conjunct (peer-review follow-up):
 * scaffolding is further scoped to `needsGitInit(projectRoot, forgeRoot)` —
 * only when THIS onboard is itself creating the project's repo. An operator
 * onboarding their OWN existing checkout (a Go repo, a Python repo) with the
 * form's JS-shaped `npm test` default left in place must NOT get a
 * fabricated package.json dropped into a repo of a language it does not
 * use — the honest outcome there is exactly what C1 already says: fail
 * loudly, with the message telling the operator to add a package.json or
 * declare a non-package-manager gate. The "no-litter" pin below covers this.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; text: string; json?: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* not JSON — leave undefined */
  }
  return { status: res.status, text, json };
}

before(async () => {
  forgeRoot = tmp('onboard-pkgjson-scaffold-');
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });

  // Probe symlink availability once (mirrors apps/forge/bridge-studio-project-create-containment.test.ts).
  const probeDir = tmp('onboard-pkgjson-symlink-probe-');
  try {
    symlinkSync(probeDir, join(forgeRoot, 'projects', '__symlink_probe__'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(join(forgeRoot, 'projects', '__symlink_probe__'), { force: true });
  rmSync(probeDir, { recursive: true, force: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url: bridgeUrl, close: closeServer } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeServer) await closeServer();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

test('POST /api/studio/projects: qualityGateCmd "npm test" scaffolds a package.json with scripts.test, and the project is born ready with zero failing hard clauses', async () => {
  const { status, json } = await post('/api/studio/projects', {
    name: 'Pkg Json Npm Test',
    northStar: 'A project onboarded with the default npm test gate.',
    qualityGateCmd: 'npm test',
  });
  assert.equal(status, 200);
  assert.equal(json?.ok, true);
  assert.equal(json?.id, 'pkg-json-npm-test');

  const projectDir = join(forgeRoot, 'projects', 'pkg-json-npm-test');
  const pkgPath = join(projectDir, 'package.json');
  assert.ok(existsSync(pkgPath), 'a package.json must be scaffolded at the project root');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
  assert.equal(typeof pkg.scripts?.test, 'string', 'scripts.test must exist');
  assert.notEqual(pkg.scripts!.test.trim(), '', 'scripts.test must be a non-empty string (C1 rejects an empty one)');

  const failing = json?.failingClauses as Array<{ id: string; detail: string }>;
  assert.deepEqual(failing, [], `zero hard clauses may fail — got: ${JSON.stringify(failing)}`);
  assert.equal(json?.ready, true);
});

test('POST /api/studio/projects: qualityGateCmd "go test ./..." writes NO package.json — negative control, scoped to package-manager gates only', async () => {
  const { status, json } = await post('/api/studio/projects', {
    name: 'Pkg Json Go Test',
    northStar: 'A Go project — the C1 npm/yarn/pnpm shape must not apply.',
    qualityGateCmd: 'go test ./...',
  });
  assert.equal(status, 200);
  assert.equal(json?.ok, true);

  const projectDir = join(forgeRoot, 'projects', 'pkg-json-go-test');
  assert.ok(!existsSync(join(projectDir, 'package.json')), 'a non-package-manager gate must not scaffold a package.json at all');
});

test('POST /api/studio/projects: an EXISTING package.json in the project root is left byte-unchanged (never-clobber)', async () => {
  // Dir basename deliberately differs from the derived id: discoverProjects
  // lists ANY slug-named dir under projects/ (config or not), so an id equal
  // to the dir name would trip the duplicate-id 409 before ever reaching the
  // scaffold under test (same precedent as apps/forge/onboard-born-green.test.ts's
  // "legacy-checkout" test).
  const projectDir = join(forgeRoot, 'projects', 'pkg-json-preexisting-checkout');
  mkdirSync(projectDir, { recursive: true });
  const original = JSON.stringify({ name: 'operator-owned', version: '1.2.3', private: false, scripts: { test: 'jest' } }, null, 2) + '\n';
  writeFileSync(join(projectDir, 'package.json'), original);

  const { status, json } = await post('/api/studio/projects', {
    name: 'Pkg Json Preexisting',
    northStar: 'Onboarding an existing checkout that already has a package.json.',
    qualityGateCmd: 'npm test',
    repoPath: 'projects/pkg-json-preexisting-checkout',
  });
  assert.equal(status, 200, `onboard must succeed — got ${status}: ${JSON.stringify(json)}`);

  const bytesAfter = readFileSync(join(projectDir, 'package.json'), 'utf8');
  assert.equal(bytesAfter, original, "the operator's existing package.json must be byte-unchanged");
});

test('POST /api/studio/projects: onboarding an operator\'s OWN existing repo with "npm test" left as the gate does NOT litter a package.json into it (no-litter, needsGitInit conjunct)', async () => {
  // Dir basename deliberately differs from the derived id — same duplicate-id
  // precedent as the never-clobber test above.
  const projectDir = join(forgeRoot, 'projects', 'pkg-json-own-repo-checkout');
  mkdirSync(projectDir, { recursive: true });
  // The project IS its own git repo already — `needsGitInit` must read this
  // as "own repo, skip" (no commit required: `git rev-parse --show-toplevel`
  // resolves on an unborn repo too). No package.json exists in it — a real
  // non-JS project (imagine a Go/Python repo) that the operator onboarded
  // without noticing the form's JS-shaped default gate.
  execFileSync('git', ['init', '-q'], { cwd: projectDir, stdio: 'ignore' });
  assert.ok(!existsSync(join(projectDir, 'package.json')), 'sanity: no package.json before the request');

  const { status, json } = await post('/api/studio/projects', {
    name: 'Pkg Json Own Repo',
    northStar: 'Onboarding an existing, non-JS repo with the JS-shaped default gate left in place.',
    qualityGateCmd: 'npm test',
    repoPath: 'projects/pkg-json-own-repo-checkout',
  });
  assert.equal(status, 200, `onboard must succeed — got ${status}: ${JSON.stringify(json)}`);

  // The decisive assertion is on the FILESYSTEM, not the response: forge
  // must not fabricate a package.json inside a repo it did not itself just
  // create. C1 is expected to fail honestly instead — asserted here too, so
  // this pin cannot pass by accident (e.g. some unrelated future clause
  // change silently making C1 permissive for this shape).
  assert.ok(
    !existsSync(join(projectDir, 'package.json')),
    'onboarding an operator\'s own existing repo must NEVER scaffold a package.json into it — that is litter in a repo forge does not own the creation of',
  );
  const failing = (json?.failingClauses as Array<{ id: string; detail: string }> | undefined) ?? [];
  const c1 = failing.find((c) => c.id === 'C1');
  assert.ok(c1, `C1 must fail honestly for this shape (no package.json, own repo, gate left as npm test) — got failingClauses: ${JSON.stringify(failing)}`);
});

test('POST /api/studio/projects: qualityGateCmd "npm run verify" produces a package.json whose scripts contains "verify"', async () => {
  const { status, json } = await post('/api/studio/projects', {
    name: 'Pkg Json Npm Run Verify',
    northStar: 'A project whose gate is a named script, not the bare "test" verb.',
    qualityGateCmd: 'npm run verify',
  });
  assert.equal(status, 200);
  assert.equal(json?.ok, true);

  const pkgPath = join(forgeRoot, 'projects', 'pkg-json-npm-run-verify', 'package.json');
  assert.ok(existsSync(pkgPath));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
  assert.equal(typeof pkg.scripts?.verify, 'string', 'scripts.verify must exist — the declared gate names it, not "test"');
  assert.notEqual(pkg.scripts!.verify.trim(), '');
});

test('(RED) POST /api/studio/projects: a symlinked package.json pointing outside the project root is REFUSED, not written through', async (t) => {
  // Mirrors apps/forge/bridge-studio-project-create-containment.test.ts's dangling-
  // leaf shape for roadmap.md/brain/profile.md exactly (same escape class,
  // same `resolveGuardedPath` guard): a DANGLING symlink is what actually
  // drives the pure Phase-1 pre-check (`checkContractArtifactContainment`)
  // into rejecting the whole onboard with a non-200 BEFORE any write on the
  // route runs — a LIVE-target symlink instead reads as "already exists" to
  // `needsPackageJsonScaffold`'s existence probe and is silently SKIPPED
  // (200, accidentally safe, the same shape roadmap.md's own "MEASURED"
  // sibling test names), which cannot satisfy the "does not 200" half of
  // this pin.
  if (skipIfNoSymlinks(t)) return;

  // Dir basename deliberately differs from the derived id (same precedent as
  // the never-clobber test above and apps/forge/onboard-born-green.test.ts's
  // "legacy-checkout" test): discoverProjects lists ANY slug-named dir under
  // projects/, so an id equal to the dir name would trip the duplicate-id
  // 409 before ever reaching the containment pre-check under test — which
  // would make this pin pass for the WRONG reason.
  const projectDir = join(forgeRoot, 'projects', 'pkg-json-symlink-escape-checkout');
  mkdirSync(projectDir, { recursive: true });
  const outside = newOutsideDir('pkg-json-symlink-escape-outside-');
  const danglingTarget = join(outside, 'package-dangling-target.json');
  symlinkSync(danglingTarget, join(projectDir, 'package.json'));
  assert.ok(!existsSync(danglingTarget), 'sanity: the dangling target must not exist before the request');

  const { status, text } = await post('/api/studio/projects', {
    name: 'Pkg Json Symlink Escape',
    northStar: 'An attempt to onboard through a pre-planted symlinked package.json.',
    qualityGateCmd: 'npm test',
    repoPath: 'projects/pkg-json-symlink-escape-checkout',
  });

  assert.equal(
    status,
    400,
    `a symlinked package.json pointing outside the project root must be REFUSED by the containment pre-check (400), not 200 into a successful scaffold, and not some unrelated status — got ${status}: ${text}`,
  );
  assert.ok(
    !existsSync(danglingTarget),
    `the outside target must remain byte-unchanged (never created) — the route must never write through the symlink — got ${status}: ${text}`,
  );
});
