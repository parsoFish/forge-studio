/**
 * Tests for orchestrator/band-agent-run.ts (R4-10-F3) — the standalone isolation
 * surface for the band-hook node agents. Proves resolution boundary errors + a
 * real standalone demo pipeline run against a seeded initiative worktree (parity
 * with the flow band: same runDemoAgentPipeline, same demo.json artifact).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runBandAgentStandalone, isStandaloneBandAgent } from './band-agent-run.ts';
import { serializeWorkItem, type WorkItem } from './work-item.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';

const INIT = 'INIT-2026-08-02-standalone-demo';

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

test('isStandaloneBandAgent: only the two band-hook node agents', () => {
  assert.equal(isStandaloneBandAgent('demo-agent'), true);
  assert.equal(isStandaloneBandAgent('adversarial-review'), true);
  assert.equal(isStandaloneBandAgent('developer-ralph'), false);
  assert.equal(isStandaloneBandAgent('project-manager'), false);
});

test('runBandAgentStandalone: a non-band agent is refused', async () => {
  await assert.rejects(
    runBandAgentStandalone({ slug: 'project-manager', initiativeId: INIT, queueRoot: '/tmp/none' }),
    /not a standalone-runnable band agent/,
  );
});

test('runBandAgentStandalone: no manifest for the initiative → clear boundary error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'band-run-nomanifest-'));
  try {
    mkdirSync(join(root, '_queue', 'ready-for-review'), { recursive: true });
    await assert.rejects(
      runBandAgentStandalone({ slug: 'demo-agent', initiativeId: INIT, queueRoot: join(root, '_queue') }),
      /no manifest for initiative/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runBandAgentStandalone: standalone demo pipeline runs against a seeded worktree → complete, same demo.json artifact', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const root = mkdtempSync(join(tmpdir(), 'band-run-'));
  try {
    // A real post-develop worktree (bare origin + clone + feature branch), the
    // same shape the flow's demo band derives from.
    const bare = join(root, 'origin.git');
    execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' });
    const wt = join(root, 'wt');
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

    // The initiative's manifest in the queue (worktree_path points at wt).
    const rfr = join(root, '_queue', 'ready-for-review');
    mkdirSync(rfr, { recursive: true });
    writeFileSync(join(rfr, `${INIT}.md`), [
      '---', `initiative_id: ${INIT}`, 'project: fix', `project_repo_path: ${wt}`,
      "created_at: '2026-08-02T00:00:00.000Z'", 'iteration_budget: 2', 'cost_budget_usd: 1',
      'phase: ready-for-review', 'origin: architect', `worktree_path: ${wt}`, `cycle_id: ${INIT}`,
      '---', `# ${INIT}`, '',
    ].join('\n'));

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

    const out = await runBandAgentStandalone({
      slug: 'demo-agent', initiativeId: INIT,
      logsRoot: join(root, '_logs'), queueRoot: join(root, '_queue'), queryFn: qf,
    });
    assert.equal(out.kind, 'demo');
    assert.equal(out.result.status, 'complete', 'the standalone demo pipeline completed against the seeded worktree');
    assert.ok(existsSync(join(wt, 'demo', INIT, 'demo.json')), 'the SAME demo.json artifact a flow run produces');
    assert.ok(existsSync(join(wt, 'demo', INIT, 'DEMO.md')), 'the pipeline rendered DEMO.md in-process (parity)');
  } finally {
    rmSync(root, { recursive: true, force: true });
    restore();
  }
});
