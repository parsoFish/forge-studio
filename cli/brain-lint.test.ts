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
