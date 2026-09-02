/**
 * Unit tests for `brain-lint-checks-integrity.ts` — does a theme hold up on its own?
 *
 * checkSourceLinks · checkStaleness · checkOrphans · checkLengthSoftCap · checkReflectorLoss.
 *
 * Split out of `brain-lint.test.ts` (1,463 lines) in M4: 17 of its 65 cases,
 * filed by the module that owns each case's SUBJECT. Shared fixtures live in
 * `./test-fixtures/brain-lint.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkLengthSoftCap,
  checkOrphans,
  checkReflectorLoss,
  checkSourceLinks,
  checkStaleness,
  classifyFinding,
} from '../../brain-lint.ts';

import { buildBrainFixture, cleanup, cf } from './test-fixtures/brain-lint.ts';

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

test('checkStaleness: a project theme\'s citation is NOT resolved against the forge repo', () => {
  // `docs/LEARNINGS.md` in a trafficGame theme names trafficGame's docs, which
  // live in its ground clone at projects/trafficGame/ — gitignored, absent in
  // CI, and another repo's tree. Resolved against the forge root it is
  // "missing" and the theme is flagged stale, which is how lighting up Brain 3
  // produced 27 flags naming files that were sitting in the project all along.
  const root = buildBrainFixture({
    themes: [
      { path: 'projects/demo/themes/cites-project-docs.md', fm: { category: 'antipattern' }, body: '# t\n\nSee `docs/LEARNINGS.md` for the detail.\n' },
    ],
    extra: [{ path: 'projects/demo/antipatterns.md', content: '# a\n\n- [`cites-project-docs`](./themes/cites-project-docs.md) — d\n' }],
  });
  try {
    assert.deepEqual(checkStaleness(root), []);
  } finally {
    cleanup(root);
  }
});

test('checkStaleness: a FORGE theme citing a missing forge path is still flagged', () => {
  const root = buildBrainFixture({
    themes: [
      { path: 'cycles/themes/cites-forge-docs.md', body: '# t\n\nSee `docs/gone-for-good.md` for the detail.\n' },
    ],
  });
  try {
    const findings = checkStaleness(root);
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /stale citation \(missing\): docs\/gone-for-good\.md/);
  } finally {
    cleanup(root);
  }
});
