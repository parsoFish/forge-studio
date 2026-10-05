/**
 * skill-event CLI — every skill invocation logs a structured JSONL event.
 *
 * Runs the REAL script as a subprocess against a temp logs dir supplied via
 * FORGE_SKILL_EVENT_LOGS.
 *
 * RUN: node --test --experimental-strip-types scripts/skill-event.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'skill-event.mjs');

function run(args: string[], logs: string) {
  return spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FORGE_SKILL_EVENT_LOGS: logs },
  });
}

test('valid invocation writes exactly one row with the contract fields', () => {
  const logs = mkdtempSync(join(tmpdir(), 'skill-event-'));
  try {
    const r = run(['docs-write', 'cut', 'page=a/b.md', 'words_before=900', 'words_after=700'], logs);
    assert.equal(r.status, 0, r.stderr);
    const file = join(logs, '_skill-docs-write', 'events.jsonl');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const row = JSON.parse(lines[0]);
    assert.equal(row.event_type, 'log');
    assert.equal(row.phase, 'skill');
    assert.equal(row.skill, 'docs-write');
    assert.equal(row.message, 'cut');
    assert.deepEqual(row.metadata, { page: 'a/b.md', words_before: '900', words_after: '700' });
    assert.equal(r.stdout.trim(), row.event_id);
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});

test('a value may itself contain "="', () => {
  const logs = mkdtempSync(join(tmpdir(), 'skill-event-'));
  try {
    const r = run(['docs-write', 'end', 'note=a=b'], logs);
    assert.equal(r.status, 0, r.stderr);
    const row = JSON.parse(readFileSync(join(logs, '_skill-docs-write', 'events.jsonl'), 'utf8'));
    assert.equal(row.metadata.note, 'a=b');
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});

const BAD: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['bad skill name', ['Bad_Skill', 'start']],
  ['bad event name', ['docs-write', '-nope']],
  ['kv without "="', ['docs-write', 'start', 'oops']],
  ['kv with bad key', ['docs-write', 'start', 'Bad-Key=1']],
];
for (const [label, args] of BAD) {
  test(`${label} exits 2 and writes nothing`, () => {
    const logs = mkdtempSync(join(tmpdir(), 'skill-event-'));
    try {
      const r = run([...args], logs);
      assert.equal(r.status, 2);
      assert.ok(r.stderr.length > 0);
      assert.equal(existsSync(join(logs, '_skill-docs-write')), false);
      assert.equal(existsSync(join(logs, '_skill-Bad_Skill')), false);
    } finally {
      rmSync(logs, { recursive: true, force: true });
    }
  });
}

test('relative FORGE_SKILL_EVENT_LOGS exits 2', () => {
  const r = run(['docs-write', 'start'], 'relative/logs');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /absolute/i);
});
