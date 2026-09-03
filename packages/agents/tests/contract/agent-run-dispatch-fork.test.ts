/**
 * The dispatch FORK — AT-1..AT-7, R4-22 WI-5's acceptance tests.
 *
 * `cmdAgentRun` resolves an agent id against two dispatch tables and, failing
 * both, against the session-kind descriptors; a descriptor carrying a
 * `turnSpec` takes the generic interactive road. These pin that contract from
 * both sides. AT-1 the new road is REACHED and the call record asserted — not
 * merely "no error" — proven by the run's own real event-log artifact. AT-2
 * every bespoke dispatch id still fast-fails unchanged, over the UNION of
 * `AGENT_RUNNERS` and `SESSION_KIND_RUNNERS` plus a coverage test that fails
 * when a new dispatch id has no case (§15.77: a tripwire keyed on ONE table
 * stops watching whatever leaves that table). AT-3 the ordering pin — a
 * turnSpec id must not be rejected as "unknown agent-id" even without
 * `--project`. AT-4 the positive control, an id in neither place is still
 * refused, exit 2. AT-5 a descriptor WITHOUT a turnSpec keeps the bespoke road
 * even when its id is also a real session-kind id. AT-6 the argument-handling
 * contract for the new road. AT-7 the standing invariant over the REAL
 * checked-in `studio/session-kinds.yaml`.
 *
 * `contract/`, because AT-2's coverage test and AT-7 both enumerate a live
 * table and assert parity — what the bucket is for (tests/README.md).
 *
 * SPLIT FROM a 1,226-line file. Its 268-line shared block became a real
 * fixture module, `tests/test-fixtures/interactive-runner-log-observer.ts`,
 * because all four of its clusters used it and one of them tests the log
 * walker as its subject — three duplicated copies of a 162-line walker is the
 * signal that a seam is wrong, not a smaller file (T1 ruling 94). The three
 * parts are `contract/agent-run-dispatch-fork` (this file's siblings:
 * AT-1..AT-7), `integration/agent-run-turnspec-paths` (where a turnSpec run's
 * paths resolve) and `regression/agent-run-log-observer` (forge-q1z /
 * forge-1im). The split retires the file's `scripts/baselines/file-size.json`
 * row rather than re-keying it: a move cannot retire an exemption, only a
 * split can.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { AGENT_RUNNERS } from '../../agent-run.ts';
import { SESSION_KIND_RUNNERS } from '@forge/sessions/kinds/registry.ts';
import { loadSessionKinds } from '@forge/sessions/studio/session-kinds.ts';
import { readSessionStatus } from '@forge/sessions/interactive-session.ts';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import {
  run,
  withCwd,
  TURNSPEC_ONLY_ID,
  setupTurnspecFixture,
  findInteractiveRunnerStartEvent,
  snapshotLogs,
  assertNoInteractiveRunnerSkillEvent,
} from '../test-fixtures/interactive-runner-log-observer.ts';

const ROOT = FORGE_ROOT;

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
    assert.ok(!BESPOKE_DISPATCH_IDS.includes(TURNSPEC_ONLY_ID), 'fixture precondition: must NOT be a bespoke dispatch id in either table');
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
// AT-2 — bespoke road untouched, for all 4 bespoke dispatch ids.
// ---------------------------------------------------------------------------
// M4 ruling 60: a PORTED kind's row moves to `@forge/sessions/kinds/registry.ts`,
// so the preconditions below ask the UNION `cmdAgentRun` consults, not one half.
const BESPOKE_DISPATCH_IDS = [...Object.keys(AGENT_RUNNERS), ...Object.keys(SESSION_KIND_RUNNERS)];

// Kills: a fork that routes an id with turnSpec undefined/absent (every
// bespoke dispatch id today) through runInteractiveTurn anyway — proven two
// ways: (a) the printed error is the exact `entry.verb`-flavored bespoke text
// (runInteractiveTurn's own errors are never phrased this way — see its
// source, "runInteractiveTurn: ..." throughout), and (b) no event anywhere
// under `_logs/` carries `skill: 'interactive-runner'` — the marker ONLY
// runInteractiveTurn stamps (R4-22 F4 amendment: content-based, not a
// `_interactive-<id>-*` directory-name check, which stops discriminating the
// moment the spine's directory name collides with the bespoke runner's own).
const LEGACY_FAST_FAIL_CASES: { agentId: string; args: string[]; expected: RegExp }[] = [
  { agentId: 'instructions', args: ['instructions', 'some-session-id'], expected: /^forge instructions run: --project <name> is required$/m },
  { agentId: 'demo-builder', args: ['demo-builder', 'some-session-id'], expected: /^forge demo-builder run: --project <name> is required$/m },
  { agentId: 'project-brain', args: ['project-brain', 'some-session-id'], expected: /^Usage: forge project-brain run <session-id> --project <name>$/m },
  { agentId: 'architect', args: ['architect'], expected: /^forge architect run: missing <session-id>$/m },
];

for (const { agentId, args, expected } of LEGACY_FAST_FAIL_CASES) {
  test(`R4-22 WI-5, AT-2 (legacy road untouched): 'agent run ${agentId}' still hits the legacy AGENT_RUNNERS fast-fail text, never runInteractiveTurn`, async () => {
    assert.ok(BESPOKE_DISPATCH_IDS.includes(agentId), `fixture precondition: "${agentId}" must be a real dispatch id in either table`);
    const baseline = snapshotLogs(ROOT);
    const r = await run(args, ROOT);
    assert.equal(r.exitCode, 2, `expected exit 2, got stderr: ${r.err}`);
    assert.match(r.err, expected, `expected the legacy entry.verb-flavored text, got: ${r.err}`);
    assert.doesNotMatch(r.err, /runInteractiveTurn/, 'the legacy fast-fail path must never mention runInteractiveTurn');
    assertNoInteractiveRunnerSkillEvent(ROOT, baseline, `'agent run ${agentId}' must never create runInteractiveTurn's log artifact`);
  });
}

// Structural: a port that adds or renames a dispatch id cannot leave AT-2
// passing vacuously over a shrinking set (COMMON §15.70, one table over).
test('AT-2 coverage: every bespoke dispatch id has a fast-fail case', () => {
  assert.deepEqual(LEGACY_FAST_FAIL_CASES.map((c) => c.agentId).sort(), [...BESPOKE_DISPATCH_IDS].sort(),
    'each id in AGENT_RUNNERS + SESSION_KIND_RUNNERS needs its own AT-2 fast-fail case');
});

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
    assert.ok(!BESPOKE_DISPATCH_IDS.includes(TURNSPEC_ONLY_ID), 'fixture precondition: must NOT be a bespoke dispatch id in either table');

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
test('R4-22 WI-5, AT-5: a descriptor WITHOUT turnSpec ("architect" — a real dispatch id AND a real session-kind id) still takes the bespoke road', async () => {
  const fx = setupTurnspecFixture();
  try {
    const descriptor = loadSessionKinds(fx.forgeRoot).find((d) => d.id === 'architect');
    assert.equal(descriptor?.turnSpec, undefined, 'fixture precondition: this row must carry NO turnSpec');
    assert.ok(BESPOKE_DISPATCH_IDS.includes('architect'), 'fixture precondition: "architect" must be a real dispatch id in either table');

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
// bespoke lookup, so the moment a descriptor whose id COLLIDES with a bespoke
// runner key gains a `turnSpec`, that runner is silently bypassed. Three real
// ids collide today: `architect`, `instructions`, `project-brain` (`demo`
// deliberately does not — the yaml's id differs from the `demo-builder` key).
//
// M4 ruling 60: the collision set is `BESPOKE_DISPATCH_IDS`, the UNION of both
// dispatch tables. Reading `AGENT_RUNNERS` alone would drop each kind out of
// this tripwire at the exact moment it ports — the scanner that quietly stops
// reaching its call sites (COMMON §15.70), on the one test written to catch a
// silent routing change.
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
test('R4-22 WI-5, AT-7 (standing invariant): no bespoke dispatch id in the REAL session-kinds.yaml carries a turnSpec', () => {
  const repoRoot = FORGE_ROOT;
  const descriptors = loadSessionKinds(repoRoot);

  // Arrange-assert: prove the fixture premise before reading any verdict — if
  // the real yaml failed to load or the collision set were empty, this test
  // would pass vacuously and protect nothing.
  assert.ok(descriptors.length > 0, 'arrange: the real studio/session-kinds.yaml must load with at least one descriptor');
  const bespokeIds = BESPOKE_DISPATCH_IDS;
  assert.ok(bespokeIds.length > 0, 'arrange: the two dispatch tables must not both be empty');
  const colliding = descriptors.filter((d) => bespokeIds.includes(d.id));
  assert.ok(
    colliding.length > 0,
    `arrange: at least one descriptor id must collide with a bespoke dispatch id, else this invariant is vacuous ` +
      `(descriptor ids: ${descriptors.map((d) => d.id).join(', ')}; bespoke ids: ${bespokeIds.join(', ')})`,
  );

  const hijacked = colliding.filter((d) => d.turnSpec !== undefined).map((d) => d.id);
  assert.deepEqual(
    hijacked,
    [],
    `session-kind(s) ${hijacked.join(', ')} share an id with a bespoke dispatch row AND declare a turnSpec, so ` +
      `cmdAgentRun's fork now routes them to the generic spine and their bespoke runner is DEAD CODE. If this is a ` +
      `deliberate batch-E migration (ADR-043), that is fine — but it must be explicit: migrate the runner, retire its ` +
      `dispatch row, and update this invariant in the same PR. If you did not intend to change routing, remove ` +
      `the turnSpec. The golden-capture suite CANNOT catch this: it calls the four turn functions directly and never ` +
      `exercises the fork.`,
  );
});
