/**
 * A `wait` declared in a story reaches the waiter INTACT — `forge-8vfn.7.6.82`,
 * T1 ruling 883.
 *
 * WHAT WAS BROKEN. `validateWait` validated `anchor` at `story-file.mjs:205-211`
 * — its refusal text there even says a misplaced one "would be dropped
 * silently" — and then dropped it, because the function rebuilds every wait
 * from a fixed field list and the returned object named only `for` and `upTo`.
 *
 * WHY THAT WAS WORSE THAN AN INERT FIELD. `beats-anchor.mjs:37` treats an
 * absent anchor as "use the wait's own start", which is the fallback its own
 * comment forbids: *"REFUSE, NEVER FALL BACK. A silent fallback to the wait's
 * start restores exactly the defect this exists to fix, and does it invisibly:
 * the beat reds `no-channel` again and the verdict is indistinguishable from a
 * real one."* So `S10.story.mjs:398` — `anchor: 'scheduler-start'`, the only
 * anchored wait in any shipped story — took the pre-718(1) search window on
 * every run since it landed, and the typo-catching refusal at `:46` was
 * unreachable because the field never arrived to be wrong.
 *
 * WHY FOUR GOOD DOORS MISSED IT. `beats-anchor.test.ts` proves `resolveAnchorMs`
 * exactly right — and every one of its cases hand-builds `{ for: 'agent',
 * anchor: … }` and passes it straight in. Nothing anywhere passed a wait that
 * had been through `validateStory`. Both halves correct in isolation; the
 * defect lived only in the composition. Identical shape to `forge-8vfn.7.6.52`:
 * `classifyOwnGroundDrift` and `groundIgnoreFromGit` each doored, never
 * composed, every door passing a stub.
 *
 * SO THE FIRST DOOR BELOW IS DELIBERATELY NOT A LIST OF FIELDS. Asserting
 * "`anchor` survives" would fix this bug and leave the next one exactly as
 * reachable — the failure is the REBUILD pattern, not the field. It deep-equals
 * the whole validated wait against what the story declared, so any field added
 * to validation but forgotten in the return reds here without anyone
 * remembering to extend a list.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateStory } from './story-file.mjs';
import { resolveAnchorMs } from './beats-anchor.mjs';

/** A minimal valid story carrying one beat whose wait is the subject. */
function storyWithWait(wait: Record<string, unknown>) {
  return {
    id: 'carry',
    ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
    docs: { kind: 'how-to' as const, title: 'carry-through' },
    beats: [
      {
        act: 'press the thing and wait for the agent',
        do: [{ press: 'scheduler-start' }],
        wait,
        expect: { route: '/x', data: { page: 'p' } },
        say: 'a beat that waits',
      },
    ],
  };
}

/** Every wait shape a story may validly declare. The meta-door below proves
 *  this list covers every field `validateWait` inspects, so it cannot silently
 *  fall behind the validator. */
const VALID_SHAPES: Record<string, unknown>[] = [
  { for: 'agent', upTo: 1_000 },
  { for: 'agent', upTo: 1_000, anchor: 'scheduler-start' },
  { for: 'settle', upTo: 1_000, key: 'preflight-status', while: 'pending' },
  // 7.6.77's shape, added because the meta-door below DEMANDED it: the moment
  // `validateWait` began inspecting `perTransition`/`progressKey`, that door
  // red-ed naming both fields, without anyone remembering to extend this list.
  // That is the whole reason it derives its population from the validator's
  // source instead of trusting this array.
  { for: 'agent', upTo: 600_000, perTransition: 480_000, progressKey: 'architect-turns' },
  // 7.6.143's shape, added because the meta-door below DEMANDED it the moment
  // `validateWait` began inspecting `cycleOf` — the third time this list has
  // been extended by its own door rather than by someone remembering. `cycleOf`
  // names the initiative whose EXISTING cycle a beat watches, for the case the
  // anchor form cannot express: the develop station CONTINUES the architect's
  // cycle, so no dispatch dir is born after the press. It is only legal beside
  // `terminal`, which is what watches a cycle at all.
  { for: 'agent', upTo: 1_800_000, terminal: 'ready-for-review', cycleOf: 'INIT-x' },
  // 7.6.118's shapes, added because the meta-door below DEMANDED them the
  // moment `validateWait` began inspecting `boundBasis`/`terminal` — the same
  // way 7.6.77's arrived. Two shapes, not one: `terminal` must survive on the
  // `settle` branch too, and that branch RETURNS before the checks below it,
  // which is the exact mechanism that dropped `perTransition` (7.6.82) and
  // `anchor` before it. A single agent-shaped entry would leave the settle
  // return path untested while reading as coverage.
  { for: 'agent', upTo: 1_800_000, terminal: 'ready-for-review', boundBasis: 'MAX_DECLARED_WAIT_MS binding at 1800000 ms; ground.budget_usd $35 would afford 4175439 ms' },
  { for: 'settle', upTo: 1_000, key: 'preflight-status', while: 'pending', terminal: 'ready-for-review', boundBasis: 'derived from ground.budget_usd $5' },
];

describe('7.6.82 — a declared wait arrives at the waiter intact', () => {
  // THE GENERALISING DOOR. No field names on the assertion side: whatever a
  // story may validly declare must come back identical.
  for (const wait of VALID_SHAPES) {
    test(`every field of ${JSON.stringify(wait)} survives validateStory`, () => {
      const v = validateStory(storyWithWait(wait)) as { beats: { wait: unknown }[] };
      assert.deepEqual(
        v.beats[0]!.wait, wait,
        'validateWait rebuilds the wait from a fixed field list, so a field it validates but does not ' +
        'name in the returned object is dropped SILENTLY — which is how `anchor` reached production ' +
        'validated and discarded. Deep-equal rather than a per-field check: a list only protects the ' +
        'fields someone remembered to add to it.',
      );
    });
  }

  // THE S10-SHAPED DOOR. The consequence, end to end: a story declares an
  // anchored wait, it goes through the real validator, and the real resolver
  // returns the ANCHOR's press time — not the wait's own start, which is the
  // forbidden fallback and what S10 has been silently getting.
  test('S10\'s shape: an anchored wait resolves from the press, not from the wait\'s start', () => {
    const declared = { for: 'agent', upTo: 600_000, anchor: 'scheduler-start' };
    const v = validateStory(storyWithWait(declared)) as { beats: { wait: { for?: string; anchor?: string } }[] };

    const pressedAt = new Map([['scheduler-start', 1_000]]);
    const waitStartedMs = 5_000;
    assert.equal(
      resolveAnchorMs(v.beats[0]!.wait, pressedAt, waitStartedMs), 1_000,
      'the search window opens at the press this beat is watching (718(1)); returning 5000 here is ' +
      '`beats-anchor.mjs:37`\'s fallback, which its own comment forbids because the resulting red is ' +
      'indistinguishable from a real one',
    );
  });

  test('and a validated anchor naming a press that never happened still REFUSES', () => {
    // The typo branch was unreachable while the field was being dropped: you
    // cannot refuse a value that never arrives. It has to work through the real
    // validator, or the refusal is only ever exercised by hand-built objects.
    const v = validateStory(storyWithWait({ for: 'agent', upTo: 1_000, anchor: 'never-pressed' })) as {
      beats: { wait: { for?: string; anchor?: string } }[];
    };
    assert.throws(
      () => resolveAnchorMs(v.beats[0]!.wait, new Map([['something-else', 1_000]]), 5_000),
      /never-pressed/,
      'a story naming a press no beat performs must fail loudly, not degrade to the old behaviour',
    );
  });

  // THE LIST IS ITSELF A POPULATION, AND THAT IS THE GAP C NAMED ON REVIEW.
  // The doors above generalise over FIELDS — deep-equal, no field named on the
  // assertion side — but they iterate a hand-written array of SHAPES. So a new
  // field arriving on a shape nobody added sits outside the very door built to
  // catch it, which is tonight's recurring failure exactly: the population did
  // not include the thing that was wrong.
  //
  // So the array is checked against the validator's own source. Every `raw.<f>`
  // that `validateWait` inspects must appear in at least one shape above. It
  // reds the moment someone validates a field no shape exercises — including
  // 7.6.77's `perTransition`/`progressKey` — and it refuses rather than passes
  // if it cannot find the function to read.
  test('the shape list covers every field validateWait inspects', () => {
    const src = readFileSync(new URL('./story-wait-schema.mjs', import.meta.url), 'utf8');
    const body = /^function validateWait\([\s\S]*?^}/m.exec(src)?.[0];
    assert.ok(body, 'could not locate validateWait in story-wait-schema.mjs — refusing rather than reporting a vacuous pass');

    const inspected = new Set([...body.matchAll(/raw\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!));
    const covered = new Set(VALID_SHAPES.flatMap((w) => Object.keys(w)));
    const missing = [...inspected].filter((f) => !covered.has(f)).sort();

    assert.deepEqual(missing, [],
      `validateWait inspects ${missing.join(', ')}, which no shape in VALID_SHAPES declares — so the ` +
      'carry-through doors never exercise it. Add a shape that uses it (that is what keeps the doors ' +
      'honest), or the field can be validated and dropped exactly as `anchor` was.');
  });
});

/*
 * `forge-8vfn.27` — the wiring, not the function.
 *
 * S10 run 16 died at beat 8 with `wait anchor "scheduler-start": no beat pressed
 * it before this wait (pressed so far: none)` after four beats had pressed. The
 * cause was not `resolveAnchorMs`, which the doors above prove correct: it was
 * that the RUNNER never threaded a map into `driveBeat`. The ninth parameter
 * defaults to a fresh `new Map()`, so every beat got its own, the write was
 * discarded when the call returned, and the read could never find anything.
 * `git log -S'pressedAt'` on the runner returned NOTHING — it had never been
 * passed in any commit, so 718(1)'s anchor had not worked once since the commit
 * that introduced it.
 *
 * WHY THE DOORS ABOVE COULD NOT CATCH IT, and it is the species this campaign
 * keeps meeting: they build their own map — `new Map([['scheduler-start', 1000]])`
 * — and call `resolveAnchorMs` directly. A fixture that constructs the shape
 * itself cannot fail on a producer that never fills it.
 *
 * WHY THIS IS A SOURCE DOOR AND WHAT THAT COSTS, stated rather than hidden:
 * `driveBeat` needs a live Playwright page, so a two-beat behavioural door would
 * need a browser and this file has none. This asserts the WIRING'S TEXT, which is
 * weaker than asserting its behaviour — it would not catch a thread that passes
 * the wrong map. It anchors through `runnerSourceContaining` rather than on a
 * filename, because three doors in this suite broke when `forge-0fli` moved the
 * beat loop to `run-story.mjs` and the filename was the one location still
 * pinned. The behavioural proof is a run whose beat 8 resolves its anchor.
 */
describe('forge-8vfn.27: the runner threads ONE pressedAt across the beat loop', () => {
  test('the runner module that drives beats passes a ninth argument to driveBeat', async () => {
    const { runnerSourceContaining } = await import('./runner-source.mjs');
    const { source, path } = runnerSourceContaining('await driveBeat(');
    const call = /await driveBeat\(([^;]*?)\);/s.exec(source);
    assert.ok(call, `no driveBeat call found in ${path}`);
    const args = call[1]!.split(',').map((a) => a.trim());
    // EXACT, not `>=`. 7.6.118 moved it from 9 to 10, T1 1471 moved it from 10
    // to 11, and T1 1545 moved it from 11 to 12 — each move is the door
    // working rather than the door being wrong: a new trailing argument with a
    // default is exactly how an earlier one could be dropped silently, so each
    // one costs a deliberate edit here. Every position is named — an arity
    // that matches with the arguments transposed would be the same defect
    // wearing the right number.
    assert.equal(
      args.length,
      12,
      `driveBeat takes twelve parameters and the runner passed ${args.length} — the ninth defaults to a ` +
        `fresh Map, so omitting it gives every beat its own and wait.anchor can never resolve (run 16); ` +
        `the tenth builds the per-beat cycle watch (7.6.118); the eleventh is the run's own $ guard for an ` +
        `agent wait's poll loop (T1 1471); the twelfth is \`forgeRoot\`, which lets a repeat's per-transition ` +
        `bound reset on its own session's \`events.jsonl\` growth, not only on its progress key (T1 1545). ` +
        `Got: ${call[1]}`,
    );
    assert.equal(args[8], 'pressedAt', `the ninth argument must be the shared map, got ${args[8]}`);
    assert.equal(args[9], 'cycleWatchFor', `the tenth must be the per-beat watch factory, got ${args[9]}`);
    assert.equal(args[10], 'waitSpendGuard', `the eleventh must be the wait's own $ guard, got ${args[10]}`);
    assert.equal(args[11], 'costlessGuard.active ? null : ROOT',
      `the twelfth must be forgeRoot, withheld exactly like the stall door for a costless beat, got ${args[11]}`);
  });

  test('that map is declared OUTSIDE the loop — one per run, not one per beat', async () => {
    const { runnerSourceContaining } = await import('./runner-source.mjs');
    const { source } = runnerSourceContaining('await driveBeat(');
    const decl = source.indexOf('const pressedAt = new Map()');
    // Anchors the loop's OWN OPENING, not its exact destructuring shape: the
    // fork verb (T1 ruling 1350) wraps `story.beats` in `expandForkedBeats(...)`
    // so the beat loop no longer reads `for (const [i, beat] of
    // story.beats.entries())` verbatim — `pressedAt` itself is untouched, still
    // declared once before this same loop, so the anchor moves rather than the
    // property it is proving.
    const loop = source.indexOf('expandForkedBeats(story.beats,');
    assert.ok(decl !== -1, 'the runner must declare its own pressedAt map');
    assert.ok(loop !== -1, 'the beat loop must still be findable');
    assert.ok(
      decl < loop,
      'the map is declared INSIDE the beat loop — that is one map per beat, which is the defect with ' +
        'extra steps: each iteration would rebind it and the anchor would still resolve nothing',
    );
  });
});
