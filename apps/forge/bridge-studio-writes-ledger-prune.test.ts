/**
 * W8-B4 FIX-2 (library-35's fourth path) — live-bridge reproduction pins for
 * the agent-DELETE route's install-ledger prune, mirroring
 * cli/bridge-studio-skills.test.ts's own "library-35" tests (the skills
 * DELETE route) at the sibling agents DELETE route.
 *
 * Root cause: cli/bridge-studio-writes.ts's agent-DELETE route
 * (`DELETE /api/studio/agents/:slug`) can destroy a `skills/<id>` package —
 * `isStudioAgent()` only requires a `runtime:` block and no `provenance`/
 * `quarantined` key, which any skill that was installed then hand-converted
 * (provenance stripped, runtime added) satisfies — but never pruned that
 * id's row from `studio/installed-skills.yaml`. A stranger row surviving the
 * delete means a LATER, unrelated skill created at the same id inherits a
 * mismatched `contentHash` and is wrongly flagged `needs-review` /
 * `provenance-tampered` (library-35's exact bug, reached through a fourth
 * path). See orchestrator/studio/destroy-prunes-ledger.test.ts for the
 * static enumeration pin that now classifies this route.
 *
 * Pin 2 (below) asserts the ARTIFACTS — the ledger file's content and the
 * recreated skill's re-derived trust — never a bare status code, per the
 * task brief's explicit instruction ("a verifier brief that does not demand
 * a runnable repro produces agreement, not verification").
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-writes-ledger-prune-'));

  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

async function del(url: string): Promise<Response> {
  return fetch(url, { method: 'DELETE', headers: { 'x-forge-csrf': '1' } });
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function makeEntries(frontmatter: Record<string, unknown>): Array<{ path: string; contentBase64: string }> {
  return [{ path: 'SKILL.md', contentBase64: b64(matter.stringify('\n# Installed\n\nBody.\n', frontmatter)) }];
}

function installLedgerDoc(): { installed?: Array<{ id: string; contentHash?: string }> } {
  const path = join(forgeRoot, 'studio', 'installed-skills.yaml');
  if (!existsSync(path)) return {};
  return yaml.load(readFileSync(path, 'utf8')) as { installed?: Array<{ id: string; contentHash?: string }> };
}

/**
 * The reviewer's exact operator-level hand-edit: strip `provenance`
 * (isStudioAgent's D4 rule — a `provenance`/`quarantined` key permanently
 * disqualifies a package from ever being treated as a studio agent) and add
 * a `runtime:` block (the OTHER half of isStudioAgent's test), while also
 * dropping `library: false` (installSkillPackage's quarantine sets this,
 * and isStudioAgent excludes `library: false` explicitly) — a full
 * frontmatter rewrite, exactly what an operator converting a library skill
 * into a studio agent by hand would produce. No HTTP route performs this
 * conversion (a PUT-based one is blocked — loadAgentDefinition throws before
 * ever reaching a write) — this is a direct file edit, the honest scope the
 * task brief names.
 */
function convertInstalledSkillToAgentByHand(id: string): void {
  const mdPath = join(forgeRoot, 'skills', id, 'SKILL.md');
  const { content } = matter(readFileSync(mdPath, 'utf8'), {});
  const converted = matter.stringify(content, {
    name: 'Hand-Converted Agent',
    description: 'operator hand-edit: provenance stripped, runtime block added',
    runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
  });
  writeFileSync(mdPath, converted, 'utf8');
}

// ---------------------------------------------------------------------------
// Pin 2 — the reviewer's live reproduction
// ---------------------------------------------------------------------------

test('pin 2 (library-35 x4): agent-DELETE of a hand-converted installed skill prunes the ledger row, and a later unrelated skill at the same id reads ready — not needs-review/provenance-tampered', async () => {
  const id = 'w8b4-fix2-live-repro';

  // 1. Install a REAL skill through the pipeline — a real ledger row.
  const install = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id,
    entries: makeEntries({ name: 'Live Repro Fixture', description: 'installed via the bridge route' }),
    upstream: { source: 'https://example.com/w8b4-fix2-live-repro' },
  });
  assert.equal(install.status, 200, `fixture setup: install must succeed — ${await install.text()}`);
  assert.ok(
    (installLedgerDoc().installed ?? []).some((e) => e.id === id),
    'fixture sanity: the install must write a ledger row',
  );

  // 2. Hand-edit: strip provenance, add a runtime block — isStudioAgent() flips true.
  convertInstalledSkillToAgentByHand(id);

  // 3. Destroy it through the AGENT-delete route (not the skills route).
  const res = await del(`${bridgeUrl}/api/studio/agents/${id}`);
  const resBody = await res.clone().text();
  assert.equal(res.status, 200, `agent-DELETE of the hand-converted package must succeed — got ${res.status}: ${resBody}`);
  assert.equal(existsSync(join(forgeRoot, 'skills', id)), false, 'the package directory must be gone');

  // 4. Assert the LEDGER ARTIFACT itself — not a status code. This is the
  //    load-bearing assertion: RED before the fix (the row survives), GREEN
  //    after (removeInstallLedgerEntry pruned it before the rmSync).
  const ledgerAfterDelete = installLedgerDoc();
  assert.ok(
    !(ledgerAfterDelete.installed ?? []).some((e) => e.id === id),
    `studio/installed-skills.yaml must carry NO row for "${id}" after the agent-DELETE route destroyed its package — ` +
      `found: ${JSON.stringify(ledgerAfterDelete.installed ?? [])}`,
  );

  // 5. A brand-new, unrelated, hand-authored skill reuses the SAME id.
  const recreate = await postJson(`${bridgeUrl}/api/studio/skills`, {
    id,
    name: 'Unrelated Replacement',
    description: 'a completely unrelated, hand-authored skill reusing the id',
    body: '# Unrelated\n\nNothing to do with the deleted package.',
  });
  assert.equal(recreate.status, 200, `recreating the id by hand must succeed — ${await recreate.text()}`);

  // 6. Assert the resulting TRUST artifact, re-derived from skillTrustDetail
  //    via a fresh GET — never trusted from the 200 alone.
  const recreatedDetail = (await (await fetch(`${bridgeUrl}/api/studio/skills/${id}`)).json()) as Record<string, unknown>;
  assert.equal(
    recreatedDetail['trust'],
    'ready',
    `a fresh, unrelated skill reusing a deleted id must read ready, not needs-review/provenance-tampered — got: ${JSON.stringify(recreatedDetail)}`,
  );
  assert.equal(recreatedDetail['paletteVisible'], true);
});

// ---------------------------------------------------------------------------
// Pin 3 — control: no ledger row ever existed
// ---------------------------------------------------------------------------

test('pin 3 (control): agent-DELETE of a package that never had a ledger row still succeeds, never 500s, and leaves an UNRELATED existing row untouched', async () => {
  // An unrelated, real ledger row must survive the tolerant no-op prune —
  // proves removeInstallLedgerEntry's "nothing to prune" path doesn't
  // corrupt the ledger file for anyone else.
  const anchorId = 'w8b4-fix2-unrelated-anchor';
  const anchorInstall = await postJson(`${bridgeUrl}/api/studio/skills/install`, {
    id: anchorId,
    entries: makeEntries({ name: 'Unrelated Anchor', description: 'must survive the sibling delete below' }),
    upstream: { source: 'https://example.com/w8b4-fix2-anchor' },
  });
  assert.equal(anchorInstall.status, 200);
  const anchorRow = (installLedgerDoc().installed ?? []).find((e) => e.id === anchorId);
  assert.ok(anchorRow, 'fixture sanity: the anchor install must write a ledger row');

  // A studio agent that was NEVER installed through the pipeline — hand-authored,
  // no provenance, never in the ledger.
  const id = 'w8b4-fix2-no-ledger-row';
  mkdirSync(join(forgeRoot, 'skills', id), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'skills', id, 'SKILL.md'),
    matter.stringify('\n# Hand Authored Agent\n\nBody.\n', {
      name: 'Hand Authored Agent',
      description: 'never installed through the pipeline',
      runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
    }),
    'utf8',
  );
  assert.equal(
    (installLedgerDoc().installed ?? []).some((e) => e.id === id),
    false,
    'fixture sanity: this id must have no ledger row before the delete',
  );

  const res = await del(`${bridgeUrl}/api/studio/agents/${id}`);
  assert.equal(res.status, 200, `deleting a never-installed agent must succeed, never 500 — got ${res.status}: ${await res.text()}`);
  assert.equal(existsSync(join(forgeRoot, 'skills', id)), false);

  const ledgerAfter = installLedgerDoc();
  assert.equal(
    (ledgerAfter.installed ?? []).some((e) => e.id === id),
    false,
    'no row must have been fabricated for an id that was never installed',
  );
  const anchorAfter = (ledgerAfter.installed ?? []).find((e) => e.id === anchorId);
  assert.ok(anchorAfter, 'the UNRELATED anchor row must survive the sibling delete');
  assert.equal(anchorAfter!.contentHash, anchorRow!.contentHash, "the anchor row's contentHash must be byte-identical, untouched");
});
