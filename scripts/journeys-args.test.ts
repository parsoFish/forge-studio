/**
 * `scripts/e2e-journey.mjs`'s argument contract — beads `forge-8vfn.7.6.40`
 * and `.41`.
 *
 * THE DEFECT THESE PIN. The runner read the flags it knew and discarded the
 * rest, so an unrecognised argument ran the FULL suite: host-global 4123/4124
 * bound, a real browser driven, `projects/` written into.
 *
 * `--help` is the worst spelling of that accident and the likeliest, because
 * asking a tool what it does is the first thing a careful operator tries. It
 * has fired twice — once deleting 313 paths and writing into a tracked
 * project, once (2026-09-12, a sibling lane) launching the whole suite on the
 * shared ports while another lane worked.
 *
 * §15.408: a diagnostic that executes the thing it diagnoses is not a
 * diagnostic.
 *
 * RUN: node --experimental-strip-types --test scripts/journeys-args.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseJourneyArgs, KNOWN_FLAGS, USAGE } from './journeys/args.mjs';

test('--help asks a question and must not answer it by running', () => {
  assert.equal(parseJourneyArgs(['--help']).kind, 'help');
  assert.equal(parseJourneyArgs(['-h']).kind, 'help');
});

test('--help wins over every other flag — a caller who asked is not also launching', () => {
  assert.equal(parseJourneyArgs(['--journey', 'home', '--help']).kind, 'help');
  assert.equal(parseJourneyArgs(['--list', '--help']).kind, 'help');
});

test('an unknown flag REFUSES and names both the flag and the accepted set', () => {
  const r = parseJourneyArgs(['--dry-run']);
  assert.notEqual(r.error, null);
  assert.ok(r.error.includes('--dry-run'), r.error);
  for (const f of KNOWN_FLAGS) assert.ok(r.error.includes(f), `accepted set must name ${f}: ${r.error}`);
  assert.ok(/Nothing was run/.test(r.error), r.error);
});

test('a bare word that is not --journey\'s value refuses rather than being ignored', () => {
  const r = parseJourneyArgs(['home']);
  assert.notEqual(r.error, null);
  assert.ok(r.error.includes('home'), r.error);
});

test('--journey without a value refuses instead of running everything', () => {
  assert.notEqual(parseJourneyArgs(['--journey']).error, null);
  // The near-miss that matters: the next token is another flag, not an id.
  assert.notEqual(parseJourneyArgs(['--journey', '--list']).error, null);
});

test('--journey with a value parses, single and comma-separated', () => {
  assert.deepEqual(parseJourneyArgs(['--journey', 'home']).journeys, ['home']);
  assert.deepEqual(parseJourneyArgs(['--journey', 'home,flows']).journeys, ['home', 'flows']);
  assert.equal(parseJourneyArgs(['--journey', 'home']).error, null);
});

test('--list still lists, and no flags still means run', () => {
  assert.equal(parseJourneyArgs(['--list']).kind, 'list');
  assert.equal(parseJourneyArgs([]).kind, 'run');
  assert.equal(parseJourneyArgs([]).error, null);
});

test('the usage text warns what a bare invocation costs — ports, browser, writes', () => {
  assert.ok(/4123/.test(USAGE) && /4124/.test(USAGE), USAGE);
  assert.ok(/run-lock/i.test(USAGE), USAGE);
});

/**
 * Bead `forge-8vfn.7.6.42` — the runner TAKES the run-lock, it does not merely
 * hope a caller did (§15.443: the lock is the tool's, not the caller's).
 *
 * Asserted at the source, the way `beats-offsession-stall.test.ts` asserts the
 * channel door's gate: the behaviour needs a held lock and a real subprocess,
 * so driving it here would test the fixture. The live proof is recorded in the
 * PR — with the lock held the runner QUEUED (still waiting at the timeout) and
 * bound no port, and `--list` returned 0 in the same conditions.
 *
 * The three properties that must not rot:
 *   - it re-execs under the SYSTEM `flock` (Node has no flock(2); an exported
 *     lock path is not a taken lock, §15.383);
 *   - `-w`, never `-n` — a lost race must QUEUE, not score as a finished
 *     attempt (715);
 *   - `--help`/`--list` are answered BEFORE the lock, so asking what the tool
 *     does never queues behind another lane.
 */
import { readFileSync } from 'node:fs';

test('7.6.42: the runner re-execs under flock with -w, and answers --help before it', () => {
  const src = readFileSync(new URL('./e2e-journey.mjs', import.meta.url), 'utf8');
  assert.match(src, /spawnSync\('flock', \['-w'/, 'must take the lock via the system flock, with -w');
  assert.ok(!/spawnSync\('flock', \['-n'/.test(src), '-n would score a lost race as a finished attempt (715)');
  const gate = src.slice(src.indexOf('function refuseOrRelock'));
  const helpAt = gate.indexOf("kind === 'help'");
  const lockAt = gate.indexOf("spawnSync('flock'");
  assert.ok(helpAt !== -1 && lockAt !== -1 && helpAt < lockAt,
    '--help must be answered before the lock is taken, or asking what the tool does queues behind a lane');
});
