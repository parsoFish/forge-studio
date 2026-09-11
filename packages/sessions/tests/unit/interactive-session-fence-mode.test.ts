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
 *      turnSpec agent (`skills/brain-maintenance/SKILL.md`,
 *      `skills/creation-agent/SKILL.md`)
 *      lists `Write` there, so `canUseTool` is never invoked for it either.
 *
 * Live evidence: the operator's community-refresh session
 * `2026-08-18T12-54-32-abdfd26b` ran with `writeRoots = [<sessionDir>/staging]`
 * and STILL wrote `/home/parso/forge/studio/community/staging/{registry.yaml,
 * evidence.json,evidence.md}` — outside every declared root — the files
 * exist on disk with mtimes matching the turn's tool_use events. (The
 * `community-refresh` session kind that produced this incident was retired
 * in W8-B5b; the incident is kept here as the motivating evidence — the fix
 * and this module's coverage are general, not specific to that one kind.)
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

import { runAgentTurn, type QueryFn } from '../../interactive-session.ts';

const MODEL = 'claude-sonnet-4-6';
/** The exact tool grant kb-cleanup's real agent, brain-maintenance
 *  (`skills/brain-maintenance/SKILL.md`'s `allowed-tools`), declares — Write
 *  is IN the allow list, which is precisely the shape that bypassed the
 *  fence. (Originally fixtured on community-refresh's own grant; that kind
 *  was retired in W8-B5b, so this now points at a surviving turnSpec agent.) */
const BRAIN_MAINTENANCE_TOOLS = ['Read', 'Grep', 'Glob', 'Write'] as const;
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
    allowedTools: BRAIN_MAINTENANCE_TOOLS, writeRoots: [writeRoot],
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
    allowedTools: BRAIN_MAINTENANCE_TOOLS, writeRoots: [writeRoot],
  });
  const allowed = captured().allowedTools as readonly string[];
  assert.ok(Array.isArray(allowed), 'allowedTools must still be an array');
  for (const gated of FENCE_GATED) {
    assert.ok(!allowed.includes(gated), `${gated} must NOT be pre-approved via allowedTools when a write-root fence is active (pre-approval skips canUseTool)`);
  }
  // Every non-gated grant survives verbatim — the fence never widens or
  // narrows the read grant.
  for (const t of ['Read', 'Grep', 'Glob']) {
    assert.ok(allowed.includes(t), `non-gated grant ${t} must survive`);
  }
});

test('fence-mode: writeRoots non-empty ⇒ the fence-gated tools are NOT pushed into disallowedTools either (they must remain CALLABLE, gated by canUseTool, not removed)', async () => {
  const writeRoot = makeWriteRoot();
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({
    queryFn, prompt: 'p', cwd: writeRoot, model: MODEL,
    allowedTools: BRAIN_MAINTENANCE_TOOLS, disallowedTools: ['Bash'], writeRoots: [writeRoot],
  });
  const disallowed = captured().disallowedTools as readonly string[];
  assert.deepEqual([...disallowed], ['Bash'], 'disallowedTools must pass through verbatim — Write must stay usable inside the root');
});

// AMENDED by bead `forge-a9o9` (T1 rulings 670 / 691). These two pinned the
// UNFENCED shape — `acceptEdits`, `allowedTools` verbatim, no `canUseTool` —
// and that shape is now the defect. S1 run 5 measured a turn reading through
// `LSP`, `TaskOutput` and `Skill`, three tools declared nowhere in this repo,
// precisely because an unfenced turn has no way to refuse a tool nobody named.
// Deny-by-default means there is no longer any such thing as an unfenced turn.
//
// What the amendment does NOT change, and these still assert: a turn's
// DECLARED tools stay pre-approved in `allowedTools`, so an ordinary turn never
// pauses and unattended operation holds. The cost is one mode flip, disclosed
// per adopting kind in the PR title.

test('fence-mode (a9o9): writeRoots absent ⇒ STILL FENCED — default mode, declared tools verbatim, a canUseTool that refuses the rest', async () => {
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({ queryFn, prompt: 'p', cwd: '/tmp', model: MODEL, allowedTools: BRAIN_MAINTENANCE_TOOLS });
  const o = captured();
  assert.equal(o.permissionMode, 'default', 'acceptEdits would short-circuit the prompt the fence rides on');
  assert.deepEqual([...(o.allowedTools as readonly string[])], [...BRAIN_MAINTENANCE_TOOLS], 'the kind keeps every tool it declared');
  assert.equal(typeof o.canUseTool, 'function', 'and an undeclared tool now has something to refuse it');
});

test('fence-mode (a9o9): writeRoots EMPTY array ⇒ same as absent — fenced by the TOOL gate, with no write-root rule inside it', async () => {
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({ queryFn, prompt: 'p', cwd: '/tmp', model: MODEL, allowedTools: BRAIN_MAINTENANCE_TOOLS, writeRoots: [] });
  const o = captured();
  assert.equal(o.permissionMode, 'default');
  assert.deepEqual([...(o.allowedTools as readonly string[])], [...BRAIN_MAINTENANCE_TOOLS], 'no write-root fence, so no names are stripped');
  assert.equal(typeof o.canUseTool, 'function');
});

test('fence-mode (a9o9): the declared tools PASS and an undeclared one is refused, through the real turn\'s own callback', async () => {
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({ queryFn, prompt: 'p', cwd: '/tmp', model: MODEL, allowedTools: BRAIN_MAINTENANCE_TOOLS });
  const fence = captured().canUseTool as (t: string, i: Record<string, unknown>, o: Record<string, unknown>) =>
    Promise<{ behavior: string; message?: string }>;

  for (const tool of BRAIN_MAINTENANCE_TOOLS) {
    assert.equal((await fence(tool, {}, {})).behavior, 'allow', `${tool} is declared by the kind`);
  }
  // The three MEASURED on S1 run 5. Nothing in the fence names them; they are
  // refused for not being declared, which is what also covers the next three.
  for (const tool of ['LSP', 'TaskOutput', 'Skill']) {
    const r = await fence(tool, {}, {});
    assert.equal(r.behavior, 'deny', `${tool} is declared nowhere in this repo and must not be reachable`);
    assert.match(String(r.message), /not declared/i, 'the refusal says why, so the agent stops hunting for the next door');
  }
});
