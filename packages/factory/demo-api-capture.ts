/**
 * `api-before-after`, path driver (forge-mfv5.1.19): GET a declared path on a
 * capture tree's OWN started server and record `{status, location?, body}` as
 * the JSON `.out` the control compares. Never a declared or agent-supplied
 * host: at point of use the path is re-checked and origin-pinned to the tree's
 * server by `resolveCheckpointUrl`; a redirect is recorded with its target,
 * never followed. A refusal, a failure or an over-long body is NOT evidence:
 * it comes back `ok: false`, the caller writes no `.out`, and the control
 * reads that side as missing — `unknown`, never `unchanged`.
 */

import { MAX_CAPTURED_OUTPUT_BYTES } from '@forge/stations/demo-model.ts';

import { resolveCheckpointUrl } from './demo.ts';

const API_GET_TIMEOUT_MS = 30_000;
/** Half the captured-output cap: escaping a body into the record can double it. */
const MAX_API_BODY_CHARS = MAX_CAPTURED_OUTPUT_BYTES / 2;

export type ApiGetResult = { ok: true; out: string } | { ok: false; reason: string };

export async function captureApiGet(serverUrl: string, apiPath: string, fetchImpl: typeof fetch = fetch): Promise<ApiGetResult> {
  const target = resolveCheckpointUrl(serverUrl, apiPath);
  if (!target.ok) return { ok: false, reason: `request refused: ${target.reason}` };
  try {
    const res = await fetchImpl(target.url, { redirect: 'manual', signal: AbortSignal.timeout(API_GET_TIMEOUT_MS) });
    const text = await res.text();
    if (text.length > MAX_API_BODY_CHARS) return { ok: false, reason: `body is ${text.length} chars — over ${MAX_API_BODY_CHARS}, not comparable` };
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // A non-JSON body is kept as text: the control still compares it.
    }
    const location = res.headers.get('location');
    // The server's origin differs per tree (a fresh port each run): tokenised, like the worktree path.
    const out = JSON.stringify({ status: res.status, ...(location ? { location } : {}), body }).split(new URL(serverUrl).origin).join('<server>');
    return { ok: true, out: `${out}\n` };
  } catch (err) {
    return { ok: false, reason: `request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
