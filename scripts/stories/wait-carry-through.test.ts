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
    const src = readFileSync(new URL('./story-file.mjs', import.meta.url), 'utf8');
    const body = /^function validateWait\([\s\S]*?^}/m.exec(src)?.[0];
    assert.ok(body, 'could not locate validateWait in story-file.mjs — refusing rather than reporting a vacuous pass');

    const inspected = new Set([...body.matchAll(/raw\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!));
    const covered = new Set(VALID_SHAPES.flatMap((w) => Object.keys(w)));
    const missing = [...inspected].filter((f) => !covered.has(f)).sort();

    assert.deepEqual(missing, [],
      `validateWait inspects ${missing.join(', ')}, which no shape in VALID_SHAPES declares — so the ` +
      'carry-through doors never exercise it. Add a shape that uses it (that is what keeps the doors ' +
      'honest), or the field can be validated and dropped exactly as `anchor` was.');
  });
});
