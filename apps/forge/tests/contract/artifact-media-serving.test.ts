/**
 * forge-mfv5.1.29 — GET /api/artifact/<cycleId>/<filename> serves MEDIA.
 *
 * Live defect: `.capture/before/<name>.webm` came back 200 `text/plain` (and,
 * because the route read the file as a utf8 string, with the bytes mangled), so
 * every <video> on the verdict page failed MEDIA_ERR_SRC_NOT_SUPPORTED. Pinned
 * through a REAL bridge response, not a helper call:
 *
 *   1. one content-type per extension in the single kernel table;
 *   2. the body is the file's EXACT bytes (binary survives);
 *   3. single-range `Range: bytes=...` support (206 / 416) and the documented
 *      "ignore a multi-range or malformed Range, send 200 full" choice;
 *   4. the path guard still refuses a symlinked media leaf / a `..` segment.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

const CYCLE = 'media-cycle';
const SIZE = 1000;
/** Every byte value, repeated: any utf8 round-trip corrupts the high half. */
const BYTES = Buffer.from(Array.from({ length: SIZE }, (_, i) => i % 256));

// [file under artifacts/, expected content-type]
const TABLE: ReadonlyArray<readonly [string, string]> = [
  ['.capture/before/a.webm', 'video/webm'],
  ['clip.mp4', 'video/mp4'],
  ['shot.png', 'image/png'],
  ['shot.jpg', 'image/jpeg'],
  ['shot.jpeg', 'image/jpeg'],
  ['anim.gif', 'image/gif'],
  ['logo.svg', 'image/svg+xml'],
  ['shot.webp', 'image/webp'],
  ['data.json', 'application/json'],
  ['note.md', 'text/markdown; charset=utf-8'],
  ['PLAN.html', 'text/html; charset=utf-8'],
  ['note.txt', 'text/plain; charset=utf-8'],
  ['run.log', 'text/plain; charset=utf-8'],
  ['SHOUT.WEBM', 'video/webm'],
];

let forgeRoot: string;
let outside: string;
let url: string;
let close: () => Promise<void>;

function artifactUrl(filename: string): string {
  return `${url}/api/artifact/${CYCLE}/${encodeURIComponent(filename)}`;
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-artifact-media-'));
  outside = mkdtempSync(join(tmpdir(), 'bridge-artifact-media-outside-'));
  const artifacts = join(forgeRoot, '_logs', CYCLE, 'artifacts');
  mkdirSync(join(artifacts, '.capture', 'before'), { recursive: true });
  for (const name of TABLE.map(([n]) => n)) writeFileSync(join(artifacts, name), BYTES);
  writeFileSync(join(artifacts, 'unknown.out'), 'plain evidence');
  writeFileSync(join(outside, 'secret.webm'), BYTES);
  symlinkSync(join(outside, 'secret.webm'), join(artifacts, '.capture', 'before', 'evil.webm'), 'file');
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  if (outside) rmSync(outside, { recursive: true, force: true });
});

for (const [file, want] of TABLE) {
  test(`content-type ${file} -> ${want}, exact bytes, nosniff, Accept-Ranges`, async () => {
    const res = await fetch(artifactUrl(file));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), want);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-length'), String(SIZE));
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(BYTES), 'body must be the file bytes, unmangled');
  });
}

test('an unknown extension keeps today\'s behaviour: text/plain; charset=utf-8', async () => {
  const res = await fetch(artifactUrl('unknown.out'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await res.text(), 'plain evidence');
});

const WEBM = '.capture/before/a.webm';

async function ranged(range: string): Promise<Response> {
  return fetch(artifactUrl(WEBM), { headers: { range } });
}

test('Range bytes=a-b -> 206 with Content-Range, Content-Length and the exact slice', async () => {
  const res = await ranged('bytes=100-199');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 100-199/${SIZE}`);
  assert.equal(res.headers.get('content-length'), '100');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'video/webm');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(BYTES.subarray(100, 200)));
});

test('Range bytes=a- (open-ended, as a browser opens a <video>) -> 206 to end of file', async () => {
  const res = await ranged('bytes=0-');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 0-${SIZE - 1}/${SIZE}`);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(BYTES));
  const tail = await ranged('bytes=990-');
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), `bytes 990-999/${SIZE}`);
  assert.ok(Buffer.from(await tail.arrayBuffer()).equals(BYTES.subarray(990)));
});

test('Range bytes=-n (suffix) -> 206 with the last n bytes', async () => {
  const res = await ranged('bytes=-10');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 990-999/${SIZE}`);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(BYTES.subarray(990)));
  const over = await ranged('bytes=-5000');
  assert.equal(over.status, 206, 'a suffix longer than the file is the whole file');
  assert.equal(over.headers.get('content-range'), `bytes 0-${SIZE - 1}/${SIZE}`);
});

test('Range end past EOF is clamped to the last byte', async () => {
  const res = await ranged('bytes=900-99999');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 900-999/${SIZE}`);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(BYTES.subarray(900)));
});

test('unsatisfiable Range -> 416 with Content-Range: bytes */<size>', async () => {
  for (const r of [`bytes=${SIZE}-`, 'bytes=5000-6000', 'bytes=-0']) {
    const res = await ranged(r);
    assert.equal(res.status, 416, r);
    assert.equal(res.headers.get('content-range'), `bytes */${SIZE}`, r);
    await res.arrayBuffer();
  }
});

test('multi-range, malformed, reversed or non-bytes Range is IGNORED -> 200 full body', async () => {
  for (const r of ['bytes=0-10,20-30', 'bytes=abc', 'bytes=-', 'bytes=', 'bytes=50-10', 'items=0-10', 'bytes 0-10', 'bytes=0-1-2']) {
    const res = await ranged(r);
    assert.equal(res.status, 200, r);
    assert.equal(res.headers.get('content-range'), null, r);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(BYTES), r);
  }
});

test('path guard still holds: a symlinked media leaf is refused, ranged or not', async () => {
  for (const headers of [{} as Record<string, string>, { range: 'bytes=0-9' }]) {
    const res = await fetch(artifactUrl('.capture/before/evil.webm'), { headers });
    assert.ok(res.status === 404 || res.status === 400, `symlinked leaf must be refused, got ${res.status}`);
    assert.ok(!Buffer.from(await res.arrayBuffer()).equals(BYTES.subarray(0, 10)), 'no out-of-root bytes served');
  }
});

test('path guard still holds: a ../ segment in the filename is refused 400', async () => {
  const res = await fetch(`${url}/api/artifact/${CYCLE}/%2E%2E%2Fartifacts%2Fshot.png`, { headers: { range: 'bytes=0-9' } });
  assert.equal(res.status, 400);
});

test('a missing media file is still 404 (no existence oracle change)', async () => {
  const res = await fetch(artifactUrl('.capture/before/missing.webm'), { headers: { range: 'bytes=0-9' } });
  assert.equal(res.status, 404);
});
