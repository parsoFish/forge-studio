/**
 * TDD: composedUnifierGate emits one structured unifier.gate.sub-check event
 * per sub-check (pass or fail). Tests drive the exported function directly,
 * following the delivery-and-disposable.test.ts git-harness pattern.
 *
 * Control flow reminder (short-circuit on first failure):
 *   1. initiative_gate  — runShellGate(qualityGateCmd)
 *   2. demo_runs_clean  — runShellGate(demoCommand), excused for shape "none"
 *   3. pr_self_contained — demo.json valid + pr-description.md present
 *   4. branches_in_sync — assertLocalRemoteSynced doesn't throw
 *   5. incomplete_delivery — all WI creates[] paths in git diff
 *
 * A failing sub-check aborts later ones, so a failure at gate N produces
 * exactly N sub-check events (no fabricated "skipped" events).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composedUnifierGate } from './developer-loop.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';

// ---------------------------------------------------------------------------
// Shared harness
// ---------------------------------------------------------------------------

/**
 * Build a minimal git repo wired up to an in-memory remote (bare clone) so
 * assertLocalRemoteSynced can verify that local HEAD == origin HEAD.
 *
 * Returns helpers for each test:
 *   - worktreePath: the local working copy
 *   - remoteUrl: the bare clone used as origin
 *   - git(…args): run git in worktreePath
 *   - logger / events(): the event logger + reader
 *   - cleanup()
 */
function unifierGateHarness(): {
  worktreePath: string;
  wiDir: string;
  logsDir: string;
  git: (...args: string[]) => string;
  logger: ReturnType<typeof createLogger>;
  events: () => EventLogEntry[];
  subCheckEvents: () => EventLogEntry[];
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'forge-ug-'));

  // 1. bare remote
  const remoteDir = join(dir, 'remote.git');
  mkdirSync(remoteDir, { recursive: true });
  execFileSync('git', ['init', '--bare', '-b', 'main', remoteDir], { stdio: 'pipe' });

  // 2. local clone
  const wt = join(dir, 'wt');
  execFileSync('git', ['clone', remoteDir, wt], { stdio: 'pipe' });

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' });

  git('config', 'user.email', 'test@forge.test');
  git('config', 'user.name', 'forge-test');

  // Baseline commit so main exists on remote
  writeFileSync(join(wt, 'README.md'), '# base\n');
  git('add', 'README.md');
  git('commit', '-m', 'base');
  git('push', 'origin', 'main');

  // Create the initiative branch
  git('checkout', '-b', 'forge/init-test');
  git('push', '--set-upstream', 'origin', 'forge/init-test');

  // 3. WI dir
  const wiDir = join(wt, '.forge', 'work-items');
  mkdirSync(wiDir, { recursive: true });

  // 4. logger
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-ug', logsDir);

  return {
    worktreePath: wt,
    wiDir,
    logsDir,
    git,
    logger,
    events: () =>
      readFileSync(logger.logFilePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as EventLogEntry),
    subCheckEvents: () => {
      const raw = readFileSync(logger.logFilePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as EventLogEntry);
      return raw.filter((e) => e.message === 'unifier.gate.sub-check');
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Write a minimal demo.json that passes validateDemoModel. */
function writeDemoJson(wt: string, initiativeId: string): void {
  const demoDir = join(wt, 'demo', initiativeId);
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(
    join(demoDir, 'demo.json'),
    JSON.stringify({
      title: 'Test demo',
      essence: 'Validates the unifier gate sub-check events.',
      project: 'test-project',
      diffStat: '2 files changed, 10 insertions(+)',
      checkpoints: [
        {
          label: 'Gate passes',
          caption: 'All five unifier sub-checks pass on a clean branch.',
        },
      ],
    }),
  );
}

/** Write a minimal valid pr-description.md with Why/What/How. */
function writePrDescription(wt: string): void {
  const forgeDir = join(wt, '.forge');
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(
    join(forgeDir, 'pr-description.md'),
    [
      '## Why',
      '',
      'We needed to add a new feature to support the initiative requirements and satisfy acceptance criteria.',
      '',
      '## What',
      '',
      '- Implemented the core logic module with full test coverage.',
      '- Added integration tests that verify end-to-end correctness.',
      '',
      '## How',
      '',
      'Follows the established project patterns (schema → expand/flatten → CRUD).',
      '',
    ].join('\n'),
  );
}

/** Write a minimal WI yaml with optional creates[] entries. */
function writeWI(wiDir: string, id: string, creates: string[]): void {
  const createsLines =
    creates.length > 0
      ? `creates:\n${creates.map((p) => `  - ${p}`).join('\n')}\n`
      : '';
  writeFileSync(
    join(wiDir, `${id}.md`),
    [
      '---',
      `work_item_id: ${id}`,
      'initiative_id: INIT-test',
      'status: pending',
      'acceptance_criteria:',
      '  - given: x',
      '    when: y',
      '    then: z',
      'files_in_scope: []',
      createsLines.trimEnd(),
      'quality_gate_cmd: ["true"]',
      'estimated_iterations: 1',
      'depends_on: []',
      '---',
      `# ${id}`,
      '',
    ]
      .filter((l) => l !== '')
      .join('\n') + '\n',
  );
}

const INITIATIVE_ID = 'INIT-test';
const BASE_INPUT = {
  initiativeId: INITIATIVE_ID,
  initiativeIdForEvent: INITIATIVE_ID,
  parentEventId: 'parent-evt-1',
  demoDir: `demo/${INITIATIVE_ID}`,
  // demoShape, demoCommand, qualityGateCmd, worktreePath, wiDir, logger
  // filled per-test
} as const;

// ---------------------------------------------------------------------------
// Happy path: all 5 gates pass → 5 sub-check events, all pass:true
// ---------------------------------------------------------------------------

test('composedUnifierGate happy-path: emits 5 sub-check events, all pass:true', async () => {
  const h = unifierGateHarness();
  try {
    writeDemoJson(h.worktreePath, INITIATIVE_ID);
    writePrDescription(h.worktreePath);
    // No WIs with creates[] → incomplete_delivery is exempt
    writeWI(h.wiDir, 'WI-1', []);

    // Stage + push so branches_in_sync passes
    h.git('add', '-A');
    h.git('commit', '-m', 'feat: add demo + pr-description');
    h.git('push', 'origin', 'forge/init-test');

    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      demoShape: 'none', // excuses demo_runs_clean
      demoCommand: undefined,
      logger: h.logger,
      workItemsDir: h.wiDir,
    });

    assert.equal(passed, true, 'gate should pass');

    const checks = h.subCheckEvents();
    assert.equal(checks.length, 5, `expected 5 sub-check events, got ${checks.length}`);

    const ids = checks.map((c) => (c.metadata as { check_id: string }).check_id);
    assert.deepEqual(ids, [
      'initiative_gate',
      'demo_runs_clean',
      'pr_self_contained',
      'branches_in_sync',
      'complete_delivery',
    ]);

    for (const ev of checks) {
      const meta = ev.metadata as { check_id: string; pass: boolean; detail: string };
      assert.equal(ev.event_type, 'log', `${meta.check_id}: event_type should be 'log'`);
      assert.equal(ev.message, 'unifier.gate.sub-check', `${meta.check_id}: message wrong`);
      assert.equal(meta.pass, true, `${meta.check_id}: expected pass:true`);
      assert.equal(typeof meta.detail, 'string', `${meta.check_id}: detail must be string`);
      assert.ok(meta.detail.length > 0, `${meta.check_id}: detail must be non-empty`);
    }
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// demo_runs_clean excused path: demoShape='none' → pass:true with excused detail
// ---------------------------------------------------------------------------

test('composedUnifierGate demo_runs_clean: excused (shape none) emits pass:true', async () => {
  const h = unifierGateHarness();
  try {
    writeDemoJson(h.worktreePath, INITIATIVE_ID);
    writePrDescription(h.worktreePath);
    h.git('add', '-A');
    h.git('commit', '-m', 'feat: setup');
    h.git('push', 'origin', 'forge/init-test');

    await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      demoShape: 'none',
      demoCommand: ['false'], // would fail if run — must be excused
      logger: h.logger,
      workItemsDir: h.wiDir,
    });

    const checks = h.subCheckEvents();
    const demoCheck = checks.find(
      (c) => (c.metadata as { check_id: string }).check_id === 'demo_runs_clean',
    );
    assert.ok(demoCheck, 'demo_runs_clean event must be emitted');
    const meta = demoCheck.metadata as { pass: boolean; detail: string };
    assert.equal(meta.pass, true);
    assert.match(meta.detail, /excused/i, 'detail should mention "excused"');
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Failure at gate 1 (initiative_gate): only 1 sub-check event emitted (fail)
// ---------------------------------------------------------------------------

test('composedUnifierGate initiative_gate fail: 1 sub-check event, pass:false, no later events', async () => {
  const h = unifierGateHarness();
  try {
    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['false'], // always fails
      demoShape: 'none',
      demoCommand: undefined,
      logger: h.logger,
      workItemsDir: h.wiDir,
    });

    assert.equal(passed, false);

    const checks = h.subCheckEvents();
    assert.equal(checks.length, 1, 'only initiative_gate should emit before short-circuit');

    const meta = checks[0]!.metadata as { check_id: string; pass: boolean; detail: string };
    assert.equal(meta.check_id, 'initiative_gate');
    assert.equal(meta.pass, false);
    assert.ok(meta.detail.length > 0, 'fail detail must be non-empty');
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Failure at gate 2 (demo_runs_clean): 2 sub-check events
// ---------------------------------------------------------------------------

test('composedUnifierGate demo_runs_clean fail: 2 sub-check events (gate1 pass, gate2 fail)', async () => {
  const h = unifierGateHarness();
  try {
    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],      // passes
      demoShape: 'harness',          // NOT none → demo gate runs
      demoCommand: ['false'],        // fails
      logger: h.logger,
      workItemsDir: h.wiDir,
    });

    assert.equal(passed, false);

    const checks = h.subCheckEvents();
    assert.equal(checks.length, 2, 'initiative_gate + demo_runs_clean should emit');

    const [g1, g2] = checks as [EventLogEntry, EventLogEntry];
    assert.equal((g1.metadata as { check_id: string }).check_id, 'initiative_gate');
    assert.equal((g1.metadata as { pass: boolean }).pass, true);

    assert.equal((g2.metadata as { check_id: string }).check_id, 'demo_runs_clean');
    assert.equal((g2.metadata as { pass: boolean }).pass, false);
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Failure at gate 3 (pr_self_contained): 3 sub-check events
// ---------------------------------------------------------------------------

test('composedUnifierGate pr_self_contained fail: 3 events (g1+g2 pass, g3 fail)', async () => {
  const h = unifierGateHarness();
  try {
    // No demo.json, no pr-description → pr_self_contained fails
    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      demoShape: 'none',        // demo_runs_clean excused → pass
      demoCommand: undefined,
      logger: h.logger,
      workItemsDir: h.wiDir,
    });

    assert.equal(passed, false);

    const checks = h.subCheckEvents();
    assert.equal(checks.length, 3, 'initiative_gate + demo_runs_clean + pr_self_contained');

    const ids = checks.map((c) => (c.metadata as { check_id: string }).check_id);
    assert.deepEqual(ids, ['initiative_gate', 'demo_runs_clean', 'pr_self_contained']);

    const g3meta = checks[2]!.metadata as { pass: boolean; detail: string };
    assert.equal(g3meta.pass, false);
    assert.ok(g3meta.detail.length > 0);
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Failure at gate 5 (incomplete_delivery): 5 events, last one fail
// ---------------------------------------------------------------------------

test('composedUnifierGate incomplete_delivery fail: 5 events, last pass:false with missing paths', async () => {
  const h = unifierGateHarness();
  try {
    writeDemoJson(h.worktreePath, INITIATIVE_ID);
    writePrDescription(h.worktreePath);

    // WI declares a path that is NOT in the diff
    writeWI(h.wiDir, 'WI-1', ['pkg/missing.go']);

    h.git('add', '-A');
    h.git('commit', '-m', 'feat: setup (no pkg/missing.go)');
    h.git('push', 'origin', 'forge/init-test');

    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      demoShape: 'none',
      demoCommand: undefined,
      logger: h.logger,
      workItemsDir: h.wiDir,
    });

    assert.equal(passed, false);

    const checks = h.subCheckEvents();
    assert.equal(checks.length, 5, 'all 5 gates should emit before delivery fails');

    const last = checks[4]!;
    const meta = last.metadata as { check_id: string; pass: boolean; detail: string };
    assert.equal(meta.check_id, 'complete_delivery');
    assert.equal(meta.pass, false);
    assert.match(meta.detail, /pkg\/missing\.go/, 'detail must list the missing path');
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Verify event shape: phase, skill, event_type, message fields
// ---------------------------------------------------------------------------

test('composedUnifierGate sub-check events have correct phase/skill/event_type/message', async () => {
  const h = unifierGateHarness();
  try {
    // Drive a gate-1 failure (minimal setup) — just need at least one event
    await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['false'],
      demoShape: 'none',
      demoCommand: undefined,
      logger: h.logger,
      workItemsDir: h.wiDir,
    });

    const checks = h.subCheckEvents();
    assert.ok(checks.length > 0, 'at least one sub-check event expected');

    for (const ev of checks) {
      assert.equal(ev.phase, 'unifier');
      assert.equal(ev.skill, 'developer-unifier');
      assert.equal(ev.event_type, 'log');
      assert.equal(ev.message, 'unifier.gate.sub-check');
      const meta = ev.metadata as Record<string, unknown>;
      assert.ok('check_id' in meta, 'metadata.check_id required');
      assert.ok('pass' in meta, 'metadata.pass required');
      assert.ok('detail' in meta, 'metadata.detail required');
    }
  } finally {
    h.cleanup();
  }
});
