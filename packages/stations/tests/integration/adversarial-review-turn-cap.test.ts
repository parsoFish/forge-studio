/**
 * forge-mfv5.1.61 — a review chunk that exhausts its turn cap degrades to a
 * PARTIAL chunk; the pipeline continues to the verdict gate.
 *
 * Recorded shape (gitweave I4 round 4): seventeen work-item chunks passed, the
 * eighteenth (WI-19, eleven files) ended `error_max_turns`, was split per file,
 * and the FIRST file — 85 lines — ended `error_max_turns` too. The pipeline
 * returned `failed/budget-exhausted` saying the file was "too large for
 * review": no findings artifact, no verdict gate, seventeen paid-for chunk
 * records discarded, ten files never looked at. And the reviewer's tool calls
 * were never logged (only heartbeats), so what it spent 71 tool uses on was
 * invisible.
 *
 * Wrong implementations each test kills:
 *  - stop at the exhausted file (today) → the artifact test reds: no findings.
 *  - skip the exhausted file silently → the partial marker + `unreviewed` finding asserts red.
 *  - grind the exhausted file but drop the rest of the split → the later files' findings assert red.
 *  - reuse a partial record on the next pass → the re-run test reds (it must re-buy the file).
 *  - keep the "too large" diagnosis → the message assert reds.
 *  - keep tool events heartbeat-only → the tool.* assert reds.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { serializeWorkItem, type WorkItem } from '@forge/flows';
import type { StreamQueryFn } from '@forge/agents';
import {
  CYCLE_ID, INIT_ID, collectLogger, makeFixture, run, validFindingsJson, withoutSpawnSuppressionEnv, type Fixture,
} from '../test-fixtures/adversarial-review-fixture.ts';

/** The I4 chunk WI-19's shape: several files, one work item. */
const SPLIT_FILES = ['apply.py', 'cli.py', 'membership.py'];
/** The single file whose own per-file review exhausts (I4: `gitweave/apply.py`, 85 lines). */
const EXHAUSTING_FILE = 'apply.py';
/** How many other work items pass first (I4: seventeen). */
const PASSING_WORK_ITEMS = 16;

function wi(id: string, files: string[]): WorkItem {
  return {
    work_item_id: id,
    initiative_id: INIT_ID,
    status: 'complete',
    depends_on: [],
    acceptance_criteria: [{ given: `${id} input`, when: 'run', then: `${id} holds` }],
    files_in_scope: files,
    estimated_iterations: 1,
    quality_gate_cmd: ['echo', 'gate-ok'],
    body: `Build ${id}.`,
  };
}

/** Sixteen more passing work items on top of the fixture's WI-1 (17 passes), then WI-19 over SPLIT_FILES. */
function addI4Shape(fx: Fixture): void {
  const ids: string[] = [];
  for (let i = 2; i <= PASSING_WORK_ITEMS + 1; i += 1) {
    const id = `WI-${i}`;
    ids.push(id);
    writeFileSync(join(fx.worktree, '.forge', 'work-items', `${id}.md`), serializeWorkItem(wi(id, [`m${i}.ts`])));
    writeFileSync(join(fx.worktree, `m${i}.ts`), `export const m${i} = ${i};\n`);
  }
  writeFileSync(join(fx.worktree, '.forge', 'work-items', 'WI-19.md'), serializeWorkItem(wi('WI-19', SPLIT_FILES)));
  for (const f of SPLIT_FILES) writeFileSync(join(fx.worktree, f), `def ${f.replace(/\W/g, '_')}():\n    return 1\n`);
  fx.git(['add', '--', '.forge/work-items', ...ids.map((_, k) => `m${k + 2}.ts`), ...SPLIT_FILES]);
  fx.git(['commit', '-q', '-m', 'feat: the rest of the I4 shape']);
}

/** The files a prompt's `## Changed files` section lists — what this spawn was shown. */
function changedFilesOf(prompt: string): string[] {
  const section = prompt.split('## Changed files')[1]?.split('\n## ')[0] ?? '';
  return [...section.matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]!);
}

/**
 * A scripted reviewer: it Reads, Greps, and either authors its file and ends
 * `success`, or ends `error_max_turns` having authored nothing — exactly the
 * stream shape the SDK hands a turn-capped one-shot spawn.
 */
function scriptedReviewer(fx: Fixture, exhausts: (files: string[]) => boolean, calls: string[][] = []): StreamQueryFn {
  return ((params: { prompt: string }) => {
    const files = changedFilesOf(params.prompt);
    calls.push(files);
    async function* gen(): AsyncGenerator<unknown> {
      const tools = [
        { type: 'tool_use', name: 'Read', input: { file_path: join(fx.worktree, '.forge/review-input/diff.patch') } },
        { type: 'tool_use', name: 'Grep', input: { pattern: 'def apply', path: fx.worktree } },
        { type: 'tool_use', name: 'Read', input: { file_path: join(fx.worktree, files[0] ?? 'x') } },
      ];
      for (const block of tools) yield { type: 'assistant', message: { content: [block] } };
      if (exhausts(files)) {
        yield { type: 'result', subtype: 'error_max_turns', total_cost_usd: 2.36, usage: { input_tokens: 9, output_tokens: 9 } };
        return;
      }
      writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(params.prompt, {
        findings: [{
          id: 'RF-1', severity: 'minor', category: 'correctness', title: `note on ${files[0] ?? 'nothing'}`,
          detail: 'a real observation', evidence: [{ file: files[0] ?? 'NOTES.md', line: 1 }],
        }],
      }));
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.2, usage: { input_tokens: 5, output_tokens: 7 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

/** WI-19's whole chunk exhausts, and so does its first file on its own; every other spawn passes. */
const i4Exhausts = (files: string[]): boolean =>
  (files.length > 1 && files.includes(EXHAUSTING_FILE)) || (files.length === 1 && files[0] === EXHAUSTING_FILE);

test('row 1: 17 passing chunks + a split whose first file hits error_max_turns → findings artifact written, partial named, the rest of the split reviewed', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    addI4Shape(fx);
    const { logger, events } = collectLogger(fx.logsRoot);
    const calls: string[][] = [];
    const res = await run(fx, scriptedReviewer(fx, i4Exhausts, calls), logger);

    assert.equal(res.status, 'complete', `a turn-capped chunk must not fail the review: ${JSON.stringify(res)}`);
    const artifact = join(fx.logsRoot, CYCLE_ID, 'artifacts', 'review-findings.json');
    assert.ok(existsSync(artifact), 'the findings artifact the verdict gate reads must be written');
    const record = JSON.parse(readFileSync(artifact, 'utf8'));

    // The partial chunk is NAMED, with what was spent — never an absence.
    assert.deepEqual(record.partialChunks.map((p: { chunk: string }) => p.chunk), [EXHAUSTING_FILE]);
    const partial = record.partialChunks[0];
    assert.equal(partial.workItemId, 'WI-19');
    assert.deepEqual(partial.files, [EXHAUSTING_FILE]);
    assert.equal(partial.resultSubtype, 'error_max_turns');
    assert.equal(partial.toolUses, 3, 'the turns it spent are stated');
    assert.ok(partial.lastTools.some((t: string) => t.startsWith('Grep')), `the last tools are stated: ${JSON.stringify(partial.lastTools)}`);

    // An explicit `unreviewed` finding the operator sees, at major, naming the file.
    const unreviewed = record.findings.filter((f: { title: string }) => /unreviewed/i.test(f.title));
    assert.equal(unreviewed.length, 1, `one unreviewed finding: ${JSON.stringify(record.findings.map((f: { title: string }) => f.title))}`);
    assert.equal(unreviewed[0].severity, 'major');
    assert.equal(unreviewed[0].evidence[0].file, EXHAUSTING_FILE);
    assert.doesNotMatch(JSON.stringify(record), /too large/i, 'the diagnosis names turns, not size');

    // The split kept going: the other WI-19 files were reviewed, and all 17 passing chunks survived.
    for (const f of SPLIT_FILES.filter((x) => x !== EXHAUSTING_FILE)) {
      assert.ok(record.findings.some((x: { title: string }) => x.title === `note on ${f}`), `${f} was reviewed after the capped file`);
      assert.ok(calls.some((c) => c.length === 1 && c[0] === f), `${f} got its own spawn`);
    }
    for (let i = 2; i <= PASSING_WORK_ITEMS + 1; i += 1) {
      assert.ok(record.findings.some((x: { title: string }) => x.title === `note on m${i}.ts`), `WI-${i}'s chunk survived`);
    }
    // Its criterion is judged `partial` by the orchestrator, never left unjudged and never `met`.
    const wi19 = record.acEvaluations.find((e: { criterion: string }) => e.criterion.startsWith('(WI-19)'));
    assert.ok(wi19, 'WI-19 criterion judged');

    const authored = events.find((e) => e.message === 'review.findings.authored');
    assert.deepEqual(authored?.metadata?.partial_chunks, [EXHAUSTING_FILE]);
    const capped = events.find((e) => e.message === 'review.chunk.partial');
    assert.ok(capped, 'the partial chunk is its own event');
    assert.equal(capped!.metadata?.tool_use_count, 3);
    assert.doesNotMatch(String(capped!.metadata?.detail), /too large|Split the work item/);
    assert.match(String(capped!.metadata?.detail), /3 tool call/);
  } finally {
    restore();
    fx.cleanup();
  }
});

test('row 1: a ONE-file work item that hits the cap degrades the same way (no split to fall back on)', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger } = collectLogger(fx.logsRoot);
    const res = await run(fx, scriptedReviewer(fx, (files) => files.length === 1 && files[0] === 'src.ts'), logger);
    assert.equal(res.status, 'complete', JSON.stringify(res));
    const record = JSON.parse(readFileSync(join(fx.logsRoot, CYCLE_ID, 'artifacts', 'review-findings.json'), 'utf8'));
    assert.deepEqual(record.partialChunks.map((p: { chunk: string }) => p.chunk), ['WI-1']);
    const ac = record.acEvaluations.find((e: { criterion: string }) => e.criterion.startsWith('(WI-1)'));
    assert.equal(ac.verdict, 'partial', 'a criterion nobody finished judging is partial, never met');
  } finally {
    restore();
    fx.cleanup();
  }
});

test('row 1: a capped agent that ALREADY wrote a valid findings file keeps what it produced, still marked partial', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger } = collectLogger(fx.logsRoot);
    const qf = ((params: { prompt: string }) => {
      async function* gen(): AsyncGenerator<unknown> {
        const files = changedFilesOf(params.prompt);
        writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(params.prompt, {
          findings: [{ id: 'RF-1', severity: 'major', category: 'correctness', title: `early finding on ${files[0]}`, detail: 'd', evidence: [{ file: files[0] ?? 'x', line: 1 }] }],
        }));
        yield { type: 'result', subtype: files[0] === 'src.ts' ? 'error_max_turns' : 'success', total_cost_usd: 0.3 };
      }
      return gen();
    }) as unknown as StreamQueryFn;
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'complete', JSON.stringify(res));
    const record = JSON.parse(readFileSync(join(fx.logsRoot, CYCLE_ID, 'artifacts', 'review-findings.json'), 'utf8'));
    assert.ok(record.findings.some((f: { title: string }) => f.title === 'early finding on src.ts'), 'the agent\'s own early record is kept');
    assert.equal(record.partialChunks[0].chunk, 'WI-1');
    assert.equal(record.partialChunks[0].source, 'agent');
  } finally {
    restore();
    fx.cleanup();
  }
});

test('row 1: a partial chunk is NEVER reused — the next pass at the same head re-buys only it', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture(['b.ts']);
  try {
    const { logger } = collectLogger(fx.logsRoot);
    // Pass 1: the whole WI-1 chunk exhausts → split → src.ts exhausts, b.ts passes.
    const first = await run(fx, scriptedReviewer(fx, (files) => files.includes('src.ts')), logger);
    assert.equal(first.status, 'complete');
    // Pass 2: nothing exhausts. The re-entered split re-buys src.ts only; b.ts and the unattributed chunk are reused.
    const calls: string[][] = [];
    const second = await run(fx, scriptedReviewer(fx, () => false, calls), logger);
    assert.equal(second.status, 'complete');
    assert.deepEqual(calls, [['src.ts']], `only the partial file is re-reviewed: ${JSON.stringify(calls)}`);
    const record = JSON.parse(readFileSync(join(fx.logsRoot, CYCLE_ID, 'artifacts', 'review-findings.json'), 'utf8'));
    assert.equal(record.partialChunks, undefined, 'a fully judged review carries no partial marker');
  } finally {
    restore();
    fx.cleanup();
  }
});

test('row 2: the reviewer\'s tool calls are logged as tool.* events, and the prompt states its bound', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const inner = scriptedReviewer(fx, () => false);
    const qf = ((params: { prompt: string }) => { prompts.push(params.prompt); return inner(params as never); }) as unknown as StreamQueryFn;
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'complete');

    const tools = events.filter((e) => e.event_type === 'tool_use' && String(e.message).startsWith('tool.'));
    assert.ok(tools.some((e) => e.message === 'tool.Read'), `tool.Read logged: ${JSON.stringify(events.map((e) => e.message))}`);
    for (const t of tools) assert.equal(t.skill, 'adversarial-review');

    const prompt = prompts[0]!;
    assert.match(prompt, /## Your bound/);
    assert.match(prompt, /only the files listed under Changed files/i);
    assert.match(prompt, /do not run|cannot run/i);
    assert.match(prompt, /\b50 turns\b/, 'the turn cap is stated from the declared budget');
    assert.match(prompt, /write .*review-findings\.json.* early/i);
  } finally {
    restore();
    fx.cleanup();
  }
});

test('row 1 CONTROL: a non-budget SDK error still fails the review by name (only a turn/budget cap degrades)', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  mkdirSync(join(fx.worktree, '.forge'), { recursive: true });
  try {
    const { logger } = collectLogger(fx.logsRoot);
    const qf = (() => (async function* () { yield { type: 'result', subtype: 'error_during_execution', total_cost_usd: 0.1 }; })()) as unknown as StreamQueryFn;
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'failed');
    assert.equal(res.status === 'failed' ? res.reason : '', 'spawn-failed');
  } finally {
    restore();
    fx.cleanup();
  }
});
