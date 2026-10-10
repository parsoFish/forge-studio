/**
 * Bead forge-mfv5.1.30 — the round-2 review must tell the truth about the head
 * it names.
 *
 * gitweave I1, round 2 (head 1d228b1): WI-7, a D-20 review-fix work item, landed
 * as one mostly-DELETION commit (967c967, merged by 0a7c5fd `wi(WI-7): merge`)
 * and the whole suite went green — yet the verdict page said all five WI-7
 * criteria were MISSED because "no file declared by WI-7 appears in this diff",
 * and `review-findings.json` repeated round-1 majors (WI-1/RF-1: demo-guide line
 * 80 installs metrics/requirements.txt) that were false at 1d228b1.
 *
 * Each test drives the real pipeline over a real temp git repo shaped like that
 * branch, with the fixture's work item and finding copied verbatim from the run
 * (`../test-fixtures/gitweave-i1-round2/`, provenance inside each file; the work item is
 * `.fixture`, not `.md`, because its criteria cite gitweave's paths verbatim).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { reviewFindingsJsonPath, serializeWorkItem, type ReviewFindingsRecord, type WorkItem } from '@forge/flows';
import type { StreamQueryFn } from '@forge/agents';

import { runAdversarialReview } from '../../phases/adversarial-review.ts';
import { testClassProfilePort } from '../test-fixtures/class-profile-port-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';
import { collectLogger, validFindingsJson, withoutSpawnSuppressionEnv } from '../test-fixtures/adversarial-review-fixture.ts';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'gitweave-i1-round2');
const INIT = 'INIT-2026-10-10-i1-honest-baseline';
const CYCLE = 'CY-rev-1'; // collectLogger's cycle id
const ROUND1_FINDING = JSON.parse(readFileSync(join(FIXTURE, 'round1-wi1-finding.json'), 'utf8')).finding;

type Repo = { wt: string; logsRoot: string; git: (a: string[]) => string; write: (f: string, c: string) => void; cleanup: () => void };

function makeRepo(files: Record<string, string>): Repo {
  const root = mkdtempSync(join(tmpdir(), 'review-truth-'));
  const wt = join(root, 'wt');
  mkdirSync(wt);
  const git = (a: string[]): string => execFileSync('git', a, { cwd: wt, stdio: 'pipe', encoding: 'utf8' });
  const write = (f: string, c: string): void => {
    mkdirSync(dirname(join(wt, f)), { recursive: true });
    writeFileSync(join(wt, f), c);
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@forge']);
  git(['config', 'user.name', 'forge-test']);
  for (const [f, c] of Object.entries(files)) write(f, c);
  git(['add', '--', ...Object.keys(files)]);
  git(['commit', '-q', '-m', 'main baseline']);
  git(['checkout', '-q', '-b', `forge/${INIT}`]);
  mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
  writeFileSync(join(wt, '.git', 'info', 'exclude'), '.forge/\n');
  return { wt, logsRoot: join(root, '_logs'), git, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** A work item delivered the way the dev loop delivers one: its own branch, merged `--no-ff` as `wi(<id>): merge`. */
function deliver(r: Repo, id: string, change: () => void): void {
  r.git(['checkout', '-q', '-b', `wi/${id}`]);
  change();
  r.git(['add', '-A', '--', '.']);
  r.git(['commit', '-q', '-m', `fix: ${id} work`]);
  r.git(['checkout', '-q', `forge/${INIT}`]);
  r.git(['merge', '-q', '--no-ff', `wi/${id}`, '-m', `wi(${id}): merge`]);
}

function orchestratorCommit(r: Repo, n: number): void {
  r.write(`demo/${INIT}/DEMO.md`, `demo capture ${n}\n`);
  r.git(['add', '--', `demo/${INIT}/DEMO.md`]);
  r.git(['commit', '-q', '-m', `chore(demo): orchestrated demo capture (${INIT})`]);
}

const wi = (id: string, files: string[], acs: WorkItem['acceptance_criteria']): WorkItem => ({
  work_item_id: id, initiative_id: INIT, status: 'complete', depends_on: [], acceptance_criteria: acs,
  files_in_scope: files, estimated_iterations: 1, quality_gate_cmd: ['echo', 'ok'], body: `${id} body`,
});

/** A review agent that authors `findingsFor(prompt)` and records every prompt it was shown. */
function agent(r: Repo, prompts: string[], findingsFor: (p: string) => unknown[]): StreamQueryFn {
  return ((params: { prompt: string }) => {
    prompts.push(params.prompt);
    async function* gen(): AsyncGenerator<unknown> {
      writeFileSync(join(r.wt, '.forge', 'review-findings.json'), validFindingsJson(params.prompt, { findings: findingsFor(params.prompt) }));
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 1 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

async function review(r: Repo, qf: StreamQueryFn): Promise<{ record: ReviewFindingsRecord; events: ReturnType<typeof collectLogger>['events'] }> {
  const { logger, events } = collectLogger(r.logsRoot);
  const res = await runAdversarialReview(
    { initiativeId: INIT, worktreePath: r.wt, cycleId: CYCLE, logsRoot: r.logsRoot, changeClass: 'code' },
    logger,
    { queryFn: qf, classProfiles: testClassProfilePort(), agentDef: canonicalDef('adversarial-review') },
  );
  assert.equal(res.status, 'complete', JSON.stringify(res));
  return { record: JSON.parse(readFileSync(reviewFindingsJsonPath(r.logsRoot, CYCLE), 'utf8')), events };
}

const listed = (prompt: string, file: string): boolean => prompt.includes(`- \`${file}\``);

/** The gitweave branch at round 1 (39ad991) — WI-1 delivered, reviewed once. */
async function roundOne(): Promise<Repo> {
  const r = makeRepo({
    'README.md': '# GitWeave\n',
    'metrics/src/main.py': 'app = None\n',
    'tests/test_demo_guide.py': 'def test_guide():\n    pass\n',
    'tests/test_oidc_workflow.py': 'def test_oidc():\n    pass\n',
    'docs/demo-guide.md': '# Demo\n\n```bash\npython3 -m pip install -r metrics/requirements.txt --quiet\n```\n',
    '.github/copilot-context.md': 'run pytest tests/test_metrics_dockerfile.py\n',
  });
  writeFileSync(join(r.wt, '.forge', 'work-items', 'WI-1.md'), serializeWorkItem(
    wi('WI-1', ['tests/test_demo_guide.py', 'metrics/src/main.py'], [{ given: 'the pruned tree', when: 'read', then: 'metrics/ is gone' }]),
  ));
  deliver(r, 'WI-1', () => {
    unlinkSync(join(r.wt, 'metrics', 'src', 'main.py'));
    r.write('tests/test_demo_guide.py', 'def test_guide():\n    assert True\n');
  });
  orchestratorCommit(r, 1);
  const prompts: string[] = [];
  // Round 1's agent reads the worktree and reports the stale demo-guide line —
  // true at round 1, so this is the finding the run actually recorded.
  const { record } = await review(r, agent(r, prompts, (p) => (listed(p, 'metrics/src/main.py') ? [ROUND1_FINDING] : [])));
  assert.ok(record.findings.some((f) => f.title === ROUND1_FINDING.title), 'round 1 records the finding (precondition)');
  return r;
}

/** Round 2 (1d228b1): the D-20 fix work item WI-7 lands as a deletion-heavy commit. */
function roundTwoBranch(r: Repo): void {
  copyFileSync(join(FIXTURE, 'WI-7.md.fixture'), join(r.wt, '.forge', 'work-items', 'WI-7.md'));
  deliver(r, 'WI-7', () => {
    unlinkSync(join(r.wt, 'tests', 'test_oidc_workflow.py'));
    r.write('docs/demo-guide.md', '# Demo\n\n```bash\npip install -r requirements.txt --quiet\n```\n');
    r.write('.github/copilot-context.md', '\n');
  });
  orchestratorCommit(r, 2);
}

const wi7Criteria = (rec: ReviewFindingsRecord): ReviewFindingsRecord['acEvaluations'] => rec.acEvaluations.filter((e) => e.criterion.startsWith('(WI-7)'));

test('(a) a deletion-heavy D-20 fix work item is reviewed against the commits recorded for it, never MISSED by declared-file presence', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const priorTimeout = process.env.FORGE_GATE_TIMEOUT_MS;
  process.env.FORGE_GATE_TIMEOUT_MS = '60000';
  const r = await roundOne();
  try {
    roundTwoBranch(r);
    const prompts: string[] = [];
    const { record } = await review(r, agent(r, prompts, () => []));
    const judged = wi7Criteria(record);
    assert.equal(judged.length, 2, 'both of WI-7\'s criteria are judged');
    for (const e of judged) assert.doesNotMatch(e.evidence, /no file declared by WI-7/, `judged by declared-file presence: ${e.evidence}`);
    const wi7Prompt = prompts.find((p) => p.includes('(WI-7) GIVEN the demo region "ac-11"'));
    assert.ok(wi7Prompt, 'WI-7\'s prose criterion is put to a review agent');
    for (const f of ['tests/test_oidc_workflow.py', 'docs/demo-guide.md', '.github/copilot-context.md']) {
      assert.ok(listed(wi7Prompt!, f), `WI-7's chunk carries ${f}, a file its recorded merge changed (deletions count)`);
    }
  } finally {
    if (priorTimeout === undefined) delete process.env.FORGE_GATE_TIMEOUT_MS;
    else process.env.FORGE_GATE_TIMEOUT_MS = priorTimeout;
    r.cleanup();
    restore();
  }
});

test('(a) refusal: a D-20 fix work item with NO recorded delivery is MISSED, and the evidence says no delivery was recorded', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const r = await roundOne();
  try {
    writeFileSync(join(r.wt, '.forge', 'work-items', 'WI-2.md'), serializeWorkItem({
      ...wi('WI-2', ['tests/test_demo_guide.py'], [{ given: 'the tree', when: 'read', then: 'it is tidy' }]), origin: 'review-fix',
    }));
    orchestratorCommit(r, 2);
    const { record } = await review(r, agent(r, [], () => []));
    const e = record.acEvaluations.find((x) => x.criterion.startsWith('(WI-2)'));
    assert.equal(e?.verdict, 'missed');
    assert.match(e!.evidence, /wi\(WI-2\): merge/, 'names the recorded commit it looked for');
  } finally {
    r.cleanup();
    restore();
  }
});

test('(b) a round-1 finding is not republished at a head where a work item has since delivered: the chunk is judged again', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const r = await roundOne();
  try {
    roundTwoBranch(r);
    const head = r.git(['rev-parse', 'HEAD']).trim();
    const prompts: string[] = [];
    // The honest round-2 agent reads 1d228b1's demo-guide and finds nothing.
    const { record, events } = await review(r, agent(r, prompts, () => []));
    assert.equal(record.headSha, head);
    assert.ok(
      !record.findings.some((f) => f.title === ROUND1_FINDING.title),
      `round 1's WI-1/RF-1 is presented as current at ${head.slice(0, 7)}, where it is false`,
    );
    assert.ok(prompts.some((p) => listed(p, 'metrics/src/main.py')), 'WI-1 is re-reviewed at the new head');
    const refused = events.find((e) => e.message === 'review.chunk.reuse-refused');
    assert.ok(refused, 'the refusal is an event');
    assert.match(JSON.stringify(refused!.metadata), /WI-1/);
  } finally {
    r.cleanup();
    restore();
  }
});

test('(b) negative control: with no work-item delivery since, an orchestrator commit still reuses the record, labelled with the head it was judged at', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const r = await roundOne();
  try {
    const judgedAt = r.git(['rev-parse', 'HEAD']).trim();
    orchestratorCommit(r, 2);
    const prompts: string[] = [];
    const { record } = await review(r, agent(r, prompts, () => []));
    assert.ok(!prompts.some((p) => listed(p, 'metrics/src/main.py')), 'WI-1 is not bought twice');
    assert.ok(record.findings.some((f) => f.title === ROUND1_FINDING.title), 'its finding still stands');
    assert.match(record.summary, new RegExp(`judged at ${judgedAt.slice(0, 12)}`), 'and the record says which head judged it');
  } finally {
    r.cleanup();
    restore();
  }
});

// ---------------------------------------------------------------------------
// (c) a criterion carrying a runnable command is RUN at the head (D-15)
// ---------------------------------------------------------------------------

test('(c) a criterion whose command the D-47 rule recognises is run at the head: exit 0 MET, exit 1 MISSED with the output tail', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const priorCtx = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT; // the child `node --test` must report to its own exit code, not to this runner
  const r = makeRepo({ 'README.md': '# x\n' });
  try {
    r.write('ok.test.mjs', "import test from 'node:test';\ntest('ok', () => {});\n");
    r.write('bad.test.mjs', "import test from 'node:test';\ntest('bad', () => { throw new Error('boom-sentinel'); });\n");
    r.git(['add', '--', 'ok.test.mjs', 'bad.test.mjs']);
    r.git(['commit', '-q', '-m', 'tests']);
    writeFileSync(join(r.wt, '.forge', 'work-items', 'WI-1.md'), serializeWorkItem(wi('WI-1', ['ok.test.mjs', 'bad.test.mjs'], [
      { given: 'the head', when: '`node --test ok.test.mjs` runs', then: 'it exits 0' },
      { given: 'the head', when: '`node --test bad.test.mjs` runs', then: 'it exits 0' },
      { given: 'the head', when: 'the operator reviews the change', then: 'the docs read well' },
      { given: 'the head', when: '`node --test ok.test.mjs | cat` runs', then: 'it exits 0' },
    ])));
    const head = r.git(['rev-parse', 'HEAD']).trim();
    const prompts: string[] = [];
    const { record } = await review(r, agent(r, prompts, () => []));
    const byWhen = (w: string) => record.acEvaluations.find((e) => e.criterion.includes(w));
    assert.equal(byWhen('`node --test ok.test.mjs` runs')?.verdict, 'met');
    assert.match(byWhen('`node --test ok.test.mjs` runs')!.evidence, new RegExp(`exit 0 at ${head.slice(0, 12)}`));
    const bad = byWhen('`node --test bad.test.mjs` runs');
    assert.equal(bad?.verdict, 'missed');
    assert.match(bad!.evidence, /boom-sentinel/, 'MISSED carries the output tail');
    const shown = prompts.join('\n');
    assert.doesNotMatch(shown, /`node --test ok\.test\.mjs` runs THEN/, 'a criterion the orchestrator ran is not put to the agent');
    // Negative controls: prose, and a span that needs a shell, stay with the agent.
    assert.match(shown, /WHEN the operator reviews the change THEN the docs read well/);
    assert.match(shown, /`node --test ok\.test\.mjs \| cat` runs/);
  } finally {
    if (priorCtx !== undefined) process.env.NODE_TEST_CONTEXT = priorCtx;
    r.cleanup();
    restore();
  }
});
