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
 * FIXTURE (self-contained, disjoint from every other journey's ids — never
 * mdtoc's own queue, never home.mjs's HOME_* scratch projects). ALL THREE run
 * kinds this pillar claims to unify, on disk, in the shapes the real writers
 * produce:
 *   - MONITOR_ACTIVE_PROJECT — a real `_queue/in-flight/<id>.md` naming the
 *     always-shipped `forge-develop` flow, plus a seeded
 *     `_logs/<cycleId>/events.jsonl` carrying one OPEN developer-loop start
 *     event. `QUEUE_STATE_TO_RUN_STATUS` maps `in-flight` -> run status
 *     `active`, so this is a genuinely in-flight run, not a poked count.
 *   - MONITOR_FAILED_PROJECT — a real `_queue/failed/<id>.md`, which the same
 *     table maps to run status `failed`.
 *   - MON_AGENT_RUN_ID (W8-F4) — a STANDALONE agent run: `_logs/_agent-…/
 *     events.jsonl` with a dispatch marker and no `end` event, which is
 *     exactly what `collectRecentAgentRuns` (cli/ui-bridge.ts) reads to emit a
 *     `linkKind:'standalone'` row -> `data-ledger-kind="agent"`.
 *   - MON_SESSION_SID (W8-F4) — a NON-TERMINAL interactive session:
 *     `projects/<scratch>/_onboarding/<sid>/status.json` with `phase: running`
 *     (the onboarding kind's real in-flight phase, studio/session-kinds.yaml;
 *     the same object `POST /api/studio/onboarding/start` writes).
 *
 * WHY ALL FOUR (W8-F4, ON-8): the relational assertions below (the summary
 * equals the list it summarises; Home and Monitor agree) are TRUE but VACUOUS
 * on an empty install — 0 === 0 passes against a completely broken derivation.
 * A check that cannot fail is not a check. The wave-8 exit gate found this
 * beat still two-thirds vacuous: the fixture seeded only FLOW runs, so the
 * "standalone agent run" and "interactive session" thirds of ON-8 were
 * asserted as SECTION PRESENCE alone — and `HomeSessionsStrip` renders its
 * <section> unconditionally, so an empty sessions list satisfied it. The beats
 * below now assert IDENTITY: the seeded ids themselves must appear as an
 * `data-ledger-kind="agent"` ledger row and as a `[data-session-card]`.
 *
 * Seed/cleanup discipline (home.mjs's own shape): `monitor-pillar-entry`
 * seeds behind a crash-safe leading sweep; `monitor-counts-agree` — the last
 * beat that needs it — sweeps in a try/finally. The session dir lives INSIDE
 * MON_ACTIVE_PROJECT_DIR, so the project sweep takes it too; the standalone
 * run dir is swept explicitly.
 */
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import { FORGE_ROOT, caption, ACT, READ } from '../lib/journey-fixtures.mjs';
import { sleep, checkHonestPillarRead } from '../lib/journey-assertions.mjs';
import { JOURNEY_AGENT_RUN_SUFFIX } from '../lib/journey-residue.mjs';

// ── MONITOR fixture identity — local to this journey, disjoint from every
// other journey's seeded ids (HOME_*/J4/J5/SK_*/HK_*/SHOWCASE_*/…) ──
const MON_DATE = new Date().toISOString().slice(0, 10);
const MON_STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';

const MON_ACTIVE_PROJECT = 'monitor-fixture-active-project';
const MON_ACTIVE_PROJECT_DIR = join(FORGE_ROOT, 'projects', MON_ACTIVE_PROJECT);
const MON_ACTIVE_INIT = `INIT-${MON_DATE}-monitor-fixture-active`;
const MON_ACTIVE_CYCLE_ID = `${MON_STAMP}_${MON_ACTIVE_INIT}`;
const MON_ACTIVE_MANIFEST = join(FORGE_ROOT, '_queue', 'in-flight', `${MON_ACTIVE_INIT}.md`);
const MON_ACTIVE_LOG_DIR = join(FORGE_ROOT, '_logs', MON_ACTIVE_CYCLE_ID);

// W8-F4 — the STANDALONE agent run. `collectRecentAgentRuns` enumerates
// `_logs/_agent-*` dirs and uses the DIRECTORY NAME verbatim as the row id, so
// this constant IS the identity the beats assert on. The slug is resolved from
// `metadata.agent_slug`; an unattributable run is dropped rather than
// fabricated, so the marker below carries it explicitly.
//
// The `JOURNEY_AGENT_RUN_SUFFIX` tail is what makes the crash-safe sweep able
// to SEE this dir (scripts/lib/journey-residue.mjs). The `_agent-` prefix is
// forced by the read route, so it cannot signal ownership; without the suffix
// this fixture leaked one `_logs/` dir per killed run, invisible to both
// residue ratchets — found by adversarial review, not by a run.
const MON_AGENT_SLUG = 'developer-ralph';
const MON_AGENT_RUN_ID = `_agent-${MON_AGENT_SLUG}-${MON_STAMP}${JOURNEY_AGENT_RUN_SUFFIX}`;
const MON_AGENT_RUN_DIR = join(FORGE_ROOT, '_logs', MON_AGENT_RUN_ID);

// W8-F4 — the INTERACTIVE session. `onboarding` is a registry-generic kind, so
// the session index finds it by scanning `projects/*/_onboarding/<sid>/
// status.json` (cli/ui-bridge.ts) — no central log dir needed. `running` is its
// real in-flight phase (studio/session-kinds.yaml): NON-terminal, and
// deliberately NOT a needs-you phase, which is the point of the heading
// assertion in MONITOR.2 — this section lists every live session, not only the
// ones waiting on the operator.
const MON_SESSION_KIND = 'onboarding';
const MON_SESSION_PHASE = 'running';
const MON_SESSION_SID = `monitor-fixture-session-${MON_STAMP}`;

const MON_FAILED_PROJECT = 'monitor-fixture-failed-project';
const MON_FAILED_PROJECT_DIR = join(FORGE_ROOT, 'projects', MON_FAILED_PROJECT);
const MON_FAILED_INIT = `INIT-${MON_DATE}-monitor-fixture-failed`;
const MON_FAILED_CYCLE_ID = `${MON_STAMP}_${MON_FAILED_INIT}`;
const MON_FAILED_MANIFEST = join(FORGE_ROOT, '_queue', 'failed', `${MON_FAILED_INIT}.md`);

/** Minimal `.forge/project.json` — enough for the project to read like a real
 *  one; never dispatched, swept every run. */
function writeMonProjectConfig(dir, name, northStar) {
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({
    $comment: 'journey-seeded scratch project (scripts/journeys/monitor.mjs) — never dispatched, swept every run.',
    name, northStar,
  }, null, 2));
}

function manifestBody(initiativeId, project, projectDir, phase, cycleId, note) {
  return [
    '---',
    `initiative_id: ${initiativeId}`,
    `project: ${project}`,
    `project_repo_path: ${projectDir}`,
    `created_at: '${new Date().toISOString()}'`,
    'iteration_budget: 10',
    'cost_budget_usd: 6',
    `phase: ${phase}`,
    'origin: architect',
    `cycle_id: ${cycleId}`,
    'flow_id: forge-develop',
    '---',
    '',
    `# Monitor fixture — ${note} (journey-seeded)`,
    '',
    'A throwaway scratch project this journey creates and destroys itself — ' +
      'never mdtoc\'s own queue, never another journey\'s fixture.',
    '',
  ].join('\n');
}

function seedMonitorFixture() {
  mkdirSync(join(FORGE_ROOT, '_queue', 'in-flight'), { recursive: true });
  mkdirSync(join(FORGE_ROOT, '_queue', 'failed'), { recursive: true });

  writeMonProjectConfig(MON_ACTIVE_PROJECT_DIR, 'Fixture: Monitor active build',
    'A journey-seeded scratch project proving Monitor counts a genuinely in-flight run.');
  writeFileSync(MON_ACTIVE_MANIFEST, manifestBody(
    MON_ACTIVE_INIT, MON_ACTIVE_PROJECT, MON_ACTIVE_PROJECT_DIR, 'in-flight', MON_ACTIVE_CYCLE_ID, 'active build'));
  // One OPEN developer-loop start event — the same in-flight shape home.mjs's
  // own active fixture uses, so the run aggregates as genuinely running.
  mkdirSync(MON_ACTIVE_LOG_DIR, { recursive: true });
  writeFileSync(join(MON_ACTIVE_LOG_DIR, 'events.jsonl'), JSON.stringify({
    event_id: 'EV_monitor_1', cycle_id: MON_ACTIVE_CYCLE_ID, initiative_id: MON_ACTIVE_INIT,
    started_at: new Date().toISOString(), phase: 'developer-loop', skill: 'developer-ralph',
    event_type: 'start', input_refs: [], output_refs: [],
    message: 'developer-loop.start', metadata: {},
  }) + '\n');

  writeMonProjectConfig(MON_FAILED_PROJECT_DIR, 'Fixture: Monitor failed build',
    'A journey-seeded scratch project proving a failed run reads as failed on Monitor.');
  writeFileSync(MON_FAILED_MANIFEST, manifestBody(
    MON_FAILED_INIT, MON_FAILED_PROJECT, MON_FAILED_PROJECT_DIR, 'failed', MON_FAILED_CYCLE_ID, 'failed build'));

  // W8-F4 — kind 2 of 3: a standalone agent run, mirroring the t0 marker the
  // real dispatch route writes into the run's OWN events.jsonl
  // (`agent-run.dispatched`, W7-B5/W8-A2). No `end` event, so
  // `deriveStandaloneStateFromEvents` reads it as genuinely `running`.
  mkdirSync(MON_AGENT_RUN_DIR, { recursive: true });
  writeFileSync(join(MON_AGENT_RUN_DIR, 'events.jsonl'), JSON.stringify({
    event_id: 'EV_monitor_agent_1', cycle_id: MON_AGENT_RUN_ID, initiative_id: MON_AGENT_RUN_ID,
    started_at: new Date().toISOString(), phase: 'orchestrator', skill: MON_AGENT_SLUG,
    event_type: 'start', input_refs: [], output_refs: [],
    message: 'agent-run.dispatched',
    metadata: { agent_phase: 'standalone', agent_slug: MON_AGENT_SLUG },
  }) + '\n');

  // W8-F4 — kind 3 of 3: a non-terminal interactive session, in the shape
  // `POST /api/studio/onboarding/start` writes (`{ phase: 'running', … }`).
  // Lives inside the active scratch project so the project sweep removes it.
  const sessionDir = join(MON_ACTIVE_PROJECT_DIR, `_${MON_SESSION_KIND}`, MON_SESSION_SID);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({
    session_id: MON_SESSION_SID,
    project: MON_ACTIVE_PROJECT,
    project_repo_path: MON_ACTIVE_PROJECT_DIR,
    phase: MON_SESSION_PHASE,
    updated_at: new Date().toISOString(),
  }, null, 2));
}

function cleanMonitorFixture() {
  for (const path of [MON_ACTIVE_PROJECT_DIR, MON_FAILED_PROJECT_DIR, MON_ACTIVE_LOG_DIR, MON_AGENT_RUN_DIR]) {
    try { rmSync(path, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  for (const path of [MON_ACTIVE_MANIFEST, MON_FAILED_MANIFEST]) {
    try { rmSync(path, { force: true }); } catch { /* best-effort */ }
  }
}

/**
 * Keep the seeded standalone run LIVE across the beats that assert it is live.
 *
 * `readStandaloneLivenessFacts` (cli/ui-bridge.ts) derives `idleMs` from the
 * newest mtime among the run dir's `events.jsonl` / `stderr.log` / `turn.pid`,
 * and `applyStandaloneStaleness` flips `running` -> `stalled` past
 * `DEFAULT_STALL_CEILING_MS` (180 s). A real in-flight run's log is being
 * appended the whole time, which is exactly why that ceiling is a fair
 * liveness signal; a file written once at the top of MONITOR.1 is not, so past
 * 180 s of walkthrough the fixture would stop representing the thing it
 * claims to be and the beats below would fail for a reason that has nothing
 * to do with the Monitor pillar. Touching the mtime is the fixture keeping its
 * own claim true — NOT a nudge to make a check pass: the run's derived state,
 * its row, its id and its kind all still come from the real read path.
 */
function keepMonitorAgentRunLive() {
  const now = new Date();
  try { utimesSync(join(MON_AGENT_RUN_DIR, 'events.jsonl'), now, now); } catch { /* swept already */ }
}

/**
 * Wait for the merged everything-ledger's AGENT half to land.
 *
 * W8-F4, found by this journey's own first green-field run: `data-page-ready`
 * on `/monitor` (and Home) comes from `useStudioHomeData().ready` — the
 * flows/agents/runs/sessions reads — but `useEverythingLedger` fetches the
 * standalone-agent half in a SECOND, independent effect and renders flow rows
 * alone until it resolves (`agentRowsReady`). So the page declares itself
 * ready while its own ledger, and the headline counts derived from that
 * ledger, are still missing every standalone run. MONITOR.3 read the summary
 * immediately after `waitMonitorReady` and saw total 2 / runsLive 1 for the
 * same tree where MONITOR.2 — which happens to read the ledger many checks
 * later — saw total 3 / runsLive 2.
 *
 * The wait below is a REAL readiness signal (the seeded row's own identity
 * appearing), never a fixed sleep, and it is deliberately non-throwing: if
 * the row never lands, the checks that follow report it as the failure it is
 * rather than the beat dying on a timeout. The underlying gap — a
 * `data-page-ready` that does not cover one of the two reads its own headline
 * is computed from — is filed separately; it is not this lane's exit row.
 */
async function waitForSeededAgentRow(page) {
  await page.waitForFunction(
    (id) => document.querySelector(`[data-ledger-row][data-run-id="${id}"]`) !== null,
    MON_AGENT_RUN_ID, { timeout: 15000 },
  ).catch(() => { /* the checks below report the absence */ });
}

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
        cleanMonitorFixture(); // crash-safe leading sweep — a prior interrupted run's leftovers
        seedMonitorFixture();

        // The `_queue/` manifests this fixture writes are in the SHARED queue
        // dir, and the harness's own daemon guard REFUSES to run with a stray
        // manifest present — so a leak here does not just pollute a later
        // beat, it blocks the next run outright. Hence a try/catch that sweeps
        // before the error propagates, on top of the leading sweep above.
        try {
        await gotoHomeReady(page, watch);
        await waitForSeededAgentRow(page);
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
        // NON-VACUOUS: the seeded fixture puts one genuinely in-flight run and
        // one failed run on disk, so these identities are exercised against
        // real numbers. On an empty install every relation below is 0 === 0,
        // which passes against a completely broken derivation.
        check((homeSummary?.live ?? 0) >= 1,
          `MONITOR.1: the seeded in-flight run is COUNTED as live — the strip reads the real run-model (got ${homeSummary?.live})`);
        check((homeSummary?.failed ?? 0) >= 1,
          `MONITOR.1: the seeded failed run is counted as failed (got ${homeSummary?.failed})`);
        check((homeSummary?.total ?? 0) >= 2,
          `MONITOR.1: both seeded runs reached the merged ledger the counts are derived from (got ${homeSummary?.total})`);

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
        } catch (err) {
          cleanMonitorFixture(); // shared `_queue/` — never leak a manifest that would block the next run
          throw err;
        }
      },
    },
    {
      id: 'monitor-one-surface',
      title: 'Everything running, in one place',
      narration: 'Monitor is assembled entirely from parts that already existed: the shared cross-object reads, the run rail with its real FAILED group, the sessions strip, the scheduler card and the merged activity ledger. No new bridge route was added for it — both endpoints it needs were already exposed. What is new is that they are on one page, so "is anything stuck?" is one look instead of four. All three run kinds are on screen at once and named by their own seeded ids: a flow run on the rail, a standalone agent run carrying an AGENT chip in the ledger, and a live interactive session card. The sessions section is headed "Active sessions" — it lists every live session, and the count of the ones actually waiting on you rides beside it as a chip, because a heading that claims the whole list needs you is a claim about the operator\'s attention that the list does not support.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[MONITOR.2] /monitor — every promised section');

        // The `_queue/` manifests this journey seeds live in the SHARED queue
        // dir, and the harness's daemon guard REFUSES to run with a stray
        // manifest present — so a throw that leaks one does not merely pollute
        // a later beat, it blocks the NEXT RUN outright. MONITOR.1 already
        // carries this catch and MONITOR.3 a finally; this beat had neither.
        try {
        keepMonitorAgentRunLive();
        await page.goto(watch.uiUrl + '/monitor', { waitUntil: 'domcontentloaded' });
        await waitMonitorReady(page);
        await waitForSeededAgentRow(page);
        await caption(page, 'Flow runs, agent runs, sessions, the queue, and everything waiting on you — one surface.');
        await sleep(READ);

        const sections = await page.evaluate(() =>
          [...document.querySelectorAll('[data-section]')].map((el) => el.getAttribute('data-section')));
        for (const named of ['monitor-summary', 'scheduler', 'monitor-attention', 'sessions-needing-you', 'monitor-runs', 'activity']) {
          check(sections.includes(named), `MONITOR.2: [data-section="${named}"] renders on Monitor (got ${JSON.stringify(sections)})`);
        }

        // ── W8-F4: all three run kinds, by IDENTITY ──
        // Section presence is not evidence: HomeSessionsStrip renders its
        // <section> unconditionally, so the checks above pass with an empty
        // sessions list — "all three kinds in one place" was being asserted at
        // zero state for two of the three kinds. These read the SEEDED IDS
        // back off the page, so a broken producer cannot satisfy them with a
        // count, an empty list, or somebody else's row.
        const seeded = await page.evaluate((ids) => {
          const agentRow = document.querySelector(`[data-ledger-row][data-run-id="${ids.agentRunId}"]`);
          const sessionCard = document.querySelector(
            `[data-section="sessions-needing-you"] [data-session-card][data-session-id="${ids.sessionId}"]`);
          const strip = document.querySelector('[data-section="sessions-needing-you"]');
          // The flow third: the rail's own card for the seeded in-flight
          // initiative. Matched on the initiative token rather than on a
          // reconstructed run id, because the run id is derived server-side
          // from the queue manifest and this beat is not the place to re-derive it.
          const flowCard = [...document.querySelectorAll('[data-section="monitor-runs"] [data-run-id]')]
            .find((el) => (el.getAttribute('data-run-id') ?? '').includes(ids.flowToken)) ?? null;
          return {
            agent: agentRow === null ? null : {
              kind: agentRow.getAttribute('data-ledger-kind'),
              linkKind: agentRow.getAttribute('data-ledger-link-kind'),
              status: agentRow.getAttribute('data-run-status'),
              href: agentRow.getAttribute('href'),
            },
            session: sessionCard === null ? null : {
              kind: sessionCard.getAttribute('data-session-kind'),
              phase: sessionCard.getAttribute('data-session-phase'),
              needsYou: sessionCard.getAttribute('data-needs-you'),
              state: sessionCard.getAttribute('data-session-state'),
            },
            flowRunId: flowCard === null ? null : flowCard.getAttribute('data-run-id'),
            stripHeading: strip === null ? null : (strip.querySelector('h2')?.textContent ?? '').trim(),
            stripAriaLabel: strip === null ? null : strip.getAttribute('aria-label'),
            stripActive: strip === null ? null : strip.getAttribute('data-active-session-count'),
            stripNeedsYou: strip === null ? null : strip.getAttribute('data-needs-you-count'),
          };
        }, { agentRunId: MON_AGENT_RUN_ID, sessionId: MON_SESSION_SID, flowToken: MON_ACTIVE_INIT });

        check(seeded.flowRunId !== null,
          `MONITOR.2 (1/3 flow): the seeded in-flight FLOW run is on the rail by identity — a card whose data-run-id carries "${MON_ACTIVE_INIT}" (got ${JSON.stringify(seeded.flowRunId)})`);
        check(seeded.agent !== null,
          `MONITOR.2 (2/3 agent): the seeded STANDALONE agent run is in the merged ledger by identity — [data-run-id="${MON_AGENT_RUN_ID}"] (got ${JSON.stringify(seeded.agent)})`);
        check(seeded.agent?.kind === 'agent' && seeded.agent?.linkKind === 'standalone',
          `MONITOR.2 (2/3 agent): and it reads as an AGENT row, not a flow row — data-ledger-kind="agent", data-ledger-link-kind="standalone" (got kind "${seeded.agent?.kind}", linkKind "${seeded.agent?.linkKind}")`);
        check(seeded.agent?.status === 'running',
          `MONITOR.2 (2/3 agent): a run with no end event reads as running, derived from its own events.jsonl (got "${seeded.agent?.status}")`);
        check(seeded.session !== null,
          `MONITOR.2 (3/3 session): the seeded INTERACTIVE session renders as its own card by identity — [data-session-id="${MON_SESSION_SID}"] (got ${JSON.stringify(seeded.session)})`);
        check(seeded.session?.kind === MON_SESSION_KIND && seeded.session?.phase === MON_SESSION_PHASE,
          `MONITOR.2 (3/3 session): carrying its real kind and its real non-terminal phase (got kind "${seeded.session?.kind}", phase "${seeded.session?.phase}")`);

        // The heading honesty check (W8-F4 S3): this card is a live session
        // that does NOT need the operator, and it is listed anyway —
        // buildHomeSessionsStrip does not filter, it slices. A heading that
        // says "Sessions needing you" over that list is a false claim about
        // what the operator is looking at; the needs-you subset is the CHIP.
        check(seeded.session?.needsYou === 'false',
          `MONITOR.2: the seeded session does NOT need the operator (data-needs-you="${seeded.session?.needsYou}") — so the section is provably listing more than the needs-you subset`);
        check(seeded.stripHeading === 'Active sessions',
          `MONITOR.2: and the section says so — its visible heading names what it lists, with "N need you" as a separate chip (got "${seeded.stripHeading}")`);
        check(seeded.stripAriaLabel === 'Active sessions',
          `MONITOR.2: the accessible name matches the visible one (got "${seeded.stripAriaLabel}")`);
        check(Number.parseInt(seeded.stripActive ?? '', 10) >= 1,
          `MONITOR.2: the strip's own declared active-session count is non-zero, so nothing above is a zero-state pass (got "${seeded.stripActive}")`);

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
        check((runs?.count ?? 0) >= 2,
          `MONITOR.2: both seeded runs reach the rail — this beat is NOT allowed to fall through to the empty state (got ${runs?.count})`);
        check((runs?.groups ?? []).length > 0,
          `MONITOR.2: runs render grouped by the rail's own status vocabulary (got ${JSON.stringify(runs?.groups)})`);
        check((runs?.cards ?? 0) > 0,
          `MONITOR.2: run cards render, each carrying its own data-run-status (got ${runs?.cards})`);
        const groupOf = (status) => (runs?.groups ?? []).find((g) => g.status === status)?.count ?? 0;
        check(groupOf('active') >= 1,
          `MONITOR.2: the seeded in-flight run lands in the ACTIVE group (got ${groupOf('active')})`);
        check(groupOf('failed') >= 1,
          `MONITOR.2: a failed run READS as failed on Monitor — the rail's own FAILED group, same treatment the flow page gives it (got ${groupOf('failed')})`);
        check((runs?.empty ?? null) === null,
          'MONITOR.2: with runs present the empty state is absent (it exists for the honest zero case, and says Monitor\'s own sentence rather than the rail\'s "no runs yet for this flow")');

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
        } catch (err) {
          cleanMonitorFixture();
          throw err;
        }
      },
    },
    {
      id: 'monitor-counts-agree',
      title: 'The summary cannot disagree with the list',
      narration: 'The regression this pins: the headline is computed FROM the rows the ledger renders, so a summary that contradicts the list beneath it is not expressible any more. Monitor\'s declared total is the ledger\'s own row total; its failed count can never be smaller than the failed group in the run rail; and the numbers Home showed a moment ago are the numbers Monitor shows now, because both read one derivation over one list.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[MONITOR.3] the summary and the list agree');

        try {
        keepMonitorAgentRunLive();
        await page.goto(watch.uiUrl + '/monitor', { waitUntil: 'domcontentloaded' });
        await waitMonitorReady(page);
        await waitForSeededAgentRow(page);
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
        check(observed.railFailed >= 1,
          `MONITOR.3: the seeded failed run is in the rail, so the next check is exercised against a real number, not 0 >= 0 (got ${observed.railFailed})`);
        check(
          (monitorSummary?.failed ?? 0) >= observed.railFailed,
          `MONITOR.3: every failed run in the rail is counted in the failed headline (rail ${observed.railFailed}, headline ${monitorSummary?.failed})`,
        );
        check((monitorSummary?.total ?? 0) >= 2,
          `MONITOR.3: the identity above is checked against a NON-EMPTY ledger (total ${monitorSummary?.total})`);
        // W8-F4: this identity used to be checkable at 0 === 0 + 0. With a
        // seeded non-terminal session AND a seeded standalone agent run, BOTH
        // addends are real, so `live = runsLive + sessionsLive` is exercised
        // against numbers a broken derivation cannot fake.
        check((monitorSummary?.sessionsLive ?? 0) >= 1,
          `MONITOR.3: the seeded interactive session is COUNTED as a live session — the sessions addend is not zero (got ${monitorSummary?.sessionsLive})`);
        check((monitorSummary?.runsLive ?? 0) >= 2,
          `MONITOR.3: the seeded flow run AND the seeded standalone agent run are both counted as live runs (got ${monitorSummary?.runsLive})`);
        check(
          (monitorSummary?.live ?? -1) === (monitorSummary?.runsLive ?? 0) + (monitorSummary?.sessionsLive ?? 0),
          `MONITOR.3: live is exactly runs-in-flight plus live sessions — no double count, no third source (${monitorSummary?.live} vs ${monitorSummary?.runsLive}+${monitorSummary?.sessionsLive})`,
        );

        await caption(page, 'The headline is computed from these very rows — it cannot contradict them.');
        await sleep(READ);
        await frame(page, 'monitor-3-counts-agree', '/monitor — the headline totals reconcile with the rail and the ledger under them', { key: true });

        // Cross-surface: Home and Monitor are reading ONE derivation, so the
        // same visit must produce the same numbers on both. The seeded run is
        // kept live across the hop too, so the two reads cannot disagree just
        // because the staleness ceiling fell between them.
        keepMonitorAgentRunLive();
        await gotoHomeReady(page, watch);
        await waitForSeededAgentRow(page);
        const homeSummary = await readSummary(page);
        check(homeSummary !== null, 'MONITOR.3: Home still renders its strip after the round trip');
        check(
          homeSummary?.live === monitorSummary?.live && homeSummary?.failed === monitorSummary?.failed
            && homeSummary?.queued === monitorSummary?.queued,
          `MONITOR.3: Home and Monitor agree on live/failed/queued — one lifted ledger, one derivation (home ${JSON.stringify([homeSummary?.live, homeSummary?.failed, homeSummary?.queued])} vs monitor ${JSON.stringify([monitorSummary?.live, monitorSummary?.failed, monitorSummary?.queued])})`,
        );

        await caption(page, 'Home and Monitor agree, because there is only one ledger and one derivation behind both.');
        await frame(page, 'monitor-4-home-agrees', 'Back on Home — the same numbers, because the depth and the glance share one derivation', { key: true });
        } finally {
          cleanMonitorFixture(); // the LAST beat that needs the fixture
        }
      },
    },
  ],
});
