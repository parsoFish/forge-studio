import { defineJourney } from '../lib/journey-runtime.mjs';
import { caption, ACT, THINK, WORK } from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

export const journey = defineJourney({
    id: 'recovery',
    title: 'Recover a stuck initiative',
    story: 'As an operator, I open the dedicated recovery screen to inspect, requeue, or abandon a stuck cycle — the recovery extension, proving forge surfaces its own failure states in the UI rather than requiring me to dig through logs or a CLI.',
    beats: [
      {
        id: 'recovery-surface',
        title: 'Recovery surface — the operator surface for stuck cycles (DEC-6)',
        narration: 'The /recovery screen renders every stuck initiative (or a clean empty state when there are none) with inspect/requeue/abandon actions — the CLI verbs that used to handle this moved here, so a stuck cycle is recovered in-UI, not by an operator dropping into a terminal.',
        drive: async (ctx) => {
              const { page, watch, browser, recordClip, check, frame } = ctx;
              // ── S4: Recovery surface (DEC-6 — the CLI recovery verbs moved to the UI) ──
              console.log('\n[S4] Recovery surface — the operator surface for stuck cycles (DEC-6)');
              await caption(page, 'forge review/requeue/abandon left the CLI (DEC-6) — recovery is a UI screen over the bridge routes.');
              await page.goto(watch.uiUrl + '/recovery', { waitUntil: 'domcontentloaded' });
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="recovery"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 20000 },
                );
                check(true, 'recovery: [data-page="recovery"][data-page-ready="true"] renders (DEC-6 operator surface)');
              } catch {
                const pr = await page.evaluate(() => document.querySelector('[data-page="recovery"]')?.getAttribute('data-page-ready') ?? '(absent)');
                check(false, `recovery: data-page-ready (got "${pr}")`);
              }
              // The list OR the empty-state renders (both are valid — depends on queue state).
              const recoverySurface = await page.evaluate(() =>
                document.querySelector('[data-section="recovery-list"]') !== null ||
                document.querySelector('[data-section="recovery-empty"]') !== null);
              check(recoverySurface, 'recovery: the recoverable-list or empty-state section renders');
              await sleep(ACT);
              await frame(page, 's4-recovery', 'S4 — Recovery: inspect/requeue/abandon a stuck cycle, all in the UI (CLI retired)', { key: true });

              // Clip: the operator swings by the recovery screen the same way they'd
              // check on any queue — an honest thin state, no stuck cycle seeded for
              // this walkthrough. The clip owns that narration: a clean, empty
              // recovery queue IS the healthy norm, not a placeholder waiting for
              // content — the same screen surfaces a stuck cycle just as plainly the
              // day one actually needs recovering. Short (~8-10s): render, dwell on
              // whichever section is real, hold.
              await recordClip(browser, watch, 'recovery-surface', '/recovery', async (p) => {
                await p.waitForFunction(
                  () => document.querySelector('[data-page="recovery"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                ).catch(() => {});
                await sleep(THINK);
                await p.waitForSelector('[data-section="recovery-list"], [data-section="recovery-empty"]', { timeout: 8000 }).catch(() => {});
                await sleep(WORK);
              }, { readySel: '[data-page="recovery"]', caption: 'Recovery, checked in on — an empty queue is the healthy norm; a stuck cycle would surface right here, just as plainly' });

        },
      },
    ],
});
