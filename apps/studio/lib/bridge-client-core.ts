/**
 * `forge-8vfn.7.6.135` — the transport core of the client-side glue to the
 * forge-ui-bridge, split out of `bridge-client.ts` (pure move; the exported
 * shape is unchanged, only which file declares it). Every other client
 * surface (roadmap, runs, interviews) imports its bridge calls from here;
 * `bridge-client.ts` re-exports this file plus its siblings so no caller
 * changes.
 *
 * Bridge URL discovery (W6-P4, redesigned per review): the client tries the
 * FIXED-PORT DEFAULT optimistically first (zero-RTT — see
 * `resolveBridgeUrl`'s own doc below), and falls back to `/api/forge-config`
 * (a Next.js route that reads process.env.FORGE_BRIDGE_URL at request time —
 * the authoritative source, correct under a `--bridge-port` override) only
 * if that first real bridge call fails outright. This still avoids the
 * build-time embedding fragility of `next.config` `env` blocks across
 * `forge watch` restarts — the DEFAULT inlined by the root layout is a
 * plain literal, never an observed env value that could go stale.
 *
 * One subscribe() opens a single WebSocket; the page is expected to
 * call this once for the lifetime of the mount. Cycle-selection filtering
 * lives in the handler the page provides — the bridge broadcasts events
 * for every live cycle.
 */
import { DEFAULT_BRIDGE_PORT } from './bridge-port.ts';
import {
  readBridgeJson,
  unwrapBridgeRead,
  unwrapBridgeReadOr404,
  type BridgeReadResult,
} from './bridge-result.ts';

export type Cycle = {
  cycleId: string;
  initiativeId: string;
  project?: string;
  // R4-11-F1: `merged` is the transient pass-through a confirmed-merge
  // manifest briefly occupies between closure's two terminal moves (→merged,
  // then merged→done in the same sweep) — distinct from the unrelated
  // `CycleOutcome`/`CycleResult.status` `'merged'` VALUE (an event outcome).
  status: 'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed' | 'pending';
  startedAt?: string;
  endedAt?: string;
  /**
   * Feature #10: cross-initiative dependency edges (manifest
   * `depends_on_initiatives`). Drives the per-project roadmap spine's
   * topological level ordering. Empty / absent = no prerequisites (the
   * initiative lays flat at level 0).
   */
  dependsOnInitiatives?: string[];
};

export type CycleListSnapshot = { live: Cycle[]; recent: Cycle[] };

export type EventLogEntry = {
  event_id: string;
  cycle_id?: string;
  initiative_id: string;
  started_at: string;
  phase: string;
  skill: string;
  event_type: string;
  message?: string;
  metadata?: Record<string, unknown>;
  // Present on SDK-backed events (iteration / end). Declared optional so the
  // UI can surface per-agent cost + token totals from the event stream.
  cost_usd?: number;
  tokens_in?: number;
  tokens_out?: number;
};

export type BridgeMessage =
  | { type: 'snapshot'; cycles: CycleListSnapshot }
  | { type: 'event'; cycleId: string; event: EventLogEntry }
  | { type: 'cycle-list-changed' }
  | { type: 'architect-list-changed' }
  | { type: 'instructions-list-changed' }
  | { type: 'demo-list-changed' };

// `daemon-stalled` (Feature #8): the bridge is reachable but the scheduler
// daemon's heartbeats have gone stale past a generous threshold — the daemon
// process is wedged / dead. Distinct from `reconnecting` (bridge unreachable).
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'no-bridge' | 'daemon-stalled';

// ---- runtime bridge URL --------------------------------------------------

// W6-P4 (redesigned per review): `app/layout.tsx` inlines the FIXED-PORT
// DEFAULT (a build-time literal — see lib/bridge-port.ts, never an env
// read, so the layout stays statically prerendered) as this global. Never a
// host — see the function doc below.
declare global {
  interface Window {
    __FORGE_BRIDGE_PORT__?: number | null;
  }
}

// Cache the PROMISE rather than the value so concurrent callers
// (Strict Mode double-mount, two effects running on the same tick)
// share a single network request.
let cachedBridgeUrl: Promise<string> | null = null;

// True once resolveBridgeUrl has produced at least one value. The FIRST
// resolution is always the OPTIMISTIC fixed-port-default guess (zero-RTT —
// no fetch at all). Every resolution AFTER an invalidation
// (clearBridgeCache, below) goes straight to the authoritative,
// env-derived `/api/forge-config` route instead of re-guessing the same
// default a second time — the guess already proved wrong once.
let hasResolvedBefore = false;

/** Build the bridge base URL from `window.location` + a port. The host
 *  segment ALWAYS comes from `window.location.hostname` — essential for
 *  WSL2 + Windows browser: the Windows browser sees `localhost` (forwarded
 *  into WSL by WSL2), while a Linux/WSL browser sees the actual WSL
 *  hostname — NEVER from a server-supplied value (global or fetched), on
 *  either resolution path below. */
function buildBridgeUrl(loc: Pick<Location, 'protocol' | 'hostname'>, port: number): string {
  return `${loc.protocol}//${loc.hostname}:${port}`;
}

/** The authoritative, env-derived answer — or `''` when the route failed or
 *  answered `bridgePort: null` (a Next process started without
 *  `FORGE_BRIDGE_URL`). `''` is NOT "there is no bridge": the caller falls
 *  back to the fixed-port default (W7-FIX-A1, A1-06). */
async function fetchAuthoritativeBridgeUrl(loc: Pick<Location, 'protocol' | 'hostname'>): Promise<string> {
  try {
    const res = await fetch('/api/forge-config', { cache: 'no-store' });
    if (!res.ok) throw new Error(`forge-config → ${res.status}`);
    const body = (await res.json()) as { bridgePort: number | null };
    if (!body.bridgePort) return '';
    return buildBridgeUrl(loc, body.bridgePort);
  } catch {
    return '';
  }
}

/** The fixed-port convention's default URL — the FIRST guess, and the last
 *  resort whenever the authoritative route has nothing better to offer. */
function defaultBridgeUrl(loc: Pick<Location, 'protocol' | 'hostname'>): string {
  return buildBridgeUrl(loc, window.__FORGE_BRIDGE_PORT__ ?? DEFAULT_BRIDGE_PORT);
}

/**
 * Resolve the bridge base URL. Resolution order (W6-P4, redesigned per
 * review — never trade the app's static shells for a per-request fact that
 * has a stable default):
 *   1. FIRST call ever: `window.__FORGE_BRIDGE_PORT__` (the fixed-port
 *      convention's default, inlined by the static root layout) —
 *      OPTIMISTIC, zero network round-trips. Used immediately for the
 *      first real bridge call; `bridgeFetch` (below) corrects it if that
 *      call fails outright.
 *   2. Any resolution AFTER `clearBridgeCache()`: the authoritative,
 *      env-derived `/api/forge-config` route — correct even under a
 *      `--bridge-port` override, at the cost of one round trip. ONLY a
 *      successful, non-null answer is authoritative (W7-FIX-A1, A1-06): a
 *      failed route / `bridgePort: null` falls back to the fixed-port
 *      default again — never to an empty base that would make every later
 *      `bridgeFetch` throw 'no bridge configured' before any fetch, wedging
 *      the tab past what the banner's Retry or the health probe can undo.
 */
export function resolveBridgeUrl(): Promise<string> {
  if (cachedBridgeUrl) return cachedBridgeUrl;
  const useOptimisticDefault = !hasResolvedBefore;
  hasResolvedBefore = true;
  cachedBridgeUrl = (async () => {
    const loc = typeof window !== 'undefined' ? window.location : null;
    if (!loc) return ''; // SSR — client-only code path
    if (useOptimisticDefault) return defaultBridgeUrl(loc);
    const authoritative = await fetchAuthoritativeBridgeUrl(loc);
    return authoritative || defaultBridgeUrl(loc);
  })();
  return cachedBridgeUrl;
}

/**
 * Invalidate the current resolution so the NEXT `resolveBridgeUrl()` call
 * re-derives — always via the authoritative `/api/forge-config` route past
 * the first resolution (see `hasResolvedBefore` above). Two callers:
 *   - `bridgeFetch`'s one-shot correction, when the FIRST real bridge call
 *     against the optimistic guess fails outright.
 *   - `subscribe()`'s WS reconnect loop, after N consecutive close
 *     failures — a bridge that restarted on a different port must be
 *     re-discovered, not retried on the dead one forever.
 */
function clearBridgeCache(): void {
  cachedBridgeUrl = null;
}

// ---- fetch envelopes -----------------------------------------------------
// Every read/write helper below shares one of these shapes. W7-A1
// (home-sessions-V01 / crosscut-01): reads NEVER resolve with a caller-
// supplied empty fallback any more — `bridgeRead` returns an explicit
// `BridgeReadResult` and the typed helpers THROW `BridgeReadError` (or map a
// 404 to `null` where "no such object" is a real answer). Writes keep the
// `{ok, error}` envelope, with the bridge's own `error`/`message` verbatim.

// W6-P4: one-shot correction gate for `bridgeFetch`. Set when a bridge
// call's raw `fetch()` throws (a network-level failure — nothing is
// listening at the guessed URL, e.g. a `--bridge-port` override moved the
// bridge off the fixed-port default). W7-A1 (crosscut-22/-26): RE-ARMED by
// any bridge call whose fetch RESOLVES (regardless of status) — so a bridge
// that later restarts on a different port is re-discovered again, while a
// since-broken bridge still can't retry-storm `/api/forge-config` (the gate
// only re-arms on a real success, and each failure spends it once).
let correctionAttempted = false;

/**
 * W7-A1: listeners told when a bridge fetch THROWS (transport-level — the
 * bridge was never reached). The bridge-status store (lib/bridge-status.ts)
 * registers here so a page's failed read triggers an immediate health probe
 * instead of waiting for the WS reconnect loop. A registry (not a direct
 * import) keeps this module free of any import back into the store.
 */
type TransportFailureListener = (error: string) => void;
const transportFailureListeners = new Set<TransportFailureListener>();

export function onBridgeTransportFailure(listener: TransportFailureListener): () => void {
  transportFailureListeners.add(listener);
  return () => { transportFailureListeners.delete(listener); };
}

function notifyTransportFailure(err: unknown): void {
  const text = err instanceof Error ? err.message : String(err);
  for (const l of transportFailureListeners) {
    try { l(text); } catch { /* a listener must never break a fetch */ }
  }
}

/**
 * `fetch(base + path, init)` against the CURRENTLY resolved bridge URL, with
 * the W6-P4 one-shot correction: if a real bridge fetch THROWS (connection
 * refused / DNS failure — not a normal non-ok status, which is left entirely
 * to the caller) and the correction is armed, invalidate the cached URL,
 * re-resolve via the authoritative route, and retry exactly once against
 * the corrected URL. Exported (W7-A1, crosscut-26) so `studio-client.ts`
 * rides the SAME transport — one URL resolution + correction policy for
 * every bridge call in Studio, not two.
 */
/** `AbortError` (caller abort) / `TimeoutError` (`AbortSignal.timeout`) —
 *  the fetch was cut short by the CALLER, not refused by the network. */
function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

export async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await resolveBridgeUrl();
  if (!base) throw new Error('no bridge configured');
  try {
    const res = await fetch(`${base}${path}`, init);
    correctionAttempted = false; // reached the bridge — re-arm for a future move
    return res;
  } catch (err) {
    // A caller-imposed timeout / abort (the bounded health probe, an
    // unmounting page) is NOT evidence of a wrong port: never spend the
    // one-shot correction or clear the app-wide URL cache on it (review
    // round 2 — a slow-but-up bridge would otherwise thrash the cache and
    // pay an extra /api/forge-config round trip on every probe).
    if (isAbortLike(err)) { notifyTransportFailure(err); throw err; }
    if (correctionAttempted) { notifyTransportFailure(err); throw err; }
    correctionAttempted = true;
    clearBridgeCache();
    const corrected = await resolveBridgeUrl();
    if (!corrected || corrected === base) { notifyTransportFailure(err); throw err; } // nothing to gain from retrying
    try {
      const res = await fetch(`${corrected}${path}`, init);
      correctionAttempted = false;
      return res;
    } catch (err2) {
      notifyTransportFailure(err2);
      throw err2;
    }
  }
}

/**
 * W7-A1 — GET a bridge JSON endpoint as an explicit result. NEVER resolves
 * with a caller-supplied fallback: `{ok:false,status,error}` when the bridge
 * refused, `{ok:false,error}` (no status) when it was never reached. The
 * classification itself lives in `./bridge-result.ts` (shared with
 * studio-client.ts).
 */
export async function bridgeRead<T>(path: string): Promise<BridgeReadResult<T>> {
  return readBridgeJson<T>(() => bridgeFetch(path));
}

/** GET as a value; THROWS `BridgeReadError` on any failure — a caller with a
 *  plain `Promise<T>` signature receives no value it could mistake for empty.
 *  Exported (7.6.135) — every satellite client-surface module needs it. */
export async function bridgeReadOrThrow<T>(path: string): Promise<T> {
  return unwrapBridgeRead(path, await bridgeRead<T>(path));
}

/** GET as a value where a 404 is a real answer (→ null); every other failure
 *  throws `BridgeReadError`. Exported (7.6.135) — see `bridgeReadOrThrow`. */
export async function bridgeReadOr404<T>(path: string): Promise<T | null> {
  return unwrapBridgeReadOr404(path, await bridgeRead<T>(path));
}

/**
 * W7-A1 — the bridge-status store's health probe: `GET /api/health` must
 * answer 2xx with the forge bridge identity (`service: 'forge-bridge'`, the
 * same identity `forge studio` itself probes before reusing a port —
 * CLAUDE.md "Studio session workflow"). A foreign process on the port, a
 * non-2xx, or a transport throw are all `ok:false` with the reason.
 */
/** W7-FIX-A1 (A1-08): the probe is BOUNDED — a port that accepts the TCP
 *  connection but never answers must not hold the banner's Retry in
 *  "Checking…" for the raw socket timeout. */
export const BRIDGE_HEALTH_PROBE_TIMEOUT_MS = 4000;

export async function probeBridgeHealth(): Promise<{ ok: true } | { ok: false; error: string }> {
  const init: RequestInit = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? { signal: AbortSignal.timeout(BRIDGE_HEALTH_PROBE_TIMEOUT_MS) }
    : {};
  const r = await readBridgeJson<{ service?: unknown }>(() => bridgeFetch('/api/health', init));
  if (!r.ok) return { ok: false, error: r.error };
  if (r.data?.service !== 'forge-bridge') return { ok: false, error: 'port answered, but not by the forge bridge' };
  return { ok: true };
}

/**
 * POST to a bridge endpoint (JSON body when provided, bare POST otherwise) and
 * normalise the reply to the `{ ok, error }` envelope. `data` carries the
 * parsed body for the rare caller that needs an extra field (e.g. sessionId).
 * Exported (7.6.135) — see `bridgeReadOrThrow`.
 */
export async function bridgePost(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await bridgeFetch(path, body === undefined
      ? { method: 'POST', headers: { 'x-forge-csrf': '1' } }
      : { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string } & Record<string, unknown>;
    if (!res.ok) return { ok: false, error: data.error ?? data.message ?? `HTTP ${res.status}` };
    return { ok: !!data.ok, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---- WebSocket subscription ---------------------------------------------

export type Subscription = { close: () => void };

export type SubscribeHandlers = {
  onMessage: (msg: BridgeMessage) => void;
  onState?: (state: ConnectionState) => void;
};

export function subscribe(handlers: SubscribeHandlers): Subscription {
  // `socket` is the CURRENT live socket. `closed` flips when the
  // consumer cancels the subscription; once true, no new sockets are
  // created and any in-flight `connect()` aborts after its await.
  let socket: WebSocket | null = null;
  let closed = false;
  let backoff = 500;
  let connecting = false; // serialises connect() against itself
  // Review fix #2: consecutive `onclose` events with no intervening `onopen`
  // — a WS that keeps failing to (re)connect. After N of these, the bridge
  // may have restarted on a DIFFERENT port (e.g. a `--bridge-port` override
  // across a `forge watch` restart); without this, `cachedBridgeUrl` stayed
  // pinned to the dead port forever and every reconnect attempt kept
  // retrying it. Reset to 0 on any successful `onopen`.
  let consecutiveCloseFailures = 0;
  const RECONNECT_REPROBE_THRESHOLD = 3;
  const setState = (s: ConnectionState): void => handlers.onState?.(s);

  const connect = async (): Promise<void> => {
    if (closed || connecting) return;
    connecting = true;
    try {
      const base = await resolveBridgeUrl();
      // CRITICAL: between subscribe() returning and the await above
      // resolving, the consumer (e.g., React Strict Mode cleanup) may
      // have called close(). Re-check before creating a socket — without
      // this, every dev-mode mount leaks a WS that survives the cleanup.
      if (closed) return;
      if (!base) {
        setState('no-bridge');
        setTimeout(() => { clearBridgeCache(); void connect(); }, 2000);
        return;
      }
      setState('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
      } catch {
        setState('reconnecting');
        setTimeout(() => { void connect(); }, backoff);
        backoff = Math.min(backoff * 2, 5000);
        return;
      }
      socket = ws;
      ws.onopen = () => {
        if (closed) { try { ws.close(); } catch { /* */ } return; }
        backoff = 500;
        consecutiveCloseFailures = 0;
        setState('open');
      };
      ws.onmessage = (ev) => {
        if (closed) return;
        try { handlers.onMessage(JSON.parse(ev.data)); } catch { /* malformed */ }
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        if (closed) return;
        consecutiveCloseFailures += 1;
        if (consecutiveCloseFailures >= RECONNECT_REPROBE_THRESHOLD) {
          // Review fix #2: re-derive via the authoritative /api/forge-config
          // route instead of retrying a dead port forever.
          clearBridgeCache();
          consecutiveCloseFailures = 0;
        }
        setState('reconnecting');
        setTimeout(() => { void connect(); }, backoff);
        backoff = Math.min(backoff * 2, 5000);
      };
      ws.onerror = () => {
        try { ws.close(); } catch { /* already closed */ }
      };
    } finally {
      connecting = false;
    }
  };

  void connect();

  return {
    close: () => {
      closed = true;
      try { socket?.close(); } catch { /* ignore */ }
      socket = null;
    },
  };
}
