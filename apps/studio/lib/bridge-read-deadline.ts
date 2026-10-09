/**
 * forge-nk1y.9 — the deadline on every bridge READ (`bridgeRead*` in
 * bridge-client-core, `studioRead*` in studio-client). Before it, a read that
 * never answered left its page loading forever.
 *
 * 30 s is an order of magnitude above the slowest read measured: a project
 * preflight (the heaviest GET — git + deps checks) took 0.9–1.8 s end to end
 * through the CLI on gitweave / gitpulse / betterado, node start-up included
 * (2026-10-09). Writes are NOT bounded — `bridgeFetch` with a method runs agents
 * and installs that may legitimately take minutes.
 *
 * Its own module (not bridge-client-core) so both clients share it AND tests that
 * mock `./bridge-client` down to `bridgeFetch` still run the real deadline.
 */
import { BridgeReadTimeoutError, readBridgeJson, type BridgeReadResult } from './bridge-result.ts';

export const BRIDGE_READ_TIMEOUT_MS = 30_000;

/** `readBridgeJson`, aborted at the deadline with a named `BridgeReadTimeoutError`
 *  (classified as `{ok:false, timedOut:true, error:"timed out after N s"}`). */
export async function readBridgeJsonWithin<T>(doFetch: (signal: AbortSignal) => Promise<Response>): Promise<BridgeReadResult<T>> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new BridgeReadTimeoutError(BRIDGE_READ_TIMEOUT_MS)), BRIDGE_READ_TIMEOUT_MS);
  try {
    return await readBridgeJson<T>(() => doFetch(controller.signal));
  } finally {
    clearTimeout(deadline);
  }
}
