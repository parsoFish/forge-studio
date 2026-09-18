/**
 * Acceptance gate + demo driver (contract C7 creds-free tier + DEMO / C9).
 *
 * Proves the change against the ACTUALLY-RUNNING thing locally: it runs the
 * BUILT CLI (`dist/cli.js`) as a real child process against a fixture markdown
 * file, captures stdout, and asserts the real generated TOC — including the
 * non-default sentinel heading (`sentinel-7f3a9c`) and the duplicate-anchor
 * disambiguation (`#rotate-the-signing-key-1`). A demo that returned a default
 * or hard-coded TOC would fail the read-back.
 *
 *   npm run acceptance   → assert; exit non-zero on mismatch.
 *   npm run demo         → assert AND write captured evidence under
 *                          forge/history/<initiative>/demo/ for the PR.
 *
 * Self-building: if `dist/cli.js` is missing it runs `tsc` first, so the gate
 * works from a clean checkout (`npm install && npm run acceptance`).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const CLI = join(PROJECT_ROOT, 'dist', 'cli.js');
const FIXTURE = join(PROJECT_ROOT, 'test', 'fixtures', 'release-notes.md');
const DEMO_DIR = join(
  PROJECT_ROOT,
  'forge',
  'history',
  'INIT-mdtoc-bootstrap',
  'demo',
);

// The exact TOC the built CLI must emit for the fixture, restricted to H2..H3.
// The sentinel section name + the duplicate-heading `-1` anchor make this a
// read-back the implementation cannot satisfy by accident.
const EXPECTED = [
  '- [Quickstart sentinel-7f3a9c](#quickstart-sentinel-7f3a9c)',
  '  - [Install the collector](#install-the-collector)',
  '  - [Configure the sink](#configure-the-sink)',
  '- [Operations](#operations)',
  '  - [Rotate the signing key](#rotate-the-signing-key)',
  '  - [Rotate the signing key](#rotate-the-signing-key-1)',
  '- [Troubleshooting](#troubleshooting)',
].join('\n');

function ensureBuilt(): void {
  if (existsSync(CLI)) return;
  process.stderr.write('acceptance: dist/cli.js missing — building…\n');
  execFileSync('npx', ['tsc', '-p', 'tsconfig.json'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
}

function runCli(args: readonly string[]): string {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf8' }).trimEnd();
}

function main(): number {
  const demo = process.argv.includes('--demo');
  ensureBuilt();

  // CAPTURE: run the real CLI against the fixture (H2..H3 window).
  const actual = runCli(['--min', '2', '--max', '3', FIXTURE]);

  // VERIFY (read-back): the captured output must equal the expected TOC exactly.
  try {
    assert.equal(actual, EXPECTED);
  } catch (err) {
    process.stderr.write('acceptance: FAILED — CLI output did not match expected TOC.\n');
    process.stderr.write(`--- expected ---\n${EXPECTED}\n--- actual ---\n${actual}\n`);
    throw err;
  }

  process.stdout.write('acceptance: PASS — built CLI produced the expected TOC for the fixture.\n');

  if (demo) {
    mkdirSync(DEMO_DIR, { recursive: true });
    const captured = [
      '# mdtoc demo evidence',
      '',
      '## Command',
      '',
      '```',
      `node dist/cli.js --min 2 --max 3 ${FIXTURE.replace(PROJECT_ROOT + '/', '')}`,
      '```',
      '',
      '## Captured output (the real generated TOC)',
      '',
      '```markdown',
      actual,
      '```',
      '',
      '## Read-back assertion',
      '',
      '- Sentinel heading `Quickstart sentinel-7f3a9c` is present with its slug anchor.',
      '- The duplicated `Rotate the signing key` heading produced distinct anchors',
      '  (`#rotate-the-signing-key` and `#rotate-the-signing-key-1`).',
      '- The fenced `## Fake Heading` was correctly excluded.',
      '',
      'Result: **PASS** — the captured TOC equals the asserted expected output.',
    ].join('\n');
    writeFileSync(join(DEMO_DIR, 'toc-capture.md'), captured + '\n');
    process.stdout.write(`acceptance: demo evidence written to ${DEMO_DIR}/toc-capture.md\n`);
  }

  return 0;
}

process.exit(main());
