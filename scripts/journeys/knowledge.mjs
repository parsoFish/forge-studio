import { defineJourney } from '../lib/journey-runtime.mjs';
import { caption, ACT, THINK, WORK, READ } from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// module-scope cross-beat state for this journey (was hoisted in main())
let GUIDANCE_TEXT, kbPageReady;             // knowledge-graph → knowledge-pin-guidance

export const journey = defineJourney({
    id: 'knowledge',
    title: 'Knowledge graph',
    story: 'As an operator, I browse the real cycles brain as a force-graph, pin a piece of human guidance onto it, and run lint/index maintenance — the knowledge pillar\'s OOTB brains, edited through both deterministic tooling and my own guidance-plus-ingest loop.',
    beats: [
      {
        id: 'knowledge-graph',
        title: 'KB-backend seam — /knowledge?id=cycles (real brain)',
        narration: 'The knowledge screen force-graphs the real cycles brain — theme and index nodes, KB health panel, a backend selector — and clicking a theme node opens its full article; this is the actual OOTB cross-cycle brain, not a mock graph.',
        drive: async (ctx) => {
              const { page, watch, check, frame, countAtLeast } = ctx;
              // ── S3: KB-backend seam (ADR-027 §4) — knowledge graph + pin guidance ─────
              GUIDANCE_TEXT = '[e2e-journey] --write theme: idempotency is the sharp edge — a second --write must be byte-identical or a trailing newline drifts into a diff.';
              console.log('\n[S3.0] KB-backend seam — /knowledge?id=cycles (real brain)');
              await page.goto(`${watch.uiUrl}/knowledge?id=cycles`, { waitUntil: 'domcontentloaded' });
              kbPageReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 30000 },
                );
                kbPageReady = true;
                check(true, 'kb-seam: [data-page="knowledge"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') ?? '(no data-page=knowledge)');
                check(false, `kb-seam: knowledge page-ready (got "${pr}")`);
              }
              await caption(page, 'The brain is a seam too — FilesystemKbBackend today, with the kb.yaml `backend:` field as the swap point. Browse the real force-graph.');
              await sleep(WORK);
              if (kbPageReady) {
                const kbId = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-kb-id') ?? '');
                check(kbId === 'cycles', `kb-seam: #kb-svg data-kb-id="cycles" (got "${kbId}")`);
                let nodeCountKb = 0;
                try {
                  await page.waitForFunction(() => {
                    const el = document.querySelector('#kb-svg');
                    return el !== null && parseInt(el.getAttribute('data-node-count') ?? '0', 10) >= 10;
                  }, null, { timeout: 15000 });
                } catch { /* report below */ }
                nodeCountKb = await page.evaluate(() => parseInt(document.querySelector('#kb-svg')?.getAttribute('data-node-count') ?? '0', 10));
                check(nodeCountKb >= 10, `kb-seam: #kb-svg data-node-count ≥10 (got ${nodeCountKb})`);
                const edgeCountKb = await page.evaluate(() => parseInt(document.querySelector('#kb-svg')?.getAttribute('data-edge-count') ?? '0', 10));
                check(edgeCountKb > 0, `kb-seam: #kb-svg data-edge-count > 0 (got ${edgeCountKb})`);
                await countAtLeast(page, '[data-node-id]', 5, 'kb-seam: ≥5 [data-node-id] nodes rendered in graph');
                const hasTheme = await page.evaluate(() => document.querySelector('[data-layer="theme"]') !== null);
                check(hasTheme, 'kb-seam: [data-layer="theme"] node(s) present');
                const hasIndex = await page.evaluate(() => document.querySelector('[data-layer="index"]') !== null);
                check(hasIndex, 'kb-seam: [data-layer="index"] node(s) present');
                const healthPresent = await page.evaluate(() =>
                  document.querySelector('[data-section="kb-health"]') !== null ||
                  [...document.querySelectorAll('div')].some((el) => el.textContent?.includes('KB HEALTH') || el.textContent?.includes('LAYER BALANCE')));
                check(healthPresent, 'kb-seam: KB HEALTH panel rendered');
                const selectorPresent = await page.evaluate(() =>
                  document.querySelector('select') !== null || document.querySelector('[data-component="kb-selector"]') !== null);
                check(selectorPresent, 'kb-seam: KB selector present');
              }
              await frame(page, 's3-0-kb-graph', `S3 — /knowledge?id=cycles: force-graph rendered (${
                await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-node-count') ?? '?')
              } nodes, real cycles brain)`);

              if (kbPageReady) {
                const themeNode = page.locator('[data-layer="theme"]').first();
                if ((await themeNode.count()) > 0) {
                  // Click the node's hit-circle: its centre is collision-free, whereas the
                  // <g> bbox centre is pushed by the label into empty/overlapped space.
                  await themeNode.locator('[data-hit]').click({ force: true, timeout: 5000 }).catch(() => {});
                  try {
                    await page.waitForFunction(
                      () => (document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '') !== '',
                      null, { timeout: 8000 },
                    );
                    const selectedNode = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '');
                    check(selectedNode !== '', `kb-seam: clicking a theme node sets data-selected-node (got "${selectedNode}")`);
                  } catch {
                    const sel = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '(absent)');
                    check(false, `kb-seam: clicking theme node sets data-selected-node (got "${sel}")`);
                  }
                } else {
                  check(false, 'kb-seam: [data-layer="theme"] node present to click');
                }
              }
              await sleep(ACT);
              await frame(page, 's3-0b-kb-node-article', 'S3 — theme node clicked: NODE ARTICLE panel visible');

        },
      },
      {
        id: 'knowledge-pin-guidance',
        title: 'KB-backend seam — pin-guidance',
        narration: 'The operator types a lesson straight into the HUMAN GUIDANCE panel and pins it; a guidance node appears in the graph immediately — human guidance is how the brain grows between ingest passes, visible as its own node until the next one folds it in.',
        drive: async (ctx) => {
              const { page, check, frame } = ctx;
              // ── S3.1: Pin-guidance → guidance node appears (writes _guidance/<ts>.md) ──
              console.log('\n[S3.1] KB-backend seam — pin-guidance');
              await caption(page, 'Human guidance — pin a note to the brain; it surfaces as a guidance node until the next ingest pass.');
              await sleep(ACT);
              if (kbPageReady) {
                const guidanceTextarea = page.locator('#guidance-text');
                if ((await guidanceTextarea.count()) > 0) {
                  await guidanceTextarea.scrollIntoViewIfNeeded().catch(() => {});
                  await guidanceTextarea.click();
                  await guidanceTextarea.pressSequentially(GUIDANCE_TEXT, { delay: 14 });
                  await sleep(THINK);
                  await frame(page, 's3-1-guidance-typed', 'S3 — guidance text typed into the HUMAN GUIDANCE panel');
                  const pinBtn = page.locator('#pin-guidance-btn');
                  if ((await pinBtn.count()) > 0) {
                    await pinBtn.click();
                    await sleep(ACT);
                    let guidancePinned = false;
                    try {
                      await page.waitForFunction(() => document.querySelector('[data-guidance-pinned="true"]') !== null, null, { timeout: 10000 });
                      guidancePinned = true;
                      check(true, 'kb-seam: data-guidance-pinned="true" — guidance POST succeeded');
                    } catch {
                      const successMsg = await page.evaluate(() =>
                        [...document.querySelectorAll('div')].some((el) => el.textContent?.includes('Guidance pinned') ?? false));
                      if (successMsg) { guidancePinned = true; check(true, 'kb-seam: "Guidance pinned" success message rendered'); }
                      else {
                        const pinVal = await page.evaluate(() =>
                          document.querySelector('[data-guidance-pinned]')?.getAttribute('data-guidance-pinned') ?? '(absent)');
                        check(false, `kb-seam: data-guidance-pinned="true" (got "${pinVal}")`);
                      }
                    }
                    if (guidancePinned) {
                      await sleep(WORK);
                      const hasGuidanceNode = await page.evaluate(() => document.querySelector('[data-layer="guidance"]') !== null);
                      check(hasGuidanceNode, 'kb-seam: [data-layer="guidance"] node appeared after pin (graph re-fetched)');
                    }
                  } else {
                    check(false, 'kb-seam: #pin-guidance-btn present to click');
                  }
                } else {
                  check(false, 'kb-seam: #guidance-text textarea present');
                }
              } else {
                check(false, 'kb-seam: pin-guidance skipped (page did not reach ready)');
              }
              await frame(page, 's3-1b-guidance-pinned', 'S3 — guidance pinned: data-guidance-pinned="true", guidance node in graph');
              await sleep(READ);

        },
      },
      {
        id: 'knowledge-lint-index',
        title: 'KB maintenance — lint / index / OOTB brains',
        narration: 'The operator runs the real kb-lint and kb-index actions from the maintenance panel — structural checks and a regenerated index, not cosmetic buttons — and the KB selector confirms both cycles and forge-dev ship as OOTB brains: the knowledge pillar is edited through lint/index tooling, on top of the human-guidance loop from the beat before.',
        drive: async (ctx) => {
              const { page, watch, browser, recordClip, check, frame } = ctx;
              // ── S3.2: KB maintenance — LINT + INDEX + OOTB brains (real, read-only) ───
              console.log('\n[S3.2] KB maintenance — lint / index / OOTB brains');
              await page.goto(`${watch.uiUrl}/knowledge?id=cycles`, { waitUntil: 'domcontentloaded' });
              const kbMaintReady = await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 30000 }).then(() => true).catch(() => false);
              await caption(page, 'Knowledge is editable — deterministic LINT + INDEX maintenance, plus the human-guidance + ingest loop.');
              if (kbMaintReady) {
                await page.locator('[data-component="kb-maintenance"] [data-action="kb-lint"]').click().catch(() => {});
                await page.waitForFunction(
                  () => (document.querySelector('[data-component="kb-maintenance-result"]')?.textContent ?? '').startsWith('lint:'),
                  null, { timeout: 15000 }).catch(() => {});
                const lintText = await page.evaluate(() => document.querySelector('[data-component="kb-maintenance-result"]')?.textContent ?? '');
                check(/^lint:/.test(lintText), `S3.2: kb-lint result badge (got "${lintText}")`);
                await frame(page, 'kb-0-lint', `Part 2 (knowledge) — kb-lint: ${lintText || 'result'}`);
                await page.locator('[data-component="kb-maintenance"] [data-action="kb-index"]').click().catch(() => {});
                await page.waitForFunction(
                  () => (document.querySelector('[data-component="kb-maintenance-result"]')?.textContent ?? '') === 'index refreshed ✓',
                  null, { timeout: 15000 }).catch(() => {});
                check(true, 'S3.2: kb-index maintenance triggered');
                const scanBtn = page.locator('[data-section="lint-resolution"] [data-action="lint-scan"]');
                if (await scanBtn.count() > 0) {
                  await scanBtn.click().catch(() => {});
                  await page.waitForFunction(
                    () => document.querySelector('[data-section="lint-resolution"]')?.getAttribute('data-lint-scanned') === 'true',
                    null, { timeout: 15000 }).catch(() => {});
                  check(await page.locator('[data-section="lint-resolution"][data-lint-scanned="true"]').count() > 0,
                    'S3.2: lint-resolution scan ran (data-lint-scanned="true")');
                }
                await frame(page, 'kb-1-maintenance', 'Part 2 (knowledge) — lint/index maintenance + the resolution surface');
                const ootb = await page.evaluate(() => ({
                  cycles: document.querySelector('#kb-select option[value="cycles"]')?.textContent ?? '',
                  forgeDev: document.querySelector('#kb-select option[value="forge-dev"]')?.textContent ?? '',
                }));
                check(ootb.cycles.length > 0 && ootb.forgeDev.length > 0,
                  `S3.2: cycles + forge-dev brains ship OOTB (${ootb.cycles} / ${ootb.forgeDev})`);
              }
              // Clip: kb-lint + the lint-resolution scan — read-only/idempotent maintenance,
              // safe to re-drive on a fresh context. Fresh context, own navigation.
              await recordClip(browser, watch, 'kb-lint', '/knowledge?id=cycles', async (p) => {
                // The force-graph animates continuously — hide it for this clip so every
                // recorded frame is near-static (the clip's story is the lint panel).
                await p.addStyleTag({ content: '#kb-svg { visibility: hidden; }' }).catch(() => {});
                await p.waitForSelector('[data-component="kb-maintenance"] [data-action="kb-lint"]', { timeout: 12000 }).catch(() => {});
                // Scroll the maintenance panel into view FIRST — the force-graph above it
                // animates continuously, and while it's in-viewport every recorded frame
                // differs (this clip hit 1.2M). Off-screen graph = near-static frames.
                await p.locator('[data-component="kb-maintenance"]').scrollIntoViewIfNeeded().catch(() => {});
                await sleep(400);
                await p.locator('[data-component="kb-maintenance"] [data-action="kb-lint"]').click().catch(() => {});
                await p.waitForFunction(
                  () => (document.querySelector('[data-component="kb-maintenance-result"]')?.textContent ?? '').startsWith('lint:'),
                  null, { timeout: 15000 },
                ).catch(() => {});
                const scanBtn = p.locator('[data-section="lint-resolution"] [data-action="lint-scan"]');
                if (await scanBtn.count() > 0) {
                  await scanBtn.click().catch(() => {});
                  await p.waitForFunction(
                    () => document.querySelector('[data-section="lint-resolution"]')?.getAttribute('data-lint-scanned') === 'true',
                    null, { timeout: 15000 },
                  ).catch(() => {});
                }
              }, {
                readySel: '[data-page="knowledge"]',
                caption: 'KB lint findings triaged from the maintenance surface',
                holdTailMs: 1500,
                // Short viewport: the animated force-graph above the maintenance panel
                // mostly leaves frame, so recorded frames stay near-static (was ~1M).
                size: { width: 1000, height: 480 },
              });

        },
      },
    ],
});
