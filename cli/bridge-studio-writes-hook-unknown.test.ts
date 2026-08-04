/**
 * ACCEPTANCE TEST (must be RED until fixed) — JOB A of the 2026-08-04
 * second post-migration adversarial review: `lintHookComposition`'s
 * `hook-library/unknown-hook-ref` and `hook-library/guard-in-hooks` checks
 * are INERT on the bridge save path — the THIRD appearance of the same
 * defect class in this one initiative (see `cli/bridge-studio-writes-
 * guard-unknown.test.ts`'s header for the first appearance,
 * `composition/guard-unknown`; `cli/studio-lint-guards-migration.test.ts`'s
 * C4 for the second).
 *
 * Root cause (verified by reading `cli/bridge-studio-writes.ts` directly,
 * not assumed): the PUT handler's step 6 calls
 * `validateAgent(merged, undefined, validGuardIds)` — that function's own
 * `compArrays` loop only regex-checks each `composition.hooks` entry's SLUG
 * SHAPE (`orchestrator/studio/validate.ts`'s `['composition/hooks',
 * def.composition.hooks ?? []]` row), never whether the id actually
 * RESOLVES to a real library hook or collides with a platform guard id.
 * `lintHookComposition` (`orchestrator/studio/hook-library.ts`) is the ONLY
 * function that knows that, and it is called exclusively from
 * `cli/studio-lint.ts`'s `runStudioLint` — a READ-ONLY entry point the write
 * route never invokes. Reproduced live by the implementer against a running
 * bridge before this file was written: `PUT .../:slug` with
 * `composition.hooks: ['totally-made-up-hook-id-xyz']` returns 200 and the
 * bogus id lands on disk verbatim.
 *
 * This is directly load-bearing, not a cosmetic gap: F4's Agent-Builder
 * binding UI writes through exactly this PUT route, so without this fix the
 * feature's own happy path can persist garbage a human operator believes is
 * a real, bound hook.
 *
 * CONTRACT (mirrors `bridge-studio-writes-guard-unknown.test.ts`'s A1/A2
 * exactly — reusing the route's EXISTING `400 {error:'validation failed',
 * findings}` contract, no new response shape invented):
 *   B1 — a composition.hooks id resolving to no hook ⇒ 400, not persisted.
 *   B2 — a GUARD id under composition.hooks ⇒ 400, not persisted (the
 *        symmetric direction, now enforced at save, not only at lint).
 *   B3 — a VALID hook id ⇒ still 200, persisted (the over-rejection guard —
 *        pinning only the reject side would let a "fix" lock operators out
 *        of binding hooks at all, which is worse than the bug).
 *
 * Both B1 and B2 are RED today: the route's `validateAgent(...)` call never
 * receives hook-registry ground truth, so neither finding can ever fire
 * through this entry point, and both PUTs return 200 with the bogus/
 * misplaced id persisted verbatim. B3 is expected to ALREADY pass (a slug-
 * shaped hooks entry that isn't a guard id and isn't checked against the
 * registry today saves fine) — kept in this file anyway so the fix's
 * over-rejection direction is pinned in the SAME place as the two reject
 * cases, per instruction.
 *
 * Fixture: mirrors bridge-studio-writes-guard-unknown.test.ts's harness
 * (`startBridge`, a real `studio/catalog.yaml` with the 9 real guard ids).
 * ADDITIONALLY seeds a real `studio/hooks/<id>/hook.yaml` package on disk
 * (B3's ground truth) — the guard-unknown fixture never needed one since it
 * doesn't exercise hook resolution at all.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { startBridge } from './ui-bridge.ts';

const UNKNOWN_HOOK_SLUG = 'hook-unknown-fixture';
const GUARD_IN_HOOKS_SLUG = 'hook-guard-in-hooks-fixture';
const VALID_HOOK_SLUG = 'hook-valid-fixture';

const REAL_HOOK_ID = 'real-lib-hook';

/** Real future-vocabulary catalog.yaml — the 9 known guard ids, matching the
 * real shipped `studio/catalog.yaml` (`guards:` section). Identical content
 * to bridge-studio-writes-guard-unknown.test.ts's own fixture — not
 * imported from it (that file is a sibling acceptance test, not a shared
 * fixture module; each ACs file stays self-contained by this repo's
 * convention, see cli/studio-lint-guards-migration.test.ts vs
 * cli/studio-lint-hooks.test.ts both hand-declaring the same catalog shape). */
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

/** A real studio/hooks/<id>/hook.yaml + script package — B3's ground truth
 * for "a valid hook id still saves". */
function writeRealHookPackage(root: string, id: string): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/usr/bin/env bash\necho ok\n', 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({
      id,
      name: id,
      description: 'A real library hook fixture for the PUT-route acceptance test.',
      on: 'PreToolUse',
      script: 'scripts/run.sh',
      permissions: { env: [], read: [], network: false },
    }),
    'utf8',
  );
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-hook-unknown-'));
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), validGuardsCatalogYaml());
  writeRealHookPackage(forgeRoot, REAL_HOOK_ID);
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
    name: 'Hook Unknown Fixture',
    purpose: 'Prove the bridge rejects an unresolvable/misplaced composition.hooks id.',
    process: 'Process body.',
    interactivity: 'none',
    brainAccess: 'advisory',
    composition: { skills: [], tools: [], mcps: [], guards: [], hooks: [] },
    runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
    ...overrides,
  };
}

test('B1: PUT with a composition.hooks id resolving to NO hook is REJECTED (400), never persisted', async () => {
  const skillMdPath = join(forgeRoot, 'skills', UNKNOWN_HOOK_SLUG, 'SKILL.md');
  assert.ok(!existsSync(skillMdPath), 'sanity: the agent must not already exist on disk before this PUT');

  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/${UNKNOWN_HOOK_SLUG}`,
    makePutAgentBody({ composition: { skills: [], tools: [], mcps: [], guards: [], hooks: ['totally-made-up-hook-id-xyz'] } }),
  );
  const body = (await res.json().catch(() => null)) as { error?: string; findings?: Array<{ check: string; level: string }> } | null;

  assert.equal(
    res.status,
    400,
    `expected the PUT to be rejected (400) for an unresolvable composition.hooks id — got ${res.status}: ${JSON.stringify(body)}`,
  );
  assert.equal(body?.error, 'validation failed');
  const unknownHookRef = body?.findings?.find((f) => f.check === 'hook-library/unknown-hook-ref');
  assert.ok(
    unknownHookRef,
    `expected a hook-library/unknown-hook-ref finding in the 400 response — got: ${JSON.stringify(body?.findings)}`,
  );
  assert.equal(unknownHookRef!.level, 'error');

  assert.ok(!existsSync(skillMdPath), 'the rejected PUT must never create/persist the SKILL.md on disk');
});

test('B2: PUT with a GUARD id under composition.hooks is REJECTED (400), never persisted (the symmetric direction, now enforced at save)', async () => {
  const skillMdPath = join(forgeRoot, 'skills', GUARD_IN_HOOKS_SLUG, 'SKILL.md');
  assert.ok(!existsSync(skillMdPath), 'sanity: the agent must not already exist on disk before this PUT');

  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/${GUARD_IN_HOOKS_SLUG}`,
    makePutAgentBody({ composition: { skills: [], tools: [], mcps: [], guards: [], hooks: ['event-log'] } }),
  );
  const body = (await res.json().catch(() => null)) as { error?: string; findings?: Array<{ check: string; level: string }> } | null;

  assert.equal(
    res.status,
    400,
    `expected the PUT to be rejected (400) for a platform guard id placed under composition.hooks — got ${res.status}: ${JSON.stringify(body)}`,
  );
  assert.equal(body?.error, 'validation failed');
  const guardInHooks = body?.findings?.find((f) => f.check === 'hook-library/guard-in-hooks');
  assert.ok(
    guardInHooks,
    `expected a hook-library/guard-in-hooks finding in the 400 response — got: ${JSON.stringify(body?.findings)}`,
  );
  assert.equal(guardInHooks!.level, 'error');

  assert.ok(!existsSync(skillMdPath), 'the rejected PUT must never create/persist the SKILL.md on disk');
});

test('B3: PUT with a VALID composition.hooks id still succeeds (200) — the fix must not lock operators out of binding real hooks', async () => {
  const skillMdPath = join(forgeRoot, 'skills', VALID_HOOK_SLUG, 'SKILL.md');

  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/${VALID_HOOK_SLUG}`,
    makePutAgentBody({ composition: { skills: [], tools: [], mcps: [], guards: [], hooks: [REAL_HOOK_ID] } }),
  );
  const body = (await res.json().catch(() => null)) as { ok?: boolean; findings?: unknown[] } | null;

  assert.equal(
    res.status,
    200,
    `expected the PUT to succeed (200) for a real composition.hooks id — got ${res.status}: ${JSON.stringify(body)}`,
  );
  assert.equal(body?.ok, true);
  assert.ok(existsSync(skillMdPath), 'a valid PUT must persist the SKILL.md to disk');
});
