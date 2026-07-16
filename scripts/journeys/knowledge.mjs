import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import { caption, ACT, THINK, WORK, READ, FORGE_ROOT, waitForFile } from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// module-scope cross-beat state for this journey (was hoisted in main())
let GUIDANCE_TEXT, kbPageReady;             // knowledge-graph → knowledge-pin-guidance

// ── scratch KB (knowledge-create-kb → knowledge-ingest) ──────────────────────
// A KB this journey creates AND deletes itself — never brain/cycles,
// brain/forge-dev, or brain/projects/*. journey-fixtures.mjs is off-limits for
// this task, so every constant/helper for the ingest demo lives here, module-
// local, mirroring the cleanup-at-top-of-beat pattern used by skills.mjs /
// demo-builder.mjs (defineJourney's spec.cleanup field is validated but never
// invoked by the runner, so self-contained cleanup lives inside drive()).
const SCRATCH_KB_ID = 'journey-scratch-kb';
const SCRATCH_KB_NAME = 'Journey scratch KB';
const SCRATCH_KB_DESC = 'Ephemeral KB created by the e2e journey itself, to demo create -> guidance -> ingest -> delete without ever touching a real brain.';
const SCRATCH_KB_SCOPE = 'project';
const SCRATCH_KB_DIR = join(FORGE_ROOT, 'brain', SCRATCH_KB_ID);
const SCRATCH_GUIDANCE_TEXT = '[e2e-journey] scratch-kb guidance: a KB created purely for this demo should still round-trip through the exact same pin -> ingest -> delete loop as a real brain.';

/** Defensive cleanup: guards against leftover state from a prior crashed run, and is
 * the belt-and-braces call after the real UI-driven delete. Safe to call any number of
 * times. Note for the caller/report: e2e-journey.mjs's finally block only ever sweeps
 * brain/cycles/_guidance/ — it has no knowledge of brain/journey-scratch-kb/, so this
 * module owns the entire cleanup contract for the scratch KB (out of this task's
 * touch-scope to wire a second runner-level sweep; the exact path for that sweep would
 * be SCRATCH_KB_DIR itself, i.e. join(FORGE_ROOT, 'brain', 'journey-scratch-kb')). */
function cleanScratchKb() {
  try { rmSync(SCRATCH_KB_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/** Emulates one ingest pass on the scratch KB: folds the pinned guidance note into a
 * real theme file (house-style frontmatter, matching brain/cycles/themes/*.md) and
 * removes the guidance note. In the real product this fold is an LLM pass
 * (brain-ingest); here, on a throwaway scratch KB, it is a scripted write — narrated as
 * such everywhere this is invoked. */
function foldScratchGuidanceIntoTheme() {
  const guidanceDir = join(SCRATCH_KB_DIR, '_guidance');
  if (existsSync(guidanceDir)) {
    for (const f of readdirSync(guidanceDir)) { try { rmSync(join(guidanceDir, f), { force: true }); } catch { /* */ } }
  }
  const themesDir = join(SCRATCH_KB_DIR, 'themes');
  mkdirSync(themesDir, { recursive: true });
  const now = new Date().toISOString();
  const theme = `---
title: Ephemeral demo lesson — folded from pinned guidance
description: >-
  A scratch-KB demo lesson: pinned human guidance, once folded by an ingest
  pass, becomes a real theme node with its own article body — not just a
  transient note. Folded on ${now.slice(0, 10)} by the e2e journey.
category: pattern
keywords:
  - e2e-journey
  - scratch-kb
  - ingest-emulation
created_at: ${now}
updated_at: ${now}
source_dates:
  - ${now.slice(0, 10)}
---

## The problem

A guidance note pinned to a KB is deliberately transient — it is a human's
raw lesson, not yet folded into the brain's structured themes. Left alone it
never becomes a durable, linkable article.

## The fix

An ingest pass reads every pending guidance note, writes it up as a proper
theme (frontmatter + a problem/fix body), and removes the guidance file once
folded. ${SCRATCH_GUIDANCE_TEXT}

## See also
- (none — this is a scratch demo theme, not a real cross-linked brain node)
`;
  writeFileSync(join(themesDir, 'scratch-ingest-lesson.md'), theme, 'utf8');
}

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
        id: 'knowledge-create-kb',
        title: 'Author a KB from scratch — /knowledge/new',
        narration: 'From a blank form the operator names a brand-new knowledge base, picks a scope, and describes it; creating it writes a fresh kb.yaml + themes/ + _raw/ under brain/ — a scratch KB this journey both creates and deletes itself, so the real cycles/forge-dev brains are never touched.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              // ── S3.0b: author a brand-new KB from scratch (/knowledge/new) ────────────
              console.log('\n[S3.0b] Author a scratch KB — /knowledge/new');
              cleanScratchKb(); // guard against leftover state from a prior crashed run
              await page.goto(`${watch.uiUrl}/knowledge/new`, { waitUntil: 'domcontentloaded' });
              await sleep(1200); // data-page-ready is static "true" pre-hydration (same trap as /skills/new)
              check(await page.locator('main[data-page="knowledge-new"]').count() > 0, 'kb-create: knowledge-new page renders');
              await caption(page, 'Author a brand-new KB from scratch — a scratch brain this journey creates and deletes itself, never a real one.');
              const fillKb = async () => {
                const nameEl = page.locator('[data-field="kb-name"]');
                await nameEl.click().catch(() => {});
                await nameEl.fill('').catch(() => {});
                await nameEl.pressSequentially(SCRATCH_KB_NAME, { delay: 16 }).catch(() => {});
                await page.locator('[data-field="kb-scope"]').selectOption(SCRATCH_KB_SCOPE).catch(() => {});
                await page.locator('[data-field="kb-desc"]').fill(SCRATCH_KB_DESC).catch(() => {});
              };
              const createEnabled = (ms) => page.waitForFunction(() => {
                const b = document.querySelector('[data-action="create-kb"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: ms }).then(() => true).catch(() => false);
              await fillKb();
              let kbEnabled = await createEnabled(6000);
              if (!kbEnabled) { await fillKb(); kbEnabled = await createEnabled(6000); }
              check(kbEnabled, 'kb-create: create-kb enables once a name is filled');
              await frame(page, 'kb-2-create-form', 'Knowledge — authoring a brand-new KB from scratch (name/scope/description)');
              await page.locator('[data-action="create-kb"]').click().catch(() => {});
              const created = await waitForFile(join(SCRATCH_KB_DIR, 'kb.yaml'), 12000);
              check(created, `kb-create: creating writes brain/${SCRATCH_KB_ID}/kb.yaml`);
              // The create form redirects to /knowledge with no ?id= (lands on whatever KB
              // the page defaults to) — navigate to the new KB's own graph explicitly.
              await page.goto(`${watch.uiUrl}/knowledge?id=${SCRATCH_KB_ID}`, { waitUntil: 'domcontentloaded' });
              let scratchReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                );
                scratchReady = true;
              } catch { /* checked below */ }
              check(scratchReady, 'kb-create: the new scratch KB\'s graph page reaches data-page-ready="true"');
              if (scratchReady) {
                const kbId = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-kb-id') ?? '');
                check(kbId === SCRATCH_KB_ID, `kb-create: #kb-svg data-kb-id="${SCRATCH_KB_ID}" (got "${kbId}")`);
                const inSelector = await page.evaluate(
                  (id) => document.querySelector(`#kb-select option[value="${id}"]`) !== null, SCRATCH_KB_ID);
                check(inSelector, 'kb-create: the new KB appears in the #kb-select selector');
              }
              await frame(page, 'kb-3-scratch-empty', 'Knowledge — the new scratch KB\'s (near-empty) graph renders', { key: true });

        },
      },
      {
        id: 'knowledge-ingest',
        title: 'Pin guidance on the scratch KB, then emulate an ingest fold',
        narration: 'The operator pins a guidance note onto the just-created scratch KB — the same panel used on the real cycles brain, proving the pin route targets whichever KB is open — then an ingest pass folds that note into a real theme file (an LLM pass in the real product, scripted here on a throwaway KB): the guidance node disappears, a theme node takes its place, and its article holds the folded lesson. The journey then deletes the scratch KB it created.',
        drive: async (ctx) => {
              const { page, watch, browser, recordClip, check, frame } = ctx;
              // ── S3.0c: pin guidance on the SCRATCH kb, then fold (ingest emulation) ───
              console.log('\n[S3.0c] Pin guidance on the scratch KB, then fold it (ingest emulation)');
              await page.goto(`${watch.uiUrl}/knowledge?id=${SCRATCH_KB_ID}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 }).catch(() => {});
              await caption(page, 'Pin guidance on the SCRATCH kb (not cycles) — the same panel, proving the route is generic to whatever KB is open.');
              const guidanceTextarea = page.locator('#guidance-text');
              let pinnedOnScratch = false;
              if (await guidanceTextarea.count() > 0) {
                await guidanceTextarea.scrollIntoViewIfNeeded().catch(() => {});
                await guidanceTextarea.click();
                await guidanceTextarea.pressSequentially(SCRATCH_GUIDANCE_TEXT, { delay: 10 });
                await sleep(THINK);
                await page.locator('#pin-guidance-btn').click().catch(() => {});
                try {
                  await page.waitForFunction(() => document.querySelector('[data-guidance-pinned="true"]') !== null, null, { timeout: 10000 });
                  pinnedOnScratch = true;
                } catch { /* checked below */ }
              }
              check(pinnedOnScratch, 'kb-ingest: guidance pinned via the real panel, on the scratch KB');
              const guidanceDir = join(SCRATCH_KB_DIR, '_guidance');
              const guidanceFileOnScratch = existsSync(guidanceDir) && readdirSync(guidanceDir).length > 0;
              check(guidanceFileOnScratch, `kb-ingest: pin route wrote into brain/${SCRATCH_KB_ID}/_guidance/ (targeted the scratch KB, not cycles)`);
              await sleep(WORK);
              check(await page.evaluate(() => document.querySelector('[data-layer="guidance"]') !== null),
                'kb-ingest: [data-layer="guidance"] node appeared on the scratch KB graph');
              await frame(page, 'kb-4-scratch-guidance', 'Knowledge — guidance pinned onto the scratch KB (guidance node appears)');

              // The clip's interact() performs the actual fold mutation (theme write +
              // guidance rm) — the one place this journey emulates an ingest pass. Ingest
              // is an LLM fold in the real product; here it's a scripted write against a
              // throwaway scratch KB (never brain/cycles, brain/forge-dev, or brain/projects).
              await recordClip(browser, watch, 'kb-ingest', `/knowledge?id=${SCRATCH_KB_ID}`, async (p) => {
                await p.waitForFunction(() => document.querySelector('[data-layer="guidance"]') !== null, null, { timeout: 10000 }).catch(() => {});
                await sleep(1200);
                foldScratchGuidanceIntoTheme();
                await p.reload({ waitUntil: 'domcontentloaded' });
                await p.waitForFunction(() => document.querySelector('[data-layer="theme"]') !== null, null, { timeout: 10000 }).catch(() => {});
                const themeNode = p.locator('[data-layer="theme"]').first();
                if (await themeNode.count() > 0) {
                  await themeNode.locator('[data-hit]').click({ force: true, timeout: 5000 }).catch(() => {});
                }
              }, {
                readySel: '[data-page="knowledge"]',
                caption: 'ingest fold (emulated): guidance note -> theme file, on the scratch KB',
                size: { width: 1000, height: 620 },
              });

              // Assertions run AFTER the clip, against the main page, re-reading the same
              // disk state the clip's interact() just mutated.
              await page.reload({ waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 }).catch(() => {});
              const guidanceGone = await page.evaluate(() => document.querySelector('[data-layer="guidance"]') === null);
              check(guidanceGone, 'kb-ingest: guidance node gone after the fold (guidance file removed)');
              const themePresent = await page.evaluate(() => document.querySelector('[data-layer="theme"]') !== null);
              check(themePresent, 'kb-ingest: theme node present after the fold (theme file written)');
              if (themePresent) {
                const themeNode = page.locator('[data-layer="theme"]').first();
                await themeNode.locator('[data-hit]').click({ force: true, timeout: 5000 }).catch(() => {});
                await sleep(ACT);
                const articleText = await page.evaluate(() => document.querySelector('[data-node-article-body]')?.textContent ?? '');
                check(articleText.includes('Ephemeral demo lesson') || articleText.length > 0,
                  'kb-ingest: clicking the folded theme node opens its article (folded lesson text)');
                await frame(page, 'kb-5-scratch-theme', 'Knowledge — ingest folded: guidance -> theme node, article open', { key: true });
              }

              // Cleanup — drive the real kb-delete on the scratch KB (proves delete works
              // end to end through the UI), then defensively rmSync in case the UI path
              // didn't fully land. Zero scratch-KB state may survive this beat.
              page.once('dialog', (dialog) => { dialog.accept().catch(() => {}); });
              await page.locator('[data-component="kb-maintenance"] [data-action="kb-delete"]').click().catch(() => {});
              let deletedFromDisk = false;
              { const dl = Date.now() + 8000; while (Date.now() < dl) { if (!existsSync(SCRATCH_KB_DIR)) { deletedFromDisk = true; break; } await sleep(150); } }
              check(deletedFromDisk, `kb-ingest: kb-delete removed brain/${SCRATCH_KB_ID}/ from disk`);
              await sleep(ACT);
              const stillInSelector = await page.evaluate(
                (id) => document.querySelector(`#kb-select option[value="${id}"]`) !== null, SCRATCH_KB_ID).catch(() => true);
              check(!stillInSelector, 'kb-ingest: scratch KB no longer listed in #kb-select after delete');
              await frame(page, 'kb-6-scratch-deleted', 'Knowledge — scratch KB deleted; gone from the selector/library');
              cleanScratchKb();

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
