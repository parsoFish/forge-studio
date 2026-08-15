import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  PROJECT, DATE, ACT, READ, THINK, caption, FORGE_ROOT, waitForFile, WORK,
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

/** Parse the real instructions session id out of a /sessions/instructions/<sid>
 *  URL (null if not there). The substring match is deliberately loose — it
 *  matches the retired /instructions/<sid> URL too (still a live redirect
 *  stub) — so this stays correct across both without needing to change. */
function instrSidFromUrl(url) {
  const m = /\/instructions\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Parse the real project-brain session id out of a /sessions/project-brain/<sid>
 *  URL (null if not there). Same loose substring match as instrSidFromUrl —
 *  correct against both the canonical route and the retired redirect stub. */
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

// R4-03: a greenfield project created from a framework TEMPLATE (distinct from
// the onboard-form create above), on its own slug.
const TEMPLATE_NAME = 'Journey Template Project';
const TEMPLATE_SLUG = 'journey-template-project';
const TEMPLATE_NORTH_STAR = 'Prove Studio scaffolds a greenfield project from a curated framework template, contract-green.';

function cleanCreateProjects() {
  cleanOnboardedProject(CREATE_SLUG);
  cleanOnboardedProject(CREATE_CLIP_SLUG);
  cleanOnboardedProject(TEMPLATE_SLUG);
}

// ── R4-12-F2 LEDGER-NAV SEED (module-local) ─────────────────────────────────
// A THROWAWAY completed cycle for the permanent cycle-ledger dig-in proof
// (AT-F2-4). It carries its OWN distinct init id — NEVER the canonical CYCLE_ID
// the flows-run journey owns (which is not seeded until much later in RUN_ORDER,
// so mdtoc's ledger is genuinely empty at this beat) — so seeding it never
// mutates canonical state (state-ownership rule). It mirrors the EXACT on-disk
// shape a real archived, merged cycle carries — the positive-control shape in
// cli/bridge-studio-flow-run-detail.test.ts: a `_queue/done/<init>.md` manifest
// (project: mdtoc, flow_id: forge-develop, cycle_id) + a `_logs/<cycleId>/
// events.jsonl` (cycle.start → cycle.end complete) — so the REAL scanCycles →
// deriveProjectCycleLedgerRows → HistoryLedger path renders a REAL, clickable row
// (never a fabricated one) that resolves as `found` on the shared run-detail
// surface. Both `_queue/` and `_logs/` are gitignored, so it never dirties git;
// the beat sweeps it in its own finally (crash-safe — a stray manifest would
// otherwise trip the next run's daemon guard).
const LEDGER_INIT = `INIT-${DATE}-r4-12-ledger-nav`;
const LEDGER_CYCLE_ID = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}Z_${LEDGER_INIT}`;
const LEDGER_LOG_DIR = join(FORGE_ROOT, '_logs', LEDGER_CYCLE_ID);
const LEDGER_MANIFEST = join(FORGE_ROOT, '_queue', 'done', `${LEDGER_INIT}.md`);

function seedLedgerCycle() {
  mkdirSync(LEDGER_LOG_DIR, { recursive: true });
  const base = { cycle_id: LEDGER_CYCLE_ID, initiative_id: LEDGER_INIT, input_refs: [], output_refs: [] };
  const now = new Date().toISOString();
  const events = [
    { ...base, event_id: 'EV_lnav_1', phase: 'orchestrator', skill: 'cycle', event_type: 'start', started_at: now, message: 'cycle.start', metadata: { origin: 'architect' } },
    { ...base, event_id: 'EV_lnav_2', phase: 'developer-loop', skill: 'developer-loop', event_type: 'start', started_at: now },
    { ...base, event_id: 'EV_lnav_3', phase: 'developer-loop', skill: 'developer-loop', event_type: 'end', started_at: now, metadata: { cost_usd: 1.0 } },
    { ...base, event_id: 'EV_lnav_4', phase: 'orchestrator', skill: 'cycle', event_type: 'end', started_at: now, message: 'cycle.end', metadata: { status: 'complete' } },
  ];
  writeFileSync(join(LEDGER_LOG_DIR, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  mkdirSync(join(FORGE_ROOT, '_queue', 'done'), { recursive: true });
  writeFileSync(LEDGER_MANIFEST, [
    '---',
    `initiative_id: ${LEDGER_INIT}`,
    `project: ${PROJECT}`,
    `project_repo_path: ${join(FORGE_ROOT, 'projects', PROJECT)}`,
    'origin: architect',
    `created_at: '${now}'`,
    'iteration_budget: 5',
    'cost_budget_usd: 2',
    `cycle_id: ${LEDGER_CYCLE_ID}`,
    'flow_id: forge-develop',
    'phase: done',
    '---',
    '',
    `# ${LEDGER_INIT} — throwaway completed cycle seeded for the R4-12-F2 ledger→run-detail nav proof.`,
    '',
  ].join('\n'));
}

function cleanLedgerCycle() {
  try { rmSync(LEDGER_LOG_DIR, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(LEDGER_MANIFEST, { force: true }); } catch { /* */ }
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

              // Hydration-robust fill: /projects/new ships data-page-ready static,
              // so a plain .fill() can land before React wires the inputs — leaving
              // canSubmit false and the Onboard button disabled (the same pattern the
              // skills builder beat guards against). Settle, fill, and re-fill once if
              // the submit hasn't enabled.
              const fillCreateForm = async () => {
                await page.locator('[data-field="project-name"]').fill(CREATE_NAME);
                await page.locator('[data-field="quality-gate"]').fill(CREATE_QUALITY_GATE).catch(() => {});
                await page.locator('[data-field="north-star"]').fill(CREATE_NORTH_STAR);
              };
              await page.waitForSelector('[data-field="project-name"]', { timeout: 10000 }).catch(() => {});
              await sleep(600); // let the onboard form hydrate before typing
              await fillCreateForm();
              const createEnabled = () => page.waitForFunction(() => {
                const b = document.querySelector('[data-action="onboard-project"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: 6000 }).then(() => true).catch(() => false);
              if (!(await createEnabled())) { await fillCreateForm(); await createEnabled(); }
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
              // is real and repeatable, not a one-off fixture. Starts at the PROJECTS
              // INDEX, the real user-facing entry point (W6-IA-4: was the library
              // "+ New Project" shelf CTA — Library dropped its projects/agents/flows/kb
              // shelves down to shelves-only: skills/hooks/connections/templates/
              // community), not the /projects/new URL directly.
              await recordClip(browser, watch, 'project-create', '/projects', async (p) => {
                await p.waitForFunction(() => document.querySelector('[data-page="projects-index"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 12000 }).catch(() => {});
                await sleep(1400); // dwell — the projects index's "Onboard a project" CTA
                await p.locator('[data-action="onboard-project-cta"]').click().catch(() => {});
                await p.waitForURL('**/projects/new', { timeout: 10000 }).catch(() => {});
                await p.waitForSelector('[data-section="project-onboard"]', { timeout: 10000 }).catch(() => {});
                await sleep(500); // hydrate the onboard form before typing
                const fillClip = async () => {
                  await p.locator('[data-field="project-name"]').fill(CREATE_CLIP_NAME).catch(() => {});
                  await p.locator('[data-field="quality-gate"]').fill(CREATE_QUALITY_GATE).catch(() => {});
                  await p.locator('[data-field="north-star"]').fill(CREATE_CLIP_NORTH_STAR).catch(() => {});
                };
                await fillClip();
                const clipEnabled = await p.waitForFunction(() => {
                  const b = document.querySelector('[data-action="onboard-project"]');
                  return b !== null && !b.hasAttribute('disabled');
                }, null, { timeout: 5000 }).then(() => true).catch(() => false);
                if (!clipEnabled) await fillClip();
                await p.locator('[data-action="onboard-project"]').click().catch(() => {});
                // Contract-green birth (R1-03-F1): the form navigates to the new
                // project's page rather than parking on a failing checklist.
                await p.waitForFunction(
                  () => document.querySelector('[data-page="projects"]') !== null,
                  null, { timeout: 12000 },
                ).catch(() => {});
                await sleep(WORK);
              }, { readySel: 'main[data-page="projects-index"]', caption: 'From the projects index\'s "Onboard a project" CTA — a second project created from nothing, live, born contract-green' });

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
        id: 'su-create-from-template',
        title: 'Create a greenfield project from a framework template — /projects/new',
        narration: 'Beyond onboarding an existing repo, the operator stands up a brand-new project from a curated framework template (R4-03): a name, a north star, and an app type (typescript-cli / typescript-api). Studio scaffolds the whole skeleton — package.json with a real quality gate, a unit test, .gitignore, an AGENTS.md that names the gate, roadmap, CI — seeds the central brain, and lands on the project page contract-green, ready for the first architect run. No manual repo surgery.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R4-03] Create a greenfield project from a template');
              cleanOnboardedProject(TEMPLATE_SLUG);
              await page.goto(watch.uiUrl + '/projects/new', { waitUntil: 'domcontentloaded' });
              await page.waitForSelector('[data-section="project-create"]', { timeout: 15000 }).catch(() => {});
              const createPresent = await page.evaluate(() => document.querySelector('[data-section="project-create"]') !== null);
              check(createPresent, 'R4-03: /projects/new offers a greenfield create-from-template form ([data-section="project-create"])');
              // Wait for the async app-types fetch to land before reading the count
              // / selecting — otherwise the assertions race the fetch.
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-section="project-create"]')?.getAttribute('data-app-type-count') ?? '0', 10) >= 2,
                null, { timeout: 15000 },
              ).catch(() => {});
              const appTypeCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-section="project-create"]')?.getAttribute('data-app-type-count') ?? '0', 10));
              check(appTypeCount >= 2, `R4-03: the create form offers ≥2 curated app-type templates (got ${appTypeCount})`);
              await page.locator('[data-field="create-name"]').fill(TEMPLATE_NAME).catch(() => {});
              await page.locator('[data-field="create-north-star"]').fill(TEMPLATE_NORTH_STAR).catch(() => {});
              await page.locator('[data-field="create-app-type"]').selectOption('typescript-cli').catch(() => {});
              await frame(page, 'r4-03-0-create-form', 'R4-03 — create a greenfield project: name, north star, framework template');
              await page.locator('[data-action="create-project"]').click().catch(() => {});
              await page.waitForURL(new RegExp(`/projects/${TEMPLATE_SLUG}`), { timeout: 20000 }).catch(() => {});
              check(/\/projects\/[^/]*journey-template-project/.test(page.url()),
                `R4-03: creating from a template lands on the new project page (url=${page.url()})`);
              const projectJson = join(FORGE_ROOT, 'projects', TEMPLATE_SLUG, '.forge', 'project.json');
              check(await waitForFile(projectJson, 12000), `R4-03: the template scaffold wrote projects/${TEMPLATE_SLUG}/.forge/project.json`);
              await page.waitForFunction(
                () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 },
              ).catch(() => {});
              await page.waitForSelector('[data-ready-count]', { timeout: 15000 }).catch(() => {});
              const readyCount = await page.evaluate(() => {
                const el = document.querySelector('[data-ready-count]');
                return el ? parseInt(el.getAttribute('data-ready-count') ?? '0', 10) : -1;
              });
              check(readyCount >= 3, `R4-03: the greenfield project is contract-ready (got ${readyCount} passing readiness checks)`);
              await frame(page, 'r4-03-1-project-ready', 'R4-03 — the greenfield project scaffolded from a template, contract-green on its own page');
              cleanOnboardedProject(TEMPLATE_SLUG);
        },
      },
      {
        id: 'su-create-library',
        title: 'Everything is data — projects index, Library shelves, Home attention strip',
        narration: 'With a brand-new project just stood up from nothing, its own index page renders it as a real data card, the rebuilt Library page renders its five shelves (skills/hooks/connections/templates/community, W6-IA-4) as real registry data, and Home\'s cross-project attention strip still surfaces this project. (W6-IA-4: Library is shelves-only now — the flows/agents/projects/knowledge shelves this beat used to check on /library moved onto their own real index routes; /flows and /agents each get their own dedicated journey coverage, so this beat checks /projects — the one index route with no other dedicated journey file yet — plus the rebuilt Library shelves and Home\'s attention strip.)',
        drive: async (ctx) => {
              const { page, watch, check, countAtLeast } = ctx;
              // ════════════════════════════════════════════════════════════════════════
              // ACT 1 — AUTHOR. Everything in Studio is data you can edit.
              // ════════════════════════════════════════════════════════════════════════

              // ── A1.0: the projects index reports ready before anything else loads ─────
              console.log('\n[A1.0] Projects index ready');
              await page.goto(watch.uiUrl + '/projects', { waitUntil: 'domcontentloaded' });
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="projects-index"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 30000 },
                );
                check(true, 'projects: [data-page="projects-index"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="projects-index"]')?.getAttribute('data-page-ready') ?? '(no data-page=projects-index)');
                check(false, `projects: data-page-ready (got "${pr}")`);
              }
              // ── A1.1: the projects index — every registered project as a real card ────
              console.log('\n[A1.1] Projects index — everything is data');
              await caption(page, 'Every registered project, as a real, editable data card.');
              await sleep(ACT);
              await countAtLeast(page, '[data-section="projects-grid"]', 1, 'projects: [data-section="projects-grid"] present');
              await countAtLeast(page, '[data-section="projects-grid"] [data-card-type="project"]', 1, 'projects: ≥1 project card');
              const projGridCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-section="projects-grid"]')?.getAttribute('data-count') ?? '0', 10));
              check(projGridCount >= 1, `projects: data-count ≥1 (got ${projGridCount})`);

              // ── A1.2: the rebuilt Library — five shelves, real registry data (W6-IA-4) ─
              console.log('\n[A1.2] Library — five shelves, real registry data');
              await page.goto(watch.uiUrl + '/library', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 30000 },
              ).catch(() => {});
              await caption(page, 'Library — skills, hooks, connections, templates, community: the reusable building blocks every agent and flow composes from.');
              await sleep(ACT);
              const shelfSections = ['skills', 'hooks', 'connections', 'templates', 'community'];
              for (const section of shelfSections) {
                await countAtLeast(page, `[data-section="${section}"]`, 1, `library: [data-section="${section}"] present`);
              }
              const shelfCounts = await page.evaluate((sections) =>
                Object.fromEntries(sections.map((s) => [
                  s, parseInt(document.querySelector(`[data-section="${s}"]`)?.getAttribute('data-count') ?? '0', 10),
                ])), shelfSections);
              check(shelfCounts.skills >= 1, `library: skills shelf data-count ≥1 (got ${shelfCounts.skills})`);
              check(shelfCounts.hooks >= 1, `library: hooks shelf data-count ≥1 (got ${shelfCounts.hooks})`);
              // Connections/templates/community counts vary by seed catalog — presence of
              // the shelf itself is the honest claim (checked above); no ≥1 floor asserted
              // for kinds this checkout may legitimately ship zero of.
              await countAtLeast(page, '[data-section="skills"] [data-card-type="skill"]', 1, 'library: ≥1 skill card in the skills shelf');
              await countAtLeast(page, '[data-section="hooks"] [data-card-type="hook"]', 1, 'library: ≥1 hook card in the hooks shelf');
              // Create CTAs — Skills/Hooks only (Connections/Templates have no author-here
              // path; Community gets a browse entry, never a create CTA).
              check(await page.locator('[data-action="new-skill"]').count() > 0, 'library: skills shelf carries a "+ New skill" create CTA');
              check(await page.locator('[data-action="new-hook"]').count() > 0, 'library: hooks shelf carries a "+ New hook" create CTA');
              check(await page.locator('[data-action="browse-community"]').count() > 0, 'library: community shelf carries a "Browse community" entry, not a create CTA');
              // KB cross-link — Library no longer creates or lists knowledge bases.
              const kbCrosslink = await page.evaluate(() =>
                document.querySelector('[data-action="kb-crosslink"]')?.getAttribute('href') ?? '');
              check(kbCrosslink === '/knowledge', `library: the KB cross-link points at /knowledge (got "${kbCrosslink}")`);

              // ── A1.3: cross-project attention strip — now lives on Home (R4-11-F4 + W6-IA-4) ─
              // mdtoc is a standing, always-registered fixture (checked into the repo,
              // not created/cleaned by any beat) so the strip always has ≥1 item here.
              console.log('\n[A1.3] Home — cross-project attention strip');
              await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="home"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 },
              ).catch(() => {});
              await countAtLeast(page, '[data-section="attention-strip"]', 1, 'home: [data-section="attention-strip"] present');
              await countAtLeast(page, '[data-attention-item]', 1, 'home: ≥1 [data-attention-item] in the attention strip');
              const attentionLink = await page.evaluate(() =>
                document.querySelector('[data-attention-item]')?.getAttribute('href') ?? '');
              check(/^\/(projects\/[^/]+|knowledge\?id=[^/]+)$/.test(attentionLink),
                `home: attention item links through to its owning project or KB surface (got "${attentionLink}")`);

        },
      },
      {
        id: 'su-create-orientation',
        title: 'Discoverable creation — the agents index "+ New Agent" CTA',
        narration: 'Creating from nothing didn\'t require a URL only a developer would know — the agents index\'s "+ New Agent" CTA proves creating something new is always one click away. (W6-IA-4: this used to be the library\'s own "+ New Agent" shelf CTA, alongside a first-run welcome panel Library rendered when nothing was registered yet — Library dropped its projects/agents/flows/kb shelves down to shelves-only, and the first-run-orientation concept retired with them; each real index page — /projects, /agents, /flows — now carries its OWN zero-state CTA instead of one shared welcome panel.)',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── J1: discoverable creation — the agents index CTA ──────────────────────
              // Creation must be discoverable from a real index page (not URL-only): the
              // "+ New Agent" CTA is a real, enabled link to the builder.
              await page.goto(watch.uiUrl + '/agents', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="agents-index"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 },
              ).catch(() => {});
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
              check(newAgentCta.present, 'J1: agents index "+ New Agent" creation CTA ([data-action="new-agent"]) is present');
              check(newAgentCta.present && !newAgentCta.disabled, 'J1: "+ New Agent" CTA is enabled (creation is discoverable, not a dead greyed button)');
              check(newAgentCta.href?.includes('/agents/new'), `J1: "+ New Agent" routes to the agent builder (got "${newAgentCta.href}")`);

              await sleep(READ);
              await frame(page, 'a1-1-agents-index', 'A1 — the agents index: every agent as a real data card, creation always one click away');

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
              // R2-10 PR2: target the shared session shell directly — the retired
              // /instructions/<sid> route is a redirect stub for stale links only.
              await page.goto(watch.uiUrl + `/sessions/instructions/${encodeURIComponent(instrSid)}`, { waitUntil: 'domcontentloaded' });
              const instrReady = await page.waitForSelector('main[data-page="session"][data-session-kind="instructions"]', { timeout: 20000 }).then(() => true).catch(() => false);
              check(instrReady, 'AI-1: instructions screen renders on the shared shell ([data-page="session"][data-session-kind="instructions"])');
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
              // R2-10: at least one turn, derived from a REAL checkpoint file —
              // questions.json contributes a pending AGENT turn while phase is
              // exactly 'awaiting-answers' (never invented).
              await page.waitForFunction(
                () => document.querySelector('[data-turn-index="0"]')?.getAttribute('data-turn-source') === 'questions.json',
                null, { timeout: 8000 },
              ).catch(() => {});
              const instrTurn0 = await page.evaluate(() => {
                const el = document.querySelector('[data-turn-index="0"]');
                return el ? { role: el.getAttribute('data-turn-role'), source: el.getAttribute('data-turn-source') } : null;
              });
              check(instrTurn0 !== null && instrTurn0.role === 'agent' && instrTurn0.source === 'questions.json',
                `AI-1: transcript derives a real turn from questions.json (got ${JSON.stringify(instrTurn0)})`);
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
              // R2-10: the artifact pane — instructions' declared renderer is
              // markdown-draft, with the drafted AGENTS.md rendering as real
              // content (not the no-draft placeholder) and a non-empty label
              // sourced from studio/session-kinds.yaml over the wire.
              check(await page.locator('[data-section="session-artifact"][data-artifact-kind="markdown-draft"]').count() > 0,
                'AI-1: session artifact pane renders the markdown-draft renderer for the instructions kind');
              // The artifact pane is LIVE: the shell refetches on its own 3s poll
              // (SHELL_POLL_MS, app/sessions/[kind]/[sessionId]/page.tsx), which is a
              // SEPARATE cycle from the summary poll that renders the verdict panel
              // above. Sampling the pane the instant the verdict appears therefore
              // races the shell's next refetch by up to one poll interval. WAIT for
              // the state instead of sampling it — a pane still empty after several
              // poll intervals is then a REAL failure (the artifact is not living),
              // not a coin flip. Same fix R2-10 applied to the onboard beat that read
              // data-session-phase before the shell's first fetch had settled; this
              // beat is the one that had been "flaky", and it was this race.
              await page
                .waitForSelector('[data-section="session-artifact"] [data-markdown-draft-state="has-content"]', { timeout: 20000 })
                .catch(() => {});
              check(await page.locator('[data-section="session-artifact"] [data-markdown-draft-state="has-content"]').count() > 0,
                'AI-1: the drafted AGENTS.md renders as real content in the artifact pane (after the shell poll refetches)');
              const instrArtifactLabel = await page.evaluate(
                () => document.querySelector('[data-section="session-artifact"]')?.getAttribute('data-artifact-label') ?? '');
              check(instrArtifactLabel.length > 0, `AI-1: artifact pane carries a non-empty data-artifact-label (got "${instrArtifactLabel}")`);
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
                  // R2-10 PR2: the fallback targets the shared shell directly.
                  await p.goto(watch.uiUrl + `/sessions/instructions/${encodeURIComponent(instrClipSid)}`, { waitUntil: 'domcontentloaded' });
                }
                await p.waitForSelector('main[data-page="session"][data-session-kind="instructions"]', { timeout: 12000 }).catch(() => {});
                await sleep(WORK);
                writeInstrStatus(instrClipSid, { phase: 'interviewing', round: 1 });
                instrEvent(instrClipSid, 'start', 'instructions turn (phase=interviewing, round=1)');
                await instrBurst(instrClipSid, ['Glob', 'Read']);
                await p.waitForFunction(
                  () => document.querySelector('main[data-page="session"]')?.getAttribute('data-session-phase') === 'interviewing',
                  null, { timeout: 10000 },
                ).catch(() => {});
                await sleep(WORK);
                writeInstrStatus(instrClipSid, { phase: 'drafting', round: 2 });
                instrEvent(instrClipSid, 'start', 'instructions turn (phase=drafting) — rolling in answers');
                await instrBurst(instrClipSid, ['Read', 'Write']);
                await p.waitForFunction(
                  () => document.querySelector('main[data-page="session"]')?.getAttribute('data-session-phase') === 'drafting',
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
              await page.waitForSelector('main[data-page="session"][data-session-kind="instructions"]', { timeout: 10000 }).catch(() => {});
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
              // R2-10 PR2: target the shared session shell directly — the retired
              // /project-brain/<sid> route is a redirect stub for stale links only
              // (it forwards ?project= for the shell's own fallback resolution).
              await page.goto(watch.uiUrl + `/sessions/project-brain/${encodeURIComponent(pbSid)}?project=${encodeURIComponent(PROJECT)}`, { waitUntil: 'domcontentloaded' });
              const pbReady = await page.waitForSelector('main[data-page="session"][data-session-kind="project-brain"]', { timeout: 20000 }).then(() => true).catch(() => false);
              check(pbReady, 'AI-2: project-brain screen renders on the shared shell ([data-page="session"][data-session-kind="project-brain"])');
              await caption(page, 'Forge reads the project and drafts its seed brain — the themes a planner reads before designing.');
              // briefing → analyzing → (seed themes) → awaiting-review
              writePbStatus(pbSid, 'analyzing', 'emphasise conventions + module layout');
              await frame(page, 'pbrain-0-analyzing', 'Part 1 — project-brain-builder analyses the project (AI-assisted)');
              seedStagedBrain(pbSid);
              await page.waitForSelector('main[data-page="session"][data-session-phase="awaiting-review"]', { timeout: 10000 }).catch(() => {});
              check(await page.locator('[data-section="brain-review"]').count() > 0, 'AI-2: staged themes presented for review');
              await countAtLeast(page, '[data-theme-name]', 3, 'AI-2: ≥3 seed themes drafted');
              // R2-10: the artifact pane — project-brain's declared renderer is
              // brain-structure, which renders its file tabs through the SHARED
              // FilePackage component (never a second tab-strip) — the "reused,
              // not forked" claim, asserted against the live product.
              check(await page.locator('[data-section="session-artifact"][data-artifact-kind="brain-structure"]').count() > 0,
                'AI-2: session artifact pane renders the brain-structure renderer for the project-brain kind');
              check(await page.locator('[data-section="session-artifact"] [data-component="file-package"]').count() > 0,
                'AI-2: brain-structure artifact renders through the SHARED FilePackage component (reused, not forked)');
              const pbArtifactLabel = await page.evaluate(
                () => document.querySelector('[data-section="session-artifact"]')?.getAttribute('data-artifact-label') ?? '');
              check(pbArtifactLabel.length > 0, `AI-2: artifact pane carries a non-empty data-artifact-label (got "${pbArtifactLabel}")`);
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
                  // R2-10 PR2: the fallback targets the shared shell directly.
                  await p.goto(watch.uiUrl + `/sessions/project-brain/${encodeURIComponent(pbClipSid)}?project=${encodeURIComponent(PROJECT)}`, { waitUntil: 'domcontentloaded' });
                }
                await p.waitForSelector('main[data-page="session"][data-session-kind="project-brain"]', { timeout: 12000 }).catch(() => {});
                await sleep(WORK);
                writePbStatus(pbClipSid, 'analyzing', 'emphasise conventions + module layout');
                await p.waitForFunction(
                  () => document.querySelector('main[data-page="session"]')?.getAttribute('data-session-phase') === 'analyzing',
                  null, { timeout: 10000 },
                ).catch(() => {});
                await sleep(WORK);
                seedStagedBrain(pbClipSid);
                await p.waitForSelector('main[data-page="session"][data-session-phase="awaiting-review"]', { timeout: 12000 }).catch(() => {});
                await sleep(WORK);
              }, { readySel: 'main[data-page="projects"]', caption: 'the project page\'s "Build project brain with the agent" — briefing → analyzing → the generated seed themes, awaiting review' });
              if (pbClipSid) cleanSeededBrain(pbClipSid);
              // approve → committing → committed (flip-only; nothing written under brain/)
              await page.locator('[data-action="approve-brain"]').click().catch(() => {});
              await page.waitForSelector('main[data-page="session"][data-session-phase="committing"]', { timeout: 8000 }).catch(() => {});
              writePbStatus(pbSid, 'committed', '');
              await page.waitForSelector('[data-section="brain-committed"]', { timeout: 8000 }).catch(() => {});
              check(await page.locator('[data-action="bind-and-return"]').count() > 0, 'AI-2: seed brain committed — bind-and-return offered');
              await frame(page, 'pbrain-2-committed', 'Part 1 — project brain seeded (grows with the project)');

        },
      },
      {
        id: 'su-create-project-brain-kickoff-chip',
        title: 'The generic kickoff screen — project-brain-builder is fixed-strategy, so it renders a read-only chip',
        narration: 'project-brain-builder pins ONE model (strategy:fixed, no declared range) — unlike demo-builder\'s range picker (see demo-builder.mjs\'s own kickoff beat), the SAME generic kickoff screen renders a read-only chip naming that fixed model instead of a radio group; widening it is a SKILL.md edit, never a UI decision. A light, self-contained beat — it only LOOKS at the kickoff screen, never starts a session (su-create-project-brain above already drives project-brain\'s real session-creation path via its own bespoke launcher).',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[AI-2b] the generic kickoff screen — project-brain\'s fixed-strategy chip');
              await page.goto(`${watch.uiUrl}/sessions/project-brain/new`, { waitUntil: 'domcontentloaded' });
              const ready = await page.waitForFunction(
                () => document.querySelector('[data-page="session-kickoff"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).then(() => true).catch(() => false);
              check(ready, 'AI-2b: the generic kickoff screen renders for kind=project-brain ([data-page="session-kickoff"])');
              await caption(page, 'A fixed-strategy skill (project-brain-builder) — one model, no picker, just a read-only chip.');
              const pickerKind = await page.evaluate(
                () => document.querySelector('[data-section="kickoff-model-tier"]')?.getAttribute('data-model-tier-picker') ?? null,
              );
              check(pickerKind === 'fixed', `AI-2b: project-brain-builder's model-tier section renders as a FIXED read-only chip, never a radio group (got "${pickerKind}")`);
              check(await page.locator('[data-field="kickoff-model-fixed-chip"]').count() > 0, 'AI-2b: the read-only fixed-model chip renders');
              check(await page.locator('[data-field="kickoff-model-tier-option"]').count() === 0, 'AI-2b: NO radio options render for a fixed-strategy skill');
              await frame(page, 'pbrain-kickoff-fixed-chip', 'The generic kickoff screen — project-brain\'s fixed-model chip, no picker', { key: true });
        },
      },
      {
        id: 'su-create-project-builder',
        title: `Project builder — tune an existing project (/projects/${PROJECT})`,
        narration: `Contrast with the from-scratch project above: ${PROJECT} already has real content, so its project builder shows the same north star, demo timeline, and contract-readiness surfaces already populated and tuneable at a glance; adding a demo step live-flips the dirty flag, proving nothing here is a static page. Two permanent read-only surfaces sit alongside the editor: the contract panel (R4-12-F1) — a live five-stage view of ${PROJECT}'s real artifacts on disk (contract, instructions, secrets, demo, roadmap), with secrets shown by NAME only and, since ${PROJECT} is creds-free, honestly reporting no secrets rather than inventing a masked value — and the permanent cycle ledger (R4-12-F2), this project's own completed cycles, each a row that digs read-only into its full run detail on the shared flow run-detail surface.`,
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

                // ── AT-F1-7: the PERMANENT contract panel — a live view of the real artifacts ──
                // Distinct from the preflight VERDICT surfaces above (ContractReadiness /
                // ContractResolutionPanel): this permanent panel (R4-12-F1) issues its OWN
                // GET /api/studio/projects/mdtoc/contract-stages and renders the five-stage
                // buildout off mdtoc's real artifacts on disk. No session is open — this is
                // the project at rest. The panel's own effect re-fetches once the
                // north-star state settles, so wait for that settled render (present)
                // rather than the first transient one — a still-missing state after the
                // wait is then a REAL failure the evaluate below surfaces honestly.
                await page.waitForSelector('[data-section="contract-panel"]', { timeout: 15000 }).catch(() => {});
                await page.waitForSelector('[data-section="contract-panel"] [data-contract-northstar-state="present"]', { timeout: 15000 }).catch(() => {});
                const contractPanel = await page.evaluate(() => {
                  const panel = document.querySelector('[data-section="contract-panel"]');
                  if (panel === null) return null;
                  const rows = [...panel.querySelectorAll('[data-checklist-row]')].map((r) => ({
                    stage: r.getAttribute('data-checklist-row'), status: r.getAttribute('data-checklist-status'),
                  }));
                  return {
                    rowCount: panel.querySelector('[data-checklist-row-count]')?.getAttribute('data-checklist-row-count') ?? null,
                    rows,
                    detailLines: panel.querySelectorAll('[data-detail-line]').length,
                    northStar: panel.querySelector('[data-contract-northstar]') !== null,
                    northStarState: panel.querySelector('[data-contract-northstar]')?.getAttribute('data-contract-northstar-state') ?? null,
                    conventionsSource: panel.querySelector('[data-contract-conventions-source]') !== null,
                  };
                }).catch(() => null);
                check(contractPanel !== null,
                  'AT-F1-7: the project page renders the permanent contract panel ([data-section="contract-panel"]) at rest — no session open');
                if (contractPanel) {
                  check(contractPanel.rowCount === '5' && contractPanel.rows.length === 5,
                    `AT-F1-7: the checklist reports all five contract stages (data-checklist-row-count, got ${contractPanel.rowCount}/${contractPanel.rows.length})`);
                  const stages = contractPanel.rows.map((r) => r.stage).join(',');
                  check(stages === 'contract,instructions,secrets,demo,roadmap',
                    `AT-F1-7: the five stage rows are the declared vocabulary in order (got "${stages}")`);
                  check(contractPanel.detailLines >= 1,
                    `AT-F1-7: the panel renders real per-stage detail lines off mdtoc's artifacts (got ${contractPanel.detailLines} [data-detail-line])`);
                  check(contractPanel.northStar && contractPanel.northStarState === 'present',
                    `AT-F1-7: the north-star block renders present off mdtoc's real north star ([data-contract-northstar-state], got "${contractPanel.northStarState}")`);
                  check(contractPanel.conventionsSource,
                    'AT-F1-7: the conventions block renders ([data-contract-conventions-source])');
                  // HONEST creds-free state (D3 security invariant): mdtoc declares NO secrets
                  // (testProcess.acceptance.requiresEnv is empty — it is forge's creds-free OOTB
                  // reference project), so the secrets row is honestly `absent` and carries NO
                  // detail line — never an invented masked value standing in for a real one. A
                  // secrets NAME is only ever rendered for a project that actually declares one.
                  const secrets = contractPanel.rows.find((r) => r.stage === 'secrets');
                  check(secrets?.status === 'absent',
                    `AT-F1-7 (D3): mdtoc is creds-free — the secrets row reports absent honestly, no NAMEs and no masked value invented (got "${secrets?.status}")`);
                }
                await frame(page, 'a4-1b-contract-panel', 'A4 (R4-12-F1) — the permanent contract panel: five-stage buildout, north star, conventions — a live view of mdtoc\'s real artifacts', { key: true });

                // ── AT-F2-4: the permanent cycle-ledger dig-in → shared run detail ──────────
                // The project page carries a PERMANENT cycle ledger (R4-12-F2): this project's
                // own completed cycles, each a row digging into its full run detail. mdtoc's
                // real archived history accrues as cycles run (the develop cycle later in this
                // walkthrough is one such producer); at THIS point in RUN_ORDER none has run
                // yet, so we seed ONE throwaway completed cycle (its own distinct init id,
                // swept in the finally below) mirroring the exact on-disk shape a real archived
                // cycle carries — so the REAL fetchCycles → deriveProjectCycleLedgerRows →
                // HistoryLedger path renders a REAL, clickable row (never a fabricated one) that
                // navigates READ-ONLY into the shared flow run-detail surface (no run triggered).
                seedLedgerCycle();
                try {
                  // Reload so the page's mount-time fetchCycles picks up the seeded cycle
                  // (the project page loads cycles once on mount; there is no periodic refetch).
                  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
                  await page.waitForFunction(
                    () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                    null, { timeout: 20000 },
                  ).catch(() => {});
                  const ledgerMounted = await page.evaluate(() =>
                    document.querySelector('[data-section="project-cycle-ledger"] [data-section="history-ledger"]') !== null).catch(() => false);
                  check(ledgerMounted,
                    'AT-F2-4: the project page mounts the permanent cycle ledger ([data-section="project-cycle-ledger"] wrapping the shared [data-section="history-ledger"])');
                  const ledgerRow = page.locator('[data-section="project-cycle-ledger"] [data-ledger-row="true"]').first();
                  const rowVisible = await ledgerRow.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
                  check(rowVisible,
                    'AT-F2-4: the ledger renders a completed-cycle row through the shared deriveProjectCycleLedgerRows engine (a real cycle on disk, not a fabricated row)');
                  if (rowVisible) {
                    const rowRunId = await ledgerRow.getAttribute('data-run-id').catch(() => null);
                    const rowStatus = await ledgerRow.getAttribute('data-run-status').catch(() => null);
                    check(rowStatus === 'done',
                      `AT-F2-4: the ledger row carries the cycle's real status verbatim (got "${rowStatus}")`);
                    await frame(page, 'a4-2-cycle-ledger', 'A4 (R4-12-F2) — the permanent cycle ledger: this project\'s completed cycles, each a dig-in to its run detail');
                    // Read-only navigation — a plain <a href> to the shared run-detail; no run
                    // is triggered, the canonical cycle is never touched.
                    await ledgerRow.click().catch(() => {});
                    await page.waitForFunction(
                      () => document.querySelector('main[data-page="flow-run"]')?.hasAttribute('data-run-found') === true,
                      null, { timeout: 20000 },
                    ).catch(() => {});
                    const runPage = await page.evaluate(() => {
                      const el = document.querySelector('main[data-page="flow-run"]');
                      return el ? { found: el.getAttribute('data-run-found'), runId: el.getAttribute('data-run-id') } : null;
                    }).catch(() => null);
                    check(runPage !== null && runPage.found === 'true' && runPage.runId === rowRunId,
                      `AT-F2-4: clicking the ledger row lands on the shared flow run-detail (main[data-page="flow-run"][data-run-found="true"][data-run-id="${rowRunId}"]) — the F2 producer→consumer proof (got ${JSON.stringify(runPage)})`);
                    await frame(page, 'a4-3-run-detail', 'A4 (R4-12-F2) — the cycle-ledger dig-in resolves into the shared flow run-detail surface', { key: true });
                  }
                } finally {
                  cleanLedgerCycle();
                }
              } else {
                check(false, 'project-builder: page did not become ready — project-builder checks skipped');
              }

        },
      },
    ],
  });
