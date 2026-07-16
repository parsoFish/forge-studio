import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  CYCLE_LOG, INIT, DATE, STAMP, QDIR, PROJECT, projectRoot, caption,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// module-scope cross-beat state for this journey (was hoisted in main())
let ROADMAP_SEEDED_WI, roadmapSeeded;       // roadmap-tab → roadmap-start-development
let INIT_DEV, DEV_CYCLE_ID;                 // roadmap-tab → roadmap-start-development

export const journey = defineJourney({
    id: 'roadmap',
    title: 'Project roadmap',
    story: 'As an operator, I browse a project\'s serpentine roadmap of initiatives over time and click "Start development" on a pending one — the roadmap extension proving the initiative timeline actually drives what forge builds next, not just a passive history view.',
    beats: [
      {
        id: 'roadmap-tab',
        title: 'Per-project Roadmap tab',
        narration: 'The Roadmap tab renders every initiative as a dot on a serpentine timeline; clicking a completed one pops a detail card listing its actual work items — the roadmap is read straight off real cycle history, not a hand-maintained list.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              // ── R6: Per-project Roadmap tab (S6 DEC-3) ───────────────────────────────
              // The manifest is now in done/; seed a minimal work-items-snapshot so the
              // roadmap endpoint returns initiatives + WIs, then verify the tab renders them.
              console.log('\n[R6] Per-project Roadmap tab');
              const wiSnapshotDir = join(CYCLE_LOG, 'work-items-snapshot');
              ROADMAP_SEEDED_WI = join(wiSnapshotDir, 'WI-1.md');
              roadmapSeeded = false;
              try {
                mkdirSync(wiSnapshotDir, { recursive: true });
                // Grounded (S5, fix item 12): real WI frontmatter always carries populated
                // GWT acceptance_criteria + files_in_scope + a quality_gate_cmd + the
                // ADR-037 `creates:` list (source: gitpulse WI-1.md/WI-3.md) — never the
                // empty arrays a hand-rolled fixture might default to.
                writeFileSync(ROADMAP_SEEDED_WI, [
                  '---',
                  `work_item_id: WI-1`,
                  `initiative_id: ${INIT}`,
                  'status: complete',
                  'depends_on: []',
                  'acceptance_criteria:',
                  '  - given: a Markdown file with <!-- toc --> / <!-- /toc --> markers',
                  '    when: mdtoc --write <file> runs',
                  '    then: the generated TOC replaces the marker region and nothing outside it changes',
                  '  - given: a file whose embedded TOC is already current',
                  '    when: mdtoc --write <file> runs again',
                  '    then: the file is unchanged (idempotent — re-running produces no diff)',
                  'files_in_scope:',
                  '  - src/inject.ts',
                  '  - src/cli.ts',
                  '  - test/inject.test.ts',
                  'estimated_iterations: 1',
                  'quality_gate_cmd:',
                  '  - npm',
                  '  - test',
                  'creates:',
                  '  - src/inject.ts',
                  '---',
                  '',
                  '## Add --write mode',
                  '',
                  'Implement in-place TOC injection with idempotency.',
                ].join('\n'));
                // Grounded (S5, fix item 12): real cycles always leave the PM's
                // decomposition trail alongside the WI snapshot — seed concise but
                // structurally real versions (source: gitpulse work-items-snapshot/).
                writeFileSync(join(wiSnapshotDir, '_decomposition.md'), [
                  `# Decomposition — ${INIT}`,
                  '',
                  '1 work item(s) emitted.',
                  '',
                  '## Top-level scope',
                  '',
                  '- Pure marker-slice injector (src/inject.ts)',
                  '- CLI wiring for --write (src/cli.ts)',
                  '',
                  '## WI-1',
                  '',
                  '- src/inject.ts',
                  '- src/cli.ts',
                  '- test/inject.test.ts',
                ].join('\n'));
                writeFileSync(join(wiSnapshotDir, '_decomposition-state.md'), [
                  `# Decomposition state — ${INIT}`,
                  '',
                  '- [x] WI-1 — Add --write mode (in-place TOC injection, idempotent)',
                ].join('\n'));
                writeFileSync(join(wiSnapshotDir, '_graph.md'), [
                  `# Work-item graph — ${INIT}`,
                  '',
                  '```mermaid',
                  'graph TD',
                  '  WI-1["WI-1: Add --write mode (src/inject.ts + src/cli.ts)"]',
                  '```',
                ].join('\n'));
                roadmapSeeded = true;
              } catch {
                check(false, 'roadmap: seeded WI snapshot for roadmap assertion');
              }
              // S7 / DEC-3: seed a SECOND, decomposed-but-not-yet-developing initiative
              // (pending) so the roadmap shows the "start development" trigger. A real
              // develop run (dev→unifier→review) is the scheduler's job — exercised by the
              // operator-gated verify:cycle; here we prove the trigger flips the manifest
              // onto the forge-develop flow.
              INIT_DEV = `INIT-${DATE}-e2e-develop-trigger`;
              DEV_CYCLE_ID = `${STAMP}_${INIT_DEV}`;
              mkdirSync(QDIR('pending'), { recursive: true });
              writeFileSync(join(QDIR('pending'), `${INIT_DEV}.md`), [
                '---', `initiative_id: ${INIT_DEV}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
                // Grounded (S5, fix item 2): distinct-but-realistic budget (real range
                // 6-24 iterations / $4-$80 — source _queue/done manifests).
                `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 8', 'cost_budget_usd: 12', 'phase: pending',
                'origin: architect', `cycle_id: ${DEV_CYCLE_ID}`,
                '---', '', '# mdtoc — `--check` mode (CI drift guard)', '',
                'Given a doc whose embedded TOC has drifted, when `mdtoc --check` runs, then it exits non-zero so CI can fail.',
              ].join('\n'));

              await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 20000 },
                );
              } catch { /* soft: continue to check tab */ }
              // Click the Roadmap tab.
              const roadmapTab = page.locator('button[data-tab="roadmap"]');
              if (await roadmapTab.count() > 0) {
                await roadmapTab.click();
                await sleep(1500); // allow bridge fetch to settle
                await caption(page, 'Per-project Roadmap — a serpentine timeline of the project’s progression over time; click a dot to pop its detail card.');
                await frame(page, 'r6-0-roadmap-tab', 'R6 — per-project Roadmap tab: the serpentine timeline of initiatives over time');
                const roadmapSection = await page.evaluate(() =>
                  document.querySelector('[data-section="project-roadmap"]') !== null);
                check(roadmapSection, 'roadmap: [data-section="project-roadmap"] rendered');
                const initCount = await page.evaluate(() =>
                  document.querySelectorAll('[data-roadmap-node]').length);
                check(initCount >= 1, `roadmap: ≥1 [data-roadmap-node] on the timeline (got ${initCount})`);
                if (roadmapSeeded) {
                  // The detail card pops OFF the dot now — click the seeded initiative's
                  // node, then assert its card (with WIs) appears in the popover.
                  await page.locator(`[data-roadmap-node][data-initiative-id="${INIT}"]`).first().click().catch(() => {});
                  await sleep(500);
                  const wiCount = await page.evaluate(() =>
                    document.querySelectorAll('[data-roadmap-popover] [data-work-item-id]').length);
                  check(wiCount >= 1, `roadmap: clicking a dot pops its card with ≥1 [data-work-item-id] (got ${wiCount})`);
                  await frame(page, 'r6-0b-popover', 'R6 — clicking an initiative dot pops its detail card up off the timeline');
                  await page.keyboard.press('Escape'); // dismiss before selecting the next node
                  await sleep(300);
                }
              } else {
                check(false, 'roadmap: Roadmap tab button [data-tab="roadmap"] present on project page');
              }

        },
      },
      {
        id: 'roadmap-start-development',
        title: 'Start development trigger (DEC-3)',
        narration: 'A decomposed-but-not-yet-built initiative offers "Start development" right on its roadmap card; clicking it repoints the manifest at the forge-develop flow and threads the architect-minted cycle id — the timeline itself is the trigger, not a separate queue command.',
        drive: async (ctx) => {
              const { page, check, frame } = ctx;
              // ── R6.1: Start development — the trigger flips the manifest onto forge-develop ──
              console.log('\n[R6.1] Start development trigger (DEC-3)');
              // The card pops off the dot — click the pending initiative's node to reveal it.
              await page.locator(`[data-roadmap-node][data-initiative-id="${INIT_DEV}"]`).first().click().catch(() => {});
              await sleep(500);
              // The card div is uniquely identified by data-develop-state (the button also
              // carries data-initiative-id, so select the div explicitly to avoid a match clash).
              const devCard = page.locator(`[data-initiative-id="${INIT_DEV}"][data-develop-state]`);
              const startBtn = devCard.locator('[data-action="start-development"]');
              if (await startBtn.count() > 0) {
                check(
                  await devCard.getAttribute('data-initiative-status') === 'pending',
                  'roadmap: the decomposed initiative is pending (develop-able)',
                );
                await devCard.scrollIntoViewIfNeeded().catch(() => {});
                await caption(page, 'A decomposed initiative offers "Start development" — it runs the Forge Develop flow.');
                await frame(page, 'r6-1-start-development', 'R6 — the "start development" trigger on a pending initiative');
                await startBtn.click();
                await page.waitForSelector(`[data-initiative-id="${INIT_DEV}"][data-develop-state="started"]`, { timeout: 12000 }).catch(() => {});
                const devState = await devCard.getAttribute('data-develop-state');
                check(devState === 'started', `start-development enqueues the develop run (data-develop-state=${devState})`);
                await frame(page, 'r6-1b-development-started', 'R6 — development started: the unifier will open a PR for review');
                // The manifest is now claimable on the forge-develop flow, threading its cycle_id.
                const devManifest = readFileSync(join(QDIR('pending'), `${INIT_DEV}.md`), 'utf8');
                check(/^flow_id:\s*forge-develop\s*$/m.test(devManifest), 'start-development repoints the manifest at the forge-develop flow');
                check(devManifest.includes(DEV_CYCLE_ID), 'the develop run threads the architect-minted cycle_id (DEC-2)');
              } else {
                check(false, `roadmap: [data-action="start-development"] present on the pending initiative ${INIT_DEV}`);
              }

              // Clean up the seeded WI snapshot (the manifest in done/ is cleaned in the finally block).
              if (roadmapSeeded) {
                try { rmSync(ROADMAP_SEEDED_WI, { force: true }); } catch { /* */ }
              }
              try { rmSync(join(QDIR('pending'), `${INIT_DEV}.md`), { force: true }); } catch { /* */ }

        },
      },
    ],
});
