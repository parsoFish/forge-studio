import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import { cleanStarterAgents, STARTER_AGENT_SLUGS, FORGE_ROOT, waitForFile, caption, ACT, THINK } from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

export const journey = defineJourney({
    id: 'agents',
    title: 'Compose an agent',
    story: 'Build the three starter agents from the curated library, then edit an existing agent\'s composition in the agent builder.',
    beats: [
      {
        id: 'agents-starters',
        title: 'Author plan/dev/review agents from the starter library',
        narration: 'Author plan/dev/review agents from the starter library',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── J2: BUILD THE THREE AGENTS FROM THE CURATED STARTER LIBRARY ───────────
              // A brand-new user creates plan/dev/review agents from starters — required
              // fields only, advanced config collapsed (UX spec §2). Proves the agents
              // land on disk as SKILL.md + pass the platform's own lint gate.
              console.log('\n[J2] Author plan/dev/review agents from the starter library');
              cleanStarterAgents(); // clear any prior-run residue first
              await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const pickerPresent = await page.evaluate(() => document.querySelector('[data-section="starter-picker"]') !== null);
              check(pickerPresent, 'J2: new-agent shows the curated starter picker ([data-section="starter-picker"])');
              const advHiddenOnPicker = await page.evaluate(() => document.querySelector('[data-section="advanced"]') === null);
              check(advHiddenOnPicker, 'J2: advanced config is not dumped on the picker (progressive disclosure)');
              const starterOptionCount = await page.evaluate(() => document.querySelectorAll('[data-starter-option]').length);
              check(starterOptionCount >= 4, `J2: picker offers ≥3 starters + blank (got ${starterOptionCount} options)`);
              await frame(page, 'j2-0-starter-picker', 'J2 — new agent: pick a curated starter (plan/dev/review) or blank');

              for (const role of STARTER_AGENT_SLUGS) {
                await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
                await page.waitForSelector(`[data-starter-option="${role}"]`, { timeout: 15000 });
                await page.locator(`[data-starter-option="${role}"]`).click();
                await page.waitForSelector('[data-action="save-agent"]', { timeout: 10000 });
                if (role === STARTER_AGENT_SLUGS[0]) {
                  const advClosed = await page.evaluate(() =>
                    document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open'));
                  check(advClosed === 'false', `J2: advanced config collapsed by default after picking a starter (got "${advClosed}")`);
                  const requiredVisible = await page.evaluate(() =>
                    document.querySelector('#purpose-input') !== null && document.querySelector('#process-input') !== null);
                  check(requiredVisible, 'J2: required fields (purpose, process) visible without opening Advanced');
                  const dirtyAfterPick = await page.evaluate(() =>
                    document.querySelector('[data-page="agents"] [data-dirty]')?.getAttribute('data-dirty')
                    ?? document.querySelector('#col-center')?.getAttribute('data-dirty'));
                  check(dirtyAfterPick === 'true', `J2: picking a starter pre-fills + marks the form dirty (got "${dirtyAfterPick}")`);
                  await frame(page, 'j2-1-builder-prefilled', 'J2 — starter pre-fills required fields; advanced collapsed');
                }
                await page.locator('[data-action="save-agent"]').click();
                const skillPath = join(FORGE_ROOT, 'skills', role, 'SKILL.md');
                const landed = await waitForFile(skillPath, 12000);
                check(landed, `J2: saving the "${role}" starter writes skills/${role}/SKILL.md`);
              }

              // The three authored agents are now LIVE studio objects — they must pass lint.
              let j2LintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                j2LintOk = true;
              } catch (e) {
                console.error(`  [studio lint J2] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(j2LintOk, 'J2: `forge studio lint` validates the three authored agents (exit 0)');
              await frame(page, 'j2-2-agents-authored', 'J2 — plan/dev/review agents authored from starters, lint-green');

        },
      },
      {
        id: 'agents-builder',
        title: 'Agent builder — /agents/project-manager',
        narration: 'Agent builder — /agents/project-manager',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check, countAtLeast } = ctx;
              // ── A3: Agent builder — an agent is data ──────────────────────────────────
              console.log('\n[A3] Agent builder — /agents/project-manager');
              await page.goto(watch.uiUrl + '/agents/project-manager', { waitUntil: 'domcontentloaded' });
              let agentPageReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 25000 },
                );
                agentPageReady = true;
                check(true, 'agent-builder: [data-page="agents"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') ?? '(no data-page=agents)');
                check(false, `agent-builder: data-page-ready (got "${pr}")`);
              }
              await caption(page, 'An agent is data too — skills, tools, runtime SDK, budgets, brain access. Edit it without leaving the UI.');
              await sleep(ACT);
              if (agentPageReady) {
                await countAtLeast(page, '[data-id]', 1, 'agent-builder: catalog palette renders ≥1 chip');
                // Open the collapsed Advanced section (J2 progressive disclosure) so the
                // capabilities zones + runtime render for both the checks and the frame.
                await page.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
                  null, { timeout: 5000 },
                ).catch(() => {});
                for (const kind of ['skill', 'tool', 'mcp', 'hook']) {
                  check(
                    await page.evaluate((k) => document.querySelector(`[data-accepts="${k}"]`) !== null, kind),
                    `agent-builder: drop zone [data-accepts="${kind}"] present`,
                  );
                }
                const agentId = await page.evaluate(() =>
                  document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ??
                  document.querySelector('[data-agent-id]')?.getAttribute('data-agent-id') ?? '');
                check(agentId.length > 0, `agent-builder: data-agent-id non-empty (got "${agentId}")`);
                const readyCount = await page.evaluate(() => {
                  const el = document.querySelector('[data-ready-count]');
                  return el ? el.getAttribute('data-ready-count') : null;
                });
                check(readyCount !== null, `agent-builder: [data-ready-count] attribute present (got ${readyCount})`);
                if (readyCount !== null) {
                  check(parseInt(readyCount, 10) >= 4, `agent-builder: readiness ≥4 checks pass for project-manager (got ${readyCount})`);
                }
                const sdk = await page.evaluate(() => document.querySelector('[data-sdk]')?.getAttribute('data-sdk') ?? '');
                check(sdk.length > 0, `agent-builder: [data-sdk] attribute present (got "${sdk}")`);
                await frame(page, 'a3-0-agent-builder', 'A3 — agent builder: catalog, drop zones, runtime, readiness panel');
                // Dirty-flag: edit the purpose field; assert data-dirty flips; discard.
                const purposeInput = page.locator('#purpose-input');
                if ((await purposeInput.count()) > 0) {
                  const originalPurpose = await purposeInput.inputValue();
                  await purposeInput.click();
                  await purposeInput.pressSequentially(' (e2e test edit)', { delay: 18 });
                  await sleep(THINK);
                  const dirtyVal = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
                  check(dirtyVal === 'true', `agent-builder: data-dirty="true" after editing purpose field (got "${dirtyVal}")`);
                  const discardBtn = page.locator('#btn-discard');
                  if ((await discardBtn.count()) > 0) { await discardBtn.click(); await sleep(THINK); }
                  else { await purposeInput.fill(originalPurpose); }
                  await frame(page, 'a3-1-agent-dirty', 'A3 — data-dirty flips on edit (discarded, no save — seed SKILL.md immutable)');
                } else {
                  check(false, 'agent-builder: #purpose-input present to test dirty flag');
                }
              } else {
                check(false, 'agent-builder: page did not become ready — agent-builder checks skipped');
              }
              // Clip: composing an agent — open Advanced, edit the purpose field (dirty),
              // discard back to a settled state. Fresh context, own navigation.
              await recordClip(browser, watch, 'agent-build', '/agents/project-manager', async (p) => {
                await p.waitForSelector('[data-action="toggle-advanced"]', { timeout: 12000 }).catch(() => {});
                await p.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
                await p.waitForFunction(
                  () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
                  null, { timeout: 5000 },
                ).catch(() => {});
                const purposeInput = p.locator('#purpose-input');
                if (await purposeInput.count() > 0) {
                  await purposeInput.click().catch(() => {});
                  // fill() = one repaint (keystroke typing recorded ~140K of extra frames)
                  const current = await purposeInput.inputValue().catch(() => '');
                  await purposeInput.fill(`${current} (clip)`).catch(() => {});
                  await sleep(THINK);
                  await p.locator('#btn-discard').click().catch(() => {});
                }
              }, { readySel: '[data-page="agents"]', caption: 'Composing an agent from the starter library', holdTailMs: 1500 });

        },
      },
    ],
  });
