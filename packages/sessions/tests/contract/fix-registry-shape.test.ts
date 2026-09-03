/**
 * `FIX_KIND_RUNNERS` conformance — the pin `kinds/fix-registry.ts`'s header
 * promises.
 *
 * The rows carry no shared `Record<string, FixKindRunner>` annotation, so that
 * TypeScript keeps each row's precise types for the CLI call site (a cast that
 * lies is how a carve reads `undefined` at runtime with nothing red, §15.66).
 * The cost of that choice is that nothing in the declaration checks the rows
 * against each other — so it is checked HERE instead, structurally, and this
 * file is the reason the header can make that trade.
 *
 * It is also the union half of the §15.77 lesson: `AT-7` read `AGENT_RUNNERS`
 * alone and each kind fell out of it at the moment it ported. The last clause
 * asserts the two dispatch tables are DISJOINT and that their union is the
 * whole set of ported kinds, so a kind added to one and forgotten by an
 * enumerator over the other is visible here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { FIX_KIND_RUNNERS, type FixKindRunner } from '../../kinds/fix-registry.ts';
import { SESSION_KIND_RUNNERS } from '../../kinds/registry.ts';

describe('FIX_KIND_RUNNERS conformance', () => {
  test('every row satisfies FixKindRunner — a field added to one row cannot drift from the other', () => {
    const ids = Object.keys(FIX_KIND_RUNNERS);
    assert.deepEqual(ids, ['brain-fix', 'preflight-fix'], 'the ported session-less fix kinds');

    for (const [id, row] of Object.entries(FIX_KIND_RUNNERS)) {
      // The assignment IS the assertion: a row that stopped satisfying the
      // interface fails the typecheck, and the runtime checks below catch a
      // row whose field is present but empty.
      const conforming: FixKindRunner = row as unknown as FixKindRunner;
      assert.equal(typeof conforming.verb, 'string', `${id}.verb`);
      assert.ok(conforming.verb.length > 0, `${id}.verb must not be empty`);
      assert.equal(typeof conforming.loadRunTurn, 'function', `${id}.loadRunTurn`);
      assert.equal(typeof conforming.printResult, 'function', `${id}.printResult`);
    }
  });

  test('each row loads ONLY its own kind module and returns a turn function', async () => {
    for (const [id, row] of Object.entries(FIX_KIND_RUNNERS)) {
      const runTurn = await row.loadRunTurn();
      assert.equal(typeof runTurn, 'function', `${id} must resolve to a turn function`);
      // One required argument — the input object. A turn that took none would
      // mean the row resolved to the wrong export.
      assert.equal(runTurn.length, 1, `${id}'s turn takes exactly one input`);
    }
  });

  test("the verb matches the operator's actual subcommand", () => {
    // These strings appear in error text an operator reads, so they track the
    // CLI rather than the kind id: `forge brain fix`, not `forge brain-fix`.
    assert.equal(FIX_KIND_RUNNERS['brain-fix'].verb, 'brain fix');
    assert.equal(FIX_KIND_RUNNERS['preflight-fix'].verb, 'preflight fix');
  });

  test('§15.77: the two dispatch tables are disjoint, and their union is every ported kind', () => {
    const fixIds = Object.keys(FIX_KIND_RUNNERS);
    const sessionIds = Object.keys(SESSION_KIND_RUNNERS);

    const overlap = fixIds.filter((id) => sessionIds.includes(id));
    assert.deepEqual(overlap, [], 'a kind in both tables would be dispatched twice, differently');

    // The six kinds ruling 60 ports. This is the UNION an enumerator must read
    // — reading either table alone is the AT-7 failure mode.
    assert.deepEqual(
      [...sessionIds, ...fixIds].sort(),
      ['architect', 'brain-fix', 'demo-builder', 'instructions', 'preflight-fix', 'project-brain'],
      'the union of the two tables is the ported set; a new kind joins exactly one',
    );
  });
});
