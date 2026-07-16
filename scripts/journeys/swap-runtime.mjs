import { defineJourney } from '../lib/journey-runtime.mjs';
import { caption, ACT, THINK } from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

export const journey = defineJourney({
    id: 'swap-runtime',
    title: 'Swap the runtime adapter',
    story: 'Swap the runtime-adapter seam — the registry-driven SDK/model picker.',
    beats: [
      {
        id: 'swap-runtime-sdk-picker',
        title: 'Runtime-adapter seam — /agents/project-manager',
        narration: 'Runtime-adapter seam — /agents/project-manager',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              // ── S2: Runtime-adapter seam (ADR-029) — registry-driven SDK picker + range
              console.log('\n[S2] Runtime-adapter seam — /agents/project-manager');
              await page.goto(watch.uiUrl + '/agents/project-manager', { waitUntil: 'domcontentloaded' });
              let rangePageReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 25000 },
                );
                rangePageReady = true;
                check(true, 'adapter-seam: [data-page="agents"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') ?? '(no data-page=agents)');
                check(false, `adapter-seam: agent builder page-ready (got "${pr}")`);
              }
              await caption(page, 'The runtime is a seam — the SDK picker is registry-driven. claude is live; gemini/aider/codex are disabled until their adapter ships (ADR-029).');
              await sleep(ACT);
              if (rangePageReady) {
                // The RuntimePicker now lives under the collapsed "Advanced" section (J2
                // progressive disclosure). Open it to drive the runtime-adapter seam.
                await page.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
                  null, { timeout: 5000 },
                ).catch(() => {});
                const claudeCardAvailable = await page.evaluate(() => {
                  const card = document.querySelector('[data-sdk-id="claude"]');
                  return card !== null && !card.classList.contains('disabled');
                });
                check(claudeCardAvailable, 'adapter-seam: [data-sdk-id="claude"] selectable (adapter registered)');
                const codexDisabled = await page.evaluate(() => {
                  const card = document.querySelector('[data-sdk-id="codex"]');
                  return card !== null && card.classList.contains('disabled');
                });
                check(codexDisabled, 'adapter-seam: [data-sdk-id="codex"] disabled (adapter not registered)');
                const geminiDisabled = await page.evaluate(() => {
                  const card = document.querySelector('[data-sdk-id="gemini"]');
                  return card !== null && card.classList.contains('disabled');
                });
                check(geminiDisabled, 'adapter-seam: [data-sdk-id="gemini"] disabled (adapter not registered)');
                await frame(page, 's2-0-sdk-picker', 'S2 — adapter seam: claude selectable; codex/gemini disabled (registry-driven)');

                const rangeBtn = page.locator('[data-component="runtime-picker"] [data-strategy="range"]');
                let rangeTogglePresent = false;
                if ((await rangeBtn.count()) > 0) {
                  rangeTogglePresent = true;
                  await rangeBtn.click();
                  await sleep(THINK);
                  try {
                    await page.waitForFunction(
                      () => document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-strategy') === 'range',
                      null, { timeout: 5000 },
                    );
                    check(true, 'adapter-seam: range segment flips [data-component="runtime-picker"][data-strategy="range"]');
                  } catch {
                    const strat = await page.evaluate(() =>
                      document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-strategy') ?? '(absent)');
                    check(false, `adapter-seam: data-strategy flipped to range (got "${strat}")`);
                  }
                } else {
                  check(false, 'adapter-seam: [data-strategy="range"] toggle present in RuntimePicker');
                }
                if (rangeTogglePresent) {
                  const captionEl = await page.evaluate(() => {
                    const el = document.querySelector('#strategy-caption');
                    return el ? el.textContent?.trim() : null;
                  });
                  check(captionEl !== null && captionEl.length > 5, `adapter-seam: range strategy caption rendered ("${captionEl ?? '(absent)'}")`);
                  const modelChips = page.locator('[data-component="runtime-picker"] [data-model-id]');
                  const chipCount = await modelChips.count();
                  check(chipCount >= 1, `adapter-seam: ≥1 [data-model-id] chip rendered in range mode (got ${chipCount})`);
                  let selectedCount = 0;
                  if (chipCount >= 1) {
                    await modelChips.first().click(); await sleep(THINK); selectedCount = 1;
                    if (chipCount >= 2) { await modelChips.nth(1).click(); await sleep(THINK); selectedCount = 2; }
                    try {
                      await page.waitForFunction(
                        ({ n }) => {
                          const el = document.querySelector('[data-component="runtime-picker"]');
                          return el !== null && parseInt(el.getAttribute('data-model-count') ?? '0', 10) >= n;
                        },
                        { n: selectedCount }, { timeout: 5000 },
                      );
                      const count = await page.evaluate(() =>
                        parseInt(document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-model-count') ?? '0', 10));
                      check(count >= selectedCount, `adapter-seam: data-model-count ≥${selectedCount} after selecting ${selectedCount} chip(s) (got ${count})`);
                    } catch {
                      const gotCount = await page.evaluate(() =>
                        document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-model-count') ?? '(absent)');
                      check(false, `adapter-seam: data-model-count ≥${selectedCount} in range mode (got "${gotCount}")`);
                    }
                  }
                  await frame(page, 's2-1-range-chips', `S2 — range mode: ${selectedCount} Claude tier chip(s) selected; routes to the cheapest capable tier first`);
                }
                const yamlPreviewText = await page.evaluate(() => {
                  const preview = document.querySelector('[data-component="yaml-preview"]');
                  if (preview) return preview.textContent ?? '';
                  const pres = [...document.querySelectorAll('pre')];
                  return pres.find((el) => el.textContent?.includes('strategy'))?.textContent ?? '';
                });
                check(yamlPreviewText.includes('strategy: range'),
                  `adapter-seam: YAML preview contains "strategy: range" (got: "${yamlPreviewText.slice(0, 100).replace(/\n/g, '\\n')}")`);
                await frame(page, 's2-2-yaml-range', 'S2 — YAML preview shows strategy: range (authored in UI; no Save — seed SKILL.md immutable)');
              } else {
                check(false, 'adapter-seam: agent builder page did not become ready — adapter-seam checks skipped');
              }

        },
      },
    ],
});
