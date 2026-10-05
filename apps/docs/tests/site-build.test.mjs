/**
 * site-build.test.mjs — the docs site refuses, at build time, a page that does
 * not say what it is or who owns it, and a broken internal link.
 *
 * Each test copies the app into a gitignored `.tmp-site-*` directory inside
 * apps/docs (so the repo's node_modules resolve; a symlinked node_modules
 * breaks Astro's compile cache), adds one fixture page and runs the real
 * `astro build`. Run by the CI `docs` job (`npm run test --workspace=docs`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASTRO = join(APP, '..', '..', 'node_modules/.bin/astro');
/** What a build reads; copying the app dir whole would copy it into itself. */
const SITE_PARTS = ['astro.config.mjs', 'package.json', 'tsconfig.json', 'src', 'public'];

function page(fields, body) {
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
function buildWith(name, contents) {
  const dir = mkdtempSync(join(APP, '.tmp-site-'));
  try {
    for (const part of SITE_PARTS) {
      if (existsSync(join(APP, part))) cpSync(join(APP, part), join(dir, part), { recursive: true });
    }
    mkdirSync(join(dir, 'src/content/docs/guides'), { recursive: true });
    writeFileSync(join(dir, 'src/content/docs/guides', name), contents);
    const r = spawnSync(ASTRO, ['build', '--root', dir], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
      timeout: 120_000,
    });
    // CI sets FORCE_COLOR; the assertions read the text, not the colour codes.
    return { status: r.status, out: `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '') };
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
