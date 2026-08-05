/**
 * Tests for `agent-builder-view.ts` — the Agent Builder's pure view-state
 * derivation (R2-09). Modelled on the skill-library-view.ts /
 * session-shell-view.ts testability convention: no DOM, no React, no
 * network. The agents pillar was the only library pillar without an
 * extracted pure view module before this initiative.
 *
 * AMBIGUITY (see final report): T2's spec names `toggleMaterial`,
 * `applyInstructionsDraft`, and `catalogAddTarget` explicitly. It does NOT
 * name a function for the click-to-add idempotency check (AT59) or the
 * YAML-preview line builder (AT60), nor the draft-flag-clearing half of
 * AT57. This file adds `addChip`, `buildYamlPreviewLines`,
 * `clearInstructionsDraftFlag`, and `editInstructionsText` as reasonable,
 * minimal complements — the implementer may reasonably choose different
 * names, in which case these specific tests (clearly grouped below) are the
 * ones to reconcile.
 */
import { test, expect } from 'vitest';

import {
  toggleMaterial,
  applyInstructionsDraft,
  clearInstructionsDraftFlag,
  editInstructionsText,
  catalogAddTarget,
  addChip,
  buildYamlPreviewLines,
} from './agent-builder-view';

// ---------------------------------------------------------------------------
// toggleMaterial(list, kind) — MATERIAL_KINDS-ordered toggle
// ---------------------------------------------------------------------------

test('toggleMaterial: adds a kind not yet present', () => {
  expect(toggleMaterial([], 'images')).toEqual(['images']);
});

test('toggleMaterial: removes a kind already present', () => {
  expect(toggleMaterial(['images', 'audio'], 'images')).toEqual(['audio']);
});

test('toggleMaterial: the result is always ordered by MATERIAL_KINDS canonical order, not click order', () => {
  // Click order: audio, then images, then documents.
  const afterAudio = toggleMaterial([], 'audio');
  const afterImages = toggleMaterial(afterAudio, 'images');
  const afterDocuments = toggleMaterial(afterImages, 'documents');
  expect(afterDocuments).toEqual(['images', 'documents', 'audio']);
});

test('toggleMaterial: toggling a kind outside the vocabulary is a no-op, never an append (fail closed)', () => {
  expect(toggleMaterial(['images'], 'holograms' as never)).toEqual(['images']);
});

test('toggleMaterial: does not mutate its input array', () => {
  const input = ['images'];
  const result = toggleMaterial(input, 'audio');
  expect(input).toEqual(['images']);
  expect(result).not.toBe(input);
});

// ---------------------------------------------------------------------------
// applyInstructionsDraft(state, draft) / clearInstructionsDraftFlag /
// editInstructionsText — the draft-flag lifecycle (D9: never auto-saved)
// ---------------------------------------------------------------------------

type BuilderInstructionsState = { instructions: string; dirty: boolean; instructionsIsDraft: boolean };

function baseState(overrides: Partial<BuilderInstructionsState> = {}): BuilderInstructionsState {
  return { instructions: '', dirty: false, instructionsIsDraft: false, ...overrides };
}

test('applyInstructionsDraft: sets the instructions text, dirty:true, and the draft flag', () => {
  const next = applyInstructionsDraft(baseState(), '# Generated draft\n\nBody.\n');
  expect(next.instructions).toBe('# Generated draft\n\nBody.\n');
  expect(next.dirty).toBe(true);
  expect(next.instructionsIsDraft).toBe(true);
});

test('applyInstructionsDraft: does not mutate the input state', () => {
  const state = baseState({ instructions: 'old' });
  const next = applyInstructionsDraft(state, 'new');
  expect(state.instructions).toBe('old');
  expect(next).not.toBe(state);
});

test('the draft flag clears on save-success and on discard', () => {
  const drafted = applyInstructionsDraft(baseState(), 'drafted text');
  expect(drafted.instructionsIsDraft).toBe(true);

  const afterSave = clearInstructionsDraftFlag(drafted);
  expect(afterSave.instructionsIsDraft).toBe(false);
  // Clearing the draft flag must not touch the text itself.
  expect(afterSave.instructions).toBe('drafted text');

  const afterDiscard = clearInstructionsDraftFlag(drafted);
  expect(afterDiscard.instructionsIsDraft).toBe(false);
});

test('the draft flag persists across a further manual edit to the draft-derived text', () => {
  const drafted = applyInstructionsDraft(baseState(), 'drafted text');
  const edited = editInstructionsText(drafted, 'drafted text plus a manual tweak');
  // A manual edit must not silently clear the draft provenance flag.
  expect(edited.instructionsIsDraft).toBe(true);
  expect(edited.instructions).toBe('drafted text plus a manual tweak');
});

// ---------------------------------------------------------------------------
// catalogAddTarget(kind) — click-to-add zone mapping
// ---------------------------------------------------------------------------

test('catalogAddTarget: maps each catalog kind to its zone id (mirrors DropZone.tsx ZONE_IDS)', () => {
  expect(catalogAddTarget('skill')).toBe('zone-skills');
  expect(catalogAddTarget('tool')).toBe('zone-tools');
  expect(catalogAddTarget('mcp')).toBe('zone-mcps');
  expect(catalogAddTarget('guard')).toBe('zone-guards');
  expect(catalogAddTarget('hook')).toBe('zone-hooks');
});

test('catalogAddTarget: an unknown kind returns null, never a default zone', () => {
  expect(catalogAddTarget('bogus' as never)).toBeNull();
});

// ---------------------------------------------------------------------------
// addChip(ids, id) — click-to-add idempotency
// ---------------------------------------------------------------------------

test('addChip: adds a new id', () => {
  expect(addChip(['a'], 'b')).toEqual(['a', 'b']);
});

test('addChip: adding an already-bound id is a no-op (matches DropZone.handleDrop\'s "!ids.includes(id)" guard)', () => {
  expect(addChip(['a', 'b'], 'a')).toEqual(['a', 'b']);
});

test('addChip: does not mutate its input array', () => {
  const input = ['a'];
  const result = addChip(input, 'b');
  expect(input).toEqual(['a']);
  expect(result).not.toBe(input);
});

// ---------------------------------------------------------------------------
// buildYamlPreviewLines — hooks + materials rows, declared-empty visibility
// ---------------------------------------------------------------------------

test('the YAML preview includes a hooks row and a materials row', () => {
  const lines = buildYamlPreviewLines({
    composition: { skills: [], tools: [], mcps: [], guards: [], hooks: ['pre-commit-lint'] },
    materials: ['images'],
  });
  expect(lines.some((l) => l.startsWith('hooks:'))).toBe(true);
  expect(lines.some((l) => l.startsWith('materials:'))).toBe(true);
});

test('materials: [] renders an explicit empty list in the preview, not an omitted row (declared-empty must be VISIBLE)', () => {
  const lines = buildYamlPreviewLines({
    composition: { skills: [], tools: [], mcps: [], guards: [], hooks: [] },
    materials: [],
  });
  const materialsLine = lines.find((l) => l.startsWith('materials:'));
  expect(materialsLine).toBeDefined();
  expect(materialsLine).toMatch(/\[\s*\]/);
});
