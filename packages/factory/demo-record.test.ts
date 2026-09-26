/**
 * Door test (mfv5.2.3) for demo-record.ts + demo-overlay.ts (D8), plus the
 * demo-model.ts binding (`collectCapturedMedia`/`mergeCapturedMedia`) they
 * feed. Real chromium via `playwright-core` throughout — no mocking the
 * thing under test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  assertPathSegment,
  recordBrowser,
  recordTerminal,
  terminalPageHtml,
  terminalFooterText,
  DemoRecordError,
} from './demo-record.ts';
import { installForgeOverlay } from './demo-overlay.ts';
import { screenshotUrl } from './demo-capture.ts';
import { collectCapturedMedia, mergeCapturedMedia, type DemoModel } from '@forge/stations/demo-model.ts';

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function magic(buf: Buffer, n: number): number[] {
  return [...buf.subarray(0, n)];
}

/** A temp dir shaped `<tmp>/_worktrees/<id>/`, mirroring a real demo bundle's
 *  home inside a project worktree. Returns the leaf to pass as `bundleDir`
 *  and the root to clean up. */
function worktreeShapedTmp(): { dir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'forge-demo-record-'));
  const id = `wt-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(root, '_worktrees', id);
  mkdirSync(dir, { recursive: true });
  return { dir, root };
}

/** Serve one static HTML string on a unique free port (port 0 → OS-assigned;
 *  never a hardcoded/reused port). */
function serveTinyPage(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolveServer) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolveServer({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// ── installForgeOverlay ──────────────────────────────────────────────────────

test('installForgeOverlay: cursor dot follows mousemove, a ring spawns on mousedown, a key chip shows keydown text', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 300 } });
    await context.addInitScript(installForgeOverlay);
    const page = await context.newPage();
    // A `data:` navigation, not `page.setContent()` — see demo-record.ts's
    // `recordTerminal` comment: `setContent`'s document.open/write/close
    // reload drops the addInitScript-installed window listeners this test
    // exercises, even though `window.__forgeOverlay` itself survives it.
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent('<html><body>hi</body></html>')}`);

    await page.mouse.move(120, 90);
    const cursorTransform = await page.evaluate(
      () => (document.querySelector('[data-forge-overlay-cursor]') as HTMLElement | null)?.style.transform,
    );
    assert.equal(cursorTransform, 'translate(120px, 90px)');

    await page.mouse.move(121, 91); // mousedown needs a prior move on some platforms
    await page.mouse.down();
    const ringCount = await page.evaluate(
      () => document.querySelectorAll('[data-forge-overlay-ring]').length,
    );
    assert.equal(ringCount, 1, 'exactly one ring exists right after mousedown');
    await page.mouse.up();

    await page.keyboard.press('a');
    const chipText = await page.evaluate(
      () => (document.querySelector('[data-forge-overlay-keychip]') as HTMLElement | null)?.textContent,
    );
    assert.equal(chipText, 'a');

    await context.close();
  } finally {
    await browser.close();
  }
});

test('installForgeOverlay: outline() boxes each region + dims the rest, zoom() scales the page', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 300 } });
    await context.addInitScript(installForgeOverlay);
    const page = await context.newPage();
    await page.setContent(
      '<html><body>' +
        '<div id="a" style="position:absolute;left:10px;top:10px;width:50px;height:20px;">a</div>' +
        '<div id="b" style="position:absolute;left:100px;top:100px;width:50px;height:20px;">b</div>' +
        '</body></html>',
    );

    await page.evaluate(() =>
      (window as unknown as { __forgeOverlay: { outline(r: string[]): void } }).__forgeOverlay.outline([
        '#a',
        '#b',
      ]),
    );
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-forge-overlay-outline]')].map((el) => (el as HTMLElement).style.boxShadow),
    );
    assert.equal(boxes.length, 2, 'one accent box per region');
    assert.ok(boxes.some((b) => b.includes('100vmax')), 'exactly one box carries the dim-the-rest shadow');

    await page.evaluate(() =>
      (window as unknown as { __forgeOverlay: { zoom(r: string): void } }).__forgeOverlay.zoom('#a'),
    );
    const bodyTransform = await page.evaluate(() => document.body.style.transform);
    assert.equal(bodyTransform, 'scale(1.6)');

    await context.close();
  } finally {
    await browser.close();
  }
});

// ── terminalPageHtml / terminalFooterText ───────────────────────────────────

test('terminalPageHtml: the footer text names the .out file its evidence came from', () => {
  assert.equal(terminalFooterText('checkout-flow'), 'rendered from checkout-flow.out');
  const html = terminalPageHtml('before', 'checkout-flow');
  assert.match(html, /rendered from checkout-flow\.out/);
});

// ── assertPathSegment ────────────────────────────────────────────────────────

test('assertPathSegment: accepts a safe label; refuses .., stringified nullish, empty, oversize, and bad charset', () => {
  assert.equal(assertPathSegment('checkout-flow.v2', 'test'), 'checkout-flow.v2');
  const refused = ['..', 'null', 'undefined', 'NaN', '', 'a'.repeat(81), 'a/b', 'a b', '../etc', 'a..b'];
  for (const bad of refused) {
    assert.throws(
      () => assertPathSegment(bad, 'test'),
      (err: unknown) => err instanceof DemoRecordError,
      `expected a DemoRecordError refusal for ${JSON.stringify(bad)}`,
    );
  }
});

// ── screenshotUrl (item 3: no more hidden `npx playwright` shell-out) ──────

test('screenshotUrl: writes a real PNG for a served page with no subprocess', async () => {
  const server = await serveTinyPage('<html><body><h1>hello</h1></body></html>');
  const dir = mkdtempSync(join(tmpdir(), 'forge-screenshot-'));
  try {
    const outPath = join(dir, 'nested', 'shot.png');
    const ok = await screenshotUrl(server.url, outPath);
    assert.equal(ok, true);
    assert.deepEqual(magic(readFileSync(outPath), 8), PNG_SIGNATURE);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('screenshotUrl: returns false (never throws) for an unreachable URL', async () => {
  const ok = await screenshotUrl('http://127.0.0.1:1/unreachable', join(tmpdir(), 'forge-screenshot-never.png'));
  assert.equal(ok, false);
});

// ── recordBrowser (door test, mfv5.2.3) ─────────────────────────────────────

test('recordBrowser: writes a webm (EBML magic) and a filmstrip (PNG signature) for a served page', async () => {
  const { dir, root } = worktreeShapedTmp();
  const server = await serveTinyPage(
    '<html><body><h1 id="hdr">hello</h1><input id="box" /></body></html>',
  );
  try {
    const result = await recordBrowser({
      side: 'before',
      label: 'checkout-flow',
      url: server.url,
      steps: [{ fill: '#box', text: 'hi' }, { click: '#hdr' }],
      regions: ['#hdr'],
      bundleDir: dir,
    });

    assert.equal(result.webm, join(dir, 'before', 'checkout-flow.webm'));
    const webmBuf = readFileSync(result.webm);
    assert.ok(webmBuf.length > 0, 'webm has bytes');
    assert.deepEqual(magic(webmBuf, 4), EBML_MAGIC, 'webm starts with the EBML/WebM magic');

    assert.equal(result.filmstrip, join(dir, 'before', 'checkout-flow.filmstrip.png'));
    const pngBuf = readFileSync(result.filmstrip);
    assert.deepEqual(magic(pngBuf, 8), PNG_SIGNATURE, 'filmstrip starts with the PNG signature');

    assert.ok(result.stills.length >= 3, 'a still after the fill, after the click, and the final outlined frame');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('recordBrowser: refuses an unsafe label/side before touching the filesystem', async () => {
  const { dir, root } = worktreeShapedTmp();
  const server = await serveTinyPage('<html><body>hi</body></html>');
  try {
    await assert.rejects(
      () => recordBrowser({ side: 'before', label: '../escape', url: server.url, bundleDir: dir }),
      (err: unknown) => err instanceof DemoRecordError,
    );
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ── recordTerminal ───────────────────────────────────────────────────────────

test('recordTerminal: writes a webm + filmstrip; the rendered page footer names the .out file', async () => {
  const { dir, root } = worktreeShapedTmp();
  try {
    const result = await recordTerminal({
      side: 'after',
      label: 'build-log',
      argv: ['node', '-e', "console.log('ok')"],
      outText: 'line one\nline two\n',
      bundleDir: dir,
    });

    const webmBuf = readFileSync(result.webm);
    assert.deepEqual(magic(webmBuf, 4), EBML_MAGIC);
    const pngBuf = readFileSync(result.filmstrip);
    assert.deepEqual(magic(pngBuf, 8), PNG_SIGNATURE);
    assert.match(terminalPageHtml('after', 'build-log'), /rendered from build-log\.out/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── demo-model.ts binding (collectCapturedMedia / mergeCapturedMedia) ───────

function baseModel(label: string): DemoModel {
  return {
    title: 't',
    essence: 'e',
    project: 'p',
    diffStat: '+1 -1',
    checkpoints: [{ label, caption: 'c' }],
  };
}

test('collectCapturedMedia: binds .webm to *VideoSrc and lets .filmstrip.png win over a plain .png', () => {
  const bundleDir = mkdtempSync(join(tmpdir(), 'forge-demo-bind-'));
  try {
    for (const side of ['before', 'after'] as const) {
      const d = join(bundleDir, side);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'checkout-flow.webm'), Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]));
      // A plain screenshot AND a filmstrip of the same label — filmstrip must win.
      writeFileSync(join(d, 'checkout-flow.png'), Buffer.from(PNG_SIGNATURE.concat([1])));
      writeFileSync(join(d, 'checkout-flow.filmstrip.png'), Buffer.from(PNG_SIGNATURE.concat([2])));
    }
    const captured = collectCapturedMedia(bundleDir);
    assert.equal(captured.length, 1);
    const [cap] = captured;
    assert.equal(cap.label, 'checkout-flow');
    assert.equal(cap.beforeVideoSrc, '.capture/before/checkout-flow.webm');
    assert.equal(cap.afterVideoSrc, '.capture/after/checkout-flow.webm');
    const filmstripUri = `data:image/png;base64,${Buffer.from(PNG_SIGNATURE.concat([2])).toString('base64')}`;
    assert.equal(cap.beforeImage, filmstripUri, 'the filmstrip PNG wins over the plain PNG');
    assert.equal(cap.afterImage, filmstripUri);

    const merged = mergeCapturedMedia(baseModel('checkout-flow'), captured);
    const [cp] = merged.checkpoints;
    assert.equal(cp.kind, 'video', "a bound webm promotes the checkpoint's kind to 'video'");
    assert.equal(cp.beforeVideoSrc, '.capture/before/checkout-flow.webm');
    assert.equal(cp.afterVideoSrc, '.capture/after/checkout-flow.webm');
    assert.equal(cp.beforeImage, filmstripUri);
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }
});

test('collectCapturedMedia: a plain .png with no filmstrip still binds as the image (no webm ⇒ kind stays screenshot)', () => {
  const bundleDir = mkdtempSync(join(tmpdir(), 'forge-demo-bind-plain-'));
  try {
    const d = join(bundleDir, 'before');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'other-flow.png'), Buffer.from(PNG_SIGNATURE.concat([3])));
    const captured = collectCapturedMedia(bundleDir);
    const [cap] = captured;
    assert.equal(cap.beforeVideoSrc, undefined);
    assert.ok(cap.beforeImage?.startsWith('data:image/png;base64,'));

    const merged = mergeCapturedMedia(baseModel('other-flow'), captured);
    assert.equal(merged.checkpoints[0].kind, 'screenshot');
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }
});
