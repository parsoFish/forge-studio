/**
 * Tests for `packages/agents/band-agent-run.ts` — the standalone isolation
 * surface for the band-guard node agents, after the carve out of
 * `orchestrator/band-agent-run.ts`.
 *
 * What this file proves is the module's OWN logic: the resolution boundary
 * errors, the isolation invariants (runId-scoped events, in-flight refusal,
 * input validation, worktree bounds), and — the point of the carve — that the
 * whole path is satisfiable by a `BandPipelineRunner` that imports no phase.
 *
 * What it deliberately does NOT prove is parity with the real flow band: that
 * needs `runDemoAgentPipeline` itself, which lives in `@forge/factory` (rank 7)
 * and may never be imported from this package (rank 3). That test moved to
 * `apps/forge/band-agent-standalone-parity.test.ts`, the layer that legally
 * holds both sides, and it is the one that proves the injected runner is the
 * real pipeline. Neither test is sufficient alone; both ship.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { test } from 'node:test';

import {
  runBandAgentStandalone,
  isStandaloneBandAgent,
  type BandAgentDeps,
  type BandPipelineCall,
} from '../../band-agent-run.ts';
import { FORGE_ROOT } from '@forge/kernel';

const INIT = 'INIT-2026-08-02-standalone-demo';
const RUN = 'RUN-2026-08-02-band-standalone';

/**
 * The queue layout the deps port declares, written out here rather than taken
 * from `@forge/flows` (rank 6 — this package may not import it). The REAL
 * `getPaths` is bound at `apps/forge/cli.ts`, and because `BandQueuePaths`
 * declares all six directories as required, a rename in flows breaks the
 * repo-wide typecheck at that assembly site rather than passing here.
 */
function fakeQueuePaths(queueRoot: string) {
  return {
    pending: join(queueRoot, 'pending'),
    inFlight: join(queueRoot, 'in-flight'),
    readyForReview: join(queueRoot, 'ready-for-review'),
    merged: join(queueRoot, 'merged'),
    done: join(queueRoot, 'done'),
    failed: join(queueRoot, 'failed'),
  };
}

/** A minimal frontmatter reader for the three fields the band surface reads. */
function fakeParseManifest(content: string) {
  const field = (name: string): string | undefined =>
    (new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(content) ?? [])[1]?.trim();
  const budget = field('cost_budget_usd');
  return {
    worktree_path: field('worktree_path'),
    project_repo_path: field('project_repo_path'),
    ...(budget === undefined ? {} : { cost_budget_usd: Number(budget) }),
  };
}

/** Deps whose pipeline runner records its call and returns a canned outcome. */
function depsWithRecorder(
  outcome: { status: 'complete' | 'complete-with-misses' | 'failed' } = { status: 'complete' },
  emitCost?: number,
): { deps: BandAgentDeps; calls: BandPipelineCall[] } {
  const calls: BandPipelineCall[] = [];
  const deps: BandAgentDeps = {
    queuePaths: fakeQueuePaths,
    parseInitiativeManifest: fakeParseManifest,
    runPipeline: async (call) => {
      calls.push(call);
      if (emitCost !== undefined) {
        call.logger.emit({
          initiative_id: call.input.initiativeId,
          phase: 'orchestrator',
          skill: 'fake-band',
          event_type: 'log',
          input_refs: [],
          output_refs: [],
          cost_usd: emitCost,
          metadata: {},
        });
      }
      return outcome;
    },
  };
  return { deps, calls };
}

/** Write an initiative manifest (worktree_path → wt) into a queue state dir. */
function writeManifest(stateDir: string, worktreePath: string): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, `${INIT}.md`), [
    '---', `initiative_id: ${INIT}`, 'project: fix', `project_repo_path: ${worktreePath}`,
    "created_at: '2026-08-02T00:00:00.000Z'", 'iteration_budget: 2', 'cost_budget_usd: 1',
    'phase: ready-for-review', 'origin: architect', `worktree_path: ${worktreePath}`, `cycle_id: ${INIT}`,
    '---', `# ${INIT}`, '',
  ].join('\n'));
}

test('isStandaloneBandAgent: only a band-hook node agent that still spawns', () => {
  // `demo-agent` is a declaration carrier since spec §5 item 4 deleted the LLM
  // demo node — the band it names runs orchestrator-side and there is no turn to
  // re-run, so it is refused here exactly as `contract-check` always has been.
  assert.equal(isStandaloneBandAgent('demo-agent'), false);
  assert.equal(isStandaloneBandAgent('contract-check'), false);
  assert.equal(isStandaloneBandAgent('adversarial-review'), true);
  assert.equal(isStandaloneBandAgent('developer-ralph'), false);
  assert.equal(isStandaloneBandAgent('project-manager'), false);
});

test('runBandAgentStandalone: a non-band agent is refused', async () => {
  await assert.rejects(
    runBandAgentStandalone({ slug: 'project-manager', initiativeId: INIT, runId: RUN, forgeRoot: '/tmp/none' }, depsWithRecorder().deps),
    /not a standalone-runnable band agent/,
  );
});

test('runBandAgentStandalone: a missing runId is refused', async () => {
  await assert.rejects(
    runBandAgentStandalone({ slug: 'adversarial-review', initiativeId: INIT, runId: '', forgeRoot: '/tmp/none' }, depsWithRecorder().deps),
    /runId is required/,
  );
});

test('runBandAgentStandalone: an unsafe initiative id is refused before any path is joined', async () => {
  await assert.rejects(
    runBandAgentStandalone({ slug: 'adversarial-review', initiativeId: '../../etc/passwd', runId: RUN, forgeRoot: '/tmp/none' }, depsWithRecorder().deps),
    /invalid initiative id/,
  );
});

test('runBandAgentStandalone: no manifest for the initiative → clear boundary error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'band-run-nomanifest-'));
  try {
    mkdirSync(join(root, '_queue', 'ready-for-review'), { recursive: true });
    await assert.rejects(
      runBandAgentStandalone({ slug: 'adversarial-review', initiativeId: INIT, runId: RUN, forgeRoot: root }, depsWithRecorder().deps),
      /no runnable manifest for initiative/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runBandAgentStandalone: an in-flight initiative is refused (a live cycle owns the worktree)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'band-run-inflight-'));
  try {
    // A bounds-valid worktree so the refusal is proven to come from the state, not bounds.
    const wt = join(root, '_worktrees', 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(join(root, '_queue', 'in-flight'), wt);
    await assert.rejects(
      runBandAgentStandalone({ slug: 'adversarial-review', initiativeId: INIT, runId: RUN, forgeRoot: root }, depsWithRecorder().deps),
      /is in-flight — a live scheduler cycle owns its worktree/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runBandAgentStandalone: a worktree outside the forge roots is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'band-run-oob-'));
  try {
    const outside = mkdtempSync(join(tmpdir(), 'band-run-oob-elsewhere-'));
    try {
      writeManifest(join(root, '_queue', 'ready-for-review'), outside);
      await assert.rejects(
        runBandAgentStandalone({ slug: 'adversarial-review', initiativeId: INIT, runId: RUN, forgeRoot: root }, depsWithRecorder().deps),
        /is outside the forge roots/,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The port control (Task 5.2): the whole standalone path is satisfiable by a
// runner that imports no phase. This is what the carve buys — before it, the
// module reached `@forge/factory/phases/adversarial-review.ts`
// from rank 3's dependency graph, and no test could run it without them.
// ---------------------------------------------------------------------------

test('runBandAgentStandalone: the review arm runs to completion against an injected runner that imports no phase — events land under the runId, the initiative cycle_id log is untouched, and a terminal `end` marks the run done', async () => {
  const root = mkdtempSync(join(tmpdir(), 'band-run-port-'));
  try {
    const wt = join(root, '_worktrees', 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(join(root, '_queue', 'ready-for-review'), wt);

    const { deps, calls } = depsWithRecorder({ status: 'complete' }, 0.25);
    const out = await runBandAgentStandalone(
      { slug: 'adversarial-review', initiativeId: INIT, runId: RUN, forgeRoot: root },
      deps,
    );

    assert.equal(out.kind, 'review');
    assert.equal(out.slug, 'adversarial-review');
    assert.equal(out.runId, RUN);
    assert.equal(out.initiativeId, INIT);
    assert.equal(out.result.status, 'complete');

    // The port carried the resolved initiative context, not the raw request.
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.kind, 'review');
    assert.equal(calls[0]!.input.worktreePath, wt);
    assert.equal(calls[0]!.input.cycleId, RUN, 'the pipeline runs under the RUN id, never the initiative cycle_id');
    assert.equal(calls[0]!.input.logsRoot, join(root, '_logs'));
    assert.equal(calls[0]!.input.costBudgetUsd, 1, 'the manifest budget reached the pipeline');
    assert.equal(calls[0]!.input.forgeRoot, root);

    const runEvents = join(root, '_logs', RUN, 'events.jsonl');
    const parsed = readFileSync(runEvents, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(parsed.some((e) => e.event_type === 'start'), 'a start event opened the run');
    const end = parsed.find((e) => e.event_type === 'end');
    assert.ok(end, 'a terminal end event was emitted (the status endpoint reads it as done)');
    assert.equal(end.cost_usd, 0.25, "the end event carries the run's summed cost");
    assert.equal(end.metadata.pipeline_status, 'complete');
    assert.ok(!readdirSync(join(root, '_logs')).includes(INIT), 'the initiative cycle_id log was never created');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runBandAgentStandalone: the review arm passes projectName from the manifest and reports a failed pipeline status without throwing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'band-run-review-'));
  try {
    const wt = join(root, '_worktrees', 'wt');
    mkdirSync(wt, { recursive: true });
    writeManifest(join(root, 'projects', 'fix'), wt); // unused dir, keeps the shape honest
    writeManifest(join(root, '_queue', 'failed'), wt);

    const { deps, calls } = depsWithRecorder({ status: 'failed' });
    const out = await runBandAgentStandalone(
      { slug: 'adversarial-review', initiativeId: INIT, runId: RUN, forgeRoot: root },
      deps,
    );
    assert.equal(out.kind, 'review');
    assert.equal(out.result.status, 'failed');
    assert.equal(calls[0]!.kind, 'review');
    assert.equal(calls[0]!.input.projectName, 'wt', 'basename(project_repo_path) reached the review pipeline');

    const parsed = readFileSync(join(root, '_logs', RUN, 'events.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(parsed.find((e) => e.event_type === 'end').metadata.pipeline_status, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The structural half of exit row 4. A green functional test above would still
// pass if a single file in the package re-imported a phase, so assert the
// absence directly against the package's own source.
// ---------------------------------------------------------------------------

test('exit row 4 (STRUCTURAL): no file under packages/agents imports a factory phase or an orchestrator/ module', () => {
  const pkg = join(FORGE_ROOT, 'packages', 'agents');
  const FACTORY_DIR = join(FORGE_ROOT, 'packages', 'factory');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1]!;
        // Resolve before judging. A bare substring test misses the RELATIVE
        // form — `'../factory/phases/reflector.ts'` from inside this package
        // reaches the same file and contains neither `@forge/factory` nor
        // `packages/factory`. Measured: a planted relative import passed a
        // substring check and failed this one. (M5-A: the legacy
        // `orchestrator/phases` disjunct this replaced went dead when those two
        // modules moved into `packages/factory`.)
        const target = spec.startsWith('.') ? resolve(dirname(full), spec) : spec;
        if (target.startsWith(FACTORY_DIR) || target.startsWith('@forge/factory')) {
          offenders.push(`${full.slice(FORGE_ROOT.length + 1)} → ${spec}`);
        }
      }
    }
  };
  walk(pkg);
  assert.deepEqual(offenders, [],
    'packages/agents (rank 3) must not reach a factory phase (rank 7). The band pipelines arrive through ' +
    'BandAgentDeps.runPipeline, injected at apps/forge/cli.ts.');
});
