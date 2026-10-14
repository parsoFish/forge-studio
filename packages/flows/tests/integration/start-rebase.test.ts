/**
 * Bead forge-mfv5.1.37 (R39) — a develop START that reuses a preserved
 * initiative branch (the Kickoff hand-off: `resume_from` unset, the
 * architect's worktree and branch kept) must rebase that branch onto the
 * project's main ONCE, before the first node runs — the same entry rebase a
 * resume gets (D-06, row 167), through the same `rebaseForResume`.
 *
 * Observed on capstone I3b (2026-10-14): its branch was cut while its
 * dependency I3a was unmerged; I3a then merged; the operator's Start ran the
 * dev loop on the pre-I3a base, because `runFlow` rebased only for the three
 * develop resume points and a Kickoff Start carries none.
 *
 * Fixture: real temp git repos with a LOCAL bare `origin` (no network) — the
 * dependency merges on origin while the project's local `main` stays stale,
 * which is the live shape (the dependency merged on GitHub).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger, type EventLogEntry } from '@forge/kernel';
import type { PhaseExecutor } from '@forge/kernel';
import { classifyCycleFailure } from '@forge/agents';
import type { FlowDefinition } from '@forge/contracts';

import { runFlow } from '../../flow-runner.ts';
import type { NodeExecContext } from '../../flow-node-context.ts';
import type { CycleInput } from '../../cycle-context.ts';
import { serializeManifest, type InitiativeManifest } from '../../manifest.ts';
import { rebaseForResume } from '../../cycle-helpers.ts';
import { errText, rebasePreservedBranchOntoMain } from '../../pr-branch-sync.ts';

const INITIATIVE = 'INIT-2026-10-14-start-rebase';
const BRANCH = `forge/${INITIATIVE}`;

type Git = (args: string[]) => string;
type Ground = { root: string; project: string; dependency: string; git: Git; gitIn: (cwd: string) => Git; cleanup: () => void };

const gitAt = (cwd: string): Git => (args) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).toString().trim();

function commitFile(git: Git, dir: string, file: string, body: string, msg: string): void {
  writeFileSync(join(dir, file), body);
  git(['add', '--', file]);
  git(['commit', '-q', '-m', msg]);
}

/** origin (bare) ← project clone, with the initiative branch cut at the base. */
function ground(): Ground {
  const root = mkdtempSync(join(tmpdir(), 'forge-start-rebase-'));
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const project = join(root, 'project');
  const dependency = join(root, 'dependency');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  const s = gitAt(seed);
  s(['config', 'user.email', 't@t']); s(['config', 'user.name', 't']);
  commitFile(s, seed, 'a.txt', 'base\n', 'base');
  s(['remote', 'add', 'origin', origin]);
  s(['push', '-q', 'origin', 'main']);
  execFileSync('git', ['clone', '-q', origin, project]);
  execFileSync('git', ['clone', '-q', origin, dependency]);
  for (const d of [project, dependency]) {
    gitAt(d)(['config', 'user.email', 't@t']);
    gitAt(d)(['config', 'user.name', 't']);
  }
  const git = gitAt(project);
  // The PM's hand-off: the initiative branch with one built commit, cut BEFORE the dependency merges.
  git(['checkout', '-q', '-b', BRANCH]);
  commitFile(git, project, 'b.txt', 'wi work\n', 'wi(WI-1): merge');
  return { root, project, dependency, git, gitIn: gitAt, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The dependency initiative merges on origin; the project's local main is NOT updated. */
function mergeDependencyOnOrigin(g: Ground, file = 'dep.txt', body = 'dependency merged\n'): string {
  const d = g.gitIn(g.dependency);
  commitFile(d, g.dependency, file, body, 'Merge dependency initiative');
  d(['push', '-q', 'origin', 'main']);
  return d(['rev-parse', 'HEAD']);
}

function fixtureFlow(): FlowDefinition {
  return {
    id: 'test-start-flow', name: 'Test Start Flow', version: 1,
    goal: 'a single-node fixture flow — the fixture never runs a real phase',
    project: null, kb: null, costCeilingUsd: 0, origin: 'seed', accepts: ['code'],
    nodes: [{ id: 'only-node' }], edges: [], triggers: [], path: '',
  };
}

function manifest(): InitiativeManifest {
  return {
    initiative_id: INITIATIVE, class: 'code', acceptance_criteria: [], project: 'fixture-project',
    project_repo_path: '/tmp/fixture-project', created_at: '2026-10-14T00:00:00Z', iteration_budget: 5,
    cost_budget_usd: 1, phase: 'pending', origin: 'architect', body: '# fixture',
  };
}

const neverCall = (name: string) => (): never => { throw new Error(`UNEXPECTED CALL: ${name}`); };

/** A run that emitted nothing has no log file yet — that is zero events, not an error. */
const readEvents = (path: string): EventLogEntry[] =>
  !existsSync(path) ? [] : readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);

const rebaseEvents = (events: EventLogEntry[]) =>
  events.filter((e) => e.phase === 'orchestrator' && typeof e.message === 'string' && e.message.startsWith('cycle.resume-'));

async function start(g: Ground, tag: string, extra: Partial<CycleInput>, onNode: () => void = () => {}) {
  const tmp = mkdtempSync(join(g.root, `run-${tag}-`));
  const manifestPath = join(tmp, 'manifest.md');
  writeFileSync(manifestPath, serializeManifest(manifest()));
  const logger = createLogger(`cyc-start-${tag}`, join(tmp, '_logs'));
  const executedNodes: string[] = [];
  const executor: PhaseExecutor<NodeExecContext> = {
    run: async (nodeId) => { executedNodes.push(nodeId); onNode(); return 'ready-for-review'; },
  };
  const input: CycleInput = {
    initiativeId: INITIATIVE, manifestPath, projectRepoPath: g.project, worktreePath: g.project,
    cycleId: `cyc-start-${tag}`, ...extra,
  };
  const run = runFlow({
    flow: fixtureFlow(), input, logger, executor,
    projectGate: { runPreflight: neverCall('runPreflight') },
    runClosure: neverCall('runClosure'), rebaseForResume,
  });
  return { run, executedNodes, events: () => readEvents(logger.logFilePath) };
}

test('Start (no resume_from) on a preserved branch cut before its dependency merged → the first node runs on a base containing the merge', async () => {
  const g = ground();
  try {
    const before = g.git(['rev-parse', 'HEAD']);
    const depSha = mergeDependencyOnOrigin(g);
    assert.notEqual(g.git(['rev-parse', 'main']), depSha, 'precondition: the project\'s local main is stale');

    const r = await start(g, 'stale', { reusesPreservedWorktree: true }, () => {
      assert.doesNotThrow(
        () => g.git(['merge-base', '--is-ancestor', depSha, 'HEAD']),
        'the dev loop must start on a base that contains the dependency\'s merge',
      );
    });
    await r.run;

    assert.deepEqual(r.executedNodes, ['only-node']);
    assert.ok(existsSync(join(g.project, 'dep.txt')), 'the dependency\'s file is in the worktree');
    const after = g.git(['rev-parse', 'HEAD']);
    const ev = rebaseEvents(r.events());
    assert.equal(ev.length, 1, 'exactly one entry rebase');
    assert.equal(ev[0].message, 'cycle.resume-rebased');
    assert.equal(ev[0].metadata?.entry, 'start');
    assert.equal(ev[0].metadata?.from_sha, before);
    assert.equal(ev[0].metadata?.to_sha, after);
    assert.equal(ev[0].metadata?.onto_sha, depSha);
    assert.equal(g.gitIn(join(g.root, 'origin.git'))(['rev-parse', BRANCH]), after, 'the rebased branch is published with lease');
  } finally {
    g.cleanup();
  }
});

test('Start no-op control: a preserved branch already on main → one no-op event, from_sha = to_sha, history untouched', async () => {
  const g = ground();
  try {
    const before = g.git(['rev-parse', 'HEAD']);
    const r = await start(g, 'noop', { reusesPreservedWorktree: true });
    await r.run;
    assert.equal(g.git(['rev-parse', 'HEAD']), before);
    const ev = rebaseEvents(r.events());
    assert.equal(ev.length, 1);
    assert.equal(ev[0].message, 'cycle.resume-no-rebase-needed');
    assert.equal(ev[0].metadata?.entry, 'start');
    assert.equal(ev[0].metadata?.from_sha, before);
    assert.equal(ev[0].metadata?.to_sha, before);
    assert.equal(ev[0].metadata?.rebased, false);
  } finally {
    g.cleanup();
  }
});

test('Start conflict control: the dependency conflicts → no node runs, terminal "rebase conflict onto <sha>", worktree and branch intact', async () => {
  const g = ground();
  try {
    commitFile(g.git, g.project, 'a.txt', 'branch change\n', 'wi edits a.txt');
    const before = g.git(['rev-parse', 'HEAD']);
    const depSha = mergeDependencyOnOrigin(g, 'a.txt', 'dependency change\n');

    const r = await start(g, 'conflict', { reusesPreservedWorktree: true });
    await assert.rejects(r.run, new RegExp(`rebase conflict onto ${depSha.slice(0, 12)}`));

    assert.deepEqual(r.executedNodes, [], 'never start the dev loop on a stale base');
    assert.equal(g.git(['rev-parse', 'HEAD']), before, 'the branch is left exactly as it was');
    assert.equal(g.git(['status', '--porcelain']), '', 'no half-applied rebase left in the worktree');
    assert.equal(g.git(['rev-parse', '--abbrev-ref', 'HEAD']), BRANCH);
    const ev = rebaseEvents(r.events());
    assert.equal(ev.length, 1);
    assert.equal(ev[0].message, 'cycle.resume-needs-rebase');
    assert.equal(ev[0].metadata?.entry, 'start');
    assert.equal(ev[0].metadata?.onto_sha, depSha);
    const cls = classifyCycleFailure(r.events());
    assert.equal(cls.kind, 'terminal');
    assert.match(cls.reason, new RegExp(`rebase conflict onto ${depSha.slice(0, 12)}`));
  } finally {
    g.cleanup();
  }
});

test('fresh-worktree control: no resume_from and no preserved worktree → no entry rebase (worktree.add already cut it from main)', async () => {
  const g = ground();
  try {
    const before = g.git(['rev-parse', 'HEAD']);
    mergeDependencyOnOrigin(g);
    const r = await start(g, 'fresh', {});
    await r.run;
    assert.equal(g.git(['rev-parse', 'HEAD']), before);
    assert.deepEqual(rebaseEvents(r.events()), []);
  } finally {
    g.cleanup();
  }
});

test('resume entry is labelled resume: resumeFrom "develop" emits entry:"resume" (D-06 once at re-entry unchanged)', async () => {
  const g = ground();
  try {
    mergeDependencyOnOrigin(g);
    const r = await start(g, 'resume', { resumeFrom: 'develop', reusesPreservedWorktree: true });
    await r.run;
    const ev = rebaseEvents(r.events());
    assert.equal(ev.length, 1, 'one rebase per entry, never two');
    assert.equal(ev[0].metadata?.entry, 'resume');
  } finally {
    g.cleanup();
  }
});

test('refusal: a preserved worktree checked out on main itself is refused by name — main is never rebased or pushed', () => {
  const g = ground();
  try {
    g.git(['checkout', '-q', 'main']);
    commitFile(g.git, g.project, 'local.txt', 'local only\n', 'local main commit');
    mergeDependencyOnOrigin(g);
    const before = g.git(['rev-parse', 'HEAD']);
    const originMain = g.gitIn(join(g.root, 'origin.git'))(['rev-parse', 'main']);
    const res = rebasePreservedBranchOntoMain(g.project);
    assert.equal(res.ok, false);
    assert.match(res.reason ?? '', /on main itself/);
    assert.equal(g.git(['rev-parse', 'HEAD']), before, 'local main untouched');
    assert.equal(g.gitIn(join(g.root, 'origin.git'))(['rev-parse', 'main']), originMain, 'origin main never pushed');
  } finally {
    g.cleanup();
  }
});

test('errText masks a credential embedded in a remote URL before it reaches an event', () => {
  const err = { stderr: "fatal: unable to access 'https://x-access-token:ghp_SECRET123@github.com/o/r.git/': 403" };
  const text = errText(err);
  assert.ok(!text.includes('ghp_SECRET123'), text);
  assert.match(text, /https:\/\/\*\*\*@github\.com/);
});

test('fail closed: origin present but unreachable → refused by name before any node, never a start on the stale local main', async () => {
  const g = ground();
  try {
    mergeDependencyOnOrigin(g);
    g.git(['remote', 'set-url', 'origin', join(g.root, 'no-such-origin.git')]);
    const before = g.git(['rev-parse', 'HEAD']);
    const r = await start(g, 'nofetch', { reusesPreservedWorktree: true });
    await assert.rejects(r.run, /could not fetch origin\/main/);
    assert.deepEqual(r.executedNodes, []);
    assert.equal(g.git(['rev-parse', 'HEAD']), before);
    const ev = rebaseEvents(r.events());
    assert.equal(ev.length, 1);
    assert.equal(ev[0].message, 'cycle.resume-needs-rebase');
    assert.equal(typeof ev[0].metadata?.fetch_error, 'string');
    const cls = classifyCycleFailure(r.events());
    assert.equal(cls.kind, 'terminal');
    assert.match(cls.reason, /could not fetch origin\/main/);
    assert.doesNotMatch(cls.reason, /rebase conflict/, 'a fetch failure is never reported as a conflict');
  } finally {
    g.cleanup();
  }
});

test('refusal: uncommitted tracked changes in the preserved worktree are named as such, never as a conflict', async () => {
  const g = ground();
  try {
    mergeDependencyOnOrigin(g);
    writeFileSync(join(g.project, 'a.txt'), 'uncommitted edit\n');
    const r = await start(g, 'dirty', { reusesPreservedWorktree: true });
    await assert.rejects(r.run, /uncommitted changes to tracked files/);
    assert.deepEqual(r.executedNodes, []);
    assert.equal(readFileSync(join(g.project, 'a.txt'), 'utf8'), 'uncommitted edit\n', 'the operator\'s edit is left in place');
    const cls = classifyCycleFailure(r.events());
    assert.match(cls.reason, /uncommitted changes/);
    assert.doesNotMatch(cls.reason, /rebase conflict/);
  } finally {
    g.cleanup();
  }
});
