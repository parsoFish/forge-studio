/**
 * Phase F:
 *  - emitDeliverySummary (cascade-v4 #1): the git-derived delivery ground truth
 *    the reflector grounds on instead of stale per-WI status.
 *  - manifest `disposable` round-trip (cascade-v4 #7): throwaway cycles skip
 *    durable reflection.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emitDeliverySummary } from './developer-loop.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';
import type { CycleInput } from '../cycle-context.ts';
import { parseManifest, serializeManifest } from '../manifest.ts';

function deliveryHarness(): {
  input: CycleInput;
  logger: ReturnType<typeof createLogger>;
  git: (args: string[]) => string;
  events: () => EventLogEntry[];
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'forge-delivered-'));
  const wt = join(dir, 'wt');
  mkdirSync(wt, { recursive: true });
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' }).toString();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(wt, 'base.txt'), 'base\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-delivered', logsDir);
  const input: CycleInput = {
    initiativeId: 'INIT-2026-06-01-delivered',
    manifestPath: join(dir, 'm.md'),
    projectRepoPath: wt,
    worktreePath: wt,
  };
  return {
    input,
    logger,
    git,
    events: () =>
      readFileSync(logger.logFilePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('emitDeliverySummary: reports the branch git diff-stat as ground truth (files + insertions > 0)', () => {
  const h = deliveryHarness();
  try {
    h.git(['checkout', '-q', '-b', 'init/x']);
    writeFileSync(join(h.input.worktreePath, 'feature.ts'), Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`).join('\n') + '\n');
    h.git(['add', '-A']);
    h.git(['commit', '-q', '-m', 'feat: real work']);

    emitDeliverySummary(h.input, h.logger, 'evt');
    const d = h.events().find((e) => e.message === 'dev-loop.delivered');
    assert.ok(d, 'expected dev-loop.delivered event');
    const md = d.metadata as { files_changed: number; insertions: number; commits: number; base: string };
    assert.equal(md.base, 'main');
    assert.ok(md.files_changed >= 1, `files_changed should be >=1, got ${md.files_changed}`);
    assert.ok(md.insertions >= 20, `insertions should be >=20, got ${md.insertions}`);
    assert.ok(md.commits >= 1, `commits should be >=1, got ${md.commits}`);
  } finally {
    h.cleanup();
  }
});

test('emitDeliverySummary: an empty branch reports zeros (the genuine no-delivery case)', () => {
  const h = deliveryHarness();
  try {
    h.git(['checkout', '-q', '-b', 'init/empty']); // no commits beyond base
    emitDeliverySummary(h.input, h.logger, 'evt');
    const d = h.events().find((e) => e.message === 'dev-loop.delivered');
    assert.ok(d);
    const md = d.metadata as { files_changed: number; commits: number };
    assert.equal(md.files_changed, 0);
    assert.equal(md.commits, 0);
  } finally {
    h.cleanup();
  }
});

test('manifest: disposable round-trips through parse + serialize', () => {
  const md = [
    '---',
    'initiative_id: INIT-2026-06-01-verify',
    'project: demo',
    'created_at: 2026-06-01T00:00:00Z',
    'iteration_budget: 3',
    'cost_budget_usd: 1',
    'phase: pending',
    'disposable: true',
    '---',
    '',
    '# verification throwaway',
    '',
  ].join('\n');
  const parsed = parseManifest(md);
  assert.equal(parsed.disposable, true);
  const round = parseManifest(serializeManifest(parsed));
  assert.equal(round.disposable, true, 'disposable must survive a serialize→parse round-trip');
});

test('manifest: absent disposable ⇒ undefined (normal reflection)', () => {
  const md = [
    '---',
    'initiative_id: INIT-2026-06-01-normal',
    'project: demo',
    'created_at: 2026-06-01T00:00:00Z',
    'iteration_budget: 3',
    'cost_budget_usd: 1',
    'phase: pending',
    '---',
    '',
    '# normal',
    '',
  ].join('\n');
  assert.equal(parseManifest(md).disposable, undefined);
});
