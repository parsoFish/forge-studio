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
 * Mirrors the `cli/ui-bridge-agent-run-ceiling.test.ts` harness conventions
 * (temp forgeRoot + real `startBridge`, CSRF header, assert-manifest-content
 * before trusting a response-shape proxy) and the sibling
 * `cli/ui-bridge-develop-start.test.ts` fixture shape (`pendingManifest`,
 * `flow_id: forge-architect` + `specs` so `hasDecompositionEvidence` passes
 * and the enqueue doesn't short-circuit on `not-planned`).
 *
 * RUN COMMAND:
 *   node --experimental-strip-types --test cli/ui-bridge-develop-start-ceiling.test.ts
 *
 * Route contract pinned:
 *   (1) A single-id batch with a valid `costCeilingUsd` stamps
 *       `cost_ceiling_usd` onto the initiative's manifest, such that
 *       `resolveCostCeilingOverride(manifestPath)` (orchestrator/cycle.ts)
 *       returns EXACTLY that value — not the `cost_budget_usd +
 *       DERIVED_CEILING_MARGIN_USD` (40) fallback a manifest with no explicit
 *       ceiling would derive.
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { resolveCostCeilingOverride } from '../orchestrator/cycle.ts';
import { MAX_KICKOFF_COST_CEILING_USD } from '../orchestrator/config.ts';
import { DERIVED_CEILING_MARGIN_USD } from '../orchestrator/manifest.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

function pendingManifest(id: string, costBudgetUsd: number): string {
  return `---
initiative_id: ${id}
project: test-project
project_repo_path: /tmp/test-project
created_at: 2026-08-09T10:00:00.000Z
iteration_budget: 5
cost_budget_usd: ${costBudgetUsd}
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
  const CEILING = 17; // deliberately far from the derived fallback (2.0 + 40 = 42)
  assert.notEqual(CEILING, COST_BUDGET_USD + DERIVED_CEILING_MARGIN_USD, 'sanity: the two values must be distinguishable');

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
  assert.equal(
    resolved,
    CEILING,
    `resolveCostCeilingOverride must read the stamped ceiling (${CEILING}) via the manifest's cost_ceiling_usd field, not the derived cost_budget_usd+${DERIVED_CEILING_MARGIN_USD} fallback (${COST_BUDGET_USD + DERIVED_CEILING_MARGIN_USD}) that a manifest with no explicit ceiling would resolve to — got ${resolved}`,
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
