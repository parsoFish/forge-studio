import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  ACT, THINK, WORK, caption, PROJECT,
  writeDemoStatus, demoEvent, demoBurst,
  patchDemoProcess, restoreProjectJson, writeDemoArtifacts, writeDemoLock,
  writeDemoGeneration, cleanDemoBuilderSession,
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
  story: 'As the operator, I regenerate a project\'s demo page on its own DEDICATED session screen (W6-B10, R1-03-F2 reversed: the demo builder used to be an inline panel; now it is the SAME shared session screen every interactive kind renders through) — brief the agent, watch it compose the capture/verify/present trio, then approve the generation it produced (picking exactly which one, if more than one exists) to finalize it as the project\'s reproducible demo skill.',
  beats: [
    {
      id: 'demo-builder-brief',
      title: 'Brief the demo agent',
      narration: 'The demo builder is its own session screen (W6-B10) — the operator launches it from the project page\'s Demo Timeline, lands on /sessions/demo/<sid>, and types one line of steering ("give the CLI capture more contrast") into the SAME generic free-text box every interactive session offers before the agent touches anything. The regenerate isn\'t a blind rerun, and it isn\'t a second, bespoke screen just for demo.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[DB-1] demo-builder — brief the agent');
        demoJsonStash = patchDemoProcess();
        demoSid = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-demo';
        ctx.seeded.demoSid = demoSid;
        demoBrief = 'Give the CLI capture a touch more contrast; keep the narrative tight.';
        writeDemoStatus(demoSid, { phase: 'briefing', mode: 'create' });
        // W6-B10: entry is the DEDICATED SESSION SCREEN — the old inline
        // ?demo= deep link on the project page is gone (DemoBuilderPanel
        // deleted); /demo/<sid> is now a plain wire redirect onto this exact
        // route (next.config.mjs).
        await page.goto(watch.uiUrl + `/sessions/demo/${encodeURIComponent(demoSid)}?project=${encodeURIComponent(PROJECT)}`, { waitUntil: 'domcontentloaded' });
        const ready = await page.waitForFunction(
          () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 },
        ).then(() => true).catch(() => false);
        check(ready, 'DB-1: the dedicated session screen renders ([data-page="session"][data-page-ready="true"])');
        const kind = await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-kind') ?? null);
        check(kind === 'demo', `DB-1: the shell resolves kind="demo" (got "${kind}")`);
        await caption(page, 'Forge regenerates a project\'s demo page — its own session screen, briefed before it runs, then locked in as a reproducible artifact.');
        const panelUp = await page.waitForSelector('[data-component="session-interactive-panel"]', { timeout: 15000 }).then(() => true).catch(() => false);
        check(panelUp, 'DB-1: the generic interaction panel renders ([data-component="session-interactive-panel"])');
        check(await page.locator('[data-affordance-kind="question-form"]').count() > 0, 'DB-1: the briefing phase derives a question-form affordance (W6-B10\'s fix — every demo session starts here)');
        check(await page.locator('[data-field="session-answer"]').count() > 0, 'DB-1: a free-text answer box is offered before the agent runs');
        check(await page.locator('[data-action="submit-answers"]').count() > 0, 'DB-1: submit-answers action present');
        await page.locator('[data-field="session-answer"]').fill(demoBrief).catch(() => {});
        await frame(page, 'demo-0-briefing', 'The demo agent — briefing before it runs');
        // REAL POST: this exercises handleDemoBrief (cli/bridge-studio-affordances.ts)
        // for real — the SAME generic route every kind's question-form uses.
        await page.locator('[data-action="submit-answers"]').click().catch(() => {});
        await sleep(ACT);
      },
    },
    {
      id: 'demo-builder-generate',
      title: 'The demo agent composes the page',
      narration: 'The agent composes the demo, then hands back an iframe-viewable generation for the operator to review before anything is locked in. While it works, the shared ActivityLog drawer (wired generically into the session shell, W6-B10) shows real progress — never a silent hold with only disabled "not yet wired" buttons as the signal.',
      drive: async (ctx) => {
        const { page, watch, browser, frame, recordClip, check, countAtLeast } = ctx;
        console.log('\n[DB-2] demo-builder — generate');
        writeDemoStatus(demoSid, { phase: 'generating', mode: 'create', prompt: demoBrief });
        demoEvent(demoSid, 'start', 'demo-builder turn (phase=generating) — composing capture/verify/present');
        const generating = await page.waitForFunction(
          () => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') === 'generating',
          null, { timeout: 15000 },
        ).then(() => true).catch(() => false);
        check(generating, 'DB-2: the phase advances to generating');
        await demoBurst(demoSid, ['Read', 'Bash', 'Write']);
        // W6-B10: the shared ActivityLog drawer, shown because 'generating'
        // derives ONLY not-yet-wired affordances (writes+next, no noop) —
        // nothing actionable, so this is what tells the operator work is
        // actually happening.
        check(await page.locator('[data-component="activity-drawer"]').count() > 0,
          'DB-2: the ActivityLog drawer renders during the working (generating) phase — SessionInteractivePanel, generic over kind');
        await frame(page, 'demo-1-generating', 'The demo agent composes the page — the ActivityLog shows real progress');
        writeDemoArtifacts();
        // R4-16: the turn's output is SNAPSHOTTED as generation 1, so it
        // survives a later generation instead of being overwritten.
        writeDemoGeneration(demoSid, 1);
        writeDemoStatus(demoSid, { phase: 'awaiting-review', mode: 'create', prompt: demoBrief });
        demoEvent(demoSid, 'log', 'demo composed — awaiting review');
        await page.waitForFunction(
          () => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') === 'awaiting-review',
          null, { timeout: 15000 },
        ).catch(() => {});
        check(await page.locator('[data-page="session"][data-session-phase="awaiting-review"]').count() > 0, 'DB-2: the phase advances to awaiting-review');
        check(await page.locator('[data-component="activity-drawer"]').count() === 0, 'DB-2: the ActivityLog drops away once there is something actionable again (awaiting-review derives a verdict)');

        // R4-16: the generation gallery renders through the R2-10 shell's own
        // artifact pane — the ONLY mount now (W6-B10 retired the inline
        // panel's second copy of the same renderer). Wait for the state
        // rather than sampling it — the shell refetches on its 3s poll, so a
        // bare read here would be a coin flip (the two-poll race R4-15
        // diagnosed).
        const gal1 = await page.waitForFunction(
          () => document.querySelector('[data-section="generation-gallery"]')?.getAttribute('data-generation-count') === '1',
          null, { timeout: 15000 },
        ).then(() => true).catch(() => false);
        check(gal1, 'DB-2: the generation gallery renders generation 1 through the session shell ([data-generation-count="1"])');
        check(
          await page.locator('[data-section="session-artifact"][data-artifact-kind="generation-gallery"]').count() > 0,
          'DB-2: it is the SHELL artifact pane doing the rendering ([data-artifact-kind="generation-gallery"])',
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
        // spawn against the canonical project) — then transitioning onto the
        // dedicated session screen for a clip-only session: briefing → (real
        // submit-answers click, spawn-suppressed) → generating →
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
        await recordClip(browser, watch, 'demo-generate', `/projects/${PROJECT}`, async (p) => {
          await p.waitForFunction(
            () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 },
          ).catch(() => {});
          await caption(p, 'From the project page — "Build the demo with the agent" opens its own session screen.');
          const launchBtn = p.locator('[data-action="launch-demo-builder"]').first();
          await launchBtn.scrollIntoViewIfNeeded().catch(() => {});
          await launchBtn.hover().catch(() => {});
          await sleep(THINK);
          // No click on [data-action="launch-demo-builder"] — onLaunchDemoBuilder()
          // is a real side-effecting API call. Navigate the clip-only session
          // directly to its own dedicated screen instead.
          await p.goto(watch.uiUrl + `/sessions/demo/${encodeURIComponent(demoClipSid)}?project=${encodeURIComponent(PROJECT)}`, { waitUntil: 'domcontentloaded' });
          await p.waitForSelector('[data-component="session-interactive-panel"]', { timeout: 12000 });
          await p.waitForSelector('[data-field="session-answer"]', { timeout: 8000 }).catch(() => {});
          await p.locator('[data-field="session-answer"]').fill(demoBrief).catch(() => {});
          await sleep(THINK);
          await p.locator('[data-action="submit-answers"]').click().catch(() => {});
          await sleep(ACT);
          writeDemoStatus(demoClipSid, { phase: 'generating', mode: 'create', prompt: demoBrief });
          demoEvent(demoClipSid, 'start', 'demo-builder turn (phase=generating) — composing capture/verify/present');
          await demoBurst(demoClipSid, ['Read', 'Bash', 'Write']);
          await p.waitForFunction(
            () => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') === 'generating',
            null, { timeout: 10000 },
          ).catch(() => {});
          await sleep(WORK);
          writeDemoArtifacts();
          writeDemoGeneration(demoClipSid, 1);
          writeDemoStatus(demoClipSid, { phase: 'awaiting-review', mode: 'create', prompt: demoBrief });
          demoEvent(demoClipSid, 'log', 'demo composed — awaiting review');
          await p.waitForFunction(
            () => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') === 'awaiting-review',
            null, { timeout: 10000 },
          ).catch(() => {});
          await p.waitForSelector('[data-affordance-kind="verdict"]', { timeout: 10000 }).catch(() => {});
          await sleep(WORK);
        }, {
          readySel: '[data-page="projects"]',
          caption: 'The demo builder, on its own session screen: briefed, then composing the page',
        });
      },
    },
    {
      id: 'demo-builder-lock',
      title: 'Approve and finalize the generation',
      narration: 'The review gate is the SAME generic verdict every interactive session offers — approve (with an optional generation picker, sourced from the real gallery) or reject. Approving restores the chosen generation\'s sample AND the generator skill that produced it into the project repo, then writes demo.lock.json plus a history entry — the demo skill the runner executes from now on is the one the operator picked, not merely the last one the agent happened to produce.',
      drive: async (ctx) => {
        const { page, frame, check } = ctx;
        console.log('\n[DB-3] demo-builder — approve and lock');
        check(await page.locator('[data-affordance-kind="verdict"]').count() > 0, 'DB-3: awaiting-review derives a verdict affordance');
        check(await page.locator('[data-action="verdict-approve"]').count() > 0
          && await page.locator('[data-action="verdict-reject"]').count() > 0,
          'DB-3: both approve and reject render for demo (unlike kb-cleanup/authoring, which are approve-only)');
        const picker = page.locator('[data-field="session-generation-pick"]');
        check(await picker.count() > 0, 'DB-3: the generation picker renders, sourced from the real generation-gallery artifact already on the wire');
        await picker.selectOption('1').catch(() => {});
        await frame(page, 'demo-3-review', 'The generic verdict gate — approve (with the generation picker) or reject', { key: true });

        // REAL POST: exercises handleDemoVerdict for real — the SAME route
        // the bespoke /api/demo-builder/lock parity test targets.
        await page.locator('[data-action="verdict-approve"]').click().catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') === 'locking',
          null, { timeout: 15000 },
        ).catch(() => {});
        writeDemoLock(demoSid, demoBrief, 1);
        demoEvent(demoSid, 'log', 'demo locked (.forge/demo/demo.lock.json + history/ written)');
        writeDemoStatus(demoSid, { phase: 'locked', mode: 'create', prompt: demoBrief, selectedGeneration: 1 });
        const locked = await page.waitForFunction(
          () => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') === 'locked',
          null, { timeout: 15000 },
        ).then(() => true).catch(() => false);
        check(locked, 'DB-3: the phase advances to locked');
        check(await page.locator('[data-component="session-interactive-panel"][data-affordance-count="0"]').count() > 0,
          'DB-3: locked is terminal — no further operator affordance (the shell\'s own honest "no operator action" state)');
        await frame(page, 'demo-4-locked', 'The chosen generation — locked in as the reproducible demo artifact');

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
        console.log('\n[DB-4] demo-builder — the generic kickoff screen');
        let kickoffSid = null;
        try {
          await page.goto(`${watch.uiUrl}/sessions/demo/new`, { waitUntil: 'domcontentloaded' });
          const ready = await page.waitForFunction(
            () => document.querySelector('[data-page="session-kickoff"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 },
          ).then(() => true).catch(() => false);
          check(ready, 'DB-4: the generic kickoff screen renders ([data-page="session-kickoff"])');
          await caption(page, 'One kickoff screen for every session kind — project, model tier, Start.');
          await page.locator('[data-field="kickoff-project"]').fill(PROJECT).catch(() => {});

          // W6-B6 post-merge review (MEDIUM): demo-builder is a
          // strategy:range skill (range: [sonnet, opus]) — the picker must
          // render as a radio group, never the read-only fixed chip.
          const pickerKind = await page.evaluate(
            () => document.querySelector('[data-section="kickoff-model-tier"]')?.getAttribute('data-model-tier-picker') ?? null,
          );
          check(pickerKind === 'range', `DB-4: demo-builder's model-tier picker renders as a RANGE radio group (got "${pickerKind}")`);
          const opusOption = page.locator('[data-field="kickoff-model-tier-option"] input[value="opus"]');
          check(await opusOption.count() > 0, 'DB-4: the "opus" tier — the top of demo-builder\'s declared range — is offered as a real radio option');
          await opusOption.check().catch(() => {});
          await frame(page, 'demo-6-kickoff', 'The generic kickoff screen — demo, model tier picked, ready to start');
          const startEnabled = await page.locator('[data-action="start-session"]:not([disabled])').count() > 0;
          check(startEnabled, 'DB-4: Start enables once a project is filled in');
          await page.locator('[data-action="start-session"]').click().catch(() => {});
          // W6-B6 fix follow-up: the kickoff screen's OWN url is already
          // `/sessions/demo/new`, which trivially satisfies a bare
          // `/^\/sessions\/demo\/[^/]+$/` test — a waitForFunction on that
          // pattern alone resolves immediately, before router.push ever
          // fires, so `kickoffSid` below was captured from the STALE
          // pre-navigation url ("new" is not a real session id). The
          // pattern must also assert the url has moved OFF the kickoff
          // route's own "new" segment — real navigation, not a coincidental
          // match against where we already were.
          const navigated = await page.waitForFunction(
            () => /^\/sessions\/demo\/[^/]+$/.test(window.location.pathname) && !window.location.pathname.endsWith('/demo/new'),
            null, { timeout: 15000 },
          ).then(() => true).catch(() => false);
          check(navigated, 'DB-4: Start POSTs the real /api/demo-builder/start route and navigates onto the shared session shell');
          kickoffSid = navigated ? decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '') : null;
          check(!!kickoffSid, `DB-4: a real, server-minted session id was captured (got "${kickoffSid}")`);
          const shellReady = await page.waitForFunction(
            () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 },
          ).then(() => true).catch(() => false);
          check(shellReady, 'DB-4: the freshly-kicked-off session opens live on the shared session shell');
          check(await page.locator('[data-affordance-kind="question-form"]').count() > 0,
            'DB-4: the fresh session (phase=briefing) derives a REAL question-form affordance — W6-B10\'s fix, not a "no operator action" dead end');
          await frame(page, 'demo-7-kickoff-session', 'The freshly-kicked-off demo session — briefing, on the shared shell', { key: true });

          // W6-B6 post-merge review (MEDIUM): the picked tier must round-trip
          // all the way through — POST /api/demo-builder/start persisted it
          // to status.json, and the shell GET reads it straight back as
          // "modelTier", never silently dropped.
          const shellRes = await fetch(`${watch.bridgeUrl}/api/studio/sessions/demo/${encodeURIComponent(kickoffSid)}?project=${encodeURIComponent(PROJECT)}`);
          const shellBody = shellRes.ok ? await shellRes.json() : null;
          check(shellBody?.modelTier === 'opus', `DB-4: the kicked-off session's own modelTier reads back as "opus" (the picked tier), got: ${JSON.stringify(shellBody?.modelTier)}`);
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
