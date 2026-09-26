/**
 * demo-capture.ts — the forge-owned demo recorder (forge-mfv5.2.1).
 *
 * ONE recorder, two modes, both driven through `playwright-core` directly
 * (chromium.launch — no `npx`, no shell). `recordTerminal` renders a
 * forge-owned terminal page and types a captured command's argv + reveals its
 * already-captured stdout; `recordBrowser` drives a real page through
 * declared steps. Both install `demo-overlay.ts`'s cursor/ring/key-chip/
 * outline/zoom via `context.addInitScript`, take stills along the way, and
 * end with `<bundleDir>/<side>/<label>.webm` + `<bundleDir>/<side>/<label>.
 * filmstrip.png` (a grid of the stills, rendered as HTML and screenshotted —
 * no ffmpeg, no image library).
 *
 * Errors are explicit and typed (`DemoRecordError`), never swallowed here.
 * ADR 021's best-effort media contract lives at the CALL SITE (the capture
 * loop in demo.ts logs and continues) — this module always tells the truth
 * about whether a recording actually happened.
 */

import { chromium, type Browser, type BrowserContext, type Page, type Video } from 'playwright-core';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installForgeOverlay, type OverlayRegion, type ForgeOverlayHandle } from './demo-overlay.ts';

const VIEWPORT = { width: 1280, height: 720 } as const;
const TYPE_DELAY_MS = 35;
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 200;
const MAX_REVEAL_LINES = 200;
const REVEAL_LINE_DELAY_MS = 40;
const FILMSTRIP_COLUMNS = 4;
const FILMSTRIP_COL_WIDTH = 320;

/** A launch/record failure. Media capture is best-effort ONLY at the caller
 *  (ADR 021) — this class never swallows; it names what failed. */
export class DemoRecordError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DemoRecordError';
  }
}

// ── Path-segment guard (label/side) ─────────────────────────────────────────
//
// Same shape as `sessionIdSegment` (scripts/lib/journey-assertions.mjs): a
// charset allow-list PLUS an explicit stringified-nullish denylist, because
// the charset alone passes `null`/`undefined`/`NaN` — they are well-formed
// path segments, just not ones anything meant to write. Throws rather than
// slugging: a recorder writing to a caller-chosen path segment must refuse a
// bad one, not silently rename it (that is `checkpointArtifactStem`'s job,
// one layer up, before the label reaches here).

const MAX_SEGMENT_CHARS = 80;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const REFUSED_SEGMENTS = new Set(['null', 'undefined', 'NaN']);

export function assertPathSegment(value: string, who: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_SEGMENT_CHARS ||
    !SAFE_SEGMENT_RE.test(value) ||
    value.includes('..') ||
    REFUSED_SEGMENTS.has(value)
  ) {
    throw new DemoRecordError(`${who}: refusing an unsafe path segment: ${JSON.stringify(value)}`);
  }
  return value;
}

export type RecordSide = 'before' | 'after';

/** The side is a closed set, not merely a safe segment: any other value would open a third directory under the bundle. */
function assertSide(value: string, who: string): RecordSide {
  if (value !== 'before' && value !== 'after') {
    throw new DemoRecordError(`${who}: side must be "before" or "after", got ${JSON.stringify(value)}`);
  }
  return value;
}

export type RecordResult = {
  webm: string;
  filmstrip: string;
  /** The `data:image/png;base64,...` stills the filmstrip was composed from. */
  stills: string[];
};

export type RecordTerminalInput = {
  side: RecordSide;
  label: string;
  /** Bare argv (no shell) — the same command `captureCommandOutput` ran. */
  argv: string[];
  /** The REAL captured stdout (`.out` bytes) — this only renders them. */
  outText: string;
  bundleDir: string;
};

export type BrowserStep = { fill: string; text: string } | { press: string } | { click: string };

export type RecordBrowserInput = {
  side: RecordSide;
  label: string;
  url: string;
  steps?: BrowserStep[];
  regions?: OverlayRegion[];
  bundleDir: string;
};

// ── Shared recording lifecycle ──────────────────────────────────────────────

type Recording = { browser: Browser; context: BrowserContext; page: Page; videoDir: string };

async function launchRecording(): Promise<Recording> {
  const videoDir = mkdtempSync(join(tmpdir(), 'forge-demo-video-'));
  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    rmSync(videoDir, { recursive: true, force: true });
    throw new DemoRecordError('demo-capture: chromium failed to launch', err);
  }
  try {
    const context = await browser.newContext({
      recordVideo: { dir: videoDir, size: VIEWPORT },
      viewport: VIEWPORT,
    });
    await context.addInitScript(installForgeOverlay);
    const page = await context.newPage();
    return { browser, context, page, videoDir };
  } catch (err) {
    await browser.close().catch(() => {});
    rmSync(videoDir, { recursive: true, force: true });
    throw new DemoRecordError('demo-capture: failed to open a recording context', err);
  }
}

async function stillDataUri(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: 'png' });
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function overlay(page: Page): { outline(regions: OverlayRegion[]): Promise<void> } {
  return {
    outline: (regions) =>
      page.evaluate(
        (r) => (window as unknown as { __forgeOverlay: ForgeOverlayHandle }).__forgeOverlay.outline(r),
        regions,
      ),
  };
}

function filmstripGridHtml(stills: string[], cols: number): string {
  const imgs = stills.map((src) => `<img src="${src}" />`).join('');
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;background:#0d1117;}' +
    `.grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;padding:4px;}` +
    '.grid img{display:block;width:100%;}' +
    `</style></head><body><div class="grid">${imgs}</div></body></html>`
  );
}

/** Save the finalised video + build the filmstrip. `browser` stays open —
 *  the caller closes it (it also needs it for the filmstrip's grid page). */
async function writeArtifacts(opts: {
  browser: Browser;
  video: Video;
  bundleDir: string;
  side: RecordSide;
  label: string;
  stills: string[];
}): Promise<RecordResult> {
  const { browser, video, bundleDir, side, label, stills } = opts;
  const sideDir = join(bundleDir, side);
  mkdirSync(sideDir, { recursive: true });

  const webm = join(sideDir, `${label}.webm`);
  await video.saveAs(webm);

  const filmstrip = join(sideDir, `${label}.filmstrip.png`);
  const cols = Math.max(1, Math.min(stills.length, FILMSTRIP_COLUMNS));
  const gridPage = await browser.newPage({
    viewport: { width: FILMSTRIP_COL_WIDTH * cols, height: FILMSTRIP_COL_WIDTH },
  });
  try {
    await gridPage.setContent(filmstripGridHtml(stills, cols));
    await gridPage.screenshot({ path: filmstrip, fullPage: true });
  } finally {
    await gridPage.close();
  }
  return { webm, filmstrip, stills };
}

// ── recordTerminal ───────────────────────────────────────────────────────────

/** The `#footer` text is baked into the static HTML (not set later via
 *  `page.evaluate`) so it is deterministic and directly assertable — see
 *  `terminalPageHtml`'s own tests. */
export function terminalFooterText(label: string): string {
  return `rendered from ${label}.out`;
}

export function terminalPageHtml(side: RecordSide, label: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%;background:#0d1117;color:#c9d1d9;' +
    'font-family:ui-monospace,Menlo,Consolas,monospace;}' +
    '.term{padding:24px;}' +
    '.titlebar{font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px;}' +
    '.prompt{display:flex;align-items:center;gap:8px;font-size:16px;margin-bottom:20px;}' +
    '.prompt .sigil{color:#3fb950;}' +
    '#cmdline{background:transparent;border:none;color:#e6edf3;font:inherit;outline:none;flex:1;caret-color:#e6edf3;}' +
    '#output{white-space:pre-wrap;font-size:13px;line-height:1.6;min-height:24px;}' +
    '#footer{margin-top:20px;font-size:11px;color:#6e7681;}' +
    '</style></head><body><div class="term">' +
    `<div class="titlebar">${side} — ${label}</div>` +
    '<div class="prompt"><span class="sigil">$</span><input id="cmdline" /></div>' +
    '<pre id="output"></pre>' +
    `<div id="footer">${terminalFooterText(label)}</div>` +
    '</div></body></html>'
  );
}

/** Render a forge-owned terminal page: type `argv` char-by-char (so the
 *  overlay's key-chip shows it), reveal `outText` line by line, then outline
 *  the output and finalise the webm + filmstrip. The evidence stays the
 *  `.out` bytes — this only renders them. */
export async function recordTerminal(input: RecordTerminalInput): Promise<RecordResult> {
  const side = assertSide(input.side, 'recordTerminal');
  const label = assertPathSegment(input.label, 'recordTerminal: label');
  const { browser, context, page, videoDir } = await launchRecording();
  let contextClosed = false;
  try {
    // A `data:` navigation, not `page.setContent()` — measured (chromium
    // 1.60/playwright-core): `setContent`'s internal document.open/write/close
    // reload drops the `window` listeners `context.addInitScript` installed
    // (the overlay's mousemove/mousedown/keydown hooks), even though it keeps
    // the SAME window object (a property set before `setContent` still reads
    // back after it). A `data:` URL is a REAL navigation — no network, and
    // `addInitScript` re-fires for it correctly — so the overlay is live.
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(terminalPageHtml(side, label))}`);
    await page.click('#cmdline');
    await page.keyboard.type(input.argv.join(' '), { delay: TYPE_DELAY_MS });
    const stills: string[] = [await stillDataUri(page)];

    for (const line of input.outText.split('\n').slice(0, MAX_REVEAL_LINES)) {
      await page.evaluate((l) => {
        const out = document.getElementById('output');
        if (out) out.textContent = (out.textContent ? `${out.textContent}\n` : '') + l;
      }, line);
      await page.waitForTimeout(REVEAL_LINE_DELAY_MS);
    }
    await overlay(page).outline(['#output']);
    stills.push(await stillDataUri(page));

    const video = page.video();
    await context.close();
    contextClosed = true;
    if (!video) throw new DemoRecordError(`recordTerminal: no video was recorded for ${side}/${label}`);
    return await writeArtifacts({ browser, video, bundleDir: input.bundleDir, side, label, stills });
  } catch (err) {
    if (err instanceof DemoRecordError) throw err;
    throw new DemoRecordError(`recordTerminal: failed recording ${side}/${label}`, err);
  } finally {
    if (!contextClosed) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    rmSync(videoDir, { recursive: true, force: true });
  }
}

// ── recordBrowser ────────────────────────────────────────────────────────────

/** Navigate, run declared steps, settle, outline regions, then finalise the
 *  webm + filmstrip. The last still doubles as the checkpoint's screenshot. */
export async function recordBrowser(input: RecordBrowserInput): Promise<RecordResult> {
  const side = assertSide(input.side, 'recordBrowser');
  const label = assertPathSegment(input.label, 'recordBrowser: label');
  const { browser, context, page, videoDir } = await launchRecording();
  let contextClosed = false;
  try {
    await page.goto(input.url, { timeout: NAV_TIMEOUT_MS });
    const stills: string[] = [];
    for (const step of input.steps ?? []) {
      if ('fill' in step) {
        await page.click(step.fill);
        await page.keyboard.type(step.text, { delay: TYPE_DELAY_MS });
        stills.push(await stillDataUri(page));
      } else if ('click' in step) {
        await page.click(step.click);
        stills.push(await stillDataUri(page));
      } else if ('press' in step) {
        await page.keyboard.press(step.press);
      } else {
        throw new DemoRecordError(`recordBrowser: unrecognised step ${JSON.stringify(step)}`);
      }
    }
    await page.waitForTimeout(SETTLE_MS);
    if (input.regions && input.regions.length > 0) {
      await overlay(page).outline(input.regions);
    }
    stills.push(await stillDataUri(page)); // final outlined frame — also the checkpoint screenshot

    const video = page.video();
    await context.close();
    contextClosed = true;
    if (!video) throw new DemoRecordError(`recordBrowser: no video was recorded for ${side}/${label}`);
    return await writeArtifacts({ browser, video, bundleDir: input.bundleDir, side, label, stills });
  } catch (err) {
    if (err instanceof DemoRecordError) throw err;
    throw new DemoRecordError(`recordBrowser: failed recording ${side}/${label} at ${input.url}`, err);
  } finally {
    if (!contextClosed) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    rmSync(videoDir, { recursive: true, force: true });
  }
}
