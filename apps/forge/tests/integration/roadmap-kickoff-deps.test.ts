/**
 * forge-nk1y.38 — through the real bridge: a kickoff-parked initiative (the stranded Kickoff
 * shape: forge-architect manifest in `_queue/ready-for-review/`) whose dependency is still in
 * flight reads BLOCKED on the roadmap card and on `/api/runs/planned`, so "Start eligible"
 * (which keys on `ready`) no longer counts it; once the dependency is merged it reads ready.
 * Gitweave I3b behind I3a (2026-10-12) read `ready=true`, `blockedBy=[]`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';
import { plantStrandedKickoff, STRANDED_INIT, STRANDED_PROJECT } from '../../../../packages/flows/tests/test-fixtures/stranded-kickoff.ts';

const DEP = 'INIT-2026-10-09-prerequisite';
type Card = { initiativeId: string; status: string; ready: boolean; blockedBy: string[] };
type Planned = { initiativeId: string; ready: boolean; blockedBy: string[] };

async function read(forgeRoot: string): Promise<{ card: Card; planned: Planned }> {
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    const roadmap = (await (await fetch(`${url}/api/studio/projects/${STRANDED_PROJECT}/roadmap`)).json()) as { roadmap: { initiatives: Card[] } };
    const planned = (await (await fetch(`${url}/api/runs/planned`)).json()) as { planned: Planned[] };
    const card = roadmap.roadmap.initiatives.find((i) => i.initiativeId === STRANDED_INIT);
    const row = planned.planned.find((p) => p.initiativeId === STRANDED_INIT);
    assert.ok(card && row, 'the kickoff-parked initiative is on the roadmap and the planned list');
    return { card, planned: row };
  } finally {
    await close();
  }
}

test('kickoff-parked dependent behind an in-flight prerequisite: card + planned read blocked; after the merge, ready', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'roadmap-kickoff-deps-'));
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    const { manifestPath } = plantStrandedKickoff(forgeRoot);
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace('flow_id: forge-architect\n', `flow_id: forge-architect\ndepends_on_initiatives:\n  - ${DEP}\n`));
    const depInFlight = join(forgeRoot, '_queue', 'in-flight', `${DEP}.md`);
    writeFileSync(depInFlight, `---\ninitiative_id: ${DEP}\nproject: ${STRANDED_PROJECT}\nflow_id: forge-develop\n---\n# prerequisite\n`);

    const blocked = await read(forgeRoot);
    assert.equal(blocked.card.status, 'awaiting-kickoff');
    assert.equal(blocked.card.ready, false);
    assert.deepEqual(blocked.card.blockedBy, [DEP]);
    assert.equal(blocked.planned.ready, false);
    assert.deepEqual(blocked.planned.blockedBy, [DEP]);

    renameSync(depInFlight, join(forgeRoot, '_queue', 'merged', `${DEP}.md`));
    const ready = await read(forgeRoot);
    assert.equal(ready.card.ready, true);
    assert.deepEqual(ready.card.blockedBy, []);
    assert.equal(ready.planned.ready, true);
  } finally {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
