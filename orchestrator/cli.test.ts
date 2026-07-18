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
  'cycle', 'enqueue', 'metrics', 'review', 'report', 'log', 'requeue',
];

// demo + preflight are AGENT/dev tools (the developer-unifier runs `forge demo
// render` every cycle; the onboarding skill runs `forge preflight`), so they stay
// dispatchable + hidden from help — NOT retired.
const KEPT_HIDDEN = [
  { cmd: 'demo', usage: /forge demo: (subcommands|usage)/ },
  { cmd: 'preflight', usage: /forge preflight/ },
];
for (const { cmd } of KEPT_HIDDEN) {
  test(`kept (hidden): 'forge ${cmd}' still dispatches (agent/dev tool, not unknown)`, () => {
    const r = runForge([cmd]);
    assert.doesNotMatch(r.stderr, /unknown command:/, `'${cmd}' should dispatch: ${r.stderr}`);
  });
}

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
  // R2-01-F3a: the generic agent-run path is an INTERNAL spawn target too — hidden.
  assert.doesNotMatch(help, /forge agent\b/, 'agent run must be hidden from help');
  // The surviving operator surface IS advertised.
  for (const kept of ['forge init', 'forge studio']) {
    assert.match(help, new RegExp(kept), `help should advertise '${kept}'`);
  }
  assert.match(help, /forge studio lint/, 'help should advertise the studio lint gate');
});

/**
 * R2-01-F3a: the generic `forge agent run <agent-id> <session-id> [--project <name>]`
 * path. `cmdAgentRun` is the ONE shared parse/resolve/guard/call/print skeleton the
 * 4 legacy `<verb> run` commands now delegate into — these tests prove the generic
 * path resolves to the SAME registry entry as its legacy verb by diffing their
 * fast-fail guard output byte-for-byte, never invoking a real runner turn (same
 * "fast no-op failure path only" discipline as the rest of this file).
 */
const AGENT_VERBS = [
  { agentId: 'architect', legacyVerb: 'architect', requiresProject: false },
  { agentId: 'instructions', legacyVerb: 'instructions', requiresProject: true },
  { agentId: 'demo-builder', legacyVerb: 'demo-builder', requiresProject: true },
  { agentId: 'project-brain', legacyVerb: 'project-brain', requiresProject: true },
];

test("kept: 'forge agent' (generic runner path) still dispatches", () => {
  const r = runForge(['agent']);
  assert.doesNotMatch(r.stderr, /unknown command:/, r.stderr);
  assert.match(r.stderr, /forge agent: subcommands/);
  assert.equal(r.status, 2);
});

for (const { agentId, legacyVerb } of AGENT_VERBS) {
  test(`agent run ${agentId}: missing <session-id> matches legacy '${legacyVerb} run'`, () => {
    const legacy = runForge([legacyVerb, 'run']);
    const generic = runForge(['agent', 'run', agentId]);
    assert.equal(generic.status, legacy.status, `exit code mismatch: ${generic.stderr} vs ${legacy.stderr}`);
    assert.equal(generic.stderr, legacy.stderr);
  });

  test(`agent run ${agentId}: nonexistent --project matches legacy '${legacyVerb} run'`, () => {
    const args = ['some-session-id', '--project', '__r2-01-f3a-nonexistent-project__'];
    const legacy = runForge([legacyVerb, 'run', ...args]);
    const generic = runForge(['agent', 'run', agentId, ...args]);
    assert.equal(generic.status, legacy.status);
    assert.equal(generic.stderr, legacy.stderr);
    assert.match(legacy.stderr, /project root not found/);
  });
}

for (const { agentId, legacyVerb } of AGENT_VERBS.filter((v) => v.requiresProject)) {
  test(`agent run ${agentId}: missing --project matches legacy '${legacyVerb} run' (required-project error path)`, () => {
    const legacy = runForge([legacyVerb, 'run', 'some-session-id']);
    const generic = runForge(['agent', 'run', agentId, 'some-session-id']);
    assert.equal(generic.status, legacy.status);
    assert.equal(generic.stderr, legacy.stderr);
    assert.equal(generic.status, 2);
  });
}

test('agent run architect: --project omitted falls back to auto-discovery, matching legacy', () => {
  const legacy = runForge(['architect', 'run', '__r2-01-f3a-nonexistent-session__']);
  const generic = runForge(['agent', 'run', 'architect', '__r2-01-f3a-nonexistent-session__']);
  assert.equal(generic.status, legacy.status);
  assert.equal(generic.stderr, legacy.stderr);
  assert.match(legacy.stderr, /no project found containing _architect\//);
});

test('agent run: unknown agent-id → clear error + exit 2', () => {
  const r = runForge(['agent', 'run', 'not-a-real-agent-id', 'some-session-id']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown agent-id/);
});

test('agent run: missing <agent-id> → clear error + exit 2', () => {
  const r = runForge(['agent', 'run']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown agent-id/);
});
