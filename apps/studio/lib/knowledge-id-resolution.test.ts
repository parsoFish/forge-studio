/**
 * knowledge-id-resolution.test.ts — W6-P4 review fix #4: behavioral tests
 * for `resolveActiveKbId`, replacing the tautological source-regex tests
 * that used to live in `knowledge-page-id-fastpath.test.ts` (deleted).
 */
import { test, expect } from 'vitest';
import { resolveActiveKbId } from './knowledge-id-resolution.ts';

const KBS = [{ id: 'kb-a' }, { id: 'kb-b' }];

test('idParam present, roster not yet settled: trusts it optimistically, unconfirmed', () => {
  expect(resolveActiveKbId('kb-a', [], false)).toEqual({ id: 'kb-a', source: 'url-optimistic' });
  // Even against an already-populated (but not yet marked ready) roster —
  // kbListReady is the authority on "settled", not allKbs.length.
  expect(resolveActiveKbId('kb-a', KBS, false)).toEqual({ id: 'kb-a', source: 'url-optimistic' });
});

test('idParam present, roster settled and CONTAINS it: validated', () => {
  expect(resolveActiveKbId('kb-b', KBS, true)).toEqual({ id: 'kb-b', source: 'validated' });
});

test('idParam present, roster settled and does NOT contain it (stale — e.g. the KB was deleted): falls back to the first KB', () => {
  expect(resolveActiveKbId('kb-deleted', KBS, true)).toEqual({ id: 'kb-a', source: 'fallback' });
});

test('idParam present, roster settled but genuinely EMPTY: no id to resolve', () => {
  expect(resolveActiveKbId('kb-a', [], true)).toEqual({ id: '', source: 'none' });
});

test('idParam absent, roster settled and non-empty: falls back to the first KB', () => {
  expect(resolveActiveKbId('', KBS, true)).toEqual({ id: 'kb-a', source: 'fallback' });
});

test('idParam absent, roster settled and non-empty: fallback does not depend on kbListReady for THIS case — allKbs already tells the whole story', () => {
  expect(resolveActiveKbId('', KBS, false)).toEqual({ id: 'kb-a', source: 'fallback' });
});

test('idParam absent, roster empty: none, regardless of kbListReady (callers gate the ready-state transition themselves)', () => {
  expect(resolveActiveKbId('', [], true)).toEqual({ id: '', source: 'none' });
  expect(resolveActiveKbId('', [], false)).toEqual({ id: '', source: 'none' });
});

test('only "validated"/"fallback"/"none" are ever returned once kbListReady is true — "url-optimistic" is impossible post-settle', () => {
  const cases = [
    resolveActiveKbId('kb-a', KBS, true),
    resolveActiveKbId('kb-missing', KBS, true),
    resolveActiveKbId('', KBS, true),
    resolveActiveKbId('', [], true),
  ];
  for (const c of cases) expect(c.source).not.toBe('url-optimistic');
});
