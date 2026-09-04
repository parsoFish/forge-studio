/**
 * `lanes.sh render` — extracted from `lanes.test.ts` when that file crossed the 800-line cap
 * (`check-file-size` says "Split it", and a `scripts/baselines/file-size.json` entry is a debt
 * ceiling raised under a cull-first milestone). Render touches neither the roster nor tmux, so
 * it carries its own two-field harness rather than importing another test file's internals.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LANES = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lanes.sh');

let dir: string;
let camp: string;

/** Run lanes.sh. Never throws — the exit status IS the subject of these tests. */
function lanes(args: string[]) {
  const r = spawnSync('bash', [LANES, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LANES_'))),
    },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'lanes-render-'));
  camp = join(dir, 'camp');
  mkdirSync(camp, { recursive: true });
});
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/**
 * Bead forge-8vfn.6.8.3 — the successor's inputs are its predecessor's OUTCOME, not its corpus.
 *
 * Measured on this campaign's own sessions (2026-09-04, transcripts under ~/.claude/projects):
 * turn-one input is 66–72 k tokens for EVERY lane whatever its prompt size (m2-b's 6,040 B
 * prompt → 68,361; flows' 15,128 B → 66,289), so the prompt is 2–5 % of turn one and total cost
 * tracks TURNS, not prompt bytes. What the prompt's READ line named is the cost: on `61491050`
 * that corpus was 1,953,768 B ≈ 488 k tokens — 130× the prompt it arrived in, and 88 % of it was
 * `_1.0/ledger.md` alone at 1,686,743 B. So `render` can append an OUTCOME file and NAMED ledger
 * sections, and refuses to produce a prompt over a measured ceiling.
 */
describe('lanes.sh render — OUTCOME and named ledger sections, under a measured ceiling', () => {
  let src: string;
  let ledger: string;
  let outcome: string;
  before(() => {
    src = join(dir, 'kickoffs-r6.md');
    writeFileSync(src, ['## 12. M5-A — package lane', '', '```text', 'ROLE: T2 lane $PKG', '```', ''].join('\n'));
    ledger = join(dir, 'ledger-r6.md');
    writeFileSync(
      ledger,
      ['## 2026-09-04 21:1x AEST — M5 opened by T1', 'ruling 146 binds', '',
       '## 2026-09-04 22:0x AEST — something else', 'not wanted', '',
       '## 2026-09-04 23:0x AEST — M5-harness OUTCOME', 'rows 1a-6', ''].join('\n'),
    );
    outcome = join(dir, 'outcome-r6.md');
    writeFileSync(outcome, 'ROWS: 1a MET, 1b MET\n');
  });

  test('appends the OUTCOME file and each named section under labelled headers, and prints bytes / ceiling', () => {
    const out = join(dir, 'render-r6.md');

    const r = lanes(['render', src, '^## 12\\. M5-A', out, 'PKG=factory',
                     '--outcome', outcome,
                     '--ledger', ledger, '--section', '^## 2026-09-04 21:1x', '--section', '^## 2026-09-04 23:0x']);

    assert.equal(r.status, 0, r.stderr);
    const text = readFileSync(out, 'utf8');
    assert.match(text, /^ROLE: T2 lane factory$/m, 'the block, with its parameters filled');
    assert.match(text, /^## OUTCOME —/m, 'the OUTCOME arrives under a header that says what it is');
    assert.match(text, /^ROWS: 1a MET, 1b MET$/m);
    assert.match(text, /ruling 146 binds/, 'the first named section');
    assert.match(text, /rows 1a-6/, 'the second named section');
    assert.doesNotMatch(text, /not wanted/, 'a section stops at the next `## ` — it does not swallow the rest of the ledger');
    assert.match(r.stdout, /\b\d+ B \/ \d+ B ceiling\b/, 'the size and the ceiling are printed, so the budget is observable and not a silent refusal');
  });

  test('over the ceiling is a REFUSAL: non-zero, and no file left to be launched by mistake', () => {
    const out = join(dir, 'render-r6-big.md');
    const big = join(dir, 'outcome-big.md');
    writeFileSync(big, 'x'.repeat(5000) + '\n');

    const r = lanes(['render', src, '^## 12\\. M5-A', out, '--outcome', big, '--max-bytes', '1000']);

    assert.notEqual(r.status, 0, 'a prompt over its budget is not rendered');
    assert.match(r.stderr, /ceiling/, 'and the refusal names the budget it broke');
    assert.ok(!existsSync(out), 'nothing is left on disk');
  });

  test('a --section regex that matches nothing is an ERROR naming it, never a silently empty section', () => {
    const out = join(dir, 'render-r6-miss.md');

    const r = lanes(['render', src, '^## 12\\. M5-A', out, '--ledger', ledger, '--section', '^## nope']);

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /\^## nope/, 'the same rule as the heading miss: a render that silently drops what was asked for is worse than none');
    assert.ok(!existsSync(out));
  });

  test('the ceiling is a real default, not only a flag — a plain render reports it', () => {
    const out = join(dir, 'render-r6-plain.md');

    const r = lanes(['render', src, '^## 12\\. M5-A', out, 'PKG=factory']);

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\/ 24576 B ceiling/, 'the measured constant, printed on every render');
  });
});
