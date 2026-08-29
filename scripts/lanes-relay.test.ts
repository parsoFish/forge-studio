/**
 * forge-8vfn.2.15 — `lanes.sh send` and `launch` reported success without ever
 * checking whether the payload was submitted.
 *
 * Measured 2026-08-29, three times in one afternoon (`_1.0/ledger.md`, the
 * 2026-08-29 T1 status re-derivation and the M1-A entries): T1's four-part
 * ruling to `m1-d` sat in the pane as `[Pasted text #1 +1 lines]` while
 * `lanes.sh` printed `sent to forge-m1-d`; an operator draft sat unsubmitted in
 * that same pane for an unknown period; and `launch` created `forge-m1-a`,
 * printed `launched forge-m1-a`, and left the lane at 0 tokens / $0.00 until a
 * hand-typed `tmux send-keys -t forge-m1-a Enter`.
 *
 * Root cause, established by probe before any fix (plan `_1.0/plans/M1-E.md`):
 * the payload and its terminator are two writes with no gap, and when they land
 * in the same read chunk the consumer's paste heuristic takes the terminator as
 * pasted CONTENT rather than a keypress. Reproduced deterministically against a
 * real Claude TUI by forcing the two into one write — `❯ [Pasted text #1 +25
 * lines]`, `$0.00 session`, `0 (0%)` context — and submitted every time the two
 * writes were separated. tmux delivers every byte in both cases; the delivery
 * was never the problem, the CONFIRMATION was missing.
 *
 * The property under test is therefore not "the bytes arrive". It is:
 *
 *   1. `send` submits, proven by the consumer PROCESSING the payload — never by
 *      the payload being visible in the pane.
 *   2. `launch` starts the lane working, proven the same way.
 *   3. Neither prints success when submission cannot be confirmed; both exit
 *      non-zero and name the lane.
 *
 * What is real here: tmux, the panes, the process lifecycle and every line of
 * `lanes.sh` under test. The only substitution is the program under the lane —
 * `LANES_CLAUDE_BIN`, the seam the script already has — replaced by consumers
 * that model the two observed behaviours: one that stages its input until a
 * terminator arrives (the Claude TUI), and one that never consumes at all.
 * Sessions use `LANES_SESSION_PREFIX`, so this file cannot address a real lane.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LANES = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lanes.sh');
const PREFIX = `m1etest${process.pid}-`;

let dir: string;
const sessions = new Set<string>();

function tmux(...args: string[]) {
  return spawnSync('tmux', args, { encoding: 'utf8' });
}
function killAll() {
  for (const s of sessions) tmux('kill-session', '-t', s);
  sessions.clear();
}
/** Run lanes.sh. Never throws — the exit status IS the subject of these tests. */
function lanes(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bash', [LANES, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LANES_SESSION_PREFIX: PREFIX, LANES_CONFIRM_TIMEOUT_S: '6', ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
function writeExec(name: string, body: string) {
  const p = join(dir, name);
  writeFileSync(p, name.endsWith('.cjs') ? body : body);
  chmodSync(p, 0o755);
  return p;
}
/** lanes.sh execs LANES_CLAUDE_BIN directly, so a node consumer needs a shim. */
function writeBin(name: string, body: string) {
  const target = writeExec(`${name}.cjs`, body);
  return writeExec(name, `#!/usr/bin/env bash\nexec node ${target} "$@"\n`);
}

/**
 * The lane consumers, modelled on what the real Claude TUI was MEASURED doing
 * (plan `_1.0/plans/M1-E.md`, probes G and H): text that arrives is held on the
 * input line as pending; a terminator that arrives inside a bracketed paste is
 * CONTENT; only a terminator outside one submits. `renders` = it draws the `❯`
 * input line, so `lanes.sh` sees exactly the pane shape a real lane shows.
 */
const CONSUMER = (opts: { deaf: boolean; fromArgv: boolean; marker?: string }) => `
const fs = require('node:fs');
const MARK = ${opts.marker ? JSON.stringify(opts.marker) : 'null'};
let pending = ${opts.fromArgv ? 'process.argv[process.argv.length - 1]' : "''"};
let inPaste = false, tail = '';
const draw = () => process.stdout.write('\\r\\x1b[K\\u276f ' + pending.replace(/\\s+/g, ' ').slice(0, 60));
process.stdout.write('\\x1b[?2004h');            // ask for bracketed paste, as the TUI does
draw();
const submit = () => {
  if (MARK) fs.appendFileSync(MARK, pending.endsWith('\\n') ? pending : pending + '\\n');
  pending = '';
  draw();
};
process.stdin.setRawMode && process.stdin.setRawMode(true);
process.stdin.on('data', (d) => {
  tail += d.toString('binary');
  while (tail.length) {
    if (tail.startsWith('\\x1b[200~')) { inPaste = true; tail = tail.slice(6); continue; }
    if (tail.startsWith('\\x1b[201~')) { inPaste = false; tail = tail.slice(6); continue; }
    if (tail.length < 6 && '\\x1b[200~'.startsWith(tail) && tail[0] === '\\x1b') break;  // partial marker
    const c = tail[0]; tail = tail.slice(1);
    if ((c === '\\r' || c === '\\n') && !inPaste) { ${opts.deaf ? '/* never submits — the measured stuck lane */' : 'submit();'} continue; }
    pending += (c === '\\r' && inPaste) ? '\\n' : c;   // a pasted CR is a newline in the content
  }
  draw();
});
setTimeout(() => {}, 120000);
`;

before(() => {
  const probe = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  assert.equal(probe.status, 0, 'tmux must be installed — these tests drive real tmux sessions and must never silently skip');
  dir = mkdtempSync(join(tmpdir(), 'm1e-lanes-'));
  mkdirSync(join(dir, 'camp', 'heartbeat'), { recursive: true });
});
after(() => {
  killAll();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('lanes.sh send — the relay is confirmed by its effect', () => {
  test('a long multi-line payload is PROCESSED by the consumer, not merely staged in the pane', () => {
    const marker = join(dir, 'processed.txt');
    const consumer = writeExec('staging-consumer.cjs', CONSUMER({ deaf: false, fromArgv: false, marker }));
    const lane = 'send-ok';
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    tmux('new-session', '-d', '-s', s, '-x', '200', '-y', '50', `node ${consumer}`);

    const payload = Array.from({ length: 25 }, (_, i) => `RULING line ${i + 1} of a long multi-part relay`).join('\n');
    const r = lanes(['send', lane, payload]);

    assert.equal(r.status, 0, `send should succeed against a consuming lane; stderr=${r.stderr}`);
    assert.ok(existsSync(marker), 'the consumer never processed anything');
    const got = readFileSync(marker, 'utf8').trimEnd().split('\n');
    // The FINAL line is completed only by the terminator. 24 lines means the
    // payload was staged and the submit was swallowed — the measured defect.
    assert.equal(got.length, 25, `consumer processed ${got.length} of 25 lines — the terminator was not delivered as a submit`);
    assert.equal(got[24], 'RULING line 25 of a long multi-part relay');
    assert.match(r.stdout, /confirmed/i, 'send must report the submission it CONFIRMED, not merely that it wrote the payload');
  });

  test('a lane that never drains its input line makes send FAIL LOUDLY, never print success', () => {
    const consumer = writeExec('deaf-consumer.cjs', CONSUMER({ deaf: true, fromArgv: false }));
    const lane = 'send-deaf';
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    tmux('new-session', '-d', '-s', s, '-x', '200', '-y', '50', `node ${consumer}`);

    const r = lanes(['send', lane, 'a ruling that will never be consumed']);

    assert.notEqual(r.status, 0, 'send must exit non-zero when submission cannot be confirmed');
    assert.doesNotMatch(r.stdout, /^sent to/im, 'send must not print a success line it did not verify');
    assert.match(`${r.stdout}${r.stderr}`, new RegExp(lane), 'the failure must name the lane');
  });
});

describe('lanes.sh launch — the lane is confirmed to be working', () => {
  test('a lane that stages its argv prompt is driven to actually process it', () => {
    const marker = join(dir, 'lane-processed.txt');
    const bin = writeBin('staging-lane', CONSUMER({ deaf: false, fromArgv: true, marker }));
    const lane = 'launch-ok';
    sessions.add(`${PREFIX}${lane}`);
    const prompt = join(dir, 'prompt.md');
    writeFileSync(prompt, `KICKOFF HEAD LINE\n${Array.from({ length: 30 }, (_, i) => `body line ${i + 1}`).join('\n')}\n`);

    const r = lanes(['launch', join(dir, 'camp'), lane, prompt], { LANES_CLAUDE_BIN: bin });

    assert.equal(r.status, 0, `launch should succeed; stderr=${r.stderr}`);
    assert.ok(existsSync(marker), 'the lane never processed its prompt — it was staged and launch reported success anyway');
    assert.match(readFileSync(marker, 'utf8'), /KICKOFF HEAD LINE/);
    assert.match(r.stdout, /confirmed/i, 'launch must report the start it CONFIRMED');
  });

  test('a lane that never starts working makes launch FAIL LOUDLY, never print success', () => {
    const bin = writeBin('deaf-lane', CONSUMER({ deaf: true, fromArgv: true }));
    const lane = 'launch-deaf';
    sessions.add(`${PREFIX}${lane}`);
    const prompt = join(dir, 'prompt2.md');
    writeFileSync(prompt, 'a kickoff that will never be consumed\n');

    const r = lanes(['launch', join(dir, 'camp'), lane, prompt], { LANES_CLAUDE_BIN: bin });

    assert.notEqual(r.status, 0, 'launch must exit non-zero when the lane cannot be confirmed working');
    assert.doesNotMatch(r.stdout, /^launched/im, 'launch must not print a success line it did not verify');
    assert.match(`${r.stdout}${r.stderr}`, new RegExp(lane), 'the failure must name the lane');
  });
});
