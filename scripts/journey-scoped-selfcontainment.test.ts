/**
 * journey-scoped-selfcontainment.test.ts — W7-FIX-B-UI pins.
 *
 * Two gate-B regressions, both journey-side (the UI contracts are as-built
 * correct — evidence in _wave7/gateB-journey.log vs gateB2-journey.log):
 *
 * 1. agents/agents-scratch-build depended on a CROSS-JOURNEY artifact: the
 *    `api-contract-review` (SK_NEW_SLUG) plain skill that skills/skills-create
 *    (SK-3) authors. In the FULL walkthrough the chip check passed (gateB
 *    line 1012 ✓); in ANY scoped run without the skills journey the chip is
 *    legitimately absent and dragSkillChipIntoZone times out, aborting the
 *    whole run (gateB2 line 513 ✗). Journeys must be self-contained
 *    (scripts/journeys/index.mjs ordering contract): the beat now seeds the
 *    throughline skill itself when SK-3 has not authored it, via
 *    seedThroughlineSkillFixture() — pinned here against the REAL
 *    listPlainSkills scanner (orchestrator/studio/registry.ts), the same
 *    discovery the bridge's GET /api/studio/catalog union performs, so the
 *    seeded fixture provably rides the R3-01-F2 live-filesystem-discovery
 *    seam rather than a lookalike file the palette would skip.
 *
 * 2. stand-up-create's A1.3 block asserted `[data-section="attention-strip"]`
 *    unconditionally. As-built (W7-B1, home-sessions-01/02) Home has TWO
 *    NAMED strips: `attention-strip` (project gate rows — renders ONLY when
 *    a real gated/flagged condition fires) and `kbs-needing-attention`
 *    (KB lint rows). A1.3's environment has no gated project — its
 *    [data-attention-item] rows are all KB rows (gateB2 line 199-201:
 *    strip 0 ✗, items 4 ✓, link "/knowledge?id=cycles&tab=health") — so the
 *    beat must assert the strip its own environment actually fires.
 *    home.mjs HOME.2 keeps the deep two-strip coverage (it seeds a gated
 *    project AND a lint-flagged KB); a keeper pin below guards that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { seedThroughlineSkillFixture, SK_NEW_SLUG, SK_NEW_NAME } from './lib/journey-fixtures.mjs';
import { listPlainSkills } from '../orchestrator/studio/registry.ts';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'w7-bfix-ui-'));
}

// ── seedThroughlineSkillFixture: the seeded fixture IS palette-discoverable ──

test('seedThroughlineSkillFixture writes a plain skill the REAL listPlainSkills discovers (R3-01-F2 seam)', () => {
  const root = tmpRoot();
  try {
    const seeded = seedThroughlineSkillFixture(root);
    assert.equal(seeded, true, 'must report that it seeded (skill was absent)');
    const found = listPlainSkills(root).find((s) => s.id === SK_NEW_SLUG);
    assert.ok(found, `listPlainSkills must discover skills/${SK_NEW_SLUG}/SKILL.md — the same scanner GET /api/studio/catalog unions into the palette`);
    assert.equal(found!.name, SK_NEW_NAME, 'chip name must be the frontmatter name, matching what SK-3 authors');
    assert.ok(found!.desc && found!.desc.length > 0, 'the fixture carries a real description (the chip tooltip)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seedThroughlineSkillFixture writes the POST /api/studio/skills shape: no runtime block, library: true', () => {
  const root = tmpRoot();
  try {
    seedThroughlineSkillFixture(root);
    const md = readFileSync(join(root, 'skills', SK_NEW_SLUG, 'SKILL.md'), 'utf8');
    assert.match(md, /^---\n/, 'frontmatter-first, like the create route');
    assert.match(md, /\nlibrary: true\n/, 'stamped library: true — palette-visible and lint-explicit, exactly like cli/bridge-studio-skills.ts');
    assert.doesNotMatch(md, /\nruntime:/, 'a plain skill NEVER carries a runtime block (that would make it an agent, not a palette chip)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seedThroughlineSkillFixture is a strict no-op when SK-3 already authored the skill', () => {
  const root = tmpRoot();
  try {
    const dir = join(root, 'skills', SK_NEW_SLUG);
    mkdirSync(dir, { recursive: true });
    const authored = `---\nname: ${SK_NEW_NAME}\ndescription: authored by the skills journey\nlibrary: true\n---\n\nSK-3's own bytes.\n`;
    writeFileSync(join(dir, 'SKILL.md'), authored);
    const seeded = seedThroughlineSkillFixture(root);
    assert.equal(seeded, false, 'must report a no-op (full-walkthrough path: SK-3 owns the artifact)');
    assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), authored, 'SK-3\'s bytes must be untouched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── static source pins on the beats themselves ──────────────────────────────

const journeysDir = join(import.meta.dirname, 'journeys');
const agentsSrc = readFileSync(join(journeysDir, 'agents.mjs'), 'utf8');
const standUpCreateSrc = readFileSync(join(journeysDir, 'stand-up-create.mjs'), 'utf8');
const homeSrc = readFileSync(join(journeysDir, 'home.mjs'), 'utf8');

test('agents.mjs seeds its own throughline skill — self-contained under any --journey scope', () => {
  assert.ok(
    agentsSrc.includes('seedThroughlineSkillFixture('),
    'agents-scratch-build must call seedThroughlineSkillFixture() before the catalog-chip lookup — a scoped run without the skills journey has no SK-3 to author it (gateB2 line 513)',
  );
});

test('stand-up-create A1.3 asserts the strip its environment fires: kbs-needing-attention (W7-B1 as-built)', () => {
  assert.ok(
    standUpCreateSrc.includes('kbs-needing-attention'),
    'A1.3 must assert [data-section="kbs-needing-attention"] — its [data-attention-item] rows are KB lint rows (gateB2 line 200-201)',
  );
  assert.ok(
    !standUpCreateSrc.includes('data-section="attention-strip"'),
    'A1.3 must NOT require the gate strip — no project is gated in its environment, and W7-B1 strips render ONLY on a real condition (gateB2 line 199)',
  );
});

test('home.mjs HOME.2 keeps the deep two-strip coverage (keeper pin — do not overcorrect)', () => {
  assert.ok(
    homeSrc.includes('data-section="attention-strip"'),
    'HOME.2 seeds a real gated project and must keep asserting the gate strip',
  );
  assert.ok(
    homeSrc.includes('kbs-needing-attention'),
    'HOME.2 seeds a real lint-flagged KB and must keep asserting the KB strip',
  );
});
