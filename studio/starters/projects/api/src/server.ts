/**
 * {{TITLE}} — {{NORTH_STAR}}
 *
 * A dependency-light HTTP API on node:http. Keep the routing/handler LOGIC in
 * pure functions (like `route` below) so the quality gate tests behaviour
 * without binding a socket; keep the server plumbing thin.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type RouteResult = { status: number; body: unknown };

/** The one small piece of real behaviour this starter ships — replace it. */
export function route(method: string, path: string): RouteResult {
  if (method === 'GET' && path === '/health') return { status: 200, body: { ok: true } };
  return { status: 404, body: { error: 'not found' } };
}

function handler(req: IncomingMessage, res: ServerResponse): void {
  const { status, body } = route(req.method ?? 'GET', req.url ?? '/');
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createApp() {
  return createServer(handler);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => process.stdout.write(`listening on :${port}\n`));
}
