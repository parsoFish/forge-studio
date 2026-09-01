/**
 * Tests for the greenfield project creation agent (R4-03) — the manifest
 * validation and starter scaffolding concern.
 *
 * F2 AC: each curated template's scaffold passes the preflight HARD clauses
 * unmodified. F3 AC: create → contract-green, ready for the first architect run,
 * with no manual repo surgery. Fully isolated: a temp forge root with the real
 * templates copied in, so the brain seed + preflight don't touch the live repo.
 *
 * The "create is atomic and refuses cleanly" concern (SEC-05 RCE-inertness,
 * the AT-4on-* orphan/retry family, and the folded AT-B6-2/AT-B6-4 cases) was
 * split out into the sibling project-create-atomicity.test.ts when this file
 * grew past the 800-line baseline cap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  scaffoldGreenfieldProject,
  validateCreationManifest,
  listProjectStarters,
  projectStartersDir,
  type CreationManifest,
} from './project-create.ts';
import { discoverProjects } from '../../orchestrator/studio/registry.ts';

const REAL_ROOT = process.cwd();

/** A temp forge root with the real project starters copied in + a brain/projects dir. */
function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pcreate-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(REAL_ROOT), startersDest, { recursive: true });
  mkdirSync(join(root, 'brain', 'projects'), { recursive: true });
  mkdirSync(join(root, 'projects'), { recursive: true });
  return root;
}

function manifest(over: Partial<CreationManifest> = {}): CreationManifest {
  return { name: 'My Tool', appType: 'typescript-cli', language: 'typescript', northStar: 'ship the thing', ...over };
}

/** Moved from project-create.ts (dead export, zero production callers — cull
 *  ledger H) — now a local assertion helper.
 *  True iff the given text still carries an unsubstituted template token.
 *  A fresh non-global regex — never the module-level `/g` ones, whose stateful
 *  `.test()` lastIndex would make repeated calls flap. */
function hasUnsubstitutedTokens(text: string): boolean {
  return /\{\{(NAME|TITLE|NORTH_STAR)\}\}/.test(text);
}

test('F1 validateCreationManifest: missing/invalid fields throw; valid → typed', () => {
  assert.throws(() => validateCreationManifest({ name: 'x' }), /appType.*required/);
  assert.throws(() => validateCreationManifest({ name: 'x', appType: 'a', language: 'ts', northStar: 'y'.repeat(141) }), /≤140/);
  const m = validateCreationManifest({ name: ' My Tool ', appType: 'typescript-cli', language: 'typescript', northStar: 'go' });
  assert.equal(m.name, 'My Tool');
  assert.equal(m.appType, 'typescript-cli');
});

test('F2: the curated starter library lists ≥2 app types', () => {
  const types = listProjectStarters(REAL_ROOT);
  assert.ok(types.includes('typescript-cli') && types.includes('typescript-api'), `got ${types.join(', ')}`);
  assert.ok(types.length >= 2);
});

for (const appType of ['typescript-cli', 'typescript-api']) {
  test(`F2/F3: scaffolding "${appType}" reaches preflight HARD-green with no manual surgery`, () => {
    const forgeRoot = isolatedForgeRoot();
    try {
      const out = scaffoldGreenfieldProject({ manifest: manifest({ appType }), forgeRoot });
      assert.equal(
        out.hardGreen,
        true,
        `expected hard-green; failing: ${out.failingClauses.map((c) => `${c.clause}:${c.detail}`).join(' | ')}`,
      );
      assert.equal(out.id, 'my-tool');
      // Tokens fully substituted across every scaffolded file.
      for (const rel of out.filesWritten) {
        assert.equal(hasUnsubstitutedTokens(readFileSync(join(out.projectDir, rel), 'utf8')), false, `${rel} has unsubstituted tokens`);
      }
      // The name/northStar landed in the real files.
      assert.match(readFileSync(join(out.projectDir, 'package.json'), 'utf8'), /"name": "my-tool"/);
      assert.match(readFileSync(join(out.projectDir, 'AGENTS.md'), 'utf8'), /ship the thing/);
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });
}

test('F2/F3: a north star with a quote/backslash produces VALID JSON + stays hard-green', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const out = scaffoldGreenfieldProject({
      manifest: manifest({ name: 'TOC Tool', northStar: 'A "smart" TOC \\ injector' }),
      forgeRoot,
    });
    assert.equal(out.hardGreen, true, `quotes must not break the scaffold; failing: ${out.failingClauses.map((c) => c.clause).join(',')}`);
    // The scaffolded JSON files parse (would throw here otherwise).
    for (const rel of ['package.json', '.forge/project.json']) {
      const parsed = JSON.parse(readFileSync(join(out.projectDir, rel), 'utf8'));
      assert.ok(parsed, `${rel} is valid JSON`);
    }
    const cfg = JSON.parse(readFileSync(join(out.projectDir, '.forge', 'project.json'), 'utf8')) as { northStar: string };
    assert.equal(cfg.northStar, 'A "smart" TOC \\ injector', 'the value round-trips exactly through JSON');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('F2: a value containing a $-replacement pattern is inserted literally (no leftover token)', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const out = scaffoldGreenfieldProject({ manifest: manifest({ northStar: 'before $& and $$ after' }), forgeRoot });
    for (const rel of out.filesWritten) {
      assert.equal(hasUnsubstitutedTokens(readFileSync(join(out.projectDir, rel), 'utf8')), false, `${rel} fully substituted`);
    }
    assert.match(readFileSync(join(out.projectDir, 'README.md'), 'utf8'), /before \$& and \$\$ after/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('F1: a manifest field with a newline/control char is rejected', () => {
  assert.throws(() => validateCreationManifest({ name: 'x\ny', appType: 'typescript-cli', language: 'ts', northStar: 'z' }), /single line/);
});

test('F3: an unknown appType throws with the available list', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    assert.throws(() => scaffoldGreenfieldProject({ manifest: manifest({ appType: 'cobol-mainframe' }), forgeRoot }), /unknown appType/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('F3: a duplicate project id is refused', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot });
    assert.throws(() => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }), /already exists/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('the shipped templates carry no stray files that would break substitution', () => {
  // Each app-type dir has the load-bearing files.
  for (const appType of ['typescript-cli', 'typescript-api']) {
    const entries = readdirSync(join(projectStartersDir(REAL_ROOT), appType));
    assert.ok(entries.includes('package.json') && entries.includes('AGENTS.md') && entries.includes('roadmap.md'));
  }
});

// ---------------------------------------------------------------------------
// R3-06-F3 — a third scaffold, typescript-web, joins the curated library.
// RED until the F3 WI adds studio/starters/projects/typescript-web/ — the
// starter doesn't exist yet, so listProjectStarters won't include it and
// scaffoldGreenfieldProject will throw "unknown appType" in the meantime.
// ---------------------------------------------------------------------------

test('AT-46: F3 — listProjectStarters(FORGE_ROOT) includes "typescript-web" alongside "typescript-cli"/"typescript-api"', () => {
  const types = listProjectStarters(REAL_ROOT);
  assert.ok(
    types.includes('typescript-web') && types.includes('typescript-cli') && types.includes('typescript-api'),
    `expected typescript-web + typescript-cli + typescript-api, got: ${types.join(', ')}`,
  );
});

test('AT-47: F3 — scaffolding "typescript-web" reaches preflight HARD-green, with every template token substituted', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const out = scaffoldGreenfieldProject({ manifest: manifest({ appType: 'typescript-web' }), forgeRoot });
    assert.equal(
      out.hardGreen,
      true,
      `expected hard-green; failing: ${out.failingClauses.map((c) => `${c.clause}:${c.detail}`).join(' | ')}`,
    );
    assert.deepEqual(out.failingClauses, []);
    for (const rel of out.filesWritten) {
      assert.equal(hasUnsubstitutedTokens(readFileSync(join(out.projectDir, rel), 'utf8')), false, `${rel} has unsubstituted tokens`);
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SEC-03 round 3 (BLOCKER) — scaffoldGreenfieldProject leaves a HALF-CREATED
// project behind. `copyTemplate` writes the COMPLETE project directory
// (including `.forge/project.json`) and only THEN calls `seedProjectBrain`.
// `seedProjectBrain` now throws `PathGuardContainmentError` on a genuine
// containment rejection (SEC-03 Finding A's own fix) — but that throw
// propagates straight out of this function with NO cleanup: the caller
// (both `POST /api/studio/projects/create` and `forge create`) sees "not
// created", while `projects/<id>` sits on disk, complete, and
// `discoverProjects` adopts it on the very next list call. An operator told
// "not created" who then sees the project in their library is worse than
// the symlink escape this whole PR was closing.
//
// `forge create` (orchestrator/cli.ts's cmdCreate, ~line 518) is NOT
// separately driven here: it is a private, non-exported function that calls
// `process.exit()` directly, and `FORGE_ROOT` (cli.ts ~line 41) is a
// module-level constant computed from `import.meta.dirname` at import time —
// hardcoded to the REAL forge repo, with no env/flag override. There is
// therefore no way to drive it in-process against an isolated temp forgeRoot
// without either modifying production code (out of scope — tests only) or
// writing real fixtures into the live repo's own `projects/`/`brain/`
// directories (rejected: every other AT in this campaign is hermetic, and a
// crash mid-test would leave real artifacts behind). Reading cmdCreate's
// source confirms it adds NO logic of its own beyond this exact call — a
// `try { scaffoldGreenfieldProject(...) } catch { print + exit }` with no
// cleanup on either path — so the defect pinned below IS the defect `forge
// create` would exhibit; the CLI entry point is covered at the function
// level only, not via its own dispatch/exit-code layer.
// ---------------------------------------------------------------------------

test('(RED) [SEC-03 round 3] scaffoldGreenfieldProject leaves NO project directory behind when seedProjectBrain rejects a planted symlink', () => {
  const forgeRoot = isolatedForgeRoot();
  const outside = mkdtempSync(join(tmpdir(), 'pcreate-halfcreated-outside-'));
  try {
    const id = 'halfcreated-blocker';
    // Finding-A shape #1: brain/projects/<id> itself a symlinked directory —
    // seedProjectBrain's OWN containment guard (already fixed) correctly
    // rejects this and throws PathGuardContainmentError.
    symlinkSync(outside, join(forgeRoot, 'brain', 'projects', id), 'dir');

    assert.throws(
      () => scaffoldGreenfieldProject({ manifest: manifest({ name: 'Halfcreated Blocker' }), forgeRoot }),
      /containment/i,
      'expected scaffoldGreenfieldProject to throw on the containment rejection',
    );

    const projectDir = join(forgeRoot, 'projects', id);
    assert.ok(
      !existsSync(projectDir),
      `copyTemplate already wrote a COMPLETE project directory (including .forge/project.json) before seedProjectBrain ever ran — when seedProjectBrain then throws, nothing unwinds that write. Found a leftover half-created project at "${projectDir}".`,
    );

    // Property #3: the original containment property (nothing created at the
    // symlink's outside target) must not regress while fixing the ordering.
    assert.deepEqual(
      readdirSync(outside),
      [],
      'nothing may be created at the symlink target outside forgeRoot — the containment guard itself is not what is being tested here, only that it stays intact',
    );

    // Property #2 (function-level proxy for "appears in the operator's
    // library"): the half-created dir must not be adopted by discoverProjects
    // on the next scan either.
    const discovered = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
    assert.ok(
      !discovered.some((p) => p.id === id),
      `discoverProjects must not adopt the half-created directory — found: ${JSON.stringify(discovered.map((p) => p.id))}`,
    );

    // RETROFIT (SEC-03 round 4) — "sweep for other surfaces that OBSERVE the
    // state you claim to have cleaned up": this scenario is a symlinked
    // brain/projects/<id> ITSELF, so seedProjectBrain's very first plan()
    // call already fails containment before queuing ANY write — no
    // kb.yaml/profile.md/themes/README.md should ever land on disk here.
    // Asserted on disk only (function level — no HTTP listing route to
    // drive; see cli/bridge-studio-write.test.ts / cli/bridge-studio-
    // project-create-containment.test.ts for the GET /api/studio/kbs
    // assertion on the two HTTP routes).
    assert.ok(
      !existsSync(join(forgeRoot, 'brain', 'projects', id, 'kb.yaml')),
      `no phantom KB may be written under brain/projects/${id}/ either — a rejection this early in seedProjectBrain's plan-then-write pattern must leave zero files, not just zero project directory`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('positive control (passes before AND after the SEC-03 round-3 fix): a normal greenfield create still succeeds, is complete, and is discoverable', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const out = scaffoldGreenfieldProject({ manifest: manifest({ name: 'Normal Greenfield Create' }), forgeRoot });
    assert.equal(out.id, 'normal-greenfield-create');
    assert.ok(existsSync(join(out.projectDir, '.forge', 'project.json')), 'expected .forge/project.json from the template');
    assert.ok(existsSync(join(forgeRoot, 'brain', 'projects', out.id, 'kb.yaml')), 'expected the central brain to be seeded');
    const discovered = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
    assert.ok(discovered.some((p) => p.id === out.id), `expected the new project to be discoverable — got ${JSON.stringify(discovered.map((p) => p.id))}`);
    const cfg = JSON.parse(readFileSync(join(out.projectDir, '.forge', 'project.json'), 'utf8')) as { kb?: string };
    assert.equal(cfg.kb, out.id, 'expected project.json.kb bound to the seeded KB (R4-02-F3)');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SEC-03 round 4 (MAJOR) — the round-3 reordering fix moved the orphan, it
// did not remove it. seedProjectBrain now runs FIRST — a WRITING operation
// moved earlier, not fail-before-write. An UNRELATED failure AFTER it
// succeeds (e.g. EACCES on copyTemplate's mkdirSync) leaves a complete,
// valid brain/projects/<id>/kb.yaml behind: a PHANTOM KB, invisible to
// discoverProjects (it only scans projects/), but VISIBLE to
// loadKbDescriptors (cli/bridge-studio-kbs.ts), which walks brain/projects/
// as its OWN second containment root — see cli/bridge-studio-write.test.ts's
// EACCES test for the live GET /api/studio/kbs confirmation.
//
// Failure-injection mechanism: chmod 0o500 (r-x, no write) on the PARENT of
// the directory copyTemplate's first mkdirSync needs to create —
// `<forgeRoot>/projects` itself. Verified deterministic in this environment
// (uid 1000, non-root — root would bypass the permission check entirely):
// `mkdirSync(child, {recursive:true})` under a 0o500 parent throws EACCES
// reliably, confirmed via a standalone probe before writing this test.
// Permissions are restored in `finally`, before rmSync cleanup — rmSync's
// OWN recursive delete needs write on `projects/` to remove its children.
// ---------------------------------------------------------------------------

test('(RED) [SEC-03 round 4] an UNRELATED EACCES failure after seedProjectBrain succeeds must not leave a phantom brain/projects/<id>/kb.yaml behind', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectsDir = join(forgeRoot, 'projects');
  try {
    const id = 'eacces-phantom-blocker';
    chmodSync(projectsDir, 0o500);
    try {
      // expected scaffoldGreenfieldProject to throw on the injected EACCES
      assert.throws(() => scaffoldGreenfieldProject({ manifest: manifest({ name: 'Eacces Phantom Blocker' }), forgeRoot }));
    } finally {
      chmodSync(projectsDir, 0o755);
    }

    assert.ok(
      !existsSync(join(forgeRoot, 'brain', 'projects', id, 'kb.yaml')),
      `seedProjectBrain succeeded (it writes to brain/projects/${id}/, entirely independent of projects/'s permissions) and copyTemplate then failed with EACCES on mkdirSync(projects/${id}) — the earlier write was never unwound, leaving a phantom KB bound to a project that was never created`,
    );
    assert.ok(!existsSync(join(forgeRoot, 'projects', id)), `the project directory must not exist either — got existsSync=${existsSync(join(forgeRoot, 'projects', id))}`);
  } finally {
    chmodSync(projectsDir, 0o755);
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

