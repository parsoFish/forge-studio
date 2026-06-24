/**
 * Tests for cli/brain-fix-auto.ts — the deterministic AUTO-tier fixers.
 * Each asserts: apply → re-lint clears the finding, and a second apply is a no-op.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runBrainLint, applyAutoFixesUntilStable } from './brain-lint.ts';
import { applyAutoFixes } from './brain-fix-auto.ts';

function brain(): string {
  const root = mkdtempSync(join(tmpdir(), 'brain-fix-auto-'));
  const b = join(root, 'brain');
  mkdirSync(join(b, 'cycles', 'themes'), { recursive: true });
  mkdirSync(join(b, 'forge-dev', 'themes'), { recursive: true });
  writeFileSync(join(b, 'INDEX.md'), '# Brain\n');
  for (const c of ['patterns', 'antipatterns', 'decisions', 'operations']) {
    writeFileSync(join(b, 'cycles', `${c}.md`), `# ${c}\n\n## Theme pages\n`);
  }
  for (const c of ['decisions', 'reference']) {
    writeFileSync(join(b, 'forge-dev', `${c}.md`), `# ${c}\n\n## Theme pages\n`);
  }
  return root;
}

function theme(fm: Record<string, string>, body = '# body'): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${v}`);
  lines.push('---', '', body);
  return lines.join('\n') + '\n';
}

function lintKinds(root: string): string[] {
  return runBrainLint({ cwd: root, scope: 'full' }).findings.map((f) => f.kind ?? '');
}

test('applyAutoFixes: index.not-listed — links the theme, re-lint clears, idempotent', () => {
  const root = brain();
  try {
    writeFileSync(
      join(root, 'brain', 'cycles', 'themes', 'foo.md'),
      theme({ title: 'Foo', description: 'a foo', category: 'pattern', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }),
    );
    let findings = runBrainLint({ cwd: root, scope: 'full' }).findings;
    const notListed = findings.find((f) => f.kind === 'index.not-listed');
    assert.ok(notListed, 'precondition: foo is not listed in patterns.md');

    const r1 = applyAutoFixes(root, findings);
    assert.ok(r1.applied.some((a) => a.kind === 'index.not-listed'), 'linked foo');
    // The index now contains the slug.
    assert.match(readFileSync(join(root, 'brain', 'cycles', 'patterns.md'), 'utf8'), /themes\/foo\.md/);
    assert.ok(!lintKinds(root).includes('index.not-listed'), 're-lint: not-listed cleared');

    // Idempotent: a second apply finds nothing to do.
    const r2 = applyAutoFixes(root, runBrainLint({ cwd: root, scope: 'full' }).findings);
    assert.equal(r2.applied.filter((a) => a.kind === 'index.not-listed').length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applyAutoFixes: frontmatter.date-order — clamps updated_at, re-lint clears', () => {
  const root = brain();
  try {
    writeFileSync(
      join(root, 'brain', 'cycles', 'themes', 'dt.md'),
      theme({ title: 'DT', description: 'x', category: 'pattern', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }),
    );
    // Pre-list it in patterns.md so date-order is the SOLE finding (a combined
    // apply would otherwise also fix the index, masking what we assert here).
    writeFileSync(
      join(root, 'brain', 'cycles', 'patterns.md'),
      '# patterns\n\n## Theme pages\n\n- [`dt`](./themes/dt.md) — x\n',
    );
    const findings = runBrainLint({ cwd: root, scope: 'full' }).findings;
    assert.deepEqual(findings.map((x) => x.kind), ['frontmatter.date-order'], 'date-order is the sole finding');
    applyAutoFixes(root, findings);
    assert.ok(!lintKinds(root).includes('frontmatter.date-order'), 're-lint: date-order cleared');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applyAutoFixes: index.duplicate — dedupes to a single entry', () => {
  const root = brain();
  try {
    writeFileSync(
      join(root, 'brain', 'cycles', 'themes', 'dup.md'),
      theme({ title: 'Dup', description: 'd', category: 'pattern', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }),
    );
    // patterns.md lists dup TWICE.
    writeFileSync(
      join(root, 'brain', 'cycles', 'patterns.md'),
      '# patterns\n\n## Theme pages\n\n- [`dup`](./themes/dup.md) — d\n- [`dup`](./themes/dup.md) — d\n',
    );
    let findings = runBrainLint({ cwd: root, scope: 'full' }).findings;
    assert.ok(findings.some((x) => x.kind === 'index.duplicate'), 'precondition: duplicate finding');
    applyAutoFixes(root, findings);
    assert.ok(!lintKinds(root).includes('index.duplicate'), 're-lint: duplicate cleared');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applyAutoFixesUntilStable: drains ALL auto findings in one call, idempotent', () => {
  const root = brain();
  try {
    // Two themes, neither indexed; one also has a reversed date pair. Multiple
    // auto findings up front → one call must resolve them all (the operator's
    // intent: "apply fixes" = drain the tier, not one layer).
    writeFileSync(
      join(root, 'brain', 'cycles', 'themes', 'a.md'),
      theme({ title: 'A', description: 'a', category: 'pattern', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }),
    );
    writeFileSync(
      join(root, 'brain', 'cycles', 'themes', 'b.md'),
      theme({ title: 'B', description: 'b', category: 'antipattern', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }),
    );
    const beforeAuto = runBrainLint({ cwd: root, scope: 'full' }).findings.filter((f) => f.resolution === 'auto');
    assert.ok(beforeAuto.length >= 2, `precondition: ≥2 auto findings, got ${beforeAuto.length}`);

    const r = applyAutoFixesUntilStable(root);
    assert.ok(r.rounds >= 1, 'ran at least one round');
    const remainingAuto = r.remaining.filter((f) => f.resolution === 'auto');
    assert.equal(remainingAuto.length, 0, `all auto findings drained, ${remainingAuto.length} left`);

    // Idempotent: a second call applies nothing.
    const r2 = applyAutoFixesUntilStable(root);
    assert.equal(r2.applied.length, 0, 'second call is a no-op');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applyAutoFixes: ignores non-auto findings (agent/user untouched)', () => {
  const root = brain();
  try {
    // a broken wikilink → agent tier; applyAutoFixes must skip it.
    writeFileSync(
      join(root, 'brain', 'cycles', 'themes', 'lnk.md'),
      theme({ title: 'Lnk', description: 'l', category: 'pattern', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }, '# body\n\nsee [[no-such-theme]]'),
    );
    applyAutoFixes(root, runBrainLint({ cwd: root, scope: 'full' }).findings);
    // the broken wikilink (agent) is still there — not auto-fixed.
    assert.ok(lintKinds(root).includes('links.broken-wikilink'), 'agent-tier finding left for the agent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
