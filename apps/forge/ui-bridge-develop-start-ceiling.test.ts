/**
 * Acceptance tests for forge-shc WI-1 (develop-start cost-ceiling lever).
 *
 * T1 RULING binds scope: `POST /api/develop/start` accepts an optional
 * `costCeilingUsd?: number` body field ONLY when `initiativeIds.length===1`
 * (batch requests refuse it outright — the T1 batch-semantics ruling: a
 * single scalar override cannot map onto N manifests unambiguously). The
 * `FORGE_COST_CEILING_USD` env var's precedence over the manifest field is
 * pre-existing behaviour (`orchestrator/cycle.ts` `resolveCostCeilingOverride`)
 * and is UNCHANGED by this WI — this file does not touch env precedence, it
 * only pins that the route's new body field reaches the manifest at all.
 *
 * Mirrors the `apps/forge/ui-bridge-agent-run-ceiling.test.ts` harness conventions
 * (temp forgeRoot + real `startBridge`, CSRF header, assert-manifest-content
 * before trusting a response-shape proxy) and the sibling
 * `apps/forge/ui-bridge-develop-start.test.ts` fixture shape (`pendingManifest`,
 * `flow_id: forge-architect` + `specs` so `hasDecompositionEvidence` passes
 * and the enqueue doesn't short-circuit on `not-planned`).
 *
 * RUN COMMAND:
 *   node --experimental-strip-types --test apps/forge/ui-bridge-develop-start-ceiling.test.ts
 *
 * Route contract pinned:
 *   (1) A single-id batch with a valid `costCeilingUsd` stamps
 *       `cost_ceiling_usd` onto the initiative's manifest, such that
 *       `resolveCostCeilingOverride(manifestPath)` (orchestrator/cycle.ts)
 *       returns EXACTLY that value — not the `cost_budget_usd x (1 +
 *       DERIVED_CEILING_MARGIN_SHARE)` fallback a manifest with no explicit
 *       ceiling would derive — and reports `source: 'manifest'`, so a stopped
 *       run names the knob the operator actually set (bead 6.10.23).
 *   (2) An out-of-bounds / non-positive / non-finite `costCeilingUsd` → 400,
 *       BEFORE any side effect: the target manifest is never repointed at
 *       forge-develop (still `flow_id: forge-architect` on disk) and never
 *       stamped with `cost_ceiling_usd`.
 *   (3) `costCeilingUsd` supplied alongside `initiativeIds.length > 1` → 400,
 *       no enqueue, no stamp, for EVERY id in the batch (the T1 ruling).
 *   (4) COMPANION: a request with no `costCeilingUsd` at all behaves exactly
 *       as it does today — enqueue succeeds, no `cost_ceiling_usd` stamped.
 *       The lever is optional; this is not independently RED (today's route
 *       already passes it) — paired here with pin (1) as the negative twin
 *       proving the new field doesn't leak into the default path.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { resolveCostCeilingOverride } from '@forge/flows/cycle.ts';
import { MAX_KICKOFF_COST_CEILING_USD } from '@forge/kernel';
import { DERIVED_CEILING_MARGIN_SHARE, persistManifestCostCeiling } from '@forge/flows/manifest.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

function pendingManifest(id: string, costBudgetUsd: number): string {
  return `---
initiative_id: ${id}
project: test-project
project_repo_path: /tmp/test-project
created_at: 2026-08-09T10:00:00.000Z
iteration_budget: 5
cost_budget_usd: ${costBudgetUsd}
class: code
phase: pending
flow_id: forge-architect
specs:
  - WI-1
---

# ${id}
`;
}

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-develop-start-ceiling-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // Precedence env must not be ambient during this file's run, or pin (1)'s
  // "resolveCostCeilingOverride returns the manifest value" assertion would
  // be meaningless (env always wins regardless of what the route stamps).
  delete process.env.FORGE_COST_CEILING_USD;

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function manifestPathFor(id: string): string {
  // enqueueFlowRun always (re)writes to `_queue/pending/<id>.md`, including
  // when the source manifest was ALREADY in pending (as every fixture below
  // is) — so the fixture's write path IS the post-request read path.
  return join(forgeRoot, '_queue', 'pending', `${id}.md`);
}

// ---------------------------------------------------------------------------
// (1) RED pin — a single-id batch's costCeilingUsd must reach the manifest,
// readable back through the REAL consumer (resolveCostCeilingOverride), not
// just as a response-shape proxy.
// ---------------------------------------------------------------------------

test('POST /api/develop/start: single-id batch with costCeilingUsd stamps cost_ceiling_usd onto the manifest, and resolveCostCeilingOverride reads EXACTLY that value — not the cost_budget_usd+margin derived fallback', async () => {
  const id = 'INIT-2026-08-09-ceiling-stamp';
  const COST_BUDGET_USD = 2.0;
  const DERIVED_FALLBACK = COST_BUDGET_USD * (1 + DERIVED_CEILING_MARGIN_SHARE);
  const CEILING = 17; // deliberately far from the derived fallback (2.0 x 1.5 = 3)
  assert.notEqual(CEILING, DERIVED_FALLBACK, 'sanity: the two values must be distinguishable');

  const manifestPath = manifestPathFor(id);
  writeFileSync(manifestPath, pendingManifest(id, COST_BUDGET_USD));
  assertFixturePrecondition(manifestPath);

  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeIds: [id], costCeilingUsd: CEILING }),
  });
  assert.equal(res.status, 200, `expected the accepted-batch 200, got ${res.status}`);
  const body = (await res.json()) as { ok: boolean; results: Array<{ initiativeId: string; ok: boolean; status: string }> };
  assert.equal(body.ok, true);
  assert.equal(body.results[0]?.status, 'enqueued');

  // Assert the mutation actually applied (grep the mutated text) BEFORE
  // trusting any derived-value read — false-negative rule.
  const onDisk = readFileSync(manifestPath, 'utf8');
  assert.match(
    onDisk,
    /cost_ceiling_usd:\s*17(\.0+)?\s*$/m,
    `expected the manifest frontmatter to carry the stamped cost_ceiling_usd: 17 — the route currently reads only initiativeIds and silently drops costCeilingUsd. On-disk manifest:\n${onDisk}`,
  );

  const resolved = resolveCostCeilingOverride(manifestPath);
  assert.deepEqual(
    resolved,
    { ceilingUsd: CEILING, source: 'manifest' },
    `resolveCostCeilingOverride must read the stamped ceiling (${CEILING}) via the manifest's cost_ceiling_usd field and name it as the manifest's, not the derived cost_budget_usd x (1 + ${DERIVED_CEILING_MARGIN_SHARE}) fallback (${DERIVED_FALLBACK}) that a manifest with no explicit ceiling would resolve to — got ${JSON.stringify(resolved)}`,
  );
});

// ---------------------------------------------------------------------------
// (4) COMPANION (not independently RED) — paired with pin (1): the lever is
// optional. Today's route already behaves this way (it ignores costCeilingUsd
// entirely); this proves the field-plumbing fix in pin (1) must not make
// omission behave any differently.
// ---------------------------------------------------------------------------

test('COMPANION of pin (1): single-id batch WITHOUT costCeilingUsd ⇒ enqueues exactly as today, no cost_ceiling_usd stamped (the lever is optional)', async () => {
  const id = 'INIT-2026-08-09-ceiling-companion-optional';
  const manifestPath = manifestPathFor(id);
  writeFileSync(manifestPath, pendingManifest(id, 2.0));

  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeIds: [id] }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; results: Array<{ initiativeId: string; ok: boolean; status: string }> };
  assert.equal(body.ok, true);
  assert.equal(body.results[0]?.status, 'enqueued');

  const onDisk = readFileSync(manifestPath, 'utf8');
  assert.doesNotMatch(onDisk, /cost_ceiling_usd:/, 'no costCeilingUsd in the request must mean no cost_ceiling_usd stamped on the manifest');
});

// ---------------------------------------------------------------------------
// (2) RED pin — an invalid costCeilingUsd must refuse the WHOLE request
// (400) before any side effect: the manifest must never be repointed at
// forge-develop, and never stamped. Proven by reading the on-disk manifest,
// not by trusting the response status alone (the fixture precondition —
// flow_id: forge-architect — is itself asserted below before the request, so
// the "still forge-architect after" check is a real before/after diff, not a
// tautology on a value we never set).
// ---------------------------------------------------------------------------

function assertFixturePrecondition(manifestPath: string): void {
  const before = readFileSync(manifestPath, 'utf8');
  assert.match(before, /flow_id: forge-architect/, 'fixture precondition: manifest must start on forge-architect (unrepointed)');
  assert.doesNotMatch(before, /cost_ceiling_usd:/, 'fixture precondition: manifest must start with no cost_ceiling_usd stamped');
}

const INVALID_CEILING_CASES: Array<{ label: string; value: unknown }> = [
  { label: 'one unit over MAX_KICKOFF_COST_CEILING_USD', value: MAX_KICKOFF_COST_CEILING_USD + 1 },
  { label: 'zero', value: 0 },
  { label: 'negative', value: -5 },
  { label: 'non-finite (string "Infinity", the only wire-representable form)', value: 'Infinity' },
];

for (const { label, value } of INVALID_CEILING_CASES) {
  test(`POST /api/develop/start: invalid costCeilingUsd (${label}) on a single-id batch ⇒ 400 BEFORE any side effect — manifest never repointed to forge-develop, never stamped`, async () => {
    const id = `INIT-2026-08-09-ceiling-invalid-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const manifestPath = manifestPathFor(id);
    writeFileSync(manifestPath, pendingManifest(id, 2.0));
    assertFixturePrecondition(manifestPath);

    const res = await fetch(`${url}/api/develop/start`, {
      method: 'POST',
      headers: CSRF,
      body: JSON.stringify({ initiativeIds: [id], costCeilingUsd: value }),
    });
    assert.equal(res.status, 400, `expected 400 for invalid costCeilingUsd (${label}), got ${res.status}`);
    const body = (await res.json()) as { error?: string };
    assert.ok(body.error, 'a validation error is returned');

    const onDisk = readFileSync(manifestPath, 'utf8');
    assert.match(onDisk, /flow_id: forge-architect/, `${label}: manifest must remain on forge-architect — no enqueue side effect may occur on a refused request. On-disk:\n${onDisk}`);
    assert.doesNotMatch(onDisk, /cost_ceiling_usd:/, `${label}: manifest must not carry a stamped cost_ceiling_usd from a refused request. On-disk:\n${onDisk}`);
  });
}

// ---------------------------------------------------------------------------
// (3) RED pin — costCeilingUsd against a batch of MORE than one id must be
// refused outright (T1 batch-semantics ruling): a single scalar cannot map
// onto N manifests. No id in the batch may be enqueued.
// ---------------------------------------------------------------------------

test('POST /api/develop/start: costCeilingUsd supplied with initiativeIds.length>1 ⇒ 400, no enqueue, no stamp for ANY id in the batch (T1 batch-semantics ruling)', async () => {
  const idA = 'INIT-2026-08-09-ceiling-batch-a';
  const idB = 'INIT-2026-08-09-ceiling-batch-b';
  const pathA = manifestPathFor(idA);
  const pathB = manifestPathFor(idB);
  writeFileSync(pathA, pendingManifest(idA, 2.0));
  writeFileSync(pathB, pendingManifest(idB, 3.0));
  assertFixturePrecondition(pathA);
  assertFixturePrecondition(pathB);

  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeIds: [idA, idB], costCeilingUsd: 17 }),
  });
  assert.equal(res.status, 400, `expected 400 when costCeilingUsd accompanies a multi-id batch, got ${res.status}`);
  const body = (await res.json()) as { error?: string };
  assert.ok(body.error, 'a validation error is returned');

  const onDiskA = readFileSync(pathA, 'utf8');
  const onDiskB = readFileSync(pathB, 'utf8');
  assert.match(onDiskA, /flow_id: forge-architect/, `id A must remain unenqueued. On-disk:\n${onDiskA}`);
  assert.match(onDiskB, /flow_id: forge-architect/, `id B must remain unenqueued. On-disk:\n${onDiskB}`);
  assert.doesNotMatch(onDiskA, /cost_ceiling_usd:/, 'id A must not be stamped from a refused batch request');
  assert.doesNotMatch(onDiskB, /cost_ceiling_usd:/, 'id B must not be stamped from a refused batch request');
});

// ---------------------------------------------------------------------------
// shc review FINDING 2 (MINOR, mutation-not-applied): `persistManifestCostCeiling`
// had a bare `catch {}` and its outcome was never folded into the per-item
// `/api/develop/start` result — a silently-failed stamp still reported
// `{status:'enqueued', ok:true}`, indistinguishable from a real success.
//
// (5) RED pin (unit boundary) — `persistManifestCostCeiling` itself must
// return a boolean signal, not `void`. Pinned directly against the function
// (not through HTTP): both writes a real `/api/develop/start` request would
// perform — `enqueueFlowRun`'s own repoint-write and this stamp write — hit
// the EXACT SAME manifest path with the EXACT SAME permissions, so there is
// no way to make the bridge's enqueue succeed while ONLY the stamp fails
// without mocking fs (not available to this file's `node:test` harness —
// see this repo's other cli/*.test.ts files, none of which mock fs). A
// missing/unwritable manifest is therefore pinned directly at the function
// boundary, the one place a false return is actually reachable.
// ---------------------------------------------------------------------------

test('persistManifestCostCeiling returns true on a real, successful stamp — a boolean signal, not void', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persist-ceiling-ok-'));
  const manifestPath = join(dir, 'INIT-2026-08-09-persist-ok.md');
  writeFileSync(manifestPath, pendingManifest('INIT-2026-08-09-persist-ok', 2.0));

  const outcome = persistManifestCostCeiling(manifestPath, 42);
  assert.equal(outcome, true, `expected persistManifestCostCeiling to return true on success — the pre-fix function returns void (undefined), which is what this assertion catches. Got: ${outcome}`);

  // Assert the mutation actually applied before trusting the boolean.
  const onDisk = readFileSync(manifestPath, 'utf8');
  assert.match(onDisk, /cost_ceiling_usd:\s*42(\.0+)?\s*$/m, `expected the stamp to have actually landed. On-disk:\n${onDisk}`);

  rmSync(dir, { recursive: true, force: true });
});

test('persistManifestCostCeiling returns false (not void/undefined) when the target manifest does not exist — the failure signal a silently-swallowed catch used to hide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persist-ceiling-missing-'));
  const manifestPath = join(dir, 'INIT-2026-08-09-persist-missing.md');
  // Deliberately never written — this is the fixture precondition.
  assert.equal(existsSync(manifestPath), false, 'fixture precondition: the manifest must not exist');

  const outcome = persistManifestCostCeiling(manifestPath, 42);
  assert.equal(outcome, false, `expected persistManifestCostCeiling to return false for a manifest that does not exist — the pre-fix function returns void (undefined !== false) regardless of outcome. Got: ${outcome}`);

  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// (6) RED pin (integration boundary) — the SUCCESS path's outcome must fold
// into the per-item `/api/develop/start` result as a distinguishable field
// (`ceilingStamped`), not be silently dropped after `persistManifestCostCeiling`
// returns. Pre-fix: `results[0]` carries no such field at all regardless of
// stamp outcome — this is the "reports enqueued/ok:true regardless" the
// finding calls out, now made assertable.
// ---------------------------------------------------------------------------

test('POST /api/develop/start: a successful single-id stamp folds ceilingStamped:true into the per-item result', async () => {
  const id = 'INIT-2026-08-09-ceiling-stamp-folded';
  const manifestPath = manifestPathFor(id);
  writeFileSync(manifestPath, pendingManifest(id, 2.0));
  assertFixturePrecondition(manifestPath);

  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeIds: [id], costCeilingUsd: 23 }),
  });
  assert.equal(res.status, 200, `expected the accepted-batch 200, got ${res.status}`);
  const body = (await res.json()) as { ok: boolean; results: Array<{ initiativeId: string; ok: boolean; status: string; ceilingStamped?: boolean }> };
  assert.equal(body.ok, true);
  assert.equal(body.results[0]?.status, 'enqueued');

  // Assert the mutation actually applied BEFORE trusting the response-shape
  // field that claims it did.
  const onDisk = readFileSync(manifestPath, 'utf8');
  assert.match(onDisk, /cost_ceiling_usd:\s*23(\.0+)?\s*$/m, `expected the manifest to actually carry the stamp before trusting ceilingStamped. On-disk:\n${onDisk}`);

  assert.equal(
    body.results[0]?.ceilingStamped,
    true,
    `expected results[0].ceilingStamped === true — the pre-fix route response carries no such field at all (undefined), leaving a failed stamp indistinguishable from a successful one. Got: ${JSON.stringify(body.results[0])}`,
  );
});

test('COMPANION of (6): no costCeilingUsd supplied ⇒ no stamp attempted ⇒ ceilingStamped is absent (never fabricated true/false for a stamp that never ran)', async () => {
  const id = 'INIT-2026-08-09-ceiling-stamp-folded-companion';
  const manifestPath = manifestPathFor(id);
  writeFileSync(manifestPath, pendingManifest(id, 2.0));

  const res = await fetch(`${url}/api/develop/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ initiativeIds: [id] }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; results: Array<{ initiativeId: string; ceilingStamped?: boolean }> };
  assert.equal(body.ok, true);
  assert.equal(body.results[0]?.ceilingStamped, undefined, `expected no ceilingStamped field when no stamp was ever attempted. Got: ${JSON.stringify(body.results[0])}`);
});
