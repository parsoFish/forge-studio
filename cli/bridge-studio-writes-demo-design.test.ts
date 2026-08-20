/**
 * W7-B6 WI-6 — projects-28 pin: the "Demo machinery needed" signal fires on
 * CHANGE, not presence. The client always sends demoProcess in the save
 * body, so the old `Array.isArray(body.demoProcess)` rule tripped the banner
 * after EVERY save (a north-star-only edit included). Killed implementation:
 * presence-as-change.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { demoProcessChanged } from './bridge-studio-writes.ts';

const STEPS = [
  { kind: 'capture', text: 'Capture the before state.' },
  { kind: 'verify', text: 'Run the gate.' },
];

test('AT-B6-18 an UNCHANGED demoProcess (the every-save client echo) does NOT signal demo-design', () => {
  assert.equal(demoProcessChanged(structuredClone(STEPS), STEPS), false, 'byte-equal echo must not trip the banner');
});

test('AT-B6-19 a genuinely CHANGED demoProcess signals demo-design; absent/non-array never does', () => {
  assert.equal(demoProcessChanged([...STEPS, { kind: 'present', text: 'Attach it.' }], STEPS), true);
  assert.equal(demoProcessChanged(STEPS, undefined), true, 'first-ever demoProcess IS a change');
  assert.equal(demoProcessChanged(undefined, STEPS), false, 'a save without the field never signals');
  assert.equal(demoProcessChanged('not-an-array', STEPS), false);
});
