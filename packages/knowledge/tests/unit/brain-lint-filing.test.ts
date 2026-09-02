/**
 * Unit tests for `brain-lint-checks-filing.ts` — is a theme filed correctly?
 *
 * checkFrontmatter · checkIndexSync · checkCategoryScope · checkProjectBrainIndexes.
 *
 * Split out of `brain-lint.test.ts` (1,463 lines) in M4: 14 of its 65 cases,
 * filed by the module that owns each case's SUBJECT. Shared fixtures live in
 * `./test-fixtures/brain-lint.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkCategoryScope,
  checkFrontmatter,
  checkIndexSync,
  checkProjectBrainIndexes,
} from '../../brain-lint.ts';

import { buildBrainFixture, cleanup, writeProjectTheme } from './test-fixtures/brain-lint.ts';

function writeProjectIndex(root: string, project: string, file: string, body: string): void {
  writeFileSync(join(root, 'brain', 'projects', project, file), body);
}

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
  // Depth-INDEPENDENT: a hand-counted chain would resolve short after a move,
  // find no `brain/`, return [], and pass VACUOUSLY (see this commit's message).
  const { FORGE_ROOT: dir } = await import('@forge/kernel/ids.ts');
  const findings = checkCategoryScope(dir);
  const errors = findings.filter((f) => f.category === 'error');
  assert.equal(
    errors.length,
    0,
    `Real brain has ${errors.length} mis-routed theme(s):\n${errors.map((f) => `  ${f.file}: ${f.message}`).join('\n')}`,
  );
});

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
