/**
 * S10 run 28 (forge-8vfn.8.1.13): both attempts of a review chunk's spawn
 * were refused by the account's weekly usage limit while the SDK still
 * reported `result_subtype: 'success'` — an error-shaped success (campaign
 * rule 6.15: UNKNOWN, never a verdict). `adversarial-review.ts` must tell
 * that apart from a GENUINE author-invalid (a real, non-refused turn that
 * simply wrote no findings file), or it misreads a transient limit as a
 * terminal defect in the reviewer's own authoring.
 *
 * The signal is read from the SAME raw stream `runOneShotSpawn` already
 * consumes (via `RunContext.onMessage`) — never re-derived from `runAgent`'s
 * summarised result. Structured fields WIN: `SDKAssistantMessage.error`
 * (a typed `SDKAssistantMessageError`, e.g. `'rate_limit'`) and
 * `SDKResultSuccess.is_error` / `api_error_status` are present even when
 * `subtype` reads `'success'` — the transcript evidence for run 28 carries
 * exactly this shape (`error: "rate_limit"`, `isApiErrorMessage: true`,
 * `apiErrorStatus: 429`) on the assistant frame. Text is the FALLBACK, via
 * `matchesRateLimitSignature` (failure-classifier.ts) — never a parallel
 * regex — for a producer that reports neither structured field.
 */
import { matchesRateLimitSignature } from '@forge/agents';

export type SpawnRefusalSignal = {
  assistantError?: string;
  resultIsError?: boolean;
  apiErrorStatus?: number | null;
  lastAssistantText?: string;
};

/** Fresh per-attempt collector: wire `.onMessage` into `runAgent`'s ctx, read `.signal()` after it resolves. */
export function trackSpawnRefusal(): { onMessage: (msg: unknown) => void; signal: () => SpawnRefusalSignal } {
  const s: SpawnRefusalSignal = {};
  const onMessage = (msg: unknown): void => {
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as {
      type?: string; error?: string; is_error?: boolean; api_error_status?: number | null;
      message?: { content?: Array<{ type?: string; text?: string }> };
    };
    if (m.type === 'assistant') {
      if (typeof m.error === 'string') s.assistantError = m.error;
      const text = m.message?.content?.find((c) => c.type === 'text')?.text;
      if (text !== undefined) s.lastAssistantText = text;
    }
    if (m.type === 'result') {
      if (typeof m.is_error === 'boolean') s.resultIsError = m.is_error;
      if (m.api_error_status !== undefined) s.apiErrorStatus = m.api_error_status;
    }
  };
  return { onMessage, signal: () => s };
}

/**
 * `undefined` when `signal` names no refusal (the genuine-author-invalid
 * path is untouched). Otherwise the `AdversarialReviewResult['failed']`
 * shape, ready to return — `emit` is the caller's own event sink (adversarial-
 * review.ts's closure over `logger`), called here so the one `rate_limited:
 * true` event this defect needs is never forgotten at a call site.
 */
export function spawnRefusalFailure(
  signal: SpawnRefusalSignal,
  ctx: { attempt: number; chunk: string },
  emit: (message: string, metadata?: Record<string, unknown>, extra?: { event_type?: 'log' | 'error'; cost_usd?: number }) => void,
): { status: 'failed'; reason: 'rate-limited'; detail: string } | undefined {
  // Narrowed to the rate/overload class, not every `SDKAssistantMessageError`:
  // 'authentication_failed' / 'invalid_request' / … are refusals too, but NOT
  // ones a bounded wait fixes — filing those as 'rate-limited' would buy them
  // an unattended auto-retry loop that can never converge. 429/529 mirror
  // `HTTP_PRESSURE_STATUS_RE`'s own status-marker rule (failure-classifier.ts).
  const isRefusal =
    signal.assistantError === 'rate_limit' || signal.assistantError === 'overloaded' ||
    (signal.resultIsError === true && (signal.apiErrorStatus === 429 || signal.apiErrorStatus === 529)) ||
    (signal.lastAssistantText !== undefined && matchesRateLimitSignature(signal.lastAssistantText));
  if (!isRefusal) return undefined;
  // N9 convention (developer-loop.ts): a structured `rate_limited: true` flag,
  // not text alone — `classifyCycleFailure` keys on it unconditionally.
  emit('review.rate-limited', { ...ctx, rate_limited: true, ...signal }, { event_type: 'error' });
  return {
    status: 'failed',
    reason: 'rate-limited',
    detail:
      `${ctx.chunk}: spawn attempt ${ctx.attempt} was refused by the account's own API/usage limit, ` +
      `not authored — auto-retry once the limit resets; never treat as author-invalid`,
  };
}
