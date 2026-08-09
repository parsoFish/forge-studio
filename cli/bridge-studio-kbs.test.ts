/**
 * Tests for bridge-studio-kbs.ts routes (M5 review fixes):
 *   - POST /api/studio/kbs/:id/guidance — 8 KiB text cap (#2)
 *   - GET  /api/studio/kbs/resolve-node/:nodeId — node→KB resolver (#3)
 *
 * Uses a real bridge against a minimal tmp forge-root with two KB stubs.
 * The guidance tests use an existing KB ('cycles').
 * The resolve-node tests need actual kb-graph data; the fixture writes
 * a minimal themes/ file with a [[wiki-link]] to create a real node.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { loadKbDescriptors } from './bridge-studio-kbs.ts';
// AT-4on-9 (SEC-05 4on REOPEN #1) needs existsSync for a fixture precondition —
// added as a second scoped node:fs import so the existing import stays untouched.
// R1-06 WI-3 review pins (M1/M2/MINOR1) additionally need readFileSync for the
// cross-KB write-isolation byte-compare.
import { existsSync, readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CYCLES_KB_YAML = `id: cycles\nname: Cycles Brain\nbinding: { kind: flow, ref: forge-develop }\ndesc: Cross-cycle patterns.\n`;
const FORGE_DEV_KB_YAML = `id: forge-dev\nname: Forge Dev Brain\nbinding: { kind: unique }\ndesc: Forge engineering decisions.\n`;

// Minimal theme file whose title becomes the theme node id.
// kb-graph derives node ids from the filename slug (without .md extension).
// We write a theme file 'test-theme.md' so the node id will be 'test-theme'.
const TEST_THEME_MD = `# Test Theme\n\nThis is a test theme node.\n`;

// ---------------------------------------------------------------------------
// R1-06 WI-3 group A fixture: a SCRATCH project KB (never cycles/forge-dev)
// carrying real-corpus-shaped lint-warning findings, for the maintenance
// op:'consolidate' RED pins below. checkFrontmatter / checkIndexSync /
// checkStaleness / checkOrphans (cli/brain-lint.ts) are all hardcoded to
// THEME_SUBDIRS = ['cycles','forge-dev'] and never scan brain/projects/*; the
// ONLY forge-side lint check that covers a project brain at all is
// checkProjectBrainIndexes (cli/brain-lint.ts:337), whose "not listed in
// project category index" finding classifies as resolution:'agent' (line
// 1042-1043) — a real, agent-tier, per-theme finding. Three fixture themes
// with valid frontmatter/category but deliberately absent from patterns.md
// gives 3 independently-clearable findings, so a follow-up lint can prove
// consolidate drained the FULL scoped set, not just one.
// ---------------------------------------------------------------------------
const CONSOLIDATE_KB_ID = 'r1-06-consolidate';
const CONSOLIDATE_KB_YAML =
  `id: ${CONSOLIDATE_KB_ID}\nname: R1-06 Consolidate Fixture (scratch)\n` +
  `binding: { kind: project, ref: ${CONSOLIDATE_KB_ID} }\n` +
  `desc: Synthetic scratch project KB seeded ONLY for the WI-3 group A op='consolidate' RED pin — never a real project brain.\n` +
  `backend: filesystem\n`;
const CONSOLIDATE_PATTERNS_INDEX =
  `# r1-06-consolidate — Patterns\n\n> Category index — deliberately left without theme links (fixture; see cli/bridge-studio-kbs.test.ts).\n\n## Theme pages\n`;

function consolidateFixtureTheme(slug: string, n: number): string {
  return (
    '---\n' +
    `title: "R1-06 consolidate fixture theme ${n}"\n` +
    `description: "Synthetic real-corpus-shaped lint-warning fixture (WI-3 group A) — deliberately left out of patterns.md so checkProjectBrainIndexes raises an agent-tier finding."\n` +
    'category: pattern\n' +
    'created_at: "2026-08-01T00:00:00Z"\n' +
    'updated_at: "2026-08-01T00:00:00Z"\n' +
    '---\n\n' +
    `# R1-06 consolidate fixture theme ${n}\n\n` +
    `Synthetic fixture theme (slug \`${slug}\`) for the maintenance op='consolidate' RED pin. Not a real cycle learning — safe to delete.\n`
  );
}

// ---------------------------------------------------------------------------
// R1-06 WI-3 review MAJOR 1 fixture: a SEPARATE, never-consolidated project KB
// (so its finding count stays fixed for the whole file) whose brain lives at
// brain/projects/<id> — the exact shape buildKbHealth's OLD hardcoded
// `resolve(forgeRoot,'brain',<id>)` prefix misses (that path is
// brain/<id>, so the health lint filter yielded 0 and hid the Lint section for
// project KBs). Three unlisted pattern themes ⇒ 3 checkProjectBrainIndexes
// 'flag' findings ⇒ health.lintFlags MUST be 3 once the health filter scopes
// via resolveKbBrainDir like consolidate/lint already do. NEVER mutated.
// ---------------------------------------------------------------------------
const HEALTH_KB_ID = 'r1-06-health';
const HEALTH_KB_YAML =
  `id: ${HEALTH_KB_ID}\nname: R1-06 Health Fixture (scratch)\n` +
  `binding: { kind: project, ref: ${HEALTH_KB_ID} }\n` +
  `desc: Synthetic scratch project KB seeded ONLY for the WI-3 review MAJOR 1 health-count pin — never consolidated.\n` +
  `backend: filesystem\n`;
const HEALTH_PATTERNS_INDEX =
  `# r1-06-health — Patterns\n\n> Category index — deliberately left without theme links (fixture).\n\n## Theme pages\n`;

// ---------------------------------------------------------------------------
// Bridge lifecycle
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-kbs-'));

  // Minimal _queue + _logs required by startBridge / listRuns
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // KB: cycles (used for guidance tests)
  mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'cycles', '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
  // Write a theme node so resolve-node can find it
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'themes', 'test-theme.md'), TEST_THEME_MD);

  // KB: forge-dev
  mkdirSync(join(forgeRoot, 'brain', 'forge-dev', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'forge-dev', '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'forge-dev', 'kb.yaml'), FORGE_DEV_KB_YAML);

  // KB: r1-06-consolidate (scratch project brain, WI-3 group A fixture — see
  // the fixture-helpers comment above). NEVER cycles/forge-dev.
  const consolidateDir = join(forgeRoot, 'brain', 'projects', CONSOLIDATE_KB_ID);
  mkdirSync(join(consolidateDir, 'themes'), { recursive: true });
  writeFileSync(join(consolidateDir, 'kb.yaml'), CONSOLIDATE_KB_YAML);
  writeFileSync(join(consolidateDir, 'patterns.md'), CONSOLIDATE_PATTERNS_INDEX);
  for (const [slug, n] of [['theme-a', 1], ['theme-b', 2], ['theme-c', 3]] as const) {
    writeFileSync(join(consolidateDir, 'themes', `${slug}.md`), consolidateFixtureTheme(slug, n));
  }

  // KB: r1-06-health (scratch project brain, MAJOR 1 fixture — never
  // consolidated, so its 3 checkProjectBrainIndexes flags stay fixed).
  const healthDir = join(forgeRoot, 'brain', 'projects', HEALTH_KB_ID);
  mkdirSync(join(healthDir, 'themes'), { recursive: true });
  writeFileSync(join(healthDir, 'kb.yaml'), HEALTH_KB_YAML);
  writeFileSync(join(healthDir, 'patterns.md'), HEALTH_PATTERNS_INDEX);
  for (const [slug, n] of [['h-one', 1], ['h-two', 2], ['h-three', 3]] as const) {
    writeFileSync(join(healthDir, 'themes', `${slug}.md`), consolidateFixtureTheme(slug, n));
  }

  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeServer = result.close;
});

after(async () => {
  await closeServer?.();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function post(
  path: string,
  body?: Record<string, unknown>,
  nocsrf = false,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!nocsrf) headers['x-forge-csrf'] = '1';
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function get(path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Fix #2: Guidance text length cap (8 KiB)
// ---------------------------------------------------------------------------

test('POST /api/studio/kbs/:id/guidance: normal text → 200', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: 'Short guidance note.',
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
});

test('POST /api/studio/kbs/:id/guidance: oversized text → 400 guidance text too large', async () => {
  // 9 KiB of text — over the 8 KiB cap
  const oversized = 'x'.repeat(9 * 1024);
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: oversized,
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).includes('guidance text too large'));
});

test('POST /api/studio/kbs/:id/guidance: exactly 8192 bytes → 200 (at-cap is allowed)', async () => {
  // Exactly 8 KiB (8192 bytes) — should pass (> not >=)
  const atCap = 'a'.repeat(8192);
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: atCap,
  });
  assert.equal(status, 200, JSON.stringify(json));
});

test('POST /api/studio/kbs/:id/guidance: 8193 bytes → 400', async () => {
  const overCap = 'a'.repeat(8193);
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: overCap,
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok((json['error'] as string).includes('guidance text too large'));
});

// ---------------------------------------------------------------------------
// Fix #3: GET /api/studio/kbs/resolve-node/:nodeId
// ---------------------------------------------------------------------------

test('GET /api/studio/kbs/resolve-node/:nodeId: finds node in cycles KB', async () => {
  // 'test-theme' was written to cycles/themes/test-theme.md
  const { status, json } = await get('/api/studio/kbs/resolve-node/test-theme');
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['kbId'], 'cycles', `expected 'cycles', got: ${JSON.stringify(json)}`);
});

test('GET /api/studio/kbs/resolve-node/:nodeId: unknown node → 404', async () => {
  const { status, json } = await get('/api/studio/kbs/resolve-node/nonexistent-node-xyz');
  assert.equal(status, 404, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
});

test('GET /api/studio/kbs/resolve-node/:nodeId: invalid node id → 400', async () => {
  // Leading dot is invalid per NODE_ID_RE
  const { status, json } = await get('/api/studio/kbs/resolve-node/.hidden');
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
});

// The Knowledge "Lint" button POSTs op=lint; the response MUST carry ok:true so
// the UI's studioPost (which gated success on data.ok) renders findings instead of
// "failed" (the reported bug — lint always showed failed despite running).
test('POST /api/studio/kbs/:id/maintenance op=lint → 200 ok:true with findings array', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/maintenance', { op: 'lint' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true, 'lint response must carry ok:true');
  assert.equal(json['op'], 'lint');
  assert.ok(Array.isArray(json['findings']), 'findings must be an array');
  assert.equal(typeof json['total'], 'number');
});

test('POST /api/studio/kbs/:id/maintenance op=index → 200 ok:true', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/maintenance', { op: 'index' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
});

test('POST /api/studio/kbs/:id/maintenance op=bogus → 400', async () => {
  const { status } = await post('/api/studio/kbs/cycles/maintenance', { op: 'bogus' });
  assert.equal(status, 400);
});

// Guided lint-resolution ops (Phase 2/3/4 bridge surface).
test('op=lint returns resolution counts', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/maintenance', { op: 'lint' });
  assert.equal(status, 200, JSON.stringify(json));
  const counts = json['counts'] as Record<string, number>;
  assert.ok(counts && typeof counts.auto === 'number' && typeof counts.agent === 'number' && typeof counts.user === 'number', 'counts present');
});

test('op=fix-auto returns the applied/skipped/remaining/counts shape', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/maintenance', { op: 'fix-auto' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
  assert.ok(Array.isArray(json['applied']), 'applied[]');
  assert.ok(Array.isArray(json['skipped']), 'skipped[]');
  assert.ok(Array.isArray(json['remaining']), 'remaining[]');
  assert.ok(json['counts'], 'counts');
});

test('op=fix-agent rejects a missing file (400)', async () => {
  const { status } = await post('/api/studio/kbs/cycles/maintenance', { op: 'fix-agent', check: 'checkSourceLinks', kind: 'links.broken' });
  assert.equal(status, 400);
});

test('op=fix-agent rejects a file outside brain/ (path-guard, 400)', async () => {
  const { status } = await post('/api/studio/kbs/cycles/maintenance', { op: 'fix-agent', file: '/etc/passwd', check: 'x', kind: 'y' });
  assert.equal(status, 400);
});

test('R5-01-F1: FORGE_DRY_BRIDGE=1 refuses op=fix-agent with the typed 409, no run dispatched', async () => {
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const { status, json } = await post('/api/studio/kbs/cycles/maintenance', {
      op: 'fix-agent', file: join(forgeRoot, 'brain', 'cycles', 'themes', 'test-theme.md'),
      check: 'checkSourceLinks', kind: 'links.broken',
    });
    assert.equal(status, 409, JSON.stringify(json));
    assert.deepEqual(json, {
      error: 'dry-bridge',
      route: '/api/studio/kbs/:id/maintenance (op=fix-agent)',
      method: 'POST',
      action: 'spawn-agent',
    });
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
});

test('GET fix-agent/:runId for an unknown run → running', async () => {
  const { status, json } = await get('/api/studio/kbs/cycles/fix-agent/nonexistent-run-123');
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['state'], 'running');
});

// ---------------------------------------------------------------------------
// R1-06 WI-3 group A — the maintenance `op:'consolidate'` op (RED pins).
//
// Today the op allow-list (bridge-studio-kbs.ts:925) is
// `lint | fix-auto | fix-agent | index` — `consolidate` falls through to the
// default 400. These pins target the missing KB-wide consolidate obligation
// (DEFAULT_KB_CONSOLIDATE, orchestrator/studio/kb-descriptor.ts:138 — builtin
// 'brain-fix') dispatched over the FULL scoped finding set, not one finding at
// a time the way op:'fix-agent' already does. Fixture: CONSOLIDATE_KB_ID (see
// the fixture-helpers comment above the shared `before()` block).
// ---------------------------------------------------------------------------

/** Poll the existing fix-agent state shape until the run leaves 'running'
 *  (or the budget is exhausted — returned as-is so the caller's assertion
 *  produces the failure message, not a silent timeout). */
async function pollUntilTerminal(
  kbId: string,
  runId: string,
  maxAttempts = 40,
  intervalMs = 250,
): Promise<{ state: string; cleared: boolean }> {
  for (let i = 0; i < maxAttempts; i++) {
    const { json } = await get(`/api/studio/kbs/${kbId}/fix-agent/${runId}`);
    const state = json['state'] as string;
    if (state && state !== 'running') return { state, cleared: json['cleared'] === true };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { state: 'running', cleared: false };
}

// ---------------------------------------------------------------------------
// R1-06 WI-3 review pins (MAJOR 2 write-isolation, MINOR 1 poll-hang) need an
// ISOLATED forge-root + bridge each: MAJOR 2 mutates on-disk brains, and
// MINOR 1's directory-as-index makes runBrainLint(scope:'full') throw for the
// WHOLE root — either would corrupt the shared bridge's other tests. Minimal
// _queue/_logs scaffold mirrors the shared `before()`.
// ---------------------------------------------------------------------------
async function makeIsolatedForge(): Promise<{ root: string; url: string; close: () => Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), 'kbs-review-pin-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(root, '_queue', state), { recursive: true });
  }
  mkdirSync(join(root, '_logs'), { recursive: true });
  const { url, close } = await startBridge({ forgeRoot: root, port: 0 });
  return { root, url, close };
}

async function postAt(
  base: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Poll an isolated bridge's fix-agent state until terminal (or budget spent —
 *  returned as-is so the caller's assertion, not a silent timeout, reports). */
async function pollTerminalAt(
  base: string,
  kbId: string,
  runId: string,
  maxAttempts = 40,
  intervalMs = 250,
): Promise<{ state: string; cleared: boolean }> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${base}/api/studio/kbs/${kbId}/fix-agent/${runId}`);
    const json = (await res.json()) as Record<string, unknown>;
    const state = json['state'] as string;
    if (state && state !== 'running') return { state, cleared: json['cleared'] === true };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { state: 'running', cleared: false };
}

/** A synthetic project brain: kb.yaml (project binding) + a category index + N
 *  unlisted `pattern` themes ⇒ N checkProjectBrainIndexes 'not listed' findings.
 *  `patternsAsDir:true` makes patterns.md a DIRECTORY (MINOR 1 throw injection —
 *  readIndexEntries' readFileSync throws EISDIR on a dir). */
function seedProjectBrain(
  root: string,
  id: string,
  themeSlugs: readonly string[],
  opts?: { patternsAsDir?: boolean },
): void {
  const dir = join(root, 'brain', 'projects', id);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(
    join(dir, 'kb.yaml'),
    `id: ${id}\nname: ${id}\nbinding: { kind: project, ref: ${id} }\ndesc: isolated review-pin fixture.\nbackend: filesystem\n`,
  );
  if (opts?.patternsAsDir) mkdirSync(join(dir, 'patterns.md'), { recursive: true });
  else writeFileSync(join(dir, 'patterns.md'), `# ${id} — Patterns\n\n> fixture index.\n\n## Theme pages\n`);
  themeSlugs.forEach((slug, i) => {
    writeFileSync(join(dir, 'themes', `${slug}.md`), consolidateFixtureTheme(slug, i + 1));
  });
}

test('R1-06 WI-3 group A red-pin: POST maintenance op=consolidate is accepted (200 ok:true + runId) — RED today (op not in the allow-list)', async () => {
  const { status, json } = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'consolidate' });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
  assert.equal(json['ok'], true, JSON.stringify(json));
  assert.equal(typeof json['runId'], 'string', `expected a string runId, got ${JSON.stringify(json)}`);
  assert.ok((json['runId'] as string).length > 0, 'runId must be non-empty');
});

test('R1-06 WI-3 group A ratchet: op=consolidate drains the FULL scoped finding set to a terminal state — RED today', async () => {
  // Fixture precondition, asserted BEFORE any verdict: the 3 seeded themes
  // really do produce 3 independent checkProjectBrainIndexes findings.
  const baseline = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'lint' });
  assert.equal(baseline.status, 200, JSON.stringify(baseline.json));
  const baselineFindings = (baseline.json['findings'] as Array<{ check?: string }>).filter(
    (f) => f.check === 'checkProjectBrainIndexes',
  );
  assert.equal(
    baselineFindings.length,
    3,
    `fixture precondition failed: expected 3 seeded checkProjectBrainIndexes findings, got ${baselineFindings.length} — ${JSON.stringify(baselineFindings)}`,
  );

  // Dispatch consolidate — must accept the op and hand back an async run
  // handle (the fix-agent shape), not the synchronous fix-auto shape.
  const dispatch = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'consolidate' });
  assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
  assert.equal(dispatch.json['ok'], true, JSON.stringify(dispatch.json));
  const runId = dispatch.json['runId'];
  assert.equal(typeof runId, 'string', `expected a string runId, got ${JSON.stringify(dispatch.json)}`);

  // Poll the existing fix-agent poll shape until the consolidate run reaches
  // a terminal state — 'running' forever is a fail.
  const terminal = await pollUntilTerminal(CONSOLIDATE_KB_ID, runId as string);
  assert.notEqual(terminal.state, 'running', 'consolidate run never reached a terminal state within the poll budget');

  // The obligation ran over the FULL scoped finding set, not a single
  // finding: a follow-up lint must show every seeded finding cleared, not
  // just one (a shallow single-finding "consolidate" would leave some behind).
  const after = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'lint' });
  assert.equal(after.status, 200, JSON.stringify(after.json));
  const afterFindings = (after.json['findings'] as Array<{ check?: string }>).filter(
    (f) => f.check === 'checkProjectBrainIndexes',
  );
  assert.equal(
    afterFindings.length,
    0,
    `expected consolidate to clear the FULL scoped finding set (3 seeded), but ${afterFindings.length} remain — ${JSON.stringify(afterFindings)}`,
  );
});

test('R1-06 WI-3 group A companion: pre-existing single-finding lint-resolution tiers (lint/fix-auto/fix-agent) stay intact on the consolidate fixture KB', async () => {
  // op=lint — response shape unchanged.
  const lint = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'lint' });
  assert.equal(lint.status, 200, JSON.stringify(lint.json));
  assert.equal(lint.json['ok'], true, JSON.stringify(lint.json));
  assert.equal(lint.json['op'], 'lint');
  assert.ok(Array.isArray(lint.json['findings']), 'findings must be an array');
  const counts = lint.json['counts'] as Record<string, number>;
  assert.ok(
    counts && typeof counts.auto === 'number' && typeof counts.agent === 'number' && typeof counts.user === 'number',
    `counts must carry auto/agent/user tallies, got ${JSON.stringify(lint.json['counts'])}`,
  );

  // op=fix-auto — response shape unchanged (synchronous applied/skipped/remaining/counts).
  const fixAuto = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'fix-auto' });
  assert.equal(fixAuto.status, 200, JSON.stringify(fixAuto.json));
  assert.equal(fixAuto.json['ok'], true, JSON.stringify(fixAuto.json));
  assert.ok(Array.isArray(fixAuto.json['applied']), 'applied[]');
  assert.ok(Array.isArray(fixAuto.json['skipped']), 'skipped[]');
  assert.ok(Array.isArray(fixAuto.json['remaining']), 'remaining[]');
  assert.ok(fixAuto.json['counts'], 'counts');

  // op=fix-agent — still a single-finding dispatch: missing file/check/kind → 400.
  const missing = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, {
    op: 'fix-agent', check: 'checkProjectBrainIndexes', kind: 'index.project',
  });
  assert.equal(missing.status, 400, JSON.stringify(missing.json));

  // op=fix-agent — dry-bridge still refuses the single-finding dispatch with
  // the typed 409, no run dispatched (unaffected by consolidate's addition).
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const themeFile = join(forgeRoot, 'brain', 'projects', CONSOLIDATE_KB_ID, 'themes', 'theme-a.md');
    const dry = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, {
      op: 'fix-agent', file: themeFile, check: 'checkProjectBrainIndexes', kind: 'index.project',
    });
    assert.equal(dry.status, 409, JSON.stringify(dry.json));
    assert.equal(dry.json['error'], 'dry-bridge');
    assert.equal(dry.json['action'], 'spawn-agent');
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
});

// ---------------------------------------------------------------------------
// R1-06 WI-3 review MAJOR 1 (mis-scoped health count / declared-data-fails-open):
// buildKbHealth scoped its lint filter with the HARDCODED
// `resolve(forgeRoot,'brain',<id>)` prefix (= brain/<id>), so for a project KB
// living at brain/projects/<id> the filter matched nothing and health reported
// lintFlags=0 — hiding the Lint section for exactly the project KBs WI-3 targets,
// while op=lint/op=consolidate reported the real count. The health filter must
// scope via resolveKbBrainDir (the SAME resolution consolidate/lint use).
//
// RED today: GET health for r1-06-health reports lintFlags=0 (not 3).
// ---------------------------------------------------------------------------
test('R1-06 WI-3 MAJOR 1 red-pin: GET health for a project KB reports the REAL checkProjectBrainIndexes count (not 0) — RED today', async () => {
  // Fixture precondition, asserted BEFORE the verdict: op=lint (which already
  // scopes correctly) sees exactly 3 checkProjectBrainIndexes findings for this
  // project KB, so a health count of 0 is a mis-scope, not an empty corpus.
  const lint = await post(`/api/studio/kbs/${HEALTH_KB_ID}/maintenance`, { op: 'lint' });
  assert.equal(lint.status, 200, JSON.stringify(lint.json));
  const projectFindings = (lint.json['findings'] as Array<{ check?: string; category?: string }>).filter(
    (f) => f.check === 'checkProjectBrainIndexes',
  );
  assert.equal(
    projectFindings.length,
    3,
    `fixture precondition failed: expected 3 checkProjectBrainIndexes findings via op=lint, got ${projectFindings.length}`,
  );

  // Verdict: the health object's lintFlags must reflect those same 3 findings.
  const detail = await get(`/api/studio/kbs/${HEALTH_KB_ID}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  const health = detail.json['health'] as { lintFlags?: number; lintErrors?: number } | undefined;
  assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
  assert.equal(
    health!.lintFlags,
    3,
    `expected health.lintFlags=3 for a project KB with 3 checkProjectBrainIndexes flags, got ${health!.lintFlags} — the health filter is mis-scoped to brain/<id> instead of brain/projects/<id>`,
  );
});

// ---------------------------------------------------------------------------
// R1-06 WI-3 review MAJOR 2 (cross-KB mutation / write-isolation): scopeFindingsToKb
// kept any finding whose path .includes(kbId) (substring). runBrainConsolidateNow
// turns that scope into WRITES (applyDeterministicConsolidateFixes). Two project
// brains "alpha" and "alpha-two": consolidating "alpha" matched alpha-two's
// findings too (its path contains "alpha") and appended a link line into
// brain/projects/alpha-two/patterns.md. The scope must be an EXACT resolved-dir
// match, never a substring — for BOTH the read (count) and write (consolidate).
//
// RED today: alpha-two/patterns.md is mutated by consolidating alpha.
// ---------------------------------------------------------------------------
test('R1-06 WI-3 MAJOR 2 red-pin: consolidating "alpha" leaves sibling "alpha-two" byte-unchanged — RED today', async () => {
  const iso = await makeIsolatedForge();
  try {
    seedProjectBrain(iso.root, 'alpha', ['a-one', 'a-two']);
    seedProjectBrain(iso.root, 'alpha-two', ['b-one']);
    const alphaTwoIndex = join(iso.root, 'brain', 'projects', 'alpha-two', 'patterns.md');

    // Fixture precondition (before any verdict): alpha-two's index does NOT yet
    // link its theme, so any cross-KB append is detectable, and alpha-two really
    // has its own unlisted-theme finding to be (wrongly) swept in.
    const before = readFileSync(alphaTwoIndex, 'utf8');
    assert.ok(!before.includes('b-one'), 'precondition: alpha-two index must not already link b-one');
    const lintTwoBefore = await postAt(iso.url, `/api/studio/kbs/alpha-two/maintenance`, { op: 'lint' });
    const twoFindingsBefore = (lintTwoBefore.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(twoFindingsBefore.length, 1, `precondition: alpha-two must have exactly 1 project-index finding, got ${twoFindingsBefore.length}`);

    // Dispatch consolidate for ALPHA only, drain to terminal.
    const dispatch = await postAt(iso.url, `/api/studio/kbs/alpha/maintenance`, { op: 'consolidate' });
    assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
    const runId = dispatch.json['runId'] as string;
    assert.equal(typeof runId, 'string', `expected runId, got ${JSON.stringify(dispatch.json)}`);
    const terminal = await pollTerminalAt(iso.url, 'alpha', runId);
    assert.notEqual(terminal.state, 'running', 'alpha consolidate never reached terminal');

    // Verdict 1 (write-isolation): alpha-two's index file is byte-identical.
    const after = readFileSync(alphaTwoIndex, 'utf8');
    assert.equal(after, before, 'consolidating "alpha" mutated sibling "alpha-two" patterns.md (substring cross-KB write)');

    // Verdict 2 (count-isolation): alpha-two still reports its own unlisted
    // finding — alpha's run must not have cleared it.
    const lintTwoAfter = await postAt(iso.url, `/api/studio/kbs/alpha-two/maintenance`, { op: 'lint' });
    const twoFindingsAfter = (lintTwoAfter.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(twoFindingsAfter.length, 1, `alpha's consolidate cleared alpha-two's finding (cross-KB), ${twoFindingsAfter.length} remain`);

    // Sanity: alpha's OWN findings did drain (the fix scopes, it does not disable).
    const lintAlphaAfter = await postAt(iso.url, `/api/studio/kbs/alpha/maintenance`, { op: 'lint' });
    const alphaFindingsAfter = (lintAlphaAfter.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(alphaFindingsAfter.length, 0, `alpha's own findings should be drained, ${alphaFindingsAfter.length} remain`);
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R1-06 WI-3 review MINOR 1 (poll-hang on throw): the pre-terminal repair phase
// (initial runBrainLint + applyDeterministicConsolidateFixes' ensureLinkedAt
// read/write) was unwrapped. When it throws (here: a category index that is a
// DIRECTORY, so readIndexEntries' readFileSync throws EISDIR), the run rejected
// before writeConsolidateTerminalEvent — readBrainFixState returns 'running'
// forever and the poll exhausts its budget. A single honest terminal must fire
// even on an unexpected throw.
//
// RED today: the run never leaves 'running'.
// ---------------------------------------------------------------------------
test('R1-06 WI-3 MINOR 1 red-pin: a consolidate whose repair phase throws still reaches a terminal state — RED today', async () => {
  const iso = await makeIsolatedForge();
  try {
    // patterns.md is a DIRECTORY → readIndexEntries' readFileSync throws EISDIR.
    seedProjectBrain(iso.root, 'throwkb', ['t-one'], { patternsAsDir: true });
    // Fixture precondition (before verdict): the index path really is a directory.
    assert.ok(
      existsSync(join(iso.root, 'brain', 'projects', 'throwkb', 'patterns.md')),
      'precondition: throwkb patterns.md (as a directory) must exist',
    );

    const dispatch = await postAt(iso.url, `/api/studio/kbs/throwkb/maintenance`, { op: 'consolidate' });
    assert.equal(dispatch.status, 200, `dispatch must be accepted async, got ${JSON.stringify(dispatch.json)}`);
    const runId = dispatch.json['runId'] as string;
    assert.equal(typeof runId, 'string', `expected runId, got ${JSON.stringify(dispatch.json)}`);

    // Tighter budget (3s): the error terminal lands within ~1 poll on GREEN;
    // on RED this bounds how long the demonstrated hang costs the suite.
    const terminal = await pollTerminalAt(iso.url, 'throwkb', runId, 20, 150);
    assert.notEqual(
      terminal.state,
      'running',
      'a consolidate whose repair phase threw never reached a terminal state — the poll hung to budget',
    );
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ADR 035: per-project brains live at brain/projects/<id>/. loadKbDescriptors
// must surface them alongside the top-level brains so they appear in Studio's KB
// list/graph (previously only direct subdirs of brain/ were scanned).
test('loadKbDescriptors: includes central per-project brains under brain/projects/', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-descriptors-'));
  try {
    // Top-level brain
    mkdirSync(join(root, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(root, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
    // Central per-project brain with two themes
    const proj = join(root, 'brain', 'projects', 'gitpulse');
    mkdirSync(join(proj, 'themes'), { recursive: true });
    writeFileSync(join(proj, 'kb.yaml'), 'id: gitpulse\nname: gitpulse (project)\nbinding: { kind: project, ref: gitpulse }\ndesc: Per-project brain.\nbackend: filesystem\n');
    writeFileSync(join(proj, 'themes', 'a.md'), '# A\n');
    writeFileSync(join(proj, 'themes', 'b.md'), '# B\n');

    const kbs = loadKbDescriptors(root);
    const ids = kbs.map((k) => k.id);
    assert.ok(ids.includes('cycles'), `expected top-level cycles, got ${JSON.stringify(ids)}`);
    assert.ok(ids.includes('gitpulse'), `expected per-project gitpulse, got ${JSON.stringify(ids)}`);
    const gp = kbs.find((k) => k.id === 'gitpulse');
    assert.deepEqual(gp?.binding, { kind: 'project', ref: 'gitpulse' });
    assert.equal(gp?.counts.themes, 2, 'gitpulse theme count should reflect its themes/ dir');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-4on-9 (loadKbDescriptors) [SEC-05 4on REOPEN #1] — a `.staging-<id>-<rand>`
// orphan under brain/projects/ (a rename-loser under concurrency, or a
// hard-kill DURING staging, of the transactional create fix) must NEVER surface
// as a phantom KB. loadKbDescriptors walks brain/projects/ via subDirs()
// (bridge-studio-kbs.ts:68-77 + :132-133), which filters ONLY on isDirectory()
// with no dot-prefix filter; isSafeSegment() in the path guard accepts a
// leading-dot segment (it rejects only '.'/'..'), and loadKbDescriptor reads the
// KB id straight from the yaml with no dir cross-check — so a real
// `.staging-decoy-abc123/kb.yaml` loads and is pushed. That is a phantom KB
// bound to a project that was never created — the exact "leaks
// .staging-<id>-<rand> orphans which SURFACE as phantom-KBs" vector this REOPEN
// closes.
//
// RED at base: loadKbDescriptors returns a kb with id 'staging-decoy-abc123'.
// Kills: a KB listing that walks brain/projects/ with no `.`-prefix filter. The
// `cycles` control proves the scan actually reached disk (not an accidental
// empty pass).
// ---------------------------------------------------------------------------
test('AT-4on-9: a `.staging-*` brain leftover is never surfaced as a phantom KB (control `cycles` still surfaced)', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-staging-dotdir-'));
  try {
    // Control: a real top-level brain — proves the scan reaches disk.
    mkdirSync(join(root, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(root, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
    // Decoy: a `.staging-<id>-<rand>` leftover under brain/projects/ carrying a
    // VALID kb.yaml (id taken straight from the yaml, no dir cross-check).
    const decoy = join(root, 'brain', 'projects', '.staging-decoy-abc123');
    mkdirSync(join(decoy, 'themes'), { recursive: true });
    const decoyYaml = join(decoy, 'kb.yaml');
    writeFileSync(
      decoyYaml,
      'id: staging-decoy-abc123\nname: Staging Decoy\nbinding: { kind: project, ref: staging-decoy-abc123 }\ndesc: A rename-loser staging orphan.\nbackend: filesystem\n',
    );
    // Fixture precondition (before any verdict): the decoy kb.yaml is on disk.
    assert.ok(existsSync(decoyYaml), 'precondition: the decoy kb.yaml must be planted');

    const kbs = loadKbDescriptors(root);
    const ids = kbs.map((k) => k.id);
    // The scan works: the control brain surfaces (guards accidental-empty).
    assert.ok(ids.includes('cycles'), `control brain must surface — got ${JSON.stringify(ids)}`);
    // The verdict: the staging leftover is NOT surfaced as a phantom KB.
    assert.ok(!ids.includes('staging-decoy-abc123'), `a .staging-* brain leftover surfaced as a phantom KB id "staging-decoy-abc123" — got ${JSON.stringify(ids)}`);
    assert.ok(!ids.includes('.staging-decoy-abc123'), `a .staging-* brain leftover surfaced verbatim — got ${JSON.stringify(ids)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
