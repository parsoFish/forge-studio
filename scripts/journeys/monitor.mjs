/**
 * monitor — W8-B1: the seventh pillar, "what is running, and what is stuck".
 *
 * The operator's own note (ON-8): to answer "is anything running, and is
 * anything stuck?" they had to visit Home for the ledger, a flow page for the
 * run rail, /sessions for sessions and a project page for its gates — and
 * Home's own headline disagreed with the ledger printed directly under it
 * ("Active status — 0 live" above ten in-flight rows).
 *
 * ENTRY-POINT RULE: the clip starts on Home, where the operator sees the
 * summary strip and CLICKS the new Monitor pillar. The nav click is the
 * trigger this journey proves — never opening /monitor cold.
 *
 * NO NEW FIXTURES. This journey deliberately seeds nothing: its assertions
 * are structural (every promised section renders) and RELATIONAL (the numbers
 * on one surface equal the numbers on the other, and the summary equals the
 * list it summarises). Those hold on an empty install and on a busy one,
 * which is the point — the defect being pinned shut is two derivations
 * disagreeing, not a particular row count. A seeded fixture here would prove
 * less and would have to be swept out of a shared project.
 */
import { defineJourney } from '../lib/journey-runtime.mjs';
import { caption, ACT, READ } from '../lib/journey-fixtures.mjs';
import { sleep, checkHonestPillarRead } from '../lib/journey-assertions.mjs';

/** goto `/` and wait for Home's real readiness signal — never a fixed sleep. */
async function gotoHomeReady(page, watch) {
  await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('[data-page="home"]')?.getAttribute('data-page-ready') === 'true',
    null, { timeout: 20000 },
  ).catch(() => {});
}

async function waitMonitorReady(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-page="monitor"]')?.getAttribute('data-page-ready') === 'true',
    null, { timeout: 20000 },
  ).catch(() => {});
}

/** Read the summary strip's declared counts off whichever surface is open. */
function readSummary(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-section="monitor-summary"]');
    if (!el) return null;
    const num = (name) => {
      const raw = el.getAttribute(name);
      return raw === null ? null : Number.parseInt(raw, 10);
    };
    return {
      variant: el.getAttribute('data-monitor-variant'),
      live: num('data-monitor-live'),
      runsLive: num('data-monitor-runs-live'),
      sessionsLive: num('data-monitor-sessions-live'),
      needsYou: num('data-monitor-needs-you'),
      failed: num('data-monitor-failed'),
      queued: num('data-monitor-queued'),
      total: num('data-monitor-total'),
      tiles: [...el.querySelectorAll('[data-summary-tile]')].map((t) => ({
        id: t.getAttribute('data-summary-tile'),
        count: Number.parseInt(t.getAttribute('data-count') ?? '', 10),
      })),
    };
  });
}

export const journey = defineJourney({
  id: 'monitor',
  title: 'Monitor — what is running, and what is stuck',
  story: 'As the operator, I want one surface that answers "is anything running, and is anything stuck?" — so I land on Home, see a summary strip that agrees with the activity ledger printed under it, click the Monitor pillar, and find flow runs, standalone agent runs, interactive sessions, the scheduler queue and everything waiting on me in one place, with the same numbers I just saw on Home.',
  beats: [
    {
      id: 'monitor-pillar-entry',
      title: 'Home\'s summary strip, and the Monitor pillar it leads to',
      narration: 'Home opens with "What is running" — four counts derived from the SAME merged ledger this page prints further down, not from a separate source. That mattered: Home used to headline its constellation with "0 live" while its own recent-activity list showed ten in-flight rows, because the number came from the hex grid and the list came from the ledger. Now one derivation feeds both, and the strip carries every count as a data-* attribute rather than as text. Its "Open Monitor" link is the trigger this journey proves — the seventh nav pillar, sitting right next to Home.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[MONITOR.1] Home — the summary strip and the new pillar');

        await gotoHomeReady(page, watch);
        await caption(page, 'Home leads with "What is running" — counts derived from the very ledger printed below them.');
        await sleep(READ);

        const homeSummary = await readSummary(page);
        check(homeSummary !== null, 'MONITOR.1: [data-section="monitor-summary"] renders on Home');
        check(homeSummary?.variant === 'home', `MONITOR.1: Home renders the linking variant (got "${homeSummary?.variant}")`);
        check(
          Number.isInteger(homeSummary?.live) && Number.isInteger(homeSummary?.needsYou)
            && Number.isInteger(homeSummary?.failed) && Number.isInteger(homeSummary?.queued),
          `MONITOR.1: every headline count is a real integer attribute, never scraped text (got ${JSON.stringify(homeSummary)})`,
        );
        check(
          (homeSummary?.tiles ?? []).map((t) => t.id).join(',') === 'live,needs-you,failed,queued',
          `MONITOR.1: all four tiles render, including at zero — an absent tile and "nothing is running" must not look the same (got ${JSON.stringify((homeSummary?.tiles ?? []).map((t) => t.id))})`,
        );
        check(
          (homeSummary?.tiles ?? []).every((t) => Number.isInteger(t.count)),
          'MONITOR.1: each tile declares its own count as data-count',
        );

        // The contradiction this lane closes, asserted directly: the page's
        // own data-live-count and the strip's live count are ONE number.
        const pageCounts = await page.evaluate(() => {
          const m = document.querySelector('[data-page="home"]');
          return m ? {
            live: m.getAttribute('data-live-count'),
            hexActive: m.getAttribute('data-hex-active-count'),
            needsYou: m.getAttribute('data-needs-you-count'),
          } : null;
        });
        check(pageCounts !== null, 'MONITOR.1: Home carries its page-level counts');
        check(
          Number.parseInt(pageCounts?.live ?? '', 10) === homeSummary?.live,
          `MONITOR.1: Home's data-live-count IS the strip's live count — one derivation, not two (page "${pageCounts?.live}" vs strip ${homeSummary?.live})`,
        );
        check(
          pageCounts?.hexActive !== null,
          'MONITOR.1: the constellation keeps its own count under a name that says what it counts (data-hex-active-count) — it answers a different question and must not be mistaken for "live runs"',
        );

        await frame(page, 'monitor-0-home-summary', 'Home — "What is running": four counts derived from the ledger below them, not from a second source', { key: true });

        // The pillar itself — seven now, and the nav is the entry point.
        const nav = await page.evaluate(() => ({
          pillars: [...document.querySelectorAll('[data-component="studio-nav"] [data-nav]')].map((a) => a.getAttribute('data-nav')),
        }));
        check(nav.pillars.length === 7, `MONITOR.1: the nav is seven pillars now (got ${nav.pillars.length}: ${nav.pillars.join(', ')})`);
        check(nav.pillars.includes('monitor'), 'MONITOR.1: Monitor is one of them');

        await caption(page, 'The seventh pillar: Monitor, right next to Home.');
        await page.locator('[data-component="studio-nav"] [data-nav="monitor"]').click();
        await waitMonitorReady(page);
        await sleep(ACT);

        const landed = await page.evaluate(() => {
          const m = document.querySelector('[data-page="monitor"]');
          const link = document.querySelector('[data-component="studio-nav"] [data-nav="monitor"]');
          return m ? { ready: m.getAttribute('data-page-ready'), active: link?.className ?? '' } : null;
        });
        check(landed !== null, 'MONITOR.1: the pillar click lands on [data-page="monitor"]');
        check(landed?.ready === 'true', `MONITOR.1: [data-page-ready="true"] once the reads settle (got "${landed?.ready}")`);
        check((landed?.active ?? '').includes('active'), 'MONITOR.1: the Monitor pillar lights as the active one — the active-pillar table resolves the new route');
        await checkHonestPillarRead(page, check, 'monitor', 'MONITOR.1');

        await frame(page, 'monitor-1-landed', 'One click from Home — the Monitor pillar, active, with its own honest read', { key: true });
      },
    },
    {
      id: 'monitor-one-surface',
      title: 'Everything running, in one place',
      narration: 'Monitor is assembled entirely from parts that already existed: the shared cross-object reads, the run rail with its real FAILED group, the sessions strip, the scheduler card and the merged activity ledger. No new bridge route was added for it — both endpoints it needs were already exposed. What is new is that they are on one page, so "is anything stuck?" is one look instead of four.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[MONITOR.2] /monitor — every promised section');

        await page.goto(watch.uiUrl + '/monitor', { waitUntil: 'domcontentloaded' });
        await waitMonitorReady(page);
        await caption(page, 'Flow runs, agent runs, sessions, the queue, and everything waiting on you — one surface.');
        await sleep(READ);

        const sections = await page.evaluate(() =>
          [...document.querySelectorAll('[data-section]')].map((el) => el.getAttribute('data-section')));
        for (const named of ['monitor-summary', 'scheduler', 'monitor-attention', 'sessions-needing-you', 'monitor-runs', 'activity']) {
          check(sections.includes(named), `MONITOR.2: [data-section="${named}"] renders on Monitor (got ${JSON.stringify(sections)})`);
        }

        // The scheduler card is the SAME component Home mounts — it reports
        // the daemon honestly (the harness runs with it stopped).
        const sched = await page.evaluate(() => {
          const el = document.querySelector('[data-component="scheduler-card"]');
          return el ? { status: el.getAttribute('data-scheduler-status'), queued: el.getAttribute('data-scheduler-queued') } : null;
        });
        check(sched !== null, 'MONITOR.2: the scheduler card is mounted — the queue is part of "what is running"');

        // The run rail: either real runs grouped by the rail's own status
        // vocabulary, or an honest empty line that does NOT borrow the flow
        // page's "no runs yet for this flow" sentence.
        const runs = await page.evaluate(() => {
          const sec = document.querySelector('[data-section="monitor-runs"]');
          if (!sec) return null;
          return {
            count: Number.parseInt(sec.getAttribute('data-run-count') ?? '', 10),
            groups: [...sec.querySelectorAll('[data-run-group]')].map((g) => ({
              status: g.getAttribute('data-run-group'),
              count: Number.parseInt(g.getAttribute('data-group-count') ?? '', 10),
            })),
            cards: sec.querySelectorAll('[data-run-id][data-run-status]').length,
            empty: sec.querySelector('[data-component="monitor-runs-empty"]')?.textContent ?? null,
          };
        });
        check(runs !== null, 'MONITOR.2: the flow-runs section carries data-run-count');
        if ((runs?.count ?? 0) > 0) {
          check(runs.groups.length > 0, `MONITOR.2: ${runs.count} flow runs render grouped by status (got ${JSON.stringify(runs.groups)})`);
          check(runs.cards > 0, `MONITOR.2: run cards render, each carrying its own data-run-status (got ${runs.cards})`);
        } else {
          check(
            (runs?.empty ?? '').includes('No flow runs recorded yet'),
            `MONITOR.2: with no runs, Monitor states its OWN empty case — never the rail's "no runs yet for this flow", which is false on a cross-flow surface (got "${runs?.empty}")`,
          );
        }

        // The merged ledger is the same shared component every other surface
        // uses, paged rather than truncated.
        const ledger = await page.evaluate(() => {
          const sec = document.querySelector('[data-section="activity"]');
          const led = document.querySelector('[data-section="history-ledger"]');
          return {
            total: Number.parseInt(sec?.getAttribute('data-ledger-total') ?? '', 10),
            ledgerCount: led ? Number.parseInt(led.getAttribute('data-ledger-count') ?? '', 10) : null,
            rows: document.querySelectorAll('[data-ledger-row]').length,
          };
        });
        check(Number.isInteger(ledger.total), `MONITOR.2: the activity section declares data-ledger-total (got "${ledger.total}")`);
        check(ledger.ledgerCount !== null, 'MONITOR.2: the shared HistoryLedger is what renders the rows — not a second, Monitor-only list');

        await frame(page, 'monitor-2-one-surface', '/monitor — flow runs, sessions, the queue and the merged ledger on one page', { key: true });
      },
    },
    {
      id: 'monitor-counts-agree',
      title: 'The summary cannot disagree with the list',
      narration: 'The regression this pins: the headline is computed FROM the rows the ledger renders, so a summary that contradicts the list beneath it is not expressible any more. Monitor\'s declared total is the ledger\'s own row total; its failed count can never be smaller than the failed group in the run rail; and the numbers Home showed a moment ago are the numbers Monitor shows now, because both read one derivation over one list.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[MONITOR.3] the summary and the list agree');

        await page.goto(watch.uiUrl + '/monitor', { waitUntil: 'domcontentloaded' });
        await waitMonitorReady(page);
        const monitorSummary = await readSummary(page);
        check(monitorSummary !== null, 'MONITOR.3: the summary strip renders on Monitor too');
        check(monitorSummary?.variant === 'monitor', `MONITOR.3: Monitor renders the non-linking variant — a self-link is a dead control (got "${monitorSummary?.variant}")`);

        const observed = await page.evaluate(() => {
          const sec = document.querySelector('[data-section="activity"]');
          const failedGroup = document.querySelector('[data-section="monitor-runs"] [data-run-group="failed"]');
          return {
            ledgerTotal: Number.parseInt(sec?.getAttribute('data-ledger-total') ?? '', 10),
            railFailed: failedGroup ? Number.parseInt(failedGroup.getAttribute('data-group-count') ?? '', 10) : 0,
          };
        });
        check(
          monitorSummary?.total === observed.ledgerTotal,
          `MONITOR.3: the summary's declared total IS the ledger's row total — the summary summarises the list it is printed above (summary ${monitorSummary?.total} vs ledger ${observed.ledgerTotal})`,
        );
        check(
          (monitorSummary?.failed ?? 0) >= observed.railFailed,
          `MONITOR.3: every failed run in the rail is counted in the failed headline (rail ${observed.railFailed}, headline ${monitorSummary?.failed})`,
        );
        check(
          (monitorSummary?.live ?? -1) === (monitorSummary?.runsLive ?? 0) + (monitorSummary?.sessionsLive ?? 0),
          `MONITOR.3: live is exactly runs-in-flight plus live sessions — no double count, no third source (${monitorSummary?.live} vs ${monitorSummary?.runsLive}+${monitorSummary?.sessionsLive})`,
        );

        await caption(page, 'The headline is computed from these very rows — it cannot contradict them.');
        await sleep(READ);
        await frame(page, 'monitor-3-counts-agree', '/monitor — the headline totals reconcile with the rail and the ledger under them', { key: true });

        // Cross-surface: Home and Monitor are reading ONE derivation, so the
        // same visit must produce the same numbers on both.
        await gotoHomeReady(page, watch);
        const homeSummary = await readSummary(page);
        check(homeSummary !== null, 'MONITOR.3: Home still renders its strip after the round trip');
        check(
          homeSummary?.live === monitorSummary?.live && homeSummary?.failed === monitorSummary?.failed
            && homeSummary?.queued === monitorSummary?.queued,
          `MONITOR.3: Home and Monitor agree on live/failed/queued — one lifted ledger, one derivation (home ${JSON.stringify([homeSummary?.live, homeSummary?.failed, homeSummary?.queued])} vs monitor ${JSON.stringify([monitorSummary?.live, monitorSummary?.failed, monitorSummary?.queued])})`,
        );

        await caption(page, 'Home and Monitor agree, because there is only one ledger and one derivation behind both.');
        await frame(page, 'monitor-4-home-agrees', 'Back on Home — the same numbers, because the depth and the glance share one derivation', { key: true });
      },
    },
  ],
});
