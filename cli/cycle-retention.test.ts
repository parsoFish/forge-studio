/**
 * S6A — tests for orchestrator/cycle-retention.ts.
 *
 * Pure unit tests over `assignRetention`, `collectCitedBy`, and
 * `patchArchiveFrontmatter`. No SDK, no real cycles. Filesystem fixtures
 * live in per-test tempdirs.
 *
 * Covers all three retention tiers + the cited_by extraction + idempotent
 * archive patching.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assignRetention,
  collectCitedBy,
  patchArchiveFrontmatter,
  type ThemeMeta,
} from './cycle-retention.ts';
import type { EventLogEntry } from '../orchestrator/logging.ts';

function makeEvent(partial: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'EV_x',
    cycle_id: 'CY-test',
    initiative_id: 'INIT-x',
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    started_at: new Date().toISOString(),
    ...partial,
  } as EventLogEntry;
}

function makeTheme(category: string | null): ThemeMeta {
  return { path: `/fake/themes/${category ?? 'unknown'}.md`, category };
}

// ---------- assignRetention ----------

test('assignRetention: load-bearing when an antipattern theme is present', () => {
  const result = assignRetention(
    [makeEvent({ event_type: 'end', message: 'cycle.end' })],
    [makeTheme('antipattern')],
  );
  assert.equal(result, 'load-bearing');
});

test('assignRetention: load-bearing on any error event', () => {
  const result = assignRetention(
    [makeEvent({ event_type: 'error', message: 'reviewer.crashed' })],
    [makeTheme('pattern')],
  );
  assert.equal(result, 'load-bearing');
});

test('assignRetention: load-bearing on wedged ralph.end', () => {
  const result = assignRetention(
    [
      makeEvent({
        event_type: 'end',
        message: 'ralph.end',
        metadata: { stop_reason: 'wedged' },
      }),
    ],
    [makeTheme('pattern')],
  );
  assert.equal(result, 'load-bearing');
});

test('assignRetention: load-bearing on a reviewer send-back verdict', () => {
  const result = assignRetention(
    [
      makeEvent({
        event_type: 'log',
        phase: 'review-loop',
        message: 'reviewer.verdict.send-back',
      }),
    ],
    [makeTheme('pattern')],
  );
  assert.equal(result, 'load-bearing');
});

test('assignRetention: load-bearing on wedge-recovery substring', () => {
  const result = assignRetention(
    [makeEvent({ event_type: 'log', message: 'pm.wedge-recovery-applied' })],
    [makeTheme('pattern')],
  );
  assert.equal(result, 'load-bearing');
});

test('assignRetention: interesting when ≥ 2 themes written and no antipattern/wedge', () => {
  const result = assignRetention(
    [makeEvent({ event_type: 'end' })],
    [makeTheme('pattern'), makeTheme('reference')],
  );
  assert.equal(result, 'interesting');
});

test('assignRetention: interesting when a decision theme is written', () => {
  const result = assignRetention(
    [makeEvent({ event_type: 'end' })],
    [makeTheme('decision')],
  );
  assert.equal(result, 'interesting');
});

test('assignRetention: routine on minimal clean cycle with a single pattern theme', () => {
  const result = assignRetention(
    [makeEvent({ event_type: 'end', message: 'cycle.end' })],
    [makeTheme('pattern')],
  );
  assert.equal(result, 'routine');
});

test('assignRetention: routine with zero themes and no incidents', () => {
  const result = assignRetention(
    [makeEvent({ event_type: 'end', message: 'cycle.end' })],
    [],
  );
  assert.equal(result, 'routine');
});

// ---------- collectCitedBy ----------

type TreeHarness = {
  forgeRoot: string;
  cleanup: () => void;
};

function setupBrainTree(opts: {
  projectName: string;
  themes: Record<string, string>;
  forgeThemes?: Record<string, string>;
  mtime?: Date;
}): TreeHarness {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-retention-test-'));
  const themesDir = join(forgeRoot, 'projects', opts.projectName, 'brain', 'themes');
  mkdirSync(themesDir, { recursive: true });
  for (const [file, body] of Object.entries(opts.themes)) {
    const full = join(themesDir, file);
    writeFileSync(full, body);
    if (opts.mtime) {
      utimesSync(full, opts.mtime, opts.mtime);
    }
  }
  if (opts.forgeThemes) {
    const forgeThemesDir = join(forgeRoot, 'brain', 'cycles', 'themes');
    mkdirSync(forgeThemesDir, { recursive: true });
    for (const [file, body] of Object.entries(opts.forgeThemes)) {
      const full = join(forgeThemesDir, file);
      writeFileSync(full, body);
      if (opts.mtime) utimesSync(full, opts.mtime, opts.mtime);
    }
  }
  return {
    forgeRoot,
    cleanup: () => {
      try {
        rmSync(forgeRoot, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

test('collectCitedBy: returns themes that mention the cycle archive', () => {
  const h = setupBrainTree({
    projectName: 'demo-project',
    themes: {
      'a.md': 'body refers to brain/cycles/_raw/CY-1.md\n',
      'b.md': 'body refers to _logs/CY-1/events.jsonl\n',
      'c.md': 'no cycle reference here\n',
    },
  });
  try {
    const cited = collectCitedBy({
      forgeRoot: h.forgeRoot,
      projectName: 'demo-project',
      cycleId: 'CY-1',
      sinceMs: 0,
    });
    assert.equal(cited.length, 2);
    assert.ok(cited.some((p) => p.endsWith('a.md')));
    assert.ok(cited.some((p) => p.endsWith('b.md')));
    assert.ok(!cited.some((p) => p.endsWith('c.md')));
  } finally {
    h.cleanup();
  }
});

test('collectCitedBy: filters by mtime (sinceMs)', () => {
  const old = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
  const h = setupBrainTree({
    projectName: 'demo-project',
    themes: {
      'old.md': 'body refers to brain/cycles/_raw/CY-1.md\n',
    },
    mtime: old,
  });
  try {
    const cited = collectCitedBy({
      forgeRoot: h.forgeRoot,
      projectName: 'demo-project',
      cycleId: 'CY-1',
      sinceMs: Date.now() - 60 * 1000, // only "modified in last minute"
    });
    assert.equal(cited.length, 0, 'old theme should be filtered out');
  } finally {
    h.cleanup();
  }
});

test('collectCitedBy: returns forge-rooted relative paths', () => {
  const h = setupBrainTree({
    projectName: 'demo-project',
    themes: {
      'a.md': 'mentions CY-XYZ\n',
    },
  });
  try {
    const cited = collectCitedBy({
      forgeRoot: h.forgeRoot,
      projectName: 'demo-project',
      cycleId: 'CY-XYZ',
      sinceMs: 0,
    });
    assert.equal(cited.length, 1);
    assert.equal(cited[0], 'projects/demo-project/brain/themes/a.md');
  } finally {
    h.cleanup();
  }
});

test('collectCitedBy: includes forge-themes namespace', () => {
  const h = setupBrainTree({
    projectName: 'demo-project',
    themes: {},
    forgeThemes: {
      'cross-cycle.md': 'mentions _logs/CY-X/events.jsonl\n',
    },
  });
  try {
    const cited = collectCitedBy({
      forgeRoot: h.forgeRoot,
      projectName: 'demo-project',
      cycleId: 'CY-X',
      sinceMs: 0,
    });
    assert.equal(cited.length, 1);
    assert.equal(cited[0], 'brain/cycles/themes/cross-cycle.md');
  } finally {
    h.cleanup();
  }
});

// ---------- patchArchiveFrontmatter ----------

function makeArchive(opts: { withRetention?: boolean; withCitedBy?: boolean }): {
  path: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'forge-archive-test-'));
  const path = join(dir, 'CY-1.md');
  const lines = [
    '---',
    'source_type: cycle',
    'source_url: _logs/CY-1/events.jsonl',
    'cycle_id: CY-1',
    'initiative_id: INIT-x',
    'project: demo-project',
    'ingested_at: 2026-05-23T12:00:00Z',
    'ingested_by: reflector',
  ];
  if (opts.withRetention) lines.push('retention: auto');
  if (opts.withCitedBy) {
    lines.push('cited_by:');
    lines.push('  - projects/demo-project/brain/themes/stale.md');
  }
  lines.push('---', '', 'Body here.', '');
  writeFileSync(path, lines.join('\n'));
  return {
    path,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

test('patchArchiveFrontmatter: inserts retention + cited_by when absent', () => {
  const a = makeArchive({});
  try {
    const ok = patchArchiveFrontmatter(a.path, 'load-bearing', [
      'projects/demo-project/brain/themes/x.md',
      'projects/demo-project/brain/themes/y.md',
    ]);
    assert.equal(ok, true);
    const body = readFileSync(a.path, 'utf8');
    assert.match(body, /^retention: load-bearing$/m);
    assert.match(body, /^cited_by:$/m);
    assert.match(body, /- projects\/demo-project\/brain\/themes\/x\.md/);
    assert.match(body, /- projects\/demo-project\/brain\/themes\/y\.md/);
    // Original frontmatter preserved.
    assert.match(body, /^source_type: cycle$/m);
    assert.match(body, /^cycle_id: CY-1$/m);
    // Body preserved.
    assert.match(body, /Body here\./);
  } finally {
    a.cleanup();
  }
});

test('patchArchiveFrontmatter: overwrites placeholder retention: auto', () => {
  const a = makeArchive({ withRetention: true });
  try {
    const ok = patchArchiveFrontmatter(a.path, 'interesting', []);
    assert.equal(ok, true);
    const body = readFileSync(a.path, 'utf8');
    assert.match(body, /^retention: interesting$/m);
    assert.doesNotMatch(body, /^retention: auto$/m);
    assert.match(body, /^cited_by: \[\]$/m);
  } finally {
    a.cleanup();
  }
});

test('patchArchiveFrontmatter: overwrites existing cited_by list', () => {
  const a = makeArchive({ withCitedBy: true });
  try {
    const ok = patchArchiveFrontmatter(a.path, 'routine', [
      'projects/demo-project/brain/themes/fresh.md',
    ]);
    assert.equal(ok, true);
    const body = readFileSync(a.path, 'utf8');
    assert.match(body, /- projects\/demo-project\/brain\/themes\/fresh\.md/);
    assert.doesNotMatch(body, /stale\.md/);
  } finally {
    a.cleanup();
  }
});

test('patchArchiveFrontmatter: returns false on missing file', () => {
  const ok = patchArchiveFrontmatter('/does/not/exist.md', 'routine', []);
  assert.equal(ok, false);
});

test('patchArchiveFrontmatter: returns false on file without frontmatter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-archive-test-'));
  const path = join(dir, 'no-fm.md');
  writeFileSync(path, '# heading\n\nbody\n');
  try {
    const ok = patchArchiveFrontmatter(path, 'routine', []);
    assert.equal(ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('patchArchiveFrontmatter: idempotent — second call yields same content', () => {
  const a = makeArchive({});
  try {
    patchArchiveFrontmatter(a.path, 'load-bearing', ['brain/cycles/themes/a.md']);
    const first = readFileSync(a.path, 'utf8');
    patchArchiveFrontmatter(a.path, 'load-bearing', ['brain/cycles/themes/a.md']);
    const second = readFileSync(a.path, 'utf8');
    assert.equal(first, second);
  } finally {
    a.cleanup();
  }
});

// ---------- existsSync used in setup ----------
test('test harness sanity: brain tree exists after setup', () => {
  const h = setupBrainTree({ projectName: 'p1', themes: { 'a.md': 'x' } });
  try {
    assert.ok(existsSync(join(h.forgeRoot, 'projects', 'p1', 'brain', 'themes', 'a.md')));
  } finally {
    h.cleanup();
  }
});
