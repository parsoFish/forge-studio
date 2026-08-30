/**
 * Conformance for the two ports `docs/roadmaps/1.0.md` §4 M2 Lane B cuts.
 *
 * Each test below names the wrong implementation it kills, because a test that
 * would look identical had the implementation been wrong is characterization,
 * not acceptance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createBandRegistry, type PhaseExecutor } from './ports.ts';

const ALLOWED = ['demo-band', 'review-band'] as const;

test('registerBand rejects an id outside the allowed set, naming the offender AND the allowed set (kills: a table keyed by a bare string, where a typo registers a band nothing ever dispatches and no gate notices)', () => {
  const reg = createBandRegistry<{ n: number }>(ALLOWED);
  assert.throws(
    () => reg.registerBand('demo_band', async () => {}),
    (err: Error) =>
      err.message.includes('demo_band') &&
      err.message.includes('demo-band') &&
      err.message.includes('review-band'),
  );
  assert.equal(reg.get('demo_band'), undefined);
});

test('registerBand rejects a duplicate registration (kills: last-write-wins, which makes band dispatch depend on import order)', () => {
  const reg = createBandRegistry<{ n: number }>(ALLOWED);
  const first = async () => {};
  reg.registerBand('demo-band', first);
  assert.throws(() => reg.registerBand('demo-band', async () => {}), /demo-band/);
  assert.equal(reg.get('demo-band'), first, 'the first registration survives the rejected second');
});

test('a registered band is retrievable, receives the caller context, and ids() lists exactly what was registered', async () => {
  const reg = createBandRegistry<{ n: number }>(ALLOWED);
  let seen = 0;
  reg.registerBand('review-band', async (ctx) => {
    seen = ctx.n;
  });
  assert.deepEqual([...reg.ids()], ['review-band']);
  await reg.get('review-band')!({ n: 7 });
  assert.equal(seen, 7, 'the band ran against the context the caller passed');
});

test('PhaseExecutor is satisfiable by an object that imports no phase — the port is a call shape, not an implementation (kills: a port declared over a concrete node context, which would drag flows types into kernel and make a stub impossible)', async () => {
  const seen: string[] = [];
  const stub: PhaseExecutor<{ marker: string }> = {
    async run(nodeId, ctx) {
      seen.push(`${nodeId}:${ctx.marker}`);
      return 'ready-for-review';
    },
  };
  assert.equal(await stub.run('demo', { marker: 'x' }), 'ready-for-review');
  assert.deepEqual(seen, ['demo:x']);
});
