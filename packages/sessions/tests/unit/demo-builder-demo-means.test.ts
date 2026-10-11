/**
 * forge-mfv5.1.32 — the demo-builder session OWNS `demoMeans.commands`: locking a declaration
 * writes the commands its capture steps drive (the ones the sample capture just ran) into
 * `demoMeans`, beside `demoProcess`. gitweave I2's operator hand-added `demoMeans` to project.json
 * because nothing in Studio authored it. Routes, api means and earlier commands survive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel';

import { runDemoBuilderTurn } from '../../kinds/demo-builder.ts';
import { readSessionStatus, writeSessionStatus } from '../../interactive-session.ts';
import type { DemoBuilderStatus } from '../../kinds/demo-session-store.ts';
import { logger, makeNoopQueryFn, makeWritingQueryFn, setup } from './test-fixtures/demo-builder-runner-fixtures.ts';

const DECLARATION = [
  { kind: 'capture', text: 'Run `gw plan --fixture tests/fixtures/org.json` on both trees.' },
  { kind: 'capture', text: 'Show `gw org show --json` before and after.' },
  { kind: 'capture', text: 'A prose step with no command.' },
  { kind: 'verify', text: 'The ghost team is planned for deletion.' },
];

async function lockWith(existing: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
  const s = setup();
  const pj = join(s.repoPath, '.forge', 'project.json');
  if (existing) writeFileSync(pj, JSON.stringify({ ...JSON.parse(readFileSync(pj, 'utf8')), demoMeans: existing }));
  const base = { sessionId: s.sessionId, project: s.project, projectRoot: s.projectRoot, forgeRoot: FORGE_ROOT, logger: logger(s.logsRoot, s.sessionId), logsRoot: s.logsRoot };
  await runDemoBuilderTurn({ ...base, queryFn: makeWritingQueryFn(undefined, DECLARATION) });
  writeSessionStatus(s.sessionDir, { ...readSessionStatus<DemoBuilderStatus>(s.sessionDir)!, phase: 'locking' });
  await runDemoBuilderTurn({ ...base, queryFn: makeNoopQueryFn() });
  return JSON.parse(readFileSync(pj, 'utf8')) as Record<string, unknown>;
}

test('locking writes the capture steps\' commands into demoMeans.commands', async () => {
  const cfg = await lockWith(undefined);
  assert.deepEqual(cfg.demoMeans, { commands: ['gw org show --json', 'gw plan --fixture tests/fixtures/org.json'] });
  assert.deepEqual(cfg.demoProcess, DECLARATION);
});

test('locking keeps the operator\'s routes, api means and earlier commands', async () => {
  const cfg = await lockWith({ commands: ['gw plan'], routes: ['/'], api: { commands: ['gw apply --json'], ignoreKeys: ['default_branch_sha'] } });
  assert.deepEqual(cfg.demoMeans, {
    commands: ['gw org show --json', 'gw plan', 'gw plan --fixture tests/fixtures/org.json'],
    routes: ['/'],
    api: { commands: ['gw apply --json'], ignoreKeys: ['default_branch_sha'] },
  });
});
