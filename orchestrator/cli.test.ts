/**
 * CLI dispatch surface — M7-5 (ADR-031) "collapse forge to its runtime spine".
 *
 * The Studio UI bridge is the operator API now, so the operator-facing
 * scheduler-lifecycle + force-approve CLI commands were removed:
 *   start · stop · pause · resume · status · review --approve
 *
 * These tests pin the trimmed surface in place:
 *   - removed commands now hit the unknown-command path (exit 1, stderr
 *     "unknown command: <cmd>") so a future refactor can't silently re-add a
 *     dead dispatch branch,
 *   - the runtime spine (serve/cycle/enqueue/preflight/review/log/requeue/
 *     studio/brain/demo/architect) still dispatches (no "unknown command"),
 *   - `forge --help` no longer advertises the removed commands, and never
 *     advertises the internalised `architect run`.
 *
 * We spawn the real CLI entrypoint (the dispatch switch only exists there).
 * To keep the suite hermetic + side-effect-free we only exercise commands
 * with a fast, no-op argless failure path (missing-arg → exit 2) — never
 * `serve`/`studio` (which would start a long-lived process).
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

const REMOVED = ['start', 'stop', 'pause', 'resume', 'status'];

for (const cmd of REMOVED) {
  test(`removed: 'forge ${cmd}' hits the unknown-command path`, () => {
    const r = runForge([cmd]);
    // default case: console.error('unknown command: …') then exit 1.
    assert.equal(r.status, 1, `expected exit 1 for removed '${cmd}', got ${r.status}`);
    assert.match(
      r.stderr,
      new RegExp(`unknown command: ${cmd}`),
      `expected "unknown command: ${cmd}" on stderr, got: ${r.stderr}`,
    );
  });
}

// Kept commands: must NOT hit the unknown-command path. We use the argless
// missing-arg failure (exit 2) as a hermetic "it dispatched" signal — the
// command body ran far enough to validate its own args.
const KEPT_ARGLESS: Array<{ cmd: string; expectExit: number }> = [
  { cmd: 'cycle', expectExit: 2 }, // 'forge cycle: missing <initiative-id>'
  { cmd: 'review', expectExit: 2 }, // 'forge review: missing <initiative-id-or-handle>'
  { cmd: 'requeue', expectExit: 2 }, // requeue usage → exit 2 with no init
  { cmd: 'report', expectExit: 2 }, // 'forge report: missing <cycle-id>'
  { cmd: 'preflight', expectExit: 2 }, // preflight requires <project>
];

for (const { cmd, expectExit } of KEPT_ARGLESS) {
  test(`kept: 'forge ${cmd}' still dispatches (no unknown-command)`, () => {
    const r = runForge([cmd]);
    assert.doesNotMatch(
      r.stderr,
      /unknown command:/,
      `'${cmd}' should dispatch, but hit unknown-command: ${r.stderr}`,
    );
    assert.equal(
      r.status,
      expectExit,
      `expected exit ${expectExit} for kept '${cmd}', got ${r.status} (stderr: ${r.stderr})`,
    );
  });
}

test("kept: 'forge architect' (internalised) still dispatches", () => {
  // architect run is hidden from help but MUST stay dispatchable for the
  // bridge's spawnArchitectTurn. Bare 'architect' prints its subcommand usage
  // (exit 2) — crucially NOT the unknown-command path.
  const r = runForge(['architect']);
  assert.doesNotMatch(r.stderr, /unknown command:/, r.stderr);
  assert.match(r.stderr, /forge architect: subcommands/);
  assert.equal(r.status, 2);
});

test("kept: 'forge studio lint' still dispatches", () => {
  // studio lint is a real, terminating command (no long-lived process). It
  // validates the studio defs and exits 0/non-zero — either way it dispatched.
  const r = runForge(['studio', 'lint']);
  assert.doesNotMatch(r.stderr, /unknown command:/, r.stderr);
});

test('help: lists the runtime spine, not the removed lifecycle commands', () => {
  const r = runForge(['--help']);
  assert.equal(r.status, 0);
  const help = r.stdout;
  // Removed commands are gone from the help surface.
  for (const cmd of REMOVED) {
    assert.doesNotMatch(
      help,
      new RegExp(`forge ${cmd}\\b`),
      `help should not advertise removed 'forge ${cmd}'`,
    );
  }
  // Internalised architect run is not advertised.
  assert.doesNotMatch(help, /forge architect run/, 'architect run must be hidden from help');
  // review --approve is gone; --inspect/--abandon recovery remains.
  assert.doesNotMatch(help, /--approve/, 'review --approve must be gone from help');
  // Runtime spine is still advertised.
  for (const kept of ['forge serve', 'forge cycle', 'forge enqueue', 'forge studio', 'forge requeue', 'forge review']) {
    assert.match(help, new RegExp(kept.replace(/ /g, ' ')), `help should advertise '${kept}'`);
  }
});
