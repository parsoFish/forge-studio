/**
 * Bead forge-c6h / R4-17 round-4 — `--logs-root <abs>` argv seam.
 *
 * `spawnAgentDispatch` (apps/forge/ui-bridge.ts) never actually spawns in this test
 * process (see `apps/forge/tests/integration/ui-bridge-agent-run-ceiling.test.ts`'s own "(E) The
 * CLI-argv dispatch seam" section, which this file mirrors) — so the seam is
 * pinned as PURE FUNCTION COMPOSITION through the exported
 * `buildAgentDispatchArgs`:
 *   1. `buildAgentDispatchArgs` includes `--logs-root <value>` when given
 *      one — pure, no execution needed.
 *   2. ROUND-TRIP: `parseAgentDispatchArgs(buildAgentDispatchArgs(...))`
 *      (`apps/forge/agent-run.ts`) — the one test that would have caught "the
 *      bridge builds the flag but the CLI-side parser never reads it".
 *
 * The generic `POST /api/agents/:slug/run` route's call site
 * (apps/forge/ui-bridge.ts:~2782) now threads `ctx.logsRoot` through as this
 * new trailing argument — that call site is exercised indirectly by every
 * existing route-level test that already covers `/api/agents/:slug/run`; this
 * file only pins the pure argv-building/parsing seam itself, per the T3
 * brief's own scoping ("test through whatever exported argv-builder seam
 * exists").
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentDispatchArgs } from '../../bridge-agent-dispatch.ts';
import { parseAgentDispatchArgs } from '../../agent-dispatch-cmd.ts';

function containsFlagPair(args: string[], flag: string, value: string): boolean {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag && args[i + 1] === value) return true;
  }
  return false;
}

test('buildAgentDispatchArgs: logsRoot present ⇒ emits --logs-root <value> (kills "the bridge\'s snapshot is threaded through spawnAgentDispatch but the argv builder never emits it")', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1', undefined, undefined, undefined, undefined, '/abs/snapshot/logs/root');
  assert.ok(
    containsFlagPair(args, '--logs-root', '/abs/snapshot/logs/root'),
    `expected --logs-root /abs/snapshot/logs/root, got ${JSON.stringify(args)}`,
  );
});

test('buildAgentDispatchArgs: logsRoot absent ⇒ no --logs-root flag at all (today\'s behaviour for every dispatch call that predates this parameter, unchanged)', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1');
  assert.ok(!args.includes('--logs-root'), `expected no --logs-root flag, got ${JSON.stringify(args)}`);
});

test('buildAgentDispatchArgs: logsRoot coexists with every other optional arg without clobbering them (comprehensive regression)', () => {
  const args = buildAgentDispatchArgs(
    'my-slug', 'run-1', 'gitpulse', { northStar: 'ship it' }, '/abs/session/dir', 9.99, '/abs/snapshot/logs/root',
  );
  assert.equal(args[0], 'my-slug');
  assert.ok(containsFlagPair(args, '--run-id', 'run-1'));
  assert.ok(containsFlagPair(args, '--project', 'gitpulse'));
  assert.ok(containsFlagPair(args, '--input', 'northStar=ship it'));
  assert.ok(containsFlagPair(args, '--session-dir', '/abs/session/dir'));
  assert.ok(containsFlagPair(args, '--cost-ceiling-usd', '9.99'));
  assert.ok(containsFlagPair(args, '--logs-root', '/abs/snapshot/logs/root'));
});

test('ROUND-TRIP: parseAgentDispatchArgs(buildAgentDispatchArgs(...)) — the bridge\'s snapshot logsRoot survives the CLI-argv seam unchanged, composed directly with no spawn/mock/flag needed', () => {
  const args = buildAgentDispatchArgs(
    'project-scoped-review', 'run-1', 'gitpulse', { northStar: 'ship it' }, '/abs/session/dir', 17.5, '/abs/snapshot/logs/root',
  );
  const parsed = parseAgentDispatchArgs(args);

  assert.equal(parsed.slug, 'project-scoped-review');
  assert.equal(parsed.runId, 'run-1');
  assert.equal(parsed.project, 'gitpulse');
  assert.deepEqual(parsed.inputs, { northStar: 'ship it' });
  assert.equal(parsed.sessionDir, '/abs/session/dir');
  assert.equal(parsed.costCeilingUsd, 17.5);
  assert.equal(
    parsed.logsRoot, '/abs/snapshot/logs/root',
    'the bridge\'s snapshot logsRoot encoded by buildAgentDispatchArgs must survive parseAgentDispatchArgs\'s parse unchanged, across the round trip',
  );
});

test('ROUND-TRIP, absence direction: no logsRoot given to buildAgentDispatchArgs ⇒ parseAgentDispatchArgs\'s result has NO logsRoot key either (today\'s behaviour, unchanged, proven end-to-end through both pure functions together)', () => {
  const args = buildAgentDispatchArgs('project-scoped-review', 'run-1');
  const parsed = parseAgentDispatchArgs(args);
  assert.equal('logsRoot' in parsed, false, `expected no logsRoot key, got ${JSON.stringify(parsed)}`);
});
