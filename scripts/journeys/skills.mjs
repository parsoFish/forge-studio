import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  FORGE_ROOT, PROJECT, ACT, WORK, caption, OOTB_SKILL_IDS, cleanSkillArtifacts,
  SK_EDIT_SLUG, SK_EDIT_PATH, stashRealSkill, restoreRealSkill,
  SK_NEW_SLUG, SK_NEW_NAME, SK_CLIP_SLUG, SK_CLIP_NAME, waitForFile,
  DEMO_DESIGN_SKILL_DIR, writeDemoDesignSkill,
  demoEvent, demoBurst, cleanDemoBuilderSession,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

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

/** Parse the demo-builder session id out of a /demo/<sid> URL (null if not there). */
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
    story: 'As an operator, I browse forge\'s OOTB skill library — highly rated skills sourced from existing community libraries, provenance and stars shown — then edit one of forge\'s real shipped skills in place, author a brand-new skill from scratch, and have a forge agent author one for me by resolving a real contract gap.',
    beats: [
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
                await sleep(1800); // dwell — the OOTB chips with provenance/stars
                await p.goto(watch.uiUrl + `/agents/${SK_EDIT_SLUG}`, { waitUntil: 'domcontentloaded' });
                await p.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
                const body = await p.locator('#process-input').inputValue().catch(() => '');
                await p.locator('#process-input').fill(body + '\n\n> ').catch(() => {});
                await p.locator('#process-input').pressSequentially(EDIT_MARKER, { delay: 14 }).catch(() => {});
                await p.locator('[data-action="save-agent"]').click().catch(() => {});
                await sleep(1200); // settle on the saved state (recordClip appends the loop-tail hold)
              }, { readySel: 'main[data-page="agents"]', caption: `editing a real shipped skill (${SK_EDIT_SLUG}) in place — saved to its own SKILL.md, then restored` });
              await waitForEditMarker(5000); // the clip's save is real — let it land before restoring
              restoreRealSkill();
              check(!readFileSync(SK_EDIT_PATH, 'utf8').includes(EDIT_MARKER), `SK-2: the shipped ${SK_EDIT_SLUG} SKILL.md is restored byte-for-byte after the beat`);

        },
      },
      {
        id: 'skills-create',
        title: 'Author a new skill',
        narration: 'From a blank builder the operator names a brand-new skill, describes it in one line, and writes its instructions; clicking Create writes a fresh SKILL.md to the library and Studio lands in the agent builder to compose it — this created skill then threads through the rest of the walkthrough.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check } = ctx;
              // ── SK-3: author a NEW skill ──────────────────────────────────────────────
              console.log('\n[SK-3] Author a new skill');
              for (const slug of [SK_NEW_SLUG, SK_CLIP_SLUG]) {
                try { rmSync(join(FORGE_ROOT, 'skills', slug), { recursive: true, force: true }); } catch { /* */ }
              }
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

              // CLIP 2 — sk-create: fills the form and CLICKS Create; the hold is the
              // product's real created-confirmation (the redirect into the agent builder
              // to compose the new skill). A fresh context creates its OWN slug
              // (SK_CLIP_SLUG) so it never collides with the main beat's artifact.
              await recordClip(browser, watch, 'sk-create', '/skills/new', async (p) => {
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
                await p.waitForURL('**/agents/new', { timeout: 12000 }).catch(() => {});
                await p.waitForSelector('[data-page="agents"]', { timeout: 12000 }).catch(() => {});
                await sleep(600); // settle on the confirmation before the loop-tail hold
              }, { readySel: 'main[data-page="skill-builder"]', caption: 'authoring a new skill from scratch — Create writes its SKILL.md and lands in the agent builder to compose it' });
              const clipLanded = await waitForFile(join(FORGE_ROOT, 'skills', SK_CLIP_SLUG, 'SKILL.md'), 8000);
              check(clipLanded, `SK-3: the clip's Create click writes skills/${SK_CLIP_SLUG}/SKILL.md`);
              try { rmSync(join(FORGE_ROOT, 'skills', SK_CLIP_SLUG), { recursive: true, force: true }); } catch { /* */ }

              // Main-page create — SK_NEW_SLUG is the walkthrough's THROUGHLINE artifact
              // (a later agents-journey block composes it into an agent build): nothing
              // removes it mid-run; the runner's finally sweeps it via cleanSkillArtifacts.
              await page.locator('[data-action="create-skill"]').click().catch(() => {});
              const skLanded = await waitForFile(join(FORGE_ROOT, 'skills', SK_NEW_SLUG, 'SKILL.md'), 12000);
              check(skLanded, `SK-3: creating writes skills/${SK_NEW_SLUG}/SKILL.md`);
              await sleep(ACT); // let the post-create redirect into the agent builder settle
              await frame(page, 'sk-3-created', 'Part 2 (skills) — new skill authored → SKILL.md on disk → Studio lands in the agent builder to compose it', { key: true });

        },
      },
      {
        id: 'skills-agentic-author',
        title: 'Agentic skill authoring (contract gap → agent)',
        narration: 'Skills don\'t only come from the library or the blank builder — forge\'s own agents author them. On the mdtoc project page the real contract preflight flags a genuine gap (a demoProcess is declared but the generated demo-design skill is missing) at the agent tier; one click on "Resolve with agent" routes it to the demo-builder. The generation itself is staged for this walkthrough (the same no-spawn seam every emulated agent turn uses): the harness hand-writes the exact SKILL.md the real agent produces, and the clause flips to resolved on the next preflight.',
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
              check(await page.locator(resolveBtn).count() > 0, 'SK-4: "Resolve with agent" offered on the clause');
              await caption(page, 'A real contract gap — the project declares a demoProcess but has no generated demo-design skill. One click hands it to an agent.');
              await frame(page, 'sk-4-clause', 'Part 2 (skills) — a real preflight gap offered for agentic resolution', { key: true });

              // The REAL click: fix-agent dispatch → demo-builder session → navigation.
              await page.locator(resolveBtn).click().catch(() => {});
              await page.waitForURL('**/demo/**', { timeout: 15000 }).catch(() => {});
              const sid = demoSidFromUrl(page.url());
              check(!!sid, `SK-4: the agent route lands on a demo-builder session (${page.url()})`);
              ctx.seeded.demoSid = sid; // crash-safe sweep via the runner's finally

              // Brief the agent for real (the bridge flips briefing → generating; the
              // spawn is suppressed), then emulate the turn's activity — the pending
              // state the viewer dwells on before the flip.
              await page.waitForSelector('[data-section="session-briefing"]', { timeout: 15000 }).catch(() => {});
              await page.locator('[data-field="briefing-notes"]').fill(AGENTIC_BRIEF).catch(() => {});
              await page.locator('[data-action="submit-brief"]').click().catch(() => {});
              await page.waitForFunction(() => document.querySelector('[data-page="demo-builder"]')?.getAttribute('data-demo-phase') === 'generating', null, { timeout: 15000 }).catch(() => {});
              check(await page.evaluate(() => document.querySelector('[data-page="demo-builder"]')?.getAttribute('data-demo-phase') === 'generating'), 'SK-4: the briefed session enters generating (the pending state the real agent runs in)');
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

              // CLIP 3 — skill-agentic: failing clause → Resolve with agent → pending
              // dwell on the (staged) generation → back on the project page with the
              // clause resolved. Runs its own fresh session; cleaned below.
              let clipSid = null;
              await recordClip(browser, watch, 'skill-agentic', `/projects/${PROJECT}`, async (p) => {
                await p.waitForFunction(() => document.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status') === 'ok', null, { timeout: 15000 }).catch(() => {});
                await sleep(1600); // dwell on the failing clause + its agent-tier offer
                await p.locator(resolveBtn).click().catch(() => {});
                await p.waitForURL('**/demo/**', { timeout: 15000 }).catch(() => {});
                clipSid = demoSidFromUrl(p.url());
                await p.waitForSelector('[data-section="session-briefing"]', { timeout: 10000 }).catch(() => {});
                await p.locator('[data-field="briefing-notes"]').fill(AGENTIC_BRIEF).catch(() => {});
                await p.locator('[data-action="submit-brief"]').click().catch(() => {});
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
    ],
  });
