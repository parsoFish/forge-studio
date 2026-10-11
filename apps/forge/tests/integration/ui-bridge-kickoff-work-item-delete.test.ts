/**
 * Bead forge-nk1y.32 12b (D-48 amended) — `DELETE /api/kickoff/work-items/<wiId>`
 * `{ initiativeId }` through the real bridge (port 0, tmp forge root holding
 * gitweave I2 as it stands live, no spawn, no network): a work item added at
 * the gate is removed — 200 / 400 / 404 / 409 (`has-dependents`,
 * `not-a-kickoff-work-item`, `not-at-kickoff`); the CORS preflight admits DELETE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';
import { parseWorkItem, serializeWorkItem } from '@forge/flows';
import { I2_INIT, plantI2Kickoff, type I2Paths } from '../../../../packages/flows/tests/test-fixtures/kickoff-deps-i2.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const ROUTE = '/api/kickoff/work-items';

type Reply = { status: number; body: Record<string, unknown> };
type Send = (method: 'PATCH' | 'DELETE', path: string, b: unknown) => Promise<Reply>;
type Client = { url: string; root: string; paths: I2Paths; send: Send };

async function withBridge(fn: (c: Client) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'kickoff-delete-route-'));
  const paths = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const { url, close } = await startBridge({ forgeRoot: root, port: 0 });
  const send: Send = async (method, path, b) => {
    const res = await fetch(`${url}${path}`, { method, headers: CSRF, body: JSON.stringify(b) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try { await fn({ url, root, paths, send }); } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
}

const wi = (dir: string, id: string) => parseWorkItem(readFileSync(join(dir, `${id}.md`), 'utf8'));
const patch = (c: Client, id: string, b: unknown) => c.send('PATCH', `${ROUTE}/${id}`, b);
const del = (c: Client, id: string, b: unknown = { initiativeId: I2_INIT }) => c.send('DELETE', `${ROUTE}/${id}`, b);
const exists = (dir: string, id: string) => existsSync(join(dir, `${id}.md`));
const build = (c: Client) => {
  const wi1 = wi(c.paths.wiDir, 'WI-1');
  writeFileSync(join(c.paths.wiDir, 'WI-1.md'), serializeWorkItem({ ...wi1, status: 'complete' }));
};

test('DELETE 200: WI-14 gone from the worktree, the snapshot and the manifest specs', () => withBridge(async (c) => {
  const r = await del(c, 'WI-14');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, workItemId: 'WI-14' });
  assert.equal(exists(c.paths.wiDir, 'WI-14'), false);
  assert.equal(exists(c.paths.snapshotDir, 'WI-14'), false);
  assert.doesNotMatch(readFileSync(c.paths.manifestPath, 'utf8'), /WI-14/);
}));

test('DELETE 409: has-dependents naming them; a plan work item; once built', () => withBridge(async (c) => {
  assert.equal((await patch(c, 'WI-14', { initiativeId: I2_INIT, dependsOn: ['WI-13'] })).status, 200);
  const a = await del(c, 'WI-13');
  assert.equal(a.status, 409);
  assert.equal(a.body.status, 'has-dependents');
  assert.match(String(a.body.detail), /WI-14/);
  const b = await del(c, 'WI-12');
  assert.equal(b.status, 409);
  assert.equal(b.body.status, 'not-a-kickoff-work-item');
  build(c);
  const d = await del(c, 'WI-14');
  assert.equal(d.status, 409);
  assert.equal(d.body.status, 'not-at-kickoff');
  assert.equal(exists(c.paths.wiDir, 'WI-14'), true);
}));

test('DELETE 404 for an unknown work item; 400 naming initiativeId or workItemId', () => withBridge(async (c) => {
  assert.equal((await del(c, 'WI-99')).status, 404);
  const a = await del(c, 'WI-14', {});
  assert.equal(a.status, 400);
  assert.ok(String(a.body.error).startsWith('initiativeId '));
  const b = await del(c, 'nope');
  assert.equal(b.status, 400);
  assert.ok(String(b.body.error).startsWith('workItemId '));
}));

test('DELETE with an unreadable events log: refused 409 (fail closed), nothing removed', () => withBridge(async (c) => {
  rmSync(join(c.paths.logDir, 'events.jsonl'));
  const r = await del(c, 'WI-14');
  assert.equal(r.status, 409);
  assert.equal(r.body.status, 'not-a-kickoff-work-item');
  assert.equal(exists(c.paths.wiDir, 'WI-14'), true);
}));

test('the CORS preflight admits DELETE on the kickoff work-item route', () => withBridge(async (c) => {
  const headers = { origin: 'http://localhost:4124', 'access-control-request-method': 'DELETE' };
  const res = await fetch(`${c.url}${ROUTE}/WI-14`, { method: 'OPTIONS', headers });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /\bDELETE\b/);
}));
