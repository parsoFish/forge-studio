/**
 * Tests for the shared interactive-session spine (the architect /
 * instructions-creator / demo-builder stream loop). The SDK call sits behind an
 * injectable `queryFn`, so the whole loop is exercised without a live LLM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runStructuredTurn,
  parseFencedJson,
  readSessionStatus,
  writeSessionStatus,
  makeHeartbeatWriter,
  type QueryFn,
} from './interactive-session.ts';

const MODEL = 'claude-sonnet-4-6';
const TOOLS = ['Read', 'Grep'] as const;

test('runStructuredTurn returns structured_output and passes model/allowedTools/outputFormat', async () => {
  const captured: Array<Record<string, unknown>> = [];
  const queryFn: QueryFn = ({ options }) => {
    captured.push((options ?? {}) as Record<string, unknown>);
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: { done: true } };
    }
    return gen();
  };

  const { output } = await runStructuredTurn<{ done: boolean }>({
    queryFn,
    prompt: 'p',
    schema: { type: 'object' },
    model: MODEL,
    allowedTools: TOOLS,
  });

  assert.deepEqual(output, { done: true });
  const o = captured[0];
  assert.equal(o.model, MODEL);
  assert.deepEqual(o.allowedTools, TOOLS);
  const of = o.outputFormat as { type?: string; schema?: unknown };
  assert.equal(of.type, 'json_schema', 'outputFormat must be wrapped (F-W5-1)');
  assert.ok(of.schema && typeof of.schema === 'object');
  assert.notEqual(o.permissionMode, 'plan', 'structured turn must never run in plan mode (F-W5-1)');
});

test('runStructuredTurn collects every Read file_path into reads, streams tools + text', async () => {
  const tools: string[] = [];
  const texts: string[] = [];
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Grep', input: { pattern: 'x' } },
            { type: 'tool_use', name: 'Read', input: { file_path: 'brain/cycles/themes/a.md' } },
            { type: 'tool_use', name: 'Read', input: { file_path: 'AGENTS.md' } },
            { type: 'text', text: '  thinking about it  ' },
          ],
        },
      };
      yield { type: 'result', total_cost_usd: 0, structured_output: { ok: 1 } };
    }
    return gen();
  };

  const { output, reads } = await runStructuredTurn<{ ok: number }>({
    queryFn,
    prompt: 'p',
    schema: {},
    model: MODEL,
    allowedTools: TOOLS,
    onToolUse: (d) => tools.push(d.name),
    onText: (t) => texts.push(t),
  });

  assert.deepEqual(output, { ok: 1 });
  assert.deepEqual(reads, ['brain/cycles/themes/a.md', 'AGENTS.md']);
  assert.ok(tools.includes('Grep'));
  assert.deepEqual(texts, ['thinking about it'], 'text block is trimmed and forwarded');
});

test('runStructuredTurn falls back to fenced JSON when no structured_output', async () => {
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'here:\n```json\n{"done":false}\n```' }] },
      };
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
  const { output } = await runStructuredTurn<{ done: boolean }>({
    queryFn, prompt: 'p', schema: {}, model: MODEL, allowedTools: TOOLS,
  });
  assert.deepEqual(output, { done: false });
});

test('parseFencedJson parses fenced, raw, and returns null on garbage', () => {
  assert.deepEqual(parseFencedJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseFencedJson('{"b":2}'), { b: 2 });
  assert.equal(parseFencedJson('not json'), null);
  assert.equal(parseFencedJson(''), null);
});

test('writeSessionStatus round-trips through readSessionStatus and stamps updated_at', () => {
  const dir = mkdtempSync(join(tmpdir(), 'isess-'));
  const sessionDir = join(dir, 'sess');
  const p = writeSessionStatus(sessionDir, { phase: 'prompting', round: 1 });
  assert.ok(existsSync(p));
  const back = readSessionStatus<{ phase: string; round: number; updated_at: string }>(sessionDir);
  assert.equal(back?.phase, 'prompting');
  assert.equal(back?.round, 1);
  assert.ok(back?.updated_at, 'updated_at is stamped');
});

test('readSessionStatus returns null on missing or unparseable file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'isess-'));
  assert.equal(readSessionStatus(dir), null);
  mkdirSync(join(dir, 's'), { recursive: true });
  writeFileSync(join(dir, 's', 'status.json'), '{ not json');
  assert.equal(readSessionStatus(join(dir, 's')), null);
});

test('makeHeartbeatWriter writes a timestamp to .heartbeat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'isess-hb-'));
  const hbDir = join(dir, '_logs', 'sess');
  const beat = makeHeartbeatWriter(hbDir);
  beat();
  const hbPath = join(hbDir, '.heartbeat');
  assert.ok(existsSync(hbPath));
  assert.match(readFileSync(hbPath, 'utf8'), /^\d{4}-\d{2}-\d{2}T/);
});
