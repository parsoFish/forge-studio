/**
 * A story that creates a flow-bound KB owns that KB's seeding anchor and its
 * drain logs (M7-D, S6 fixture proof run 2, 2026-09-25).
 *
 * S6 creates KB `story-s6`. Seeding runs a real project-brain session anchored
 * under `projects/.kb-story-s6/_project-brain/<sid>`, and the drain writes
 * `_logs/_kb-drain-story-s6-drain-<rand>/`. The sweep owned `story-<id>` only,
 * so both survived: bead `forge-8vfn.7.6.5` made the foreign-session preflight
 * SEE the anchor, which then refused the NEXT S6 run over S6's own residue.
 * Prefix-bounded exactly like the fork grounds: `story-s60`'s and a real
 * project's KB logs are never this story's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { productFixturePathsFor } from './sweep.mjs';

test('the story KB\'s seeding anchor projects/.kb-story-<id> is a product fixture of that story', () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-kb-'));
  try {
    const paths = productFixturePathsFor('S6', root);
    assert.ok(paths.includes(join(root, 'projects', '.kb-story-s6')), paths.join('\n'));
    assert.ok(!paths.some((p) => p.endsWith('.kb-story-s60')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the story KB\'s drain logs are product fixtures — prefix-bounded, never another story\'s or a real KB\'s', () => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-kb-'));
  try {
    for (const d of ['_kb-drain-story-s6-drain-abc123', '_kb-drain-story-s60-drain-x', '_kb-drain-mdtoc-drain-y', '_kb-drain-story-s6']) {
      mkdirSync(join(root, '_logs', d), { recursive: true });
    }
    const paths = productFixturePathsFor('S6', root);
    assert.ok(paths.includes(join(root, '_logs', '_kb-drain-story-s6-drain-abc123')), 'this story\'s drain log');
    assert.ok(!paths.includes(join(root, '_logs', '_kb-drain-story-s60-drain-x')), 'story-s60 is not story-s6');
    assert.ok(!paths.includes(join(root, '_logs', '_kb-drain-mdtoc-drain-y')), 'a real KB\'s drain log is never swept');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
