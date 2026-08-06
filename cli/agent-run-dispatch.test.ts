/**
 * Tests for `cmdAgentDispatch` (R2-01-F3) — the `forge agent dispatch <slug>`
 * generic-run CLI the bridge spawns detached. Arg parsing + the no-spawn-seam
 * happy path; `process.exit` + console are stubbed so exit codes are asserted
 * without tearing down the test runner.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
