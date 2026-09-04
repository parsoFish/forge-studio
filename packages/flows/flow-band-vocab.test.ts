/**
 * R1-06 WI-1 group A pin — packages/flows/flow-band-vocab.ts (T1 ruling Q8) does not
 * exist yet. Once it lands, `listFlowBandIds(forgeRoot, flowId)` must
 * return the flow's real band vocabulary: the distinct BAND_GUARD_IDS
 * declared by the SKILL.md `composition.guards` of every agent-bearing node
 * in the flow, resolved via `resolveBandGuard`
 * (orchestrator/agent-bands.ts) — not a hardcoded guess.
 *
 * Real production ground truth for the 'forge-develop' flow
 * (studio/flows/forge-develop/flow.yaml), verified by reading the actual
 * SKILL.md guard declarations rather than assuming them:
 *   - nodes: dev (developer-ralph), demo (demo-agent, resumable),
 *     adversarial-review (adversarial-review), review (a `gate`, no agent).
 *   - skills/developer-ralph/SKILL.md composition.guards:
 *       [event-log, cost-guard, stall-watchdog, scratch-strip] — no band.
 *   - skills/demo-agent/SKILL.md composition.guards:
 *       [event-log, demo-band] -> demo-band.
 *   - skills/adversarial-review/SKILL.md composition.guards:
 *       [event-log, review-band] -> review-band.
 *   - `review` is a bare `gate` node (no `agent` key) -> contributes nothing.
 * So the real expected vocabulary for forge-develop is exactly
 * {demo-band, review-band}.
 *
 * RED today: packages/flows/flow-band-vocab.ts does not exist — the import below fails
 * (module not found), which IS the RED proof for this pin. Once the helper
 * lands, the assertion below is the real behavior it must satisfy against
 * this repo's actual forge-develop flow and actual SKILL.md files — a real
 * production call path, not a constructed fixture.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORGE_ROOT } from '@forge/kernel';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listFlowBandIds } from './flow-band-vocab.ts';

test('listFlowBandIds(forgeRoot, "forge-develop") returns the real band vocabulary derived from node SKILL.md guards', () => {
  // Bead 5.53: FORGE_ROOT, not the process cwd — the band vocabulary is
  // derived from `<root>/skills/*/SKILL.md`, so a cwd of packages/flows
  // returned an empty vocabulary rather than failing loudly.
  const forgeRoot = FORGE_ROOT;
  const bandIds = listFlowBandIds(forgeRoot, 'forge-develop');
  assert.deepEqual(
    [...bandIds].sort(),
    ['demo-band', 'review-band'],
    `expected exactly the bands declared by forge-develop's node SKILL.md guards ` +
      `(demo-agent -> demo-band, adversarial-review -> review-band) — got ${JSON.stringify(bandIds)}`,
  );
});

// ---------------------------------------------------------------------------
// F2 (fail-open-validator) pin — a registered-but-empty flow dir has NO real
// band vocabulary, so listFlowBandIds must FAIL CLOSED (return []), never
// widen to the full platform vocab [...BAND_GUARD_IDS].
//
// Why this matters: `listFlowIds`/`studio-lint` register a flow by DIRECTORY
// NAME only, so a not-yet-authored (or corrupt) `flow.yaml` still passes the
// ref-existence check — yet the fail-OPEN fallback used to return every band
// on the platform (including `review-band`), letting an operator attach the
// review band (→ a reviewer brain-read grant) to a flow that has no review
// band at all. An unauthored flow genuinely has no bands, so any band scope on
// it is correctly rejected: [] is the safe answer.
//
// RED at base: the fallback returns the full BAND_GUARD_IDS array (4
// elements when this test was authored; 5 today after R4-18 added
// 'onboard-preflight' — the bug this guards against scales with the count).
// ---------------------------------------------------------------------------
test('F2: listFlowBandIds on a registered-but-empty flow dir (no flow.yaml) fails CLOSED with []', () => {
  const root = mkdtempSync(join(tmpdir(), 'flow-band-vocab-failclosed-'));
  try {
    // A flow registered by directory name ONLY — no flow.yaml inside it, the
    // exact shape `listFlowIds` accepts and `loadFlowDefinition` cannot parse.
    const flowDir = join(root, 'studio', 'flows', 'emptyflow');
    mkdirSync(flowDir, { recursive: true });

    // Fixture precondition FIRST (before reading any verdict): the flow dir
    // exists but its flow.yaml genuinely does not.
    assert.ok(existsSync(flowDir), 'precondition: the flow dir must exist');
    assert.ok(!existsSync(join(flowDir, 'flow.yaml')), 'precondition: flow.yaml must be absent');

    const bandIds = listFlowBandIds(root, 'emptyflow');
    assert.deepEqual(
      bandIds,
      [],
      `a flow with no derivable band vocabulary must fail CLOSED with [] — a fail-OPEN fallback ` +
        `to the full platform vocab would let review-band (a reviewer brain-read grant) be attached ` +
        `to a flow that has no review band. Got: ${JSON.stringify(bandIds)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('F2: listFlowBandIds on an unparsable flow.yaml also fails CLOSED with []', () => {
  const root = mkdtempSync(join(tmpdir(), 'flow-band-vocab-corrupt-'));
  try {
    const flowDir = join(root, 'studio', 'flows', 'corruptflow');
    mkdirSync(flowDir, { recursive: true });
    const flowYaml = join(flowDir, 'flow.yaml');
    // Not a valid flow definition — loadFlowDefinition throws on it.
    writeFileSync(flowYaml, ': not: valid: yaml: [\n', 'utf8');
    assert.ok(existsSync(flowYaml), 'precondition: the corrupt flow.yaml must be planted');

    const bandIds = listFlowBandIds(root, 'corruptflow');
    assert.deepEqual(bandIds, [], `an unparsable flow.yaml has no derivable bands — got ${JSON.stringify(bandIds)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
