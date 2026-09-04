/**
 * MIGRATION ACCEPTANCE TEST — E1 of the ADR-027-amendment-#2
 * `composition.hooks` → `composition.guards` rename: the agent save/round-trip
 * path in `apps/forge/bridge-studio-writes.ts` (~L379, now maps `guards`) must
 * preserve `composition.guards` through a PUT /api/studio/agents/:slug
 * write → re-load-from-disk cycle.
 *
 * Mirrors `apps/forge/bridge-studio-write.test.ts`'s existing harness conventions
 * exactly (`startBridge`, `putJson`, a temp forgeRoot fixture with a real
 * `skills/<slug>/SKILL.md`) rather than inventing a new one — this is a
 * SEPARATE new file (not an edit to that existing, currently-green suite)
 * so this file's assertions never contaminate that one.
 *
 * FIXTURE CORRECTION (2026-08-04, post-migration): the original draft of
 * this file seeded the on-disk SKILL.md with the OLD vocabulary
 * (`composition.hooks: [event-log]`) and asserted the PUT returned 200. That
 * was written before A3 was redirected (peer review) to make
 * `loadAgentDefinition` THROW on a stale `hooks:` key rather than silently
 * ignore it — so the old fixture modeled a state A2 now makes IMPOSSIBLE:
 * after this migration, no real on-disk SKILL.md carries the old key, and
 * `bridge-studio-writes.ts`'s PUT handler loads the EXISTING file to merge
 * fields before writing (`existing = loadAgentDefinition(skillMdPath)`), so a
 * legacy-hooks seed now makes every PUT against that slug 500, not 200 — the
 * old fixture was asserting behaviour that can no longer occur, against
 * production code that now correctly refuses to reach it. Confirmed
 * empirically: after the migration landed, the original E1 failed with
 * `500: composition.hooks is retired...`, not the expected mismatch — a
 * stale-fixture failure, not a feature-gap failure.
 *
 * Fixed: the seed SKILL.md now carries `composition.guards` (the true
 * post-migration on-disk shape). E1a is the real subject — a round-trip PUT
 * with `composition.guards` in the body preserves it exactly.
 *
 * === E1b SUPERSEDED (2026-08-04, R3-03 landed) — retired by DESIGN, not a
 * rollback ===
 *
 * WHAT E1b PROTECTED: for the same transitional window as A3 (see
 * `apps/forge/studio-lint-guards-migration.test.ts`'s "A3 SUPERSEDED" paragraph —
 * same root cause, this file's own product surface), a legacy on-disk
 * `hooks:` key made `loadAgentDefinition` throw; the bridge PUT route wraps
 * that same load call in its own try/catch and turned it into an HTTP 500.
 * E1b pinned that the SAVE surface inherited the loud failure, not just the
 * read-only lint scan.
 *
 * WHY THE RULE ENDED: identical reason to A3 — `composition.hooks` is valid
 * data again, so `loadAgentDefinition` no longer throws, so the PUT no
 * longer 500s. Confirmed empirically after the migration landed: the same
 * legacy fixture now returns 200, not 500.
 *
 * WHICH RULE CARRIES THE GUARANTEE NOW — HONEST GAP, NOT A CLEAN STORY:
 * unlike A3, this is NOT a case of "a more precise rule took over". I
 * checked `apps/forge/bridge-studio-writes.ts`'s PUT handler directly (lines
 * ~370-445): its composition-merge block reads `skills`/`tools`/`mcps`/
 * `guards` from the request body but was NOT updated in this PR to read or
 * preserve a `hooks` field at all, and the `validateAgent(merged, ...)` call
 * it runs before writing does NOT include `lintHookComposition`'s
 * `hook-library/guard-in-hooks` check (that check only runs inside
 * `runStudioLint`, apps/forge/studio-lint.ts, a separate read-only entry point).
 * The observable, verified consequence: a PUT against ANY agent — legacy-
 * hooks-shaped or not — silently DROPS `composition.hooks` from the written
 * file, and returns 200 with no finding naming the loss. This is a REAL,
 * separate gap this retirement surfaced, not something E1b's original scope
 * covered (E1b only ever seeded a legacy fixture; it never asserted
 * anything about a WELL-FORMED hooks composition surviving a save) — flagged
 * to the operator/implementer in the T3 report rather than silently
 * "fixed" by a test-writer inventing bridge behaviour. E1b below is
 * rewritten to pin the REAL, current, verified behaviour (200 + silent
 * field loss) honestly, plus the guarantee that DOES still hold at the
 * correct surface: running the real `runStudioLint` entry point against the
 * same forgeRoot (bypassing the bridge to seed the true on-disk state, since
 * the bridge itself cannot currently produce a persisted `hooks:` key) still
 * catches a colliding legacy id as `hook-library/guard-in-hooks` — the same
 * replacement rule A3 now carries, proven here from this file's own surface
 * rather than re-asserted redundantly.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { runStudioLint } from './studio-lint.ts';
import { loadAgentDefinition } from '@forge/agents/studio/agent-registry.ts';

const SLUG = 'write-agent-guards';
const LEGACY_SLUG = 'write-agent-legacy-hooks';

function makeSeedSkillMd(name: string, compositionBlock: string[]): string {
  return [
    '---',
    `name: ${name}`,
    'description: An agent for the guards-migration bridge round-trip test.',
    'phase: developer',
    'surface: unattended',
    'purpose: Prove the bridge round-trips composition.guards.',
    'brainAccess: advisory',
    'interactivity: none',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    ...compositionBlock,
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'allowed-tools: []',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    `# ${name}`,
    '',
    'Process body text.',
  ].join('\n');
}

/** Post-migration on-disk shape — the true seed for E1a. */
function makeGuardsSeedSkillMd(): string {
  return makeSeedSkillMd('Write Agent Guards', ['  guards:', '    - event-log']);
}

/** The OLD, now-impossible on-disk shape — the true seed for E1b (proves the
 * bridge PUT path fails loud rather than silently accepting/rewriting it). */
function makeLegacyHooksSeedSkillMd(): string {
  return makeSeedSkillMd('Write Agent Legacy Hooks', ['  hooks:', '    - event-log']);
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-guards-migration-'));
  mkdirSync(join(forgeRoot, 'skills', SLUG), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', SLUG, 'SKILL.md'), makeGuardsSeedSkillMd());
  mkdirSync(join(forgeRoot, 'skills', LEGACY_SLUG), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', LEGACY_SLUG, 'SKILL.md'), makeLegacyHooksSeedSkillMd());
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
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

test('E1a: PUT /api/studio/agents/:slug with composition.guards round-trips through a save + re-load', async () => {
  const putBody = {
    name: 'Write Agent Guards',
    purpose: 'Prove the bridge round-trips composition.guards.',
    process: 'Updated process body.',
    interactivity: 'none',
    brainAccess: 'advisory',
    composition: {
      skills: [],
      tools: [],
      mcps: [],
      guards: ['event-log', 'cost-guard'],
    },
    runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
  };

  const res = await putJson(`${bridgeUrl}/api/studio/agents/${SLUG}`, putBody);
  const putResponseBody = await res.json().catch(() => null);
  assert.equal(res.status, 200, `expected the PUT to succeed (200) — got ${res.status}: ${JSON.stringify(putResponseBody)}`);

  const reloaded = loadAgentDefinition(join(forgeRoot, 'skills', SLUG, 'SKILL.md'));
  assert.deepEqual(
    reloaded.composition.guards,
    ['event-log', 'cost-guard'],
    `expected the re-loaded def's composition.guards to equal the PUT body's sent value — got: ${JSON.stringify(reloaded.composition.guards)}`,
  );
});

test('E1b (part 1) SUPERSEDED: PUT against a legacy-hooks on-disk SKILL.md now succeeds (200) and SILENTLY DROPS composition.hooks — a real, honestly-pinned gap, not a fix I invented', async () => {
  const putBody = {
    name: 'Write Agent Legacy Hooks',
    purpose: 'Prove the bridge PUT path fails loud on a legacy on-disk file.',
    process: 'Updated process body.',
    interactivity: 'none',
    brainAccess: 'advisory',
    composition: { skills: [], tools: [], mcps: [], guards: ['event-log'] },
    runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
  };

  const res = await putJson(`${bridgeUrl}/api/studio/agents/${LEGACY_SLUG}`, putBody);
  const body = (await res.json().catch(() => null)) as { ok?: boolean; findings?: unknown[] } | null;

  // The transitional 500 is GONE by design — composition.hooks is valid data
  // again (see the file header's "E1b SUPERSEDED" paragraph).
  assert.equal(
    res.status,
    200,
    `expected the PUT to now succeed (200) — composition.hooks is valid data again — got ${res.status}: ${JSON.stringify(body)}`,
  );

  // HONEST GAP (verified by reading apps/forge/bridge-studio-writes.ts directly,
  // not assumed): the PUT handler's composition-merge block was not updated
  // in this PR to read/preserve a `hooks` field, and its own validateAgent
  // call does not include lintHookComposition's guard-in-hooks check. The
  // written file therefore has NO composition.hooks key at all afterward —
  // pin that explicitly so a future fix (making the bridge round-trip
  // hooks like it already does guards) is a visible, deliberate change to
  // THIS assertion, not a silent regression discovered later.
  const reloaded = loadAgentDefinition(join(forgeRoot, 'skills', LEGACY_SLUG, 'SKILL.md'));
  const reloadedHooks = (reloaded.composition as unknown as { hooks?: string[] }).hooks;
  assert.deepEqual(
    reloadedHooks ?? [],
    [],
    'CURRENT REAL BEHAVIOUR: the bridge PUT path silently drops composition.hooks on every save (not wired into the merge, unlike guards) — ' +
      'this is a genuine product gap this retirement surfaced, flagged in the T3 report, not something a test-writer should silently paper over',
  );
});

test('E1b (part 2): the surviving guarantee — forge studio lint on the TRUE on-disk legacy state still catches hook-library/guard-in-hooks (same replacement rule as A3, proven from this file\'s own surface)', () => {
  // Self-contained fixture, independent of the shared bridge/forgeRoot above
  // (whose file part 1 will have already mutated) — seeds the true,
  // never-PUT-through on-disk legacy shape directly, since the bridge itself
  // cannot currently produce a persisted `hooks:` key (see part 1).
  const root = mkdtempSync(join(tmpdir(), 'bridge-guards-migration-lint-check-'));
  try {
    const skillDir = join(root, 'skills', LEGACY_SLUG);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), makeLegacyHooksSeedSkillMd());
    mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
    mkdirSync(join(root, 'projects', 'lint-check-project', '.forge'), { recursive: true });
    writeFileSync(
      join(root, 'projects', 'lint-check-project', '.forge', 'project.json'),
      JSON.stringify({ name: 'lint-check-project' }),
      'utf8',
    );

    const result = runStudioLint(root);
    const hit = result.findings.find(
      (f) => f.level === 'error' && f.object === `agent:${LEGACY_SLUG}` && f.check === 'hook-library/guard-in-hooks',
    );
    assert.ok(
      hit,
      `expected forge studio lint to catch the true on-disk legacy shape as hook-library/guard-in-hooks — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
