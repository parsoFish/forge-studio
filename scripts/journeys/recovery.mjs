import { defineJourney } from '../lib/journey-runtime.mjs';
import { caption, ACT } from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

export const journey = defineJourney({
    id: 'recovery',
    title: 'Recover a stuck initiative',
    story: 'Recover a stuck initiative from the dedicated operator surface.',
    beats: [
      {
        id: 'recovery-surface',
        title: 'Recovery surface — the operator surface for stuck cycles (DEC-6)',
        narration: 'Recovery surface — the operator surface for stuck cycles (DEC-6)',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
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
              await frame(page, 's4-recovery', 'S4 — Recovery: inspect/requeue/abandon a stuck cycle, all in the UI (CLI retired)');

        },
      },
    ],
});
