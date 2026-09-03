/**
 * `unroutableKbReason` and `loadKbDescriptors`' unroutable-callback contract.
 *
 * Both cases moved here from `cli/id-rule.test.ts` (M4-knowledge s5). That file
 * boots a bridge and spans four packages — it is the right home for "the roster
 * ROUTE diagnoses a dropped descriptor", and the wrong home for "the predicate
 * says what is unroutable", which is knowledge's own and needs no server.
 *
 * The split is deliberate rather than mechanical: the HTTP half of the original
 * W7A4-04 red-pin stays in `cli/id-rule.test.ts` asserting on
 * `list.body.unroutable`, so the route's diagnostic is still pinned end to end.
 * What comes here is the half that was only ever about these two functions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { unroutableKbReason, type UnroutableKb } from '../../kb-sites.ts';
import { loadKbDescriptors } from '../../bridge-studio-kbs.ts';

test('W7A4-04: unroutableKbReason is the ONE predicate — null iff id === dir AND id passes KB_ID_RE', () => {
  assert.equal(unroutableKbReason('trafficGame', 'trafficGame'), null);
  assert.equal(unroutableKbReason('gitpulse', 'gitpulse'), null);
  assert.match(unroutableKbReason('gitpulse-brain', 'gitpulse') ?? '', /gitpulse-brain.*"gitpulse"/);
  assert.match(unroutableKbReason('trafficgame', 'trafficGame') ?? '', /trafficgame/, 'case matters — exact match');
  assert.notEqual(unroutableKbReason('bad id', 'bad id'), null, 'an id failing KB_ID_RE is unroutable even when it equals its dir');
});

test('W7A4-04: loadKbDescriptors DROPS a descriptor whose id is not its directory name, and reports it through the unroutable callback (dir + id + reason)', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'kb-sites-unroutable-'));
  try {
    // A kb.yaml whose id is NOT its directory name — a valid id per KB_ID_RE,
    // so validateKb is silent. No route can resolve it (routes join
    // brain/**/<id>/), so it must not be listed, but it must be DIAGNOSED.
    mkdirSync(join(forgeRoot, 'brain', 'projects', 'gitpulse'), { recursive: true });
    writeFileSync(
      join(forgeRoot, 'brain', 'projects', 'gitpulse', 'kb.yaml'),
      'id: gitpulse-brain\nname: gitpulse (project)\nbinding:\n  kind: project\n  ref: gitpulse\ndesc: Mismatched id.\nbackend: filesystem\n',
    );
    // A well-formed sibling, so "drops the bad one" is not "drops everything".
    mkdirSync(join(forgeRoot, 'brain', 'projects', 'trafficGame', 'themes'), { recursive: true });
    writeFileSync(
      join(forgeRoot, 'brain', 'projects', 'trafficGame', 'kb.yaml'),
      'id: trafficGame\nname: trafficGame (project)\nbinding:\n  kind: project\n  ref: trafficGame\ndesc: Per-project brain for trafficGame.\nbackend: filesystem\n',
    );

    const local: UnroutableKb[] = [];
    const listed = loadKbDescriptors(forgeRoot, (u) => local.push(u));

    assert.ok(!listed.some((k) => k.id === 'gitpulse-brain'), 'the loader drops the mismatched descriptor');
    assert.ok(listed.some((k) => k.id === 'trafficGame'), 'the well-formed sibling still loads');
    assert.equal(local.length, 1, `expected exactly the gitpulse fixture, got ${JSON.stringify(local)}`);
    assert.equal(local[0].dir, 'gitpulse');
    assert.equal(local[0].id, 'gitpulse-brain');
    assert.match(local[0].reason, /gitpulse-brain/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
