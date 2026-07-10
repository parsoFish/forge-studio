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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openPrInline } from './cycle-helpers.ts';
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
