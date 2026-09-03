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
import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchAgentRun } from '../../agent-dispatch.ts';
import { runAgent } from '../../run-agent.ts';
import { cmdAgentDispatch } from '../../agent-dispatch-cmd.ts';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import type { StreamQueryFn } from '../../pinned-sdk-query.ts';
import { AGENT_RUN_MARKER_FILE, readRunMarkers } from '../../spawn-marker.ts';

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

/**
 * The containment default changes an unbound dispatch from "the forge
 * checkout" to "an empty run directory". Both are silent to the operator
 * unless the dispatcher says which branch it took — declared data that
 * nothing surfaces is the class this campaign keeps finding, so the event is
 * pinned in both directions.
 */
function eventMessages(logsRoot: string, runId: string): string[] {
  const path = join(logsRoot, runId, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l).message as string);
}

test('dispatchAgentRun REPORTS an unbound run: no project and no workdir emits agent-dispatch.no-project-bound (forge-8vfn.5.37)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-unbound-event-'));
  try {
    const runId = 'CONTAINMENT-EVENT-TEST';
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
    assert.ok(
      eventMessages(logsRoot, runId).includes('agent-dispatch.no-project-bound'),
      'an unbound dispatch must say so in the event log — otherwise the operator cannot tell an intentional scratch run from an agent that needed a checkout and silently got an empty directory',
    );
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dispatchAgentRun does NOT report an unbound run when a project IS bound (forge-8vfn.5.37)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-bound-event-'));
  try {
    const runId = 'CONTAINMENT-EVENT-BOUND-TEST';
    const logsRoot = join(dir, '_logs');
    const captured: { value: { options: Record<string, unknown> } | null } = { value: null };
    await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: SKILLS,
      runId,
      logsRoot,
      project: { name: 'a-project', repoPath: join(dir, 'a-project-repo') },
      loadDefs: () => [oneShotDef('project-scoped-review')],
      queryFn: capturingQueryFn(captured),
    });
    assert.ok(
      !eventMessages(logsRoot, runId).includes('agent-dispatch.no-project-bound'),
      'a bound run must not claim it was unbound — the negative half, without which the assertion above would pass on an unconditional emit',
    );
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The error path for an unsafe runId used that same runId to build a path.
 *
 * `dispatchAgentRun` refuses a traversing `runId` (`isSafeRunId`, throwing
 * "unsafe runId (path-traversal risk)"). That throw lands in
 * `cmdAgentDispatch`'s outer catch, which writes a terminal-failure marker
 * with `createLogger(runId, ...)` — and `createLogger` does
 * `resolve(logsDir, cycleId)` with no validation of its own. So the handler
 * that had just identified the value as dangerous handed it straight to a
 * path resolution: `resolve('<forgeRoot>/_logs', '../../../../tmp/x')` is
 * `/tmp/x`, and mkdir+append there succeed silently.
 *
 * Found by the adversarial containment review of the fix itself, which is
 * what that review is for.
 */
test('cmdAgentDispatch REFUSES to write the terminal marker with an unsafe runId — the error path must not use the value it just rejected (forge-8vfn.5.37)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-marker-traversal-'));
  const escapeTarget = join(dir, 'ESCAPED');
  const forgeRoot = join(dir, 'forge');
  const origExit = process.exit;
  const origErr = console.error;
  const errs: string[] = [];
  try {
    // A runId that climbs out of <forgeRoot>/_logs and lands in `escapeTarget`.
    const traversal = join('..', '..', 'ESCAPED');
    process.exit = ((code?: number) => { throw new Error(`__exit__${code ?? 0}`); }) as typeof process.exit;
    console.error = (...a: unknown[]) => { errs.push(a.join(' ')); };
    try {
      await cmdAgentDispatch(['project-scoped-review', '--run-id', traversal], forgeRoot);
    } catch (e) {
      if (!/^__exit__/.test((e as Error).message)) throw e;
    }
    assert.equal(
      existsSync(escapeTarget),
      false,
      `the terminal-failure marker must never be written through an unsafe runId — found a directory at ${escapeTarget}, outside the logs root`,
    );
  } finally {
    process.exit = origExit;
    console.error = origErr;
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Bead `forge-8vfn.5.50` — the runtime OWNS what it spawns.
//
// The containment tests above bind where an agent works. These bind what
// happens when it escapes anyway: every child this runtime spawns carries the
// run's own token, so a `setsid`'d orphan — invisible to the story reaper's
// ppid walk AND to its process-group sweep (`scripts/stories/reap.mjs`) — can
// still be identified as ours after every other trace of ownership is gone.
// The token itself, its minting rules and the `/proc` sweep are pinned in
// `./spawn-marker.test.ts` on real processes; these two cases pin the WIRING:
// that both spawn paths actually carry it, and that the run records it where
// a reaper looks.
// ---------------------------------------------------------------------------

/** A legacy (non-one-shot) definition — `runAgent`'s adapter/invocation path. */
function invocationDef(slug: string): AgentDefinition {
  const def = oneShotDef(slug) as AgentDefinition & { runtime: { loopStrategy?: string } };
  return { ...def, runtime: { ...def.runtime, loopStrategy: undefined } } as AgentDefinition;
}

test('5.50 a ONE-SHOT run records its spawn marker where a reaper reads it', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-spawn-marker-oneshot-'));
  try {
    const runId = 'MARKER-ONE-SHOT-TEST';
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

    const recorded = readRunMarkers(join(logsRoot, runId))[0];
    assert.ok(
      recorded,
      `the run recorded no ${AGENT_RUN_MARKER_FILE}: a marker no artifact of the run names is one no reaper can sweep by`,
    );
    assert.ok(recorded!.startsWith(`${runId}:`), 'the token names its own run');

    // The INJECTED query is used verbatim (see `resolveRunQuery`), which is
    // what keeps the five spawn-capture goldens byte-identical — asserted
    // here so a future change that starts wrapping injected queries fails
    // HERE, next to the reason, rather than in five characterization
    // fixtures with no explanation.
    assert.equal(
      (captured.value!.options as { env?: unknown }).env,
      undefined,
      'an injected queryFn must receive the phase\'s own option bag, unmarked',
    );
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('5.50 a LEGACY invocation run records one too — the onboarding agent that escaped runs on THIS path', async () => {
  // `onboarding-agent` declares no `loopStrategy`, so the S3 escape went
  // through `runInvocationSpawn` -> the adapter -> `createClaudeAgent`, not
  // through the one-shot path. Marking only the one-shot path would leave the
  // exact shape bead 5.37 recorded unmarked.
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-spawn-marker-legacy-'));
  try {
    const runId = 'MARKER-LEGACY-TEST';
    const logsRoot = join(dir, '_logs');
    const captured: { value: { options: Record<string, unknown> } | null } = { value: null };

    await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: SKILLS,
      runId,
      logsRoot,
      workdir: dir,
      loadDefs: () => [invocationDef('project-scoped-review')],
      queryFn: capturingQueryFn(captured),
    });

    assert.ok(captured.value, 'the invocation path must reach the real spawn call');
    assert.ok(
      readRunMarkers(join(logsRoot, runId)).length === 1,
      'the invocation path recorded no marker — the path the S3 escape took would be unsweepable',
    );
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('5.50 a `lifecycle: "caller"` run records its marker too — the four phase pipelines are not covered in appearance only', async () => {
  // The PM, reflector, demo-agent and adversarial-review phases all call
  // `runAgent` with `lifecycle: 'caller'`, and every flow-runner node injects
  // its own logger. Their children carried the token from the first cut, but
  // nothing recorded it — so no artifact of the run named the token to sweep
  // for, and 5.50 covered the bulk of forge's real workload in name only.
  // Found by `silent-failure-hunter` on this diff.
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-spawn-marker-caller-'));
  try {
    const runId = 'MARKER-CALLER-LIFECYCLE-TEST';
    const logsRoot = join(dir, '_logs');
    const captured: { value: { options: Record<string, unknown> } | null } = { value: null };

    await runAgent(oneShotDef('project-scoped-review'), {
      runId,
      workdir: dir,
      prompt: 'test',
      logsRoot,
      lifecycle: 'caller',
      queryFn: capturingQueryFn(captured),
    });

    assert.ok(captured.value, 'the caller-lifecycle branch must reach the spawn');
    assert.equal(readRunMarkers(join(logsRoot, runId)).length, 1, 'a caller-lifecycle run recorded no marker');
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('5.50 an unrecordable marker is REPORTED and the run still completes — it is a deviation, not a failure', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-spawn-marker-deviation-'));
  const errors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  try {
    const runId = 'MARKER-DEVIATION-TEST';
    const logsRoot = join(dir, '_logs');
    mkdirSync(logsRoot, { recursive: true });
    // A FILE where the run directory must be: `mkdirSync` fails, so the marker
    // cannot be written. An injected logger keeps `createLogger` out of it, so
    // the only thing this breaks is the marker.
    writeFileSync(join(logsRoot, runId), 'not a directory');
    const captured: { value: { options: Record<string, unknown> } | null } = { value: null };

    const result = await runAgent(oneShotDef('project-scoped-review'), {
      runId,
      workdir: dir,
      prompt: 'test',
      logsRoot,
      logger: { cycleId: runId, logFilePath: join(dir, 'noop.jsonl'), emit: (e: Record<string, unknown>) => ({ ...e, event_id: 'x' }) } as never,
      queryFn: capturingQueryFn(captured),
    });

    assert.ok(result, 'the run must still complete — refusing to run over an unrecordable marker is worse than the leak');
    const reported = errors.find((e: string) => e.includes('could not record the spawn marker'));
    assert.ok(reported, `the failure was swallowed; console.error saw: ${JSON.stringify(errors)}`);
    assert.match(reported!, /will not be sweepable by marker/, 'the report must name the CONSEQUENCE, not just the errno');
    assert.match(reported!, new RegExp(runId), 'the report must name the run');
  } finally {
    console.error = realError;
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('5.50 a SUPPRESSED run records NO marker — a marker is a record of a child that exists', async () => {
  // `logsRoot` defaults to `<FORGE_ROOT>/_logs`, so recording before the
  // dry-bridge/no-spawn early return had the test suite alone minting ten
  // marker files into the repository's own log tree — each one a claim about a
  // process nobody spawned. Same placement rule as the connection-readiness
  // gate immediately above it in `runAgent`.
  const dir = mkdtempSync(join(tmpdir(), 'agent-spawn-marker-suppressed-'));
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const runId = 'MARKER-SUPPRESSED-TEST';
    const logsRoot = join(dir, '_logs');
    const result = await runAgent(oneShotDef('project-scoped-review'), {
      runId,
      workdir: dir,
      prompt: 'test',
      logsRoot,
      queryFn: (() => {
        throw new Error('a suppressed run must never reach the spawn');
      }) as never,
    });
    assert.equal(result.suppressed, true);
    assert.equal(existsSync(join(logsRoot, runId, AGENT_RUN_MARKER_FILE)), false, 'a suppressed run wrote a marker');
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});
