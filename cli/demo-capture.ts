/**
 * Minimal screenshot helper used by `forge demo capture`.
 *
 * Uses `playwright` (if available in the project tree) or puppeteer to take
 * ONE screenshot of a URL and write it to `outPath`. Best-effort: returns
 * false on any error so the caller can degrade gracefully.
 *
 * This is intentionally thin — no spec authoring, no multi-test runner.
 * The agent (unifier) authors the checkpoints; this tool captures one PNG
 * per label.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Take a single screenshot of `url` and write it to `outPath` (PNG).
 * Resizes to ≤800px wide so the self-contained HTML stays portable.
 * Returns true on success, false on any failure.
 */
export async function screenshotUrl(url: string, outPath: string): Promise<boolean> {
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    // Use npx playwright screenshot — available in any project that has
    // @playwright/test; falls back gracefully if not installed.
    execFileSync(
      'npx',
      [
        '--yes',
        'playwright',
        'screenshot',
        '--browser', 'chromium',
        '--viewport-size', '1280,720',
        url,
        outPath,
      ],
      {
        stdio: 'pipe',
        timeout: 30_000,
        env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '0' },
      },
    );
    return true;
  } catch {
    return false;
  }
}
