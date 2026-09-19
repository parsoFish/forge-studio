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

/** The literal `launch` and `render` both require of a prompt for THIS campaign (M7 findings row 70). */
function lockLine() {
  return `Suites: flock ${camp}/.suite-lock npm test`;
}

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
    writeFileSync(src, ['## 12. M5-A — package lane', '', '```text', 'ROLE: T2 lane $PKG', lockLine(), '```', ''].join('\n'));
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

    const r = lanes(['render', src, '^## 12\\. M5-A', out, 'PKG=factory', '--campaign', camp,
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

    const r = lanes(['render', src, '^## 12\\. M5-A', out, '--campaign', camp, '--outcome', big, '--max-bytes', '1000']);

    assert.notEqual(r.status, 0, 'a prompt over its budget is not rendered');
    assert.match(r.stderr, /ceiling/, 'and the refusal names the budget it broke');
    assert.ok(!existsSync(out), 'nothing is left on disk');
  });

  test('a --section regex that matches nothing is an ERROR naming it, never a silently empty section', () => {
    const out = join(dir, 'render-r6-miss.md');

    const r = lanes(['render', src, '^## 12\\. M5-A', out, '--campaign', camp, '--ledger', ledger, '--section', '^## nope']);

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /\^## nope/, 'the same rule as the heading miss: a render that silently drops what was asked for is worse than none');
    assert.ok(!existsSync(out));
  });

  test('the ceiling is a real default, not only a flag — a plain render reports it', () => {
    const out = join(dir, 'render-r6-plain.md');

    const r = lanes(['render', src, '^## 12\\. M5-A', out, 'PKG=factory', '--campaign', camp]);

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\/ 24576 B ceiling/, 'the measured constant, printed on every render');
  });
});

/**
 * Bead forge-uowf / §15.59 (T1, wave-3 launch): `lanes.sh render docs/roadmaps/1.0-kickoffs.md
 * '11. M4-' out` produced the T1 kickoff block from §1 — twice — because a heading regex that
 * matches nothing left `found` false and the first ```text block in the file won. A rendered
 * prompt that is silently the wrong prompt is worse than no prompt. (Moved here from
 * `lanes.test.ts` with the row-70 cases below — render needs neither tmux nor the roster.)
 */
describe('lanes.sh render — a heading miss is an error, never a fallback', () => {
  let src: string;
  before(() => {
    src = join(dir, 'kickoffs.md');
    writeFileSync(
      src,
      ['## 1. T1 — campaign orchestrator', '', '```text', 'ROLE: T1 campaign orchestrator', '```', '',
       '## 11. M4-<pkg> — package lane', '', '```text', 'ROLE: T2 lane for $PKG', lockLine(), '```', ''].join('\n'),
    );
  });

  test('a heading regex that matches nothing exits non-zero, names the regex and writes NO file', () => {
    const out = join(dir, 'render-miss.md');

    const r = lanes(['render', src, '^## nope', out, '--campaign', camp]);

    assert.notEqual(r.status, 0, 'a miss is an error');
    assert.match(r.stderr, /\^## nope/, 'the failure names the regex that missed, so it can be fixed');
    assert.ok(!existsSync(out), 'and nothing is left on disk to be mistaken for a rendered prompt');
  });

  test('a hit prints the heading it matched, so the render can be checked before a launch', () => {
    const out = join(dir, 'render-hit.md');

    const r = lanes(['render', src, '^## 11\\. M4-', out, 'PKG=agents', '--campaign', camp]);

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## 11\. M4-<pkg> — package lane/, 'the matched heading is printed');
    assert.equal(readFileSync(out, 'utf8').trim(), `ROLE: T2 lane for agents\n${lockLine()}`, 'the right block, with its parameters filled');
  });
});

/**
 * M7 findings row 70 (T1, 2026-09-19, ledger 1198/1201): `launch` refused a rendered prompt that
 * lacked the literal `flock <campaign>/.suite-lock`, but `render` wrote that prompt without a word
 * — three M7 lanes bounced at launch. Render now enforces the SAME predicate (`require_lockline`,
 * one function both doors call), so a prompt `launch` would refuse is never written.
 */
describe('lanes.sh render — refuses the prompt launch would refuse (row 70)', () => {
  let src: string;
  before(() => {
    src = join(dir, 'kickoffs-row70.md');
    writeFileSync(
      src,
      ['## 11. M4-<pkg> — package lane', '', '```text', 'ROLE: T2 lane for $PKG', lockLine(), '```', '',
       '## 12. M4-<pkg> — no lock line', '', '```text', 'ROLE: T2 lane for $PKG', 'Suites: npm test', '```', '',
       '## 13. M4-<pkg> — another campaign\'s lock', '', '```text', 'ROLE: T2 lane for $PKG', 'Suites: flock /elsewhere/_1.0/.suite-lock npm test', '```', ''].join('\n'),
    );
  });

  test('render with no --campaign is refused — the lock predicate is about ONE campaign — and writes nothing', () => {
    const out = join(dir, 'render-nocamp.md');

    const r = lanes(['render', src, '^## 11\\. M4-', out, 'PKG=agents']);

    assert.notEqual(r.status, 0, 'render cannot check the lock line without knowing which campaign it names');
    assert.match(r.stderr, /--campaign/, 'the refusal names the missing flag');
    assert.ok(!existsSync(out), 'and nothing is left on disk');
  });

  test('a block with no suite-lock line is refused, the literal is quoted, and nothing is written', () => {
    const out = join(dir, 'render-nolock.md');

    const r = lanes(['render', src, '^## 12\\. M4-', out, 'PKG=agents', '--campaign', camp]);

    assert.notEqual(r.status, 0, 'a prompt launch would refuse is refused at render');
    assert.ok(r.stderr.includes(`does not contain the literal 'flock ${camp}/.suite-lock'`), `the refusal quotes the literal it looked for; stderr=${r.stderr}`);
    assert.ok(!existsSync(out), 'and nothing is left on disk to be launched');
  });

  test('another campaign\'s lock line does not satisfy this campaign, and the words are launch\'s own', () => {
    const out = join(dir, 'render-otherlock.md');

    const r = lanes(['render', src, '^## 13\\. M4-', out, 'PKG=agents', '--campaign', camp]);

    assert.notEqual(r.status, 0, 'the literal is per campaign, exactly as launch reads it');
    assert.ok(!existsSync(out), 'nothing written');
    // One predicate, two doors: the refusal text is the one `launch` prints (lanes.test.ts's
    // 'a rendered prompt with no suite-lock line is refused' pins launch's half).
    assert.ok(r.stderr.includes(`does not contain the literal 'flock ${camp}/.suite-lock' — a lane that never saw the suite-lock line runs its suite outside it`), `stderr=${r.stderr}`);
  });

  test('a campaign that is not a directory is refused by name — never a default', () => {
    const out = join(dir, 'render-badcamp.md');

    const r = lanes(['render', src, '^## 11\\. M4-', out, 'PKG=agents', '--campaign', join(dir, 'no-such-campaign')]);

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no campaign dir/);
    assert.ok(!existsSync(out));
  });
});
