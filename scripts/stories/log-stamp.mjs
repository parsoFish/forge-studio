/**
 * Every runner line carries the wall-clock time it was printed.
 *
 * Bead `forge-8vfn.6.11.41` (c), T1 ruling 362. S2 run 9's 7 m 41 s gap had to
 * be reconstructed AFTERWARDS from file mtimes and `events.jsonl`, because the
 * runner's own log — which watched the whole thing and printed
 * `present and enabled` throughout — said nothing about WHEN. A run that
 * cannot say when it was waiting cannot diagnose a wait, and that cost a
 * funded run's diagnosis a second funded run.
 *
 * Stamped ONCE, at the entry point, rather than at the twenty-two call sites:
 * one place to be right, and every module the runner loads is covered without
 * knowing about this one. ISO-8601 UTC so a line lines up with
 * `events.jsonl`'s `started_at` and with a captured file's mtime without any
 * conversion — those are the three clocks a red run is read against.
 *
 * Its own module rather than a private function in `run.mjs` for one reason: a
 * test cannot import `run.mjs`, which runs a story on import.
 */

/** The stamp itself, so a test pins the FORMAT and not just the wrapping. */
export function stamp(at = new Date()) {
  return `[${at.toISOString()}]`;
}

/**
 * Wrap every channel the runner prints on so each line is preceded by
 * `stamp()`.
 *
 * `log`, `warn` AND `error` — every channel the runner actually prints on,
 * enumerated from its own call sites rather than assumed. The five refusals go
 * to `console.error` and the sweep's `REFUSING to delete …` goes to
 * `console.warn`; those are the lines that say a run declined to do something,
 * which are exactly the lines whose timing is read afterwards. A stamp on part
 * of the output is a log that still cannot be put beside `events.jsonl`.
 *
 * @param {{log: Function, warn?: Function, error?: Function}} sink
 *
 * Returns the restore function. It captures the CURRENT functions and puts
 * them back, so a second wrap cannot double-stamp a line the first already
 * stamped.
 *
 * defaults to the real console.
 * @param {() => Date} now                          injectable clock, for the test
 */
export function stampEveryLine(sink = console, now = () => new Date()) {
  const original = {};
  for (const channel of ['log', 'warn', 'error']) {
    if (typeof sink[channel] !== 'function') continue;
    const write = sink[channel].bind(sink);
    original[channel] = sink[channel];
    sink[channel] = (...parts) => write(stamp(now()), ...parts);
  }
  return () => { for (const [c, fn] of Object.entries(original)) sink[c] = fn; };
}
