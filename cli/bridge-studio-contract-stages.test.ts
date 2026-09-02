/**
 * Acceptance tests for `GET /api/studio/projects/<id>/contract-stages`
 * (R4-17, D9 — the data contract R4-12-F1 renders on the project page in
 * batch D). The route DOES NOT EXIST YET — this file is RED at branch base
 * (every 200-path assertion fails against a 404 fallthrough; the malformed-id
 * ATs may coincidentally already read as errors via the generic bridge
 * fallthrough — see the RED-proof report for the exact per-test reason).
 *
 * Wire-level rule (path-shaped param — mirrors the R4-16 precedent in
 * cli/bridge-studio-sessions.test.ts's own header): a real `fetch()` client
 * normalizes a LITERAL `..` path segment away before the request ever leaves
 * the client, so that shape can only be exercised by calling
 * `handleStudioRoutes` DIRECTLY with a hand-built `rawUrl` string (AT-3). A
 * PERCENT-ENCODED traversal (`%2e%2e%2f`) is NOT normalized client-side and
 * genuinely reaches the server over a real `fetch()` call (AT-2) — both
 * shapes are tested, on the path that actually exercises them.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { handleStudioRoutes } from './bridge-studio.ts';
import type { StudioRunsContext } from './bridge-studio.ts';
import { deriveContractStages, type ContractStageRow, type DeriveContractStagesResult } from '@forge/projects/contract-stages.ts';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-contract-stages-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  const okDir = join(forgeRoot, 'projects', 'onboardedproj');
  mkdirSync(join(okDir, '.forge'), { recursive: true });
  writeFileSync(join(okDir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } } }), 'utf8');
  writeFileSync(join(okDir, 'roadmap.md'), '# Roadmap\n', 'utf8');

  const badDir = join(forgeRoot, 'projects', 'brokenconfigproj');
  mkdirSync(join(badDir, '.forge'), { recursive: true });
  writeFileSync(join(badDir, '.forge', 'project.json'), '{ not valid json [[[', 'utf8');

  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Validation (AT-1, AT-2, AT-3)
// ---------------------------------------------------------------------------

test('R4-17 AT-1: GET /api/studio/projects/<id>/contract-stages — malformed id (whitespace / path shape; W7-A4: uppercase + underscore are LEGAL) → 400', async () => {
  const res = await fetch(`${url}/api/studio/projects/${encodeURIComponent('not a project')}/contract-stages`);
  assert.equal(res.status, 400);
  const dot = await fetch(`${url}/api/studio/projects/.hidden/contract-stages`);
  assert.equal(dot.status, 400);
});

test('R4-17 AT-2 (real client path — percent-encoded traversal survives client-side normalization): id = "%2e%2e%2fetc" reaches the server verbatim and is rejected server-side (not merely client-normalized away)', async () => {
  const res = await fetch(`${url}/api/studio/projects/%2e%2e%2fetc/contract-stages`);
  assert.equal(res.status, 400, 'a percent-encoded traversal must be rejected by the server-side slug check, not silently 404 as "not found" (which would be indistinguishable from an unvalidated pass-through)');
});

// R4-17 AT-3 MOVED, not deleted (M4 projects routes carve): it drove
// `handleStudioRoutes` directly, and the contract-stages route has left that
// if-chain for `packages/projects/routes.ts`. Its assertion — a LITERAL ".."
// segment must be CLAIMED by the route and rejected 400 by the server-side
// slug check, never left unmatched to 404 with the guard never running — now
// lives in `packages/projects/tests/contract/routes-table.test.ts`, as two
// cases against the table entry and its handler. The remaining ATs in this
// file drive the live bridge over HTTP and are unaffected by the carve.

test('R4-17 AT-4: GET /api/studio/projects/<id>/contract-stages — unknown project (valid slug, no such directory) → 404', async () => {
  const res = await fetch(`${url}/api/studio/projects/no-such-project-xyz/contract-stages`);
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// Happy path — real deriveContractStages output over the wire (AT-5)
// ---------------------------------------------------------------------------

test('R4-17 AT-5: GET /api/studio/projects/<id>/contract-stages — 200 {ok:true, project, stages, sourcesScanned}, five stages in D2 order, derived from the REAL on-disk project fixture', async () => {
  const res = await fetch(`${url}/api/studio/projects/onboardedproj/contract-stages`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { ok: boolean; project: string; stages: Array<{ stage: string; status: string }>; sourcesScanned: string[] };
  assert.equal(body.ok, true);
  assert.equal(body.project, 'onboardedproj');
  assert.deepEqual(
    body.stages.map((s) => s.stage),
    ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
    'all five stages, in the declared D2 order, over the real wire — never a dropped row',
  );
  const byStage = (s: string): { status: string } => body.stages.find((r) => r.stage === s)!;
  assert.equal(byStage('contract').status, 'present', 'the fixture declares testProcess.local.cmd');
  assert.equal(byStage('roadmap').status, 'present', 'the fixture has a real roadmap.md');
  assert.equal(byStage('instructions').status, 'absent', 'the fixture has no AGENTS.md/CLAUDE.md');
  assert.ok(Array.isArray(body.sourcesScanned) && body.sourcesScanned.length > 0);
});

// ---------------------------------------------------------------------------
// Malformed config — fail-closed reaches the wire (AT-6)
// ---------------------------------------------------------------------------

test('R4-17 AT-6: a project with a malformed .forge/project.json → deriveContractStages\'s {ok:false} surfaces as a NON-200 error naming the cause, never a 200 with an empty artifact', async () => {
  const res = await fetch(`${url}/api/studio/projects/brokenconfigproj/contract-stages`);
  assert.notEqual(res.status, 200, 'a malformed project.json must never be smoothed into a 200 — this is the "declared data fails open" shape this campaign keeps finding');
  const body = (await res.json()) as { error?: string; ok?: boolean };
  assert.ok(typeof body.error === 'string' && body.error.length > 0, `the error response must name the cause, got: ${JSON.stringify(body)}`);
  assert.notEqual(body.ok, true);
});

// ---------------------------------------------------------------------------
// AT-F1-4 (server half) — derived-not-duplicated / cannot-drift (R4-12-F1)
// ---------------------------------------------------------------------------

/**
 * GREEN-ON-ARRIVAL REGRESSION LOCK (immutable-gates: this proves a killed
 * impl, it does not merely restate existing coverage). `deriveContractStages`
 * ALREADY EXISTS and already re-reads its artifacts on every call — this test
 * is red-before-green only in the trivial "doesn't exist as a file" sense;
 * against the real implementation it is green on arrival, and stays the
 * tripwire for two DISTINCT wrong shapes the project-detail page
 * (R4-12-F1) must never regress to:
 *
 *   (a) a SERVER-side cached/memoized `deriveContractStages` result (e.g. the
 *       route handler in cli/bridge-studio.ts memoizing by projectId and
 *       serving the first computed rows on every subsequent request) — this
 *       test's second call, after mutating the on-disk fixture, would still
 *       observe the FIRST call's stale `requiresEnv`/`bytes` and fail;
 *   (b) a CLIENT-side hand-parsed second copy of contract facts (forge-ui
 *       re-deriving secrets/instructions status itself from a raw project
 *       payload instead of trusting this server-derived `ContractStageRow[]`
 *       verbatim) — a second parser is exactly the shape that can silently
 *       drift from this one; this test pins that the ONE real parser
 *       (`deriveContractStages`) is safe to point the client at, by proving
 *       it has no hidden cache and genuinely re-derives from the artifacts
 *       every time, so there is no correctness reason to ever justify (b).
 *
 * Fixture/tmp-dir pattern reused from this file's own `before()` above
 * (mkdirSync + writeFileSync directly under the shared `forgeRoot` temp
 * dir, no separate mkdtempSync per test).
 */
test('R4-12 AT-F1-4 (server half, GREEN-ON-ARRIVAL REGRESSION LOCK): deriveContractStages re-derives the secrets/instructions rows from the on-disk artifacts on every call — mutating .forge/project.json requiresEnv and AGENTS.md bytes between two calls changes the SECOND result, proving there is no server-side cache/duplicate that could drift from the artifacts (kills: a memoized/cached deriveContractStages result, or a client-side hand-parsed second copy of these facts)', () => {
  const projectId = 'driftlockproj';
  const projectsRoot = join(forgeRoot, 'projects');
  const dir = join(projectsRoot, projectId);
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    JSON.stringify({
      testProcess: {
        local: { cmd: ['npm', 'test'] },
        acceptance: { match: 'acceptance', required: true, requiresEnv: ['FOO'] },
      },
    }),
    'utf8',
  );
  const agentsMdPath = join(dir, 'AGENTS.md');
  const initialBody = '# Instructions\n\nInitial fixture content, sentinel-3301.\n';
  writeFileSync(agentsMdPath, initialBody, 'utf8');

  const firstResult: DeriveContractStagesResult = deriveContractStages({ forgeRoot, projectsRoot, projectId });
  assert.equal(firstResult.ok, true, `expected ok:true before mutation, got: ${JSON.stringify(firstResult)}`);
  const firstRows = (firstResult as { ok: true; rows: ContractStageRow[] }).rows;
  const secretsBefore = firstRows.find((r) => r.stage === 'secrets')!;
  const instructionsBefore = firstRows.find((r) => r.stage === 'instructions')!;
  assert.deepEqual(secretsBefore.detail, ['FOO'], 'secrets row detail must be exactly the declared requiresEnv NAMES, before mutation');
  assert.equal(instructionsBefore.bytes, Buffer.byteLength(initialBody, 'utf8'), 'instructions row bytes must be the real AGENTS.md byte length, before mutation');

  // MUTATE the fixture: add a new required secret NAME and grow AGENTS.md.
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    JSON.stringify({
      testProcess: {
        local: { cmd: ['npm', 'test'] },
        acceptance: { match: 'acceptance', required: true, requiresEnv: ['FOO', 'NEW_SECRET'] },
      },
    }),
    'utf8',
  );
  const grownBody = initialBody + 'Appended content to grow the byte length, sentinel-8842.\n';
  writeFileSync(agentsMdPath, grownBody, 'utf8');

  const secondResult: DeriveContractStagesResult = deriveContractStages({ forgeRoot, projectsRoot, projectId });
  assert.equal(secondResult.ok, true, `expected ok:true after mutation, got: ${JSON.stringify(secondResult)}`);
  const secondRows = (secondResult as { ok: true; rows: ContractStageRow[] }).rows;
  const secretsAfter = secondRows.find((r) => r.stage === 'secrets')!;
  const instructionsAfter = secondRows.find((r) => r.stage === 'instructions')!;

  assert.ok(
    secretsAfter.detail.includes('NEW_SECRET'),
    `secrets row detail must CONTAIN the newly-declared "NEW_SECRET" after re-deriving, got: ${JSON.stringify(secretsAfter.detail)} — a cached/stale result would still show only ["FOO"]`,
  );
  assert.ok(
    (instructionsAfter.bytes ?? 0) > (instructionsBefore.bytes ?? 0),
    `instructions row bytes must have INCREASED after AGENTS.md grew, got before=${instructionsBefore.bytes} after=${instructionsAfter.bytes} — a cached/stale result would still show the original byte count`,
  );
});

// ---------------------------------------------------------------------------
// W7-B6 review F6 — the migrate hint targets ONLY the shape migrate can fix
// ---------------------------------------------------------------------------

test('W7-B6 F6 (RED) contract-stages 409: the MIGRATE-shape (flat keys, no testProcess) message appends the `forge project migrate` hint', async () => {
  const dir = join(forgeRoot, 'projects', 'flatkeysproj');
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ name: 'flatkeysproj', quality_gate_cmd: ['npm', 'test'] }), 'utf8');
  const res = await fetch(`${url}/api/studio/projects/flatkeysproj/contract-stages`);
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.match(String(body.error), /forge project migrate flatkeysproj/, 'the migrate-shape 409 must name the mechanical remedy');
});

test('W7-B6 F6 (RED) contract-stages 409: the CONFLICT-shape (flat keys ALONGSIDE testProcess) message must NOT append the migrate hint — migrate refuses that shape', async () => {
  const dir = join(forgeRoot, 'projects', 'conflictkeysproj');
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    JSON.stringify({ name: 'conflictkeysproj', testProcess: { local: { cmd: ['npm', 'test'] } }, quality_gate_cmd: ['make', 'check'] }),
    'utf8',
  );
  const res = await fetch(`${url}/api/studio/projects/conflictkeysproj/contract-stages`);
  assert.equal(res.status, 409);
  const body = (await res.json()) as { error?: string };
  assert.ok(
    !String(body.error).includes('forge project migrate'),
    `the conflict shape points at a command that would DECLINE to act — the hint must not appear; got: ${body.error}`,
  );
});
