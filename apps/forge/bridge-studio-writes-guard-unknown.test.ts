/**
 * ACCEPTANCE TEST (must be RED until fixed) — Job A of the 2026-08-04
 * post-migration adversarial review: `composition/guard-unknown` is INERT
 * on the bridge save path.
 *
 * Root cause: `apps/forge/bridge-studio-writes.ts` (~L422) calls
 * `validateAgent(merged)` with NO second (`validModelIds`) or third
 * (`validGuardIds`) argument, so the `if (validGuardIds) {...}` branch
 * inside `composition/guard-unknown` (`orchestrator/studio/validate.ts`)
 * never executes on `PUT /api/studio/agents/:slug`. A typo'd or unknown
 * guard id — via the builder UI or a raw API call — is accepted with 200
 * and persisted to disk, silently inert until someone happens to run
 * `forge studio lint`. This directly contradicts ADR-027 §6: "The same
 * validation runs at save (bridge PUT) and at spawn." Only
 * `apps/forge/studio-lint.ts` currently computes and supplies the set (mirrors the
 * pre-existing `composition/guard-unknown` real-lint-entry-point pin in
 * `apps/forge/studio-lint-guards-migration.test.ts`, which drives the SAME check
 * through a DIFFERENT real entry point — the read-only lint scan, not the
 * operator's save request).
 *
 * DECISION 1 (asked for) — what the correct rejection is: the route ALREADY
 * has an established error-finding contract, unrelated to this check.
 * `bridge-studio-writes.ts`'s PUT handler runs `validateAgent(merged)` and,
 * when `findings.some(f => f.level === 'error')`, returns
 * `400 {error: 'validation failed', findings}` WITHOUT writing the file —
 * `apps/forge/bridge-studio-write.test.ts`'s "empty purpose → 400 + findings,
 * SKILL.md unchanged" test already pins exactly this contract for
 * `readiness/purpose`. `composition/guard-unknown` is an ERROR-level finding
 * (`err(...)`, not `flag(...)` — `orchestrator/studio/validate.ts`), so
 * wiring `validGuardIds` into the SAME `validateAgent()` call makes this
 * exact 400 path fire automatically — no new response shape is needed, and
 * the route does NOT currently ignore validation errors wholesale (it
 * enforces plenty of others); this one specific check just never receives
 * the data it needs to fire. A1 below pins the 400 + not-persisted contract.
 *
 * DECISION 2 (asked for) — yes: the valid-guard-id direction needs pinning
 * too (A2), for the identical over-firing risk the direct-call C4b case
 * guards against at the lint level
 * (`orchestrator/studio/guards-migration-validate-rules.test.ts`) — an
 * operator saving a legitimate agent using only real catalog guard ids must
 * still get 200, so the fix cannot lock operators out of legitimate saves.
 * Both directions live in this one file so a future reader sees the full
 * contract (reject the bad, accept the good) in one place.
 *
 * Fixture: mirrors `apps/forge/bridge-studio-write.test.ts`'s harness exactly
 * (`startBridge`, a real `skills/<slug>/SKILL.md`, minimal `_queue`/`_logs`
 * dirs). ADDITIONALLY writes a real `studio/catalog.yaml` with a `guards:`
 * section (future vocabulary, the 9 real ids) — the existing E1
 * (`apps/forge/bridge-studio-writes-guards-migration.test.ts`) never needed a
 * catalog fixture since it doesn't exercise this check; this one does, so
 * the eventual fix's `validGuardIds` set has real ground truth to validate
 * a typo against.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

const NEW_SLUG = 'guard-unknown-fixture';
const VALID_SLUG = 'guard-valid-fixture';

/** Real future-vocabulary catalog.yaml — the 9 known guard ids, matching
 * the real shipped `studio/catalog.yaml` (`guards:` section). */
function validGuardsCatalogYaml(): string {
  return `sdks:
  - { id: claude-code, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-5, name: Sonnet 4.5, sdk: claude-code, tier: standard }
tools: []
mcps: []
guards:
  - { id: event-log, name: JSONL event log }
  - { id: cost-guard, name: Cost guard }
  - { id: stall-watchdog, name: Stall watchdog }
  - { id: merge-gate, name: Merge gate }
  - { id: scratch-strip, name: Scratch strip }
  - { id: wi-contract, name: WI contract band }
  - { id: reflection-close, name: Reflection close band }
  - { id: demo-band, name: Demo band }
  - { id: review-band, name: Review band }
`;
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-guard-unknown-'));
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), validGuardsCatalogYaml());
  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function putJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

function makePutAgentBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Guard Unknown Fixture',
    purpose: 'Prove the bridge rejects an unknown composition.guards id.',
    process: 'Process body.',
    interactivity: 'none',
    brainAccess: 'advisory',
    composition: { skills: [], tools: [], mcps: [], guards: ['event-log'] },
    runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
    ...overrides,
  };
}

test('A1: PUT with a composition.guards id NOT in catalog.guards is REJECTED (400), never persisted', async () => {
  const skillMdPath = join(forgeRoot, 'skills', NEW_SLUG, 'SKILL.md');
  assert.ok(!existsSync(skillMdPath), 'sanity: the agent must not already exist on disk before this PUT');

  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/${NEW_SLUG}`,
    makePutAgentBody({ composition: { skills: [], tools: [], mcps: [], guards: ['event-log', 'not-a-real-guard'] } }),
  );
  const body = (await res.json().catch(() => null)) as { error?: string; findings?: Array<{ check: string; level: string }> } | null;

  assert.equal(
    res.status,
    400,
    `expected the PUT to be rejected (400) for an unknown composition.guards id — got ${res.status}: ${JSON.stringify(body)}`,
  );
  assert.equal(body?.error, 'validation failed');
  const guardUnknown = body?.findings?.find((f) => f.check === 'composition/guard-unknown');
  assert.ok(
    guardUnknown,
    `expected a composition/guard-unknown finding in the 400 response — got: ${JSON.stringify(body?.findings)}`,
  );
  assert.equal(guardUnknown!.level, 'error');

  assert.ok(!existsSync(skillMdPath), 'the rejected PUT must never create/persist the SKILL.md on disk');
});

test('A2: PUT with only real catalog.guards ids still succeeds (200) — the fix must not over-reject', async () => {
  const skillMdPath = join(forgeRoot, 'skills', VALID_SLUG, 'SKILL.md');

  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/${VALID_SLUG}`,
    makePutAgentBody({ composition: { skills: [], tools: [], mcps: [], guards: ['event-log', 'cost-guard'] } }),
  );
  const body = (await res.json().catch(() => null)) as { ok?: boolean; findings?: unknown[] } | null;

  assert.equal(
    res.status,
    200,
    `expected the PUT to succeed (200) for real catalog.guards ids — got ${res.status}: ${JSON.stringify(body)}`,
  );
  assert.equal(body?.ok, true);
  assert.ok(existsSync(skillMdPath), 'a valid PUT must persist the SKILL.md to disk');
});
