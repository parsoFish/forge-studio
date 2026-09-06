/**
 * `log-stamp.mjs` — the runner's lines carry the time they were printed.
 *
 * ACCEPTANCE, pinned against the incident it was bought by. S2 run 9 printed
 * `[data-field="question-freetext"]: present and enabled` throughout a
 * 7 m 41 s wait and the log could not say that any time had passed at all;
 * the gap had to be reconstructed from `questions.json`'s mtime
 * (`23:00:19.132Z`), `answers.json`'s (`23:08:00.399Z`) and `events.jsonl`.
 * These cases kill the implementation that stamps only the runner's OWN
 * `[stories]` lines — the line that mattered was printed by
 * `beats-control-state.mjs`, three modules away.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stamp, stampEveryLine } from './log-stamp.mjs';

const AT = new Date('2026-09-06T23:00:19.132Z');

test('6.11.41c: the stamp is ISO-8601 UTC — the same clock as events.jsonl and a captured mtime', () => {
  // Not a locale string and not epoch millis: a red run is read by putting a
  // log line, an `events.jsonl` `started_at` and a file mtime side by side,
  // and any format that needs converting first is a format nobody converts.
  assert.equal(stamp(AT), '[2026-09-06T23:00:19.132Z]');
});

test('6.11.41c: EVERY line through the sink is stamped, whichever module printed it', () => {
  const lines: string[] = [];
  const sink = { log: (...p: unknown[]) => { lines.push(p.join(' ')); } };
  const restore = stampEveryLine(sink, () => AT);

  // The runner's own line, and the one a module three files away prints.
  sink.log('[stories] S2 — Create a new project from scratch');
  sink.log('[stories] while waiting on [data-field="question-freetext"]: present and enabled');
  restore();

  assert.deepEqual(lines, [
    '[2026-09-06T23:00:19.132Z] [stories] S2 — Create a new project from scratch',
    '[2026-09-06T23:00:19.132Z] [stories] while waiting on [data-field="question-freetext"]: present and enabled',
  ]);
});

test('6.11.41c: the original arguments survive — a stamp must not flatten what a line said', () => {
  const seen: unknown[][] = [];
  const sink = { log: (...p: unknown[]) => { seen.push(p); } };
  const restore = stampEveryLine(sink, () => AT);
  sink.log('a', 2, { c: 3 });
  restore();

  assert.deepEqual(seen, [['[2026-09-06T23:00:19.132Z]', 'a', 2, { c: 3 }]]);
});

test('6.11.41c: `warn` and `error` are stamped too — a refusal is a line whose timing is read', () => {
  // The runner's five refusals go to `console.error` and the sweep's
  // `REFUSING to delete …` to `console.warn`. Kills the implementation that
  // wraps `log` alone: the smoke run measured BOTH of those arriving unstamped
  // beside stamped neighbours. Part of a log stamped is a log that still
  // cannot be put beside `events.jsonl`.
  const out: string[] = [];
  const sink = {
    log: (...p: unknown[]) => { out.push(`log ${p.join(' ')}`); },
    warn: (...p: unknown[]) => { out.push(`warn ${p.join(' ')}`); },
    error: (...p: unknown[]) => { out.push(`err ${p.join(' ')}`); },
  };
  const restore = stampEveryLine(sink, () => AT);
  sink.error('[stories] REFUSING: not enough memory');
  sink.warn('[stories] REFUSING to delete parsoFish/story-s2');
  restore();

  assert.deepEqual(out, [
    'err [2026-09-06T23:00:19.132Z] [stories] REFUSING: not enough memory',
    'warn [2026-09-06T23:00:19.132Z] [stories] REFUSING to delete parsoFish/story-s2',
  ]);
  sink.error('bare');
  sink.warn('bare');
  assert.deepEqual(out.slice(2), ['err bare', 'warn bare'], 'restore puts every wrapped channel back');
});

test('6.11.41c: restoring puts the ORIGINAL sink back, so a second wrap cannot double-stamp', () => {
  const lines: string[] = [];
  const sink = { log: (...p: unknown[]) => { lines.push(p.join(' ')); } };
  const restore = stampEveryLine(sink, () => AT);
  restore();
  sink.log('bare');

  assert.deepEqual(lines, ['bare']);
});
