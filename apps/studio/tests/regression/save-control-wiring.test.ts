/**
 * forge-mfv5.1.20 (structural door) — the project page's Save button takes its
 * enabled state and label from `deriveSaveControl` (form + repo-status + refusal),
 * and the page polls repo-status. Gated on `!dirty` alone (the defect), Save read
 * "No unsaved changes" with forge-studio 4 commits ahead and the adopt path
 * unreachable from the UI.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(__dirname, '../../app/projects/[id]/page.tsx'), 'utf8');
const button = page.slice(page.indexOf('data-action="save-project"') - 200, page.indexOf('data-action="save-project"') + 400);

test('the save-project button is gated by the derived control, never the form flag alone', () => {
  expect(button).toContain('disabledAttrs(saveControl.disabledReason)');
  expect(button).toContain('{saveControl.label}');
  expect(button).not.toMatch(/!dirty\s*\?\s*'No unsaved changes'/);
});

test('the page polls repo-status and feeds it to the derivation', () => {
  expect(page).toMatch(/useRepoStatus\(/);
  expect(page).toMatch(/deriveSaveControl\(\{[^}]*\brepo\b/);
});

test('the adopt panel lists the derived files, so the refusal path is reachable from the page', () => {
  expect(page).toMatch(/<SaveRefusal files=\{saveControl\.adoptFiles\}/);
});
