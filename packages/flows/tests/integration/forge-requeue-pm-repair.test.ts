/**
 * forge-mfv5.1.34 (D-49) — Requeue on a manifest failed by unrepaired PM set
 * validation resumes at the plan node and CARRIES the recorded errors, so the
 * PM runs in repair mode (project-manager.ts) instead of re-decomposing blind;
 * a manifest failed for any other reason keeps today's requeue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRequeue } from '../../forge-requeue.ts';
import { parseManifest } from '../../manifest.ts';
import { derivePmValidationErrors, recordedPmValidationErrors } from '../../requeue-resume.ts';

const INIT = 'INIT-2026-10-11-i2-apply-engine-terraform-retired';
const CYCLE = `2026-10-11T02-16-05_${INIT}`;
const ERRORS = ['WI-3: creates lists 7 path(s), exceeding the D-18 sizing bound of 5 — split into smaller work items'];

function plant(classification: Record<string, unknown>, errors: string[] | null): string {
  const root = mkdtempSync(join(tmpdir(), 'requeue-pm-repair-'));
  for (const d of ['pending', 'in-flight', 'failed', 'done', 'ready-for-review']) mkdirSync(join(root, '_queue', d), { recursive: true });
  mkdirSync(join(root, 'projects', 'gitweave'), { recursive: true });
  writeFileSync(join(root, '_queue', 'failed', `${INIT}.md`), `---
initiative_id: ${INIT}
project: gitweave
project_repo_path: ${join(root, 'projects', 'gitweave')}
created_at: '2026-10-11T00:55:44.289Z'
iteration_budget: 14
cost_budget_usd: 22
phase: pending
origin: architect
class: code
flow_id: forge-architect
cycle_id: ${CYCLE}
${errors ? `pm_validation_errors:\n${errors.map((e) => `  - '${e}'`).join('\n')}\n` : ''}---

# I2
`);
  mkdirSync(join(root, '_logs', CYCLE), { recursive: true });
  writeFileSync(join(root, '_logs', CYCLE, 'events.jsonl'), JSON.stringify({
    event_id: 'EV_1', initiative_id: INIT, phase: 'orchestrator', skill: 'cycle', event_type: 'log',
    input_refs: [], output_refs: [], started_at: '2026-10-11T02:31:00.000Z', message: 'failure_classification',
    metadata: { failure_kind: 'terminal', recoverable: false, environment: false, cleanBoundaryHalt: false, ...classification },
  }) + '\n');
  return root;
}

const pending = (root: string) => parseManifest(readFileSync(join(root, '_queue', 'pending', `${INIT}.md`), 'utf8'));

test('D-49: Requeue on unrepaired set validation → resume_from plan, the recorded errors carried to the repair turn', () => {
  const root = plant({ resume_from: 'plan' }, ERRORS);
  try {
    const r = runRequeue(INIT, { forgeRoot: root });
    assert.equal(r.resumeDecision.resume && r.resumeDecision.resume_from, 'plan', r.resumeDecision.reason);
    assert.match(r.resumeDecision.reason, /repair mode/);
    const m = pending(root);
    assert.equal(m.resume_from, 'plan');
    assert.deepEqual(m.pm_validation_errors, ERRORS, 'the errors travel with the manifest — never a blind re-decompose');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('D-49: a manifest failed for another reason keeps today\'s requeue (no plan resume)', () => {
  const root = plant({}, null);
  try {
    const r = runRequeue(INIT, { forgeRoot: root });
    assert.equal(r.resumeDecision.resume, false, r.resumeDecision.reason);
    assert.equal(pending(root).resume_from, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- row 5: the live I2 manifest failed BEFORE D-49 — nothing recorded -------
// Fixture: COPIES of the live `_queue/failed` manifest and its cycle's events.jsonl
// (read-only sources; machine paths scrubbed), in test-fixtures/pm-repair-i2/.

const FIX = join(import.meta.dirname, '..', 'test-fixtures', 'pm-repair-i2');
const LIVE_D18 = 'WI-3: creates lists 7 path(s), exceeding the D-18 sizing bound of 5 — split into smaller work items';
const LIVE_AC5 = 'AC5 (uncarried: `python3 -m pytest tests/`';

function plantLive(): string {
  const root = mkdtempSync(join(tmpdir(), 'requeue-pm-backfill-'));
  for (const d of ['pending', 'in-flight', 'failed', 'done', 'ready-for-review']) mkdirSync(join(root, '_queue', d), { recursive: true });
  mkdirSync(join(root, 'projects', 'gitweave'), { recursive: true });
  writeFileSync(join(root, '_queue', 'failed', `${INIT}.md`),
    readFileSync(join(FIX, 'manifest.md.fixture'), 'utf8').replace('PROJECT_REPO_PATH', join(root, 'projects', 'gitweave')));
  mkdirSync(join(root, '_logs', CYCLE), { recursive: true });
  copyFileSync(join(FIX, 'events.jsonl.fixture'), join(root, '_logs', CYCLE, 'events.jsonl'));
  return root;
}

test('row 5: the live I2 log yields both validation errors from the PM error event', () => {
  const errors = derivePmValidationErrors(join(FIX, 'events.jsonl.fixture'));
  assert.ok(errors.includes(LIVE_D18), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes(LIVE_AC5)), errors.join('\n'));
});

test('row 5: Requeue on the live I2 manifest (no recorded errors) backfills them by a named event and resumes at plan', () => {
  const root = plantLive();
  try {
    assert.equal(parseManifest(readFileSync(join(root, '_queue', 'failed', `${INIT}.md`), 'utf8')).pm_validation_errors, undefined, 'the live manifest recorded nothing');
    const r = runRequeue(INIT, { forgeRoot: root, resetRetries: true });
    assert.equal(r.resumeDecision.resume && r.resumeDecision.resume_from, 'plan', r.resumeDecision.reason);
    const m = pending(root);
    assert.equal(m.resume_from, 'plan');
    assert.ok(m.pm_validation_errors?.includes(LIVE_D18), `${m.pm_validation_errors}`);
    const log = readFileSync(join(root, '_logs', CYCLE, 'events.jsonl'), 'utf8');
    assert.match(log, /"message":"pm-validation-errors-backfilled"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 5: a log whose last attempt did not fail in the PM derives nothing → standard requeue', () => {
  const root = plantLive();
  try {
    appendFileSync(join(root, '_logs', CYCLE, 'events.jsonl'), [
      { phase: 'orchestrator', skill: 'cycle', event_type: 'start', message: 'cycle.start', metadata: {} },
      { phase: 'orchestrator', skill: 'cycle', event_type: 'end', message: 'cycle.end', metadata: { status: 'failed', error: 'Error: developer-loop phase failed: gate red' } },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n');
    assert.deepEqual(derivePmValidationErrors(join(root, '_logs', CYCLE, 'events.jsonl')), []);
    const r = runRequeue(INIT, { forgeRoot: root, resetRetries: true });
    assert.notEqual(r.resumeDecision.resume && r.resumeDecision.resume_from, 'plan');
    assert.equal(pending(root).pm_validation_errors, undefined);
    assert.ok(existsSync(join(root, '_queue', 'pending', `${INIT}.md`)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 5: an unsafe cycle_id derives nothing — never a read outside _logs (the roadmap GET calls this)', () => {
  const root = plantLive();
  try {
    assert.deepEqual(recordedPmValidationErrors(root, { cycle_id: `../_logs/${CYCLE}` }), []);
    assert.ok(recordedPmValidationErrors(root, { cycle_id: CYCLE }).includes(LIVE_D18), 'the safe id still derives');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- row 6 (forge-mfv5.1.35): the stranded kickoff -------------------------
// The live I2 repair resolved (cycle.end awaiting-kickoff, 15 WIs) but the PM of
// #1185 left `resume_from: plan`, so the Kickoff gate never derived. Fixture:
// COPIES of the live ready-for-review manifest, its events.jsonl and its 15 WIs.

const STR = join(import.meta.dirname, '..', 'test-fixtures', 'pm-repair-i2-stranded');

function plantStranded(opts: { withSet: boolean }): { root: string; manifestPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'requeue-stranded-'));
  for (const d of ['pending', 'in-flight', 'failed', 'done', 'ready-for-review']) mkdirSync(join(root, '_queue', d), { recursive: true });
  const repo = join(root, 'projects', 'gitweave');
  mkdirSync(repo, { recursive: true });
  const manifestPath = join(root, '_queue', 'ready-for-review', `${INIT}.md`);
  writeFileSync(manifestPath, readFileSync(join(STR, 'manifest.md.fixture'), 'utf8').replace('PROJECT_REPO_PATH', repo));
  mkdirSync(join(root, '_logs', CYCLE), { recursive: true });
  copyFileSync(join(STR, 'events.jsonl.fixture'), join(root, '_logs', CYCLE, 'events.jsonl'));
  if (opts.withSet) {
    const wi = join(root, '_worktrees', INIT, '.forge', 'work-items');
    mkdirSync(wi, { recursive: true });
    for (const f of readdirSync(join(STR, 'work-items'))) copyFileSync(join(STR, 'work-items', f), join(wi, f.replace(/\.fixture$/, '')));
  }
  return { root, manifestPath };
}

test('row 6: Requeue on the stranded kickoff commits the repaired set — stays in ready-for-review, resume_from cleared, specs = the set, named event', () => {
  const { root, manifestPath } = plantStranded({ withSet: true });
  try {
    assert.equal(parseManifest(readFileSync(manifestPath, 'utf8')).resume_from, 'plan', 'fixture is the live stranded shape');
    const r = runRequeue(INIT, { forgeRoot: root, resetRetries: true });
    assert.equal(r.toQueueDir, 'ready-for-review');
    assert.match(r.resumeDecision.reason, /stranded kickoff/);
    assert.ok(!existsSync(join(root, '_queue', 'pending', `${INIT}.md`)), 'never re-queued — nothing re-runs');
    const m = parseManifest(readFileSync(manifestPath, 'utf8'));
    assert.equal(m.resume_from, undefined);
    assert.equal(m.specs?.length, 15);
    assert.ok(m.specs?.includes('WI-3a') && m.specs?.includes('WI-9b'));
    assert.match(readFileSync(join(root, '_logs', CYCLE, 'events.jsonl'), 'utf8'), /"message":"pm-set-commit-recovered"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 6: the stranded shape with no readable set is refused by name — nothing moves', () => {
  const { root, manifestPath } = plantStranded({ withSet: false });
  try {
    assert.throws(() => runRequeue(INIT, { forgeRoot: root, resetRetries: true }), /stranded kickoff has no readable work-item set/);
    assert.ok(existsSync(manifestPath), 'the manifest stays where it is');
    assert.equal(parseManifest(readFileSync(manifestPath, 'utf8')).resume_from, 'plan', 'untouched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
