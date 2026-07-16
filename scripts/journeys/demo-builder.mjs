import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  ACT, THINK, WORK, caption,
  writeDemoStatus, demoEvent, demoBurst,
  patchDemoProcess, restoreProjectJson, writeDemoArtifacts, writeDemoLock,
  cleanDemoBuilderSession,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// module-scope cross-beat state (mirrors stand-up-create.mjs's instrSid/pbSid).
let demoSid = null;
let demoClipSid = null;         // demo-builder-generate → demo-builder-lock (clip-only session)
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
      narration: 'Before the agent touches anything, the operator types one line of steering ("give the CLI capture more contrast") into a real briefing field — the regenerate isn\'t a blind rerun, it takes direction first.',
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
      narration: 'The agent works through all three demo-process steps — capture, verify, present — each one bound to its own element, then hands back an iframe preview for the operator to review before anything is locked in.',
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
        await frame(page, 'demo-2-review', 'The demo agent — composed demo ready for review', { key: true });

        // Clip: a fresh clip-only session shows the FULL generation progression —
        // briefing → (real submit-brief click, spawn-suppressed) → generating →
        // awaiting-review — staged with real dwells between each write, so the
        // clip shows the regenerate actually happening rather than a single
        // static hold on the finished review surface. A dedicated sid (not the
        // shared demoSid) keeps this clip's writes off the outer page's own
        // poll on demoSid, which is already sitting at 'awaiting-review' by
        // this point in the beat.
        // SAFETY (S5): cleanDemoBuilderSession() unconditionally wipes the
        // *shared* .forge/demo/ directory (DEMO_FORGE_DIR is NOT sid-scoped,
        // unlike _demo/<sid>/ and _logs/_demo-<sid>/) — cleaning demoClipSid
        // here, mid-beat, would delete DEMO.html before demo-builder-lock's
        // writeDemoLock() reads it back. So the clip session's cleanup is
        // deferred to demo-builder-lock's tail (alongside the existing
        // cleanDemoBuilderSession(demoSid) call), once nothing downstream
        // still needs .forge/demo/.
        demoClipSid = `${demoSid}-clip`;
        writeDemoStatus(demoClipSid, { phase: 'briefing', mode: 'create' });
        await recordClip(browser, watch, 'demo-generate', `/demo/${encodeURIComponent(demoClipSid)}`, async (p) => {
          await p.waitForSelector('main[data-page="demo-builder"]', { timeout: 12000 });
          await p.waitForSelector('[data-section="session-briefing"]', { timeout: 8000 }).catch(() => {});
          await p.locator('[data-field="briefing-notes"]').fill(demoBrief).catch(() => {});
          await sleep(THINK);
          await p.locator('[data-action="submit-brief"]').click().catch(() => {});
          await sleep(ACT);
          writeDemoStatus(demoClipSid, { phase: 'generating', mode: 'create', prompt: demoBrief });
          demoEvent(demoClipSid, 'start', 'demo-builder turn (phase=generating) — composing capture/verify/present');
          await demoBurst(demoClipSid, ['Read', 'Bash', 'Write']);
          await p.waitForFunction(
            () => document.querySelector('[data-page="demo-builder"]')?.getAttribute('data-demo-phase') === 'generating',
            null, { timeout: 10000 },
          ).catch(() => {});
          await sleep(WORK);
          writeDemoArtifacts();
          writeDemoStatus(demoClipSid, { phase: 'awaiting-review', mode: 'create', prompt: demoBrief });
          demoEvent(demoClipSid, 'log', 'demo composed — awaiting review');
          await p.waitForFunction(
            () => document.querySelector('[data-page="demo-builder"]')?.getAttribute('data-demo-phase') === 'awaiting-review',
            null, { timeout: 10000 },
          ).catch(() => {});
          await p.waitForSelector('[data-demo-iframe]', { timeout: 10000 }).catch(() => {});
          await sleep(WORK);
        }, {
          readySel: 'main[data-page="demo-builder"]',
          caption: 'The demo builder: briefed, then composing the page element by element — capture, verify, present',
        });
      },
    },
    {
      id: 'demo-builder-lock',
      title: 'Lock the demo in',
      narration: 'Locking writes demo.lock.json plus a history entry to disk and returns the operator to the project — the regenerated demo becomes the one reproducible artifact for this cycle, not a throwaway preview.',
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
        // The clip-only session's cleanup is deliberately deferred to here (not
        // demo-builder-generate, right after recordClip) — cleanDemoBuilderSession()
        // also unconditionally wipes the shared .forge/demo/ directory, which the
        // writeDemoLock() call above still needed to read from. Safe now: nothing
        // downstream needs .forge/demo/ once the demo is locked.
        cleanDemoBuilderSession(demoClipSid);
        restoreProjectJson(demoJsonStash);
      },
    },
  ],
});
