/**
 * Tests for the shared interactive-session spine (the architect /
 * instructions-creator / demo-builder stream loop). The SDK call sits behind an
 * injectable `queryFn`, so the whole loop is exercised without a live LLM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  runStructuredTurn,
  runAgentTurn,
  parseFencedJson,
  readSessionStatus,
  writeSessionStatus,
  makeHeartbeatWriter,
  makeThinkingSink,
  makeReasoningSink,
  REDACTED_THINKING_MARKER,
  THINKING_CAPPED_MARKER,
  REASONING_CAPPED_MARKER,
  SINK_ROW_CAP,
  MAX_THINKING_TEXT,
  makeWriteRootCanUseTool,
  type TextSinkContext,
  type QueryFn,
  type WriteRootCanUseTool,
} from './interactive-session.ts';
import type { EventLogEntry, EventLogger } from '@forge/kernel';

const MODEL = 'claude-sonnet-4-6';
const TOOLS = ['Read', 'Grep'] as const;

/** In-memory logger that captures emitted entries instead of writing to disk
 *  — mirrors tool-event-emit.test.ts's own `captureLogger`. */
function captureLogger(): { logger: EventLogger; entries: EventLogEntry[] } {
  const entries: EventLogEntry[] = [];
  const logger: EventLogger = {
    cycleId: 'TEST',
    logFilePath: '/dev/null',
    emit: (partial) => {
      const entry = { event_id: 'EV_TEST', cycle_id: 'TEST', started_at: 'T', ...partial } as EventLogEntry;
      entries.push(entry);
      return entry;
    },
  };
  return { logger, entries };
}

const SINK_CTX: TextSinkContext = {
  initiativeId: 'INIT-test',
  phase: 'orchestrator',
  skill: 'test-skill',
  idMeta: { session_id: 'sid-test' },
};

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

test('runStructuredTurn forwards non-empty thinking blocks to onThinking, trimmed', async () => {
  const thoughts: string[] = [];
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: '  weighing the options  ' },
            { type: 'thinking', thinking: '   ' }, // whitespace-only — must not fire
          ],
        },
      };
      yield { type: 'result', total_cost_usd: 0, structured_output: { ok: 1 } };
    }
    return gen();
  };

  await runStructuredTurn<{ ok: number }>({
    queryFn, prompt: 'p', schema: {}, model: MODEL, allowedTools: TOOLS,
    onThinking: (t) => thoughts.push(t),
  });

  assert.deepEqual(thoughts, ['weighing the options']);
});

test('runStructuredTurn fires onThinking with the exact redaction marker for redacted_thinking, never block content', async () => {
  const thoughts: string[] = [];
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'redacted_thinking', data: 'super-secret-opaque-bytes-never-surfaced' }],
        },
      };
      yield { type: 'result', total_cost_usd: 0, structured_output: { ok: 1 } };
    }
    return gen();
  };

  await runStructuredTurn<{ ok: number }>({
    queryFn, prompt: 'p', schema: {}, model: MODEL, allowedTools: TOOLS,
    onThinking: (t) => thoughts.push(t),
  });

  assert.deepEqual(thoughts, [REDACTED_THINKING_MARKER]);
  assert.equal(REDACTED_THINKING_MARKER, '[thinking redacted]');
  for (const t of thoughts) assert.doesNotMatch(t, /super-secret-opaque-bytes/);
});

// ---------------------------------------------------------------------------
// W6-B1 review round 2 — the shared makeThinkingSink / makeReasoningSink pair.
// ---------------------------------------------------------------------------

test('makeThinkingSink: SINK_ROW_CAP+10 distinct blocks yields exactly SINK_ROW_CAP rows + ONE terminal marker row, then drops the rest', () => {
  const { logger, entries } = captureLogger();
  const onThinking = makeThinkingSink(logger, SINK_CTX);

  const total = SINK_ROW_CAP + 10;
  for (let i = 0; i < total; i++) onThinking(`distinct thought #${i}`);

  const normalRows = entries.filter((e) => e.metadata?.kind === 'thinking' && e.metadata?.capped !== true);
  const markerRows = entries.filter((e) => e.metadata?.kind === 'thinking' && e.metadata?.capped === true);
  assert.equal(normalRows.length, SINK_ROW_CAP, 'exactly SINK_ROW_CAP normal rows emitted');
  assert.equal(markerRows.length, 1, 'exactly ONE terminal marker row, not one per dropped block');
  assert.equal(markerRows[0].message, THINKING_CAPPED_MARKER);
  assert.equal(THINKING_CAPPED_MARKER, `[thinking capped after ${SINK_ROW_CAP} rows]`);
  assert.equal(entries.length, SINK_ROW_CAP + 1, 'total rows == cap + 1 marker, the rest silently dropped');
});

test('makeReasoningSink shares the same unbounded-row gap: SINK_ROW_CAP+10 distinct blocks yields exactly SINK_ROW_CAP rows + ONE terminal marker row', () => {
  const { logger, entries } = captureLogger();
  const onText = makeReasoningSink(logger, SINK_CTX);

  const total = SINK_ROW_CAP + 10;
  for (let i = 0; i < total; i++) onText(`distinct reasoning #${i}`);

  const normalRows = entries.filter((e) => e.metadata?.kind === 'reasoning' && e.metadata?.capped !== true);
  const markerRows = entries.filter((e) => e.metadata?.kind === 'reasoning' && e.metadata?.capped === true);
  assert.equal(normalRows.length, SINK_ROW_CAP);
  assert.equal(markerRows.length, 1);
  assert.equal(markerRows[0].message, REASONING_CAPPED_MARKER);
  assert.equal(entries.length, SINK_ROW_CAP + 1);
});

test('makeThinkingSink coalescing compares the RAW text, not the truncated form — two distinct blocks sharing a 700-char prefix do NOT collapse (collision case)', () => {
  const { logger, entries } = captureLogger();
  const onThinking = makeThinkingSink(logger, SINK_CTX);

  const sharedPrefix = 'x'.repeat(MAX_THINKING_TEXT); // exactly the truncation length
  const blockA = `${sharedPrefix} — first distinct tail`;
  const blockB = `${sharedPrefix} — second distinct tail (DIFFERENT FROM A)`;
  assert.notEqual(blockA, blockB, 'arrange: the two raw blocks are genuinely distinct');
  assert.equal(
    blockA.slice(0, MAX_THINKING_TEXT),
    blockB.slice(0, MAX_THINKING_TEXT),
    'arrange: their first MAX_THINKING_TEXT chars — i.e. their TRUNCATED forms — are identical (the collision this bug hinged on)',
  );

  onThinking(blockA);
  onThinking(blockB);

  const rows = entries.filter((e) => e.metadata?.kind === 'thinking');
  assert.equal(rows.length, 2, 'both distinct raw blocks must emit their own row — the old truncated-string compare would have coalesced the second into nothing');
  assert.equal(rows[0].message, `${sharedPrefix}…`);
  assert.equal(rows[1].message, `${sharedPrefix}…`, 'both EMITTED (truncated) messages are identical — that IS the collision scenario — yet both rows exist');
});

test('makeThinkingSink still coalesces genuinely-repeated consecutive raw blocks (e.g. redacted_thinking runs) into one row', () => {
  const { logger, entries } = captureLogger();
  const onThinking = makeThinkingSink(logger, SINK_CTX);

  onThinking(REDACTED_THINKING_MARKER);
  onThinking(REDACTED_THINKING_MARKER);
  onThinking(REDACTED_THINKING_MARKER);
  onThinking('a genuinely new thought');
  onThinking(REDACTED_THINKING_MARKER); // not consecutive with the earlier run — must emit again

  const rows = entries.filter((e) => e.metadata?.kind === 'thinking');
  assert.deepEqual(rows.map((r) => r.message), [
    REDACTED_THINKING_MARKER,
    'a genuinely new thought',
    REDACTED_THINKING_MARKER,
  ]);
});

test('runAgentTurn streams tool_use, text, and cost — the write-tools/agent-shape turn', async () => {
  const tools: string[] = [];
  const texts: string[] = [];
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Write', input: { file_path: 'x.md', content: 'y' } },
            { type: 'text', text: '  drafting now  ' },
          ],
        },
      };
      yield { type: 'result', total_cost_usd: 0.05 };
    }
    return gen();
  };

  const { costUsd } = await runAgentTurn({
    queryFn, prompt: 'p', cwd: '/tmp', model: MODEL, allowedTools: TOOLS,
    onToolUse: (d) => tools.push(d.name),
    onText: (t) => texts.push(t),
  });

  assert.equal(costUsd, 0.05);
  assert.ok(tools.includes('Write'));
  assert.deepEqual(texts, ['drafting now']);
});

test('runAgentTurn forwards thinking blocks and the exact redaction marker to onThinking, independent of onText', async () => {
  const thoughts: string[] = [];
  const texts: string[] = [];
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: '  planning the edit  ' },
            { type: 'redacted_thinking', data: 'opaque' },
            { type: 'text', text: 'applying the edit' },
          ],
        },
      };
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };

  await runAgentTurn({
    queryFn, prompt: 'p', cwd: '/tmp', model: MODEL, allowedTools: TOOLS,
    onThinking: (t) => thoughts.push(t),
    onText: (t) => texts.push(t),
  });

  assert.deepEqual(thoughts, ['planning the edit', REDACTED_THINKING_MARKER]);
  assert.deepEqual(texts, ['applying the edit'], 'onText unaffected by thinking blocks');
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

// ---------------------------------------------------------------------------
// makeWriteRootCanUseTool — the writeRoots fence (bead forge-eip, W6-CR-3).
// A tool-name allowlist alone is NOT a fence: this is the real, per-call
// enforcement against the actual filesystem every Write/Edit/MultiEdit/
// NotebookEdit call goes through when a turn supplies `writeRoots`.
// ---------------------------------------------------------------------------

function makeFenceFixture(prefix: string): { root: string; writeRoot: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const writeRoot = join(root, 'staging');
  mkdirSync(writeRoot, { recursive: true });
  return { root, writeRoot };
}

test('makeWriteRootCanUseTool: allows a Write to a NEW (not-yet-existing) file inside the write root', async () => {
  const { writeRoot } = makeFenceFixture('fence-allow-new-');
  const canUseTool: WriteRootCanUseTool = makeWriteRootCanUseTool([writeRoot]);
  const result = await canUseTool('Write', { file_path: join(writeRoot, 'registry.yaml'), content: 'x' }, {});
  assert.equal(result.behavior, 'allow');
});

test('makeWriteRootCanUseTool: allows an Edit to an EXISTING file inside the write root', async () => {
  const { writeRoot } = makeFenceFixture('fence-allow-existing-');
  const target = join(writeRoot, 'evidence.md');
  writeFileSync(target, 'seed');
  const canUseTool = makeWriteRootCanUseTool([writeRoot]);
  const result = await canUseTool('Edit', { file_path: target, old_string: 'seed', new_string: 'updated' }, {});
  assert.equal(result.behavior, 'allow');
});

test('makeWriteRootCanUseTool: denies a Write to an absolute path OUTSIDE the write root — the registryPath shape', async () => {
  const { root, writeRoot } = makeFenceFixture('fence-deny-outside-');
  // Mirrors the real shape: a session's own status.json carries an absolute
  // `registryPath` sitting OUTSIDE its `staging/` write root — exactly the
  // sensitive path a prompt-injected agent might be steered into writing.
  const registryPath = join(root, 'studio', 'community', 'registry.yaml');
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, 'meta: {}\nitems: []\n');
  const canUseTool = makeWriteRootCanUseTool([writeRoot]);
  const result = await canUseTool('Write', { file_path: registryPath, content: 'items: [{id: "exfiltrated"}]' }, {});
  assert.equal(result.behavior, 'deny');
  assert.match((result as { message: string }).message, /outside this session's writable root/);
  // The real file must be byte-unchanged — the fence denies BEFORE any write happens.
  assert.equal(readFileSync(registryPath, 'utf8'), 'meta: {}\nitems: []\n');
});

test('makeWriteRootCanUseTool: denies a write whose target is reached through a SYMLINK escaping the write root', async (t) => {
  const { root, writeRoot } = makeFenceFixture('fence-deny-symlink-');
  const secretDir = mkdtempSync(join(tmpdir(), 'fence-secret-'));
  const linkPath = join(writeRoot, 'escape-link');
  try {
    symlinkSync(secretDir, linkPath, 'dir');
  } catch {
    t.skip('platform cannot create symlinks in this environment');
    return;
  }
  const canUseTool = makeWriteRootCanUseTool([writeRoot]);
  const result = await canUseTool('Write', { file_path: join(linkPath, 'planted.txt'), content: 'x' }, {});
  assert.equal(result.behavior, 'deny');
  assert.equal(existsSync(join(secretDir, 'planted.txt')), false, 'nothing may be written through the symlink');
  void root;
});

test('makeWriteRootCanUseTool: denies when the tool input carries no resolvable file path', async () => {
  const { writeRoot } = makeFenceFixture('fence-deny-nopath-');
  const canUseTool = makeWriteRootCanUseTool([writeRoot]);
  const result = await canUseTool('Write', { content: 'no path field at all' }, {});
  assert.equal(result.behavior, 'deny');
});

test('makeWriteRootCanUseTool: passes every NON-gated tool through unmodified, even naming an out-of-root path', async () => {
  const { root, writeRoot } = makeFenceFixture('fence-passthrough-');
  const canUseTool = makeWriteRootCanUseTool([writeRoot]);
  const result = await canUseTool('Read', { file_path: join(root, 'anything', 'anywhere.txt') }, {});
  assert.equal(result.behavior, 'allow');
});

test('runAgentTurn: writeRoots installs a REAL canUseTool on options that denies an out-of-root Write — proves the wiring, not just the pure function', async () => {
  const { root, writeRoot } = makeFenceFixture('fence-wired-');
  let capturedOptions: Record<string, unknown> | undefined;
  const queryFn: QueryFn = ({ options }) => {
    capturedOptions = options;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };

  await runAgentTurn({
    queryFn, prompt: 'p', cwd: writeRoot, model: MODEL, allowedTools: TOOLS,
    writeRoots: [writeRoot],
  });

  assert.ok(capturedOptions, 'queryFn must have been invoked');
  const canUseTool = capturedOptions!.canUseTool as WriteRootCanUseTool | undefined;
  assert.ok(canUseTool, 'runAgentTurn must install options.canUseTool when writeRoots is supplied');

  const registryPath = join(root, 'studio', 'community', 'registry.yaml');
  const outside = await canUseTool!('Write', { file_path: registryPath, content: 'x' }, {});
  assert.equal(outside.behavior, 'deny', 'a Write to the sensitive out-of-root registryPath must be refused');

  const inside = await canUseTool!('Write', { file_path: join(writeRoot, 'registry.yaml'), content: 'x' }, {});
  assert.equal(inside.behavior, 'allow', 'a Write inside the declared write root must still be allowed');
});

test('runAgentTurn: writeRoots absent/empty installs NO canUseTool — byte-identical prior behaviour for every non-opted-in caller', async () => {
  let capturedOptions: Record<string, unknown> | undefined;
  const queryFn: QueryFn = ({ options }) => {
    capturedOptions = options;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
  await runAgentTurn({ queryFn, prompt: 'p', cwd: '/tmp', model: MODEL, allowedTools: TOOLS });
  assert.equal(capturedOptions!.canUseTool, undefined);
});
