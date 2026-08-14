/**
 * SEC-07 refusal-boundary pin (P3): `forge demo capture <init> --project
 * <name>` (`cmdDemo`, `orchestrator/cli.ts`) must refuse an escaping
 * `--project` value with exit 2 + a containment message BEFORE it resolves the
 * value into a repo path and looks for a demo.json under it.
 *
 * `cmdDemo` is not exported, so this drives the REAL CLI through the worktree's
 * own launcher (`bin/forge.mjs`) as a child process, with cwd = the worktree
 * root so `FORGE_ROOT`/the config-derived projects root align to this repo.
 *
 * Refusal-boundary note: on the current code an escaping `--project` is
 * ACCEPTED — the value is folded into a repo path, no demo.json exists at the
 * escaped location, so it prints "…not found — Skipping" and exits 0. The
 * out-of-root WRITE the containment fix forecloses is only reachable if the
 * escaped location also happens to hold a demo.json; the fix refuses the
 * escaping value categorically, before that branch is ever taken. A random,
 * non-existent initiativeId keeps this test from doing any real capture work.
 *
 * PUBLIC-REPO NOTE: neutral naming — this pins that a traversal-shaped or
 * absolute `--project` is REJECTED, nothing about any onward path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WORKTREE_ROOT = resolve(import.meta.dirname, '..');
// The launcher this repo ships (package.json `bin`) — the same entry every
// `forge <subcommand>` goes through. Confirmed to exist before use.
const LAUNCHER = join(WORKTREE_ROOT, 'bin', 'forge.mjs');

const CONTAINMENT_RE = /is not a valid project name|unsafe path segment|identity mismatch|containment|escapes/i;

/** A syntactically valid but guaranteed-absent initiative id, so no real
 *  capture is attempted regardless of how the `--project` value resolves. */
function randomInitId(): string {
  return `sec07-absent-${Math.random().toString(36).slice(2, 10)}`;
}

/** Run `forge demo capture <initId> --project <value>` through the launcher,
 *  from the worktree root. Returns the exit status and combined stdout+stderr. */
function runDemoCapture(projectValue: string): { status: number | null; output: string } {
  const initId = randomInitId();
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', LAUNCHER, 'demo', 'capture', initId, '--project', projectValue],
    { cwd: WORKTREE_ROOT, encoding: 'utf8' },
  );
  return { status: r.status, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

test('fixture precondition: the launcher exists', () => {
  assert.ok(existsSync(LAUNCHER), `launcher must exist at ${LAUNCHER}`);
});

test('refuses a traversal-shaped --project value with exit 2 + a containment message, before any capture', () => {
  const { status, output } = runDemoCapture('../../etc');
  // Red now: the current code accepts the escaping value, folds it into a repo
  // path, finds no demo.json there and exits 0 with no refusal.
  assert.equal(status, 2, `a traversal-shaped --project must be refused with exit 2 before capture — got exit ${status}; output: ${output}`);
  assert.match(output, CONTAINMENT_RE, `expected a containment refusal, got: ${output}`);
});

test('refuses an absolute --project value with exit 2 + a containment message, before any capture', () => {
  const { status, output } = runDemoCapture('/tmp/sec07-demo-capture-abs-target');
  assert.equal(status, 2, `an absolute --project must be refused with exit 2 before capture — got exit ${status}; output: ${output}`);
  assert.match(output, CONTAINMENT_RE, `expected a containment refusal, got: ${output}`);
});
