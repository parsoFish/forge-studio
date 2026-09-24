/**
 * Tests for lib/template-client.ts's `parseTemplateLibraryEntry` — the pure
 * parse boundary, no fetch/window/jsdom (mirrors hook-client.test.ts's own
 * precedent, which exists precisely because the equivalent hook parser used
 * to be private and untested — see that file's header for the full
 * rationale). `parseTemplateLibraryEntry` is now EXPORTED (forge-8vfn.8.3.7)
 * so this coverage gap cannot recur here either.
 *
 * `origin` is OPTIONAL on this type (unlike hook-client.ts's mandatory
 * `origin`) — the server itself only omits it when a definition failed to
 * parse (`error` set), the same convention `format`/`previewKind` already
 * follow on this exact type.
 */
import { test, expect } from 'vitest';
import { parseTemplateLibraryEntry } from '../../lib/template-client.ts';

const WELL_FORMED_ENTRY = {
  id: 'plan',
  name: 'Plan',
  category: 'planning',
  format: 'file',
  provenance: 'studio/artifact-templates',
  definitionRef: 'studio/artifact-templates/plan.md',
  previewKind: 'doc',
  usedBy: ['forge-develop'],
  usedByDerivation: { source: 'studio/flows/*/flow.yaml', scanned: 2 },
  origin: 'ootb',
};

test('parseTemplateLibraryEntry: a well-formed entry (including origin) round-trips verbatim', () => {
  const parsed = parseTemplateLibraryEntry(WELL_FORMED_ENTRY);
  expect(parsed).toEqual(WELL_FORMED_ENTRY);
});

test('parseTemplateLibraryEntry: origin "operator" round-trips too', () => {
  const parsed = parseTemplateLibraryEntry({ ...WELL_FORMED_ENTRY, origin: 'operator' });
  expect(parsed.origin).toBe('operator');
});

test('parseTemplateLibraryEntry: origin absent stays undefined — the honest "definition failed to parse" shape, never defaulted to a guessed value', () => {
  const { origin: _drop, ...withoutOrigin } = WELL_FORMED_ENTRY;
  const parsed = parseTemplateLibraryEntry(withoutOrigin);
  expect(parsed.origin).toBeUndefined();
});

test('parseTemplateLibraryEntry: a PRESENT but unrecognised origin THROWS — including the wire\'s own 3-value Provenance vocabulary a template never legitimately emits', () => {
  expect(() => parseTemplateLibraryEntry({ ...WELL_FORMED_ENTRY, origin: 'unknown' })).toThrow();
  expect(() => parseTemplateLibraryEntry({ ...WELL_FORMED_ENTRY, origin: 'seed' })).toThrow();
  expect(() => parseTemplateLibraryEntry({ ...WELL_FORMED_ENTRY, origin: 3 })).toThrow();
});
