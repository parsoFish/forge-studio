import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  FORGE_ROOT, PROJECT, ACT, WORK, caption, OOTB_SKILL_IDS, cleanSkillArtifacts,
  SK_EDIT_SLUG, SK_EDIT_PATH, stashRealSkill, restoreRealSkill,
  SK_NEW_SLUG, SK_NEW_NAME, SK_CLIP_SLUG, SK_CLIP_NAME, waitForFile,
  DEMO_DESIGN_SKILL_DIR, writeDemoDesignSkill,
  demoEvent, demoBurst, cleanDemoBuilderSession,
  SK_INSTALL_ID, SK_INSTALL_DIR, cleanSkillInstallArtifacts,
  AUTH_SKILL_ID, AUTH_SKILL_DIR, authoringDir, authoringSidFromUrl,
  seedAuthoringSkillDraft, cleanAuthoringSkillArtifacts,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// ── R3-01-F3/F4 helpers: real, disk-derived cross-checks ────────────────────
// These mirror orchestrator/studio/skill-library.ts's own derivations (read
// directly off disk, no TS import from this .mjs harness) so the beats below
// assert a genuine cross-check against reality, not a re-read of whatever the
// product's own response already claims.

/** Extract + parse a SKILL.md's YAML frontmatter block (the same shape
 *  gray-matter parses server-side); null if there is no frontmatter or it
 *  fails to parse. */
function parseSkillFrontmatter(raw) {
  const m = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!m) return null;
  try { return yaml.load(m[1]); } catch { return null; }
}

/** Mirror of deriveSkillUsage (orchestrator/studio/skill-library.ts): which
 *  STUDIO AGENTS (SKILL.md carrying a `runtime:` block) compose `skillId` in
 *  their `composition.skills`, sorted. The point of every beat that calls
 *  this is that `usedBy` is DERIVED from real agent specs, never a declared
 *  field — this recomputes that same fact independently off disk. */
function realSkillUsage(skillId) {
  const skillsRoot = join(FORGE_ROOT, 'skills');
  const slugs = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const mdPath = join(skillsRoot, entry.name, 'SKILL.md');
    if (!existsSync(mdPath)) continue;
    let raw;
    try { raw = readFileSync(mdPath, 'utf8'); } catch { continue; }
    const data = parseSkillFrontmatter(raw);
    if (!data || typeof data !== 'object' || !('runtime' in data)) continue; // studio agents only
    const skills = Array.isArray(data.composition?.skills) ? data.composition.skills : [];
    if (skills.includes(skillId)) slugs.push(entry.name);
  }
  return slugs.sort((a, b) => a.localeCompare(b));
}

/** Real file count under a skill's package directory — mirrors
 *  readSkillPackage's walk (files only, recursive). */
function countPackageFiles(dir) {
  let count = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) count += 1;
    }
  };
  walk(dir);
  return count;
}

// The one-line marker the edit beat appends to the REAL skill's instructions —
// distinctive enough to poll the file for, and honest about being restored.
const EDIT_MARKER = 'Walkthrough note: this line was appended live in the demo, then restored.';

/** Poll the real skill's SKILL.md until the appended marker lands (save confirmation). */
async function waitForEditMarker(ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (readFileSync(SK_EDIT_PATH, 'utf8').includes(EDIT_MARKER)) return true; } catch { /* */ }
    await sleep(120);
  }
  return false;
}

/** Parse the demo-builder session id out of the dedicated session screen's
 * own URL, `/sessions/demo/<sid>` (W6-B10 — the builder is that screen, not
 * an inline panel; matches on the `/demo/<sid>` path segment shared by both
 * `/sessions/demo/<sid>` and the legacy `/demo/<sid>` wire-redirect source,
 * so either form resolves). */
function demoSidFromUrl(url) {
  const m = /\/demo\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

const CLIP_SK_DESC = 'Flag contract-breaking API changes before merge.';
const CLIP_SK_BODY = '1. Diff the public surface.\n2. Flag removed/renamed exports.\n3. Require a migration note.';
const AGENTIC_BRIEF = 'Author the demo-design skill: capture the built CLI\'s TOC output and verify the read-back against the fixture.';

export const journey = defineJourney({
    id: 'skills',
    title: 'Compose a skill',
    story: 'As an operator, I browse the /skills library — local and community, with a used-by count DERIVED from real agent composition — open a real skill\'s file package, browse forge\'s OOTB skill library — highly rated skills sourced from existing community libraries, provenance and stars shown — then edit one of forge\'s real shipped skills in place, author a brand-new skill from scratch through the library\'s one entry point, install a community package through the full draft→approve→re-review trust arc, and have a forge agent author one for me by resolving a real contract gap.',
    beats: [
      {
        id: 'skills-library',
        title: 'The /skills library — local + community, derived used-by',
        narration: 'The library lists every plain composable skill in two sections — hand-authored (or already-installed) skills on disk, and community catalog entries not yet installed — with per-section counts that always equal the rendered card count, and a used-by count on every card that is DERIVED from real agent `composition.skills`, never a declared field.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── SK-0: the /skills library (local + community, derived used-by) ────────
              console.log('\n[SK-0] The /skills library');
              await page.goto(watch.uiUrl + '/skills', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="skill-library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              check(await page.locator('main[data-page="skill-library"]').count() > 0, 'SK-0: /skills renders [data-page="skill-library"]');
              await caption(page, 'The skill library — local + community, every used-by count derived straight from real agent composition.skills.');

              const counts = await page.evaluate(() => {
                const root = document.querySelector('[data-page="skill-library"]');
                return {
                  total: parseInt(root?.getAttribute('data-skill-count') ?? '-1', 10),
                  local: parseInt(root?.getAttribute('data-local-count') ?? '-1', 10),
                  community: parseInt(root?.getAttribute('data-community-count') ?? '-1', 10),
                  localCards: document.querySelectorAll('[data-skill-source="local"]').length,
                  communityCards: document.querySelectorAll('[data-skill-source="community"]').length,
                };
              });
              check(counts.local > 0, `SK-0: the Local section is populated (${counts.local})`);
              check(counts.community > 0, `SK-0: the Community section is populated (${counts.community})`);
              check(counts.total === counts.local + counts.community,
                `SK-0: data-skill-count is the sum of both sections (${counts.total} vs ${counts.local}+${counts.community})`);
              check(counts.local === counts.localCards,
                `SK-0: data-local-count matches the rendered local card count (${counts.local} vs ${counts.localCards})`);
              check(counts.community === counts.communityCards,
                `SK-0: data-community-count matches the rendered community card count (${counts.community} vs ${counts.communityCards})`);

              // Cross-check ONE card's used-by count against the real, disk-derived
              // truth (composition.skills read straight off every agent's SKILL.md) —
              // the whole point of this beat: used-by is derived, never declared.
              const derivedUsage = realSkillUsage('brain-query');
              check(derivedUsage.length > 0, `SK-0: brain-query has real composers on disk (${derivedUsage.join(', ')})`);
              const domUsedByCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-skill-id="brain-query"]')?.getAttribute('data-skill-used-by-count') ?? '-1', 10));
              check(domUsedByCount === derivedUsage.length,
                `SK-0: brain-query's data-skill-used-by-count matches derived usage (dom=${domUsedByCount}, real=${derivedUsage.length})`);

              await frame(page, 'sk-0a-library', 'Part 2 (skills) — the /skills library: local + community sections, derived used-by', { key: true });

        },
      },
      {
        id: 'skills-detail-package',
        title: 'A real skill\'s detail page — file package + used-by',
        narration: 'The detail page for a real shipped skill renders its file package (SKILL.md plus every supporting file, tabbed) with a file count that matches the real files on disk, and the SAME derived used-by list the library card showed — the detail route and the library card agree on one real fact, not two independent guesses.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── SK-0b: a real skill's package detail page ──────────────────────────────
              const targetId = 'brain-query';
              console.log(`\n[SK-0b] Open a real skill's package (/skills/${targetId})`);
              const realFileCount = countPackageFiles(join(FORGE_ROOT, 'skills', targetId));

              await page.goto(watch.uiUrl + `/skills/${targetId}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              check(await page.locator('main[data-page="skill-detail"]').count() > 0, `SK-0b: /skills/${targetId} renders [data-page="skill-detail"]`);
              check(await page.locator('[data-component="file-package"]').count() > 0, 'SK-0b: [data-component="file-package"] renders');

              const domFileCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-component="file-package"]')?.getAttribute('data-file-count') ?? '-1', 10));
              check(domFileCount === realFileCount,
                `SK-0b: data-file-count matches the real file count under skills/${targetId}/ (dom=${domFileCount}, real=${realFileCount})`);

              const firstTab = page.locator('[data-file-tab]').first();
              const tabPath = await firstTab.getAttribute('data-file-path');
              await caption(page, `${targetId}'s file package — SKILL.md${realFileCount > 1 ? ' plus its supporting files' : ''}, tabbed.`);
              await firstTab.click().catch(() => {});
              await page.waitForFunction(
                (p) => document.querySelector('[data-component="file-package"]')?.getAttribute('data-active-file') === p,
                tabPath, { timeout: 5000 }).catch(() => {});
              const activeAfterClick = await page.evaluate(() => document.querySelector('[data-component="file-package"]')?.getAttribute('data-active-file'));
              check(activeAfterClick === tabPath, `SK-0b: clicking [data-file-tab] sets data-active-file (got "${activeAfterClick}", want "${tabPath}")`);

              const derivedUsage = realSkillUsage(targetId);
              const usedByCountDom = await page.evaluate(() =>
                parseInt(document.querySelector('[data-section="used-by"]')?.getAttribute('data-used-by-count') ?? '-1', 10));
              check(usedByCountDom === derivedUsage.length,
                `SK-0b: [data-section="used-by"] data-used-by-count matches derived usage (dom=${usedByCountDom}, real=${derivedUsage.length})`);
              const usedByAgentsDom = (await page.evaluate(() =>
                [...document.querySelectorAll('[data-used-by-agent]')].map((el) => el.getAttribute('data-used-by-agent')))).sort();
              check(JSON.stringify(usedByAgentsDom) === JSON.stringify(derivedUsage),
                `SK-0b: the exact used-by agent set matches derivation (dom=[${usedByAgentsDom.join(', ')}], real=[${derivedUsage.join(', ')}])`);

              await frame(page, 'sk-0b-detail', `Part 2 (skills) — /skills/${targetId}: file package tabs + derived used-by`, { key: true });

        },
      },
      {
        id: 'skills-ootb-library',
        title: 'OOTB skill library (community-sourced)',
        narration: 'The catalog ships a library of community-sourced skills (superpowers, TDD, security-review, and more), each one carrying its source URL, provenance, and star count in the agent builder\'s palette — the operator can see exactly where a skill came from before dragging it in.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ════════════════════════════════════════════════════════════════════════
              // PART 2 (skills pillar) — the OOTB skill library (sourced from curated
              // community repos), editing a REAL shipped skill, authoring a new one from
              // scratch, and agent-authored skills (the demo-design contract clause).
              // ════════════════════════════════════════════════════════════════════════

              // ── SK-1: the OOTB skill library (community-sourced) ──────────────────────
              // W6-CR-1: community skills moved from studio/catalog.yaml's
              // `community-skills:` section to studio/community/registry.yaml —
              // read that file directly (mirrors community.mjs's own
              // loadRegistryDoc), never the now community-skills-less catalog.
              console.log('\n[SK-1] OOTB skill library (community-sourced)');
              let community = [];
              try {
                const registryDoc = yaml.load(readFileSync(join(FORGE_ROOT, 'studio', 'community', 'registry.yaml'), 'utf8'));
                community = (registryDoc?.items ?? []).filter((i) => i.kind === 'skill');
              } catch { /* */ }
              check(community.length >= 5, `SK-1: registry.yaml ships an OOTB skill library (${community.length} community skills)`);
              const handoffSkill = community.find((s) => s.id === 'handoff');
              check(/github\.com|firecrawl|http/.test(handoffSkill?.sourceUrl ?? ''), `SK-1: an OOTB skill cites an online source (${handoffSkill?.sourceUrl ?? 'none'})`);
              check(!!handoffSkill?.provenance && !!handoffSkill?.signals?.starsDisplay, `SK-1: OOTB skill carries provenance + stars (${handoffSkill?.provenance ?? '?'}, ${handoffSkill?.signals?.starsDisplay ?? '?'})`);
              await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
              await caption(page, 'Every OOTB skill is a curated community skill (superpowers, TDD, security-review) — drag it into an agent.');
              check(await page.locator('[data-component="catalog-palette"]').count() > 0, 'SK-1: agent-builder renders the Component Library');
              for (const id of OOTB_SKILL_IDS) {
                const present = await page.locator(`[data-component="catalog-palette"] [data-kind="skill"][data-id="${id}"]`).count() > 0;
                check(present, `SK-1: OOTB skill "${id}" is draggable in the library`);
              }
              await frame(page, 'sk-0-library', 'Part 2 (skills) — the OOTB skill library, sourced from community repos', { key: true });

        },
      },
      {
        id: 'skills-edit',
        title: 'Edit a real shipped skill',
        narration: 'The operator opens one of forge\'s real shipped skills — project-scoped-review, the drift auditor — in the editor, appends a note to its instructions, and saves: the change lands in that skill\'s own SKILL.md on disk (restored to the shipped bytes right after), proving a shipped skill is editable text, not a black box.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check } = ctx;
              // ── SK-2: edit a REAL shipped skill (via the agent-skill editor) ──────────
              // The /agents/<slug> editor opens studio agents (SKILL.md with a runtime
              // block); project-scoped-review is the shipped, library-listed, low-risk
              // pick. Original bytes are stashed + restored after every real save.
              console.log('\n[SK-2] Edit a real shipped skill');
              cleanSkillArtifacts(); // stale-state sweep (scratch slugs + demo-design residue; restore is a no-op pre-stash)
              const original = stashRealSkill();
              // Mirror the stash into ctx.seeded for runner-side visibility; the actual
              // crash-safe restore rides the finally's cleanSkillArtifacts() call.
              ctx.seeded.skillEditStash = { path: SK_EDIT_PATH, bytes: original.length };
              check(original.includes('runtime:'), `SK-2: ${SK_EDIT_SLUG} is a real studio agent-skill (runtime block in its shipped SKILL.md)`);
              await page.goto(watch.uiUrl + `/agents/${SK_EDIT_SLUG}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
              check(await page.evaluate((s) => document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') === s, SK_EDIT_SLUG), `SK-2: editor loaded the real skill ([data-agent-id="${SK_EDIT_SLUG}"])`);
              const bodyBefore = await page.locator('#process-input').inputValue().catch(() => '');
              check(bodyBefore.includes('Audit ONE project'), 'SK-2: the editor shows the shipped instructions body (real content, not a seeded fixture)');
              await caption(page, `${SK_EDIT_SLUG} — a real shipped skill, opened in place: append a line, save, and it lands in its own SKILL.md.`);
              await page.locator('#process-input').fill(bodyBefore + '\n\n> ' + EDIT_MARKER).catch(() => {});
              await frame(page, 'sk-1-edit', `Part 2 (skills) — editing forge's real ${SK_EDIT_SLUG} skill in the builder`, { key: true });
              await page.locator('[data-action="save-agent"]').click().catch(() => {});
              check(await waitForEditMarker(8000), `SK-2: saving rewrites the real skills/${SK_EDIT_SLUG}/SKILL.md`);
              restoreRealSkill(); // proof captured — put the shipped bytes back before anything else reads it

              // CLIP 1 — skill-edit: fresh context → the library with OOTB provenance
              // chips (brief dwell) → open the real skill → typed edit → SAVE → hold on
              // the saved state. The clip context's save is REAL; the file is restored
              // below, after recordClip returns (the context's PUT has long landed by
              // the time the clip's hold-tail + context close complete).
              await recordClip(browser, watch, 'skill-edit', '/agents/new', async (p) => {
                await p.waitForSelector('[data-component="catalog-palette"]', { timeout: 12000 }).catch(() => {});
                await sleep(1800); // dwell — the OOTB chips with provenance/stars (discovery)
                await p.goto(watch.uiUrl + `/agents/${SK_EDIT_SLUG}`, { waitUntil: 'domcontentloaded' });
                await p.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
                await sleep(1000); // dwell — landed in the editor, the shipped instructions visible before editing
                const body = await p.locator('#process-input').inputValue().catch(() => '');
                await p.locator('#process-input').fill(body + '\n\n> ').catch(() => {});
                await p.locator('#process-input').pressSequentially(EDIT_MARKER, { delay: 14 }).catch(() => {});
                await p.locator('[data-action="save-agent"]').click().catch(() => {});
                await sleep(1200); // settle on the saved state (recordClip appends the loop-tail hold)
              }, { readySel: 'main[data-page="agents"]', caption: `discovering skills in the library, then editing a real shipped skill (${SK_EDIT_SLUG}) in place — saved to its own SKILL.md, then restored` });
              await waitForEditMarker(5000); // the clip's save is real — let it land before restoring
              restoreRealSkill();
              check(!readFileSync(SK_EDIT_PATH, 'utf8').includes(EDIT_MARKER), `SK-2: the shipped ${SK_EDIT_SLUG} SKILL.md is restored byte-for-byte after the beat`);

        },
      },
      {
        id: 'skills-create',
        title: 'Author a new skill',
        narration: 'From a blank builder the operator names a brand-new skill, describes it in one line, and writes its instructions; clicking Create writes a fresh SKILL.md to the library and Studio returns to the library, where the new skill is now listed — this created skill then threads through the rest of the walkthrough.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check } = ctx;
              // ── SK-3: author a NEW skill ──────────────────────────────────────────────
              console.log('\n[SK-3] Author a new skill');
              for (const slug of [SK_NEW_SLUG, SK_CLIP_SLUG]) {
                try { rmSync(join(FORGE_ROOT, 'skills', slug), { recursive: true, force: true }); } catch { /* */ }
              }
              // D8: the library is the ONE place "New skill" lives — enter through its
              // own [data-action="new-skill"] link rather than a direct goto, so this
              // beat also proves the one-entry-point rule (the rest of the library
              // surface is covered by the skills-library beat above).
              await page.goto(watch.uiUrl + '/skills', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="skill-library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              check(await page.locator('[data-action="new-skill"]').count() > 0,
                'SK-3: the library exposes [data-action="new-skill"] (D8: the one creation entry point)');
              await page.locator('[data-action="new-skill"]').click().catch(() => {});
              await page.waitForURL('**/skills/new', { timeout: 10000 }).catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-page="skill-builder"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              const skNewReady = await page.locator('main[data-page="skill-builder"]').count() > 0;
              check(skNewReady, 'SK-3: clicking [data-action="new-skill"] lands on the skill builder ([data-page="skill-builder"])');
              check(await page.locator('[data-section="skill-new"]').count() > 0, 'SK-3: [data-section="skill-new"] present');
              await caption(page, 'Author a brand-new skill: name, one-line description, instructions — added to the library.');
              // data-page-ready is static "true" here, so settle for hydration then type with
              // real keystrokes (pressSequentially fires onChange per char; plain .fill() can
              // land before React wires the input). Re-fill if create hasn't enabled.
              await sleep(1500);
              const fillSkill = async () => {
                const nameEl = page.locator('[data-field="skill-name"]');
                await nameEl.click().catch(() => {});
                await nameEl.fill('').catch(() => {});
                await nameEl.pressSequentially(SK_NEW_NAME, { delay: 18 }).catch(() => {});
                const descEl = page.locator('[data-field="skill-description"]');
                await descEl.click().catch(() => {});
                await descEl.fill('').catch(() => {});
                await descEl.pressSequentially('Review an API surface for contract-breaking changes before merge.', { delay: 8 }).catch(() => {});
                await page.locator('[data-field="skill-body"]').fill(CLIP_SK_BODY).catch(() => {});
              };
              const createEnabled = (ms) => page.waitForFunction(() => {
                const b = document.querySelector('[data-action="create-skill"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: ms }).then(() => true).catch(() => false);
              await fillSkill();
              let skEnabled = await createEnabled(6000);
              if (!skEnabled) { await fillSkill(); skEnabled = await createEnabled(6000); }
              check(skEnabled, 'SK-3: create-skill enables once name + description are filled');
              await frame(page, 'sk-2-create', 'Part 2 (skills) — authoring a brand-new skill', { key: true });

              // CLIP 2 — sk-create: the operator's real discovery path — the "+ author
              // a skill" CTA in a project's Relevant Skills panel (the only real UI entry
              // to /skills/new) — dwell, CLICK, then fill the form and CLICK Create; the
              // hold is the product's real created-confirmation (the redirect back to the
              // library, where the new skill is now listed). A fresh context creates its
              // OWN slug (SK_CLIP_SLUG) so it never collides with the main beat's artifact.
              await recordClip(browser, watch, 'sk-create', `/projects/${PROJECT}`, async (p) => {
                await p.waitForFunction(() => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 12000 }).catch(() => {});
                await sleep(1400); // dwell — discovering "+ author a skill" in the Relevant Skills panel
                await p.locator('[data-action="author-skill"]').click().catch(() => {});
                await p.waitForURL('**/skills/new', { timeout: 10000 }).catch(() => {});
                await p.waitForSelector('[data-section="skill-new"]', { timeout: 12000 });
                await sleep(1200); // hydration (same recipe as the main page)
                const nameEl = p.locator('[data-field="skill-name"]');
                await nameEl.click().catch(() => {});
                await nameEl.pressSequentially(SK_CLIP_NAME, { delay: 16 }).catch(() => {});
                await p.locator('[data-field="skill-description"]').fill(CLIP_SK_DESC).catch(() => {});
                await p.locator('[data-field="skill-body"]').fill(CLIP_SK_BODY).catch(() => {});
                const enabled = await p.waitForFunction(() => {
                  const b = document.querySelector('[data-action="create-skill"]');
                  return b !== null && !b.hasAttribute('disabled');
                }, null, { timeout: 6000 }).then(() => true).catch(() => false);
                if (!enabled) { // one re-fill — .fill can land before React wires the input
                  await nameEl.fill(SK_CLIP_NAME).catch(() => {});
                  await p.locator('[data-field="skill-description"]').fill(CLIP_SK_DESC).catch(() => {});
                }
                await p.locator('[data-action="create-skill"]').click().catch(() => {});
                await p.waitForURL('**/skills', { timeout: 12000 }).catch(() => {});
                await p.waitForFunction(() => document.querySelector('[data-page="skill-library"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 12000 }).catch(() => {});
                await sleep(600); // settle on the confirmation before the loop-tail hold
              }, { readySel: 'main[data-page="projects"]', caption: 'discovering "+ author a skill" on a project page — authoring a new skill from scratch, Create writes its SKILL.md and returns to the library' });
              const clipLanded = await waitForFile(join(FORGE_ROOT, 'skills', SK_CLIP_SLUG, 'SKILL.md'), 8000);
              check(clipLanded, `SK-3: the clip's Create click writes skills/${SK_CLIP_SLUG}/SKILL.md`);
              try { rmSync(join(FORGE_ROOT, 'skills', SK_CLIP_SLUG), { recursive: true, force: true }); } catch { /* */ }

              // Main-page create — SK_NEW_SLUG is the walkthrough's THROUGHLINE artifact
              // (a later agents-journey block composes it into an agent build): nothing
              // removes it mid-run; the runner's finally sweeps it via cleanSkillArtifacts.
              await page.locator('[data-action="create-skill"]').click().catch(() => {});
              const skLanded = await waitForFile(join(FORGE_ROOT, 'skills', SK_NEW_SLUG, 'SKILL.md'), 12000);
              check(skLanded, `SK-3: creating writes skills/${SK_NEW_SLUG}/SKILL.md`);
              // Create returns to the library — NOT the agent builder (there is no
              // agent build in progress to compose it into; the operator picks the
              // new skill from the library into whichever agent build comes next).
              await page.waitForURL('**/skills', { timeout: 12000 }).catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-page="skill-library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 12000 }).catch(() => {});
              check(await page.locator('main[data-page="skill-library"]').count() > 0,
                'SK-3: creating returns to the skill library ([data-page="skill-library"])');
              await sleep(ACT); // let the post-create redirect settle
              await frame(page, 'sk-3-created', 'Part 2 (skills) — new skill authored → SKILL.md on disk → back in the library, ready to compose into an agent', { key: true });

        },
      },
      {
        id: 'skills-install-approve',
        title: 'Install a community package, approve it, then catch drift',
        narration: 'The trust arc, end to end and real: a package materialised in a temp dir (never the repo) is installed through the bridge — landing quarantined as a draft, absent from the agent-builder palette — then approved for real through the UI, becoming palette-visible with its runtime: block still permanently quarantined (D4); mutating one byte of a non-SKILL.md package file afterwards flips it to needs-review and drops it back OUT of the palette, proving the drift check is enforced end to end, not just rendered.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── SK-5: install → quarantine → approve → needs-review (the trust arc) ───
              console.log('\n[SK-5] Install a community package, approve it, then catch drift');
              // Narrow sweep ONLY (own install dir + ledger) — NOT the broad
              // cleanSkillArtifacts(), which would also delete SK_NEW_SLUG
              // (api-contract-review), the skills-create beat's throughline
              // artifact a later agents-journey beat still needs (ui:journey-found
              // defect, R3-01-F4: this beat ran AFTER skills-create and wiped it).
              cleanSkillInstallArtifacts(); // stale-state sweep first (crash-safe, own artifacts only)
              try {
                // D2: this pipeline consumes an inline package upload — the entries are
                // built in memory and streamed as base64; the server stages them under a
                // trusted root (<forgeRoot>/_skill-staging) before any filesystem walk,
                // so no caller-supplied host path ever reaches installSkillPackage.
                const skillMd = [
                  '---',
                  'name: Journey Installed Skill',
                  'description: A package materialised purely for this journey beat -- exercises install, quarantine, approve, and re-review end to end; never composed by any real agent.',
                  'runtime:',
                  '  sdk: claude',
                  '  strategy: fixed',
                  'allowed-tools:',
                  '  - Read',
                  'library: true',
                  '---',
                  '',
                  '# Journey Installed Skill',
                  '',
                  'Demonstrates the trust pipeline end to end. Never composed by any real',
                  'agent -- it exists solely for this journey beat and is removed at the end',
                  'of every run.',
                  '',
                ].join('\n');
                const collectSh = '#!/usr/bin/env bash\necho "journey fixture -- never executed"\n';
                const entries = [
                  { path: 'SKILL.md', contentBase64: Buffer.from(skillMd).toString('base64') },
                  { path: 'scripts/collect.sh', contentBase64: Buffer.from(collectSh).toString('base64') },
                ];

                // Install via the bridge — the inline { id, entries, upstream } upload
                // contract. No install button ever called this route (installSkill was a
                // dead export, now deleted); the harness posts the entries directly. The
                // server stages them under a trusted root (<forgeRoot>/_skill-staging),
                // re-checking per-entry containment, before installSkillPackage walks them.
                const installRes = await fetch(watch.bridgeUrl + '/api/studio/skills/install', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
                  body: JSON.stringify({
                    id: SK_INSTALL_ID,
                    entries,
                    upstream: { source: 'local-fixture://journey-install-approve' },
                  }),
                });
                const installBody = await installRes.json().catch(() => ({}));
                check(installRes.ok && installBody.ok === true, `SK-5: install POST succeeds (status ${installRes.status})`);
                check(existsSync(join(SK_INSTALL_DIR, 'SKILL.md')), `SK-5: skills/${SK_INSTALL_ID}/SKILL.md lands on disk`);

                const installedRaw = readFileSync(join(SK_INSTALL_DIR, 'SKILL.md'), 'utf8');
                check(/^status: draft$/m.test(installedRaw), 'SK-5: installed package is quarantined as status: draft');
                const topFrontmatter = installedRaw.split(/\nquarantined:/)[0];
                check(!/^runtime:/m.test(topFrontmatter), 'SK-5: runtime: is NOT top-level after install (moved under quarantined:)');
                check(/quarantined:/.test(installedRaw) && /\n\s+runtime:/.test(installedRaw.split(/\nquarantined:/)[1] ?? ''),
                  'SK-5: the quarantined: block preserves the original runtime: key');

                // Draft is NOT palette-visible — check the agent-builder palette itself,
                // not just a status field (the end-to-end enforcement point).
                await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
                const draftInPalette = await page.locator(`[data-component="catalog-palette"] [data-kind="skill"][data-id="${SK_INSTALL_ID}"]`).count();
                check(draftInPalette === 0, `SK-5: the draft install is NOT in the agent-builder palette (found ${draftInPalette})`);

                // The detail page renders the approval gate (drafts only) with the scan.
                await page.goto(watch.uiUrl + `/skills/${SK_INSTALL_ID}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
                check(await page.evaluate(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-skill-trust')) === 'draft',
                  'SK-5: detail page reports data-skill-trust="draft"');
                check(await page.locator('[data-section="approval-gate"]').count() > 0, 'SK-5: [data-section="approval-gate"] renders for the draft');
                // scanSkillPackage reports the keys the source package actually declared —
                // whether they still sit at top level or have already been moved under the
                // nested `quarantined:` block by installSkillPackage (D4). The fixture above
                // declares all three quarantine-able keys (runtime, allowed-tools, library),
                // so the draft's scan must report all three, not just the one (`library`)
                // that always happens to sit top-level on every fresh draft regardless of
                // what the source declared.
                check(await page.evaluate(() => document.querySelector('[data-section="scan-report"]')?.getAttribute('data-quarantined-count')) === '3',
                  'SK-5: scan reports all three quarantined keys the source package declared (runtime, allowed-tools, library)');
                const quarantinedKeysText = await page.evaluate(() => {
                  const dts = [...document.querySelectorAll('[data-section="scan-report"] dt')];
                  const dt = dts.find((el) => el.textContent?.trim() === 'quarantined keys');
                  return dt?.nextElementSibling?.textContent ?? '';
                });
                check(quarantinedKeysText.includes('runtime'), `SK-5: the scan-report's reported keys include "runtime" (got "${quarantinedKeysText}")`);
                check(await page.evaluate(() => document.querySelector('[data-section="scan-report"]')?.getAttribute('data-executable-count')) === '1',
                  'SK-5: scan reports the one executable-extension file (scripts/collect.sh)');
                await caption(page, 'Installed as a draft — quarantined, not palette-visible, not runnable (D4). Read the full SKILL.md, then approve.');
                await frame(page, 'sk-7-install-draft', 'Part 2 (skills) — an installed package lands quarantined as a draft', { key: true });

                // Approve — for real, through the UI button.
                await page.locator('[data-action="approve-skill"]').click().catch(() => {});
                await page.waitForFunction(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-skill-trust') === 'ready', null, { timeout: 10000 }).catch(() => {});
                check(await page.evaluate(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-skill-trust')) === 'ready',
                  'SK-5: approving flips trust to ready');
                check(await page.locator('[data-section="approval-gate"]').count() === 0, 'SK-5: the approval gate no longer renders once approved');
                const approvedRaw = readFileSync(join(SK_INSTALL_DIR, 'SKILL.md'), 'utf8');
                check(!/^status: draft$/m.test(approvedRaw), 'SK-5: status: draft removed on disk after approval');
                check(!/^runtime:/m.test(approvedRaw.split(/\nquarantined:/)[0]), 'SK-5: runtime: is still NOT restored top-level after approval (D4)');

                // Now palette-visible.
                await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
                const approvedInPalette = await page.locator(`[data-component="catalog-palette"] [data-kind="skill"][data-id="${SK_INSTALL_ID}"]`).count();
                check(approvedInPalette > 0, `SK-5: the approved skill IS now in the agent-builder palette (found ${approvedInPalette})`);
                await caption(page, 'Approved — palette-visible now, but still a plain composable skill forever (D4 never restores runtime:).');
                await frame(page, 'sk-8-approved-palette', 'Part 2 (skills) — approved: palette-visible, runtime: still quarantined', { key: true });

                // Mutate ONE byte of a NON-SKILL.md package file → needs-review, and the
                // skill drops back OUT of the palette (the end-to-end enforcement point).
                const scriptPath = join(SK_INSTALL_DIR, 'scripts', 'collect.sh');
                writeFileSync(scriptPath, readFileSync(scriptPath, 'utf8') + '# tampered\n');
                await page.goto(watch.uiUrl + `/skills/${SK_INSTALL_ID}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
                check(await page.evaluate(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-skill-trust')) === 'needs-review',
                  'SK-5: mutating a non-SKILL.md package file flips trust to needs-review');
                check(await page.locator('[data-section="needs-review"]').count() > 0, 'SK-5: [data-section="needs-review"] renders');
                await caption(page, 'One byte changed in scripts/collect.sh — not even SKILL.md itself — and the pin no longer matches.');
                await frame(page, 'sk-9-needs-review', 'Part 2 (skills) — a package-file byte change flips it to needs-review', { key: true });

                await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
                const driftedInPalette = await page.locator(`[data-component="catalog-palette"] [data-kind="skill"][data-id="${SK_INSTALL_ID}"]`).count();
                check(driftedInPalette === 0, `SK-5: needs-review drops back OUT of the palette (found ${driftedInPalette})`);
              } finally {
                // Every beat cleans up its own artifacts — the installed result + ledger,
                // restored to their exact prior state (cleanSkillInstallArtifacts — the
                // NARROW sweep; see the start-of-beat comment for why this must not be the
                // broad cleanSkillArtifacts()). No temp package dir to remove any more —
                // the entries are streamed in memory and staged server-side.
                cleanSkillInstallArtifacts();
              }
              check(!existsSync(SK_INSTALL_DIR), `SK-5: skills/${SK_INSTALL_ID}/ removed after the beat (self-cleaning)`);

        },
      },
      {
        id: 'skills-agentic-author',
        title: 'Agentic skill authoring (contract gap → agent)',
        narration: 'Skills don\'t only come from the library or the blank builder — forge\'s own agents author them. On the mdtoc project page the real contract preflight flags a genuine gap (a demoProcess is declared but the generated demo-design skill is missing) at the agent tier; one click on "Open in demo builder…" opens the demo-builder session where the operator briefs it. The generation itself is staged for this walkthrough (the same no-spawn seam every emulated agent turn uses): the harness hand-writes the exact SKILL.md the real agent produces, and the clause flips to resolved on the next preflight.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check } = ctx;
              // ── SK-4: agentic skill authoring (the demo-design contract clause) ───────
              // mdtoc genuinely fails DEMO-SKILL (demoProcess declared, no generated
              // .forge/skills/demo-design/SKILL.md), classified agent-tier → route
              // demo-builder (cli/preflight-resolve.ts). The resolve click is REAL
              // (fix-agent dispatch + demo-builder session + navigation); only the LLM
              // turn is suppressed (FORGE_ARCHITECT_NO_SPAWN=1) and its artifact seeded.
              console.log('\n[SK-4] Agentic skill authoring (demo-design contract clause)');
              try { rmSync(DEMO_DESIGN_SKILL_DIR, { recursive: true, force: true }); } catch { /* */ }
              const gotoProject = async (p) => {
                await p.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
                await p.waitForFunction(() => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 20000 }).catch(() => {});
                await p.waitForFunction(() => document.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status') === 'ok', null, { timeout: 20000 }).catch(() => {});
              };
              await gotoProject(page);
              check(await page.evaluate(() => document.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status') === 'ok'), 'SK-4: the real preflight ran against the project (loaded, no hard failures)');
              const clauseSel = '[data-resolution-clause][data-clause-id="DEMO-SKILL"]';
              check(await page.locator(`${clauseSel}[data-clause-resolution="agent"]`).count() > 0, 'SK-4: the DEMO-SKILL clause fails at the agent tier (real preflight, real gap)');
              const resolveBtn = '[data-action="resolve-clause-agent"][data-resolve-clause-id="DEMO-SKILL"]';
              check(await page.locator(resolveBtn).count() > 0, 'SK-4: "Open in demo builder…" offered on the clause');
              await caption(page, 'A real contract gap — the project declares a demoProcess but has no generated demo-design skill. One click opens the demo builder to brief the agent.');
              await frame(page, 'sk-4-clause', 'Part 2 (skills) — a real preflight gap offered for agentic resolution', { key: true });

              // The REAL click: fix-agent dispatch → demo-builder session → navigation.
              await page.locator(resolveBtn).click().catch(() => {});
              // W6-B10 (R1-03-F2 reversed): the resolution opens the DEDICATED
              // session screen (/sessions/demo/<sid>), not an inline panel.
              const kickoffReady = await page.waitForFunction(
                () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).then(() => true).catch(() => false);
              check(kickoffReady, `SK-4: the agent route opens the dedicated demo-builder session screen (${page.url()})`);
              const sid = demoSidFromUrl(page.url());
              check(!!sid, `SK-4: a real session id is in the URL (${page.url()})`);
              ctx.seeded.demoSid = sid; // crash-safe sweep via the runner's finally

              // Brief the agent for real, through the GENERIC question-form
              // affordance (the bridge flips briefing → generating; the spawn is
              // suppressed), then emulate the turn's activity — the pending
              // state the viewer dwells on before the flip.
              await page.waitForSelector('[data-field="session-answer"]', { timeout: 15000 }).catch(() => {});
              await page.locator('[data-field="session-answer"]').fill(AGENTIC_BRIEF).catch(() => {});
              await page.locator('[data-action="submit-answers"]').click().catch(() => {});
              await page.waitForFunction(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') === 'generating', null, { timeout: 15000 }).catch(() => {});
              check(await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') === 'generating'), 'SK-4: the briefed session enters generating (the pending state the real agent runs in)');
              if (sid) demoEvent(sid, 'start', 'demo-builder turn (staged) — authoring .forge/skills/demo-design/SKILL.md');
              await caption(page, 'The demo-builder agent authors the skill — staged for this walkthrough; a real run writes the same file.');
              await frame(page, 'sk-5-generating', 'Part 2 (skills) — the agent turn pending (generation staged for the demo)');
              if (sid) await demoBurst(sid, ['Read', 'Bash', 'Write']);
              await sleep(WORK); // generation dwell — pending state visible

              // Hand-write the artifact the real agent would produce, then let the
              // project page re-run preflight (it runs server-side on every load).
              writeDemoDesignSkill();
              if (sid) demoEvent(sid, 'log', 'demo-design skill authored — preflight re-checks the clause');
              await gotoProject(page);
              await page.waitForFunction((sel) => document.querySelector(sel) === null, clauseSel, { timeout: 15000 }).catch(() => {});
              check(await page.locator(clauseSel).count() === 0, 'SK-4: the DEMO-SKILL clause flips to resolved once the generated skill exists (row gone on re-preflight)');
              check(existsSync(join(DEMO_DESIGN_SKILL_DIR, 'SKILL.md')), 'SK-4: .forge/skills/demo-design/SKILL.md exists (the staged agent output at the real path)');
              await caption(page, 'The clause is resolved — the generated demo-design skill now exists at the path the contract names.');
              await frame(page, 'sk-6-resolved', 'Part 2 (skills) — the contract clause flipped to resolved by an agent-authored skill', { key: true });

              // Reset the failing state so CLIP 3 records the full arc from scratch.
              try { rmSync(DEMO_DESIGN_SKILL_DIR, { recursive: true, force: true }); } catch { /* */ }
              cleanDemoBuilderSession(sid);

              // CLIP 3 — skill-agentic: failing clause → Open in demo builder… → pending
              // dwell on the (staged) generation → back on the project page with the
              // clause resolved. Runs its own fresh session; cleaned below.
              let clipSid = null;
              await recordClip(browser, watch, 'skill-agentic', `/projects/${PROJECT}`, async (p) => {
                await p.waitForFunction(() => document.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status') === 'ok', null, { timeout: 15000 }).catch(() => {});
                await sleep(1600); // dwell on the failing clause + its agent-tier offer
                await p.locator(resolveBtn).click().catch(() => {});
                await p.waitForFunction(
                  () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                ).catch(() => {});
                clipSid = demoSidFromUrl(p.url());
                await p.waitForSelector('[data-field="session-answer"]', { timeout: 10000 }).catch(() => {});
                await p.locator('[data-field="session-answer"]').fill(AGENTIC_BRIEF).catch(() => {});
                await p.locator('[data-action="submit-answers"]').click().catch(() => {});
                if (clipSid) demoEvent(clipSid, 'start', 'demo-builder turn (staged) — authoring the demo-design skill');
                await sleep(2400); // pending hold — the generation dwell before the flip
                writeDemoDesignSkill();
                if (clipSid) demoEvent(clipSid, 'log', 'demo-design skill authored');
                await p.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
                await p.waitForFunction((sel) =>
                  document.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status') === 'ok' &&
                  document.querySelector(sel) === null,
                clauseSel, { timeout: 15000 }).catch(() => {});
              }, { readySel: '[data-section="contract-resolution"]', caption: 'a preflight contract gap resolved by an agent-authored skill (generation staged for the demo)' });

              // Beat-tail cleanup: the staged artifact is untracked (the runner's
              // git-checkout doesn't cover it) — remove it + the clip's session here;
              // cleanSkillArtifacts in the runner's finally is the crash-safe sweep.
              try { rmSync(DEMO_DESIGN_SKILL_DIR, { recursive: true, force: true }); } catch { /* */ }
              cleanDemoBuilderSession(clipSid);
              check(!existsSync(DEMO_DESIGN_SKILL_DIR), 'SK-4: the staged demo-design artifact is cleaned up (next run starts from the real failing state)');

        },
      },
      {
        id: 'skills-agentic-build',
        title: 'Build a skill with the creation agent (authoring session)',
        narration: 'The library\'s OTHER creation path: instead of filling in the manual form, describe the skill to the creation agent. A real session opens at /sessions/authoring/<sid> — under this harness the drafting turn itself is suppressed, so the journey seeds exactly the bytes a real, captured creation-agent turn produced (provenance in journey-fixtures.mjs, sha256 verified). Everything after that is real, unsuppressed product code: the file-package pane renders the drafted SKILL.md, Save runs the real finalize route end to end (landing a draft skill), and Approve flips it palette-visible — checked against the REAL agent-builder catalog, not merely a page re-render.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── SK-6: build a skill through the creation-agent authoring session ──────
              console.log('\n[SK-6] Build a skill with the creation agent (authoring session)');
              cleanAuthoringSkillArtifacts(null); // stale-state sweep first (crash-safe, this beat's own artifacts only)

              // Entry: the /skills library's own "new skill" affordance lands on
              // /skills/new, where AuthoringLauncher renders ALONGSIDE the manual
              // form (D2, T3 report) — the SAME entry point skills-create already
              // proves for the manual form, now proving the agentic alternative.
              await page.goto(watch.uiUrl + '/skills', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="skill-library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              await page.locator('[data-action="new-skill"]').click().catch(() => {});
              await page.waitForURL('**/skills/new', { timeout: 10000 }).catch(() => {});
              await page.waitForSelector('[data-section="authoring-launcher"]', { timeout: 15000 }).catch(() => {});
              check(await page.locator('[data-section="authoring-launcher"]').count() > 0,
                'SK-6: /skills/new renders the authoring launcher alongside the manual form');
              await caption(page, 'Or describe it to the creation agent instead — the same entry point, an agentic alternative to the manual form.');

              await page.locator('[data-field="authoring-launcher-project"]').fill(PROJECT).catch(() => {});
              await page.locator('[data-field="authoring-launcher-prompt"]').fill(
                'Summarise a git diff into three bullet points: what changed, why it matters, what to test.',
              ).catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-section="authoring-launcher"]')?.getAttribute('data-authoring-launcher-ready') === 'true',
                null, { timeout: 5000 }).catch(() => {});
              await frame(page, 'sk-10-authoring-launcher', 'Part 2 (skills) — the authoring launcher: describe it to the creation agent', { key: true });

              await page.locator('[data-action="start-authoring"]').click().catch(() => {});
              await page.waitForURL(/\/sessions\/authoring\//, { timeout: 15000 }).catch(() => {});
              const sid = authoringSidFromUrl(page.url());
              check(!!sid, `SK-6: starting opens a real session at /sessions/authoring/<sid> (${page.url()})`);

              check(await page.locator('main[data-page="session"][data-session-kind="authoring"]').count() > 0,
                'SK-6: the shared session shell renders for the authoring kind');
              const statusPath = join(authoringDir(sid ?? ''), 'status.json');
              const startedReal = sid ? await waitForFile(statusPath, 8000) : false;
              check(startedReal, `SK-6: the real POST /start route wrote projects/${PROJECT}/_authoring/${sid}/status.json`);
              const preSeedPhase = startedReal ? JSON.parse(readFileSync(statusPath, 'utf8')).phase : null;
              check(preSeedPhase === 'analyzing', `SK-6: the suppressed spawn leaves the session at phase "analyzing" (got "${preSeedPhase}")`);

              // SEED: exactly what the suppressed creation-agent turn would have
              // written — the captured live-capture SKILL.md, verbatim — then the
              // SAME analyzing -> awaiting-review transition the turnSpec table
              // itself declares (studio/session-kinds.yaml).
              if (sid) seedAuthoringSkillDraft(sid);
              await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('main[data-page="session"]')?.getAttribute('data-session-phase') === 'awaiting-review',
                null, { timeout: 10000 }).catch(() => {});
              // W6-B8 — authoring now renders the GENERIC SessionInteractivePanel
              // (its bespoke SessionAuthoringPanel/[data-authoring-shape] is
              // deleted); the drafted shape (skill vs hook) is detected the
              // SAME way — file PRESENCE, SKILL.md at the package root — but
              // surfaces as the package-id field's own label text, since the
              // generic panel carries no per-kind status section.
              check(await page.locator('[data-affordance-kind="verdict"]').count() > 0,
                'SK-6: awaiting-review derives a verdict affordance');
              check(await page.locator('[data-field="session-package-id"]').count() > 0,
                'SK-6: the package-id field renders (artifact.kind === "file-package")');
              const idFieldLabel = await page.evaluate(() => document.querySelector('[data-field="session-package-id"]')?.previousElementSibling?.textContent ?? '');
              check(idFieldLabel === 'Skill id (directory name)',
                `SK-6: the panel detects the drafted shape by file PRESENCE (SKILL.md at the package root) — got label "${idFieldLabel}"`);
              check(await page.locator('[data-section="session-artifact"] [data-component="file-package"]').count() > 0,
                'SK-6: the real file-package artifact pane renders the drafted SKILL.md');
              const draftedText = await page.evaluate(() =>
                document.querySelector('[data-section="session-artifact"] [data-component="file-package"]')?.textContent ?? '');
              check(draftedText.includes('Live Proof Skill'), 'SK-6: the pane shows the REAL captured turn\'s content, not a placeholder');
              await frame(page, 'sk-11-drafted', 'Part 2 (skills) — the drafted SKILL.md in the real file-package pane', { key: true });

              await page.locator('[data-field="session-package-id"]').fill(AUTH_SKILL_ID).catch(() => {});
              await page.locator('[data-action="verdict-approve"]').click().catch(() => {});
              await page.waitForURL(new RegExp(`/skills/${AUTH_SKILL_ID}`), { timeout: 15000 }).catch(() => {});
              await page.waitForFunction(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
              check(existsSync(join(AUTH_SKILL_DIR, 'SKILL.md')), `SK-6: finalize lands the real skills/${AUTH_SKILL_ID}/SKILL.md`);
              check(await page.evaluate(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-skill-trust')) === 'draft',
                'SK-6: the finalized package lands as a DRAFT (never auto-approved)');
              check(await page.locator('[data-section="approval-gate"]').count() > 0, 'SK-6: the approval gate renders for the draft');
              await caption(page, 'Finalize ran the real commit turn end to end — landed as a draft skill, awaiting approval.');
              await frame(page, 'sk-12-draft', 'Part 2 (skills) — the creation agent\'s package, landed as a real draft skill', { key: true });

              await page.locator('[data-action="approve-skill"]').click().catch(() => {});
              await page.waitForFunction(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-skill-trust') === 'ready', null, { timeout: 10000 }).catch(() => {});
              check(await page.evaluate(() => document.querySelector('[data-page="skill-detail"]')?.getAttribute('data-skill-trust')) === 'ready',
                'SK-6: approving flips trust to ready');

              await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
              const inPalette = await page.locator(`[data-component="catalog-palette"] [data-kind="skill"][data-id="${AUTH_SKILL_ID}"]`).count();
              check(inPalette > 0, `SK-6: the agent-authored skill is palette-visible from the REAL agent-builder catalog source (found ${inPalette})`);
              await caption(page, 'Palette-visible — from the real agent-builder catalog source, not merely a page re-render.');
              await frame(page, 'sk-13-palette', 'Part 2 (skills) — the agent-authored skill, approved and palette-visible', { key: true });

              cleanAuthoringSkillArtifacts(sid);
              check(!existsSync(AUTH_SKILL_DIR), `SK-6: skills/${AUTH_SKILL_ID}/ removed after the beat (self-cleaning)`);

        },
      },
    ],
  });
