/**
 * docs-site.test.ts — the docs site refuses a page that does not say what it
 * is, who owns it and when it was checked, refuses a broken internal link, and
 * flags a page older than its freshness window.
 *
 * The build tests copy apps/docs into a gitignored `scripts/.tmp-*` dir (inside
 * the repo so the real node_modules resolve; a symlinked node_modules breaks
 * Vite's compile cache) and run the real `astro build` there, so a fixture
 * page never touches the tracked tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStale, windowDays } from '../apps/docs/src/freshness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps/docs');
const ASTRO = join(ROOT, 'node_modules/.bin/astro');
const DAY = 24 * 60 * 60 * 1000;

function page(fields: Record<string, string>, body: string): string {
  const fm = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${fm}\n---\n\n${body}\n`;
}

const VALID = {
  title: 'Fixture',
  description: 'A fixture page.',
  type: 'guide',
  owner: 'parsoFish',
  last_verified: '2026-10-05',
  covers: '[apps/docs/**]',
};

/** Build a copy of the site with one extra page; returns the build's exit code and output. */
function buildWith(name: string, contents: string): { status: number | null; out: string } {
  const dir = mkdtempSync(join(ROOT, 'scripts', '.tmp-docs-site-'));
  try {
    cpSync(APP, dir, { recursive: true, filter: (src) => !/[/\\](dist|\.astro|node_modules)$/.test(src) });
    mkdirSync(join(dir, 'src/content/docs/guides'), { recursive: true });
    writeFileSync(join(dir, 'src/content/docs/guides', name), contents);
    const r = spawnSync(ASTRO, ['build', '--root', dir], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
      timeout: 120_000,
    });
    if (process.env.DOCS_SITE_TEST_DUMP) process.stderr.write(`--- ${name} rc=${r.status}\n${r.stdout}\n${r.stderr}\n`);
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a complete page builds (control for the refusals below)', () => {
  const r = buildWith('fixture.md', page(VALID, 'Read [how forge works](/how-forge-works/).'));
  assert.equal(r.status, 0, r.out);
});

test('a page without owner fails the build and names the field', () => {
  const { owner: _owner, ...noOwner } = VALID;
  const r = buildWith('no-owner.md', page(noOwner, 'Body.'));
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /InvalidContentEntryDataError[^\n]*no-owner[\s\S]*owner\*\*: \*\*owner: Required/);
});

test('a page whose type is outside the four fails the build', () => {
  const r = buildWith('bad-type.md', page({ ...VALID, type: 'tutorial' }, 'Body.'));
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /InvalidContentEntryDataError[^\n]*bad-type[\s\S]*type: Invalid option/);
});

test('a broken internal link fails the build', () => {
  const r = buildWith('broken-link.md', page(VALID, 'See [nowhere](/guides/does-not-exist/).'));
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /Links validation failed[\s\S]*\/guides\/does-not-exist\/[\s\S]*invalid link/);
});

test('freshness windows: 120 days for guides and how-tos, 180 for reference and explanation', () => {
  assert.equal(windowDays('guide'), 120);
  assert.equal(windowDays('how-to'), 120);
  assert.equal(windowDays('reference'), 180);
  assert.equal(windowDays('explanation'), 180);
  assert.throws(() => windowDays('tutorial'), /unknown page type/);
});

test('a page is stale only past its window', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  assert.equal(isStale('guide', ago(120), now), false);
  assert.equal(isStale('guide', ago(121), now), true);
  assert.equal(isStale('reference', ago(180), now), false);
  assert.equal(isStale('reference', ago(181), now), true);
  assert.throws(() => isStale('guide', new Date('nope'), now), /not a valid date/);
});
