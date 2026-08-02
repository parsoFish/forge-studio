/**
 * Tests for the R4-07 demo-agent pipeline — spawn (stubbed queryFn), validate
 * (+ bounded retry), render, orchestrated capture (fake capture script), nonce
 * verification, and the F2 AC-miss judgment band. Git fixtures are real repos
 * (bare origin + clone) so diffStat derivation and the capture commit/push are
 * exercised for real.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runDemoAgentPipeline, assertDemoAgentDeclaration, type DemoAgentPipelineResult } from './demo-agent.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';
import { serializeWorkItem, type WorkItem } from '../work-item.ts';
import { validateDemoFixSpec, demoFixSpecJsonPath } from '../flow-artifacts.ts';
import type { StreamQueryFn } from '../pinned-sdk-query.ts';

const INIT_ID = 'INIT-2026-07-24-demo';

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

function wiFixture(): WorkItem {
  return {
    work_item_id: 'WI-1',
    initiative_id: INIT_ID,
    status: 'complete',
    depends_on: [],
    acceptance_criteria: [{ given: 'the CLI is built', when: 'it runs bare', then: 'usage prints' }],
    files_in_scope: ['src/cli.ts'],
    estimated_iterations: 1,
    quality_gate_cmd: ['echo', 'gate-ok'],
    body: 'Build the CLI.',
  };
}

type Fixture = {
  root: string;
  worktree: string;
  logsRoot: string;
  git: (args: string[]) => string;
  cleanup: () => void;
};

/** Bare origin + clone with main (project files + WI) and a feature branch commit. */
function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'demo-agent-pipe-'));
  const bare = join(root, 'origin.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' });
  const worktree = join(root, 'wt');
  execFileSync('git', ['clone', bare, worktree], { stdio: 'pipe' });
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: worktree, stdio: 'pipe', encoding: 'utf8' });
  git(['config', 'user.email', 'test@forge']);
  git(['config', 'user.name', 'forge-test']);
  git(['checkout', '-b', 'main']);

  writeFileSync(join(worktree, 'package.json'), JSON.stringify({ name: 'fix', scripts: { ok: 'echo ok' } }));
  mkdirSync(join(worktree, '.forge', 'work-items'), { recursive: true });
  writeFileSync(
    join(worktree, '.forge', 'project.json'),
    JSON.stringify({
      testProcess: { local: { cmd: ['echo', 'gate-ok'] } },
      demoProcess: [
        { kind: 'capture', text: 'record the CLI before/after' },
        { kind: 'verify', text: 'assert the gate passes' },
      ],
    }),
  );
  writeFileSync(join(worktree, '.forge', 'work-items', 'WI-1.md'), serializeWorkItem(wiFixture()));
  writeFileSync(join(worktree, 'src.ts'), 'export const v = 1;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'main baseline']);
  git(['push', '-q', 'origin', 'main']);

  git(['checkout', '-q', '-b', `feat/${INIT_ID}`]);
  writeFileSync(join(worktree, 'src.ts'), 'export const v = 2;\n');
  git(['add', 'src.ts']);
  git(['commit', '-q', '-m', 'feat: the change']);
  git(['push', '-q', '-u', 'origin', `feat/${INIT_ID}`]);

  return { root, worktree, logsRoot: join(root, '_logs'), git, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function demoDirAbs(worktree: string): string {
  return join(worktree, 'demo', INIT_ID);
}

/** Extract the injected diffStat from the rendered user prompt (the stub's source of truth). */
function diffStatFromPrompt(prompt: string): string {
  const m = /- diffStat: `([^`]*)`/.exec(prompt);
  assert.ok(m, 'prompt must carry the injected diffStat');
  return m![1]!;
}

/** The exact criterion string the pipeline injects (WI-prefixed GWT — AC coverage matches verbatim). */
const INJECTED_CRITERION = '(WI-1) GIVEN the CLI is built WHEN it runs bare THEN usage prints';

function validDemoJson(diffStat: string, opts: { command?: string; verdict?: 'met' | 'partial' | 'missed' } = {}): Record<string, unknown> {
  return {
    title: 'CLI usage demo',
    essence: 'the CLI now prints usage',
    project: 'fix',
    initiativeId: INIT_ID,
    diffStat,
    checkpoints: [
      {
        label: 'cli-run',
        caption: 'bare CLI invocation',
        ...(opts.command ? { command: opts.command } : { beforeNote: 'no usage', afterNote: 'usage printed' }),
      },
    ],
    acceptanceCriteria: [INJECTED_CRITERION],
    acEvaluations: [
      {
        criterion: INJECTED_CRITERION,
        verdict: opts.verdict ?? 'met',
        evidence: 'checkpoint cli-run shows the usage text',
      },
    ],
  };
}

function validProposals(): unknown[] {
  return [
    {
      id: 'FIX-1',
      criterion: INJECTED_CRITERION,
      verdict: 'missed',
      evidence: 'the after run prints nothing',
      title: 'Print usage on bare invocation',
      acceptance_criteria: [{ given: 'a built CLI', when: 'run bare', then: 'usage on stdout' }],
      files_in_scope: ['src/cli.ts'],
      rationale: 'behaviour absent, not an evidence-capture failure',
    },
  ];
}

/** Write a valid relocated PR body (R4-10-F1) — the demo agent authors this
 *  alongside demo.json; the pipeline hard-requires it (Why/What/How). */
function writeValidPrDescription(worktree: string): void {
  writeFileSync(
    join(worktree, '.forge', 'pr-description.md'),
    '## Why\n\nThe initiative intent.\n\n## What\n\nThe behavioural change delivered.\n\n## How\n\nHow the diff achieves it.\n',
  );
}

/** A queryFn stub whose Nth call runs the matching writer side-effect, then yields a result message. */
function stubQueryFn(
  _worktree: string,
  writers: Array<(prompt: string) => void>,
  calls: string[] = [],
): StreamQueryFn {
  let n = 0;
  return ((params: { prompt: string }) => {
    const i = n;
    n += 1;
    calls.push(params.prompt);
    const writer = writers[Math.min(i, writers.length - 1)]!;
    async function* gen(): AsyncGenerator<unknown> {
      // R4-10-F1: every real demo spawn authors the relocated PR body — write a
      // valid default so the pipeline's pr-description gate passes; a writer can
      // still author project-code dirt (scope-guard test) or a bad demo.json.
      writeValidPrDescription(_worktree);
      writer(params.prompt);
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.1, usage: { input_tokens: 5, output_tokens: 7 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

function collectLogger(logsRoot: string): { logger: ReturnType<typeof createLogger>; events: EventLogEntry[] } {
  const events: EventLogEntry[] = [];
  const logger = createLogger(INIT_ID, logsRoot, { tee: (e) => events.push(e) });
  return { logger, events };
}

async function run(
  fx: Fixture,
  queryFn: StreamQueryFn | undefined,
  _events: EventLogEntry[],
  logger: ReturnType<typeof createLogger>,
  capture?: { argv: string[]; timeoutMs?: number },
): Promise<DemoAgentPipelineResult> {
  return runDemoAgentPipeline(
    { initiativeId: INIT_ID, worktreePath: fx.worktree, cycleId: INIT_ID, logsRoot: fx.logsRoot, orchestratedCapture: capture },
    logger,
    { queryFn },
  );
}

test('happy path all-met, no capture wanted: complete + DEMO.md rendered + demo.complete', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(validDemoJson(diffStatFromPrompt(prompt)), null, 2));
      },
    ], prompts);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'complete');
    assert.ok(existsSync(join(demoDirAbs(fx.worktree), 'DEMO.md')), 'pipeline renders DEMO.md in-process');
    assert.ok(events.some((e) => e.message === 'demo.input.derived'));
    assert.ok(events.some((e) => e.message === 'demo.complete'));
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0]!.includes('demo/INIT-2026-07-24-demo/demo.json'), 'prompt names the demo dir');
    assert.ok(!existsSync(demoFixSpecJsonPath(fx.logsRoot, INIT_ID)), 'no fix spec on an all-met demo');
    // No-capture demos still land ON the branch — the pipeline owns the commit.
    const committedEv = events.find((e) => e.message === 'demo.artifacts.committed');
    assert.ok(committedEv, 'no-capture path emits demo.artifacts.committed');
    assert.equal((committedEv!.metadata as Record<string, unknown>).committed, true);
    assert.ok(fx.git(['log', '--oneline']).includes('chore(demo): demo artifacts'), 'demo.json + DEMO.md committed');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('author-invalid demo.json: one retry with errors in the prompt, then success', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        const bad = validDemoJson(diffStatFromPrompt(prompt)) as Record<string, unknown>;
        delete bad.essence;
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(bad));
      },
      (prompt) => {
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(validDemoJson(diffStatFromPrompt(prompt))));
      },
    ], prompts);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'complete');
    assert.equal(prompts.length, 2, 'exactly one retry');
    assert.ok(/essence/.test(prompts[1]!), 'retry prompt names the validation failure');
    assert.equal(events.filter((e) => e.message === 'demo.author.invalid').length, 1);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('author-invalid twice: failed/author-invalid with the errors in detail', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const qf = stubQueryFn(fx.worktree, [
      () => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), '{"title":"only"}');
      },
    ]);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'author-invalid');
    assert.ok((res as { detail: string }).detail.length > 0);
    assert.equal(events.filter((e) => e.message === 'demo.author.invalid').length, 2);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('stale diffStat is authoring-invalid: the retry prompt names the mismatch', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn(fx.worktree, [
      () => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(
          join(demoDirAbs(fx.worktree), 'demo.json'),
          JSON.stringify(validDemoJson('99 files changed, 1 insertion(+)')),
        );
      },
      (prompt) => {
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(validDemoJson(diffStatFromPrompt(prompt))));
      },
    ], prompts);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'complete');
    assert.ok(/diffStat/.test(prompts[1]!), 'retry prompt names the diffStat mismatch');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('unproducible capture command: hard tooling-unavailable failure, no retry', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(
          join(demoDirAbs(fx.worktree), 'demo.json'),
          JSON.stringify(validDemoJson(diffStatFromPrompt(prompt), { command: 'npm run not-a-script' })),
        );
      },
    ], prompts);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'tooling-unavailable');
    assert.equal(prompts.length, 1, 'tooling-unavailable never retries the agent');
    const ev = events.find((e) => e.message === 'demo.capture.tooling-unavailable');
    assert.ok(ev, 'distinct environment-failure event class');
    assert.ok(String((ev!.metadata as Record<string, unknown>).problems).includes('not-a-script'));
  } finally {
    fx.cleanup();
    restore();
  }
});

/** Fake capture engine: stamps capture.nonce from the env into demo.json (what `forge demo capture` does). */
function fakeCaptureScript(root: string, nonceExpr: string): string[] {
  const script = join(root, 'fake-capture.mjs');
  writeFileSync(
    script,
    [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      `const p = 'demo/${INIT_ID}/demo.json';`,
      "const m = JSON.parse(readFileSync(p, 'utf8'));",
      `m.capture = { nonce: ${nonceExpr}, capturedAt: '2026-07-24T00:00:00.000Z' };`,
      "m.checkpoints[0].beforeOutput = 'before-out';",
      "m.checkpoints[0].afterOutput = 'after-out';",
      "writeFileSync(p, JSON.stringify(m, null, 2) + '\\n');",
    ].join('\n'),
  );
  return [process.execPath, script];
}

test('orchestrated capture: nonce round-trips, artifacts committed + pushed, complete', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(
          join(demoDirAbs(fx.worktree), 'demo.json'),
          JSON.stringify(validDemoJson(diffStatFromPrompt(prompt), { command: 'echo hi' })),
        );
      },
    ]);
    const argv = fakeCaptureScript(fx.root, 'process.env.FORGE_CAPTURE_NONCE');
    const res = await run(fx, qf, events, logger, { argv });
    assert.equal(res.status, 'complete');
    const cap = events.find((e) => e.message === 'demo.capture');
    assert.ok(cap, 'capture outcome event emitted');
    const meta = cap!.metadata as Record<string, unknown>;
    assert.equal(meta.capture_ok, true);
    assert.equal(meta.committed, true, 'capture artifacts committed + pushed (bare origin fixture)');
    const model = JSON.parse(readFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), 'utf8'));
    assert.equal(model.capture.nonce, meta.capture_nonce, 'stamped nonce matches the generated one');
    assert.ok(fx.git(['log', '--oneline']).includes('orchestrated demo capture'));
  } finally {
    fx.cleanup();
    restore();
  }
});

test('nonce mismatch: hard failure — evidence not produced by this run', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(
          join(demoDirAbs(fx.worktree), 'demo.json'),
          JSON.stringify(validDemoJson(diffStatFromPrompt(prompt), { command: 'echo hi' })),
        );
      },
    ]);
    const argv = fakeCaptureScript(fx.root, "'stale-or-replayed-nonce'");
    const res = await run(fx, qf, events, logger, { argv });
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'nonce-mismatch');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('F2 seeded AC-miss: fix spec persisted + validates, events emitted, worktree copy deleted, no dispatch', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(
          join(demoDirAbs(fx.worktree), 'demo.json'),
          JSON.stringify(validDemoJson(diffStatFromPrompt(prompt), { verdict: 'missed' })),
        );
        writeFileSync(join(demoDirAbs(fx.worktree), 'fix-proposals.json'), JSON.stringify(validProposals()));
      },
    ]);
    const wiCountBefore = fx.git(['ls-files', '.forge/work-items']).trim().split('\n').length;
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'complete-with-misses');
    const specPath = demoFixSpecJsonPath(fx.logsRoot, INIT_ID);
    assert.ok(existsSync(specPath), 'demo-fix-spec.json persisted under _logs');
    const record = JSON.parse(readFileSync(specPath, 'utf8'));
    assert.deepEqual(validateDemoFixSpec(record), []);
    assert.equal(record.proposals[0].criterion, validProposals()[0]!['criterion' as never]);
    assert.equal(events.filter((e) => e.message === 'demo.ac-miss').length, 1);
    assert.ok(events.some((e) => e.message === 'demo.fix-spec.authored'));
    assert.ok(!existsSync(join(demoDirAbs(fx.worktree), 'fix-proposals.json')), 'worktree copy deleted (never an untracked merge-blocker)');
    const wiCountAfter = fx.git(['ls-files', '.forge/work-items']).trim().split('\n').length;
    assert.equal(wiCountAfter, wiCountBefore, 'judgment only — nothing appended to any WI queue');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('AC-miss without proposals: one retry, then failed/author-invalid', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(
          join(demoDirAbs(fx.worktree), 'demo.json'),
          JSON.stringify(validDemoJson(diffStatFromPrompt(prompt), { verdict: 'missed' })),
        );
        // No fix-proposals.json — the output contract is violated.
      },
    ], prompts);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'author-invalid');
    assert.equal(prompts.length, 2);
    assert.ok(/fix-proposals\.json/.test(prompts[1]!), 'retry prompt names the missing proposals file');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('scope guard: agent edits outside the demo dir → hard scope-violation, no retry', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(validDemoJson(diffStatFromPrompt(prompt))));
        // The ADR-036 arms-race move: edit project code to make an AC demonstrable.
        writeFileSync(join(fx.worktree, 'src.ts'), 'export const v = 3; // agent-authored edit\n');
      },
    ], prompts);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'scope-violation');
    assert.ok((res as { detail: string }).detail.includes('src.ts'));
    assert.equal(prompts.length, 1, 'an agent that edits code is not negotiated with');
    const ev = events.find((e) => e.message === 'demo.scope-violation');
    assert.ok(ev);
    assert.deepEqual((ev!.metadata as Record<string, unknown>).paths, ['src.ts']);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('budget-exhausted spawn (error_max_turns): hard failure, never retried as an authoring bug', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    let calls = 0;
    const qf = ((_params: { prompt: string }) => {
      calls += 1;
      async function* gen(): AsyncGenerator<unknown> {
        yield { type: 'result', subtype: 'error_max_turns', total_cost_usd: 2.0, usage: { input_tokens: 5, output_tokens: 7 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'budget-exhausted');
    assert.ok((res as { detail: string }).detail.includes('error_max_turns'));
    assert.equal(calls, 1);
    assert.ok(events.some((e) => e.message === 'demo.budget-exhausted'));
  } finally {
    fx.cleanup();
    restore();
  }
});

test('AC coverage: missing acEvaluations entry for an injected criterion → retry names it verbatim', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        const noEvals = validDemoJson(diffStatFromPrompt(prompt)) as Record<string, unknown>;
        delete noEvals.acEvaluations; // schema-valid, judgment-vacuous
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(noEvals));
      },
      (prompt) => {
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(validDemoJson(diffStatFromPrompt(prompt))));
      },
    ], prompts);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'complete');
    assert.equal(prompts.length, 2);
    assert.ok(prompts[1]!.includes(INJECTED_CRITERION), 'retry prompt names the uncovered criterion verbatim');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('all-met demo alongside a stray proposals file: discarded loudly, never left untracked', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(validDemoJson(diffStatFromPrompt(prompt))));
        writeFileSync(join(demoDirAbs(fx.worktree), 'fix-proposals.json'), JSON.stringify(validProposals()));
      },
    ]);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'complete');
    assert.ok(!existsSync(join(demoDirAbs(fx.worktree), 'fix-proposals.json')), 'stray proposals discarded on the complete path');
    assert.ok(events.some((e) => e.message === 'demo.stale-proposals-discarded'));
  } finally {
    fx.cleanup();
    restore();
  }
});

test('capture that invalidates demo.json: hard capture-failed, never a silent stale-model fallback', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(
          join(demoDirAbs(fx.worktree), 'demo.json'),
          JSON.stringify(validDemoJson(diffStatFromPrompt(prompt), { command: 'echo hi' })),
        );
      },
    ]);
    // Fake capture engine that stamps a VALID nonce but corrupts the schema —
    // exercises the post-capture validation distinctly from the nonce check
    // (nonce verification deliberately fires first).
    const script = join(fx.root, 'corrupting-capture.mjs');
    writeFileSync(
      script,
      `import { writeFileSync } from 'node:fs'; writeFileSync('demo/${INIT_ID}/demo.json', JSON.stringify({ title: 'only', capture: { nonce: process.env.FORGE_CAPTURE_NONCE } }));`,
    );
    const res = await run(fx, qf, events, logger, { argv: [process.execPath, script] });
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'capture-failed');
    assert.ok((res as { detail: string }).detail.includes('post-capture'));
  } finally {
    fx.cleanup();
    restore();
  }
});

test('assertDemoAgentDeclaration: each missing declared guard throws with the vector named', () => {
  const base = { budgets: { maxTurns: 10, maxBudgetUsd: 1 }, composition: { skills: ['demo'] } };
  assert.doesNotThrow(() => assertDemoAgentDeclaration(base));
  assert.throws(() => assertDemoAgentDeclaration({ ...base, budgets: { maxBudgetUsd: 1 } }), /maxTurns/);
  assert.throws(() => assertDemoAgentDeclaration({ ...base, budgets: { maxTurns: 10 } }), /silent-spend/);
  assert.throws(() => assertDemoAgentDeclaration({ ...base, composition: { skills: [] } }), /composition\.skills/);
  assert.throws(() => assertDemoAgentDeclaration({ ...base, allowedTools: ['Read', 'Bash'] }), /scope guard/);
});

test('spawn suppression (no queryFn under FORGE_ARCHITECT_NO_SPAWN): failed/spawn-suppressed, never fake', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
    const { logger, events } = collectLogger(fx.logsRoot);
    const res = await run(fx, undefined, events, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'spawn-suppressed');
    assert.ok(events.some((e) => e.message === 'demo.spawn-suppressed'));
  } finally {
    fx.cleanup();
    restore();
  }
});

// ---------------------------------------------------------------------------
// R4-10-F1: the relocated PR body (.forge/pr-description.md)
// ---------------------------------------------------------------------------

test('pr-description relocation: a missing PR body is author-invalid, retried, then complete', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const prPath = join(fx.worktree, '.forge', 'pr-description.md');
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        // Attempt 1: author a valid demo.json but FORGET the PR body (the stub
        // wrote a default — delete it to simulate the omission).
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(validDemoJson(diffStatFromPrompt(prompt))));
        rmSync(prPath, { force: true });
      },
      (prompt) => {
        // Attempt 2: author both (the stub's default PR body stands).
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(validDemoJson(diffStatFromPrompt(prompt))));
      },
    ], prompts);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'complete');
    assert.equal(prompts.length, 2, 'exactly one retry for the missing PR body');
    assert.ok(/pr-description/.test(prompts[1]!), 'retry prompt names the missing PR body');
    assert.ok(existsSync(prPath), 'the PR body is present on success');
    assert.ok(readFileSync(prPath, 'utf8').includes('## Why'), 'the PR body carries the Why/What/How sections');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('pr-description relocation: a section-less PR body is author-invalid (names the missing section)', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const prPath = join(fx.worktree, '.forge', 'pr-description.md');
    const qf = stubQueryFn(fx.worktree, [
      (prompt) => {
        // Author a valid demo.json but a PR body missing the "## How" section
        // (both attempts) — the pipeline must reject it, never silently pass.
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(validDemoJson(diffStatFromPrompt(prompt))));
        writeFileSync(prPath, '## Why\n\nintent\n\n## What\n\nchange\n');
      },
    ], prompts);
    const res = await run(fx, qf, events, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'author-invalid');
    assert.ok((res as { detail: string }).detail.includes('## How'), 'the failure names the missing section');
    assert.equal(events.filter((e) => e.message === 'demo.author.invalid').length, 2);
  } finally {
    fx.cleanup();
    restore();
  }
});
