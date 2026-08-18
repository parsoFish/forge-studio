/**
 * bridge-result — the ONE failure vocabulary for every bridge read
 * (W7-A1, walkthrough findings home-sessions-V01 / crosscut-01 / crosscut-12).
 *
 * Before this module, `studioGet(path, fallback)` (lib/studio-client.ts) and
 * `bridgeGet(path, fallback)` (lib/bridge-client.ts) both resolved with the
 * caller's EMPTY FALLBACK on every failure — non-2xx, network throw,
 * malformed JSON — with no signal that a failure had happened at all. Every
 * pillar page built on them therefore rendered "you have nothing" the moment
 * the bridge blipped (home-sessions-29/-30, crosscut-01), and a 409 carrying
 * the operator's own fix instructions vanished into an empty checklist
 * (crosscut-12, projects-03).
 *
 * This module is PURE (no DOM, no network, no timers) so both clients — and
 * their tests — share exactly one classification:
 *
 *   - `readBridgeJson(doFetch)` runs a fetch and classifies its outcome into a
 *     `BridgeReadResult<T>`: `{ok:true,status,data}` for a 2xx JSON body,
 *     `{ok:false,status,error,body}` for a non-2xx (the bridge's OWN
 *     `error`/`message` field verbatim — never a generic string when the
 *     server said something), and `{ok:false,error}` (no `status`) when the
 *     transport itself threw — the bridge was never reached.
 *   - `BridgeReadError` is what the typed read helpers THROW so a caller that
 *     keeps a plain `Promise<T[]>` signature can still never mistake a failed
 *     read for an empty one — the promise rejects; there is no value to
 *     confuse with `[]`.
 *   - `describeBridgeError(err)` frames any caught error for the shared
 *     failure state (components/FetchErrorState.tsx): a reachable bridge that
 *     refused (`status` present) is NEVER framed as "unreachable" (library-13).
 */

export type BridgeReadFailure = {
  ok: false;
  /** HTTP status when the bridge answered; ABSENT when the transport threw
   *  (connection refused / DNS / aborted) — "the bridge was never reached". */
  status?: number;
  /** The bridge's own `error`/`message` verbatim when it sent one, else
   *  `HTTP <status>` / the transport error text. Never empty. */
  error: string;
  /** The parsed non-2xx body when the bridge sent JSON — callers wanting an
   *  extra field (e.g. a 409's `runId`) read it here; most ignore it. */
  body?: unknown;
};

export type BridgeReadResult<T> = { ok: true; status: number; data: T } | BridgeReadFailure;

/** Pull the bridge's own message out of a non-2xx JSON body: `error` first,
 *  then `message` (string, non-empty), else `HTTP <status>`. */
export function bridgeErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    for (const key of ['error', 'message'] as const) {
      const v = rec[key];
      if (typeof v === 'string' && v.trim().length > 0) return v;
    }
  }
  return `HTTP ${status}`;
}

/** The transport threw — the bridge was never reached. `status` is absent. */
export function transportFailure(err: unknown): BridgeReadFailure {
  const text = err instanceof Error ? err.message : String(err);
  return { ok: false, error: `bridge unreachable (${text})` };
}

/**
 * Run `doFetch` and classify. `doFetch` is injected (not a path) so the two
 * clients keep their own transport (`bridgeFetch`, with the W6-P4 port
 * correction) while sharing this ONE classification.
 */
export async function readBridgeJson<T>(doFetch: () => Promise<Response>): Promise<BridgeReadResult<T>> {
  let res: Response;
  try {
    res = await doFetch();
  } catch (err) {
    return transportFailure(err);
  }
  let body: unknown;
  let jsonError: string | null = null;
  try {
    body = await res.json();
  } catch (err) {
    jsonError = err instanceof Error ? err.message : String(err);
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: bridgeErrorMessage(res.status, body), body };
  }
  if (jsonError !== null) {
    return { ok: false, status: res.status, error: `malformed JSON from the bridge (${jsonError})` };
  }
  return { ok: true, status: res.status, data: body as T };
}

/**
 * Thrown by the typed read helpers (`studioRead*`, `bridgeRead*`) so a caller
 * with a plain `Promise<T>` signature receives NO value on failure. Carries
 * the failure verbatim.
 */
export class BridgeReadError extends Error {
  readonly path: string;
  readonly status?: number;
  readonly body?: unknown;

  constructor(path: string, failure: BridgeReadFailure) {
    super(failure.error);
    this.name = 'BridgeReadError';
    this.path = path;
    if (failure.status !== undefined) this.status = failure.status;
    if (failure.body !== undefined) this.body = failure.body;
  }
}

export function isBridgeReadError(err: unknown): err is BridgeReadError {
  return err instanceof BridgeReadError || (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'BridgeReadError'
  );
}

/** Unwrap a result: the data, or throw `BridgeReadError`. */
export function unwrapBridgeRead<T>(path: string, r: BridgeReadResult<T>): T {
  if (r.ok) return r.data;
  throw new BridgeReadError(path, r);
}

/** Unwrap a result where a 404 is a real answer ("no such object" → null);
 *  every OTHER failure still throws. */
export function unwrapBridgeReadOr404<T>(path: string, r: BridgeReadResult<T>): T | null {
  if (r.ok) return r.data;
  if (r.status === 404) return null;
  throw new BridgeReadError(path, r);
}

/**
 * How the shared failure state frames a caught error.
 *   - `reachable: true` — the bridge answered (an HTTP status is known):
 *     the message is the bridge's own text; the UI must NOT say
 *     "could not reach the bridge" (library-13).
 *   - `reachable: false` — the transport threw / no status: the bridge is
 *     unreachable (or the error is not a bridge error at all).
 */
export function describeBridgeError(err: unknown): { message: string; status?: number; reachable: boolean } {
  if (isBridgeReadError(err)) {
    return err.status !== undefined
      ? { message: err.message, status: err.status, reachable: true }
      : { message: err.message, reachable: false };
  }
  if (err instanceof Error) return { message: err.message, reachable: false };
  return { message: String(err), reachable: false };
}
