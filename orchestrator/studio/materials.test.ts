/**
 * Tests for orchestrator/studio/materials.ts (R2-09 "Agent-builder definition
 * parity", design points D1-D3).
 *
 * NEW MODULE — does not exist yet. Exports under test:
 *   - MATERIAL_KINDS: the closed, frozen vocabulary ['images','documents','audio','data-files']
 *   - parseMaterials(raw): string[] | undefined — lenient on VALUES, strict on SHAPE
 *   - agentAcceptsMaterial(def, kind): boolean — fail-closed capability gate
 *
 * D1: materials is parsed leniently as free strings; an unknown VALUE is a
 * lint concern (materials/enum in validate.ts), never a load-time throw. A
 * SHAPE error (non-array, or a non-string entry) DOES throw at load — this
 * mirrors the `composition` (shape, throws) vs `surface` (value, lints) split
 * already established in registry.ts/validate.ts.
 * D2: `materials` absent and `materials: []` both mean "accepts nothing" —
 * there is no "undeclared ⇒ allow all" arm.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MATERIAL_KINDS, parseMaterials, agentAcceptsMaterial } from './materials.ts';
import type { AgentDefinition } from './types.ts';

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function fixtureDef(materials?: string[]): AgentDefinition {
  return {
    slug: 'fixture-agent',
    name: 'Fixture Agent',
    description: 'A fixture agent for materials tests.',
    purpose: 'Testing materials gating.',
    composition: { skills: [], tools: [], mcps: [], guards: [], hooks: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: '# Fixture\n',
    path: '/fixture/skills/fixture-agent/SKILL.md',
    ...(materials !== undefined ? { materials } : {}),
  } as AgentDefinition;
}

// ---------------------------------------------------------------------------
// MATERIAL_KINDS
// ---------------------------------------------------------------------------

describe('MATERIAL_KINDS', () => {
  it('is exactly [images, documents, audio, data-files] in that order', () => {
    assert.deepEqual(MATERIAL_KINDS, ['images', 'documents', 'audio', 'data-files']);
  });

  it('is frozen — pushing onto it throws and leaves the vocabulary unchanged', () => {
    assert.ok(Object.isFrozen(MATERIAL_KINDS), 'MATERIAL_KINDS must be Object.freeze()d');
    const before = [...MATERIAL_KINDS];
    assert.throws(() => {
      (MATERIAL_KINDS as unknown as string[]).push('holograms');
    });
    assert.deepEqual(MATERIAL_KINDS, before, 'a mutation attempt must not change the vocabulary');
  });

  it('is frozen — reassigning an index throws and leaves the vocabulary unchanged', () => {
    assert.throws(() => {
      (MATERIAL_KINDS as unknown as string[])[0] = 'mutated';
    });
    assert.equal(MATERIAL_KINDS[0], 'images');
  });
});

// ---------------------------------------------------------------------------
// parseMaterials
// ---------------------------------------------------------------------------

describe('parseMaterials', () => {
  it('undefined → undefined ("not declared", distinct from empty)', () => {
    assert.equal(parseMaterials(undefined), undefined);
  });

  it('[] → []', () => {
    assert.deepEqual(parseMaterials([]), []);
  });

  it('[images, documents] → same values, order preserved', () => {
    assert.deepEqual(parseMaterials(['images', 'documents']), ['images', 'documents']);
  });

  it('an unknown value survives (lenient) — lint rejects it, load does not', () => {
    assert.deepEqual(parseMaterials(['holograms']), ['holograms']);
  });

  it('a bare string (wrong SHAPE, not an array) throws, message names the field', () => {
    assert.throws(() => parseMaterials('images' as unknown as unknown[]), /materials/);
  });

  it('a non-string entry (wrong SHAPE) throws', () => {
    assert.throws(() => parseMaterials([1, 'images'] as unknown as unknown[]));
  });
});

// ---------------------------------------------------------------------------
// agentAcceptsMaterial
// ---------------------------------------------------------------------------

describe('agentAcceptsMaterial', () => {
  it('false when materials is undefined (D2: no "undeclared ⇒ allow all" arm)', () => {
    assert.equal(agentAcceptsMaterial(fixtureDef(undefined), 'images'), false);
  });

  it('false when materials is [] (D2: declared-empty also means "accepts nothing")', () => {
    assert.equal(agentAcceptsMaterial(fixtureDef([]), 'images'), false);
  });

  it('true for a declared kind, false for an undeclared-but-valid kind', () => {
    const def = fixtureDef(['images']);
    assert.equal(agentAcceptsMaterial(def, 'images'), true);
    assert.equal(agentAcceptsMaterial(def, 'documents'), false);
  });

  it('fail-closed: a value that slipped past lint (not in MATERIAL_KINDS) never grants acceptance, even though it is declared', () => {
    const def = fixtureDef(['holograms']);
    assert.equal(
      agentAcceptsMaterial(def, 'holograms'),
      false,
      'the gate must answer from VOCABULARY ∩ DECLARATION, never from the declaration alone',
    );
  });

  it('case-sensitive: "Images" is not accepted even though "images" is declared', () => {
    const def = fixtureDef(['images']);
    assert.equal(agentAcceptsMaterial(def, 'Images'), false);
  });
});

// ---------------------------------------------------------------------------
// agentAcceptsMaterial — fail-CLOSED on a malformed def.materials (2026-08-05
// adversarial-review round 2, finding A). `loadAgentDefinition` always hands
// back either `undefined` or a real `string[]` — but this gate is reachable
// from ANY hand-built `AgentDefinition`, and JS does not enforce the type at
// runtime. The bug: `def.materials.includes(kind)` — when `materials` is a
// bare STRING, `.includes` resolves to `String.prototype.includes`, which
// SUBSTRING-matches. `materials: 'no-images-allowed'` + kind `'images'`
// currently returns `true` (a real fail-open, not just a crash) because the
// substring "images" is present in the string. Every non-array shape must
// return `false` — never substring-match, never throw.
// ---------------------------------------------------------------------------

describe('agentAcceptsMaterial — fail-closed on a malformed (non-array) def.materials', () => {
  it('a bare string that literally IS the kind name never grants acceptance (no accidental match)', () => {
    const def = { ...fixtureDef(undefined), materials: 'images' } as unknown as AgentDefinition;
    assert.equal(agentAcceptsMaterial(def, 'images'), false);
  });

  it('a bare string that merely CONTAINS the kind as a substring must not fail open via String.prototype.includes', () => {
    const def1 = { ...fixtureDef(undefined), materials: 'no-images-allowed' } as unknown as AgentDefinition;
    assert.equal(
      agentAcceptsMaterial(def1, 'images'),
      false,
      'String.prototype.includes substring-matches "images" inside "no-images-allowed" — this is the exact fail-open bug',
    );
    const def2 = { ...fixtureDef(undefined), materials: 'documents-and-audio' } as unknown as AgentDefinition;
    assert.equal(agentAcceptsMaterial(def2, 'audio'), false);
  });

  it('materials: null → false, never throws', () => {
    const def = { ...fixtureDef(undefined), materials: null } as unknown as AgentDefinition;
    assert.equal(agentAcceptsMaterial(def, 'images'), false);
  });

  it('materials: {} (plain object) → false, never throws', () => {
    const def = { ...fixtureDef(undefined), materials: {} } as unknown as AgentDefinition;
    assert.equal(agentAcceptsMaterial(def, 'images'), false);
  });

  it('materials: a Set → false, never throws (Set has no .includes)', () => {
    const def = { ...fixtureDef(undefined), materials: new Set(['images']) } as unknown as AgentDefinition;
    assert.equal(agentAcceptsMaterial(def, 'images'), false);
  });

  it('materials: a bare number → false, never throws', () => {
    const def = { ...fixtureDef(undefined), materials: 42 } as unknown as AgentDefinition;
    assert.equal(agentAcceptsMaterial(def, 'images'), false);
  });

  it('materials: an array-LIKE object ({0:"images",length:1}, not a real Array) → false, never throws', () => {
    const def = { ...fixtureDef(undefined), materials: { 0: 'images', length: 1 } } as unknown as AgentDefinition;
    assert.equal(agentAcceptsMaterial(def, 'images'), false);
  });

  it('def itself is null → false, never throws', () => {
    assert.equal(agentAcceptsMaterial(null as unknown as AgentDefinition, 'images'), false);
  });

  it('def itself is undefined → false, never throws', () => {
    assert.equal(agentAcceptsMaterial(undefined as unknown as AgentDefinition, 'images'), false);
  });
});
