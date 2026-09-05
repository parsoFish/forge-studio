/**
 * PARITY: the band pipelines the standalone surface actually runs.
 *
 * `packages/agents/band-agent-run.ts` runs the band-guard node agent through its
 * FLOW pipeline rather than the bare `runAgent` spawn — that parity IS the
 * module's reason to exist (R4-10-F3, ADR-039). Proving it needs
 * `runAdversarialReview` itself, which is `@forge/factory` (rank 7) and may
 * never be imported from `packages/agents` (rank 3). This is the layer that
 * legally holds both sides, so the parity case lives here — carried over
 * verbatim from `orchestrator/band-agent-run.test.ts` when that file was
 * carved (M4-agents, exit row 4).
 *
 * It was the DEMO arm until spec §5 item 4 deleted the LLM demo node; the review
 * band is the one that still spawns, so it is the one whose parity can be
 * proven. The claim is unchanged — the production binding runs the REAL pipeline
 * in-process, and the same artifact a flow run produces lands on disk.
 *
 * The package's own `band-agent-run.test.ts` proves the surrounding logic
 * against an injected runner; what it CANNOT prove is that the injected runner
 * is the real thing. So this file drives the production binding —
 * `bandAgentDeps` from `./band-agent-deps.ts`, the same object `cli.ts` passes
 * in — and asserts `cli.ts` passes it. Neither half is sufficient alone.
 */

import assert from 'node:assert/strict';
import { AGENT_DISPATCH_DEPS, architectManifestPorts } from './session-kind-deps.ts';
import { bandAgentDeps } from './band-agent-deps.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runBandAgentStandalone } from '@forge/agents/band-agent-run.ts';
import { serializeWorkItem, type WorkItem } from '@forge/flows/work-item.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';

const INIT = 'INIT-2026-08-02-standalone-review';
const RUN = 'RUN-2026-08-02-band-standalone';

function withoutSpawnSuppressionEnv(): () => void {
  const p1 = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const p2 = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  return () => {
    if (p1 === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN; else process.env.FORGE_ARCHITECT_NO_SPAWN = p1;
    if (p2 === undefined) delete process.env.FORGE_DRY_BRIDGE; else process.env.FORGE_DRY_BRIDGE = p2;
  };
}

/** Write an initiative manifest (worktree_path → wt) into a queue state dir. */
function writeManifest(stateDir: string, worktreePath: string): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, `${INIT}.md`), [
    '---', `initiative_id: ${INIT}`, 'project: fix', `project_repo_path: ${worktreePath}`,
    "created_at: '2026-08-02T00:00:00.000Z'", 'iteration_budget: 2', 'cost_budget_usd: 1', 'class: code',
    'phase: ready-for-review', 'origin: architect', `worktree_path: ${worktreePath}`, `cycle_id: ${INIT}`,
    '---', `# ${INIT}`, '',
  ].join('\n'));
}

test('runBandAgentStandalone with the PRODUCTION deps: the standalone review pipeline runs against a seeded worktree → complete, same review-findings artifact, runId-scoped log', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const root = mkdtempSync(join(tmpdir(), 'band-run-'));
  try {
    // A real post-develop worktree (bare origin + clone + feature branch), the
    // same shape the flow's demo band derives from — placed UNDER the forge
    // `_worktrees` root so the standalone bounds-check accepts it.
    const bare = join(root, 'origin.git');
    execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' });
    const wt = join(root, '_worktrees', 'wt');
    mkdirSync(join(root, '_worktrees'), { recursive: true });
    execFileSync('git', ['clone', bare, wt], { stdio: 'pipe' });
    const git = (args: string[]) => execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' });
    git(['config', 'user.email', 'test@forge']);
    git(['config', 'user.name', 'forge-test']);
    git(['checkout', '-q', '-b', 'main']);
    writeFileSync(join(wt, 'package.json'), JSON.stringify({ name: 'fix', scripts: { ok: 'echo ok' } }));
    mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
    writeFileSync(join(wt, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['echo', 'ok'] } } }));
    const wi: WorkItem = {
      work_item_id: 'WI-1', initiative_id: INIT, status: 'complete', depends_on: [],
      acceptance_criteria: [{ given: 'the CLI is built', when: 'it runs bare', then: 'usage prints' }],
      files_in_scope: ['src.ts'], estimated_iterations: 1, quality_gate_cmd: ['echo', 'ok'], body: 'Build.',
    };
    writeFileSync(join(wt, '.forge', 'work-items', 'WI-1.md'), serializeWorkItem(wi));
    writeFileSync(join(wt, 'src.ts'), 'export const v = 1;\n');
    git(['add', '-A']); git(['commit', '-q', '-m', 'main baseline']); git(['push', '-q', 'origin', 'main']);
    git(['checkout', '-q', '-b', `feat/${INIT}`]);
    writeFileSync(join(wt, 'src.ts'), 'export const v = 2;\n');
    git(['add', 'src.ts']); git(['commit', '-q', '-m', 'feat: change']); git(['push', '-q', '-u', 'origin', `feat/${INIT}`]);

    // The initiative's manifest in the queue (worktree_path points at wt) —
    // read here by the REAL `parseManifest`/`getPaths` the deps object binds.
    writeManifest(join(root, '_queue', 'ready-for-review'), wt);

    // A queryFn standing in for the review agent: authors the findings file with
    // the run identity echoed back, exactly as the flow band's spawn must.
    const qf = ((params: { prompt: string }) => {
      async function* gen(): AsyncGenerator<unknown> {
        const headSha = (/head SHA[^`]*`([0-9a-f]+)`/.exec(params.prompt) ?? [])[1]
          ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
        writeFileSync(join(wt, '.forge', 'review-findings.json'), JSON.stringify({
          initiative_id: INIT,
          cycleId: RUN,
          baseRef: 'main',
          headSha,
          reviewedAt: '2026-09-05T00:00:00Z',
          summary: 'one pointer-backed finding on the changed file',
          // Spec §5 item 5: the record carries the class's lenses, ONE verdict per
          // injected criterion (matched verbatim, exact set membership) and the
          // reviewer's narrative. The criterion string is the one the WI above
          // declares, rendered the way the pipeline renders it into the prompt.
          lenses: ['correctness', 'containment', 'test-strength', 'boundary'],
          acEvaluations: [{
            criterion: '(WI-1) GIVEN the CLI is built WHEN it runs bare THEN usage prints',
            verdict: 'partial',
            evidence: 'usage prints, but the changed constant is unasserted',
          }],
          whyWhatHow: { why: 'the CLI must print usage when run bare', what: 'a constant and its call site', how: 'the exported value moved from 1 to 2' },
          findings: [{
            id: 'RF-1',
            severity: 'minor',
            category: 'correctness',
            title: 'the exported constant changed value without a test',
            detail: 'src.ts moved from 1 to 2 and no test names either value.',
            evidence: [{ file: 'src.ts', line: 1, excerpt: 'export const v = 2;' }],
          }],
        }));
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.1, usage: { input_tokens: 5, output_tokens: 7 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;

    const out = await runBandAgentStandalone(
      { slug: 'adversarial-review', initiativeId: INIT, runId: RUN, forgeRoot: root, queryFn: qf },
      bandAgentDeps,
    );
    assert.equal(out.kind, 'review');
    assert.equal(out.runId, RUN);
    assert.equal(out.result.status, 'complete', 'the standalone review pipeline completed against the seeded worktree');
    assert.ok(
      existsSync(join(root, '_logs', RUN, 'artifacts', 'review-findings.json')),
      'the SAME review-findings artifact a flow run produces, persisted under the run',
    );
    assert.ok(
      !existsSync(join(wt, '.forge', 'review-findings.json')),
      'the pipeline scrubbed its worktree copy in-process (parity) — nothing untracked is left to block a merge',
    );

    // Isolation: events land under _logs/<runId>/, NOT the initiative's cycle_id,
    // and a terminal `end` marks the run 'done' for the runId-keyed status endpoint.
    const runEvents = join(root, '_logs', RUN, 'events.jsonl');
    assert.ok(existsSync(runEvents), 'events were written under the runId, not the cycle_id');
    assert.ok(!existsSync(join(root, '_logs', INIT, 'events.jsonl')), 'the initiative cycle_id log was never touched');
    const parsed = readFileSync(runEvents, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(parsed.some((e) => e.event_type === 'end'), 'a terminal end event was emitted (status endpoint reads it as done)');
  } finally {
    rmSync(root, { recursive: true, force: true });
    restore();
  }
});

test('ASSEMBLY: cli.ts hands the production band deps to cmdAgent — without this line every standalone band dispatch refuses', () => {
  // The oracle is not observable through a spawn without writing a real run
  // into this repo's own `_logs`, so the gate is structural (COMMON §15.75):
  // assert the binding IS on the path. Its negative twin — a dispatch with no
  // `deps.band` refusing rather than falling back — is in the package's
  // `agent-run-band-deps.test.ts`.
  // THE BAG IS ASSERTED BY VALUE, NOT BY SOURCE TEXT. A regex over
  // `session-kind-deps.ts` looked equivalent and was not: commenting the line
  // out as `// band: bandAgentDeps,` left the text intact, so the pattern still
  // matched and the control passed against code with the binding REMOVED — a
  // control whose victim does not exist. Importing the real object cannot be
  // fooled that way, and it is strictly stronger than what this test asserted
  // before the G1 P1 moved the bag out of the `agent` case.
  assert.equal(AGENT_DISPATCH_DEPS.band, bandAgentDeps,
    'AGENT_DISPATCH_DEPS must carry the production band binding — every standalone band dispatch refuses without it');
  assert.equal(AGENT_DISPATCH_DEPS.sessionKind.manifestPorts, architectManifestPorts,
    'AGENT_DISPATCH_DEPS must carry the architect manifest ports (M4 ruling 77/81)');

  // The one thing that IS structural: the bag reaching the single production
  // entry to `forge agent`. There is no value to inspect for that.
  const src = readFileSync(new URL('./cli.ts', import.meta.url), 'utf8');
  assert.match(src, /cmdAgent\(args\.slice\(1\), FORGE_ROOT, AGENT_DISPATCH_DEPS\)/,
    'cli.ts must pass AGENT_DISPATCH_DEPS to cmdAgent — the `agent` case is the only production entry to `forge agent`')
});
