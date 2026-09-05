/**
 * Tests for `library-validate.ts` — the Catalog / Template / Instruction-seed /
 * library-flag rules. The validators moved here in the M4 library-by-kind carve
 * but their tests stayed behind in `apps/forge/validate.test.ts`; ruling 159's
 * retirement of `orchestrator/studio/validate.ts` brings them home unchanged.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Catalog, InstructionSeed } from '@forge/contracts/studio/types.ts';
import {
  validateArtifactTemplate,
  validateCatalog,
  validateInstructionSeed,
  validateLibraryFlag,
} from './library-validate.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCatalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: [{ id: 'Read', name: 'Read' }],
    mcps: [],
    guards: [{ id: 'event-log', name: 'Event Log', kind: 'toggle' }],
    path: '/studio/catalog.yaml',
    ...overrides,
  };
}


// ---------------------------------------------------------------------------
// validateLibraryFlag (R3-01-F2)
// ---------------------------------------------------------------------------

describe('validateLibraryFlag', () => {
  it('unset (key absent) → error', () => {
    const findings = validateLibraryFlag('my-agent', { name: 'my-agent' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].level, 'error');
    assert.equal(findings[0].object, 'agent:my-agent');
    assert.equal(findings[0].check, 'library');
  });

  it('non-boolean value → error', () => {
    const findings = validateLibraryFlag('my-agent', { library: 'true' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].level, 'error');
  });

  it('explicit true → clean', () => {
    assert.deepEqual(validateLibraryFlag('my-agent', { library: true }), []);
  });

  it('explicit false → clean', () => {
    assert.deepEqual(validateLibraryFlag('my-agent', { library: false }), []);
  });

  it('null/non-object frontmatter → error, no throw', () => {
    assert.equal(validateLibraryFlag('my-agent', null).length, 1);
    assert.equal(validateLibraryFlag('my-agent', undefined).length, 1);
  });
});

// ---------------------------------------------------------------------------
// validateCatalog
// ---------------------------------------------------------------------------

describe('validateArtifactTemplate', () => {
  const base = { id: 'plan', name: 'Plan', kind: 'file' as const, schema: {}, body: '', path: '/x/plan.md' };

  it('bad slug id → error slug', () => {
    assert.ok(validateArtifactTemplate({ ...base, id: 'Bad Id' }).some((f) => f.check === 'slug'));
  });

  it('bad producer slug → error producer/slug', () => {
    assert.ok(validateArtifactTemplate({ ...base, producer: 'Bad Slug' }).some((f) => f.check === 'producer/slug'));
  });

  it('valid template → no findings', () => {
    assert.deepEqual(
      validateArtifactTemplate({ ...base, producer: 'architect', consumer: 'project-manager' }),
      [],
    );
  });
});

describe('validateCatalog — model-sdk', () => {
  it('model with sdk not among declared sdk ids → error model-sdk', () => {
    const catalog = makeCatalog({
      models: [
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet', sdk: 'nope', tier: 'sonnet' },
      ],
    });
    const findings = validateCatalog(catalog);
    const f = findings.find((x) => x.check === 'model-sdk');
    assert.ok(f, 'expected model-sdk finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('nope') && f.message.includes('claude-sonnet-4-6'));
  });

  it('model with valid sdk → no model-sdk finding', () => {
    const findings = validateCatalog(makeCatalog());
    assert.ok(!findings.some((x) => x.check === 'model-sdk'));
  });
});

describe('validateCatalog — unique-ids', () => {
  it('duplicate model ids → error unique-ids', () => {
    const catalog = makeCatalog({
      models: [
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet', sdk: 'claude', tier: 'sonnet' },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet Dup', sdk: 'claude', tier: 'sonnet' },
      ],
    });
    const findings = validateCatalog(catalog);
    const f = findings.find((x) => x.check === 'unique-ids');
    assert.ok(f, 'expected unique-ids finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('claude-sonnet-4-6'));
  });

  it('duplicate sdk ids → error unique-ids', () => {
    const catalog = makeCatalog({
      sdks: [
        { id: 'claude', name: 'Claude', available: true },
        { id: 'claude', name: 'Claude Dup', available: false },
      ],
    });
    const findings = validateCatalog(catalog);
    const f = findings.find((x) => x.check === 'unique-ids');
    assert.ok(f, 'expected unique-ids finding');
    assert.equal(f.level, 'error');
  });

  it('duplicate guard ids → error unique-ids', () => {
    const catalog = makeCatalog({
      guards: [
        { id: 'event-log', name: 'Event Log', kind: 'toggle' },
        { id: 'event-log', name: 'Event Log Dup', kind: 'toggle' },
      ],
    });
    const findings = validateCatalog(catalog);
    const f = findings.find((x) => x.check === 'unique-ids');
    assert.ok(f, 'expected unique-ids finding');
    assert.equal(f.level, 'error');
  });

  it('clean catalog → no findings', () => {
    const findings = validateCatalog(makeCatalog());
    assert.deepEqual(findings, []);
  });
});

// ---------------------------------------------------------------------------
// validateDiscoveredProjects
// ---------------------------------------------------------------------------

// validateCatalog — community-skills tests REMOVED (W6-CR-1 reviewer fix):
// catalog.yaml's `community-skills:` section and `Catalog.communitySkills`
// are both gone (moved to studio/community/registry.yaml — see
// validateCommunityRegistry's own tests, apps/forge/studio-lint-community-registry.test.ts
// + this file's registry.ts coverage). These tests exercised a shape
// `loadCatalog` can no longer produce.


// ---------------------------------------------------------------------------
// validateInstructionSeed (R3-05-F1)
// ---------------------------------------------------------------------------

function mkSeed(overrides: Partial<InstructionSeed> = {}): InstructionSeed {
  return {
    id: 'ts-node',
    title: 'TypeScript conventions',
    kind: 'language',
    appliesTo: ['typescript'],
    scope: 'project',
    provenance: 'forge CLAUDE.md',
    body: 'Use tsc --noEmit.',
    path: '/studio/instruction-seeds/ts-node.md',
    ...overrides,
  };
}

describe('validateInstructionSeed (R3-05)', () => {
  it('a well-formed seed produces no findings', () => {
    assert.deepEqual(validateInstructionSeed(mkSeed()), []);
  });

  it('a non-slug id → error', () => {
    const f = validateInstructionSeed(mkSeed({ id: 'Bad Id' }));
    assert.ok(f.some((x) => x.check === 'slug'));
  });

  it('empty appliesTo → error (can never match a project)', () => {
    const f = validateInstructionSeed(mkSeed({ appliesTo: [] }));
    assert.ok(f.some((x) => x.check === 'applies-to'));
  });

  it('a non-slug appliesTo tag → error', () => {
    const f = validateInstructionSeed(mkSeed({ appliesTo: ['type script'] }));
    assert.ok(f.some((x) => x.check === 'applies-to/slug'));
  });

  it('blank provenance → error (corpus-grounding: no hand-invented practices)', () => {
    const f = validateInstructionSeed(mkSeed({ provenance: '   ' }));
    assert.ok(f.some((x) => x.check === 'provenance'));
  });

  it('empty body → error', () => {
    const f = validateInstructionSeed(mkSeed({ body: '' }));
    assert.ok(f.some((x) => x.check === 'body'));
  });

  it('blank title → error', () => {
    const f = validateInstructionSeed(mkSeed({ title: '  ' }));
    assert.ok(f.some((x) => x.check === 'title'));
  });
});
