/**
 * PARITY: the band pipelines the standalone surface actually runs.
 *
 * `packages/agents/band-agent-run.ts` runs the two band-guard node agents
 * through their FLOW pipelines rather than the bare `runAgent` spawn — that
 * parity IS the module's reason to exist (R4-10-F3, ADR-039). Proving it needs
 * `runDemoAgentPipeline` itself, which is `@forge/factory` (rank 7) and may
 * never be imported from `packages/agents` (rank 3). This is the layer that
 * legally holds both sides, so the parity case lives here — carried over
 * verbatim from `orchestrator/band-agent-run.test.ts` when that file was
 * carved (M4-agents, exit row 4).
 *
 * The package's own `band-agent-run.test.ts` proves the surrounding logic
 * against an injected runner; what it CANNOT prove is that the injected runner
 * is the real thing. So this file drives the production binding —
 * `bandAgentDeps` from `./band-agent-deps.ts`, the same object `cli.ts` passes
 * in — and asserts `cli.ts` passes it. Neither half is sufficient alone.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runBandAgentStandalone } from '@forge/agents/band-agent-run.ts';
import { serializeWorkItem, type WorkItem } from '@forge/flows/work-item.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';
import { bandAgentDeps } from './band-agent-deps.ts';

const INIT = 'INIT-2026-08-02-standalone-demo';
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
    "created_at: '2026-08-02T00:00:00.000Z'", 'iteration_budget: 2', 'cost_budget_usd: 1',
    'phase: ready-for-review', 'origin: architect', `worktree_path: ${worktreePath}`, `cycle_id: ${INIT}`,
    '---', `# ${INIT}`, '',
  ].join('\n'));
}

test('runBandAgentStandalone with the PRODUCTION deps: the standalone demo pipeline runs against a seeded worktree → complete, same demo.json artifact, runId-scoped log', async () => {
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

    // A queryFn standing in for the demo agent: authors demo.json + the PR body,
    // exactly as the flow band's spawn would.
    const CRIT = '(WI-1) GIVEN the CLI is built WHEN it runs bare THEN usage prints';
    const qf = ((params: { prompt: string }) => {
      async function* gen(): AsyncGenerator<unknown> {
        const diffStat = (/- diffStat: `([^`]*)`/.exec(params.prompt) ?? [])[1] ?? '';
        const demoDir = join(wt, 'demo', INIT);
        mkdirSync(demoDir, { recursive: true });
        writeFileSync(join(demoDir, 'demo.json'), JSON.stringify({
          title: 'demo', essence: 'the CLI now prints usage', project: 'fix', initiativeId: INIT, diffStat,
          checkpoints: [{ label: 'run', caption: 'bare', beforeNote: 'no usage', afterNote: 'usage' }],
          acceptanceCriteria: [CRIT],
          acEvaluations: [{ criterion: CRIT, verdict: 'met', evidence: 'checkpoint run shows usage' }],
        }));
        writeFileSync(join(wt, '.forge', 'pr-description.md'), '## Why\n\nintent\n\n## What\n\nchange\n\n## How\n\napproach\n');
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.1, usage: { input_tokens: 5, output_tokens: 7 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;

    const out = await runBandAgentStandalone(
      { slug: 'demo-agent', initiativeId: INIT, runId: RUN, forgeRoot: root, queryFn: qf },
      bandAgentDeps,
    );
    assert.equal(out.kind, 'demo');
    assert.equal(out.runId, RUN);
    assert.equal(out.result.status, 'complete', 'the standalone demo pipeline completed against the seeded worktree');
    assert.ok(existsSync(join(wt, 'demo', INIT, 'demo.json')), 'the SAME demo.json artifact a flow run produces');
    assert.ok(existsSync(join(wt, 'demo', INIT, 'DEMO.md')), 'the pipeline rendered DEMO.md in-process (parity)');

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
  const src = readFileSync(new URL('./cli.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ bandAgentDeps \} from '\.\/band-agent-deps\.ts';/,
    'cli.ts must import the production band binding');
  assert.match(src, /cmdAgent\(args\.slice\(1\), FORGE_ROOT, \{ band: bandAgentDeps \}\)/,
    'cli.ts must pass it to cmdAgent — the `agent` case is the only production entry to `forge agent dispatch`');
});
