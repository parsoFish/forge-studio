/**
 * Bead `forge-8vfn.6.11.49` — the demo builder WRITES before it RUNS.
 *
 * WHAT WAS MEASURED. On S1 runs 10 and 11 the demo-builder turn spent its whole
 * `maxTurns: 24` running the project — run 10: 24 Bash calls; run 11, with a
 * focus-only brief that said *do not run the project*: 22 Bash + 2 Read, and it
 * ran the project six times — and wrote neither `.forge/skills/demo-design/
 * SKILL.md` nor `.forge/demo/DEMO.html`, ending `failed` at ~111 s on the
 * missing-artifact throw.
 *
 * WHY GUIDANCE WAS NEVER THE LEVER (ruling 374, with the cause named). The
 * instruction to run the project is not stray guidance a brief can talk the
 * agent out of — it is the kind's own TASK, written into the SKILL.md section
 * every turn loads. The agent obeyed the skill. A brief that contradicts the
 * skill is two instructions fighting, and the skill wins.
 *
 * THE LEVER IS THE TURN'S TOOL SET, PER PASS. One kind turn, two agent passes:
 * pass 1 runs with Bash REMOVED and a small budget and must produce both
 * deliverables; pass 2 runs only if they exist, gets Bash and the rest of the
 * budget, and grounds the sample in real output by EDITING what pass 1 wrote.
 * Burning the budget before writing anything becomes impossible by
 * construction rather than by persuasion — and grounding stays real, which the
 * obvious "just forbid Bash" fix would have destroyed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

import { logger, setup } from './test-fixtures/demo-builder-runner-fixtures.ts';
import {
  runDemoBuilderTurn,
  DEMO_HTML_REL_PATH,
  DEMO_SKILL_REL_PATH,
  DEMO_WRITE_PASS_MAX_TURNS,
} from '../../kinds/demo-builder.ts';
import { type QueryFn } from '../../interactive-session.ts';

type Pass = { allowedTools: string[]; maxTurns: number | undefined; prompt: string };

/**
 * A fake SDK that records each pass's tool set and budget. `writeOn` says which
 * pass (1-based) writes the two deliverables; `null` writes neither — the
 * measured failure, an agent that only ever ran things.
 */
function recordingQueryFn(writeOn: number | null, passes: Pass[]): QueryFn {
  return ({ prompt, options }) => {
    const o = (options ?? {}) as { cwd?: string; allowedTools?: string[]; maxTurns?: number };
    passes.push({ allowedTools: [...(o.allowedTools ?? [])], maxTurns: o.maxTurns, prompt });
    const n = passes.length;
    const cwd = o.cwd ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      if (writeOn !== null && n === writeOn) {
        mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
        mkdirSync(join(cwd, '.forge', 'skills', 'demo-design'), { recursive: true });
        writeFileSync(join(cwd, DEMO_SKILL_REL_PATH), '# demo-design (fixture)');
        writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>sample</body></html>');
      }
      yield { type: 'result', total_cost_usd: 0.02 };
    }
    return gen();
  };
}

test('6.11.49: pass 1 runs with NO Bash and a budget well inside 24 — the agent cannot run the project before it has written anything', async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  const passes: Pass[] = [];

  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, logsRoot,
    queryFn: recordingQueryFn(1, passes), logger: logger(logsRoot, sessionId),
  });

  assert.ok(passes.length >= 1, 'the write pass must run');
  assert.ok(!passes[0].allowedTools.includes('Bash'), `pass 1 must not carry Bash — got ${passes[0].allowedTools.join(', ')}`);
  assert.ok(passes[0].allowedTools.includes('Write'), 'pass 1 keeps the tools it needs to author');
  assert.equal(passes[0].maxTurns, DEMO_WRITE_PASS_MAX_TURNS);
  assert.ok(DEMO_WRITE_PASS_MAX_TURNS < 24, 'the write budget is well inside the old 24-turn one');
});

test('6.11.49: an agent that writes NOTHING fails NAMING both artifacts, inside the write budget — never a silently exhausted 24 turns', async () => {
  const { projectRoot, logsRoot, sessionId, repoPath } = setup();
  const passes: Pass[] = [];

  await assert.rejects(
    () => runDemoBuilderTurn({
      sessionId, projectRoot, forgeRoot: FORGE_ROOT, logsRoot,
      queryFn: recordingQueryFn(null, passes), logger: logger(logsRoot, sessionId),
    }),
    (err: Error) => {
      assert.match(err.message, /\.forge\/skills\/demo-design\/SKILL\.md/, 'the failure names the missing skill');
      assert.match(err.message, /\.forge\/demo\/DEMO\.html/, 'the failure names the missing sample');
      return true;
    },
  );

  assert.equal(passes.length, 1, 'the grounding pass must NOT run once the write pass produced nothing');
  assert.equal(passes[0].maxTurns, DEMO_WRITE_PASS_MAX_TURNS);
  assert.ok(!existsSync(join(repoPath, DEMO_HTML_REL_PATH)));
});

test('6.11.49: once both artifacts exist, a SECOND pass runs WITH Bash and the rest of the budget, to ground the sample', async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  const passes: Pass[] = [];

  const result = await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, logsRoot,
    queryFn: recordingQueryFn(1, passes), logger: logger(logsRoot, sessionId),
  });

  assert.equal(passes.length, 2, 'write pass, then grounding pass');
  assert.ok(passes[1].allowedTools.includes('Bash'), 'grounding needs Bash — a demo that cannot run the project cannot be REAL output');
  assert.ok((passes[1].maxTurns ?? 0) > 0);
  assert.ok(
    (passes[0].maxTurns ?? 0) + (passes[1].maxTurns ?? 0) <= 24,
    'the two passes together spend no more than the single pass they replace',
  );
  assert.equal(result.phase, 'awaiting-review');
});

test('6.11.49: the two passes carry DIFFERENT instructions — the write pass is not told to run the project', async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  const passes: Pass[] = [];

  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, logsRoot,
    queryFn: recordingQueryFn(1, passes), logger: logger(logsRoot, sessionId),
  });

  assert.notEqual(passes[0].prompt, passes[1].prompt, 'two passes, two tasks');
  // The measured defect in one assertion: the instruction to check out, build
  // and RUN the project belongs to the pass that has Bash, not to the one that
  // must author two files first.
  assert.doesNotMatch(passes[0].prompt, /check out \/ build \/ run/i, 'the write pass is not told to run anything');
  assert.match(passes[1].prompt, /check out \/ build \/ run/i, 'the grounding pass is');
});
