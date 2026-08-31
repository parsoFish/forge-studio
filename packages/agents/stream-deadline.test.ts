import assert from 'node:assert/strict';
import test from 'node:test';

import { withIdleDeadline, StreamDeadlineError } from './stream-deadline.ts';

/** A stream that yields the given values then NEVER settles (a stall). */
function stallAfter<T>(values: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let i = 0;
      return {
        next(): Promise<IteratorResult<T>> {
          if (i < values.length) return Promise.resolve({ value: values[i++], done: false });
          return new Promise<IteratorResult<T>>(() => {}); // never resolves — the stall
        },
      };
    },
  };
}

/** A stream that yields all values then completes cleanly. */
async function* healthy<T>(values: T[]): AsyncGenerator<T> {
  for (const v of values) yield v;
}

test('withIdleDeadline: passes through a healthy stream unchanged', async () => {
  const out: number[] = [];
  for await (const v of withIdleDeadline(healthy([1, 2, 3]), { idleMs: 1000, label: 'test' })) {
    out.push(v);
  }
  assert.deepEqual(out, [1, 2, 3]);
});

test('withIdleDeadline: throws StreamDeadlineError + aborts when the stream stalls', async () => {
  const ac = new AbortController();
  const seen: number[] = [];
  await assert.rejects(
    (async () => {
      for await (const v of withIdleDeadline(stallAfter([7]), {
        idleMs: 40,
        label: 'project-manager',
        abortController: ac,
      })) {
        seen.push(v);
      }
    })(),
    (err: unknown) => {
      assert.ok(err instanceof StreamDeadlineError, 'expected StreamDeadlineError');
      assert.match((err as Error).message, /stream-deadline/);
      assert.match((err as Error).message, /project-manager/);
      return true;
    },
  );
  // It consumed the one real message before the stall, and aborted the query.
  assert.deepEqual(seen, [7]);
  assert.equal(ac.signal.aborted, true, 'the SDK query must be aborted on deadline');
});

test('withIdleDeadline: a stall that never yields anything still trips the deadline', async () => {
  await assert.rejects(
    (async () => {
      for await (const _v of withIdleDeadline(stallAfter<number>([]), { idleMs: 30, label: 'ralph-iteration' })) {
        void _v;
      }
    })(),
    StreamDeadlineError,
  );
});
