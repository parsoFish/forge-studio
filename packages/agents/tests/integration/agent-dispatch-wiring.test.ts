/**
 * `dispatchAgentRun` — the wiring, against a real filesystem.
 *
 * Two halves, both about what actually HAPPENS rather than what renders. The
 * first is the no-spawn seam: a dispatch goes through `runAgent`, is suppressed
 * under `FORGE_ARCHITECT_NO_SPAWN`, and an unsafe or empty runId is rejected
 * before any I/O. The second is R6-04-F2 round 3's WIRING proof — the dispatch
 * must DISCOVER `<logsRoot>/<runId>/materials/` on disk (derivable from runId,
 * no argv change) and thread the references into the prompt it builds, with
 * the mixed-directory, `.DS_Store`, only-no-kind, EACCES and ENOTDIR cases each
 * pinned to the exact event the run emits.
 *
 * It uses the `queryFn` test-injection seam plus a one-shot clone — the
 * spawn-capture technique `integration/run-agent-spawn-capture.test.ts`
 * already establishes as this codebase's way to capture a real spawn call
 * without a real SDK call, reused rather than reinvented. Materials are written
 * straight to disk, bypassing `stageMaterials`, because discovery must work
 * regardless of how they got there.
 *
 * SPLIT FROM `agent-dispatch.test.ts` (863 lines) along its declared seams;
 * the rendering half is `unit/agent-dispatch-prompt`, the boundary rejections
 * are `contract/agent-dispatch-resolve`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchAgentRun, buildStandaloneRunPrompt } from '../../agent-dispatch.ts';
import { listAgentDefinitions } from '../../studio/agent-registry.ts';
import { FORGE_ROOT } from '../../studio/derive.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import type { StreamQueryFn } from '../../pinned-sdk-query.ts';

const ROOT = FORGE_ROOT;
const SKILLS = join(ROOT, 'skills');

/** Read one shipped agent definition off the REAL roster. Duplicated into each
 *  part of this split rather than exported from a `.test.ts` — the precedent
 *  this package already set in `regression/failure-classifier.rate-limit.test.ts`:
 *  a test file that exports a helper becomes an import target and starts
 *  constraining what it may assert. Five lines is the cheaper side of that. */
function getDef(slug: string): AgentDefinition {
  const def = listAgentDefinitions(SKILLS).find((d) => d.slug === slug);
  assert.ok(def, `expected the ${slug} library fixture in the roster`);
  return def;
}

// ---------------------------------------------------------------------------
// dispatchAgentRun — wiring under the no-spawn seam (no real SDK spawn)
// ---------------------------------------------------------------------------

test('dispatchAgentRun: dispatches through runAgent; suppressed under FORGE_ARCHITECT_NO_SPAWN', async () => {
  const prior = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const logsRoot = mkdtempSync(join(tmpdir(), 'agent-dispatch-'));
  try {
    const runId = '_agent-project-scoped-review-test';
    const out = await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: SKILLS,
      runId,
      logsRoot,
      project: { name: 'gitpulse', repoPath: '/x/projects/gitpulse' },
      inputs: { northStar: 'audit drift' },
    });
    assert.equal(out.slug, 'project-scoped-review');
    assert.equal(out.runId, runId);
    assert.equal(out.result.suppressed, true);
    assert.equal(out.result.costUsd, 0);

    const events = readFileSync(join(logsRoot, runId, 'events.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(events[0]?.event_type, 'start');
    assert.equal(events[0]?.skill, 'project-scoped-review');
    assert.ok(
      events.some((e) => e.message === 'run-agent.spawn-suppressed'),
      'emits the spawn-suppressed event under the no-spawn seam',
    );
  } finally {
    if (prior === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = prior;
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

test('dispatchAgentRun: rejects an unsafe runId before any I/O', async () => {
  await assert.rejects(
    () => dispatchAgentRun({ slug: 'project-scoped-review', skillsDir: SKILLS, runId: '../escape' }),
    /unsafe runId/,
  );
});

test('dispatchAgentRun: rejects an empty runId', async () => {
  await assert.rejects(
    () => dispatchAgentRun({ slug: 'project-scoped-review', skillsDir: SKILLS, runId: '' }),
    /runId is required/,
  );
});

// ---------------------------------------------------------------------------
// R6-04-F2 ROUND 3 amendment 3 (continued) — WIRING proof: dispatchAgentRun
// must actually DISCOVER `<logsRoot>/<runId>/materials/` on disk (derivable
// from runId — no argv/opts change needed) and thread references into the
// prompt it builds. The pure buildStandaloneRunPrompt tests above prove the
// RENDERING contract; these prove the DISCOVERY actually happens for real,
// reading the real filesystem the same way the route's stageMaterials would
// have populated it.
//
// Uses the SAME `queryFn` test-injection seam + one-shot-clone technique
// orchestrator/run-agent-spawn-capture.test.ts already establishes as this
// codebase's correct way to capture a real spawn call without a real SDK
// call — reused here, not reinvented. Materials files are written directly
// to disk (bypassing stageMaterials entirely) since dispatchAgentRun's
// discovery must work regardless of how the materials got there — its job
// is reading `<logsRoot>/<runId>/materials/`, not staging it.
// ---------------------------------------------------------------------------

function withoutSpawnSuppressionEnv(): () => void {
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  return () => {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  };
}

function oneShotClone(def: AgentDefinition): AgentDefinition {
  return {
    ...def,
    runtime: { ...def.runtime, loopStrategy: 'one-shot' },
    budgets: { maxTurns: 25, maxBudgetUsd: 3.5 },
  };
}

function capturingQueryFn(captured: { value: { prompt: string; options: Record<string, unknown> } | null }): StreamQueryFn {
  return ((params: { prompt: string; options: Record<string, unknown> }) => {
    captured.value = { prompt: params.prompt, options: params.options };
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.01, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

test('dispatchAgentRun WIRING: discovers real staged materials on disk and threads their references (relative path + derived kind) into the real spawn prompt', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-materials-wiring-'));
  try {
    const runId = 'MATERIALS-WIRING-TEST';
    const logsRoot = join(dir, '_logs');
    const materialsDir = join(logsRoot, runId, 'materials');
    mkdirSync(materialsDir, { recursive: true });
    const photoMarker = 'PHOTO-BYTES-MUST-NEVER-REACH-THE-PROMPT';
    const notesMarker = 'NOTES-BYTES-MUST-NEVER-REACH-THE-PROMPT';
    writeFileSync(join(materialsDir, 'photo.png'), photoMarker);
    writeFileSync(join(materialsDir, 'notes.pdf'), notesMarker);

    const base = getDef('project-scoped-review');
    const captured: { value: { prompt: string; options: Record<string, unknown> } | null } = { value: null };

    await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: SKILLS,
      runId,
      logsRoot,
      loadDefs: () => [oneShotClone(base)],
      queryFn: capturingQueryFn(captured),
    });

    assert.ok(captured.value, 'queryFn must have been invoked — the dispatch must reach the real spawn call');
    const prompt = captured.value!.prompt;
    assert.match(prompt, /materials\/photo\.png/, 'expected a reference to the first staged material\'s relative path');
    assert.match(prompt, /images/, 'expected the first material\'s derived kind ("images")');
    assert.match(prompt, /materials\/notes\.pdf/, 'expected a reference to the second staged material\'s relative path');
    assert.match(prompt, /documents/, 'expected the second material\'s derived kind ("documents")');
    assert.doesNotMatch(prompt, new RegExp(photoMarker), 'the photo\'s raw bytes must never reach the prompt');
    assert.doesNotMatch(prompt, new RegExp(notesMarker), 'the notes file\'s raw bytes must never reach the prompt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  }
});

// R6-04-F2 ROUND 4 — dual-phase status, stated explicitly so a future reader
// doesn't need this conversation's context: this test is GREEN today (before
// discovery is implemented, an absent materials/ dir trivially produces the
// same output as "materials was never a concept"), and it MUST STAY GREEN
// after the implementer's work — that persistence across the before/after
// boundary is the entire point of it. If this test ever needs to be
// weakened or deleted to make discovery land, that is itself a signal the
// implementation broke every pre-existing, materials-less dispatch call
// site, not a reason to relax the test.
test('dispatchAgentRun WIRING: REGRESSION — a run with NO materials directory on disk at all produces a prompt identical to a run that never discovers any materials (no stray "## Materials" section, no crash on a missing directory)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-no-materials-wiring-'));
  try {
    const runId = 'NO-MATERIALS-WIRING-TEST';
    const logsRoot = join(dir, '_logs');
    // Deliberately do NOT create <logsRoot>/<runId>/materials/ at all — this
    // is the common case (every dispatch that predates this feature, and
    // every dispatch with no attached materials).
    const base = getDef('project-scoped-review');
    const captured: { value: { prompt: string; options: Record<string, unknown> } | null } = { value: null };

    await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: SKILLS,
      runId,
      logsRoot,
      loadDefs: () => [oneShotClone(base)],
      queryFn: capturingQueryFn(captured),
    });

    assert.ok(captured.value, 'queryFn must have been invoked');
    assert.doesNotMatch(captured.value!.prompt, /Materials \(data/i, 'no materials section when nothing was ever staged for this run');
    assert.equal(
      captured.value!.prompt,
      buildStandaloneRunPrompt(oneShotClone(base), {}),
      'must be byte-identical to the pure function\'s own no-materials output — proves discovery of an absent directory degrades to exactly the pre-existing behaviour, not an empty/stray section',
    );

    // ROUND 6 tightening — ENOENT (this ordinary, ubiquitous case) must stay
    // COMPLETELY SILENT: no "material-skipped" event (nothing was skipped,
    // nothing was even listed) and, sharper, no "materials-unreadable" event
    // either — ENOENT is not a failure, and reporting it would fire a
    // deviation event on nearly every dispatch that has ever run, training
    // the operator to ignore the channel. This is the contract's line in the
    // sand between "nothing to report" and "genuinely could not read".
    const raw = join(logsRoot, runId, 'events.jsonl');
    const rawText = existsSync(raw) ? readFileSync(raw, 'utf8') : '';
    assert.doesNotMatch(rawText, /agent-dispatch\.material-skipped/, 'ENOENT must never emit a per-file skip event — there was nothing to list');
    assert.doesNotMatch(rawText, /agent-dispatch\.materials-unreadable/, 'ENOENT must never emit the unreadable-directory event — an absent directory is the ordinary case, not a failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  }
});

// =============================================================================
// R6-04-F2 ROUND 5 — skip-and-REPORT ruling. Today `discoverStagedMaterials`
// silently `continue`s past any staged file whose extension derives no kind
// (dead code today — the route's own gate already required a valid kind
// before staging — but a future direct caller would have a file vanish from
// the agent's prompt with no signal anywhere). Ruling: skip, never fatal
// (a throw would turn a stray `.DS_Store`/editor swapfile into an outage for
// the whole run), but never silent either (this repo's standing rule).
//
// PLACEMENT NOTE: the PURE, direct tests against `discoverStagedMaterials`
// itself (its assumed `{materials, skipped}` return shape) live in the
// SIBLING file `orchestrator/agent-dispatch-materials-skip.test.ts`, not
// here — deliberately split out. That file's whole import goes RED as one
// unit if `discoverStagedMaterials` never becomes exported (an assumption
// this round makes, not given verbatim — see that file's own header for the
// full reasoning); keeping it separate means that speculative red cannot
// collateral-damage the 20+ already-passing tests in THIS file (rounds
// 1/3/4's work), which depend only on the already-exported
// `dispatchAgentRun`/`buildStandaloneRunPrompt`.
//
// Contract pinned in the wiring tests below:
//   - `dispatchAgentRun` emits one `log` event per skipped filename, message
//     PINNED EXACTLY as `agent-dispatch.material-skipped` (this repo's
//     established `<namespace>.<event>` convention — see
//     `run-agent.spawn-suppressed`, `dry-bridge.skip`, `dry-bridge.refuse` —
//     `agent-dispatch` is this module's own namespace). This exact string is
//     MY choice per the ruling's explicit delegation ("pick a namespaced
//     message and pin it exactly so the implementer can't guess a different
//     one") — if the review disagrees with this specific string, that's a
//     one-line amendment, not a design dispute.
//   - The run PROCEEDS regardless — a skip is a reported deviation, not a
//     failure.
//   - A skipped filename is a REFERENCE ONLY in the event log and must never
//     appear in the agent's prompt (it is explicitly not usable material).
//
// ROUND 6 addendum — `agent-dispatch.ts:160`'s bare `catch {}` conflates
// ENOENT (the ordinary case — no materials directory at all) with every
// OTHER errno (EACCES, ENOTDIR, ...: a materials directory plausibly exists
// and could not be read). Same defect shape the R2-09 guard round already
// paid for once (`lexists` swallowing EACCES/ENOTDIR into "definitively
// absent"). Ruling: ENOENT must stay completely silent (reporting the
// ordinary case would fire a deviation event on nearly every dispatch and
// train the operator to ignore the channel); any OTHER errno is a genuine,
// reportable failure. `dispatchAgentRun` emits a SECOND, distinct message —
// PINNED EXACTLY as `agent-dispatch.materials-unreadable` — carrying the
// errno code string, exactly once, when `discoverStagedMaterials`'s
// (assumed) `unreadable` field is set. The run still proceeds in this case
// too — reported, never fatal, mirroring the skip contract above.
// =============================================================================

const MATERIALS_UNREADABLE_MESSAGE = 'agent-dispatch.materials-unreadable';

const MATERIAL_SKIPPED_MESSAGE = 'agent-dispatch.material-skipped';

function eventsRaw(logsRoot: string, runId: string): string {
  return readFileSync(join(logsRoot, runId, 'events.jsonl'), 'utf8');
}

// ---- wiring: dispatchAgentRun end-to-end ------------------------------------

test('dispatchAgentRun WIRING: a mixed staged directory (one valid file, one no-kind file) — the prompt carries ONLY the valid one, the event log carries a skip record naming the no-kind one, and the run still completes', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-materials-skip-mixed-'));
  try {
    const runId = 'MATERIALS-SKIP-MIXED';
    const logsRoot = join(dir, '_logs');
    const materialsDir = join(logsRoot, runId, 'materials');
    mkdirSync(materialsDir, { recursive: true });
    writeFileSync(join(materialsDir, 'notes.md'), 'valid staged content');
    writeFileSync(join(materialsDir, 'stray.xyz'), 'this must never reach the prompt');

    const base = getDef('project-scoped-review');
    const captured: { value: { prompt: string; options: Record<string, unknown> } | null } = { value: null };

    await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: SKILLS,
      runId,
      logsRoot,
      loadDefs: () => [oneShotClone(base)],
      queryFn: capturingQueryFn(captured),
    });

    assert.ok(captured.value, 'the run must complete and reach the real spawn call — a skip is a reported deviation, not a failure');
    const prompt = captured.value!.prompt;
    assert.match(prompt, /materials\/notes\.md/, 'the valid material must still reach the prompt');
    assert.doesNotMatch(prompt, /stray\.xyz/, 'the no-kind, skipped file must NEVER appear in the prompt — it is explicitly not usable material');

    const raw = eventsRaw(logsRoot, runId);
    assert.match(raw, new RegExp(MATERIAL_SKIPPED_MESSAGE.replace('.', '\\.')), `expected the exact pinned message "${MATERIAL_SKIPPED_MESSAGE}" in the event log`);
    assert.match(raw, /stray\.xyz/, 'the skip record must name the skipped filename as a REFERENCE');
    const events = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const skipEvent = events.find((e) => e['message'] === MATERIAL_SKIPPED_MESSAGE);
    assert.ok(skipEvent, `expected a log event with message === "${MATERIAL_SKIPPED_MESSAGE}"`);
    assert.equal(skipEvent!['event_type'], 'log', 'the skip record must be a "log" event type, matching the run-agent.spawn-suppressed shape');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  }
});

test('dispatchAgentRun WIRING: ".DS_Store" alongside a valid material — skipped-and-reported, never fatal, never in the prompt (dedicated pin per the ruling: this is the real-operator-on-a-Mac case)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-materials-dsstore-'));
  try {
    const runId = 'MATERIALS-DSSTORE';
    const logsRoot = join(dir, '_logs');
    const materialsDir = join(logsRoot, runId, 'materials');
    mkdirSync(materialsDir, { recursive: true });
    writeFileSync(join(materialsDir, 'photo.png'), 'real image');
    writeFileSync(join(materialsDir, '.DS_Store'), 'macOS Finder metadata');

    const base = getDef('project-scoped-review');
    const captured: { value: { prompt: string; options: Record<string, unknown> } | null } = { value: null };

    await assert.doesNotReject(
      dispatchAgentRun({
        slug: 'project-scoped-review',
        skillsDir: SKILLS,
        runId,
        logsRoot,
        loadDefs: () => [oneShotClone(base)],
        queryFn: capturingQueryFn(captured),
      }),
      'a ".DS_Store" in the staged directory must never fail the whole dispatch',
    );

    assert.ok(captured.value, 'the run must still complete');
    assert.match(captured.value!.prompt, /materials\/photo\.png/);
    assert.doesNotMatch(captured.value!.prompt, /DS_Store/, '".DS_Store" must never appear in the prompt');
    assert.match(eventsRaw(logsRoot, runId), /DS_Store/, '".DS_Store" must appear as a reference in the event log — reported, not silently dropped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  }
});

test('dispatchAgentRun WIRING: a staged directory with ONLY no-kind files — the prompt is BYTE-IDENTICAL to the no-materials baseline (an empty "## Materials" section still counts as a behaviour change, exactly like the existing absent-directory anchor above), and every no-kind file is reported', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-materials-onlyunknown-'));
  try {
    const runId = 'MATERIALS-ONLY-UNKNOWN';
    const logsRoot = join(dir, '_logs');
    const materialsDir = join(logsRoot, runId, 'materials');
    mkdirSync(materialsDir, { recursive: true });
    writeFileSync(join(materialsDir, 'stray1.xyz'), 'a');
    writeFileSync(join(materialsDir, 'stray2.abc'), 'b');

    const base = getDef('project-scoped-review');
    const captured: { value: { prompt: string; options: Record<string, unknown> } | null } = { value: null };

    await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: SKILLS,
      runId,
      logsRoot,
      loadDefs: () => [oneShotClone(base)],
      queryFn: capturingQueryFn(captured),
    });

    assert.ok(captured.value);
    assert.equal(
      captured.value!.prompt,
      buildStandaloneRunPrompt(oneShotClone(base), {}),
      'a staged directory containing ONLY no-kind files must render BYTE-IDENTICAL to no materials at all — not an empty "## Materials" header, which would itself be a behaviour change to every dispatch',
    );

    const raw = eventsRaw(logsRoot, runId);
    assert.match(raw, /stray1\.xyz/, 'every no-kind file must still be reported — none silently vanish');
    assert.match(raw, /stray2\.abc/, 'every no-kind file must still be reported — none silently vanish');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  }
});

/** Local twin of the sibling file's `eaccesUnenforceable` helper (small,
 *  deliberate duplication across test files — matches this file's own
 *  existing convention of re-declaring `withoutSpawnSuppressionEnv`/
 *  `capturingQueryFn`/`oneShotClone` rather than importing test-only helpers
 *  across files). True when mode-000 cannot be trusted to deny access in
 *  this environment (root, or a permission-transparent filesystem). */
function eaccesUnenforceableHere(dir: string): boolean {
  const probe = join(dir, `eacces-probe-${process.pid}`);
  mkdirSync(probe, { recursive: true });
  try {
    chmodSync(probe, 0o000);
    try {
      readFileSync(join(probe, 'anything'));
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code !== 'EACCES';
    }
  } finally {
    chmodSync(probe, 0o700);
    rmSync(probe, { recursive: true, force: true });
  }
}

test('dispatchAgentRun WIRING: EACCES — an unreadable materials directory does not crash the dispatch, contributes no materials to the prompt, and emits the EXACT pinned "agent-dispatch.materials-unreadable" event carrying the errno — TIGHTENED from round 5\'s baseline-contrast-only pin now that the message is specified. Gracefully SKIPPED when mode-000 is unenforceable in this environment (root, etc.) rather than left to pass/fail for the wrong reason', async (t) => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-materials-unreadable-'));
  try {
    if (eaccesUnenforceableHere(dir)) {
      t.skip('this process/filesystem does not enforce mode-000 (running as root, or a permission-transparent filesystem) — EACCES cannot be genuinely produced here');
      return;
    }

    const logsRoot = join(dir, '_logs');
    const runId = 'MATERIALS-UNREADABLE';
    const materialsDir = join(logsRoot, runId, 'materials');
    const base = getDef('project-scoped-review');

    mkdirSync(materialsDir, { recursive: true });
    chmodSync(materialsDir, 0o000);
    try {
      const captured: { value: { prompt: string; options: Record<string, unknown> } | null } = { value: null };

      await assert.doesNotReject(
        dispatchAgentRun({
          slug: 'project-scoped-review',
          skillsDir: SKILLS,
          runId,
          logsRoot,
          loadDefs: () => [oneShotClone(base)],
          queryFn: capturingQueryFn(captured),
        }),
        'an unreadable materials directory must never fail the whole dispatch',
      );

      assert.ok(captured.value, 'the run must still complete');
      assert.doesNotMatch(captured.value!.prompt, /Materials \(data/i, 'no materials can be read, so none may be rendered');

      const raw = eventsRaw(logsRoot, runId);
      assert.match(raw, new RegExp(MATERIALS_UNREADABLE_MESSAGE.replace(/\./g, '\\.')), `expected the exact pinned message "${MATERIALS_UNREADABLE_MESSAGE}"`);
      assert.match(raw, /EACCES/, 'the event must carry the exact errno code');
      assert.doesNotMatch(raw, /agent-dispatch\.material-skipped/, 'a directory read failure is not a per-FILENAME skip — nothing could even be listed, so the OTHER message must not fire');

      const events = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
      const unreadableEvent = events.find((e) => e['message'] === MATERIALS_UNREADABLE_MESSAGE);
      assert.ok(unreadableEvent, `expected a log event with message === "${MATERIALS_UNREADABLE_MESSAGE}"`);
      assert.equal(unreadableEvent!['event_type'], 'log');
    } finally {
      // Restore permissions BEFORE rmSync — rmSync(recursive) cannot descend
      // into or remove a mode-000 directory as a non-root user, and leaving
      // one behind leaks into /tmp for every later cleanup that touches it
      // (mirrors cli/studio-path-guard.test.ts's own established pattern).
      chmodSync(materialsDir, 0o700);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  }
});

test('dispatchAgentRun WIRING: ENOTDIR — a regular FILE occupies the materials/ path — does not crash the dispatch, contributes no materials to the prompt, and emits "agent-dispatch.materials-unreadable" carrying "ENOTDIR"', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'agent-dispatch-materials-enotdir-'));
  try {
    const logsRoot = join(dir, '_logs');
    const runId = 'MATERIALS-ENOTDIR';
    const runDir = join(logsRoot, runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'materials'), 'a regular file, not a directory, occupying the materials/ path');

    const base = getDef('project-scoped-review');
    const captured: { value: { prompt: string; options: Record<string, unknown> } | null } = { value: null };

    await assert.doesNotReject(
      dispatchAgentRun({
        slug: 'project-scoped-review',
        skillsDir: SKILLS,
        runId,
        logsRoot,
        loadDefs: () => [oneShotClone(base)],
        queryFn: capturingQueryFn(captured),
      }),
      'a file occupying the materials/ path must never fail the whole dispatch',
    );

    assert.ok(captured.value, 'the run must still complete');
    assert.doesNotMatch(captured.value!.prompt, /Materials \(data/i, 'no materials can be read, so none may be rendered');

    const raw = eventsRaw(logsRoot, runId);
    assert.match(raw, new RegExp(MATERIALS_UNREADABLE_MESSAGE.replace(/\./g, '\\.')), `expected the exact pinned message "${MATERIALS_UNREADABLE_MESSAGE}"`);
    assert.match(raw, /ENOTDIR/, 'the event must carry the exact errno code');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  }
});
