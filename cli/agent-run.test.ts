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
 * `runInteractiveTurn`'s OWN real event-log artifact, LOCATED BY CONTENT, not
 * by a hardcoded directory-name literal (R4-22 F4 amendment — see
 * `findInteractiveRunnerStartEvent` below): every event `runInteractiveTurn`
 * emits carries `skill: 'interactive-runner'` (`orchestrator/
 * interactive-runner.ts`'s `RUNNER_SKILL`), a value no legacy runner ever
 * emits, so scanning every events.jsonl under `<forgeRoot>/_logs/` for that
 * skill plus a matching `metadata.{session_id,session_kind}` finds the right event
 * regardless of which directory it landed in — deliberately decoupled from
 * `orchestrator/interactive-runner.ts:213`'s own directory-naming convention
 * (`_<descriptor.id>-<sessionId>`, pinned separately by this file's AT-a/AT-b
 * and by `cli/agent-run-log-dir-colocation.test.ts`'s co-location ratchet),
 * because a dir-NAME discriminator alone cannot tell "the spine ran" apart
 * from "a legacy runner sharing the same kind id ran" once both write into
 * an identically-named directory. `orchestrator/logging.ts`'s `createLogger`
 * writes the artifact; the `start` event's own
 * `metadata.{session_id,session_kind,phase,step}` is read straight from
 * `runInteractiveTurn`'s own source, not guessed — a MECHANISM-GROUNDED proof
 * of invocation-with-these-exact-args, not a bare "it did not throw" proxy
 * (the same evidentiary bar `cli/ui-bridge-agent-run-ceiling.test.ts`'s
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
  appendFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  statSync,
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

/** R4-22 F4 amendment (replaces the former `assertNoInteractiveLogDir`,
 *  which discriminated "did the spine run" by a `_interactive-<id>-*`
 *  directory-NAME prefix). LOCATES the ONE `runInteractiveTurn`-emitted
 *  "start" event, ANYWHERE under `<forgeRoot>/_logs/`, matching `sessionId`
 *  + `sessionKind` by CONTENT — `skill: 'interactive-runner'`
 *  (`orchestrator/interactive-runner.ts`'s `RUNNER_SKILL`, stamped on every
 *  event the spine emits and on NO event any of the 4 legacy runners emit:
 *  they stamp 'architect-runner' / 'instructions-runner' /
 *  'demo-builder-runner' / 'project-brain-builder' — see each runner's own
 *  `skill:` literal, `orchestrator/{architect,instructions,demo-builder,
 *  project-brain-builder}-runner.ts`).
 *
 *  Deliberately does NOT assume any particular directory NAME: once
 *  `orchestrator/interactive-runner.ts:213`'s cycleId becomes
 *  `_<descriptor.id>-<sessionId>` (this WI's own fixed convention, pinned by
 *  AT-a/AT-b/the co-location ratchet), that directory name is
 *  INDISTINGUISHABLE from a legacy runner's own directory for any id the two
 *  share (architect/instructions/project-brain) — a dir-name discriminator
 *  can no longer tell "the spine ran" apart from "the legacy runner with the
 *  same kind id ran"; only the event's own `skill` field still can. Returns
 *  `undefined` if no matching event exists anywhere. */
/** Shared walk (extracted so findInteractiveRunnerStartEvent's find-one and
 *  assertNoInteractiveRunnerSkillEvent's assert-none below cannot silently
 *  drift apart on what counts as "every event under _logs/"): yields every
 *  raw JSONL line from every `<forgeRoot>/_logs/<dir>/events.jsonl`,
 *  alongside its parsed form (`undefined` if the line failed to
 *  `JSON.parse`) and the events.jsonl path it came from. */
/** Opaque to callers (forge-q1z): per events.jsonl, existed-at-snapshot + byte size. */
type LogBaseline = Map<string, { existed: boolean; size: number }>;

function* walkEventJsonLines(forgeRoot: string, baseline?: LogBaseline): Generator<{
  eventsPath: string;
  line: string;
  parsed: Record<string, unknown> | undefined;
}> {
  const logsRoot = join(forgeRoot, '_logs');
  if (!existsSync(logsRoot)) return;
  for (const entry of readdirSync(logsRoot)) {
    const eventsPath = join(logsRoot, entry, 'events.jsonl');
    if (!existsSync(eventsPath)) continue;
    const prior = baseline?.get(eventsPath);
    const startByte = prior?.existed ? prior.size : 0;
    const lines = readFileSync(eventsPath).subarray(startByte).toString('utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        parsed = undefined;
      }
      yield { eventsPath, line, parsed };
    }
  }
}

function findInteractiveRunnerStartEvent(
  forgeRoot: string,
  sessionId: string,
  sessionKind: string,
): Record<string, unknown> | undefined {
  for (const { parsed } of walkEventJsonLines(forgeRoot)) {
    if (!parsed) continue;
    if (parsed.event_type !== 'start' || parsed.skill !== 'interactive-runner') continue;
    const metadata = parsed.metadata as Record<string, unknown> | undefined;
    if (metadata?.session_id === sessionId && metadata?.session_kind === sessionKind) return parsed;
  }
  return undefined;
}

/** No event ANYWHERE under `<forgeRoot>/_logs/` carries `skill:
 *  'interactive-runner'` — proves `runInteractiveTurn` was never invoked at
 *  all (any session/kind). STRICTLY STRONGER than the directory-name-prefix
 *  check it replaces (`_interactive-<id>-*`) — see
 *  `findInteractiveRunnerStartEvent`'s doc above for why a dir-name
 *  discriminator alone stops working once the spine's directory name
 *  collides with a legacy runner's own. */
/** Snapshot (forge-q1z) — take right before the invocation under test. */
function snapshotLogs(forgeRoot: string): LogBaseline {
  const baseline: LogBaseline = new Map();
  const logsRoot = join(forgeRoot, '_logs');
  if (!existsSync(logsRoot)) return baseline;
  for (const entry of readdirSync(logsRoot)) {
    const eventsPath = join(logsRoot, entry, 'events.jsonl');
    const existed = existsSync(eventsPath);
    baseline.set(eventsPath, { existed, size: existed ? statSync(eventsPath).size : 0 });
  }
  return baseline;
}

function assertNoInteractiveRunnerSkillEvent(forgeRoot: string, baseline: LogBaseline, msg: string): void {
  for (const { eventsPath, line, parsed } of walkEventJsonLines(forgeRoot, baseline)) {
    if (!parsed) continue;
    assert.notEqual(
      parsed.skill,
      'interactive-runner',
      `${msg} — found a skill:'interactive-runner' event in ${eventsPath}: ${line}`,
    );
  }
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

    // R4-22 F4 amendment: located by CONTENT (skill: 'interactive-runner' +
    // matching session_id/session_kind), not by a hardcoded directory-name
    // literal — see findInteractiveRunnerStartEvent's doc + this file's header.
    const startEv = findInteractiveRunnerStartEvent(fx.forgeRoot, fx.sessionId, TURNSPEC_ONLY_ID);
    assert.ok(
      startEv,
      `expected a skill:'interactive-runner' start event for session ${fx.sessionId} kind ${TURNSPEC_ONLY_ID} ` +
        `anywhere under ${join(fx.forgeRoot, '_logs')} — its absence means runInteractiveTurn was never actually ` +
        `invoked (stdout: ${r.out}, stderr: ${r.err})`,
    );
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
// source, "runInteractiveTurn: ..." throughout), and (b) no event anywhere
// under `_logs/` carries `skill: 'interactive-runner'` — the marker ONLY
// runInteractiveTurn stamps (R4-22 F4 amendment: content-based, not a
// `_interactive-<id>-*` directory-name check, which stops discriminating the
// moment the spine's directory name collides with the legacy runner's own —
// see this file's header).
const LEGACY_FAST_FAIL_CASES: { agentId: string; args: string[]; expected: RegExp }[] = [
  { agentId: 'instructions', args: ['instructions', 'some-session-id'], expected: /^forge instructions run: --project <name> is required$/m },
  { agentId: 'demo-builder', args: ['demo-builder', 'some-session-id'], expected: /^forge demo-builder run: --project <name> is required$/m },
  { agentId: 'project-brain', args: ['project-brain', 'some-session-id'], expected: /^Usage: forge project-brain run <session-id> --project <name>$/m },
  { agentId: 'architect', args: ['architect'], expected: /^forge architect run: missing <session-id>$/m },
];

for (const { agentId, args, expected } of LEGACY_FAST_FAIL_CASES) {
  test(`R4-22 WI-5, AT-2 (legacy road untouched): 'agent run ${agentId}' still hits the legacy AGENT_RUNNERS fast-fail text, never runInteractiveTurn`, async () => {
    assert.notEqual(AGENT_RUNNERS[agentId], undefined, `fixture precondition: "${agentId}" must be a real AGENT_RUNNERS key`);
    const baseline = snapshotLogs(ROOT);
    const r = await run(args, ROOT);
    assert.equal(r.exitCode, 2, `expected exit 2, got stderr: ${r.err}`);
    assert.match(r.err, expected, `expected the legacy entry.verb-flavored text, got: ${r.err}`);
    assert.doesNotMatch(r.err, /runInteractiveTurn/, 'the legacy fast-fail path must never mention runInteractiveTurn');
    assertNoInteractiveRunnerSkillEvent(ROOT, baseline, `'agent run ${agentId}' must never create runInteractiveTurn's log artifact`);
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

    const baseline = snapshotLogs(fx.forgeRoot);
    const r = await withCwd(fx.forgeRoot, () => run(['architect'], fx.forgeRoot)); // no session-id at all
    assert.equal(r.exitCode, 2, `expected exit 2, got stderr: ${r.err}`);
    assert.match(r.err, /^forge architect run: missing <session-id>$/m, `expected the legacy entry.verb-flavored error, got: ${r.err}`);
    assert.doesNotMatch(r.err, /runInteractiveTurn/);
    assertNoInteractiveRunnerSkillEvent(fx.forgeRoot, baseline, 'a turnSpec-less "architect" descriptor must never reach runInteractiveTurn');
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

    const baseline = snapshotLogs(fx.forgeRoot);
    const r = await withCwd(fx.forgeRoot, () => run([TURNSPEC_ONLY_ID, fx.sessionId], fx.forgeRoot)); // no --project
    assert.equal(r.exitCode, 2, `must exit 2 when --project is omitted for a turnSpec kind, got stdout: ${r.out}, stderr: ${r.err}`);
    assert.match(r.err, /--project/i, `expected the error to mention --project, got: ${r.err}`);
    assert.match(r.err, /required/i, `expected the error to say --project is required, got: ${r.err}`);
    assert.match(r.err, /Usage:.*--project <name>/s, `expected a Usage: line naming --project <name>, got: ${r.err}`);
    assertNoInteractiveRunnerSkillEvent(fx.forgeRoot, baseline, 'a rejected (missing --project) call must never reach runInteractiveTurn');
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

    // R4-22 F4 amendment: located by CONTENT, not a hardcoded directory-name
    // literal — see findInteractiveRunnerStartEvent's doc + this file's header.
    const startEv = findInteractiveRunnerStartEvent(forgeRoot, sessionId, 'authoring');
    assert.ok(
      startEv,
      `expected a skill:'interactive-runner' start event for session ${sessionId} kind "authoring" anywhere under ` +
        `${join(forgeRoot, '_logs')} — its absence means "authoring" fell through to AGENT_RUNNERS (undefined -> ` +
        `unknown-agent-id) instead of reaching runInteractiveTurn (stdout: ${r.out}, stderr: ${r.err})`,
    );
    const metadata = (startEv as Record<string, unknown>).metadata as Record<string, unknown>;
    assert.equal(metadata.session_id, sessionId, 'CALL RECORD: ctx.sessionId must reach runInteractiveTurn unmodified');
    assert.equal(metadata.session_kind, 'authoring', 'CALL RECORD: the real "authoring" descriptor.id must have been passed — NOT AGENT_RUNNERS');
    assert.equal(metadata.step, 'noop', 'sanity: the real authoring turnSpec\'s awaiting-review row declares step:noop');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ===========================================================================
// R4-21 phase 2, amendment round 2, correction B (_wave5/unit-specs/
// R4-21-phase2.md's own T2 spec does not cover this — the T3 amendment brief
// does): `runTurnSpecAgent` (cli/agent-run.ts) resolves the projects root
// with a HARDCODED `resolveGuardedPath(resolve('projects'), [projectArg])` —
// `<cwd>/projects`, ignoring `forge.config.json`'s `projectsDir` and the
// `FORGE_PROJECTS_DIR` env var entirely. Every bridge route instead resolves
// the projects root via `resolveProjectsDir(forgeRoot, loadConfig(
// defaultConfigPath(forgeRoot)))` (orchestrator/config.ts:143) — the single
// source of truth for "where do managed projects live", honouring BOTH
// overrides. Because R4-21's `POST /api/studio/authoring/start` route SPAWNS
// `forge agent run authoring <sid> --project <p>` (WI-2, D5's sibling
// concern), a non-default `projectsDir` makes a UI-created session
// UNREACHABLE by its own turn — this CLI entry point looks in the wrong
// place while the bridge that created the session looked in the right one.
//
// RED-NOW: `runTurnSpecAgent` never calls `resolveProjectsDir` at all, so a
// session seeded under a CONFIGURED (non-default) projects dir is invisible
// to it — the guard resolves `<forgeRoot>/projects/<projectArg>`, which
// either does not exist at all (a fresh forgeRoot with no `projects/` dir)
// or, if it does, does not contain this test's session — either way,
// `cmdAgentRun` exits 2 rather than running the turn.
// ===========================================================================

type ProjectsDirMode =
  | { kind: 'default' }
  | { kind: 'config'; relativeDirName: string }
  | { kind: 'env'; absoluteDir: string };

/** Mirrors `setupTurnspecFixture` above, but places the fixture project under
 *  a projects root chosen by `mode` instead of always `<forgeRoot>/projects`
 *  — `'config'` writes a `forge.config.json` declaring `projectsDir`;
 *  `'env'` expects the caller to have already set `FORGE_PROJECTS_DIR` (this
 *  function does not touch process.env itself, so the caller controls
 *  restore-in-finally around it). */
function setupTurnspecFixtureWithProjectsDir(mode: ProjectsDirMode): TurnspecFixture {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'r421-correctionB-agentrun-'));
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);

  let projectsDirAbs: string;
  if (mode.kind === 'default') {
    projectsDirAbs = join(forgeRoot, 'projects');
  } else if (mode.kind === 'config') {
    projectsDirAbs = join(forgeRoot, mode.relativeDirName);
    writeFileSync(join(forgeRoot, 'forge.config.json'), JSON.stringify({ projectsDir: mode.relativeDirName }, null, 2));
  } else {
    projectsDirAbs = mode.absoluteDir;
  }

  const projectArg = 'fixtureproj';
  const projectRoot = join(projectsDirAbs, projectArg);
  const sessionId = '2026-08-11T00-00-00-correctionb';
  const sessionDir = join(projectRoot, KIND_DIR, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'p1', updated_at: new Date(0).toISOString() });

  return { forgeRoot, projectArg, projectRoot, sessionId, sessionDir };
}

test('R4-21 phase 2, correction B, AT-B1: cmdAgentRun resolves the projects root via forge.config.json\'s "projectsDir" (resolveProjectsDir), not a hardcoded <cwd>/projects', async () => {
  const fx = setupTurnspecFixtureWithProjectsDir({ kind: 'config', relativeDirName: 'custom-projects' });
  try {
    // Fixture preconditions — proven BEFORE reading any verdict, per this
    // file's own established idiom.
    assert.ok(existsSync(fx.sessionDir), 'arrange: the session must exist under the CONFIGURED custom-projects/ dir');
    assert.equal(
      existsSync(join(fx.forgeRoot, 'projects', fx.projectArg)),
      false,
      'arrange: the session must NOT also exist under the default projects/ dir — a hardcoded resolve(\'projects\') coincidentally finding it would falsify this test',
    );

    const r = await withCwd(fx.forgeRoot, () => run([TURNSPEC_ONLY_ID, fx.sessionId, '--project', fx.projectArg], fx.forgeRoot));
    assert.equal(
      r.exitCode, null,
      `expected the turn to resolve the session under the CONFIGURED projectsDir and run it — got exit(${r.exitCode}), stdout: ${r.out}, stderr: ${r.err}`,
    );

    // R4-22 F4 amendment: located by CONTENT, not a hardcoded directory-name
    // literal — see findInteractiveRunnerStartEvent's doc + this file's header.
    const startEv = findInteractiveRunnerStartEvent(fx.forgeRoot, fx.sessionId, TURNSPEC_ONLY_ID);
    assert.ok(
      startEv,
      `expected a skill:'interactive-runner' start event for session ${fx.sessionId} kind ${TURNSPEC_ONLY_ID} — its ` +
        `absence means the session under the CONFIGURED projectsDir was never found (stdout: ${r.out}, stderr: ${r.err})`,
    );
  } finally {
    rmSync(fx.forgeRoot, { recursive: true, force: true });
  }
});

test('R4-21 phase 2, correction B, AT-B2: cmdAgentRun resolves the projects root via FORGE_PROJECTS_DIR (env override wins over config/default)', async () => {
  const externalProjectsDir = mkdtempSync(join(tmpdir(), 'r421-correctionb-external-projects-'));
  const fx = setupTurnspecFixtureWithProjectsDir({ kind: 'env', absoluteDir: externalProjectsDir });
  const prevEnv = process.env.FORGE_PROJECTS_DIR;
  process.env.FORGE_PROJECTS_DIR = externalProjectsDir;
  try {
    assert.ok(existsSync(fx.sessionDir), 'arrange: the session must exist under the env-pointed external projects dir');
    assert.equal(
      existsSync(join(fx.forgeRoot, 'projects', fx.projectArg)),
      false,
      'arrange: the session must NOT also exist under the default projects/ dir',
    );

    const r = await withCwd(fx.forgeRoot, () => run([TURNSPEC_ONLY_ID, fx.sessionId, '--project', fx.projectArg], fx.forgeRoot));
    assert.equal(
      r.exitCode, null,
      `expected the turn to resolve the session via FORGE_PROJECTS_DIR and run it — got exit(${r.exitCode}), stdout: ${r.out}, stderr: ${r.err}`,
    );

    // R4-22 F4 amendment: located by CONTENT, not a hardcoded directory-name
    // literal — see findInteractiveRunnerStartEvent's doc + this file's header.
    const startEv = findInteractiveRunnerStartEvent(fx.forgeRoot, fx.sessionId, TURNSPEC_ONLY_ID);
    assert.ok(
      startEv,
      `expected a skill:'interactive-runner' start event for session ${fx.sessionId} kind ${TURNSPEC_ONLY_ID} — its ` +
        `absence means FORGE_PROJECTS_DIR was not honoured (stdout: ${r.out}, stderr: ${r.err})`,
    );
  } finally {
    if (prevEnv === undefined) delete process.env.FORGE_PROJECTS_DIR;
    else process.env.FORGE_PROJECTS_DIR = prevEnv;
    rmSync(fx.forgeRoot, { recursive: true, force: true });
    rmSync(externalProjectsDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-B3 — regression pin: the fix above must not regress the EXISTING
// guarded-segment containment (R4-22 WI-5 review finding 1 / ADR-043 §3's own
// "root-folding" closure) — an untrusted --project value must still ride as
// its OWN guarded segment against whichever projects root is in effect,
// never folded into it. GREEN on arrival (the guard already exists in
// runTurnSpecAgent today); mutation-proved below rather than trusted at face
// value.
// ---------------------------------------------------------------------------

test('R4-21 phase 2, correction B, AT-B3 (regression pin): --project still rides as its OWN guarded segment under a reconfigured projectsDir — "..", an absolute path, and a "/"-bearing name are all refused', async () => {
  const fx = setupTurnspecFixtureWithProjectsDir({ kind: 'config', relativeDirName: 'custom-projects' });
  try {
    const baseline = snapshotLogs(fx.forgeRoot);
    for (const bad of ['..', '/etc', 'a/b']) {
      const r = await withCwd(fx.forgeRoot, () => run([TURNSPEC_ONLY_ID, fx.sessionId, '--project', bad], fx.forgeRoot));
      assert.equal(r.exitCode, 2, `--project ${JSON.stringify(bad)} must be refused, got exit(${r.exitCode}), stdout: ${r.out}`);
      assert.match(r.err, /not a valid project name/, `expected the guarded-segment refusal text for ${JSON.stringify(bad)}, got: ${r.err}`);
    }
    assertNoInteractiveRunnerSkillEvent(fx.forgeRoot, baseline, 'a refused --project value must never reach runInteractiveTurn');
  } finally {
    rmSync(fx.forgeRoot, { recursive: true, force: true });
  }
});

// ===========================================================================
// R4-22 F4 (T3, acceptance tests) — pins the CORRECT event-log DIRECTORY
// LOCATION `runInteractiveTurn` must write into: `_<descriptor.id>-
// <sessionId>` under `<forgeRoot>/_logs/` — the SAME convention every real
// consumer of an interactive session's live log already derives
// independently:
//   - forge-ui/app/sessions/[kind]/[sessionId]/page.tsx:158,
//     `cycleId = \`_${kind}-${sessionId}\``, handed to useCycleEvents;
//   - cli/ui-bridge.ts's spawnAgentTurn (~L2044-2062) writes a turn's
//     stderr.log into `_logs/_${logPrefix}-${sessionId}/`
//     (SPAWN_AGENT_SPECS.authoring.logPrefix === 'authoring');
//   - the 4 legacy runners' own createLogger cycleId's
//     (`_architect-<sid>`, `_instructions-<sid>`, `_demo-<sid>`,
//     `_project-brain-<sid>` — orchestrator/{architect,instructions,
//     demo-builder,project-brain-builder}-runner.ts).
//
// THE DEFECT (already reproduced — see the T3 brief, not re-litigated here):
// `orchestrator/interactive-runner.ts:213` today builds
// `cycleId = \`_interactive-${descriptor.id}-${ctx.sessionId}\`` — an EXTRA
// `_interactive-` prefix none of the three consumers above share. One real
// authoring turn therefore splits its stderr (written to `_authoring-<sid>`)
// and its own events (written to `_interactive-authoring-<sid>`) across TWO
// directories, and the live UI panel (subscribed to `_authoring-<sid>` per
// page.tsx) sees neither.
//
// AT-1..AT-7/WI-1/AT-B1..AT-B3 above (amended, R4-22 F4) prove the FORK
// routes to runInteractiveTurn at all, by CONTENT (skill:
// 'interactive-runner'), deliberately independent of directory naming. The
// two tests below are the ones that pin the LOCATION contract itself — they
// are expected to be RED at HEAD (no production change on this branch yet)
// and GREEN only once interactive-runner.ts:213 is fixed.
// ===========================================================================

// Kills: an implementation that leaves orchestrator/interactive-runner.ts:213
// unchanged (cycleId = `_interactive-${descriptor.id}-${ctx.sessionId}`) —
// the correct-directory assertion fails outright; and an implementation that
// "fixes" it by writing into BOTH the old and new directories (e.g. a
// half-migration that keeps the old write for back-compat, so the bug's
// symptom — the UI subscribing to a directory nothing/only-half writes to —
// persists) — the explicit must-NOT-exist assertion on the old directory
// catches that, which a must-exist-only assertion on the new directory alone
// would miss entirely.
test('R4-22 F4, AT-a: cmdAgentRun(["authoring", sid, "--project", p]) writes its event log to _logs/_authoring-<sid>/, NOT _logs/_interactive-authoring-<sid>/ — driven by the REAL checked-in session-kinds.yaml through the REAL CLI entry point', async () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const realYaml = readFileSync(join(repoRoot, 'studio', 'session-kinds.yaml'), 'utf8');
  // Fixture preconditions, asserted BEFORE reading any verdict.
  assert.ok(realYaml.includes('id: authoring'), 'arrange: the real, checked-in studio/session-kinds.yaml must declare an "authoring" row');
  assert.match(realYaml, /id:\s*authoring[\s\S]*?turnSpec:/, 'arrange: the real "authoring" row must carry a turnSpec');

  const forgeRoot = mkdtempSync(join(tmpdir(), 'r422f4-ata-agentrun-'));
  try {
    mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
    writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), realYaml);

    const projectArg = 'fixtureproj';
    const projectRoot = join(forgeRoot, 'projects', projectArg);
    // The real authoring turnSpec's kindDir is "_authoring" (ADR-043 §1) —
    // hardcoded here (not re-derived from the descriptor we're about to
    // load), matching the established precedent set by the WI-1 test above.
    const sessionId = '2026-08-11T00-00-01-r422f4ata';
    const sessionDir = join(projectRoot, '_authoring', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    // awaiting-review is the real authoring turnSpec's ONE noop-step phase
    // (ADR-043 §1) — SDK-free, mirroring the WI-1 test's own established
    // no-mock-seam design.
    writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'awaiting-review', updated_at: new Date(0).toISOString() });
    assert.equal(
      readSessionStatus<{ phase: string }>(sessionDir)?.phase,
      'awaiting-review',
      'arrange: seeded status must start in awaiting-review',
    );

    const r = await withCwd(forgeRoot, () => run(['authoring', sessionId, '--project', projectArg], forgeRoot));
    assert.equal(r.exitCode, null, `a successful turn must not call process.exit — got exit(${r.exitCode}), stderr: ${r.err}`);

    const correctLogPath = join(forgeRoot, '_logs', `_authoring-${sessionId}`, 'events.jsonl');
    assert.ok(
      existsSync(correctLogPath),
      `expected the spine's event log at ${correctLogPath} (the "_<descriptor.id>-<sessionId>" convention every ` +
        'real consumer — forge-ui\'s session page, ui-bridge\'s spawnAgentTurn stderr sink, the 4 legacy runners — ' +
        `already uses) — its absence means interactive-runner.ts's cycleId still carries the "_interactive-" prefix ` +
        `(stdout: ${r.out}, stderr: ${r.err})`,
    );
    const contents = readFileSync(correctLogPath, 'utf8').trim();
    assert.ok(contents.length > 0, `${correctLogPath} exists but is empty`);

    const oldBuggyLogDir = join(forgeRoot, '_logs', `_interactive-authoring-${sessionId}`);
    assert.equal(
      existsSync(oldBuggyLogDir),
      false,
      `the OLD, buggy directory ${oldBuggyLogDir} must NOT exist — this is not just "the new directory is right", ` +
        'it also rules out a half-migration that writes into both the old and new locations',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// Kills the same wrong-implementation shapes as AT-a above, PLUS: a fix that
// special-cases the literal string "authoring" (e.g. `descriptor.id ===
// 'authoring' ? \`_${id}-${sid}\` : \`_interactive-${id}-${sid}\``) instead
// of fixing the general cycleId construction — this test uses a completely
// unrelated synthetic id (TURNSPEC_ONLY_ID) that shares no code path or
// string literal with "authoring", so a hardcoded special case would pass
// AT-a but fail this test outright.
test('R4-22 F4, AT-b: a SYNTHETIC turnSpec-only kind also writes its event log to _logs/_<id>-<sid>/, NOT _logs/_interactive-<id>-<sid>/ — proves the rule is generic, not hardcoded to "authoring"', async () => {
  const fx = setupTurnspecFixture();
  try {
    const descriptor = loadSessionKinds(fx.forgeRoot).find((d) => d.id === TURNSPEC_ONLY_ID);
    assert.ok(descriptor?.turnSpec, 'fixture precondition: descriptor must carry a turnSpec');

    const r = await withCwd(fx.forgeRoot, () => run([TURNSPEC_ONLY_ID, fx.sessionId, '--project', fx.projectArg], fx.forgeRoot));
    assert.equal(r.exitCode, null, `a successful turn must not call process.exit — got exit(${r.exitCode}), stderr: ${r.err}`);

    const correctLogPath = join(fx.forgeRoot, '_logs', `_${TURNSPEC_ONLY_ID}-${fx.sessionId}`, 'events.jsonl');
    assert.ok(
      existsSync(correctLogPath),
      `expected the spine's event log at ${correctLogPath} — its absence means the "_<descriptor.id>-<sessionId>" ` +
        `convention does not hold generically (stdout: ${r.out}, stderr: ${r.err})`,
    );
    assert.ok(readFileSync(correctLogPath, 'utf8').trim().length > 0, `${correctLogPath} exists but is empty`);

    const oldBuggyLogDir = join(fx.forgeRoot, '_logs', `_interactive-${TURNSPEC_ONLY_ID}-${fx.sessionId}`);
    assert.equal(existsSync(oldBuggyLogDir), false, `the OLD, buggy directory ${oldBuggyLogDir} must NOT exist`);
  } finally {
    rmSync(fx.forgeRoot, { recursive: true, force: true });
  }
});

// ===========================================================================
// forge-q1z (T3, acceptance test) — assertNoInteractiveRunnerSkillEvent must
// be SCOPED to a baseline snapshot taken before the invocation under test,
// not a blanket walk of every _logs/ dir that happens to exist on disk.
//
// THE DEFECT: the four AT-2 cases above call assertNoInteractiveRunnerSkillEvent
// with ROOT = the real repo root (legacy fast-fail paths never touch the
// filesystem, so there is nothing to isolate into a tmp fixture). After a
// `npm run ui:journey` run, the real repo's _logs/ accumulates leftover
// interactive-runner event dirs (gitignored scratch, never cleaned up
// between runs). The CURRENT (unscoped) assertNoInteractiveRunnerSkillEvent
// walks EVERY directory under _logs/ regardless of when it was written, so
// it trips over that pre-existing scratch and false-fails all four AT-2
// cases — a false red with no code regression behind it (CI stays green
// because CI's own _logs/ is always empty). See bead forge-q1z.
//
// THE FIX (landed separately by the implementer, NOT by this test): a
// baseline snapshot taken before the invocation under test, so the assertion
// only inspects (a) _logs/ directories that did NOT exist at snapshot time,
// and (b) the bytes APPENDED to an existing events.jsonl after its
// snapshotted length. Pre-existing scratch becomes invisible; anything
// written DURING the invocation is still fully caught.
//
// PINNED SEAM (no design freedom on names/arity — the implementer must land
// exactly this):
//
//   function snapshotLogs(forgeRoot: string): LogBaseline
//   function assertNoInteractiveRunnerSkillEvent(
//     forgeRoot: string,
//     baseline: LogBaseline,
//     msg: string,
//   ): void
//
// `LogBaseline` itself is opaque to callers — internally it must be able to
// answer, per `_logs/<dir>/events.jsonl`, both "did this directory exist at
// snapshot time" and "how many bytes had it already written", so the scoped
// assertion can skip pre-existing bytes while still inspecting appended
// bytes and brand-new directories in full.
//
// RED-NOW: neither `snapshotLogs` nor the 3-arg
// `assertNoInteractiveRunnerSkillEvent` exist at this SHA (the function
// above still takes exactly `(forgeRoot, msg)`) — this test calls the NEW
// contract directly, so the file does not typecheck as written, and running
// it hits a ReferenceError on the undefined `snapshotLogs` call before any
// assertion below is ever reached. That is the intentional RED this WI
// pins; see the T3 report for the captured tsc + node --test output.
// ===========================================================================

/** One real-shaped `start`/interactive-runner JSONL line, mirroring EXACTLY
 *  the event shape `findInteractiveRunnerStartEvent` above parses
 *  (`event_type:'start'`, `skill:'interactive-runner'`,
 *  `metadata:{session_id,session_kind,phase,step}`) — not a hand-waved
 *  stand-in shape. */
function fakeInteractiveRunnerStartLine(sessionId: string, sessionKind: string): string {
  return JSON.stringify({
    event_type: 'start',
    skill: 'interactive-runner',
    metadata: { session_id: sessionId, session_kind: sessionKind, phase: 'p1', step: 'noop' },
  });
}

test('forge-q1z: assertNoInteractiveRunnerSkillEvent is scoped to a baseline snapshot — pre-existing _logs/ scratch cannot false-fail it, but events written during the invocation (appended OR brand-new) still throw', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'q1z-scoped-logs-'));
  try {
    // --- arrange: PRE-EXISTING journey scratch, on disk BEFORE the baseline
    // is taken — mirrors a real repo _logs/ dir already carrying leftover
    // interactive-runner events from an earlier `ui:journey` run.
    const scratchDir = join(forgeRoot, '_logs', '_journeyscratch-preexisting');
    mkdirSync(scratchDir, { recursive: true });
    const scratchEventsPath = join(scratchDir, 'events.jsonl');
    writeFileSync(scratchEventsPath, fakeInteractiveRunnerStartLine('pre-existing-sid', 'pre-existing-kind') + '\n');

    // The baseline snapshot — taken exactly where the AT-2 loop must take
    // it: AFTER pre-existing scratch is already on disk, BEFORE the
    // invocation under test.
    const baseline = snapshotLogs(forgeRoot);

    // =========================================================================
    // Half 1 — the q1z fix: pre-existing scratch is invisible to the scoped
    // assertion. Kills the CURRENT (unscoped) implementation outright: it
    // walks every _logs/<dir>/events.jsonl regardless of write time, so it
    // would throw here on the pre-existing line planted above — exactly
    // forge-q1z's false-fail.
    // =========================================================================
    assert.doesNotThrow(
      () => assertNoInteractiveRunnerSkillEvent(forgeRoot, baseline, 'pre-existing scratch must not false-fail'),
      'a baseline taken after pre-existing _logs/ scratch already exists must make that scratch invisible to the scoped assertion',
    );

    // =========================================================================
    // Half 2 — positive control: the scoping must not neuter the assertion.
    // Two sub-cases, BOTH required — a wrong implementation can satisfy
    // either alone.
    // =========================================================================

    // 2a. Append a SECOND interactive-runner line to the SAME pre-existing
    // file, after the baseline. Kills a wrong implementation that scopes by
    // "is this _logs/<dir> new" alone (skip any directory that already
    // existed at snapshot time, wholesale) — that shape would pass 2b below
    // but silently miss a real event appended to an existing dir, which is
    // exactly what a second turn in an already-running session does.
    appendFileSync(scratchEventsPath, fakeInteractiveRunnerStartLine('appended-sid', 'appended-kind') + '\n');
    assert.throws(
      () => assertNoInteractiveRunnerSkillEvent(forgeRoot, baseline, 'appended event must still be caught'),
      /interactive-runner/,
      'bytes appended to a pre-existing events.jsonl AFTER the baseline snapshot must still be inspected and caught',
    );

    // 2b. A brand-new _logs/<dir> created after the baseline. Kills a wrong
    // implementation that only ever re-scans directories present at
    // snapshot time (an "existing dirs only" scope) — that shape would pass
    // 2a above but miss a directory freshly created during the invocation,
    // which is exactly what a NEW session's first turn does. Re-snapshots
    // on a fresh baseline so this sub-case is proven independently of 2a's
    // mutation.
    const baseline2 = snapshotLogs(forgeRoot);
    const newDir = join(forgeRoot, '_logs', '_brandnew-newlyspawned');
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, 'events.jsonl'), fakeInteractiveRunnerStartLine('new-sid', 'new-kind') + '\n');
    assert.throws(
      () => assertNoInteractiveRunnerSkillEvent(forgeRoot, baseline2, 'new dir event must still be caught'),
      /interactive-runner/,
      'a brand-new _logs/ directory created AFTER the baseline snapshot must still be fully inspected',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
