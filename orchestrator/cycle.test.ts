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

import {
  assertNonEmptyDelivery,
  decideFinalCiGate,
  execCommandVector,
  recordBrainGateResult,
  resolveCostCeilingOverride,
  resolveCiTimeoutMs,
  runCycle,
  snapshotCycleArtefacts,
  type CiCommandRunner,
} from './cycle.ts';
import { createLogger, type EventLogEntry } from './logging.ts';
import { serializeManifest, DERIVED_CEILING_MARGIN_USD, type InitiativeManifest } from './manifest.ts';

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

// ----- resolveCostCeilingOverride (per-run cost ceiling precedence) -----

function writeManifestWithCeiling(ceiling: number | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-ceiling-'));
  const m: InitiativeManifest = {
    initiative_id: 'INIT-2026-06-19-ceiling',
    project: 'demo',
    project_repo_path: '/tmp/demo',
    created_at: '2026-06-19T00:00:00Z',
    iteration_budget: 50,
    cost_budget_usd: 25,
    phase: 'pending',
    origin: 'architect',
    body: '# body',
    ...(ceiling !== undefined ? { cost_ceiling_usd: ceiling } : {}),
  };
  const path = join(dir, 'manifest.md');
  writeFileSync(path, serializeManifest(m));
  return path;
}

test('resolveCostCeilingOverride: env wins over manifest', () => {
  const path = writeManifestWithCeiling(120);
  const prev = process.env.FORGE_COST_CEILING_USD;
  process.env.FORGE_COST_CEILING_USD = '200';
  try {
    assert.equal(resolveCostCeilingOverride(path), 200);
  } finally {
    if (prev === undefined) delete process.env.FORGE_COST_CEILING_USD;
    else process.env.FORGE_COST_CEILING_USD = prev;
  }
});

test('resolveCostCeilingOverride: falls back to manifest when env unset', () => {
  const path = writeManifestWithCeiling(120);
  const prev = process.env.FORGE_COST_CEILING_USD;
  delete process.env.FORGE_COST_CEILING_USD;
  try {
    assert.equal(resolveCostCeilingOverride(path), 120);
  } finally {
    if (prev !== undefined) process.env.FORGE_COST_CEILING_USD = prev;
  }
});

test('resolveCostCeilingOverride: derives cost_budget_usd + margin when ceiling unset; bad env ignored', () => {
  const path = writeManifestWithCeiling(undefined); // fixture carries cost_budget_usd: 25
  const derived = 25 + DERIVED_CEILING_MARGIN_USD;
  const prev = process.env.FORGE_COST_CEILING_USD;
  delete process.env.FORGE_COST_CEILING_USD;
  try {
    assert.equal(resolveCostCeilingOverride(path), derived);
    process.env.FORGE_COST_CEILING_USD = 'not-a-number';
    assert.equal(resolveCostCeilingOverride(path), derived);
    process.env.FORGE_COST_CEILING_USD = '-5';
    assert.equal(resolveCostCeilingOverride(path), derived);
    assert.equal(resolveCostCeilingOverride('/nonexistent/manifest.md'), undefined);
  } finally {
    if (prev === undefined) delete process.env.FORGE_COST_CEILING_USD;
    else process.env.FORGE_COST_CEILING_USD = prev;
  }
});

// ----- resolveCiTimeoutMs (env-overridable CI gate/fix timeouts) -----

test('resolveCiTimeoutMs: defaults are 20min gate / 5min fix', () => {
  const prevG = process.env.FORGE_CI_GATE_TIMEOUT_MS, prevF = process.env.FORGE_CI_FIX_TIMEOUT_MS;
  delete process.env.FORGE_CI_GATE_TIMEOUT_MS; delete process.env.FORGE_CI_FIX_TIMEOUT_MS;
  try {
    assert.equal(resolveCiTimeoutMs('gate'), 20 * 60_000);
    assert.equal(resolveCiTimeoutMs('fix'), 5 * 60_000);
  } finally {
    if (prevG !== undefined) process.env.FORGE_CI_GATE_TIMEOUT_MS = prevG;
    if (prevF !== undefined) process.env.FORGE_CI_FIX_TIMEOUT_MS = prevF;
  }
});

test('resolveCiTimeoutMs: env overrides the gate timeout; bad values ignored', () => {
  const prev = process.env.FORGE_CI_GATE_TIMEOUT_MS;
  try {
    process.env.FORGE_CI_GATE_TIMEOUT_MS = '2400000';
    assert.equal(resolveCiTimeoutMs('gate'), 2_400_000);
    process.env.FORGE_CI_GATE_TIMEOUT_MS = 'nope';
    assert.equal(resolveCiTimeoutMs('gate'), 20 * 60_000);
    process.env.FORGE_CI_GATE_TIMEOUT_MS = '-1';
    assert.equal(resolveCiTimeoutMs('gate'), 20 * 60_000);
  } finally {
    if (prev === undefined) delete process.env.FORGE_CI_GATE_TIMEOUT_MS;
    else process.env.FORGE_CI_GATE_TIMEOUT_MS = prev;
  }
});

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

// ----- decideFinalCiGate (final CI delivery gate) -----

/**
 * Build a stub CiCommandRunner that records every invocation and returns a
 * canned ok/output per `kind`. No real process is spawned — the test never
 * runs `make test`.
 */
function stubRunner(
  results: { fix?: { ok: boolean; output?: string }; gate: { ok: boolean; output?: string } },
): { run: CiCommandRunner; calls: Array<{ cmd: string[]; kind: 'fix' | 'gate' }> } {
  const calls: Array<{ cmd: string[]; kind: 'fix' | 'gate' }> = [];
  const run: CiCommandRunner = (cmd, _wt, kind) => {
    calls.push({ cmd, kind });
    const r = kind === 'fix' ? results.fix ?? { ok: true } : results.gate;
    return { ok: r.ok, output: r.output ?? '' };
  };
  return { run, calls };
}

test('decideFinalCiGate: ci_gate green → gateOk true, fixer ran first', () => {
  const { run, calls } = stubRunner({ fix: { ok: true }, gate: { ok: true, output: 'PASS' } });
  const decision = decideFinalCiGate({
    ciGate: ['bash', '-c', 'make test && lint'],
    ciFixCmd: ['bash', '-c', 'make fmt'],
    worktreePath: '/fake/wt',
    run,
  });
  assert.ok(decision);
  assert.equal(decision.gateOk, true);
  assert.equal(decision.ranFixer, true);
  // fixer runs before the gate.
  assert.deepEqual(calls.map((c) => c.kind), ['fix', 'gate']);
});

test('decideFinalCiGate: ci_gate red → gateOk false with output (caller throws ci-gate-failed)', () => {
  const { run } = stubRunner({ gate: { ok: false, output: 'gofmt: file.go needs formatting' } });
  const decision = decideFinalCiGate({
    ciGate: ['bash', '-c', 'make test && lint'],
    ciFixCmd: null,
    worktreePath: '/fake/wt',
    run,
  });
  assert.ok(decision);
  assert.equal(decision.gateOk, false);
  assert.match(decision.gateOutput, /gofmt/);
});

test('decideFinalCiGate: no ci_gate configured → null (gate skipped, no PR block)', () => {
  const { run, calls } = stubRunner({ gate: { ok: true } });
  assert.equal(
    decideFinalCiGate({ ciGate: null, ciFixCmd: ['x'], worktreePath: '/fake/wt', run }),
    null,
  );
  assert.equal(
    decideFinalCiGate({ ciGate: [], ciFixCmd: null, worktreePath: '/fake/wt', run }),
    null,
  );
  // No commands run when there is no gate.
  assert.equal(calls.length, 0);
});

test('decideFinalCiGate: a throwing fixer does not block — gate still decides', () => {
  const calls: Array<'fix' | 'gate'> = [];
  const run: CiCommandRunner = (_cmd, _wt, kind) => {
    calls.push(kind);
    if (kind === 'fix') throw new Error('formatter crashed');
    return { ok: true, output: 'PASS' };
  };
  const decision = decideFinalCiGate({
    ciGate: ['bash', '-c', 'make test'],
    ciFixCmd: ['bash', '-c', 'make fmt'],
    worktreePath: '/fake/wt',
    run,
  });
  assert.ok(decision);
  assert.equal(decision.gateOk, true);
  // ranFixer stays false because the fixer threw, but the gate still ran.
  assert.equal(decision.ranFixer, false);
  assert.deepEqual(calls, ['fix', 'gate']);
});

test('decideFinalCiGate: no ci_fix_cmd → gate runs without a fixer pass', () => {
  const { run, calls } = stubRunner({ gate: { ok: true } });
  const decision = decideFinalCiGate({
    ciGate: ['bash', '-c', 'make test'],
    ciFixCmd: null,
    worktreePath: '/fake/wt',
    run,
  });
  assert.ok(decision);
  assert.equal(decision.ranFixer, false);
  assert.deepEqual(calls.map((c) => c.kind), ['gate']);
});

test('decideFinalCiGate: unsetEnv is passed to BOTH the fixer and the gate (A3 TF_ACC isolation)', () => {
  // The CI delivery gate must mirror GitHub CI: stripping TF_ACC so `make test`
  // does NOT run the live acceptance suite even though the serve env set it for
  // the per-WI live gates.
  const seen: Array<{ kind: 'fix' | 'gate'; unsetEnv?: string[] }> = [];
  const run: CiCommandRunner = (_cmd, _wt, kind, unsetEnv) => {
    seen.push({ kind, unsetEnv });
    return { ok: true, output: 'PASS' };
  };
  const decision = decideFinalCiGate({
    ciGate: ['bash', '-c', 'make test'],
    ciFixCmd: ['bash', '-c', 'make fmt'],
    worktreePath: '/fake/wt',
    run,
    unsetEnv: ['TF_ACC'],
  });
  assert.ok(decision);
  assert.equal(decision.gateOk, true);
  assert.deepEqual(seen, [
    { kind: 'fix', unsetEnv: ['TF_ACC'] },
    { kind: 'gate', unsetEnv: ['TF_ACC'] },
  ]);
});

test('execCommandVector: strips the named env var from the child process (A3, real spawn)', () => {
  const prev = process.env.TF_ACC;
  process.env.TF_ACC = '1';
  try {
    // Without stripping, the child sees TF_ACC=1 (inherited).
    const inherited = execCommandVector(['bash', '-c', 'echo "TFACC=[$TF_ACC]"'], '/tmp', 'gate');
    assert.match(inherited.output, /TFACC=\[1\]/);
    // With unsetEnv, TF_ACC is absent in the child → empty expansion.
    const stripped = execCommandVector(
      ['bash', '-c', 'echo "TFACC=[$TF_ACC]"'],
      '/tmp',
      'gate',
      ['TF_ACC'],
    );
    assert.match(stripped.output, /TFACC=\[\]/);
    assert.equal(stripped.ok, true);
  } finally {
    if (prev === undefined) delete process.env.TF_ACC;
    else process.env.TF_ACC = prev;
  }
});


// S4 deletion: the F-30 adaptive reviewer iteration cap tests are gone —
// `computeAdaptiveReviewIterationCap` was reviewer-internal logic that
// moves away with the Ralph-reviewer deletion. The new router-driven
// review phase doesn't iterate (the unifier owns iteration in S4 mode).

// P4: architect events emitted from real manifest fields at cycle start.

/** Build a minimal valid InitiativeManifest fixture for cycle tests. */
function cycleManifestFixture(extra: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-06-08-p4test',
    project: 'test-project',
    project_repo_path: '/tmp/test-project',
    created_at: '2026-06-08T00:00:00Z',
    iteration_budget: 3,
    cost_budget_usd: 2,
    phase: 'pending',
    origin: 'architect',
    body: '# P4 test\n\nACc: test.',
    ...extra,
  };
}

test('P4: runCycle emits architect end event with real cost_usd + duration_ms from manifest fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-p4-'));
  const forgeRoot = resolve(import.meta.dirname, '..');
  const cycleId = `TEST-p4-arch-${process.pid}-${Date.now()}`;
  try {
    // Write a manifest that carries real architect telemetry.
    const manifestPath = join(root, 'INIT-2026-06-08-p4test.md');
    writeFileSync(manifestPath, serializeManifest(cycleManifestFixture({
      architect_session_id: 'sid-p4-test',
      architect_cost_usd: 1.23,
      architect_duration_ms: 42000,
    })));

    await runCycle({
      initiativeId: 'INIT-2026-06-08-p4test',
      manifestPath,
      projectRepoPath: root,
      worktreePath: root,
      cycleId,
      dryRun: true,
    });

    // The cycle emits into the real _logs/ dir (same pattern as snapshotCycleArtefacts test).
    const logPath = join(forgeRoot, '_logs', cycleId, 'events.jsonl');
    assert.ok(existsSync(logPath), `expected events.jsonl at ${logPath}`);
    const events: EventLogEntry[] = readFileSync(logPath, 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as EventLogEntry);

    const archEnd = events.find((e) => e.phase === 'architect' && e.event_type === 'end');
    assert.ok(archEnd, 'expected an architect end event');
    assert.equal(archEnd!.cost_usd, 1.23, 'cost_usd must come from manifest field');
    assert.equal(archEnd!.duration_ms, 42000, 'duration_ms must come from manifest field');
    assert.equal(
      (archEnd!.metadata as Record<string, unknown>)?.session_id,
      'sid-p4-test',
      'session_id propagated to metadata',
    );

    const archStart = events.find((e) => e.phase === 'architect' && e.event_type === 'start');
    assert.ok(archStart, 'expected an architect start event');
  } finally {
    rmSync(join(forgeRoot, '_logs', cycleId), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('P4: runCycle emits architect end event without cost/duration for legacy manifest (no telemetry fields)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-p4-legacy-'));
  const forgeRoot = resolve(import.meta.dirname, '..');
  const cycleId = `TEST-p4-legacy-${process.pid}-${Date.now()}`;
  try {
    const manifestPath = join(root, 'INIT-2026-06-08-p4test.md');
    // Legacy manifest: no architect telemetry fields.
    writeFileSync(manifestPath, serializeManifest(cycleManifestFixture()));

    await runCycle({
      initiativeId: 'INIT-2026-06-08-p4test',
      manifestPath,
      projectRepoPath: root,
      worktreePath: root,
      cycleId,
      dryRun: true,
    });

    const logPath = join(forgeRoot, '_logs', cycleId, 'events.jsonl');
    assert.ok(existsSync(logPath), `expected events.jsonl at ${logPath}`);
    const events: EventLogEntry[] = readFileSync(logPath, 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as EventLogEntry);

    const archEnd = events.find((e) => e.phase === 'architect' && e.event_type === 'end');
    assert.ok(archEnd, 'expected an architect end event even for legacy manifest');
    // cost_usd + duration_ms must be ABSENT (not present as 0/undefined) when the
    // manifest carries no telemetry — the UI cost pill must stay blank, not show $0.
    assert.equal(archEnd!.cost_usd, undefined, 'cost_usd must be absent for legacy manifest');
    assert.equal(archEnd!.duration_ms, undefined, 'duration_ms must be absent for legacy manifest');
  } finally {
    rmSync(join(forgeRoot, '_logs', cycleId), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

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
