/**
 * Unit tests for brain-lint.ts.
 *
 * Each of the 7 checks (+ the warn-only contradictions stretch goal) gets at
 * least one positive (clean) and one negative (violation) case. Tests build a
 * tempdir brain corpus from minimal fixtures — they do not touch the live
 * brain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkCategoryScope,
  checkContradictions,
  checkDanglingEdges,
  checkDuplicateThemes,
  checkFrontmatter,
  checkIndexSync,
  checkLengthSoftCap,
  checkOrphans,
  checkProjectBrainIndexes,
  checkReflectorLoss,
  checkSourceLinks,
  checkStaleness,
  runBrainLint,
  classifyFinding,
  resolutionCounts,
  lintThemeFiles,
  CHECK_NAMES,
  CHECK_SCOPE,
  LINT_THEME_FILE_CHECKS,
  type Finding,
} from './brain-lint.ts';

// ---------- fixture builder ----------

type ThemeSpec = {
  /** Relative path under brain/ (e.g. `cycles/themes/foo.md`). */
  path: string;
  /** Frontmatter as a partial object — title/description/category/created_at/updated_at default to valid values when omitted. */
  fm?: Partial<{
    title: string;
    description: string;
    category: string;
    created_at: string;
    updated_at: string;
    keywords: string[];
    related_themes: string[];
  }>;
  /** Body markdown after frontmatter. */
  body?: string;
};

type BrainFixtureSpec = {
  themes: ThemeSpec[];
  /** Extra files at arbitrary paths (e.g. `INDEX.md`, `forge/patterns.md`, `projects/<n>/profile.md`). */
  extra?: Array<{ path: string; content: string }>;
};

function buildBrainFixture(spec: BrainFixtureSpec): string {
  const root = mkdtempSync(join(tmpdir(), 'brain-lint-test-'));
  const brain = join(root, 'brain');
  mkdirSync(brain, { recursive: true });

  // INDEX.md must always exist for orphan/index-sync checks.
  if (!spec.extra?.some((e) => e.path === 'INDEX.md')) {
    writeFileSync(join(brain, 'INDEX.md'), '# Brain\n\nnavigation hub.\n');
  }

  // Cycle-level category indexes — default to empty stubs so checkIndexSync has a target.
  for (const cat of ['patterns', 'antipatterns', 'decisions', 'operations']) {
    const p = join(brain, 'cycles', `${cat}.md`);
    mkdirSync(join(brain, 'cycles'), { recursive: true });
    if (!spec.extra?.some((e) => e.path === `cycles/${cat}.md`)) {
      writeFileSync(p, `# ${cat}\n`);
    }
  }
  // forge-dev/ category indexes
  for (const cat of ['decisions', 'reference']) {
    const p = join(brain, 'forge-dev', `${cat}.md`);
    mkdirSync(join(brain, 'forge-dev'), { recursive: true });
    if (!spec.extra?.some((e) => e.path === `forge-dev/${cat}.md`)) {
      writeFileSync(p, `# ${cat}\n`);
    }
  }
  mkdirSync(join(brain, 'cycles', 'themes'), { recursive: true });
  mkdirSync(join(brain, 'projects'), { recursive: true });

  for (const t of spec.themes) {
    const file = join(brain, t.path);
    mkdirSync(join(file, '..'), { recursive: true });
    const fm = {
      title: t.fm?.title ?? `theme-${t.path}`,
      description: t.fm?.description ?? 'description text.',
      category: t.fm?.category ?? 'pattern',
      created_at: t.fm?.created_at ?? '2026-01-01T00:00:00Z',
      updated_at: t.fm?.updated_at ?? '2026-01-01T00:00:00Z',
      keywords: t.fm?.keywords ?? [],
      related_themes: t.fm?.related_themes ?? [],
    };
    const lines = ['---'];
    for (const [k, v] of Object.entries(fm)) {
      if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
      else lines.push(`${k}: ${v}`);
    }
    lines.push('---');
    lines.push('');
    lines.push(t.body ?? '# theme body');
    writeFileSync(file, lines.join('\n') + '\n');
  }

  for (const e of spec.extra ?? []) {
    const file = join(brain, e.path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, e.content);
  }

  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

// ---------- checkFrontmatter ----------

// ---------- classification (resolution tier) ----------

const cf = (check: string, message: string): Finding => ({ category: 'error', file: '/x.md', message, check });

test('classifyFinding: AUTO tier — deterministic fixes', () => {
  assert.equal(classifyFinding(cf('checkIndexSync', 'not listed in category index: brain/cycles/patterns.md')).resolution, 'auto');
  assert.equal(classifyFinding(cf('checkIndexSync', 'listed 2 times in category index: x')).resolution, 'auto');
  assert.equal(classifyFinding(cf('checkOrphans', 'orphan: not linked from INDEX.md')).resolution, 'auto');
  assert.equal(classifyFinding(cf('checkCategoryScope', 'category "pattern" belongs in brain/cycles/themes/')).resolution, 'auto');
  assert.equal(classifyFinding(cf('checkFrontmatter', 'created_at > updated_at')).resolution, 'auto');
  assert.equal(classifyFinding(cf('checkFrontmatter', 'missing required frontmatter field: updated_at')).resolution, 'auto');
});

test('classifyFinding: AGENT tier — LLM-resolvable, carries a fixHint', () => {
  for (const m of [
    ['checkFrontmatter', 'missing required frontmatter field: description'],
    ['checkFrontmatter', 'unparseable frontmatter (gray-matter failed)'],
    ['checkSourceLinks', 'broken wikilink: [[foo-bar]]'],
    ['checkSourceLinks', 'broken link: ../x.md'],
    ['checkStaleness', 'stale citation (missing): orchestrator/gone.ts'],
    ['checkLengthSoftCap', 'theme too long: 142 body lines (hard cap 100)'],
    ['checkIndexSync', 'category index missing: brain/cycles/patterns.md'],
  ] as const) {
    const r = classifyFinding(cf(m[0], m[1]));
    assert.equal(r.resolution, 'agent', `${m[1]} → agent`);
    assert.ok(r.fixHint && r.fixHint.length > 0, `${m[1]} should carry a fixHint`);
  }
});

test('classifyFinding: USER tier — needs a human decision', () => {
  assert.equal(classifyFinding(cf('checkFrontmatter', 'category "bug" not in whitelist {pattern|...}')).resolution, 'user');
  assert.equal(classifyFinding(cf('checkContradictions', 'possible contradiction with x (3 keyword overlaps)')).resolution, 'user');
  assert.equal(classifyFinding(cf('checkCleanupCandidates', 'cleanup: tier-C (load-bearing — never auto)')).resolution, 'user');
  assert.equal(classifyFinding(cf('checkCleanupCandidates', 'cleanup: tier-B (routine, > 30 days old)')).resolution, 'user');
});

test('classifyFinding: unknown check → user (fail-safe, never silent auto-edit)', () => {
  assert.equal(classifyFinding(cf('checkNewThing', 'whatever')).resolution, 'user');
  assert.equal(classifyFinding(cf('checkNewThing', 'whatever')).kind, 'unknown');
});

test('resolutionCounts: tallies by tier (classifies unstamped findings)', () => {
  const counts = resolutionCounts([
    cf('checkOrphans', 'orphan: x'),
    cf('checkSourceLinks', 'broken wikilink: [[y]]'),
    cf('checkContradictions', 'possible contradiction with z'),
  ]);
  assert.deepEqual(counts, { auto: 1, agent: 1, user: 1 });
});

test('runBrainLint stamps every finding with kind + resolution', () => {
  // Reuse a fixture that produces findings: a theme missing from its index.
  const r = runBrainLint({ cwd: process.cwd(), scope: 'full' });
  for (const f of r.findings) {
    assert.ok(f.kind, `finding has a kind: ${f.message}`);
    assert.ok(f.resolution, `finding has a resolution: ${f.message}`);
  }
});

test('checkFrontmatter: clean theme produces no findings', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/clean.md', fm: { category: 'pattern' } }],
  });
  try {
    const findings = checkFrontmatter(root);
    assert.equal(findings.filter((f) => f.file.endsWith('clean.md')).length, 0);
  } finally {
    cleanup(root);
  }
});

test('checkFrontmatter: rejects category outside the whitelist (snapshot/process/bug-candidate)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/snap.md', fm: { category: 'snapshot' } },
      { path: 'cycles/themes/proc.md', fm: { category: 'process' } },
      { path: 'cycles/themes/bug.md', fm: { category: 'bug-candidate' } },
      { path: 'cycles/themes/ok.md', fm: { category: 'pattern' } },
    ],
  });
  try {
    const findings = checkFrontmatter(root);
    const errors = findings.filter((f) => f.category === 'error');
    assert.equal(errors.length, 3, 'three category violations');
    assert.ok(errors.some((e) => e.file.endsWith('snap.md')));
    assert.ok(errors.some((e) => e.file.endsWith('proc.md')));
    assert.ok(errors.some((e) => e.file.endsWith('bug.md')));
    assert.ok(!errors.some((e) => e.file.endsWith('ok.md')));
  } finally {
    cleanup(root);
  }
});

test('checkFrontmatter: flags missing required field (description)', () => {
  const root = buildBrainFixture({ themes: [] });
  // Hand-write a theme with no description.
  const file = join(root, 'brain', 'cycles', 'themes', 'no-desc.md');
  writeFileSync(
    file,
    `---
title: no-desc
category: pattern
created_at: 2026-01-01T00:00:00Z
updated_at: 2026-01-01T00:00:00Z
---

body.
`,
  );
  try {
    const findings = checkFrontmatter(root);
    const errors = findings.filter((f) => f.category === 'error' && f.file.endsWith('no-desc.md'));
    assert.ok(errors.length >= 1);
    assert.ok(errors.some((e) => /description/i.test(e.message)));
  } finally {
    cleanup(root);
  }
});

// ---------- checkIndexSync ----------

test('checkIndexSync: theme indexed in its category index produces no findings', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/myp.md', fm: { category: 'pattern' } }],
    extra: [
      { path: 'cycles/patterns.md', content: '# patterns\n\n- [`myp`](./themes/myp.md) — example.\n' },
    ],
  });
  try {
    const findings = checkIndexSync(root);
    assert.equal(findings.length, 0);
  } finally {
    cleanup(root);
  }
});

test('checkIndexSync: theme with category=pattern but missing from forge/patterns.md flags', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/orphaned-pattern.md', fm: { category: 'pattern' } }],
  });
  try {
    const findings = checkIndexSync(root);
    assert.ok(findings.some((f) => f.file.endsWith('orphaned-pattern.md') && /index/i.test(f.message)));
  } finally {
    cleanup(root);
  }
});

// ---------- checkSourceLinks ----------

test('checkSourceLinks: resolved relative link produces no findings', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/a.md', fm: { category: 'pattern' }, body: '## Sources\n\n- [other](./b.md)\n' },
      { path: 'cycles/themes/b.md', fm: { category: 'pattern' } },
    ],
  });
  try {
    const findings = checkSourceLinks(root);
    assert.equal(findings.filter((f) => f.file.endsWith('a.md')).length, 0);
  } finally {
    cleanup(root);
  }
});

test('checkSourceLinks: broken relative link errors', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/a.md', fm: { category: 'pattern' }, body: '## Sources\n\n- [gone](./does-not-exist.md)\n' },
    ],
  });
  try {
    const findings = checkSourceLinks(root);
    assert.ok(findings.some((f) => f.file.endsWith('a.md') && f.category === 'error'));
  } finally {
    cleanup(root);
  }
});

// ---------- checkStaleness ----------

test('checkStaleness: theme citing an existing path produces no error', () => {
  const root = buildBrainFixture({
    themes: [
      {
        path: 'cycles/themes/cite.md',
        fm: { category: 'pattern' },
        body: '## Sources\n\n- `orchestrator/cycle.ts` — main cycle runner.\n',
      },
    ],
  });
  try {
    // Create the cited file at forge root so the staleness check sees it.
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(join(root, 'orchestrator', 'cycle.ts'), '// stub\n');
    const findings = checkStaleness(root);
    assert.equal(findings.filter((f) => f.file.endsWith('cite.md') && f.category === 'error').length, 0);
  } finally {
    cleanup(root);
  }
});

test('checkStaleness: cycles theme citing a deleted forge-side path flags', () => {
  const root = buildBrainFixture({
    themes: [
      {
        path: 'cycles/themes/stale.md',
        fm: { category: 'antipattern' },
        body: '## Sources\n\n- `orchestrator/DeletedFile.ts` — was here.\n',
      },
    ],
  });
  try {
    // orchestrator/DeletedFile.ts does NOT exist in the temp forge root.
    const findings = checkStaleness(root);
    assert.ok(findings.some((f) => f.file.endsWith('stale.md') && /stale|missing/i.test(f.message)));
  } finally {
    cleanup(root);
  }
});

// ---------- checkOrphans ----------

test('checkOrphans: theme reachable from a category index produces no finding', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/reach.md', fm: { category: 'pattern' } }],
    extra: [
      { path: 'cycles/patterns.md', content: '# patterns\n\n- [`reach`](./themes/reach.md) — yes.\n' },
    ],
  });
  try {
    const findings = checkOrphans(root);
    assert.equal(findings.filter((f) => f.file.endsWith('reach.md')).length, 0);
  } finally {
    cleanup(root);
  }
});

test('checkOrphans: theme not linked from any index flags', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/lonely.md', fm: { category: 'pattern' } }],
  });
  try {
    const findings = checkOrphans(root);
    assert.ok(findings.some((f) => f.file.endsWith('lonely.md') && /orphan/i.test(f.message)));
  } finally {
    cleanup(root);
  }
});

// ---------- checkLengthSoftCap ----------

test('checkLengthSoftCap: short theme produces no finding', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/short.md', fm: { category: 'pattern' }, body: '# x\n' }],
  });
  try {
    const findings = checkLengthSoftCap(root);
    assert.equal(findings.filter((f) => f.file.endsWith('short.md')).length, 0);
  } finally {
    cleanup(root);
  }
});

test('checkLengthSoftCap: > 100 lines errors; 61-99 lines warns', () => {
  const longBody = Array.from({ length: 110 }, (_, i) => `line ${i}`).join('\n');
  const midBody = Array.from({ length: 75 }, (_, i) => `line ${i}`).join('\n');
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/long.md', fm: { category: 'pattern' }, body: longBody },
      { path: 'cycles/themes/mid.md', fm: { category: 'pattern' }, body: midBody },
    ],
  });
  try {
    const findings = checkLengthSoftCap(root);
    const longFinding = findings.find((f) => f.file.endsWith('long.md'));
    const midFinding = findings.find((f) => f.file.endsWith('mid.md'));
    assert.ok(longFinding && longFinding.category === 'error');
    assert.ok(midFinding && midFinding.category === 'flag');
  } finally {
    cleanup(root);
  }
});

test('checkLengthSoftCap: counts body lines, not frontmatter', () => {
  // 90-line body warns (>60) but does NOT error, even though raw file length
  // (body + the fixture's frontmatter) exceeds the 100 hard cap. Frontmatter
  // is structured metadata and must not count against the prose cap.
  const body95 = Array.from({ length: 95 }, (_, i) => `line ${i}`).join('\n');
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/bodycap.md', fm: { category: 'pattern' }, body: body95 }],
  });
  try {
    const finding = checkLengthSoftCap(root).find((f) => f.file.endsWith('bodycap.md'));
    assert.ok(finding && finding.category === 'flag', 'expected a soft-cap flag, not an error');
  } finally {
    cleanup(root);
  }
});

// ---------- checkContradictions (stretch, warn-only) ----------

test('checkContradictions: pattern + antipattern with overlapping keywords flags', () => {
  const root = buildBrainFixture({
    themes: [
      {
        path: 'cycles/themes/x-pattern.md',
        fm: { category: 'pattern', keywords: ['k1', 'k2', 'k3'] },
      },
      {
        path: 'cycles/themes/x-antipattern.md',
        fm: { category: 'antipattern', keywords: ['k1', 'k2', 'k3'] },
      },
    ],
  });
  try {
    const findings = checkContradictions(root);
    // Contradictions are warn-only — flag category.
    assert.ok(findings.some((f) => f.category === 'flag' && f.message.toLowerCase().includes('contradict')));
    // Never errors.
    assert.equal(findings.filter((f) => f.category === 'error').length, 0);
  } finally {
    cleanup(root);
  }
});

test('checkContradictions: pattern + antipattern with no keyword overlap produces no finding', () => {
  const root = buildBrainFixture({
    themes: [
      {
        path: 'cycles/themes/y-pattern.md',
        fm: { category: 'pattern', keywords: ['a', 'b', 'c'] },
      },
      {
        path: 'cycles/themes/y-antipattern.md',
        fm: { category: 'antipattern', keywords: ['d', 'e', 'f'] },
      },
    ],
  });
  try {
    const findings = checkContradictions(root);
    assert.equal(findings.filter((f) => f.message.toLowerCase().includes('contradict')).length, 0);
  } finally {
    cleanup(root);
  }
});

// ---------- runBrainLint (end-to-end) ----------

test('runBrainLint: full scope catches a mix of violations + clean themes', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/snap.md', fm: { category: 'snapshot' } }, // 1 category error
      { path: 'cycles/themes/ok.md', fm: { category: 'pattern' } }, // orphan flag (not in patterns.md)
    ],
  });
  try {
    const result = runBrainLint({ cwd: root, scope: 'full' });
    assert.ok(result.findings.some((f) => f.category === 'error' && /category/i.test(f.message)));
    assert.ok(result.exitCode === 1, 'errors → exit 1');
  } finally {
    cleanup(root);
  }
});

test('runBrainLint: clean corpus exits 0', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/c1.md', fm: { category: 'pattern' } }],
    extra: [
      { path: 'cycles/patterns.md', content: '# patterns\n\n- [`c1`](./themes/c1.md) — yes.\n' },
      {
        path: 'INDEX.md',
        content: '# Brain\n\n- [c1](./cycles/themes/c1.md)\n',
      },
    ],
  });
  try {
    const result = runBrainLint({ cwd: root, scope: 'full' });
    const errors = result.findings.filter((f) => f.category === 'error');
    assert.equal(errors.length, 0, `errors: ${JSON.stringify(errors)}`);
    assert.equal(result.exitCode, 0);
  } finally {
    cleanup(root);
  }
});

test('runBrainLint: single-file scope walks one file only', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/snap.md', fm: { category: 'snapshot' } },
      { path: 'cycles/themes/proc.md', fm: { category: 'process' } },
    ],
  });
  try {
    const result = runBrainLint({
      cwd: root,
      scope: 'single-file',
      file: 'brain/cycles/themes/snap.md',
    });
    const violationFiles = new Set(result.findings.map((f) => f.file));
    assert.ok(Array.from(violationFiles).every((f) => f.endsWith('snap.md')), 'only snap.md walked');
  } finally {
    cleanup(root);
  }
});

test('runBrainLint: forge-only scope skips project themes', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/forge-snap.md', fm: { category: 'snapshot' } },
      { path: 'projects/myproj/themes/proj-snap.md', fm: { category: 'snapshot' } },
    ],
    extra: [{ path: 'projects/myproj/profile.md', content: '# x\n' }],
  });
  try {
    const result = runBrainLint({ cwd: root, scope: 'forge-only' });
    assert.ok(result.findings.some((f) => f.file.endsWith('forge-snap.md')));
    assert.ok(!result.findings.some((f) => f.file.endsWith('proj-snap.md')));
  } finally {
    cleanup(root);
  }
});

test('runBrainLint: project-only scope returns no findings (project themes are in separate repos)', () => {
  // After the three-brain restructure, project themes live inside the project repo's own
  // brain/ directory and are NOT scanned by forge-side brain-lint. The project-only scope
  // is preserved for CLI backwards compat but returns no findings from forge.
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/forge-snap.md', fm: { category: 'snapshot' } },
    ],
  });
  try {
    const result = runBrainLint({ cwd: root, scope: 'project-only', project: 'p1' });
    assert.ok(!result.findings.some((f) => f.file.endsWith('forge-snap.md')), 'forge themes excluded from project-only scope');
    assert.equal(result.findings.filter((f) => /p1/.test(f.file)).length, 0);
  } finally {
    cleanup(root);
  }
});

test('runBrainLint: cleanup-dry-run scope is inventory-only — exits 0', () => {
  // cleanup-dry-run surfaces flags but never errors, so exitCode is always 0.
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/x.md', fm: { category: 'snapshot' } }],
  });
  try {
    const result = runBrainLint({ cwd: root, scope: 'cleanup-dry-run' });
    // All findings downgraded to flag — no errors.
    assert.equal(result.findings.filter((f) => f.category === 'error').length, 0);
    assert.equal(result.exitCode, 0);
  } finally {
    cleanup(root);
  }
});

// ---------- checkCategoryScope (brain gap #8) ----------

test('checkCategoryScope: correctly-routed pattern in cycles/themes/ produces no finding', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/good-pattern.md', fm: { category: 'pattern' } }],
  });
  try {
    const findings = checkCategoryScope(root);
    assert.equal(findings.filter((f) => f.file.endsWith('good-pattern.md')).length, 0);
  } finally {
    cleanup(root);
  }
});

test('checkCategoryScope: correctly-routed decision in forge-dev/themes/ produces no finding', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'forge-dev/themes/good-decision.md', fm: { category: 'decision' } }],
  });
  try {
    const findings = checkCategoryScope(root);
    assert.equal(findings.filter((f) => f.file.endsWith('good-decision.md')).length, 0);
  } finally {
    cleanup(root);
  }
});

test('checkCategoryScope: decision theme in cycles/themes/ (mis-routed) → error', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'cycles/themes/misrouted-decision.md', fm: { category: 'decision' } }],
  });
  try {
    const findings = checkCategoryScope(root);
    const f = findings.filter((f) => f.file.endsWith('misrouted-decision.md'));
    assert.equal(f.length, 1);
    assert.equal(f[0].category, 'error');
    assert.ok(f[0].message.includes('forge-dev'));
    assert.equal(f[0].check, 'checkCategoryScope');
  } finally {
    cleanup(root);
  }
});

test('checkCategoryScope: antipattern theme in forge-dev/themes/ (mis-routed) → error', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'forge-dev/themes/misrouted-antipattern.md', fm: { category: 'antipattern' } }],
  });
  try {
    const findings = checkCategoryScope(root);
    const f = findings.filter((f) => f.file.endsWith('misrouted-antipattern.md'));
    assert.equal(f.length, 1);
    assert.equal(f[0].category, 'error');
    assert.ok(f[0].message.includes('cycles'));
    assert.equal(f[0].check, 'checkCategoryScope');
  } finally {
    cleanup(root);
  }
});

test('checkCategoryScope: reference theme in forge-dev/themes/ (correctly routed) produces no finding', () => {
  const root = buildBrainFixture({
    themes: [{ path: 'forge-dev/themes/good-reference.md', fm: { category: 'reference' } }],
  });
  try {
    const findings = checkCategoryScope(root);
    assert.equal(findings.filter((f) => f.file.endsWith('good-reference.md')).length, 0);
  } finally {
    cleanup(root);
  }
});

test('checkCategoryScope: real brain has 0 scope-guard errors', async () => {
  // This test asserts the real brain is clean under the scope-guard rule.
  // If it fails, that is a genuine brain data inconsistency (not a test bug).
  const { resolve: nodeResolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = nodeResolve(fileURLToPath(import.meta.url), '..', '..');
  const findings = checkCategoryScope(dir);
  const errors = findings.filter((f) => f.category === 'error');
  assert.equal(
    errors.length,
    0,
    `Real brain has ${errors.length} mis-routed theme(s):\n${errors.map((f) => `  ${f.file}: ${f.message}`).join('\n')}`,
  );
});

// ---------- checkReflectorLoss ----------

/** Minimal forgeRoot fixture: `_queue/done/` + `brain/cycles/_raw/`, no brain/ theme scaffolding needed. */
function buildQueueFixture(opts: {
  doneManifests?: string[]; // initiative ids
  archives?: string[]; // filenames under brain/cycles/_raw/
  omitDoneDir?: boolean;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'brain-lint-reflector-test-'));
  if (!opts.omitDoneDir) {
    const doneDir = join(root, '_queue', 'done');
    mkdirSync(doneDir, { recursive: true });
    for (const id of opts.doneManifests ?? []) {
      writeFileSync(
        join(doneDir, `${id}.md`),
        `---\ninitiative_id: ${id}\nproject: demo\n---\n\nbody\n`,
      );
    }
  }
  if (opts.archives && opts.archives.length > 0) {
    const rawDir = join(root, 'brain', 'cycles', '_raw');
    mkdirSync(rawDir, { recursive: true });
    for (const name of opts.archives) {
      writeFileSync(join(rawDir, name), '# archive\n');
    }
  }
  return root;
}

test('checkReflectorLoss: done manifest with a matching archive produces no finding', () => {
  const root = buildQueueFixture({
    doneManifests: ['INIT-2026-07-01-foo'],
    archives: ['2026-07-01T10-00-00_INIT-2026-07-01-foo.md'],
  });
  try {
    const findings = checkReflectorLoss(root);
    assert.equal(findings.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkReflectorLoss: done manifest with no matching archive is flagged (advisory)', () => {
  const root = buildQueueFixture({
    doneManifests: ['INIT-2026-07-01-bar'],
    archives: [],
  });
  try {
    const findings = checkReflectorLoss(root);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].category, 'flag');
    assert.equal(findings[0].check, 'checkReflectorLoss');
    assert.match(findings[0].message, /INIT-2026-07-01-bar/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkReflectorLoss: an unrelated archive does not satisfy the match (no false negative)', () => {
  const root = buildQueueFixture({
    doneManifests: ['INIT-2026-07-01-gallery'],
    // Longer id that merely starts with the same prefix must NOT count as a match.
    archives: ['2026-07-01T10-00-00_INIT-2026-07-01-gallery-extensionmanagement.md'],
  });
  try {
    const findings = checkReflectorLoss(root);
    assert.equal(findings.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkReflectorLoss: any of multiple archives for the same initiative satisfies the match', () => {
  const root = buildQueueFixture({
    doneManifests: ['INIT-2026-07-01-baz'],
    archives: [
      '2026-07-01T10-00-00_INIT-2026-07-01-baz.md',
      '2026-07-02T11-30-00_INIT-2026-07-01-baz.md',
    ],
  });
  try {
    const findings = checkReflectorLoss(root);
    assert.equal(findings.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkReflectorLoss: no-ops gracefully when _queue/done/ does not exist', () => {
  const root = buildQueueFixture({ omitDoneDir: true });
  try {
    const findings = checkReflectorLoss(root);
    assert.equal(findings.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkReflectorLoss: classifies as an advisory user-tier finding', () => {
  const { kind, resolution } = classifyFinding(
    cf('checkReflectorLoss', 'no reflection archive found for INIT-2026-07-01-bar in brain/cycles/_raw/'),
  );
  assert.equal(kind, 'reflector.loss');
  assert.equal(resolution, 'user');
});

// ---------- checkProjectBrainIndexes ----------

function writeProjectTheme(root: string, project: string, slug: string, category: string): void {
  const themes = join(root, 'brain', 'projects', project, 'themes');
  mkdirSync(themes, { recursive: true });
  writeFileSync(
    join(themes, `${slug}.md`),
    `---\ntitle: ${slug}\ndescription: d\ncategory: ${category}\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\n---\nbody\n`,
  );
}

function writeProjectIndex(root: string, project: string, file: string, body: string): void {
  writeFileSync(join(root, 'brain', 'projects', project, file), body);
}

test('checkProjectBrainIndexes: theme listed in its project category index → no finding', () => {
  const root = mkdtempSync(join(tmpdir(), 'brainpb-'));
  try {
    writeProjectTheme(root, 'demo', 'x-thing', 'antipattern');
    writeProjectIndex(root, 'demo', 'antipatterns.md', '# demo — Antipatterns\n\n- [`x-thing`](./themes/x-thing.md) — d\n');
    assert.equal(checkProjectBrainIndexes(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkProjectBrainIndexes: theme absent from an existing category index → flag', () => {
  const root = mkdtempSync(join(tmpdir(), 'brainpb-'));
  try {
    writeProjectTheme(root, 'demo', 'x-thing', 'antipattern');
    writeProjectIndex(root, 'demo', 'antipatterns.md', '# demo — Antipatterns\n\n- [`other`](./themes/other.md) — d\n');
    const findings = checkProjectBrainIndexes(root);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].category, 'flag');
    assert.equal(findings[0].check, 'checkProjectBrainIndexes');
    assert.match(findings[0].message, /not listed in project category index/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkProjectBrainIndexes: project with themes but no index files → single flag', () => {
  const root = mkdtempSync(join(tmpdir(), 'brainpb-'));
  try {
    writeProjectTheme(root, 'demo', 'a', 'pattern');
    writeProjectTheme(root, 'demo', 'b', 'pattern');
    const findings = checkProjectBrainIndexes(root);
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /no category index files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('classifyFinding: checkProjectBrainIndexes → agent tier with fixHint', () => {
  const f = classifyFinding(cf('checkProjectBrainIndexes', 'not listed in project category index: x'));
  assert.equal(f.resolution, 'agent');
  assert.equal(f.kind, 'index.project');
  assert.ok(f.fixHint && f.fixHint.length > 0);
});

// ---------- CHECK_NAMES drift guard (R6-08 4on, F3) ----------

/**
 * F3 hardening: `runBrainLint` now iterates a single `FULL_SCOPE_CHECKS`
 * registry that `CHECK_NAMES` is ALSO derived from (kept private/unexported —
 * `CHECK_NAMES` and `CHECK_SCOPE` are the intended public surface), so the two
 * can no longer drift apart BY CONSTRUCTION. This test is the independent,
 * fixture-based verification the WI calls for: a maximal fixture engineered
 * to trip every one of the 10 full-scope checks simultaneously, asserting the
 * set of `check` names `runBrainLint(scope:'full')` actually EMITS findings
 * under is EXACTLY `CHECK_NAMES` — no more, no fewer. A future edit that
 * re-introduces two separate hand-typed lists (the exact shape that caused
 * the original MAJOR — `CHECK_NAMES` hand-duplicated in
 * cli/bridge-studio-kbs.test.ts instead of imported) and lets them drift
 * would fail this test, because it exercises REAL runtime behavior, not the
 * internal wiring.
 */
test('CHECK_NAMES drift guard: a maximal fixture tripping every check emits findings under EXACTLY the CHECK_NAMES set', () => {
  const root = buildBrainFixture({
    themes: [
      // checkFrontmatter (missing description) + checkIndexSync + checkOrphans
      // (never linked from any category index / INDEX.md — the default stub
      // indexes carry no entries).
      { path: 'cycles/themes/max-a.md', fm: { category: 'pattern', description: '' }, body: '# Max A\n\nFixture body.\n' },

      // checkSourceLinks (broken relative link + broken wikilink) + checkStaleness
      // (a cited forge-internal path that does not exist).
      {
        path: 'cycles/themes/max-b.md',
        fm: { category: 'pattern' },
        body:
          '# Max B\n\nBroken link: [bad](./does-not-exist.md)\n\nBroken wikilink: [[no-such-theme-xyz]]\n\n' +
          'Stale citation: `orchestrator/does-not-exist-xyz.ts`\n',
      },

      // checkLengthSoftCap (hard cap, > 100 body lines).
      {
        path: 'cycles/themes/max-c.md',
        fm: { category: 'pattern' },
        body: '# Max C\n\n' + Array.from({ length: 110 }, (_, i) => `line ${i}`).join('\n') + '\n',
      },

      // checkContradictions — a pattern/antipattern pair sharing >=3 keywords.
      {
        path: 'cycles/themes/max-d-pattern.md',
        fm: { category: 'pattern', keywords: ['alpha', 'beta', 'gamma', 'delta'] },
        body: '# Max D Pattern\n',
      },
      {
        path: 'cycles/themes/max-e-antipattern.md',
        fm: { category: 'antipattern', keywords: ['alpha', 'beta', 'gamma', 'epsilon'] },
        body: '# Max E Antipattern\n',
      },

      // checkCategoryScope — a `decision` theme mis-routed into cycles/themes/
      // (decisions belong in forge-dev/themes/).
      { path: 'cycles/themes/max-f.md', fm: { category: 'decision' }, body: '# Max F\n' },

      // checkDanglingEdges — a related_themes slug that resolves nowhere
      // under brain/**/themes/.
      { path: 'cycles/themes/max-g.md', fm: { category: 'pattern', related_themes: ['max-slug-does-not-exist-xyz'] }, body: '# Max G\n' },

      // checkDuplicateThemes — a title-normalization collision pair.
      { path: 'cycles/themes/max-h-dup1.md', fm: { category: 'pattern', title: 'Max Duplicate Pair' }, body: '# Max H\n' },
      { path: 'cycles/themes/max-i-dup2.md', fm: { category: 'pattern', title: 'max duplicate pair!' }, body: '# Max I\n' },
    ],
  });
  try {
    // checkProjectBrainIndexes — a project theme with no category index files.
    writeProjectTheme(root, 'max-project', 'max-proj-theme', 'pattern');

    // checkReflectorLoss — a `_queue/done/` manifest with no matching archive
    // (brain/cycles/_raw/ is never created by buildBrainFixture, so ANY
    // manifest here is automatically unmatched).
    const doneDir = join(root, '_queue', 'done');
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(join(doneDir, 'MAX-LOST-INIT.md'), '---\ninitiative_id: MAX-LOST-INIT\n---\n\nbody\n');

    const { findings } = runBrainLint({ cwd: root, scope: 'full' });
    const tripped = new Set(findings.map((f) => f.check).filter((c): c is string => Boolean(c)));

    const expected = [...CHECK_NAMES].sort();
    const actual = [...tripped].sort();
    assert.deepEqual(
      actual,
      expected,
      `maximal fixture must trip findings under EXACTLY the CHECK_NAMES set. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (missing: ${JSON.stringify(expected.filter((n) => !actual.includes(n)))}, extra: ${JSON.stringify(actual.filter((n) => !expected.includes(n)))})`,
    );
  } finally {
    cleanup(root);
  }
});

// =============================================================================
// checkDanglingEdges (R4-19-F2) — related_themes entries that resolve nowhere.
// =============================================================================

test('checkDanglingEdges: a related_themes slug with no matching theme file anywhere produces exactly one finding naming the file and the slug (kills a no-op / unimplemented check)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/has-dangler.md', fm: { related_themes: ['does-not-exist'] } },
    ],
  });
  try {
    const findings = checkDanglingEdges(root);
    const hits = findings.filter((f) => f.file.endsWith('has-dangler.md'));
    assert.equal(hits.length, 1, `expected exactly one finding, got ${JSON.stringify(findings)}`);
    assert.equal(hits[0].check, 'checkDanglingEdges');
    assert.match(hits[0].message, /does-not-exist/);
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges: a related_themes slug resolving in a DIFFERENT forge sub-wiki (cycles -> forge-dev) is NOT dangling (kills a naive same-directory-only / same-sub-wiki-only slug resolution)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/a.md', fm: { related_themes: ['b'] } },
      { path: 'forge-dev/themes/b.md', fm: {} },
    ],
  });
  try {
    const findings = checkDanglingEdges(root);
    assert.equal(
      findings.filter((f) => f.file.endsWith('a.md')).length,
      0,
      `slug "b" resolves in brain/forge-dev/themes/ — must not be reported dangling, got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges: two bad slugs in one theme yields two findings (kills an implementation that dedupes per-file rather than per-slug)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/multi.md', fm: { related_themes: ['missing-one', 'missing-two'] } },
    ],
  });
  try {
    const findings = checkDanglingEdges(root).filter((f) => f.file.endsWith('multi.md'));
    assert.equal(findings.length, 2, `expected two findings (one per bad slug), got ${JSON.stringify(findings)}`);
    assert.ok(findings.some((f) => /missing-one/.test(f.message)));
    assert.ok(findings.some((f) => /missing-two/.test(f.message)));
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges: a theme with no related_themes key at all produces zero findings and does not crash (kills an implementation that assumes the field always exists / throws on undefined)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    // Planted directly on disk WITHOUT the related_themes key — buildBrainFixture's
    // ThemeSpec always writes `related_themes: []`, which is a different (and
    // easier) shape than "key absent entirely". Many real themes predate the
    // field, so the check must tolerate `data.related_themes === undefined`.
    writeFileSync(
      join(root, 'brain', 'cycles', 'themes', 'nokey.md'),
      '---\ntitle: No Key\ndescription: none.\ncategory: pattern\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\n---\n\n# No Key\n',
    );
    const findings = checkDanglingEdges(root);
    assert.equal(findings.length, 0, `expected no findings/crash, got ${JSON.stringify(findings)}`);
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges: related_themes entries with a trailing ".md" suffix, surrounding whitespace, or both, normalize and resolve when the target theme exists — zero findings (kills replacing the trim()/".md"-strip normalization with a bare String(rawEntry))', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/norm-target.md', fm: {} },
      { path: 'cycles/themes/norm-suffix.md', fm: { related_themes: ['norm-target.md'] } },
      { path: 'cycles/themes/norm-whitespace.md', fm: { related_themes: ['  norm-target  '] } },
      { path: 'cycles/themes/norm-both.md', fm: { related_themes: ['  norm-target.md  '] } },
    ],
  });
  try {
    const findings = checkDanglingEdges(root);
    const hits = findings.filter(
      (f) =>
        f.file.endsWith('norm-suffix.md') ||
        f.file.endsWith('norm-whitespace.md') ||
        f.file.endsWith('norm-both.md'),
    );
    assert.equal(
      hits.length,
      0,
      `".md"-suffixed / whitespace-padded related_themes entries must normalize and resolve against the existing target, got ${JSON.stringify(hits)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges MIRROR: a whitespace-and-".md"-padded related_themes entry that still does not resolve after normalization DOES fire (kills a normalization "fix" that degenerates into never reporting anything)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/norm-unresolvable.md', fm: { related_themes: ['  really-does-not-exist.md  '] } },
    ],
  });
  try {
    const hits = checkDanglingEdges(root).filter((f) => f.file.endsWith('norm-unresolvable.md'));
    assert.equal(hits.length, 1, `expected exactly one finding for the unresolvable normalized slug, got ${JSON.stringify(hits)}`);
    assert.match(hits[0].message, /really-does-not-exist/);
  } finally {
    cleanup(root);
  }
});

test('checkDanglingEdges: a bare-scalar (non-array) related_themes value is a DELIBERATE no-op — zero findings even though the slug does not exist anywhere (kills an unreviewed "improvement" that starts scanning scalar related_themes and silently diverges the lint from the graph it audits)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    // Planted directly on disk: `related_themes: some-slug` as a bare YAML
    // scalar (NOT `related_themes: [some-slug]`) — buildBrainFixture's
    // ThemeSpec is typed to `string[]` and always emits the array form, so
    // this shape can only be produced by hand-writing the file.
    //
    // WHY this is a deliberate pin, not an accidental gap:
    //   (a) MIRRORS orchestrator/kb-graph.ts:327-329's own
    //       `Array.isArray(parsed?.data.related_themes) ? (...) : []` guard —
    //       the graph builder treats a non-array related_themes as "no edges
    //       declared" and never attempts to resolve it. If this lint check
    //       scanned scalar values, it would report an edge as "broken" that
    //       the graph never tried to build in the first place — going
    //       STRICTER than the graph, not matching it.
    //   (b) Known blind spot, not an oversight: a genuinely-scalar
    //       `related_themes: some-slug` (vs. the array form) is a real
    //       authoring mistake the graph silently drops today with zero
    //       signal anywhere. It is a filed, tracked gap (this test IS that
    //       tracking record, alongside the `danglingEdgeFindings`
    //       "tolerate missing/absent/non-array" comment a few lines above in
    //       cli/brain-lint.ts and the sibling cross-KB gap documented in
    //       `checkDanglingEdges`'s own doc comment). Zero occurrences exist
    //       in the live 364-theme corpus as of 2026-08-14, which is why it
    //       is parked rather than fixed now.
    //   (c) EXPIRY CONDITION (immutable-gates: a deliberately-green gap-pin
    //       must document when it should be revisited) — THIS TEST MUST
    //       FLIP the moment orchestrator/kb-graph.ts starts coercing or
    //       otherwise honouring a scalar `related_themes` value into a real
    //       edge (i.e. the day the `Array.isArray(...)` guard at
    //       kb-graph.ts:327 is loosened/removed). Until then, staying a
    //       no-op here is correct; going stricter than the graph is the bug.
    writeFileSync(
      join(root, 'brain', 'cycles', 'themes', 'scalar-related.md'),
      '---\ntitle: Scalar Related\ndescription: none.\ncategory: pattern\ncreated_at: 2026-01-01T00:00:00Z\nupdated_at: 2026-01-01T00:00:00Z\nrelated_themes: definitely-does-not-exist-anywhere\n---\n\n# Scalar Related\n',
    );
    const findings = checkDanglingEdges(root).filter((f) => f.file.endsWith('scalar-related.md'));
    assert.equal(
      findings.length,
      0,
      `a bare-scalar related_themes value must be a no-op (mirrors kb-graph.ts:327-329's Array.isArray guard), got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

// =============================================================================
// checkDuplicateThemes (R4-19-F2) — near-duplicate theme pairs.
// =============================================================================

test('checkDuplicateThemes: two themes whose titles normalize to the same string are flagged as a pair (kills an implementation that only does exact-string title equality, no normalization)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/dup-a.md', fm: { title: 'The Same Thing' } },
      { path: 'cycles/themes/dup-b.md', fm: { title: 'the same thing!' } },
    ],
  });
  try {
    const findings = checkDuplicateThemes(root);
    assert.equal(findings.length, 1, `expected exactly one pair finding, got ${JSON.stringify(findings)}`);
    assert.equal(findings[0].check, 'checkDuplicateThemes');
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: keywords Jaccard >= 0.8 (8/10, distinct titles) fires (kills an implementation that never implements the keywords clause and only checks titles)', () => {
  const common = ['kw-1', 'kw-2', 'kw-3', 'kw-4', 'kw-5', 'kw-6', 'kw-7', 'kw-8'];
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/kwdup-a.md', fm: { keywords: [...common, 'only-a'] } },
      { path: 'cycles/themes/kwdup-b.md', fm: { keywords: [...common, 'only-b'] } },
    ],
  });
  try {
    // Precondition: distinct (default) titles, so a title-only implementation
    // could not accidentally pass this test.
    const findings = checkDuplicateThemes(root);
    const hits = findings.filter(
      (f) => f.file.endsWith('kwdup-a.md') || f.file.endsWith('kwdup-b.md'),
    );
    assert.equal(hits.length, 1, `expected exactly one pair finding (8/10 = 0.8 Jaccard), got ${JSON.stringify(findings)}`);
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes NEGATIVE: two themes sharing only 1 of 4 keywords (Jaccard ~0.14) and distinct titles produce zero findings (kills a too-loose Jaccard threshold)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/lowj-a.md', fm: { keywords: ['w1', 'w2', 'w3', 'w4'] } },
      { path: 'cycles/themes/lowj-b.md', fm: { keywords: ['w1', 'x2', 'x3', 'x4'] } },
    ],
  });
  try {
    const findings = checkDuplicateThemes(root).filter(
      (f) => f.file.endsWith('lowj-a.md') || f.file.endsWith('lowj-b.md'),
    );
    assert.equal(findings.length, 0, `low-overlap keyword sets must not be flagged, got ${JSON.stringify(findings)}`);
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes NEGATIVE: two themes with 2 identical keywords each (below the >=3 minimum) and distinct titles produce zero findings (kills a too-loose "any keyword overlap" implementation that ignores the minimum-declared-keywords floor)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/thin-a.md', fm: { keywords: ['p1', 'p2'] } },
      { path: 'cycles/themes/thin-b.md', fm: { keywords: ['p1', 'p2'] } },
    ],
  });
  try {
    const findings = checkDuplicateThemes(root).filter(
      (f) => f.file.endsWith('thin-a.md') || f.file.endsWith('thin-b.md'),
    );
    assert.equal(
      findings.length,
      0,
      `identical-but-thin (2-keyword) sets are below the >=3 minimum and must not be flagged, got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: DUPLICATE_KEYWORD_MIN_DECLARED boundary — exactly 3 declared keywords each with a qualifying Jaccard DOES fire, exactly 2 declared keywords each (otherwise identical) does NOT (kills mutating the ">=3" floor comparisons to ">3")', () => {
  const root = buildBrainFixture({
    themes: [
      // Exactly 3 keywords each, identical sets -> Jaccard 3/3 = 1.0 (>= 0.8),
      // landing exactly ON the >=3-declared floor. Distinct default titles
      // rule out a title-collision false positive.
      { path: 'cycles/themes/floor3-a.md', fm: { keywords: ['f1', 'f2', 'f3'] } },
      { path: 'cycles/themes/floor3-b.md', fm: { keywords: ['f1', 'f2', 'f3'] } },
      // Exactly 2 keywords each (one below the floor), identical sets ->
      // Jaccard 1.0 but below the >=3-declared floor -> must NOT fire.
      { path: 'cycles/themes/floor2-a.md', fm: { keywords: ['g1', 'g2'] } },
      { path: 'cycles/themes/floor2-b.md', fm: { keywords: ['g1', 'g2'] } },
    ],
  });
  try {
    const findings = checkDuplicateThemes(root);
    const at3 = findings.filter((f) => f.file.endsWith('floor3-a.md') || f.file.endsWith('floor3-b.md'));
    const at2 = findings.filter((f) => f.file.endsWith('floor2-a.md') || f.file.endsWith('floor2-b.md'));
    assert.equal(at3.length, 1, `exactly-3-declared-keywords pair AT the floor must fire, got ${JSON.stringify(at3)}`);
    assert.equal(at2.length, 0, `exactly-2-declared-keywords pair BELOW the floor must not fire, got ${JSON.stringify(at2)}`);
  } finally {
    cleanup(root);
  }
});

test('checkDuplicateThemes: reports exactly ONE finding per pair, on the lexicographically-LATER path, with the partner file named in the message (kills a double-reporting implementation that emits one finding per file)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/aaa-first.md', fm: { title: 'Lexicographic Duplicate' } },
      { path: 'cycles/themes/zzz-second.md', fm: { title: 'lexicographic duplicate' } },
    ],
  });
  try {
    const findings = checkDuplicateThemes(root).filter(
      (f) => f.file.endsWith('aaa-first.md') || f.file.endsWith('zzz-second.md'),
    );
    assert.equal(findings.length, 1, `expected exactly ONE finding for the pair (not one per file), got ${JSON.stringify(findings)}`);
    assert.ok(
      findings[0].file.endsWith('zzz-second.md'),
      `finding must be filed on the lexicographically-later path (zzz-second.md), got ${findings[0].file}`,
    );
    assert.match(
      findings[0].message,
      /aaa-first\.md/,
      `message must name the partner file (aaa-first.md), got: ${findings[0].message}`,
    );
  } finally {
    cleanup(root);
  }
});

// =============================================================================
// Severity lock (R4-19-F2) — the two new checks must NEVER be 'error'.
// =============================================================================

test('SEVERITY LOCK: a fixture whose ONLY problems are one dangling edge and one duplicate pair keeps runBrainLint exitCode 0, with every finding from the two new checks category:"flag" (kills an implementation that raises them as errors and silently breaks the `forge brain lint` gate)', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/lone.md', fm: { title: 'Lone Theme', related_themes: ['missing-slug'] } },
      { path: 'cycles/themes/dup-x.md', fm: { title: 'Duplicate Title' } },
      { path: 'cycles/themes/dup-y.md', fm: { title: 'duplicate title!' } },
    ],
    extra: [
      {
        path: 'cycles/patterns.md',
        content:
          '# patterns\n\n' +
          '- [Lone Theme](./themes/lone.md)\n' +
          '- [Duplicate Title](./themes/dup-x.md)\n' +
          '- [Duplicate Title Two](./themes/dup-y.md)\n',
      },
    ],
  });
  try {
    const { findings, exitCode } = runBrainLint({ cwd: root, scope: 'full' });
    assert.equal(exitCode, 0, `exitCode must be 0 (flag-only fixture), got ${exitCode}. Findings: ${JSON.stringify(findings)}`);

    const relevant = findings.filter(
      (f) => f.check === 'checkDanglingEdges' || f.check === 'checkDuplicateThemes',
    );
    assert.equal(
      relevant.length,
      2,
      `expected exactly 2 findings total (1 dangling + 1 duplicate pair), got ${JSON.stringify(findings)}`,
    );
    for (const f of relevant) {
      assert.equal(f.category, 'flag', `${f.check} finding must be category:'flag', never 'error', got ${JSON.stringify(f)}`);
    }
    // This fixture is otherwise squeaky-clean (linked, no broken links, no
    // mis-routing, no length/contradiction/project/reflector issues) — so the
    // two new-check findings really are the ONLY problems, not merely a
    // filtered subset of a noisier fixture.
    assert.equal(
      findings.length,
      2,
      `fixture must be otherwise clean — any other finding means the fixture isn't isolating the two new checks. Got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

// =============================================================================
// Registration contract (R4-19-F2) — CHECK_NAMES / CHECK_SCOPE / LINT_THEME_FILE_CHECKS.
// =============================================================================

test('CHECK_NAMES: exactly the 12 expected full-scope check names (kills a registration that adds the check function but forgets to append it to FULL_SCOPE_CHECKS)', () => {
  const expected = [
    'checkFrontmatter',
    'checkIndexSync',
    'checkSourceLinks',
    'checkStaleness',
    'checkOrphans',
    'checkProjectBrainIndexes',
    'checkLengthSoftCap',
    'checkContradictions',
    'checkCategoryScope',
    'checkReflectorLoss',
    'checkDanglingEdges',
    'checkDuplicateThemes',
  ];
  assert.equal(CHECK_NAMES.length, 12, `expected 12 full-scope checks, got ${CHECK_NAMES.length}: ${JSON.stringify(CHECK_NAMES)}`);
  assert.deepEqual(
    [...CHECK_NAMES].sort(),
    [...expected].sort(),
    `CHECK_NAMES must be exactly the expected 12-name set, got ${JSON.stringify(CHECK_NAMES)}`,
  );
});

test('CHECK_SCOPE: both new checks map to "forge-themes", and every CHECK_NAMES entry has a CHECK_SCOPE mapping (kills a registration that updates CHECK_NAMES but forgets CHECK_SCOPE, silently defaulting per-KB health to a false verdict)', () => {
  assert.equal(CHECK_SCOPE['checkDanglingEdges'], 'forge-themes');
  assert.equal(CHECK_SCOPE['checkDuplicateThemes'], 'forge-themes');
  for (const name of CHECK_NAMES) {
    assert.ok(name in CHECK_SCOPE, `CHECK_SCOPE is missing an entry for "${name}" (CHECK_NAMES/CHECK_SCOPE drift)`);
  }
});

test('LINT_THEME_FILE_CHECKS: declares both new checks AND lintThemeFiles(forgeRoot, files) actually emits findings under both check names (kills declaring membership without implementing it — the declared-data-fails-open shape)', () => {
  assert.ok(LINT_THEME_FILE_CHECKS.has('checkDanglingEdges'), 'LINT_THEME_FILE_CHECKS must include checkDanglingEdges');
  assert.ok(LINT_THEME_FILE_CHECKS.has('checkDuplicateThemes'), 'LINT_THEME_FILE_CHECKS must include checkDuplicateThemes');

  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/lf-dangler.md', fm: { related_themes: ['lf-nowhere-slug'] } },
      { path: 'cycles/themes/lf-dup-a.md', fm: { title: 'Lint File Dup' } },
      { path: 'cycles/themes/lf-dup-b.md', fm: { title: 'lint file dup' } },
    ],
  });
  try {
    const files = [
      join(root, 'brain', 'cycles', 'themes', 'lf-dangler.md'),
      join(root, 'brain', 'cycles', 'themes', 'lf-dup-a.md'),
      join(root, 'brain', 'cycles', 'themes', 'lf-dup-b.md'),
    ];
    const findings = lintThemeFiles(root, files);
    assert.ok(
      findings.some((f) => f.check === 'checkDanglingEdges'),
      `lintThemeFiles must emit a checkDanglingEdges finding for the seeded dangling edge, got ${JSON.stringify(findings)}`,
    );
    assert.ok(
      findings.some((f) => f.check === 'checkDuplicateThemes'),
      `lintThemeFiles must emit a checkDuplicateThemes finding for the seeded duplicate pair, got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// W7 FIX-B-KB — parse-cache poisoning + per-KB checkCategoryScope scope
// ---------------------------------------------------------------------------

test('lintThemeFiles: frontmatter parsing is order-independent — a prior parse of the same invalid-YAML content must not poison a later read into phantom missing-field findings (W7 FIX-B-KB, kb-maintain consolidate regression)', () => {
  // gray-matter throws on this description's unquoted `: ` — parseTheme's
  // lenient fallback recovers the fields. But gray-matter populates its
  // module-level cache BEFORE the parse throws, so a SECOND parse of the
  // byte-identical content silently returned `data: {}` from the poisoned
  // cache and the fallback never ran. Journey sequence that hit this:
  // checkProjectBrainIndexes parsed the theme first (fallback fine), then
  // collectKbFindings' own-theme lens re-parsed it and invented five
  // "missing required frontmatter field" findings for fields plainly
  // present — three of them agent-tier, so consolidate could never reach
  // cleared under no-spawn (the kb-maintain "not-cleared" gate failure).
  const root = mkdtempSync(join(tmpdir(), 'brain-lint-cache-'));
  try {
    const themesDir = join(root, 'brain', 'projects', 'poison-kb', 'themes');
    mkdirSync(themesDir, { recursive: true });
    const file = join(themesDir, 'colon-desc.md');
    writeFileSync(file, [
      '---',
      'title: Colon description fixture',
      // Unique per run so a previous process/test never pre-poisons it; the
      // two reads under test share the SAME content within this test.
      `description: A scratch lint fixture: unquoted colon makes gray-matter throw (poison-${Date.now()})`,
      'category: pattern',
      'created_at: 2026-01-01T00:00:00Z',
      'updated_at: 2026-01-01T00:00:00Z',
      '---',
      '',
      '# body',
      '',
    ].join('\n'));
    const first = lintThemeFiles(root, [file]).filter((f) => f.check === 'checkFrontmatter');
    const second = lintThemeFiles(root, [file]).filter((f) => f.check === 'checkFrontmatter');
    assert.deepEqual(first, [], `first pass must recover every field via the lenient fallback, got ${JSON.stringify(first)}`);
    assert.deepEqual(second, [], `second pass of the SAME content must match the first — phantom findings here mean a poisoned parse cache, got ${JSON.stringify(second)}`);
  } finally {
    cleanup(root);
  }
});

test('lintThemeFiles: checkCategoryScope governs ONLY the forge sub-wikis — a scratch/band KB\'s own themes are never flagged mis-routed (W7 FIX-B-KB: the auto-tier mover that would drag scratch themes into brain/cycles|forge-dev)', () => {
  const root = mkdtempSync(join(tmpdir(), 'brain-lint-catscope-'));
  try {
    // A category-bearing theme in a top-level NON-forge KB dir (the shape
    // every flow/band/scratch KB has): the category→sub-wiki routing rule is
    // a three-brain (ADR 018) convention for the forge brains only, so no
    // mis-routed finding may fire here — classify() maps it to the AUTO tier
    // whose fixer git-mv's the file into brain/<sub>/themes/.
    const scratchThemes = join(root, 'brain', 'scratch-kb', 'themes');
    mkdirSync(scratchThemes, { recursive: true });
    const scratchTheme = join(scratchThemes, 'a-pattern.md');
    writeFileSync(scratchTheme, [
      '---', 'title: Scratch pattern', 'description: scratch KB theme.', 'category: pattern',
      'created_at: 2026-01-01T00:00:00Z', 'updated_at: 2026-01-01T00:00:00Z', '---', '', '# body', '',
    ].join('\n'));
    const scratchFindings = lintThemeFiles(root, [scratchTheme]);
    assert.ok(
      !scratchFindings.some((f) => f.check === 'checkCategoryScope'),
      `a non-forge KB's own theme must never trip checkCategoryScope, got ${JSON.stringify(scratchFindings)}`,
    );

    // …while a genuinely mis-routed FORGE theme (a decision sitting in
    // brain/cycles) still gets flagged — the check stays real in its domain.
    const cyclesThemes = join(root, 'brain', 'cycles', 'themes');
    mkdirSync(cyclesThemes, { recursive: true });
    const misrouted = join(cyclesThemes, 'a-decision.md');
    writeFileSync(misrouted, [
      '---', 'title: Misrouted decision', 'description: belongs in forge-dev.', 'category: decision',
      'created_at: 2026-01-01T00:00:00Z', 'updated_at: 2026-01-01T00:00:00Z', '---', '', '# body', '',
    ].join('\n'));
    const forgeFindings = lintThemeFiles(root, [misrouted]);
    assert.ok(
      forgeFindings.some((f) => f.check === 'checkCategoryScope'),
      `a mis-categorized forge sub-wiki theme must still trip checkCategoryScope, got ${JSON.stringify(forgeFindings)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('classifyFinding: checkDanglingEdges/checkDuplicateThemes classify as agent-tier with a non-empty fixHint, and resolutionCounts tallies them under "agent" (kills a classifyFinding that leaves the new checks unhandled, silently falling through to the "user" default)', () => {
  const dangling = classifyFinding(cf('checkDanglingEdges', 'dangling related_themes slug: missing-slug'));
  assert.equal(dangling.kind, 'edge.dangling');
  assert.equal(dangling.resolution, 'agent');
  assert.ok(dangling.fixHint && dangling.fixHint.length > 0, 'checkDanglingEdges must carry a non-empty fixHint');

  const duplicate = classifyFinding(cf('checkDuplicateThemes', 'possible duplicate of cycles/themes/other.md'));
  assert.equal(duplicate.kind, 'theme.duplicate');
  assert.equal(duplicate.resolution, 'agent');
  assert.ok(duplicate.fixHint && duplicate.fixHint.length > 0, 'checkDuplicateThemes must carry a non-empty fixHint');

  const counts = resolutionCounts([
    cf('checkDanglingEdges', 'dangling related_themes slug: x'),
    cf('checkDuplicateThemes', 'possible duplicate of y'),
  ]);
  assert.deepEqual(counts, { auto: 0, agent: 2, user: 0 });
});
