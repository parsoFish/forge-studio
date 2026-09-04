/**
 * Where a turnSpec run's PATHS resolve — the projects root, and the event-log
 * directory.
 *
 * Two clusters that are the same question asked twice. **R4-21 phase 2** — the
 * REAL checked-in `studio/session-kinds.yaml` "authoring" row drives the fork
 * through the real CLI entry point (copied byte-for-byte into an isolated tmp
 * forgeRoot, never read from the live worktree at test time, so a typo the
 * implementer introduces in the real file is caught HERE and not only in
 * session-kinds' structural pins); then correction B: the projects root comes
 * from `forge.config.json`'s `projectsDir` via `resolveProjectsDir`, and from
 * `FORGE_PROJECTS_DIR` when that is set, never from a hardcoded
 * `<cwd>/projects` — with AT-B3 as the regression pin that `--project` still
 * rides as its own guarded segment under a reconfigured root, so `..`, an
 * absolute path and a `/`-bearing name are all still refused.
 *
 * **R4-22 F4** — the event log lands in `_logs/_<descriptor.id>-<sessionId>`,
 * NOT `_logs/_interactive-<id>-<sessionId>`. The extra prefix split one real
 * authoring turn's stderr from its own events across two directories, and the
 * live UI panel — which derives `_${kind}-${sessionId}` — saw neither. AT-a
 * pins it for the real "authoring" id and AT-b for a synthetic one, which is
 * what proves the rule is generic rather than hardcoded to a name.
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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AGENT_RUNNERS } from '../../agent-run.ts';
import { loadSessionKinds } from '@forge/sessions/studio/session-kinds.ts';
import { writeSessionStatus, readSessionStatus } from '@forge/sessions/interactive-session.ts';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import {
  run,
  withCwd,
  TURNSPEC_ONLY_ID,
  KIND_DIR,
  FIXTURE_SESSION_KINDS_YAML,
  setupTurnspecFixture,
  findInteractiveRunnerStartEvent,
  snapshotLogs,
  assertNoInteractiveRunnerSkillEvent,
  type TurnspecFixture,
} from '../test-fixtures/interactive-runner-log-observer.ts';

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
  const repoRoot = FORGE_ROOT;
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
// does): `runTurnSpecAgent` (packages/agents/agent-run.ts) resolves the projects root
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
//   - apps/studio/app/sessions/[kind]/[sessionId]/page.tsx:158,
//     `cycleId = \`_${kind}-${sessionId}\``, handed to useCycleEvents;
//   - apps/forge/ui-bridge.ts's spawnAgentTurn (~L2044-2062) writes a turn's
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
  const repoRoot = FORGE_ROOT;
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
