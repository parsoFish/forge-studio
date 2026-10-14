/**
 * Row 4 of forge-nk1y.45 — a screenshot checkpoint drives its declared steps.
 * `captureCheckpoints` called `recordBrowser` with no `steps`/`regions`
 * (demo.ts, the browser loop), so a UI "before/after" was a bare page load;
 * and a `test-evidence` checkpoint (gate output, no command) was treated as a
 * browser checkpoint and recorded as a root-page still. Real chromium on a
 * served tmp page — no project tree, no network beyond 127.0.0.1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { browserCheckpointsOf, recordBrowserCheckpoint } from '../../demo.ts';

test('browserCheckpointsOf: carries steps and regions; test-evidence, harness and command checkpoints are not browser captures', () => {
  const steps = [{ click: '#go' }];
  const r = browserCheckpointsOf([
    { label: 'Plan 1: WI-1', form: 'screenshot', kind: 'screenshot', route: '/dash', steps, regions: ['#out'] },
    { label: 'Plan 2: test-evidence', form: 'test-evidence' },
    { label: 'harness', kind: 'harness' },
    { label: 'cli', command: 'gw plan' },
    { label: 'api', apiPath: '/api/x' },
  ]);
  assert.deepEqual(r, { checkpoints: [{ label: 'Plan 1: WI-1', route: '/dash', steps, regions: ['#out'] }], refused: [] });
});

test('browserCheckpointsOf: malformed steps are refused by name at the point of use, never driven', () => {
  const r = browserCheckpointsOf([{ label: 'Plan 1', form: 'screenshot', route: '/', steps: [{ hover: '#x' }] }]);
  assert.deepEqual(r.checkpoints, []);
  assert.equal(r.refused.length, 1);
  assert.match(r.refused[0]!, /^Plan 1: .*steps\[0\]: must be exactly one of/);
});

function serve(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((done) => {
    const server = http.createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((c) => server.close(() => c())) });
    });
  });
}
const digest = (s: string): string => createHash('sha256').update(s).digest('hex');

test('recordBrowserCheckpoint drives the declared steps: the final frame differs from the no-steps control', { timeout: 120_000 }, async () => {
  const page = await serve('<html><body style="font:40px sans-serif"><button id="go" onclick="document.getElementById(\'out\').textContent=\'APPLIED FILTER: alice\'">go</button><p id="out">idle</p></body></html>');
  const bundleDir = mkdtempSync(join(tmpdir(), 'demo-steps-'));
  try {
    const control = await recordBrowserCheckpoint({ label: 'control', route: '/' }, 'before', page.url, bundleDir);
    const driven = await recordBrowserCheckpoint({ label: 'driven', route: '/', steps: [{ click: '#go' }], regions: ['#out'] }, 'before', page.url, bundleDir);
    // The final frame (the checkpoint's still) of each recording.
    assert.notEqual(digest(driven.stills.at(-1)!), digest(control.stills.at(-1)!));
    assert.ok(driven.stills.length > control.stills.length, 'the click recorded its own still');
  } finally {
    await page.close();
    rmSync(bundleDir, { recursive: true, force: true });
  }
});

test('a step that navigates off the tree\'s own server is refused — evidence never comes from another origin', { timeout: 120_000 }, async () => {
  const elsewhere = await serve('<html><body>another origin</body></html>');
  const page = await serve(`<html><body><a id="away" href="${elsewhere.url}">away</a></body></html>`);
  const bundleDir = mkdtempSync(join(tmpdir(), 'demo-steps-origin-'));
  try {
    await assert.rejects(
      () => recordBrowserCheckpoint({ label: 'escape', route: '/', steps: [{ click: '#away' }] }, 'after', page.url, bundleDir),
      /left the tree's own server/,
    );
  } finally {
    await page.close();
    await elsewhere.close();
    rmSync(bundleDir, { recursive: true, force: true });
  }
});
