/**
 * The integrate band (spec §5 item 4) — the orchestrator verb that turns a
 * finished branch into the artifacts a reviewer reads, with no LLM in it.
 *
 * Each test names the failure it kills. The band writes to a real temp git
 * worktree, because every one of its failure modes is a filesystem or git fact.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeManifest, type InitiativeManifest } from '@forge/flows/manifest.ts';
import type { EventLogEntry } from '@forge/kernel';

import { runIntegrateBand, PR_DESCRIPTION_REL } from './integrate.ts';

const INITIATIVE_ID = 'INIT-2026-09-05-integrate';

let root: string;
let events: EventLogEntry[];

const logger = {
  emit(entry: Partial<EventLogEntry>): EventLogEntry {
    const full = { event_id: `e${events.length}`, ...entry } as EventLogEntry;
    events.push(full);
    return full;
  },
} as unknown as import('@forge/kernel').EventLogger;

function git(args: string[], cwd = root): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

function manifest(overrides: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: INITIATIVE_ID,
    class: 'code',
    acceptance_criteria: [{ given: 'a repo', when: 'the CLI runs', then: 'a report prints' }],
    project: 'gitpulse',
    project_repo_path: root,
    created_at: '2026-09-05T00:00:00Z',
    iteration_budget: 50,
    cost_budget_usd: 25,
    phase: 'in-flight',
    origin: 'architect',
    title: 'Integrate band under test',
    body: '# Integrate band under test\n',
    ...overrides,
  };
}

function writeManifest(m: InitiativeManifest = manifest()): string {
  const path = join(root, 'manifest.md');
  writeFileSync(path, serializeManifest(m));
  return path;
}

function writeProjectConfig(demoProcess: unknown): void {
  mkdirSync(join(root, '.forge'), { recursive: true });
  writeFileSync(
    join(root, '.forge', 'project.json'),
    JSON.stringify({ name: 'gitpulse', testProcess: { local: { cmd: ['npm', 'test'] } }, demoProcess }, null, 2),
  );
}

function writeWorkItem(id: string): void {
  const dir = join(root, '.forge', 'work-items');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.md`),
    [
      '---',
      `work_item_id: ${id}`,
      `initiative_id: ${INITIATIVE_ID}`,
      'status: complete',
      'acceptance_criteria:',
      '  - given: a fixture repo',
      '    when: the CLI runs',
      '    then: a report prints',
      '---',
      '',
      `Build ${id}.`,
      '',
    ].join('\n'),
  );
}

const GATES = [{ gate: 'local' as const, cmd: ['npm', 'test'], ok: true, outputTail: '120 passing' }];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'forge-integrate-'));
  events = [];
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@forge.local']);
  git(['config', 'user.name', 'forge test']);
  writeFileSync(join(root, 'src.ts'), 'export const a = 1;\n');
  git(['add', '--', 'src.ts']);
  git(['commit', '-q', '-m', 'base']);
  // A real initiative branch with a real diff — the band runs after the
  // empty-branch guard, so an empty diff is a state it never sees in production.
  git(['checkout', '-q', '-b', 'forge/INIT']);
  writeFileSync(join(root, 'src.ts'), 'export const a = 2;\n');
  git(['add', '--', 'src.ts']);
  git(['commit', '-q', '-m', 'the initiative']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function messages(): string[] {
  return events.map((e) => String((e as { message?: string }).message ?? ''));
}

describe('integrate band — what it writes', () => {
  it('kills "no PR body, no PR": both artifacts land, derived, with no agent spawned', () => {
    writeProjectConfig([]);
    writeWorkItem('WI-1');
    const result = runIntegrateBand(
      { initiativeId: INITIATIVE_ID, worktreePath: root, manifestPath: writeManifest(manifest({ class: 'docs' })), projectRepoPath: root },
      logger,
      GATES,
    );
    assert.equal(result.status, 'complete');
    const prBody = readFileSync(join(root, PR_DESCRIPTION_REL), 'utf8');
    for (const section of ['## Why', '## What', '## How']) assert.ok(prBody.includes(section), `PR body missing ${section}`);
    assert.ok(prBody.includes('a report prints'), 'the work item criterion reaches the PR body');
    const demoJson = JSON.parse(readFileSync(join(root, 'demo', INITIATIVE_ID, 'demo.json'), 'utf8'));
    assert.equal(demoJson.acEvaluations, undefined, 'the band must not score its own criteria');
    assert.ok(existsSync(join(root, 'demo', INITIATIVE_ID, 'DEMO.md')), 'DEMO.md is rendered from the derived model');
  });

  it('kills "a stale body from the previous round ships": an existing PR body is replaced, not appended to', () => {
    writeProjectConfig([]);
    mkdirSync(join(root, '.forge'), { recursive: true });
    writeFileSync(join(root, PR_DESCRIPTION_REL), 'STALE ROUND N-1 BODY\n');
    runIntegrateBand(
      { initiativeId: INITIATIVE_ID, worktreePath: root, manifestPath: writeManifest(manifest({ class: 'docs' })), projectRepoPath: root },
      logger,
      GATES,
    );
    assert.ok(!readFileSync(join(root, PR_DESCRIPTION_REL), 'utf8').includes('STALE'));
  });

  it('kills "the gate evidence never reached the reviewer": the gate rows are in the PR body and the demo model', () => {
    writeProjectConfig([]);
    runIntegrateBand(
      { initiativeId: INITIATIVE_ID, worktreePath: root, manifestPath: writeManifest(manifest({ class: 'docs' })), projectRepoPath: root },
      logger,
      [{ gate: 'ci', cmd: ['npm', 'run', 'ci'], ok: false, outputTail: 'red' }],
    );
    assert.ok(readFileSync(join(root, PR_DESCRIPTION_REL), 'utf8').includes('npm run ci'));
    const demoJson = JSON.parse(readFileSync(join(root, 'demo', INITIATIVE_ID, 'demo.json'), 'utf8'));
    assert.deepEqual(demoJson.testEvidence, [{ name: 'ci: npm run ci', result: 'fail' }]);
  });
});

describe('integrate band — the class decides, and a class it cannot serve fails LOUD', () => {
  it('kills "a code initiative silently ships an empty demo": capture=checkpoints with no capture step is a config error', () => {
    writeProjectConfig([{ kind: 'verify', text: 'Read it back.' }]);
    const result = runIntegrateBand(
      { initiativeId: INITIATIVE_ID, worktreePath: root, manifestPath: writeManifest(), projectRepoPath: root },
      logger,
      GATES,
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.status === 'failed' ? result.reason : '', 'config-error');
    assert.ok(messages().includes('demo.config-error'), 'the config error is emitted, not swallowed');
    assert.ok(!existsSync(join(root, PR_DESCRIPTION_REL)), 'no PR body is written for a config error');
  });

  it('kills "docs work runs a code demo": a docs initiative needs no demoProcess and still completes', () => {
    writeProjectConfig([{ kind: 'verify', text: 'Read it back.' }]);
    const result = runIntegrateBand(
      { initiativeId: INITIATIVE_ID, worktreePath: root, manifestPath: writeManifest(manifest({ class: 'docs' })), projectRepoPath: root },
      logger,
      GATES,
    );
    assert.equal(result.status, 'complete');
  });

  it('kills "the class was never consulted": the derived event records the class and its capture column', () => {
    writeProjectConfig([]);
    runIntegrateBand(
      { initiativeId: INITIATIVE_ID, worktreePath: root, manifestPath: writeManifest(manifest({ class: 'config' })), projectRepoPath: root },
      logger,
      GATES,
    );
    const derived = events.find((e) => (e as { message?: string }).message === 'demo.input.derived');
    assert.equal((derived as { metadata?: Record<string, unknown> }).metadata?.change_class, 'config');
    assert.equal((derived as { metadata?: Record<string, unknown> }).metadata?.capture, 'none');
  });

  it('kills "a shell string is spawned": a capture step whose command needs a shell is a config error', () => {
    writeProjectConfig([{ kind: 'capture', text: 'Run `npm run demo | tee out.txt`.' }]);
    const result = runIntegrateBand(
      { initiativeId: INITIATIVE_ID, worktreePath: root, manifestPath: writeManifest(), projectRepoPath: root },
      logger,
      GATES,
    );
    assert.equal(result.status === 'failed' ? result.reason : '', 'config-error');
  });
});

describe('integrate band — a broken input is named, never guessed', () => {
  it('kills "a demo for a branch that changed nothing": an empty diff against main fails derive', () => {
    writeProjectConfig([]);
    git(['checkout', '-q', 'main']);
    git(['checkout', '-q', '-b', 'forge/EMPTY']);
    const result = runIntegrateBand(
      { initiativeId: INITIATIVE_ID, worktreePath: root, manifestPath: writeManifest(manifest({ class: 'docs' })), projectRepoPath: root },
      logger,
      GATES,
    );
    assert.equal(result.status === 'failed' ? result.reason : '', 'derive-failed');
    assert.ok(!existsSync(join(root, 'demo', INITIATIVE_ID)), 'nothing is written for a branch with no diff');
  });

  it('kills "an unreadable manifest reads as a class": a missing manifest fails derive, before any write', () => {
    writeProjectConfig([]);
    const result = runIntegrateBand(
      { initiativeId: INITIATIVE_ID, worktreePath: root, manifestPath: join(root, 'nope.md'), projectRepoPath: root },
      logger,
      GATES,
    );
    assert.equal(result.status === 'failed' ? result.reason : '', 'derive-failed');
    assert.ok(!existsSync(join(root, 'demo', INITIATIVE_ID)), 'nothing is written before the manifest is read');
  });
});
