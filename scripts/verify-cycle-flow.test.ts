/**
 * verify-cycle `--flow <id>` — which flow stage 2 hands the planned initiative
 * to (M7-A exit row 1; the G3 run selects the second factory through it).
 *
 * Until this flag the harness could only ever drive the example's develop flow:
 * stage 2 was `POST /api/develop/start`, whose target is fixed to
 * `forge-develop`. A second factory is reached through the platform's generic
 * per-flow door (`POST /api/flows/<id>/run`), so the selection decides both the
 * flow id and the door. The decision is a pure function of argv and the known
 * flow ids, tested here without a funded run (§15.163); the two script-level
 * tests drive the real `verify-cycle.mjs` entry, which must refuse before it
 * boots anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import {
  DEVELOP_FLOW_ID,
  flowDeclaresMergedReflect,
  flowDefinition,
  knownFlowIds,
  resolveFlowSelection,
  stageTwoRequest,
} from './verify-cycle-flow.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const KNOWN = ['forge-architect', 'forge-develop', 'forge-docs'];

test('no --flow keeps the develop hand-off exactly as it was: forge-develop through /api/develop/start', () => {
  assert.deepEqual(resolveFlowSelection(['--project', 'gitpulse'], KNOWN), { flowId: DEVELOP_FLOW_ID, door: 'develop-start' });
});

test('--flow forge-develop names the default explicitly and takes the same door', () => {
  assert.deepEqual(resolveFlowSelection(['--flow', 'forge-develop'], KNOWN), { flowId: 'forge-develop', door: 'develop-start' });
});

test('--flow <another known flow> takes the generic per-flow door, the one a second factory is reachable through', () => {
  assert.deepEqual(resolveFlowSelection(['--project', 'gitpulse', '--flow', 'forge-docs'], KNOWN), { flowId: 'forge-docs', door: 'flow-run' });
});

test('an unknown flow id is REFUSED naming every known id, never defaulted to develop', () => {
  assert.throws(
    () => resolveFlowSelection(['--flow', 'nope'], KNOWN),
    (err: Error) => /"nope"/.test(err.message) && /forge-architect, forge-develop, forge-docs/.test(err.message),
  );
});

test('--flow with no value, or followed by another flag, is refused rather than silently ignored', () => {
  assert.throws(() => resolveFlowSelection(['--flow'], KNOWN), /--flow needs a flow id/);
  assert.throws(() => resolveFlowSelection(['--flow', '--project', 'gitpulse'], KNOWN), /--flow needs a flow id/);
});

test('--flow given twice is refused: two answers to one question is not a selection', () => {
  assert.throws(() => resolveFlowSelection(['--flow', 'forge-docs', '--flow', 'forge-develop'], KNOWN), /more than once/);
});

test('--flow naming the plan flow is refused: stage 1 IS forge-architect, --flow chooses what it hands off to', () => {
  assert.throws(() => resolveFlowSelection(['--flow', 'forge-architect'], KNOWN), /stage 1/);
});

test('--send-back with a non-develop flow is refused: the send-back drain is proven on the develop topology only', () => {
  assert.throws(() => resolveFlowSelection(['--flow', 'forge-docs', '--send-back'], KNOWN), /--send-back/);
  assert.doesNotThrow(() => resolveFlowSelection(['--flow', 'forge-develop', '--send-back'], KNOWN));
});

test('the generic door carries the initiative and CONFIRMS the repoint from the plan flow it is actually leaving', () => {
  assert.deepEqual(stageTwoRequest({ flowId: 'forge-docs', door: 'flow-run' }, 'INIT-2026-09-19-x'), {
    path: '/api/flows/forge-docs/run',
    payload: { initiativeId: 'INIT-2026-09-19-x', confirmRepointFrom: 'forge-architect' },
  });
});

test('stageTwoRequest refuses the develop selection — that door is batch-shaped and has its own caller', () => {
  assert.throws(() => stageTwoRequest({ flowId: DEVELOP_FLOW_ID, door: 'develop-start' }, 'INIT-x'), /develop-start/);
});

test('reflect is expected only when the flow DECLARES an on:merged reflector trigger', () => {
  assert.equal(flowDeclaresMergedReflect({ triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'reflector' } }] }), true);
  assert.equal(flowDeclaresMergedReflect({ triggers: [] }), false);
  assert.equal(flowDeclaresMergedReflect({}), false);
  assert.equal(flowDeclaresMergedReflect({ triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'someone-else' } }] }), false);
  assert.equal(flowDeclaresMergedReflect({ triggers: [{ on: 'flow-complete', target: { kind: 'agent', ref: 'reflector' } }] }), false);
});

test('the known ids come from the platform\'s own flow registry over this tree, and the develop flow declares its reflect', () => {
  const ids = knownFlowIds(ROOT);
  assert.ok(ids.includes('forge-architect') && ids.includes('forge-develop'), `registry listed ${ids.join(', ')}`);
  assert.equal(flowDeclaresMergedReflect(flowDefinition('forge-develop')), true, 'forge-develop declares {on: merged, ref: reflector}');
});

test('the real script: --flow nope exits non-zero BEFORE booting anything, listing the known ids', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-cycle.mjs'), 'm7-a-flow-probe', '--flow', 'nope'], { encoding: 'utf8', timeout: 60_000 });
  assert.notEqual(r.status, 0, `exited ${r.status}; stdout: ${r.stdout}`);
  assert.match(r.stderr, /"nope"/);
  assert.match(r.stderr, /forge-architect, forge-develop/);
  assert.doesNotMatch(r.stdout, /spawning|bridge|architect start/i, 'nothing may boot before the selection is validated');
});

test('the real script: --help exits 0 and documents --flow', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-cycle.mjs'), '--help'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `exited ${r.status}; stderr: ${r.stderr}`);
  assert.match(r.stdout, /--flow <id>/);
});
