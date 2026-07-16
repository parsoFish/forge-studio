import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  ACT, caption,
  writeDemoStatus, demoEvent, demoBurst,
  patchDemoProcess, restoreProjectJson, writeDemoArtifacts, writeDemoLock,
  cleanDemoBuilderSession,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// module-scope cross-beat state (mirrors stand-up-create.mjs's instrSid/pbSid).
let demoSid = null;
let demoJsonStash = null;
let demoBrief = '';

export const journey = defineJourney({
  id: 'demo-builder',
  title: 'Regenerate the demo page',
  story: 'As the operator, I regenerate a project\'s demo page element by element — brief the agent, watch it compose the capture/verify/present trio, review the result, and lock it in as the reproducible artifact.',
  beats: [
    {
      id: 'demo-builder-brief',
      title: 'Brief the demo agent',
      narration: 'Brief the demo agent',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[DB-1] demo-builder — brief the agent');
        demoJsonStash = patchDemoProcess();
        demoSid = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-demo';
        ctx.seeded.demoSid = demoSid;
        demoBrief = 'Give the CLI capture a touch more contrast; keep the narrative tight.';
        writeDemoStatus(demoSid, { phase: 'briefing', mode: 'create' });
        await page.goto(watch.uiUrl + `/demo/${encodeURIComponent(demoSid)}`, { waitUntil: 'domcontentloaded' });
        const ready = await page.waitForFunction(
          () => document.querySelector('[data-page="demo-builder"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 },
        ).then(() => true).catch(() => false);
        check(ready, 'DB-1: demo-builder screen renders ([data-page="demo-builder"][data-page-ready="true"])');
        await caption(page, 'Forge regenerates a project\'s demo page — element by element, then locks it in as a reproducible artifact.');
        await page.waitForSelector('[data-section="session-briefing"]', { timeout: 15000 }).catch(() => {});
        check(await page.locator('[data-section="session-briefing"]').count() > 0, 'DB-1: briefing surface offered before the agent runs');
        check(await page.locator('[data-action="submit-brief"]').count() > 0, 'DB-1: submit-brief action present');
        await page.locator('[data-field="briefing-notes"]').fill(demoBrief).catch(() => {});
        await frame(page, 'demo-0-briefing', 'The demo agent — briefing before it runs');
        await page.locator('[data-action="submit-brief"]').click().catch(() => {});
        await sleep(ACT);
      },
    },
    {
      id: 'demo-builder-generate',
      title: 'The demo agent composes the page, element by element',
      narration: 'The demo agent composes the page, element by element',
      drive: async (ctx) => {
        const { page, watch, browser, frame, recordClip, check, countAtLeast } = ctx;
        console.log('\n[DB-2] demo-builder — generate');
        writeDemoStatus(demoSid, { phase: 'generating', mode: 'create', prompt: demoBrief });
        demoEvent(demoSid, 'start', 'demo-builder turn (phase=generating) — composing capture/verify/present');
        await frame(page, 'demo-1-generating', 'The demo agent composes the page, element by element');
        await demoBurst(demoSid, ['Read', 'Bash', 'Write']);
        writeDemoArtifacts();
        writeDemoStatus(demoSid, { phase: 'awaiting-review', mode: 'create', prompt: demoBrief });
        demoEvent(demoSid, 'log', 'demo composed — awaiting review');
        await page.waitForFunction(
          () => document.querySelector('[data-page="demo-builder"]')?.getAttribute('data-demo-phase') === 'awaiting-review',
          null, { timeout: 15000 },
        ).catch(() => {});
        const demoPhaseAttr = await page.evaluate(() => document.querySelector('[data-page="demo-builder"]')?.getAttribute('data-demo-phase') ?? null);
        check(demoPhaseAttr === 'awaiting-review', 'DB-2: phase advances to awaiting-review');
        await page.waitForSelector('[data-component="demo-review"]', { timeout: 15000 }).catch(() => {});
        check(await page.locator('[data-component="demo-review"]').count() > 0, 'DB-2: the demo-review surface renders');
        await page.waitForSelector('[data-demo-iframe]', { timeout: 15000 }).catch(() => {});
        check(await page.locator('[data-demo-iframe]').count() > 0, 'DB-2: the composed demo previews in an iframe');
        check(await page.locator('[data-section="demo-process"][data-step-count="3"]').count() > 0, 'DB-2: the demo process shows all 3 element-bound steps');
        await countAtLeast(page, '[data-step-element]', 3, 'DB-2: all 3 demo-process steps carry a data-step-element');
        await frame(page, 'demo-2-review', 'The demo agent — composed demo ready for review');
        await recordClip(browser, watch, 'demo-generate', `/demo/${encodeURIComponent(demoSid)}`, async (p) => {
          await p.waitForSelector('main[data-page="demo-builder"]', { timeout: 12000 });
          await p.waitForSelector('[data-component="demo-review"]', { timeout: 8000 }).catch(() => {});
          await sleep(2600);
        }, { readySel: 'main[data-page="demo-builder"]', caption: 'The demo builder regenerates the page element by element' });
      },
    },
    {
      id: 'demo-builder-lock',
      title: 'Lock the demo in',
      narration: 'Lock the demo in',
      drive: async (ctx) => {
        const { page, frame, check } = ctx;
        console.log('\n[DB-3] demo-builder — lock');
        await page.locator('[data-action="lock-demo"]').click().catch(() => {});
        await sleep(ACT);
        writeDemoLock(demoSid, demoBrief);
        demoEvent(demoSid, 'log', 'demo locked (.forge/demo/demo.lock.json + history/ written)');
        writeDemoStatus(demoSid, { phase: 'locked', mode: 'create', prompt: demoBrief });
        await page.waitForSelector('[data-section="demo-status"] [data-action="back-to-project"]', { timeout: 15000 }).catch(() => {});
        check(await page.locator('[data-section="demo-status"]').count() > 0, 'DB-3: the locked success surface renders');
        check(await page.locator('[data-section="demo-status"] [data-action="back-to-project"]').count() > 0, 'DB-3: back-to-project offered once locked');
        await frame(page, 'demo-3-locked', 'The demo agent — locked in as the reproducible demo artifact');

        // Self-contained cleanup (e2e-journey.mjs's finally block is out of this
        // task's touch-scope, so this journey cleans up its own state here).
        cleanDemoBuilderSession(demoSid);
        restoreProjectJson(demoJsonStash);
      },
    },
  ],
});
