/**
 * D-45 (forge-mfv5.1.19): the demo planner chooses each checkpoint's evidence
 * form and the initiative's narrative as inert data from the change's ACs and
 * user stories; the declaration supplies only means; the orchestrator
 * validates the plan by name, captures and compares (D-15); the narrative is
 * never evidence.
 *
 * A real temp git worktree, a fixture initiative with one API AC and one CLI
 * AC, an injected planner port (no model, no network), and a fake capture
 * child that stamps the orchestrator's nonce.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeManifest } from '@forge/flows';
import type { AgentDefinition, InitiativeManifest } from '@forge/contracts';
import type { EventLogEntry, EventLogger } from '@forge/kernel';

import { classifyCycleFailure } from '@forge/agents';

import { runIntegrateBand } from '../../phases/integrate.ts';
import { integrateDeliveryFailure } from '../../phases/executor-table.ts';
import type { DemoPlannerInput, DemoPlannerOutcome, DemoPlannerPort } from '../../demo-planner-port.ts';
import { testClassProfilePort } from '../test-fixtures/class-profile-port-fixture.ts';

const ID = 'INIT-2026-10-09-org-read';
const API_CMD = 'node -p 1';
const CLI_CMD = 'git --version';
const NARRATIVE = 'Platform admins can now read the whole org back in one call and see what the last apply changed.';

let root: string;
let logsDir: string;
let events: EventLogEntry[];
const logger = {
  emit(entry: Partial<EventLogEntry>): EventLogEntry {
    const full = { event_id: `e${events.length}`, ...entry } as EventLogEntry;
    events.push(full);
    return full;
  },
  // The cycle's own log dir is a tmp dir beside the worktree, never the repo's _logs.
  get logFilePath(): string { return join(logsDir, 'events.jsonl'); },
} as unknown as EventLogger;
const DEF = { slug: 'demo-agent', path: '/nonexistent/SKILL.md' } as unknown as AgentDefinition;
const GATES = [{ gate: 'local' as const, cmd: ['npm', 'test'], ok: true, outputTail: '12 passing' }];

const git = (args: string[]): string => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });

function writeWorkItem(id: string, when: string, story: string): void {
  const dir = join(root, '.forge', 'work-items');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), [
    '---', `work_item_id: ${id}`, `initiative_id: ${ID}`, 'status: complete', 'acceptance_criteria:',
    '  - given: a configured org', `    when: ${when}`, '    then: the org reads back', '---', '', story, '',
  ].join('\n'));
}

function manifestPath(): string {
  const m: InitiativeManifest = {
    initiative_id: ID, class: 'code', acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }], project: 'gitweave',
    project_repo_path: root, created_at: '2026-10-09T00:00:00Z', iteration_budget: 50, cost_budget_usd: 25,
    phase: 'in-flight', origin: 'architect', title: 'Read the org back', body: '# Read the org back\n',
  };
  const p = join(root, 'manifest.md');
  writeFileSync(p, serializeManifest(m));
  return p;
}

/** The capture child: stamps the nonce it was handed (what `forge demo capture` does), records that it ran. */
function fakeCapture(): string {
  const p = join(root, 'fake-capture.mjs');
  writeFileSync(p, [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "const f = join(process.cwd(), 'demo', process.argv[2], 'demo.json');",
    "const m = JSON.parse(readFileSync(f, 'utf8'));",
    "m.checkpoints = m.checkpoints.map((c) => ({ ...c, delta: 'changed' }));",
    'm.capture = { nonce: process.env.FORGE_CAPTURE_NONCE };',
    'writeFileSync(f, JSON.stringify(m, null, 2));',
    "writeFileSync(join(process.cwd(), 'capture-ran'), 'yes');",
  ].join('\n'));
  return p;
}

function port(outcome: DemoPlannerOutcome, seen: DemoPlannerInput[] = []): DemoPlannerPort {
  return { plan: async (_def, input) => { seen.push(input); return outcome; } };
}

async function run(planner: DemoPlannerPort) {
  return runIntegrateBand({
    initiativeId: ID, worktreePath: root, manifestPath: manifestPath(), projectRepoPath: root,
    orchestratedCapture: { argv: [process.execPath, fakeCapture(), ID] },
    planner: { port: planner, def: DEF, cycleId: 'cycle-1' },
  }, logger, GATES, testClassProfilePort());
}

const messages = (): string[] => events.map((e) => String((e as { message?: string }).message ?? ''));
const demoDir = (): string => join(root, 'demo', ID);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'forge-demo-planner-'));
  logsDir = mkdtempSync(join(tmpdir(), 'forge-demo-planner-logs-'));
  events = [];
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@forge.local']);
  git(['config', 'user.name', 'forge test']);
  writeFileSync(join(root, 'src.ts'), 'export const a = 1;\n');
  git(['add', '--', 'src.ts']);
  git(['commit', '-q', '-m', 'base']);
  git(['checkout', '-q', '-b', 'forge/INIT']);
  writeFileSync(join(root, 'src.ts'), 'export const a = 2;\n');
  git(['add', '--', 'src.ts']);
  git(['commit', '-q', '-m', 'the initiative']);
  mkdirSync(join(root, '.forge'), { recursive: true });
  writeFileSync(join(root, '.forge', 'project.json'), JSON.stringify({
    name: 'gitweave', testProcess: { local: { cmd: ['npm', 'test'] } },
    demoMeans: { api: { commands: [API_CMD] } },
  }));
  writeWorkItem('WI-1', `run \`${CLI_CMD}\``, 'As a platform admin I want the CLI to report its version.');
  writeWorkItem('WI-2', 'the org is read', 'As a platform admin I want to read the org back after an apply.');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(logsDir, { recursive: true, force: true });
});

describe('D-45: the planner picks the form and the narrative; the orchestrator validates, captures and compares', () => {
  it('one API AC + one CLI AC → demo.json carries two forms + the narrative; capture ran under the nonce; the plan carries no output', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await run(port({
      ok: true, costUsd: 0.12,
      raw: { narrative: NARRATIVE, checkpoints: [
        { form: 'api-before-after', caption: 'The org reads back as JSON', acRef: 'WI-2', command: API_CMD },
        { form: 'cli-before-after', caption: 'The CLI reports its version', acRef: 'WI-1', command: CLI_CMD },
      ] },
    }, seen));
    assert.equal(result.status, 'complete', result.status === 'failed' ? result.detail : '');

    // The planner saw the user stories and only the declared means + AC spans.
    assert.match(seen[0]!.workItems.map((w) => w.story).join('\n'), /read the org back after an apply/);
    assert.deepEqual(seen[0]!.allowed.apiCommands, [API_CMD, CLI_CMD]);

    const demo = JSON.parse(readFileSync(join(demoDir(), 'demo.json'), 'utf8'));
    assert.deepEqual(demo.checkpoints.map((c: { form: string }) => c.form), ['api-before-after', 'cli-before-after']);
    assert.equal(demo.narrative, NARRATIVE);
    // D-15: the orchestrator ran the capture and the stamp is the nonce IT generated.
    assert.ok(existsSync(join(root, 'capture-ran')));
    const capture = events.find((e) => (e as { message?: string }).message === 'demo.capture') as unknown as { metadata: { capture_nonce: string } };
    assert.equal(demo.capture.nonce, capture.metadata.capture_nonce);
    // The plan is inert: recorded beside demo.json, it carries no output, delta or stamp.
    const planText = readFileSync(join(demoDir(), 'demo-plan.json'), 'utf8');
    assert.doesNotMatch(planText, /Output|delta|nonce|capture"/);
    assert.match(readFileSync(join(demoDir(), 'DEMO.md'), 'utf8'), /## What this enables\n\n_Agent narrative — not evidence\._/);
    // The event log carries the plan and what it cost.
    assert.ok(messages().includes('demo.plan.start'));
    const validated = events.find((e) => (e as { message?: string }).message === 'demo.plan.validated') as unknown as { cost_usd?: number };
    assert.equal(validated.cost_usd, 0.12);
  });

  for (const [name, checkpoint, row] of [
    ['an agent-supplied host', { form: 'api-before-after', caption: 'c', apiPath: 'https://evil.example/orgs' }, /plan-invalid:checkpoints\[0\]\.apiPath/],
    ['a command outside the means', { form: 'cli-before-after', caption: 'c', command: 'curl --version' }, /plan-invalid:checkpoints\[0\]\.command/],
    ['an unknown form', { form: 'hologram', caption: 'c' }, /plan-invalid:checkpoints\[0\]\.form/],
  ] as const) {
    it(`an invalid plan (${name}) fails the band by name — no demo, no capture, no fallback`, async () => {
      const result = await run(port({ ok: true, costUsd: 0.05, raw: { narrative: NARRATIVE, checkpoints: [checkpoint] } }));
      assert.equal(result.status, 'failed');
      assert.equal(result.status === 'failed' && result.reason, 'plan-invalid');
      assert.match(result.status === 'failed' ? result.detail : '', row);
      assert.ok(!existsSync(join(demoDir(), 'demo.json')), 'no derived demo stands in for the refused plan');
      assert.ok(!existsSync(join(root, 'capture-ran')));
      assert.ok(messages().includes('demo.plan.invalid'));
    });
  }

  it('a screenshot checkpoint is marked kind screenshot, so capture opens it', async () => {
    writeFileSync(join(root, '.forge', 'project.json'), JSON.stringify({ name: 'gitweave', testProcess: { local: { cmd: ['npm', 'test'] } }, demoMeans: { routes: ['/org'] } }));
    const result = await run(port({ ok: true, costUsd: 0, raw: { narrative: NARRATIVE, checkpoints: [{ form: 'screenshot', caption: 'The org page', route: '/org' }] } }));
    assert.equal(result.status, 'complete', result.status === 'failed' ? result.detail : '');
    const demo = JSON.parse(readFileSync(join(demoDir(), 'demo.json'), 'utf8'));
    assert.equal(demo.checkpoints[0].kind, 'screenshot');
    assert.ok(existsSync(join(root, 'capture-ran')), 'a route-only plan still reaches the orchestrated capture');
  });

  it('a planner that produced nothing fails the band by name — never the derived checkpoints', async () => {
    const result = await run(port({ ok: false, reason: 'spawn-suppressed', detail: 'FORGE_DRY_BRIDGE' }));
    assert.equal(result.status === 'failed' && result.reason, 'plan-failed');
    assert.ok(!existsSync(join(demoDir(), 'demo.json')));
  });
});

// forge-nk1y.42: a plan whose command would run a PATH copy of the tree's own
// command is refused at preflight, and the planner gets ONE revise turn told why.
describe('nk1y.42: an unproducible plan gets one revise turn, told why', () => {
  const GW = 'gw plan';
  let savedPath: string | undefined;
  beforeEach(() => {
    const stale = join(root, '..', `${root.split('/').pop()}-stale-bin`);
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'gw'), '#!/bin/sh\necho stale\n', { mode: 0o755 });
    savedPath = process.env.PATH;
    process.env.PATH = `${stale}:${savedPath ?? ''}`;
    writeFileSync(join(root, 'pyproject.toml'), '[project.scripts]\ngw = "gitweave.cli:main"\n');
    writeFileSync(join(root, '.forge', 'project.json'), JSON.stringify({
      name: 'gitweave', testProcess: { local: { cmd: ['npm', 'test'] } }, demoMeans: { commands: [GW, CLI_CMD] },
    }));
  });
  afterEach(() => {
    process.env.PATH = savedPath;
    rmSync(join(root, '..', `${root.split('/').pop()}-stale-bin`), { recursive: true, force: true });
  });

  const plan = (command: string): DemoPlannerOutcome => ({
    ok: true, costUsd: 0.01, raw: { narrative: NARRATIVE, checkpoints: [{ form: 'cli-before-after', caption: 'c', acRef: 'WI-1', command }] },
  });
  function sequence(outcomes: DemoPlannerOutcome[], seen: DemoPlannerInput[]): DemoPlannerPort {
    return { plan: async (_def, input) => { seen.push(input); return outcomes[Math.min(seen.length - 1, outcomes.length - 1)]!; } };
  }

  it('the revise turn is told the refusal by name, and its producible plan is captured', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await run(sequence([plan(GW), plan(CLI_CMD)], seen));
    assert.equal(result.status, 'complete', result.status === 'failed' ? result.detail : '');
    assert.equal(seen.length, 2);
    assert.equal(seen[0]!.revise, undefined);
    assert.match(seen[1]!.revise!.reason, /not producible/);
    assert.match(seen[1]!.revise!.details.join('\n'), /`gw` resolves to .*stale-bin\/gw outside the capture tree .*demoMeans\.run/);
    assert.ok(messages().includes('demo.plan.revise'));
    const demo = JSON.parse(readFileSync(join(demoDir(), 'demo.json'), 'utf8'));
    assert.equal(demo.checkpoints[0].command, CLI_CMD);
  });

  it('ONE chance: a revise that is still unproducible fails the band by name, no capture', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await run(sequence([plan(GW), plan(GW)], seen));
    assert.equal(seen.length, 2);
    assert.equal(result.status === 'failed' && result.reason, 'tooling-unavailable');
    assert.match(result.status === 'failed' ? result.detail : '', /outside the capture tree/);
    assert.ok(!existsSync(join(root, 'capture-ran')));
  });

  it('a producible plan is never sent back', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await run(sequence([plan(CLI_CMD)], seen));
    assert.equal(result.status, 'complete', result.status === 'failed' ? result.detail : '');
    assert.equal(seen.length, 1);
    assert.ok(!messages().includes('demo.plan.revise'));
  });
});

// forge-nk1y.43: an all-unchanged capture sends the plan back ONCE with the identical outputs in its
// brief; the revised plan is captured again; a second no-change stands as the named outcome.
describe('nk1y.43: a no-change capture gets one revise turn with the identical outputs', () => {
  /** Capture child: run N stamps the deltas[N-1] on every checkpoint, with identical output on unchanged. */
  function sequencedCapture(deltas: string[]): string {
    const p = join(root, 'fake-capture-seq.mjs');
    writeFileSync(p, [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const n = join(process.cwd(), 'capture-count');",
      "const run = existsSync(n) ? Number(readFileSync(n, 'utf8')) + 1 : 1;",
      'writeFileSync(n, String(run));',
      `const delta = ${JSON.stringify(deltas)}[run - 1] ?? 'unchanged';`,
      "const f = join(process.cwd(), 'demo', process.argv[2], 'demo.json');",
      "const m = JSON.parse(readFileSync(f, 'utf8'));",
      "m.checkpoints = m.checkpoints.map((c) => ({ ...c, delta, beforeOutput: 'git version 2.55.0', afterOutput: 'git version 2.55.0' }));",
      'm.capture = { nonce: process.env.FORGE_CAPTURE_NONCE };',
      'writeFileSync(f, JSON.stringify(m, null, 2));',
    ].join('\n'));
    return p;
  }
  async function runSeq(planner: DemoPlannerPort, deltas: string[]) {
    return runIntegrateBand({
      initiativeId: ID, worktreePath: root, manifestPath: manifestPath(), projectRepoPath: root,
      orchestratedCapture: { argv: [process.execPath, sequencedCapture(deltas), ID] },
      planner: { port: planner, def: DEF, cycleId: 'cycle-1' },
    }, logger, GATES, testClassProfilePort());
  }
  const plan = (command: string): DemoPlannerOutcome => ({
    ok: true, costUsd: 0.01, raw: { narrative: NARRATIVE, checkpoints: [{ form: 'cli-before-after', caption: 'c', acRef: 'WI-1', command }] },
  });
  const apiPlan: DemoPlannerOutcome = {
    ok: true, costUsd: 0.01, raw: { narrative: NARRATIVE, checkpoints: [{ form: 'api-before-after', caption: 'c', acRef: 'WI-2', command: API_CMD }] },
  };
  function sequence(outcomes: DemoPlannerOutcome[], seen: DemoPlannerInput[]): DemoPlannerPort {
    return { plan: async (_def, input) => { seen.push(input); return outcomes[Math.min(seen.length - 1, outcomes.length - 1)]!; } };
  }

  it('the revise turn sees the identical outputs; its plan is captured again and reads changed', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await runSeq(sequence([plan(CLI_CMD), apiPlan], seen), ['unchanged', 'changed']);
    assert.equal(result.status, 'complete', result.status === 'failed' ? result.detail : '');
    assert.equal(seen.length, 2);
    assert.match(seen[1]!.revise!.reason, /^Demo captured no behaviour change — 1\/1 checkpoints identical/);
    assert.deepEqual(seen[1]!.revise!.details, [`"Plan 1: WI-1" \`${CLI_CMD}\` printed the same before and after: git version 2.55.0`]);
    assert.equal(readFileSync(join(root, 'capture-count'), 'utf8'), '2');
    const demo = JSON.parse(readFileSync(join(demoDir(), 'demo.json'), 'utf8'));
    assert.equal(demo.outcome.kind, 'changed');
    assert.equal(demo.checkpoints[0].command, API_CMD);
    assert.ok(!messages().includes('demo.no-change'));
  });

  it('ONE chance: a second no-change stands as the named outcome, the planner asked exactly twice', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await runSeq(sequence([plan(CLI_CMD), apiPlan], seen), ['unchanged', 'unchanged']);
    assert.equal(result.status, 'complete', result.status === 'failed' ? result.detail : '');
    assert.equal(seen.length, 2);
    const demo = JSON.parse(readFileSync(join(demoDir(), 'demo.json'), 'utf8'));
    assert.equal(demo.outcome.kind, 'no-change');
    assert.ok(messages().includes('demo.no-change'));
  });

  it('a changed first capture is never sent back', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await runSeq(sequence([plan(CLI_CMD)], seen), ['changed']);
    assert.equal(result.status, 'complete', result.status === 'failed' ? result.detail : '');
    assert.equal(seen.length, 1);
    assert.equal(readFileSync(join(root, 'capture-count'), 'utf8'), '1');
  });
});

// forge-mfv5.1.41 (D-49 shape on D-45): a plan the validator refuses gets exactly ONE repair turn, fed the
// validator's errors verbatim, the declared means and the invalid plan; a second refusal fails the band by
// name with both outputs and the recovery act. The raw invalid plan is persisted beside the cycle's events.
describe('mfv5.1.41: a refused plan gets one error-fed repair turn, then fails by name', () => {
  // The I3b shape: the planner narrows a declared AC span to one file under it.
  const NARROWED = `${CLI_CMD} --build-options`;
  const rawOf = (command: string) => ({ narrative: NARRATIVE, checkpoints: [{ form: 'cli-before-after', caption: 'c', acRef: 'WI-1', command }] });
  const plan = (command: string, costUsd = 0.18): DemoPlannerOutcome => ({ ok: true, costUsd, raw: rawOf(command) });
  function sequence(outcomes: DemoPlannerOutcome[], seen: DemoPlannerInput[]): DemoPlannerPort {
    return { plan: async (_def, input) => { seen.push(input); return outcomes[Math.min(seen.length - 1, outcomes.length - 1)]!; } };
  }
  const named = (m: string): Array<{ metadata: Record<string, unknown>; cost_usd?: number }> =>
    events.filter((e) => (e as { message?: string }).message === m) as unknown as Array<{ metadata: Record<string, unknown>; cost_usd?: number }>;

  it('invalid then valid: the repair turn sees the error verbatim, the means and the invalid plan; capture proceeds', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await run(sequence([plan(NARROWED), plan(CLI_CMD)], seen));
    assert.equal(result.status, 'complete', result.status === 'failed' ? result.detail : '');
    assert.equal(seen.length, 2);
    assert.equal(seen[0]!.revise, undefined);
    const error = `plan-invalid:checkpoints[0].command: ${JSON.stringify(NARROWED)} is not a declared means (demoMeans or an acceptance criterion's span)`;
    assert.match(seen[1]!.revise!.reason, /failed validation/);
    assert.deepEqual(seen[1]!.revise!.details, [error]);
    assert.deepEqual(JSON.parse(seen[1]!.revise!.invalidPlan!), rawOf(NARROWED));
    assert.deepEqual(seen[1]!.allowed, seen[0]!.allowed, 'the repair turn carries the full declared means');
    const repair = named('demo.plan.repair-turn');
    assert.equal(repair.length, 1);
    assert.deepEqual(repair[0]!.metadata.errors, [error]);
    // The raw refused plan is on disk beside the cycle's events and named in the event.
    const invalid = named('demo.plan.invalid');
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0]!.metadata.attempt, 1);
    assert.equal(invalid[0]!.metadata.raw_plan_path, join(logsDir, 'demo-plan-invalid-1.json'));
    assert.deepEqual(JSON.parse(readFileSync(join(logsDir, 'demo-plan-invalid-1.json'), 'utf8')), rawOf(NARROWED));
    // Both turns are metered.
    assert.equal(invalid[0]!.cost_usd, 0.18);
    assert.equal(named('demo.plan.validated')[0]!.cost_usd, 0.18);
    assert.ok(existsSync(join(root, 'capture-ran')));
    const demo = JSON.parse(readFileSync(join(demoDir(), 'demo.json'), 'utf8'));
    assert.equal(demo.checkpoints[0].command, CLI_CMD);
  });

  it('invalid twice: fails by name with BOTH validator outputs and the recovery act — no third call, no capture', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await run(sequence([plan(NARROWED), plan('curl --version'), plan(CLI_CMD)], seen));
    assert.equal(seen.length, 2, 'exactly one repair turn');
    assert.equal(result.status === 'failed' && result.reason, 'plan-invalid');
    const detail = result.status === 'failed' ? result.detail : '';
    assert.match(detail, /^Demo plan invalid after a repair turn: plan-invalid:checkpoints\[0\]\.command: "curl --version" is not a declared means/);
    assert.match(detail, /first plan: plan-invalid:checkpoints\[0\]\.command: "git --version --build-options" is not a declared means/);
    assert.match(detail, /Resume from integrate re-runs the planner/);
    const invalid = named('demo.plan.invalid');
    assert.deepEqual(invalid.map((e) => e.metadata.attempt), [1, 2]);
    assert.ok(existsSync(join(logsDir, 'demo-plan-invalid-2.json')));
    assert.ok(!existsSync(join(root, 'capture-ran')));
    assert.ok(!existsSync(join(demoDir(), 'demo.json')));
    // The run page's failure note is the classifier's reason over the executor's own throw: it names the
    // band's headline and the recovery act, never a bare "integrate band failed".
    const thrown = integrateDeliveryFailure('plan-invalid', detail);
    const c = classifyCycleFailure([{ ...events[0]!, phase: 'orchestrator', skill: 'cycle', event_type: 'error', message: thrown }]);
    assert.equal(c.kind, 'terminal');
    assert.match(c.reason, /integrate band failed \(plan-invalid\): Demo plan invalid after a repair turn: plan-invalid:checkpoints\[0\]\.command/);
    assert.match(c.reason, /Resume from integrate re-runs the planner/);
  });

  it('a valid first plan gets no repair turn (control)', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await run(sequence([plan(CLI_CMD)], seen));
    assert.equal(result.status, 'complete', result.status === 'failed' ? result.detail : '');
    assert.equal(seen.length, 1);
    assert.equal(named('demo.plan.repair-turn').length, 0);
    assert.equal(named('demo.plan.invalid').length, 0);
  });

  it('D-45 untouched: the repaired plan is validated the same way — an undeclared command is still refused', async () => {
    const seen: DemoPlannerInput[] = [];
    const result = await run(sequence([plan(NARROWED), plan(NARROWED)], seen));
    assert.equal(result.status === 'failed' && result.reason, 'plan-invalid');
    assert.match(result.status === 'failed' ? result.detail : '', /is not a declared means/);
  });
});
