/**
 * http-envelope.ts — the HTTP response envelope every carved route table needs.
 *
 * M4 §4 step 2, T1 ruling on M4-knowledge's PARK 2. These five symbols lived in
 * `apps/forge/bridge-studio.ts`. Every package that carves its routes out of the
 * bridge needs them, and a package importing `cli/` is a `package-to-legacy`
 * boundary violation — so the knowledge lane's first carve would have added one
 * such row, and the five later carves (projects, library, sessions, agents,
 * flows) would each have added their own. They live here instead, which removes
 * the row rather than baselining six of them.
 *
 * `apps/forge/bridge-studio.ts` re-exports all five as a transition affordance so its
 * existing importers are untouched; when the host itself moves (flows lane) the
 * re-export goes with it.
 *
 * SCOPE. This is the envelope only — origin decision, JSON write, error
 * sanitisation, URL splitting, and the two-field context a route handler
 * receives. Body parsing, CSRF and the route dispatch stay with the host: they
 * are policy about a *request*, not the shape of a *response*, and the host is
 * the single place that policy is applied.
 *
 * `parseQuery` IS here, on this file's own standing instruction. The ruling
 * that created this module named five symbols and left a sixth pending: "it is
 * `pathOnly`'s two-line twin — so the first carved route that reads a query
 * string should move it rather than import `cli/`." The sessions lane's
 * `/api/studio/sessions` index route is that route (M4, `additive: kernel`).
 * `apps/forge/bridge-studio.ts` re-exports it so the host's callers are unchanged.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The context every carved route handler receives from the host. */
export type StudioContext = {
  forgeRoot: string;
  logsRoot: string;
};

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Returns the request's Origin if it matches the forge-ui dev-origin pattern,
 * otherwise returns 'null' (the literal string that signals "no access").
 * Used to tighten CORS beyond the old wildcard.
 */
export function allowedOrigin(req: IncomingMessage, _pattern?: RegExp): string {
  const origin = req.headers?.['origin'];
  if (typeof origin === 'string' && LOCAL_ORIGIN_RE.test(origin)) return origin;
  return 'null';
}

export function sendJson(res: ServerResponse, status: number, body: unknown, origin = 'null'): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': origin,
    'vary': 'origin',
  });
  res.end(payload);
}

/**
 * Strip absolute filesystem paths from error strings before sending them to
 * the browser. Prevents leaking the operator's directory layout.
 * Pattern: any token starting with / that looks like a path segment.
 * Exported so alias catch-blocks in ui-bridge.ts can reuse it (M2).
 */
export function sanitizeError(err: unknown): string {
  return String(err).replace(/\/[^\s:,'"]+/g, '[path]');
}

/** Strip the query-string from a URL string. */
export function pathOnly(rawUrl: string): string {
  const idx = rawUrl.indexOf('?');
  return idx >= 0 ? rawUrl.slice(0, idx) : rawUrl;
}

/** Parse the query-string from a URL string (e.g. '/api/runs?flow=forge-cycle').
 *  `pathOnly`'s twin: same split, the other half. */
export function parseQuery(rawUrl: string): URLSearchParams {
  const idx = rawUrl.indexOf('?');
  return new URLSearchParams(idx >= 0 ? rawUrl.slice(idx + 1) : '');
}

