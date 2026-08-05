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
