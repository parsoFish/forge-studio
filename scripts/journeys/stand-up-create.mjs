import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  PROJECT, ACT, READ, THINK, caption, FORGE_ROOT, waitForFile, WORK,
  cleanOnboardedProject,
  writeInstrStatus, instrEvent, instrBurst, writeInstrQuestions, writeInstrDraft, cleanInstructionsSession,
  writePbStatus, seedStagedBrain, cleanSeededBrain,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// module-scope cross-beat state for this journey (was hoisted in main()). Both
// are also READ by the runner's finally-block cleanup (cleanInstructionsSession /
// cleanSeededBrain), so each is mirrored onto ctx.seeded at its assignment site.
let instrSid = null;   // instructions-creator session (Part 1)
let pbSid = null;      // project-brain-builder session (Part 1)

/** Parse the real instructions session id out of a /instructions/<sid> URL (null if not there). */
function instrSidFromUrl(url) {
  const m = /\/instructions\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Parse the real project-brain session id out of a /project-brain/<sid> URL (null if not there). */
function pbSidFromUrl(url) {
  const m = /\/project-brain\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

// ── CREATE-NEW HELPERS (module-local) ───────────────────────────────────────
// A brand-new project stood up from absolutely nothing via /projects/new — no
// existing repo, no contract, no brain — on its own slug, distinct from
// stand-up-onboard's onboard-existing slugs so the two journeys never collide
// on disk. Two slugs: the canonical one the beat drives, and a clip-only
// throwaway the isolated clip context creates to prove the path is repeatable.
const CREATE_NAME = 'Journey Fresh Project';
const CREATE_SLUG = 'journey-fresh-project';
const CREATE_NORTH_STAR = 'Prove Studio can stand up a project from absolutely nothing — no repo, no contract, no brain seeded — in one form.';
const CREATE_QUALITY_GATE = 'npm test';
const CREATE_CLIP_NAME = 'Journey Fresh Project Clip';
const CREATE_CLIP_SLUG = `${CREATE_SLUG}-clip`;
const CREATE_CLIP_NORTH_STAR = 'A second from-scratch project, created live in an isolated browser context, to prove the path is real.';

function cleanCreateProjects() {
  cleanOnboardedProject(CREATE_SLUG);
  cleanOnboardedProject(CREATE_CLIP_SLUG);
}

export const journey = defineJourney({
    id: 'stand-up-create',
    title: 'Stand up a project (create new)',
    story: 'As an operator, I stand up a brand-new project from absolutely nothing through Studio\'s onboarding form — the create-new path of the capability diagram — then discover it from the library. AI-assisted instructions- and project-brain-builders seed its AGENTS.md and its seeded-to-grow knowledge base, while the project builder lets me tune north star, demo timeline, and contract readiness.',
    beats: [
      {
        id: 'su-create-project',
        title: 'Create a project from nothing — /projects/new',
        narration: 'The operator stands up a brand-new project from absolutely nothing — no repo, no contract, no brain — filling in a name, a north star, and a quality-gate command; the very same form that onboards an existing repo also creates one from scratch. Since the typed testProcess contract (R1-03), the scaffold declares the gate and preflight reads it — so a from-scratch project is born contract-GREEN on the hard clauses and opens straight into its own page, where the honest remaining gaps (no CI net yet, no instructions file, no demo) show as advisory rows.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check } = ctx;
              // ── A0: CREATE A PROJECT FROM NOTHING (in the UI) ──────────────────────────
              console.log('\n[A0] Create a project from nothing — /projects/new');
              cleanCreateProjects();
              ctx.seeded.createSlugs = [CREATE_SLUG, CREATE_CLIP_SLUG]; // read by the runner's finally-block cleanup

              await page.goto(watch.uiUrl + '/projects/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-section="project-onboard"]') !== null,
                null, { timeout: 15000 },
              ).catch(() => {});
              const formPresent = await page.evaluate(() => document.querySelector('[data-section="project-onboard"]') !== null);
              check(formPresent, 'A0: /projects/new renders the onboarding form (create-new shares the same form as onboard-existing)');
              await frame(page, 'a0-0-create-form', 'A0 — creating a project from nothing: name, north star, quality-gate command');

              await page.locator('[data-field="project-name"]').fill(CREATE_NAME);
              await page.locator('[data-field="quality-gate"]').fill(CREATE_QUALITY_GATE).catch(() => {});
              await page.locator('[data-field="north-star"]').fill(CREATE_NORTH_STAR);
              await page.locator('[data-action="onboard-project"]').click();

              const createJsonPath = join(FORGE_ROOT, 'projects', CREATE_SLUG, '.forge', 'project.json');
              const createLanded = await waitForFile(createJsonPath, 12000);
              check(createLanded, `A0: creating writes projects/${CREATE_SLUG}/.forge/project.json — a project entry now exists where nothing did before`);

              let createCfg = {};
              try { createCfg = JSON.parse(readFileSync(createJsonPath, 'utf8')); } catch { /* */ }
              check(Array.isArray(createCfg.testProcess?.local?.cmd) && createCfg.testProcess.local.cmd.length > 0,
                'A0: project.json carries the typed testProcess.local.cmd contract field (R1-03-F1)');
              check(typeof createCfg.northStar === 'string' && createCfg.northStar.length > 0,
                'A0: project.json carries the north star — real contract items land, not just a bare registry entry');

              // R1-03-F1 changed the from-scratch birth story: the scaffold declares
              // the typed testProcess and preflight now READS it, so C1 is green at
              // birth and the auto-fixes cover C2/C4 — ZERO hard clauses fail and the
              // form navigates straight to the new project's page (the old failing
              // checklist only renders when a hard clause still fails). The REAL
              // remaining gaps are advisory (C1b no CI net, C8 instructions, DEMO)
              // and render on the project page's ContractReadiness instead.
              const landedOnProject = await page.waitForFunction(
                (slug) => document.querySelector('[data-page="projects"]')?.getAttribute('data-project-id') === slug
                  || window.location.pathname.endsWith(`/projects/${slug}`),
                CREATE_SLUG, { timeout: 12000 },
              ).then(() => true).catch(() => false);
              check(landedOnProject, 'A0: a from-scratch project is born contract-green on the hard clauses — the form navigates straight to the project page (R1-03-F1: the declared testProcess closes C1 at birth)');
              if (landedOnProject) {
                const preflightStatus = await page.waitForFunction(
                  () => document.querySelector('[data-preflight-status]')?.getAttribute('data-preflight-status') === 'ok',
                  null, { timeout: 15000 },
                ).then(() => true).catch(() => false);
                check(preflightStatus, 'A0: the real preflight reports ok (no hard failures) on the newborn project');
                await frame(page, 'a0-1-contract-green-birth', 'A0 — a project created from nothing is contract-green at birth; only advisory gaps remain');
              }

              // Clip: a second from-scratch project, created live in its own isolated
              // browser context on its own throwaway slug — proves the create-new path
              // is real and repeatable, not a one-off fixture. Starts at the LIBRARY,
              // the real user-facing entry point, not the /projects/new URL directly.
              await recordClip(browser, watch, 'project-create', '/', async (p) => {
                await p.waitForFunction(() => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 12000 }).catch(() => {});
                await sleep(1400); // dwell — the library's "+ New Project" CTA
                await p.locator('[data-action="new-project"]').click().catch(() => {});
                await p.waitForURL('**/projects/new', { timeout: 10000 }).catch(() => {});
                await p.waitForSelector('[data-section="project-onboard"]', { timeout: 10000 }).catch(() => {});
                await p.locator('[data-field="project-name"]').fill(CREATE_CLIP_NAME).catch(() => {});
                await p.locator('[data-field="quality-gate"]').fill(CREATE_QUALITY_GATE).catch(() => {});
                await p.locator('[data-field="north-star"]').fill(CREATE_CLIP_NORTH_STAR).catch(() => {});
                await p.locator('[data-action="onboard-project"]').click().catch(() => {});
                // Contract-green birth (R1-03-F1): the form navigates to the new
                // project's page rather than parking on a failing checklist.
                await p.waitForFunction(
                  () => document.querySelector('[data-page="projects"]') !== null,
                  null, { timeout: 12000 },
                ).catch(() => {});
                await sleep(WORK);
              }, { readySel: 'main[data-page="library"]', caption: 'From the library\'s "+ New Project" CTA — a second project created from nothing, live, born contract-green' });

              // Already on the real project page (contract-green birth navigated
              // there); a direct navigate below is the crash-safe fallback.
              await page.waitForURL(new RegExp(`/projects/${CREATE_SLUG}`), { timeout: 10000 }).catch(() => {});
              if (!new RegExp(`/projects/${CREATE_SLUG}`).test(page.url())) {
                await page.goto(watch.uiUrl + `/projects/${CREATE_SLUG}`, { waitUntil: 'domcontentloaded' });
              }
              await page.waitForFunction(
                () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 },
              ).catch(() => {});
              await page.waitForSelector('[data-ready-count]', { timeout: 15000 }).catch(() => {});
              const readyCount = await page.evaluate(() => {
                const el = document.querySelector('[data-ready-count]');
                return el ? parseInt(el.getAttribute('data-ready-count') ?? '0', 10) : -1;
              });
              check(readyCount >= 3, `A0: the from-scratch project's own page renders the readiness checklist (got ${readyCount} passing checks)`);
              await frame(page, 'a0-2-project-page', 'A0 — the from-scratch project\'s own page: readiness checklist, north star, contract fields all real');

              // Clean up BOTH slugs (canonical + clip) in this beat's own tail — runner-safe
              // even if a later beat throws, since nothing downstream depends on this project.
              cleanCreateProjects();

        },
      },
      {
        id: 'su-create-library',
        title: 'Library — everything is data',
        narration: 'With a brand-new project just stood up from nothing, the library renders flows, agents, projects, and knowledge bases side by side as data cards, plus an operator-pulse panel — including the OOTB flows (forge-develop is the one the operator rebuilds from scratch, live, later in this walkthrough).',
        drive: async (ctx) => {
              const { page, watch, check, countAtLeast } = ctx;
              // ════════════════════════════════════════════════════════════════════════
              // ACT 1 — AUTHOR. Everything in Studio is data you can edit.
              // ════════════════════════════════════════════════════════════════════════

              // ── A1.0: the library reports ready before anything else loads ────────────
              console.log('\n[A1.0] Library ready');
              await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 30000 },
                );
                check(true, 'library: [data-page="library"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') ?? '(no data-page=library)');
                check(false, `library: data-page-ready (got "${pr}")`);
              }
              // ── A1.1: Library — flows / agents / projects / KBs as data ───────────────
              console.log('\n[A1.1] Library — everything is data');
              await caption(page, 'Flows, agents, projects, and knowledge — one screen, all editable definitions.');
              await sleep(ACT);
              await countAtLeast(page, '[data-section="flows"]', 1, 'library: [data-section="flows"] present');
              await countAtLeast(page, '[data-section="agents"]', 1, 'library: [data-section="agents"] present');
              await countAtLeast(page, '[data-section="projects"]', 1, 'library: [data-section="projects"] present');
              await countAtLeast(page, '[data-section="kbs"]', 1, 'library: [data-section="kbs"] present');
              const pulsePresent = await page.evaluate(() => document.querySelector('[data-pulse-flows]') !== null);
              check(pulsePresent, 'library: operator pulse panel ([data-pulse-flows]) present');
              await countAtLeast(page, '[data-section="flows"] [data-card-type="flow"]', 1, 'library: ≥1 flow card in flows section');
              await countAtLeast(page, '[data-section="agents"] [data-card-type="agent"]', 1, 'library: ≥1 agent card in agents section');
              await countAtLeast(page, '[data-section="projects"] [data-card-type="project"]', 1, 'library: ≥1 project card in projects section');
              await countAtLeast(page, '[data-section="kbs"] [data-card-type="kb"]', 1, 'library: ≥1 kb card in kbs section');
              const sectionCounts = await page.evaluate(() => {
                const sections = ['flows', 'agents', 'projects', 'kbs'];
                return Object.fromEntries(sections.map((s) => [
                  s, parseInt(document.querySelector(`[data-section="${s}"]`)?.getAttribute('data-count') ?? '0', 10),
                ]));
              });
              check(sectionCounts.flows >= 1, `library: flows section data-count ≥1 (got ${sectionCounts.flows})`);
              check(sectionCounts.agents >= 1, `library: agents section data-count ≥1 (got ${sectionCounts.agents})`);
              check(sectionCounts.projects >= 1, `library: projects section data-count ≥1 (got ${sectionCounts.projects})`);
              check(sectionCounts.kbs >= 1, `library: kbs section data-count ≥1 (got ${sectionCounts.kbs})`);
              // The OOTB flows render as real cards (data, not a hardcoded list) — this
              // is the "everything is data" claim, honestly scoped to what's on disk at
              // this point in the run (the from-scratch flow is authored live in the
              // BUILD tab later, in flows-author — it doesn't exist yet here).
              const ootbFlowIds = ['forge-architect', 'forge-develop', 'forge-reflect'];
              const ootbCardsPresent = await page.evaluate((ids) =>
                ids.every((id) =>
                  document.querySelector(`[data-card-type="flow"][data-card-id="${id}"]`) !== null ||
                  [...document.querySelectorAll('[data-card-type="flow"]')].some((el) => (el.getAttribute('href') ?? '').includes(id))),
                ootbFlowIds);
              check(ootbCardsPresent, `library: the OOTB flows (${ootbFlowIds.join(', ')}) render as cards (registered as data)`);
              // ── A1.2: cross-project attention strip (R4-11-F4) ────────────────────────
              // mdtoc is a standing, always-registered fixture (checked into the repo,
              // not created/cleaned by any beat) so the strip always has ≥1 item here.
              await countAtLeast(page, '[data-section="attention-strip"]', 1, 'library: [data-section="attention-strip"] present');
              await countAtLeast(page, '[data-attention-item]', 1, 'library: ≥1 [data-attention-item] in the attention strip');
              const attentionLink = await page.evaluate(() =>
                document.querySelector('[data-attention-item]')?.getAttribute('href') ?? '');
              check(/^\/projects\/[^/]+$/.test(attentionLink),
                `library: attention item links through to its owning project surface (got "${attentionLink}")`);

        },
      },
      {
        id: 'su-create-orientation',
        title: 'First-run orientation + discoverable creation',
        narration: 'Creating from nothing didn\'t require a URL only a developer would know — the library\'s "+ New Agent" CTA proves creating something new is always one click away, and with the library already populated the first-run welcome panel correctly stays hidden.',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              // ── J1: first-run orientation + discoverable creation ─────────────────────
              // Creation must be discoverable from the library (not URL-only): the
              // "+ New Agent" CTA is a real, enabled link to the builder.
              const newAgentCta = await page.evaluate(() => {
                const el = document.querySelector('[data-action="new-agent"]');
                if (!el) return { present: false };
                return {
                  present: true,
                  disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
                  href: el.getAttribute('href') ?? '',
                  tag: el.tagName.toLowerCase(),
                };
              });
              check(newAgentCta.present, 'J1: library "+ New Agent" creation CTA ([data-action="new-agent"]) is present');
              check(newAgentCta.present && !newAgentCta.disabled, 'J1: "+ New Agent" CTA is enabled (creation is discoverable, not a dead greyed button)');
              check(newAgentCta.href?.includes('/agents/new'), `J1: "+ New Agent" routes to the agent builder (got "${newAgentCta.href}")`);
              // No false welcome: with a populated library the orientation panel is absent
              // and data-first-run reflects it.
              const firstRunAttr = await page.evaluate(() =>
                document.querySelector('[data-page="library"]')?.getAttribute('data-first-run'));
              check(firstRunAttr === 'false', `J1: populated library reports data-first-run="false" (got "${firstRunAttr}")`);
              const orientationAbsent = await page.evaluate(() => document.querySelector('[data-section="orientation"]') === null);
              check(orientationAbsent, 'J1: orientation panel correctly hidden when the library is populated (shown only on a fresh install)');

              await sleep(READ);
              await frame(page, 'a1-1-library', 'A1 — Studio library: flows/agents/projects/KBs as data + operator pulse');

        },
      },
      {
        id: 'su-create-instructions',
        title: 'instructions-creator — generate AGENTS.md (AI-assisted)',
        narration: 'The operator launches the instructions-creator agent, answers its two clarifying questions, and approves the AGENTS.md it drafts — a new project gets its onboarding contract written for it, with a human still signing off.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check, countAtLeast } = ctx;
              // ════════════════════════════════════════════════════════════════════════
              // PART 1 — STAND UP (AI-assisted generation). The project's AGENTS.md and its
              // seed brain, generated WITH AI ASSISTANCE, plus aligning an existing repo to
              // the contract. No live LLM: seed the session files the runner would write
              // (same FORGE_ARCHITECT_NO_SPAWN seam as the architect) + drive the real UI.
              // ════════════════════════════════════════════════════════════════════════

              // ── AI-1: instructions-creator generates AGENTS.md ────────────────────────
              console.log('\n[AI-1] instructions-creator — generate AGENTS.md (AI-assisted)');
              await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              console.log(`  [AI-1] launcher present: ${await page.locator('[data-action="launch-instructions"]').count() > 0}`);
              // Seed a briefing session on disk + drive the dedicated screen (architect pattern).
              instrSid = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-instr';
              ctx.seeded.instrSid = instrSid; // read by the runner's finally-block cleanup
              writeInstrStatus(instrSid, { phase: 'briefing', round: 1 });
              await page.goto(watch.uiUrl + `/instructions/${encodeURIComponent(instrSid)}`, { waitUntil: 'domcontentloaded' });
              const instrReady = await page.waitForSelector('main[data-page="instructions-interview"]', { timeout: 20000 }).then(() => true).catch(() => false);
              check(instrReady, 'AI-1: instructions screen renders ([data-page="instructions-interview"])');
              await caption(page, 'Forge generates AGENTS.md with you — interview → draft → approve. AI-assisted, and gated.');
              // interviewing — activity bursts + clarifying questions
              writeInstrStatus(instrSid, { phase: 'interviewing', round: 1 });
              instrEvent(instrSid, 'start', 'instructions turn (phase=interviewing, round=1)');
              await instrBurst(instrSid, ['Glob', 'Read', 'Grep', 'Bash']);
              writeInstrQuestions(instrSid);
              writeInstrStatus(instrSid, { phase: 'awaiting-answers', round: 1 });
              await page.waitForSelector('[data-section="instructions-interview"]', { timeout: 15000 }).catch(() => {});
              check(await page.locator('[data-section="instructions-interview"]').count() > 0, 'AI-1: interview returns clarifying questions');
              await countAtLeast(page, '[data-question-index]', 2, 'AI-1: ≥2 instructions questions');
              await frame(page, 'instr-0-interview', 'Part 1 — instructions-creator interviews before writing AGENTS.md (AI-assisted)');
              // answer → draft → verdict
              await page.locator('[data-question-index="0"] input[type="radio"]').first().check().catch(() => {});
              await page.locator('[data-question-index="1"] input[type="radio"]').first().check().catch(() => {});
              await page.locator('[data-action="submit-answers"]').click().catch(() => {});
              await sleep(ACT);
              writeInstrStatus(instrSid, { phase: 'drafting', round: 2 });
              instrEvent(instrSid, 'start', 'instructions turn (phase=drafting) — rolling in answers');
              await instrBurst(instrSid, ['Read', 'Write']);
              writeInstrDraft(instrSid);
              writeInstrStatus(instrSid, { phase: 'awaiting-verdict', round: 2 });
              await page.waitForSelector('[data-component="instructions-verdict"]', { timeout: 15000 }).catch(() => {});
              check(await page.locator('[data-component="instructions-verdict"]').count() > 0, 'AI-1: drafted AGENTS.md awaits the operator verdict');
              await frame(page, 'instr-1-draft', 'Part 1 — the generated AGENTS.md draft, awaiting approval');
              // Clip: the operator's END-TO-END trigger — dwell on the project page's
              // real "Generate AGENTS.md with the instructions agent" button, CLICK it
              // (the bridge opens a genuine session, no spawn — same no-spawn seam as
              // everywhere else), then adopt THAT session id for the staged generation
              // progression — briefing → interviewing → drafting → awaiting-verdict —
              // so the clip shows generation actually happening rather than a single
              // static hold on the finished draft. Falls back to an honest brief pause
              // onto a clip-only session only if the real trigger doesn't land.
              let instrClipSid = null;
              await recordClip(browser, watch, 'instr-generate', `/projects/${PROJECT}`, async (p) => {
                await p.waitForFunction(() => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 12000 }).catch(() => {});
                await sleep(1400); // dwell — the real "Generate AGENTS.md with the instructions agent" button
                await p.locator('[data-action="launch-instructions"]').click().catch(() => {});
                await p.waitForURL(/\/instructions\//, { timeout: 10000 }).catch(() => {});
                instrClipSid = instrSidFromUrl(p.url());
                if (instrClipSid) {
                  // The real button: a genuine bridge session at 'briefing' — brief it
                  // for real too (the flip to 'interviewing' is real; the spawn is not).
                  await p.waitForSelector('[data-section="session-briefing"]', { timeout: 10000 }).catch(() => {});
                  await p.locator('[data-field="briefing-notes"]').fill('Keep it short; document the build + test gate.').catch(() => {});
                  await p.locator('[data-action="submit-brief"]').click().catch(() => {});
                } else {
                  // Fallback — the real trigger didn't land this run; an honest brief
                  // pause onto a clip-only session rather than a silent jump-cut.
                  instrClipSid = `${instrSid}-clip`;
                  writeInstrStatus(instrClipSid, { phase: 'briefing', round: 1 });
                  await sleep(THINK);
                  await p.goto(watch.uiUrl + `/instructions/${encodeURIComponent(instrClipSid)}`, { waitUntil: 'domcontentloaded' });
                }
                await p.waitForSelector('main[data-page="instructions-interview"]', { timeout: 12000 }).catch(() => {});
                await sleep(WORK);
                writeInstrStatus(instrClipSid, { phase: 'interviewing', round: 1 });
                instrEvent(instrClipSid, 'start', 'instructions turn (phase=interviewing, round=1)');
                await instrBurst(instrClipSid, ['Glob', 'Read']);
                await p.waitForFunction(
                  () => document.querySelector('main[data-page="instructions-interview"]')?.getAttribute('data-instructions-phase') === 'interviewing',
                  null, { timeout: 10000 },
                ).catch(() => {});
                await sleep(WORK);
                writeInstrStatus(instrClipSid, { phase: 'drafting', round: 2 });
                instrEvent(instrClipSid, 'start', 'instructions turn (phase=drafting) — rolling in answers');
                await instrBurst(instrClipSid, ['Read', 'Write']);
                await p.waitForFunction(
                  () => document.querySelector('main[data-page="instructions-interview"]')?.getAttribute('data-instructions-phase') === 'drafting',
                  null, { timeout: 10000 },
                ).catch(() => {});
                await sleep(WORK);
                writeInstrDraft(instrClipSid);
                writeInstrStatus(instrClipSid, { phase: 'awaiting-verdict', round: 2 });
                await p.waitForSelector('[data-component="instructions-verdict"]', { timeout: 12000 }).catch(() => {});
                await sleep(WORK);
              }, { readySel: 'main[data-page="projects"]', caption: 'clicking "Generate AGENTS.md with the instructions agent" on the project page — briefing → interviewing → drafting → the generated draft' });
              if (instrClipSid) cleanInstructionsSession(instrClipSid);
              // approve → committed
              await page.locator('[data-component="instructions-verdict"] [data-action="approve-instructions"]').click().catch(() => {});
              await page.waitForSelector('[data-component="instructions-verdict"][data-form-state="submitted"]', { timeout: 10000 }).catch(() => {});
              writeInstrStatus(instrSid, { phase: 'committed', round: 2 });
              instrEvent(instrSid, 'log', 'instructions-committed (AGENTS.md written)');
              await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
              await page.waitForSelector('main[data-page="instructions-interview"]', { timeout: 10000 }).catch(() => {});
              await page.waitForSelector('[data-action="back-to-project"]', { timeout: 8000 }).catch(() => {});
              check(await page.locator('[data-action="back-to-project"]').count() > 0, 'AI-1: AGENTS.md committed — back-to-project offered');
              await frame(page, 'instr-2-committed', 'Part 1 — AGENTS.md generated + approved (AI-assisted)');

        },
      },
      {
        id: 'su-create-project-brain',
        title: 'project-brain-builder — seed the project brain (AI-assisted)',
        narration: 'The project-brain-builder analyses the new project and stages three seed themes for review; approving commits nothing but a pointer — the project\'s own knowledge base starts here and grows as cycles run.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check, countAtLeast } = ctx;
              // ── AI-2: project-brain-builder seeds the project brain ───────────────────
              console.log('\n[AI-2] project-brain-builder — seed the project brain (AI-assisted)');
              pbSid = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-pbrain';
              ctx.seeded.pbSid = pbSid; // read by the runner's finally-block cleanup
              writePbStatus(pbSid, 'briefing', '');
              await page.goto(watch.uiUrl + `/project-brain/${encodeURIComponent(pbSid)}?project=${encodeURIComponent(PROJECT)}`, { waitUntil: 'domcontentloaded' });
              const pbReady = await page.waitForSelector('main[data-page="project-brain"]', { timeout: 20000 }).then(() => true).catch(() => false);
              check(pbReady, 'AI-2: project-brain screen renders ([data-page="project-brain"])');
              await caption(page, 'Forge reads the project and drafts its seed brain — the themes a planner reads before designing.');
              // briefing → analyzing → (seed themes) → awaiting-review
              writePbStatus(pbSid, 'analyzing', 'emphasise conventions + module layout');
              await frame(page, 'pbrain-0-analyzing', 'Part 1 — project-brain-builder analyses the project (AI-assisted)');
              seedStagedBrain(pbSid);
              await page.waitForSelector('main[data-project-brain-phase="awaiting-review"]', { timeout: 10000 }).catch(() => {});
              check(await page.locator('[data-section="brain-review"]').count() > 0, 'AI-2: staged themes presented for review');
              await countAtLeast(page, '[data-theme-name]', 3, 'AI-2: ≥3 seed themes drafted');
              await frame(page, 'pbrain-1-review', 'Part 1 — the generated seed brain: themes to review + approve');
              // Clip: the operator's END-TO-END trigger — dwell on the project page's
              // real "Build project brain with the agent" button (Knowledge Base panel),
              // CLICK it, and adopt THAT session id for the staged generation
              // progression — briefing → analyzing → awaiting-review. mdtoc's fixture
              // ships with a KB already bound (a project carries a single brain), so the
              // button is genuinely hidden on a checkout at rest — the fallback covers
              // that honestly, with a brief pause rather than a silent jump-cut; the
              // real-button path stays preferred and self-heals if the button reappears.
              let pbClipSid = null;
              await recordClip(browser, watch, 'pbrain-generate', `/projects/${PROJECT}`, async (p) => {
                await p.waitForFunction(() => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 12000 }).catch(() => {});
                const buildBtn = p.locator('[data-action="create-project-brain"]');
                const brainBtnVisible = await buildBtn.count() > 0;
                await sleep(1400); // dwell — the "Build project brain with the agent" button
                if (brainBtnVisible) {
                  await buildBtn.click().catch(() => {});
                  await p.waitForURL(/\/project-brain\//, { timeout: 10000 }).catch(() => {});
                  pbClipSid = pbSidFromUrl(p.url());
                  if (pbClipSid) {
                    // The real button: a genuine bridge session at 'briefing' — brief it
                    // for real too (the flip to 'analyzing' is real; the spawn is not).
                    await p.waitForSelector('[data-section="brain-briefing"]', { timeout: 10000 }).catch(() => {});
                    await p.locator('[data-component="brain-brief-input"]').fill('emphasise conventions + module layout').catch(() => {});
                    await p.locator('[data-action="start-brain-analysis"]').click().catch(() => {});
                  }
                }
                if (!pbClipSid) {
                  // Fallback — the real trigger didn't land this run; an honest brief
                  // pause onto a clip-only session rather than a silent jump-cut.
                  pbClipSid = `${pbSid}-clip`;
                  writePbStatus(pbClipSid, 'briefing', '');
                  await sleep(THINK);
                  await p.goto(watch.uiUrl + `/project-brain/${encodeURIComponent(pbClipSid)}?project=${encodeURIComponent(PROJECT)}`, { waitUntil: 'domcontentloaded' });
                }
                await p.waitForSelector('main[data-page="project-brain"]', { timeout: 12000 }).catch(() => {});
                await sleep(WORK);
                writePbStatus(pbClipSid, 'analyzing', 'emphasise conventions + module layout');
                await p.waitForFunction(
                  () => document.querySelector('main[data-page="project-brain"]')?.getAttribute('data-project-brain-phase') === 'analyzing',
                  null, { timeout: 10000 },
                ).catch(() => {});
                await sleep(WORK);
                seedStagedBrain(pbClipSid);
                await p.waitForSelector('main[data-project-brain-phase="awaiting-review"]', { timeout: 12000 }).catch(() => {});
                await sleep(WORK);
              }, { readySel: 'main[data-page="projects"]', caption: 'the project page\'s "Build project brain with the agent" — briefing → analyzing → the generated seed themes, awaiting review' });
              if (pbClipSid) cleanSeededBrain(pbClipSid);
              // approve → committing → committed (flip-only; nothing written under brain/)
              await page.locator('[data-action="approve-brain"]').click().catch(() => {});
              await page.waitForSelector('main[data-project-brain-phase="committing"]', { timeout: 8000 }).catch(() => {});
              writePbStatus(pbSid, 'committed', '');
              await page.waitForSelector('[data-section="brain-committed"]', { timeout: 8000 }).catch(() => {});
              check(await page.locator('[data-action="bind-and-return"]').count() > 0, 'AI-2: seed brain committed — bind-and-return offered');
              await frame(page, 'pbrain-2-committed', 'Part 1 — project brain seeded (grows with the project)');

        },
      },
      {
        id: 'su-create-project-builder',
        title: `Project builder — tune an existing project (/projects/${PROJECT})`,
        narration: `Contrast with the from-scratch project above: ${PROJECT} already has real content, so its project builder shows the same north star, demo timeline, and contract-readiness surfaces already populated and tuneable at a glance; adding a demo step live-flips the dirty flag, proving nothing here is a static page.`,
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── A4: Project builder — the managed project as data ─────────────────────
              console.log(`\n[A4] Project builder — /projects/${PROJECT}`);
              await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
              let projectPageReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 25000 },
                );
                projectPageReady = true;
                check(true, 'project-builder: [data-page="projects"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') ?? '(no data-page=projects)');
                check(false, `project-builder: data-page-ready (got "${pr}")`);
              }
              await caption(page, 'The mdtoc project — north star, the creds-free demo timeline (capture → verify → present), skills, KB, contract readiness.');
              await sleep(ACT);
              if (projectPageReady) {
                const projectId = await page.evaluate(() =>
                  document.querySelector('[data-project-id]')?.getAttribute('data-project-id') ?? '');
                check(projectId === PROJECT, `project-builder: data-project-id="${PROJECT}" (got "${projectId}")`);
                check(
                  await page.evaluate(() => document.querySelector('[data-component="north-star"]') !== null ||
                    document.querySelectorAll('textarea').length > 0 ||
                    document.querySelector('[placeholder*="north star" i]') !== null ||
                    document.querySelector('[placeholder*="goal" i]') !== null ||
                    document.querySelector('[placeholder*="outcome" i]') !== null),
                  'project-builder: north star field present',
                );
                const stepCount = await page.evaluate(() => {
                  const el = document.querySelector('[data-step-count]');
                  return el ? el.getAttribute('data-step-count') : null;
                });
                check(stepCount !== null, `project-builder: [data-step-count] attribute present (got ${stepCount})`);
                const contractReadyCount = await page.evaluate(() => {
                  const el = document.querySelector('[data-ready-count]');
                  return el ? el.getAttribute('data-ready-count') : null;
                });
                check(contractReadyCount !== null, `project-builder: [data-ready-count] attribute present (got ${contractReadyCount})`);
                const flowReady = await page.evaluate(() => {
                  const el = document.querySelector('[data-flow-ready]');
                  return el ? el.getAttribute('data-flow-ready') : null;
                });
                check(flowReady !== null, `project-builder: [data-flow-ready] attribute present (got "${flowReady}")`);
                // Stage A/B backfill — the agentic instruction + demo launchers are present.
                check(
                  await page.evaluate(() => document.querySelector('[data-action="launch-instructions"]') !== null),
                  'project-builder: instructions agent launcher present (Stage A)',
                );
                check(
                  await page.evaluate(() => document.querySelector('[data-action="launch-demo-builder"]') !== null),
                  'project-builder: demo agent launcher present (Stage B)',
                );
                // Stage D — contract resolution is wired: the panel renders when clauses
                // fail, and is correctly absent when the project is fully contract-ready.
                const resolutionWired = await page.evaluate(() => {
                  const panel = document.querySelector('[data-section="contract-resolution"]');
                  const ready = document.querySelector('[data-flow-ready]')?.getAttribute('data-flow-ready');
                  return panel !== null || ready === 'true';
                });
                check(resolutionWired, 'project-builder: contract-resolution panel wired (present on gaps, absent when ready)');
                await frame(page, 'a4-0-project-builder', 'A4 — project builder: north star, demo timeline, skills, contract readiness');
                // Add a demo step → data-step-count increments + dirty flips; discard.
                const presetBtn = page.locator('button').filter({ hasText: /^\+ Add step$/ }).first();
                if ((await presetBtn.count()) > 0) {
                  const before = parseInt(stepCount ?? '0', 10);
                  await presetBtn.click();
                  await sleep(THINK);
                  const after = await page.evaluate(() => {
                    const el = document.querySelector('[data-step-count]');
                    return el ? parseInt(el.getAttribute('data-step-count') ?? '0', 10) : 0;
                  });
                  check(after > before, `project-builder: data-step-count incremented after preset click (${before}→${after})`);
                  const dirtyAfter = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
                  check(dirtyAfter === 'true', `project-builder: data-dirty="true" after adding demo step (got "${dirtyAfter}")`);
                  await frame(page, 'a4-1-project-dirty', `A4 — data-step-count incremented (${before}→${after}), data-dirty="true" (no save)`);
                } else {
                  check(false, 'project-builder: preset/add-step button present (soft — builder loaded)');
                }
              } else {
                check(false, 'project-builder: page did not become ready — project-builder checks skipped');
              }

        },
      },
    ],
  });
