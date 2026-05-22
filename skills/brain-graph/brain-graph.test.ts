/**
 * Unit tests for the brain-graph helpers.
 *
 * The skill itself is a SKILL.md (operator-facing prompt); the helpers it
 * documents live in `orchestrator/brain-graph.ts`. These tests exercise
 * the helpers against a tiny in-memory brain fixture so they stay
 * deterministic and fast.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildBrainGraph,
  bridgesBetween,
  checkGraphFreshness,
  neighbours,
  reachable,
} from '../../orchestrator/brain-graph.ts';

/** Create a tiny brain on disk and return its root cwd. */
function makeFixtureBrain(): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), 'forge-brain-graph-test-'));
  mkdirSync(join(cwd, 'brain/forge/themes'), { recursive: true });
  mkdirSync(join(cwd, 'brain/_raw/web'), { recursive: true });
  mkdirSync(join(cwd, 'brain/projects/trafficGame/themes'), { recursive: true });

  // INDEX + category index
  writeFileSync(
    join(cwd, 'brain/INDEX.md'),
    `# brain index\n\n- [pr-as-sole-review-window](./forge/themes/pr-as-sole-review-window.md)\n`,
  );
  writeFileSync(
    join(cwd, 'brain/forge/patterns.md'),
    `# patterns\n\n- [pr-as-sole-review-window](./themes/pr-as-sole-review-window.md)\n`,
  );

  // Two forge themes linked by frontmatter + body wikilink.
  writeFileSync(
    join(cwd, 'brain/forge/themes/pr-as-sole-review-window.md'),
    `---
title: PR as sole review window
description: The PR is the demo + spec + verdict.
category: pattern
keywords: [pr, review, demo]
related_themes: [reviewer-ralph-loop]
updated_at: 2026-05-22T00:00:00Z
---

# PR as sole review window

Reviewers see [[reviewer-ralph-loop]] only through the PR.

## Sources

- [adr-007](../../_raw/docs/adr-007.md)
`,
  );
  writeFileSync(
    join(cwd, 'brain/forge/themes/reviewer-ralph-loop.md'),
    `---
title: Reviewer Ralph loop
description: stages 1 + 2 collapse.
category: pattern
keywords: [reviewer, ralph]
related_themes: [pr-as-sole-review-window]
updated_at: 2026-05-21T00:00:00Z
---

# Reviewer Ralph loop

See [[pr-as-sole-review-window]] for why the PR is the surface.
`,
  );

  // Raw + project theme that bridges both via wikilink.
  mkdirSync(join(cwd, 'brain/_raw/docs'), { recursive: true });
  writeFileSync(
    join(cwd, 'brain/_raw/docs/adr-007.md'),
    `# ADR 007\n\nMarkdown artifact flow.\n`,
  );
  writeFileSync(
    join(cwd, 'brain/projects/trafficGame/profile.md'),
    `# trafficGame profile\n\nReferences [[pr-as-sole-review-window]] and [[reviewer-ralph-loop]].\n`,
  );

  return {
    cwd,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

test('buildBrainGraph emits nodes for themes, profiles, indexes, and raw sources', () => {
  const { cwd, cleanup } = makeFixtureBrain();
  try {
    const graph = buildBrainGraph({ cwd });
    const ids = new Set(graph.nodes.map((n) => n.id));
    assert.ok(ids.has('brain/forge/themes/pr-as-sole-review-window.md'));
    assert.ok(ids.has('brain/forge/themes/reviewer-ralph-loop.md'));
    assert.ok(ids.has('brain/projects/trafficGame/profile.md'));
    assert.ok(ids.has('brain/INDEX.md'));
    assert.ok(ids.has('brain/forge/patterns.md'));
    // The freshly-archived synthesis path doesn't exist in this fixture but
    // the walker must not crash. node_count must be > 0.
    assert.ok(graph.node_count >= 5);

    const prNode = graph.nodes.find(
      (n) => n.id === 'brain/forge/themes/pr-as-sole-review-window.md',
    );
    assert.ok(prNode);
    assert.equal(prNode?.label, 'PR as sole review window');
    assert.equal(prNode?.category, 'pattern');
    assert.equal(prNode?.layer, 'theme');
    assert.deepEqual(prNode?.keywords, ['pr', 'review', 'demo']);
  } finally {
    cleanup();
  }
});

test('buildBrainGraph emits related_to and wikilink edges, deduped', () => {
  const { cwd, cleanup } = makeFixtureBrain();
  try {
    const graph = buildBrainGraph({ cwd });
    const prId = 'brain/forge/themes/pr-as-sole-review-window.md';
    const rrId = 'brain/forge/themes/reviewer-ralph-loop.md';

    const prToRrRelated = graph.edges.find(
      (e) => e.source === prId && e.target === rrId && e.relation === 'related_to',
    );
    const prToRrWiki = graph.edges.find(
      (e) => e.source === prId && e.target === rrId && e.relation === 'wikilink',
    );
    assert.ok(prToRrRelated, 'related_to PR → RR missing');
    assert.ok(prToRrWiki, 'wikilink PR → RR missing');

    // Edges must be deduped — no two edges with same (s, t, relation).
    const seen = new Set<string>();
    for (const e of graph.edges) {
      const key = `${e.source} ${e.target} ${e.relation}`;
      assert.ok(!seen.has(key), `duplicate edge: ${key}`);
      seen.add(key);
    }

    // Sources block link should land as `cites`.
    const cite = graph.edges.find((e) => e.source === prId && e.relation === 'cites');
    assert.ok(cite, 'cites edge to ADR missing');
  } finally {
    cleanup();
  }
});

test('neighbours / reachable / bridgesBetween navigate the graph correctly', () => {
  const { cwd, cleanup } = makeFixtureBrain();
  try {
    const graph = buildBrainGraph({ cwd });
    const prId = 'brain/forge/themes/pr-as-sole-review-window.md';
    const rrId = 'brain/forge/themes/reviewer-ralph-loop.md';
    const tgProfile = 'brain/projects/trafficGame/profile.md';

    const nbs = neighbours(graph, prId);
    assert.ok(nbs.includes(rrId), 'PR neighbours should include RR');

    const within2 = reachable(graph, prId, 2);
    assert.ok(within2.includes(rrId));
    // The trafficGame profile [[wikilinks]] both PR + RR; 2-hop from PR
    // should reach it via RR.
    assert.ok(within2.includes(tgProfile));

    const bridges = bridgesBetween(graph, prId, rrId);
    // The trafficGame profile mentions both — it's a bridge.
    assert.ok(bridges.includes(tgProfile));
  } finally {
    cleanup();
  }
});

test('checkGraphFreshness flags themes newer than graph.json', () => {
  const { cwd, cleanup } = makeFixtureBrain();
  try {
    // Write an "old" graph.json then bump a theme's mtime.
    const graphPath = 'brain/graph.json';
    const graphAbs = join(cwd, graphPath);
    mkdirSync(join(cwd, 'brain'), { recursive: true });
    writeFileSync(graphAbs, JSON.stringify({ nodes: [], edges: [] }));

    // Make graph 60s old; theme 30s old (so theme is newer).
    const now = Date.now();
    utimesSync(graphAbs, new Date(now - 60_000), new Date(now - 60_000));
    utimesSync(
      join(cwd, 'brain/forge/themes/pr-as-sole-review-window.md'),
      new Date(now - 30_000),
      new Date(now - 30_000),
    );

    const check = checkGraphFreshness({ cwd, graphPath });
    assert.equal(check.fresh, false, 'graph should be flagged stale');
    assert.ok(
      check.stale_files.includes('brain/forge/themes/pr-as-sole-review-window.md'),
      `stale_files should mention PR theme: ${check.stale_files.join(', ')}`,
    );
  } finally {
    cleanup();
  }
});

test('checkGraphFreshness returns fresh:false when graph.json is missing', () => {
  const { cwd, cleanup } = makeFixtureBrain();
  try {
    const check = checkGraphFreshness({ cwd, graphPath: 'brain/graph.json' });
    assert.equal(check.fresh, false);
    assert.equal(check.graph_mtime, null);
  } finally {
    cleanup();
  }
});
