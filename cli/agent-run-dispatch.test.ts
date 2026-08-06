/**
 * Tests for `cmdAgentDispatch` (R2-01-F3) — the `forge agent dispatch <slug>`
 * generic-run CLI the bridge spawns detached. Arg parsing + the no-spawn-seam
 * happy path; `process.exit` + console are stubbed so exit codes are asserted
 * without tearing down the test runner.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { cmdAgentDispatch } from './agent-run.ts';

const ROOT = process.cwd();

async function run(args: string[]): Promise<{ exitCode: number | null; out: string; err: string }> {
  const origExit = process.exit;
  const origLog = console.log;
  const origErr = console.error;
  let exitCode: number | null = null;
  const out: string[] = [];
  const err: string[] = [];
  // Throw a sentinel from the stub so control returns immediately (the real
  // handler expects process.exit to end the process).
  process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error(`__exit__${exitCode}`); }) as typeof process.exit;
  console.log = (...a: unknown[]) => { out.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { err.push(a.join(' ')); };
  try {
    await cmdAgentDispatch(args, ROOT);
  } catch (e) {
    if (!/^__exit__/.test((e as Error).message)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

test('cmdAgentDispatch: missing slug → exit 2', async () => {
  const r = await run([]);
  assert.equal(r.exitCode, 2);
  assert.match(r.err, /missing <slug>/);
});

test('cmdAgentDispatch: missing --run-id → exit 2', async () => {
  const r = await run(['project-scoped-review']);
  assert.equal(r.exitCode, 2);
  assert.match(r.err, /--run-id/);
});

test('cmdAgentDispatch: malformed --input (no =) → exit 2', async () => {
  const r = await run(['project-scoped-review', '--run-id', '_agent-cli', '--input', 'novalue']);
  assert.equal(r.exitCode, 2);
  assert.match(r.err, /--input expects k=v/);
});

test('cmdAgentDispatch: unknown --project → exit 2', async () => {
  const r = await run(['project-scoped-review', '--run-id', '_agent-cli', '--project', 'no-such-project-xyz']);
  assert.equal(r.exitCode, 2);
  assert.match(r.err, /project root not found/);
});

test('cmdAgentDispatch: happy path under the no-spawn seam → suppressed, no exit', async () => {
  const prior = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const runId = '_agent-cli-suppressed-test';
  try {
    const r = await run(['project-scoped-review', '--run-id', runId]);
    assert.equal(r.exitCode, null, 'no exit on a successful (suppressed) dispatch');
    assert.match(r.out, /spawn suppressed/);
  } finally {
    if (prior === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = prior;
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R4-17, D7 — `--session-dir <abs>`: the process that OBSERVES the run
// writes the terminal phase (complete/failed) into that session dir's
// status.json when the run ends. D6: WITHOUT the flag, behaviour is
// byte-identical to today (the 5 tests above, all still passing unmodified,
// ARE that regression pin — this block only adds NEW, additive coverage for
// the NEW flag).
// ---------------------------------------------------------------------------

// Re-homed (R4-17 pin 3, item 2 — mechanical amendment, forced by a T2
// ruling): the only REAL caller of `--session-dir`, `POST /api/studio/
// onboarding/start`, always builds `<projectsRoot>/<project>/_onboarding/
// <sessionId>` (cli/ui-bridge.ts) — a fixture under `<ROOT>/_logs/…` is not
// a shape any real session dir ever occupies. This constant + helper now
// mirror the real shape exactly; every assertion in the tests below is
// unchanged, only the fixture's directory moved. Swept via the module-level
// `after()` below regardless of individual test outcome.
const FIXTURE_PROJECT_DIR = join(ROOT, 'projects', '_r4-17-dispatch-fixture-proj');

function makeSessionDirFixture(name: string): string {
  const dir = join(FIXTURE_PROJECT_DIR, '_onboarding', `_r4-17-session-dir-fixture-${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ phase: 'running' }), 'utf8');
  return dir;
}

after(() => {
  rmSync(FIXTURE_PROJECT_DIR, { recursive: true, force: true });
});

test('cmdAgentDispatch: R4-17 AT-D7-1 — with --session-dir, a SUCCESSFUL dispatch (suppressed under the no-spawn seam still counts as "the run ended") writes phase:"complete" into that dir\'s status.json', async () => {
  const prior = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const runId = '_agent-cli-sessiondir-complete-test';
  const sessionDir = makeSessionDirFixture('complete');
  try {
    const r = await run(['project-scoped-review', '--run-id', runId, '--session-dir', sessionDir]);
    assert.equal(r.exitCode, null, 'a successful (even if suppressed) dispatch must not exit non-zero');
    const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string };
    assert.equal(status.phase, 'complete', `--session-dir must write the terminal phase when the run ends, got status.json: ${JSON.stringify(status)}`);
  } finally {
    if (prior === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = prior;
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('cmdAgentDispatch: R4-17 AT-D7-2 — with --session-dir, a FAILED dispatch (unknown slug) writes phase:"failed" into that dir\'s status.json', async () => {
  const runId = '_agent-cli-sessiondir-failed-test';
  const sessionDir = makeSessionDirFixture('failed');
  try {
    const r = await run(['totally-unknown-slug-does-not-exist', '--run-id', runId, '--session-dir', sessionDir]);
    assert.equal(r.exitCode, 1, 'an unknown-slug dispatch must still exit 1, exactly as before this flag existed');
    const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string };
    assert.equal(status.phase, 'failed', `--session-dir must write phase:"failed" on a failed run, got status.json: ${JSON.stringify(status)}`);
  } finally {
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('cmdAgentDispatch: R4-17 AT-D7-3 (D6 — byte-identical without the flag) — omitting --session-dir on a successful dispatch touches NO session status.json anywhere; a pre-existing fixture dir\'s status.json is left completely untouched', async () => {
  const prior = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const runId = '_agent-cli-nosessiondir-test';
  const untouchedDir = makeSessionDirFixture('untouched');
  const before = readFileSync(join(untouchedDir, 'status.json'), 'utf8');
  try {
    const r = await run(['project-scoped-review', '--run-id', runId]);
    assert.equal(r.exitCode, null);
    const after = readFileSync(join(untouchedDir, 'status.json'), 'utf8');
    assert.equal(after, before, 'a dispatch run with NO --session-dir flag must never guess at or touch ANY session status.json — D6\'s "byte-identical without the flag" claim');
  } finally {
    if (prior === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = prior;
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
    rmSync(untouchedDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R4-17 pin 3, item 3 (NEW — T2 ruling, binding): the containment root for
// `writeSessionTerminalPhase` (cli/agent-run.ts:193) must be `projectsRoot`,
// not `forgeRoot`. The round-1 fix widened the boundary to `forgeRoot`
// solely to keep the D7-1/2/3 fixtures above passing while they still lived
// under `<ROOT>/_logs/…` — disclosed honestly in that function's own header,
// but the precedent is exact and settled: R2-10's gate found
// `validateSessionKinds` fail-closing on a missing registry broke a
// synthetic `tmpRoot()` fixture, and T2 ruled the RULE stands, the fixture
// was the incomplete thing. Same call here — `forgeRoot` accepts a
// `status.json` write anywhere in the forge tree (`brain/`, `skills/`,
// `studio/`, `docs/`, `.git/`, `_logs/`…), a materially wider write surface
// than any real caller needs: the ONE real sender, `POST /api/studio/
// onboarding/start`, always builds `sessionDir` under `<projectsRoot>/
// <project>/_onboarding/<sessionId>` — a strict subset of `forgeRoot`. Item
// 2 (above) already re-homed the D7-1/2/3 fixtures onto that real
// `projectsRoot`-shaped path (`FIXTURE_PROJECT_DIR`), so retightening the
// guard to `projectsRoot` costs those pre-existing tests nothing.
//
// AT-D7-4 kills a guard whose containment root was widened to accommodate a
// TEST FIXTURE'S location rather than any real caller's — the shipped
// `forgeRoot` boundary is exactly that shape, and this AT is RED against it
// right now (verified below — see the T3 report for the raw run output).
// ---------------------------------------------------------------------------

test('cmdAgentDispatch: R4-17 AT-D7-4 (item 3, REJECT — must be RED against the shipped forgeRoot boundary): a --session-dir INSIDE forgeRoot but OUTSIDE projectsRoot (under <forgeRoot>/_logs/) must be REFUSED — asserted on the FILESYSTEM (status.json still reads its pre-run phase), never on exit code alone, because an exit code cannot distinguish "refused" from "wrote it and carried on"', async () => {
  const runId = '_agent-cli-outside-projectsroot-test';
  const outsideDir = join(ROOT, '_logs', '_r4-17-outside-projectsroot-fixture');
  mkdirSync(outsideDir, { recursive: true });
  const statusPath = join(outsideDir, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ phase: 'running' }), 'utf8');
  const before = readFileSync(statusPath, 'utf8');
  try {
    const r = await run(['totally-unknown-slug-does-not-exist', '--run-id', runId, '--session-dir', outsideDir]);
    assert.equal(r.exitCode, 1, 'an unknown-slug dispatch must still exit 1 regardless of the session-dir guard outcome');
    const afterStatus = readFileSync(statusPath, 'utf8');
    assert.equal(
      afterStatus, before,
      `a --session-dir INSIDE forgeRoot but OUTSIDE projectsRoot must be refused by writeSessionTerminalPhase's containment check — got status.json overwritten to: ${afterStatus}. The shipped guard's root is forgeRoot, which accepts this write; T2's binding ruling is that the root must be projectsRoot instead`,
    );
  } finally {
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('cmdAgentDispatch: R4-17 AT-D7-5 (item 3, ACCEPT control): a --session-dir under <projectsRoot>/<project>/_onboarding/<sid> — the REAL shape the one real caller uses — must still be written, proving the retightened guard is projectsRoot CONTAINMENT, not a blanket refusal of everything outside forgeRoot\'s _logs/ fixture shape', async () => {
  const prior = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const runId = '_agent-cli-inside-projectsroot-control-test';
  const sessionDir = makeSessionDirFixture('inside-projectsroot-control');
  try {
    const r = await run(['project-scoped-review', '--run-id', runId, '--session-dir', sessionDir]);
    assert.equal(r.exitCode, null, 'a successful (even if suppressed) dispatch must not exit non-zero');
    const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string };
    assert.equal(status.phase, 'complete', `a --session-dir under the REAL projectsRoot-shaped location must still be written — got status.json: ${JSON.stringify(status)}`);
  } finally {
    if (prior === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = prior;
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R4-17 pin 4, item 1 (BLOCKER, round-2 adversarial review): `writeSessionTerminalPhase`
// (agent-run.ts:194, exercised here via `cmdAgentDispatch`) resolves
// `projectsRoot` via `resolveProjectsDir(resolve(forgeRoot), loadConfig())`
// (cli/agent-run.ts:201) — config-aware, honouring BOTH `FORGE_PROJECTS_DIR`
// (env) and `forge.config.json`'s `projectsDir` (file), per
// `orchestrator/config.ts:106-121`'s documented precedence. The BLOCKER is
// that `cli/ui-bridge.ts:222` — `POST /api/studio/onboarding/start`, the ONE
// real producer of `--session-dir` — does NOT: it hardcodes `resolve(forgeRoot,
// 'projects')`, never consulting either mechanism. When an operator
// configures a custom projects root, the producer keeps building sessions
// under the OLD hardcoded literal while this guard now checks containment
// against the CONFIGURED root, and the two disagree.
//
// `cli/ui-bridge-onboarding-start.test.ts`'s AT-10 kills the PRODUCER half
// directly (RED now: the route can't even find a project that only exists
// under a configured root, so it 404s instead of placing the session there).
// The tests below pin the CONSUMER half this function owns: fed a
// `--session-dir` that legitimately sits under WHATEVER root is configured —
// the shape the route will build once AT-10's finding is fixed — the guard
// must still write the terminal phase, on both outcomes (AT-D7-6/7), and a
// dir OUTSIDE the configured root must still be refused (AT-D7-8) — the
// containment invariant has to survive a configured root, not just hold for
// the default. These pin the CORRECT, forward-looking target shape (not the
// current mismatched one), so — unlike AT-10 — they are expected to be GREEN
// already: this guard was never the broken half. They stay in the suite as
// the ACCEPT/REJECT controls the "guard that cannot fail is not a guard"
// brief requires, and as the regression pin that keeps this half correct
// once AT-10's producer-side fix lands.
//
// Two mechanisms, because `resolveProjectsDir` honours both:
//   - `FORGE_PROJECTS_DIR` (env, cwd-independent) — AT-D7-6/7/8.
//   - `forge.config.json`'s `projectsDir` (file) — `loadConfig()` is called
//     BARE at agent-run.ts:201 (`loadConfig()`, no path arg), so it resolves
//     `forge.config.json` relative to the process CWD, not `forgeRoot`. The
//     only way to exercise this mechanism here is to `process.chdir()` into a
//     forgeRoot that owns the file — mirroring how the REAL CLI entrypoint
//     already works (`orchestrator/cli.ts:46`, `process.chdir(FORGE_ROOT)`,
//     before any command runs) and the established test pattern for it
//     (`orchestrator/manifest-path-fields.test.ts`,
//     `orchestrator/trigger-prompt-isolation.test.ts`) — AT-D7-9.
// ---------------------------------------------------------------------------

test('cmdAgentDispatch: R4-17 AT-D7-6 (pin 4, item 1, ACCEPT — FORGE_PROJECTS_DIR, success path): a --session-dir legitimately placed under a CONFIGURED (non-default) projects root still gets phase:"complete" written', async () => {
  const priorSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorProjectsDir = process.env.FORGE_PROJECTS_DIR;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const customProjectsRoot = mkdtempSync(join(tmpdir(), 'r4-17-configured-projects-root-'));
  process.env.FORGE_PROJECTS_DIR = customProjectsRoot;
  const runId = '_agent-cli-configured-root-complete-test';
  const sessionDir = join(customProjectsRoot, 'someproj', '_onboarding', '_r4-17-configured-root-fixture-complete');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ phase: 'running' }), 'utf8');
  try {
    const r = await run(['project-scoped-review', '--run-id', runId, '--session-dir', sessionDir]);
    assert.equal(r.exitCode, null, 'a successful (even if suppressed) dispatch must not exit non-zero');
    const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string };
    assert.equal(
      status.phase, 'complete',
      `a --session-dir under a CONFIGURED (FORGE_PROJECTS_DIR) projects root must still get its terminal phase written — got: ${JSON.stringify(status)}`,
    );
  } finally {
    if (priorSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorSpawn;
    if (priorProjectsDir === undefined) delete process.env.FORGE_PROJECTS_DIR;
    else process.env.FORGE_PROJECTS_DIR = priorProjectsDir;
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
    rmSync(customProjectsRoot, { recursive: true, force: true });
  }
});

test('cmdAgentDispatch: R4-17 AT-D7-7 (pin 4, item 1, ACCEPT — FORGE_PROJECTS_DIR, failure path): a --session-dir under a CONFIGURED projects root still gets phase:"failed" written on a failed dispatch', async () => {
  const priorProjectsDir = process.env.FORGE_PROJECTS_DIR;
  const customProjectsRoot = mkdtempSync(join(tmpdir(), 'r4-17-configured-projects-root-'));
  process.env.FORGE_PROJECTS_DIR = customProjectsRoot;
  const runId = '_agent-cli-configured-root-failed-test';
  const sessionDir = join(customProjectsRoot, 'someproj', '_onboarding', '_r4-17-configured-root-fixture-failed');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ phase: 'running' }), 'utf8');
  try {
    const r = await run(['totally-unknown-slug-does-not-exist', '--run-id', runId, '--session-dir', sessionDir]);
    assert.equal(r.exitCode, 1, 'an unknown-slug dispatch must still exit 1');
    const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string };
    assert.equal(
      status.phase, 'failed',
      `a --session-dir under a CONFIGURED (FORGE_PROJECTS_DIR) projects root must still get phase:"failed" written on a failed dispatch — got: ${JSON.stringify(status)}`,
    );
  } finally {
    if (priorProjectsDir === undefined) delete process.env.FORGE_PROJECTS_DIR;
    else process.env.FORGE_PROJECTS_DIR = priorProjectsDir;
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
    rmSync(customProjectsRoot, { recursive: true, force: true });
  }
});

test('cmdAgentDispatch: R4-17 AT-D7-8 (pin 4, item 1, REJECT control — configured root): with FORGE_PROJECTS_DIR configured, a --session-dir OUTSIDE that configured root must still be refused — asserted on the FILESYSTEM, never on exit code alone', async () => {
  const priorProjectsDir = process.env.FORGE_PROJECTS_DIR;
  const customProjectsRoot = mkdtempSync(join(tmpdir(), 'r4-17-configured-projects-root-'));
  process.env.FORGE_PROJECTS_DIR = customProjectsRoot;
  const outsideConfiguredRoot = mkdtempSync(join(tmpdir(), 'r4-17-outside-configured-root-'));
  const statusPath = join(outsideConfiguredRoot, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ phase: 'running' }), 'utf8');
  const before = readFileSync(statusPath, 'utf8');
  const runId = '_agent-cli-outside-configured-root-test';
  try {
    const r = await run(['totally-unknown-slug-does-not-exist', '--run-id', runId, '--session-dir', outsideConfiguredRoot]);
    assert.equal(r.exitCode, 1, 'an unknown-slug dispatch must still exit 1 regardless of the session-dir guard outcome');
    const after = readFileSync(statusPath, 'utf8');
    assert.equal(
      after, before,
      `a --session-dir OUTSIDE the CONFIGURED projects root must still be refused — got status.json overwritten to: ${after}. The containment invariant must hold against whichever root is configured, not just the default`,
    );
  } finally {
    if (priorProjectsDir === undefined) delete process.env.FORGE_PROJECTS_DIR;
    else process.env.FORGE_PROJECTS_DIR = priorProjectsDir;
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
    rmSync(customProjectsRoot, { recursive: true, force: true });
    rmSync(outsideConfiguredRoot, { recursive: true, force: true });
  }
});

test('cmdAgentDispatch: R4-17 AT-D7-9 (pin 4, item 1, ACCEPT — forge.config.json mechanism): with a chdir\'d forgeRoot whose forge.config.json sets "projectsDir", a --session-dir under that configured root still gets its terminal phase written — mirrors AT-D7-6 but through the FILE mechanism instead of the env var', async () => {
  const priorSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const originalCwd = process.cwd();
  const configForgeRoot = mkdtempSync(join(tmpdir(), 'r4-17-configfile-forgeroot-'));
  const configuredProjectsRoot = mkdtempSync(join(tmpdir(), 'r4-17-configfile-projectsroot-'));
  writeFileSync(
    join(configForgeRoot, 'forge.config.json'),
    JSON.stringify({ projectsDir: configuredProjectsRoot }),
    'utf8',
  );
  const runId = '_agent-cli-configfile-root-complete-test';
  const sessionDir = join(configuredProjectsRoot, 'someproj', '_onboarding', '_r4-17-configfile-root-fixture-complete');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ phase: 'running' }), 'utf8');
  try {
    process.chdir(configForgeRoot);
    const r = await run(['project-scoped-review', '--run-id', runId, '--session-dir', sessionDir]);
    assert.equal(r.exitCode, null, 'a successful (even if suppressed) dispatch must not exit non-zero');
    const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string };
    assert.equal(
      status.phase, 'complete',
      `a --session-dir under a projects root configured via forge.config.json must still get its terminal phase written — got: ${JSON.stringify(status)}`,
    );
  } finally {
    process.chdir(originalCwd);
    if (priorSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorSpawn;
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
    rmSync(configForgeRoot, { recursive: true, force: true });
    rmSync(configuredProjectsRoot, { recursive: true, force: true });
  }
});
