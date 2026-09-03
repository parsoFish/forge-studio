/**
 * Containment of the dispatch seam — bead `forge-8vfn.5.37`.
 *
 * `SPEC.md` §1: "The caller binds the run — which worktree, which run id,
 * which artifacts." A spawn whose working directory comes from whatever
 * directory the PARENT process happened to be in is not bound by its caller;
 * it is bound by an accident of invocation.
 *
 * THE DEFECT this file pins (measured 2026-09-03, M4-agents):
 * `agent-dispatch.ts` resolved its spawn cwd as
 *
 *     const workdir = opts.workdir ?? opts.project?.repoPath ?? process.cwd();
 *
 * and `run-agent.ts` passes that straight to the SDK as `options.cwd`. With
 * no project bound — a supported CLI invocation, since `cmdAgentDispatch`
 * treats `--project` as optional — the agent ran wherever the parent stood.
 * In production that is the forge checkout itself, because `apps/forge/cli.ts`
 * chdir's to `FORGE_ROOT` two files away (COMMON §15.21's "right by accident
 * of a chdir elsewhere"), so an unbound agent got the forge repository as its
 * working directory. Bead 5.37 records S3's onboarding agent doing exactly
 * that to another checkout.
 *
 * The fix binds the run: with no project, the agent works in its OWN run
 * directory. T1's ruling admits either a refusal or a derivation from the
 * session directory; a refusal would break the shipped no-project CLI path,
 * so this derives.
 *
 * Separate file rather than a case in `agent-dispatch.test.ts` because that
 * file sits at its exact `check-file-size` ceiling (863) — an exemption is a
 * ceiling, not a licence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchAgentRun } from './agent-dispatch.ts';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';

const SKILLS = join(FORGE_ROOT, 'skills');

/**
 * A synthetic one-shot definition rather than a real roster entry. The roster
 * loader still lives in `orchestrator/studio/registry.ts`, and importing it
 * from a NEW file would mint a fresh `package-to-legacy` boundary row —
 * `check-boundaries` refused exactly that and was right to: the baseline only
 * shrinks. The dispatch's `loadDefs` seam is injected here anyway, so nothing
 * about this test needed the real roster; what it needs is *an* agent, and a
 * hermetic one is the better test. (Once the Agent-kind registry split lands
 * in this package, a real def costs no boundary row and this can use one.)
 */
function oneShotDef(slug: string): AgentDefinition {
  return {
    slug,
    name: slug,
    description: `Agent ${slug}.`,
    purpose: 'Containment fixture.',
    composition: { skills: [], tools: [], mcps: [], hooks: [], guards: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', loopStrategy: 'one-shot' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: { maxTurns: 25, maxBudgetUsd: 3.5 },
    allowedTools: [],
    disallowedTools: [],
    body: 'Body.',
    path: join(SKILLS, slug, 'SKILL.md'),
  } as AgentDefinition;
}

/** The suppression env would short-circuit before the spawn options are built. */
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

function capturingQueryFn(captured: { value: { options: Record<string, unknown> } | null }): StreamQueryFn {
  return ((params: { prompt: string; options: Record<string, unknown> }) => {
    captured.value = { options: params.options };
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.01, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

test('dispatchAgentRun CONTAINMENT: with no project and no workdir, the spawn cwd is the run directory — never the parent process cwd (forge-8vfn.5.37)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-containment-'));
  try {
    const runId = 'CONTAINMENT-NO-PROJECT-TEST';
    const logsRoot = join(dir, '_logs');
    const captured: { value: { options: Record<string, unknown> } | null } = { value: null };

    await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: SKILLS,
      runId,
      logsRoot,
      loadDefs: () => [oneShotDef('project-scoped-review')],
      queryFn: capturingQueryFn(captured),
    });

    assert.ok(captured.value, 'queryFn must have been invoked — the dispatch must reach the real spawn call');
    const cwd = captured.value!.options.cwd;

    // Asserted positively, not merely as "not the cwd": a `notEqual` alone
    // would pass for `undefined`, for a deleted field, or for any third
    // directory that is equally uncontained.
    assert.equal(
      cwd,
      join(logsRoot, runId),
      'an agent dispatched with no project must work inside its own run directory',
    );
    assert.notEqual(
      cwd,
      process.cwd(),
      'the spawn cwd must never be inherited from the parent process (bead forge-8vfn.5.37: an agent that inherits the parent cwd can act on any checkout on the host)',
    );
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dispatchAgentRun CONTAINMENT: an explicit project binding still wins — the fix does not shadow the caller (forge-8vfn.5.37)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-containment-project-'));
  try {
    const runId = 'CONTAINMENT-WITH-PROJECT-TEST';
    const logsRoot = join(dir, '_logs');
    const repoPath = join(dir, 'a-project-repo');
    const captured: { value: { options: Record<string, unknown> } | null } = { value: null };

    await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: SKILLS,
      runId,
      logsRoot,
      project: { name: 'a-project', repoPath },
      loadDefs: () => [oneShotDef('project-scoped-review')],
      queryFn: capturingQueryFn(captured),
    });

    assert.ok(captured.value, 'queryFn must have been invoked');
    assert.equal(
      captured.value!.options.cwd,
      repoPath,
      'a bound project is the agent\'s worktree and must remain the spawn cwd — the containment default applies only when nothing was bound',
    );
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});
