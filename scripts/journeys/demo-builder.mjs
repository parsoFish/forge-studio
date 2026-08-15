import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  ACT, THINK, WORK, caption, PROJECT,
  writeDemoStatus, demoEvent, demoBurst,
  patchDemoProcess, restoreProjectJson, writeDemoArtifacts, writeDemoLock,
  writeDemoGeneration, cleanDemoBuilderSession, demoDir,
} from '../lib/journey-fixtures.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from '../lib/journey-assertions.mjs';

// module-scope cross-beat state (mirrors stand-up-create.mjs's instrSid/pbSid).
let demoSid = null;
let demoClipSid = null;         // demo-builder-generate → demo-builder-lock (clip-only session)
let demoJsonStash = null;
let demoBrief = '';

export const journey = defineJourney({
  id: 'demo-builder',
  title: 'Regenerate the demo page',
  story: 'As the operator, I regenerate a project\'s demo page element by element WITHOUT leaving the project page (R1-03-F2: the demo builder is an inline panel, not a detached route) — brief the agent, watch it compose the capture/verify/present trio, feed back on what I see, and watch the next generation land BESIDE the first (R4-16) so I can finalize the take I actually want as the project\'s reproducible demo skill.',
  beats: [
    {
      id: 'demo-builder-brief',
      title: 'Brief the demo agent',
      narration: 'The demo builder now lives ON the project page (R1-03-F2) — the operator opens the session inline, right beneath the demo timeline, and types one line of steering ("give the CLI capture more contrast") into a real briefing field before the agent touches anything. The regenerate isn\'t a blind rerun, and it isn\'t a separate screen.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[DB-1] demo-builder — brief the agent');
        demoJsonStash = patchDemoProcess();
        demoSid = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-demo';
        ctx.seeded.demoSid = demoSid;
        demoBrief = 'Give the CLI capture a touch more contrast; keep the narrative tight.';
        writeDemoStatus(demoSid, { phase: 'briefing', mode: 'create' });
        // R1-03-F2: entry is the PROJECT PAGE (?demo= deep link — the panel is
        // inline; the old /demo/<sid> route is a redirect stub back here).
        await page.goto(watch.uiUrl + `/projects/${PROJECT}?demo=${encodeURIComponent(demoSid)}`, { waitUntil: 'domcontentloaded' });
        const ready = await page.waitForFunction(
          () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 },
        ).then(() => true).catch(() => false);
        check(ready, 'DB-1: the project page renders ([data-page="projects"][data-page-ready="true"])');
        const panelUp = await page.waitForSelector('[data-section="demo-builder-panel"]', { timeout: 15000 }).then(() => true).catch(() => false);
        check(panelUp, 'DB-1: the inline demo-builder panel opens on the project page ([data-section="demo-builder-panel"])');
        await caption(page, 'Forge regenerates a project\'s demo page — inline on the project page, element by element, then locks it in as a reproducible artifact.');
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
        // R4-16: the turn's output is SNAPSHOTTED as generation 1, so it
        // survives the next generation instead of being overwritten.
        writeDemoGeneration(demoSid, 1);
        writeDemoStatus(demoSid, { phase: 'awaiting-review', mode: 'create', prompt: demoBrief });
        demoEvent(demoSid, 'log', 'demo composed — awaiting review');
        await page.waitForFunction(
          () => document.querySelector('[data-section="demo-builder-panel"]')?.getAttribute('data-demo-phase') === 'awaiting-review',
          null, { timeout: 15000 },
        ).catch(() => {});
        const demoPhaseAttr = await page.evaluate(() => document.querySelector('[data-section="demo-builder-panel"]')?.getAttribute('data-demo-phase') ?? null);
        check(demoPhaseAttr === 'awaiting-review', 'DB-2: the panel phase advances to awaiting-review');
        await page.waitForSelector('[data-component="demo-review"]', { timeout: 15000 }).catch(() => {});
        check(await page.locator('[data-component="demo-review"]').count() > 0, 'DB-2: the demo-review surface renders');
        await page.waitForSelector('[data-demo-iframe]', { timeout: 15000 }).catch(() => {});
        check(await page.locator('[data-demo-iframe]').count() > 0, 'DB-2: the composed demo previews in an iframe');
        check(await page.locator('[data-section="demo-process"][data-step-count="3"]').count() > 0, 'DB-2: the demo process shows all 3 element-bound steps');
        await countAtLeast(page, '[data-step-element]', 3, 'DB-2: all 3 demo-process steps carry a data-step-element');
        // R4-16: the generation gallery renders IN PLACE on the project page
        // (R1-03-F2 not reversed) through the R2-10 shell's own artifact pane.
        // Wait for the state rather than sampling it — the panel refetches on
        // its 3s poll, so a bare read here would be a coin flip (the two-poll
        // race R4-15 diagnosed).
        const gal1 = await page.waitForFunction(
          () => document.querySelector('[data-section="generation-gallery"]')?.getAttribute('data-generation-count') === '1',
          null, { timeout: 15000 },
        ).then(() => true).catch(() => false);
        check(gal1, 'DB-2: the generation gallery renders generation 1 through the session shell ([data-generation-count="1"])');
        check(
          await page.locator('[data-section="session-artifact"][data-artifact-kind="generation-gallery"]').count() > 0,
          'DB-2: it is the SHELL artifact pane doing the rendering, not a panel-local copy ([data-artifact-kind="generation-gallery"])',
        );
        check(
          await page.locator('[data-generation-item][data-item-path="DEMO.html"]').count() > 0,
          'DB-2: the snapshotted sample is listed as a real item with its path',
        );
        check(
          await page.locator('[data-section="generation-feedback"][data-has-feedback="false"]').count() > 0,
          'DB-2: generation 1 honestly reports no feedback drove it (the brief did)',
        );
        await frame(page, 'demo-2-review', 'The demo agent — composed demo ready for review', { key: true });

        // Clip: a fresh clip-only session shows the FULL entry-to-generation
        // progression — starting at the project page's own demo affordance (the
        // "Build the demo with the agent" button an operator would actually
        // click), hovering it (never clicking — onLaunchDemoBuilder() is a real
        // side-effecting API call, and this clip must never trigger a second
        // spawn against the canonical project) — then transitioning into the
        // clip-only session: briefing → (real submit-brief click,
        // spawn-suppressed) → generating → awaiting-review — staged with real
        // dwells between each write, so the clip shows the regenerate actually
        // happening rather than a single static hold on the finished review
        // surface. A dedicated sid (not the shared demoSid) keeps this clip's
        // writes off the outer page's own poll on demoSid, which is already
        // sitting at 'awaiting-review' by this point in the beat.
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
        await recordClip(browser, watch, 'demo-generate', `/projects/${PROJECT}`, async (p) => {
          await p.waitForFunction(
            () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 },
          ).catch(() => {});
          await caption(p, 'From the project page — "Build the demo with the agent" opens the builder right here, inline.');
          const launchBtn = p.locator('[data-action="launch-demo-builder"]').first();
          await launchBtn.scrollIntoViewIfNeeded().catch(() => {});
          await launchBtn.hover().catch(() => {});
          await sleep(THINK);
          // No click on [data-action="launch-demo-builder"] — onLaunchDemoBuilder()
          // is a real side-effecting API call. Deep-link the clip-only session
          // instead (?demo= — same page, panel opens inline).
          await p.goto(watch.uiUrl + `/projects/${PROJECT}?demo=${encodeURIComponent(demoClipSid)}`, { waitUntil: 'domcontentloaded' });
          await p.waitForSelector('[data-section="demo-builder-panel"]', { timeout: 12000 });
          await p.waitForSelector('[data-section="session-briefing"]', { timeout: 8000 }).catch(() => {});
          await p.locator('[data-field="briefing-notes"]').fill(demoBrief).catch(() => {});
          await sleep(THINK);
          await p.locator('[data-action="submit-brief"]').click().catch(() => {});
          await sleep(ACT);
          writeDemoStatus(demoClipSid, { phase: 'generating', mode: 'create', prompt: demoBrief });
          demoEvent(demoClipSid, 'start', 'demo-builder turn (phase=generating) — composing capture/verify/present');
          await demoBurst(demoClipSid, ['Read', 'Bash', 'Write']);
          await p.waitForFunction(
            () => document.querySelector('[data-section="demo-builder-panel"]')?.getAttribute('data-demo-phase') === 'generating',
            null, { timeout: 10000 },
          ).catch(() => {});
          await sleep(WORK);
          writeDemoArtifacts();
          writeDemoGeneration(demoClipSid, 1);
          writeDemoStatus(demoClipSid, { phase: 'awaiting-review', mode: 'create', prompt: demoBrief });
          demoEvent(demoClipSid, 'log', 'demo composed — awaiting review');
          await p.waitForFunction(
            () => document.querySelector('[data-section="demo-builder-panel"]')?.getAttribute('data-demo-phase') === 'awaiting-review',
            null, { timeout: 10000 },
          ).catch(() => {});
          await p.waitForSelector('[data-demo-iframe]', { timeout: 10000 }).catch(() => {});
          await sleep(WORK);
        }, {
          readySel: '[data-page="projects"]',
          caption: 'The demo builder, inline on the project page: briefed, then composing the page element by element — capture, verify, present',
        });
      },
    },
    {
      id: 'demo-builder-session-shell',
      title: 'The same session, on the shared session shell (the generic panel)',
      narration: 'The inline project-page panel is not the only door into this session — R1-03-F2 never reversed, but W6-B6 wires "demo" onto the shared, generic session shell too: the SAME awaiting-review session, opened at /sessions/demo/<sid>, now renders the generic interaction panel — derived from the phase table, never re-authored — offering approve/reject with a generation picker.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[DB-2b] demo-builder — the same session on the generic session shell');
        // READ-ONLY: this beat only navigates and asserts — it never clicks
        // verdict-approve/verdict-reject, so demoSid's canonical
        // 'awaiting-review' state (still needed by demo-builder-generations,
        // the very next beat, on the SAME page object) is never mutated.
        await page.goto(`${watch.uiUrl}/sessions/demo/${encodeURIComponent(demoSid)}?project=${encodeURIComponent(PROJECT)}`,
          { waitUntil: 'domcontentloaded' });
        const shellReady = await page.waitForFunction(
          () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 15000 },
        ).then(() => true).catch(() => false);
        check(shellReady, 'DB-2b: the generic session shell renders for kind=demo ([data-page="session"][data-page-ready="true"])');
        await caption(page, 'The same demo session, on the shared shell — one generic panel, derived from the phase table.');
        await page.waitForSelector('[data-component="session-interactive-panel"]', { timeout: 15000 }).catch(() => {});
        check(await page.locator('[data-component="session-interactive-panel"]').count() > 0,
          'DB-2b: the generic SessionInteractivePanel renders (W6-B6)');
        check(await page.locator('[data-section="session-provenance"]').count() > 0,
          'DB-2b: the provenance strip is visible ("derived from phase …")');
        check(await page.locator('[data-affordance-kind="verdict"]').count() > 0,
          'DB-2b: awaiting-review derives a verdict affordance (approve/reject)');
        check(await page.locator('[data-action="verdict-approve"]').count() > 0
          && await page.locator('[data-action="verdict-reject"]').count() > 0,
          'DB-2b: both approve and reject render for demo (unlike kb-cleanup/authoring, which are approve-only)');
        check(await page.locator('[data-field="session-generation-pick"]').count() > 0,
          'DB-2b: the demo-only generation picker renders, sourced from the real generation-gallery artifact already on the wire');
        await frame(page, 'demo-2b-session-shell', 'The generic session shell — the same session, the generic interaction panel', { key: true });

        // Navigate back to the project page's inline panel — demo-builder-
        // generations (the very next beat) continues driving the SAME `page`
        // object against the inline panel, unaware this beat took a detour.
        await page.goto(`${watch.uiUrl}/projects/${PROJECT}?demo=${encodeURIComponent(demoSid)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-section="demo-builder-panel"]')?.getAttribute('data-demo-phase') === 'awaiting-review',
          null, { timeout: 15000 },
        ).catch(() => {});
        check(await page.locator('[data-section="demo-builder-panel"][data-demo-phase="awaiting-review"]').count() > 0,
          'DB-2b: back on the inline project-page panel, unchanged, for the next beat to continue driving');
      },
    },
    {
      id: 'demo-builder-generations',
      title: 'Feedback drives the next generation — side by side',
      narration: 'The operator does not accept or reject a single take. Real feedback goes back to the agent, the next generation lands beside the first — numbered, accumulating, never overwriting — and the operator can sit on an earlier generation for as long as they like while the panel keeps polling.',
      drive: async (ctx) => {
        const { page, frame, check } = ctx;
        console.log('\n[DB-3] demo-builder — generations accumulate');
        const feedbackText = 'Keep the CLI capture, but lead with the test evidence card.';
        // REAL round trip: the operator types into the real review surface and
        // the real bridge route writes feedback.md + bumps the iteration.
        await page.locator('[data-field="demo-feedback"]').fill(feedbackText).catch(() => {});
        await page.locator('[data-action="apply-feedback"]').click().catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-section="demo-builder-panel"]')?.getAttribute('data-demo-phase') === 'generating',
          null, { timeout: 15000 },
        ).catch(() => {});
        const feedbackOnDisk = (() => {
          try { return readFileSync(join(demoDir(demoSid), 'feedback.md'), 'utf8'); } catch { return ''; }
        })();
        check(feedbackOnDisk === feedbackText, 'DB-3: the real bridge route persisted the operator\'s feedback to the session\'s feedback.md');

        demoEvent(demoSid, 'start', 'demo-builder turn (phase=generating) — applying operator feedback');
        writeDemoArtifacts();
        // The generation records the feedback it was DRIVEN BY, read from the
        // real feedback.md the bridge just wrote — never passed in by the
        // harness, so the assertion below is a real round trip.
        writeDemoGeneration(demoSid, 2, feedbackText);
        writeDemoStatus(demoSid, { phase: 'awaiting-review', mode: 'create', prompt: demoBrief, iteration: 2 });
        demoEvent(demoSid, 'log', 'generation 2 composed — awaiting review');

        const twoGens = await page.waitForFunction(
          () => document.querySelector('[data-section="generation-gallery"]')?.getAttribute('data-generation-count') === '2',
          null, { timeout: 20000 },
        ).then(() => true).catch(() => false);
        check(twoGens, 'DB-3: generation 2 lands BESIDE generation 1 — the gallery accumulates ([data-generation-count="2"])');
        check(await page.locator('[data-action="select-generation"][data-generation-number="1"]').count() > 0, 'DB-3: generation 1 is still selectable — the earlier take was not overwritten');
        check(await page.locator('[data-action="select-generation"][data-generation-number="2"]').count() > 0, 'DB-3: generation 2 is selectable');
        const selectedNow = await page.evaluate(() => document.querySelector('[data-section="generation-gallery"]')?.getAttribute('data-selected-generation') ?? null);
        check(selectedNow === '2', 'DB-3: the newest generation is selected by default');
        const shownFeedback = await page.evaluate(() => document.querySelector('[data-section="generation-feedback"]')?.textContent ?? '');
        check(
          shownFeedback.includes('lead with the test evidence card'),
          'DB-3: the gallery shows the operator\'s OWN words as the feedback that drove generation 2 (real POST → real feedback.md → real derivation → real DOM)',
        );
        await frame(page, 'demo-3-generations', 'Generations accumulate — feedback drives the next one', { key: true });

        // Pick the earlier generation and prove the choice SURVIVES a poll
        // tick. The panel refetches every 3s with a freshly-parsed payload; a
        // selection that resets on each tick cannot be acted on, so this is
        // asserted after more than one full interval, not immediately.
        await page.locator('[data-action="select-generation"][data-generation-number="1"]').click().catch(() => {});
        const picked = await page.waitForFunction(
          () => document.querySelector('[data-section="generation-gallery"]')?.getAttribute('data-selected-generation') === '1',
          null, { timeout: 10000 },
        ).then(() => true).catch(() => false);
        check(picked, 'DB-3: the operator can select the earlier generation ([data-selected-generation="1"])');
        await sleep(4200); // > one 3s poll interval — deliberate, not padding
        const stillPicked = await page.evaluate(() => document.querySelector('[data-section="generation-gallery"]')?.getAttribute('data-selected-generation') ?? null);
        check(stillPicked === '1', 'DB-3: the selection SURVIVES a refetch — the poll does not snap the operator back to the newest generation');
        await frame(page, 'demo-4-generation-picked', 'The operator sits on generation 1 — the choice holds across the poll');
      },
    },
    {
      id: 'demo-builder-lock',
      title: 'Finalize the chosen generation',
      narration: 'Finalizing the chosen generation restores that take — its sample AND the generator skill that produced it — into the project repo, then writes demo.lock.json plus a history entry. The operator never left the project page, and the demo skill the runner will execute from now on is the one they picked, not merely the last one the agent happened to produce.',
      drive: async (ctx) => {
        const { page, frame, check } = ctx;
        console.log('\n[DB-4] demo-builder — finalize the chosen generation');
        check(
          await page.locator('[data-action="lock-demo"]').count() > 0,
          'DB-4: the plain "lock the current sample" control is still offered (R4-16 added a chooser, it did not replace the existing path)',
        );
        // R4-16: finalize GENERATION 1 — the one selected in DB-3, not the
        // newest. This POSTs to the real bridge lock route with the chosen
        // generation number.
        await page.locator('[data-action="finalize-generation"][data-generation-number="1"]').click().catch(() => {});
        await sleep(ACT);
        const persisted = (() => {
          try { return JSON.parse(readFileSync(join(demoDir(demoSid), 'status.json'), 'utf8')); } catch { return {}; }
        })();
        check(
          persisted.selectedGeneration === 1,
          'DB-4: the real bridge persisted the operator\'s choice to status.json (selectedGeneration=1) — the lock step enforces it',
        );
        writeDemoLock(demoSid, demoBrief, 1);
        demoEvent(demoSid, 'log', 'demo locked (.forge/demo/demo.lock.json + history/ written)');
        writeDemoStatus(demoSid, { phase: 'locked', mode: 'create', prompt: demoBrief, iteration: 2, selectedGeneration: 1 });
        await page.waitForSelector('[data-section="demo-status"]', { timeout: 15000 }).catch(() => {});
        check(await page.locator('[data-section="demo-status"]').count() > 0, 'DB-4: the locked success surface renders in the panel');
        check(
          await page.locator('[data-section="demo-builder-panel"] [data-action="close-demo-panel"]').count() > 0,
          'DB-4: close-demo-panel offered once locked (the operator is already on the project page — R1-03-F2)',
        );
        await frame(page, 'demo-5-locked', 'The chosen generation — locked in as the reproducible demo artifact');

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
    {
      id: 'demo-builder-kickoff',
      title: 'Kick off a brand-new demo session from the generic kickoff screen',
      narration: 'Every interactive kind now shares ONE kickoff screen (W6-B6, /sessions/<kind>/new) — the operator picks a project AND a model tier within the demo-builder skill\'s own declared range (sonnet/opus), hits Start, and lands on the real, server-minted session, straight on the shared shell, with the picked tier persisted to its status.json. This is a SEPARATE, self-contained session — it never touches demoSid or the shared .forge/demo/ lock this journey\'s own beats already exercised above.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[DB-6] demo-builder — the generic kickoff screen');
        let kickoffSid = null;
        try {
          await page.goto(`${watch.uiUrl}/sessions/demo/new`, { waitUntil: 'domcontentloaded' });
          const ready = await page.waitForFunction(
            () => document.querySelector('[data-page="session-kickoff"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 },
          ).then(() => true).catch(() => false);
          check(ready, 'DB-6: the generic kickoff screen renders ([data-page="session-kickoff"])');
          await caption(page, 'One kickoff screen for every session kind — project, model tier, Start.');
          await page.locator('[data-field="kickoff-project"]').fill(PROJECT).catch(() => {});

          // W6-B6 post-merge review (MEDIUM): demo-builder is a
          // strategy:range skill (range: [sonnet, opus]) — the picker must
          // render as a radio group, never the read-only fixed chip.
          const pickerKind = await page.evaluate(
            () => document.querySelector('[data-section="kickoff-model-tier"]')?.getAttribute('data-model-tier-picker') ?? null,
          );
          check(pickerKind === 'range', `DB-6: demo-builder's model-tier picker renders as a RANGE radio group (got "${pickerKind}")`);
          const opusOption = page.locator('[data-field="kickoff-model-tier-option"] input[value="opus"]');
          check(await opusOption.count() > 0, 'DB-6: the "opus" tier — the top of demo-builder\'s declared range — is offered as a real radio option');
          await opusOption.check().catch(() => {});
          await frame(page, 'demo-6-kickoff', 'The generic kickoff screen — demo, model tier picked, ready to start');
          const startEnabled = await page.locator('[data-action="start-session"]:not([disabled])').count() > 0;
          check(startEnabled, 'DB-6: Start enables once a project is filled in');
          await page.locator('[data-action="start-session"]').click().catch(() => {});
          const navigated = await page.waitForFunction(
            () => /^\/sessions\/demo\/[^/]+$/.test(window.location.pathname),
            null, { timeout: 15000 },
          ).then(() => true).catch(() => false);
          check(navigated, 'DB-6: Start POSTs the real /api/demo-builder/start route and navigates onto the shared session shell');
          kickoffSid = navigated ? decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '') : null;
          check(!!kickoffSid, `DB-6: a real, server-minted session id was captured (got "${kickoffSid}")`);
          const shellReady = await page.waitForFunction(
            () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 },
          ).then(() => true).catch(() => false);
          check(shellReady, 'DB-6: the freshly-kicked-off session opens live on the shared session shell');
          await frame(page, 'demo-7-kickoff-session', 'The freshly-kicked-off demo session — briefing, on the shared shell', { key: true });

          // W6-B6 post-merge review (MEDIUM): the picked tier must round-trip
          // all the way through — POST /api/demo-builder/start persisted it
          // to status.json, and the shell GET reads it straight back as
          // "modelTier", never silently dropped.
          const shellRes = await fetch(`${watch.bridgeUrl}/api/studio/sessions/demo/${encodeURIComponent(kickoffSid)}?project=${encodeURIComponent(PROJECT)}`);
          const shellBody = shellRes.ok ? await shellRes.json() : null;
          check(shellBody?.modelTier === 'opus', `DB-6: the kicked-off session's own modelTier reads back as "opus" (the picked tier), got: ${JSON.stringify(shellBody?.modelTier)}`);
        } finally {
          // Self-contained (mirrors demo-builder-lock's own tail). This is
          // the LAST beat in this journey, so cleanDemoBuilderSession's
          // unconditional wipe of the shared .forge/demo/ dir — already
          // empty, demo-builder-lock wiped it above once its own lock was
          // read back — is harmless here; nothing downstream needs it.
          if (kickoffSid) cleanDemoBuilderSession(kickoffSid);
        }
      },
    },
  ],
});
