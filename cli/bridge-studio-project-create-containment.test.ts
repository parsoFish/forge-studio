/**
 * ACCEPTANCE TESTS (SEC-03, T3) — two real defects on `POST
 * /api/studio/projects` (cli/bridge-studio-writes.ts ~683-737), pinned RED
 * against today's code:
 *
 * DEFECT 1 (P0) — lexical containment bypass. The route computes
 *   `projectRoot = resolve(ctx.forgeRoot, repoPathRel)` then checks
 *   `!projectRoot.startsWith(resolve(ctx.forgeRoot) + sep)`. `path.resolve()`
 *   is PURE STRING MATH — no filesystem I/O, no symlink following — so it
 *   DOES correctly collapse a literal `..` and fold an absolute `repoPath`
 *   before the comparison runs (MEASURED below, not assumed: a plain
 *   `..`-traversal or an absolute outside path is already rejected today —
 *   see the "non-regression" tests). What it CANNOT see is a symlink's own
 *   on-disk TARGET: a symlinked `<root>/<id>` is lexically inside the allowed
 *   root even when it POINTS somewhere else entirely — the "guard that
 *   cannot fail" shape this whole campaign
 *   (docs/security-request-path-audit.md) exists to close. Reproduced live
 *   below via a real `startBridge()` HTTP round-trip for every escape shape
 *   that DOES defeat this check at this call site: leaf dir symlink,
 *   one-level-nested dir symlink, a cross-object symlink alias (a DIFFERENT
 *   real project dir under the SAME `projects/` root), and a `repoPath` that
 *   is inside forgeRoot but OUTSIDE `projects/` (today's check only verifies
 *   "under forgeRoot at all"; the intended fix — `isContainedProjectRepoPath`,
 *   root = `<forgeRoot>/projects` — narrows and rejects it). The plain
 *   `..`-traversal and absolute-repoPath shapes from the audit's generic
 *   catalogue are ALSO exercised below, but as non-regression pins (they
 *   already pass) rather than RED pins — see the note ahead of them.
 *
 * DEFECT 2 — sibling-project CLOBBER (audit row `cli/bridge-studio-
 *   writes.ts:679-737`, bd `forge-q80`). The final
 *   `writeFileSync(resolve(forgeDir,'project.json'), ...)` has NO existence
 *   check. A fresh, non-colliding `name` (so the 409 duplicate-id scan,
 *   which keys off `discoverProjects()` ids, never fires) with `repoPath`
 *   aimed at an ALREADY-ONBOARDED project overwrites that project's
 *   `.forge/project.json` wholesale — including `testProcess.local.cmd`, the
 *   quality-gate command forge later EXECUTES. A containment guard cannot
 *   close this on its own: `projects/<victim>` is genuinely, honestly
 *   contained — this is an application-level invariant (does an onboarded
 *   project already live there?), not a path-identity question.
 *
 * BINDING RULES applied throughout (four review rounds of this campaign):
 *   - Every escape assertion is on the SECURITY PROPERTY (outside/sibling
 *     bytes untouched, no new artifacts appear) — never a pre-fix status
 *     code used as a precondition.
 *   - Every symlink-based escape plants REAL sentinel bytes at the target
 *     and asserts on those bytes (never a bare 404/mtime-absent check that
 *     could pass by accident regardless of containment).
 *   - Positive controls are mandatory and pinned to PASS both before and
 *     after any fix — each one says so in its own comment.
 *   - Every claim is driven through the REAL route via `startBridge` +
 *     `fetch`, mirroring the fixture idiom in
 *     `cli/bridge-studio-sibling-containment.test.ts`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

/** Plant a sentinel file with distinctive bytes at `dir/SENTINEL.txt`. */
function plantSentinel(dir: string, marker: string): void {
  writeFileSync(join(dir, 'SENTINEL.txt'), `${marker}\n`);
}

function readSentinel(dir: string): string {
  return readFileSync(join(dir, 'SENTINEL.txt'), 'utf8');
}

/** True iff any of the four project-onboarding artifacts exist under `dir`. */
function hasAnyProjectArtifact(dir: string): { forge: boolean; git: boolean; roadmap: boolean; brainProfile: boolean } {
  return {
    forge: existsSync(join(dir, '.forge', 'project.json')),
    git: existsSync(join(dir, '.git')),
    roadmap: existsSync(join(dir, 'roadmap.md')),
    brainProfile: existsSync(join(dir, 'brain', 'profile.md')),
  };
}

function assertNoArtifactsCreated(dir: string, context: string): void {
  const got = hasAnyProjectArtifact(dir);
  assert.deepEqual(
    got,
    { forge: false, git: false, roadmap: false, brainProfile: false },
    `${context}: no project-onboarding artifact (.forge/project.json, .git, roadmap.md, brain/profile.md) may be created at "${dir}" — got ${JSON.stringify(got)}`,
  );
}

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

before(async () => {
  forgeRoot = tmp('project-create-containment-');

  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, '_queue2-unused'), { recursive: true }); // never referenced; keeps _queue's own dirs untouched by an accidental collision
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });

  // Probe symlink availability once.
  const probeDir = tmp('project-create-symlink-probe-');
  try {
    symlinkSync(probeDir, join(forgeRoot, 'projects', '__symlink_probe__'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(join(forgeRoot, 'projects', '__symlink_probe__'), { force: true });
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

async function postProject(body: unknown): Promise<{ status: number; text: string; json?: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}/api/studio/projects`, {
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

// ---------------------------------------------------------------------------
// Positive controls (rule 4) — MUST pass both BEFORE and AFTER any fix.
// ---------------------------------------------------------------------------

test('positive control (passes before AND after any fix): default repoPath (omitted) onboards at projects/<id>', async () => {
  const { status, text, json } = await postProject({
    name: 'default-repo-path-project',
    qualityGateCmd: 'echo ok',
  });
  assert.equal(status, 200, `expected the default (omitted repoPath) onboarding to succeed — got ${status}: ${text}`);
  assert.equal(json?.ok, true, `expected ok:true — got ${text}`);
  const expectedPath = join(forgeRoot, 'projects', 'default-repo-path-project', '.forge', 'project.json');
  assert.ok(existsSync(expectedPath), `expected .forge/project.json at the default projects/<id> location "${expectedPath}"`);
  const cfg = JSON.parse(readFileSync(expectedPath, 'utf8')) as Record<string, unknown>;
  assert.deepEqual((cfg.testProcess as Record<string, unknown>)?.local, { cmd: ['echo', 'ok'] });
});

test('positive control (passes before AND after any fix): an explicit legitimate repoPath "projects/<id>" onboards correctly', async () => {
  const { status, text, json } = await postProject({
    name: 'explicit-legit-project',
    repoPath: 'projects/explicit-legit-dir',
    qualityGateCmd: 'echo explicit-ok',
  });
  assert.equal(status, 200, `expected an explicit, genuinely-contained repoPath to succeed — got ${status}: ${text}`);
  assert.equal(json?.ok, true, `expected ok:true — got ${text}`);
  const expectedPath = join(forgeRoot, 'projects', 'explicit-legit-dir', '.forge', 'project.json');
  assert.ok(existsSync(expectedPath), `expected .forge/project.json at the explicit repoPath location "${expectedPath}"`);
});

test('positive control (passes before AND after any fix): escape-and-return "projects/../projects/<id>" is ACCEPTED — resolve() normalises it to a genuinely contained path', async () => {
  const { status, text, json } = await postProject({
    name: 'escape-and-return-project',
    repoPath: 'projects/../projects/escape-and-return-dir',
    qualityGateCmd: 'echo return-ok',
  });
  assert.equal(status, 200, `an escape-and-return repoPath that resolves to a genuinely contained path must be ACCEPTED, not rejected — got ${status}: ${text}`);
  assert.equal(json?.ok, true, `expected ok:true — got ${text}`);
  const expectedPath = join(forgeRoot, 'projects', 'escape-and-return-dir', '.forge', 'project.json');
  assert.ok(existsSync(expectedPath), `expected .forge/project.json at the normalised, contained location "${expectedPath}"`);
});

// ---------------------------------------------------------------------------
// DEFECT 1 — escape shapes. Each kills a DIFFERENT wrong implementation.
// ---------------------------------------------------------------------------

test('(RED) [Defect 1, shape: leaf dir symlink] repoPath "projects/escape-link/nested" through a symlinked projects/escape-link -> outside writes nothing outside forgeRoot', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('project-create-leaf-symlink-outside-');
  plantSentinel(outside, 'SENTINEL-LEAF-SYMLINK-9c31a');
  symlinkSync(outside, join(forgeRoot, 'projects', 'escape-link'), 'dir');

  const { status, text } = await postProject({
    name: 'totally-new-project',
    repoPath: 'projects/escape-link/nested',
    qualityGateCmd: 'echo ok',
  });

  assertNoArtifactsCreated(outside, `leaf dir symlink escape (status ${status}: ${text})`);
  assert.equal(readSentinel(outside), 'SENTINEL-LEAF-SYMLINK-9c31a\n', 'the outside sentinel bytes must be byte-unchanged');
  assert.notEqual(status, 200, `today's lexical resolve().startsWith() check accepts this and creates real project artifacts outside forgeRoot — the fix must reject it — got ${status}: ${text}`);
});

test('(RED) [Defect 1, shape: nested dir symlink, one level down] repoPath "projects/real-parent/escape-link" through a nested symlink writes nothing outside forgeRoot', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  mkdirSync(join(forgeRoot, 'projects', 'real-parent'), { recursive: true });
  const outside = newOutsideDir('project-create-nested-symlink-outside-');
  plantSentinel(outside, 'SENTINEL-NESTED-SYMLINK-4e71d');
  symlinkSync(outside, join(forgeRoot, 'projects', 'real-parent', 'escape-link'), 'dir');

  const { status, text } = await postProject({
    name: 'totally-new-nested-project',
    repoPath: 'projects/real-parent/escape-link',
    qualityGateCmd: 'echo ok',
  });

  assertNoArtifactsCreated(outside, `nested dir symlink escape (status ${status}: ${text})`);
  assert.equal(readSentinel(outside), 'SENTINEL-NESTED-SYMLINK-4e71d\n', 'the outside sentinel bytes must be byte-unchanged');
  assert.notEqual(status, 200, `the symlinked segment one level below "real-parent" must be rejected — got ${status}: ${text}`);
});

// NOTE (measured, not assumed): the three tests below were ORIGINALLY written
// as "(RED)" pins for the ".."-traversal and absolute-repoPath escape shapes
// the audit catalogues generically. Running them against today's code shows
// they already PASS — this call site's check is
//   projectRoot = resolve(ctx.forgeRoot, repoPathRel);
//   projectRoot.startsWith(resolve(ctx.forgeRoot) + sep)
// and `path.resolve()` is PURE STRING MATH (no filesystem I/O, no symlink
// following) that collapses ".." and folds an absolute second argument
// BEFORE the comparison runs — so for a repoPath with no symlink involved,
// the resolved string genuinely lands outside forgeRoot and the prefix check
// correctly rejects it, exactly as intended. That is NOT the defect: the
// defect (proven above) is that this SAME check is blind to a symlink, whose
// on-disk TARGET the check can never see because `resolve()` never touches
// the filesystem. Relabelled as non-regression pins per binding rule 1
// (AT-pins-the-defect — a test that already passes today is not a RED
// acceptance test for this defect) rather than dropped, since the intended
// fix (isContainedProjectRepoPath / resolveGuardedPath) must not regress
// these already-correct rejections.

test('non-regression (passes today; must keep passing after any fix): plain ".."-traversal ("../outside-x") is ALREADY rejected — resolve() collapses it before the comparison runs, no symlink involved', async () => {
  const outside = newOutsideDir('project-create-dotdot-a-outside-');
  plantSentinel(outside, 'SENTINEL-DOTDOT-A-7b02e');
  const repoPath = `../${basename(outside)}`;
  assert.equal(dirname(forgeRoot), dirname(outside), 'sanity: forgeRoot and the outside dir must be siblings under the same tmp parent for this repoPath to reach it');

  const { status, text } = await postProject({
    name: 'dotdot-a-project',
    repoPath,
    qualityGateCmd: 'echo ok',
  });

  assertNoArtifactsCreated(outside, `"../outside-x" traversal (status ${status}: ${text})`);
  assert.equal(readSentinel(outside), 'SENTINEL-DOTDOT-A-7b02e\n', 'the outside sentinel bytes must be byte-unchanged');
  assert.equal(status, 400, `expected today's resolved-path prefix check to already reject this plain (non-symlink) traversal — got ${status}: ${text}`);
});

test('non-regression (passes today; must keep passing after any fix): a longer ".."-traversal string ("projects/../../outside-x") resolving to the same escape is ALREADY rejected', async () => {
  const outside = newOutsideDir('project-create-dotdot-b-outside-');
  plantSentinel(outside, 'SENTINEL-DOTDOT-B-2f88c');
  const repoPath = `projects/../../${basename(outside)}`;

  const { status, text } = await postProject({
    name: 'dotdot-b-project',
    repoPath,
    qualityGateCmd: 'echo ok',
  });

  assertNoArtifactsCreated(outside, `"projects/../../outside-x" traversal (status ${status}: ${text})`);
  assert.equal(readSentinel(outside), 'SENTINEL-DOTDOT-B-2f88c\n', 'the outside sentinel bytes must be byte-unchanged');
  assert.equal(status, 400, `expected today's resolved-path prefix check to already reject this plain (non-symlink) traversal — got ${status}: ${text}`);
});

test('non-regression (passes today; must keep passing after any fix): an absolute repoPath naming a directory entirely outside the forge root is ALREADY rejected — path.resolve() folds it verbatim, discarding forgeRoot, before the comparison runs', async () => {
  const outside = newOutsideDir('project-create-absolute-outside-');
  plantSentinel(outside, 'SENTINEL-ABSOLUTE-6d40f');

  const { status, text } = await postProject({
    name: 'absolute-repo-path-project',
    repoPath: outside, // absolute path, verbatim
    qualityGateCmd: 'echo ok',
  });

  assertNoArtifactsCreated(outside, `absolute repoPath (status ${status}: ${text})`);
  assert.equal(readSentinel(outside), 'SENTINEL-ABSOLUTE-6d40f\n', 'the outside sentinel bytes must be byte-unchanged');
  assert.equal(status, 400, `expected today's resolved-path prefix check to already reject an absolute repoPath naming a directory outside forgeRoot — got ${status}: ${text}`);
});

test('(RED) [Defect 1, shape: cross-object symlink under projects/] a symlink aliasing a DIFFERENT real project dir under the same root leaves that project untouched', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  mkdirSync(join(forgeRoot, 'projects', 'legit-victim', '.forge'), { recursive: true });
  const victimCfg = {
    name: 'Legit Victim',
    northStar: 'n',
    instructions: 'i',
    demoProcess: [],
    testProcess: { local: { cmd: ['echo', 'CROSS-OBJECT-VICTIM-MARKER-3a19d'] } },
    kb: null,
  };
  const victimProjectJsonPath = join(forgeRoot, 'projects', 'legit-victim', '.forge', 'project.json');
  writeFileSync(victimProjectJsonPath, JSON.stringify(victimCfg, null, 2), 'utf8');
  const victimBytesBefore = readFileSync(victimProjectJsonPath, 'utf8');

  symlinkSync(join(forgeRoot, 'projects', 'legit-victim'), join(forgeRoot, 'projects', 'evil-alias'), 'dir');

  const { status, text } = await postProject({
    name: 'cross-object-attacker-project',
    repoPath: 'projects/evil-alias',
    qualityGateCmd: 'echo pwned-cross-object',
  });

  const victimBytesAfter = readFileSync(victimProjectJsonPath, 'utf8');
  assert.equal(
    victimBytesAfter,
    victimBytesBefore,
    `"projects/evil-alias" -> "projects/legit-victim" is a DIFFERENT real object under the SAME projects/ root — "somewhere under root" is not the guarantee, "this path's own identity" is. legit-victim's .forge/project.json must be byte-unchanged — status ${status}: ${text}`,
  );
});

test('(RED) [Defect 1, shape: repoPath outside projects/ but inside forgeRoot — "skills/evil"] writes nothing under skills/', async () => {
  const target = join(forgeRoot, 'skills', 'evil');

  const { status, text } = await postProject({
    name: 'outside-projects-skills-attacker',
    repoPath: 'skills/evil',
    qualityGateCmd: 'echo ok',
  });

  assert.ok(
    !existsSync(join(target, '.forge', 'project.json')),
    `a repoPath that is inside forgeRoot but OUTSIDE projects/ must be rejected by the intended fix (isContainedProjectRepoPath scopes root to <forgeRoot>/projects) — today's lexical forgeRoot-prefix check wrongly accepts it. Found artifacts at "${target}" — status ${status}: ${text}`,
  );
});

test('(RED) [Defect 1, shape: repoPath outside projects/ but inside forgeRoot — "_queue/evil"] writes nothing under _queue/', async () => {
  const target = join(forgeRoot, '_queue', 'evil');

  const { status, text } = await postProject({
    name: 'outside-projects-queue-attacker',
    repoPath: '_queue/evil',
    qualityGateCmd: 'echo ok',
  });

  assert.ok(
    !existsSync(join(target, '.forge', 'project.json')),
    `a repoPath inside forgeRoot but outside projects/ (here: _queue/evil, a directory forge treats as operational state, not project code) must be rejected — found artifacts at "${target}" — status ${status}: ${text}`,
  );
});

// ---------------------------------------------------------------------------
// DEFECT 2 — sibling-project clobber (no existence check on the final write).
// ---------------------------------------------------------------------------

test('positive control (passes before AND after any fix): onboarding into an EMPTY, brand-new projects/<id> still succeeds', async () => {
  const { status, text, json } = await postProject({
    name: 'fresh-empty-onboard-project',
    qualityGateCmd: 'echo fresh-ok',
  });
  assert.equal(status, 200, `expected a genuinely fresh, non-colliding onboard to succeed — got ${status}: ${text}`);
  assert.equal(json?.ok, true, `expected ok:true — got ${text}`);
  const expectedPath = join(forgeRoot, 'projects', 'fresh-empty-onboard-project', '.forge', 'project.json');
  const cfg = JSON.parse(readFileSync(expectedPath, 'utf8')) as Record<string, unknown>;
  assert.deepEqual((cfg.testProcess as Record<string, unknown>)?.local, { cmd: ['echo', 'fresh-ok'] });
});

test('(RED) [Defect 2] a fresh non-colliding name with repoPath aimed at an already-onboarded project must NOT clobber that project\'s .forge/project.json', async () => {
  mkdirSync(join(forgeRoot, 'projects', 'onboarded-victim', '.forge'), { recursive: true });
  const victimCfg = {
    name: 'Onboarded Victim',
    northStar: 'n',
    instructions: 'i',
    demoProcess: [],
    testProcess: { local: { cmd: ['echo', 'SIBLING-CLOBBER-VICTIM-MARKER-8e02f'] } },
    kb: null,
  };
  const victimProjectJsonPath = join(forgeRoot, 'projects', 'onboarded-victim', '.forge', 'project.json');
  writeFileSync(victimProjectJsonPath, JSON.stringify(victimCfg, null, 2), 'utf8');
  const victimBytesBefore = readFileSync(victimProjectJsonPath, 'utf8');

  // Sanity: "attacker-clobber-victim" must NOT collide with the 409
  // duplicate-id scan (discoverProjects keys off the "onboarded-victim" DIRECTORY
  // name, deriving id "onboarded-victim" — a different id from our attacker name).
  const { status, text } = await postProject({
    name: 'attacker-clobber-victim',
    repoPath: 'projects/onboarded-victim',
    qualityGateCmd: 'echo pwned-sibling-clobber',
  });
  assert.notEqual(status, 409, `sanity: this must not collide with the duplicate-id 409 guard (that guard is not the defect under test) — got ${status}: ${text}`);

  const victimBytesAfter = readFileSync(victimProjectJsonPath, 'utf8');
  assert.equal(
    victimBytesAfter,
    victimBytesBefore,
    `POST /api/studio/projects' final writeFileSync has NO existence check — a fresh, non-colliding "name" whose repoPath names an already-onboarded project's real (non-symlinked, genuinely contained) directory overwrites that project's .forge/project.json wholesale, including testProcess.local.cmd (the quality-gate command forge later EXECUTES). A path-containment guard alone cannot close this — "projects/onboarded-victim" is genuinely contained. victim bytes must be unchanged — status ${status}: ${text}`,
  );
});
