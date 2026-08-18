/**
 * W7-A2 (sessions-kinds-V01, beads forge-w08 / forge-eip) — the write-root
 * fence must be REACHABLE by the SDK, not merely installed.
 *
 * `runAgentTurn` installs `options.canUseTool` when `writeRoots` is
 * non-empty — but the SDK only consults `canUseTool` for a tool call it
 * would otherwise PROMPT for. Two independent settings in the SAME options
 * object short-circuit that prompt for exactly the tools the fence gates:
 *
 *   1. `permissionMode: 'acceptEdits'` auto-accepts Write/Edit/MultiEdit/
 *      NotebookEdit at the SDK level; `canUseTool` is never invoked.
 *   2. `allowedTools` pre-approves every listed tool name; every real
 *      turnSpec agent (`skills/community-refresh/SKILL.md`,
 *      `skills/brain-maintenance/SKILL.md`, `skills/creation-agent/SKILL.md`)
 *      lists `Write` there, so `canUseTool` is never invoked for it either.
 *
 * Live evidence: the operator's community-refresh session
 * `2026-08-18T12-54-32-abdfd26b` ran with `writeRoots = [<sessionDir>/staging]`
 * and STILL wrote `/home/parso/forge/studio/community/staging/{registry.yaml,
 * evidence.json,evidence.md}` — outside every declared root — the files
 * exist on disk with mtimes matching the turn's tool_use events.
 *
 * These pins encode the fix's CONTRACT on the options object handed to the
 * SDK (the only seam a unit test can observe without spending tokens):
 *   - writeRoots non-empty ⇒ permissionMode is NOT 'acceptEdits' (it is
 *     'default'), AND `allowedTools` carries NONE of the fence-gated tool
 *     names, AND `canUseTool` is installed.
 *   - writeRoots empty/absent ⇒ byte-identical prior behaviour
 *     ('acceptEdits', allowedTools verbatim, no canUseTool).
 * The end-to-end proof (a real haiku turn attempting an out-of-root Write and
 * being refused) is `scripts/probe-write-fence.mjs`, run by the T2 and
 * recorded in the PR — it spends tokens and is deliberately NOT part of
 * `npm test`.
 *
 * RED at base: permissionMode is 'acceptEdits' and allowedTools passes
 * through verbatim regardless of writeRoots.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgentTurn, type QueryFn } from './interactive-session.ts';

const MODEL = 'claude-sonnet-4-6';
/** The exact tool grant community-refresh's SKILL.md declares — Write is IN
 *  the allow list, which is precisely the shape that bypassed the fence. */
const COMMUNITY_REFRESH_TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'WebFetch', 'WebSearch'] as const;
const FENCE_GATED = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

function capturingQueryFn(): { queryFn: QueryFn; captured: () => Record<string, unknown> } {
  let capturedOptions: Record<string, unknown> | undefined;
  const queryFn: QueryFn = ({ options }) => {
    capturedOptions = options;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
  return {
    queryFn,
    captured: () => {
      assert.ok(capturedOptions, 'queryFn must have been invoked');
      return capturedOptions!;
    },
  };
}

function makeWriteRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'fence-mode-'));
  const writeRoot = join(root, 'session', 'staging');
  mkdirSync(writeRoot, { recursive: true });
  return writeRoot;
}

test('fence-mode: writeRoots non-empty ⇒ permissionMode is NOT acceptEdits (the SDK must prompt, so canUseTool is consulted)', async () => {
  const writeRoot = makeWriteRoot();
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({
    queryFn, prompt: 'p', cwd: writeRoot, model: MODEL,
    allowedTools: COMMUNITY_REFRESH_TOOLS, writeRoots: [writeRoot],
  });
  const o = captured();
  assert.notEqual(o.permissionMode, 'acceptEdits', 'acceptEdits auto-approves Write/Edit before canUseTool runs — the fence is dead code under it');
  assert.equal(o.permissionMode, 'default');
  assert.ok(o.canUseTool, 'canUseTool must still be installed');
});

test('fence-mode: writeRoots non-empty ⇒ allowedTools handed to the SDK carries NONE of the fence-gated tool names, and keeps every other grant', async () => {
  const writeRoot = makeWriteRoot();
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({
    queryFn, prompt: 'p', cwd: writeRoot, model: MODEL,
    allowedTools: COMMUNITY_REFRESH_TOOLS, writeRoots: [writeRoot],
  });
  const allowed = captured().allowedTools as readonly string[];
  assert.ok(Array.isArray(allowed), 'allowedTools must still be an array');
  for (const gated of FENCE_GATED) {
    assert.ok(!allowed.includes(gated), `${gated} must NOT be pre-approved via allowedTools when a write-root fence is active (pre-approval skips canUseTool)`);
  }
  // Every non-gated grant survives verbatim — the fence never widens or
  // narrows the read/network grant.
  for (const t of ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']) {
    assert.ok(allowed.includes(t), `non-gated grant ${t} must survive`);
  }
});

test('fence-mode: writeRoots non-empty ⇒ the fence-gated tools are NOT pushed into disallowedTools either (they must remain CALLABLE, gated by canUseTool, not removed)', async () => {
  const writeRoot = makeWriteRoot();
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({
    queryFn, prompt: 'p', cwd: writeRoot, model: MODEL,
    allowedTools: COMMUNITY_REFRESH_TOOLS, disallowedTools: ['Bash'], writeRoots: [writeRoot],
  });
  const disallowed = captured().disallowedTools as readonly string[];
  assert.deepEqual([...disallowed], ['Bash'], 'disallowedTools must pass through verbatim — Write must stay usable inside the root');
});

test('fence-mode: writeRoots absent ⇒ byte-identical prior behaviour: acceptEdits, allowedTools verbatim, no canUseTool', async () => {
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({ queryFn, prompt: 'p', cwd: '/tmp', model: MODEL, allowedTools: COMMUNITY_REFRESH_TOOLS });
  const o = captured();
  assert.equal(o.permissionMode, 'acceptEdits');
  assert.deepEqual([...(o.allowedTools as readonly string[])], [...COMMUNITY_REFRESH_TOOLS]);
  assert.equal(o.canUseTool, undefined);
});

test('fence-mode: writeRoots EMPTY array ⇒ same as absent (no fence, acceptEdits, allowedTools verbatim)', async () => {
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({ queryFn, prompt: 'p', cwd: '/tmp', model: MODEL, allowedTools: COMMUNITY_REFRESH_TOOLS, writeRoots: [] });
  const o = captured();
  assert.equal(o.permissionMode, 'acceptEdits');
  assert.deepEqual([...(o.allowedTools as readonly string[])], [...COMMUNITY_REFRESH_TOOLS]);
  assert.equal(o.canUseTool, undefined);
});
