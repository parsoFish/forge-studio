import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import { cleanFirstProject, FORGE_ROOT, J4_PROJECT, waitForFile, caption, ONB_EXISTING_SLUG, WORK } from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

export const journey = defineJourney({
    id: 'stand-up-onboard',
    title: 'Stand up a project (onboard existing)',
    story: 'Onboard an existing project in the UI and resolve it to the forge project contract.',
    beats: [
      {
        id: 'su-onboard-project',
        title: 'Onboard a project from the UI',
        narration: 'Onboard a project from the UI',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── J4: ONBOARD A PROJECT (in the UI) ─────────────────────────────────────
              // The library "+ New Project" CTA opens a minimal onboarding form (name +
              // quality gate + north star); submitting registers the project + scaffolds
              // .forge/project.json. Proves: registry + config on disk, readiness renders,
              // the project appears in the library, lint stays green.
              console.log('\n[J4] Onboard a project from the UI');
              cleanFirstProject();
              await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              // Baseline project count BEFORE onboarding — the discoverable-on-disk projects
              // vary by checkout (this de-betterado'd worktree ships only the mdtoc reference
              // project + scratch dirs), so the assertion is RELATIVE: onboarding must add
              // exactly one project. Stronger than an absolute floor, and checkout-agnostic.
              const projCountBefore = await page.evaluate(() =>
                parseInt(document.querySelector('[data-section="projects"]')?.getAttribute('data-count') ?? '0', 10));
              const newProjCta = await page.evaluate(() => {
                const el = document.querySelector('[data-action="new-project"]');
                return el ? { href: el.getAttribute('href'), disabled: el.hasAttribute('disabled') } : null;
              });
              check(newProjCta !== null && !newProjCta.disabled && (newProjCta.href ?? '').includes('/projects/new'),
                'J4: library "+ New Project" CTA is enabled and routes to onboarding');

              await page.goto(watch.uiUrl + '/projects/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-section="project-onboard"]') !== null,
                null, { timeout: 15000 },
              ).catch(() => {});
              const onboardForm = await page.evaluate(() => document.querySelector('[data-section="project-onboard"]') !== null);
              check(onboardForm, 'J4: new-project shows the onboarding form ([data-section="project-onboard"])');
              const onbAdvCollapsed = await page.evaluate(() => {
                const d = document.querySelector('[data-section="onboard-advanced"]');
                return d ? !d.open : false;
              });
              check(onbAdvCollapsed, 'J4: advanced contract clauses collapsed by default (only required fields shown)');
              await frame(page, 'j4-0-onboard-form', 'J4 — onboard a project: required fields only (quality gate, north star)');

              // Fill the minimal required fields + onboard. (quality-gate defaults to npm test)
              await page.locator('[data-field="project-name"]').fill('Journey Demo Project');
              await page.locator('[data-field="north-star"]').fill('A scratch project onboarded by the e2e journey to prove UI onboarding.');
              await page.locator('[data-action="onboard-project"]').click();

              const projectJsonPath = join(FORGE_ROOT, 'projects', J4_PROJECT, '.forge', 'project.json');
              const projLanded = await waitForFile(projectJsonPath, 12000);
              check(projLanded, `J4: onboarding writes projects/${J4_PROJECT}/.forge/project.json`);

              // The hard contract fields are on disk.
              let projCfg = {};
              try { projCfg = JSON.parse(readFileSync(projectJsonPath, 'utf8')); } catch { /* */ }
              check(Array.isArray(projCfg.quality_gate_cmd) && projCfg.quality_gate_cmd.length > 0,
                'J4: project.json carries the C1 quality_gate_cmd');
              check(projCfg.demo && typeof projCfg.demo.shape === 'string',
                'J4: project.json carries the DEMO block (demo.shape)');
              check(typeof projCfg.northStar === 'string' && projCfg.northStar.length > 0,
                'J4: project.json carries the north star');
              // The project is auto-discovered from disk: its dir carries the
              // `.forge/project.json` contract file (B1 — no registry file).
              check(existsSync(projectJsonPath),
                'J4: the project is auto-discovered from disk (.forge/project.json present)');

              // Onboarding redirects to the editor — readiness renders + reflects the
              // onboarded fields. Navigate explicitly (don't rely solely on the redirect
              // race) and wait for the editor's [data-ready-count] to materialise before
              // reading it, so a slow first-compile doesn't read it as absent (-1).
              await page.waitForURL(new RegExp(`/projects/${J4_PROJECT}`), { timeout: 15000 }).catch(() => {});
              if (!/\/projects\/[^/]*journey-demo-project/.test(page.url())) {
                await page.goto(watch.uiUrl + `/projects/${J4_PROJECT}`, { waitUntil: 'domcontentloaded' });
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
              check(readyCount >= 3, `J4: onboarded project passes ≥3 contract-readiness checks (got ${readyCount})`);
              await frame(page, 'j4-1-project-readiness', 'J4 — onboarded project: contract readiness reflects the hard fields');

              // The project now appears in the library.
              await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const projCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-section="projects"]')?.getAttribute('data-count') ?? '0', 10));
              const onboardedListed = await page.evaluate((id) =>
                document.querySelector(`[data-section="projects"] [data-card-type="project"][data-card-id="${id}"]`) !== null, J4_PROJECT);
              check(projCount === projCountBefore + 1 && onboardedListed,
                `J4: onboarding adds exactly one project to the library (${projCountBefore}→${projCount}, ${J4_PROJECT} listed=${onboardedListed})`);

              // lint stays green with the new project registered.
              let j4LintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                j4LintOk = true;
              } catch (e) {
                console.error(`  [studio lint J4] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(j4LintOk, 'J4: `forge studio lint` stays green with the onboarded project (exit 0)');

        },
      },
      {
        id: 'su-onboard-preflight',
        title: 'onboard existing → deterministically resolve a failing clause',
        narration: 'onboard existing → deterministically resolve a failing clause',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── SU: onboard existing → align to the contract (preflight resolution) ────
              console.log('\n[SU] onboard existing → deterministically resolve a failing clause');
              await page.goto(watch.uiUrl + '/projects/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              await page.waitForSelector('[data-section="project-onboard"]', { timeout: 15000 }).catch(() => {});
              await caption(page, 'Onboard an existing repo — forge aligns it to the contract, resolving clauses deterministically.');
              // name + north-star only (quality-gate keeps its default 'npm test'). Fill AFTER
              // page-ready + re-fill if the button hasn't enabled (guards a hydration race where
              // the input event lands before React wires onChange). Guarded so a disabled form
              // never throws + aborts the journey.
              const fillOnboard = async () => {
                await page.locator('[data-field="project-name"]').fill('Journey Onboard Existing').catch(() => {});
                await page.locator('[data-field="north-star"]').fill('An existing repo aligned to the forge contract by the journey.').catch(() => {});
              };
              const onboardEnabled = (ms) => page.waitForFunction(() => {
                const b = document.querySelector('[data-action="onboard-project"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: ms }).then(() => true).catch(() => false);
              await fillOnboard();
              let onbEnabled = await onboardEnabled(6000);
              if (!onbEnabled) { await fillOnboard(); onbEnabled = await onboardEnabled(6000); }
              check(onbEnabled, 'SU: onboard-project enables once the required fields are filled');
              // The onboard may redirect (ready) or stay on the form (a hard clause still
              // fails) — either way the project is created on disk. Use the known slug +
              // navigate explicitly (like J4), rather than depending on the redirect.
              const onbSlug = ONB_EXISTING_SLUG;
              const onbJson = join(FORGE_ROOT, 'projects', onbSlug, '.forge', 'project.json');
              if (onbEnabled) {
                await page.locator('[data-action="onboard-project"]').click().catch(() => {});
                await waitForFile(onbJson, 12000);
              }
              const onbCreated = existsSync(onbJson);
              check(onbEnabled && onbCreated, `SU: onboarding created project "${onbSlug}"`);
              if (onbCreated) {
                // Seed disk state so the AUTO-tier ARTIFACTS clause fails (deterministic, no LLM).
                const onbDir = join(FORGE_ROOT, 'projects', onbSlug);
                try {
                  writeFileSync(join(onbDir, 'package.json'), JSON.stringify({ name: onbSlug, private: true, scripts: { test: 'node --test' } }, null, 2));
                  writeFileSync(join(onbDir, '.gitignore'), ['node_modules/', '.forge/work-items/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'].join('\n') + '\n');
                } catch { /* */ }
                await page.goto(watch.uiUrl + `/projects/${onbSlug}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(
                  () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 20000 }).catch(() => {});
                const resolutionPanel = await page.waitForSelector('[data-section="contract-resolution"]', { timeout: 15000 }).then(() => true).catch(() => false);
                check(resolutionPanel, 'SU: contract-resolution panel renders when a clause fails');
                await frame(page, 'onb-0-failing', 'Part 1 — onboard existing: a contract clause fails preflight (auto-fixable)');
                await page.locator('[data-action="apply-preflight-auto"]').first().click().catch(() => {});
                await sleep(WORK);
                await page.waitForFunction(
                  () => document.querySelector('[data-resolution-clause][data-clause-id="ARTIFACTS"]') === null,
                  null, { timeout: 12000 }).catch(() => {});
                const artifactsCleared = await page.locator('[data-resolution-clause][data-clause-id="ARTIFACTS"]').count() === 0;
                check(artifactsCleared, 'SU: auto-fix resolved the failing clause (existing repo aligned to the contract)');
                await frame(page, 'onb-1-resolved', 'Part 1 — clause auto-resolved: the existing repo is now contract-ready');
              }

        },
      },
    ],
  });
