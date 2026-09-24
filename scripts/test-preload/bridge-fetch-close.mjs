/**
 * Preload — `node --import=./scripts/test-preload/bridge-fetch-close.mjs`
 * (wired into package.json's `test` script; loaded for the WHOLE `npm test`
 * process, before any test file).
 *
 * CLASS FIX for F8 (known-flakes.md — "`TypeError: fetch failed` IN A
 * BRIDGE DOOR IS TRANSPORT"). ~85 node:test files boot an in-process
 * `startBridge()` and talk to it with the plain global `fetch()`; every one
 * of them carries the same race, not just the two files that had sightings
 * — a fix in two of them leaves the rest red on the next loaded gate. This
 * wraps `globalThis.fetch` ONCE, for the whole suite, instead of aliasing a
 * per-file helper into a hand-picked subset.
 *
 * MECHANISM. A bridge-door test's own `fetch()` and the in-process bridge
 * SERVER it dials share ONE event loop — nothing like production, where a
 * browser client and the bridge are separate processes on separate
 * machines. Node's `http.Server` default `keepAliveTimeout` (5000ms) races
 * undici's global keep-alive pool under a starved or blocked event loop:
 * the server destroys an idle socket right as this SAME process's next
 * `fetch()` call reuses it, surfacing as `TypeError: fetch failed` with
 * `cause.code === 'ECONNRESET'`. Reproduced deterministically (7/40
 * attempts; 0/40 with this fix) by blocking the event loop across the
 * server's timeout boundary immediately before reusing a warm connection.
 *
 * FIX. Keep-alive buys these tests nothing — every call is an independent,
 * cheap loopback round trip — so this removes the reused socket instead of
 * tuning either side's timeout ("do not widen timeouts blindly"): a request
 * to a LOOPBACK host declares `Connection: close`, which Node's
 * `http.Server` honours by closing the socket itself right after the
 * response, so there is never an idle keep-alive socket left for a later
 * call to race. Scoped to loopback (127.0.0.1 / localhost / ::1) — every
 * in-process bridge test dials one of these, and nothing else this process
 * fetches (a real network call, if any test makes one) is touched. A caller
 * that already declared its own `connection` header wins unconditionally —
 * this only fills a gap plain `fetch()` leaves, never overrides a choice.
 *
 * The product's own `startBridge` keeps Node's stock `keepAliveTimeout`:
 * real Studio clients are separate processes that never share this race,
 * so tuning it there would be papering over a test-only artifact.
 */

const realFetch = globalThis.fetch;

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** The URL string `fetch()` was actually asked to dial, for either call shape. */
function requestUrlOf(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url; // a Request
}

function isLoopbackUrl(urlString) {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(urlString).hostname);
  } catch {
    return false; // not a fetchable absolute URL — never our concern here
  }
}

function callerSetConnectionHeader(input, init) {
  if (init?.headers && new Headers(init.headers).has('connection')) return true;
  return input instanceof Request && input.headers.has('connection');
}

globalThis.fetch = function bridgeFetchClosePreload(input, init) {
  if (!isLoopbackUrl(requestUrlOf(input)) || callerSetConnectionHeader(input, init)) {
    return realFetch(input, init);
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('connection', 'close');
  return realFetch(input, { ...init, headers });
};
