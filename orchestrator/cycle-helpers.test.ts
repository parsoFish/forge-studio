/**
 * openPrInline diagnostics — plan 2.5 / N3.
 *
 * When PR-open fails, the missing-prerequisite report must resolve the demo
 * path through the demo-path SSOT (demo-paths.ts). It previously hardcoded
 * `demo/<initiativeId>/DEMO.md`, so on an artifactRoot project the event told
 * the operator the demo was missing from a path the unifier never writes —
 * the 2026-07-05 producer/contract mismatch read as a filesystem race.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commitDevLoopBoundary, openPrInline } from './cycle-helpers.ts';
import { createLogger, type EventLogEntry } from './logging.ts';
import type { CycleInput } from './cycle-context.ts';

const INIT = 'INIT-2026-07-01-new-api-pipelinesapproval';

test('openPrInline missing-prereq diagnostics use the SSOT demo path on an artifactRoot project', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-openpr-'));
  try {
    const wt = join(dir, 'wt');
    mkdirSync(join(wt, '.forge'), { recursive: true });
    // artifactRoot project → the unifier authors forge/history/<id>/demo/…
    writeFileSync(join(wt, '.forge', 'project.json'), JSON.stringify({ artifactRoot: 'forge' }));
    const logsDir = join(dir, '_logs');
    mkdirSync(logsDir, { recursive: true });
    const logger = createLogger('TEST-openpr', logsDir);

    // Not a git repo → openPullRequest returns null → the diagnostics path runs.
    const input = {
      initiativeId: INIT,
      worktreePath: wt,
      manifestPath: join(wt, 'manifest.md'),
    } as CycleInput;

    await assert.rejects(
      () => openPrInline(input, logger),
      (err: Error) => {
        assert.match(err.message, /missing prerequisites/);
        assert.match(
          err.message,
          new RegExp(`forge/history/${INIT}/demo/DEMO\\.md`),
          'the thrown message must name the artifactRoot-resolved demo path',
        );
        assert.ok(
          !err.message.includes(`demo/${INIT}/DEMO.md`),
          'must NOT report the legacy path the unifier never wrote to',
        );
        return true;
      },
    );

    const events = readFileSync(logger.logFilePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as EventLogEntry);
    const missingEvt = events.find((e) => e.message === 'unifier.prerequisite-missing');
    assert.ok(missingEvt, 'unifier.prerequisite-missing event emitted');
    const md = missingEvt!.metadata as { missing: string[]; demo_md_path: string };
    assert.ok(
      md.missing.includes(`forge/history/${INIT}/demo/DEMO.md`),
      `missing[] carries the SSOT-resolved rel path, got ${JSON.stringify(md.missing)}`,
    );
    assert.ok(
      md.demo_md_path.endsWith(join('forge', 'history', INIT, 'demo', 'DEMO.md')),
      `demo_md_path resolved through the SSOT, got ${md.demo_md_path}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// commitDevLoopBoundary — G8 wave 2 (2026-07-12): the boundary commit is
// orchestrator-issued (no agent in the loop), so it must carry
// ORCHESTRATOR_GIT_IDENTITY via explicit `-c` flags rather than whatever
// identity happens to be configured locally in the worktree.
// ---------------------------------------------------------------------------

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** A tiny repo with a base commit and a LOCAL identity distinct from forge's — proves the -c override actually takes effect rather than passively matching. */
function setupRepoWithLocalIdentity(): { wt: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-devloop-boundary-'));
  const wt = join(dir, 'wt');
  mkdirSync(wt, { recursive: true });
  sh(wt, ['init', '-q', '-b', 'main']);
  sh(wt, ['config', 'user.email', 'poisoned@example.com']);
  sh(wt, ['config', 'user.name', 'Poisoned Local Identity']);
  writeFileSync(join(wt, 'README.md'), 'base\n');
  sh(wt, ['add', '.']);
  sh(wt, ['commit', '-q', '-m', 'base']);
  return { wt, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('commitDevLoopBoundary: boundary commit carries forge-orchestrator identity, not the local gitconfig', () => {
  const { wt, cleanup } = setupRepoWithLocalIdentity();
  try {
    writeFileSync(join(wt, 'work.txt'), 'dev-loop work\n');

    const logsDir = mkdtempSync(join(tmpdir(), 'forge-devloop-boundary-logs-'));
    const logger = createLogger('TEST-boundary', logsDir);

    commitDevLoopBoundary(wt, logger, 'INIT-boundary-test');

    const authorName = sh(wt, ['log', '-1', '--pretty=%an']).trim();
    const authorEmail = sh(wt, ['log', '-1', '--pretty=%ae']).trim();
    const committerName = sh(wt, ['log', '-1', '--pretty=%cn']).trim();
    const committerEmail = sh(wt, ['log', '-1', '--pretty=%ce']).trim();

    assert.equal(authorName, 'forge-orchestrator');
    assert.equal(authorEmail, 'forge-orchestrator@forge.local');
    assert.equal(committerName, 'forge-orchestrator');
    assert.equal(committerEmail, 'forge-orchestrator@forge.local');

    rmSync(logsDir, { recursive: true, force: true });
  } finally {
    cleanup();
  }
});

test('commitDevLoopBoundary: --allow-empty boundary snapshot on a clean tree also carries forge-orchestrator identity', () => {
  const { wt, cleanup } = setupRepoWithLocalIdentity();
  try {
    const logsDir = mkdtempSync(join(tmpdir(), 'forge-devloop-boundary-logs-'));
    const logger = createLogger('TEST-boundary-empty', logsDir);

    commitDevLoopBoundary(wt, logger, 'INIT-boundary-empty-test');

    const authorEmail = sh(wt, ['log', '-1', '--pretty=%ae']).trim();
    assert.equal(authorEmail, 'forge-orchestrator@forge.local');

    rmSync(logsDir, { recursive: true, force: true });
  } finally {
    cleanup();
  }
});
