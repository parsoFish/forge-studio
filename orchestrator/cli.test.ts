/**
 * CLI dispatch surface — S9/DEC-6 "the CLI is retired as the operator surface".
 *
 * The Studio UI bridge is the SOLE operator interaction point now. M7-5 already
 * removed the scheduler-lifecycle verbs (start/stop/pause/resume/status); S9
 * additionally retires the operator cycle-management + recovery verbs
 * (cycle · enqueue · metrics · preflight · review · report · log · demo · requeue) —
 * their replacements are the bridge routes (POST /api/runs, /api/verdict,
 * /api/recovery/:id, /api/initiatives) + the run-detail UI.
 *
 * These tests pin the trimmed surface:
 *   - every retired command hits the unknown-command path (exit 1) so a refactor
 *     can't silently re-add a dead dispatch branch,
 *   - the surviving dispatchable commands (studio lint, architect, brain) still
 *     dispatch (no "unknown command"),
 *   - `forge --help` advertises ONLY init/studio/studio lint, never the retired
 *     verbs nor the internalised `architect run`.
 *
 * We spawn the real CLI entrypoint (the dispatch switch only exists there) and only
 * exercise commands with a fast, no-op failure path — never serve/studio/init
 * (long-lived or side-effecting).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, 'cli.ts');

type Run = { status: number | null; stdout: string; stderr: string };

function runForge(args: string[]): Run {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', CLI, ...args],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// M7-5 lifecycle verbs + the S9/DEC-6 retired operator cycle-management/recovery verbs.
const REMOVED = [
  'start', 'stop', 'pause', 'resume', 'status',
  'cycle', 'enqueue', 'metrics', 'preflight', 'review', 'report', 'log', 'demo', 'requeue',
];

for (const cmd of REMOVED) {
  test(`retired: 'forge ${cmd}' hits the unknown-command path`, () => {
    const r = runForge([cmd]);
    assert.equal(r.status, 1, `expected exit 1 for retired '${cmd}', got ${r.status}`);
    assert.match(
      r.stderr,
      new RegExp(`unknown command: ${cmd}`),
      `expected "unknown command: ${cmd}" on stderr, got: ${r.stderr}`,
    );
  });
}

// Surviving dispatchable commands must NOT hit the unknown-command path. The
// argless missing-arg failure (exit 2) is a hermetic "it dispatched" signal.
test("kept: 'forge brain' (dev/CI integrity gate) still dispatches", () => {
  const r = runForge(['brain']);
  assert.doesNotMatch(r.stderr, /unknown command:/, r.stderr);
  assert.match(r.stderr, /forge brain: subcommands/);
  assert.equal(r.status, 2);
});

test("kept: 'forge architect' (internal, bridge-spawned) still dispatches", () => {
  const r = runForge(['architect']);
  assert.doesNotMatch(r.stderr, /unknown command:/, r.stderr);
  assert.match(r.stderr, /forge architect: subcommands/);
  assert.equal(r.status, 2);
});

test("kept: 'forge studio lint' still dispatches", () => {
  const r = runForge(['studio', 'lint']);
  assert.doesNotMatch(r.stderr, /unknown command:/, r.stderr);
});

test('help: advertises only init/studio/studio lint, not the retired verbs', () => {
  const r = runForge(['--help']);
  assert.equal(r.status, 0);
  const help = r.stdout;
  // Retired verbs are gone from the operator help surface.
  for (const cmd of REMOVED) {
    assert.doesNotMatch(
      help,
      new RegExp(`forge ${cmd}\\b`),
      `help should not advertise retired 'forge ${cmd}'`,
    );
  }
  // Internalised architect run + the dev brain gate are not advertised.
  assert.doesNotMatch(help, /forge architect run/, 'architect run must be hidden from help');
  // The surviving operator surface IS advertised.
  for (const kept of ['forge init', 'forge studio']) {
    assert.match(help, new RegExp(kept), `help should advertise '${kept}'`);
  }
  assert.match(help, /forge studio lint/, 'help should advertise the studio lint gate');
});
