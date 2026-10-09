/**
 * forge-mfv5.1.20 — the project page's Save control is derived from the form AND
 * the project repo. It used to be gated on the form's dirty flag alone, so with
 * forge-studio 4 commits ahead and contract files uncommitted (the gitweave
 * capstone) it read "No unsaved changes" and the Save/adopt path was unreachable.
 */
import { test, expect } from 'vitest';

import { deriveSaveControl } from '@/lib/save-control';

const CAPSTONE = { pending: true, branch: 'forge-studio', uncommitted: ['.gitignore', 'roadmap.md'] };
const CLEAN = { pending: false, branch: 'forge-studio', uncommitted: [] as string[] };

test('repo pending + uncommitted contract files + a clean form → Save enabled, with the adopt list', () => {
  const c = deriveSaveControl({ dirty: false, saving: false, repo: CAPSTONE, refused: [] });
  expect(c.disabledReason).toBeNull();
  expect(c.adoptFiles).toEqual(['.gitignore', 'roadmap.md']);
  expect(c.label).toBe('Save pending changes');
});

test('repo pending alone (nothing uncommitted) still enables Save', () => {
  const c = deriveSaveControl({ dirty: false, saving: false, repo: { ...CAPSTONE, uncommitted: [] }, refused: [] });
  expect(c.disabledReason).toBeNull();
  expect(c.adoptFiles).toEqual([]);
});

test('everything clean → disabled, "No unsaved changes"', () => {
  const c = deriveSaveControl({ dirty: false, saving: false, repo: CLEAN, refused: [] });
  expect(c.disabledReason).toBe('No unsaved changes');
});

test('a refusal names the files the server refused, over the polled list', () => {
  const c = deriveSaveControl({ dirty: false, saving: false, repo: CAPSTONE, refused: ['roadmap.md'] });
  expect(c.adoptFiles).toEqual(['roadmap.md']);
});

test('a dirty form is still "Save project"; saving disables', () => {
  expect(deriveSaveControl({ dirty: true, saving: false, repo: CLEAN, refused: [] }).label).toBe('Save project');
  expect(deriveSaveControl({ dirty: true, saving: true, repo: CLEAN, refused: [] }).disabledReason).toBe('Saving…');
});
