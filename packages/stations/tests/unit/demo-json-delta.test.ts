/**
 * The control for `api-before-after` checkpoints (forge-mfv5.1.19): before and
 * after JSON bodies are compared after dropping volatile keys (ids,
 * timestamps, urls, etags, sizes, watcher counts) and the project's declared
 * `ignoreKeys`, at any depth, with key order ignored. A side that is missing
 * fails closed to `unknown`; a side that is not JSON is compared as text; the
 * narrative is never evidence and never moves a verdict.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeCheckpointDeltas } from '../../demo-delta.ts';
import { DEFAULT_VOLATILE_JSON_KEYS, normaliseJsonBody } from '../../demo-form.ts';
import { deriveDeltaSummary } from '../../phases/derive-demo-model.ts';
import type { DemoModel, DemoModelCheckpoint } from '../../demo-model.ts';

function bundle(before: string | null, after: string | null, stem = 'org'): string {
  const dir = mkdtempSync(join(tmpdir(), 'demo-json-delta-'));
  mkdirSync(join(dir, 'before'));
  mkdirSync(join(dir, 'after'));
  if (before !== null) writeFileSync(join(dir, 'before', `${stem}.out`), before);
  if (after !== null) writeFileSync(join(dir, 'after', `${stem}.out`), after);
  return dir;
}

function model(cp: Partial<DemoModelCheckpoint> = {}, extra: Partial<DemoModel> = {}): DemoModel {
  return {
    title: 'T', essence: 'E', project: 'p', diffStat: 'd',
    checkpoints: [{ label: 'org', caption: 'c', form: 'api-before-after', command: 'gitweave org show --json', ...cp }],
    ...extra,
  };
}

const deltaOf = (m: DemoModel, dir: string, ignoreKeys: string[] = []): DemoModelCheckpoint =>
  computeCheckpointDeltas(m, dir, ignoreKeys).checkpoints[0]!;

const BEFORE = JSON.stringify({
  id: 1, node_id: 'A', login: 'dave-parso', created_at: '2026-10-09T01:00:00Z', updated_at: '2026-10-09T01:00:00Z',
  url: 'https://api.github.com/orgs/x', repos_url: 'https://api.github.com/orgs/x/repos', etag: 'W/"1"',
  plan: { size: 10, name: 'free' }, repos: [{ id: 7, name: 'a', pushed_at: '2026-10-09T01:00:00Z', watchers_count: 1 }],
});
const SAME_AFTER_NOISE = JSON.stringify({
  repos: [{ watchers_count: 9, pushed_at: '2026-10-09T02:00:00Z', name: 'a', id: 8 }],
  plan: { name: 'free', size: 11 }, etag: 'W/"2"', repos_url: 'https://api.github.com/orgs/y/repos', url: 'https://api.github.com/orgs/y',
  updated_at: '2026-10-09T02:00:00Z', created_at: '2026-10-09T02:00:00Z', login: 'dave-parso', node_id: 'B', id: 2,
});

test('identical JSON after normalisation (volatile keys differ, key order differs) is "unchanged"', () => {
  assert.equal(deltaOf(model(), bundle(BEFORE, SAME_AFTER_NOISE)).delta, 'unchanged');
});

test('a real field change is "changed", with an excerpt naming it', () => {
  const after = JSON.stringify({ ...JSON.parse(BEFORE), default_repository_permission: 'read' });
  const cp = deltaOf(model(), bundle(BEFORE, after));
  assert.equal(cp.delta, 'changed');
  assert.match(cp.deltaExcerpt ?? '', /default_repository_permission/);
});

test('the project\'s declared ignoreKeys (passed by the capture, never read from demo.json) are dropped at any depth', () => {
  const before = JSON.stringify({ a: { sha: '1', name: 'x' } });
  const after = JSON.stringify({ a: { sha: '2', name: 'x' } });
  assert.equal(deltaOf(model(), bundle(before, after)).delta, 'changed');
  assert.equal(deltaOf(model({ ignoreKeys: ['sha'] } as Partial<DemoModelCheckpoint>), bundle(before, after)).delta, 'changed', 'a demo.json ignoreKeys is not honoured');
  assert.equal(deltaOf(model(), bundle(before, after), ['sha']).delta, 'unchanged');
});

test('an ISO timestamp in a value under any key name (camelCase too) is normalised', () => {
  const before = JSON.stringify({ name: 'x', updatedAt: '2026-10-09T01:00:00Z' });
  const after = JSON.stringify({ name: 'x', updatedAt: '2026-10-09T02:00:00Z' });
  assert.equal(deltaOf(model(), bundle(before, after)).delta, 'unchanged');
});

test('a missing side fails closed to "unknown"', () => {
  assert.equal(deltaOf(model(), bundle(BEFORE, null)).delta, 'unknown');
  assert.equal(deltaOf(model(), bundle(null, BEFORE)).delta, 'unknown');
});

test('the path driver (apiPath, no command) compares its .out body the same way', () => {
  const m = model({ command: undefined, apiPath: '/api/org' });
  assert.equal(deltaOf(m, bundle(BEFORE, SAME_AFTER_NOISE)).delta, 'unchanged');
});

test('a side that is not JSON is compared as text: an endpoint that did not exist before IS a change', () => {
  assert.equal(deltaOf(model(), bundle('[command did not run: unknown subcommand]\n', BEFORE)).delta, 'changed');
  assert.equal(deltaOf(model(), bundle('plain\n', 'plain\n')).delta, 'unchanged');
});

test('a narrative on the model never moves a verdict', () => {
  const dir = bundle(BEFORE, SAME_AFTER_NOISE);
  assert.equal(deltaOf(model({}, { narrative: 'Teams can now see who changed the ruleset.' }), dir).delta, 'unchanged');
});

test('a cli-before-after checkpoint is NOT JSON-normalised (only the api form is)', () => {
  const cp = deltaOf(model({ form: 'cli-before-after' }), bundle('{"id":1}', '{"id":2}'));
  assert.equal(cp.delta, 'changed');
});

test('normaliseJsonBody: defaults cover the volatile key list, *_url and watchers*', () => {
  for (const key of ['id', 'node_id', 'created_at', 'updated_at', 'pushed_at', 'url', 'etag', 'size']) {
    assert.ok(DEFAULT_VOLATILE_JSON_KEYS.includes(key), key);
  }
  assert.equal(normaliseJsonBody('{"html_url":"x","watchers":3,"watchers_count":4,"k":1}', []), normaliseJsonBody('{"k":1}', []));
  assert.notEqual(normaliseJsonBody('{"watchersEnabled":true}', []), normaliseJsonBody('{}', []), 'only the exact watcher keys are volatile');
  assert.equal(normaliseJsonBody('not json', []), null);
});

test('the delta summary says JSON keys were normalised away when an api checkpoint was compared', () => {
  const out = computeCheckpointDeltas(model(), bundle(BEFORE, SAME_AFTER_NOISE));
  assert.match(deriveDeltaSummary(out.checkpoints) ?? '', /volatile JSON keys/);
});
