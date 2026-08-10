/**
 * Acceptance tests for orchestrator/studio/hook-library.ts (R3-03-F1 + F1b) —
 * DOES NOT EXIST YET. This file is RED at branch base: every describe block
 * below fails at import time (`Cannot find module './hook-library.ts'`) —
 * that is the expected, deliberate red. Do not stub the module into
 * existence to turn this green; red is the deliverable of this round.
 *
 * Contract this file pins (docs/decisions/027-studio-object-model.md's
 * "Amendment (R3-03, 2026-08-04)" + docs/roadmaps/R3-library-componentry.md
 * §R3-03):
 *
 *   A library HOOK is an agent-lifecycle customisation — {id, name,
 *   description, on (lifecycle event), matcher?, script, permissions} — read
 *   from a FILE PACKAGE at studio/hooks/<id>/hook.yaml (+ the script files it
 *   references), exactly parallel to a skill package. It is generic and
 *   host-agnostic: a definition never names a binding. Binding happens only
 *   in the Agent Builder via composition.hooks (a list of library hook ids).
 *
 *   composition.guards (renamed from composition.hooks by the immediately
 *   preceding PR, #76 / commit 7984a548) stays the platform dispatch-key
 *   vocabulary — 5 toggle ids (event-log, cost-guard, stall-watchdog,
 *   merge-gate, scratch-strip) + 4 band ids (wi-contract, reflection-close,
 *   demo-band, review-band), all listed in studio/catalog.yaml's `guards:`
 *   section. composition.hooks is REINTRODUCED by this round meaning ONLY
 *   library hook ids. Enforcement must be SYMMETRIC: a guard id under
 *   composition.hooks is an error, and a hook id under composition.guards is
 *   an error — both directions, because a one-directional check is the
 *   half-guard this repo has been bitten by before.
 *
 * Style: node:test + node:assert/strict, real temp forge roots via
 * mkdtempSync (no mocking of node:fs), mirroring skill-library.test.ts and
 * template-library.test.ts. The two OOTB seed hooks are pinned against the
 * REAL repo root (REPO_ROOT), mirroring template-library.test.ts's "the REAL
 * repo for facts" convention — this test is RED for a second, independent
 * reason until those two are also shipped: neither `hook-library.ts` NOR
 * `studio/hooks/pre-pr-security-review/` exist yet.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS MADE HERE THAT WERE NOT SPECIFIED (ratify or redirect —
 * see the T3 final report for the full list; summarised at each call site):
 *
 *  D-A. Module surface (exact names the implementer must produce):
 *       HOOK_LIFECYCLE_EVENTS, HookLifecycleEvent, HookPermissionManifest,
 *       HookDefinition, HookLibraryEntry, HookUsedByDerivation,
 *       FORBIDDEN_HOOK_BINDING_KEYS, hooksDir, hookDir, hookYamlPath,
 *       listHookIds, loadHookDefinition, deriveHookUsage, listHookLibrary,
 *       lintHookDefinitions, lintHookComposition.
 *  D-B. `loadHookDefinition` THROWS (never returns a partial/invalid model)
 *       for: bad slug, `on` outside the closed set, script escaping the hook
 *       dir, and a forbidden binding key — mirrors registry.ts's `oneOf()`
 *       (throws on a bad enum) and skill-library.ts's `walkPackageDir`
 *       (throws on traversal). `listHookLibrary` is RESILIENT (catches
 *       per-id, surfaces an `error` field) — mirrors
 *       `listAgentDefinitionsResilient`/`SkillLibraryEntry.error` (AT-7).
 *       `lintHookDefinitions` is the THIRD layer that turns the same throw
 *       into a `Finding` for `forge studio lint` — satisfying the roadmap's
 *       literal "a lint ERROR" phrasing for the `on:` check without making
 *       `loadHookDefinition` itself return a bogus value for a bad enum.
 *  D-C. `deriveHookUsage(forgeRoot)` takes a ROOT, not an `AgentDefinition[]`
 *       array (template-library.ts's `deriveArtifactTemplateUsage`
 *       precedent, not skill-library.ts's `deriveSkillUsage` precedent) —
 *       deliberately, so this test file never has to construct a fixture
 *       `AgentDefinition` object literal carrying a `composition.hooks`
 *       field that doesn't exist yet on `AgentComposition` (see D-E below).
 *  D-D. Composition-symmetry checks (`lintHookComposition`) live in
 *       hook-library.ts, not validate.ts/registry.ts — it is the one module
 *       that knows BOTH "what is a valid library hook id" (F1) and needs
 *       "what is a valid guard id" (studio/catalog.yaml's `guards:`,
 *       existing `loadCatalog`). Findings: `hook-library/guard-in-hooks`,
 *       `hook-library/unknown-hook-ref`, `hook-library/hook-in-guards` (all
 *       my naming choice).
 *  D-E. Exactly ONE test below constructs a typed `AgentDefinition` fixture
 *       with a `composition.hooks` array using `as unknown as AgentDefinition`
 *       (never `any`, never `@ts-expect-error`) — the dispatch-hijack proof,
 *       which calls the REAL, ALREADY-SHIPPED `resolveBandGuard`
 *       (orchestrator/agent-bands.ts) directly and needs a real typed value.
 *       `AgentComposition` does not carry `hooks` yet (that lands with this
 *       feature); the cast is the documented, minimal way to pin the contract
 *       today without waiting on the type to exist. Every OTHER test reads
 *       `composition.hooks` only through raw YAML frontmatter on disk
 *       (untyped `Record<string, unknown>`) or through the NEW library's own
 *       `Finding[]`-returning functions, so it never touches the untyped
 *       field directly.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { loadAgentDefinition, loadCatalog } from './registry.ts';
import { resolveBandGuard, PLATFORM_GUARD_IDS } from '../agent-bands.ts';
import type { AgentDefinition } from './types.ts';
import type { Finding } from './validate.ts';

import {
  HOOK_LIFECYCLE_EVENTS,
  FORBIDDEN_HOOK_BINDING_KEYS,
  hooksDir,
  hookDir,
  hookYamlPath,
  listHookIds,
  loadHookDefinition,
  deriveHookUsage,
  listHookLibrary,
  lintHookDefinitions,
  lintHookComposition,
  type HookDefinition,
  type HookPermissionManifest,
  type HookLibraryEntry,
} from './hook-library.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

const createdDirs: string[] = [];

function makeForgeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-library-'));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

const DEFAULT_PERMISSIONS: HookPermissionManifest = { env: [], read: [], network: false };

/** Write a real studio/hooks/<id>/hook.yaml + scripts/run.sh package to a forge root. */
function writeHookPackage(
  root: string,
  id: string,
  fields: {
    name?: string;
    description?: string;
    on?: string;
    matcher?: string;
    script?: string; // relative path, default scripts/run.sh
    permissions?: HookPermissionManifest;
    extra?: Record<string, unknown>; // spliced into the YAML root — used for binding-field probes
    scriptBody?: string;
  } = {},
): string {
  const dir = hookDirRaw(root, id);
  const scriptRel = fields.script ?? 'scripts/run.sh';
  mkdirSync(join(dir, ...scriptRel.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(dir, ...scriptRel.split('/')), fields.scriptBody ?? '#!/usr/bin/env bash\necho ok\n', 'utf8');

  const doc: Record<string, unknown> = {
    id,
    name: fields.name ?? id,
    description: fields.description ?? `Test hook ${id}.`,
    on: fields.on ?? 'PreToolUse',
    ...(fields.matcher !== undefined ? { matcher: fields.matcher } : {}),
    script: scriptRel,
    permissions: fields.permissions ?? DEFAULT_PERMISSIONS,
    ...(fields.extra ?? {}),
  };
  writeFileSync(join(dir, 'hook.yaml'), yaml.dump(doc), 'utf8');
  return join(dir, 'hook.yaml');
}

/** Raw dir join — deliberately NOT going through the module under test's own
 *  `hookDir`, so a fixture can be written for an INVALID id (traversal probes
 *  construct their fixture directory directly; the id under test is what is
 *  passed to `loadHookDefinition`, not necessarily what the fixture dir is
 *  named). For well-formed ids the two coincide. */
function hookDirRaw(root: string, id: string): string {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A minimal, valid studio-agent SKILL.md — raw YAML frontmatter text (never
 *  a typed `AgentComposition` object literal), so a `hooks:` line can be
 *  added freely without hitting the not-yet-existing field on the type. */
function writeAgentSkillMd(
  root: string,
  slug: string,
  composition: { skills?: string[]; tools?: string[]; mcps?: string[]; guards?: string[]; hooks?: string[] } = {},
): string {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const compositionYaml = [
    `  skills: [${(composition.skills ?? []).join(', ')}]`,
    `  tools: [${(composition.tools ?? []).join(', ')}]`,
    `  mcps: [${(composition.mcps ?? []).join(', ')}]`,
    `  guards: [${(composition.guards ?? []).join(', ')}]`,
    ...(composition.hooks !== undefined ? [`  hooks: [${composition.hooks.join(', ')}]`] : []),
  ].join('\n');
  const content = `---
name: ${slug}
description: Test agent ${slug}.
purpose: Test purpose.
composition:
${compositionYaml}
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: none
interactivity: Fully autonomous.
allowed-tools: []
disallowed-tools: []
budgets:
  iterationCap: 5
---

Process body.
`;
  const p = join(dir, 'SKILL.md');
  writeFileSync(p, content, 'utf8');
  return p;
}

/** A minimal, valid AgentDefinition fixture (no disk I/O) matching the
 *  CURRENT `AgentComposition` shape — see D-E in the header for the ONE test
 *  that widens this with a `hooks` field via `as unknown as`. */
function makeAgentDef(slug: string, guards: string[]): AgentDefinition {
  return {
    slug,
    name: slug,
    description: `Agent ${slug}.`,
    purpose: 'Test purpose.',
    composition: { skills: [], tools: [], mcps: [], hooks: [], guards },
    runtime: { sdk: 'claude', strategy: 'fixed' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: 'Body.',
    path: `/fake/${slug}/SKILL.md`,
  } as AgentDefinition;
}

// ---------------------------------------------------------------------------
// HOOK_LIFECYCLE_EVENTS — closed registry (mirrors flow-trigger.ts's
// TRIGGER_KINDS pattern per the task brief)
// ---------------------------------------------------------------------------

describe('HOOK_LIFECYCLE_EVENTS', () => {
  it('is exactly the 6 events named in the ADR amendment, no more, no fewer', () => {
    assert.deepEqual(
      [...HOOK_LIFECYCLE_EVENTS].sort(),
      ['Notification', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'UserPromptSubmit'].sort(),
    );
  });

  it('contains no duplicate entries', () => {
    assert.equal(new Set(HOOK_LIFECYCLE_EVENTS).size, HOOK_LIFECYCLE_EVENTS.length);
  });
});

// ---------------------------------------------------------------------------
// loadHookDefinition — F1 model + registry
// ---------------------------------------------------------------------------

describe('loadHookDefinition: valid package', () => {
  it('parses a well-formed hook.yaml into the typed model', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'demo-hook', {
      name: 'Demo Hook',
      description: 'A demo lifecycle hook.',
      on: 'PreToolUse',
      matcher: 'Bash(gh pr create)',
      permissions: { env: ['GH_TOKEN'], read: [], network: false },
    });
    const def: HookDefinition = loadHookDefinition('demo-hook', root);
    assert.equal(def.id, 'demo-hook');
    assert.equal(def.name, 'Demo Hook');
    assert.equal(def.description, 'A demo lifecycle hook.');
    assert.equal(def.on, 'PreToolUse');
    assert.equal(def.matcher, 'Bash(gh pr create)');
    assert.equal(def.script, 'scripts/run.sh');
    assert.deepEqual(def.permissions, { env: ['GH_TOKEN'], read: [], network: false });
  });

  it('matcher is optional — absent when not declared', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'no-matcher-hook', { on: 'SessionEnd' });
    const def = loadHookDefinition('no-matcher-hook', root);
    assert.equal(def.matcher, undefined);
  });

  it('empty permissions manifest is deny-by-default (all fields empty/false), not an error', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'bare-hook', { permissions: { env: [], read: [], network: false } });
    const def = loadHookDefinition('bare-hook', root);
    assert.deepEqual(def.permissions, { env: [], read: [], network: false });
  });
});

describe('loadHookDefinition: id slug validation (reuses skill-path.ts guard)', () => {
  it('rejects a traversal-shaped id ("../escape")', () => {
    const root = makeForgeRoot();
    assert.throws(() => loadHookDefinition('../escape', root));
  });

  it('rejects an id containing a path separator ("sub/evil")', () => {
    const root = makeForgeRoot();
    assert.throws(() => loadHookDefinition('sub/evil', root));
  });

  it('rejects an absolute-path-shaped id', () => {
    const root = makeForgeRoot();
    assert.throws(() => loadHookDefinition('/etc/passwd', root));
  });

  it('rejects an id that is just "."', () => {
    const root = makeForgeRoot();
    assert.throws(() => loadHookDefinition('.', root));
  });

  it('rejects an id with uppercase or invalid characters', () => {
    const root = makeForgeRoot();
    assert.throws(() => loadHookDefinition('Not_A_Slug!', root));
  });
});

describe('loadHookDefinition: `on` — closed lifecycle-event registry', () => {
  it('accepts every member of HOOK_LIFECYCLE_EVENTS', () => {
    const root = makeForgeRoot();
    for (const [i, event] of HOOK_LIFECYCLE_EVENTS.entries()) {
      const id = `event-ok-${i}`;
      writeHookPackage(root, id, { on: event });
      assert.equal(loadHookDefinition(id, root).on, event);
    }
  });

  it('rejects an `on` value outside the closed set ("PreCommit" is not real)', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'bad-event-hook', { on: 'PreCommit' });
    assert.throws(() => loadHookDefinition('bad-event-hook', root));
  });

  it('rejects a lowercased variant of a real event ("pretooluse" — case matters)', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'bad-case-hook', { on: 'pretooluse' });
    assert.throws(() => loadHookDefinition('bad-case-hook', root));
  });
});

describe('loadHookDefinition: script must resolve INSIDE the hook dir (security AC)', () => {
  it('rejects a `../` parent-escape script path', () => {
    const root = makeForgeRoot();
    // Write a real file the traversal would land on, so the probe can't
    // accidentally pass on a benign ENOENT instead of the intended guard.
    // studio/hooks/ must exist BEFORE this write, or writeFileSync itself
    // throws ENOENT before the probe ever reaches loadHookDefinition — a
    // traversal probe that dies in its own setup proves nothing (bug found in
    // peer review, 2026-08-04).
    mkdirSync(join(root, 'studio', 'hooks'), { recursive: true });
    writeFileSync(join(root, 'studio', 'hooks', 'outside.sh'), '#!/usr/bin/env bash\necho leaked\n', 'utf8');
    writeHookPackage(root, 'traversal-hook', { script: '../outside.sh' });
    assert.throws(() => loadHookDefinition('traversal-hook', root));
  });

  it('rejects a URL-encoded traversal ("%2e%2e/outside.sh")', () => {
    const root = makeForgeRoot();
    mkdirSync(join(root, 'studio', 'hooks'), { recursive: true });
    writeFileSync(join(root, 'studio', 'hooks', 'outside.sh'), '#!/usr/bin/env bash\necho leaked\n', 'utf8');
    writeHookPackage(root, 'encoded-traversal-hook', { script: '%2e%2e/outside.sh' });
    assert.throws(() => loadHookDefinition('encoded-traversal-hook', root));
  });

  it('rejects an absolute script path', () => {
    const root = makeForgeRoot();
    const outside = join(root, 'outside-abs.sh');
    writeFileSync(outside, '#!/usr/bin/env bash\necho leaked\n', 'utf8');
    writeHookPackage(root, 'absolute-script-hook', { script: outside });
    assert.throws(() => loadHookDefinition('absolute-script-hook', root));
  });

  it('rejects a symlink inside the hook dir that resolves OUTSIDE it', () => {
    const root = makeForgeRoot();
    const dir = hookDirRaw(root, 'symlink-hook');
    const outsideTarget = join(root, 'outside-target.sh');
    writeFileSync(outsideTarget, '#!/usr/bin/env bash\necho leaked\n', 'utf8');
    const linkPath = join(dir, 'run.sh');
    symlinkSync(outsideTarget, linkPath);
    writeFileSync(
      join(dir, 'hook.yaml'),
      yaml.dump({ id: 'symlink-hook', name: 'symlink-hook', description: 'x', on: 'PreToolUse', script: 'run.sh', permissions: DEFAULT_PERMISSIONS }),
      'utf8',
    );
    assert.throws(() => loadHookDefinition('symlink-hook', root));
  });

  it('accepts a script nested in a subdirectory of the hook dir', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'nested-script-hook', { script: 'scripts/deep/run.sh' });
    const def = loadHookDefinition('nested-script-hook', root);
    assert.equal(def.script, 'scripts/deep/run.sh');
  });
});

describe('loadHookDefinition: a definition never names a binding (round-4 mockup rule, structural)', () => {
  it('FORBIDDEN_HOOK_BINDING_KEYS is non-empty and includes "agent"', () => {
    assert.ok(FORBIDDEN_HOOK_BINDING_KEYS.length > 0);
    assert.ok((FORBIDDEN_HOOK_BINDING_KEYS as readonly string[]).includes('agent'));
  });

  for (const key of ['agent', 'agents', 'boundTo', 'carriedBy', 'bind', 'composition']) {
    it(`rejects a hook.yaml declaring a top-level "${key}:" field`, () => {
      const root = makeForgeRoot();
      writeHookPackage(root, `binding-${key}`, { extra: { [key]: 'developer-ralph' } });
      assert.throws(() => loadHookDefinition(`binding-${key}`, root));
    });
  }
});

// ---------------------------------------------------------------------------
// lintHookDefinitions — turns a per-id load failure into a Finding (the
// roadmap's literal "on: outside the closed event set is a lint ERROR")
// ---------------------------------------------------------------------------

describe('lintHookDefinitions', () => {
  it('reports zero findings for an all-valid hooks directory', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'ok-one', {});
    writeHookPackage(root, 'ok-two', { on: 'SessionEnd' });
    assert.deepEqual(lintHookDefinitions(root), []);
  });

  it('reports exactly one error Finding for a bad `on` value, naming the hook', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'good-hook', {});
    writeHookPackage(root, 'bad-on-hook', { on: 'NotARealEvent' });
    const findings = lintHookDefinitions(root);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.level, 'error');
    assert.equal(findings[0]!.object, 'hook:bad-on-hook');
  });
});

// ---------------------------------------------------------------------------
// listHookLibrary: a malformed entry carries NO INVENTED field values
// (2026-08-04 peer-review JOB 5b — the R3-01 fabrication-shape lesson: a
// plausible-looking value the file never contained, e.g. R3-01's invented
// `usedBy: []` for an id with none, is worse than an honest absence).
//
// SHAPE CHOSEN (mine to pick, documented per the T3 contract — implementer's
// one target): `HookLibraryEntry` becomes a DISCRIMINATED UNION on `ok`:
//   - `{ ok: true } & HookDefinition & { carriedBy, carriedByDerivation }`
//     for a successfully-loaded hook — every field is REAL, read off disk.
//   - `{ ok: false; id; carriedBy; carriedByDerivation; error }` for a
//     malformed one — structurally NO `on`/`script`/`permissions`/`name`/
//     `description` key exists on this branch at all, so a consumer cannot
//     accidentally read a fabricated value even by mistake; TypeScript's own
//     narrowing forces a check of `ok` before touching hook-shaped fields.
// Rejected alternative: an optional `error?: string` bolted onto the full
// shape (mirrors SkillLibraryEntry.error) — that is the EXACT shape that
// currently permits fabrication (nothing stops the malformed branch from
// still populating `on`/`script`/permissions with placeholders alongside
// `error`), so it does not close the defect class, only documents it.
// ---------------------------------------------------------------------------

describe('listHookLibrary: a malformed entry carries no fabricated field values', () => {
  it('a malformed hook.yaml (bad `on`) yields ok:false with NO on/script/permissions/name/description keys — not fabricated placeholders', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'malformed-hook', { on: 'NotARealEvent' });

    const entries = listHookLibrary(root);
    const entry = entries.find((e) => e.id === 'malformed-hook');
    assert.ok(entry, 'a malformed hook must still be LISTED (never silently dropped, AT-7 precedent) — just not fabricated');

    // The structural assertion: on:'PreToolUse' must never appear as a
    // GUESSED value for an entry whose real `on:` was invalid. Checking
    // `'ok' in entry && entry.ok === false` first (discriminated-union
    // narrowing) — then NONE of the hook-shaped keys may be present at all.
    assert.equal((entry as unknown as { ok: boolean }).ok, false, 'a malformed entry must be discriminated ok:false, not merely carry an error alongside fabricated data');
    assert.equal('error' in entry && typeof (entry as unknown as { error: unknown }).error === 'string', true, 'the failure reason must still be surfaced');
    for (const forbiddenKey of ['on', 'script', 'permissions', 'name', 'description']) {
      assert.equal(
        forbiddenKey in entry,
        false,
        `a malformed entry must not carry a "${forbiddenKey}" key at all — a placeholder value here (e.g. on:'PreToolUse') is a fabrication the file never actually contained`,
      );
    }
  });

  it('a well-formed hook yields ok:true with every real HookDefinition field populated from disk', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'well-formed-hook', { on: 'SessionEnd', matcher: 'Bash(gh pr create)' });

    const entries = listHookLibrary(root);
    const entry = entries.find((e) => e.id === 'well-formed-hook');
    assert.ok(entry);
    assert.equal((entry as unknown as { ok: boolean }).ok, true);
    assert.equal('error' in entry, false, 'a well-formed entry must not carry an error key at all');
    assert.equal((entry as unknown as { on: string }).on, 'SessionEnd', 'real, disk-read value — not a placeholder');
    assert.equal((entry as unknown as { matcher: string }).matcher, 'Bash(gh pr create)');
  });
});

// ---------------------------------------------------------------------------
// carriedBy — DERIVED from real agent specs, never declared (D3 precedent,
// R3-06). An empty carriedBy must read as "scanned N, found none", never as
// "unknown, rendered empty".
// ---------------------------------------------------------------------------

describe('carriedBy: derived, self-naming (R3-06 D3 precedent)', () => {
  it('a hook composed by no agent still names WHAT it scanned and HOW MANY', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'orphan-hook', {});
    writeAgentSkillMd(root, 'unrelated-agent', { hooks: [] });
    const entries = listHookLibrary(root);
    const orphan = entries.find((e: HookLibraryEntry) => e.id === 'orphan-hook');
    assert.ok(orphan, 'orphan-hook must be listed');
    assert.deepEqual(orphan!.carriedBy, []);
    assert.ok(orphan!.carriedByDerivation, 'an empty carriedBy must still carry a derivation descriptor');
    assert.equal(orphan!.carriedByDerivation.scanned, 1, 'must name how many agent specs were scanned');
    assert.ok(orphan!.carriedByDerivation.source.length > 0, 'must name WHAT was scanned');
  });

  it('a hook composed by one real agent is carried by exactly that agent slug', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'carried-hook', {});
    writeAgentSkillMd(root, 'carrier-agent', { hooks: ['carried-hook'] });
    writeAgentSkillMd(root, 'bystander-agent', { hooks: [] });
    const entries = listHookLibrary(root);
    const carried = entries.find((e: HookLibraryEntry) => e.id === 'carried-hook');
    assert.deepEqual(carried!.carriedBy, ['carrier-agent']);
    assert.equal(carried!.carriedByDerivation.scanned, 2);
  });

  it('deriveHookUsage(forgeRoot) exposes the same fact as a standalone Map', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'map-hook', {});
    writeAgentSkillMd(root, 'map-carrier', { hooks: ['map-hook'] });
    const usage = deriveHookUsage(root);
    assert.deepEqual(usage.get('map-hook'), ['map-carrier']);
  });

  it('carriedBy is sorted and de-duplicated across multiple carrying agents', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'shared-hook', {});
    writeAgentSkillMd(root, 'z-agent', { hooks: ['shared-hook'] });
    writeAgentSkillMd(root, 'a-agent', { hooks: ['shared-hook'] });
    const entries = listHookLibrary(root);
    const shared = entries.find((e: HookLibraryEntry) => e.id === 'shared-hook');
    assert.deepEqual(shared!.carriedBy, ['a-agent', 'z-agent']);
  });
});

// ---------------------------------------------------------------------------
// OOTB seed hooks — pinned against the REAL repo (REPO_ROOT), mirroring
// template-library.test.ts's "the real repo for facts" convention. RED for
// two independent reasons: hook-library.ts does not exist, AND (once it
// does) studio/hooks/pre-pr-security-review and studio/hooks/post-merge-
// brain-ingest do not exist either — the roadmap's re-scope explicitly says
// these two OOTB seeds ship WITH F1 (mockups/studio-endstate-v2/data.jsx's
// HOOKS_LOCAL, provenance: OOTB).
// ---------------------------------------------------------------------------

describe('OOTB seed hooks (mockup data.jsx HOOKS_LOCAL, provenance: OOTB)', () => {
  it('pre-pr-security-review ships with the mockup-pinned event + matcher', () => {
    const entries = listHookLibrary(REPO_ROOT);
    const entry = entries.find((e: HookLibraryEntry) => e.id === 'pre-pr-security-review');
    assert.ok(entry, 'pre-pr-security-review must be a shipped OOTB library hook');
    assert.equal(entry!.on, 'PreToolUse');
    assert.equal(entry!.matcher, 'Bash(gh pr create)');
    assert.equal(typeof entry!.permissions, 'object');
    assert.ok(Array.isArray(entry!.permissions.env));
    assert.ok(Array.isArray(entry!.permissions.read));
    assert.equal(typeof entry!.permissions.network, 'boolean');
  });

  it('post-merge-brain-ingest ships with the mockup-pinned event', () => {
    const entries = listHookLibrary(REPO_ROOT);
    const entry = entries.find((e: HookLibraryEntry) => e.id === 'post-merge-brain-ingest');
    assert.ok(entry, 'post-merge-brain-ingest must be a shipped OOTB library hook');
    assert.equal(entry!.on, 'SessionEnd');
  });

  it('exactly these two OOTB seeds exist under studio/hooks/ at this stage of the roadmap', () => {
    assert.deepEqual([...listHookIds(REPO_ROOT)].sort(), ['post-merge-brain-ingest', 'pre-pr-security-review']);
  });
});

// ---------------------------------------------------------------------------
// PLATFORM_GUARD_IDS / studio/catalog.yaml guards: id-set PARITY
// (2026-08-04 peer-review JOB 5a). `lintHookComposition` sources its "is this
// id platform machinery" ground truth from `PLATFORM_GUARD_IDS`
// (orchestrator/agent-bands.ts) — a fixed constant, deliberately NOT
// re-derived from studio/catalog.yaml (catalog.yaml is a display surface, a
// lint fixture root may not seed one at all). Ratified: that choice is
// correct. But two representations that must agree, with nothing checking
// it, is exactly how they drift — a guard added to the catalog (for display)
// without also being added to PLATFORM_GUARD_IDS would be invisible to this
// lint; the reverse drift (added to the constant, forgotten in the catalog)
// would silently stop showing an operator that guard in the palette. Mirrors
// R3-06's flow-artifact-catalog parity device
// (template-library.test.ts's AT-10 "real repo lints clean" pattern) —
// pinned bidirectionally here, against the REAL repo (REPO_ROOT), not a
// fixture, since a fixture parity check could never catch real drift.
// ---------------------------------------------------------------------------

describe('PLATFORM_GUARD_IDS / studio/catalog.yaml guards: id-set parity (bidirectional)', () => {
  it('every PLATFORM_GUARD_IDS entry has a matching studio/catalog.yaml guards: row', () => {
    const catalog = loadCatalog(join(REPO_ROOT, 'studio', 'catalog.yaml'));
    const catalogIds = new Set(catalog.guards.map((g) => g.id));
    const missingFromCatalog = PLATFORM_GUARD_IDS.filter((id) => !catalogIds.has(id));
    assert.deepEqual(
      missingFromCatalog,
      [],
      `PLATFORM_GUARD_IDS entries with no studio/catalog.yaml guards: row (would be invisible to the palette): ${JSON.stringify(missingFromCatalog)}`,
    );
  });

  it('every studio/catalog.yaml guards: row has a matching PLATFORM_GUARD_IDS entry', () => {
    const catalog = loadCatalog(join(REPO_ROOT, 'studio', 'catalog.yaml'));
    const platformIds = new Set<string>(PLATFORM_GUARD_IDS);
    const missingFromConstant = catalog.guards.map((g) => g.id).filter((id) => !platformIds.has(id));
    assert.deepEqual(
      missingFromConstant,
      [],
      `studio/catalog.yaml guards: rows with no PLATFORM_GUARD_IDS entry (invisible to lintHookComposition's guard-in-hooks/hook-in-guards checks): ${JSON.stringify(missingFromConstant)}`,
    );
  });

  // R4-18 mechanical amendment (2026-08-10): a 5th band, 'onboard-preflight',
  // joins the vocabulary — both sides now count 10, not 9. RED until R4-18's
  // production change lands (see orchestrator/onboard-flow-gate.test.ts AT-2).
  it('sanity: both sides are exactly the known ten ids (catches a silent count-only false pass)', () => {
    assert.strictEqual(PLATFORM_GUARD_IDS.length, 10);
    const catalog = loadCatalog(join(REPO_ROOT, 'studio', 'catalog.yaml'));
    assert.strictEqual(catalog.guards.length, 10);
  });
});

// ---------------------------------------------------------------------------
// F1b — composition.hooks REINTRODUCED at the registry layer
// ---------------------------------------------------------------------------

describe('composition.hooks reintroduced (registry.ts loadAgentDefinition)', () => {
  it('a SKILL.md declaring composition.hooks no longer throws the "retired" error', () => {
    const root = makeForgeRoot();
    const p = writeAgentSkillMd(root, 'hook-composer', { hooks: ['pre-pr-security-review'] });
    assert.doesNotThrow(() => loadAgentDefinition(p));
  });

  it('the parsed composition.hooks array round-trips (cast documented in D-E)', () => {
    const root = makeForgeRoot();
    const p = writeAgentSkillMd(root, 'hook-composer-2', { hooks: ['pre-pr-security-review', 'post-merge-brain-ingest'] });
    const def = loadAgentDefinition(p);
    const hooks = (def.composition as unknown as { hooks: string[] }).hooks;
    assert.deepEqual(hooks, ['pre-pr-security-review', 'post-merge-brain-ingest']);
  });

  it('composition.hooks absent parses as an empty array, not undefined', () => {
    const root = makeForgeRoot();
    const p = writeAgentSkillMd(root, 'no-hooks-agent', {});
    const def = loadAgentDefinition(p);
    const hooks = (def.composition as unknown as { hooks?: string[] }).hooks;
    assert.deepEqual(hooks ?? [], []);
  });
});

// ---------------------------------------------------------------------------
// F1b — SYMMETRIC enforcement (lintHookComposition). Both directions.
// ---------------------------------------------------------------------------

describe('lintHookComposition: guard id under composition.hooks is an ERROR', () => {
  // R4-18 mechanical amendment (2026-08-10): 'onboard-preflight' joins the
  // sweep — RED until PLATFORM_GUARD_IDS (which lintHookComposition reads
  // from) picks it up, since this loop must cover every legacy value.
  for (const guardId of ['event-log', 'cost-guard', 'stall-watchdog', 'merge-gate', 'scratch-strip', 'wi-contract', 'reflection-close', 'demo-band', 'review-band', 'onboard-preflight']) {
    it(`"${guardId}" under composition.hooks is flagged`, () => {
      const root = makeForgeRoot();
      writeAgentSkillMd(root, `agent-with-${guardId}-as-hook`, { hooks: [guardId] });
      const findings = lintHookComposition(root);
      const hit = findings.find((f: Finding) => f.object === `agent:agent-with-${guardId}-as-hook` && f.check === 'hook-library/guard-in-hooks');
      assert.ok(hit, `expected a hook-library/guard-in-hooks finding for guard id "${guardId}"`);
      assert.equal(hit!.level, 'error');
    });
  }
});

describe('lintHookComposition: library hook id under composition.guards is an ERROR (the direction the previous PR could not test)', () => {
  it('a real library hook id ("pre-pr-security-review") under composition.guards is flagged', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'pre-pr-security-review', { on: 'PreToolUse', matcher: 'Bash(gh pr create)' });
    writeAgentSkillMd(root, 'agent-with-hook-as-guard', { guards: ['pre-pr-security-review'] });
    const findings = lintHookComposition(root);
    const hit = findings.find((f: Finding) => f.object === 'agent:agent-with-hook-as-guard' && f.check === 'hook-library/hook-in-guards');
    assert.ok(hit, 'expected a hook-library/hook-in-guards finding');
    assert.equal(hit!.level, 'error');
  });
});

describe('lintHookComposition: the correct placement in each field produces no findings', () => {
  it('a real guard under composition.guards + a real hook under composition.hooks: clean', () => {
    const root = makeForgeRoot();
    writeHookPackage(root, 'clean-hook', {});
    writeAgentSkillMd(root, 'well-formed-agent', { guards: ['event-log'], hooks: ['clean-hook'] });
    const findings = lintHookComposition(root).filter((f: Finding) => f.object === 'agent:well-formed-agent');
    assert.deepEqual(findings, []);
  });

  it('an unknown id under composition.hooks (neither a guard nor a real hook) is a distinct error', () => {
    const root = makeForgeRoot();
    writeAgentSkillMd(root, 'agent-with-typo-hook', { hooks: ['totally-made-up-hook-id'] });
    const findings = lintHookComposition(root);
    const hit = findings.find((f: Finding) => f.object === 'agent:agent-with-typo-hook' && f.check === 'hook-library/unknown-hook-ref');
    assert.ok(hit, 'expected an unknown-hook-ref finding, distinct from guard-in-hooks');
  });
});

// ---------------------------------------------------------------------------
// The dispatch-hijack case, explicitly (the whole point of this round): a
// library hook whose id collides with a band id must NOT reach
// resolveBandGuard. Dispatch is unaffected by anything in composition.hooks.
// ---------------------------------------------------------------------------

describe('dispatch-hijack proof: resolveBandGuard reads ONLY composition.guards', () => {
  it('a colliding id ("wi-contract") sitting in composition.hooks does not resolve a band', () => {
    const base = makeAgentDef('innocent-agent', []); // no band declared in guards
    // D-E: widen with `hooks` via `as unknown as`, documented in the file
    // header — `AgentComposition` does not carry `hooks` on the type yet.
    const hijacked = {
      ...base,
      composition: { ...base.composition, hooks: ['wi-contract'] },
    } as unknown as AgentDefinition;
    assert.equal(resolveBandGuard(hijacked), undefined, 'composition.hooks must never influence band dispatch');
  });

  it('the SAME agent WITH the id correctly placed in composition.guards DOES resolve the band', () => {
    const legit = makeAgentDef('project-manager', ['wi-contract']);
    assert.equal(resolveBandGuard(legit), 'wi-contract');
  });

  it('composition.hooks containing every band id simultaneously still resolves nothing', () => {
    const base = makeAgentDef('another-innocent-agent', []);
    const hijacked = {
      ...base,
      composition: { ...base.composition, hooks: ['wi-contract', 'reflection-close', 'demo-band', 'review-band'] },
    } as unknown as AgentDefinition;
    assert.equal(resolveBandGuard(hijacked), undefined);
  });
});

// ---------------------------------------------------------------------------
// hooksDir / hookDir / hookYamlPath — path plumbing sanity (mirrors
// skill-path.ts's own directly-tested helpers)
// ---------------------------------------------------------------------------

describe('path helpers', () => {
  it('hookDir/hookYamlPath compose the expected studio/hooks/<id>/ layout', () => {
    const root = makeForgeRoot();
    assert.equal(hookDir('my-hook', root), join(root, 'studio', 'hooks', 'my-hook'));
    assert.equal(hookYamlPath('my-hook', root), join(root, 'studio', 'hooks', 'my-hook', 'hook.yaml'));
    assert.equal(hooksDir(root), join(root, 'studio', 'hooks'));
  });

  it('hookDir slug-validates before ever touching a path (traversal cannot even construct a path)', () => {
    const root = makeForgeRoot();
    assert.throws(() => hookDir('../evil', root));
  });
});
