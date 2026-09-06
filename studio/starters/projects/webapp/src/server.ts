/**
 * {{TITLE}} — {{NORTH_STAR}}
 *
 * A dependency-light HTTP server on node:http, serving HTML. Keep the
 * page-rendering LOGIC in pure functions (like `page` below) so the quality
 * gate tests behaviour without binding a socket; keep the server plumbing thin.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type PageResult = { status: number; body: string };

/** The one small piece of real behaviour this starter ships — replace it. */
export function page(method: string, path: string): PageResult {
  if (method === 'GET' && path === '/') return { status: 200, body: '<!doctype html><html><body><h1>It works</h1></body></html>' };
  return { status: 404, body: '<!doctype html><html><body><h1>Not found</h1></body></html>' };
}

function handler(req: IncomingMessage, res: ServerResponse): void {
  const { status, body } = page(req.method ?? 'GET', req.url ?? '/');
  res.writeHead(status, { 'content-type': 'text/html' });
  res.end(body);
}

export function createApp() {
  return createServer(handler);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => process.stdout.write(`listening on :${port}\n`));
}
