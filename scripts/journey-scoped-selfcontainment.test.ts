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
 *    beat now asserts the KB strip, and fires it on a condition the beat
 *    OWNS: a seeded lint-flagged scratch KB (writeSuLintKbFixture — the
 *    HOME.2 fixture shape), never the repo's transient standing lint debt,
 *    which the operator can drain to green at any time (KB lint is derived
 *    live per request — packages/knowledge/kb-lint-summary.ts, derive-don't-store).
 *    home.mjs HOME.2 keeps the deep two-strip coverage (it seeds a gated
 *    project AND a lint-flagged KB); a keeper pin below guards that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { seedThroughlineSkillFixture, SK_NEW_SLUG, SK_NEW_NAME, SK_NEW_DESC } from './lib/journey-fixtures.mjs';
import { listPlainSkills } from '@forge/library/studio/skill-registry.ts';

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
    assert.equal(found!.desc, SK_NEW_DESC, 'the chip tooltip is the shared SK_NEW_DESC constant — the SAME description SK-3 types into the real /skills/new form (skills.mjs), so the two paths can never drift');
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

test('agents.mjs seeds its own throughline skill BEFORE the catalog-chip lookup — self-contained under any --journey scope', () => {
  // Ordering pin, not a bare .includes(): a prose mention in a comment (or a
  // call moved BELOW the chip lookup) must not keep this green — the
  // invariant is "the seed runs first, so the chip exists when looked up"
  // (gateB2 line 513). The chip-lookup marker is A-scratch's own palette
  // query — the [data-component="catalog-palette"]-prefixed selector appears
  // exactly once in agents.mjs (dragSkillChipIntoZone and the clip context
  // use the bare .catalog-chip form).
  const seedIdx = agentsSrc.indexOf('seedThroughlineSkillFixture(');
  const chipIdx = agentsSrc.indexOf('[data-component="catalog-palette"] .catalog-chip[data-id=');
  assert.notEqual(seedIdx, -1,
    'agents-scratch-build must call seedThroughlineSkillFixture() — a scoped run without the skills journey has no SK-3 to author it (gateB2 line 513)');
  assert.notEqual(chipIdx, -1,
    'the A-scratch catalog-chip lookup marker must exist ([data-component="catalog-palette"] .catalog-chip[data-id=…) — if the lookup moved, update this pin to its new marker');
  assert.ok(seedIdx < chipIdx,
    'seedThroughlineSkillFixture() must run BEFORE the catalog-chip lookup — seeding after the lookup re-opens the gateB2 scoped-run timeout');
});

test('stand-up-create A1.3 seeds its own lint-flagged KB and asserts kbs-needing-attention (W7-B1 as-built)', () => {
  // Scope every pin to the A1.3 region: the file-wide form blocked any FUTURE
  // stand-up-create beat that legitimately seeds a gated project and asserts
  // the gate strip (the exact HOME.2 pattern this file endorses below).
  const a13Start = standUpCreateSrc.indexOf('[A1.3]');
  const a13End = standUpCreateSrc.indexOf("id: 'su-create-orientation'");
  assert.notEqual(a13Start, -1, 'the A1.3 block marker ("[A1.3]") must exist in stand-up-create.mjs');
  assert.notEqual(a13End, -1, "the region end marker (id: 'su-create-orientation', the next beat) must exist — if the beat order changed, update this pin");
  assert.ok(a13Start < a13End, 'the A1.3 block must precede the su-create-orientation beat');
  const a13Region = standUpCreateSrc.slice(a13Start, a13End);

  const seedIdx = a13Region.indexOf('writeSuLintKbFixture(');
  const stripIdx = a13Region.indexOf('kbs-needing-attention');
  assert.notEqual(stripIdx, -1,
    'A1.3 must assert [data-section="kbs-needing-attention"] — its [data-attention-item] rows are KB lint rows (gateB2 line 200-201)');
  assert.notEqual(seedIdx, -1,
    'A1.3 must seed its OWN lint-flagged scratch KB (writeSuLintKbFixture) — KB lint is derived live per request, so riding the repo\'s standing lint debt goes red the day the operator drains it to green');
  assert.ok(seedIdx < stripIdx,
    'the seed must run BEFORE the strip assertion — seeding after it asserts the environmental condition, not the self-owned one');
  assert.ok(
    !a13Region.includes('data-section="attention-strip"'),
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
