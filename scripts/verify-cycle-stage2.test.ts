/**
 * verify-cycle-stage2 — the hand-off door and the landed-wait follow the
 * selected flow (M7-A `--flow`). Collaborators are fakes injected through the
 * module's own seam; the queue and log are real files under a temp root.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStageTwo } from './verify-cycle-stage2.mjs';

type Call = { path: string; payload: unknown };

function harness(opts: { flowId: string; door: 'develop-start' | 'flow-run'; flowReflects: boolean; reply?: (path: string) => { ok: boolean; status: number; body: any } }) {
  const root = mkdtempSync(join(tmpdir(), 'm7a-stage2-'));
  const calls: Call[] = [];
  const logs: string[] = [];
  const stageTwo = createStageTwo({
    forgeRoot: root,
    flow: { flowId: opts.flowId, door: opts.door },
    flowReflects: opts.flowReflects,
    bridgePost: async (_url: string, path: string, payload: unknown) => {
      calls.push({ path, payload });
      return opts.reply ? opts.reply(path) : { ok: true, status: 200, body: { ok: true, results: [{ ok: true, initiativeId: 'INIT-a' }] } };
    },
    log: (m: string) => logs.push(m),
    sleep: async () => {},
  });
  return { root, calls, logs, stageTwo };
}

test('a non-develop flow is handed off through the generic door, one request per initiative, confirming the repoint', async () => {
  const h = harness({ flowId: 'forge-docs', door: 'flow-run', flowReflects: false });
  await h.stageTwo.handoff('http://bridge', ['INIT-a', 'INIT-b']);
  assert.deepEqual(h.calls, [
    { path: '/api/flows/forge-docs/run', payload: { initiativeId: 'INIT-a', confirmRepointFrom: 'forge-architect' } },
    { path: '/api/flows/forge-docs/run', payload: { initiativeId: 'INIT-b', confirmRepointFrom: 'forge-architect' } },
  ]);
});

test('the generic door refusing (409 repoint-requires-confirm, ok:false) fails the hand-off loudly', async () => {
  const h = harness({ flowId: 'forge-docs', door: 'flow-run', flowReflects: false, reply: () => ({ ok: false, status: 409, body: { ok: false, status: 'repoint-requires-confirm' } }) });
  await assert.rejects(h.stageTwo.handoff('http://bridge', ['INIT-a']), /forge-docs hand-off failed for INIT-a \(409\)/);
});

test('forge-develop keeps its batch door', async () => {
  const h = harness({ flowId: 'forge-develop', door: 'develop-start', flowReflects: true });
  await h.stageTwo.handoff('http://bridge', ['INIT-a']);
  assert.deepEqual(h.calls, [{ path: '/api/develop/start', payload: { initiativeIds: ['INIT-a'] } }]);
});

test('a flow with no merged reflect is LANDED when its manifest reaches _queue/done/, not on reflector.end', async () => {
  const h = harness({ flowId: 'forge-docs', door: 'flow-run', flowReflects: false });
  mkdirSync(join(h.root, '_queue', 'done'), { recursive: true });
  writeFileSync(join(h.root, '_queue', 'done', 'INIT-a.md'), '---\n---\n');
  assert.equal(await h.stageTwo.waitLanded({ initiativeId: 'INIT-a', cycleId: 'C-a' }, Date.now() + 1000), true);
  assert.ok(h.logs.some((l) => /declares no on:merged reflect/.test(l)));
});

test('a flow that declares reflect waits on reflector.end — a manifest in done/ alone does not land it', async () => {
  const h = harness({ flowId: 'forge-develop', door: 'develop-start', flowReflects: true });
  mkdirSync(join(h.root, '_queue', 'done'), { recursive: true });
  writeFileSync(join(h.root, '_queue', 'done', 'INIT-a.md'), '---\n---\n');
  assert.equal(await h.stageTwo.waitLanded({ initiativeId: 'INIT-a', cycleId: 'C-a' }, Date.now() + 50), false, 'no reflector.end in the log');
  mkdirSync(join(h.root, '_logs', 'C-a'), { recursive: true });
  writeFileSync(join(h.root, '_logs', 'C-a', 'events.jsonl'), `${JSON.stringify({ skill: 'reflector', event_type: 'end', message: 'reflector.end' })}\n`);
  assert.equal(await h.stageTwo.waitLanded({ initiativeId: 'INIT-a', cycleId: 'C-a' }, Date.now() + 1000), true);
});
