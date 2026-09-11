/**
 * `wait: { for: 'settle', key, while }` — T1 ruling 621(ii), bought by lane A's
 * S1 beat 3.
 *
 * THE MEASUREMENT. Three attempts on one head inside fifteen minutes: green,
 * red, green — load-dependent, not a product defect. The red named ONE token of
 * seven: `data-preflight-status: expected "hard-fail", got "pending"`, while
 * `route`, `page`, `project-id`, `page-ready` and both checklist keys all held.
 * On a stale DOM `page` and `project-id` would have failed with it. The beat was
 * on the RIGHT page, honestly ready, reading the right project — only the
 * computed status disagreed.
 *
 * And the timing rules out waiting longer for the PAGE: the last handle log is
 * 15.3 s before the verdict, so the runner had already spent
 * `READY_TIMEOUT_MS`, the page had arrived, and the value was still transient.
 * Only waiting on the VALUE helps.
 *
 * WHY THE VALUE IS DECLARED AND NOT INFERRED. A blanket longer wait sits
 * through `soft-fail` exactly as patiently as through `pending`, and turns a
 * real red into a timeout. Naming the transient keeps the failure sharp: the
 * story says what it is willing to wait out, so a beat can never silently wait
 * out a value it should have failed on. That property is the third test here,
 * and it is the reason the kind takes two required fields instead of one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBeat } from './beats-drive.mjs';
import { validateStory } from './story-file.mjs';

/** A page whose computed status is transient: `pending` until `settlesAfterMs`. */
function preflightPage({ settlesAfterMs, lands = 'hard-fail' }) {
  const startedAt = Date.now();
  const status = () => (Date.now() - startedAt >= settlesAfterMs ? lands : 'pending');
  const locator = (): any => ({
    first: () => locator(),
    count: async () => 1,
    nth: () => locator(),
    evaluateAll: async (fn: any, arg: any) => fn([], arg),
    waitFor: async () => {},
    click: async () => {},
    fill: async () => {},
  });
  return {
    url: () => 'http://localhost:4124/projects/gitweave',
    locator,
    waitForSelector: async () => {},
    goto: async () => {},
    evaluate: async (_fn: unknown, arg?: { wanted?: string[] }) => {
      const all: Record<string, string> = {
        page: 'projects', 'page-ready': 'true', 'project-id': 'gitweave', 'preflight-status': status(),
      };
      const wanted = arg?.wanted ?? null;
      const data = wanted === null ? all : Object.fromEntries(Object.entries(all).filter(([k]) => wanted.includes(k)));
      return { data, nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null };
    },
  };
}

const beat = (wait?: unknown) => ({
  act: 'Onboard the project and read the preflight',
  ...(wait === undefined ? {} : { wait }),
  expect: {
    route: '/projects/gitweave',
    data: { page: 'projects', 'project-id': 'gitweave', 'preflight-status': 'hard-fail' },
  },
  say: 'The preflight computes, and the gate it reports is the one the operator acts on.',
});

const SETTLE = { for: 'settle', key: 'preflight-status', while: 'pending', upTo: 20_000 };

test('621(ii) RED-FIRST: a key still transient at the bound reds without `settle`', async () => {
  // A's beat 3 exactly: the page is right, ready, and one computed key has not
  // finished computing. With no declared wait the beat is judged at the DOM
  // bound and reds on that one token.
  const page = preflightPage({ settlesAfterMs: 1_200 });
  const v = await driveBeat(page as never, beat(), 1, 'http://localhost:4124', {}, 300);

  assert.equal(v.status, 'red');
  assert.match(v.failures.join(' | '), /preflight-status: expected "hard-fail", got "pending"/);
});

test('621(ii): `settle` waits for the NAMED key to leave the DECLARED value', async () => {
  const page = preflightPage({ settlesAfterMs: 1_200 });
  const began = Date.now();
  const v = await driveBeat(page as never, beat(SETTLE), 1, 'http://localhost:4124', {}, 300);
  const took = Date.now() - began;

  assert.equal(v.status, 'green', `failures: ${JSON.stringify(v.failures)}`);
  assert.ok(took >= 1_000, `it actually waited rather than passing by luck — took ${took} ms`);
  assert.ok(took < 10_000, `and it stopped as soon as the value moved — took ${took} ms`);
});

test('621(ii) CONTROL: a genuinely WRONG value is not waited out', async () => {
  // The property the declared transient exists for. `soft-fail` is not
  // `pending`, so the wait ends at once and the beat reds on the truth — where
  // a blanket longer wait would have sat through it to the bound and reported a
  // timeout instead of the mismatch.
  const page = preflightPage({ settlesAfterMs: 0, lands: 'soft-fail' });
  const began = Date.now();
  const v = await driveBeat(page as never, beat(SETTLE), 1, 'http://localhost:4124', {}, 300);
  const took = Date.now() - began;

  assert.equal(v.status, 'red');
  assert.match(v.failures.join(' | '), /preflight-status: expected "hard-fail", got "soft-fail"/);
  assert.ok(took < 5_000, `a wrong value must not be waited out — took ${took} ms of a 20 s bound`);
});

test('621(ii) CONTROL: a value that never settles reds at the declared bound, not before', async () => {
  const page = preflightPage({ settlesAfterMs: 999_999 });
  const began = Date.now();
  const v = await driveBeat(page as never, beat({ ...SETTLE, upTo: 1_500 }), 1, 'http://localhost:4124', {}, 300);
  const took = Date.now() - began;

  assert.equal(v.status, 'red');
  assert.ok(took >= 1_400, `the declared bound is spent before giving up — took ${took} ms`);
  assert.match(v.failures.join(' | '), /got "pending"/);
});

test('621(ii): the kind is fail-closed — both fields required, and refused on an agent wait', () => {
  const story = (wait: unknown) => ({
    id: 'X', title: 't', docs: { kind: 'tutorial', title: 'X' },
    ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
    beats: [{ act: 'a', wait, expect: { route: '/', data: { page: 'home' } }, say: 's' }],
  });
  // A settle wait with no key would silently watch nothing.
  assert.throws(() => validateStory(story({ for: 'settle', upTo: 1000 })), /wait\.key/);
  assert.throws(() => validateStory(story({ for: 'settle', key: 'x', upTo: 1000 })), /wait\.while/);
  // And `key`/`while` on an AGENT wait must refuse rather than be dropped —
  // `validateWait` drops every key it does not name, which is how `fork` is
  // silently discarded today.
  assert.throws(
    () => validateStory(story({ for: 'agent', key: 'x', while: 'y', upTo: 1000 })),
    /only a settle wait takes/,
  );
  // The good shape survives intact, with both fields carried through.
  const ok = validateStory(story({ for: 'settle', key: 'preflight-status', while: 'pending', upTo: 1000 }));
  assert.deepEqual(ok.beats[0].wait, { for: 'settle', upTo: 1000, key: 'preflight-status', while: 'pending' });
});
