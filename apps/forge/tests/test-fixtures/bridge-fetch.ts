/**
 * A drop-in `fetch` replacement for tests that talk to an in-process
 * `startBridge()` instance (F8, known-flakes.md — "`TypeError: fetch failed`
 * IN A BRIDGE DOOR IS TRANSPORT").
 *
 * MECHANISM. These tests share ONE Node process/event loop with the bridge
 * SERVER they are exercising — nothing like production, where a browser
 * client and the bridge are separate processes on separate machines. Node's
 * `http.Server` default `keepAliveTimeout` (5000ms) idle-closes a kept-alive
 * socket, and plain `fetch()` pools/reuses sockets across calls by default.
 * Under a starved or blocked event loop, the two can race: the server
 * decides an idle socket is overdue for closing at almost the exact moment
 * this SAME process's next `fetch()` call reuses it, and the reused socket
 * comes back `ECONNRESET` — surfaced to the test as `TypeError: fetch
 * failed`. Reproduced deterministically (7/40 attempts) by blocking the
 * event loop across the server's 5000ms boundary immediately before firing
 * the next request on a warm connection; 0/40 with the header below.
 *
 * FIX, AT THIS LAYER (not the product server's timeouts). Keep-alive buys
 * these tests nothing — each call is an independent, cheap localhost round
 * trip — so this removes the reused socket instead of tuning either side's
 * timeout ("do not widen timeouts blindly"): every request declares
 * `Connection: close`, which Node's `http.Server` honours by closing the
 * socket itself right after the response, so there is never an idle
 * keep-alive socket left for a later call to race. (The product's own
 * `startBridge` keeps Node's stock `keepAliveTimeout` — real Studio clients
 * are separate processes that do not share this failure mode, and lowering
 * it there would be tuning a timeout to paper over a test-only race.)
 *
 * Import this ALIASED as `fetch` (`import { bridgeFetch as fetch } from
 * '../test-fixtures/bridge-fetch.ts'`) so every existing call site in a test
 * file keeps working unchanged — the signature and return type are
 * identical to the global `fetch`.
 */
export function bridgeFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('connection', 'close');
  return fetch(url, { ...init, headers });
}
