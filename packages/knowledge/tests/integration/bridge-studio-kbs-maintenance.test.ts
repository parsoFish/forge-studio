/**
 * Integration tests for `POST /api/studio/kbs/:id/maintenance` and the consolidate run.
 *
 * lint · fix-auto · fix-agent · index · consolidate, the reattach GET, and the write/count isolation a consolidate must hold. `drainConsolidate` lives here because only this file dispatches a run: it queues a no-op behind the run on `enqueueConsolidate`'s per-kbId chain, so the run's own completion is the signal and no assertion in this file depends on wall-clock time (known-flakes entry 2).
 *
 * Split out of `bridge-studio-kbs.test.ts` (1,306 lines) in M4: 19 of its 35
 * cases. Shared support lives in `./test-fixtures/bridge-studio-kbs.ts`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { IncomingMessage, ServerResponse } from 'node:http';

import { dispatchRoute } from '@forge/kernel';
import { knowledgeRoutes, type KnowledgeRouteContext } from '../../routes.ts';

import { enqueueConsolidate } from '../../bridge-studio-kb-consolidate.ts';

import {
  CONSOLIDATE_KB_ID,
  HEALTH_KB_ID,
  setupSharedForge,
  makeIsolatedForge,
  postAt,
  seedProjectBrain,
} from './test-fixtures/bridge-studio-kbs.ts';

let forgeRoot: string;

before(async () => {
  const shared = await setupSharedForge();
  forgeRoot = shared.root;
});

after(async () => {
  rmSync(forgeRoot, { recursive: true, force: true });
});

/**
 * `post`/`get`/`terminalState` drive the CARVED HANDLERS directly — no bridge
 * (COMMON §5: a package test never boots one). The `{status, json}` shape is
 * preserved so every assertion below is byte-for-byte what it was over HTTP.
 * Not tested here any more, deliberately: origin/CSRF/404-fallthrough — the
 * HOST's policy, tested in `cli/*.test.ts`.
 */
const routes = knowledgeRoutes({
  listFlowIds: () => ['forge-develop'],
  listFlowBandIds: () => ['review-band', 'demo-band'],
  // M4 ruling 86: the real fix turn is injected by the assembly, so route
  // tests declare one. It THROWS: no assertion in this file expects a fix turn
  // to be dispatched, and a stub that returned a plausible result would let a
  // future change dispatch one here unnoticed.
  runFixTurn: async () => {
    throw new Error('unexpected brain-fix dispatch in this test');
  },
});

const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

function mockRes(): { res: ServerResponse; captured: { status: number | null; body: string } } {
  const captured: { status: number | null; body: string } = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

async function drive(root: string, path: string, method: string, body: unknown = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const { res, captured } = mockRes();
  const ctx: KnowledgeRouteContext = {
    forgeRoot: root,
    logsRoot: join(root, '_logs'),
    readBody: async () => body,
  };
  const matched = await dispatchRoute(routes, mockReq(), res, ctx, path, method);
  if (!matched) return { status: 404, json: {} };
  return { status: captured.status ?? 0, json: JSON.parse(captured.body || '{}') as Record<string, unknown> };
}

async function post(path: string, body?: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  return drive(forgeRoot, path, 'POST', body ?? {});
}

async function get(path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return drive(forgeRoot, path, 'GET');
}

/** Wait for a dispatched consolidate to finish — deterministically.
 *
 *  The maintenance route enqueues the run on `enqueueConsolidate`'s per-kbId
 *  promise chain SYNCHRONOUSLY, before it sends its 200. Queuing a no-op behind
 *  it therefore resolves exactly when the dispatched run has finished. That
 *  replaces the two 60 s attempt-budget pollers this file used to carry, which
 *  asserted `state !== 'running'` against wall-clock time and went red under
 *  three-lane host load while the code under test was correct (known-flakes
 *  entry 2, sites :451 and :658). A budget is not a signal. */
async function drainConsolidate(kbId: string): Promise<void> {
  await enqueueConsolidate(kbId, async () => {});
}

/** The run's terminal state, read ONCE after `drainConsolidate` — never polled. */
async function terminalState(root: string, kbId: string, runId: string): Promise<Record<string, unknown>> {
  const { json } = await drive(root, `/api/studio/kbs/${kbId}/fix-agent/${runId}`, 'GET');
  return json;
}

// The Knowledge "Lint" button POSTs op=lint; the response MUST carry ok:true so
// the UI's studioPost (which gated success on data.ok) renders findings instead of
// "failed" (the reported bug — lint always showed failed despite running).
test('POST /api/studio/kbs/:id/maintenance op=lint → 200 ok:true with findings array', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/maintenance', { op: 'lint' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true, 'lint response must carry ok:true');
  assert.equal(json['op'], 'lint');
  assert.ok(Array.isArray(json['findings']), 'findings must be an array');
  assert.equal(typeof json['total'], 'number');
});

test('POST /api/studio/kbs/:id/maintenance op=index → 200 ok:true', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/maintenance', { op: 'index' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
});

test('POST /api/studio/kbs/:id/maintenance op=bogus → 400', async () => {
  const { status } = await post('/api/studio/kbs/cycles/maintenance', { op: 'bogus' });
  assert.equal(status, 400);
});

// Guided lint-resolution ops (Phase 2/3/4 bridge surface).
test('op=lint returns resolution counts', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/maintenance', { op: 'lint' });
  assert.equal(status, 200, JSON.stringify(json));
  const counts = json['counts'] as Record<string, number>;
  assert.ok(counts && typeof counts.auto === 'number' && typeof counts.agent === 'number' && typeof counts.user === 'number', 'counts present');
});

test('op=fix-auto returns the applied/skipped/remaining/counts shape', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/maintenance', { op: 'fix-auto' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
  assert.ok(Array.isArray(json['applied']), 'applied[]');
  assert.ok(Array.isArray(json['skipped']), 'skipped[]');
  assert.ok(Array.isArray(json['remaining']), 'remaining[]');
  assert.ok(json['counts'], 'counts');
});

test('op=fix-agent rejects a missing file (400)', async () => {
  const { status } = await post('/api/studio/kbs/cycles/maintenance', { op: 'fix-agent', check: 'checkSourceLinks', kind: 'links.broken' });
  assert.equal(status, 400);
});

test('op=fix-agent rejects a file outside brain/ (path-guard, 400)', async () => {
  const { status } = await post('/api/studio/kbs/cycles/maintenance', { op: 'fix-agent', file: '/etc/passwd', check: 'x', kind: 'y' });
  assert.equal(status, 400);
});

test('R5-01-F1: FORGE_DRY_BRIDGE=1 refuses op=fix-agent with the typed 409, no run dispatched', async () => {
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const { status, json } = await post('/api/studio/kbs/cycles/maintenance', {
      op: 'fix-agent', file: join(forgeRoot, 'brain', 'cycles', 'themes', 'test-theme.md'),
      check: 'checkSourceLinks', kind: 'links.broken',
    });
    assert.equal(status, 409, JSON.stringify(json));
    assert.deepEqual(json, {
      error: 'dry-bridge',
      route: '/api/studio/kbs/:id/maintenance (op=fix-agent)',
      method: 'POST',
      action: 'spawn-agent',
    });
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
});

test('GET fix-agent/:runId for an unknown run → running', async () => {
  const { status, json } = await get('/api/studio/kbs/cycles/fix-agent/nonexistent-run-123');
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['state'], 'running');
});

test('R1-06 WI-3 group A red-pin: POST maintenance op=consolidate is accepted (200 ok:true + runId) — RED today (op not in the allow-list)', async () => {
  // W7-B2: its OWN seeded KB — the mutating routes are mutually gated on the
  // per-KB active job now, and a completed consolidate here would clear
  // CONSOLIDATE_KB_ID's seeded findings before the ratchet test measures them.
  seedProjectBrain(forgeRoot, 'r1-06-redpin', ['rp-one']);
  const { status, json } = await post('/api/studio/kbs/r1-06-redpin/maintenance', { op: 'consolidate' });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
  assert.equal(json['ok'], true, JSON.stringify(json));
  assert.equal(typeof json['runId'], 'string', `expected a string runId, got ${JSON.stringify(json)}`);
  assert.ok((json['runId'] as string).length > 0, 'runId must be non-empty');
  // A BARRIER, not a check. This test's subject is that the route ACCEPTS the
  // op (200 / ok / runId); that the run reaches a terminal state is the NEXT
  // test's verdict, and asserting it twice is what put a 60 s wall-clock budget
  // on a test about a status code. The dispatched run must still finish before
  // `after()` removes the forge root under it, so it is drained and nothing is
  // asserted about it.
  await drainConsolidate('r1-06-redpin');
});

test('R1-06 WI-3 group A ratchet: op=consolidate drains the FULL scoped finding set to a terminal state — RED today', async () => {
  // Fixture precondition, asserted BEFORE any verdict: the 3 seeded themes
  // really do produce 3 independent checkProjectBrainIndexes findings.
  const baseline = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'lint' });
  assert.equal(baseline.status, 200, JSON.stringify(baseline.json));
  const baselineFindings = (baseline.json['findings'] as Array<{ check?: string }>).filter(
    (f) => f.check === 'checkProjectBrainIndexes',
  );
  assert.equal(
    baselineFindings.length,
    3,
    `fixture precondition failed: expected 3 seeded checkProjectBrainIndexes findings, got ${baselineFindings.length} — ${JSON.stringify(baselineFindings)}`,
  );

  // Dispatch consolidate — must accept the op and hand back an async run
  // handle (the fix-agent shape), not the synchronous fix-auto shape.
  const dispatch = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'consolidate' });
  assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
  assert.equal(dispatch.json['ok'], true, JSON.stringify(dispatch.json));
  const runId = dispatch.json['runId'];
  assert.equal(typeof runId, 'string', `expected a string runId, got ${JSON.stringify(dispatch.json)}`);

  // Poll the existing fix-agent poll shape until the consolidate run reaches
  // a terminal state — 'running' forever is a fail.
  await drainConsolidate(CONSOLIDATE_KB_ID);
  const terminal = await terminalState(forgeRoot, CONSOLIDATE_KB_ID, runId as string);
  assert.notEqual(terminal['state'], 'running', 'consolidate run never reached a terminal state');

  // The obligation ran over the FULL scoped finding set, not a single
  // finding: a follow-up lint must show every seeded finding cleared, not
  // just one (a shallow single-finding "consolidate" would leave some behind).
  const after = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'lint' });
  assert.equal(after.status, 200, JSON.stringify(after.json));
  const afterFindings = (after.json['findings'] as Array<{ check?: string }>).filter(
    (f) => f.check === 'checkProjectBrainIndexes',
  );
  assert.equal(
    afterFindings.length,
    0,
    `expected consolidate to clear the FULL scoped finding set (3 seeded), but ${afterFindings.length} remain — ${JSON.stringify(afterFindings)}`,
  );
});

test('R1-06 WI-3 group A companion: pre-existing single-finding lint-resolution tiers (lint/fix-auto/fix-agent) stay intact on the consolidate fixture KB', async () => {
  // op=lint — response shape unchanged.
  const lint = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'lint' });
  assert.equal(lint.status, 200, JSON.stringify(lint.json));
  assert.equal(lint.json['ok'], true, JSON.stringify(lint.json));
  assert.equal(lint.json['op'], 'lint');
  assert.ok(Array.isArray(lint.json['findings']), 'findings must be an array');
  const counts = lint.json['counts'] as Record<string, number>;
  assert.ok(
    counts && typeof counts.auto === 'number' && typeof counts.agent === 'number' && typeof counts.user === 'number',
    `counts must carry auto/agent/user tallies, got ${JSON.stringify(lint.json['counts'])}`,
  );

  // op=fix-auto — response shape unchanged (synchronous applied/skipped/remaining/counts).
  const fixAuto = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'fix-auto' });
  assert.equal(fixAuto.status, 200, JSON.stringify(fixAuto.json));
  assert.equal(fixAuto.json['ok'], true, JSON.stringify(fixAuto.json));
  assert.ok(Array.isArray(fixAuto.json['applied']), 'applied[]');
  assert.ok(Array.isArray(fixAuto.json['skipped']), 'skipped[]');
  assert.ok(Array.isArray(fixAuto.json['remaining']), 'remaining[]');
  assert.ok(fixAuto.json['counts'], 'counts');

  // op=fix-agent — still a single-finding dispatch: missing file/check/kind → 400.
  const missing = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, {
    op: 'fix-agent', check: 'checkProjectBrainIndexes', kind: 'index.project',
  });
  assert.equal(missing.status, 400, JSON.stringify(missing.json));

  // op=fix-agent — dry-bridge still refuses the single-finding dispatch with
  // the typed 409, no run dispatched (unaffected by consolidate's addition).
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const themeFile = join(forgeRoot, 'brain', 'projects', CONSOLIDATE_KB_ID, 'themes', 'theme-a.md');
    const dry = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, {
      op: 'fix-agent', file: themeFile, check: 'checkProjectBrainIndexes', kind: 'index.project',
    });
    assert.equal(dry.status, 409, JSON.stringify(dry.json));
    assert.equal(dry.json['error'], 'dry-bridge');
    assert.equal(dry.json['action'], 'spawn-agent');
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
});

test('W6-B14: GET .../consolidate/active on a kb that has never consolidated -> {ok:true, runId:null}, never a guess', async () => {
  // HEALTH_KB_ID (unlike CONSOLIDATE_KB_ID) is never dispatched through
  // op=consolidate anywhere else in this file — genuinely untouched.
  const { status, json } = await get(`/api/studio/kbs/${HEALTH_KB_ID}/consolidate/active`);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
  assert.equal(json['runId'], null);
});

test('W6-B14: GET .../consolidate/active rediscovers the runId of a just-dispatched consolidate run, and its state matches the SAME fix-agent GET the runId itself is pollable through', async () => {
  const dispatch = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'consolidate' });
  assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
  const runId = dispatch.json['runId'] as string;
  assert.equal(typeof runId, 'string');

  const active = await get(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/consolidate/active`);
  assert.equal(active.status, 200, JSON.stringify(active.json));
  assert.equal(active.json['ok'], true);
  assert.equal(active.json['runId'], runId, 'active discovery must rediscover the SAME runId the dispatch minted');

  // The rediscovered runId polls to a terminal state through the byte-
  // identical fix-agent route the consolidate ratchet test above already
  // proves — never a dead end.
  await drainConsolidate(CONSOLIDATE_KB_ID);
  const terminal = await terminalState(forgeRoot, CONSOLIDATE_KB_ID, runId);
  assert.notEqual(terminal['state'], 'running');
});

test('W6-B14: GET .../consolidate/active with an invalid (non-slug) kb id -> 400', async () => {
  const { status, json } = await get(`/api/studio/kbs/${encodeURIComponent('Not A Slug!')}/consolidate/active`);
  assert.equal(status, 400, JSON.stringify(json));
});

// ---------------------------------------------------------------------------
// R1-06 WI-3 review MAJOR 2 (cross-KB mutation / write-isolation): scopeFindingsToKb
// kept any finding whose path .includes(kbId) (substring). runBrainConsolidateNow
// turns that scope into WRITES (applyDeterministicConsolidateFixes). Two project
// brains "alpha" and "alpha-two": consolidating "alpha" matched alpha-two's
// findings too (its path contains "alpha") and appended a link line into
// brain/projects/alpha-two/patterns.md. The scope must be an EXACT resolved-dir
// match, never a substring — for BOTH the read (count) and write (consolidate).
//
// RED today: alpha-two/patterns.md is mutated by consolidating alpha.
// ---------------------------------------------------------------------------
test('R1-06 WI-3 MAJOR 2 red-pin: consolidating "alpha" leaves sibling "alpha-two" byte-unchanged — RED today', async () => {
  const iso = await makeIsolatedForge();
  try {
    seedProjectBrain(iso.root, 'alpha', ['a-one', 'a-two']);
    seedProjectBrain(iso.root, 'alpha-two', ['b-one']);
    const alphaTwoIndex = join(iso.root, 'brain', 'projects', 'alpha-two', 'patterns.md');

    // Fixture precondition (before any verdict): alpha-two's index does NOT yet
    // link its theme, so any cross-KB append is detectable, and alpha-two really
    // has its own unlisted-theme finding to be (wrongly) swept in.
    const before = readFileSync(alphaTwoIndex, 'utf8');
    assert.ok(!before.includes('b-one'), 'precondition: alpha-two index must not already link b-one');
    const lintTwoBefore = await postAt(iso.root, `/api/studio/kbs/alpha-two/maintenance`, { op: 'lint' });
    const twoFindingsBefore = (lintTwoBefore.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(twoFindingsBefore.length, 1, `precondition: alpha-two must have exactly 1 project-index finding, got ${twoFindingsBefore.length}`);

    // Dispatch consolidate for ALPHA only, drain to terminal.
    const dispatch = await postAt(iso.root, `/api/studio/kbs/alpha/maintenance`, { op: 'consolidate' });
    assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
    const runId = dispatch.json['runId'] as string;
    assert.equal(typeof runId, 'string', `expected runId, got ${JSON.stringify(dispatch.json)}`);
    await drainConsolidate('alpha');
    const terminal = await terminalState(iso.root, 'alpha', runId);
    assert.notEqual(terminal['state'], 'running', 'alpha consolidate never reached terminal');

    // Verdict 1 (write-isolation): alpha-two's index file is byte-identical.
    const after = readFileSync(alphaTwoIndex, 'utf8');
    assert.equal(after, before, 'consolidating "alpha" mutated sibling "alpha-two" patterns.md (substring cross-KB write)');

    // Verdict 2 (count-isolation): alpha-two still reports its own unlisted
    // finding — alpha's run must not have cleared it.
    const lintTwoAfter = await postAt(iso.root, `/api/studio/kbs/alpha-two/maintenance`, { op: 'lint' });
    const twoFindingsAfter = (lintTwoAfter.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(twoFindingsAfter.length, 1, `alpha's consolidate cleared alpha-two's finding (cross-KB), ${twoFindingsAfter.length} remain`);

    // Sanity: alpha's OWN findings did drain (the fix scopes, it does not disable).
    const lintAlphaAfter = await postAt(iso.root, `/api/studio/kbs/alpha/maintenance`, { op: 'lint' });
    const alphaFindingsAfter = (lintAlphaAfter.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(alphaFindingsAfter.length, 0, `alpha's own findings should be drained, ${alphaFindingsAfter.length} remain`);
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R1-06 WI-3 review MINOR 1 (poll-hang on throw): the pre-terminal repair phase
// (initial runBrainLint + applyDeterministicConsolidateFixes' ensureLinkedAt
// read/write) was unwrapped. When it throws (here: a category index that is a
// DIRECTORY, so readIndexEntries' readFileSync throws EISDIR), the run rejected
// before writeConsolidateTerminalEvent — readBrainFixState returns 'running'
// forever and the poll exhausts its budget. A single honest terminal must fire
// even on an unexpected throw.
//
// RED today: the run never leaves 'running'.
// ---------------------------------------------------------------------------
test('R1-06 WI-3 MINOR 1 red-pin: a consolidate whose repair phase throws still reaches a terminal state — RED today', async () => {
  const iso = await makeIsolatedForge();
  try {
    // patterns.md is a DIRECTORY → readIndexEntries' readFileSync throws EISDIR.
    seedProjectBrain(iso.root, 'throwkb', ['t-one'], { patternsAsDir: true });
    // Fixture precondition (before verdict): the index path really is a directory.
    assert.ok(
      existsSync(join(iso.root, 'brain', 'projects', 'throwkb', 'patterns.md')),
      'precondition: throwkb patterns.md (as a directory) must exist',
    );

    const dispatch = await postAt(iso.root, `/api/studio/kbs/throwkb/maintenance`, { op: 'consolidate' });
    assert.equal(dispatch.status, 200, `dispatch must be accepted async, got ${JSON.stringify(dispatch.json)}`);
    const runId = dispatch.json['runId'] as string;
    assert.equal(typeof runId, 'string', `expected runId, got ${JSON.stringify(dispatch.json)}`);

    // No budget at all. `enqueueConsolidate` swallows the run's own rejection
    // (its queue continuation must survive one), so the barrier still resolves
    // when the throwing run gives up — and the state read after it reports the
    // honest 'running' this pin exists to catch, instead of "not terminal
    // within N seconds", which is a claim about the host.
    await drainConsolidate('throwkb');
    const terminal = await terminalState(iso.root, 'throwkb', runId);
    assert.notEqual(
      terminal['state'],
      'running',
      'a consolidate whose repair phase threw never reached a terminal state — the poll hung to budget',
    );
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R1-06 WI-4 kb-maintain journey pin (dry-bridge consolidate refusal): the
// journey harness runs `forge studio` under FORGE_DRY_BRIDGE=1 (scripts/
// e2e-journey.mjs) — the seam that stops the bridge performing real
// spawn/merge/daemon side-effects. The consolidate route USED to refuse the
// WHOLE op under dry-bridge (`refuseDryBridge` → 409, action:'spawn-agent'),
// which killed the DETERMINISTIC in-process repair too: the exact same
// spawn-free category-index append op=fix-auto already performs under
// dry-bridge with no guard. So the kb-maintain beat saw consolidate 409
// (data-consolidate-state="error", never "cleared") and the seeded lint flag
// never dropped — a KB whose health legitimately reports a fixable flag could
// not be healed under the journey/CI env (declared-data-fails-open: health
// surfaces a finding the only fix path refuses to act on).
//
// runBrainConsolidateNow already treats isDryBridge() as `noSpawn`, so the ONLY
// thing dry-bridge must suppress — a real agent turn on the residual — is
// skipped there regardless. The route must therefore dispatch (not refuse), and
// the deterministic path clears the "not listed" finding in-process, terminal
// 'cleared', health back to 0.
//
// RED before fix: POST consolidate under FORGE_DRY_BRIDGE=1 returns 409
// (dry-bridge), so it never reaches a 'cleared' terminal and health stays 1.
// ---------------------------------------------------------------------------
test('R1-06 WI-4 kb-maintain pin: under FORGE_DRY_BRIDGE=1, consolidate still drives a real lint reduction (health 1 → cleared → 0) — RED before fix', async () => {
  const iso = await makeIsolatedForge();
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1'; // mirror the journey harness's bridge env
  try {
    // The exact journey fixture shape: a project-bound KB with ONE `pattern`
    // theme deliberately absent from its own patterns.md category index.
    seedProjectBrain(iso.root, 'drybridge-consolidate', ['scratch-maintain-lesson']);

    const health = async (): Promise<number> => {
      const { json } = await drive(iso.root, '/api/studio/kbs/drybridge-consolidate', 'GET');
      return (json['health'] as { lintFlags?: number } | undefined)?.lintFlags ?? -1;
    };

    // Fixture precondition, asserted BEFORE the verdict: health reflects the
    // fixable lint flag(s) even under dry-bridge (a pure read, never gated).
    // R6-08 4on: 2, not 1 — buildKbHealth now ALSO runs lintThemeFiles over
    // this KB's own theme file (F1 fix), and its checkIndexSync independently
    // rediscovers the same "theme not listed in patterns.md" defect
    // checkProjectBrainIndexes already flags — two distinct, both-real checks
    // on the one seeded theme, not a double-count of a single check.
    assert.equal(
      await health(),
      2,
      'precondition: health.lintFlags must be 2 for the seeded flagged KB (checkProjectBrainIndexes + checkIndexSync, R6-08 4on — under dry-bridge)',
    );
    // And op=lint (already dry-bridge-allowed) agrees the finding is real.
    const baseline = await postAt(iso.root, `/api/studio/kbs/drybridge-consolidate/maintenance`, { op: 'lint' });
    const baselineFindings = (baseline.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(baselineFindings.length, 1, `precondition: expected 1 seeded finding, got ${baselineFindings.length}`);

    // Verdict 1: consolidate is DISPATCHED under dry-bridge (RED: 409), handing
    // back the async run handle rather than refusing.
    const dispatch = await postAt(iso.root, `/api/studio/kbs/drybridge-consolidate/maintenance`, { op: 'consolidate' });
    assert.equal(
      dispatch.status,
      200,
      `consolidate must dispatch (200) under dry-bridge, not 409-refuse — got ${dispatch.status}: ${JSON.stringify(dispatch.json)}`,
    );
    assert.equal(dispatch.json['ok'], true, JSON.stringify(dispatch.json));
    const runId = dispatch.json['runId'];
    assert.equal(typeof runId, 'string', `expected a string runId, got ${JSON.stringify(dispatch.json)}`);

    // Verdict 2: the deterministic in-process path drains to a 'cleared'
    // terminal — no spawn, no SDK turn (the CI-safe shipped shape).
    await drainConsolidate('drybridge-consolidate');
    const terminal = await terminalState(iso.root, 'drybridge-consolidate', runId as string);
    assert.equal(
      terminal['state'],
      'cleared',
      `consolidate must reach a 'cleared' terminal under dry-bridge, got '${terminal['state']}'`,
    );

    // Verdict 3: the seeded finding is actually gone — follow-up lint 0 AND
    // health lintFlags back to 0 (the reduction the beat observes).
    const after = await postAt(iso.root, `/api/studio/kbs/drybridge-consolidate/maintenance`, { op: 'lint' });
    const afterFindings = (after.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(afterFindings.length, 0, `consolidate must clear the seeded finding, ${afterFindings.length} remain`);
    assert.equal(await health(), 0, 'health.lintFlags must drop to 0 after consolidate cleared the finding');
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('W8-F1 (knowledge-42): a consolidate over ZERO findings does not report "cleared" — and its counters reach the wire', async () => {
  // No themes ⇒ no findings at all ⇒ the run has nothing to clear.
  seedProjectBrain(forgeRoot, 'w8f1-noop-kb', []);
  const dispatch = await post('/api/studio/kbs/w8f1-noop-kb/maintenance', { op: 'consolidate' });
  assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
  const runId = dispatch.json['runId'] as string;

  await drainConsolidate('w8f1-noop-kb');
  const body = await terminalState(forgeRoot, 'w8f1-noop-kb', runId);
  assert.notEqual(body['state'], 'running', 'the zero-findings consolidate never reached a terminal state');
  assert.equal(
    body['cleared'],
    false,
    `a run that fixed nothing must not report cleared — got ${JSON.stringify(body)}`,
  );
  // The counters the event already carries must reach the surface, so the pill
  // can say "nothing to clear" instead of either lie ("cleared ✓" / "some
  // findings remain"). A field the wire drops is a field no UI can be honest
  // about — the declared-data-fails-open shape, in reverse.
  assert.equal(body['total'], 0, `the run's own finding count must be on the wire — got ${JSON.stringify(body)}`);
  assert.equal(body['clearedCount'], 0, `and its cleared count — got ${JSON.stringify(body)}`);
});
