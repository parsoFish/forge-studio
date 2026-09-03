/**
 * The fix-turn PORT contract — M4 ruling 86 (amended).
 *
 * This package used to import `runBrainFixTurn` and its input/result types
 * straight out of `@forge/sessions`: an upward edge (knowledge is rank 2,
 * sessions rank 4) carried by four baseline rows. It now declares the port
 * itself — `KbDrainFixTurnInput` / `KbDrainFixTurnResult` /
 * `KbDrainRunFixTurnFn`, in this package's own vocabulary — and the real turn
 * arrives from the assembly (`apps/forge/brain-fix-turn.ts`, threaded through
 * `knowledgeRoutes(deps)`).
 *
 * Two obligations follow, and this file is both of them:
 *
 *   1. PARITY — drain behaviour through an injected turn is what it always
 *      was. Table-driven over the outcomes a turn can produce, so a new
 *      outcome cannot be added without a row here.
 *   2. THE ABSENT TURN IS A NAMED REFUSAL — never a silent fallback. A caller
 *      that forgot to thread `runFixTurn` must not get a drain that reports
 *      every agent-tier finding uncleared, which is indistinguishable from a
 *      genuinely hard KB.
 *
 * The refusal is LAZY, and that was a finding rather than a design choice: the
 * first cut threw when the turn was SELECTED, which refused an auto-only drain
 * that never dispatches a turn at all. Five of this package's own drain tests
 * failed and were right to. Clause 3 pins the corrected placement from both
 * sides — an auto-only drain needs no injection, an agent-tier drain does.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runKbDrain, type KbDrainRunFixTurnFn } from '../../bridge-studio-kb-drain.ts';
import { noKbEdits } from '../../kb-drain-edit-soundness.ts';
import type { Finding, AutoFixStableResult } from '../../brain-lint.ts';

/**
 * Fixtures mirroring `tests/unit/bridge-studio-kb-drain.test.ts`'s Part A, and
 * mirrored rather than imported on purpose: they are that file's private test
 * scaffolding, and a contract test that depends on another test file's
 * internals breaks when that file is re-bucketed. The shapes matter and were
 * taken from the working tests, not guessed — `brain/<kbId>` (not
 * `brain/projects/<kbId>`, which is a different KB layout), a `category` on
 * every Finding, and `lint` called TWICE per round.
 */
function makeDrainRoot(kbId: string): { root: string; brainDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'fix-turn-port-'));
  const brainDir = join(root, 'brain', kbId);
  mkdirSync(join(brainDir, 'themes'), { recursive: true });
  writeFileSync(
    join(brainDir, 'kb.yaml'),
    `id: ${kbId}\nname: ${kbId}\nbinding: { kind: unique }\ndesc: fix-turn port fixture.\n`,
  );
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root, brainDir };
}

function fixtureFinding(brainDir: string, slug: string, resolution: Finding['resolution']): Finding {
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

/** `runKbDrain` calls lint twice per round (before auto-fix, after the agent
 *  turns), so a length-2 sequence scripts exactly one round. */
function scriptedLint(sequence: Finding[][]): (forgeRoot: string) => { findings: Finding[] } {
  let i = 0;
  return () => {
    const idx = Math.min(i, sequence.length - 1);
    i += 1;
    return { findings: sequence[idx] };
  };
}

describe('the drain dispatches its fix turn through the injected port (ruling 86)', () => {
  /**
   * PARITY, table-driven — and the table encodes a product fact the first
   * draft got wrong, which is worth stating because it is easy to assume the
   * other way: **the drain's per-finding `outcome` is derived from the
   * POST-TURN LINT, not from the turn's own `cleared` flag.** A turn that
   * returns `cleared: false`, or that throws outright, still records
   * `outcome: 'cleared'` if the follow-up lint no longer sees the finding —
   * the turn's verdict lands in `turnError` and the lint decides. So each row
   * controls BOTH the turn and what lint sees afterwards; a table that varied
   * only the turn would have asserted the wrong mechanism and passed.
   */
  const cases: ReadonlyArray<{
    name: string;
    turn: KbDrainRunFixTurnFn;
    stillFoundAfter: boolean;
    expectOutcome: 'cleared' | 'not-cleared';
    expectTurnError: boolean;
  }> = [
    {
      name: 'a turn clears it and the lint agrees',
      turn: async (input) => ({ runId: input.runId, cleared: true, costUsd: 0, editAudit: noKbEdits() }),
      stillFoundAfter: false,
      expectOutcome: 'cleared',
      expectTurnError: false,
    },
    {
      name: 'a turn leaves it and the lint still sees it',
      turn: async (input) => ({ runId: input.runId, cleared: false, costUsd: 0, editAudit: noKbEdits() }),
      stillFoundAfter: true,
      expectOutcome: 'not-cleared',
      expectTurnError: false,
    },
    {
      name: 'a turn THROWS and the lint still sees it — the throw is recorded, not swallowed',
      turn: async () => {
        throw new Error('turn exploded');
      },
      stillFoundAfter: true,
      expectOutcome: 'not-cleared',
      expectTurnError: true,
    },
    {
      name: 'a turn throws but the lint no longer sees it — the LINT decides the outcome',
      turn: async () => {
        throw new Error('turn exploded after writing');
      },
      stillFoundAfter: false,
      expectOutcome: 'cleared',
      expectTurnError: true,
    },
  ];

  for (const c of cases) {
    test(`parity: ${c.name}`, async () => {
      const { root, brainDir } = makeDrainRoot('parity-kb');
      try {
        const agent = fixtureFinding(brainDir, 'agent-residual', 'agent');
        let calls = 0;
        const status = await runKbDrain(root, 'parity-kb', `parity-${Date.now().toString(36)}`, {
          lint: scriptedLint([[agent], c.stillFoundAfter ? [agent] : []]),
          // The agent phase draws from the auto-fixer's `remaining`, not from
          // the lint result — measured from the working drain tests.
          applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [agent] }),
          runFixTurn: async (input) => {
            calls += 1;
            return c.turn(input);
          },
        });

        assert.equal(calls, 1, 'the injected turn must be the one dispatched, exactly once');
        const entry = status.perFinding.find((f) => f.tier === 'agent');
        assert.ok(entry, `expected an agent-tier entry — got ${JSON.stringify(status.perFinding)}`);
        assert.equal(entry!.outcome, c.expectOutcome, JSON.stringify(entry));
        assert.equal(
          'turnError' in entry! && entry!.turnError !== undefined,
          c.expectTurnError,
          `turnError presence — ${JSON.stringify(entry)}`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test("the port receives this package's own vocabulary — no sessions concept crosses it", async () => {
    const { root, brainDir } = makeDrainRoot('shape-kb');
    try {
      const agent = fixtureFinding(brainDir, 'agent-residual', 'agent');
      let seen: Record<string, unknown> | null = null;
      await runKbDrain(root, 'shape-kb', 'port-shape', {
        lint: scriptedLint([[agent], []]),
        applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [agent] }),
        runFixTurn: async (input) => {
          seen = input as unknown as Record<string, unknown>;
          return { runId: input.runId, cleared: true, costUsd: 0, editAudit: noKbEdits() };
        },
      });

      assert.ok(seen !== null, 'the turn must have been dispatched');
      const keys = Object.keys(seen as Record<string, unknown>).sort();
      // `queryFn` and `logsRoot` exist on the TURN's own input type and are
      // never set by the drain; either appearing here means the port has
      // acquired a sessions concept, which is what ruling 86 removed.
      assert.equal(keys.includes('queryFn'), false, `port grew queryFn: ${keys.join(',')}`);
      assert.equal(keys.includes('logsRoot'), false, `port grew logsRoot: ${keys.join(',')}`);
      for (const required of ['runId', 'forgeRoot', 'kbId', 'file', 'check', 'kind', 'message']) {
        assert.ok(keys.includes(required), `the port must carry ${required} — got ${keys.join(',')}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an ABSENT turn is a named refusal on the agent path, and a no-op on the auto path', async (t) => {
    // The env is what selects the no-spawn stand-in, so this test states the
    // condition it needs rather than inheriting whatever CI set (§15.63 — a
    // result names how it was produced).
    const prior = process.env.FORGE_ARCHITECT_NO_SPAWN;
    delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    t.after(() => {
      if (prior === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
      else process.env.FORGE_ARCHITECT_NO_SPAWN = prior;
    });

    const { root, brainDir } = makeDrainRoot('refuse-kb');
    try {
      // (a) AGENT-tier with no injected turn -> the refusal, BY NAME.
      const agent = fixtureFinding(brainDir, 'agent-residual', 'agent');
      const status = await runKbDrain(root, 'refuse-kb', 'port-refuse', {
        lint: scriptedLint([[agent], [agent]]),
        applyAutoFixes: () => ({ ...EMPTY_AUTO_RESULT, remaining: [agent] }),
      });
      const entry = status.perFinding.find((f) => f.tier === 'agent');
      assert.ok(entry, `expected an agent-tier entry — got ${JSON.stringify(status.perFinding)}`);
      assert.equal(entry!.outcome, 'not-cleared', JSON.stringify(entry));
      assert.match(
        JSON.stringify(status),
        /no fix turn was injected/,
        'the refusal must NAME itself in the run record — a silently uncleared finding is the failure mode this exists to prevent',
      );

      // (b) AUTO-only with no injected turn -> no refusal at all. This is the
      // half the EAGER refusal got wrong, and five drain tests caught it.
      const auto = await runKbDrain(root, 'refuse-kb', 'port-auto', {
        lint: scriptedLint([[], []]),
        applyAutoFixes: () => EMPTY_AUTO_RESULT,
      });
      assert.equal(auto.state, 'green', JSON.stringify(auto));
      assert.doesNotMatch(
        JSON.stringify(auto),
        /no fix turn was injected/,
        'an auto-only drain dispatches no turn, so demanding one is a new precondition, not a check',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
