/**
 * W7-B2 pinned tests — observable drain (wave-7 walkthrough findings
 * knowledge-01/02/10/11/12/13/14/15 + the cancel affordance).
 *
 * Written RED-FIRST against the pre-W7-B2 drain engine; each test names the
 * finding it encodes. Part A drives `runKbDrain` directly (injected fakes,
 * same harness as cli/bridge-studio-kb-drain.test.ts); Part B exercises the
 * HTTP routes against a real isolated bridge.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  runKbDrain,
  requestKbDrainCancel,
  listKbRuns,
  KB_DRAIN_STALE_MS,
  type KbDrainStatus,
  type KbDrainOpts,
} from '../../bridge-studio-kb-drain.ts';
import { collectKbFindings } from '../../kb-lint-summary.ts';
import { deriveKbActiveJob } from '../../kb-job-state.ts';
import { noKbEdits } from '../../kb-drain-edit-soundness.ts';
import { runBrainLint } from '../../brain-lint.ts';
import type { Finding, AutoFixStableResult } from '../../brain-lint.ts';
import { startBridge } from '../../../../cli/ui-bridge.ts';

// ---------------------------------------------------------------------------
// Shared fixtures (mirrors cli/bridge-studio-kb-drain.test.ts Part A)
// ---------------------------------------------------------------------------

function makeDrainRoot(kbId: string): { root: string; brainDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'kb-drain-w7-'));
  const brainDir = join(root, 'brain', kbId);
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  writeFileSync(join(brainDir, 'kb.yaml'), `id: ${kbId}\nname: ${kbId}\nbinding: { kind: unique }\ndesc: drain fixture.\n`);
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root, brainDir };
}

function fixtureFinding(brainDir: string, slug: string, resolution: Finding['resolution']): Finding & { check: string; kind: string } {
  return {
    category: 'flag',
    file: join(brainDir, 'themes', `${slug}.md`),
    message: `synthetic fixture finding: ${slug}`,
    check: 'fixtureCheck',
    kind: slug,
    resolution,
  };
}

const EMPTY_AUTO_RESULT: AutoFixStableResult = { applied: [], skipped: [], rounds: 0, remaining: [] };

function scriptedLint(sequence: Finding[][]): (forgeRoot: string) => { findings: Finding[] } {
  let i = 0;
  return () => {
    const idx = Math.min(i, sequence.length - 1);
    i += 1;
    return { findings: sequence[idx] };
  };
}

// ---------------------------------------------------------------------------
// knowledge-10 — ONE lint lens: the drain must see a project-bound KB's OWN
// theme findings (the lens buildKbHealth already unions in), never scope the
// full scan alone and declare a false instant green.
// ---------------------------------------------------------------------------

function makeProjectKbRoot(): { root: string; brainDir: string; themeFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'kb-drain-w7-proj-'));
  const brainDir = join(root, 'brain', 'projects', 'pkb');
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  writeFileSync(join(brainDir, 'kb.yaml'), 'id: pkb\nname: pkb\nbinding: { kind: project, ref: pkb }\ndesc: project kb fixture.\n');
  // A theme MISSING updated_at — lintThemeFiles emits checkFrontmatter
  // "missing required frontmatter field: updated_at" (auto tier:
  // frontmatter.missing-date). The category index lists the slug so no
  // index-tier finding muddies the fixture.
  const themeFile = join(brainDir, 'themes', 'needs-date.md');
  writeFileSync(themeFile, [
    '---',
    'title: Needs a date',
    'description: fixture theme missing updated_at',
    'category: pattern',
    'created_at: 2026-01-01',
    '---',
    '',
    'Body prose.',
    '',
  ].join('\n'));
  writeFileSync(join(brainDir, 'patterns.md'), '# Patterns\n\n- [needs-date](./themes/needs-date.md)\n');
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root, brainDir, themeFile };
}

test('collectKbFindings — a project KB\'s own theme findings come from the ONE full scan (knowledge-10)', () => {
  const { root, themeFile } = makeProjectKbRoot();
  try {
    // The guarantee is unchanged: the drain must SEE a project-bound KB's own
    // theme findings, never scope a blind scan and declare a false instant
    // green. What changed is where they come from. This used to be asserted by
    // passing NO full-scan findings at all (`collectKbFindings(root,'pkb',[])`)
    // and relying on a second lens over the KB's own theme files, because
    // readThemeFiles never walked brain/projects/<id>/themes. It does now
    // (ADR 035), so the finding must be in the scan itself — one lens, and no
    // way for the drain's view and `forge brain lint` to disagree.
    const scan = runBrainLint({ cwd: root, scope: 'full' }).findings;
    const findings = collectKbFindings(root, 'pkb', scan);
    const missingDate = findings.find((f) => f.file === themeFile && /updated_at/.test(f.message));
    assert.ok(missingDate, `expected the missing-updated_at finding for this project KB's own theme, got ${JSON.stringify(findings)}`);
    // classify() must have stamped a resolution so the drain can tier it.
    assert.ok(missingDate?.resolution, 'findings must be classified (resolution stamped)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runKbDrain — drains a project KB\'s own-theme auto finding to green (knowledge-10: no false instant green)', async () => {
  const { root, themeFile } = makeProjectKbRoot();
  try {
    const before = readFileSync(themeFile, 'utf8');
    // Injected full-scan lint returns NOTHING — exactly the real gitpulse
    // shape (the shared scan never walks a project brain). The own-theme
    // lens is the only honest source.
    const status = await runKbDrain(root, 'pkb', 'pkb-drain-w7lens', {
      lint: () => ({ findings: [] }),
    });
    assert.equal(status.state, 'green', JSON.stringify(status));
    assert.ok(
      status.perFinding.some((f) => f.tier === 'auto' && f.outcome === 'cleared'),
      `expected the auto fix to be recorded in perFinding — got ${JSON.stringify(status.perFinding)}`,
    );
    const after = readFileSync(themeFile, 'utf8');
    assert.notEqual(after, before, 'the auto-fixer must have actually edited the theme (added updated_at)');
    assert.match(after, /updated_at/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// knowledge-02 / knowledge-11 — per-transition persistence: status.json moves
// during a round, not only at round boundaries; round is visible from the
// start of round 1.
// ---------------------------------------------------------------------------

test('runKbDrain — persists per transition: round visible at round start, perFinding grows after EACH agent turn (knowledge-02/11)', async () => {
  const { root, brainDir } = makeDrainRoot('perturn-kb');
  const a = fixtureFinding(brainDir, 'finding-a', 'agent');
  const b = fixtureFinding(brainDir, 'finding-b', 'agent');
  const snapshots: KbDrainStatus[] = [];
  const opts: KbDrainOpts = {
    lint: scriptedLint([[a, b], []]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [a, b] }),
    runFixTurn: async (input) => ({ runId: input.runId, cleared: true, costUsd: 0.05, editAudit: noKbEdits() }),
    persistStatus: (_root, _runId, s) => { snapshots.push(structuredClone(s)); },
  };
  const status = await runKbDrain(root, 'perturn-kb', 'perturn-kb-drain-t1', opts);
  assert.equal(status.state, 'green', JSON.stringify(status));

  // Round 1 must be visible BEFORE any turn output exists: some persisted
  // snapshot has round=1, state running, and zero agent entries yet.
  assert.ok(
    snapshots.some((s) => s.state === 'running' && s.round === 1 && s.perFinding.filter((f) => f.tier === 'agent').length === 0),
    `expected a round-start persist with round=1 and no agent rows yet — got ${JSON.stringify(snapshots.map((s) => ({ state: s.state, round: s.round, agents: s.perFinding.filter((f) => f.tier === 'agent').length })))}`,
  );
  // After the FIRST agent turn (of two), a persist must already carry
  // exactly one agent entry — the mid-round transition knowledge-02 pins.
  assert.ok(
    snapshots.some((s) => s.state === 'running' && s.perFinding.filter((f) => f.tier === 'agent').length === 1),
    'expected a persist between the two agent turns (one agent row, still running)',
  );
});

test('runKbDrain — status carries startedAt + budget fields (knowledge-14: elapsed/ceiling visible)', async () => {
  const { root } = makeDrainRoot('meta-kb');
  const status = await runKbDrain(root, 'meta-kb', 'meta-kb-drain-t1', {
    lint: scriptedLint([[], []]),
    applyAutoFixes: () => EMPTY_AUTO_RESULT,
  });
  assert.ok(status.startedAt && !Number.isNaN(new Date(status.startedAt).getTime()), `startedAt must be a real ISO stamp, got ${JSON.stringify(status.startedAt)}`);
  assert.equal(typeof status.maxRounds, 'number');
  assert.equal(typeof status.maxCostUsd, 'number');
});

// ---------------------------------------------------------------------------
// knowledge-12 — a finished drain keeps EVERY round's findings, tagged by
// round, not just the last round's list.
// ---------------------------------------------------------------------------

test('runKbDrain — perFinding accumulates across rounds with a round tag (knowledge-12)', async () => {
  const { root, brainDir } = makeDrainRoot('rounds-kb');
  const a = fixtureFinding(brainDir, 'round1-finding', 'agent');
  const b = fixtureFinding(brainDir, 'round2-finding', 'agent');
  // Round 1: a present, cleared; b appears. Round 2: b cleared → green.
  const opts: KbDrainOpts = {
    lint: scriptedLint([[a], [b], [b], []]),
    applyAutoFixes: (_root, o) => {
      // remaining mirrors what the scripted lint says is live pre-fix.
      void o;
      return EMPTY_AUTO_RESULT;
    },
    runFixTurn: async (input) => ({ runId: input.runId, cleared: true, costUsd: 0.01, editAudit: noKbEdits() }),
  };
  // applyAutoFixes must hand back the right residual per round: script it.
  let round = 0;
  opts.applyAutoFixes = () => {
    round += 1;
    return { ...EMPTY_AUTO_RESULT, remaining: round === 1 ? [a] : [b] };
  };
  const status = await runKbDrain(root, 'rounds-kb', 'rounds-kb-drain-t1', opts);
  assert.equal(status.state, 'green', JSON.stringify(status));
  const agentRows = status.perFinding.filter((f) => f.tier === 'agent');
  assert.equal(agentRows.length, 2, `terminal perFinding must keep BOTH rounds' work — got ${JSON.stringify(status.perFinding)}`);
  assert.deepEqual(
    agentRows.map((f) => f.round).sort(),
    [1, 2],
    `each entry must carry the round it happened in — got ${JSON.stringify(agentRows)}`,
  );
});

// ---------------------------------------------------------------------------
// knowledge-01 — the drain's own event log carries renderable per-transition
// progress events, not just start/end.
// ---------------------------------------------------------------------------

test('runKbDrain — emits progress events onto its own cycle log (knowledge-01)', async () => {
  const { root, brainDir } = makeDrainRoot('events-kb');
  const a = fixtureFinding(brainDir, 'evt-finding', 'agent');
  const status = await runKbDrain(root, 'events-kb', 'events-kb-drain-t1', {
    lint: scriptedLint([[a], []]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [a] }),
    runFixTurn: async (input) => ({ runId: input.runId, cleared: true, costUsd: 0.02, editAudit: noKbEdits() }),
  });
  assert.equal(status.state, 'green');
  const raw = readFileSync(join(root, '_logs', '_kb-drain-events-kb-drain-t1', 'events.jsonl'), 'utf8');
  const events = raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { message?: string; metadata?: Record<string, unknown> });
  const progress = events.filter((e) => e.metadata?.['kind'] === 'progress');
  assert.ok(
    progress.some((e) => e.message?.startsWith('kb-drain.round')),
    `expected a round progress event — got ${JSON.stringify(events.map((e) => e.message))}`,
  );
  assert.ok(
    progress.some((e) => e.message?.startsWith('kb-drain.turn')),
    `expected per-turn progress events — got ${JSON.stringify(events.map((e) => e.message))}`,
  );
});

// ---------------------------------------------------------------------------
// Cancel (knowledge-14) — a cancel requested mid-run terminates the loop at
// the next between-turn check with an honest 'cancelled' terminal.
// ---------------------------------------------------------------------------

test('runKbDrain — a cancel request lands as a "cancelled" terminal between turns (knowledge-14)', async () => {
  const { root, brainDir } = makeDrainRoot('cancel-kb');
  const a = fixtureFinding(brainDir, 'cancel-a', 'agent');
  const b = fixtureFinding(brainDir, 'cancel-b', 'agent');
  const runId = 'cancel-kb-drain-t1';
  let turns = 0;
  const status = await runKbDrain(root, 'cancel-kb', runId, {
    lint: scriptedLint([[a, b], [a, b]]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [a, b] }),
    runFixTurn: async (input) => {
      turns += 1;
      // The operator cancels while the FIRST turn is in flight.
      requestKbDrainCancel(root, runId);
      return { runId: input.runId, cleared: false, costUsd: 0.01, editAudit: noKbEdits() };
    },
  });
  assert.equal(status.state, 'cancelled', JSON.stringify(status));
  assert.equal(turns, 1, 'the second queued turn must never dispatch after a cancel');
});

// ---------------------------------------------------------------------------
// Part B — HTTP routes (isolated bridge)
// ---------------------------------------------------------------------------

async function makeIsolatedBridge(): Promise<{ root: string; url: string; close: () => Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), 'kb-drain-w7-http-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(root, '_queue', state), { recursive: true });
  }
  mkdirSync(join(root, '_logs'), { recursive: true });
  const { url, close } = await startBridge({ forgeRoot: root, port: 0 });
  return { root, url, close };
}

function seedCleanKb(root: string, kbId: string): void {
  const dir = join(root, 'brain', kbId);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(join(dir, 'kb.yaml'), `id: ${kbId}\nname: ${kbId}\nbinding: { kind: unique }\ndesc: clean http fixture.\n`);
}

function writeDrainStatus(root: string, runId: string, status: Record<string, unknown>): void {
  const dir = join(root, '_logs', `_kb-drain-${runId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify(status, null, 2));
}

async function postJson(base: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'x-forge-csrf': '1' } });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const RUNNING_STATUS = {
  state: 'running', round: 1, counts: { auto: 0, agent: 1, user: 0 }, perFinding: [],
  costUsd: 0.1, kbId: 'cx-kb',
};

test('POST /api/studio/kbs/:id/drain — events.jsonl exists the moment the dispatch returns (knowledge-13)', async () => {
  const iso = await makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'evt-sync');
    const dispatch = await postJson(iso.url, '/api/studio/kbs/evt-sync/drain');
    assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
    const runId = dispatch.json['runId'] as string;
    // SYNCHRONOUS check — before the deferred queue tick can have run.
    assert.ok(
      existsSync(join(iso.root, '_logs', `_kb-drain-${runId}`, 'events.jsonl')),
      'the drain log must exist before the first UI fetch, not after the queued job starts',
    );
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('POST /api/studio/kbs/:id/drain/cancel — live run: cancel requested (flag written, 200)', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'cx-kb');
    const runId = 'cx-kb-drain-live1';
    writeDrainStatus(iso.root, runId, { ...RUNNING_STATUS, updatedAt: new Date().toISOString() });
    const res = await postJson(iso.url, '/api/studio/kbs/cx-kb/drain/cancel');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json['runId'], runId);
    assert.equal(res.json['mode'], 'requested');
    assert.ok(existsSync(join(iso.root, '_logs', `_kb-drain-${runId}`, 'cancel.json')), 'cancel flag file must exist');
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('POST /api/studio/kbs/:id/drain/cancel — stale run (no heartbeat): forced terminal cancel', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'cx-kb');
    const runId = 'cx-kb-drain-stale1';
    const stale = new Date(Date.now() - (KB_DRAIN_STALE_MS + 60_000)).toISOString();
    writeDrainStatus(iso.root, runId, { ...RUNNING_STATUS, updatedAt: stale });
    const res = await postJson(iso.url, '/api/studio/kbs/cx-kb/drain/cancel');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json['mode'], 'forced');
    const after = JSON.parse(readFileSync(join(iso.root, '_logs', `_kb-drain-${runId}`, 'status.json'), 'utf8')) as { state: string };
    assert.equal(after.state, 'cancelled');
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('POST /api/studio/kbs/:id/drain/cancel — 409 when no active run', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'cx-kb');
    const runId = 'cx-kb-drain-done1';
    writeDrainStatus(iso.root, runId, { ...RUNNING_STATUS, state: 'green', updatedAt: new Date().toISOString() });
    const res = await postJson(iso.url, '/api/studio/kbs/cx-kb/drain/cancel');
    assert.equal(res.status, 409, JSON.stringify(res.json));
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// W7 FIX-B-KB (knowledge-14) — the terminal-run 409 must SAY the run is
// terminal (state + runId), not just "no active drain run": "refuses
// honestly" means the operator learns WHY there is nothing to cancel.
test('POST /api/studio/kbs/:id/drain/cancel — the terminal-run 409 names the latest run + its terminal state (knowledge-14, W7 FIX-B-KB)', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'cx-kb');
    const runId = 'cx-kb-drain-done2';
    writeDrainStatus(iso.root, runId, { ...RUNNING_STATUS, state: 'no-progress', updatedAt: new Date().toISOString() });
    const res = await postJson(iso.url, '/api/studio/kbs/cx-kb/drain/cancel');
    assert.equal(res.status, 409, JSON.stringify(res.json));
    const err = String(res.json['error'] ?? '');
    assert.ok(err.includes('terminal'), `the 409 reason must say the run is terminal, got "${err}"`);
    assert.ok(err.includes('no-progress'), `the 409 reason must carry the terminal state, got "${err}"`);
    assert.equal(res.json['runId'], runId, `the 409 body must name the terminal run, got ${JSON.stringify(res.json)}`);
    assert.equal(res.json['state'], 'no-progress', `the 409 body must carry the terminal state, got ${JSON.stringify(res.json)}`);
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('POST /api/studio/kbs/:id/drain/cancel — 409 with the never-dispatched reason when NO run exists at all (W7 FIX-B-KB)', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'cx-kb');
    const res = await postJson(iso.url, '/api/studio/kbs/cx-kb/drain/cancel');
    assert.equal(res.status, 409, JSON.stringify(res.json));
    const err = String(res.json['error'] ?? '');
    assert.ok(err.includes('no active drain run'), `got "${err}"`);
    assert.equal('runId' in res.json, false, `no runId may be fabricated when no run exists, got ${JSON.stringify(res.json)}`);
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W7-B2 code-review round — the forced-cancel branch must ALSO stake the
// cancel FLAG. A "stale" status is not proof the loop is DEAD: a drain that
// sat QUEUED behind another job on the same per-kbId lock never heartbeats
// either, so it reads stale while being perfectly alive. Terminating only the
// status file let such a run start late, re-persist 'running' over the
// operator's 'cancelled', and execute every agent turn to a real terminal.
// ---------------------------------------------------------------------------

test('POST /api/studio/kbs/:id/drain/cancel — forced branch stakes the cancel flag; a late-starting queued run cannot resurrect', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'cx-kb');
    const runId = 'cx-kb-drain-queued1';
    const stale = new Date(Date.now() - (KB_DRAIN_STALE_MS + 60_000)).toISOString();
    writeDrainStatus(iso.root, runId, { ...RUNNING_STATUS, updatedAt: stale });

    const res = await postJson(iso.url, '/api/studio/kbs/cx-kb/drain/cancel');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json['mode'], 'forced');
    assert.ok(
      existsSync(join(iso.root, '_logs', `_kb-drain-${runId}`, 'cancel.json')),
      'the forced branch must ALSO write the cancel flag, not only the terminal status',
    );

    // Simulated LATE start: the run was queued, not dead, and reaches the head
    // of the queue AFTER the operator was told it had been terminated.
    const brainDir = join(iso.root, 'brain', 'cx-kb');
    const late: Finding & { check: string; kind: string } = {
      category: 'flag',
      file: join(brainDir, 'themes', 'late.md'),
      message: 'synthetic fixture finding: late',
      check: 'fixtureCheck',
      kind: 'late',
      resolution: 'agent',
    };
    let turns = 0;
    let autoCalls = 0;
    const status = await runKbDrain(iso.root, 'cx-kb', runId, {
      lint: () => ({ findings: [late] }),
      applyAutoFixes: () => {
        autoCalls += 1;
        return { ...EMPTY_AUTO_RESULT, remaining: [late] };
      },
      runFixTurn: async (input) => {
        turns += 1;
        return { runId: input.runId, cleared: false, costUsd: 0.01, editAudit: noKbEdits() };
      },
    });
    assert.equal(status.state, 'cancelled', JSON.stringify(status));
    assert.equal(turns, 0, 'a cancelled run must dispatch no agent turn at all');
    assert.equal(autoCalls, 0, 'a cancelled run must not apply auto-fixes either');
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W7-B2 code-review round — ONE terminal-event definition. The active-job
// gate and the RecentRuns widget read the same `_brainfix-<runId>/
// events.jsonl` through the same helpers (cli/kb-job-state.ts), so they can
// never disagree about whether a consolidate has finished.
// ---------------------------------------------------------------------------

function writeConsolidateEvents(root: string, runId: string, lines: readonly string[]): void {
  const dir = join(root, '_logs', `_brainfix-${runId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n');
}

test('consolidate terminal reading — the active-job gate and listKbRuns agree on running/done/failed', () => {
  const { root } = makeDrainRoot('agree-kb');
  try {
    const stamp = Date.now().toString(36);
    const running = `agree-kb-consolidate-${stamp}`;
    // A staked-out dir with a start event and no terminal = running, both ways.
    writeConsolidateEvents(root, running, [
      JSON.stringify({ event_type: 'start', ts: new Date().toISOString() }),
    ]);
    assert.deepEqual(deriveKbActiveJob(root, 'agree-kb'), { kind: 'consolidate', runId: running });
    const runningRow = listKbRuns(root, 'agree-kb').find((r) => r.id === running);
    assert.equal(runningRow?.status, 'running');

    // Terminal 'end' -> gate clears AND the row reports done, with the cost and
    // cleared/total detail read off that same event.
    writeConsolidateEvents(root, running, [
      JSON.stringify({ event_type: 'start', ts: new Date().toISOString() }),
      JSON.stringify({ event_type: 'end', ts: new Date().toISOString(), cost_usd: 0.42, metadata: { clearedCount: 2, total: 3 } }),
    ]);
    assert.equal(deriveKbActiveJob(root, 'agree-kb'), null);
    const doneRow = listKbRuns(root, 'agree-kb').find((r) => r.id === running);
    assert.equal(doneRow?.status, 'done');
    assert.equal(doneRow?.costUsd, 0.42);
    assert.equal(doneRow?.detail, 'cleared 2/3');

    // Terminal 'error' -> gate clears AND the row reports failed. A garbage
    // line between the events must not break either reader.
    const failed = `agree-kb-consolidate-${(Date.now() + 1).toString(36)}`;
    writeConsolidateEvents(root, failed, [
      JSON.stringify({ event_type: 'start', ts: new Date().toISOString() }),
      '{ not json',
      JSON.stringify({ event_type: 'error', ts: new Date().toISOString() }),
    ]);
    assert.equal(deriveKbActiveJob(root, 'agree-kb'), null);
    const failedRow = listKbRuns(root, 'agree-kb').find((r) => r.id === failed);
    assert.equal(failedRow?.status, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
