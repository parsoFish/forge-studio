/**
 * SDK stream idle-deadline (known-gaps 2026-06-01 — the betterado roadmap stall).
 *
 * A usage-limit / network stall makes the Claude Agent SDK `query()` stream go
 * SILENT indefinitely — no assistant / tool_use / result message ever arrives —
 * so a bare `for await (const msg of query(...))` hangs FOREVER. In the betterado
 * roadmap run this silently halted a cycle mid-PM (and, because recovery only
 * runs inside the live scheduler loop, stranded the whole queue) with no
 * escalation. There was no timeout/abort anywhere on the SDK stream loops.
 *
 * `withIdleDeadline` wraps the stream so that if no message arrives within
 * `idleMs`, it ABORTS the underlying query (via the SDK's `AbortController`,
 * which kills the CLI subprocess) and THROWS `StreamDeadlineError` — routing the
 * stall into the existing `cycle.ts` catch → `failure-classifier` (transient) →
 * auto-retry machinery instead of an infinite hang.
 *
 * It is an IDLE gap, NOT a total wall-clock: every message the agent streams
 * resets the window, so a legitimately long-but-progressing call is never
 * killed — only a genuine no-output stall trips it.
 */

export class StreamDeadlineError extends Error {
  readonly label: string;
  readonly idleMs: number;
  constructor(label: string, idleMs: number) {
    super(
      `stream-deadline: SDK stream '${label}' produced no message for ${Math.round(idleMs / 1000)}s — ` +
        'aborted as a likely usage-limit / network stall (transient; routes to auto-retry).',
    );
    this.name = 'StreamDeadlineError';
    this.label = label;
    this.idleMs = idleMs;
  }
}

/**
 * Generous default idle window. The longest plausible SILENT stretch in a
 * healthy call is one long tool execution (a build / test run) between
 * messages — comfortably under 6 min — while a usage-limit hang is unbounded.
 * Callers may override (e.g. from a project's heartbeat config).
 */
export const DEFAULT_IDLE_DEADLINE_MS = 6 * 60_000;

const DEADLINE = Symbol('idle-deadline');

export async function* withIdleDeadline<T>(
  stream: AsyncIterable<T>,
  opts: { idleMs?: number; label: string; abortController?: AbortController },
): AsyncGenerator<T> {
  const idleMs = opts.idleMs && opts.idleMs > 0 ? opts.idleMs : DEFAULT_IDLE_DEADLINE_MS;
  const iterator = stream[Symbol.asyncIterator]();
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof DEADLINE>((res) => {
      timer = setTimeout(() => res(DEADLINE), idleMs);
    });
    let res: IteratorResult<T> | typeof DEADLINE;
    try {
      res = await Promise.race([iterator.next(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res === DEADLINE) {
      try {
        opts.abortController?.abort();
      } catch {
        /* aborting is best-effort — we throw regardless */
      }
      throw new StreamDeadlineError(opts.label, idleMs);
    }
    if (res.done) return;
    yield res.value;
  }
}
