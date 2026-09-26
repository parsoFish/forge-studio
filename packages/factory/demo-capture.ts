/**
 * Minimal screenshot helper used by `forge demo capture`.
 *
 * Uses `playwright-core` directly (`chromium.launch` — the same engine
 * demo-record.ts drives) to take ONE screenshot of a URL and write it to
 * `outPath`. Best-effort: returns false on any error so the caller can
 * degrade gracefully.
 *
 * Previously shelled `npx --yes playwright screenshot` — a HIDDEN dependency
 * on whatever `playwright` version npx happened to resolve, network access to
 * fetch it, and a chromium download it could trigger mid-run. `playwright-core`
 * is a declared root dependency (package.json) with chromium already cached
 * locally, so this now runs in-process with no subprocess and no surprises.
 *
 * This is intentionally thin — no spec authoring, no multi-test runner.
 * The agent (unifier) authors the checkpoints; this tool captures one PNG
 * per label.
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const VIEWPORT = { width: 1280, height: 720 } as const;
const NAV_TIMEOUT_MS = 30_000;

/**
 * Take a single screenshot of `url` and write it to `outPath` (PNG).
 * Returns true on success, false on any failure.
 */
export async function screenshotUrl(url: string, outPath: string): Promise<boolean> {
  mkdirSync(dirname(outPath), { recursive: true });
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(url, { timeout: NAV_TIMEOUT_MS });
    await page.screenshot({ path: outPath });
    return true;
  } catch {
    return false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
