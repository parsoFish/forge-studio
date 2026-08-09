/**
 * demo-showcase journey (R4-14) — /projects/[id]/showcase: a per-project
 * standing demo page, distinct from the per-run /artifact evidence view.
 * Ports the SHOWCASE end of the mockup's `run-agent-demo-runner` story (its
 * closing claim: "the showcase never goes stale — merges refresh it
 * automatically" — see story-registry.mjs's flipped row); the agent-builder
 * navigation half of that same mockup story is a different surface and stays
 * excluded there.
 *
 * Fixtures are purpose-built and clip-only (journey-fixtures.mjs's
 * writeShowcaseCycleOne/Two + writeShowcaseEmptyFixture) — never the shared
 * CYCLE_ID/INIT flows-run/roadmap own through to `_queue/done/`, and never
 * demo-builder's shared `.forge/demo/` dir. Every beat that seeds state
 * cleans it up itself (try/finally), so the canonical mdtoc cycle history
 * this journey found on entry is exactly what it leaves behind.
 */
import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  PROJECT, caption, THINK, WORK,
  writeShowcaseCycleOne, cleanShowcaseCycleOne,
  writeShowcaseCycleTwo, cleanShowcaseCycleTwo,
  writeShowcaseEmptyFixture, cleanShowcaseEmptyFixture,
  SHOWCASE_EMPTY_PROJECT,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

export const journey = defineJourney({
  id: 'demo-showcase',
  title: 'Demo showcase',
  story: 'As the operator, I open a project\'s standing "show someone the project" page — reached only once the project has a merged cycle — and see real stats + the same evidence gallery the per-run review uses, honestly empty when there is nothing terminal yet, and automatically current the moment a newer cycle merges, with no code change and no re-generation step.',
  beats: [
    {
      id: 'demo-showcase-entry',
      title: 'Gated entry from the project page',
      narration: 'The showcase is not a standalone route the operator has to know about — it is a link on the project\'s own cycle ledger, and it only appears once the project actually has a merged or done cycle (the same deriveShowcaseCycleId the showcase page itself calls), so the operator is never one click from a page that would just render empty.',
      drive: async (ctx) => {
        const { page, watch, browser, recordClip, check, frame } = ctx;
        console.log('\n[R4-14] demo showcase — gated entry');
        writeShowcaseCycleOne();

        await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
        const projectReady = await page.waitForFunction(
          () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 },
        ).then(() => true).catch(() => false);
        check(projectReady, 'demo-showcase-entry: the project page renders ([data-page="projects"][data-page-ready="true"])');

        // The gated link is driven by `projectCycles`, populated by the project
        // page's loadCycleGroups effect which settles AFTER data-page-ready flips
        // (a separate async fetch). Wait for that settle before asserting — the
        // seeded mdtoc done-cycle is genuinely in the raw project-scoped set, so
        // the link WILL appear; this waits for the async load, never masks a real
        // absence (the empty beat below proves the not-gated case for real).
        const entryLink = page.locator('[data-action="open-showcase"]');
        const entryAppeared = await entryLink.waitFor({ state: 'attached', timeout: 8000 }).then(() => true).catch(() => false);
        check(entryAppeared, 'demo-showcase-entry: the gated "Open showcase →" link renders once the project has a merged|done cycle');

        await entryLink.scrollIntoViewIfNeeded().catch(() => {});
        await caption(page, 'A project with a merged cycle offers "Open showcase →" on its cycle ledger — a standing "show someone the project" page, distinct from a per-run artifact view.');
        await frame(page, 'showcase-0-entry', 'R4-14 — the gated showcase entry on the project page', { key: true });

        await entryLink.click();
        const showcaseReady = await page.waitForFunction(
          () => document.querySelector('[data-page="project-showcase"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 20000 },
        ).then(() => true).catch(() => false);
        check(showcaseReady, 'demo-showcase-entry: clicking through lands on [data-page="project-showcase"][data-page-ready="true"]');
        const projIdAttr = await page.evaluate(() => document.querySelector('[data-page="project-showcase"]')?.getAttribute('data-project-id') ?? null);
        check(projIdAttr === PROJECT, `demo-showcase-entry: the showcase page carries the real project id (got "${projIdAttr}")`);
        await frame(page, 'showcase-1-landed', 'R4-14 — landed on the demo showcase, derived from the real demo manifest');

        // Clip: the full trigger → payoff arc in one ephemeral context (entry-point
        // rule) — a fresh context has no nav state, so it re-navigates and re-drives
        // the same real click, against the SAME seeded cycle the beat above proved.
        await recordClip(browser, watch, 'showcase-entry', `/projects/${PROJECT}`, async (p) => {
          await p.waitForFunction(
            () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 },
          ).catch(() => {});
          await caption(p, 'A merged cycle unlocks the showcase — click through from the project page.');
          const link = p.locator('[data-action="open-showcase"]').first();
          await link.scrollIntoViewIfNeeded().catch(() => {});
          await link.hover().catch(() => {});
          await sleep(THINK);
          await link.click().catch(() => {});
          await p.waitForFunction(
            () => document.querySelector('[data-page="project-showcase"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 },
          ).catch(() => {});
          await sleep(WORK);
        }, {
          readySel: '[data-page="projects"]',
          caption: 'From the project page — "Open showcase" leads straight into the project\'s standing demo evidence.',
        });
      },
    },
    {
      id: 'demo-showcase-render',
      title: 'The seeded demo renders — stats + evidence, not the empty state',
      narration: 'The showcase is derived, not authored a second time: the stats strip\'s real counts (tests, AC met/partial/missed) come off the SAME DemoModel the evidence gallery below it renders — the reused <DemoComparison>, unchanged from the per-run /artifact view. No separate showcase-only schema to drift out of sync.',
      drive: async (ctx) => {
        const { page, check, frame } = ctx;
        console.log('\n[R4-14] demo showcase — render');

        check(await page.locator('[data-section="showcase-empty"]').count() === 0, 'demo-showcase-render: NOT the honest-empty state — a real demo is seeded');

        const statsPresent = await page.locator('[data-section="showcase-stats"]').count() > 0;
        check(statsPresent, 'demo-showcase-render: [data-section="showcase-stats"] renders');
        const tiles = statsPresent ? await page.evaluate(() => {
          const root = document.querySelector('[data-section="showcase-stats"]');
          return root ? Array.from(root.children).map((el) => {
            const divs = el.querySelectorAll('div');
            return { label: divs[0]?.textContent ?? '', value: divs[1]?.textContent ?? '' };
          }) : [];
        }) : [];
        const testsTile = tiles.find((t) => t.label === 'Tests');
        const metTile = tiles.find((t) => t.label === 'AC met');
        check(testsTile?.value === '3', `demo-showcase-render: the Tests tile shows the seeded demo.json's real testEvidence count (got "${testsTile?.value}")`);
        check(metTile?.value === '2', `demo-showcase-render: the AC met tile shows the seeded demo.json's real acEvaluations verdict count (got "${metTile?.value}")`);

        const evidencePresent = await page.locator('[data-section="showcase-evidence"] [data-section="demo-comparison"]').count() > 0;
        check(evidencePresent, 'demo-showcase-render: [data-section="showcase-evidence"] renders the SAME <DemoComparison> the per-run /artifact view uses');
        const evalCount = await page.locator('[data-section="showcase-evidence"] [data-section="demo-evaluation"]').getAttribute('data-ac-eval-count').catch(() => null);
        check(evalCount === '2', `demo-showcase-render: the Intent & Outcome table carries the real per-AC evaluation count (data-ac-eval-count, got "${evalCount}")`);
        const title = await page.locator('[data-section="showcase-evidence"] [data-section="demo-comparison"]').first().evaluate((el) => el.querySelector('div')?.textContent ?? '').catch(() => '');
        check(title.includes('--write'), `demo-showcase-render: the rendered evidence is the seeded cycle's own demo (got title text "${title}")`);

        await caption(page, 'Stats strip + the full evidence gallery — both derived from the same real demo.json the merged cycle produced.');
        await frame(page, 'showcase-2-render', 'R4-14 — the demo showcase: a real stats strip above the reused evidence gallery', { key: true });
      },
    },
    {
      id: 'demo-showcase-empty',
      title: 'Honest empty state — no merged|done cycle, no fabricated gallery',
      narration: 'A project with real cycle activity but nothing merged or done yet renders the honest [data-section="showcase-empty"] state, never a blank or fabricated evidence gallery — the same declared-data-fails-open discipline the load pipeline documents (a terminal cycle whose demo.json never landed degrades to this SAME empty state, not a partial render). Reachable only by direct URL, exactly as the page\'s own header comment says — the gated entry link never offers a project this state.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[R4-14] demo showcase — honest empty state');
        writeShowcaseEmptyFixture();
        try {
          await page.goto(watch.uiUrl + `/projects/${encodeURIComponent(SHOWCASE_EMPTY_PROJECT)}/showcase`, { waitUntil: 'domcontentloaded' });
          const ready = await page.waitForFunction(
            () => document.querySelector('[data-page="project-showcase"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 20000 },
          ).then(() => true).catch(() => false);
          check(ready, 'demo-showcase-empty: the showcase page settles ([data-page-ready="true"]) even with zero merged|done cycles');

          check(await page.locator('[data-section="showcase-empty"]').count() > 0, 'demo-showcase-empty: [data-section="showcase-empty"] renders — a project with only an in-flight cycle gets the honest empty state');
          check(await page.locator('[data-section="showcase-stats"]').count() === 0, 'demo-showcase-empty: no stats strip is fabricated');
          check(await page.locator('[data-section="showcase-evidence"]').count() === 0, 'demo-showcase-empty: no evidence gallery is fabricated');

          await caption(page, 'This project has real activity (an in-flight cycle) but nothing merged or done yet — the showcase says so honestly instead of rendering an empty or fabricated gallery.');
          await frame(page, 'showcase-3-empty', 'R4-14 — the honest empty state: real activity, nothing terminal yet', { key: true });
        } finally {
          cleanShowcaseEmptyFixture();
        }
      },
    },
    {
      id: 'demo-showcase-refresh',
      title: 'A new merged cycle appears without a code change',
      narration: 'The showcase re-derives on every load — it is not cached or pinned to the cycle it first rendered. Seed a SECOND, newer merged cycle for the same project and revisit the page: the evidence gallery flips to the new cycle\'s real demo.json with zero code changes — the mockup\'s own closing claim for this story, "the showcase never goes stale — merges refresh it automatically", made real.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[R4-14] demo showcase — refresh on a newer merged cycle');
        writeShowcaseCycleTwo();
        try {
          await page.goto(watch.uiUrl + `/projects/${PROJECT}/showcase`, { waitUntil: 'domcontentloaded' });
          const ready = await page.waitForFunction(
            () => document.querySelector('[data-page="project-showcase"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 20000 },
          ).then(() => true).catch(() => false);
          check(ready, 'demo-showcase-refresh: the showcase reloads clean ([data-page-ready="true"])');

          const evalCount = await page.locator('[data-section="showcase-evidence"] [data-section="demo-evaluation"]').getAttribute('data-ac-eval-count').catch(() => null);
          check(evalCount === '1', `demo-showcase-refresh: the evaluation table's real count flips to the NEWER cycle's own (data-ac-eval-count, expected "1", got "${evalCount}")`);
          const title = await page.locator('[data-section="showcase-evidence"] [data-section="demo-comparison"]').first().evaluate((el) => el.querySelector('div')?.textContent ?? '').catch(() => '');
          check(title.includes('--check'), `demo-showcase-refresh: the rendered evidence is the NEWER cycle's own demo, not the stale one (got title text "${title}")`);

          const tiles = await page.evaluate(() => {
            const root = document.querySelector('[data-section="showcase-stats"]');
            return root ? Array.from(root.children).map((el) => {
              const divs = el.querySelectorAll('div');
              return { label: divs[0]?.textContent ?? '', value: divs[1]?.textContent ?? '' };
            }) : [];
          });
          const testsTile = tiles.find((t) => t.label === 'Tests');
          check(testsTile?.value === '2', `demo-showcase-refresh: the stats strip's Tests count flips to the newer cycle's own real testEvidence count (got "${testsTile?.value}")`);

          await caption(page, 'A second merged cycle landed — same project, same page, zero code changes — and the showcase already shows its evidence.');
          await frame(page, 'showcase-4-refresh', 'R4-14 — the showcase re-derives to the newest merged cycle, no code change needed', { key: true });
        } finally {
          // Both showcase fixtures are done for good here — clean the ENTIRE
          // clip-only pair, restoring mdtoc's canonical cycle history to
          // exactly what this journey found on entry.
          cleanShowcaseCycleTwo();
          cleanShowcaseCycleOne();
        }
      },
    },
  ],
});
