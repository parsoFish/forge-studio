/**
 * Acceptance tests for R6-05's additive `RunPhaseMeta.findings` field —
 * `orchestrator/run-model.ts`'s `RunPhaseMeta` type (mirrored client-side in
 * `apps/studio/lib/studio-client.ts`) does NOT declare `findings` yet, and
 * `orchestrator/run-model-derive.ts`'s `buildNodeMeta`/`deriveNodeMeta` do
 * not populate one. Every assertion below is a legitimate RED against the
 * CURRENT, unmodified derivation.
 *
 * WHY THIS FIELD EXISTS: R6-05's flow-monitor ledger (`apps/studio/lib/
 * history-ledger.ts` + `flow-ledger.ts`, this initiative's other tasks)
 * needs a real, non-fabricated review-findings count to compose its
 * outcome-narrative segment — D3 forbids free-typed prose, so the narrative
 * needs a genuine data source. `phaseMeta[node].findings` is that source.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED ADDITIVE SHAPE (does not exist yet):
 *
 *   RunPhaseMeta.findings?: {
 *     total: number; blocker: number; major: number; minor: number; info: number;
 *   };
 *
 * Only the five COUNT fields — see measurement (c) below for why `path`/
 * `head_sha` must NOT leak in.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MEASURED GROUNDS (not invented — read from the real producer + the real
 * event-routing code, see the task report for the full trace):
 *
 * (a) THE REAL PRODUCER. `orchestrator/phases/adversarial-review.ts:330-332`:
 *       const counts: Record<string, number> =
 *         { total: harvest.record.findings.length, blocker: 0, major: 0, minor: 0, info: 0 };
 *       for (const f of harvest.record.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
 *       emit('review.findings.authored', { ...counts, path: persisted, head_sha: headSha });
 *     `emit` (same file, ~line 125-139) wraps every call as
 *     `phase: 'orchestrator', skill: AGENT_SLUG, metadata: { agent_slug: AGENT_SLUG, ...metadata }`
 *     where `AGENT_SLUG` is `'adversarial-review'`. So the REAL wire shape of
 *     a `review.findings.authored` event's metadata is
 *     `{ agent_slug: 'adversarial-review', total, blocker, major, minor, info, path, head_sha }`
 *     — SEVEN keys, not five. `path` (a findings.json file path, a string)
 *     and `head_sha` (a commit SHA, a string) are NOT counts and must never
 *     land in a numeric-typed `findings` summary.
 *
 *     Contrast: the journey fixture sugar `adversarialReviewEvent` in
 *     `scripts/journeys/lib/journey-fixtures.mjs:492-501` + its one call site
 *     `scripts/journeys/flows-run.mjs:816` only ever seeds the five COUNT
 *     fields (`{ total: 1, blocker: 0, major: 0, minor: 1, info: 0 }`) — the
 *     journey fixture is NOT fully faithful to the real producer (it never
 *     seeds `path`/`head_sha`). That drift is out of this round's scope (no
 *     edits under `scripts/journeys/` this round), but the derivation under
 *     test must be correct against the REAL, 7-key shape, not just the
 *     journey's trimmed one — test (c) below uses the real 7-key shape.
 *
 * (b) NODE RESOLUTION. `eventToNodeId` (run-model-derive.ts:781-809): for
 *     `phase === 'orchestrator'`, `metadata.agent_slug` is looked up in
 *     `agentSlugToNodeId` FIRST, before the canonical nodeMapping/orchestrator
 *     -> null override ever applies. `buildAgentSlugToNodeId` (run-model.ts:
 *     309+) builds that map from every flow.yaml under studio/flows/'s
 *     `{id, agent}` node declarations; `studio/flows/forge-develop/
 *     flow.yaml:38` declares `{ id: adversarial-review, agent: adversarial-review }`
 *     — so `agent_slug: 'adversarial-review'` resolves to nodeId
 *     `'adversarial-review'`, the SAME frozen generic-agent contract the demo
 *     node already uses (R2-01-F4). This file traces the real flow.yaml +
 *     the real eventToNodeId/buildAgentSlugToNodeId code rather than driving
 *     a live cycle end-to-end (read, not executed live — see task report).
 *
 * (c) HONEST-ABSENT PRECEDENT. `phaseMeta` keys are events-derived, not
 *     flow-derived (a declared node that never emitted has NO phaseMeta
 *     entry at all — deriveNodeMeta buckets by event, run-model-derive.ts:
 *     124-131), and within an existing node's meta, optional fields are only
 *     set when the underlying fact exists (buildNodeMeta:189-196, e.g.
 *     `if (gateChecks !== undefined && gateChecks.length > 0) meta.gateChecks = ...`).
 *     `findings` must follow the SAME convention: no event -> no key, never a
 *     fabricated `{total:0,...}`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeMeta, deriveNodeMeta } from './run-model-derive.ts';
import type { EventLogEntry, Phase } from '@forge/kernel';
import type { RunPhaseMeta } from './run-model.ts';

// ---------------------------------------------------------------------------
// helpers — mirrors orchestrator/run-model-derive.test.ts's `ev()` house style
// ---------------------------------------------------------------------------

let seq = 0;
function ev(
  phase: Phase | string,
  event_type: string,
  opts: {
    cost_usd?: number;
    message?: string;
    metadata?: Record<string, unknown>;
  } = {},
): EventLogEntry {
  seq += 1;
  return {
    event_id: `ef-${seq}`,
    cycle_id: 'CYCLE-findings-test',
    initiative_id: 'INIT-findings-test',
    phase: phase as Phase,
    skill: phase as string,
    event_type,
    input_refs: [],
    output_refs: [],
    started_at: new Date(Date.now() + seq).toISOString(), // monotonically increasing for latest-wins tests
    ...(opts.cost_usd !== undefined ? { cost_usd: opts.cost_usd } : {}),
    ...(opts.message !== undefined ? { message: opts.message } : {}),
    ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
  } as EventLogEntry;
}

/** The real wire event, exactly as `adversarial-review.ts:125-139,332` emits it. */
function findingsEvent(counts: { total: number; blocker: number; major: number; minor: number; info: number }, extra: Record<string, unknown> = {}) {
  return ev('orchestrator', 'log', {
    message: 'review.findings.authored',
    metadata: { agent_slug: 'adversarial-review', ...counts, path: 'artifacts/review-findings.json', head_sha: 'abc123def456', ...extra },
  });
}

const AGENT_SLUG_MAP = new Map<string, string>([['adversarial-review', 'adversarial-review'], ['demo-agent', 'demo']]);
const CANONICAL_MAPPING = new Map<string, string | null>([
  ['developer-loop', 'dev'],
  ['orchestrator', null], // orchestrator events fall to null UNLESS agent_slug resolves first (b)
]);

function meta(events: readonly EventLogEntry[]): RunPhaseMeta & { findings?: { total: number; blocker: number; major: number; minor: number; info: number } } {
  return buildNodeMeta('adversarial-review', events, 8, Date.now());
}

// ---------------------------------------------------------------------------
// buildNodeMeta — the per-node derivation
// ---------------------------------------------------------------------------

test('buildNodeMeta: adversarial-review carries findings mirroring the event counts verbatim', () => {
  // KILLS: a derivation that drops the field entirely, or that fabricates
  // its own counts (e.g. always {total:0,...}) instead of reading the event.
  const m = meta([findingsEvent({ total: 4, blocker: 1, major: 1, minor: 2, info: 0 })]);
  assert.deepEqual(m.findings, { total: 4, blocker: 1, major: 1, minor: 2, info: 0 });
});

test('buildNodeMeta: findings carries ONLY the five count fields — path/head_sha never leak in', () => {
  // KILLS: `findings: { ...metadata }` (a naive spread of the whole event
  // metadata object), which would smuggle `agent_slug` (string), `path`
  // (string) and `head_sha` (string) into what must be a pure numeric
  // summary. Uses the REAL 7-key production shape (measurement (a)), not
  // the journey fixture's trimmed 5-key one.
  const m = meta([findingsEvent({ total: 1, blocker: 0, major: 0, minor: 1, info: 0 })]);
  assert.deepEqual(m.findings, { total: 1, blocker: 0, major: 0, minor: 1, info: 0 });
  assert.equal(Object.keys(m.findings ?? {}).length, 5, `findings must carry exactly 5 keys, got ${JSON.stringify(m.findings)}`);
  assert.ok(!('path' in (m.findings ?? {})), 'path must not appear on the findings summary');
  assert.ok(!('head_sha' in (m.findings ?? {})), 'head_sha must not appear on the findings summary');
  assert.ok(!('agent_slug' in (m.findings ?? {})), 'agent_slug must not appear on the findings summary');
});

test('buildNodeMeta: a node with no review.findings.authored event carries NO findings key (honest-absent, not a fabricated zero)', () => {
  // KILLS: `findings: { total: 0, blocker: 0, major: 0, minor: 0, info: 0 }`
  // as a default — the same class of defect `gateChecks`'s
  // `if (gateChecks.length > 0)` guard already avoids for a different field.
  // These events ARE on the adversarial-review node (start/end), just none
  // of them is the findings-authoring one.
  const m = meta([
    ev('orchestrator', 'start', { metadata: { agent_slug: 'adversarial-review' }, message: 'review-node.start' }),
    ev('orchestrator', 'end', { metadata: { agent_slug: 'adversarial-review' }, message: 'review.end', cost_usd: 0.47 }),
  ]);
  assert.equal('findings' in m, false, `expected no findings key, got ${JSON.stringify(m.findings)}`);
  assert.equal(m.findings, undefined);
});

test('buildNodeMeta: on a retried review, the LATEST review.findings.authored event wins — never summed, never the first', () => {
  // KILLS two distinct wrong implementations at once: (1) summing every
  // findings-authored event on the node (would yield total:4, the WRONG
  // arithmetic sum of 3+1), and (2) taking the FIRST event instead of the
  // latest (would report the stale total:3 after a real re-review reduced
  // it to total:1). `ev()`'s monotonically increasing started_at makes the
  // array order the real temporal order.
  const stale = findingsEvent({ total: 3, blocker: 1, major: 1, minor: 1, info: 0 });
  const fresh = findingsEvent({ total: 1, blocker: 0, major: 0, minor: 1, info: 0 });
  const m = meta([stale, fresh]);

  assert.deepEqual(m.findings, { total: 1, blocker: 0, major: 0, minor: 1, info: 0 }, `expected the LATEST event's counts, got ${JSON.stringify(m.findings)}`);
  assert.notDeepEqual(m.findings, { total: 4, blocker: 1, major: 1, minor: 2, info: 0 }); // the naive sum
  assert.notDeepEqual(m.findings, { total: 3, blocker: 1, major: 1, minor: 1, info: 0 }); // the stale first
});

test('buildNodeMeta: a clean-pass review (all-zero counts) still populates findings — zero counts are a real fact, not "nothing happened"', () => {
  // KILLS: treating a zero-valued findings object the same as "absent" (an
  // over-eager falsy-check like `if (counts.total) meta.findings = counts`
  // would drop a genuine clean pass, indistinguishable from a review that
  // never ran at all — the exact "clean pass vs no review" confusion R6-01's
  // own ReviewFindingsPanel test already guards against on a sibling surface,
  // flow-run-detail-render.test.ts:447-458). Presence of the EVENT, not a
  // truthy total, is what must gate the key.
  const m = meta([findingsEvent({ total: 0, blocker: 0, major: 0, minor: 0, info: 0 })]);
  assert.ok('findings' in m, 'a clean pass must still set the findings key (the event fired)');
  assert.deepEqual(m.findings, { total: 0, blocker: 0, major: 0, minor: 0, info: 0 });
});

// ---------------------------------------------------------------------------
// deriveNodeMeta — the event-routing/bucketing layer (phantom-node guard)
// ---------------------------------------------------------------------------

test('deriveNodeMeta: a run whose adversarial-review node never ran gets NO phaseMeta entry — not a phantom node with empty findings', () => {
  // KILLS: iterating every node the flow COULD declare and pre-seeding an
  // entry for it (the standing "declared-data-fails-open" antipattern in
  // reverse — here it would be "declared node fabricates a phantom entry").
  // Every event below belongs to 'dev'; adversarial-review emitted nothing.
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'end', { message: 'ralph.end', cost_usd: 1.2 }),
  ];
  const result = deriveNodeMeta(events, 8, Date.now(), CANONICAL_MAPPING, AGENT_SLUG_MAP);

  assert.equal('adversarial-review' in result, false, `expected no phantom adversarial-review entry, got ${JSON.stringify(result['adversarial-review'])}`);
  assert.ok('dev' in result, 'precondition: the dev node DOES have events');
});

test('deriveNodeMeta: review.findings.authored resolves via phase:orchestrator + metadata.agent_slug, onto the adversarial-review node ONLY', () => {
  // KILLS: misattributing the event to a different node (e.g. 'review', the
  // gate-only node it feeds into but does not equal — a plausible confusion
  // since the flow edge is `adversarial-review -> review`), and any
  // implementation that lets a findings event contaminate an unrelated
  // node's meta. Runs a REAL dev-loop stream alongside it so a leak would be
  // observable on 'dev' too.
  const events = [
    ev('developer-loop', 'start'),
    ev('developer-loop', 'iteration', { cost_usd: 0.5 }),
    ev('developer-loop', 'end', { message: 'ralph.end', cost_usd: 0.5 }),
    findingsEvent({ total: 2, blocker: 0, major: 1, minor: 1, info: 0 }),
  ];
  const result = deriveNodeMeta(events, 8, Date.now(), CANONICAL_MAPPING, AGENT_SLUG_MAP);

  assert.deepEqual(result['adversarial-review']?.findings, { total: 2, blocker: 0, major: 1, minor: 1, info: 0 });
  assert.equal('findings' in (result['dev'] ?? {}), false, 'the findings event must not leak onto the dev node');
  assert.equal('review' in result, false, 'the gate-only "review" node (fed BY adversarial-review, not equal to it) must not receive a phantom entry either');
});
