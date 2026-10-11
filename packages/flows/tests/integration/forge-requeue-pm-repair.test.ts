/**
 * forge-mfv5.1.34 (D-49) — Requeue on a manifest failed by unrepaired PM set
 * validation resumes at the plan node and CARRIES the recorded errors, so the
 * PM runs in repair mode (project-manager.ts) instead of re-decomposing blind;
 * a manifest failed for any other reason keeps today's requeue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRequeue } from '../../forge-requeue.ts';
import { parseManifest } from '../../manifest.ts';

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
