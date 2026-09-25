/**
 * forge-8vfn.2.16 — the ADR-035 central move of trafficGame's Brain 3 lost
 * `related_themes` edges and a Sources citation.
 *
 * M1's class-10 dry-run compared `projects/trafficGame/brain/themes/` (the
 * pre-move project-side copy, kept read-only as the only surviving record)
 * against `brain/projects/trafficGame/themes/` at HEAD: 9 themes had
 * populated `related_themes` in the project copy but `[]` centrally, and
 * `2026-05-16-structural-prerequisites-for-autonomy.md` had its `## Sources`
 * list duplicated (the same link twice) where the project copy cited two
 * distinct sources (the second being `retro.md`).
 *
 * These assertions read the REAL central brain (via `FORGE_ROOT`, not a
 * synthetic fixture) and are non-vacuous: each expected edge list is the
 * exact restored set (traced through `git log` to the 2026-05-23
 * `docs(brain): wikilink connectivity lift` commit that first created these
 * bridges), not a bare `.length > 0`. A theme whose ONLY historically-true
 * edges point at themes archived on 2026-06-07
 * (`docs(brain): reconcile brain to as-is`) is asserted to legitimately stay
 * `[]` — restoring a slug with no surviving target file would itself be a
 * `checkDanglingEdges` regression.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { FORGE_ROOT } from '@forge/kernel';

import { parseThemeFile } from '../../theme-frontmatter.ts';
import { checkDanglingEdges } from '../../brain-lint.ts';

const THEMES_DIR = join(FORGE_ROOT, 'brain', 'projects', 'trafficGame', 'themes');

function relatedThemesOf(fileName: string): string[] {
  const parsed = parseThemeFile(join(THEMES_DIR, fileName));
  assert.ok(parsed, `expected ${fileName} to exist and parse under ${THEMES_DIR}`);
  const related = parsed!.data.related_themes;
  return Array.isArray(related) ? related.map((s) => String(s)) : [];
}

// slug -> the exact edge set restorable from the pre-move project copy (only
// slugs whose target theme file still exists SOMEWHERE under brain/**/themes/
// today; the archived 4 — pr-as-sole-review-window, review-phase-target-design,
// phase-isolation-benchmarks, forge-current-architecture-as-built — are
// deliberately excluded).
const EXPECTED_RESTORED_EDGES: Record<string, string[]> = {
  '2026-05-17-stale-brain-contradicts-code-pm-failure.md': ['brain-read-policy', 'brain-gap-feedback-loop'],
  '2026-05-17-demo-server-reuse-captures-stale-build.md': ['quality-gates-orchestrator-verified'],
  '2026-05-17-file-isolation-constraint-enables-single-iteration.md': ['spec-driven-work-items', 'dependency-ordered-work'],
  '2026-05-10-developer-ralph-brain-skip-on-second-wi.md': ['brain-read-policy', 'ralph-loop-pattern'],
  '2026-05-10-mvp-architecture-snapshot.md': ['karpathy-three-layer-wiki'],
  '2026-05-10-ui-canvas-overlay-pattern.md': ['episodic-not-cumulative-learnings'],
  '2026-05-16-structural-prerequisites-for-autonomy.md': [
    'merge-boundary-stacked-initiative-failure',
    'objective-gate-autonomous-closure',
  ],
  '2026-05-17-reviewer-budget-undersized-medium-initiatives.md': ['wedged-loop-detector', 'cost-aware-model-routing'],
};

// SUPERSET, not exact: a later reflector edit may ADD edges legitimately;
// what this pins is the class that lost them (related_themes dropped to []).
for (const [fileName, expectedEdges] of Object.entries(EXPECTED_RESTORED_EDGES)) {
  test(`central trafficGame theme ${fileName} carries its restored related_themes edges (kills a related_themes: [] regression)`, () => {
    const related = relatedThemesOf(fileName);
    for (const edge of expectedEdges) {
      assert.ok(
        related.includes(edge),
        `${fileName}: expected related_themes to include "${edge}", got ${JSON.stringify(related)}`,
      );
    }
  });
}

// test-stack-and-gates.md kept a central-only edge (2026-05-23-grading-frontier-infrastructure,
// added after the move) ON TOP OF its two restored edges — asserted separately
// so the fixture above isn't muddied by a non-lost, central-only addition.
test('central trafficGame theme 2026-05-10-test-stack-and-gates.md keeps its central-only edge AND carries its restored edges', () => {
  const related = relatedThemesOf('2026-05-10-test-stack-and-gates.md');
  for (const edge of ['2026-05-23-grading-frontier-infrastructure', 'tdd-with-agents', 'quality-gates-orchestrator-verified']) {
    assert.ok(related.includes(edge), `expected related_themes to include "${edge}", got ${JSON.stringify(related)}`);
  }
});

test('restored related_themes edges are not dangling (every restored slug resolves to a real theme file somewhere under brain/**/themes/)', () => {
  const findings = checkDanglingEdges(FORGE_ROOT);
  const trafficGameDangling = findings.filter((f) => f.file.includes(join('projects', 'trafficGame', 'themes')));
  assert.deepEqual(
    trafficGameDangling,
    [],
    `expected zero dangling related_themes entries under trafficGame themes, got ${JSON.stringify(trafficGameDangling)}`,
  );
});

test('2026-05-16-structural-prerequisites-for-autonomy.md has two DISTINCT Sources (kills the duplicated-link regression)', () => {
  const parsed = parseThemeFile(join(THEMES_DIR, '2026-05-16-structural-prerequisites-for-autonomy.md'));
  assert.ok(parsed, 'expected structural-prerequisites-for-autonomy.md to exist and parse');
  const match = parsed!.content.match(/^## Sources\n\n([\s\S]*?)\n\n## /m);
  assert.ok(match, 'expected a "## Sources" section followed by another heading');
  const bullets = match![1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
  assert.equal(bullets.length, 2, `expected exactly 2 Sources bullets, got ${JSON.stringify(bullets)}`);
  assert.notEqual(
    bullets[0],
    bullets[1],
    `expected two DISTINCT sources, got the same bullet twice: ${JSON.stringify(bullets)}`,
  );
  assert.match(bullets[1], /retro\.md/, `expected the second source to cite retro.md, got: ${bullets[1]}`);
});
