/**
 * Acceptance tests — Home dashboard derivation (R6-07).
 *
 * THE DEFECT CLASS: declared-data-fails-open. The mockup
 * (mockups/studio-endstate-v2/views-home.jsx + data.jsx) invents
 * `flow.status` / `agent.status` / `kb.status` fields that do not exist on
 * the real wire types (`Flow`, `Agent`, `Project`, `Kb` in ./studio-client —
 * none carry a `status` field). Live status on Home MUST be DERIVED from the
 * run-model (`Run[]` from `fetchRuns()`) and the attention aggregate
 * (`ProjectAttentionItem[]` from `fetchProjectAttention()`), never read off
 * a fabricated field. Every fixture below deliberately constructs Flow /
 * Agent / Kb objects WITHOUT a `status` property — TypeScript itself refuses
 * to compile one in, which is the point: a wrong implementation that reads
 * `flow.status` has nowhere on the real type to read it from.
 *
 * RUN: cd forge-ui && npx vitest run lib/home-view.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveFlowStatus,
  deriveAgentStatus,
  deriveProjectStatus,
  buildConstellation,
  buildHomeAttention,
  // forge-2am/n5r (R6-07 batch-H honesty pass) — NOT exported yet at pin
  // time: both resolve to `undefined` under this repo's vitest module
  // runner (same "missing named export resolves to undefined, not a
  // collection-time throw" convention studio-client.test.ts's
  // fetchContractStages/bootstrapKb pins already document), so this import
  // alone does not disturb any of the already-green tests above — only the
  // new tests below that actually CALL these two go red, on an honest
  // "is not a function" reason.
  buildKbAttention,
  runsForFlow,
  // W6-IA-4 additions
  GATE_ATTENTION_STATUS_FRAME,
  gateAttentionStatusDot,
  deriveWatchLiveRunHref,
  buildHomeLedgerRows,
  // W6-B11 additions
  buildHomeSessionsStrip,
  HOME_SESSIONS_STRIP_LIMIT,
  type HomeHex,
  type HomeAttentionItem,
} from './home-view.ts';
import type { Flow, Agent, Project, Kb, Run, FlowNode, KbLintSummary, SessionIndexRow } from './studio-client.ts';
import type { ProjectAttentionItem } from './bridge-client.ts';
import type { LedgerRow } from './history-ledger.ts';

// ---- fixtures --------------------------------------------------------------

function makeFlow(id: string, nodes: FlowNode[] = []): Flow {
  return { id, name: id, goal: '', nodes, edges: [], triggers: [] };
}

function makeAgent(id: string): Agent {
  return { id, name: id, purpose: '', skills: [], tools: [], mcps: [], guards: [], hooks: [] };
}

function makeProject(id: string): Project {
  return { id, name: id, skills: [] };
}

// FORCED EDIT (Kb gains required `lint`/`provenance` fields, forge-2am/3oq
// seam): every existing makeKb('kbN') call site below keeps compiling
// unchanged because both new fields default here — `lint: null` /
// `provenance: 'unknown'` are themselves the HONEST defaults (absence, never
// a fabricated clean verdict or a guessed shipped/authored claim).
//
// BEFORE:
//   function makeKb(id: string): Kb {
//     return { id, name: id, binding: { kind: 'unique' }, counts: { index: 0, themes: 0, raw: 0 } };
//   }
function makeKb(id: string, overrides: Partial<Pick<Kb, 'lint' | 'provenance'>> = {}): Kb {
  return {
    id,
    name: id,
    binding: { kind: 'unique' },
    counts: { index: 0, themes: 0, raw: 0 },
    lint: null,
    provenance: 'unknown',
    ...overrides,
  };
}

function makeLint(overrides: Partial<KbLintSummary> = {}): KbLintSummary {
  return { errors: 0, flags: 0, checksRun: 1, checksTotal: 10, ...overrides };
}

/**
 * FORCED EDIT (HomeAttentionItem widens to a `{kind:'gate';...} |
 * {kind:'kb';...}` discriminated union, forge-2am seam): `.projectId` only
 * exists on the 'gate' variant, so the pre-existing buildHomeAttention tests
 * further down that read `.projectId` directly need a narrow first —
 * TypeScript can no longer infer it from the (now-widened)
 * HomeAttentionItem[] return type alone. Narrows-or-throws (rather than a
 * silent `as`) so a wrong implementation that returns a 'kb' item from
 * buildHomeAttention fails LOUDLY here instead of the assertion below just
 * seeing `undefined`.
 */
function asGateItem(item: HomeAttentionItem): Extract<HomeAttentionItem, { kind: 'gate' }> {
  if (item.kind !== 'gate') throw new Error(`expected a 'gate' attention item, got kind="${item.kind}"`);
  return item;
}

function makeRun(overrides: Partial<Run> & { id: string; flowId: string }): Run {
  return {
    initiativeId: overrides.id,
    initiative: overrides.id,
    status: 'active',
    origin: 'architect',
    costUsd: 0,
    phases: {},
    phaseMeta: {},
    artifactsReady: {},
    flowLineage: [overrides.flowId],
    ...overrides,
  };
}

function makeAttention(overrides: Partial<ProjectAttentionItem> & { projectId: string }): ProjectAttentionItem {
  return {
    name: overrides.projectId,
    link: `/projects/${overrides.projectId}/roadmap`,
    planned: 0,
    inFlight: 0,
    gated: 0,
    merged: 0,
    flagged: 0,
    ...overrides,
  };
}

// ---- deriveFlowStatus: the ruling-49 core ----------------------------------

test('deriveFlowStatus: a gated run on the flow -> hex status "gated"', () => {
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'gated' })];
  expect(deriveFlowStatus('f1', runs)).toBe('gated');
});

test('deriveFlowStatus: flip the run to active -> hex status "active" (active wins over gated)', () => {
  const runs = [
    makeRun({ id: 'r1', flowId: 'f1', status: 'gated' }),
    makeRun({ id: 'r2', flowId: 'f1', status: 'active' }),
  ];
  expect(deriveFlowStatus('f1', runs)).toBe('active');
});

test('deriveFlowStatus: no matching run at all -> "idle" (not a fabricated status)', () => {
  // Kills an impl that defaults to 'active'/'gated' when it can't find the
  // flow.status field it wrongly expects to exist.
  expect(deriveFlowStatus('f1', [])).toBe('idle');
});

test('deriveFlowStatus: removing the run drops the flow back to "idle"', () => {
  const withRun = deriveFlowStatus('f1', [makeRun({ id: 'r1', flowId: 'f1', status: 'active' })]);
  const withoutRun = deriveFlowStatus('f1', []);
  expect(withRun).toBe('active');
  expect(withoutRun).toBe('idle');
});

test('deriveFlowStatus: flowLineage path — a threaded run whose flowId is elsewhere still lights up f1', () => {
  // Kills an impl that only checks run.flowId and ignores flowLineage, which
  // would leave a threaded spine run's traversed flows permanently 'idle'.
  const runs = [makeRun({ id: 'r1', flowId: 'x', flowLineage: ['forge-architect', 'f1', 'forge-reflect'], status: 'active' })];
  expect(deriveFlowStatus('f1', runs)).toBe('active');
});

// ---- deriveAgentStatus ------------------------------------------------------

test('deriveAgentStatus: active iff an active run has an active phase on a node this agent owns', () => {
  const node: FlowNode = { id: 'dev', agent: 'developer' };
  const flows = [makeFlow('f1', [node])];
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'active', phases: { dev: 'active' } })];
  const agent = makeAgent('developer');
  expect(deriveAgentStatus(agent, flows, runs)).toBe('active');
});

test('deriveAgentStatus: idle when the owning node\'s phase is pending, not active', () => {
  const node: FlowNode = { id: 'dev', agent: 'developer' };
  const flows = [makeFlow('f1', [node])];
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'active', phases: { dev: 'pending' } })];
  const agent = makeAgent('developer');
  expect(deriveAgentStatus(agent, flows, runs)).toBe('idle');
});

test('deriveAgentStatus: idle when no flow node references this agent at all', () => {
  // Kills an impl that defaults an unmapped agent to 'active' rather than
  // failing closed to 'idle'.
  const flows = [makeFlow('f1', [{ id: 'dev', agent: 'someone-else' }])];
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'active', phases: { dev: 'active' } })];
  const agent = makeAgent('developer');
  expect(deriveAgentStatus(agent, flows, runs)).toBe('idle');
});

// ---- deriveProjectStatus -----------------------------------------------------

test('deriveProjectStatus: gated > 0 -> "gated"', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 1, inFlight: 3 })];
  expect(deriveProjectStatus('p1', attention)).toBe('gated');
});

test('deriveProjectStatus: no gated but inFlight > 0 -> "active"', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 0, inFlight: 2 })];
  expect(deriveProjectStatus('p1', attention)).toBe('active');
});

test('deriveProjectStatus: nothing gated or in flight -> "idle"', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 0, inFlight: 0 })];
  expect(deriveProjectStatus('p1', attention)).toBe('idle');
});

test('deriveProjectStatus: project absent from the attention list -> "idle" (fail closed, not fabricated)', () => {
  expect(deriveProjectStatus('missing', [])).toBe('idle');
});

// ---- buildConstellation ------------------------------------------------------

test('buildConstellation: one hex per object, correct glyph per kind, count == flows+agents+projects+kbs', () => {
  const flows = [makeFlow('f1'), makeFlow('f2')];
  const agents = [makeAgent('a1')];
  const projects = [makeProject('p1')];
  const kbs = [makeKb('kb1'), makeKb('kb2'), makeKb('kb3')];
  const hexes = buildConstellation({ flows, agents, projects, kbs, runs: [], attention: [] });

  expect(hexes).toHaveLength(flows.length + agents.length + projects.length + kbs.length);

  const byKind = (kind: HomeHex['kind']) => hexes.filter((h) => h.kind === kind);
  expect(byKind('flow')).toHaveLength(2);
  expect(byKind('agent')).toHaveLength(1);
  expect(byKind('project')).toHaveLength(1);
  expect(byKind('kb')).toHaveLength(3);

  for (const h of byKind('flow')) expect(h.glyph).toBe('⬡');
  for (const h of byKind('agent')) expect(h.glyph).toBe('⬢');
  for (const h of byKind('kb')) expect(h.glyph).toBe('◈');
});

test('buildConstellation: every hex href points at its OWNING surface', () => {
  const flows = [makeFlow('f1')];
  const agents = [makeAgent('a1')];
  const projects = [makeProject('p1')];
  const kbs = [makeKb('kb1')];
  const hexes = buildConstellation({ flows, agents, projects, kbs, runs: [], attention: [] });

  const flowHex = hexes.find((h) => h.kind === 'flow' && h.id === 'f1')!;
  const agentHex = hexes.find((h) => h.kind === 'agent' && h.id === 'a1')!;
  const projectHex = hexes.find((h) => h.kind === 'project' && h.id === 'p1')!;
  const kbHex = hexes.find((h) => h.kind === 'kb' && h.id === 'kb1')!;

  expect(flowHex.href).toBe('/flows/f1');
  expect(agentHex.href).toBe('/agents/a1');
  expect(projectHex.href).toBe('/projects/p1');
  // KB surface prefix only — the exact kb detail route is not pinned here.
  expect(kbHex.href.startsWith('/knowledge')).toBe(true);
});

test('buildConstellation: kb status is always "idle" — no live read exists for KBs', () => {
  const kbs = [makeKb('kb1')];
  const hexes = buildConstellation({ flows: [], agents: [], projects: [], kbs, runs: [], attention: [] });
  expect(hexes[0].status).toBe('idle');
});

test('buildConstellation: hex status equals the derive* result for each object (flow + project cases)', () => {
  const flows = [makeFlow('f1')];
  const projects = [makeProject('p1')];
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'gated' })];
  const attention = [makeAttention({ projectId: 'p1', gated: 2 })];

  const hexes = buildConstellation({ flows, agents: [], projects, kbs: [], runs, attention });

  const flowHex = hexes.find((h) => h.kind === 'flow' && h.id === 'f1')!;
  const projectHex = hexes.find((h) => h.kind === 'project' && h.id === 'p1')!;

  expect(flowHex.status).toBe(deriveFlowStatus('f1', runs));
  expect(flowHex.status).toBe('gated');
  expect(projectHex.status).toBe(deriveProjectStatus('p1', attention));
  expect(projectHex.status).toBe('gated');
});

// ---- buildHomeAttention (mirrors R4-11-F4) -----------------------------------

test('buildHomeAttention: nothing gated and nothing flagged -> empty array (fires only on a real condition)', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 0, flagged: 0, inFlight: 5 })];
  expect(buildHomeAttention(attention)).toEqual([]);
});

test('buildHomeAttention: gated > 0 -> exactly one item, href/projectId pulled from the source row', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 2, link: '/projects/p1/roadmap' })];
  const items = buildHomeAttention(attention);
  expect(items).toHaveLength(1);
  expect(items[0].href).toBe('/projects/p1/roadmap');
  // FORCED EDIT (union-type change): was `items[0].projectId` — see asGateItem's header comment above.
  expect(asGateItem(items[0]).projectId).toBe('p1');
  expect(items[0].kind).toBe('gate');
});

test('buildHomeAttention: flagged > 0 alone (no gated) also fires', () => {
  const attention = [makeAttention({ projectId: 'p2', gated: 0, flagged: 1, link: '/projects/p2/roadmap' })];
  const items = buildHomeAttention(attention);
  expect(items).toHaveLength(1);
  // FORCED EDIT (union-type change): was `items[0].projectId` — see asGateItem's header comment above.
  expect(asGateItem(items[0]).projectId).toBe('p2');
});

test('buildHomeAttention: mixed list only surfaces the rows that actually need attention', () => {
  const attention = [
    makeAttention({ projectId: 'quiet', gated: 0, flagged: 0, inFlight: 9 }),
    makeAttention({ projectId: 'noisy', gated: 1, flagged: 0 }),
  ];
  const items = buildHomeAttention(attention);
  // FORCED EDIT (union-type change): was `items.map((i) => i.projectId)` — see asGateItem's header comment above.
  expect(items.map((i) => asGateItem(i).projectId)).toEqual(['noisy']);
});

// ---- runsForFlow (forge-n5r): the ONE flow<->run matcher -------------------
//
// deriveFlowStatus already has the RIGHT predicate inline (this file's own
// `r.flowId === flowId || r.flowLineage.includes(flowId)`, above); the
// defect is that it isn't EXTRACTED, so FlowCard (LibraryCard.tsx:115) and
// the flow monitor (app/flows/[id]/page.tsx:101) each keep their own copy —
// one of which (LibraryCard.tsx) drops flowLineage entirely
// (`runs.filter(r => r.flowId === flow.id)`). These tests pin runsForFlow as
// the ONE shared matcher and pin deriveFlowStatus as BUILT ON it, not merely
// agreeing with it by coincidence.

test('runsForFlow: matches a run by direct flowId', () => {
  const runs = [makeRun({ id: 'r1', flowId: 'f1', status: 'active' })];
  expect(runsForFlow('f1', runs).map((r) => r.id)).toEqual(['r1']);
});

test('runsForFlow: matches a run by flowLineage even when flowId is a DIFFERENT flow', () => {
  // Kills LibraryCard.tsx's `runs.filter(r => r.flowId === flow.id)` — the
  // exact defect this AT is named for.
  const runs = [makeRun({ id: 'r1', flowId: 'forge-architect', flowLineage: ['forge-architect', 'f1'], status: 'active' })];
  expect(runsForFlow('f1', runs).map((r) => r.id)).toEqual(['r1']);
});

test('runsForFlow: excludes a run matching neither flowId nor flowLineage', () => {
  const runs = [makeRun({ id: 'r1', flowId: 'other', flowLineage: ['other'], status: 'active' })];
  expect(runsForFlow('f1', runs)).toEqual([]);
});

test('deriveFlowStatus agrees with a status hand-computed from runsForFlow() for a lineage-only run — proves deriveFlowStatus is BUILT ON runsForFlow, not a second independent predicate', () => {
  const runs = [
    makeRun({ id: 'r1', flowId: 'forge-architect', flowLineage: ['forge-architect', 'f1'], status: 'gated' }),
  ];
  const viaRunsForFlow = runsForFlow('f1', runs).some((r) => r.status === 'gated') ? 'gated' : 'idle';
  expect(deriveFlowStatus('f1', runs)).toBe(viaRunsForFlow);
  expect(deriveFlowStatus('f1', runs)).toBe('gated'); // sanity: a real, non-vacuous status
});

// ---- SOURCE: the flowLineage predicate collapses to ONE copy ---------------

test('SOURCE: the flowLineage-matching predicate exists in EXACTLY ONE file under forge-ui/ — lib/home-view.ts (runsForFlow). Every other consumer (FlowCard, the flow monitor) must call runsForFlow/deriveFlowStatus, never re-write the predicate inline', () => {
  // A plain literal search for "flowLineage.includes(" under-counts today: it
  // misses app/flows/[id]/page.tsx's own copy, which spells the SAME
  // predicate as `(r.flowLineage ?? []).includes(id)` — a `?? []` null-guard
  // sits between the property read and the `.includes(` call. This regex
  // matches BOTH spellings of the inline predicate (with or without the
  // `?? []` guard) so the count is honest about how many copies exist today.
  //
  // Verified against the real tree before writing this test (`node -e`
  // walking forge-ui/**/*.{ts,tsx} with this exact regex): TWO PRODUCTION
  // matches today — lib/home-view.ts (line 55) + app/flows/[id]/page.tsx
  // (line 101). RED at pin: after the fix only lib/home-view.ts's own
  // runsForFlow definition should remain, so `elsewhere` below must become
  // `[]`.
  //
  // Exclusion needed, confirmed by actually running this test once before
  // finalising it: `.test.ts`/`.test.tsx` files ARE excluded from the walk.
  // THIS FILE would otherwise self-match — the explanatory prose two
  // paragraphs up literally quotes the predicate shape
  // "(r.flowLineage ?? []).includes(id)" for documentation, which is
  // indistinguishable from a real third copy to a plain-text regex scan.
  // Fixture-only files (`flowLineage: [...]` assignments, never
  // `.includes(` calls) would not have needed the exclusion on their own,
  // but every test file is excluded uniformly rather than special-casing
  // "no comment happens to quote the shape" per file.
  //
  // Exclusion considered and NOT needed: lib/studio-client.ts's
  // `flowLineage:   r.flowLineage   ?? [],` (parseRun's field-default
  // assignment) has no `.includes(` after it, so the regex never matches it
  // — verified directly, no exclusion required for it.
  const forgeUiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const LINEAGE_PREDICATE_RE = /flowLineage(\s*\?\?\s*\[\]\s*\))?\s*\.includes\(/;

  function walk(dir: string, out: string[]): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p);
    }
    return out;
  }

  const matches = walk(forgeUiRoot, [])
    .filter((f) => LINEAGE_PREDICATE_RE.test(readFileSync(f, 'utf8')))
    .map((f) => relative(forgeUiRoot, f));

  const HOME_VIEW = join('lib', 'home-view.ts');
  const elsewhere = matches.filter((f) => f !== HOME_VIEW);
  expect(elsewhere, `the lineage predicate must live ONLY in lib/home-view.ts; also found in: ${JSON.stringify(elsewhere)}`).toEqual([]);
});

// ---- type invariant: derive-dont-store (no stored .status field) ----------

test('Flow/Agent/Project/Kb carry no stored `.status` field — a wrong "fix" that stores status instead of deriving it has nowhere to write, and this guard has nowhere to read', () => {
  const flow = makeFlow('f1');
  const agent = makeAgent('a1');
  const project = makeProject('p1');
  const kb = makeKb('kb1');
  expect('status' in flow).toBe(false);
  expect('status' in agent).toBe(false);
  expect('status' in project).toBe(false);
  expect('status' in kb).toBe(false);
});

// ---- buildKbAttention (forge-2am): KB rows for the attention strip --------
//
// Mirrors buildHomeAttention's own real-condition rule (see that section's
// header above): a KB row fires ONLY on an honest signal from ITS OWN lint
// summary, never from mere existence, and never folds "no data" into a
// fabricated clean verdict.

test('buildKbAttention: errors > 0 -> status "fail"', () => {
  const kbs = [makeKb('kb1', { lint: makeLint({ errors: 2 }) })];
  const items = buildKbAttention(kbs);
  expect(items).toHaveLength(1);
  expect(items[0].status).toBe('fail');
});

test('buildKbAttention: flags > 0 with errors 0 -> status "warn"', () => {
  const kbs = [makeKb('kb1', { lint: makeLint({ flags: 3 }) })];
  const items = buildKbAttention(kbs);
  expect(items).toHaveLength(1);
  expect(items[0].status).toBe('warn');
});

test('buildKbAttention: lint.error present -> status "unknown", even when errors/flags are also 0', () => {
  const kbs = [makeKb('kb1', { lint: makeLint({ error: 'lint run threw' }) })];
  const items = buildKbAttention(kbs);
  expect(items).toHaveLength(1);
  expect(items[0].status).toBe('unknown');
});

test('buildKbAttention: an all-zero clean lint -> NO row (existence alone never fires a row)', () => {
  // Kills a row fabricated from mere KB existence.
  const kbs = [makeKb('kb1', { lint: makeLint() })];
  expect(buildKbAttention(kbs)).toEqual([]);
});

test('buildKbAttention: lint === null -> NO row (absence is honest; a fabricated "clean" row is not)', () => {
  // Kills folding "no data" into a clean verdict.
  const kbs = [makeKb('kb1', { lint: null })];
  expect(buildKbAttention(kbs)).toEqual([]);
});

test("buildKbAttention: row numbers come from the KB's OWN lint summary — a 2-KB fixture where only one is dirty proves no cross-KB attribution", () => {
  const kbs = [
    makeKb('clean-kb', { lint: makeLint({ errors: 0, flags: 0, checksRun: 9, checksTotal: 9 }) }),
    makeKb('dirty-kb', { lint: makeLint({ errors: 1, flags: 2, checksRun: 3, checksTotal: 10 }) }),
  ];
  const items = buildKbAttention(kbs);
  expect(items).toHaveLength(1);
  const row = items[0];
  if (row.kind !== 'kb') throw new Error('expected a kb row');
  expect(row.kbId).toBe('dirty-kb');
  expect(row.lint.errors).toBe(1);
  expect(row.lint.flags).toBe(2);
  expect(row.lint.checksRun).toBe(3);
  expect(row.lint.checksTotal).toBe(10);
});

test('buildKbAttention: checksRun < checksTotal is surfaced on the row verbatim — the n/a-invariant reaching the operator', () => {
  // Kills a row that implies a full clean sweep when most checks never
  // actually inspected this KB (only checkProjectBrainIndexes's
  // project-indexes scope applies to a project-brain KB; the other ~9
  // forge-themes/global checks never touched it — see cli/brain-lint.ts's
  // CHECK_SCOPE).
  const kbs = [makeKb('kb1', { lint: makeLint({ flags: 1, checksRun: 1, checksTotal: 10 }) })];
  const items = buildKbAttention(kbs);
  const row = items[0];
  if (row.kind !== 'kb') throw new Error('expected a kb row');
  expect(row.lint.checksRun).toBe(1);
  expect(row.lint.checksTotal).toBe(10);
  expect(row.lint.checksRun < row.lint.checksTotal).toBe(true);
});

test('buildKbAttention: row id is kb-<id>, href is /knowledge?id=<id>&tab=health (deep-links straight to the tab the finding lives on)', () => {
  const kbs = [makeKb('my-kb', { lint: makeLint({ errors: 1 }) })];
  const items = buildKbAttention(kbs);
  expect(items[0].id).toBe('kb-my-kb');
  expect(items[0].href).toBe('/knowledge?id=my-kb&tab=health');
});

test('buildKbAttention: gate rows from buildHomeAttention are unaffected by KB rows — the two functions tag `kind` independently and neither leaks into the other', () => {
  const attention = [makeAttention({ projectId: 'p1', gated: 1 })];
  const kbs = [makeKb('kb1', { lint: makeLint({ errors: 1 }) })];
  const gateItems = buildHomeAttention(attention);
  const kbItems = buildKbAttention(kbs);
  expect(gateItems.every((i) => i.kind === 'gate')).toBe(true);
  expect(kbItems.every((i) => i.kind === 'kb')).toBe(true);
  expect([...gateItems, ...kbItems]).toHaveLength(2);
});

// ---- SOURCE: purity + no-new-fetch guards (forge-2am) ----------------------
//
// Restates scripts/home-no-new-polling.test.ts's contract at the forge-ui
// vitest level, scoped to what buildKbAttention's arrival must NOT change:
// home-view.ts stays a pure derivation (kbs are ALREADY-FETCHED input, same
// as flows/agents/projects/runs/attention today), and app/page.tsx gains no
// fetch identifier beyond app/library/page.tsx's existing set — the park
// record's explicit refusal of an N-fan-out `Promise.all(kbs.map(fetchKb))`.
// These currently pass (nothing has regressed yet) — they are forward
// guards, not RED pins for new behaviour.

test('SOURCE: lib/home-view.ts stays pure after buildKbAttention — no fetch(, no /api/, no await, no subscribe(', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'home-view.ts'), 'utf8');
  expect(/\bfetch\(/.test(src)).toBe(false);
  expect(src.includes('/api/')).toBe(false);
  expect(/\bawait\b/.test(src)).toBe(false);
  expect(/\bsubscribe\(/.test(src)).toBe(false);
});

// W6-IA-4: this SOURCE test used to compare app/page.tsx's fetch
// identifiers against app/library/page.tsx's own set — Home and the OLD
// Library landing page byte-duplicated the exact same loadAll/refreshRuns/
// subscribe() shape (sweep finding C1#5), so "Home's fetch identifiers are
// a subset of Library's" was a real, meaningful guard against a bespoke
// Home-only endpoint. W6-IA-4 EXTRACTS that shape into ONE shared hook
// (lib/use-studio-home-data.ts) — app/page.tsx no longer contains any of
// these identifiers directly, and the rebuilt Library page's five shelves
// (skills/hooks/connections/templates/community) read entirely different
// sources, so "subset of Library's set" is no longer a meaningful
// invariant to state. The guard this test existed to enforce — no bespoke
// Home-only fetch/endpoint invented — now lives on the EXTRACTED hook
// itself, checked directly rather than by comparison to a sibling page.
test('SOURCE: lib/use-studio-home-data.ts only calls the pre-existing fetchStudioFlows/Agents/Projects/Kbs/fetchRuns/fetchProjectAttention/subscribe — no bespoke endpoint, no per-KB fan-out fetch', () => {
  const forgeUiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const hookSrc = readFileSync(join(forgeUiRoot, 'lib', 'use-studio-home-data.ts'), 'utf8');
  const ALLOWED = ['fetchStudioFlows', 'fetchStudioAgents', 'fetchStudioProjects', 'fetchStudioKbs', 'fetchRuns', 'fetchProjectAttention', 'subscribe'];
  const usedIds = ALLOWED.filter((id) => new RegExp(`\\b${id}\\b`).test(hookSrc));
  expect(usedIds.length, 'the hook must call at least one of the existing fetch* reads').toBeGreaterThan(0);
  // Kills the N-fan-out shape specifically: no per-item fetch helper name
  // (fetchKb, etc.) appears in the hook's source at all.
  expect(/\bfetchKb\b/.test(hookSrc)).toBe(false);
  expect(hookSrc.includes("'/api/")).toBe(false);
  expect(/\bnew WebSocket\(/.test(hookSrc)).toBe(false);
  expect(hookSrc.includes('setInterval(')).toBe(false);
});

test('SOURCE: app/page.tsx sources its six cross-object reads through useStudioHomeData(), not a re-duplicated fetch shape of its own', () => {
  const forgeUiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const homeSrc = readFileSync(join(forgeUiRoot, 'app', 'page.tsx'), 'utf8');
  expect(homeSrc.includes('useStudioHomeData')).toBe(true);
  const ALLOWED = ['fetchStudioFlows', 'fetchStudioAgents', 'fetchStudioProjects', 'fetchStudioKbs', 'fetchProjectAttention'];
  for (const id of ALLOWED) {
    expect(new RegExp(`\\b${id}\\b`).test(homeSrc), `app/page.tsx must not re-declare ${id} — it belongs to the extracted hook`).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// W6-IA-4 sweep finding C1#3 — GATE_ATTENTION_STATUS_FRAME
// ---------------------------------------------------------------------------

test('GATE_ATTENTION_STATUS_FRAME: gated -> retrying, flagged -> failed', () => {
  expect(GATE_ATTENTION_STATUS_FRAME.gated).toBe('retrying');
  expect(GATE_ATTENTION_STATUS_FRAME.flagged).toBe('failed');
});

test('gateAttentionStatusDot: maps the real buildHomeAttention() gate statuses, and fails closed to "pending" for anything unrecognised — never a fabricated guess', () => {
  expect(gateAttentionStatusDot('gated')).toBe('retrying');
  expect(gateAttentionStatusDot('flagged')).toBe('failed');
  expect(gateAttentionStatusDot('something-unexpected')).toBe('pending');
});

test('gateAttentionStatusDot: a real buildHomeAttention() row status round-trips through the frame correctly', () => {
  const gatedItem = asGateItem(buildHomeAttention([makeAttention({ projectId: 'p1', gated: 2 })])[0]);
  expect(gatedItem.status).toBe('gated');
  expect(gateAttentionStatusDot(gatedItem.status)).toBe('retrying');

  const flaggedItem = asGateItem(buildHomeAttention([makeAttention({ projectId: 'p2', gated: 0, flagged: 1 })])[0]);
  expect(flaggedItem.status).toBe('flagged');
  expect(gateAttentionStatusDot(flaggedItem.status)).toBe('failed');
});

// ---------------------------------------------------------------------------
// W6-IA-4 sweep finding C1#2 — deriveWatchLiveRunHref
// ---------------------------------------------------------------------------

test('deriveWatchLiveRunHref: an active run -> that run\'s OWN flow, never a hardcoded flow id', () => {
  const runs = [makeRun({ id: 'r1', flowId: 'onboard-project', status: 'active' })];
  expect(deriveWatchLiveRunHref(runs)).toBe('/flows/onboard-project');
});

test('deriveWatchLiveRunHref: active beats gated when both exist', () => {
  const runs = [
    makeRun({ id: 'r1', flowId: 'forge-architect', status: 'gated' }),
    makeRun({ id: 'r2', flowId: 'forge-develop', status: 'active' }),
  ];
  expect(deriveWatchLiveRunHref(runs)).toBe('/flows/forge-develop');
});

test('deriveWatchLiveRunHref: no active run -> falls back to a gated run\'s flow', () => {
  const runs = [makeRun({ id: 'r1', flowId: 'forge-architect', status: 'gated' })];
  expect(deriveWatchLiveRunHref(runs)).toBe('/flows/forge-architect');
});

test('deriveWatchLiveRunHref: no active or gated run -> falls back to the flows index, never a fabricated specific flow', () => {
  const runs = [makeRun({ id: 'r1', flowId: 'forge-develop', status: 'complete' })];
  expect(deriveWatchLiveRunHref(runs)).toBe('/flows');
});

test('deriveWatchLiveRunHref: an empty runs list falls back to the flows index', () => {
  expect(deriveWatchLiveRunHref([])).toBe('/flows');
});

// ---------------------------------------------------------------------------
// W6-IA-4 — buildHomeLedgerRows: the merged everything-ledger
// ---------------------------------------------------------------------------

function makeLedgerRow(overrides: Partial<LedgerRow> & { id: string }): LedgerRow {
  return {
    when: '2026-01-01T00:00:00Z',
    what: overrides.id,
    narrative: null,
    narrativeKinds: [],
    status: 'complete',
    costUsd: null,
    href: `/flows/forge-develop/run/${overrides.id}`,
    ...overrides,
  };
}

test('buildHomeLedgerRows: interleaves flow rows and agent rows into ONE newest-first list', () => {
  const flowRows = [
    makeLedgerRow({ id: 'flow-old', when: '2026-01-01T00:00:00Z' }),
  ];
  const agentRows = [
    makeLedgerRow({ id: 'agent-new', when: '2026-01-03T00:00:00Z', linkKind: 'standalone', href: '/agents/dev/run/agent-new' }),
    makeLedgerRow({ id: 'agent-mid', when: '2026-01-02T00:00:00Z', linkKind: 'standalone', href: '/agents/dev/run/agent-mid' }),
  ];
  const merged = buildHomeLedgerRows(flowRows, agentRows);
  expect(merged.map((r) => r.id)).toEqual(['agent-new', 'agent-mid', 'flow-old']);
});

test('buildHomeLedgerRows: a run id shared by BOTH a flow row and an agent row dedupes to the FLOW row — one row per run, attributed to the flow', () => {
  const flowRows = [makeLedgerRow({ id: 'shared-run', when: '2026-01-01T00:00:00Z', href: '/flows/forge-develop/run/shared-run' })];
  const agentRows = [makeLedgerRow({ id: 'shared-run', when: '2026-01-01T00:00:00Z', linkKind: 'flow-node', href: '/agents/dev/run/shared-run' })];
  const merged = buildHomeLedgerRows(flowRows, agentRows);
  expect(merged).toHaveLength(1);
  expect(merged[0].href).toBe('/flows/forge-develop/run/shared-run');
  expect(merged[0].linkKind).toBeUndefined();
});

test('buildHomeLedgerRows: respects the limit, keeping the newest rows across BOTH sources', () => {
  const flowRows = [makeLedgerRow({ id: 'f1', when: '2026-01-01T00:00:00Z' })];
  const agentRows = [
    makeLedgerRow({ id: 'a1', when: '2026-01-05T00:00:00Z', linkKind: 'standalone' }),
    makeLedgerRow({ id: 'a2', when: '2026-01-04T00:00:00Z', linkKind: 'standalone' }),
  ];
  const merged = buildHomeLedgerRows(flowRows, agentRows, 2);
  expect(merged.map((r) => r.id)).toEqual(['a1', 'a2']);
});

test('buildHomeLedgerRows: an empty agentRows list still returns the flow rows, newest-first', () => {
  const flowRows = [
    makeLedgerRow({ id: 'f-new', when: '2026-01-02T00:00:00Z' }),
    makeLedgerRow({ id: 'f-old', when: '2026-01-01T00:00:00Z' }),
  ];
  expect(buildHomeLedgerRows(flowRows, []).map((r) => r.id)).toEqual(['f-new', 'f-old']);
});

// ---------------------------------------------------------------------------
// W6-B11 — buildHomeSessionsStrip
// ---------------------------------------------------------------------------

function makeSessionRow(overrides: Partial<SessionIndexRow> = {}): SessionIndexRow {
  return {
    kind: 'instructions',
    sessionId: 'fixture',
    project: 'p',
    phase: 'drafting',
    terminal: false,
    needsYou: false,
    modelTier: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    href: '/sessions/instructions/fixture?project=p',
    ...overrides,
  };
}

test('buildHomeSessionsStrip: cards is a straight slice to the limit — never re-sorted (trusts the already-sorted input)', () => {
  const sessions = [
    makeSessionRow({ sessionId: 'a' }),
    makeSessionRow({ sessionId: 'b' }),
    makeSessionRow({ sessionId: 'c' }),
  ];
  const strip = buildHomeSessionsStrip(sessions, 2);
  expect(strip.cards.map((s) => s.sessionId)).toEqual(['a', 'b']);
});

test('buildHomeSessionsStrip: defaults to HOME_SESSIONS_STRIP_LIMIT (4) cards', () => {
  const sessions = Array.from({ length: 6 }, (_, i) => makeSessionRow({ sessionId: `s${i}` }));
  const strip = buildHomeSessionsStrip(sessions);
  expect(strip.cards).toHaveLength(HOME_SESSIONS_STRIP_LIMIT);
});

test('buildHomeSessionsStrip: needsYouCount counts ALL needs-you sessions, not just the ones inside the card budget', () => {
  const sessions = [
    makeSessionRow({ sessionId: 'a', needsYou: true }),
    makeSessionRow({ sessionId: 'b', needsYou: true }),
    makeSessionRow({ sessionId: 'c', needsYou: true }),
    makeSessionRow({ sessionId: 'd', needsYou: true }),
    makeSessionRow({ sessionId: 'e', needsYou: true }), // 5th needs-you row, past the 4-card budget
  ];
  const strip = buildHomeSessionsStrip(sessions, 4);
  expect(strip.cards).toHaveLength(4);
  expect(strip.needsYouCount).toBe(5);
});

test('buildHomeSessionsStrip: totalCount is the full in-flight count, not cards.length', () => {
  const sessions = Array.from({ length: 7 }, (_, i) => makeSessionRow({ sessionId: `s${i}` }));
  const strip = buildHomeSessionsStrip(sessions, 4);
  expect(strip.totalCount).toBe(7);
  expect(strip.cards).toHaveLength(4);
});

test('buildHomeSessionsStrip: an empty sessions list -> empty cards, zero counts (honest absence, never fabricated)', () => {
  const strip = buildHomeSessionsStrip([]);
  expect(strip.cards).toEqual([]);
  expect(strip.needsYouCount).toBe(0);
  expect(strip.totalCount).toBe(0);
});
