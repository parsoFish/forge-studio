/**
 * TDD: composedUnifierGate emits one structured unifier.gate.sub-check event
 * per sub-check (pass or fail). Tests drive the exported function directly,
 * following the delivery-and-disposable.test.ts git-harness pattern.
 *
 * Control flow reminder (short-circuit on first failure):
 *   1. initiative_gate  — runShellGate(qualityGateCmd)
 *   2. pr_self_contained — demo.json valid + pr-description.md present
 *   3. demo_fanin_honesty — demo metadata matches post-fan-in reality (plan 2.5)
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
  existsSync,
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
  // qualityGateCmd, worktreePath, wiDir, logger filled per-test
} as const;

// ---------------------------------------------------------------------------
// Happy path: all 5 gates pass → 5 sub-check events, all pass:true
// (demo_fanin_honesty joined the composed gate — refinement plan 2.5)
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
      logger: h.logger,
      workItemsDir: h.wiDir,
    });

    assert.equal(passed, true, 'gate should pass');

    const checks = h.subCheckEvents();
    assert.equal(checks.length, 5, `expected 5 sub-check events, got ${checks.length}`);

    const ids = checks.map((c) => (c.metadata as { check_id: string }).check_id);
    assert.deepEqual(ids, [
      'initiative_gate',
      'pr_self_contained',
      'demo_fanin_honesty',
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
// Failure at gate 1 (initiative_gate): only 1 sub-check event emitted (fail)
// ---------------------------------------------------------------------------

test('composedUnifierGate initiative_gate fail: 1 sub-check event, pass:false, no later events', async () => {
  const h = unifierGateHarness();
  try {
    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['false'], // always fails
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
// Failure at gate 2 (pr_self_contained): 2 sub-check events
// ---------------------------------------------------------------------------

test('composedUnifierGate pr_self_contained fail: 2 events (g1 pass, g2 fail)', async () => {
  const h = unifierGateHarness();
  try {
    // No demo.json, no pr-description → pr_self_contained fails
    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      logger: h.logger,
      workItemsDir: h.wiDir,
    });

    assert.equal(passed, false);

    const checks = h.subCheckEvents();
    assert.equal(checks.length, 2, 'initiative_gate + pr_self_contained');

    const ids = checks.map((c) => (c.metadata as { check_id: string }).check_id);
    assert.deepEqual(ids, ['initiative_gate', 'pr_self_contained']);

    const g2meta = checks[1]!.metadata as { pass: boolean; detail: string };
    assert.equal(g2meta.pass, false);
    assert.ok(g2meta.detail.length > 0);
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Failure at the terminal gate (incomplete_delivery): 5 events, last one fail
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

// ---------------------------------------------------------------------------
// N10 (2026-07): initiative gate TIMEOUT → distinct unifier.gate.timeout event
// classified as ENVIRONMENT failure, never work-failure / broken-gate.
// ---------------------------------------------------------------------------

test('composedUnifierGate initiative gate TIMEOUT: unifier.gate.timeout event with environment classification', async () => {
  const h = unifierGateHarness();
  try {
    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['sleep', '30'],
      gateTimeoutMs: 300,
      logger: h.logger,
      workItemsDir: h.wiDir,
    });
    assert.equal(passed, false);

    const timeouts = h.events().filter((e) => e.message === 'unifier.gate.timeout');
    assert.equal(timeouts.length, 1, 'expected exactly one unifier.gate.timeout event');
    const md = timeouts[0]!.metadata as Record<string, unknown>;
    assert.equal(md.gate_timed_out, true);
    assert.equal(md.failure_kind, 'environment');
    assert.equal(md.failure_class, 'dev-loop-unifier-gate-timeout');

    // No unifier.gate.initiative-failed / unifier.gate.errored mis-classification.
    assert.equal(h.events().filter((e) => e.message === 'unifier.gate.initiative-failed').length, 0);
    assert.equal(h.events().filter((e) => e.message === 'unifier.gate.errored').length, 0);
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Live-gate-feedback seam for the unifier (design step 2): the orchestrator's
// own gate result is persisted to .forge/last-gate-failure.md for the next
// agent iteration, and DELETED when the composed gate passes.
// ---------------------------------------------------------------------------

test('composedUnifierGate failure writes .forge/last-gate-failure.md for the next iteration', async () => {
  const h = unifierGateHarness();
  try {
    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['false'],
      logger: h.logger,
      workItemsDir: h.wiDir,
    });
    assert.equal(passed, false);
    const fb = join(h.worktreePath, '.forge', 'last-gate-failure.md');
    assert.ok(existsSync(fb), 'gate failure must persist feedback for the next iteration');
    const body = readFileSync(fb, 'utf8');
    assert.match(body, /initiative_gate/);
  } finally {
    h.cleanup();
  }
});

test('composedUnifierGate pass DELETES a stale .forge/last-gate-failure.md', async () => {
  const h = unifierGateHarness();
  try {
    writeDemoJson(h.worktreePath, INITIATIVE_ID);
    writePrDescription(h.worktreePath);
    writeWI(h.wiDir, 'WI-1', []);
    h.git('add', '-A');
    h.git('commit', '-m', 'feat: add demo + pr-description');
    h.git('push', 'origin', 'forge/init-test');

    // A stale feedback file from a prior failed evaluation.
    mkdirSync(join(h.worktreePath, '.forge'), { recursive: true });
    writeFileSync(join(h.worktreePath, '.forge', 'last-gate-failure.md'), '# stale\n');

    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      logger: h.logger,
      workItemsDir: h.wiDir,
    });
    assert.equal(passed, true);
    assert.ok(
      !existsSync(join(h.worktreePath, '.forge', 'last-gate-failure.md')),
      'a passing composed gate must remove the stale feedback file',
    );
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// N1 — orchestrator-owned demo capture: when demo.json carries command
// checkpoints, the ORCHESTRATOR (not the agent) spawns the capture runner in
// the worktree, records its output as events, and commits what it produced.
// ---------------------------------------------------------------------------

/** demo.json with a command checkpoint (the orchestrated-capture trigger). */
function writeDemoJsonWithCommand(wt: string, initiativeId: string): void {
  const demoDir = join(wt, 'demo', initiativeId);
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(
    join(demoDir, 'demo.json'),
    JSON.stringify({
      title: 'Test demo',
      essence: 'Validates orchestrator-owned capture.',
      project: 'test-project',
      diffStat: '2 files changed, 10 insertions(+)',
      checkpoints: [
        {
          label: 'CLI output',
          caption: 'Real stdout captured by the orchestrator.',
          command: 'echo hello',
        },
      ],
    }),
  );
}

test('composedUnifierGate spawns the orchestrated capture in the worktree and records events (N1)', async () => {
  const h = unifierGateHarness();
  try {
    writeDemoJsonWithCommand(h.worktreePath, INITIATIVE_ID);
    writePrDescription(h.worktreePath);
    writeWI(h.wiDir, 'WI-1', []);
    h.git('add', '-A');
    h.git('commit', '-m', 'feat: add demo + pr-description');
    h.git('push', 'origin', 'forge/init-test');

    // Fake capture runner standing in for `forge demo capture`: proves cwd is
    // the worktree and produces a derived artifact the orchestrator commits.
    const script = join(h.worktreePath, 'fake-capture.sh');
    writeFileSync(
      script,
      '#!/bin/bash\npwd > captured-cwd.txt\necho "captured" > demo/INIT-test/DEMO.md\necho done\n',
      { mode: 0o755 },
    );

    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      logger: h.logger,
      workItemsDir: h.wiDir,
      orchestratedCapture: { argv: ['bash', 'fake-capture.sh'], timeoutMs: 10_000 },
    });
    assert.equal(passed, true, 'gate should pass after orchestrated capture');

    // The child ran with cwd = the worktree.
    const cwdMarker = join(h.worktreePath, 'captured-cwd.txt');
    assert.ok(existsSync(cwdMarker), 'capture child must run in the worktree');

    // Structured event: command + exit code + output tail.
    const captureEvents = h.events().filter((e) => e.message === 'unifier.demo-capture');
    assert.equal(captureEvents.length, 1);
    const md = captureEvents[0]!.metadata as Record<string, unknown>;
    assert.equal(md.exit_code, 0);
    assert.equal(md.capture_ok, true);
    assert.match(String(md.command), /fake-capture\.sh/);
    assert.match(String(md.stdout_tail), /done/);

    // The orchestrator committed (and pushed) the capture-produced artifacts,
    // so branches_in_sync still holds and the evidence is ON the branch. (A
    // demo-metadata refresh commit may follow it — plan 2.5 — so scan the log.)
    const log = execFileSync('git', ['log', '--oneline', '-3'], { cwd: h.worktreePath, encoding: 'utf8' });
    assert.match(log, /orchestrated demo capture/i);
  } finally {
    h.cleanup();
  }
});

test('composedUnifierGate skips orchestrated capture when no checkpoint wants it', async () => {
  const h = unifierGateHarness();
  try {
    writeDemoJson(h.worktreePath, INITIATIVE_ID); // notes-only checkpoint, no command
    writePrDescription(h.worktreePath);
    writeWI(h.wiDir, 'WI-1', []);
    h.git('add', '-A');
    h.git('commit', '-m', 'feat: add demo + pr-description');
    h.git('push', 'origin', 'forge/init-test');

    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      logger: h.logger,
      workItemsDir: h.wiDir,
      orchestratedCapture: { argv: ['bash', '-c', 'exit 1'], timeoutMs: 10_000 },
    });
    assert.equal(passed, true);
    assert.equal(h.events().filter((e) => e.message === 'unifier.demo-capture').length, 0);
  } finally {
    h.cleanup();
  }
});

test('composedUnifierGate orchestrated capture TIMEOUT is best-effort: recorded as environment, gate proceeds', async () => {
  const h = unifierGateHarness();
  try {
    writeDemoJsonWithCommand(h.worktreePath, INITIATIVE_ID);
    writePrDescription(h.worktreePath);
    writeWI(h.wiDir, 'WI-1', []);
    h.git('add', '-A');
    h.git('commit', '-m', 'feat: add demo + pr-description');
    h.git('push', 'origin', 'forge/init-test');

    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      logger: h.logger,
      workItemsDir: h.wiDir,
      orchestratedCapture: { argv: ['sleep', '30'], timeoutMs: 300 },
    });
    assert.equal(passed, true, 'capture is best-effort — a timeout must not block the gate');

    const captureEvents = h.events().filter((e) => e.message === 'unifier.demo-capture');
    assert.equal(captureEvents.length, 1);
    const md = captureEvents[0]!.metadata as Record<string, unknown>;
    assert.equal(md.capture_ok, false);
    assert.equal(md.timed_out, true);
    assert.equal(md.failure_kind, 'environment');
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Plan 2.5 — demo fan-in honesty inside the composed gate.
// Stale liveEvidence ids fail HONESTLY (specific event + feedback); stale
// diffStat is mechanical git metadata and is refreshed + committed in place.
// ---------------------------------------------------------------------------

/** demo.json embedding a liveEvidence url (schema-valid). */
function writeDemoJsonWithLiveEvidence(wt: string, initiativeId: string, url: string): void {
  const demoDir = join(wt, 'demo', initiativeId);
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(
    join(demoDir, 'demo.json'),
    JSON.stringify({
      title: 'Test demo',
      essence: 'Live-evidence identity check.',
      project: 'test-project',
      diffStat: '2 files changed, 10 insertions(+)',
      checkpoints: [
        {
          label: 'acceptance-resource',
          kind: 'harness',
          caption: 'Live resource GET',
          liveEvidence: { url },
        },
      ],
    }),
  );
}

test('composedUnifierGate stale liveEvidence id: demo_fanin_honesty fails with specific event, feedback + gate-failure callback', async () => {
  const h = unifierGateHarness();
  try {
    writeDemoJsonWithLiveEvidence(
      h.worktreePath,
      INITIATIVE_ID,
      'https://dev.azure.com/org/_apis/notification/subscriptions/886543',
    );
    writePrDescription(h.worktreePath);
    writeWI(h.wiDir, 'WI-1', []);
    h.git('add', '-A');
    h.git('commit', '-m', 'feat: add demo + pr-description');
    h.git('push', 'origin', 'forge/init-test');

    // The CURRENT (orchestrator-run) acceptance gate persisted a NEWER resource.
    const evDir = join(h.worktreePath, '.forge', 'live-evidence');
    mkdirSync(evDir, { recursive: true });
    writeFileSync(
      join(evDir, 'acceptance-resource.json'),
      JSON.stringify({
        label: 'acceptance-resource',
        url: 'https://dev.azure.com/org/_apis/notification/subscriptions/886548',
      }),
    );

    const failures: Array<{ checkId: string; outputTail: string }> = [];
    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      logger: h.logger,
      workItemsDir: h.wiDir,
      onGateFailure: (f) => failures.push({ checkId: f.checkId, outputTail: f.outputTail }),
    });
    assert.equal(passed, false, 'a demo asserting a stale resource id must NOT pass');

    // Sub-check trail: initiative_gate ✓, pr_self_contained ✓ (schema-valid),
    // demo_fanin_honesty ✗ — then short-circuit.
    const checks = h.subCheckEvents();
    const ids = checks.map((c) => (c.metadata as { check_id: string }).check_id);
    assert.deepEqual(ids, ['initiative_gate', 'pr_self_contained', 'demo_fanin_honesty']);
    const lastMeta = checks[2]!.metadata as { pass: boolean; detail: string };
    assert.equal(lastMeta.pass, false);
    assert.match(lastMeta.detail, /886543/, 'sub-check detail names the stale id');

    // The specific classified error event (never a vague fail).
    const staleEvents = h
      .events()
      .filter((e) => e.message?.startsWith('unifier.gate.demo-stale-after-fanin'));
    assert.equal(staleEvents.length, 1);
    assert.equal(staleEvents[0]!.event_type, 'error');
    const md = staleEvents[0]!.metadata as Record<string, unknown>;
    assert.equal(md.failure_class, 'dev-loop-unifier-demo-stale');
    assert.match(JSON.stringify(md.stale_evidence), /886543/);
    assert.match(JSON.stringify(md.fresh_evidence_urls), /886548/);
    assert.ok(staleEvents[0]!.message?.includes('demo.json'), 'message keeps the demo.json classifier token');

    // Live-gate feedback tells the agent EXACTLY what went stale + the fix.
    const fb = join(h.worktreePath, '.forge', 'last-gate-failure.md');
    assert.ok(existsSync(fb), 'last-gate-failure.md written');
    const fbText = readFileSync(fb, 'utf8');
    assert.match(fbText, /886543/);
    assert.match(fbText, /886548/);
    assert.match(fbText, /forge demo render/);

    // G4 seam: the loop-cap tracker sees the dedicated check id.
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.checkId, 'demo_fanin_honesty');
    assert.match(failures[0]!.outputTail, /886543/);
  } finally {
    h.cleanup();
  }
});

test('composedUnifierGate stale diffStat: refreshed with git truth, committed, unifier.demo-metadata-refreshed emitted, gate passes', async () => {
  const h = unifierGateHarness();
  try {
    writeDemoJson(h.worktreePath, INITIATIVE_ID); // stored diffStat: "2 files changed…"
    writePrDescription(h.worktreePath);
    writeWI(h.wiDir, 'WI-1', []);
    h.git('add', '-A');
    h.git('commit', '-m', 'feat: add demo + pr-description');
    h.git('push', 'origin', 'forge/init-test');
    // Real diff main…HEAD now spans ≥3 files — the stored "2 files changed" is
    // pre-fan-in metadata.

    const passed = await composedUnifierGate({
      ...BASE_INPUT,
      worktreePath: h.worktreePath,
      qualityGateCmd: ['true'],
      logger: h.logger,
      workItemsDir: h.wiDir,
    });
    assert.equal(passed, true, 'a refreshable metadata drift must not fail the gate');

    const refreshEvents = h.events().filter((e) => e.message === 'unifier.demo-metadata-refreshed');
    assert.equal(refreshEvents.length, 1);
    const md = refreshEvents[0]!.metadata as Record<string, unknown>;
    assert.match(String(md.from), /2 files changed/);
    assert.match(String(md.to), /files changed/);

    // demo.json on the branch carries the re-derived git truth…
    const realStat = execFileSync('git', ['diff', '--stat', 'main...HEAD'], {
      cwd: h.worktreePath,
      encoding: 'utf8',
    }).trim();
    const demoJson = JSON.parse(
      readFileSync(join(h.worktreePath, 'demo', INITIATIVE_ID, 'demo.json'), 'utf8'),
    ) as { diffStat: string };
    assert.match(demoJson.diffStat, /files changed/);
    assert.notEqual(demoJson.diffStat, '2 files changed, 10 insertions(+)');
    // …and the refresh is COMMITTED (branches_in_sync passed after it).
    const status = execFileSync('git', ['status', '--porcelain', '--', 'demo/'], {
      cwd: h.worktreePath,
      encoding: 'utf8',
    }).trim();
    assert.equal(status, '', 'refreshed demo artifacts are committed, not left dirty');
    const log = execFileSync('git', ['log', '--oneline', '-2'], { cwd: h.worktreePath, encoding: 'utf8' });
    assert.match(log, /refresh demo metadata after fan-in/i);
    assert.ok(realStat.length > 0);
  } finally {
    h.cleanup();
  }
});
