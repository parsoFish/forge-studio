/**
 * Tests for packages/knowledge/bridge-studio-kb-drain.ts (W6-B12 — KB drain-to-green bridge job).
 *
 * Part A — the state-machine termination matrix: calls `runKbDrain` DIRECTLY
 * with injected `lint`/`applyAutoFixes`/`runFixTurn` fakes, so each terminal
 * state is exercised deterministically without touching the real brain-lint
 * corpus or making an SDK call.
 *
 * Part B — the HTTP routes — moved to the sibling
 * `bridge-studio-kb-drain-routes.test.ts` (forge-6gv.6.1) once the two parts
 * together crossed the 800-line cap; that file's own header carries the full
 * rationale this header used to state for it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  runKbDrain,
  KB_DRAIN_MAX_ROUNDS,
  DEFAULT_KB_DRAIN_MAX_COST_USD,
  type KbDrainStatus,
  type KbDrainOpts,
} from '../../bridge-studio-kb-drain.ts';
import type { Finding, AutoFixStableResult } from '../../brain-lint.ts';
import { noKbEdits } from '../../kb-drain-edit-soundness.ts';
import { readKbDrainStatus } from '../../kb-drain-store.ts';
// M4 ruling 86: the fix-turn port is THIS package's own declaration now —
// the drain is the consumer, so the shape it needs is its own vocabulary.
import type { KbDrainFixTurnInput, KbDrainFixTurnResult } from '../../bridge-studio-kb-drain.ts';

// ---------------------------------------------------------------------------
// Part A fixtures/helpers
// ---------------------------------------------------------------------------

/** A minimal isolated forge-root with exactly one real KB directory (so
 *  `resolveKbBrainDir`/`scopeFindingsToKb` succeed) — the drain loop's OWN
 *  lint/auto-fix/fix-turn calls are all injected fakes, so no real brain
 *  corpus is needed beyond this. */
function makeDrainRoot(kbId: string): { root: string; brainDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'kb-drain-unit-'));
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

/** A `KbDrainLintFn` that replays a fixed sequence of return values, one per
 *  call, holding on the last entry once exhausted — `runKbDrain` calls this
 *  exactly twice per round (before auto-fix, after agent turns), so a
 *  sequence of length 2*N scripts N rounds precisely. */
function scriptedLint(sequence: Finding[][]): (forgeRoot: string) => { findings: Finding[] } {
  let i = 0;
  return () => {
    const idx = Math.min(i, sequence.length - 1);
    i += 1;
    return { findings: sequence[idx] };
  };
}

function neverFixTurn(): (input: KbDrainFixTurnInput) => Promise<KbDrainFixTurnResult & { costUsd: number }> {
  return async (input) => {
    throw new Error(`unexpected runFixTurn call for ${JSON.stringify(input)}`);
  };
}

// ---------------------------------------------------------------------------
// Part A — termination matrix
// ---------------------------------------------------------------------------

test('runKbDrain: GREEN when a round ends with zero auto+agent findings and zero user findings', async () => {
  const { root } = makeDrainRoot('green-kb');
  const opts: KbDrainOpts = {
    lint: scriptedLint([[], []]),
    applyAutoFixes: () => EMPTY_AUTO_RESULT,
    runFixTurn: neverFixTurn(),
  };
  const status = await runKbDrain(root, 'green-kb', 'green-kb-drain-t1', opts);
  assert.equal(status.state, 'green', JSON.stringify(status));
  assert.equal(status.round, 1);
  assert.deepEqual(status.counts, { auto: 0, agent: 0, user: 0 });
  assert.equal(status.costUsd, 0);
});

test('runKbDrain: NEEDS-YOU when auto+agent are drained but a user-tier finding remains', async () => {
  const { root, brainDir } = makeDrainRoot('needsyou-kb');
  const userFinding = fixtureFinding(brainDir, 'user-decision', 'user');
  const opts: KbDrainOpts = {
    lint: scriptedLint([[], [userFinding]]),
    applyAutoFixes: () => EMPTY_AUTO_RESULT,
    runFixTurn: neverFixTurn(),
  };
  const status = await runKbDrain(root, 'needsyou-kb', 'needsyou-kb-drain-t1', opts);
  assert.equal(status.state, 'needs-you', JSON.stringify(status));
  assert.deepEqual(status.counts, { auto: 0, agent: 0, user: 1 });
  const listed = status.perFinding.find((f) => f.tier === 'user' && f.key.includes('user-decision'));
  assert.ok(listed, `expected the user-tier finding to be listed in perFinding — ${JSON.stringify(status.perFinding)}`);
  assert.equal(listed?.outcome, 'needs-you');
});

test('runKbDrain: NO-PROGRESS when the scoped auto+agent finding-key set is unchanged across a round', async () => {
  const { root, brainDir } = makeDrainRoot('noprogress-kb');
  const stuck = fixtureFinding(brainDir, 'stuck-finding', 'agent');
  const opts: KbDrainOpts = {
    // Same finding before AND after — nothing this round's fixer touched cleared.
    lint: scriptedLint([[stuck], [stuck]]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [stuck] }),
    runFixTurn: async (input) => ({ runId: input.runId, cleared: false, costUsd: 0.01, editAudit: noKbEdits() }),
  };
  const status = await runKbDrain(root, 'noprogress-kb', 'noprogress-kb-drain-t1', opts);
  assert.equal(status.state, 'no-progress', JSON.stringify(status));
  assert.equal(status.round, 1);
  const agentEntry = status.perFinding.find((f) => f.tier === 'agent');
  assert.equal(agentEntry?.outcome, 'not-cleared');
});

test(`runKbDrain: ROUND-CAP after ${KB_DRAIN_MAX_ROUNDS} rounds when progress keeps happening but never reaches zero`, async () => {
  const { root, brainDir } = makeDrainRoot('roundcap-kb');
  const maxRounds = 2; // keep the test fast; the mechanism is round-count-agnostic
  // A fresh, differently-keyed finding shows up "before" and "after" each
  // round — always DIFFERENT keys (so no-progress never fires), never empty
  // (so green/needs-you never fires) — forcing the loop to spend every round.
  const sequence: Finding[][] = [];
  for (let r = 0; r < maxRounds; r++) {
    sequence.push([fixtureFinding(brainDir, `round-${r}-before`, 'agent')]);
    sequence.push([fixtureFinding(brainDir, `round-${r}-after`, 'agent')]);
  }
  let turnCalls = 0;
  const opts: KbDrainOpts = {
    maxRounds,
    lint: scriptedLint(sequence),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [fixtureFinding(brainDir, 'residual', 'agent')] }),
    runFixTurn: async (input) => {
      turnCalls += 1;
      return { runId: input.runId, cleared: false, costUsd: 0, editAudit: noKbEdits() };
    },
  };
  const status = await runKbDrain(root, 'roundcap-kb', 'roundcap-kb-drain-t1', opts);
  assert.equal(status.state, 'round-cap', JSON.stringify(status));
  assert.equal(status.round, maxRounds);
  assert.equal(turnCalls, maxRounds, 'expected exactly one fix-turn dispatch per round');
});

test('runKbDrain: COST-CEILING stops dispatching mid-round the moment cumulative cost reaches the ceiling', async () => {
  const { root, brainDir } = makeDrainRoot('cost-kb');
  const f1 = fixtureFinding(brainDir, 'expensive-1', 'agent');
  const f2 = fixtureFinding(brainDir, 'expensive-2', 'agent');
  let turnCalls = 0;
  const opts: KbDrainOpts = {
    maxCostUsd: 1.0,
    lint: scriptedLint([[f1, f2], [f1, f2]]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [f1, f2] }),
    runFixTurn: async (input) => {
      turnCalls += 1;
      return { runId: input.runId, cleared: true, costUsd: 1.5, editAudit: noKbEdits() };
    },
  };
  const status = await runKbDrain(root, 'cost-kb', 'cost-kb-drain-t1', opts);
  assert.equal(status.state, 'cost-ceiling', JSON.stringify(status));
  assert.equal(turnCalls, 1, 'expected the SECOND finding to never be dispatched once the ceiling was reached');
  assert.equal(status.costUsd, 1.5);
});

test('runKbDrain: knowledge-48 — status.counts reflects the round\'s REAL post-auto-fix backlog during agent turns, never the stale pre-round value (0-0-0 for round 1) while cost climbs', async () => {
  const { root, brainDir } = makeDrainRoot('counts-kb');
  const f1 = fixtureFinding(brainDir, 'counts-1', 'agent');
  const f2 = fixtureFinding(brainDir, 'counts-2', 'agent');
  let sawDuringFirstTurn: KbDrainStatus['counts'] | null = null;
  const opts: KbDrainOpts = {
    lint: scriptedLint([[f1, f2], []]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [f1, f2] }),
    runFixTurn: async (input) => {
      if (sawDuringFirstTurn === null) {
        // The auto-fix pass's own persist (BEFORE this — the first — turn
        // even starts) must already carry the round's real backlog.
        const mid = readKbDrainStatus(root, 'counts-kb-drain-t1');
        sawDuringFirstTurn = mid?.counts ?? null;
      }
      return { runId: input.runId, cleared: false, costUsd: 0.05, editAudit: noKbEdits() };
    },
  };
  const status = await runKbDrain(root, 'counts-kb', 'counts-kb-drain-t1', opts);
  assert.deepEqual(
    sawDuringFirstTurn,
    { auto: 0, agent: 2, user: 0 },
    `expected the mid-round status to already show the real backlog (2 agent findings still open), not the stale/seed 0-0-0 — got ${JSON.stringify(sawDuringFirstTurn)}`,
  );
  // Sanity: cost DID climb across both turns while that backlog count held.
  assert.equal(status.costUsd, 0.1, JSON.stringify(status));
});

test('runKbDrain: default maxCostUsd is DEFAULT_KB_DRAIN_MAX_COST_USD when opts.maxCostUsd is omitted', async () => {
  const { root, brainDir } = makeDrainRoot('cost-default-kb');
  const f1 = fixtureFinding(brainDir, 'just-under', 'agent');
  const opts: KbDrainOpts = {
    lint: scriptedLint([[f1], []]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [f1] }),
    runFixTurn: async (input) => ({ runId: input.runId, cleared: true, costUsd: DEFAULT_KB_DRAIN_MAX_COST_USD - 0.01, editAudit: noKbEdits() }),
  };
  const status = await runKbDrain(root, 'cost-default-kb', 'cost-default-kb-drain-t1', opts);
  // Cost stayed under the default ceiling, and the second lint call reports
  // clean — GREEN, not cost-ceiling, proving the default really is
  // DEFAULT_KB_DRAIN_MAX_COST_USD (a much smaller override would have tripped).
  assert.equal(status.state, 'green', JSON.stringify(status));
});

test('runKbDrain: FAILED when the kb id does not resolve to a real brain directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-drain-unit-'));
  mkdirSync(join(root, '_logs'), { recursive: true });
  const status = await runKbDrain(root, 'no-such-kb', 'no-such-kb-drain-t1', {
    lint: scriptedLint([[]]),
    runFixTurn: neverFixTurn(),
  });
  assert.equal(status.state, 'failed', JSON.stringify(status));
});

test('runKbDrain: FAILED when the loop itself throws unexpectedly (not a single turn failing)', async () => {
  const { root } = makeDrainRoot('crash-kb');
  const opts: KbDrainOpts = {
    lint: () => {
      throw new Error('synthetic lint crash');
    },
  };
  const status = await runKbDrain(root, 'crash-kb', 'crash-kb-drain-t1', opts);
  assert.equal(status.state, 'failed', JSON.stringify(status));
  // The status file itself must reflect 'failed', not just the return value —
  // this is what the GET routes serve to a caller that reattaches after nav-away.
  const onDisk = JSON.parse(readFileSync(join(root, '_logs', '_kb-drain-crash-kb-drain-t1', 'status.json'), 'utf8')) as KbDrainStatus;
  assert.equal(onDisk.state, 'failed');
});

test('runKbDrain: a throw in the INITIAL persist (before the round loop even starts) still reaches an on-disk "failed" terminal — not silent-forever "running"', async () => {
  // Reviewer HIGH finding: the initial persist/emit used to sit OUTSIDE the
  // try, so a throw there rejected runKbDrain and enqueueConsolidate's queue
  // continuation swallowed it, leaving status.json at 'running' forever. A
  // plain filesystem fault can't isolate "first persist call fails, the
  // catch-block's recovery persist succeeds" — both target the identical
  // on-disk path — so this uses the persistStatus DI seam to fail ONLY the
  // first call.
  const { root } = makeDrainRoot('initcrash-kb');
  const runId = 'initcrash-kb-drain-t1';
  let calls = 0;
  const opts: KbDrainOpts = {
    persistStatus: (forgeRoot, rid, status) => {
      calls += 1;
      if (calls === 1) throw new Error('synthetic initial-persist crash');
      // Recovery call: a plain direct write (this test's own stub — NOT the
      // real atomic writer under test; see the dedicated atomicity test for
      // that).
      const dir = join(forgeRoot, '_logs', `_kb-drain-${rid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'status.json'), JSON.stringify(status), 'utf8');
    },
  };
  const status = await runKbDrain(root, 'initcrash-kb', runId, opts);
  assert.equal(calls, 2, 'expected exactly 2 persist attempts: the failed initial one, then the catch-block recovery');
  assert.equal(status.state, 'failed', JSON.stringify(status));
  const onDisk = JSON.parse(
    readFileSync(join(root, '_logs', `_kb-drain-${runId}`, 'status.json'), 'utf8'),
  ) as KbDrainStatus;
  assert.equal(onDisk.state, 'failed', 'the on-disk status.json must ALSO reflect failed — what a poller/GET route actually reads');
});

test("runKbDrain: if EVEN the crash-recovery persist throws, the failure is RETHROWN — never silently swallowed into a fabricated success", async () => {
  const { root } = makeDrainRoot('doublecrash-kb');
  const opts: KbDrainOpts = {
    persistStatus: () => {
      throw new Error('synthetic persist crash (always fails)');
    },
  };
  await assert.rejects(
    () => runKbDrain(root, 'doublecrash-kb', 'doublecrash-kb-drain-t1', opts),
    /synthetic persist crash/,
    'expected runKbDrain to REJECT (not silently resolve) when even the recovery persist fails — the last line of defense against a silent-forever status',
  );
});

test('runKbDrain: NO-PROGRESS via cumulative oscillation — a round\'s after-state repeating a PRIOR round\'s after-state stops the drain even though something changes every round (A→B→A stops at round 3, not the round-cap)', async () => {
  const { root, brainDir } = makeDrainRoot('oscillate-kb');
  const seed = fixtureFinding(brainDir, 'seed', 'agent');
  const a = fixtureFinding(brainDir, 'state-a', 'agent');
  const b = fixtureFinding(brainDir, 'state-b', 'agent');
  // round1: before=seed, after=A  (A never seen before -> not oscillating)
  // round2: before=A,    after=B  (B never seen before -> not oscillating)
  // round3: before=B,    after=A  (A WAS seen, in round1's after -> oscillating)
  // Note before(N) != after(N) in every round, so the pre-existing SAME-round
  // no-progress check never fires either — only the NEW cumulative check can
  // catch this.
  const opts: KbDrainOpts = {
    lint: scriptedLint([[seed], [a], [a], [b], [b], [a]]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [] }),
    runFixTurn: neverFixTurn(),
  };
  const status = await runKbDrain(root, 'oscillate-kb', 'oscillate-kb-drain-t1', opts);
  assert.equal(status.state, 'no-progress', JSON.stringify(status));
  assert.equal(
    status.round,
    3,
    `expected oscillation to be caught at round 3 (not the ${KB_DRAIN_MAX_ROUNDS}-round cap), got round ${status.round}`,
  );
});

test('runKbDrain: under FORGE_DRY_BRIDGE=1 the DEFAULT fix turn never spawns — the auto-fix loop still runs, cost stays 0, terminal state stays honest (an INJECTED runFixTurn is by definition not a spawn and is honored regardless — that is how the termination matrix above is testable under CI\'s global FORGE_ARCHITECT_NO_SPAWN=1)', async () => {
  const { root, brainDir } = makeDrainRoot('drybridge-kb');
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const stuck = fixtureFinding(brainDir, 'stuck-under-dry-bridge', 'agent');
    let autoFixCalls = 0;
    // NO runFixTurn injected: exercise the default selection. Under dry-bridge
    // that resolves to the no-spawn stand-in — a real SDK spawn here would
    // either fail (no SDK in CI) or cost money; both are the outcome this test
    // exists to rule out.
    const opts: KbDrainOpts = {
      lint: scriptedLint([[stuck], [stuck]]),
      applyAutoFixes: () => {
        autoFixCalls += 1;
        return { ...EMPTY_AUTO_RESULT, remaining: [stuck] };
      },
    };
    const status = await runKbDrain(root, 'drybridge-kb', 'drybridge-kb-drain-t1', opts);
    assert.ok(autoFixCalls >= 1, 'expected the local auto-fix/lint loop to still run under dry-bridge (not a whole-route refusal)');
    assert.equal(status.costUsd, 0, 'no cost may accrue when the default turn is the no-spawn stand-in');
    // Honest terminal: the finding never actually cleared (identical before
    // and after — it was never touched) — no-progress, NOT a fabricated green.
    assert.equal(status.state, 'no-progress', JSON.stringify(status));
    const agentEntry = status.perFinding.find((f) => f.tier === 'agent');
    assert.equal(agentEntry?.outcome, 'not-cleared');
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
});

test('runKbDrain: a single turn throwing is RECORDED as a turn error, and the outcome still comes from the round\'s own lint (W8-B2)', async () => {
  const { root, brainDir } = makeDrainRoot('turnthrow-kb');
  const f1 = fixtureFinding(brainDir, 'throws', 'agent');
  const opts: KbDrainOpts = {
    lint: scriptedLint([[f1], []]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [f1] }),
    runFixTurn: async () => {
      throw new Error('synthetic turn crash');
    },
  };
  const status = await runKbDrain(root, 'turnthrow-kb', 'turnthrow-kb-drain-t1', opts);
  // The round still completes (lint after reports clean) — GREEN, not FAILED —
  // proving the per-turn throw was caught locally, not propagated to the loop.
  assert.equal(status.state, 'green', JSON.stringify(status));
  const agentEntry = status.perFinding.find((f) => f.tier === 'agent');
  // W8-B2 — this assertion CHANGED, and the old one was wrong. It used to
  // require `outcome: 'not-cleared'` here, which made this very fixture assert
  // a contradiction: a GREEN run (the round's post-fix lint reports the finding
  // gone) carrying a not-cleared row for that same finding. That is forge-6gu's
  // shape with the sign flipped. `outcome` is now derived from the post-fix
  // lint — the only thing that actually knows — and the crash is recorded as
  // the separate fact it is, so neither signal is lost in the other.
  assert.equal(agentEntry?.outcome, 'cleared');
  assert.match(agentEntry?.turnError ?? '', /synthetic turn crash/);
});

test('runKbDrain: status.json is written per round (survives nav-away) with round/counts/updatedAt progressing', async () => {
  const { root, brainDir } = makeDrainRoot('progress-kb');
  const r1Before = fixtureFinding(brainDir, 'round1-before', 'agent');
  const r1After = fixtureFinding(brainDir, 'round1-after', 'agent');
  // Round 1: before=[r1Before], after=[r1After] — DIFFERENT keys, so round 1
  // shows progress (not no-progress) but isn't clean yet (round-1 'running'
  // status write). Round 2: before=[r1After] (same as round 1's after — the
  // fresh lint at the top of round 2 sees the same state round 1 left),
  // after=[] — clean, GREEN.
  const runId = 'progress-kb-drain-t1';
  const status = await runKbDrain(root, 'progress-kb', runId, {
    lint: scriptedLint([[r1Before], [r1After], [r1After], []]),
    applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [r1After] }),
    runFixTurn: async (input) => ({ runId: input.runId, cleared: false, costUsd: 0, editAudit: noKbEdits() }),
  });
  assert.equal(status.state, 'green', JSON.stringify(status));
  assert.equal(status.round, 2);
  const statusPath = join(root, '_logs', `_kb-drain-${runId}`, 'status.json');
  assert.ok(existsSync(statusPath), 'expected a status.json to exist on disk');
  const eventsPath = join(root, '_logs', `_kb-drain-${runId}`, 'events.jsonl');
  assert.ok(existsSync(eventsPath), 'expected events.jsonl to exist (createLogger)');
  const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { message?: string });
  assert.ok(events.some((e) => e.message === 'kb-drain.start'));
  assert.ok(events.some((e) => e.message?.startsWith('kb-drain.end')));
});

test('writeKbDrainStatus is atomic (temp+rename): no leftover .tmp file after a completed run — a mid-write reader can only ever see the fully-written prior or fully-written new file, never a truncated one', async () => {
  const { root } = makeDrainRoot('atomic-kb');
  const runId = 'atomic-kb-drain-t1';
  const status = await runKbDrain(root, 'atomic-kb', runId, {
    lint: scriptedLint([[], []]),
    applyAutoFixes: () => EMPTY_AUTO_RESULT,
    runFixTurn: neverFixTurn(),
  });
  assert.equal(status.state, 'green');
  const dir = join(root, '_logs', `_kb-drain-${runId}`);
  assert.ok(existsSync(join(dir, 'status.json')), 'expected the final status.json to exist');
  assert.ok(
    !existsSync(join(dir, 'status.json.tmp')),
    'expected NO leftover .tmp file — renameSync must have replaced the final path atomically, in one step, every round',
  );
});

