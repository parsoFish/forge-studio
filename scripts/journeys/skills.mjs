import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  FORGE_ROOT, caption, OOTB_SKILL_IDS, cleanSkillArtifacts, seedOotbSkill,
  SK_EDIT_SLUG, SK_NEW_SLUG, SK_NEW_NAME, waitForFile,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

export const journey = defineJourney({
    id: 'skills',
    title: 'Compose a skill',
    story: 'Browse the OOTB community-sourced skill library, edit a skill, and author a brand-new one.',
    beats: [
      {
        id: 'skills-ootb-library',
        title: 'OOTB skill library (community-sourced)',
        narration: 'OOTB skill library (community-sourced)',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ════════════════════════════════════════════════════════════════════════
              // PART 2 (skills pillar) — the OOTB skill library (sourced from curated
              // community repos), editing a skill, and authoring a new one from scratch.
              // ════════════════════════════════════════════════════════════════════════

              // ── SK-1: the OOTB skill library (community-sourced) ──────────────────────
              console.log('\n[SK-1] OOTB skill library (community-sourced)');
              let community = [];
              try { community = (yaml.load(readFileSync(join(FORGE_ROOT, 'studio', 'catalog.yaml'), 'utf8'))?.['community-skills']) ?? []; } catch { /* */ }
              check(community.length >= 5, `SK-1: catalog ships an OOTB skill library (${community.length} community-skills)`);
              const handoffSkill = community.find((s) => s.id === 'handoff');
              check(/github\.com|firecrawl|http/.test(handoffSkill?.source ?? ''), `SK-1: an OOTB skill cites an online source (${handoffSkill?.source ?? 'none'})`);
              check(!!handoffSkill?.provenance && !!handoffSkill?.stars, `SK-1: OOTB skill carries provenance + stars (${handoffSkill?.provenance ?? '?'}, ${handoffSkill?.stars ?? '?'})`);
              await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
              await caption(page, 'Every OOTB skill is a curated community skill (superpowers, TDD, security-review) — drag it into an agent.');
              check(await page.locator('[data-component="catalog-palette"]').count() > 0, 'SK-1: agent-builder renders the Component Library');
              for (const id of OOTB_SKILL_IDS) {
                const present = await page.locator(`[data-component="catalog-palette"] [data-kind="skill"][data-id="${id}"]`).count() > 0;
                check(present, `SK-1: OOTB skill "${id}" is draggable in the library`);
              }
              await frame(page, 'sk-0-library', 'Part 2 (skills) — the OOTB skill library, sourced from community repos');

        },
      },
      {
        id: 'skills-edit',
        title: 'Edit a skill',
        narration: 'Edit a skill',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── SK-2: edit a skill (via the agent-skill editor) ───────────────────────
              console.log('\n[SK-2] Edit a skill');
              cleanSkillArtifacts();
              seedOotbSkill();
              await page.goto(watch.uiUrl + `/agents/${SK_EDIT_SLUG}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
              check(await page.evaluate((s) => document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') === s, SK_EDIT_SLUG), `SK-2: editor loaded the skill ([data-agent-id="${SK_EDIT_SLUG}"])`);
              await caption(page, 'Open any skill and edit it in place — the instructions are rewritten to its SKILL.md.');
              await page.locator('#process-input').fill('EDITED body — journey rewrote the skill instructions.').catch(() => {});
              await frame(page, 'sk-1-edit', 'Part 2 (skills) — editing a skill in the builder');
              await page.locator('[data-action="save-agent"]').click().catch(() => {});
              let skEdited = false;
              { const p = join(FORGE_ROOT, 'skills', SK_EDIT_SLUG, 'SKILL.md'); const dl = Date.now() + 8000;
                while (Date.now() < dl) { try { if (readFileSync(p, 'utf8').includes('EDITED body')) { skEdited = true; break; } } catch { /* */ } await sleep(120); } }
              check(skEdited, `SK-2: saving rewrites skills/${SK_EDIT_SLUG}/SKILL.md`);

        },
      },
      {
        id: 'skills-create',
        title: 'Author a new skill',
        narration: 'Author a new skill',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check } = ctx;
              // ── SK-3: author a NEW skill ──────────────────────────────────────────────
              console.log('\n[SK-3] Author a new skill');
              try { rmSync(join(FORGE_ROOT, 'skills', SK_NEW_SLUG), { recursive: true, force: true }); } catch { /* */ }
              await page.goto(watch.uiUrl + '/skills/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="skill-builder"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              const skNewReady = await page.locator('main[data-page="skill-builder"]').count() > 0;
              check(skNewReady, 'SK-3: skill builder renders ([data-page="skill-builder"])');
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
                await page.locator('[data-field="skill-body"]').fill('1. Diff the public surface.\n2. Flag removed/renamed exports.\n3. Require a migration note.').catch(() => {});
              };
              const createEnabled = (ms) => page.waitForFunction(() => {
                const b = document.querySelector('[data-action="create-skill"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: ms }).then(() => true).catch(() => false);
              await fillSkill();
              let skEnabled = await createEnabled(6000);
              if (!skEnabled) { await fillSkill(); skEnabled = await createEnabled(6000); }
              check(skEnabled, 'SK-3: create-skill enables once name + description are filled');
              await frame(page, 'sk-2-create', 'Part 2 (skills) — authoring a brand-new skill');
              await recordClip(browser, watch, 'sk-create', '/skills/new', async (p) => {
                await p.waitForSelector('[data-section="skill-new"]', { timeout: 12000 });
                await p.locator('[data-field="skill-name"]').fill('API contract review').catch(() => {});
                await p.locator('[data-field="skill-description"]').fill('Flag contract-breaking API changes before merge.').catch(() => {});
                await sleep(1800);
              }, { readySel: 'main[data-page="skill-builder"]', caption: 'authoring a new skill from scratch' });
              await page.locator('[data-action="create-skill"]').click().catch(() => {});
              const skLanded = await waitForFile(join(FORGE_ROOT, 'skills', SK_NEW_SLUG, 'SKILL.md'), 12000);
              check(skLanded, `SK-3: creating writes skills/${SK_NEW_SLUG}/SKILL.md`);
              await frame(page, 'sk-3-created', 'Part 2 (skills) — new skill authored → SKILL.md on disk → ready to compose');

        },
      },
    ],
  });
