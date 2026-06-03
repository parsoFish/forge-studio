/**
 * Tests for orchestrator/cycle.ts internal helpers. Heavy SDK-dependent paths
 * (runProjectManager, runDeveloperLoop, runReviewer, runReflector) are
 * exercised by their respective benchmarks; this file covers the small
 * orchestration utilities the cycle uses for gates and routing — F-13
 * brain-first gate, F-11 status routing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { assertNonEmptyDelivery, recordBrainGateResult, snapshotCycleArtefacts } from './cycle.ts';
import { createLogger, type EventLogEntry } from './logging.ts';

function setupLogger(): { dir: string; logger: ReturnType<typeof createLogger>; cycleId: string } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cycle-test-'));
  const cycleId = 'TEST-cycle-2026-05-10';
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger(cycleId, logsDir);
  return { dir, logger, cycleId };
}

function readEvents(logger: ReturnType<typeof createLogger>): EventLogEntry[] {
  // The log file is created lazily on first emit; a code path that emits
  // nothing (e.g. assertNonEmptyDelivery on a non-empty branch) leaves no file.
  if (!existsSync(logger.logFilePath)) return [];
  const text = readFileSync(logger.logFilePath, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as EventLogEntry);
}

// ----- recordBrainGateResult -----

test('recordBrainGateResult: returns true and emits no event when brainReads > 0', () => {
  const { dir, logger } = setupLogger();
  try {
    const result = recordBrainGateResult('project-manager', 'project-manager', 1, {
      initiativeId: 'INIT-test',
      logger,
    });
    assert.equal(result, true);
    // No events emitted (brain consulted, gate passes silently).
    assert.ok(!existsSync(logger.logFilePath) || readEvents(logger).length === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordBrainGateResult: returns false and emits a brain-skipped error event when brainReads === 0', () => {
  const { dir, logger } = setupLogger();
  try {
    const result = recordBrainGateResult('project-manager', 'project-manager', 0, {
      initiativeId: 'INIT-test',
      logger,
    });
    assert.equal(result, false);
    const events = readEvents(logger);
    assert.equal(events.length, 1);
    assert.equal(events[0].phase, 'project-manager');
    assert.equal(events[0].skill, 'project-manager');
    assert.equal(events[0].event_type, 'error');
    assert.equal(events[0].message, 'project-manager.brain-skipped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordBrainGateResult: emits per-WI subject in metadata for dev-loop', () => {
  const { dir, logger } = setupLogger();
  try {
    const result = recordBrainGateResult('developer-loop', 'developer-ralph', 0, {
      initiativeId: 'INIT-test',
      logger,
      subject: 'WI-3',
    });
    assert.equal(result, false);
    const events = readEvents(logger);
    assert.equal(events.length, 1);
    assert.equal(events[0].message, 'developer-ralph.brain-skipped');
    assert.deepEqual(events[0].metadata, { subject: 'WI-3' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordBrainGateResult: parentEventId is propagated for child-event correlation', () => {
  const { dir, logger } = setupLogger();
  try {
    recordBrainGateResult('reflection', 'reflector', 0, {
      initiativeId: 'INIT-test',
      logger,
      parentEventId: 'EV_parent_123',
    });
    const events = readEvents(logger);
    assert.equal(events[0].parent_event_id, 'EV_parent_123');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ----- assertNonEmptyDelivery (DEV-1) -----

test('assertNonEmptyDelivery: throws and emits delivery-gate.empty-branch when 0 commits + 0 insertions', () => {
  const { dir, logger } = setupLogger();
  try {
    assert.throws(
      () =>
        assertNonEmptyDelivery(
          { commitsAhead: 0, filesChanged: 0, insertions: 0 },
          'INIT-empty',
          '/fake/worktree',
          logger,
        ),
      /zero-delivery/,
    );
    const events = readEvents(logger);
    const ev = events.find((e) => e.message === 'delivery-gate.empty-branch');
    assert.ok(ev, 'expected a delivery-gate.empty-branch error event');
    assert.equal(ev!.event_type, 'error');
    assert.equal(ev!.phase, 'orchestrator');
    assert.equal(ev!.initiative_id, 'INIT-empty');
    const md = ev!.metadata as Record<string, unknown>;
    assert.equal(md.failure_class, 'zero-delivery');
    assert.equal(md.commits_ahead, 0);
    assert.equal(md.insertions, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assertNonEmptyDelivery: does NOT throw when commitsAhead > 0 (non-empty branch)', () => {
  const { dir, logger } = setupLogger();
  try {
    assert.doesNotThrow(() =>
      assertNonEmptyDelivery(
        { commitsAhead: 3, filesChanged: 5, insertions: 42 },
        'INIT-nonempty',
        '/fake/worktree',
        logger,
      ),
    );
    // No error event emitted for a non-empty branch.
    const events = readEvents(logger);
    assert.equal(events.filter((e) => e.message === 'delivery-gate.empty-branch').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assertNonEmptyDelivery: does NOT throw when insertions > 0 even with 0 commitsAhead', () => {
  // Edge: a boundary commit may produce insertions without a separate WI commit.
  const { dir, logger } = setupLogger();
  try {
    assert.doesNotThrow(() =>
      assertNonEmptyDelivery(
        { commitsAhead: 0, filesChanged: 1, insertions: 10 },
        'INIT-insertions',
        '/fake/worktree',
        logger,
      ),
    );
    const events = readEvents(logger);
    assert.equal(events.filter((e) => e.message === 'delivery-gate.empty-branch').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// S4 deletion: the F-30 adaptive reviewer iteration cap tests are gone —
// `computeAdaptiveReviewIterationCap` was reviewer-internal logic that
// moves away with the Ralph-reviewer deletion. The new router-driven
// review phase doesn't iterate (the unifier owns iteration in S4 mode).

// ADR 021: snapshotCycleArtefacts mirrors the tracked demo bundle + the
// architect PLAN.html into _logs/<cycleId>/artifacts/ so the bridge can serve
// them to the in-UI review screen.
test('snapshotCycleArtefacts: mirrors demo.json + DEMO.html + PLAN.html into _logs/<cycleId>/artifacts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snap-test-'));
  const worktree = join(root, 'wt');
  const projectRepo = join(root, 'proj');
  const initiativeId = 'INIT-2026-05-30-snap';
  const cycleId = `TEST-snap-${process.pid}-${initiativeId}`;
  // tracked demo bundle in the worktree
  mkdirSync(join(worktree, 'demo', initiativeId), { recursive: true });
  writeFileSync(join(worktree, 'demo', initiativeId, 'demo.json'), '{"title":"t"}');
  writeFileSync(join(worktree, 'demo', initiativeId, 'DEMO.html'), '<html></html>');
  // architect session whose manifests/ holds this initiative
  mkdirSync(join(projectRepo, '_architect', 'sid1', 'manifests'), { recursive: true });
  writeFileSync(join(projectRepo, '_architect', 'sid1', 'manifests', `${initiativeId}.md`), '# manifest');
  writeFileSync(join(projectRepo, '_architect', 'sid1', 'PLAN.html'), '<html>plan</html>');

  const forgeRoot = resolve(import.meta.dirname, '..');
  const artifacts = join(forgeRoot, '_logs', cycleId, 'artifacts');
  try {
    await snapshotCycleArtefacts(
      { initiativeId, manifestPath: 'm', projectRepoPath: projectRepo, worktreePath: worktree },
      cycleId,
    );
    assert.ok(existsSync(join(artifacts, 'demo.json')), 'demo.json mirrored');
    assert.ok(existsSync(join(artifacts, 'DEMO.html')), 'DEMO.html mirrored');
    assert.ok(existsSync(join(artifacts, 'PLAN.html')), 'PLAN.html mirrored');
  } finally {
    rmSync(join(forgeRoot, '_logs', cycleId), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
