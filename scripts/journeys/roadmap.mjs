import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  CYCLE_LOG, INIT, DATE, STAMP, QDIR, PROJECT, projectRoot, caption, THINK, WORK, FORGE_ROOT,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// module-scope cross-beat state for this journey (was hoisted in main())
let ROADMAP_SEEDED_WI, roadmapSeeded;       // roadmap-tab → roadmap-start-development
let INIT_DEV, DEV_CYCLE_ID;                 // roadmap-tab → roadmap-start-development
let INIT_MERGED;                            // roadmap-tab only (seeded + asserted + cleaned in one beat)
let INIT_PLAN;                              // roadmap-tab → roadmap-plan-trigger (R4-11-F2)
let INIT_RECOVERY;                          // roadmap-recovery only (R4-11-T3, self-contained)

export const journey = defineJourney({
    id: 'roadmap',
    title: 'Project roadmap',
    story: 'As an operator, I browse a project\'s roadmap as a completion-time canvas — done initiatives on a real day-by-day time axis in the order they actually merged, pending work banded right of the now-line by dependency-feasibility (no invented dates) — click a card to open its detail drawer, and click "Start development" on a ready one, proving the roadmap actually drives what forge builds next, not just a passive history view.',
    beats: [
      {
        id: 'roadmap-tab',
        title: 'Per-project Roadmap tab',
        narration: 'The Roadmap tab renders the project\'s initiatives as a completion-time canvas (W6-RV-2) — done initiatives placed on a real day-by-day time axis in completion order, one edge per prerequisite→dependent pair (edge-correctness the retired serpentine timeline carried no data for). Clicking a card opens its detail drawer (canvas geometry never reflows) listing its real work items and run links; a completed initiative\'s drawer links straight to the project\'s demo surface (R4-07-F3), so demo upkeep is one click from initiative state. The roadmap is read straight off real cycle history, not a hand-maintained list.',
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
              // develop run (dev→demo→adversarial-review→verdict) is the scheduler's job — exercised by the
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
                // R4-13: seed a REAL dependency so the DAG draws a genuine edge to
                // assert. This develop-trigger initiative depends on the completed
                // INIT (already in _queue/done/), so the roadmap renders a true
                // [data-dep-edge] data-dep-from=INIT → data-dep-to=INIT_DEV. Because
                // the prerequisite is DONE, the scheduler's checkInitiativeDeps gate
                // leaves INIT_DEV `ready` (blockedBy empty) — the Start-development
                // trigger still shows. The edge is display-truth, not a gate flip.
                'depends_on_initiatives:', `  - ${INIT}`,
                '---', '', '# mdtoc — `--check` mode (CI drift guard)', '',
                'Given a doc whose embedded TOC has drifted, when `mdtoc --check` runs, then it exits non-zero so CI can fail.',
              ].join('\n'));
              // R4-11-F2: this initiative must already be PLANNED (a WI snapshot
              // exists under its threaded cycle_id) — the roadmap-builder now reads
              // decomposition off the WI snapshot regardless of queue status, so a
              // WI-less pending manifest would otherwise render the Plan lock and
              // withhold "start development" (the very trigger this beat needs).
              const devWiSnapshotDir = join(FORGE_ROOT, '_logs', DEV_CYCLE_ID, 'work-items-snapshot');
              mkdirSync(devWiSnapshotDir, { recursive: true });
              writeFileSync(join(devWiSnapshotDir, 'WI-1.md'), [
                '---', 'work_item_id: WI-1', `initiative_id: ${INIT_DEV}`, 'status: pending', 'depends_on: []',
                '---', '', '## Add --check mode', '',
                'Implement the CI drift guard.',
              ].join('\n'));

              // R4-11-F2: a THIRD seeded initiative — pending, no cycle_id, no WI
              // snapshot — the "unplanned" fixture for the Plan trigger + the
              // blocked-until-planned lock (asserted in the roadmap-plan-trigger beat).
              INIT_PLAN = `INIT-${DATE}-e2e-plan-trigger`;
              writeFileSync(join(QDIR('pending'), `${INIT_PLAN}.md`), [
                '---', `initiative_id: ${INIT_PLAN}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
                `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 8', 'cost_budget_usd: 12', 'phase: pending',
                'origin: architect',
                '---', '', '# mdtoc — `--fix` mode (auto-repair drift)', '',
                'Given a doc whose embedded TOC has drifted, when `mdtoc --fix` runs, then the TOC is rewritten in place.',
              ].join('\n'));

              // R4-11-F1: a FOURTH seeded initiative sitting in `_queue/merged/` —
              // the transient QueueState pass-through dir between a confirmed PR
              // merge and closure's own same-sweep promotion to `done/` (distinct
              // from the unrelated CycleOutcome 'merged' status value). `merged`
              // is a same-sweep pass-through, but that sweep spans the post-merge
              // CI watch plus the reflector run, so a manifest legitimately sits
              // here for minutes on every normal finalize, not instantaneously —
              // the roadmap must be able to render the state faithfully for that
              // whole window (not just the rare crash-between-moves case) — seed
              // it directly so the node renders
              // `[data-initiative-status="merged"]` without needing a real
              // merge+closure round-trip (that's covered by the orchestrator
              // suite: queue.test.ts, closure.test.ts, finalize-merged.test.ts).
              INIT_MERGED = `INIT-${DATE}-e2e-merged-state`;
              mkdirSync(QDIR('merged'), { recursive: true });
              writeFileSync(join(QDIR('merged'), `${INIT_MERGED}.md`), [
                '---', `initiative_id: ${INIT_MERGED}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
                `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 8', 'cost_budget_usd: 12',
                'origin: architect',
                '---', '', '# mdtoc — `--json` output mode', '',
                'Given `mdtoc --json` runs against a repo, when the PR merges, then the roadmap card reflects the merged-but-not-yet-reflected state.',
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
                await caption(page, 'Per-project Roadmap — a completion-time canvas: initiatives that really finished sit on a day-by-day time axis; pending work continues right of the now-line, banded by dependency-feasibility (no invented dates). Click a card to open its detail drawer.');
                await frame(page, 'r6-0-roadmap-tab', 'W6-RV-2 — per-project Roadmap tab: the completion-time canvas, edges drawn prerequisite → dependent', { key: true });
                const roadmapSection = await page.evaluate(() =>
                  document.querySelector('[data-section="project-roadmap"]') !== null);
                check(roadmapSection, 'roadmap: [data-section="project-roadmap"] rendered');
                // W6-RV-2: the canvas container + one [data-roadmap-node] per initiative.
                const canvasPresent = await page.evaluate(() =>
                  document.querySelector('[data-roadmap-canvas]') !== null);
                check(canvasPresent, 'roadmap: the canvas container [data-roadmap-canvas] renders');
                const initCount = await page.evaluate(() =>
                  document.querySelectorAll('[data-roadmap-canvas] [data-roadmap-node]').length);
                check(initCount >= 1, `roadmap: ≥1 [data-roadmap-node] on the canvas (got ${initCount})`);
                // W6-RV-2: the canvas still draws one edge per (prerequisite → dependent)
                // pair (faint at rest, highlighted on selection) — a correctness proof
                // the serpentine arcs carried ZERO data-* for, carried forward from R4-13.
                // The seeded INIT_DEV depends on the completed INIT (both in the
                // roadmap), so a genuine [data-dep-edge] must render with
                // data-dep-from=prerequisite / data-dep-to=dependent.
                const edgeInfo = await page.evaluate((ids) => {
                  const edges = Array.from(document.querySelectorAll('[data-roadmap-canvas] [data-dep-edge]'));
                  return {
                    count: edges.length,
                    matched: edges.some((e) =>
                      e.getAttribute('data-dep-from') === ids.from &&
                      e.getAttribute('data-dep-to') === ids.to),
                  };
                }, { from: INIT, to: INIT_DEV });
                check(edgeInfo.count >= 1, `roadmap: the canvas renders ≥1 dependency edge [data-dep-edge] (got ${edgeInfo.count})`);
                check(edgeInfo.matched, `roadmap: the ${INIT} → ${INIT_DEV} dependency renders a [data-dep-edge] with data-dep-from=prerequisite / data-dep-to=dependent`);
                // R4-11-F1: the seeded `merged/` initiative renders its own node with
                // the merged status — proves the roadmap surfaces the transient
                // pass-through state rather than skipping straight to done/failed.
                const mergedStatus = await page.evaluate((id) =>
                  document.querySelector(`[data-roadmap-node][data-initiative-id="${id}"]`)?.getAttribute('data-initiative-status') ?? null,
                  INIT_MERGED);
                check(mergedStatus === 'merged', `roadmap: seeded merged/ initiative renders [data-initiative-status="merged"] (got ${mergedStatus})`);
                // R4-15-F1: the mockup's "trigger: manual, from a project page" entry into
                // an architect planning session. It must be a real control, not a label —
                // clicking it reveals the ONE shipped start-a-session surface (NewIdeaBox),
                // pre-seeded with THIS project, so the operator never retypes it.
                const entryState = await page.evaluate(() => {
                  const el = document.querySelector('[data-component="project-architect-entry"]');
                  return el === null ? null : el.getAttribute('data-architect-entry-open');
                });
                check(entryState === 'false',
                  `R4-15: the project page offers a collapsed architect-session entry (got ${entryState === null ? 'no [data-component="project-architect-entry"]' : `data-architect-entry-open="${entryState}"`})`);
                // The resume probe must actually SETTLE — a permanently-'pending'
                // attribute would make "still loading" indistinguishable from "no
                // in-flight session", which is the whole reason it exists.
                await page.waitForSelector('[data-architect-resume-probe="settled"]', { timeout: 8000 }).catch(() => {});
                const probe = await page.evaluate(() =>
                  document.querySelector('[data-component="project-architect-entry"]')?.getAttribute('data-architect-resume-probe') ?? null);
                check(probe === 'settled', `R4-15: the in-flight-session probe settles (got ${probe})`);
                await page.locator('[data-action="plan-with-architect"]').first().click().catch(() => {});
                await page.waitForSelector('[data-component="project-architect-entry"] [data-section="new-idea"]', { timeout: 8000 }).catch(() => {});
                const revealed = await page.evaluate((project) => {
                  const root = document.querySelector('[data-component="project-architect-entry"]');
                  if (!root) return null;
                  const projectField = root.querySelector('[data-section="new-idea"] [data-field="project"]');
                  return {
                    open: root.getAttribute('data-architect-entry-open'),
                    hasIdeaBox: root.querySelector('[data-section="new-idea"]') !== null,
                    projectValue: projectField ? projectField.value : null,
                    matchesProject: projectField ? projectField.value === project : false,
                  };
                }, PROJECT);
                check(revealed !== null && revealed.open === 'true' && revealed.hasIdeaBox,
                  `R4-15: "Plan with Architect" reveals the real start-a-session surface (got ${JSON.stringify(revealed)})`);
                check(revealed !== null && revealed.matchesProject,
                  `R4-15: the revealed idea box is pre-seeded with this project (expected "${PROJECT}", got "${revealed ? revealed.projectValue : 'none'}")`);
                // The revealed form must be dismissible — an affordance that opens with no
                // way back is a dead end, and the beats after this one drive the same page.
                await page.locator('[data-action="cancel-plan-with-architect"]').first().click().catch(() => {});
                const collapsed = await page.evaluate(() =>
                  document.querySelector('[data-component="project-architect-entry"]')?.getAttribute('data-architect-entry-open') ?? null);
                check(collapsed === 'false', `R4-15: the revealed idea box collapses again (got ${collapsed})`);
                if (roadmapSeeded) {
                  // W6-RV-2: the canvas card is ALWAYS collapsed (no more inline
                  // expand — canvas geometry never reflows on selection); clicking
                  // it selects the initiative and opens the RIGHT PUSH DRAWER
                  // instead. The drawer hosts InitiativeDetail (RV-1's affordances,
                  // byte-identical) under [data-drawer-initiative]. Click INIT's
                  // card (safe — it carries no destructive trigger) and assert its
                  // real work items render inside the opened drawer.
                  const initNode = `[data-roadmap-node][data-initiative-id="${INIT}"]`;
                  await page.locator(initNode).click().catch(() => {});
                  await page.waitForSelector(`[data-drawer-initiative="${INIT}"]`, { timeout: 5000 }).catch(() => {});
                  const drawerOpen = await page.evaluate(() =>
                    document.querySelector('[data-roadmap-drawer]')?.getAttribute('data-drawer-open') ?? null);
                  check(drawerOpen === 'true', `roadmap: clicking a card opens the drawer [data-drawer-open="true"] (got ${drawerOpen})`);
                  const drawerSel = `[data-drawer-initiative="${INIT}"]`;
                  const wiCount = await page.evaluate((sel) =>
                    document.querySelectorAll(`${sel} [data-work-item-id]`).length, drawerSel);
                  check(wiCount >= 1, `roadmap: the ${INIT} drawer lists its real work items (≥1 [data-work-item-id], got ${wiCount})`);
                  await frame(page, 'r6-0b-popover', 'W6-RV-2 — a card\'s detail drawer: its real work items, run links, and demo tie-in — canvas geometry unchanged behind it');
                  // R4-07-F3 (entrypoint fixed W6-B10): the drawer links to the
                  // project's demo surface — click it and land HONESTLY on the
                  // dedicated demo-builder session screen or its kickoff
                  // (resolveDemoEntryHref, lib/demo-entry-view.ts), never the
                  // old fake tab-switch. This fixture project has no demo
                  // session yet, so it lands on the generic kickoff screen,
                  // prefilled with the project and this initiative for context.
                  const demoLink = page.locator(`${drawerSel} [data-link="demo-builder"]`);
                  const demoLinkPresent = (await demoLink.count()) >= 1;
                  check(demoLinkPresent, 'roadmap: the drawer carries [data-link="demo-builder"] (R4-07-F3 demo tie-in)');
                  if (demoLinkPresent) {
                    await demoLink.first().click().catch(() => {});
                    const kickoffReady = await page.waitForFunction(
                      () => document.querySelector('[data-page="session-kickoff"]')?.getAttribute('data-page-ready') === 'true',
                      null, { timeout: 15000 },
                    ).then(() => true).catch(() => false);
                    check(kickoffReady, 'roadmap: demo-builder link lands on the generic kickoff screen ([data-page="session-kickoff"])');
                    const prefilledProject = await page.locator('[data-field="kickoff-project"]').inputValue().catch(() => '');
                    check(prefilledProject === PROJECT, `roadmap: the kickoff screen prefills ?project= from the link (got "${prefilledProject}")`);
                    const initiativeContext = await page.locator('[data-section="kickoff-initiative-context"]').count() > 0;
                    check(initiativeContext, 'roadmap: the kickoff screen shows the originating initiative as context ([data-section="kickoff-initiative-context"])');
                    await frame(page, 'r6-0c-demo-link', 'W6-B10 — the drawer links honestly to the demo kickoff screen, prefilled with the project + initiative');
                    // Return to the project page's roadmap tab — a real
                    // navigation happened (the old fake tab-switch didn't),
                    // so the following assertions/beats need a fresh page.goto.
                    await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
                    await page.waitForFunction(
                      () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                      null, { timeout: 15000 },
                    ).catch(() => {});
                    await page.locator('[data-tab="roadmap"]').click().catch(() => {});
                    await sleep(500);
                  }
                }
              } else {
                check(false, 'roadmap: Roadmap tab button [data-tab="roadmap"] present on project page');
              }

              // Clean up the seeded merged/ initiative — self-contained to this beat,
              // unlike INIT_DEV which the next beat still needs.
              try { rmSync(join(QDIR('merged'), `${INIT_MERGED}.md`), { force: true }); } catch { /* */ }

        },
      },
      {
        id: 'roadmap-canvas-controls',
        title: 'Canvas pan/zoom toolbar (W6-RV-2)',
        narration: 'Every canvas card is now permanently collapsed — geometry never reflows on selection, so RV-1\'s per-node collapse-all/expand-all toolbar has nothing left to bulk-toggle. Its replacement is a canvas-wide view reset: zoom in/out, fit-to-view, and jump-to-now — the same "one click, everything resets to a sane baseline" affordance, ported onto the new surface.',
        drive: async (ctx) => {
              const { page, check, frame } = ctx;
              // ── W6-RV-2: canvas pan/zoom toolbar ──────────────────────────────────────
              console.log('\n[W6-RV-2] Canvas pan/zoom toolbar');

              await page.waitForSelector('[data-roadmap-canvas]', { timeout: 10000 }).catch(() => {});

              const zoomInBtn = page.locator('[data-action="roadmap-zoom-in"]');
              const zoomOutBtn = page.locator('[data-action="roadmap-zoom-out"]');
              const fitBtn = page.locator('[data-action="roadmap-zoom-fit"]');
              const nowBtn = page.locator('[data-action="roadmap-jump-now"]');
              check((await zoomInBtn.count()) > 0, 'roadmap: the canvas toolbar carries [data-action="roadmap-zoom-in"]');
              check((await zoomOutBtn.count()) > 0, 'roadmap: the canvas toolbar carries [data-action="roadmap-zoom-out"]');
              check((await fitBtn.count()) > 0, 'roadmap: the canvas toolbar carries [data-action="roadmap-zoom-fit"]');
              check((await nowBtn.count()) > 0, 'roadmap: the canvas toolbar carries [data-action="roadmap-jump-now"]');

              // data-canvas-scale is the real view state (not a label) — prove a
              // click genuinely changes it, the same "bulk toggle actually reaches
              // real state" proof the old collapse-all/expand-all beat pinned.
              const scaleBefore = await page.locator('[data-roadmap-canvas]').getAttribute('data-canvas-scale');
              await zoomInBtn.click();
              await sleep(200);
              const scaleAfterZoomIn = await page.locator('[data-roadmap-canvas]').getAttribute('data-canvas-scale');
              check(scaleAfterZoomIn !== scaleBefore, `roadmap: zoom-in changes [data-canvas-scale] (before ${scaleBefore}, after ${scaleAfterZoomIn})`);
              await caption(page, 'Zoom in on the completion-time canvas — the amber now-line and the projected zone stay anchored as the view scales.');
              await frame(page, 'r6-2-zoom-in', 'W6-RV-2 — zooming the canvas changes real view state (data-canvas-scale)', { key: true });

              await fitBtn.click();
              await sleep(200);
              const scaleAfterFit = await page.locator('[data-roadmap-canvas]').getAttribute('data-canvas-scale');
              check(!!scaleAfterFit, `roadmap: fit-to-view resets [data-canvas-scale] to a real value (got ${scaleAfterFit})`);
              await caption(page, 'Fit resets the canvas to show every initiative — done work on its real time axis, pending work banded right of the now-line.');
              await frame(page, 'r6-2b-fit', 'W6-RV-2 — fit-to-view resets the canvas to a sane baseline');

              await nowBtn.click();
              await sleep(200);
              await caption(page, 'Jump-to-now pans straight to the amber now-line, the boundary between real history and projected work.');
              await frame(page, 'r6-2c-jump-now', 'W6-RV-2 — jump-to-now pans the canvas to the amber now-line');

              // A real wheel dispatch over the viewport — proves the canvas
              // zooms on scroll (not just the toolbar buttons above), and
              // implicitly that the viewport's wheel handler is attached
              // NATIVELY with { passive: false } (React's root wheel
              // listener is passive, so a JSX onWheel's preventDefault()
              // would be a silent no-op and the page would scroll under the
              // canvas instead of zooming it).
              const viewportBox = await page.locator('[data-roadmap-viewport]').boundingBox();
              if (viewportBox) {
                const scaleBeforeWheel = await page.locator('[data-roadmap-canvas]').getAttribute('data-canvas-scale');
                await page.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2);
                await page.mouse.wheel(0, -200); // negative deltaY = zoom in
                await sleep(200);
                const scaleAfterWheel = await page.locator('[data-roadmap-canvas]').getAttribute('data-canvas-scale');
                check(scaleAfterWheel !== scaleBeforeWheel, `roadmap: wheel-to-zoom changes [data-canvas-scale] (before ${scaleBeforeWheel}, after ${scaleAfterWheel})`);
              } else {
                check(false, 'roadmap: [data-roadmap-viewport] has a bounding box to dispatch a wheel event over');
              }

        },
      },
      {
        id: 'roadmap-plan-trigger',
        title: 'Plan trigger + blocked-until-planned lock (R4-11-F2)',
        narration: 'A WI-less pending initiative shows a "Plan" trigger instead of "Start development" — a blocked-until-planned lock withholds development until it\'s actually decomposed. Clicking Plan repoints the manifest at the forge-architect flow so a real PM pass can produce work items.',
        drive: async (ctx) => {
              const { page, check, frame } = ctx;
              // ── R4-11-F2: Plan trigger + blocked-until-planned lock ──────────────────
              console.log('\n[R4-11-F2] Plan trigger + blocked-until-planned lock');

              // W6-RV-2: canvas cards are ALWAYS collapsed (data-plan-state lives on
              // the [data-roadmap-node] button itself, so this locator still resolves
              // to the real card — unchanged). Clicking the card selects it and opens
              // the drawer instead of inline-expanding; the Plan affordance lives
              // inside the drawer now.
              const planCard = page.locator(`[data-initiative-id="${INIT_PLAN}"][data-plan-state]`);
              const planCardPresent = (await planCard.count()) > 0;
              if (planCardPresent) {
                const initialState = await planCard.getAttribute('data-plan-state');
                check(initialState === 'unplanned', `roadmap: a WI-less pending initiative renders [data-plan-state="unplanned"] (got ${initialState})`);

                await planCard.scrollIntoViewIfNeeded().catch(() => {});
                await planCard.click().catch(() => {});
                await page.waitForSelector(`[data-drawer-initiative="${INIT_PLAN}"]`, { timeout: 5000 }).catch(() => {});
                const drawerSel = `[data-drawer-initiative="${INIT_PLAN}"]`;

                const lockCount = await page.locator(`${drawerSel} [data-section="initiative-blocked-until-planned"]`).count();
                check(lockCount > 0, 'roadmap: the blocked-until-planned lock badge is present in the drawer for a WI-less initiative');

                const developCount = await page.locator(`${drawerSel} [data-action="start-development"]`).count();
                check(developCount === 0, 'roadmap: "start development" is withheld in the drawer until the initiative is planned');

                const planBtn = page.locator(`${drawerSel} [data-action="plan-initiative"]`);
                check((await planBtn.count()) > 0, `roadmap: [data-action="plan-initiative"] present in the drawer for ${INIT_PLAN}`);
                await caption(page, 'A WI-less initiative\'s drawer offers "Plan" instead of "Start development" — the blocked-until-planned lock withholds development until it is decomposed.');
                await frame(page, 'r4-11-2-plan-trigger', 'R4-11-F2 — the Plan trigger + blocked-until-planned lock, now in the drawer', { key: true });

                await planBtn.click();
                await page.waitForSelector(`[data-initiative-id="${INIT_PLAN}"][data-plan-state="planning"]`, { timeout: 12000 }).catch(() => {});
                const afterState = await planCard.getAttribute('data-plan-state');
                check(afterState === 'planning', `plan-initiative transitions to [data-plan-state="planning"] (got ${afterState})`);
                await frame(page, 'r4-11-2b-planning-started', 'R4-11-F2 — planning started: the initiative will be decomposed into work items', { key: true });

                // The manifest is now claimable on the forge-architect flow. The
                // UI reaches [data-plan-state="planning"] as soon as the POST is
                // in flight, but the bridge's manifest write settles a beat later
                // — poll the on-disk repoint rather than racing it (the write is
                // synchronous in enqueuePlanRun; this only absorbs fs/roundtrip lag).
                let planManifest = '';
                for (let i = 0; i < 20; i++) {
                  planManifest = readFileSync(join(QDIR('pending'), `${INIT_PLAN}.md`), 'utf8');
                  if (/^flow_id:\s*forge-architect\s*$/m.test(planManifest)) break;
                  await sleep(150);
                }
                check(/^flow_id:\s*forge-architect\s*$/m.test(planManifest), 'plan-initiative repoints the manifest at the forge-architect flow');
              } else {
                check(false, `roadmap: [data-action="plan-initiative"] present on the WI-less initiative ${INIT_PLAN}`);
              }

              // Self-contained to this beat — clean up the seeded fixture.
              try { rmSync(join(QDIR('pending'), `${INIT_PLAN}.md`), { force: true }); } catch { /* */ }

        },
      },
      {
        id: 'roadmap-start-development',
        title: 'Start development trigger (DEC-3)',
        narration: 'A decomposed-but-not-yet-built initiative offers "Start development" on its drawer; clicking it repoints the manifest at the forge-develop flow and threads the architect-minted cycle id — the roadmap card itself is the trigger, not a separate queue command.',
        drive: async (ctx) => {
              const { page, watch, browser, recordClip, check, frame } = ctx;
              // ── R6.1: Start development — the trigger flips the manifest onto forge-develop ──
              console.log('\n[R6.1] Start development trigger (DEC-3)');

              // Clip: a fresh, isolated context drives the roadmap the way an operator
              // would — dwell on the completion-time canvas (done work on its real
              // time axis, edges drawn prerequisite → dependent), select the
              // completed initiative's card (opens its drawer, then closes it), then
              // select the pending initiative and settle on its "Start development"
              // trigger inside the drawer, focused and ready to fire.
              // SAFETY (S5): the real trigger repoints ${INIT_DEV}'s manifest onto the
              // forge-develop flow — a live scheduler (`forge studio` spawns `serve` for
              // real; only FORGE_ARCHITECT_NO_SPAWN-guarded routes are stubbed) polls
              // _queue/pending every 5s and would claim it, kicking off a REAL dev-loop
              // cycle. The main beat below already performs that click exactly once (on
              // the outer `page`) and its own tail already cleans up the manifest it
              // creates — reusing it here would be a second live-fire window for a demo
              // clip. W6-RV-2: canvas cards never inline-expand, so this clip selects
              // the pending card (opens its drawer) and only SCROLLS to the button
              // inside it, never clicks it. The single real click stays owned by the
              // code that follows, on the outer page.
              await recordClip(browser, watch, 'roadmap-drive', `/projects/${PROJECT}`, async (p) => {
                await p.waitForFunction(
                  () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                ).catch(() => {});
                await p.locator('button[data-tab="roadmap"]').click().catch(() => {});
                await p.waitForSelector('[data-roadmap-canvas] [data-roadmap-node]', { timeout: 10000 }).catch(() => {});
                await sleep(WORK); // dwell on the completion-time canvas + its prerequisite → dependent edges
                // Select the completed initiative's card (safe — no destructive
                // trigger): opens its drawer, then close it again.
                await p.locator(`[data-roadmap-node][data-initiative-id="${INIT}"]`).click().catch(() => {});
                await sleep(THINK);
                await p.locator('[data-action="drawer-close"]').click().catch(() => {});
                await sleep(WORK);
                // Select the pending node too — its Start-development button lives
                // inside its drawer.
                await p.locator(`[data-roadmap-node][data-initiative-id="${INIT_DEV}"]`).click().catch(() => {});
                await p.waitForSelector(`[data-drawer-initiative="${INIT_DEV}"]`, { timeout: 5000 }).catch(() => {});
                await sleep(THINK);
                // Settle on the pending initiative's "Start development" trigger — we
                // only SCROLL to the button, never click it (see SAFETY note above).
                await p.locator(`[data-drawer-initiative="${INIT_DEV}"] [data-action="start-development"]`)
                  .scrollIntoViewIfNeeded().catch(() => {});
                await sleep(WORK);
              }, {
                readySel: '[data-page="projects"]',
                caption: 'The operator reads the completion-time canvas, opens a finished initiative’s drawer, then eyes the "Start development" trigger on the initiative queued up next',
              });

              // W6-RV-2: canvas cards never inline-expand — click the card to select
              // it and open its drawer, then find Start-development inside the
              // drawer (not the card). The card is uniquely identified by
              // data-develop-state (the button also carries data-initiative-id, so
              // select the button explicitly to avoid a match clash).
              const devCard = page.locator(`[data-initiative-id="${INIT_DEV}"][data-develop-state]`);
              const devCardPresent = (await devCard.count()) > 0;
              if (devCardPresent) {
                check(
                  await devCard.getAttribute('data-initiative-status') === 'pending',
                  'roadmap: the decomposed initiative is pending (develop-able)',
                );
                await devCard.scrollIntoViewIfNeeded().catch(() => {});
                await devCard.click().catch(() => {});
                await page.waitForSelector(`[data-drawer-initiative="${INIT_DEV}"]`, { timeout: 5000 }).catch(() => {});
                const drawerSel = `[data-drawer-initiative="${INIT_DEV}"]`;
                const startBtn = page.locator(`${drawerSel} [data-action="start-development"]`);
                check((await startBtn.count()) > 0, `roadmap: [data-action="start-development"] present in the drawer for ${INIT_DEV}`);
                await caption(page, 'A decomposed, dependency-satisfied initiative\'s drawer offers "Start development" — it runs the Forge Develop flow.');
                await frame(page, 'r6-1-start-development', 'W6-RV-2 — the "start development" trigger, now in the drawer');
                await startBtn.click();
                await page.waitForSelector(`[data-initiative-id="${INIT_DEV}"][data-develop-state="started"]`, { timeout: 12000 }).catch(() => {});
                const devState = await devCard.getAttribute('data-develop-state');
                check(devState === 'started', `start-development enqueues the develop run (data-develop-state=${devState})`);
                await frame(page, 'r6-1b-development-started', 'R6 — development started: dev → demo → adversarial-review → verdict, ending at a PR for review', { key: true });
                // The manifest is now claimable on the forge-develop flow, threading its cycle_id.
                // Poll the repoint (same read-after-write settle as the plan trigger above).
                let devManifest = '';
                for (let i = 0; i < 20; i++) {
                  devManifest = readFileSync(join(QDIR('pending'), `${INIT_DEV}.md`), 'utf8');
                  if (/^flow_id:\s*forge-develop\s*$/m.test(devManifest)) break;
                  await sleep(150);
                }
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
              try { rmSync(join(FORGE_ROOT, '_logs', DEV_CYCLE_ID), { recursive: true, force: true }); } catch { /* */ }

        },
      },
      {
        id: 'roadmap-recovery',
        title: 'Recovery affordances in a stuck initiative\'s drawer (R4-11-T3)',
        narration: 'A recoverable initiative — in-flight, ready-for-review, or failed (never `merged`, a transient pass-through) — gets inspect/requeue/abandon in its roadmap drawer, folded off the retired standalone /recovery page. Inspect reads the preserved worktree; under the harness\'s dry-bridge safety seam, requeue/abandon correctly refuse rather than perform a real git operation — the affordance\'s honest failure path, not a faked success.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              // ── R4-11-T3: recovery affordances on the roadmap card ───────────────────
              console.log('\n[R4-11-T3] Recovery affordances on a stuck initiative\'s card');

              // Grounded (a real cycle can genuinely land in `_queue/failed/` after
              // exhausting its retry budget — see orchestrator/queue.ts): seed a
              // minimal failed manifest for this project, self-contained to this beat.
              INIT_RECOVERY = `INIT-${DATE}-e2e-recovery-surface`;
              mkdirSync(QDIR('failed'), { recursive: true });
              writeFileSync(join(QDIR('failed'), `${INIT_RECOVERY}.md`), [
                '---', `initiative_id: ${INIT_RECOVERY}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
                `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 8', 'cost_budget_usd: 12', 'phase: pending',
                'origin: architect',
                '---', '', '# mdtoc — `--strict` mode (fail on any drift)', '',
                'Given `mdtoc --strict` runs against a repo with drifted TOCs, when it is invoked, then it exits non-zero listing every drifted file.',
              ].join('\n'));

              // Reload the roadmap tab fresh so the just-seeded failed/ manifest
              // is picked up (the earlier beats' fetch already happened).
              await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 },
              ).catch(() => {});
              await page.locator('button[data-tab="roadmap"]').click().catch(() => {});
              await sleep(1500);

              // W6-RV-2: the recovery block now lives in the DRAWER (not the card) —
              // click the card to select it and open the drawer, then look for
              // [data-recovery-item] inside [data-drawer-initiative].
              const recoveryNode = page.locator(`[data-roadmap-node][data-initiative-id="${INIT_RECOVERY}"]`);
              const recoveryNodePresent = (await recoveryNode.count()) > 0;
              if (recoveryNodePresent) {
                await recoveryNode.scrollIntoViewIfNeeded().catch(() => {});
                await recoveryNode.click().catch(() => {});
                await page.waitForSelector(`[data-drawer-initiative="${INIT_RECOVERY}"]`, { timeout: 5000 }).catch(() => {});
                const drawerSel = `[data-drawer-initiative="${INIT_RECOVERY}"]`;
                const recoveryItem = page.locator(`${drawerSel} [data-recovery-item][data-recovery-initiative="${INIT_RECOVERY}"]`);
                const recoveryItemPresent = (await recoveryItem.count()) > 0;
                check(recoveryItemPresent, `roadmap: [data-recovery-item] present in the drawer for the seeded failed initiative ${INIT_RECOVERY}`);
                if (recoveryItemPresent) {
                  const status = await recoveryItem.getAttribute('data-recovery-status');
                  check(status === 'failed', `roadmap: the failed initiative's drawer renders [data-recovery-status="failed"] (got ${status})`);
                  const attemptCount = await recoveryItem.getAttribute('data-recovery-attempt-count');
                  check(!!attemptCount && Number(attemptCount) >= 1, `roadmap: [data-recovery-attempt-count] present (got ${attemptCount})`);

                  await caption(page, 'A recoverable (failed) initiative\'s drawer offers Inspect / Requeue / Abandon — no separate /recovery page.');
                  await frame(page, 'r4-11-t3-0-recovery-affordances', 'R4-11-T3 — inspect/requeue/abandon on a recoverable initiative\'s drawer', { key: true });

                  // Inspect — read-only; asserts the detail section renders for this initiative.
                  await recoveryItem.locator('[data-action="recovery-inspect"]').click();
                  await page.waitForSelector(`[data-section="recovery-detail"][data-recovery-detail-initiative="${INIT_RECOVERY}"]`, { timeout: 8000 }).catch(() => {});
                  const detailCount = await recoveryItem.locator(`[data-section="recovery-detail"][data-recovery-detail-initiative="${INIT_RECOVERY}"]`).count();
                  check(detailCount > 0, 'roadmap: recovery-inspect renders [data-section="recovery-detail"] for the initiative');
                  await frame(page, 'r4-11-t3-1-inspect', 'R4-11-T3 — Inspect reveals the preserved worktree state (none here — the fixture never ran a real cycle)');

                  // Requeue — under the harness's FORGE_DRY_BRIDGE seam this route hard-refuses
                  // (real git ops); assert the HONEST refusal renders, not a faked success, and
                  // that the manifest genuinely never moved off `_queue/failed/`.
                  await recoveryItem.locator('[data-action="recovery-requeue"]').click();
                  await page.waitForSelector(`[data-recovery-initiative="${INIT_RECOVERY}"] [data-recovery-note]`, { timeout: 8000 }).catch(() => {});
                  const requeueNote = await recoveryItem.locator('[data-recovery-note]').textContent().catch(() => null);
                  check(!!requeueNote && /requeue failed/.test(requeueNote), `roadmap: recovery-requeue honestly reports the dry-bridge refusal (got ${requeueNote})`);
                  check(existsSync(join(QDIR('failed'), `${INIT_RECOVERY}.md`)), 'roadmap: the manifest stays in failed/ — dry-bridge genuinely refused the git ops, not just the UI message');
                  await frame(page, 'r4-11-t3-2-requeue-refused', 'R4-11-T3 — under the harness\'s safety seam, requeue honestly refuses rather than faking success');

                  // Abandon — same dry-bridge refusal path.
                  await recoveryItem.locator('[data-action="recovery-abandon"]').click();
                  await sleep(500);
                  const abandonNote = await recoveryItem.locator('[data-recovery-note]').textContent().catch(() => null);
                  check(!!abandonNote && /abandon failed/.test(abandonNote), `roadmap: recovery-abandon honestly reports the dry-bridge refusal (got ${abandonNote})`);
                }
              } else {
                check(false, `roadmap: [data-roadmap-node] present for the seeded failed initiative ${INIT_RECOVERY}`);
              }

              try { rmSync(join(QDIR('failed'), `${INIT_RECOVERY}.md`), { force: true }); } catch { /* */ }

        },
      },
    ],
});
