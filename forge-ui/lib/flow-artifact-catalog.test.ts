/**
 * Acceptance tests for forge-ui/lib/flow-artifact-catalog.ts (R3-06 / R2-05-F1).
 *
 * The module under test does not exist yet — vitest cannot even collect this
 * file until it lands (module-not-found is the expected red).
 *
 * The flow builder's ArtifactPicker today hardcodes a 9-entry ARTIFACTS list
 * (forge-ui/components/studio/flow-builder/ArtifactPicker.tsx) that includes
 * two orphans — "reflection" and "demo" — neither of which has a template
 * file under studio/artifact-templates/. This test proves the picker's
 * catalog, once relocated to this plain-TS module, has an id set EXACTLY
 * equal to the real on-disk template set (both directions) — no orphans, no
 * gaps. It reads the real repo directory rather than a fixture because this
 * is a fact that must stay true as templates are added/removed.
 *
 * AT numbers continue the flat R3-06 sequence started in
 * orchestrator/studio/template-library.test.ts.
 */
import { test, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARTIFACTS, type ArtifactDef } from './flow-artifact-catalog.ts';

// Walk up from this test file (forge-ui/lib/) to the repo root (two levels:
// forge-ui/lib -> forge-ui -> repo root), then into studio/artifact-templates/.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const TEMPLATES_DIR = join(REPO_ROOT, 'studio', 'artifact-templates');

function onDiskTemplateIds(): string[] {
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

// AT-52 -------------------------------------------------------------------

test('AT-52: the picker catalog id set is EXACTLY the on-disk studio/artifact-templates/ id set (both directions)', () => {
  const onDisk = onDiskTemplateIds();
  const catalog = [...ARTIFACTS.map((a: ArtifactDef) => a.id)].sort();

  const missingFromCatalog = onDisk.filter((id) => !catalog.includes(id));
  const orphansInCatalog = catalog.filter((id) => !onDisk.includes(id));

  expect(missingFromCatalog, `templates on disk but missing from the picker catalog: ${missingFromCatalog.join(', ') || '(none)'}`).toEqual([]);
  expect(orphansInCatalog, `picker catalog ids with no on-disk template (orphans): ${orphansInCatalog.join(', ') || '(none)'}`).toEqual([]);
  expect(catalog).toEqual(onDisk);
});

// AT-53 -------------------------------------------------------------------

test('AT-53: the two known orphans ("reflection", "demo") are gone — the catalog has exactly 7 entries', () => {
  const ids = ARTIFACTS.map((a: ArtifactDef) => a.id);
  expect(ids).not.toContain('reflection');
  expect(ids).not.toContain('demo');
  expect(ARTIFACTS.length).toBe(7);
});
