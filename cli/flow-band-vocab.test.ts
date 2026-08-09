/**
 * R1-06 WI-1 group A pin — cli/flow-band-vocab.ts (T1 ruling Q8) does not
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
 * RED today: cli/flow-band-vocab.ts does not exist — the import below fails
 * (module not found), which IS the RED proof for this pin. Once the helper
 * lands, the assertion below is the real behavior it must satisfy against
 * this repo's actual forge-develop flow and actual SKILL.md files — a real
 * production call path, not a constructed fixture.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listFlowBandIds } from './flow-band-vocab.ts';

test('listFlowBandIds(forgeRoot, "forge-develop") returns the real band vocabulary derived from node SKILL.md guards', () => {
  const forgeRoot = process.cwd();
  const bandIds = listFlowBandIds(forgeRoot, 'forge-develop');
  assert.deepEqual(
    [...bandIds].sort(),
    ['demo-band', 'review-band'],
    `expected exactly the bands declared by forge-develop's node SKILL.md guards ` +
      `(demo-agent -> demo-band, adversarial-review -> review-band) — got ${JSON.stringify(bandIds)}`,
  );
});
