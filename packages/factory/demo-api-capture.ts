/**
 * `api-before-after`, path driver (forge-mfv5.1.19): GET a declared path on a
 * capture tree's OWN started server and record `{status, body}` as JSON, the
 * `.out` the JSON control compares. Never a declared or agent-supplied host:
 * at point of use the path is re-checked and origin-pinned to the tree's
 * server by `resolveCheckpointUrl`; redirects are recorded, never followed.
 * Never throws — a refusal or a failure is recorded as text, which the control
 * compares as text.
 */

import { MAX_CAPTURED_OUTPUT_BYTES } from '@forge/stations/demo-model.ts';

import { resolveCheckpointUrl } from './demo.ts';

const API_GET_TIMEOUT_MS = 30_000;

export async function captureApiGet(serverUrl: string, apiPath: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const target = resolveCheckpointUrl(serverUrl, apiPath);
  if (!target.ok) return `[request refused: ${target.reason}]\n`;
  try {
    const res = await fetchImpl(target.url, { redirect: 'manual', signal: AbortSignal.timeout(API_GET_TIMEOUT_MS) });
    const text = (await res.text()).slice(0, MAX_CAPTURED_OUTPUT_BYTES);
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // A non-JSON body is kept as text: the control still compares it.
    }
    return `${JSON.stringify({ status: res.status, body })}\n`;
  } catch (err) {
    return `[request failed: ${err instanceof Error ? err.message : String(err)}]\n`;
  }
}
