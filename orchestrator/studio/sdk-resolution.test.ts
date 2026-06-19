/**
 * SDK-id resolution gate (WS-F2).
 *
 * Proves the runtime sdk id is unified on the canonical 'claude' adapter and
 * that nothing in the shipped studio definitions can route to an sdk id that
 * `getAdapter()` would throw on:
 *
 *   (a) every catalog sdk id either resolves via getAdapter OR is available:false
 *       (a catalog entry may advertise a not-yet-registered sdk — e.g. codex —
 *       provided it is flagged unavailable, so the UI never offers it).
 *   (b) every studio SKILL.md `runtime.sdk` is a registered adapter id.
 *   (c) the bridge default for a body with no `runtime.sdk` (and no existing
 *       agent) resolves to a registered id.
 *   (d) resolveSdkId unit behaviour incl. the unavailable-fallback log callback.
 *
 * Resolves paths from the repo root (process.cwd()), same precedent as
 * seed-data.test.ts. Auto-run by the orchestrator/studio/*.test.ts glob.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { loadCatalog, isStudioAgent, loadAgentDefinition } from './registry.ts';
import { readdirSync } from 'node:fs';
import {
  getAdapter,
  isSdkAvailable,
  registeredSdkIds,
  resolveSdkId,
} from '../../loops/_adapters/registry.ts';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// (a) every catalog sdk id resolves OR is available:false (legalises codex)
// ---------------------------------------------------------------------------

test('every catalog sdk id resolves via getAdapter OR is available:false', () => {
  const catalog = loadCatalog(join(ROOT, 'studio/catalog.yaml'));
  assert.ok(catalog.sdks.length > 0, 'catalog must declare at least one sdk');

  for (const sdk of catalog.sdks) {
    if (sdk.available) {
      // An sdk advertised as available MUST resolve to a real adapter.
      assert.doesNotThrow(
        () => getAdapter(sdk.id),
        `catalog sdk "${sdk.id}" is available:true but getAdapter throws — it must be registered`,
      );
    } else {
      // available:false sdks (e.g. codex) need not be registered; the UI never
      // offers them. Nothing to assert beyond the flag itself.
      assert.equal(sdk.available, false);
    }
  }
});

// ---------------------------------------------------------------------------
// (b) every studio SKILL.md runtime.sdk is a registered adapter id
// ---------------------------------------------------------------------------

test('every studio SKILL.md runtime.sdk is in registeredSdkIds()', () => {
  const skillsDir = join(ROOT, 'skills');
  const registered = new Set(registeredSdkIds());

  const entries = readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  let checked = 0;
  for (const name of entries) {
    const skillMdPath = join(skillsDir, name, 'SKILL.md');
    // Skip the non-studio skills (no runtime block); only studio agents carry a sdk.
    if (!isStudioAgent(skillMdPath)) continue;
    const def = loadAgentDefinition(skillMdPath);
    assert.ok(
      registered.has(def.runtime.sdk),
      `studio agent "${name}" declares runtime.sdk "${def.runtime.sdk}" which is not registered (ids: ${[...registered].join(', ')})`,
    );
    checked += 1;
  }

  assert.ok(checked > 0, 'expected at least one studio agent with a runtime.sdk to check');
});

// ---------------------------------------------------------------------------
// (c) the bridge default (no runtime.sdk, no existing agent) resolves clean
// ---------------------------------------------------------------------------

test('bridge default for a body with no runtime.sdk resolves to a registered id', () => {
  // Mirror cli/bridge-studio-writes.ts: a body with no runtime.sdk and no
  // existing agent falls back to the literal default. That default must resolve.
  const bridgeDefault = 'claude';
  const resolved = resolveSdkId(bridgeDefault);
  assert.ok(
    registeredSdkIds().includes(resolved),
    `bridge default "${bridgeDefault}" resolved to "${resolved}" which is not registered`,
  );
  // And it must reach a real adapter without throwing.
  assert.doesNotThrow(() => getAdapter(resolved));
});

// ---------------------------------------------------------------------------
// (d) resolveSdkId unit behaviour
// ---------------------------------------------------------------------------

test('resolveSdkId(undefined) === "claude"', () => {
  assert.equal(resolveSdkId(undefined), 'claude');
});

test('resolveSdkId("") === "claude"', () => {
  assert.equal(resolveSdkId(''), 'claude');
});

test('resolveSdkId("claude") === "claude"', () => {
  assert.equal(resolveSdkId('claude'), 'claude');
});

test('resolveSdkId("gemini", spy) falls back to "claude" and fires the log callback', () => {
  // gemini is registered but available:false in CI — the unavailable-fallback path.
  assert.equal(isSdkAvailable('gemini'), false, 'precondition: gemini is unavailable in CI');

  const events: Array<{ type: string; sdk?: string }> = [];
  const spy = (event: { type: string; sdk?: string }) => events.push(event);

  const resolved = resolveSdkId('gemini', spy);
  assert.equal(resolved, 'claude');
  assert.equal(events.length, 1, 'log callback must fire exactly once on fallback');
  assert.equal(events[0].type, 'sdk.unavailable-fallback');
  assert.equal(events[0].sdk, 'gemini');
});

test('resolveSdkId of a registered, available id does NOT fire the log callback', () => {
  const events: Array<{ type: string; sdk?: string }> = [];
  const spy = (event: { type: string; sdk?: string }) => events.push(event);

  const resolved = resolveSdkId('claude', spy);
  assert.equal(resolved, 'claude');
  assert.equal(events.length, 0, 'available id must not log a fallback');
});
