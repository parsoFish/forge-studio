#!/usr/bin/env node
/**
 * forge CLI. Subcommands:
 *   forge serve [--once]            run the scheduler
 *   forge cycle <initiative-id>     run one initiative end-to-end (foreground)
 *   forge enqueue <project> <spec>  drop a manifest into _queue/pending/
 *   forge enqueue --fixture         drop a smoke-test fixture
 *   forge status [--watch]          print queue + in-flight snapshot
 *   forge metrics [<cycle-id>]      print per-cycle aggregates (or all)
 *   forge bench <phase>             run a phase's benchmark suite
 *   forge brain query "..."         stub: invoke brain-query skill
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { runCycle } from './cycle.ts';
import { serve, status as schedulerStatus } from './scheduler.ts';
import { snapshot, render } from './visualise.ts';
import { summariseCycle, summariseAll } from './metrics.ts';
import { getPaths } from './queue.ts';

const args = process.argv.slice(2);
const cmd = args[0];

(async () => {
  switch (cmd) {
    case 'serve':
      return await cmdServe(args.slice(1));
    case 'cycle':
      return await cmdCycle(args.slice(1));
    case 'enqueue':
      return cmdEnqueue(args.slice(1));
    case 'status':
      return cmdStatus(args.slice(1));
    case 'metrics':
      return cmdMetrics(args.slice(1));
    case 'bench':
      return cmdBench(args.slice(1));
    case 'brain':
      return cmdBrain(args.slice(1));
    case '--help':
    case '-h':
    case undefined:
      return cmdHelp();
    default:
      console.error(`unknown command: ${cmd}`);
      cmdHelp();
      process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

function cmdHelp(): void {
  console.log(
    `forge — autonomous multi-agent orchestrator

Usage:
  forge serve [--once]              Start the unattended scheduler
  forge cycle <initiative-id>       Run one initiative end-to-end (foreground)
  forge enqueue <project> <spec>    Drop an initiative manifest into _queue/pending/
  forge enqueue --fixture           Drop a smoke-test fixture into _queue/pending/
  forge status [--watch]            Print queue + in-flight snapshot
  forge metrics [<cycle-id>]        Per-cycle aggregates (or all cycles)
  forge bench <phase>               Run a phase's benchmark suite (alias for npm run bench:<phase>)
  forge brain query "<question>"    Query the brain (skeleton)

For phase-implementation guidance see docs/phases/. For decisions see docs/decisions/.`,
  );
}

async function cmdServe(rest: string[]): Promise<void> {
  const once = rest.includes('--once');
  console.log(once ? 'forge serve --once: claiming one initiative…' : 'forge serve: starting…');
  await serve({ mode: once ? 'once' : 'forever' });
}

async function cmdCycle(rest: string[]): Promise<void> {
  const initiativeId = rest[0];
  const dryRun = rest.includes('--dry-run');
  if (!initiativeId) {
    console.error('forge cycle: missing <initiative-id>');
    process.exit(2);
  }
  // For dry runs, we can synthesise paths; for real runs the manifest must
  // exist in _queue/in-flight/.
  const paths = getPaths();
  const manifestPath = join(paths.inFlight, `${initiativeId}.md`);
  const projectRepoPath = resolve('projects', initiativeId);
  const worktreePath = resolve('_worktrees', initiativeId);
  const result = await runCycle({
    initiativeId,
    manifestPath,
    projectRepoPath,
    worktreePath,
    dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
}

function cmdEnqueue(rest: string[]): void {
  const paths = getPaths();
  if (!existsSync(paths.pending)) mkdirSync(paths.pending, { recursive: true });

  if (rest[0] === '--fixture') {
    // Bootstrap a tiny throwaway git repo at projects/fixture/ so the scheduler
    // can `git worktree add` against it and complete the (no-op) cycle, ending
    // up in _queue/ready-for-review/ instead of failing on missing-repo.
    const fixtureRepo = resolve('projects', 'fixture');
    if (!existsSync(fixtureRepo)) {
      mkdirSync(fixtureRepo, { recursive: true });
      execSync(
        `git -C "${fixtureRepo}" init -q -b main && \
         git -C "${fixtureRepo}" -c user.email=fixture@forge -c user.name=fixture commit -q --allow-empty -m "fixture: initial"`,
        { stdio: 'pipe' },
      );
    }
    const id = `INIT-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-fixture`;
    const manifest = `---
initiative_id: ${id}
project: fixture
project_repo_path: ${fixtureRepo}
created_at: ${new Date().toISOString()}
iteration_budget: 5
cost_budget_usd: 1.00
phase: pending
features:
  - feature_id: FEAT-1
    title: smoke-test feature
    depends_on: []
---

# Fixture initiative

Smoke test for the scheduler. No real work performed.
`;
    const out = join(paths.pending, `${id}.md`);
    writeFileSync(out, manifest);
    console.log(`enqueued: ${out}`);
    return;
  }

  const project = rest[0];
  const specPath = rest[1];
  if (!project || !specPath) {
    console.error('forge enqueue: usage: enqueue <project> <spec-path> | enqueue --fixture');
    process.exit(2);
  }
  const id = `INIT-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${project}`;
  const body = readFileSync(specPath, 'utf8');
  const manifest = `---
initiative_id: ${id}
project: ${project}
created_at: ${new Date().toISOString()}
iteration_budget: 50
cost_budget_usd: 25.00
phase: pending
---

${body}`;
  const out = join(paths.pending, `${id}.md`);
  writeFileSync(out, manifest);
  console.log(`enqueued: ${out}`);
}

function cmdStatus(rest: string[]): void {
  const watch = rest.includes('--watch');
  const print = (): void => {
    const snap = snapshot();
    if (watch) console.clear();
    console.log(render(snap));
    if (!watch) {
      const c = schedulerStatus().counts;
      console.log(`\n(totals: ${JSON.stringify(c)})`);
    }
  };
  print();
  if (watch) setInterval(print, 2000);
}

function cmdMetrics(rest: string[]): void {
  if (rest[0]) {
    console.log(JSON.stringify(summariseCycle(rest[0]), null, 2));
  } else {
    console.log(JSON.stringify(summariseAll(), null, 2));
  }
}

function cmdBench(rest: string[]): void {
  const phase = rest[0];
  if (!phase) {
    console.error('forge bench: usage: bench <phase>');
    process.exit(2);
  }
  console.log(`Run via: npm run bench:${phase}`);
}

function cmdBrain(rest: string[]): void {
  const sub = rest[0];
  if (sub !== 'query') {
    console.error('forge brain: only `query` is implemented (skeleton)');
    process.exit(2);
  }
  const question = rest.slice(1).join(' ');
  console.log(`(skeleton) brain-query: "${question}"`);
  console.log('Wire the brain-query skill via @anthropic-ai/claude-agent-sdk to make this real.');
}
