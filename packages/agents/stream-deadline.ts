/**
 * SDK stream idle-deadline (known-gaps 2026-06-01 — the betterado roadmap stall).
 *
 * A usage-limit / network stall makes the Claude Agent SDK `query()` stream go
 * SILENT indefinitely — no assistant / tool_use / result message ever arrives —
 * so a bare `for await (const msg of query(...))` hangs FOREVER, silently
 * stranding a cycle with no escalation. `withIdleDeadline` wraps the stream so
 * that if no message arrives within `idleMs`, it ABORTS the underlying query
 * (the SDK's `AbortController`, which kills the CLI subprocess) and THROWS
 * `StreamDeadlineError` — routing the stall into `failure-classifier`
 * (transient) → auto-retry instead of an infinite hang.
 *
 * It is an IDLE gap, not a wall clock: every message resets the window — which
 * is ALSO A BUG (forge-8vfn.8.1.9): non-progress SDK messages (`tool_progress`,
 * `system`, `hook_response`, `auth_status`, …) reset it identically to real
 * progress, so an 8.5-min Studio architect stall with no forge event never
 * tripped it. `isProgress` below is the fix: when supplied, only a message it
 * accepts extends the window; every other message still reaches the consumer
 * unmodified, it just leaves the deadline where it was. Omitted, the original
 * any-message-resets-it behaviour is unchanged (`ralph/claude-agent.ts`'s own
 * call site).
 */

export class StreamDeadlineError extends Error {
  readonly label: string;
  readonly idleMs: number;
  /** Set only when `isProgress` was supplied and the window elapsed with at
   *  least one non-progress message seen — a `"type×count"` summary (e.g.
   *  `tool_progress×41, system×3`) naming what was looping instead. */
  readonly nonProgressSummary?: string;
  constructor(label: string, idleMs: number, nonProgressSummary?: string) {
    const seconds = Math.round(idleMs / 1000);
    const tail = 'aborted as a likely usage-limit / network stall (transient; routes to auto-retry).';
    super(
      nonProgressSummary
        ? `stream-deadline: SDK stream '${label}' saw only non-progress messages for ${seconds}s: ${nonProgressSummary} — ${tail}`
        : `stream-deadline: SDK stream '${label}' produced no message for ${seconds}s — ${tail}`,
    );
    this.name = 'StreamDeadlineError';
    this.label = label;
    this.idleMs = idleMs;
    this.nonProgressSummary = nonProgressSummary;
  }
}

/** Best-effort "type" label for a non-progress message — for the error
 *  summary only, never control flow; degrades to `typeof` for anything odd. */
function describeMessageType(value: unknown): string {
  if (value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') {
    return (value as { type: string }).type;
  }
  return typeof value;
}

/** `Map<type, count>` → `"type×count, type×count"`, or `undefined` if empty
 *  (the caller then throws the plain "produced no message" form). */
function summarizeNonProgress(counts: Map<string, number>): string | undefined {
  if (counts.size === 0) return undefined;
  return [...counts.entries()].map(([type, n]) => `${type}×${n}`).join(', ');
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
  opts: {
    idleMs?: number;
    label: string;
    abortController?: AbortController;
    /** Progress predicate (forge-8vfn.8.1.9): only an accepted message resets
     *  the idle window; every other message still reaches the consumer.
     *  Omitted preserves the original any-message-resets-it behaviour. */
    isProgress?: (value: T) => boolean;
  },
): AsyncGenerator<T> {
  const idleMs = opts.idleMs && opts.idleMs > 0 ? opts.idleMs : DEFAULT_IDLE_DEADLINE_MS;
  const iterator = stream[Symbol.asyncIterator]();
  const isProgress = opts.isProgress;
  let deadlineAt = Date.now() + idleMs;
  // Non-progress types seen since the window last reset — for the error only.
  const nonProgressSeen = new Map<string, number>();
  while (true) {
    const remaining = Math.max(0, deadlineAt - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof DEADLINE>((res) => {
      timer = setTimeout(() => res(DEADLINE), remaining);
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
      throw new StreamDeadlineError(opts.label, idleMs, isProgress ? summarizeNonProgress(nonProgressSeen) : undefined);
    }
    if (res.done) return;
    const { value } = res;
    if (isProgress) {
      if (isProgress(value)) {
        deadlineAt = Date.now() + idleMs;
        nonProgressSeen.clear();
      } else {
        const key = describeMessageType(value);
        nonProgressSeen.set(key, (nonProgressSeen.get(key) ?? 0) + 1);
      }
    } else {
      // No predicate supplied — original behaviour: ANY message resets it.
      deadlineAt = Date.now() + idleMs;
    }
    yield value;
  }
}
