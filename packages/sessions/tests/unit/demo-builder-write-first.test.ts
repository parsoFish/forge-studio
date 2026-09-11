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
import { runDemoBuilderTurn } from '../../kinds/demo-builder.ts';
import { DEMO_WRITE_PASS_MAX_TURNS, DEMO_READ_PASS_MAX_TURNS } from '../../kinds/demo-generate.ts';
import { DEMO_HTML_REL_PATH, DEMO_SKILL_REL_PATH } from '../../kinds/demo-session-store.ts';
import { type QueryFn } from '../../interactive-session.ts';

type CanUseTool = (t: string, i: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>;
type Pass = { allowedTools: string[]; disallowedTools: string[]; maxTurns: number | undefined; prompt: string; canUseTool?: CanUseTool };

/**
 * A fake SDK that records each pass's tool set and budget. `writeOn` says which
 * pass (1-based) writes the two deliverables; `null` writes neither — the
 * measured failure, an agent that only ever ran things.
 */
function recordingQueryFn(writeOn: number | null, passes: Pass[]): QueryFn {
  return ({ prompt, options }) => {
    const o = (options ?? {}) as { cwd?: string; allowedTools?: string[]; disallowedTools?: string[]; maxTurns?: number; canUseTool?: CanUseTool };
    passes.push({
      allowedTools: [...(o.allowedTools ?? [])], disallowedTools: [...(o.disallowedTools ?? [])],
      maxTurns: o.maxTurns, prompt,
      // 703 — the fence is where the write pass's real permissions now live, so
      // a recorder that captured only the advisory lists could no longer see
      // what this turn may do.
      ...(o.canUseTool !== undefined ? { canUseTool: o.canUseTool } : {}),
    });
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
  // THE LOAD-BEARING ASSERTION, and it is not the one below it. Bead
  // `forge-8vfn.7.3.6`: the first cut of this fix removed Bash from
  // `allowedTools` only, and TWO funded S1 runs measured pass 1 calling Bash
  // anyway — run 1 six Read + 2 Bash, run 2 four Bash + one Glob + three Read,
  // all eight turns spent, neither artifact written. `interactive-session.ts`
  // says why in its own doc comment, three lines above the parameter that fix
  // used: "`allowedTools` on its own is NOT a fence: it is auto-allow-without-
  // prompting, not a restriction … a caller relying on `allowedTools` alone
  // gets no code-level enforcement at all". `disallowedTools` is the lever
  // that removes a tool from the model's context. Asserting the advisory field
  // is how a test agrees with the bug it was written to catch.
  assert.ok(passes[1].disallowedTools.includes('Bash'), `pass 1 must DENY Bash — got disallowedTools ${passes[1].disallowedTools.join(', ') || '(none)'}`);
  assert.ok(!passes[1].allowedTools.includes('Bash'), `pass 1 must not carry Bash — got ${passes[1].allowedTools.join(', ')}`);
  // AMENDED by 703: the write pass is now write-root AND read-root FENCED to
  // `.forge/demo/` + `.forge/skills/demo-design/`, and a fenced turn STRIPS the
  // gated names from `allowedTools` on purpose — a name left there is
  // pre-approved by the SDK and would never reach the callback that scopes it
  // (`session-write-fence.ts`: "a fence is three settings, not one"). So the
  // property "it can still author" is asserted at the CALLBACK, below, where it
  // now lives, rather than at a list that no longer decides it.
  assert.ok(!passes[1].allowedTools.includes('Write'), 'a fenced turn strips the gated name so the SDK routes it to the fence');
  assert.equal(typeof passes[1].canUseTool, 'function', 'and the fence is installed');
  assert.equal(passes[1].maxTurns, DEMO_WRITE_PASS_MAX_TURNS);
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

  assert.equal(passes.length, 2, 'read then write ran; the grounding pass must NOT run once the write pass produced nothing');
  assert.equal(passes[1].maxTurns, DEMO_WRITE_PASS_MAX_TURNS);
  assert.ok(!existsSync(join(repoPath, DEMO_HTML_REL_PATH)));
});

test('6.11.49: once both artifacts exist, a SECOND pass runs WITH Bash and the rest of the budget, to ground the sample', async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  const passes: Pass[] = [];

  const result = await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, logsRoot,
    queryFn: recordingQueryFn(1, passes), logger: logger(logsRoot, sessionId),
  });

  assert.equal(passes.length, 3, 'read pass, write pass, then grounding pass');
  assert.ok(passes[2].allowedTools.includes('Bash'), 'grounding needs Bash — a demo that cannot run the project cannot be REAL output');
  assert.ok(!passes[2].disallowedTools.includes('Bash'), 'the grounding pass must NOT deny Bash — the deny is per-pass, not for the turn');
  assert.ok((passes[2].maxTurns ?? 0) > 0);
  assert.ok(
    (passes[1].maxTurns ?? 0) + (passes[2].maxTurns ?? 0) <= 24,
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

  assert.notEqual(passes[1].prompt, passes[2].prompt, 'two passes, two tasks');
  // The measured defect in one assertion: the instruction to check out, build
  // and RUN the project belongs to the pass that has Bash, not to the one that
  // must author two files first.
  assert.doesNotMatch(passes[1].prompt, /check out \/ build \/ run/i, 'the write pass is not told to run anything');
  assert.match(passes[2].prompt, /check out \/ build \/ run/i, 'the grounding pass is');
});

test('7.3.6: the WRITE pass has no read door at all — Bash was never the only one', async () => {
  // THE ASSERTION THIS FILE EXISTS FOR, one bead later. 6.11.49 denied Bash so
  // the agent 'cannot run the project before it has written anything'. S1 run 4
  // measured what that left: 1 TodoWrite + 2 Glob + 6 Read in eight seconds,
  // the whole 8-turn budget spent, not one write attempted. Denying Bash
  // removed run-instead-of-write; Read, Glob, Grep and TodoWrite were still
  // open, and that is where the budget went. A deny list that leaves ANY read
  // door open is #558 again, so this pins the whole list rather than one entry.
  const { projectRoot, repoPath, logsRoot, sessionId } = setup();
  const passes: Pass[] = [];
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: recordingQueryFn(2, passes), logger: logger(logsRoot, sessionId),
  });

  const write = passes[1]!;
  // AMENDED by T1 ruling 703 — `Read` LEFT this list. §15.397: a deny that makes
  // a required protocol step impossible is a trap, not a fence. S1 run 6
  // measured the trap: the SDK refuses `Write` to a file that already exists
  // unless the turn has Read it, so the agent created `SKILL.md`, could not
  // re-Write it, concluded "the tool is blocking writes to new files too", fell
  // back to `Edit` — which only works on files that exist — and looped on the
  // one file it had. `DEMO.html` was never attempted. Read is now PATH-SCOPED
  // to the pass's own two roots and refused everywhere else, which is asserted
  // at the callback below.
  for (const door of ['Bash', 'Glob', 'Grep', 'TodoWrite']) {
    assert.ok(write.disallowedTools.includes(door), `the write pass must DENY ${door} — got ${write.disallowedTools.join(', ') || '(none)'}`);
    assert.ok(!write.allowedTools.includes(door), `the write pass must not CARRY ${door} — got ${write.allowedTools.join(', ')}`);
  }
  assert.ok(!write.allowedTools.includes('Write'), 'the fence strips the gated name so the SDK routes it to the callback (703)');

  // WHERE THE PASS'S REAL PERMISSIONS NOW LIVE. 703 scoped `Read` to the two
  // directories this pass exists to fill instead of denying it outright, because
  // the SDK refuses `Write` to an existing file unless the turn has Read it —
  // so the old blanket deny made a required protocol step impossible (§15.397),
  // and S1 run 6 measured the agent looping on `Edit` because of it.
  const fence = write.canUseTool!;
  assert.equal((await fence('Write', { file_path: `${repoPath}/.forge/demo/DEMO.html`, content: 'x' }, {})).behavior, 'allow', 'it can still author, in its own root');
  const readIn = await fence('Read', { file_path: `${repoPath}/.forge/skills/demo-design/SKILL.md` }, {});
  assert.equal(readIn.behavior, 'allow', 'and re-read what it wrote, which is what the Write-after-Read rule demands');
  const readOut = await fence('Read', { file_path: `${repoPath}/README.md` }, {});
  assert.equal(readOut.behavior, 'deny', 'but nowhere else — the scope is the fence, not the absence of one');
  assert.match(String(readOut.message), /read-root fence/, 'and the refusal says which fence refused it');

  // And the reading it needs happens first, bounded, with writes denied there.
  const read = passes[0]!;
  assert.ok(read.allowedTools.includes('Read') && read.allowedTools.includes('Glob'), 'the read pass can read');
  for (const w of ['Write', 'Edit']) {
    assert.ok(read.disallowedTools.includes(w), `the read pass must DENY ${w} — a pass that can write is not a read pass`);
  }
  assert.equal(read.maxTurns, DEMO_READ_PASS_MAX_TURNS);
});

test('forge-a9o9: the write pass denies the doors the PRODUCT NEVER DECLARED — LSP, TaskOutput, Skill', async () => {
  // MEASURED, S1 run 5 (evidence/m6-a-S1-run5/_demo-.../events.jsonl). The test
  // above pins the five doors 7.3.6 knew about and the write pass STILL read:
  //
  //   TaskOutput -> LSP -> Glob -> Skill(glob) -> Write -> Edit -> LSP
  //
  // Four of seven calls hunting for a way to read, three of them through tools
  // that appear NOWHERE in this repo — not in an allowed-tools list, not in a
  // disallowed-tools list, not in any kind's spec. The SDK ships them anyway.
  // The agent said so itself, in the run's own log: "The tools available are
  // Read, Grep, Glob, Bash, Write, Edit per the skill spec — but the environment
  // only has a subset. Let me use what's actually available."
  //
  // So the deny list is incomplete BY CONSTRUCTION, not by oversight: it can
  // only name tools its authors have heard of. This test closes the three doors
  // that were measured open. It does not — cannot — close the next three, and
  // that is the point of the structural fix (`forge-a9o9`, T1 ruling 662(ii)):
  // deny by default, from the SDK's real surface, so an undeclared tool is
  // refused without anyone having to name it here first.
  const { projectRoot, logsRoot, sessionId } = setup();
  const passes: Pass[] = [];
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: recordingQueryFn(2, passes), logger: logger(logsRoot, sessionId),
  });

  const write = passes[1]!;
  for (const door of ['LSP', 'TaskOutput', 'Skill']) {
    assert.ok(
      write.disallowedTools.includes(door),
      `the write pass must DENY ${door} — it was USED to read on S1 run 5. Got: ${write.disallowedTools.join(', ') || '(none)'}`,
    );
    assert.ok(!write.allowedTools.includes(door), `the write pass must not CARRY ${door} — got ${write.allowedTools.join(', ')}`);
  }

  // The read pass keeps them: it is ALLOWED to read, so an undeclared read door
  // is not a defect there. Pinning this stops the fix being over-applied into
  // the one pass whose whole job is reading.
  assert.ok(!passes[0]!.disallowedTools.includes('LSP'), 'the READ pass is not harmed by a read door — do not deny it there');
});

test('forge-a9o9: the write pass is TOLD what it holds, so it stops hunting for a door', async () => {
  // The other half of the same measurement, and the reason denying three more
  // names is not enough on its own. The agent did not guess it had read tools —
  // it READ that it did. `loadSkillTurnPrompt` returns `${base}\n\n${section}`,
  // and `base` is everything above the first turn marker: the SKILL.md
  // frontmatter included, `allowed-tools: [Read, Grep, Glob, Bash, Write, Edit]`
  // and all. That line is TRUE of the kind and FALSE of this pass, and the agent
  // believed the frontmatter over its own tool-call failures for four calls.
  //
  // The read pass has said `## This turn: READ ONLY` since #630. The write pass
  // was given no such header and inherited the contradiction instead. This pins
  // the matching one.
  const { projectRoot, logsRoot, sessionId } = setup();
  const passes: Pass[] = [];
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: recordingQueryFn(2, passes), logger: logger(logsRoot, sessionId),
  });

  const write = passes[1]!.prompt;
  assert.match(write, /## This turn: WRITE ONLY/, 'the write pass declares itself, as the read pass does');
  assert.match(write, /no Read, Grep, Glob, Bash/i, 'and names the doors it does not have, against a frontmatter that says it does');
  // The deliverable the pass kept failing to produce is the one the SKILL
  // describes as "produced by running that generator" — with Bash denied, that
  // reading is unfollowable. The same SKILL sentence also says the captured
  // output is left as MARKED PLACEHOLDERS for the grounding pass, which is the
  // half this pass can actually do. The header says which half is this turn's.
  assert.match(write, /placeholder/i, 'it says how to produce the sample WITHOUT running anything');
});
