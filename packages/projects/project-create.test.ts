/**
 * Tests for the greenfield project creation agent (R4-03).
 *
 * F2 AC: each curated template's scaffold passes the preflight HARD clauses
 * unmodified. F3 AC: create → contract-green, ready for the first architect run,
 * with no manual repo surgery. Fully isolated: a temp forge root with the real
 * templates copied in, so the brain seed + preflight don't touch the live repo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  scaffoldGreenfieldProject,
  validateCreationManifest,
  listProjectStarters,
  projectStartersDir,
  hasUnsubstitutedTokens,
  type CreationManifest,
} from './project-create.ts';
import { discoverProjects } from './studio/registry.ts';
// SEC-05 / forge-4on additions (below) also need to write corrupt template
// fixtures — added as a second node:fs import so the existing import line (and
// every existing test) stays byte-for-byte untouched.
import { writeFileSync } from 'node:fs';

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

// ---------------------------------------------------------------------------
// SEC-05 (P1 forge-hwo) — RCE via raw north-star / title interpolation into a
// scaffolded CODE FILE's JSDoc header.
//
// copyTemplate (orchestrator/project-create.ts:126-127) interpolates the
// human-authored `title` (= manifest.name, line 126) and `northStar`
// (line 127) RAW into every code file on the NON-JSON branch. Each starter's
// entry module opens with:
//
//     /**
//      * {{TITLE}} — {{NORTH_STAR}}
//      *  ...
//      */
//
// A value carrying the comment-terminator `*/` closes that JSDoc block early;
// the text that follows becomes TOP-LEVEL module code (the starters are ESM —
// `"type":"module"` — so top-level `await` is legal); a trailing `/*` reopens
// a comment to swallow the rest of the original header. The injected statement
// then executes at MODULE LOAD — i.e. the moment the shipped gate
// (`node --experimental-strip-types --test`) loads the entry module via its
// test's `import` — and the scaffold's OWN gate stays GREEN (preflight does
// only static command-shape checks; it never runs the scaffolded suite, so the
// break-out is never compiled or executed at create time — it lands live in
// the operator's new repo). Sinks: src/server.ts (typescript-api / -web),
// src/index.ts (typescript-cli).
//
// The FIX these ATs pin (implemented in a later stage — RED now):
//   • commentSafe(s) = s.replace(/\*\//g,'* /').replace(/\/\*/g,'/ *'),
//     applied at :126-127 to BOTH title and northStar on the code-file branch,
//     so neither bigram can terminate/open a comment.
//   • validateCreationManifest ALSO rejects northStar/title carrying `*/`/`/*`
//     (defense-in-depth at the boundary).
//
// The payload string below is a TEST ASSET — an inertness assertion. It stays
// on this lane branch until the fix lands in the same PR. It is written only
// into throwaway /tmp scaffolds, never into any repo-tracked file.
// ---------------------------------------------------------------------------

/** Build the break-out payload targeting a unique /tmp marker. `*/` closes the
 *  JSDoc header, the middle runs at module load, `/*` reopens a comment. */
function hwoPayload(marker: string): string {
  return `*/;(await import("node:fs")).writeFileSync(${JSON.stringify(marker)},"[exec]");/*`;
}

/** (appType → its entry code file, the JSDoc-header sink). */
const HWO_STARTERS = [
  { appType: 'typescript-api', codeFile: 'src/server.ts' },
  { appType: 'typescript-web', codeFile: 'src/server.ts' },
  { appType: 'typescript-cli', codeFile: 'src/index.ts' },
];

/** Run the scaffolded project's REAL shipped gate, exactly as its package.json
 *  declares it (`node --experimental-strip-types --test`), from the project dir
 *  — NOT through a shell, so we read the child's numeric exit status directly.
 *
 *  `NODE_TEST_CONTEXT` is stripped from the child's env on purpose: THIS suite
 *  runs under `node --test`, which exports `NODE_TEST_CONTEXT=child-v8`; a
 *  nested `node --test` that inherits it detects a "recursive" run and SKIPS
 *  running any files (0 tests, entry module never loaded) — a false green that
 *  would hide the very RCE these ATs assert. An operator running the shipped
 *  `npm test` is never nested under a test runner, so the clean-env child is
 *  the faithful reproduction of what actually ships. `gateRanTests` below
 *  backstops this: it fails loudly if the gate ever runs zero tests again. */
function runScaffoldedGate(projectDir: string) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync('node', ['--experimental-strip-types', '--test'], { cwd: projectDir, encoding: 'utf8', env });
}

/** True iff the gate actually executed ≥1 test (entry module was loaded). A
 *  recursion-skipped run emits no `# tests N` summary — this guards against a
 *  gate that "passes" only because it ran nothing. */
function gateRanTests(stdout: string): boolean {
  const m = stdout.match(/^# tests (\d+)/m);
  return m !== null && Number(m[1]) >= 1;
}

// Defense-in-depth invariant. The intended fix has TWO layers that BOTH aim at
// the same break-out payload: the boundary validator (AT-hwo-3) refuses it, AND
// commentSafe neutralizes it at the code-file sink. So creating with a break-out
// value must land in exactly one of two inert outcomes — and NEVER execute:
//   • REFUSED — validateCreationManifest throws; no project, no gate; OR
//   • NEUTRALIZED — a scaffold IS produced, but the payload sits inert in the
//     entry module's JSDoc header, so the shipped gate loads it and stays green.
// The marker-absent assertion holds on BOTH paths and is the load-bearing one.
// It is RED at base (neither layer exists → the scaffold's gate loads the entry
// module and the break-out executes, writing the marker). Whenever a scaffold IS
// produced (base today, or a sink-only fix tomorrow), the gate branch runs and
// pins the sink directly; the moment the boundary is the last line of defense,
// the refusal branch covers it. Either way a regression that re-opens the RCE
// (raw interpolation reachable) trips the marker assertion.

test('AT-hwo-1: [SEC-05] a break-out northStar never executes — the create is either refused, or scaffolds inert with a green gate (all three starters)', () => {
  for (const { appType, codeFile } of HWO_STARTERS) {
    const forgeRoot = isolatedForgeRoot();
    const marker = `/tmp/HWO_MARK_ns_${appType.replace('typescript-', '')}`;
    rmSync(marker, { force: true });
    try {
      let out: ReturnType<typeof scaffoldGreenfieldProject> | undefined;
      try {
        out = scaffoldGreenfieldProject({
          manifest: manifest({ name: 'HWO NorthStar Probe', appType, northStar: hwoPayload(marker) }),
          forgeRoot,
        });
      } catch {
        // Layer 1 — the boundary validator refused the break-out payload
        // outright. A fully inert outcome: no project, no gate (marker-absent
        // asserted below).
        out = undefined;
      }

      if (out) {
        // A scaffold WAS produced → layer 2 (commentSafe) must have neutralized
        // the payload. Fixture precondition (before any verdict): the entry code
        // file exists and the payload's MARKER PATH reached its JSDoc header —
        // fix-agnostic, since commentSafe breaks only the `*/`/`/*` bigrams,
        // never the marker path text.
        const codePath = join(out.projectDir, codeFile);
        assert.ok(existsSync(codePath), `${appType}: expected the scaffold to produce ${codeFile}`);
        assert.ok(
          readFileSync(codePath, 'utf8').includes(marker),
          `${appType}: the northStar payload did not reach ${codeFile}'s header — the repro precondition is not met`,
        );

        const gate = runScaffoldedGate(out.projectDir);
        // The REAL shipped gate must PASS and must actually load the entry
        // module — a comment-safe fix keeps the scaffold green, it does not
        // fail-closed by breaking compilation.
        assert.equal(gate.error, undefined, `${appType}: could not launch the scaffolded gate — ${gate.error}`);
        assert.ok(
          gateRanTests(gate.stdout ?? ''),
          `${appType}: the gate ran ZERO tests (the entry module was never loaded) — the inertness check below would false-green. stdout:\n${gate.stdout}`,
        );
        assert.equal(
          gate.status,
          0,
          `${appType}: the scaffolded project's own gate must stay green. exit=${gate.status}\n${(gate.stdout ?? '') + (gate.stderr ?? '')}`,
        );
      }

      // The invariant on EVERY path: the injected statement NEVER executed.
      assert.ok(
        !existsSync(marker),
        `${appType}: RCE — a break-out northStar reached ${codeFile}'s JSDoc header and executed at module load, writing ${marker} (the create was neither refused at the boundary nor neutralized at the sink)`,
      );
    } finally {
      rmSync(marker, { force: true });
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  }
});

test('AT-hwo-2: [SEC-05] the TITLE twin — a break-out in the title field (manifest.name → copyTemplate subs.title, line 126) never executes either', () => {
  for (const { appType, codeFile } of HWO_STARTERS) {
    const forgeRoot = isolatedForgeRoot();
    const marker = `/tmp/HWO_MARK_tt_${appType.replace('typescript-', '')}`;
    rmSync(marker, { force: true });
    try {
      // Payload in the TITLE field (manifest.name → copyTemplate's subs.title,
      // line 126). The slug id still derives to a valid slug (the leading
      // punctuation is stripped); the human title lands in {{TITLE}} in the
      // code-file header — the injection point a northStar-only sink fix would
      // miss. Same defense-in-depth disjunction as AT-hwo-1.
      let out: ReturnType<typeof scaffoldGreenfieldProject> | undefined;
      try {
        out = scaffoldGreenfieldProject({
          manifest: manifest({ name: hwoPayload(marker), appType, northStar: 'ship the thing' }),
          forgeRoot,
        });
      } catch {
        out = undefined; // Layer 1: boundary refused the break-out title.
      }

      if (out) {
        const codePath = join(out.projectDir, codeFile);
        assert.ok(existsSync(codePath), `${appType}: expected the scaffold to produce ${codeFile}`);
        assert.ok(
          readFileSync(codePath, 'utf8').includes(marker),
          `${appType}: the title(name) payload did not reach ${codeFile}'s header — the repro precondition is not met`,
        );

        const gate = runScaffoldedGate(out.projectDir);
        assert.equal(gate.error, undefined, `${appType}: could not launch the scaffolded gate — ${gate.error}`);
        assert.ok(
          gateRanTests(gate.stdout ?? ''),
          `${appType}: the gate ran ZERO tests (the entry module was never loaded) — the inertness check below would false-green. stdout:\n${gate.stdout}`,
        );
        assert.equal(
          gate.status,
          0,
          `${appType}: the scaffolded project's own gate must stay green. exit=${gate.status}\n${(gate.stdout ?? '') + (gate.stderr ?? '')}`,
        );
      }

      assert.ok(
        !existsSync(marker),
        `${appType}: RCE via the TITLE injection point — a break-out {{TITLE}} reached ${codeFile}'s JSDoc header and executed at module load, writing ${marker} (neither refused at the boundary nor neutralized at the sink)`,
      );
    } finally {
      rmSync(marker, { force: true });
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  }
});

test('AT-hwo-3: [SEC-05] boundary — validateCreationManifest rejects a comment terminator in northStar (`*/`) and in title (`/*`)', () => {
  // RED at base: validateCreationManifest screens only control chars + the
  // ≤140 length; neither bigram is caught, so both manifests validate today.
  // A sink-only commentSafe fix that leaves the boundary permissive is caught
  // here — the defense-in-depth clause is what these two throws pin.
  assert.throws(
    () => validateCreationManifest({ name: 'Ok Name', appType: 'typescript-cli', language: 'typescript', northStar: 'break out */ of the header' }),
    'northStar containing the comment terminator "*/" must be rejected at the boundary',
  );
  assert.throws(
    () => validateCreationManifest({ name: 'bad /* title', appType: 'typescript-cli', language: 'typescript', northStar: 'ship the thing' }),
    'title (manifest.name) containing the comment opener "/*" must be rejected at the boundary',
  );
});

// ===========================================================================
// SEC-05 / forge-4on (P1) — scaffoldGreenfieldProject is NON-TRANSACTIONAL.
//
// Phase 1 validates (manifest, slug, appType whitelist, existsSync(projectDir)
// duplicate refusal, checkProjectBrainSeedContainment — a read-only lstat walk
// that never writes a request-derived path). Phase 2 WRITES, with NO unwind on
// a throw between the first write and the last:
//   copyTemplate   (project-create.ts:227) — mkdirSync(projectDir) then per-file
//                    writes; throws on invalid scaffolded JSON (:157-158) or any
//                    OS read/write error (:152/:160).
//   seedProjectBrain (:233) — writes brain/projects/<id>/{kb.yaml,profile.md,
//                    themes/README.md}; can throw EACCES on a brain write.
//   runPreflight   (:235) — a PURE, non-throwing reporter (every readFileSync in
//                    cli/preflight.ts is existsSync-guarded or try/caught, and
//                    loadProjectConfig is wrapped), so it can NEVER itself orphan;
//                    the tail-most REPRODUCIBLE Phase-2 throw is seedProjectBrain's
//                    final write, which AT-4on-5 pins.
// A throw in that band leaves an ORPHAN — a half-created <projectsRoot>/<id>
// and/or a phantom <forgeRoot>/brain/projects/<id> — and a RETRY then trips
// existsSync(projectDir) → "project already exists". Neither caller (the
// bridge greenfield route, cli.ts:538 cmdCreate) does any rmSync cleanup.
//
// THE RULED FIX these RED tests pin: stage-then-atomic-move — build the whole
// project into projectsRoot/.staging-<rand>/ (same fs, NOT os.tmpdir → EXDEV) +
// brain into brain/projects/.staging-<rand>/, run copyTemplate + seedProjectBrain
// + runPreflight entirely in staging, then renameSync each staged tree into
// place on FULL success, writing .forge/.create-complete LAST; a pre-create/boot
// reconcile sweeps any projects/<id> lacking that marker (and any brain/projects/
// <id> with no matching project). On any staged failure: rmSync the staging dirs
// and rethrow → no orphan, retry succeeds. NOT a reordering (three SEC-03
// reorders already failed — see the SEC-03 round 3/4 tests above).
//
// cmdCreate (cli.ts) is NOT driven here — same reason the SEC-03 round-3 block
// above states: it is a private, process.exit()-calling function keyed off a
// module-level FORGE_ROOT constant with no override, so it can only be covered
// at the function level; reading its source confirms it adds no cleanup of its
// own beyond the bare `try { scaffoldGreenfieldProject } catch { print+exit }`.
// The bridge greenfield route IS driven end-to-end in
// cli/bridge-studio-writes.test.ts (AT-4on-4 + AT-4on-6).
// ===========================================================================

/** True iff creating a child under `dir` is ACTUALLY blocked by permissions in
 *  this process's uid (a 0o500 chmod bites). Returns false when the probe write
 *  SUCCEEDS — i.e. we are root and the mode bit is bypassed — so a caller skips
 *  rather than false-fail. Cleans up its own probe. */
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

/** True iff reading `file` is actually blocked in this process's uid (a 0o000
 *  chmod bites). False when the read SUCCEEDS (root bypass) → caller skips. */
function readIsBlocked(file: string): boolean {
  try {
    readFileSync(file, 'utf8');
    return false;
  } catch {
    return true;
  }
}

test('AT-4on-1 (RED) [SEC-05 4on] a copyTemplate invalid-JSON throw mid-Phase-2 leaves NEITHER projects/<id> NOR brain/projects/<id>, and an identical retry succeeds', () => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const pkgPath = join(forgeRoot, 'studio', 'starters', 'projects', 'typescript-cli', 'package.json');
  try {
    // Corrupt the SHARED template input so copyTemplate's JSON.parse
    // (project-create.ts:157-158) throws AFTER mkdirSync(projectDir) already ran
    // — still invalid JSON after token substitution. Both today's code and the
    // staged fix read this same template, so both fail Phase 2 here.
    writeFileSync(pkgPath, '{ "name": "{{NAME}}", NOT_VALID_JSON }', 'utf8');

    assert.throws(
      () => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }),
      /invalid JSON/i,
      'injection precondition: copyTemplate must throw on the corrupt scaffolded JSON',
    );

    // No-orphan invariant — RED at base: mkdirSync(projects/<id>) ran before the
    // throw and nothing unwinds it.
    assert.ok(!existsSync(join(forgeRoot, 'projects', id)), `mid-copyTemplate failure left an orphan project dir at projects/${id}`);
    assert.ok(!existsSync(join(forgeRoot, 'brain', 'projects', id)), `no brain orphan may be left at brain/projects/${id}`);

    // Clear the transient (restore the good template) and retry — RED at base:
    // the orphan trips existsSync(projectDir) → "already exists".
    cpSync(join(projectStartersDir(REAL_ROOT), 'typescript-cli', 'package.json'), pkgPath);
    let ok = false;
    let err = '';
    try { ok = scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }).id === id; }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    assert.ok(ok, `the identical retry after a mid-Phase-2 failure must succeed with no "already exists" — got: ${err}`);
    assert.ok(existsSync(join(forgeRoot, 'projects', id, '.forge', 'project.json')), 'the retry must produce a complete scaffold');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-4on-2 (RED) [SEC-05 4on] an OS filesystem error mid-copyTemplate leaves no orphan; retry succeeds', (t) => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const srcFile = join(forgeRoot, 'studio', 'starters', 'projects', 'typescript-cli', 'AGENTS.md');
  try {
    // Unreadable template source → readFileSync (project-create.ts:152) throws
    // EACCES mid-copy, AFTER mkdirSync(projectDir). A genuine OS filesystem
    // error in the copy step (the "OS write fail" class), reproducible + shared
    // by the staged fix (it reads the same source).
    chmodSync(srcFile, 0o000);
    if (!readIsBlocked(srcFile)) { chmodSync(srcFile, 0o644); t.skip('chmod 0o000 does not block reads in this environment (running as root?)'); return; }

    assert.throws(
      () => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }),
      /EACCES|permission denied/i,
      'injection precondition: copyTemplate must throw an OS read error mid-copy',
    );
    assert.ok(!existsSync(join(forgeRoot, 'projects', id)), `mid-copyTemplate OS failure left an orphan at projects/${id}`);
    assert.ok(!existsSync(join(forgeRoot, 'brain', 'projects', id)), `no brain orphan at brain/projects/${id}`);

    chmodSync(srcFile, 0o644);
    let ok = false;
    let err = '';
    try { ok = scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }).id === id; }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    assert.ok(ok, `the retry after the OS-error failure must succeed — got: ${err}`);
    assert.ok(existsSync(join(forgeRoot, 'projects', id, 'AGENTS.md')), 'the retry must produce a complete scaffold (AGENTS.md restored)');
  } finally {
    try { chmodSync(srcFile, 0o644); } catch { /* best effort */ }
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-4on-3 (RED, headline) [SEC-05 4on] a seedProjectBrain EACCES AFTER a full copyTemplate — the fully-scaffolded project dir must NOT survive; retry succeeds', (t) => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const brainProjects = join(forgeRoot, 'brain', 'projects');
  try {
    // Injection: brain/projects read-only. Phase 1's checkProjectBrainSeedContainment
    // only lstat-walks (r-x is enough) and mkdirs an ALREADY-existing brain/projects
    // (a no-op that does not need write) → it PASSES. copyTemplate then writes the
    // WHOLE projects/<id> tree. Only seedProjectBrain's mkdirSync(brain/projects/<id>)
    // then hits EACCES — Leg B, the headline: the failure lands AFTER the project
    // directory is fully, validly scaffolded.
    chmodSync(brainProjects, 0o500);
    if (!writeIsBlocked(brainProjects)) { chmodSync(brainProjects, 0o755); t.skip('chmod 0o500 does not block writes (running as root?)'); return; }

    assert.throws(
      () => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }),
      /EACCES|permission denied/i,
      'injection precondition: seedProjectBrain must throw EACCES after copyTemplate completed',
    );

    // HEADLINE — RED at base: copyTemplate wrote the whole project dir
    // (.forge/project.json included) before seedProjectBrain threw; today nothing
    // unwinds it, so a FULLY-scaffolded orphan survives.
    assert.ok(!existsSync(join(forgeRoot, 'projects', id)), `a FULLY-scaffolded orphan project survived at projects/${id} after seedProjectBrain threw`);
    assert.ok(!existsSync(join(brainProjects, id)), `no brain orphan at brain/projects/${id}`);

    // Retry once the transient clears — RED at base ("already exists").
    chmodSync(brainProjects, 0o755);
    let ok = false;
    let err = '';
    try { ok = scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }).id === id; }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    assert.ok(ok, `the retry after the seedProjectBrain failure must succeed, never "already exists" — got: ${err}`);
    assert.ok(existsSync(join(brainProjects, id, 'kb.yaml')), 'the retry must seed the central brain');
  } finally {
    try { chmodSync(brainProjects, 0o755); } catch { /* best effort */ }
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-4on-5 (RED) [SEC-05 4on] a tail failure AFTER kb.yaml was written is atomic — no half-created project, no phantom brain, always retryable', (t) => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const brainDir = join(forgeRoot, 'brain', 'projects', id);
  const themesDir = join(brainDir, 'themes');
  try {
    // Injection: a read-only themes/ dir under a WRITABLE brain/projects/<id>.
    // seedProjectBrain writes kb.yaml then profile.md into <id> (writable), then
    // throws writing themes/README.md into the 0o500 themes dir — the tail-most
    // reproducible Phase-2 throw (runPreflight, the nominal tail, cannot throw —
    // see the header). So today the failed create leaves BOTH a copyTemplate
    // orphan AND a phantom kb.yaml+profile.md.
    mkdirSync(themesDir, { recursive: true });
    chmodSync(themesDir, 0o500);
    if (!writeIsBlocked(themesDir)) { chmodSync(themesDir, 0o755); t.skip('chmod 0o500 does not block writes (running as root?)'); return; }
    assert.ok(!existsSync(join(brainDir, 'kb.yaml')), 'precondition: no kb.yaml before the create');

    let firstThrew = false;
    try { scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }); }
    catch { firstThrew = true; }

    if (firstThrew) {
      // A FAILED create must be atomic — RED at base (both orphans present).
      assert.ok(!existsSync(join(forgeRoot, 'projects', id)), `orphan project dir survived at projects/${id}`);
      assert.ok(!existsSync(join(brainDir, 'kb.yaml')), `phantom kb.yaml survived at brain/projects/${id}/kb.yaml`);

      // ...and retryable. Clear the transient + the injection scaffold, then
      // retry — RED at base (the projects/<id> orphan → "already exists").
      chmodSync(themesDir, 0o755);
      rmSync(brainDir, { recursive: true, force: true });
      let ok = false;
      let err = '';
      try { ok = scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }).id === id; }
      catch (e) { err = e instanceof Error ? e.message : String(e); }
      assert.ok(ok, `retry after a tail failure must succeed — got: ${err}`);
    } else {
      // The transactional fix stages everything and sidesteps the partial-write
      // window (its pre-create reconcile sweeps the pre-planted marker-less
      // brain/projects/<id>), so the create SUCCEEDS on the first attempt and
      // the project is real + complete.
      assert.ok(existsSync(join(forgeRoot, 'projects', id, '.forge', 'project.json')), 'a first-attempt success must be a complete scaffold');
      assert.ok(existsSync(join(brainDir, 'kb.yaml')), 'a first-attempt success must seed the brain');
    }
  } finally {
    try { chmodSync(themesDir, 0o755); } catch { /* best effort */ }
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-4on-7 (RED) [SEC-05 4on] retryability regression lock — a mid-Phase-2 failure then an IDENTICAL create must succeed, never "already exists"', () => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const pkgPath = join(forgeRoot, 'studio', 'starters', 'projects', 'typescript-cli', 'package.json');
  try {
    writeFileSync(pkgPath, '{ "name": "{{NAME}}", NOPE }', 'utf8');
    assert.throws(
      () => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }),
      /invalid JSON/i,
      'injection precondition: copyTemplate throws mid-Phase-2',
    );
    // Restore the shared template input; the identical create must now succeed.
    cpSync(join(projectStartersDir(REAL_ROOT), 'typescript-cli', 'package.json'), pkgPath);
    let ok = false;
    let err = '';
    try { ok = scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }).id === id; }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    assert.ok(ok, `the identical retry must succeed with no "already exists" — got: ${err}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-4on-8 (AMENDED W7-B6, projects-35) a marker-less projects/<id> is REFUSED byte-untouched — the old sweep-and-rescaffold contract WAS the data-loss defect', () => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const projectDir = join(forgeRoot, 'projects', id);
  try {
    // HISTORY: this test used to pin the OPPOSITE contract — "a marker-less
    // projects/<id> is a crashed-create orphan; sweep it and rescaffold". That
    // inference is exactly projects-35's DATA LOSS: every onboarded /
    // hand-added project is marker-less, so a name collision deleted a real
    // project (live-reproduced against projects/mdtoc). The immutable-gates
    // "tests pin the defect" shape — amended, not deleted, so the history is
    // auditable. The transactional staging design means a genuine crashed
    // create leaves only `.staging-<id>-*` dirs (swept by name marker,
    // AT-4on-10) and NEVER a marker-less final-path dir, so ANY existing
    // `projects/<id>` must be refused.
    mkdirSync(join(projectDir, '.forge'), { recursive: true });
    writeFileSync(join(projectDir, '.forge', 'project.json'), '{"partial":true}', 'utf8');
    writeFileSync(join(projectDir, 'ORPHAN_SENTINEL.txt'), 'indistinguishable from operator data\n', 'utf8');
    assert.ok(!existsSync(join(projectDir, '.forge', '.create-complete')), 'precondition: no completion marker (the onboarded-project shape)');

    assert.throws(
      () => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }),
      /already exists/i,
      'a marker-less projects/<id> must be REFUSED — marker absence is not proof of orphanhood',
    );
    // Assert the ARTIFACT: nothing was swept, nothing rescaffolded.
    assert.ok(existsSync(join(projectDir, 'ORPHAN_SENTINEL.txt')), 'the existing directory must survive byte-untouched');
    assert.equal(readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8'), '{"partial":true}', 'project.json must be byte-unchanged');
    assert.ok(!existsSync(join(projectDir, 'package.json')), 'no fresh scaffold may land over the refused slot');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ===========================================================================
// SEC-05 / forge-4on REOPEN #1 — the transactional create fix LEAKS
// `.staging-<id>-<rand>` orphans. Two ways they arise: a rename-loser under
// concurrency (two creates for the same id both stage, one wins the rename and
// the other's staged tree is stranded) and a hard-kill DURING staging (the
// process dies after `copyTemplate`/`seedProjectBrain` wrote into
// `.staging-*` but before the rename). Both leave a real, fully-formed staging
// tree in `projectsRoot`/`brain/projects/` — which then SURFACES as a
// phantom project (AT-4on-9, discoverProjects — a sibling test file) or a
// phantom KB (AT-4on-9, loadKbDescriptors — a sibling test file), because
// neither listing filters dot-prefixed dirs, and the pre-create reconcile
// (project-create.ts:240-251) never sweeps `.staging-*` at all.
//
// AT-4on-10 pins the SWEEP (RED today: the reconcile ignores `.staging-*`).
// AT-4on-11a/-11b pin the completion-marker SEMANTICS the sweep hinges on
// (green-lock today; named killed impls so the widened reconcile can't regress
// them into deleting a genuinely-complete project or dropping the marker).
// ===========================================================================

test('AT-4on-10 (RED) [SEC-05 4on] a stale `.staging-<id>-<rand>` orphan is swept (not adopted) and the fresh create succeeds clean', () => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const stagingProj = join(forgeRoot, 'projects', `.staging-${id}-deadbeef`);
  const stagingBrain = join(forgeRoot, 'brain', 'projects', `.staging-${id}-deadbeef`);
  try {
    // Plant BOTH halves of a crashed-during-staging leftover, each carrying a
    // SENTINEL that a real fresh scaffold (its staging name is a fresh random
    // hex, never "deadbeef") would never itself write.
    mkdirSync(stagingProj, { recursive: true });
    writeFileSync(join(stagingProj, 'STAGING_SENTINEL.txt'), 'rename-loser / hard-kill leftover\n', 'utf8');
    mkdirSync(stagingBrain, { recursive: true });
    writeFileSync(join(stagingBrain, 'STAGING_SENTINEL.txt'), 'rename-loser / hard-kill leftover\n', 'utf8');
    // Fixture precondition (before any verdict): both leftovers really exist.
    assert.ok(existsSync(join(stagingProj, 'STAGING_SENTINEL.txt')), 'precondition: projects/.staging-* leftover planted');
    assert.ok(existsSync(join(stagingBrain, 'STAGING_SENTINEL.txt')), 'precondition: brain/projects/.staging-* leftover planted');

    const out = scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot });

    // The create must SUCCEED with a clean, complete project (+ completion marker).
    // (These PASS at base too — the RED here is the SWEEP assertions below, so the
    // test fails for the right reason: `.staging-*` was never reconciled away.)
    assert.equal(out.id, id, 'the fresh create must succeed over a `.staging-*`-littered root');
    assert.ok(existsSync(join(forgeRoot, 'projects', id, '.forge', 'project.json')), 'the create must produce a complete scaffold');
    assert.ok(existsSync(join(forgeRoot, 'projects', id, '.forge', '.create-complete')), 'the completed project must carry the completion marker');

    // The verdict — RED at base: the leftover `.staging-*` trees must be GONE
    // (swept), with their SENTINELs absent — proving a SWEEP, not adoption.
    // Kills: a reconcile that GCs only projects/<id> + brain/projects/<id> and
    // ignores the sibling `.staging-*` orphans it must also sweep.
    assert.ok(!existsSync(stagingProj), `a stale projects/.staging-${id}-deadbeef orphan survived the create — the reconcile must sweep it`);
    assert.ok(!existsSync(stagingBrain), `a stale brain/projects/.staging-${id}-deadbeef orphan survived the create — the reconcile must sweep it`);
    assert.ok(!existsSync(join(stagingProj, 'STAGING_SENTINEL.txt')), 'the projects staging SENTINEL must be gone (swept, not adopted)');
    assert.ok(!existsSync(join(stagingBrain, 'STAGING_SENTINEL.txt')), 'the brain staging SENTINEL must be gone (swept, not adopted)');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// AT-4on-11 (green-lock) — the completion-marker semantics the reconcile (and
// AT-4on-8/-10's sweep) hinge on. TWO invariants, BOTH green at base today;
// pinned so the transactional-reconcile fix cannot regress them.
//   (a) marker-exists-after-success — a SUCCESSFUL create writes
//       <projectsRoot>/<id>/.forge/.create-complete (project-create.ts:311-312,
//       LAST, after both renames). Kills: a fix that drops the marker write, or
//       writes it at the wrong path — without it the reconcile cannot tell a
//       COMPLETE project from a crash orphan and would sweep real projects.
//   (b) marker-present-refused-and-untouched — a projects/<id> that DOES carry
//       the marker is the genuinely-complete case: it must be REFUSED
//       ("already exists", project-create.ts:240-243) and NEVER swept. Kills: a
//       reconcile widened to rmSync projects/<id> unconditionally (marker-blind)
//       — the over-reach twin of the AT-4on-10 sweep; the untouched SENTINEL is
//       the tell.
// EXPIRY: both stay green after the fix. If a future change makes a
// marker-present collision non-fatal (ADOPTING or SWEEPING a complete project),
// (b)'s throw + SENTINEL assertions catch it — re-audit rather than relax.
test('AT-4on-11a (green-lock) [SEC-05 4on] a successful create writes the .forge/.create-complete marker LAST', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const out = scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot });
    // Fixture precondition: the create really produced a project.
    assert.ok(existsSync(join(out.projectDir, '.forge', 'project.json')), 'precondition: the create produced a scaffold');
    // Verdict: the completion marker is present at the contracted path.
    assert.ok(
      existsSync(join(out.projectDir, '.forge', '.create-complete')),
      'a completed create must write .forge/.create-complete — the reconcile relies on it to tell a complete project from a crash orphan',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-4on-11b (green-lock) [SEC-05 4on] a marker-PRESENT projects/<id> is refused ("already exists"), never swept', () => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const projectDir = join(forgeRoot, 'projects', id);
  try {
    // Plant a genuinely-COMPLETE project: a valid .forge/project.json + the
    // completion marker + a SENTINEL a sweep-then-rescaffold would destroy.
    mkdirSync(join(projectDir, '.forge'), { recursive: true });
    writeFileSync(join(projectDir, '.forge', 'project.json'), '{"name":"my-tool"}', 'utf8');
    writeFileSync(join(projectDir, '.forge', '.create-complete'), `${new Date().toISOString()}\n`, 'utf8');
    writeFileSync(join(projectDir, 'COMPLETE_SENTINEL.txt'), 'a real, complete project — must not be swept\n', 'utf8');
    // Fixture precondition (before any verdict): the marker + sentinel are on disk.
    assert.ok(existsSync(join(projectDir, '.forge', '.create-complete')), 'precondition: the marker is planted');
    assert.ok(existsSync(join(projectDir, 'COMPLETE_SENTINEL.txt')), 'precondition: the sentinel is planted');

    // Verdict 1: a marker-present slot is REFUSED, not reconciled away.
    assert.throws(
      () => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }),
      /already exists/,
      'a marker-present (genuinely complete) projects/<id> must be refused, never swept',
    );
    // Verdict 2 (assert the ARTIFACT, not just the throw): the pre-existing
    // complete project is byte-untouched — a marker-blind sweep would have
    // rmSync'd the SENTINEL before throwing/rescaffolding.
    assert.ok(existsSync(join(projectDir, 'COMPLETE_SENTINEL.txt')), 'the complete project must be left UNTOUCHED — a marker-blind sweep would have deleted the SENTINEL');
    assert.equal(readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8'), '{"name":"my-tool"}', 'the pre-existing project.json must be byte-untouched');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
