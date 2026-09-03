/**
 * Contract: a `SESSION_KIND_RUNNERS` row and an `AGENT_RUNNERS` row are the
 * SAME shape.
 *
 * `cmdAgentRun` (packages/agents/agent-run.ts) resolves an agent-id from
 * `AGENT_RUNNERS` first and `SESSION_KIND_RUNNERS` second, then drives ONE
 * code path over whichever it found. Neither package imports the other's row
 * type — agents already imports this package, so a type import back would
 * close a cycle — which means TypeScript's structural check is the only thing
 * holding the two shapes together, and it only fires at the assignment inside
 * agents. A field added on either side would compile here and fail there, or
 * (worse) compile in both and be silently ignored for ported kinds.
 *
 * This test pins the contract from the sessions side: every registry row
 * carries every field `cmdAgentRun` reads, its `kindDir` EQUALS the kind
 * module's own variant, and `loadRunTurn` resolves to a callable. It asserts
 * over EVERY row, so a kind ported later is covered without anyone
 * remembering to extend this file — the second test fails loudly for a new
 * row until its variant is registered here.
 *
 * PRECISION: a runtime test can only prove the two VALUES agree, not that the
 * registry reads the variant's field rather than re-typing the same literal.
 * The value equality is what the `_demo`/`demo-builder` trap actually needs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SESSION_KIND_RUNNERS } from '../../kinds/registry.ts';
import { architectKind } from '../../kinds/architect.ts';
import { demoKind } from '../../kinds/demo-builder.ts';
import { instructionsKind } from '../../kinds/instructions.ts';
import { projectBrainKind } from '../../kinds/project-brain.ts';
import type { SessionKindVariant, KindTurnResult, KindTurnStatus } from '../../kinds/kind-turn.ts';

/** The kind module whose variant backs each registry row, by registry key. */
const VARIANT_BY_ID: Record<string, SessionKindVariant<KindTurnStatus, KindTurnResult>> = {
  architect: architectKind as unknown as SessionKindVariant<KindTurnStatus, KindTurnResult>,
  'demo-builder': demoKind as unknown as SessionKindVariant<KindTurnStatus, KindTurnResult>,
  instructions: instructionsKind as unknown as SessionKindVariant<KindTurnStatus, KindTurnResult>,
  'project-brain': projectBrainKind as unknown as SessionKindVariant<KindTurnStatus, KindTurnResult>,
};

test('every SESSION_KIND_RUNNERS row carries the fields cmdAgentRun reads', () => {
  const ids = Object.keys(SESSION_KIND_RUNNERS);
  assert.ok(ids.length > 0, 'the registry must not be empty — a port with no row is not dispatchable');

  for (const id of ids) {
    const row = SESSION_KIND_RUNNERS[id]!;
    assert.equal(typeof row.verb, 'string', `${id}: verb`);
    assert.ok(row.verb.length > 0, `${id}: verb must be non-empty — it is the operator-facing usage text`);
    assert.equal(typeof row.requiresProject, 'boolean', `${id}: requiresProject`);
    assert.equal(typeof row.kindDir, 'string', `${id}: kindDir`);
    assert.ok(row.kindDir.startsWith('_'), `${id}: kindDir must be an on-disk "_<kind>" segment, got ${row.kindDir}`);
    assert.equal(typeof row.loadRunTurn, 'function', `${id}: loadRunTurn`);
    assert.equal(typeof row.printResult, 'function', `${id}: printResult`);
    for (const optional of ['needsForgeRoot', 'combinedArgCheck'] as const) {
      const v = row[optional];
      assert.ok(v === undefined || typeof v === 'boolean', `${id}: ${optional} must be boolean|undefined`);
    }
  }
});

test('every registry row\'s kindDir agrees with its kind module\'s variant', () => {
  for (const id of Object.keys(SESSION_KIND_RUNNERS)) {
    const variant = VARIANT_BY_ID[id];
    assert.ok(variant, `${id}: no kind module registered in this test — a new port must add its variant here`);
    assert.equal(
      SESSION_KIND_RUNNERS[id]!.kindDir,
      variant.kindDir,
      `${id}: the registry row's kindDir must equal the kind module's own — a divergence here is exactly the "_demo" vs "demo-builder" trap`,
    );
  }
});

test('every registry row resolves a callable turn function', async () => {
  for (const id of Object.keys(SESSION_KIND_RUNNERS)) {
    const run = await SESSION_KIND_RUNNERS[id]!.loadRunTurn();
    assert.equal(typeof run, 'function', `${id}: loadRunTurn must resolve to the kind's turn function`);
  }
});

test('every registry row prints a summary naming its own kind', () => {
  for (const id of Object.keys(SESSION_KIND_RUNNERS)) {
    const lines: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      SESSION_KIND_RUNNERS[id]!.printResult({ phase: 'committed', wrote: [], themes: [] });
    } finally {
      console.log = realLog;
    }
    assert.ok(lines.length > 0, `${id}: printResult must print something — a silent dispatch reports nothing to the operator`);
    assert.ok(
      lines.some((l) => l.includes(id)),
      `${id}: printResult must name its own kind, got ${JSON.stringify(lines)}`,
    );
  }
});
