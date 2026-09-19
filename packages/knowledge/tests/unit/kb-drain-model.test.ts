/**
 * Tests for packages/knowledge/kb-drain-model.ts's pure key/derivation
 * helpers — currently just `findingKey` (forge-1ep).
 *
 * forge-1ep: `findingKey` used to be `${kind}::${file}`, so two findings of
 * the SAME kind on the SAME file collided onto one key. The derived
 * `not-cleared`/`cleared` outcome tolerates this (finalizeRoundRows checks
 * `afterKeys.has(row.key)` and is conservative either way), but
 * `draftedKeys`/`refusedKeys` in `bridge-studio-kb-drain.ts` are NOT: once
 * one sibling with a shared key is drafted or refused, every other finding
 * that happens to share that same key — including ones never dispatched at
 * all — is filtered out of the residual for the rest of the run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findingKey, progressKeySet } from '../../kb-drain-model.ts';
import type { Finding } from '../../brain-lint.ts';

function finding(overrides: Partial<Finding> & Pick<Finding, 'message'>): Finding {
  return {
    category: 'error',
    file: '/brain/cycles/themes/x.md',
    check: 'checkDanglingEdges',
    kind: 'edge.dangling',
    resolution: 'agent',
    ...overrides,
  };
}

test('findingKey: two findings of the SAME kind on the SAME file but different messages get DIFFERENT keys', () => {
  const a = finding({ message: 'dangling related_themes slug: missing-slug-1' });
  const b = finding({ message: 'dangling related_themes slug: missing-slug-2' });
  assert.notEqual(findingKey(a), findingKey(b), 'two distinct findings on one file must not share a key');
});

test('findingKey: still stable/deterministic — the SAME finding (by value) always produces the SAME key', () => {
  const a = finding({ message: 'broken link: ../gone.md' });
  const b = finding({ message: 'broken link: ../gone.md' });
  assert.equal(findingKey(a), findingKey(b));
});

test('findingKey: two findings that differ only by file still get different keys (unaffected by the message fix)', () => {
  const a = finding({ file: '/brain/cycles/themes/a.md', message: 'same message' });
  const b = finding({ file: '/brain/cycles/themes/b.md', message: 'same message' });
  assert.notEqual(findingKey(a), findingKey(b));
});

test('progressKeySet: a round with two same-kind, same-file, different-message findings tracks BOTH — a set built from colliding keys would silently drop one', () => {
  const a = finding({ message: 'dangling related_themes slug: missing-slug-1' });
  const b = finding({ message: 'dangling related_themes slug: missing-slug-2' });
  const keys = progressKeySet([a, b]);
  assert.equal(keys.size, 2, `expected both siblings tracked distinctly, got ${JSON.stringify([...keys])}`);
});
