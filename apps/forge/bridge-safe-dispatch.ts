/**
 * bridge-safe-dispatch — the bridge's last line of defence around a request.
 *
 * `handleHttp` is an async route dispatcher; a throw out of any route handler
 * is an unhandled rejection, and Node exits on one — one unauthenticated
 * request (`curl localhost:4123/api/reflect/%E0%A4%A`) killed the bridge
 * (forge-nk1y.8). This wrapper turns every escape into an HTTP answer:
 *
 *   - `MalformedUrlEncodingError` (`decodeUrlPart`, `@forge/kernel`) -> 400
 *   - anything else                                                  -> 500 `internal error` (detail logged only)
 *   - headers already sent                                           -> just end the response
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { MalformedUrlEncodingError, allowedOrigin, sendJson } from '@forge/kernel';

/** The body of the 400 a malformed percent-escape earns. */
export const MALFORMED_URL_MESSAGE = 'malformed percent-encoding in request URL';

/** The fixed body of the 500 — error text, classes and paths stay in the log. */
export const INTERNAL_ERROR_MESSAGE = 'internal error';

/** Run `handler`; never reject. */
export async function safeDispatch(
  req: IncomingMessage,
  res: ServerResponse,
  handler: () => Promise<void>,
  logError: (err: unknown) => void = (err) => console.error('[bridge] route handler threw:', err),
): Promise<void> {
  try {
    await handler();
  } catch (err) {
    if (res.headersSent) {
      // A status line is already on the wire — nothing honest left to send.
      logError(err);
      if (!res.writableEnded) res.end();
      return;
    }
    const origin = allowedOrigin(req);
    if (err instanceof MalformedUrlEncodingError) {
      sendJson(res, 400, { error: MALFORMED_URL_MESSAGE }, origin);
      return;
    }
    logError(err);
    sendJson(res, 500, { error: INTERNAL_ERROR_MESSAGE }, origin);
  }
}
