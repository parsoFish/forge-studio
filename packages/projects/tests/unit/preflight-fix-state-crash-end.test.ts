/**
 * HIGH-7 (row 206 follow-up, forge-8vfn.8.5.56) — `readPreflightFixState`
 * (private to `project-preflight-read.ts`, exercised here through its one
 * caller, `GET /api/studio/projects/:id/preflight/fix-agent/:runId`) scans
 * `events.jsonl` NEWEST FIRST and returns on the FIRST `end` event, before
 * ever reaching an `error` event further back. MEDIUM-4 made `runFixTurn`'s
 * crash path emit an `end` event (naming `status: 'failed'`) AFTER its
 * `error` event, so the reversed scan now hits that `end` first and
 * misreads a crash as `'not-cleared'` instead of `'failed'`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleProjectPreflightFixAgentStatus } from '../../project-preflight-read.ts';
import type { StudioContext } from '@forge/kernel';

function mockRes(): { res: ServerResponse; captured: { status: number | null; body: string } } {
  const captured = { status: null as number | null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

function writeCrashLog(root: string, runId: string): void {
  const dir = join(root, '_logs', `_preflight-fix-${runId}`);
  mkdirSync(dir, { recursive: true });
  const lines = [
    { event_type: 'start', message: 'preflight-fix.start', metadata: {} },
    { event_type: 'error', message: 'preflight-fix.crashed', metadata: { error: 'pinned stream failure' } },
    { event_type: 'end', message: 'preflight-fix.end (error)', metadata: { status: 'failed', error: 'Error: pinned stream failure' } },
  ];
  writeFileSync(dir + '/events.jsonl', lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('GET .../preflight/fix-agent/:runId: a crashed run (error then a status:failed end) reports state "failed", not "not-cleared"', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'preflight-fix-crash-end-'));
  try {
    writeCrashLog(forgeRoot, 'r-crash-1');
    const ctx: StudioContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };
    const { res, captured } = mockRes();
    const req = {} as IncomingMessage;
    const handled = await handleProjectPreflightFixAgentStatus(
      req, res, ctx, '/api/studio/projects/p1/preflight/fix-agent/r-crash-1', 'GET',
    );
    assert.equal(handled, true);
    assert.equal(captured.status, 200);
    const body = JSON.parse(captured.body) as { state: string; cleared: boolean };
    assert.equal(body.state, 'failed', `a crashed run must report 'failed', got ${JSON.stringify(body)}`);
    assert.equal(body.cleared, false);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
