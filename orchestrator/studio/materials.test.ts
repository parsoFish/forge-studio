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

import {
  MATERIAL_KINDS,
  parseMaterials,
  agentAcceptsMaterial,
  materialKindForFilename,
  MAX_MATERIALS_COUNT,
  MAX_MATERIAL_BYTES,
  MAX_MATERIALS_TOTAL_BYTES,
} from './materials.ts';
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

// ---------------------------------------------------------------------------
// materialKindForFilename + the materials caps (R6-04-F2, WI-1 — "materials
// contract enforcement + guarded staging", the agent-kickoff upload seam).
//
// NEW exports — none of these exist at HEAD, so importing them is itself
// part of this file's RED proof (a genuine "feature not implemented yet"
// red — a `node --test` module-resolution failure on the import line above,
// not a missing npm dependency).
//
// Route-level ACCEPTANCE tests (the shape/gate/cap/base64/duplicate/success
// contract, the client-supplied-`kind`-must-not-be-trusted proof, and every
// containment escape shape) live in
// cli/ui-bridge-agent-run-materials.test.ts — THIS file only pins the pure
// vocabulary: the extension→kind derivation function and the three named cap
// constants, at the unit level.
// ---------------------------------------------------------------------------

describe('materialKindForFilename — server-side extension→kind derivation (R6-04-F2 contract point 4)', () => {
  // These three extensions are pinned to a SPECIFIC kind because there is no
  // plausible alternate classification among the four MATERIAL_KINDS for any
  // of them — a PNG cannot reasonably be "audio" or "documents", an MP3
  // cannot reasonably be "images" or "data-files", a PDF cannot reasonably be
  // "audio" or "images". Deliberately NOT pinned here: any 'data-files'
  // extension (.csv/.json/.parquet/.xlsx/...) — every candidate has a
  // plausible alternate classification an implementer could reasonably
  // choose (e.g. .csv as 'documents'), and the WI does not specify an
  // extension table, so hardcoding one risks failing a compliant
  // implementation that simply chose a different (but reasonable) mapping.
  it('an unambiguous image extension (.png) derives "images"', () => {
    assert.equal(materialKindForFilename('photo.png'), 'images');
  });

  it('an unambiguous audio extension (.mp3) derives "audio"', () => {
    assert.equal(materialKindForFilename('track.mp3'), 'audio');
  });

  it('an unambiguous document extension (.pdf) derives "documents"', () => {
    assert.equal(materialKindForFilename('report.pdf'), 'documents');
  });

  it('an unrecognized extension (.exe) derives undefined, never a fabricated kind', () => {
    assert.equal(materialKindForFilename('payload.exe'), undefined);
  });

  it('no extension at all derives undefined', () => {
    assert.equal(materialKindForFilename('README'), undefined);
  });

  it('a bare dot with nothing after it derives undefined, not a crash', () => {
    assert.equal(materialKindForFilename('trailing.'), undefined);
  });

  it('every derivable result is a genuine member of MATERIAL_KINDS — kills an implementation that returns the raw extension string (or any other non-vocabulary value) instead of a proper MaterialKind', () => {
    const candidates = [
      'a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp',
      'a.mp3', 'a.wav', 'a.m4a', 'a.ogg',
      'a.pdf', 'a.docx', 'a.txt', 'a.md',
      'a.csv', 'a.json', 'a.parquet', 'a.xlsx',
      'a.zip', 'a.exe', 'a.dll', 'noext',
    ];
    for (const filename of candidates) {
      const kind = materialKindForFilename(filename);
      assert.ok(
        kind === undefined || (MATERIAL_KINDS as readonly string[]).includes(kind),
        `materialKindForFilename(${JSON.stringify(filename)}) returned ${JSON.stringify(kind)} — neither undefined nor a member of MATERIAL_KINDS`,
      );
    }
  });
});

describe('materials caps — named constants exported from materials.ts (R6-04-F2 contract point 6)', () => {
  it('MAX_MATERIALS_COUNT is a positive integer', () => {
    assert.equal(Number.isInteger(MAX_MATERIALS_COUNT), true, `MAX_MATERIALS_COUNT must be an integer, got ${MAX_MATERIALS_COUNT}`);
    assert.ok(MAX_MATERIALS_COUNT > 0, 'MAX_MATERIALS_COUNT must be positive');
  });

  it('MAX_MATERIAL_BYTES is a positive integer', () => {
    assert.equal(Number.isInteger(MAX_MATERIAL_BYTES), true, `MAX_MATERIAL_BYTES must be an integer, got ${MAX_MATERIAL_BYTES}`);
    assert.ok(MAX_MATERIAL_BYTES > 0, 'MAX_MATERIAL_BYTES must be positive');
  });

  it('MAX_MATERIALS_TOTAL_BYTES is a positive integer', () => {
    assert.equal(Number.isInteger(MAX_MATERIALS_TOTAL_BYTES), true, `MAX_MATERIALS_TOTAL_BYTES must be an integer, got ${MAX_MATERIALS_TOTAL_BYTES}`);
    assert.ok(MAX_MATERIALS_TOTAL_BYTES > 0, 'MAX_MATERIALS_TOTAL_BYTES must be positive');
  });

  it('MAX_MATERIAL_BYTES does not exceed MAX_MATERIALS_TOTAL_BYTES (a single file cannot legitimately exceed the whole request\'s total cap)', () => {
    assert.ok(
      MAX_MATERIAL_BYTES <= MAX_MATERIALS_TOTAL_BYTES,
      `MAX_MATERIAL_BYTES (${MAX_MATERIAL_BYTES}) must be <= MAX_MATERIALS_TOTAL_BYTES (${MAX_MATERIALS_TOTAL_BYTES}), otherwise a single at-cap file could never actually be sent`,
    );
  });

  // R6-04-F2 contract point 10 — DRIFT GUARD. `cli/ui-bridge.ts`'s
  // `MAX_BODY_BYTES` (line ~3207, `1 * 1024 * 1024`) is a module-private
  // constant — not exported, and this test file must not touch
  // cli/ui-bridge.ts to export it (out of scope: "files you own" for this
  // work item is materials.ts/.test.ts + the bridge materials test file
  // only). So this mirrors the literal value with a comment citing the
  // source line, rather than importing it live. If cli/ui-bridge.ts:3207
  // ever changes, this mirrored literal must be updated in the same PR, or
  // this test is testing a stale number.
  //
  // The inequality must hold with real margin, not just by one byte: a
  // materials payload at the DECODED total cap becomes ~4/3 LARGER once
  // base64-encoded, plus JSON envelope overhead (per-material object
  // punctuation/keys) — so MAX_MATERIALS_TOTAL_BYTES must leave enough
  // headroom under MAX_BODY_BYTES for that inflation, or a legitimate
  // at-cap request would be rejected by the bridge's own outer body-size
  // guard (a 500, per readJson's reject path) before materials validation
  // ever runs — see cli/ui-bridge-agent-run-materials.test.ts's boundary
  // tests, which exercise this live over HTTP.
  it('MAX_MATERIALS_TOTAL_BYTES is strictly less than the bridge\'s MAX_BODY_BYTES (1 MiB, cli/ui-bridge.ts:3207) — fails loudly if a future edit inverts this', () => {
    const MAX_BODY_BYTES_MIRROR = 1 * 1024 * 1024; // cli/ui-bridge.ts:3207 — literal, not imported (module-private, out of this WI's file scope)
    assert.ok(
      MAX_MATERIALS_TOTAL_BYTES < MAX_BODY_BYTES_MIRROR,
      `MAX_MATERIALS_TOTAL_BYTES (${MAX_MATERIALS_TOTAL_BYTES}) must be strictly less than MAX_BODY_BYTES (${MAX_BODY_BYTES_MIRROR})`,
    );
  });
});
