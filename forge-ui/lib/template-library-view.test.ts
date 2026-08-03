/**
 * Acceptance tests for forge-ui/lib/template-library-view.ts (R3-06).
 *
 * The module under test does not exist yet — vitest cannot even collect this
 * file until it lands (module-not-found is the expected red). Pure view-state
 * derivation for the templates library page — mirrors
 * forge-ui/lib/skill-library-view.ts's testability convention: no DOM, no
 * React, no network.
 *
 * AT numbers continue the flat R3-06 sequence started in
 * orchestrator/studio/template-library.test.ts.
 */
import { test, expect } from 'vitest';
import {
  groupTemplateLibrary,
  filterTemplates,
  templateBadges,
  previewClassFor,
} from './template-library-view.ts';
import type { TemplateLibraryEntry } from './template-client.ts';

function entry(overrides: Partial<TemplateLibraryEntry> & { id: string; category: TemplateLibraryEntry['category'] }): TemplateLibraryEntry {
  return {
    name: overrides.id,
    format: 'file',
    provenance: 'studio/artifact-templates',
    definitionRef: `studio/artifact-templates/${overrides.id}.md`,
    previewKind: 'doc',
    usedBy: [],
    usedByDerivation: { source: 'studio/flows/*/flow.yaml', scanned: 3 },
    ...overrides,
  };
}

// AT-48 -------------------------------------------------------------------

test('AT-48: groupTemplateLibrary(entries) splits into planning / demo-output / project-scaffold, preserving order, counts derived from the arrays', () => {
  const entries = [
    entry({ id: 'zeta-plan', category: 'planning' }),
    entry({ id: 'cli-capture', category: 'demo-output' }),
    entry({ id: 'alpha-plan', category: 'planning' }),
    entry({ id: 'typescript-cli', category: 'project-scaffold' }),
  ];

  const grouped = groupTemplateLibrary(entries);

  expect(grouped.planning.map((e) => e.id)).toEqual(['zeta-plan', 'alpha-plan']);
  expect(grouped.demoOutput.map((e) => e.id)).toEqual(['cli-capture']);
  expect(grouped.projectScaffold.map((e) => e.id)).toEqual(['typescript-cli']);

  // Counts are always derived from the arrays themselves, never independently
  // set fields that could drift from reality.
  expect(grouped.planningCount).toBe(grouped.planning.length);
  expect(grouped.demoOutputCount).toBe(grouped.demoOutput.length);
  expect(grouped.projectScaffoldCount).toBe(grouped.projectScaffold.length);
  expect(grouped.total).toBe(4);
  expect(grouped.total).toBe(grouped.planning.length + grouped.demoOutput.length + grouped.projectScaffold.length);
});

// AT-49 -------------------------------------------------------------------

test('AT-49: filterTemplates(entries, q) matches on name + description, case-insensitive; empty query returns all (new array, input untouched)', () => {
  const entries = [
    entry({ id: 'plan', category: 'planning', name: 'Plan', description: 'Approved plan and decomposition.' }),
    entry({ id: 'narrative', category: 'demo-output', name: 'Narrative essence', description: 'A tight prose lead.' }),
    entry({ id: 'typescript-cli', category: 'project-scaffold', name: 'TypeScript CLI', description: 'A CLI starter.' }),
  ];

  expect(filterTemplates(entries, 'prose').map((e) => e.id)).toEqual(['narrative']);
  expect(filterTemplates(entries, 'CLI').map((e) => e.id), 'case-insensitive on name').toEqual(['typescript-cli']);
  expect(filterTemplates(entries, 'decomposition').map((e) => e.id), 'matches on description too').toEqual(['plan']);

  const all = filterTemplates(entries, '');
  expect(all).toEqual(entries);
  expect(all).not.toBe(entries); // new array

  const snapshot = [...entries];
  filterTemplates(entries, 'plan');
  expect(entries).toEqual(snapshot); // input array untouched
});

// AT-50 -------------------------------------------------------------------

test('AT-50: templateBadges(entry) derives tokens from real fields — never a free-text description', () => {
  const unverified = entry({ id: 'verdict', category: 'planning', endpointsVerified: false });
  expect(templateBadges(unverified)).toContain('unverified');

  const verified = entry({ id: 'plan', category: 'planning', endpointsVerified: true });
  expect(templateBadges(verified)).not.toContain('unverified');

  const errored = entry({ id: 'broken', category: 'planning', error: 'cannot parse frontmatter' });
  expect(templateBadges(errored)).toContain('error');

  const clean = entry({ id: 'typescript-cli', category: 'project-scaffold' });
  expect(templateBadges(clean)).not.toContain('error');
  expect(templateBadges(clean)).not.toContain('unverified');

  // A description that LOOKS like it claims a status must never influence badges.
  const decoy = entry({ id: 'decoy', category: 'planning', description: 'unverified and full of errors', endpointsVerified: true });
  expect(templateBadges(decoy)).not.toContain('unverified');
  expect(templateBadges(decoy)).not.toContain('error');
});

// AT-51 -------------------------------------------------------------------

test('AT-51: previewClassFor(previewKind) is a total function over the 6 known kinds, each mapping to a distinct class; an unrecognised kind throws (never a silent default)', () => {
  const kinds = ['html', 'video', 'shots', 'mock', 'doc', 'scaffold'] as const;
  const classes = kinds.map((k) => previewClassFor(k));
  expect(new Set(classes).size).toBe(kinds.length, 'every previewKind must map to a DISTINCT class');
  for (const cls of classes) {
    expect(typeof cls).toBe('string');
    expect(cls.length).toBeGreaterThan(0);
  }

  expect(() => previewClassFor('not-a-real-kind' as never)).toThrow();
});
