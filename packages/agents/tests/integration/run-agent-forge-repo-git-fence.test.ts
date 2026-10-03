/**
 * forge-8vfn.8.5.44 (row 208) — proves the forge-repo-git fence is a REAL
 * enforcement point on both `runAgent` spawn shapes, not merely a function
 * that exists somewhere. Drives the actual `runAgent` entry point (never
 * `decideForgeRepoGit` or the hook callback directly) with a capturing
 * `queryFn`, exactly `run-agent-spawn-capture.test.ts`'s idiom, then invokes
 * the `options.hooks.PreToolUse` callback `runAgent` really built — the one
 * the Claude Agent SDK would call — with the 2026-10-03 incident's own
 * seq 52 (`git update-ref refs/heads/main <sha>` at the forge root).
 *
 * Both spawn shapes are covered: the one-shot path (`project-scoped-review`,
 * cloned with a declared `loopStrategy: 'one-shot'`, mirroring every other
 * `run-agent*.test.ts` fixture) and the legacy invocation path (the REAL
 * `onboarding-agent` roster def, which declares no `loopStrategy` — the
 * exact agent kind the incident ran).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../../run-agent.ts';
import { listAgentDefinitions } from '../../studio/agent-registry.ts';
import type { StreamQueryFn } from '../../pinned-sdk-query.ts';
import type { AgentDefinition } from '@forge/contracts';
import { FORGE_ROOT } from '@forge/kernel';

function withoutSpawnSuppressionEnv(): () => void {
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  return () => {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  };
}

function getFixtureDef(defs: AgentDefinition[], slug: string): AgentDefinition {
  const def = defs.find((d) => d.slug === slug);
  assert.ok(def, `expected the ${slug} library fixture in the roster`);
  return def;
}

function oneShotClone(def: AgentDefinition): AgentDefinition {
  return { ...def, runtime: { ...def.runtime, loopStrategy: 'one-shot' }, budgets: { maxTurns: 10, maxBudgetUsd: 1 } };
}

function capturingQueryFn(sink: { options?: Record<string, unknown> }): StreamQueryFn {
  return ((params: { prompt: string; options: Record<string, unknown> }) => {
    sink.options = params.options;
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.01, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

/** Pull the ONE PreToolUse callback `runAgent` built for a fixture that binds
 * no library hook of its own — the forge-repo-git fence IS that one entry
 * (forge-8vfn.8.5.44: it is never absent, never opt-in). */
function soleFenceCallback(options: Record<string, unknown>): (input: unknown) => Promise<Record<string, unknown>> {
  const hooks = options['hooks'] as { PreToolUse?: Array<{ hooks: Array<(input: unknown) => Promise<Record<string, unknown>>> }> } | undefined;
  assert.ok(hooks, 'runAgent must always build an options.hooks bag — the fence is not opt-in');
  assert.equal(Object.keys(hooks).length, 1, 'only PreToolUse should carry anything for a fixture with no bound library hook');
  assert.equal(hooks.PreToolUse!.length, 1, 'no bound library hook on this fixture — ONLY the forge-repo-git fence');
  return hooks.PreToolUse![0]!.hooks[0]!;
}

function readEvents(logFilePath: string): Array<Record<string, unknown>> {
  return readFileSync(logFilePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

const SEQ_52 =
  'cd {{FORGE}} && git update-ref refs/heads/main 8be024930 && git branch -d forge-brain-story-s1-onboard && git log --oneline main -3';
const SEQ_46 =
  'git add .gitignore CLAUDE.md roadmap.md scripts/gates/local.sh .forge/project.json && git commit -m "chore: onboard story-s1"';

test('runAgent one-shot path: options.hooks.PreToolUse really denies seq 52, and logs forge-repo-git.denied', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchForgeRoot = mkdtempSync(join(tmpdir(), 'forge-repo-git-fence-wiring-'));
  try {
    const workdir = join(scratchForgeRoot, 'projects', 'story-s1');
    mkdirSync(workdir, { recursive: true });
    const logsRoot = join(scratchForgeRoot, '_logs');

    const defs = listAgentDefinitions(join(FORGE_ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'));

    const sink: { options?: Record<string, unknown> } = {};
    await runAgent(def, {
      runId: '_agent-fence-wiring',
      workdir,
      forgeRoot: scratchForgeRoot,
      prompt: 'noop',
      logsRoot,
      queryFn: capturingQueryFn(sink),
    });

    const fence = soleFenceCallback(sink.options!);
    const deniedCommand = SEQ_52.replace('{{FORGE}}', scratchForgeRoot);
    const decision = await fence({ tool_name: 'Bash', tool_input: { command: deniedCommand } });
    assert.equal(decision['continue'], true, 'a fence denial never stops the SESSION — it denies the ONE tool call');
    const out = decision['hookSpecificOutput'] as Record<string, unknown> | undefined;
    assert.ok(out, 'seq 52 (git update-ref at the forge root) must be refused');
    assert.equal(out.hookEventName, 'PreToolUse');
    assert.equal(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason as string, /git update-ref/);

    const events = readEvents(join(logsRoot, '_agent-fence-wiring', 'events.jsonl'));
    const denial = events.find((e) => e.message === 'forge-repo-git.denied');
    assert.ok(denial, 'every refusal must be logged (forge-8vfn.8.5.44)');
    assert.equal(denial!.event_type, 'error');
    assert.equal((denial!.metadata as Record<string, unknown>).command, deniedCommand);

    // The ALLOWED counterpart (seq 46's own shape, run inside the project's
    // own nested repo): the fence must stay out of the way.
    const allowed = await fence({ tool_name: 'Bash', tool_input: { command: SEQ_46 } });
    assert.equal('hookSpecificOutput' in allowed, false, 'a legitimate project-repo commit must not be refused');
  } finally {
    rmSync(scratchForgeRoot, { recursive: true, force: true });
    restoreEnv();
  }
});

test('runAgent legacy invocation path (the real onboarding-agent def, which declares no loopStrategy — the incident\'s own agent kind): options.hooks.PreToolUse also denies seq 52', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  // Deliberately NOT a scratch forgeRoot (unlike the one-shot test above):
  // `deriveAgentSpec`'s model-tier resolution reads the REAL `studio/catalog.yaml`
  // off `ctx.forgeRoot ?? FORGE_ROOT`, which a bare scratch dir does not carry.
  // `ctx.forgeRoot` is therefore left absent (defaults to the real `FORGE_ROOT`,
  // this checkout) and the command string below names that SAME real root as
  // its `cd` target — the fence only ever PARSES the string; nothing actually
  // runs it, so naming a real path here commits this test to no filesystem risk.
  const scratchWorkdir = mkdtempSync(join(tmpdir(), 'forge-repo-git-fence-invocation-wiring-'));
  try {
    const logsRoot = join(scratchWorkdir, '_logs');
    const defs = listAgentDefinitions(join(FORGE_ROOT, 'skills'));
    const def = getFixtureDef(defs, 'onboarding-agent');
    assert.equal(def.runtime.loopStrategy, undefined, 'sanity: onboarding-agent is a legacy invocation-path agent (no declared loopStrategy)');

    const sink: { options?: Record<string, unknown> } = {};
    await runAgent(def, {
      runId: '_agent-fence-invocation-wiring',
      workdir: scratchWorkdir,
      prompt: 'noop',
      logsRoot,
      queryFn: capturingQueryFn(sink),
    });

    const fence = soleFenceCallback(sink.options!);
    const deniedCommand = SEQ_52.replace('{{FORGE}}', FORGE_ROOT);
    const decision = await fence({ tool_name: 'Bash', tool_input: { command: deniedCommand } });
    const out = decision['hookSpecificOutput'] as Record<string, unknown> | undefined;
    assert.ok(out, 'seq 52 must be refused on the invocation path too');
    assert.equal(out.permissionDecision, 'deny');
  } finally {
    rmSync(scratchWorkdir, { recursive: true, force: true });
    restoreEnv();
  }
});
