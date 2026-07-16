import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  cleanFirstFlow, J3_FLOW_DIR, waitForFile, readSavedFlowNodes, J3_FLOW,
  readSavedFlow, waitForFlowVersion, THINK, cleanFirstFlowRun, QDIR, J5_INIT,
  J4_PROJECT, J5_CYCLE_ID, j5Event, parseFlowStructure, SEED_FLOW_PATH,
  SCRATCH_FLOW_DIR, SCRATCH_FLOW, FORGE_ROOT, caption, ACT, READ,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const journey = defineJourney({
    id: 'flows-author',
    title: 'Author a flow',
    story: 'Author a cycle flow as data: string agents into a new flow, give it seeded work, and prove a from-scratch flow is structurally identical to the production seed.',
    beats: [
      {
        id: 'flows-author-new-flow',
        title: 'String plan/dev/review into a flow (new-flow builder)',
        narration: 'String plan/dev/review into a flow (new-flow builder)',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              // ── J3: STRING THE THREE AGENTS INTO A FLOW (new-flow builder) ────────────
              // From the library "+ New Flow" → canvas seeded from the basic starter
              // (plan → dev → review + verdict gate). Name it, save (slug derived), and
              // prove: lint-green, runnable, and node positions PERSIST across reload.
              console.log('\n[J3] String plan/dev/review into a flow (new-flow builder)');
              cleanFirstFlow();
              // discoverable creation: the library "+ New Flow" CTA is a real enabled link
              await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const newFlowCta = await page.evaluate(() => {
                const el = document.querySelector('[data-action="new-flow"]');
                return el ? { href: el.getAttribute('href'), disabled: el.hasAttribute('disabled') } : null;
              });
              check(newFlowCta !== null && !newFlowCta.disabled && (newFlowCta.href ?? '').includes('/flows/new'),
                'J3: library "+ New Flow" CTA is enabled and routes to the flow builder');

              await page.goto(watch.uiUrl + '/flows/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') === 'build',
                null, { timeout: 15000 },
              ).catch(() => {});
              // Seeded from the basic starter: ≥3 nodes on the canvas.
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              const seededNodeCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10));
              check(seededNodeCount >= 3, `J3: new-flow canvas seeded from the basic starter (≥3 nodes, got ${seededNodeCount})`);
              const flowAdvCollapsed = await page.evaluate(() => {
                const d = document.querySelector('[data-section="flow-advanced"]');
                return d ? !(d).open : false;
              });
              check(flowAdvCollapsed, 'J3: project/KB/triggers collapsed under Advanced by default (progressive disclosure)');
              await frame(page, 'j3-0-new-flow-seeded', 'J3 — new flow seeded from the basic starter (plan → dev → review)');

              // Name the flow + save (slug derived from name → /flows/my-first-flow).
              await page.locator('[data-field="flow-name"]').fill('My First Flow');
              await page.locator('[data-action="save-flow"]').click();
              const flowYamlPath = join(J3_FLOW_DIR, 'flow.yaml');
              const flowLanded = await waitForFile(flowYamlPath, 12000);
              check(flowLanded, `J3: saving the new flow writes studio/flows/${J3_FLOW}/flow.yaml`);

              // Persistence: every node carries a numeric x/y (the J3 schema addition).
              const nodesV1 = readSavedFlowNodes(J3_FLOW);
              const allHaveXY = nodesV1.length >= 3 && nodesV1.every((n) => typeof n.x === 'number' && typeof n.y === 'number');
              check(allHaveXY, `J3: saved flow persists node positions (every node has numeric x/y; ${nodesV1.length} nodes)`);
              const gatePresent = nodesV1.some((n) => typeof n.gate === 'string');
              check(gatePresent, 'J3: authored flow keeps the human verdict gate (zero-gate flows are rejected)');

              // lint validates the authored flow; it is runnable.
              let j3LintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                j3LintOk = true;
              } catch (e) {
                console.error(`  [studio lint J3] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(j3LintOk, 'J3: `forge studio lint` validates the authored flow (exit 0)');

              // Saving a new flow auto-redirects to its real route — wait for that
              // navigation rather than racing it with our own goto.
              await page.waitForURL(new RegExp(`/flows/${J3_FLOW}`), { timeout: 15000 }).catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const j3CanStart = await page.evaluate(() =>
                document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-can-start'));
              check(j3CanStart === 'true', `J3: authored flow is runnable (data-can-start="true", got "${j3CanStart}")`);

              // Position round-trip: drag a node, save, reload, save again — the dragged
              // position must survive (proves x/y are honoured on load, not recomputed).
              await page.locator('[data-page="flow-monitor"] .tab', { hasText: 'BUILD' }).first().click().catch(() => {});
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              const dragId = nodesV1[0]?.id ?? 'plan';
              const x0 = nodesV1.find((n) => n.id === dragId)?.x ?? 0;
              const vBeforeDrag = readSavedFlow(J3_FLOW).version;
              let dragged = false;
              try {
                const nodeEl = page.locator(`.react-flow__node:has([data-node-id="${dragId}"])`).first();
                const box = await nodeEl.boundingBox();
                if (box) {
                  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                  await page.mouse.down();
                  await page.mouse.move(box.x + box.width / 2 + 230, box.y + box.height / 2 + 150, { steps: 12 });
                  await page.mouse.up();
                  dragged = true;
                }
              } catch { /* drag unavailable */ }
              await sleep(THINK);
              await page.locator('[data-action="save-flow"]').click();
              // Wait for the async save to land (version bumps) — not a fixed sleep.
              await waitForFlowVersion(J3_FLOW, vBeforeDrag + 1, 15000);
              const xDrag = readSavedFlow(J3_FLOW).nodes.find((n) => n.id === dragId)?.x ?? x0;
              check(dragged && Math.abs(xDrag - x0) > 40, `J3: dragging node "${dragId}" moved + saved its position (x ${x0}→${xDrag})`);
              await frame(page, 'j3-1-flow-arranged', 'J3 — authored flow, node hand-arranged on the canvas');

              // Reload + save again (no move): the dragged position survives the reload
              // (proves persisted x/y are honoured on load, not recomputed by autolayout).
              const vBeforeReload = readSavedFlow(J3_FLOW).version;
              await page.goto(watch.uiUrl + `/flows/${J3_FLOW}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              // Stage C — a no-runs flow monitor shows the per-flow kickoff surface (FlowKickoff).
              const j3KickoffKind = await page.evaluate(() => {
                const el = document.querySelector('[data-section="flow-kickoff"]');
                return el ? el.getAttribute('data-kickoff-kind') : null;
              });
              check(j3KickoffKind !== null, `J3: no-runs flow shows the kickoff surface ([data-kickoff-kind]="${j3KickoffKind}")`);
              await page.locator('[data-page="flow-monitor"] .tab', { hasText: 'BUILD' }).first().click().catch(() => {});
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              await page.locator('[data-action="save-flow"]').click();
              await waitForFlowVersion(J3_FLOW, vBeforeReload + 1, 15000);
              const xReload = readSavedFlow(J3_FLOW).nodes.find((n) => n.id === dragId)?.x ?? -9999;
              check(Math.abs(xReload - xDrag) < 30, `J3: node position PERSISTS across reload (x ${xDrag} → ${xReload})`);
              await frame(page, 'j3-2-flow-persisted', 'J3 — node positions persist across reload (authored flow is durable)');

        },
      },
      {
        id: 'flows-author-seeded-run',
        title: 'Give the authored flow work (seeded run on my-first-flow)',
        narration: 'Give the authored flow work (seeded run on my-first-flow)',
        drive: async (ctx) => {
              const { page, watch, check, frame, expectPhaseCost } = ctx;
              // ── J5: GIVE THE AUTHORED FLOW WORK (seeded run) ──────────────────────────
              // The user's authored flow (my-first-flow) is given work against the
              // onboarded project. Seeded (no real agents), this proves the monitor
              // surfaces a USER-AUTHORED flow's run — its plan→dev→review hexes progress
              // and the run parks at the verdict gate. (The full mdtoc idea→reflect
              // path is proven separately by the RUN act below.)
              console.log('\n[J5] Give the authored flow work (seeded run on my-first-flow)');
              cleanFirstFlowRun();
              // Seed a gated run: manifest (flow_id binds it to the authored flow) + events.
              mkdirSync(QDIR('ready-for-review'), { recursive: true });
              writeFileSync(join(QDIR('ready-for-review'), `${J5_INIT}.md`), [
                '---',
                `initiative_id: ${J5_INIT}`,
                `project: ${J4_PROJECT}`,
                `project_repo_path: ${join(FORGE_ROOT, 'projects', J4_PROJECT)}`,
                `created_at: '${new Date().toISOString()}'`,
                'iteration_budget: 3',
                'cost_budget_usd: 5',
                'phase: ready-for-review',
                'origin: human-directed',
                `cycle_id: ${J5_CYCLE_ID}`,
                `flow_id: ${J3_FLOW}`,
                '---',
                '',
                '# Give the authored flow work',
                '',
                'A seeded run proving the authored plan → dev → review flow renders in the monitor.',
                '',
              ].join('\n'));
              j5Event('orchestrator', 'start', 'cycle.start', { origin: 'human-directed' });
              j5Event('plan', 'start', 'plan.start');
              j5Event('plan', 'end', 'plan.end', {}, { cost_usd: 0.12, duration_ms: 24000 });
              j5Event('dev', 'start', 'dev.start');
              j5Event('dev', 'log', 'gate.pass', {});
              j5Event('dev', 'end', 'dev.end', {}, { cost_usd: 0.28, duration_ms: 41000 });
              j5Event('review', 'start', 'review.start');

              await page.goto(watch.uiUrl + `/flows/${J3_FLOW}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              // The run is discovered + associated with the authored flow (flow_id).
              const j5RunCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-run-count') ?? '0', 10));
              check(j5RunCount >= 1, `J5: the authored flow shows the seeded run (run-count ${j5RunCount})`);
              // The monitor renders the authored flow's own nodes (plan/dev/review).
              for (const nodeId of ['plan', 'dev', 'review']) {
                await page.waitForSelector(`[data-mon-node][data-node-id="${nodeId}"]`, { timeout: 10000 }).catch(() => {});
                const present = await page.evaluate((n) => document.querySelector(`[data-mon-node][data-node-id="${n}"]`) !== null, nodeId);
                check(present, `J5: monitor renders the "${nodeId}" hex of the authored flow`);
              }
              // Phase statuses progressed (plan + dev complete) and the run parked at the gate.
              const planStatus = await page.evaluate(() =>
                document.querySelector('[data-mon-node][data-node-id="plan"]')?.getAttribute('data-status'));
              check(planStatus === 'complete', `J5: plan phase shows complete (got "${planStatus}")`);
              const reviewStatus = await page.evaluate(() =>
                document.querySelector('[data-mon-node][data-node-id="review"]')?.getAttribute('data-status'));
              check(reviewStatus === 'gated' || reviewStatus === 'active', `J5: review phase awaits the human verdict (got "${reviewStatus}")`);
              await expectPhaseCost(page, 'J5: the authored run shows accrued per-phase cost');
              await frame(page, 'j5-0-authored-run', 'J5 — the authored flow, given work, runs plan → dev → review to the verdict gate');
              // Clean the seeded run now so it does not bleed into the mdtoc RUN act.
              cleanFirstFlowRun();

        },
      },
      {
        id: 'flows-author-scratch-parity',
        title: 'Build the forge-develop flow from scratch (flow-as-data)',
        narration: 'Build the forge-develop flow from scratch (flow-as-data)',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check, countAtLeast } = ctx;
              // ── A2: BUILD THE FORGE DEVELOP FLOW FROM SCRATCH ─────────────────────────
              // The headline new beat. We authored forge-develop-scratch as a flow definition
              // (3 nodes, 2 edges, 1 gate). Prove: (1) `forge studio lint` validates it,
              // (2) it is structurally identical to the production seed (subsumption), (3)
              // the flow builder renders it live, (4) the engine can run it (data-can-start).
              console.log('\n[A2] Build the forge-develop flow from scratch (flow-as-data)');

              // (1) `forge studio lint` validates the authored flow — the platform's own gate.
              let lintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                lintOk = true;
              } catch (e) {
                console.error(`  [studio lint] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(lintOk, 'author-from-scratch: `forge studio lint` validates the authored forge-develop-scratch flow (exit 0)');

              // (2) Structural parity with the production seed (forge-develop) — the subsumption proof.
              const seedStruct = parseFlowStructure(readFileSync(SEED_FLOW_PATH, 'utf8'));
              const scratchStruct = parseFlowStructure(readFileSync(join(SCRATCH_FLOW_DIR, 'flow.yaml'), 'utf8'));
              check(JSON.stringify(scratchStruct.nodeIds) === JSON.stringify(seedStruct.nodeIds),
                `author-from-scratch: node set matches the seed (${scratchStruct.nodeIds.join(',')})`);
              check(scratchStruct.gates.review === 'verdict',
                'author-from-scratch: the review gate lands on verdict (matches the forge-develop seed)');
              check(scratchStruct.edgeCount === seedStruct.edgeCount,
                `author-from-scratch: edge count matches the seed (${scratchStruct.edgeCount})`);

              // (3) The flow builder renders the authored flow live.
              await page.goto(watch.uiUrl + `/flows/${SCRATCH_FLOW}`, { waitUntil: 'domcontentloaded' });
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 20000 },
                );
                check(true, 'author-from-scratch: flow-monitor ready for the authored flow');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') ?? '(absent)');
                check(false, `author-from-scratch: flow-monitor ready (got "${pr}")`);
              }
              await caption(page, 'The forge-develop build flow, rebuilt from scratch — dev → unifier → review, one verdict gate. The platform validates it and it is identical to the production seed.');
              await sleep(ACT);
              // (4) The engine can run it — start-run is enabled (no runs yet on this flow).
              const canStart = await page.evaluate(() =>
                document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-can-start') ?? '(absent)');
              check(canStart === 'true', `author-from-scratch: engine can run the authored flow (data-can-start="true", got "${canStart}")`);
              await frame(page, 'a2-0-scratch-monitor', 'A2 — authored forge-develop-scratch: lint green, parity with seed, runnable by the engine');

              // Open the BUILD tab to show the authored topology on the canvas.
              const buildTabBtn = page.locator('button.tab').filter({ hasText: 'BUILD' }).first();
              if ((await buildTabBtn.count()) > 0) {
                await buildTabBtn.click();
                try {
                  await page.waitForFunction(
                    () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') === 'build',
                    null, { timeout: 8000 },
                  );
                  check(true, 'author-from-scratch: BUILD tab click flips data-active-tab="build"');
                } catch {
                  const tabVal = await page.evaluate(() =>
                    document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') ?? '(absent)');
                  check(false, `author-from-scratch: data-active-tab="build" (got "${tabVal}")`);
                }
              } else {
                check(false, 'author-from-scratch: BUILD tab button present');
              }
              // ReactFlow hydrates after the tab switch — poll for the node count rather
              // than a fixed sleep (the canvas can render a tick late under load).
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-node-count]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              const nodeCount = await page.evaluate(() => {
                const el = document.querySelector('[data-node-count]');
                return el ? parseInt(el.getAttribute('data-node-count') ?? '0', 10) : -1;
              });
              check(nodeCount >= 3, `author-from-scratch: BUILD canvas renders ≥3 nodes for the authored forge-develop-scratch flow (got ${nodeCount})`);
              await countAtLeast(page, '[data-flow-node]', 1, 'author-from-scratch: ≥1 [data-flow-node] rendered in BUILD canvas');
              const palettePresent = await page.evaluate(() => document.querySelector('[data-component="agent-palette"]') !== null);
              check(palettePresent, 'author-from-scratch: [data-component="agent-palette"] present (drag more agents in)');
              await countAtLeast(page, '[data-palette-chip]', 1, 'author-from-scratch: palette has ≥1 [data-palette-chip]');
              // Agent chips load async (the Agents section shows "Loading…" first while the
              // fixed Artifact chips render instantly) — wait for the agent chips before
              // asserting, else we race the fetch.
              await countAtLeast(page, '[data-palette-chip="agent"]', 3, 'author-from-scratch: palette agent chips loaded');
              // The new OOTB agent library (L1-A) is draggable from the palette (#10) — the
              // author can compose the freshly-seeded agents into a flow from scratch.
              const ootbChips = await page.evaluate(() => {
                const want = ['developer-ralph', 'project-manager', 'project-scoped-review'];
                const present = new Set(
                  Array.from(document.querySelectorAll('[data-palette-chip="agent"]')).map((el) =>
                    el.getAttribute('data-chip-ref'),
                  ),
                );
                return want.filter((w) => present.has(w));
              });
              check(
                ootbChips.length === 3,
                `author-from-scratch: library agents appear in the palette (${ootbChips.join(',') || 'none'})`,
              );
              const goalSetPresent = await page.evaluate(() => document.querySelector('[data-goal-set]') !== null);
              check(goalSetPresent, 'author-from-scratch: [data-goal-set] present in FlowHeader');
              await sleep(READ);
              await frame(page, 'a2-1-scratch-build', `A2 — BUILD canvas: the authored cycle (${nodeCount} nodes) on the ReactFlow canvas, palette + goal field`);
              // Clip: the flow builder — the iconic "build the pipeline as data" surface.
              await recordClip(browser, watch, 'flow-build', `/flows/${SCRATCH_FLOW}`, async (p) => {
                const buildTab = p.locator('button.tab').filter({ hasText: 'BUILD' }).first();
                if (await buildTab.count() > 0) await buildTab.click().catch(() => {});
                await p.waitForSelector('[data-flow-node]', { timeout: 12000 }).catch(() => {});
                await sleep(2600);
              }, { readySel: '[data-page="flow-monitor"]', caption: 'the flow builder — compose the cycle as data (nodes · palette · gates)' });

        },
      },
    ],
});
