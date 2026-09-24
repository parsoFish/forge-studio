/**
 * forge-8vfn.8.3.5 (M7-C ABR) — the architect's OWN `brain.read` event.
 *
 * ARCH-1's `brain-query` marker (`kinds/architect.ts`'s `architectPreamble`)
 * fires unconditionally once per turn, before any tool call, so it names the
 * project but never the KB actually read. `deriveBrainReadSummary`
 * (`apps/studio/lib/brain-read-view.ts`, M7-C U2) deliberately refuses to
 * fabricate a per-KB row from that marker. This is the class fix: the
 * architect's interview turn tallies every brain/ path its Read/Grep/Glob
 * tool calls actually touch and emits one `brain.read` event per KB, same
 * shape as the PM's (forge-8vfn.5.16): `event_type: 'brain-query'`,
 * `message: 'brain.read'`, `metadata: {kbId, themeCount, reader, runId}`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EventLogEntry } from '@forge/kernel';
import { runArchitectTurn, type ArchitectStatus } from '../../kinds/architect.ts';
import type { QueryFn } from '../../interactive-session.ts';

const SESSION_ID = 'sess-brain-read';

/** One assistant message carrying three Read tool_use blocks: two brain/
 *  paths under Brain-1-shaped `kbA` (one of them a duplicate FILE — read
 *  twice — proving `themeCount` counts DISTINCT files, not tool calls), one
 *  under Brain-3-shaped `brain/projects/kbB/`, and one plain project file
 *  that names no KB at all (must not appear in any tally). */
function scriptedInterviewStream(): QueryFn {
  return () => ({
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: 'brain/kbA/themes/x.md' } },
            { type: 'tool_use', name: 'Read', input: { file_path: 'brain/kbA/themes/x.md' } },
            { type: 'tool_use', name: 'Read', input: { file_path: 'brain/kbA/themes/y.md' } },
            { type: 'tool_use', name: 'Read', input: { file_path: 'brain/projects/kbB/themes/z.md' } },
            { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } },
          ],
        },
      };
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.01,
        structured_output: {
          done: false,
          questions: [{ question: 'Should the toggle follow the OS setting?', header: 'OS sync' }],
        },
      };
    },
  });
}

function plantSession(): { projectRoot: string; logsRoot: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'arch-brain-read-'));
  const projectRoot = join(root, 'projects', 'p1');
  mkdirSync(join(projectRoot, '_architect', SESSION_ID), { recursive: true });
  const status: ArchitectStatus = {
    session_id: SESSION_ID,
    project: 'p1',
    project_repo_path: projectRoot,
    phase: 'interviewing',
    round: 1,
    idea: 'Add a dark-mode toggle.',
    updated_at: new Date(0).toISOString(),
  };
  writeFileSync(join(projectRoot, '_architect', SESSION_ID, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  const logsRoot = join(root, '_logs');
  return { projectRoot, logsRoot, root };
}

function readEvents(logsRoot: string): EventLogEntry[] {
  const text = readFileSync(join(logsRoot, `_architect-${SESSION_ID}`, 'events.jsonl'), 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as EventLogEntry);
}

test('AT-8.3.5-0 an architect interview turn emits one brain.read event per KB its tool calls actually read, with a distinct-file themeCount', async () => {
  const { projectRoot, logsRoot, root } = plantSession();
  try {
    await runArchitectTurn({
      sessionId: SESSION_ID,
      projectRoot,
      logsRoot,
      brainCwd: root,
      queryFn: scriptedInterviewStream(),
    });

    const events = readEvents(logsRoot);
    const reads = events.filter((e) => e.message === 'brain.read');
    assert.equal(reads.length, 2, `expected exactly two brain.read events (one per KB), got ${JSON.stringify(reads)}`);

    const byKb = new Map(reads.map((e) => [(e.metadata as Record<string, unknown>)['kbId'], e]));
    const kbA = byKb.get('kbA');
    assert.ok(kbA, 'expected a brain.read event for kbA');
    const kbAMeta = kbA!.metadata as Record<string, unknown>;
    assert.equal(kbAMeta['themeCount'], 2, 'kbA: two DISTINCT files (x.md, y.md) — the repeated Read of x.md must not double-count');
    assert.equal(kbAMeta['reader'], 'architect');
    assert.equal(kbAMeta['runId'], `architect-session-${SESSION_ID}`);

    const kbB = byKb.get('kbB');
    assert.ok(kbB, 'expected a brain.read event for kbB (brain/projects/kbB/...)');
    const kbBMeta = kbB!.metadata as Record<string, unknown>;
    assert.equal(kbBMeta['themeCount'], 1);
    assert.equal(kbBMeta['reader'], 'architect');
    assert.equal(kbBMeta['runId'], `architect-session-${SESSION_ID}`);

    for (const e of reads) {
      assert.equal(e.event_type, 'brain-query', 'reuses the existing event_type union member — no schema change');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-8.3.5-1b Grep and Glob tool calls into brain/ are tallied through the same onToolUse path-summary seam as Read', async () => {
  // forge-8vfn.8.3.5 gate fix: the tally observes `onToolUse` (already
  // threaded through every architect sub-turn), never `queryFn` — bead 5.50's
  // lock forbids a production `queryFn:` that is not a caller pass-through.
  // `ToolUseLiveDetail.inputSummary` (summarizeToolInput) is the path itself
  // for Glob, and `` `${pattern} @ ${path}` `` for Grep — this pins BOTH shapes.
  const { projectRoot, logsRoot, root } = plantSession();
  try {
    const queryFn: QueryFn = () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Grep', input: { pattern: 'ADR', path: 'brain/kbA/themes/g.md' } },
              { type: 'tool_use', name: 'Glob', input: { pattern: '*.md', path: 'brain/projects/kbB/themes' } },
            ],
          },
        };
        yield {
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0.01,
          structured_output: { done: false, questions: [{ question: 'Q?', header: 'H' }] },
        };
      },
    });

    await runArchitectTurn({ sessionId: SESSION_ID, projectRoot, logsRoot, brainCwd: root, queryFn });

    const reads = readEvents(logsRoot).filter((e) => e.message === 'brain.read');
    assert.equal(reads.length, 2, `expected one brain.read event per KB (Grep -> kbA, Glob -> kbB), got ${JSON.stringify(reads)}`);
    const byKb = new Map(reads.map((e) => [(e.metadata as Record<string, unknown>)['kbId'], e]));
    assert.equal((byKb.get('kbA')?.metadata as Record<string, unknown>)['themeCount'], 1, 'Grep path parsed out of "pattern @ path"');
    assert.equal((byKb.get('kbB')?.metadata as Record<string, unknown>)['themeCount'], 1, 'Glob path IS the inputSummary');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-8.3.5-1 (positive control) a turn that reads no brain/ path emits no brain.read event at all', async () => {
  const { projectRoot, logsRoot, root } = plantSession();
  try {
    const queryFn: QueryFn = () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0.01,
          structured_output: { done: false, questions: [{ question: 'Q?', header: 'H' }] },
        };
      },
    });

    await runArchitectTurn({ sessionId: SESSION_ID, projectRoot, logsRoot, brainCwd: root, queryFn });

    const reads = readEvents(logsRoot).filter((e) => e.message === 'brain.read');
    assert.equal(reads.length, 0, 'no brain/ path was read this turn, so no brain.read event should exist');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
