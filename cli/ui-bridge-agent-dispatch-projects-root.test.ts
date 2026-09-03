/**
 * Bead forge-c6h / R4-17 round-4 — `--projects-root <abs>` argv seam.
 *
 * `spawnAgentDispatch` (cli/ui-bridge.ts) never actually spawns in this test
 * process (see `cli/ui-bridge-agent-run-ceiling.test.ts`'s own "(E) The
 * CLI-argv dispatch seam" section, which this file mirrors) — so the seam is
 * pinned as PURE FUNCTION COMPOSITION through the exported
 * `buildAgentDispatchArgs`:
 *   1. `buildAgentDispatchArgs` includes `--projects-root <value>` when given
 *      one — pure, no execution needed.
 *   2. ROUND-TRIP: `parseAgentDispatchArgs(buildAgentDispatchArgs(...))`
 *      (`cli/agent-run.ts`) — the one test that would have caught "the
 *      bridge builds the flag but the CLI-side parser never reads it".
 *
 * The generic `POST /api/agents/:slug/run` route's call site
 * (cli/ui-bridge.ts:~2782) now threads `ctx.projectsRoot` through as this
 * new trailing argument — that call site is exercised indirectly by every
 * existing route-level test that already covers `/api/agents/:slug/run`; this
 * file only pins the pure argv-building/parsing seam itself, per the T3
 * brief's own scoping ("test through whatever exported argv-builder seam
 * exists").
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentDispatchArgs } from './ui-bridge.ts';
import { parseAgentDispatchArgs } from '@forge/agents/agent-dispatch-cmd.ts';

function containsFlagPair(args: string[], flag: string, value: string): boolean {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag && args[i + 1] === value) return true;
  }
  return false;
}

test('buildAgentDispatchArgs: projectsRoot present ⇒ emits --projects-root <value> (kills "the bridge\'s snapshot is threaded through spawnAgentDispatch but the argv builder never emits it")', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1', undefined, undefined, undefined, undefined, '/abs/snapshot/projects/root');
  assert.ok(
    containsFlagPair(args, '--projects-root', '/abs/snapshot/projects/root'),
    `expected --projects-root /abs/snapshot/projects/root, got ${JSON.stringify(args)}`,
  );
});

test('buildAgentDispatchArgs: projectsRoot absent ⇒ no --projects-root flag at all (today\'s behaviour for every dispatch call that predates this parameter, unchanged)', () => {
  const args = buildAgentDispatchArgs('my-slug', 'run-1');
  assert.ok(!args.includes('--projects-root'), `expected no --projects-root flag, got ${JSON.stringify(args)}`);
});

test('buildAgentDispatchArgs: projectsRoot coexists with every other optional arg without clobbering them (comprehensive regression)', () => {
  const args = buildAgentDispatchArgs(
    'my-slug', 'run-1', 'gitpulse', { northStar: 'ship it' }, '/abs/session/dir', 9.99, '/abs/snapshot/projects/root',
  );
  assert.equal(args[0], 'my-slug');
  assert.ok(containsFlagPair(args, '--run-id', 'run-1'));
  assert.ok(containsFlagPair(args, '--project', 'gitpulse'));
  assert.ok(containsFlagPair(args, '--input', 'northStar=ship it'));
  assert.ok(containsFlagPair(args, '--session-dir', '/abs/session/dir'));
  assert.ok(containsFlagPair(args, '--cost-ceiling-usd', '9.99'));
  assert.ok(containsFlagPair(args, '--projects-root', '/abs/snapshot/projects/root'));
});

test('ROUND-TRIP: parseAgentDispatchArgs(buildAgentDispatchArgs(...)) — the bridge\'s snapshot projectsRoot survives the CLI-argv seam unchanged, composed directly with no spawn/mock/flag needed', () => {
  const args = buildAgentDispatchArgs(
    'project-scoped-review', 'run-1', 'gitpulse', { northStar: 'ship it' }, '/abs/session/dir', 17.5, '/abs/snapshot/projects/root',
  );
  const parsed = parseAgentDispatchArgs(args);

  assert.equal(parsed.slug, 'project-scoped-review');
  assert.equal(parsed.runId, 'run-1');
  assert.equal(parsed.project, 'gitpulse');
  assert.deepEqual(parsed.inputs, { northStar: 'ship it' });
  assert.equal(parsed.sessionDir, '/abs/session/dir');
  assert.equal(parsed.costCeilingUsd, 17.5);
  assert.equal(
    parsed.projectsRoot, '/abs/snapshot/projects/root',
    'the bridge\'s snapshot projectsRoot encoded by buildAgentDispatchArgs must survive parseAgentDispatchArgs\'s parse unchanged, across the round trip',
  );
});

test('ROUND-TRIP, absence direction: no projectsRoot given to buildAgentDispatchArgs ⇒ parseAgentDispatchArgs\'s result has NO projectsRoot key either (today\'s behaviour, unchanged, proven end-to-end through both pure functions together)', () => {
  const args = buildAgentDispatchArgs('project-scoped-review', 'run-1');
  const parsed = parseAgentDispatchArgs(args);
  assert.equal('projectsRoot' in parsed, false, `expected no projectsRoot key, got ${JSON.stringify(parsed)}`);
});
