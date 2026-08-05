/**
 * Acceptance tests for orchestrator/studio/session-kinds.ts (R2-10, PR1: the
 * session-shell backend contract).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./session-kinds.ts` import is the expected
 * red). Mirrors orchestrator/studio/template-library.ts / .test.ts's idiom:
 * real fs fixtures under mkdtempSync, plus the REAL repo (REPO_ROOT) for facts
 * that must stay true (the 3 shipped session kinds, their real agent ids).
 *
 * AT numbers below are a flat sequence AT-1..AT-48 spanning THREE files:
 *   AT-1  .. AT-18 — this file (session-kinds.ts)
 *   AT-19 .. AT-37 — orchestrator/studio/session-transcript.test.ts
 *   AT-38 .. AT-48 — cli/bridge-studio-sessions.test.ts
 * AT-amendment-2 round (T2-ratified, adversarial-review findings) adds:
 *   AT-49 .. AT-56 — this file (A3: legacyRoutes declared-data-fails-open;
 *                    A4: YAML structural coverage gap)
 *   AT-57 .. AT-58 — session-transcript.test.ts (A2: phase-driven pending)
 *   AT-59 .. AT-60 — bridge-studio-sessions.test.ts (A1: status.json symlink
 *                    escape blocker; A2 route-level re-ask case)
 * AT-amendment-3 round (fresh re-review of the amendment-2 fix, `8893ffcd`)
 * adds:
 *   AT-61 .. AT-67 — this file (A1: legacyRouteResolves has no containment
 *                    check — a regression the amendment-2 FIX ITSELF
 *                    introduced while closing the original declared-data
 *                    gap; see the AT-61..67 block below)
 *   AT-68 .. AT-69 — session-transcript.test.ts (A2: listDirEntries can
 *                    enumerate an outside directory when manifests/themes
 *                    is itself a dir-level symlink)
 *   AT-70 .. AT-74 — bridge-studio-sessions.test.ts (A3: the 404 message
 *                    buckets for every status.json failure shape)
 *
 * A3 (this file, AT-49..52): `legacyRoutes` was parsed, typed, and echoed
 * back, but never actually checked — declared-data-fails-open. New contract:
 * `validateSessionKinds` errors when a `legacyRoutes` entry is empty/blank OR
 * does not correspond to a real route directory under `forge-ui/app/` (route
 * path segments map 1:1 onto Next.js App Router directory names, including
 * literal `[sessionId]` dynamic-segment folders — e.g.
 * `/architect/[sessionId]/interview` → `forge-ui/app/architect/[sessionId]/interview`,
 * verified to exist on disk for AT-52).
 *
 * AT-amendment-3, A1 (this file, AT-61..67): the amendment-2 fix for A3
 * added `legacyRouteResolves(forgeRoot, route)`, which does
 * `existsSync(join(forgeRoot, 'forge-ui', 'app', ...segments))` with NO
 * check that the resolved path stays under `forge-ui/app/` — `path.join`
 * normalizes `..` segments before `existsSync` ever runs. A route entry
 * containing enough `..` escapes to ANY real directory (including, via
 * enough `..` segments to clamp past the filesystem root, arbitrary
 * absolute paths like `/etc`) and is wrongly accepted as "resolved". Every
 * AT below was empirically verified against the actual (unfixed)
 * `legacyRouteResolves`/`validateSessionKinds` before being written — see
 * each test's comment for whether it demonstrates a LIVE bypass (RED today)
 * or pins an already-safe shape (GREEN today, coverage only — reported
 * honestly per T2's brief, not disguised as a fresh catch).
 *
 * Design decisions this file pins (see the T3 report for the full rationale):
 *   - `studio/session-kinds.yaml` is a bare top-level YAML sequence of
 *     descriptor objects (mirrors nothing else in the repo exactly, but is
 *     the simplest shape for a single-purpose registry file).
 *   - `loadSessionKinds` is STRUCTURAL only (mirrors loadFlowDefinition /
 *     loadCatalog): it throws on missing file / unparseable YAML / a missing
 *     required scalar field, but does NOT validate closed-vocabulary
 *     membership (stage tokens, artifact kinds, agent refs, duplicate ids,
 *     slug shape) — those are SEMANTIC checks, live only in
 *     `validateSessionKinds`, exactly mirroring the load/validate split
 *     validate.ts already draws for agents/flows (validateAgent's slug check
 *     is a Finding, not a load-time throw).
 *   - Agent-ref resolution scans EVERY skill dir's SKILL.md (skills/<slug>/SKILL.md)
 *     with a `runtime:` block, REGARDLESS of `library: false` — NOT `listAgentDefinitions()`,
 *     which deliberately excludes `library: false` agents from the composable
 *     Studio roster (instructions-creator and project-brain-builder are both
 *     `library: false` internal agents dispatched by the bridge — see their
 *     SKILL.md frontmatter). Using `listAgentDefinitions()` for resolution
 *     would wrongly flag 2 of the 3 real session-kind descriptors. AT-17
 *     pins this against the real repo.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import matter from 'gray-matter';

import {
  SESSION_STAGES,
  SESSION_ARTIFACT_KINDS,
  sessionArtifactKindState,
  loadSessionKinds,
  validateSessionKinds,
  type SessionKindDescriptor,
} from './session-kinds.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeForgeRoot(prefix = 'session-kinds-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

type FixtureDescriptor = {
  id: string;
  agent: string;
  title: string;
  legacyRoutes: string[];
  stages: string[];
  defaultStage: string;
  artifact: { kind: string; label: string };
};

function baseDescriptor(overrides: Partial<FixtureDescriptor> = {}): FixtureDescriptor {
  return {
    id: 'fixture-kind',
    agent: 'fixture-agent',
    title: 'Fixture Kind',
    legacyRoutes: ['/fixture/[sessionId]'],
    stages: ['roadmap'],
    defaultStage: 'roadmap',
    artifact: { kind: 'roadmap-draft', label: 'Fixture draft' },
    ...overrides,
  };
}

/** Write `studio/session-kinds.yaml` from a list of plain descriptor objects. */
function writeSessionKindsYaml(root: string, descriptors: unknown[]): string {
  const dir = join(root, 'studio');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'session-kinds.yaml');
  writeFileSync(p, yaml.dump(descriptors), 'utf8');
  return p;
}

/** Write a minimal SKILL.md with a `runtime:` block (a resolvable agent),
 *  optionally `library: false` (an internal agent, still resolvable — this is
 *  the exact shape instructions-creator / project-brain-builder use). */
function writeAgentSkill(root: string, slug: string, opts: { libraryFalse?: boolean } = {}): void {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const data: Record<string, unknown> = {
    name: slug,
    description: `Fixture agent ${slug}.`,
    purpose: 'Fixture purpose.',
    composition: { skills: [], tools: [], mcps: [], guards: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fixture.',
    'allowed-tools': [],
    'disallowed-tools': [],
    budgets: {},
  };
  if (opts.libraryFalse) data.library = false;
  writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\nFixture body.\n', data), 'utf8');
}

function byId(descs: readonly SessionKindDescriptor[], id: string): SessionKindDescriptor {
  const d = descs.find((x) => x.id === id);
  assert.ok(d, `expected descriptor "${id}" to be present`);
  return d!;
}

/** Creates a REAL `forge-ui/app/<...segments>/` directory under `root` for a
 *  legacyRoutes entry like `/fixture-kind/[sessionId]` — route path segments
 *  map 1:1 onto Next.js App Router directory names, including a literal
 *  `[sessionId]` dynamic-segment folder (verified against the real repo:
 *  `forge-ui/app/architect/[sessionId]/interview/page.tsx` exists on disk). */
function writeForgeUiRoute(root: string, routePath: string): void {
  const segments = routePath.replace(/^\//, '').split('/').filter((s) => s.length > 0);
  mkdirSync(join(root, 'forge-ui', 'app', ...segments), { recursive: true });
}

// ===========================================================================
// Vocabularies (AT-1, AT-2)
// ===========================================================================

describe('SESSION_STAGES + SESSION_ARTIFACT_KINDS — closed vocabularies', () => {
  it('AT-1: SESSION_STAGES is exactly the 6-token ordered vocabulary, frozen', () => {
    assert.deepEqual([...SESSION_STAGES], ['contract', 'instructions', 'secrets', 'demo', 'roadmap', 'brain']);
    assert.ok(Object.isFrozen(SESSION_STAGES), 'SESSION_STAGES must be frozen — a closed vocabulary is never mutated at runtime');
  });

  it('AT-2: SESSION_ARTIFACT_KINDS carries exactly the 3 live + 3 reserved rows, in order, frozen', () => {
    const ids = SESSION_ARTIFACT_KINDS.map((k) => k.id);
    assert.deepEqual(ids, ['roadmap-draft', 'markdown-draft', 'brain-structure', 'file-package', 'contract-buildout', 'generation-gallery']);
    const live = SESSION_ARTIFACT_KINDS.filter((k) => k.status === 'live').map((k) => k.id);
    const reserved = SESSION_ARTIFACT_KINDS.filter((k) => k.status === 'reserved').map((k) => k.id);
    assert.deepEqual(live, ['roadmap-draft', 'markdown-draft', 'brain-structure']);
    assert.deepEqual(reserved, ['file-package', 'contract-buildout', 'generation-gallery']);
    assert.ok(Object.isFrozen(SESSION_ARTIFACT_KINDS));
  });

  it('AT-3: sessionArtifactKindState is a total function — live/reserved/unknown, never throws', () => {
    assert.equal(sessionArtifactKindState('roadmap-draft'), 'live');
    assert.equal(sessionArtifactKindState('brain-structure'), 'live');
    assert.equal(sessionArtifactKindState('file-package'), 'reserved');
    assert.equal(sessionArtifactKindState('generation-gallery'), 'reserved');
    assert.equal(sessionArtifactKindState('no-such-kind-at-all'), undefined, 'an unrecognised kind must resolve to undefined, never a guess and never a throw');
  });
});

// ===========================================================================
// loadSessionKinds — structural parse only (AT-4, AT-5)
// ===========================================================================

describe('loadSessionKinds — structural parse (fixture-driven)', () => {
  it('AT-4: parses a valid 3-descriptor fixture; ids unique; shape matches SessionKindDescriptor', () => {
    const root = makeForgeRoot();
    writeSessionKindsYaml(root, [
      baseDescriptor({ id: 'alpha', agent: 'alpha-agent' }),
      baseDescriptor({ id: 'beta', agent: 'beta-agent' }),
      baseDescriptor({ id: 'gamma', agent: 'gamma-agent' }),
    ]);
    const descs = loadSessionKinds(root);
    assert.equal(descs.length, 3);
    assert.deepEqual(descs.map((d) => d.id).sort(), ['alpha', 'beta', 'gamma']);
    const alpha = byId(descs, 'alpha');
    assert.equal(alpha.agent, 'alpha-agent');
    assert.equal(alpha.title, 'Fixture Kind');
    assert.deepEqual(alpha.legacyRoutes, ['/fixture/[sessionId]']);
    assert.deepEqual(alpha.stages, ['roadmap']);
    assert.equal(alpha.defaultStage, 'roadmap');
    assert.deepEqual(alpha.artifact, { kind: 'roadmap-draft', label: 'Fixture draft' });
  });

  it('AT-5: order is deterministic — a reverse-alpha fixture is returned in DECLARATION order, never silently resorted', () => {
    const root = makeForgeRoot();
    writeSessionKindsYaml(root, [
      baseDescriptor({ id: 'zzz-kind', agent: 'z-agent' }),
      baseDescriptor({ id: 'mmm-kind', agent: 'm-agent' }),
      baseDescriptor({ id: 'aaa-kind', agent: 'a-agent' }),
    ]);
    const ids = loadSessionKinds(root).map((d) => d.id);
    assert.deepEqual(ids, ['zzz-kind', 'mmm-kind', 'aaa-kind'], 'loadSessionKinds must preserve YAML declaration order, not re-sort alphabetically');
  });
});

// ===========================================================================
// validateSessionKinds — semantic errors, each its own AT (AT-6..AT-15)
// ===========================================================================

describe('validateSessionKinds — semantic errors', () => {
  it('AT-6: a stage token outside SESSION_STAGES → error naming the value and the allowed set', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ stages: ['not-a-real-stage'], defaultStage: 'not-a-real-stage' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/unknown-stage');
    assert.ok(f, `expected a session-kinds/unknown-stage finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('not-a-real-stage'), 'message must name the offending value');
    for (const s of SESSION_STAGES) assert.ok(f!.message.includes(s), `message must name the allowed set (missing "${s}")`);
  });

  it('AT-7: defaultStage not a member of the descriptor\'s OWN stages → error naming both', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ stages: ['roadmap'], defaultStage: 'brain' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/default-stage-not-in-stages');
    assert.ok(f, `expected a session-kinds/default-stage-not-in-stages finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('brain'), 'message must name the offending defaultStage');
    assert.ok(f!.message.includes('roadmap'), 'message must name the descriptor\'s own declared stages');
  });

  it('AT-8: an empty stages list → error', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ stages: [] })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/empty-stages');
    assert.ok(f, `expected a session-kinds/empty-stages finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('fixture-kind'), 'message must name the offending descriptor id');
  });

  it('AT-9: an artifact kind outside SESSION_ARTIFACT_KINDS entirely → error naming the value and the allowed set', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ artifact: { kind: 'no-such-kind-at-all', label: 'x' } })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/unknown-artifact-kind');
    assert.ok(f, `expected a session-kinds/unknown-artifact-kind finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('no-such-kind-at-all'));
    for (const k of SESSION_ARTIFACT_KINDS.map((x) => x.id)) assert.ok(f!.message.includes(k), `message must name the allowed set (missing "${k}")`);
  });

  it('AT-10: an artifact kind that IS a reserved row → error, DISTINCT check id from "unknown kind" (parses ok, lint error)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ artifact: { kind: 'file-package', label: 'x' } })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/reserved-artifact-kind');
    assert.ok(f, `expected a session-kinds/reserved-artifact-kind finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('file-package'));
    assert.ok(!findings.some((x) => x.check === 'session-kinds/unknown-artifact-kind'), 'a reserved kind must NOT also trip the unknown-kind check — they are distinct findings');
  });

  it('AT-11: duplicate descriptor ids → error naming the id', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ id: 'dupe' }), baseDescriptor({ id: 'dupe' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/duplicate-id');
    assert.ok(f, `expected a session-kinds/duplicate-id finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('dupe'));
  });

  it('AT-12: an agent ref that resolves to no real agent definition → error naming BOTH the offending value AND the known-agent set (strengthened — mirrors AT-6/AT-9\'s shape, a reviewer-flagged gap)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'real-agent-fixture');
    writeAgentSkill(root, 'another-real-agent-fixture');
    writeSessionKindsYaml(root, [baseDescriptor({ agent: 'ghost-agent-does-not-exist' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/unknown-agent');
    assert.ok(f, `expected a session-kinds/unknown-agent finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('ghost-agent-does-not-exist'), 'message must name the offending agent id');
    // Strengthened: AT-6 (unknown stage) and AT-9 (unknown artifact kind)
    // both enumerate the full allowed set in their message — the unknown-agent
    // message must meet the same bar, not just name the bad value in isolation.
    assert.ok(f!.message.includes('real-agent-fixture'), `message must enumerate the known-agent set (missing "real-agent-fixture"), got: ${f!.message}`);
    assert.ok(f!.message.includes('another-real-agent-fixture'), `message must enumerate the known-agent set (missing "another-real-agent-fixture"), got: ${f!.message}`);
  });

  it('AT-13: a missing studio/session-kinds.yaml → loadSessionKinds throws; validateSessionKinds returns exactly one error finding, never a silent empty list', () => {
    const root = makeForgeRoot();
    // No studio/ dir at all — the file is entirely absent.
    assert.throws(() => loadSessionKinds(root), 'loadSessionKinds must throw on a missing file (mirrors loadFlowDefinition/loadCatalog)');
    const findings = validateSessionKinds(root);
    assert.equal(findings.length, 1, `expected exactly 1 finding on a missing file, got: ${JSON.stringify(findings)}`);
    assert.equal(findings[0].check, 'session-kinds/load-error');
    assert.equal(findings[0].level, 'error');
    assert.ok(findings[0].message.length > 0);
  });

  it('AT-14: a malformed (unparseable) session-kinds.yaml → loadSessionKinds throws; validateSessionKinds returns exactly one error finding naming the file', () => {
    const root = makeForgeRoot();
    const dir = join(root, 'studio');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'session-kinds.yaml');
    writeFileSync(p, '- id: broken\n    this is not valid yaml: [\n', 'utf8');
    assert.throws(() => loadSessionKinds(root));
    const findings = validateSessionKinds(root);
    assert.equal(findings.length, 1, `expected exactly 1 finding on malformed YAML, got: ${JSON.stringify(findings)}`);
    assert.equal(findings[0].check, 'session-kinds/load-error');
    assert.equal(findings[0].level, 'error');
    assert.ok(findings[0].message.includes('session-kinds.yaml'), 'message must name the offending file');
  });

  it('AT-15: a descriptor id that is not a valid slug → error', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ id: 'Not_A_Valid_Slug' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/slug');
    assert.ok(f, `expected a session-kinds/slug finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('Not_A_Valid_Slug'));
  });
});

// ===========================================================================
// Defense-in-depth — validate reads the SAME evidence load does (AT-16)
// ===========================================================================

describe('defense-in-depth — validate must not check a more permissive parse than load', () => {
  it('AT-16: loadSessionKinds ACCEPTS a descriptor with an unknown stage (structural parse is lenient); validateSessionKinds still flags the SAME value', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ stages: ['not-a-real-stage'], defaultStage: 'not-a-real-stage' })]);

    // The loader must not throw or drop the descriptor — semantic validation
    // is validateSessionKinds's job, not the loader's.
    let descs: SessionKindDescriptor[] = [];
    assert.doesNotThrow(() => { descs = loadSessionKinds(root); });
    assert.equal(descs.length, 1);
    assert.deepEqual(descs[0].stages, ['not-a-real-stage'], 'the loader must carry the same offending value through, unmodified');

    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/unknown-stage');
    assert.ok(f, 'validateSessionKinds must flag the exact value the loader accepted — the same evidence, not a different, more permissive parse');
    assert.ok(f!.message.includes('not-a-real-stage'));
  });
});

// ===========================================================================
// Real repo (AT-17, AT-18)
// ===========================================================================

describe('the real repo (studio/session-kinds.yaml) lints clean and matches the spec exactly', () => {
  it('AT-17: validateSessionKinds(REPO_ROOT) returns ZERO error-level findings — including zero unknown-agent errors, even though instructions-creator and project-brain-builder are both `library: false` internal agents', () => {
    const findings = validateSessionKinds(REPO_ROOT);
    const errors = findings.filter((f) => f.level === 'error');
    assert.deepEqual(errors, [], `expected 0 error-level findings in the real repo, got: ${JSON.stringify(errors)}`);
  });

  it('AT-18: loadSessionKinds(REPO_ROOT) returns EXACTLY the 3 shipped descriptors with their pinned real ids/agents/stages/defaultStage/artifact kinds+labels', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    assert.equal(descs.length, 3, `expected exactly 3 real session kinds, got ids: ${descs.map((d) => d.id).join(', ')}`);

    const architect = byId(descs, 'architect');
    assert.equal(architect.agent, 'architect');
    assert.deepEqual(architect.legacyRoutes, ['/architect/[sessionId]', '/architect/[sessionId]/interview']);
    assert.deepEqual(architect.stages, ['roadmap']);
    assert.equal(architect.defaultStage, 'roadmap');
    assert.deepEqual(architect.artifact, { kind: 'roadmap-draft', label: 'Roadmap draft' });

    const instructions = byId(descs, 'instructions');
    assert.equal(instructions.agent, 'instructions-creator');
    assert.deepEqual(instructions.legacyRoutes, ['/instructions/[sessionId]']);
    assert.deepEqual(instructions.stages, ['instructions']);
    assert.equal(instructions.defaultStage, 'instructions');
    assert.deepEqual(instructions.artifact, { kind: 'markdown-draft', label: 'AGENTS.md draft' });

    const projectBrain = byId(descs, 'project-brain');
    assert.equal(projectBrain.agent, 'project-brain-builder');
    assert.deepEqual(projectBrain.legacyRoutes, ['/project-brain/[sessionId]']);
    assert.deepEqual(projectBrain.stages, ['brain']);
    assert.equal(projectBrain.defaultStage, 'brain');
    assert.deepEqual(projectBrain.artifact, { kind: 'brain-structure', label: 'Seeded structure' });
  });
});

// ===========================================================================
// A3 — legacyRoutes is no longer declared-data-fails-open (AT-49..52)
// ===========================================================================

describe('validateSessionKinds — legacyRoutes must resolve to a real forge-ui/app/ route (AT-amendment-2, A3)', () => {
  it('AT-49: a legacyRoutes entry that does not correspond to a real forge-ui/app/ directory → error naming ONLY the bogus entry, not the sibling that DOES resolve', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]'); // this one is real
    // '/totally-bogus-route/[sessionId]' has NO matching forge-ui/app/ dir.
    writeSessionKindsYaml(root, [
      baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', '/totally-bogus-route/[sessionId]'] }),
    ]);
    const findings = validateSessionKinds(root);
    // Exactly ONE finding proves the real, resolving sibling route was never
    // flagged (a false positive would produce a second finding for it).
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 bogus-route finding (not the real sibling too), got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes('/totally-bogus-route/[sessionId]'), `message must name the offending route, got: ${routeFindings[0].message}`);
  });

  it('AT-50: an empty/blank legacyRoutes entry → error', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', ''] })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/legacy-route-not-found');
    assert.ok(f, `expected a session-kinds/legacy-route-not-found finding for the blank entry, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
  });

  it('AT-51: an EMPTY legacyRoutes list → allowed, no finding (a future kind may declare none)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: [] })]);
    const findings = validateSessionKinds(root);
    assert.deepEqual(findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found'), [], 'an empty legacyRoutes list must never itself be an error');
  });

  it('AT-52: the real repo — all three shipped descriptors\' legacyRoutes resolve to real forge-ui/app/ directories (verified independently of the validator too)', () => {
    const findings = validateSessionKinds(REPO_ROOT);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.deepEqual(routeFindings, [], `expected 0 legacy-route-not-found findings in the real repo, got: ${JSON.stringify(routeFindings)}`);

    // Independent verification (not just trusting the validator under test):
    // every shipped legacyRoutes entry really does exist as a forge-ui/app/ dir.
    const descs = loadSessionKinds(REPO_ROOT);
    for (const d of descs) {
      for (const route of d.legacyRoutes) {
        const segments = route.replace(/^\//, '').split('/').filter((s) => s.length > 0);
        const dirPath = join(REPO_ROOT, 'forge-ui', 'app', ...segments);
        assert.ok(existsSync(dirPath), `expected "${dirPath}" (from legacyRoutes entry "${route}" on session kind "${d.id}") to exist`);
      }
    }
  });
});

// ===========================================================================
// A4 — YAML structural coverage gap (AT-53..56): these already work
// correctly against the shipped loader (loadSessionKindsSequence's
// `!Array.isArray(parsed)` guard, and parseSessionKindDescriptor's mapping
// guard) — reviewer-reproduced but previously UNPINNED. Each must yield
// EXACTLY ONE session-kinds/load-error finding, never a silent empty list.
// ===========================================================================

describe('validateSessionKinds — YAML structural coverage (AT-amendment-2, A4)', () => {
  function writeRawYaml(root: string, content: string): void {
    const dir = join(root, 'studio');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session-kinds.yaml'), content, 'utf8');
  }

  function assertExactlyOneLoadError(root: string): void {
    assert.throws(() => loadSessionKinds(root), 'loadSessionKinds must throw — this is a structural violation, not a semantic one');
    const findings = validateSessionKinds(root);
    assert.equal(findings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(findings)}`);
    assert.equal(findings[0].check, 'session-kinds/load-error');
    assert.equal(findings[0].level, 'error');
  }

  it('AT-53: top-level YAML parses to a MAP (not a sequence) → exactly one session-kinds/load-error finding', () => {
    const root = makeForgeRoot();
    writeRawYaml(root, 'id: not-a-sequence-at-all\nagent: whatever\n');
    assertExactlyOneLoadError(root);
  });

  it('AT-54: top-level YAML parses to a BARE SCALAR (a plain string) → exactly one session-kinds/load-error finding', () => {
    const root = makeForgeRoot();
    writeRawYaml(root, 'just a bare scalar string\n');
    assertExactlyOneLoadError(root);
  });

  it('AT-55: top-level YAML parses to NULL/empty (an empty file, and an explicit "null") → exactly one session-kinds/load-error finding, in BOTH cases', () => {
    const emptyRoot = makeForgeRoot();
    writeRawYaml(emptyRoot, '');
    assertExactlyOneLoadError(emptyRoot);

    const nullRoot = makeForgeRoot();
    writeRawYaml(nullRoot, 'null\n');
    assertExactlyOneLoadError(nullRoot);
  });

  it('AT-56: a sequence item that is a BARE STRING rather than a mapping → exactly one session-kinds/load-error finding', () => {
    const root = makeForgeRoot();
    writeRawYaml(root, '- "just a string, not a mapping"\n- id: also-irrelevant\n');
    assertExactlyOneLoadError(root);
  });
});

// ===========================================================================
// AT-amendment-3, A1 (AT-61..67) — legacyRouteResolves has NO containment
// check. `existsSync(join(forgeRoot, 'forge-ui', 'app', ...segments))` is
// evaluated on the path.join()-NORMALIZED result — `..` segments collapse
// BEFORE existsSync runs, so a route entry can point anywhere `existsSync`
// can see. Every scenario below was run against the actual, unfixed
// `legacyRouteResolves`/`validateSessionKinds` before being written (see
// each test's comment for the empirically-verified outcome).
// ===========================================================================

describe('validateSessionKinds — legacyRouteResolves has NO containment check (AT-amendment-3, A1)', () => {
  it('AT-61: a legacyRoutes entry escaping upward to a REAL directory OUTSIDE forge-ui/app → error (empirically verified: currently returns true, i.e. wrongly "resolves" — LIVE bypass)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]'); // negative control: the real, legitimate sibling
    mkdirSync(join(root, 'escaped-outside-target'), { recursive: true }); // the escape target REALLY exists
    const evilRoute = '../../escaped-outside-target'; // forge-ui/app/../.. => root; + escaped-outside-target
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', evilRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding (the escape, not the real sibling), got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(evilRoute), `message must name the offending route, got: ${routeFindings[0].message}`);
  });

  it('AT-62: a legacyRoutes entry of exactly "../../.." → error (empirically verified: normalizes ONE level above forgeRoot — not forgeRoot itself, but still a real, always-present directory — currently returns true — LIVE bypass)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const evilRoute = '../../..';
    // Sanity precondition (not the assertion under test): confirm the target
    // this route actually resolves to is real, so the AT can't pass for the
    // wrong reason (a route that resolves to nothing would be correctly
    // rejected even by the buggy code).
    const target = join(root, 'forge-ui', 'app', '..', '..', '..');
    assert.ok(existsSync(target), `precondition failed: "${target}" (what "../../.." resolves to) must exist for this AT to mean anything`);
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', evilRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(evilRoute));
  });

  it('AT-63: legacyRoutes entries reaching absolute filesystem paths via excess ".." segments (clamps past the root, then descends into "/etc" and a self-controlled outside dir) → error for EACH (empirically verified: both currently return true — LIVE bypass; a literal bare "/etc" string does NOT bypass on this codebase — see AT-64\'s neighbor note — this is the actual reachable shape)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const outsideAbsDir = makeForgeRoot('legacy-abs-outside-target-'); // a REAL, independent absolute dir
    const manyDotDot = Array(30).fill('..').join('/'); // safely more than any real nesting depth
    const routeToEtc = `${manyDotDot}/etc`;
    const routeToOutsideAbsDir = manyDotDot + outsideAbsDir; // outsideAbsDir already starts with '/'
    writeSessionKindsYaml(root, [
      baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', routeToEtc, routeToOutsideAbsDir] }),
    ]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 2, `expected exactly 2 findings (both absolute escapes, not the real sibling), got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings.some((f) => f.message.includes(routeToEtc)), `expected a finding naming the /etc escape, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings.some((f) => f.message.includes(routeToOutsideAbsDir)), `expected a finding naming the outside-dir escape, got: ${JSON.stringify(routeFindings)}`);
  });

  it('AT-64: a legacyRoutes entry containing a BACKSLASH separator → error (empirically verified: this does NOT bypass containment today — POSIX treats "\\\\" as a plain filename character, not a separator, so the literal-backslash "filename" simply never exists; ALREADY correctly rejected — pinned as coverage, not a fresh catch)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const backslashRoute = '..\\..\\escaped-outside-target';
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', backslashRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(backslashRoute));
  });

  it('AT-65: a legacyRoutes entry containing a NULL BYTE → error (empirically verified: does NOT bypass — existsSync neither throws nor matches a literal-NUL "filename"; ALREADY correctly rejected — pinned as coverage, not a fresh catch)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    mkdirSync(join(root, 'escaped-outside-target'), { recursive: true }); // real target — proves the NUL, not a missing dir, is what blocks it
    const nullByteRoute = '../../escaped-outside-target' + String.fromCharCode(0);
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', nullByteRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes('escaped-outside-target'));
  });

  it('AT-66: a legacyRoutes entry containing a URL-ENCODED traversal ("%2e%2e%2f...") → error (empirically verified: never URL-decoded anywhere in this code path — the literal percent-text is just an opaque filename that never exists; ALREADY correctly rejected — pinned as coverage, not a fresh catch)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const encodedRoute = '%2e%2e%2fescaped-outside-target';
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', encodedRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(encodedRoute));
  });

  it('AT-67: a legacyRoutes entry that escapes and comes back down to the SAME real, legitimate directory → error (T2 ruling: a declared route is a Studio route path, not a filesystem expression — "../app/fixture-kind/[sessionId]" numerically round-trips to the real target, but the STRING contains ".." and must be rejected regardless; empirically verified: currently returns true — LIVE bypass, and the most dangerous shape since it looks harmless on inspection)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const roundTripRoute = '../app/fixture-kind/[sessionId]'; // normalizes right back to the real target
    // Sanity precondition: confirm this route really does round-trip to the
    // legitimate target (so the AT is pinning "must reject despite being
    // numerically legitimate", not accidentally pinning a missing-dir case).
    const target = join(root, 'forge-ui', 'app', '..', 'app', 'fixture-kind', '[sessionId]');
    assert.ok(existsSync(target), `precondition failed: "${target}" must exist (it's the same real dir as the legitimate route)`);
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', roundTripRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding — a route string containing ".." must be rejected even when it numerically resolves back to a legitimate target, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(roundTripRoute));
  });
});
