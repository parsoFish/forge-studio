/**
 * fork-grounds.test.ts — T1 ruling 1350's gap-close: the own-ground drift
 * machinery must watch EVERY ground a fill fork mints, not only the base
 * `ground.project`. Before this, `story-s2-api`/`-cli`/`-webapp` (S2's own
 * per-case grounds, ruling (1)) were created and never hashed, licensed or
 * cleared — a fail-open shape no fence watched.
 *
 * `fork-grounds.mjs` reuses `ground-hash.mjs`/`ground-clear.mjs`'s own
 * primitives (never re-implements them) and loops them over the per-case
 * grounds; the base ground's own inline call in `run-story.mjs` is untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  perCaseGroundProjects,
  undeclaredForkGrounds,
  snapshotForkGrounds,
  judgeCaseGround,
  judgeForkGrounds,
} from './fork-grounds.mjs';
import { ownGroundManifest } from './ground-hash.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'fork-grounds-'));

/** A validated-shape S2-like story: one FILL fork beat over two starters. */
function fillForkStory(extra = {}) {
  return {
    id: 'S2',
    ground: { project: 'story-s2', realSpawn: true, budget_usd: 25 },
    beats: [
      {
        act: 'Create',
        say: 's',
        do: [{ fill: 'create-app-type', with: 'api' }],
        expect: { route: '/projects/story-s2', data: { 'project-id': 'story-s2' } },
        fork: { over: 'create-app-type', cases: ['api', 'cli'] },
      },
    ],
    ...extra,
  };
}

/** A DOOR fork — `over` names no fill step. Must mint no per-case ground. */
function doorForkStory() {
  return {
    id: 'S7',
    ground: { project: 'mdtoc', realSpawn: true, budget_usd: 25 },
    beats: [
      {
        act: 'Describe',
        say: 's',
        do: [{ fill: 'authoring-launcher-project', with: 'mdtoc' }],
        expect: { route: '/skills/new', data: { x: '1' } },
        fork: { over: 'authoring-door', cases: ['creation-agent', 'manual-form'] },
      },
    ],
  };
}

function noForkStory() {
  return {
    id: 'S1',
    ground: { project: 'gitpulse', realSpawn: false, budget_usd: 0 },
    beats: [{ act: 'a', say: 's', do: [], expect: { route: '/', data: { x: '1' } } }],
  };
}

// ────────────────────────────────────────────────────────── perCaseGroundProjects

test('perCaseGroundProjects names one ground per case, prefixed by the base project', () => {
  assert.deepEqual(perCaseGroundProjects(fillForkStory()), ['story-s2-api', 'story-s2-cli']);
});

test('perCaseGroundProjects is empty for a DOOR fork — it mints no per-case ground', () => {
  assert.deepEqual(perCaseGroundProjects(doorForkStory()), []);
});

test('perCaseGroundProjects is empty for a story with no fork at all', () => {
  assert.deepEqual(perCaseGroundProjects(noForkStory()), []);
});

// ───────────────────────────────────────────────────────────── undeclaredForkGrounds

test('undeclaredForkGrounds names a story-<id>-* ground that is NOT one of this run\'s declared cases', () => {
  const root = scratch();
  try {
    mkdirSync(join(root, 'projects', 'story-s2-api'), { recursive: true });   // declared
    mkdirSync(join(root, 'projects', 'story-s2-zzz'), { recursive: true });  // NOT declared
    const rogue = undeclaredForkGrounds(root, fillForkStory());
    assert.deepEqual(rogue, ['story-s2-zzz']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('undeclaredForkGrounds is empty when only declared cases are present', () => {
  const root = scratch();
  try {
    mkdirSync(join(root, 'projects', 'story-s2-api'), { recursive: true });
    mkdirSync(join(root, 'projects', 'story-s2-cli'), { recursive: true });
    assert.deepEqual(undeclaredForkGrounds(root, fillForkStory()), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('undeclaredForkGrounds never reaches a different story\'s namespace', () => {
  // story-s20 shares S2's prefix character-for-character up to the id, but the
  // trailing hyphen in the prefix (`story-s2-`) keeps it out — same guard as
  // the sweep's prefix bound.
  const root = scratch();
  try {
    mkdirSync(join(root, 'projects', 'story-s20'), { recursive: true });
    assert.deepEqual(undeclaredForkGrounds(root, fillForkStory()), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────── snapshotForkGrounds

test('snapshotForkGrounds reads null for every declared case before any of them exist', () => {
  const root = scratch();
  try {
    const snap = snapshotForkGrounds(root, fillForkStory());
    assert.deepEqual([...snap.keys()].sort(), ['story-s2-api', 'story-s2-cli']);
    assert.equal(snap.get('story-s2-api'), null);
    assert.equal(snap.get('story-s2-cli'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────────── judgeCaseGround

/** A real, git-initialised ground — `groundIgnoreFromGit` refuses outside one. */
function gitGround(root, project, files) {
  const dir = join(root, 'projects', project);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, contents] of Object.entries(files)) writeFileSync(join(dir, rel), contents);
}

test('judgeCaseGround: RED — a per-case ground drifting with no declaration is UNDECLARED', () => {
  const root = scratch();
  try {
    gitGround(root, 'story-s2-api', { 'README.md': 'seed\n' });
    const before = null; // absent before the run, exactly like the base ground's first-ever run
    writeFileSync(join(root, 'projects', 'story-s2-api', 'CLAUDE.md'), 'written by an agent\n');
    const logsDir = mkdtempSync(join(tmpdir(), 'fork-grounds-logs-'));
    const result = judgeCaseGround({
      root, project: 'story-s2-api', before, mintedPaths: [], logsDir,
      expectedChanges: [], beatWindowChanges: new Map(), storyId: 'S2', runStamp: '2026-01-01T00-00-00',
    });
    assert.ok(result.split.undeclared.length > 0, JSON.stringify(result.split));
    rmSync(logsDir, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('judgeCaseGround: a declared (whole-run) change is licensed, exactly as the base ground licenses one', () => {
  const root = scratch();
  try {
    gitGround(root, 'story-s2-api', {});
    const before = { digest: 'x', files: new Map() };
    writeFileSync(join(root, 'projects', 'story-s2-api', 'CLAUDE.md'), 'written by an agent\n');
    const logsDir = mkdtempSync(join(tmpdir(), 'fork-grounds-logs-'));
    const result = judgeCaseGround({
      root, project: 'story-s2-api', before, mintedPaths: [], logsDir,
      expectedChanges: [{ path: 'CLAUDE.md', change: 'added' }], beatWindowChanges: new Map(),
      storyId: 'S2', runStamp: '2026-01-01T00-00-00',
    });
    assert.deepEqual(result.split.undeclared, []);
    assert.equal(result.split.declared.length, 1);
    rmSync(logsDir, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────────── judgeForkGrounds

test('judgeForkGrounds: a story with no fork is a no-op — base-only behaviour is unchanged', () => {
  const root = scratch();
  try {
    const logsDir = mkdtempSync(join(tmpdir(), 'fork-grounds-logs-'));
    writeFileSync(join(logsDir, '.keep'), '');
    const result = judgeForkGrounds({
      root, story: noForkStory(), before: new Map(), logsBefore: [], logsDir,
      runStamp: '2026-01-01T00-00-00',
    });
    assert.deepEqual(result, { lines: [], redReason: null });
    rmSync(logsDir, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('judgeForkGrounds: RED — one fork case drifting outside its declared changes REDs the run', () => {
  const root = scratch();
  const logsDir = mkdtempSync(join(tmpdir(), 'fork-grounds-logs-'));
  try {
    const story = fillForkStory();
    const before = snapshotForkGrounds(root, story); // both null — neither case exists yet
    gitGround(root, 'story-s2-api', {});
    gitGround(root, 'story-s2-cli', {});
    writeFileSync(join(root, 'projects', 'story-s2-api', 'CLAUDE.md'), 'written by an agent\n'); // undeclared
    const result = judgeForkGrounds({ root, story, before, logsBefore: [], logsDir, runStamp: '2026-01-01T00-00-00' });
    assert.notEqual(result.redReason, null);
    assert.match(result.redReason, /CONTAINMENT FAILURE/);
    assert.match(result.redReason, /story-s2-api/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test('judgeForkGrounds: RED — an undeclared story-<id>-zzz ground REDs even with no drift inside it', () => {
  const root = scratch();
  const logsDir = mkdtempSync(join(tmpdir(), 'fork-grounds-logs-'));
  try {
    const story = fillForkStory();
    const before = snapshotForkGrounds(root, story);
    gitGround(root, 'story-s2-api', {});
    gitGround(root, 'story-s2-cli', {});
    mkdirSync(join(root, 'projects', 'story-s2-zzz'), { recursive: true }); // not a declared case
    const result = judgeForkGrounds({ root, story, before, logsBefore: [], logsDir, runStamp: '2026-01-01T00-00-00' });
    assert.notEqual(result.redReason, null);
    assert.match(result.redReason, /story-s2-zzz/);
    assert.match(result.redReason, /not one of this run's declared cases/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test('judgeForkGrounds: green when every declared case ground is clean', () => {
  const root = scratch();
  const logsDir = mkdtempSync(join(tmpdir(), 'fork-grounds-logs-'));
  try {
    const story = fillForkStory();
    gitGround(root, 'story-s2-api', { 'README.md': 'x\n' });
    gitGround(root, 'story-s2-cli', { 'README.md': 'x\n' });
    // Taken AFTER seeding, so the seed itself is not read as drift — mirrors
    // the base ground's own "before" being the pre-run hash.
    const before = new Map([
      ['story-s2-api', ownGroundManifest(root, 'story-s2-api')],
      ['story-s2-cli', ownGroundManifest(root, 'story-s2-cli')],
    ]);
    const result = judgeForkGrounds({ root, story, before, logsBefore: [], logsDir, runStamp: '2026-01-01T00-00-00' });
    assert.equal(result.redReason, null, result.redReason ?? '');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(logsDir, { recursive: true, force: true });
  }
});
