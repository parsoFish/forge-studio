/**
 * Acceptance test — the UI font is self-hosted, no external font load
 * (R6-03-F3 rider).
 *
 * Immutable-gate, RED-first. The mockup's signature display face loads from
 * Google Fonts; that load is mock-only. The shipped app must BUNDLE the font
 * (self-host) — no request ever leaves the origin for a typeface. As-built,
 * forge-ui already has no external font URL but bundles NOTHING (it names the
 * faces and silently falls back to system-ui), so the meaningful RED->GREEN is
 * the POSITIVE: a real font file ships and an @font-face references it from a
 * same-origin path. The negative (no googleapis/gstatic) is pinned too so a
 * future edit can't reintroduce an external fetch.
 *
 * Kills: naming the font in a CSS var while shipping no file (design silently
 * renders as system-ui), or re-adding a `fonts.googleapis`/`fonts.gstatic`
 * link.
 *
 * RUN: node --test --experimental-strip-types scripts/font-selfhost.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'apps', 'studio');
const GLOBALS = join(UI, 'app', 'globals.css');

const EXTERNAL_FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'use.typekit', 'fontawesome.com'];
const SOURCE_EXTS = ['.css', '.ts', '.tsx', '.mjs', '.js'];

function walk(dir: string, pick: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, pick));
    else if (pick(p)) out.push(p);
  }
  return out;
}

test('no forge-ui source references an external font host', () => {
  const sources = walk(UI, (p) => SOURCE_EXTS.some((e) => p.endsWith(e)));
  const offenders: string[] = [];
  for (const f of sources) {
    const src = readFileSync(f, 'utf8');
    if (EXTERNAL_FONT_HOSTS.some((h) => src.includes(h))) offenders.push(f.slice(ROOT.length + 1));
  }
  assert.deepEqual(offenders, [], 'the shipped app must not fetch a font from an external host');
});

test('a real font file is bundled inside forge-ui', () => {
  const fonts = walk(UI, (p) => p.endsWith('.woff2') || p.endsWith('.woff'));
  assert.ok(fonts.length > 0, 'at least one self-hosted font file (.woff2) must ship under apps/studio/');
  // A real font, not an empty stub.
  for (const f of fonts) {
    assert.ok(statSync(f).size > 1000, `bundled font ${f.slice(ROOT.length + 1)} looks empty/stubbed`);
  }
});

test('an @font-face binds the display face to a same-origin file', () => {
  assert.ok(existsSync(GLOBALS), 'apps/studio/app/globals.css must exist');
  const css = readFileSync(GLOBALS, 'utf8');
  assert.match(css, /@font-face/, 'globals.css must declare @font-face for the self-hosted face');
  // The @font-face src points at a same-origin path (starts with / or ./), never an external URL.
  const srcMatch = css.match(/@font-face[\s\S]*?src:\s*([^;]+);/);
  assert.ok(srcMatch, '@font-face must carry a src');
  const srcVal = srcMatch![1];
  assert.match(srcVal, /url\(\s*['"]?[./]/, '@font-face src must be a same-origin path (self-hosted), not an external URL');
  assert.ok(
    !EXTERNAL_FONT_HOSTS.some((h) => srcVal.includes(h)),
    '@font-face src must not reference an external font host',
  );
});
