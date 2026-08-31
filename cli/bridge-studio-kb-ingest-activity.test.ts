/**
 * bridge-studio-kb-ingest-activity.test.ts — R6-08 WI-2 (F2 Ingest-activity,
 * read-only) RED pins (T3). Mirrors cli/bridge-studio-kbs.test.ts's route +
 * tmp-forge-root bridge harness (see that file's header + `before`/`after`).
 *
 * Pins a NEW read-only route, `GET /api/studio/kbs/:id/ingest-activity`, that
 * lists REAL `reflect.kb-ingest` events (message string LITERALLY
 * 'reflect.kb-ingest', emitted by orchestrator/kb-health.ts:206/213/216;
 * metadata `{kb, fresh_themes, impl:'builtin'|'cmd'}`) discovered via a
 * listCycles-style walk of `_logs/<cycleId>/events.jsonl` (mirroring
 * cli/metrics.ts:46-76's `listCycles` + `guardedReadFile`), filtered to
 * `metadata.kb === kbId` AFTER the guarded read — kbId is never folded into
 * the filesystem path itself. NO ingest affordance: GET-only, no dispatch,
 * nothing this route does can trigger an ingest.
 *
 * RUN: node --experimental-strip-types --test cli/bridge-studio-kb-ingest-activity.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startBridge } from './ui-bridge.ts';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_KBS_PATH = join(FORGE_ROOT, 'packages', 'knowledge', 'bridge-studio-kbs.ts');

// A scratch project KB — never a real project brain, seeded ONLY for these
// ingest-activity RED pins.
const KB_ID = 'r6-08-ingest';
const KB_YAML =
  `id: ${KB_ID}\nname: R6-08 Ingest Activity Fixture (scratch)\n` +
  `binding: { kind: project, ref: ${KB_ID} }\n` +
  `desc: Scratch project KB seeded ONLY for the WI-2 ingest-activity RED pins.\nbackend: filesystem\n`;

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-kb-ingest-activity-'));
  // Minimal _queue + _logs scaffold, mirroring bridge-studio-kbs.test.ts's shared before().
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  const kbDir = join(forgeRoot, 'brain', 'projects', KB_ID);
  mkdirSync(join(kbDir, 'themes'), { recursive: true });
  writeFileSync(join(kbDir, 'kb.yaml'), KB_YAML);

  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeServer = result.close;
});

after(async () => {
  await closeServer?.();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

/**
 * Tolerant GET: a totally unmatched route falls through to the bridge's bare
 * `res.writeHead(404); res.end();` fallback (cli/ui-bridge.ts:1985-1986) —
 * an EMPTY body, not JSON. Parsing that with a bare `.json()` would throw
 * before any assertion runs, turning a clean "expected 200, got 404" failure
 * into an opaque JSON-parse crash. Read as text first and tolerate an
 * empty/non-JSON body as `{}` so every RED below fails with an informative
 * assertion message instead.
 */
async function get(path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`);
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { _rawText: text };
    }
  }
  return { status: res.status, json };
}

/** Seed one `reflect.kb-ingest` event into `_logs/<cycleId>/events.jsonl`.
 *  Field shapes follow orchestrator/logging.ts's `EventLogEntry` (only the
 *  fields this route cares about — `message`/`metadata` — carry real test
 *  values; the rest are minimal-valid placeholders). */
function writeIngestEvent(cycleId: string, metadata: Record<string, unknown>): void {
  const dir = join(forgeRoot, '_logs', cycleId);
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    event_id: `${cycleId}-reflect-kb-ingest`,
    cycle_id: cycleId,
    initiative_id: 'init-1',
    phase: 'reflector',
    skill: 'reflect',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    started_at: new Date().toISOString(),
    message: 'reflect.kb-ingest',
    metadata,
  });
  writeFileSync(join(dir, 'events.jsonl'), line + '\n');
}

test('R6-08 WI-2 RED-E: GET .../ingest-activity surfaces a seeded reflect.kb-ingest event for this KB — RED today (route absent)', async () => {
  writeIngestEvent('cycle-a', { kb: KB_ID, fresh_themes: 2, impl: 'builtin' });

  const { status, json } = await get(`/api/studio/kbs/${KB_ID}/ingest-activity`);
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
  const events = json['events'] as Array<{ kb?: string; freshThemes?: number }> | undefined;
  assert.ok(Array.isArray(events), `events must be an array — got ${JSON.stringify(json)}`);
  assert.equal(events!.length, 1, `expected exactly 1 event, got ${events!.length}: ${JSON.stringify(events)}`);
  assert.equal(events![0].kb, KB_ID, JSON.stringify(events));
  assert.equal(events![0].freshThemes, 2, JSON.stringify(events));
});

test('R6-08 WI-2 RED-F (risk #3, real-source): events from TWO different cycle dirs BOTH surface (proves a listCycles-style walk, not one hardcoded path) — RED today (route absent)', async () => {
  writeIngestEvent('cycle-x', { kb: KB_ID, fresh_themes: 3, impl: 'builtin' });
  writeIngestEvent('cycle-y', { kb: KB_ID, fresh_themes: 5, impl: 'cmd', cmd: 'forge brain fix' });

  const { status, json } = await get(`/api/studio/kbs/${KB_ID}/ingest-activity`);
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
  const events = json['events'] as Array<{ kb?: string; freshThemes?: number }> | undefined;
  assert.ok(Array.isArray(events), `events must be an array — got ${JSON.stringify(json)}`);
  const freshCounts = events!.map((e) => e.freshThemes);
  assert.ok(
    freshCounts.includes(3) && freshCounts.includes(5),
    `expected events from BOTH cycle-x (fresh_themes:3) and cycle-y (fresh_themes:5) — got ${JSON.stringify(events)}`,
  );
});

test('R6-08 WI-2 RED-G (risk #4, stricter-than-ratchet): the /ingest-activity route is GET-only (no POST branch on its URL pattern) — source-text; RED today because the route is absent', () => {
  const text = readFileSync(BRIDGE_KBS_PATH, 'utf8');
  const occurrences = [...text.matchAll(/ingest-activity/g)];
  assert.ok(
    occurrences.length > 0,
    'expected cli/bridge-studio-kbs.ts to define the /ingest-activity route (WI-2 F2 read-only ingest-activity route) — no occurrence of "ingest-activity" found; the route has not been implemented yet',
  );
  // Once the route exists: no occurrence's surrounding context may pair with
  // a POST method gate for the same URL pattern — the whole point of this
  // WI-2 obligation (read-only, no ingest affordance anywhere).
  for (const m of occurrences) {
    const start = Math.max(0, (m.index ?? 0) - 300);
    const end = Math.min(text.length, (m.index ?? 0) + 300);
    const windowText = text.slice(start, end);
    assert.ok(
      !/method\s*===\s*['"]POST['"]/.test(windowText),
      `found a POST-method gate near an "ingest-activity" occurrence at offset ${m.index} — the route must stay GET-only:\n${windowText}`,
    );
  }
});
