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

import { runIntegrateBand } from '../../phases/integrate.ts';
import type { DemoPlannerInput, DemoPlannerOutcome, DemoPlannerPort } from '../../demo-planner-port.ts';
import { testClassProfilePort } from '../test-fixtures/class-profile-port-fixture.ts';

const ID = 'INIT-2026-10-09-org-read';
const API_CMD = 'node -p 1';
const CLI_CMD = 'git --version';
const NARRATIVE = 'Platform admins can now read the whole org back in one call and see what the last apply changed.';

let root: string;
let events: EventLogEntry[];
const logger = {
  emit(entry: Partial<EventLogEntry>): EventLogEntry {
    const full = { event_id: `e${events.length}`, ...entry } as EventLogEntry;
    events.push(full);
    return full;
  },
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

afterEach(() => rmSync(root, { recursive: true, force: true }));

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
    const capture = events.find((e) => (e as { message?: string }).message === 'demo.capture') as { metadata: { capture_nonce: string } };
    assert.equal(demo.capture.nonce, capture.metadata.capture_nonce);
    // The plan is inert: recorded beside demo.json, it carries no output, delta or stamp.
    const planText = readFileSync(join(demoDir(), 'demo-plan.json'), 'utf8');
    assert.doesNotMatch(planText, /Output|delta|nonce|capture"/);
    assert.match(readFileSync(join(demoDir(), 'DEMO.md'), 'utf8'), /## What this enables\n\n_Agent narrative — not evidence\._/);
    // The event log carries the plan and what it cost.
    assert.ok(messages().includes('demo.plan.start'));
    const validated = events.find((e) => (e as { message?: string }).message === 'demo.plan.validated') as { cost_usd?: number };
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

  it('a planner that produced nothing fails the band by name — never the derived checkpoints', async () => {
    const result = await run(port({ ok: false, reason: 'spawn-suppressed', detail: 'FORGE_DRY_BRIDGE' }));
    assert.equal(result.status === 'failed' && result.reason, 'plan-failed');
    assert.ok(!existsSync(join(demoDir(), 'demo.json')));
  });
});
