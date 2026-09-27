/**
 * forge-mfv5.2.8 — a generation-gallery entry's `declaration` crosses the wire
 * as a `demoProcess` step list or null; a missing, non-array or malformed one
 * THROWS in `parseSessionArtifact`, never coerced into something lockable.
 *
 * RUN: npx vitest run --root apps/studio apps/studio/tests/unit/generation-declaration.test.ts
 */
import { test, expect } from 'vitest';

import { parseSessionArtifact } from '@/lib/session-client';

const STEPS = [{ kind: 'capture', text: 'Run `npm run demo`.', element: 'cli-capture' }, { kind: 'verify', text: 'It holds.' }];

function gallery(entry: Record<string, unknown>): unknown {
  return {
    kind: 'generation-gallery',
    label: 'Demo generations',
    sourcesScanned: [],
    generations: [{ number: 1, createdAt: '2026-09-27T00:00:00.000Z', feedback: null, targetElement: null, items: [], ...entry }],
  };
}

test('a step list or null round-trips exactly', () => {
  const parsed = parseSessionArtifact(gallery({ declaration: STEPS })) as { generations: Array<{ declaration: unknown }> };
  expect(parsed.generations[0]!.declaration).toEqual(STEPS);
  const none = parseSessionArtifact(gallery({ declaration: null })) as { generations: Array<{ declaration: unknown }> };
  expect(none.generations[0]!.declaration).toBeNull();
});

test('a missing, non-array or malformed declaration THROWS', () => {
  expect(() => parseSessionArtifact(gallery({}))).toThrow(/declaration/);
  expect(() => parseSessionArtifact(gallery({ declaration: 'steps' }))).toThrow(/declaration/);
  expect(() => parseSessionArtifact(gallery({ declaration: [{ kind: 'capture' }] }))).toThrow(/"kind" and "text"/);
  expect(() => parseSessionArtifact(gallery({ declaration: [{ kind: 'capture', text: 'x', element: 3 }] }))).toThrow(/element/);
});
