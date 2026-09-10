/**
 * forge-b6af — `/monitor`'s ledger has never shown what a SESSION cost.
 *
 * `GET /api/agents/runs/recent` (`collectRecentAgentRuns`) has a FLOW pass and
 * a STANDALONE pass and stops there, and its standalone half opens with
 * `if (!entry.startsWith('_agent-')) continue`. A session's turn writes its
 * events to `_logs/_<kind>-<sessionId>`, which is neither — so no session has
 * ever produced a row, and `/monitor` is the only place an operator can look.
 *
 * Measured on S9 run 3, both figures read from the run's own logs:
 *   `_authoring-<sid>/events.jsonl`               cost_usd 0.71176675
 *   `_agent-onboarding-agent-<stamp>/events.jsonl` cost_usd 0.39334640
 * Beat 8 read the 0.71 on the authoring session's own page. Beat 14 read FOUR
 * `/monitor` rows, every one `onboarding-agent` — those are the standalone
 * dispatches the onboarding kind happens to make, an accident of one kind's
 * internals rather than evidence that sessions are ledgered. The authoring
 * session was simply absent.
 *
 * These pin the third pass. The cost itself is NOT re-summed here: it comes
 * from `readSessionLogFacts` → `deriveSessionCostUsd`, the ONE cost rule
 * (bead 7.6.1), so a second formula can never drift from it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectRecentAgentRuns, type AgentHistoryDeps } from '../../bridge-agents-history-rows.ts';

const KIND = 'authoring';
const SLUG = 'creation-agent';
const SESSION_ID = '2026-09-10T13-22-56-8c06a0bf';
const COST = 0.71176675;

function plant(): { forgeRoot: string; projectsRoot: string; logsRoot: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'b6af-'));
  const projectsRoot = join(forgeRoot, 'projects');
  const sessionDir = join(projectsRoot, 'p1', `_${KIND}`, SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ phase: 'working', project: 'p1' }), 'utf8');
  const logsRoot = join(forgeRoot, '_logs');
  const logDir = join(logsRoot, `_${KIND}-${SESSION_ID}`);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, 'events.jsonl'),
    `${JSON.stringify({ event_id: 'e1', started_at: '2026-09-10T13:22:57.096Z', event_type: 'start' })}\n` +
      `${JSON.stringify({ event_id: 'e2', started_at: '2026-09-10T13:25:19.000Z', event_type: 'end', cost_usd: COST })}\n`,
    'utf8',
  );
  return { forgeRoot, projectsRoot, logsRoot };
}

function deps(projectsRoot: string): AgentHistoryDeps {
  return {
    projectsRoot,
    cachedListRuns: () => [],
    buildAgentSlugToNodeId: () => new Map(),
    loadFlowDefinition: () => ({ id: 'none', nodes: [] }),
    loadSessionKinds: () => [{ id: KIND, agent: SLUG, title: 'Authoring session', legacyRoutes: [] }],
    parseGuardedEventsJsonl: (logsRoot, entry) => {
      const p = join(logsRoot, entry, 'events.jsonl');
      if (!existsSync(p)) return null;
      return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    },
    isTurnAlive: () => false,
    extractErrorMessage: () => '',
    stallCeilingMs: 180_000,
  };
}

test('AT-b6af-1 (RED) an authoring session with a priced event log produces a /monitor row', () => {
  const { forgeRoot, projectsRoot, logsRoot } = plant();
  try {
    const rows = collectRecentAgentRuns(deps(projectsRoot), forgeRoot, logsRoot, 20, 'all');
    const row = rows.find((r) => r.id === SESSION_ID);
    assert.ok(row, `no row for the authoring session — /monitor still cannot show what a session cost. Got: ${JSON.stringify(rows)}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-b6af-2 the row carries the session’s OWN cost and its agent', () => {
  const { forgeRoot, projectsRoot, logsRoot } = plant();
  try {
    const row = collectRecentAgentRuns(deps(projectsRoot), forgeRoot, logsRoot, 20, 'all').find((r) => r.id === SESSION_ID);
    assert.ok(row);
    // The exact figure the session's own log carries — the beat-15 assertion.
    assert.equal(row.costUsd, COST);
    // `data-ledger-agent` reads this. Without it the row is unattributable and
    // a story could never name the session it means.
    assert.deepEqual(row.agents, [SLUG]);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-b6af-3 a session whose log dir does not exist is honestly null, never a fabricated 0', () => {
  // The rule the whole ledger is built on: an absent cost is `null`, not zero.
  // A zero row would tell the operator the session was free.
  const { forgeRoot, projectsRoot, logsRoot } = plant();
  try {
    rmSync(join(logsRoot, `_${KIND}-${SESSION_ID}`), { recursive: true, force: true });
    const row = collectRecentAgentRuns(deps(projectsRoot), forgeRoot, logsRoot, 20, 'all').find((r) => r.id === SESSION_ID);
    assert.ok(row, 'the session still exists and must still be listed');
    assert.equal(row.costUsd, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-b6af-4 kind=flow excludes sessions — the server-side filter still means what it says', () => {
  const { forgeRoot, projectsRoot, logsRoot } = plant();
  try {
    const rows = collectRecentAgentRuns(deps(projectsRoot), forgeRoot, logsRoot, 20, 'flow');
    assert.equal(rows.find((r) => r.id === SESSION_ID), undefined);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
