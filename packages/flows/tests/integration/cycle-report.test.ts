/**
 * Tests for orchestrator/cycle-report.ts. The report builder consumes a
 * variety of inputs (event log, manifest, work-item snapshots, brain themes,
 * git refs); these tests build synthetic fixtures and verify the markdown
 * output contains the load-bearing sections.
 *
 * Real-cycle output is also exercised end-to-end via the W4 trial run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCycleReport, writeCycleReport } from '../../cycle-report.ts';
import { phaseCostRemainder } from '../../metrics.ts';

function setupFixture(): { forgeRoot: string; cycleId: string; cleanup: () => void } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-report-'));
  const cycleId = '2026-05-10T12-00-00_INIT-2026-05-10-fixture';
  const initiativeId = 'INIT-2026-05-10-fixture';
  const cycleLogDir = join(forgeRoot, '_logs', cycleId);
  mkdirSync(cycleLogDir, { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'projects', 'demo', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', '_raw', 'cycles'), { recursive: true });

  // Manifest in done/.
  writeFileSync(
    join(forgeRoot, '_queue', 'done', `${initiativeId}.md`),
    `---
initiative_id: ${initiativeId}
project: demo
project_repo_path: /tmp/demo-fixture
created_at: 2026-05-10T12:00:00Z
iteration_budget: 5
cost_budget_usd: 1.5
class: code
flow_id: forge-develop
phase: done
quality_gate_cmd:
  - npm
  - test
---

# Add helper utility

## Why

We need a helper to support feature X.

## Acceptance

- Function works as documented.
`,
  );

  // Event log.
  const events = [
    {
      event_id: 'EV_1', cycle_id: cycleId, started_at: '2026-05-10T12:00:00Z',
      initiative_id: initiativeId, phase: 'orchestrator', skill: 'cycle',
      event_type: 'start', input_refs: [], output_refs: [], message: 'cycle.start',
    },
    {
      event_id: 'EV_2', cycle_id: cycleId, started_at: '2026-05-10T12:01:00Z',
      initiative_id: initiativeId, phase: 'project-manager', skill: 'project-manager',
      event_type: 'start', input_refs: [], output_refs: [],
    },
    {
      event_id: 'EV_3', cycle_id: cycleId, started_at: '2026-05-10T12:02:00Z',
      initiative_id: initiativeId, phase: 'project-manager', skill: 'project-manager',
      event_type: 'end', input_refs: [], output_refs: [],
      cost_usd: 0.45, duration_ms: 60000,
      metadata: { tool_use: { brainReads: 3 } },
    },
    {
      event_id: 'EV_4', cycle_id: cycleId, started_at: '2026-05-10T12:03:00Z',
      initiative_id: initiativeId, phase: 'review-loop', skill: 'reviewer',
      event_type: 'log', input_refs: [], output_refs: [], message: 'reviewer.verdict.approve',
    },
    {
      event_id: 'EV_5', cycle_id: cycleId, started_at: '2026-05-10T12:04:00Z',
      initiative_id: initiativeId, phase: 'review-loop', skill: 'reviewer',
      event_type: 'log', input_refs: [], output_refs: ['https://github.com/x/y/pull/1'],
      message: 'reviewer.merged',
    },
    {
      event_id: 'EV_6', cycle_id: cycleId, started_at: '2026-05-10T12:05:00Z',
      initiative_id: initiativeId, phase: 'orchestrator', skill: 'cycle',
      event_type: 'end', input_refs: [], output_refs: [], message: 'cycle.end',
      duration_ms: 300000, metadata: { status: 'merged', reflection_status: 'closed' },
    },
  ];
  writeFileSync(
    join(cycleLogDir, 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );

  // Work-items snapshot.
  const wiDir = join(cycleLogDir, 'work-items-snapshot');
  mkdirSync(wiDir, { recursive: true });
  writeFileSync(
    join(wiDir, 'WI-1.md'),
    `---
work_item_id: WI-1
initiative_id: ${initiativeId}
status: complete
depends_on: []
acceptance_criteria:
  - given: "an input X"
    when: "the helper is called"
    then: "the output is Y"
files_in_scope:
  - src/helper.ts
estimated_iterations: 1
---

# WI-1: Add the helper

Implement the helper as specified.
`,
  );
  writeFileSync(
    join(wiDir, '_graph.md'),
    '```mermaid\ngraph TD\n  WI-1["Add helper"]\n```\n',
  );

  // A brain theme written within the cycle window. Set the file's mtime to
  // a timestamp inside the synthetic cycle's [start, end+5min] window so the
  // builder picks it up (mtime comparison, not frontmatter-date comparison).
  const themePath = join(forgeRoot, 'brain', 'projects', 'demo', 'themes', '2026-05-10-test-theme.md');
  writeFileSync(
    themePath,
    `---
title: Test theme
description: A theme captured during the test cycle
category: pattern
created_at: 2026-05-10T12:04:30Z
updated_at: 2026-05-10T12:04:30Z
---

# Test theme

Body text.
`,
  );
  const themeMtime = new Date('2026-05-10T12:04:30Z');
  utimesSync(themePath, themeMtime, themeMtime);

  // Retro.
  writeFileSync(
    join(cycleLogDir, 'retro.md'),
    '# Retro\n\n## Self-reflection\n\nIt went well.\n',
  );

  // Profile.
  writeFileSync(
    join(forgeRoot, 'brain', 'projects', 'demo', 'profile.md'),
    `---
project: demo
---

# Demo project

Demo project for the report fixture. Used in tests.
`,
  );

  return {
    forgeRoot,
    cycleId,
    cleanup: () => rmSync(forgeRoot, { recursive: true, force: true }),
  };
}

test('buildCycleReport: emits all load-bearing sections for a successful cycle', () => {
  const { forgeRoot, cycleId, cleanup } = setupFixture();
  try {
    const md = buildCycleReport({ cycleId, forgeRoot });

    // Header
    assert.match(md, /Cycle Report/);
    assert.match(md, /Status:.*merged/);
    // M7 findings row 59: both seed flows terminate at the SAME status word
    // (`ready-for-review`), so the flow id must sit beside the status —
    // never merely elsewhere in the header — or a reader cannot tell which
    // flow produced this report.
    assert.match(md, /Status:.*merged.*forge-develop/, 'the flow id must render beside the status word, not just anywhere in the report');
    assert.match(md, /Reflection:.*closed/);
    assert.match(md, /github\.com\/x\/y\/pull\/1/);
    assert.match(md, /Total cost.*\$0\.45/);

    // What was asked
    assert.match(md, /What was asked/);
    assert.match(md, /Add helper utility/);

    // Decomposition
    assert.match(md, /How the system decomposed it/);
    assert.match(md, /WI-1.*Add the helper/);
    assert.match(md, /GIVEN.*WHEN.*THEN/);
    assert.match(md, /```mermaid/);

    // Trajectory
    assert.match(md, /Trajectory/);
    assert.match(md, /\| `project-manager` \| \$0\.45 \|/);
    assert.match(md, /3 brain read/);
    assert.match(md, /reviewer\.merged/);

    // Verification
    assert.match(md, /PR merged/);
    assert.match(md, /github\.com/);

    // Brain learning
    assert.match(md, /Brain learning/);
    assert.match(md, /Test theme/);

    // Appendix
    assert.match(md, /Appendix/);
    assert.match(md, /events\.jsonl/);
    assert.match(md, /retro\.md/);
  } finally {
    cleanup();
  }
});

test('buildCycleReport: handles missing event log gracefully', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-report-empty-'));
  try {
    const md = buildCycleReport({ cycleId: 'nonexistent', forgeRoot: dir });
    assert.match(md, /no events found/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildCycleReport: handles missing manifest gracefully', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-report-noman-'));
  try {
    const cycleId = '2026-05-10T00-00-00_INIT-orphan';
    const cycleLogDir = join(forgeRoot, '_logs', cycleId);
    mkdirSync(cycleLogDir, { recursive: true });
    const events = [
      {
        event_id: 'EV_1', cycle_id: cycleId, started_at: '2026-05-10T00:00:00Z',
        initiative_id: 'INIT-orphan', phase: 'orchestrator', skill: 'cycle',
        event_type: 'start', input_refs: [], output_refs: [], message: 'cycle.start',
      },
      {
        event_id: 'EV_2', cycle_id: cycleId, started_at: '2026-05-10T00:01:00Z',
        initiative_id: 'INIT-orphan', phase: 'orchestrator', skill: 'cycle',
        event_type: 'error', input_refs: [], output_refs: [], message: 'cycle.error',
      },
    ];
    writeFileSync(
      join(cycleLogDir, 'events.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
    const md = buildCycleReport({ cycleId, forgeRoot });
    assert.match(md, /Status:.*failed/);
    assert.match(md, /manifest unavailable/i);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('writeCycleReport: writes the markdown to _logs/<cycleId>/report.md', () => {
  const { forgeRoot, cycleId, cleanup } = setupFixture();
  try {
    const path = writeCycleReport({ cycleId, forgeRoot });
    assert.match(path, /report\.md$/);
    assert.ok(existsSync(path));
    const content = readFileSync(path, 'utf8');
    assert.match(content, /Cycle Report/);
  } finally {
    cleanup();
  }
});

/*
 * `forge-8vfn.7.6.119` — every phase that SPENT gets a row, and the rows sum to
 * the stated total.
 *
 * MEASURED ON TWO REAL RUNS. S10 run 17's report.md stated `Total cost $3.99`
 * and rendered ONE trajectory row, `project-manager $1.45`. Run 18: total
 * $3.84, same single row. The missing money was not unattributed — it was the
 * ARCHITECT, and `renderTrajectory` iterated a hardcoded
 * `['project-manager', 'developer-loop', 'review-loop', 'reflection']` that
 * does not contain it:
 *
 *     run 17   architect $2.5401 + project-manager $1.4542 = $3.9944 == total
 *     run 18   architect $2.9605 + project-manager $0.8772 = $3.8378 == total
 *
 * Exact, both runs — and it cannot be otherwise: `metrics.ts` accumulates
 * `per_phase[e.phase].cost_usd` and `total_cost_usd` in the SAME `countCost`
 * branch from the same events, so the two are equal by construction. The data
 * was always complete; only the rendering was short.
 *
 * THE HARM IS THE OPPOSITE OF SMALL. The architect is the LARGEST line item in
 * both runs — 64% and 77% — and it is exactly the row the table never shows. A
 * per-phase cost table exists to answer "which phase is expensive"; this one
 * omitted the answer every time.
 *
 * WHY THE SUITE NEVER CAUGHT IT: the fixture above spends only in
 * `project-manager`, which the hardcoded list happens to contain, so the table
 * summed correctly for the one phase it was ever asked about. The population
 * did not include the thing that was wrong — the same shape as `beats-page`'s
 * dead glob and `wait-carry-through`'s shape list.
 */
function fixtureWithArchitectSpend(): { forgeRoot: string; cycleId: string; cleanup: () => void } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-report-arch-'));
  const cycleId = '2026-09-18T03-59-20_INIT-arch';
  const dir = join(forgeRoot, '_logs', cycleId);
  mkdirSync(dir, { recursive: true });
  const base = { cycle_id: cycleId, initiative_id: 'INIT-arch', input_refs: [], output_refs: [] };
  const rows = [
    { ...base, event_id: 'E1', started_at: '2026-09-18T03:59:24Z', phase: 'orchestrator', skill: 'cycle', event_type: 'start', message: 'cycle.start' },
    { ...base, event_id: 'E2', started_at: '2026-09-18T03:59:24Z', phase: 'architect', skill: 'architect', event_type: 'start', message: 'architect.start' },
    // The architect's real spend, in the shape the runs produced it.
    { ...base, event_id: 'E3', started_at: '2026-09-18T04:02:00Z', phase: 'architect', skill: 'architect', event_type: 'end', message: 'architect.end', cost_usd: 2.9605, duration_ms: 156000 },
    { ...base, event_id: 'E4', started_at: '2026-09-18T04:02:01Z', phase: 'project-manager', skill: 'project-manager', event_type: 'start' },
    { ...base, event_id: 'E5', started_at: '2026-09-18T04:05:13Z', phase: 'project-manager', skill: 'project-manager', event_type: 'end', cost_usd: 0.8772, duration_ms: 192000 },
    { ...base, event_id: 'E6', started_at: '2026-09-18T04:05:13Z', phase: 'orchestrator', skill: 'cycle', event_type: 'end', message: 'cycle.end' },
  ];
  writeFileSync(join(dir, 'events.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return { forgeRoot, cycleId, cleanup: () => rmSync(forgeRoot, { recursive: true, force: true }) };
}

test('7.6.119: the architect gets a trajectory row — the largest line item was never rendered', () => {
  const { forgeRoot, cycleId, cleanup } = fixtureWithArchitectSpend();
  try {
    const md = buildCycleReport({ cycleId, forgeRoot });
    assert.match(md, /\| `architect` \| \$2\.96 \|/,
      'the phase that spent 77% of this cycle must appear in the per-phase table');
    assert.match(md, /\| `project-manager` \| \$0\.88 \|/, 'and the phase that was already rendered still is');
  } finally { cleanup(); }
});

test('7.6.119: the rendered rows SUM to the stated total, and the report says so', () => {
  // THE GUARD, and its value is that it reads zero forever once the rows are
  // complete. Nothing in this report compared those two numbers before, which
  // is why a table summing to 36% of its own stated total shipped: an operator
  // had to subtract two figures ten lines apart to notice.
  const { forgeRoot, cycleId, cleanup } = fixtureWithArchitectSpend();
  try {
    const md = buildCycleReport({ cycleId, forgeRoot });
    const rows = [...md.matchAll(/^\| `[a-z-]+` \| \$([0-9.]+) \|/gm)].map((m) => Number(m[1]));
    assert.ok(rows.length >= 2, `expected a row per spending phase, got ${rows.length}`);
    const summed = rows.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(summed - 3.84) < 0.011, `rendered rows sum to $${summed.toFixed(2)}, stated total $3.84`);
    assert.match(md, /Total cost.*\$3\.84/);
  } finally { cleanup(); }
});

test('7.6.119: phaseCostRemainder reports a gap when one exists — the tripwire, doored directly', () => {
  // THE RENDERER'S REMAINDER BRANCH IS UNREACHABLE THROUGH `buildCycleReport`
  // TODAY, and saying so is the honest version. `collect()` sums per-phase and
  // total in one branch from one event stream, so once every phase is rendered
  // the two agree by construction and the line never prints. That is the
  // intended steady state, not a reason to leave the function untested: it is a
  // tripwire for the day the invariant breaks, and a tripwire nobody has ever
  // seen fire is indistinguishable from one that cannot.
  //
  // So it is doored where it CAN be exercised — on the function, with a metrics
  // object whose halves disagree. If this ever starts returning 0 for a genuine
  // mismatch, the report goes back to summing to less than it states with
  // nothing to say so.
  const m = {
    total_cost_usd: 3.84,
    per_phase: { 'project-manager': { cost_usd: 0.8772, iterations: 0, duration_ms: 0 } },
    per_skill: {}, iterations_total: 0, errors: 0,
  } as unknown as Parameters<typeof phaseCostRemainder>[0];
  assert.ok(Math.abs(phaseCostRemainder(m) - 2.9628) < 0.001,
    'a phase missing from per_phase must surface as the remainder, not vanish');

  const whole = {
    total_cost_usd: 3.8377,
    per_phase: {
      architect: { cost_usd: 2.9605, iterations: 0, duration_ms: 0 },
      'project-manager': { cost_usd: 0.8772, iterations: 0, duration_ms: 0 },
    },
    per_skill: {}, iterations_total: 0, errors: 0,
  } as unknown as Parameters<typeof phaseCostRemainder>[0];
  assert.ok(Math.abs(phaseCostRemainder(whole)) < 0.005,
    'and the steady state reads zero — which is what makes a non-zero meaningful');
});

test('7.6.119: a phase NOBODY anticipated still gets a row — the claim, doored', () => {
  // THE BRANCH THIS PINS WAS NOT-AIMED UNTIL NOW, and a mutation proved it:
  // making `phasesInRenderOrder` return only its known list left every test
  // above green, because each fixture spends in phases the list already
  // contains. The whole argument for deriving from what is PRESENT is that a
  // constant cannot see a phase added later — and that argument was carried by
  // a branch nothing exercised, which is the decorative shape this bead is
  // about in the first place.
  //
  // So: a phase name no literal in the codebase mentions, carrying real spend.
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-report-unknown-'));
  const cycleId = '2026-09-18T05-00-00_INIT-unknown';
  const dir = join(forgeRoot, '_logs', cycleId);
  mkdirSync(dir, { recursive: true });
  const base = { cycle_id: cycleId, initiative_id: 'INIT-unknown', input_refs: [], output_refs: [] };
  const rows = [
    { ...base, event_id: 'U1', started_at: '2026-09-18T05:00:00Z', phase: 'orchestrator', skill: 'cycle', event_type: 'start', message: 'cycle.start' },
    { ...base, event_id: 'U2', started_at: '2026-09-18T05:00:01Z', phase: 'demo-builder', skill: 'demo', event_type: 'start' },
    { ...base, event_id: 'U3', started_at: '2026-09-18T05:01:00Z', phase: 'demo-builder', skill: 'demo', event_type: 'end', cost_usd: 1.25, duration_ms: 60000 },
    { ...base, event_id: 'U4', started_at: '2026-09-18T05:01:01Z', phase: 'orchestrator', skill: 'cycle', event_type: 'end', message: 'cycle.end' },
  ];
  writeFileSync(join(dir, 'events.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  try {
    const md = buildCycleReport({ cycleId, forgeRoot });
    assert.match(md, /\| `demo-builder` \| \$1\.25 \|/,
      'a phase outside every known list must still be rendered — dropping it silently is the defect, '
      + 'and a phase the product gains next month would otherwise vanish from its own cost table');
  } finally { rmSync(forgeRoot, { recursive: true, force: true }); }
});
