/**
 * Tests for `parseCapability` (R2-02-F1/AC3) — the client-side parse of the
 * server-computed `capability` field on GET /api/studio/agents and
 * GET /api/studio/starters. AC3 requires the descriptor be carried through
 * verbatim, never re-derived client-side; this locks the parse boundary
 * (well-formed → passed through, absent/malformed → undefined, no throw).
 */
import { test, expect } from 'vitest';

import { parseCapability } from './studio-client';

test('parseCapability: a well-formed descriptor is carried through verbatim', () => {
  expect(parseCapability({ interactive: true, runtimeSdks: ['claude-code'] }))
    .toEqual({ interactive: true, runtimeSdks: ['claude-code'] });
  expect(parseCapability({ interactive: false, runtimeSdks: [] }))
    .toEqual({ interactive: false, runtimeSdks: [] });
});

test('parseCapability: undefined/absent input returns undefined', () => {
  expect(parseCapability(undefined)).toBeUndefined();
  expect(parseCapability(null)).toBeUndefined();
});

test('parseCapability: malformed shapes return undefined without throwing (older bridge payload)', () => {
  expect(parseCapability({})).toBeUndefined();
  expect(parseCapability({ interactive: 'yes', runtimeSdks: ['claude-code'] })).toBeUndefined();
  expect(parseCapability({ interactive: true, runtimeSdks: 'claude-code' })).toBeUndefined();
  expect(parseCapability({ interactive: true })).toBeUndefined();
  expect(parseCapability('not-an-object')).toBeUndefined();
  expect(parseCapability(42)).toBeUndefined();
});
