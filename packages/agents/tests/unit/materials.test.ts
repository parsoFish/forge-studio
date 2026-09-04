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
} from '../../studio/materials.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

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
// apps/forge/ui-bridge-agent-run-materials.test.ts — THIS file only pins the pure
// vocabulary: the extension→kind derivation function and the three named cap
// constants, at the unit level.
// ---------------------------------------------------------------------------

// R6-04-F2 ROUND 2 — the extension→kind table, specified exactly by the
// round-2 spawner ruling (was an honestly-disclosed gap in round 1: the WI
// text did not specify one, and every 'data-files' candidate had a plausible
// alternate classification). Case-insensitive; the LAST extension wins
// (`notes.tar.gz` ⇒ `gz`, not `tar`); no extension ⇒ undefined. It is a
// closed ALLOWLIST — anything not explicitly listed is refused, including
// several extensions that would otherwise "obviously" fit a kind.
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const DOCUMENT_EXTS = ['md', 'txt', 'pdf', 'docx'];
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'ogg', 'flac'];
const DATA_FILE_EXTS = ['json', 'csv', 'tsv', 'yaml', 'yml', 'ndjson'];

describe('materialKindForFilename — server-side extension→kind derivation (R6-04-F2 contract point 4, round 2 exact table)', () => {
  it('every "images" extension in the table derives "images" — kills an implementation that only recognizes .png (e.g. copy-pasted from round 1\'s single-example test) and silently 400s a legitimate .jpg/.jpeg/.gif/.webp upload', () => {
    for (const ext of IMAGE_EXTS) {
      assert.equal(materialKindForFilename(`file.${ext}`), 'images', `expected .${ext} → images`);
    }
  });

  it('every "documents" extension in the table derives "documents" — kills an incomplete documents list (e.g. only .pdf recognized)', () => {
    for (const ext of DOCUMENT_EXTS) {
      assert.equal(materialKindForFilename(`file.${ext}`), 'documents', `expected .${ext} → documents`);
    }
  });

  it('every "audio" extension in the table derives "audio" — kills an incomplete audio list (e.g. only .mp3 recognized)', () => {
    for (const ext of AUDIO_EXTS) {
      assert.equal(materialKindForFilename(`file.${ext}`), 'audio', `expected .${ext} → audio`);
    }
  });

  it('every "data-files" extension in the table derives "data-files" — kills an implementation that omits the "data-files" kind entirely (e.g. treats it as unreachable dead vocabulary since round 1 never exercised it) — exercised now that the table is specified', () => {
    for (const ext of DATA_FILE_EXTS) {
      assert.equal(materialKindForFilename(`file.${ext}`), 'data-files', `expected .${ext} → data-files`);
    }
  });

  it('derivation is case-insensitive: "NOTES.MD" derives "documents", "PHOTO.PNG" derives "images" — kills an implementation that does a case-sensitive lookup/Set.has() against lowercase-only keys and 400s any uppercase-extension upload', () => {
    assert.equal(materialKindForFilename('NOTES.MD'), 'documents');
    assert.equal(materialKindForFilename('PHOTO.PNG'), 'images');
    assert.equal(materialKindForFilename('Track.Mp3'), 'audio');
  });

  it('no extension at all derives undefined (README)', () => {
    assert.equal(materialKindForFilename('README'), undefined);
  });

  it('a bare dot with nothing after it derives undefined, not a crash', () => {
    assert.equal(materialKindForFilename('trailing.'), undefined);
  });

  it('an unrecognized extension (.exe) derives undefined, never a fabricated kind', () => {
    assert.equal(materialKindForFilename('payload.exe'), undefined);
  });

  // ---- deliberate exclusions — pin these as REFUSED, with the reason -------

  it('DELIBERATE EXCLUSION: ".svg" is undefined, even though it would otherwise obviously fit "images" — SVG is an active-content format (can embed <script>), and a run view may later render an accepted image directly; this test is the one that stops a future "just add svg to images" edit from quietly reopening that hole', () => {
    assert.equal(materialKindForFilename('icon.svg'), undefined, '.svg must NOT derive "images" — see comment');
  });

  it('DELIBERATE EXCLUSION: markup/script/executable/archive extensions are all undefined (.html/.htm, .js/.mjs/.ts, .sh/.bat, .exe, .zip/.tar/.gz) — kills a DENYLIST-shaped implementation (rejects only a hardcoded "bad" set) in favor of the required ALLOWLIST shape: anything not explicitly listed must be refused, not merely a few obviously-dangerous names', () => {
    for (const ext of ['html', 'htm', 'js', 'mjs', 'ts', 'sh', 'bat', 'exe', 'zip', 'tar', 'gz']) {
      assert.equal(materialKindForFilename(`file.${ext}`), undefined, `expected .${ext} → undefined (deliberately excluded)`);
    }
  });

  // ---- tricky shapes ---------------------------------------------------------

  it('LAST extension wins: "notes.tar.gz" derives undefined via ".gz" (not ".tar", which is also excluded, but this pins WHICH segment the implementation must inspect)', () => {
    assert.equal(materialKindForFilename('notes.tar.gz'), undefined);
  });

  it('LAST extension wins in the ACCEPTING direction too: "archive.backup.png" derives "images" via the trailing ".png", proving the rule is genuinely "last segment", not "any segment matches"', () => {
    assert.equal(materialKindForFilename('archive.backup.png'), 'images');
  });

  it('"archive.json.exe" derives undefined — the trailing ".exe" wins over the earlier, allowlisted ".json"', () => {
    assert.equal(materialKindForFilename('archive.json.exe'), undefined);
  });

  it('every derivable result is a genuine member of MATERIAL_KINDS — kills an implementation that returns the raw extension string (or any other non-vocabulary value) instead of a proper MaterialKind', () => {
    const candidates = [
      ...IMAGE_EXTS, ...DOCUMENT_EXTS, ...AUDIO_EXTS, ...DATA_FILE_EXTS,
      'svg', 'html', 'js', 'ts', 'sh', 'exe', 'zip', 'tar', 'gz', 'dll',
    ].map((ext) => `a.${ext}`).concat('noext');
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

  // R6-04-F2 contract point 10 — DRIFT GUARD. `apps/forge/ui-bridge.ts`'s
  // `MAX_BODY_BYTES` (line ~3207, `1 * 1024 * 1024`) is a module-private
  // constant — not exported, and this test file must not touch
  // apps/forge/ui-bridge.ts to export it (out of scope: "files you own" for this
  // work item is materials.ts/.test.ts + the bridge materials test file
  // only). So this mirrors the literal value with a comment citing the
  // source line, rather than importing it live. If apps/forge/ui-bridge.ts:3207
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
  // ever runs — see apps/forge/ui-bridge-agent-run-materials.test.ts's boundary
  // tests, which exercise this live over HTTP.
  it('MAX_MATERIALS_TOTAL_BYTES is strictly less than the bridge\'s MAX_BODY_BYTES (1 MiB, cli/ui-bridge.ts:3207) — fails loudly if a future edit inverts this', () => {
    const MAX_BODY_BYTES_MIRROR = 1 * 1024 * 1024; // cli/ui-bridge.ts:3207 — literal, not imported (module-private, out of this WI's file scope)
    assert.ok(
      MAX_MATERIALS_TOTAL_BYTES < MAX_BODY_BYTES_MIRROR,
      `MAX_MATERIALS_TOTAL_BYTES (${MAX_MATERIALS_TOTAL_BYTES}) must be strictly less than MAX_BODY_BYTES (${MAX_BODY_BYTES_MIRROR})`,
    );
  });
});
