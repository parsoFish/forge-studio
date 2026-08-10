/**
 * R4-22 WI-5 (T3, acceptance tests) — pins the contract for the dispatch
 * FORK `cmdAgentRun` (`cli/agent-run.ts`) must gain (ADR-043 §3): a
 * `turnSpec`-bearing session-kind descriptor routes onto the generic spine
 * `runInteractiveTurn` (`orchestrator/interactive-runner.ts`, R4-22 WI-3,
 * already landed on this branch); everything else keeps riding the existing,
 * byte-for-byte UNTOUCHED `AGENT_RUNNERS` registry path.
 *
 * RED-NOW: no fork exists yet — `cmdAgentRun` unconditionally resolves
 * `AGENT_RUNNERS[agentId]` FIRST and bails out with "unknown agent-id" for
 * anything not in that 4-entry registry. Every "new road" test below is
 * expected to fail for exactly that reason until WI-5 lands. See the T3
 * report for the exact captured RED output.
 *
 * ---------------------------------------------------------------------------
 * WHY NO DEPENDENCY-INJECTION SEAM (a design call this file had to make)
 * ---------------------------------------------------------------------------
 * `cmdAgentRun` today has the 2-arg signature `(rest, forgeRoot)`. Adding a
 * `deps?: { runInteractiveTurn?: ... }` parameter (mirroring
 * `cmdAgentDispatch`'s own `deps?: { dispatch?: ... }` a few dozen lines
 * below it in the same file) would be the obvious DI seam — but this test
 * file must typecheck AS WRITTEN, against `cmdAgentRun`'s CURRENT signature,
 * because WI-5 has not landed yet and is not this file's job to implement.
 * Calling a 2-arg function with a 3rd argument is a real `tsc` arity error,
 * not a runtime RED — that would violate this WI's "your file MUST
 * typecheck" requirement outright. `node:test`'s `mock.module()` was also
 * considered and rejected for the identical reason
 * `cli/ui-bridge-agent-run-ceiling.test.ts`'s own header already rejected it
 * for a sibling seam: it requires `--experimental-test-module-mocks`, a flag
 * `npm test` (and this WI's own mandated run command) does not pass.
 *
 * Instead, every "new road" test below drives `cmdAgentRun` to REAL,
 * SDK-free execution of `runInteractiveTurn` by giving the turnSpec fixture a
 * single `step: noop` phase (the one step `runInteractiveTurn` runs with zero
 * external calls — confirmed by `orchestrator/interactive-runner.test.ts`'s
 * own AT-2). The "call record" required by AT-1 below is then read back from
 * `runInteractiveTurn`'s OWN real event-log artifact
 * (`<forgeRoot>/_logs/_interactive-<descriptor.id>-<sessionId>/events.jsonl`,
 * `orchestrator/logging.ts`'s `createLogger` — its path and its `start`
 * event's `metadata.{session_id,session_kind,phase,step}` are read straight
 * from `runInteractiveTurn`'s own source, not guessed) — a MECHANISM-GROUNDED
 * proof of invocation-with-these-exact-args, not a bare "it did not throw"
 * proxy (the same evidentiary bar `cli/ui-bridge-agent-run-ceiling.test.ts`'s
 * header sets for its own no-spawn proof).
 *
 * The fixture forgeRoot is used BOTH as `cmdAgentRun`'s explicit `forgeRoot`
 * argument AND as the test process's `process.cwd()` for the call's duration
 * (restored in a `finally`, mirroring `cli/agent-run-dispatch.test.ts`'s own
 * AT-D7-9 precedent for exactly this technique). `cmdAgentRun`'s existing
 * `--project` resolution (`resolve('projects', projectArg)`) is cwd-relative
 * and forgeRoot-independent today; chdir'ing into the fixture forgeRoot makes
 * `resolve('projects', ...)` and any (unspecified, so-far) `resolve(forgeRoot,
 * 'projects', ...)` convention the WI-5 implementer might choose resolve to
 * the IDENTICAL path — this test suite does not need to guess which
 * convention lands.
 *
 * ---------------------------------------------------------------------------
 * DESIGN DECISIONS THIS FILE PINS (T3 call, per the WI-5 brief)
 * ---------------------------------------------------------------------------
 *   1. Routing key is `descriptor?.turnSpec` presence alone — NOT whether an
 *      `AGENT_RUNNERS` entry also exists for the same id (AT-5 kills a fork
 *      keyed on "is a session-kind descriptor").
 *   2. The `if (!entry)` unknown-agent-id bail-out must be reachable ONLY
 *      when BOTH `entry` is absent AND `descriptor?.turnSpec` is absent
 *      (AT-3/AT-4 — the ordering pin and its positive control).
 *   3. A turnSpec kind REQUIRES `--project <name>`; omitting it must print a
 *      usage error mentioning "--project" and "required", plus a `Usage:`
 *      line naming `--project <name>`, and exit(2) — the same OVERALL SHAPE
 *      as the legacy two-line error, even though there is no `entry.verb` to
 *      draw an exact prefix from (AT-6).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { cmdAgentRun, AGENT_RUNNERS } from './agent-run.ts';
import { loadSessionKinds } from '../orchestrator/studio/session-kinds.ts';
import { writeSessionStatus, readSessionStatus } from '../orchestrator/interactive-session.ts';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// cmdAgentRun driver — mirrors cli/agent-run-dispatch.test.ts's own `run()`
// helper exactly (the established house pattern for stubbing process.exit +
// console in this file's sibling test suite): a sentinel thrown from the
// process.exit stub returns control immediately without tearing down the
// test runner.
// ---------------------------------------------------------------------------

async function run(args: string[], forgeRoot: string): Promise<{ exitCode: number | null; out: string; err: string }> {
  const origExit = process.exit;
  const origLog = console.log;
  const origErr = console.error;
  let exitCode: number | null = null;
  const out: string[] = [];
  const err: string[] = [];
  process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error(`__exit__${exitCode}`); }) as typeof process.exit;
  console.log = (...a: unknown[]) => { out.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { err.push(a.join(' ')); };
  try {
    await cmdAgentRun(args, forgeRoot);
  } catch (e) {
    if (!/^__exit__/.test((e as Error).message)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

/** chdir for the duration of `fn`, always restoring — see the file header for
 *  why this is load-bearing rather than cosmetic. */
async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

// ---------------------------------------------------------------------------
// Fixture — one forgeRoot, one turnSpec-only descriptor (no AGENT_RUNNERS
// entry) with a single step:noop phase, plus a turnSpec-LESS "architect" row
// sharing an id with a real AGENT_RUNNERS key (AT-5's fixture). Loaded
// through the REAL loadSessionKinds parse path (studio/session-kinds.ts),
// mirroring orchestrator/interactive-runner.test.ts's own fixture-design
// precedent, rather than a hand-built descriptor object.
// ---------------------------------------------------------------------------

const TURNSPEC_ONLY_ID = 'turnspec-only-fixture-kind';
const KIND_DIR = '_fixturekind';

const FIXTURE_SESSION_KINDS_YAML = `
- id: ${TURNSPEC_ONLY_ID}
  agent: project-brain-builder
  title: Fixture turnSpec kind (R4-22 WI-5, T3)
  legacyRoutes: []
  stages: [contract]
  defaultStage: contract
  artifact:
    kind: markdown-draft
    label: Fixture artifact
  turnSpec:
    kindDir: ${KIND_DIR}
    style: agent
    phases:
      - { phase: p1, step: noop }
- id: architect
  agent: architect
  title: Architect (fixture, deliberately carries NO turnSpec)
  legacyRoutes: []
  stages: [roadmap]
  defaultStage: roadmap
  artifact:
    kind: roadmap-draft
    label: Fixture roadmap draft
`;

type TurnspecFixture = {
  forgeRoot: string;
  projectArg: string;
  projectRoot: string;
  sessionId: string;
  sessionDir: string;
};

function setupTurnspecFixture(): TurnspecFixture {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'r422-wi5-agentrun-'));
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);

  const projectArg = 'fixtureproj';
  // cwd-relative, matching cmdAgentRun's existing `resolve('projects',
  // projectArg)` convention — see file header. The test chdirs into
  // `forgeRoot` before invoking cmdAgentRun, so this is also exactly where
  // `resolve(forgeRoot, 'projects', projectArg)` would land.
  const projectRoot = join(forgeRoot, 'projects', projectArg);
  const sessionId = '2026-08-11T00-00-00-wi5fixture';
  const sessionDir = join(projectRoot, KIND_DIR, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'p1', updated_at: new Date(0).toISOString() });

  return { forgeRoot, projectArg, projectRoot, sessionId, sessionDir };
}

/** No `_interactive-<agentId>-*` event-log dir exists under `<forgeRoot>/
 *  _logs/` — the artifact `runInteractiveTurn` (and ONLY runInteractiveTurn)
 *  creates. Absence proves the new spine was never invoked. */
function assertNoInteractiveLogDir(forgeRoot: string, agentIdPrefix: string, msg: string): void {
  const logsRoot = join(forgeRoot, '_logs');
  if (!existsSync(logsRoot)) return;
  const entries = readdirSync(logsRoot);
  assert.ok(
    !entries.some((e) => e.startsWith(`_interactive-${agentIdPrefix}-`)),
    `${msg} — got _logs/ entries: ${entries.join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
// AT-1 — new road reached, CALL RECORD asserted (not just "no error").
// ---------------------------------------------------------------------------

// Kills: a fork that silently no-ops on a turnSpec id (never actually calls
// runInteractiveTurn — "no error" alone would pass a no-op just as easily as
// a real call); a fork that calls runInteractiveTurn with the WRONG
// descriptor (e.g. re-looked-up by a different key) or the WRONG
// ctx.sessionId/ctx.projectRoot (containment would then refuse and the log
// artifact this test reads would never be written at all, or would carry a
// mismatched session_id).
test('R4-22 WI-5, AT-1: a turnSpec-only agent-id (no AGENT_RUNNERS entry) drives runInteractiveTurn with the correct descriptor + ctx — proven by its own real event-log artifact', async () => {
  const fx = setupTurnspecFixture();
  try {
    // Fixture preconditions, established BEFORE any verdict is read.
    const descriptor = loadSessionKinds(fx.forgeRoot).find((d) => d.id === TURNSPEC_ONLY_ID);
    assert.ok(descriptor?.turnSpec, 'fixture precondition: descriptor must carry a turnSpec');
    assert.equal(AGENT_RUNNERS[TURNSPEC_ONLY_ID], undefined, 'fixture precondition: must NOT be an AGENT_RUNNERS key');
    const seeded = readSessionStatus<{ phase: string }>(fx.sessionDir);
    assert.equal(seeded?.phase, 'p1', 'fixture precondition: seeded status.json must start in phase p1');

    const r = await withCwd(fx.forgeRoot, () => run([TURNSPEC_ONLY_ID, fx.sessionId, '--project', fx.projectArg], fx.forgeRoot));
    assert.equal(r.exitCode, null, `a successful turn must not call process.exit — got exit(${r.exitCode}), stderr: ${r.err}`);

    const cycleId = `_interactive-${TURNSPEC_ONLY_ID}-${fx.sessionId}`;
    const logPath = join(fx.forgeRoot, '_logs', cycleId, 'events.jsonl');
    assert.ok(
      existsSync(logPath),
      `runInteractiveTurn's own event log must exist at ${logPath} — its absence means runInteractiveTurn was never actually invoked (stdout: ${r.out}, stderr: ${r.err})`,
    );
    const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    const startEv = lines.find((l) => l.event_type === 'start');
    assert.ok(startEv, `expected a "start" event in ${logPath}, got: ${JSON.stringify(lines)}`);
    const metadata = (startEv as Record<string, unknown>).metadata as Record<string, unknown>;
    assert.equal(metadata.session_id, fx.sessionId, 'CALL RECORD: ctx.sessionId must reach runInteractiveTurn unmodified');
    assert.equal(metadata.session_kind, TURNSPEC_ONLY_ID, 'CALL RECORD: the correct descriptor.id must have been passed');
    assert.equal(metadata.phase, 'p1', 'CALL RECORD: ctx.projectRoot correctly located OUR fixture session (a wrong projectRoot would have failed containment before any log write)');
    assert.equal(metadata.step, 'noop', 'sanity: our fixture phase table\'s declared step');
  } finally {
    rmSync(fx.forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-2 — legacy road untouched, for all 4 AGENT_RUNNERS ids.
// ---------------------------------------------------------------------------

// Kills: a fork that routes an id with turnSpec undefined/absent (every real
// AGENT_RUNNERS id today) through runInteractiveTurn anyway — proven two
// ways: (a) the printed error is the exact `entry.verb`-flavored legacy text
// (runInteractiveTurn's own errors are never phrased this way — see its
// source, "runInteractiveTurn: ..." throughout), and (b) no
// `_interactive-<id>-*` log dir — the artifact ONLY runInteractiveTurn
// creates — ever appears.
const LEGACY_FAST_FAIL_CASES: { agentId: string; args: string[]; expected: RegExp }[] = [
  { agentId: 'instructions', args: ['instructions', 'some-session-id'], expected: /^forge instructions run: --project <name> is required$/m },
  { agentId: 'demo-builder', args: ['demo-builder', 'some-session-id'], expected: /^forge demo-builder run: --project <name> is required$/m },
  { agentId: 'project-brain', args: ['project-brain', 'some-session-id'], expected: /^Usage: forge project-brain run <session-id> --project <name>$/m },
  { agentId: 'architect', args: ['architect'], expected: /^forge architect run: missing <session-id>$/m },
];

for (const { agentId, args, expected } of LEGACY_FAST_FAIL_CASES) {
  test(`R4-22 WI-5, AT-2 (legacy road untouched): 'agent run ${agentId}' still hits the legacy AGENT_RUNNERS fast-fail text, never runInteractiveTurn`, async () => {
    assert.notEqual(AGENT_RUNNERS[agentId], undefined, `fixture precondition: "${agentId}" must be a real AGENT_RUNNERS key`);
    const r = await run(args, ROOT);
    assert.equal(r.exitCode, 2, `expected exit 2, got stderr: ${r.err}`);
    assert.match(r.err, expected, `expected the legacy entry.verb-flavored text, got: ${r.err}`);
    assert.doesNotMatch(r.err, /runInteractiveTurn/, 'the legacy fast-fail path must never mention runInteractiveTurn');
    assertNoInteractiveLogDir(ROOT, agentId, `'agent run ${agentId}' must never create runInteractiveTurn's log artifact`);
  });
}

// ---------------------------------------------------------------------------
// AT-3 — ordering pin: a turnSpec-only id must not hit the unknown-agent-id
// bail-out, even when a downstream argument (here: --project) is missing.
// ---------------------------------------------------------------------------

// Kills: a fork placed AFTER `if (!entry) { unknown agent-id; exit(2) }`
// (today's code shape) — every turnSpec-only id would be rejected as unknown
// before the fork is ever consulted, making the new spine dead on arrival
// while looking correct in a review that only reads the fork's own diff.
test('R4-22 WI-5, AT-3 (ordering pin): a turnSpec-only agent-id must NOT be rejected as "unknown agent-id", even without --project', async () => {
  const fx = setupTurnspecFixture();
  try {
    const descriptor = loadSessionKinds(fx.forgeRoot).find((d) => d.id === TURNSPEC_ONLY_ID);
    assert.ok(descriptor?.turnSpec, 'fixture precondition: descriptor must carry a turnSpec');
    assert.equal(AGENT_RUNNERS[TURNSPEC_ONLY_ID], undefined, 'fixture precondition: must NOT be an AGENT_RUNNERS key');

    const r = await withCwd(fx.forgeRoot, () => run([TURNSPEC_ONLY_ID, fx.sessionId], fx.forgeRoot));
    assert.doesNotMatch(
      r.err, /unknown agent-id/i,
      `a turnSpec-only id must never hit the unknown-agent-id bail-out (the fork must be checked BEFORE that bail-out) — got: ${r.err}`,
    );
  } finally {
    rmSync(fx.forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-4 — positive control: a genuinely unknown id (neither AGENT_RUNNERS key
// nor turnSpec descriptor) is still refused.
// ---------------------------------------------------------------------------

// Kills: a fork that turns the unknown-agent-id bail-out into an "accept
// everything reaching loadSessionKinds" hole (e.g. dropping the `!entry &&`
// half of the guard entirely instead of narrowing it correctly).
test('R4-22 WI-5, AT-4 (positive control): an id that is neither an AGENT_RUNNERS key nor a session-kind descriptor is still refused as unknown-agent-id, exit 2', async () => {
  const fx = setupTurnspecFixture();
  try {
    const bogusId = 'totally-bogus-agent-id-xyz-does-not-exist';
    assert.equal(AGENT_RUNNERS[bogusId], undefined, 'fixture precondition: must not be an AGENT_RUNNERS key');
    const descriptor = loadSessionKinds(fx.forgeRoot).find((d) => d.id === bogusId);
    assert.equal(descriptor, undefined, 'fixture precondition: must not be a session-kind descriptor either');

    const r = await withCwd(fx.forgeRoot, () => run([bogusId, 'some-session-id'], fx.forgeRoot));
    assert.equal(r.exitCode, 2, `expected exit 2, got stderr: ${r.err}`);
    assert.match(r.err, /unknown agent-id/, `expected the unknown-agent-id refusal, got: ${r.err}`);
  } finally {
    rmSync(fx.forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-5 — a descriptor WITHOUT turnSpec does not take the new road, even when
// it shares an id with a real AGENT_RUNNERS key.
// ---------------------------------------------------------------------------

// Kills: a fork keyed on "a matching session-kind descriptor exists" rather
// than "the matching descriptor carries a turnSpec" — this fixture's
// "architect" row exists precisely so that wrong condition would be truthy
// here and misroute it.
test('R4-22 WI-5, AT-5: a descriptor WITHOUT turnSpec ("architect" — a real AGENT_RUNNERS key AND a real session-kind id) still takes the legacy road', async () => {
  const fx = setupTurnspecFixture();
  try {
    const descriptor = loadSessionKinds(fx.forgeRoot).find((d) => d.id === 'architect');
    assert.equal(descriptor?.turnSpec, undefined, 'fixture precondition: this row must carry NO turnSpec');
    assert.notEqual(AGENT_RUNNERS.architect, undefined, 'fixture precondition: "architect" must be a real AGENT_RUNNERS key');

    const r = await withCwd(fx.forgeRoot, () => run(['architect'], fx.forgeRoot)); // no session-id at all
    assert.equal(r.exitCode, 2, `expected exit 2, got stderr: ${r.err}`);
    assert.match(r.err, /^forge architect run: missing <session-id>$/m, `expected the legacy entry.verb-flavored error, got: ${r.err}`);
    assert.doesNotMatch(r.err, /runInteractiveTurn/);
    assertNoInteractiveLogDir(fx.forgeRoot, 'architect', 'a turnSpec-less "architect" descriptor must never reach runInteractiveTurn');
  } finally {
    rmSync(fx.forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-6 — argument-handling contract for the new road (PINNED by this file,
// per the WI-5 brief: "decide and pin how --project is handled").
// ---------------------------------------------------------------------------

// Kills: a new road that silently proceeds with an undefined/guessed
// projectRoot when --project is omitted (e.g. falling through to the
// architect-style auto-discovery `findSessionProject`, which was never asked
// for on this road) instead of refusing loudly, in the same shape the legacy
// required-project entries use.
test('R4-22 WI-5, AT-6 (argument-handling, PINNED): a turnSpec kind REQUIRES --project <name> — omitting it prints a usage error ("--project" + "required" + a Usage: line naming "--project <name>") and exits 2', async () => {
  const fx = setupTurnspecFixture();
  try {
    const descriptor = loadSessionKinds(fx.forgeRoot).find((d) => d.id === TURNSPEC_ONLY_ID);
    assert.ok(descriptor?.turnSpec, 'fixture precondition: descriptor must carry a turnSpec');

    const r = await withCwd(fx.forgeRoot, () => run([TURNSPEC_ONLY_ID, fx.sessionId], fx.forgeRoot)); // no --project
    assert.equal(r.exitCode, 2, `must exit 2 when --project is omitted for a turnSpec kind, got stdout: ${r.out}, stderr: ${r.err}`);
    assert.match(r.err, /--project/i, `expected the error to mention --project, got: ${r.err}`);
    assert.match(r.err, /required/i, `expected the error to say --project is required, got: ${r.err}`);
    assert.match(r.err, /Usage:.*--project <name>/s, `expected a Usage: line naming --project <name>, got: ${r.err}`);
    assertNoInteractiveLogDir(fx.forgeRoot, TURNSPEC_ONLY_ID, 'a rejected (missing --project) call must never reach runInteractiveTurn');
  } finally {
    rmSync(fx.forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R4-22 WI-5, AT-7 (STANDING INVARIANT — added by T2 after the WI-5 adversarial
// review proved the existing tripwire has a hole for exactly the event it
// exists to detect).
//
// The fork keys ONLY on `descriptor?.turnSpec` and is evaluated BEFORE the
// `AGENT_RUNNERS` lookup, so the moment a descriptor whose id COLLIDES with a
// legacy runner key gains a `turnSpec`, that bespoke runner is silently
// bypassed. Three real ids collide today: `architect`, `instructions`,
// `project-brain` (`demo` deliberately does not — the yaml's id differs from
// the `demo-builder` runner key).
//
// ADR-043 says that switch is INTENTIONAL — it is precisely how each runner
// migrates in batch E. The danger is that it can also happen BY ACCIDENT, and
// the review established by inspection that nothing would catch it:
// `orchestrator/interactive-runners-golden.test.ts` imports the four turn
// functions DIRECTLY and never imports `cmdAgentRun`/`loadSessionKinds`, so it
// stubs strictly BELOW the routing decision and would stay 4/4 green while the
// live CLI silently took the new road.
//
// This test is the missing tripwire. It reads the REAL shipped
// `studio/session-kinds.yaml` (not a fixture) and fails if any legacy-colliding
// id carries a `turnSpec`. It is DELIBERATELY expected to go red on the first
// real migration — that is its purpose: the migration must be an explicit,
// reviewed act that updates this invariant, never a silent yaml edit.
// KILLS: an accidental `turnSpec:` added to a legacy row, which would bypass a
// bespoke runner in production with every existing suite still green.
test('R4-22 WI-5, AT-7 (standing invariant): no legacy AGENT_RUNNERS id in the REAL session-kinds.yaml carries a turnSpec', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const descriptors = loadSessionKinds(repoRoot);

  // Arrange-assert: prove the fixture premise before reading any verdict — if
  // the real yaml failed to load or the collision set were empty, this test
  // would pass vacuously and protect nothing.
  assert.ok(descriptors.length > 0, 'arrange: the real studio/session-kinds.yaml must load with at least one descriptor');
  const legacyIds = Object.keys(AGENT_RUNNERS);
  assert.ok(legacyIds.length > 0, 'arrange: AGENT_RUNNERS must be non-empty');
  const colliding = descriptors.filter((d) => legacyIds.includes(d.id));
  assert.ok(
    colliding.length > 0,
    `arrange: at least one descriptor id must collide with an AGENT_RUNNERS key, else this invariant is vacuous ` +
      `(descriptor ids: ${descriptors.map((d) => d.id).join(', ')}; legacy ids: ${legacyIds.join(', ')})`,
  );

  const hijacked = colliding.filter((d) => d.turnSpec !== undefined).map((d) => d.id);
  assert.deepEqual(
    hijacked,
    [],
    `session-kind(s) ${hijacked.join(', ')} share an id with a legacy AGENT_RUNNERS entry AND declare a turnSpec, so ` +
      `cmdAgentRun's fork now routes them to the generic spine and their bespoke runner is DEAD CODE. If this is a ` +
      `deliberate batch-E migration (ADR-043), that is fine — but it must be explicit: migrate the runner, retire its ` +
      `AGENT_RUNNERS entry, and update this invariant in the same PR. If you did not intend to change routing, remove ` +
      `the turnSpec. The golden-capture suite CANNOT catch this: it calls the four turn functions directly and never ` +
      `exercises the fork.`,
  );
});

// ===========================================================================
// R4-21 phase 2, WI-1 (_wave5/unit-specs/R4-21-phase2.md) — the REAL
// checked-in `studio/session-kinds.yaml` "authoring" row drives the fork
// through cmdAgentRun, the REAL CLI entry point. Every AT-1..AT-7 test above
// proves the GENERIC fork mechanism against a synthetic fixture id
// (`turnspec-only-fixture-kind`); this test proves the mechanism actually
// FIRES for the specific id "authoring" once the real production yaml file
// carries its turnSpec — the defect this WI-1 closes (defect 1 in the
// unit-spec: "No descriptor carries turnSpec ⇒ the R4-22 spine is
// unreachable from production"). RED today: the real "authoring" row has no
// turnSpec, so this falls through to `AGENT_RUNNERS['authoring']`
// (undefined) and hits the unknown-agent-id bail-out.
//
// The REAL, checked-in studio/session-kinds.yaml is copied byte-for-byte
// into an isolated tmp forgeRoot (never written into, never read from the
// real worktree at test time) — this is deliberately NOT a hand-rolled
// duplicate of the authoring row (which would only prove the generic
// mechanism again, redundant with AT-1 above): reading the actual file
// means a typo/drift the WI-1 implementer introduces in the real file is
// caught here, not just in session-kinds.test.ts's structural pins.
// ===========================================================================

test('R4-21 phase 2, WI-1: cmdAgentRun(["authoring", sid, "--project", p]) reaches runInteractiveTurn and NOT AGENT_RUNNERS — driven by the REAL checked-in session-kinds.yaml through the REAL CLI entry point', async () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const realYaml = readFileSync(join(repoRoot, 'studio', 'session-kinds.yaml'), 'utf8');
  // Fixture precondition, asserted before reading any verdict.
  assert.ok(realYaml.includes('id: authoring'), 'arrange: the real, checked-in studio/session-kinds.yaml must declare an "authoring" row');
  assert.equal(AGENT_RUNNERS['authoring'], undefined, 'fixture precondition: "authoring" must NOT be an AGENT_RUNNERS key (there is no bespoke authoring-runner.ts)');

  const forgeRoot = mkdtempSync(join(tmpdir(), 'r421-phase2-agentrun-'));
  try {
    mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
    writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), realYaml);

    const projectArg = 'fixtureproj';
    const projectRoot = join(forgeRoot, 'projects', projectArg);
    // D1 (ADR-043 §1): the real authoring turnSpec's kindDir is "_authoring"
    // — hardcoded here (not re-derived from the descriptor we're about to
    // load) so a kindDir drift in the real file surfaces as a containment
    // failure below rather than a silently-matching fixture path.
    const sessionId = '2026-08-11T00-00-00-r421p2';
    const sessionDir = join(projectRoot, '_authoring', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    // awaiting-review is the real authoring turnSpec's ONE noop-step phase
    // (ADR-043 §1) — SDK-free, mirroring this file's own established
    // no-mock-seam design (see file header "WHY NO DEPENDENCY-INJECTION SEAM").
    writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'awaiting-review', updated_at: new Date(0).toISOString() });
    assert.equal(
      readSessionStatus<{ phase: string }>(sessionDir)?.phase,
      'awaiting-review',
      'arrange: seeded status must start in awaiting-review',
    );

    const r = await withCwd(forgeRoot, () => run(['authoring', sessionId, '--project', projectArg], forgeRoot));
    assert.equal(r.exitCode, null, `a successful turn must not call process.exit — got exit(${r.exitCode}), stderr: ${r.err}`);
    assert.doesNotMatch(
      r.err,
      /unknown agent-id/i,
      `"authoring" must not be rejected as unknown-agent-id once the real yaml carries its turnSpec — got stderr: ${r.err}`,
    );

    const logPath = join(forgeRoot, '_logs', `_interactive-authoring-${sessionId}`, 'events.jsonl');
    assert.ok(
      existsSync(logPath),
      `runInteractiveTurn's own event log must exist at ${logPath} — its absence means "authoring" fell through to ` +
        `AGENT_RUNNERS (undefined -> unknown-agent-id) instead of reaching runInteractiveTurn (stdout: ${r.out}, stderr: ${r.err})`,
    );
    const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    const startEv = lines.find((l) => l.event_type === 'start');
    assert.ok(startEv, `expected a "start" event in ${logPath}, got: ${JSON.stringify(lines)}`);
    const metadata = (startEv as Record<string, unknown>).metadata as Record<string, unknown>;
    assert.equal(metadata.session_id, sessionId, 'CALL RECORD: ctx.sessionId must reach runInteractiveTurn unmodified');
    assert.equal(metadata.session_kind, 'authoring', 'CALL RECORD: the real "authoring" descriptor.id must have been passed — NOT AGENT_RUNNERS');
    assert.equal(metadata.step, 'noop', 'sanity: the real authoring turnSpec\'s awaiting-review row declares step:noop');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
