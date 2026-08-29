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
// R6-08 4on (F3 hardening) — CHECK_NAMES is the real, single-source-of-truth
// export (cli/brain-lint.ts); the hand-duplicated `FULL_SCOPE_CHECK_NAMES`
// literal this file used to carry is exactly the drift risk F3 fixes, so the
// health-itemization pins below import the real thing instead. checkReflectorLoss
// is imported directly for the F2 pin's fixture precondition (the GLOBAL advisory
// is never kb-scoped, so there is no per-kb HTTP route to verify it through).
import { CHECK_NAMES, checkReflectorLoss } from './brain-lint.ts';
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
  maxAttempts = 240,
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

/** GET against an isolated bridge (mirrors `postAt`'s style/pairing). Used by
 *  the R6-08 WI-1 health-itemization RED pins below, which each need their
 *  OWN forge-root (a fresh 'cycles' with exactly one seeded defect, or the
 *  isolated alpha/alpha-two/throwkb fixtures) rather than the shared file-level
 *  fixture — mutating the SHARED 'cycles'/HEALTH_KB_ID KBs would risk
 *  interfering with the ~30 other tests in this file that read them. */
async function getAt(base: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Poll an isolated bridge's fix-agent state until terminal (or budget spent —
 *  returned as-is so the caller's assertion, not a silent timeout, reports). */
/** The assertion these helpers serve is "the run reaches a terminal state",
 *  never "within N seconds" — the budget is harness headroom, not an
 *  acceptance criterion. Raised from 40 when the lint began walking Brain 3
 *  too (M1-D): a drain round re-lints the whole corpus, and this file's forge
 *  root seeds a dozen project brains, so a full consolidate settles in ~13s
 *  against the old 10s ceiling. */
async function pollTerminalAt(
  base: string,
  kbId: string,
  runId: string,
  maxAttempts = 240,
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
  // W7-B2: its OWN seeded KB — the mutating routes are mutually gated on the
  // per-KB active job now, and a completed consolidate here would clear
  // CONSOLIDATE_KB_ID's seeded findings before the ratchet test measures them.
  seedProjectBrain(forgeRoot, 'r1-06-redpin', ['rp-one']);
  const { status, json } = await post('/api/studio/kbs/r1-06-redpin/maintenance', { op: 'consolidate' });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
  assert.equal(json['ok'], true, JSON.stringify(json));
  assert.equal(typeof json['runId'], 'string', `expected a string runId, got ${JSON.stringify(json)}`);
  assert.ok((json['runId'] as string).length > 0, 'runId must be non-empty');
  const settled = await pollTerminalAt(bridgeUrl, 'r1-06-redpin', json['runId'] as string);
  assert.notEqual(settled.state, 'running', 'red-pin consolidate never reached a terminal state within budget');
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
// W6-B14 — GET /api/studio/kbs/:id/consolidate/active: reattach discovery
// for a client that lost its consolidate runId (nav-away, reload). The old
// `lib/kb-consolidate.ts` `runConsolidateToTerminal` awaited its OWN bounded
// poll loop directly inside the dispatching click handler, so the run's
// result (though the run itself kept going server-side) was simply
// unreachable again once that handler's closure was gone.
// ---------------------------------------------------------------------------

test('W6-B14: GET .../consolidate/active on a kb that has never consolidated -> {ok:true, runId:null}, never a guess', async () => {
  // HEALTH_KB_ID (unlike CONSOLIDATE_KB_ID) is never dispatched through
  // op=consolidate anywhere else in this file — genuinely untouched.
  const { status, json } = await get(`/api/studio/kbs/${HEALTH_KB_ID}/consolidate/active`);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
  assert.equal(json['runId'], null);
});

test('W6-B14: GET .../consolidate/active rediscovers the runId of a just-dispatched consolidate run, and its state matches the SAME fix-agent GET the runId itself is pollable through', async () => {
  const dispatch = await post(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/maintenance`, { op: 'consolidate' });
  assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
  const runId = dispatch.json['runId'] as string;
  assert.equal(typeof runId, 'string');

  const active = await get(`/api/studio/kbs/${CONSOLIDATE_KB_ID}/consolidate/active`);
  assert.equal(active.status, 200, JSON.stringify(active.json));
  assert.equal(active.json['ok'], true);
  assert.equal(active.json['runId'], runId, 'active discovery must rediscover the SAME runId the dispatch minted');

  // The rediscovered runId polls to a terminal state through the byte-
  // identical fix-agent route the consolidate ratchet test above already
  // proves — never a dead end.
  const terminal = await pollUntilTerminal(CONSOLIDATE_KB_ID, runId);
  assert.notEqual(terminal.state, 'running');
});

test('W6-B14: GET .../consolidate/active with an invalid (non-slug) kb id -> 400', async () => {
  const { status, json } = await get(`/api/studio/kbs/${encodeURIComponent('Not A Slug!')}/consolidate/active`);
  assert.equal(status, 400, JSON.stringify(json));
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

  // Verdict: the health object's lintFlags must reflect those same 3 findings
  // — PLUS 6 more, all from the ONE full-scope scan now that it walks
  // brain/projects/<id>/themes (M1-D, ADR 035). By hand, over this fixture's 3
  // unlisted, near-identically-titled themes:
  //   3  checkProjectBrainIndexes — not listed in the project category index
  //   3  checkOrphans             — not reachable from INDEX.md or any index
  //   3  checkDuplicateThemes     — normalized-title collision across the trio
  // 3 + 3 + 3 = 9. Each is a distinct check's own honest verdict on the same
  // three files, not one check counted three times.
  //
  // It used to be 6: 3 checkProjectBrainIndexes plus 3 from a SECOND lens
  // (lintThemeFiles over the KB's own theme files), whose non-project-aware
  // checkIndexSync rediscovered the "not listed in patterns.md" defect under a
  // different check name. That lens existed only because the shared scan never
  // walked this KB at all; with the scan fixed it is gone, and with it the
  // possibility of Studio counting a flag `forge brain lint` does not report.
  const detail = await get(`/api/studio/kbs/${HEALTH_KB_ID}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  const health = detail.json['health'] as { lintFlags?: number; lintErrors?: number } | undefined;
  assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
  assert.equal(
    health!.lintFlags,
    9,
    `expected health.lintFlags=9 for a project KB with 3 checkProjectBrainIndexes + 3 checkOrphans + 3 checkDuplicateThemes flags, got ${health!.lintFlags} — the health filter is mis-scoped to brain/<id> instead of brain/projects/<id>`,
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

// ---------------------------------------------------------------------------
// R1-06 WI-4 kb-maintain journey pin (dry-bridge consolidate refusal): the
// journey harness runs `forge studio` under FORGE_DRY_BRIDGE=1 (scripts/
// e2e-journey.mjs) — the seam that stops the bridge performing real
// spawn/merge/daemon side-effects. The consolidate route USED to refuse the
// WHOLE op under dry-bridge (`refuseDryBridge` → 409, action:'spawn-agent'),
// which killed the DETERMINISTIC in-process repair too: the exact same
// spawn-free category-index append op=fix-auto already performs under
// dry-bridge with no guard. So the kb-maintain beat saw consolidate 409
// (data-consolidate-state="error", never "cleared") and the seeded lint flag
// never dropped — a KB whose health legitimately reports a fixable flag could
// not be healed under the journey/CI env (declared-data-fails-open: health
// surfaces a finding the only fix path refuses to act on).
//
// runBrainConsolidateNow already treats isDryBridge() as `noSpawn`, so the ONLY
// thing dry-bridge must suppress — a real agent turn on the residual — is
// skipped there regardless. The route must therefore dispatch (not refuse), and
// the deterministic path clears the "not listed" finding in-process, terminal
// 'cleared', health back to 0.
//
// RED before fix: POST consolidate under FORGE_DRY_BRIDGE=1 returns 409
// (dry-bridge), so it never reaches a 'cleared' terminal and health stays 1.
// ---------------------------------------------------------------------------
test('R1-06 WI-4 kb-maintain pin: under FORGE_DRY_BRIDGE=1, consolidate still drives a real lint reduction (health 1 → cleared → 0) — RED before fix', async () => {
  const iso = await makeIsolatedForge();
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1'; // mirror the journey harness's bridge env
  try {
    // The exact journey fixture shape: a project-bound KB with ONE `pattern`
    // theme deliberately absent from its own patterns.md category index.
    seedProjectBrain(iso.root, 'drybridge-consolidate', ['scratch-maintain-lesson']);

    const health = async (): Promise<number> => {
      const res = await fetch(`${iso.url}/api/studio/kbs/drybridge-consolidate`);
      const json = (await res.json()) as { health?: { lintFlags?: number } };
      return json.health?.lintFlags ?? -1;
    };

    // Fixture precondition, asserted BEFORE the verdict: health reflects the
    // fixable lint flag(s) even under dry-bridge (a pure read, never gated).
    // R6-08 4on: 2, not 1 — buildKbHealth now ALSO runs lintThemeFiles over
    // this KB's own theme file (F1 fix), and its checkIndexSync independently
    // rediscovers the same "theme not listed in patterns.md" defect
    // checkProjectBrainIndexes already flags — two distinct, both-real checks
    // on the one seeded theme, not a double-count of a single check.
    assert.equal(
      await health(),
      2,
      'precondition: health.lintFlags must be 2 for the seeded flagged KB (checkProjectBrainIndexes + checkIndexSync, R6-08 4on — under dry-bridge)',
    );
    // And op=lint (already dry-bridge-allowed) agrees the finding is real.
    const baseline = await postAt(iso.url, `/api/studio/kbs/drybridge-consolidate/maintenance`, { op: 'lint' });
    const baselineFindings = (baseline.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(baselineFindings.length, 1, `precondition: expected 1 seeded finding, got ${baselineFindings.length}`);

    // Verdict 1: consolidate is DISPATCHED under dry-bridge (RED: 409), handing
    // back the async run handle rather than refusing.
    const dispatch = await postAt(iso.url, `/api/studio/kbs/drybridge-consolidate/maintenance`, { op: 'consolidate' });
    assert.equal(
      dispatch.status,
      200,
      `consolidate must dispatch (200) under dry-bridge, not 409-refuse — got ${dispatch.status}: ${JSON.stringify(dispatch.json)}`,
    );
    assert.equal(dispatch.json['ok'], true, JSON.stringify(dispatch.json));
    const runId = dispatch.json['runId'];
    assert.equal(typeof runId, 'string', `expected a string runId, got ${JSON.stringify(dispatch.json)}`);

    // Verdict 2: the deterministic in-process path drains to a 'cleared'
    // terminal — no spawn, no SDK turn (the CI-safe shipped shape).
    const terminal = await pollTerminalAt(iso.url, 'drybridge-consolidate', runId as string);
    assert.equal(
      terminal.state,
      'cleared',
      `consolidate must reach a 'cleared' terminal under dry-bridge, got '${terminal.state}'`,
    );

    // Verdict 3: the seeded finding is actually gone — follow-up lint 0 AND
    // health lintFlags back to 0 (the reduction the beat observes).
    const after = await postAt(iso.url, `/api/studio/kbs/drybridge-consolidate/maintenance`, { op: 'lint' });
    const afterFindings = (after.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(afterFindings.length, 0, `consolidate must clear the seeded finding, ${afterFindings.length} remain`);
    assert.equal(await health(), 0, 'health.lintFlags must drop to 0 after consolidate cleared the finding');
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
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

// =============================================================================
// R6-08 WI-1 (F2 Health itemization) — RED pins (T3).
//
// buildKbHealth (this file, lines ~577-634) today returns only an AGGREGATE
// `{ lintFlags, lintErrors }` — no per-check breakdown. This block pins the
// itemized `checks: Array<{check,status,errorCount,flagCount}>` field the F2
// Health tab renders, for ALL full-scope checks (cli/brain-lint.ts:1123-1136;
// checkCleanupCandidates excluded — cleanup-dry-run only), always present (a
// clean check reports status:'pass', never omitted). 12 as of R4-19-F2
// (checkDanglingEdges + checkDuplicateThemes joined the original 10).
//
//   RULING 2 — the aggregate `lintFlags`/`lintErrors` fields stay, derived as a
//   roll-up OVER checks[] (never dropped, never allowed to diverge).
//   RULING 3 — if the lint run throws, EVERY check reports status:'unknown'
//   plus a top-level `healthError` string — never a silent 0/0 "clean" pass
//   (buildKbHealth's current `catch { lintFlags = 0; lintErrors = 0; }` at
//   lines ~629-631 is exactly this declared-data-fails-open bug).
//
// R6-08 4on (F3 hardening): `FULL_SCOPE_CHECK_NAMES` is now the REAL exported
// `CHECK_NAMES` (cli/brain-lint.ts), imported above — never hand-duplicated —
// so this test's set-equality assertion is what forbids the itemization from
// silently drifting off whatever `runBrainLint` actually iterates.
// =============================================================================

const FULL_SCOPE_CHECK_NAMES = CHECK_NAMES;

type CheckHealthEntry = { check: string; status: string; errorCount: number; flagCount: number };

test('R6-08 WI-1 RED-A: GET health.checks itemizes EXACTLY the 12 full-scope checks (set-equality) — RED today (checks absent)', async () => {
  // Mirrors the existing R1-06 health test's harness (~:534-559): the shared
  // `get()` helper against the never-mutated HEALTH_KB_ID fixture.
  const detail = await get(`/api/studio/kbs/${HEALTH_KB_ID}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  const health = detail.json['health'] as { checks?: CheckHealthEntry[] } | undefined;
  assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
  assert.ok(Array.isArray(health!.checks), `health.checks must be an array — got ${JSON.stringify(health)}`);
  const names = health!.checks!.map((c) => c.check).sort();
  const expected = [...FULL_SCOPE_CHECK_NAMES].sort();
  assert.deepEqual(
    names,
    expected,
    `health.checks must itemize exactly the 12 full-scope checks (checkCleanupCandidates excluded — cleanup-dry-run only). Expected ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`,
  );
});

test('R6-08 4on: a lone checkFrontmatter defect (missing description) on the top-level "cycles" KB yields checks[checkFrontmatter]={fail,errorCount:1}; the applicable forge-themes checks pass; the non-applicable checks (checkProjectBrainIndexes/checkReflectorLoss) are honestly n/a, NOT pass; aggregate lintErrors rolls up (RULING 2)', async () => {
  const iso = await makeIsolatedForge();
  try {
    // Fresh, ISOLATED 'cycles' KB (checkFrontmatter/checkIndexSync/checkOrphans
    // are hardcoded to THEME_SUBDIRS=['cycles','forge-dev'] — cli/brain-lint.ts:124
    // — so a project-brain fixture can never exercise checkFrontmatter at all;
    // this must be a top-level brain). Isolated rather than the shared 'cycles'
    // fixture, which ~15 other tests in this file read and must stay pristine.
    mkdirSync(join(iso.root, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(iso.root, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
    // Linked once in patterns.md (satisfies checkIndexSync + checkOrphans —
    // both scan brain/cycles/*.md for theme links) so checkFrontmatter's
    // missing-description error is the FIXTURE's ONLY defect.
    writeFileSync(
      join(iso.root, 'brain', 'cycles', 'patterns.md'),
      '# cycles — Patterns\n\n> Category index.\n\n## Theme pages\n- [`rb-frontmatter`](./themes/rb-frontmatter.md) — fixture theme.\n',
    );
    writeFileSync(
      join(iso.root, 'brain', 'cycles', 'themes', 'rb-frontmatter.md'),
      '---\ntitle: "RB Frontmatter Fixture"\ncategory: pattern\ncreated_at: "2026-08-01T00:00:00Z"\nupdated_at: "2026-08-01T00:00:00Z"\n---\n\n' +
      '# RB Frontmatter Fixture\n\nMinimal fixture body with no links (deliberately missing `description` — the ONE defect this fixture carries).\n',
    );

    const detail = await getAt(iso.url, '/api/studio/kbs/cycles');
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    const health = detail.json['health'] as
      | { checks?: CheckHealthEntry[]; lintErrors?: number; lintFlags?: number }
      | undefined;
    assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
    assert.ok(Array.isArray(health!.checks), `health.checks must be an array — got ${JSON.stringify(health)}`);

    const byName = new Map(health!.checks!.map((c) => [c.check, c]));
    const fm = byName.get('checkFrontmatter');
    assert.ok(fm, `checks[] must include a checkFrontmatter entry, got ${JSON.stringify(health!.checks)}`);
    assert.equal(fm!.status, 'fail', `checkFrontmatter must be status:'fail' for the seeded missing-description defect, got ${JSON.stringify(fm)}`);
    assert.equal(fm!.errorCount, 1, `checkFrontmatter errorCount must be 1, got ${JSON.stringify(fm)}`);

    // R6-08 4on (F1/F2 correction): the OLD expectation here — EVERY other
    // check reports 'pass' — encoded the reviewer-proved MISLEADING behavior:
    // checkProjectBrainIndexes (scans brain/projects/*) and checkReflectorLoss
    // (a GLOBAL advisory over _queue/done) never actually inspect a top-level
    // 'cycles' KB at all, so reporting 'pass' for them was a declared-data-
    // fails-open lie (twelve green dots, only ten of which ever ran, as of
    // R4-19-F2's checkDanglingEdges + checkDuplicateThemes). Under the honest
    // design those two report 'n/a'; the remaining 9 forge-themes checks
    // genuinely DID scan this KB (readThemeFiles walks brain/cycles/
    // themes) and correctly report 'pass' on this single-defect fixture.
    const NEVER_APPLICABLE_TO_CYCLES = new Set(['checkProjectBrainIndexes', 'checkReflectorLoss']);
    for (const name of FULL_SCOPE_CHECK_NAMES) {
      if (name === 'checkFrontmatter') continue;
      const entry = byName.get(name);
      assert.ok(entry, `checks[] must ALWAYS include a ${name} entry, even when clean (never absent) — got ${JSON.stringify(health!.checks)}`);
      if (NEVER_APPLICABLE_TO_CYCLES.has(name)) {
        assert.equal(entry!.status, 'n/a', `${name} never scans a top-level 'cycles' KB — it must report 'n/a', NOT 'pass' (declared-data-fails-open), got ${JSON.stringify(entry)}`);
      } else {
        assert.equal(entry!.status, 'pass', `${name} must be status:'pass' on this single-defect fixture, got ${JSON.stringify(entry)}`);
      }
    }

    // RULING 2: the aggregate lintErrors/lintFlags fields are KEPT — derived
    // as a roll-up over checks[], never dropped and never allowed to diverge.
    assert.equal(health!.lintErrors, 1, `aggregate lintErrors must roll up to 1, got ${health!.lintErrors}`);
    const rollupErrors = health!.checks!.reduce((sum, c) => sum + c.errorCount, 0);
    assert.equal(health!.lintErrors, rollupErrors, `aggregate lintErrors (${health!.lintErrors}) must equal the sum of checks[].errorCount (${rollupErrors})`);
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('R6-08 WI-1 RED-C (risk #5, sibling-leak guard): checks[checkProjectBrainIndexes].flagCount for "alpha" excludes sibling "alpha-two"s findings — RED today (checks absent)', async () => {
  const iso = await makeIsolatedForge();
  try {
    // The SAME alpha/alpha-two sibling fixture shape as the existing MAJOR 2
    // red-pin above (~:572): alpha has 2 unlisted theme findings, alpha-two
    // has 1 — a naive substring scope (`file.includes('alpha')`) would fold
    // alpha-two's finding into alpha's count (3, not 2).
    seedProjectBrain(iso.root, 'alpha', ['a-one', 'a-two']);
    seedProjectBrain(iso.root, 'alpha-two', ['b-one']);

    // Fixture precondition (before any verdict): the pre-existing, already
    // correctly-scoped op=lint read really does see 2 findings for alpha,
    // independent of alpha-two.
    const lintAlpha = await postAt(iso.url, '/api/studio/kbs/alpha/maintenance', { op: 'lint' });
    const alphaFindings = (lintAlpha.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(alphaFindings.length, 2, `precondition: alpha must have 2 checkProjectBrainIndexes findings via op=lint, got ${alphaFindings.length}`);

    const detail = await getAt(iso.url, '/api/studio/kbs/alpha');
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    const health = detail.json['health'] as { checks?: CheckHealthEntry[] } | undefined;
    assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
    assert.ok(Array.isArray(health!.checks), `health.checks must be an array — got ${JSON.stringify(health)}`);

    const entry = health!.checks!.find((c) => c.check === 'checkProjectBrainIndexes');
    assert.ok(entry, `checks[] must include a checkProjectBrainIndexes entry, got ${JSON.stringify(health!.checks)}`);
    assert.equal(
      entry!.flagCount,
      2,
      `checkProjectBrainIndexes.flagCount for "alpha" must be exactly 2 (its own findings only) — a naive substring scope would fold in sibling "alpha-two"'s 1 finding and report 3. Got ${JSON.stringify(entry)}`,
    );
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('R6-08 WI-1 addendum (RULING 3, unlettered in the WI spec): a lint-run throw marks every check status:"unknown" plus a top-level healthError — never a silent 0/0 pass — RED today', async () => {
  const iso = await makeIsolatedForge();
  try {
    // The SAME 'throwkb' fixture as the existing MINOR 1 red-pin above
    // (patterns.md is a DIRECTORY → readIndexEntries' readFileSync throws
    // EISDIR, uncaught inside checkProjectBrainIndexes → runBrainLint throws).
    // Confirmed empirically before writing this assertion: GET .../throwkb's
    // graph build does NOT throw (buildKbGraph tolerates the directory), only
    // buildKbHealth's runBrainLint call does — so this reaches a 200 today,
    // just with the current silent-catch bug (lintFlags/lintErrors both 0).
    seedProjectBrain(iso.root, 'throwkb', ['t-one'], { patternsAsDir: true });

    const detail = await getAt(iso.url, '/api/studio/kbs/throwkb');
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    const health = detail.json['health'] as { checks?: CheckHealthEntry[]; healthError?: string } | undefined;
    assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
    assert.ok(Array.isArray(health!.checks), `health.checks must be an array even on a lint-run throw — got ${JSON.stringify(health)}`);
    assert.ok(
      health!.checks!.length > 0 && health!.checks!.every((c) => c.status === 'unknown'),
      `every check must be status:'unknown' when the lint run throws — got ${JSON.stringify(health!.checks)}`,
    );
    assert.equal(
      typeof health!.healthError,
      'string',
      `a top-level healthError (string) must be present on a lint-run throw — got ${JSON.stringify(health)}`,
    );
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// =============================================================================
// R6-08 4on — additional adversarial-review MAJOR fixes (F1/F2/F3).
// =============================================================================

test('R6-08 4on (F2): checkReflectorLoss is a GLOBAL advisory (_queue/done) — every kb reports it "n/a", never "pass", even when a real reflector-loss condition exists', async () => {
  const iso = await makeIsolatedForge();
  try {
    // Seed a REAL reflector-loss condition: a `_queue/done/` manifest with no
    // matching archive under `brain/cycles/_raw/` — checkReflectorLoss's own
    // trigger (cli/brain-lint.ts). Deliberately GLOBAL: nothing ties this
    // manifest to any one KB's brain dir (its `file` is under `_queue/done/`,
    // never under `brain/<kbId>`).
    writeFileSync(join(iso.root, '_queue', 'done', 'lost-init.md'), '# lost initiative\n');

    // Fixture precondition, asserted directly against the real check (there is
    // no per-kb HTTP route for a check that is never kb-scoped): the condition
    // is genuinely real, not a fixture no-op.
    const findings = checkReflectorLoss(iso.root);
    assert.equal(
      findings.length,
      1,
      `precondition: checkReflectorLoss must find the seeded lost-init manifest, got ${JSON.stringify(findings)}`,
    );

    // A top-level forge kb ('cycles') and a project kb — the GLOBAL/never-
    // applicable verdict must hold for EVERY kb kind, not just one.
    mkdirSync(join(iso.root, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(iso.root, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
    seedProjectBrain(iso.root, 'reflector-loss-check', ['r-one']);

    for (const kbId of ['cycles', 'reflector-loss-check']) {
      const detail = await getAt(iso.url, `/api/studio/kbs/${kbId}`);
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      const health = detail.json['health'] as { checks?: CheckHealthEntry[] } | undefined;
      assert.ok(health, `health object must be present for "${kbId}", got ${JSON.stringify(detail.json)}`);
      assert.ok(Array.isArray(health!.checks), `health.checks must be an array for "${kbId}" — got ${JSON.stringify(health)}`);
      const entry = health!.checks!.find((c) => c.check === 'checkReflectorLoss');
      assert.ok(entry, `checks[] must include a checkReflectorLoss entry for "${kbId}", got ${JSON.stringify(health!.checks)}`);
      assert.equal(
        entry!.status,
        'n/a',
        `checkReflectorLoss never inspects any single kb's brain dir — "${kbId}" must report 'n/a', NEVER 'pass', even though the seeded condition is genuinely real (declared-data-fails-open). Got ${JSON.stringify(entry)}`,
      );
    }
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('R6-08 4on (F1): a project kb with NO own themes reports the 10 forge-theme checks "n/a" (never "pass"); with an own theme carrying a real defect, the lintThemeFiles-covered check is real (fail)', async () => {
  const iso = await makeIsolatedForge();
  try {
    // Part 1 — a project kb scaffolded with an empty themes/ dir: the shared
    // readThemeFiles-based checks never see it (it isn't brain/cycles or
    // brain/forge-dev) AND lintThemeFiles has nothing of its own to lint
    // (0 own theme files) — every forge-themes-scoped check must be honestly
    // 'n/a', never a silent 'pass' implying "scanned, found nothing".
    const emptyId = 'f1-empty-themes-project';
    const emptyDir = join(iso.root, 'brain', 'projects', emptyId);
    mkdirSync(join(emptyDir, 'themes'), { recursive: true });
    writeFileSync(
      join(emptyDir, 'kb.yaml'),
      `id: ${emptyId}\nname: ${emptyId}\nbinding: { kind: project, ref: ${emptyId} }\ndesc: F1 no-own-themes fixture.\nbackend: filesystem\n`,
    );
    writeFileSync(join(emptyDir, 'patterns.md'), `# ${emptyId} — Patterns\n\n> fixture index.\n\n## Theme pages\n`);

    const emptyDetail = await getAt(iso.url, `/api/studio/kbs/${emptyId}`);
    assert.equal(emptyDetail.status, 200, JSON.stringify(emptyDetail.json));
    const emptyHealth = emptyDetail.json['health'] as { checks?: CheckHealthEntry[] } | undefined;
    assert.ok(emptyHealth, `health object must be present, got ${JSON.stringify(emptyDetail.json)}`);
    const emptyByName = new Map(emptyHealth!.checks!.map((c) => [c.check, c]));
    // A project kb with 0 theme files has nothing for any of these to inspect.
    // The scan walks its themes/ dir now (ADR 035) but reads no file out of
    // it, so every one of them must report 'n/a' — a check that opened nothing
    // has not earned a 'pass' over an empty set.
    const FORGE_THEME_CHECKS = [
      'checkFrontmatter', 'checkIndexSync', 'checkSourceLinks', 'checkStaleness',
      'checkOrphans', 'checkLengthSoftCap', 'checkContradictions', 'checkCategoryScope',
      'checkDanglingEdges', 'checkDuplicateThemes',
    ] as const;
    for (const name of FORGE_THEME_CHECKS) {
      const entry = emptyByName.get(name);
      assert.ok(entry, `checks[] must include a ${name} entry, got ${JSON.stringify(emptyHealth!.checks)}`);
      assert.equal(
        entry!.status,
        'n/a',
        `${name} never scans a project kb's brain dir AND this kb has 0 own theme files — must report 'n/a', NEVER 'pass'. Got ${JSON.stringify(entry)}`,
      );
    }

    // Part 2 — a SEPARATE project kb with ONE own theme carrying a real
    // defect (missing `description`), correctly linked in its own patterns.md
    // so checkIndexSync stays clean and checkFrontmatter is the fixture's
    // ONLY defect. This is what makes a project kb's Health REAL: the SAME
    // check that reported 'n/a' above now reports a genuine, freshly-computed
    // 'fail' when it has real content of its own to inspect.
    const defectId = 'f1-defect-project';
    const defectDir = join(iso.root, 'brain', 'projects', defectId);
    mkdirSync(join(defectDir, 'themes'), { recursive: true });
    writeFileSync(
      join(defectDir, 'kb.yaml'),
      `id: ${defectId}\nname: ${defectId}\nbinding: { kind: project, ref: ${defectId} }\ndesc: F1 own-theme-defect fixture.\nbackend: filesystem\n`,
    );
    writeFileSync(
      join(defectDir, 'patterns.md'),
      `# ${defectId} — Patterns\n\n> fixture index.\n\n## Theme pages\n- [\`f1-defect-theme\`](./themes/f1-defect-theme.md) — fixture theme.\n`,
    );
    writeFileSync(
      join(defectDir, 'themes', 'f1-defect-theme.md'),
      '---\ntitle: "F1 Own-Theme Defect Fixture"\ncategory: pattern\ncreated_at: "2026-08-01T00:00:00Z"\nupdated_at: "2026-08-01T00:00:00Z"\n---\n\n' +
      '# F1 Own-Theme Defect Fixture\n\nDeliberately missing `description` — the ONE defect this fixture carries.\n',
    );

    const defectDetail = await getAt(iso.url, `/api/studio/kbs/${defectId}`);
    assert.equal(defectDetail.status, 200, JSON.stringify(defectDetail.json));
    const defectHealth = defectDetail.json['health'] as { checks?: CheckHealthEntry[] } | undefined;
    assert.ok(defectHealth, `health object must be present, got ${JSON.stringify(defectDetail.json)}`);
    const fm = defectHealth!.checks!.find((c) => c.check === 'checkFrontmatter');
    assert.ok(fm, `checks[] must include a checkFrontmatter entry, got ${JSON.stringify(defectHealth!.checks)}`);
    assert.equal(
      fm!.status,
      'fail',
      `checkFrontmatter is LINT_THEME_FILE_CHECKS-covered and this kb has 1 own theme with a real missing-description defect — must report a genuine 'fail', not 'n/a'/'pass'. Got ${JSON.stringify(fm)}`,
    );
    assert.equal(fm!.errorCount, 1, `checkFrontmatter errorCount must be 1, got ${JSON.stringify(fm)}`);

    // The index verdict stays clean (real 'pass') — the theme IS linked —
    // proving this is a genuine per-check computation, not every check going
    // red together. For a project brain that verdict is
    // checkProjectBrainIndexes': it resolves the index in the project's OWN
    // dir. checkIndexSync resolves it through the ADR 018 category→sub-wiki
    // routing map (pattern→brain/cycles), which governs the forge brains
    // alone, so for this KB it is honestly 'n/a' — it would otherwise look for
    // this theme in brain/cycles/patterns.md and flag every project theme in
    // the repo as unindexed.
    const pbi = defectHealth!.checks!.find((c) => c.check === 'checkProjectBrainIndexes');
    assert.ok(pbi, `checks[] must include a checkProjectBrainIndexes entry, got ${JSON.stringify(defectHealth!.checks)}`);
    assert.equal(pbi!.status, 'pass', `checkProjectBrainIndexes must be a real 'pass' (theme correctly linked in its own index), got ${JSON.stringify(pbi)}`);
    const idx = defectHealth!.checks!.find((c) => c.check === 'checkIndexSync');
    assert.ok(idx, `checks[] must include a checkIndexSync entry, got ${JSON.stringify(defectHealth!.checks)}`);
    assert.equal(idx!.status, 'n/a', `checkIndexSync is the forge category→sub-wiki index rule — must be 'n/a' for a project brain, never a verdict it did not compute. Got ${JSON.stringify(idx)}`);

    // checkCategoryScope is 'n/a' even though this KB has an own theme carrying
    // `category: pattern`: the category→sub-wiki routing rule is a three-brain
    // (ADR 018) convention that governs ONLY the forge KBs (cycles/forge-dev),
    // so it is NOT in LINT_THEME_FILE_CHECKS. Reporting 'pass' here would be a
    // vacuous exempt-pass (lintThemeFiles skips the routing check for non-cycles
    // /forge-dev themes anyway) and reporting 'fail' would be the false-FAIL a
    // band/flow KB's own theme would otherwise hit — 'n/a' is the honest state.
    const cat = defectHealth!.checks!.find((c) => c.check === 'checkCategoryScope');
    assert.ok(cat, `checks[] must include a checkCategoryScope entry, got ${JSON.stringify(defectHealth!.checks)}`);
    assert.equal(cat!.status, 'n/a', `checkCategoryScope is a forge-brain-only routing convention — must be 'n/a' for a non-forge KB, never a vacuous 'pass' or a false 'fail'. Got ${JSON.stringify(cat)}`);
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W8-F1 / knowledge-42 (bead forge-6gv.6.2 — a named row of a CLOSED bead that
// still reproduces end to end, re-confirmed twice in the C4 regate).
//
// `writeConsolidateTerminalEvent` hardcodes
//   `const cleared = outcome.total === 0 || outcome.clearedCount === outcome.total;`
// so a consolidate that found NOTHING writes `cleared: true`, and the KB
// action-result pill reads "consolidate: cleared ✓" — the identical wording a
// run that really fixed something produces. `readBrainFixState` then drops
// `total`/`clearedCount` entirely, so no consumer can tell the two apart.
//
// The cure is to DERIVE rather than assert: a run has cleared something only
// when it cleared something, and the counters the event already carries are
// threaded to the surface so "nothing to clear" can be said out loud.
// ---------------------------------------------------------------------------

test('W8-F1 (knowledge-42): a consolidate over ZERO findings does not report "cleared" — and its counters reach the wire', async () => {
  // No themes ⇒ no findings at all ⇒ the run has nothing to clear.
  seedProjectBrain(forgeRoot, 'w8f1-noop-kb', []);
  const dispatch = await post('/api/studio/kbs/w8f1-noop-kb/maintenance', { op: 'consolidate' });
  assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
  const runId = dispatch.json['runId'] as string;

  let body: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${bridgeUrl}/api/studio/kbs/w8f1-noop-kb/fix-agent/${runId}`);
    body = (await res.json()) as Record<string, unknown>;
    if (body['state'] && body['state'] !== 'running') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.notEqual(body['state'], 'running', 'the zero-findings consolidate never reached a terminal state');
  assert.equal(
    body['cleared'],
    false,
    `a run that fixed nothing must not report cleared — got ${JSON.stringify(body)}`,
  );
  // The counters the event already carries must reach the surface, so the pill
  // can say "nothing to clear" instead of either lie ("cleared ✓" / "some
  // findings remain"). A field the wire drops is a field no UI can be honest
  // about — the declared-data-fails-open shape, in reverse.
  assert.equal(body['total'], 0, `the run's own finding count must be on the wire — got ${JSON.stringify(body)}`);
  assert.equal(body['clearedCount'], 0, `and its cleared count — got ${JSON.stringify(body)}`);
});
