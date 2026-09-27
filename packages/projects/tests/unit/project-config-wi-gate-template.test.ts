/**
 * forge-mfv5.3.6 (operator ruling 2026-09-12) — `testProcess.local.perWorkItem`,
 * the per-work-item gate TEMPLATE a project may declare next to `cmd`. It fills
 * only a work item's OMITTED `quality_gate_cmd`, with the one package the item
 * changes substituted for the `{package}` placeholder (the derivation and the
 * precedence live in `packages/stations/phases/wi-quality-gate.ts`).
 *
 * This file pins the load-time validation: the template is an argv array with
 * exactly one placeholder and no shell metacharacters (the shared
 * `SHELL_METACHARACTERS` rule from `@forge/contracts` — the gate child is a
 * bare argv, never a shell). A malformed template is a load error that names
 * the field.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateProjectConfig } from '../../project-config.ts';

const GO_TEMPLATE = ['go', 'test', '-tags', 'all', '-count=1', './{package}/...'];

function load(perWorkItem: unknown) {
  return validateProjectConfig({ testProcess: { local: { cmd: ['true'], perWorkItem } } });
}

test('forge-mfv5.3.6: a valid perWorkItem template loads onto testProcess.local unchanged', () => {
  const cfg = load(GO_TEMPLATE);
  assert.deepEqual(cfg.testProcess.local.perWorkItem, GO_TEMPLATE);
  assert.deepEqual(cfg.testProcess.local.cmd, ['true'], 'the project-wide gate is untouched by the template');
});

test('forge-mfv5.3.6: perWorkItem is optional — absent leaves no key', () => {
  const cfg = validateProjectConfig({ testProcess: { local: { cmd: ['true'] } } });
  assert.equal('perWorkItem' in cfg.testProcess.local, false);
});

test('forge-mfv5.3.6: a template with NO {package} placeholder is refused by name', () => {
  assert.throws(() => load(['go', 'test', './...']), /testProcess\.local\.perWorkItem.*exactly one \{package\} placeholder \(found 0\)/);
});

test('forge-mfv5.3.6: a template with TWO {package} placeholders is refused by name — one token or two', () => {
  assert.throws(() => load(['go', 'test', './{package}/...', './{package}']), /testProcess\.local\.perWorkItem.*exactly one \{package\} placeholder \(found 2\)/);
  assert.throws(() => load(['go', 'test', './{package}/{package}/...']), /testProcess\.local\.perWorkItem.*\(found 2\)/);
});

test('forge-mfv5.3.6: a template carrying a shell metacharacter is refused by name', () => {
  for (const bad of [
    ['go', 'test', './{package}/...', '&&', 'true'],
    ['bash', '-c', 'go test ./{package}/... | tee out'],
    ['go', 'test', './{package}/*.go'],
  ]) {
    assert.throws(() => load(bad), /testProcess\.local\.perWorkItem.*shell metacharacter/, `must refuse ${JSON.stringify(bad)}`);
  }
});

test('forge-mfv5.3.6: a template that is not an argv array (a shell string, an empty array) is refused by name', () => {
  assert.throws(() => load('go test ./{package}/...'), /testProcess\.local\.perWorkItem must be an argv string\[\]/);
  assert.throws(() => load([]), /testProcess\.local\.perWorkItem.*\(found 0\)/);
});
