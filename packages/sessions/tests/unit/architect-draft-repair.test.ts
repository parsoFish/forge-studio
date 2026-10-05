/**
 * Row 159 (bead forge-8vfn.8.1.47, ruling 1891) — S10 run 41
 * (`_1.0/reports/m7-a-run41-triage.md`): the architect's draft produced
 * `acceptance_criteria[8].given = ""` and `buildManifest` threw straight out
 * of `runDraftStep` with no repair chance — the session went to
 * `phase: 'failed'` carrying the raw validator error, never a repair turn.
 *
 * Drives the KIND'S DOOR (`runArchitectTurn`), the same convention
 * `architect-stage-events.test.ts` uses for row 8.1.14, with the SAME
 * scripted-`queryFn` / recording-`logger` / `plant` shapes (each test file
 * keeps its own small copies — see that file's own doc comment on why).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runArchitectTurn, type ArchitectStatus } from '../../kinds/architect.ts';
import { stubArchitectManifestPorts } from '../../tests/architect-ports-stub.ts';
import { ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX } from '@forge/contracts';
import type { EventLogEntry, EventLogger } from '@forge/kernel';

const GIVEN_ERROR = /acceptance_criteria\[0\]\.given must be a non-empty string/;
const PREFIX = ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX;

/** A draft whose ONE initiative's acceptance_criteria[0].given is invalid
 *  (empty) unless `given` is overridden — the exact S10 run 41 shape
 *  (`acceptance_criteria[8].given must be a non-empty string`), narrowed to
 *  index 0 since this fixture drafts a single criterion. */
const draft = (given: string) => ({
  vision: 'A vision.',
  initiatives: [{
    slug: 'exclude-author-flag',
    title: 'Exclude author flag',
    iteration_budget: 3,
    cost_budget_usd: 2,
    class: 'code',
    acceptance_criteria: [{ given, when: '--exclude-author is passed', then: 'the author is omitted' }],
    body: '# Exclude author flag\n',
  }],
});
const BAD_DRAFT = draft(''); // fails architect-manifest.ts's requireDraftAcceptanceCriteria
const GOOD_DRAFT = draft('a commit with an author trailer'); // the repair turn's corrected draft
const CLEAN_CRITIC = { findings: [] };

/** Scripted queryFn — replays one structured output per call, in order. */
function scriptedQueryFn(
  script: readonly unknown[],
): { queryFn: (o: { prompt: string }) => AsyncGenerator<unknown>; prompts: string[] } {
  const prompts: string[] = [];
  const queryFn = (opts: { prompt: string }) => {
    const i = prompts.length;
    prompts.push(opts.prompt);
    if (i >= script.length) {
      throw new Error(`scriptedQueryFn: call ${i + 1} past the end of a ${script.length}-turn script`);
    }
    const scripted = script[i];
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0.01, structured_output: scripted };
    }
    return gen();
  };
  return { queryFn, prompts };
}

function recordingLogger(): { logger: EventLogger; messages: string[]; entries: EventLogEntry[] } {
  const messages: string[] = [];
  const entries: EventLogEntry[] = [];
  const logger: EventLogger = {
    emit: (entry) => {
      messages.push(String((entry as { message?: unknown }).message ?? ''));
      const stub = { event_id: 'stub', cycle_id: 'stub', started_at: '1970-01-01T00:00:00.000Z' };
      const full = ({ ...stub, ...entry }) as EventLogEntry;
      entries.push(full);
      return full;
    },
    cycleId: 'stub',
    logFilePath: '',
  };
  return { logger, messages, entries };
}

function plant(): { root: string; projectRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'arch-draft-repair-'));
  const projectRoot = join(root, 'projects', 'p1');
  const sessionDir = join(root, '_logs', '_sessions', 'p1', '_architect', 'sess-1');
  mkdirSync(sessionDir, { recursive: true });
  const status: ArchitectStatus = {
    session_id: 'sess-1', project: 'p1', project_repo_path: projectRoot, phase: 'drafting', round: 1,
    idea: 'Add a --exclude-author flag.', updated_at: new Date().toISOString(),
  };
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  return { root, projectRoot };
}

test('(a) an invalid draft earns ONE bounded repair turn; a valid repair proceeds normally', async () => {
  const { root, projectRoot } = plant();
  const { queryFn, prompts } = scriptedQueryFn([BAD_DRAFT, GOOD_DRAFT, CLEAN_CRITIC]);
  const { logger, messages, entries } = recordingLogger();
  try {
    const result = await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot, project: 'p1',
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger,
    });
    assert.equal(result.phase, 'awaiting-verdict', 'the repaired draft passes the clean critic and proceeds');
    assert.equal(prompts.length, 3, 'draft, ONE repair turn, then the critic — never a second repair call');
    assert.ok(messages.includes('architect.draft-repair.start'), 'the repair turn is observable');
    const isRepairEnd = (m: string): boolean => m.startsWith('architect.draft-repair.end');
    const repairEnded = messages.some((m) => isRepairEnd(m) && !m.includes(PREFIX));
    assert.ok(repairEnded, 'the repair turn ended successfully — no classified failure');
    const repairStart = entries.find((e) => e.message === 'architect.draft-repair.start');
    assert.match(
      String(repairStart?.metadata?.validation_error ?? ''),
      GIVEN_ERROR,
      'the repair prompt carries the validator message verbatim',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(b)+(c) a second-failing repair classifies the failure, never a second repair turn', async () => {
  const { root, projectRoot } = plant();
  const { queryFn, prompts } = scriptedQueryFn([BAD_DRAFT, BAD_DRAFT, CLEAN_CRITIC]);
  const { logger, messages } = recordingLogger();
  try {
    await assert.rejects(
      () => runArchitectTurn({
        manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot, project: 'p1',
        logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger,
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(PREFIX), `expected the classified prefix in: ${err.message}`);
        assert.match(err.message, GIVEN_ERROR);
        return true;
      },
    );
    // Exactly one repair turn: draft (call 0) + repair (call 1) — the critic
    // (which would be call 2) is never reached.
    assert.equal(prompts.length, 2, 'exactly one repair turn, never two, and no fall-through to the critic');
    const classified = messages.some((m) => m.startsWith('architect.draft-repair.end') && m.includes(PREFIX));
    assert.ok(classified, 'the classified reason is also written to an event, not just the thrown message');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
