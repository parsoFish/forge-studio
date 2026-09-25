import assert from 'node:assert/strict';
import test from 'node:test';

import { withIdleDeadline, StreamDeadlineError } from '../../stream-deadline.ts';

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

// ---------------------------------------------------------------------------
// isProgress — bead forge-8vfn.8.1.9 (the Studio architect stall: non-progress
// SDK messages like `tool_progress`/`system` kept resetting this deadline for
// 8.5 minutes with no real progress).
// ---------------------------------------------------------------------------

type SdkLikeMessage = { type: string };

/** Only `assistant`/`result` count as progress — the same rule
 *  `runStructuredTurn`/`runAgentTurn` apply. */
const isSdkProgress = (m: SdkLikeMessage): boolean => m.type === 'assistant' || m.type === 'result';

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Yields `messages` one at a time, `gapMs` apart, then hangs forever
 *  (never resolves, never rejects) — models a stream that keeps producing
 *  SOMETHING without ever producing real progress. */
async function* pingsThenSilent(messages: SdkLikeMessage[], gapMs: number): AsyncGenerator<SdkLikeMessage> {
  for (const m of messages) {
    await delay(gapMs);
    yield m;
  }
  await new Promise<never>(() => {});
}

test('withIdleDeadline: isProgress — only non-progress messages arrive → rejects naming the types and counts seen', async () => {
  const pings: SdkLikeMessage[] = [{ type: 'tool_progress' }, { type: 'tool_progress' }, { type: 'system' }];
  await assert.rejects(
    (async () => {
      // Pings land at t≈10/20/30ms — comfortably inside the 100ms window,
      // which never resets (none of them is progress) and fires at t≈100ms.
      for await (const _m of withIdleDeadline(pingsThenSilent(pings, 10), {
        idleMs: 100,
        label: 'interactive-structured',
        isProgress: isSdkProgress,
      })) {
        void _m;
      }
    })(),
    (err: unknown) => {
      assert.ok(err instanceof StreamDeadlineError, 'expected StreamDeadlineError');
      assert.match((err as Error).message, /stream-deadline/);
      assert.match(
        (err as Error).message,
        /saw only non-progress messages for \d+s: tool_progress×2, system×1/,
        (err as Error).message,
      );
      return true;
    },
  );
});

test('withIdleDeadline: isProgress — an assistant/result message interleaved among pings resets the window, so a stream that finishes cleanly never rejects', async () => {
  // Timeline (gapMs=10, idleMs=150): pings at t≈10/20ms (well inside the
  // initial 150ms window); `assistant` at t≈30ms (safe) RESETS the window to
  // ≈180ms; two more pings at t≈40/50ms (well inside the reset window);
  // `result` at t≈60ms (safe) completes the turn — the window never lapses.
  const messages: SdkLikeMessage[] = [
    { type: 'tool_progress' },
    { type: 'tool_progress' },
    { type: 'assistant' },
    { type: 'tool_progress' },
    { type: 'tool_progress' },
    { type: 'result' },
  ];
  async function* healthyInterleaved(): AsyncGenerator<SdkLikeMessage> {
    for (const m of messages) {
      await delay(10);
      yield m;
    }
  }
  const seen: SdkLikeMessage[] = [];
  await (async () => {
    for await (const m of withIdleDeadline(healthyInterleaved(), {
      idleMs: 150,
      label: 'interactive-structured',
      isProgress: isSdkProgress,
    })) {
      seen.push(m);
    }
  })();
  assert.deepEqual(seen, messages, 'every message — progress and non-progress alike — still reaches the consumer');
});
