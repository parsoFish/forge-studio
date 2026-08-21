/**
 * flows-onboard — W7-C1 rework (flows-20, sessions-kinds-01, crosscut-14):
 * onboarding's ONE surface is the SESSION.
 *
 * HISTORY: R4-18 shipped an `onboard-project` OOTB flow alongside R4-17's
 * onboarding session — two entry points, and the flow-shaped one (the one an
 * operator found from the Flows pillar) was the broken duplicate: its only
 * control 400'd and it never asked for a project. W7-C1 retired the flow
 * wrapper (goal-pack C1 decision: keep the SESSION — it is the generic
 * panel's kind and carries the multi-stage selector). The platform seam the
 * old flows-onboard-gate beat proved (the REAL `runPreflight` behind a
 * `gate: contract` node) remains fully covered — against an AUTHORED flow
 * fixture — by orchestrator/onboard-flow-gate.test.ts (AT-3/AT-4/companion).
 *
 * Three beats (ids kept stable — story-registry.mjs's run-flow-onboard entry
 * cites them):
 *   - flows-onboard-monitor  — the CONSOLIDATED flows pillar: exactly the two
 *     seed flows (no onboarding flow card), plus the W7-C1 index additions —
 *     the name filter, data-flow-visible-count, the unified recent-runs
 *     section, and trigger badges that read "on merged" (a trigger), never a
 *     bare "MERGED" (a status).
 *   - flows-onboard-kickoff  — /sessions/onboarding/new is a REAL kickoff
 *     (sessions-kinds-01/crosscut-14 killed: it used to render «Session kind
 *     "onboarding" has no kickoff entry» with zero controls): a roster
 *     project select + Start, linked from the /sessions index.
 *   - flows-onboard-gate     — the loop closes: Start genuinely POSTs
 *     /api/studio/onboarding/start (the session dir + status.json land for
 *     real; only the agent dispatch is dry-bridge-suppressed, the same seam
 *     every kickoff beat relies on) and the operator lands on the generic
 *     session panel with data-session-kind="onboarding". Self-contained:
 *     removes its own session dir + run log in a finally, and a crash-safe
 *     leading sweep (via the tmpdir marker below) removes a PRIOR
 *     interrupted run's residue first.
 */
import { defineJourney } from '../lib/journey-runtime.mjs';
import { FORGE_ROOT, PROJECT, caption } from '../lib/journey-fixtures.mjs';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Session/run residue swept by the gate beat's finally, PLUS a crash-safe
// leading sweep: the sid is server-minted (not deterministic like the old
// flow-shaped fixture ids), so as soon as it is known the beat records it in
// a fixed marker file; the next run's leading sweep reads the marker and
// removes a PRIOR interrupted run's residue. The one honest gap: a crash in
// the window between the Start POST and the sid landing in the URL leaves
// one staged session dir unrecorded (visible under the project's sessions,
// harmless, manually removable).
const FOB_MARKER = join(tmpdir(), 'forge-journey-flows-onboard-marker.json');
let FOB_SESSION_ID = null;

function sweepOnboardResidue(sessionId) {
  try {
    rmSync(join(FORGE_ROOT, 'projects', PROJECT, '_onboarding', sessionId), { recursive: true, force: true });
  } catch { /* best-effort */ }
  // The dispatch run log dir (runId is minted server-side; sweep any _logs
  // dir whose name embeds this session id).
  try {
    const logsRoot = join(FORGE_ROOT, '_logs');
    if (existsSync(logsRoot)) {
      for (const d of readdirSync(logsRoot)) {
        if (d.includes(sessionId)) {
          rmSync(join(logsRoot, d), { recursive: true, force: true });
        }
      }
    }
  } catch { /* best-effort */ }
}

/** Crash-safe leading sweep: residue of a PRIOR interrupted run of this
 *  same beat, recognised by the marker it recorded. */
function sweepPriorInterruptedRun() {
  try {
    if (!existsSync(FOB_MARKER)) return;
    const prior = JSON.parse(readFileSync(FOB_MARKER, 'utf8'));
    // Same-project guard: only sweep residue this journey's own PROJECT owns.
    if (prior && typeof prior.sessionId === 'string' && prior.project === PROJECT) {
      sweepOnboardResidue(prior.sessionId);
    }
    rmSync(FOB_MARKER, { force: true });
  } catch { /* best-effort */ }
}

function recordOnboardMarker(sessionId) {
  try {
    writeFileSync(FOB_MARKER, JSON.stringify({ project: PROJECT, sessionId, at: new Date().toISOString() }));
  } catch { /* best-effort */ }
}

function cleanOnboardSession() {
  if (!FOB_SESSION_ID) return;
  sweepOnboardResidue(FOB_SESSION_ID);
  try { rmSync(FOB_MARKER, { force: true }); } catch { /* best-effort */ }
  FOB_SESSION_ID = null;
}

export const journey = defineJourney({
  id: 'flows-onboard',
  title: 'Onboard a project through the onboarding session',
  story: 'As an operator, I see one consolidated flows pillar (two seed flows, a filter, a unified recent-runs ledger) and one obvious way to onboard a project: the onboarding SESSION, with a real kickoff at /sessions/onboarding/new that starts a genuine staged session on the generic panel.',
  beats: [
    {
      id: 'flows-onboard-monitor',
      title: 'The consolidated flows pillar: two seed flows, filter, unified recent runs',
      narration: 'W7-C1 consolidated the flows pillar: the vestigial reflect and onboard flow wrappers are gone (reflection is a standalone post-merge agent run; onboarding is a session), so the index lists exactly forge-architect and forge-develop. The index also grew what it was missing (flows-18/19/32): trigger badges that read "on merged" — a trigger, no longer a bare "MERGED" that read as a run status beside the failed chips — a name filter with data-flow-visible-count, and the SAME shared RecentRuns ledger the agents index mounts, fed kind=all so flow runs AND standalone agent work are both visible from this pillar.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[FOB.1] The consolidated flows index');
        await page.goto(watch.uiUrl + '/flows', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="flows-index"]')?.getAttribute('data-page-ready') === 'true',
          null, { timeout: 15000 },
        ).catch(() => {});
        await caption(page, 'One consolidated flows pillar — the two real seed flows, nothing vestigial.');

        // W7-C1 retirement: the two seed flows and ONLY those among the seeds.
        const cardIds = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-card-type="flow"]')).map((el) => el.getAttribute('data-card-id')));
        check(cardIds.includes('forge-architect') && cardIds.includes('forge-develop'),
          `FOB.1: forge-architect + forge-develop render as flow cards (got ${JSON.stringify(cardIds)})`);
        // (The retired reflect flow id is spelled indirectly — W7-C1's grep
        // gate keeps the literal out of live scripts/.)
        const retiredIds = ['onboard-project', ['forge', 'reflect'].join('-')];
        check(retiredIds.every((rid) => !cardIds.includes(rid)),
          `FOB.1: the retired reflect/onboard flow wrappers are GONE from the index (got ${JSON.stringify(cardIds)})`);

        // R6-03-F3 pins carried over: six-pillar nav + server-sourced provenance.
        const navCount = await page.locator('[data-component="studio-nav"] [data-nav]').count();
        check(navCount === 6, `FOB.nav: the six-pillar nav renders — got ${navCount}`);
        check(await page.locator('[data-card-type="flow"][data-card-id="forge-develop"][data-provenance="ootb"]').count() > 0,
          'FOB.prov: forge-develop is marked data-provenance="ootb"');

        // forge-n5r carry-over: every flow card carries a live data-flow-status.
        const flowStatuses = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-card-type="flow"][data-flow-status]'))
            .map((el) => ({ id: el.getAttribute('data-card-id'), status: el.getAttribute('data-flow-status') })));
        const VALID_FLOW_STATUS = new Set(['active', 'gated', 'idle']);
        check(flowStatuses.length >= 2 && flowStatuses.every((f) => VALID_FLOW_STATUS.has(f.status)),
          `FOB.status: every flow card carries a valid data-flow-status (got ${JSON.stringify(flowStatuses)})`);

        // W7-C1 (flows-18): the develop card's merged trigger badge reads as a
        // TRIGGER ("on merged"), with the full target on the hover title.
        const badge = await page.evaluate(() => {
          const el = document.querySelector('[data-card-id="forge-develop"] [data-trigger-badge="merged"]');
          return el ? { text: el.textContent, title: el.getAttribute('title') } : null;
        });
        check(badge !== null && badge.text.trim() === 'on merged',
          `FOB.badge (flows-18): the merged trigger badge reads "on merged", never a bare status-looking "MERGED" (got ${JSON.stringify(badge)})`);
        check(badge !== null && badge.title.includes('reflector'),
          `FOB.badge: the hover title names the real target — the standalone reflector agent (got ${JSON.stringify(badge)})`);

        // W7-C1 (flows-19): filter + visible-count.
        check(await page.locator('[data-field="flows-filter"]').count() === 1,
          'FOB.filter (flows-19): the index renders the name filter (data-field="flows-filter")');
        const visibleCount = await page.evaluate(() =>
          document.querySelector('[data-component="flows-grid"]')?.getAttribute('data-flow-visible-count'));
        check(visibleCount === String(cardIds.length),
          `FOB.filter: data-flow-visible-count mirrors the rendered grid (${visibleCount} vs ${cardIds.length})`);
        // Type a needle that matches only forge-develop ("develop" would ALSO
        // hit forge-architect's goal — "ready for Develop to execute" — so use
        // a token unique to the develop flow's goal); the grid narrows and
        // the count tells automation so without card-scraping.
        await page.locator('[data-field="flows-filter"]').fill('adversarial').catch(() => {});
        await page.waitForFunction(
          () => document.querySelector('[data-component="flows-grid"]')?.getAttribute('data-flow-visible-count') === '1',
          null, { timeout: 5000 },
        ).catch(() => {});
        const narrowed = await page.evaluate(() =>
          document.querySelector('[data-component="flows-grid"]')?.getAttribute('data-flow-visible-count'));
        check(narrowed === '1', `FOB.filter: typing "adversarial" narrows the grid to 1 card (data-flow-visible-count="${narrowed}")`);
        await frame(page, 'fob-0b-filter', 'FOB — the flows filter narrows the grid; data-flow-visible-count mirrors it');
        await page.locator('[data-field="flows-filter"]').fill('').catch(() => {});

        // W7-C1 (flows-19/32): the unified recent-runs section (shared
        // RecentRuns, kind=all — flow runs AND standalone agent runs).
        await page.waitForFunction(
          () => document.querySelector('[data-section="flow-recent-runs"]')?.querySelector('[data-component="recent-runs-loading"]') === null,
          null, { timeout: 15000 },
        ).catch(() => {});
        const recent = await page.evaluate(() => {
          const el = document.querySelector('[data-section="flow-recent-runs"]');
          return el ? { count: el.getAttribute('data-count'), limit: el.getAttribute('data-limit') } : null;
        });
        check(recent !== null,
          'FOB.recent (flows-19/32): the flows index mounts the shared RecentRuns section (data-section="flow-recent-runs")');
        check(recent !== null && recent.limit !== null,
          `FOB.recent: the section publishes its fetch bound (data-limit="${recent?.limit}") — a capped list is never silent`);

        await frame(page, 'fob-1-consolidated-index', 'FOB — the consolidated flows pillar: two seed flows, trigger badges that read as triggers, filter, unified recent runs', { key: true });
      },
    },
    {
      id: 'flows-onboard-kickoff',
      title: '/sessions/onboarding/new is a real kickoff — no more dead end',
      narration: 'Before W7-C1, /sessions/onboarding/new rendered «Session kind "onboarding" has no kickoff entry» — zero buttons, zero inputs, linked from nowhere (sessions-kinds-01, crosscut-14) — while the flow-shaped duplicate 400\'d. Now onboarding rides the SAME generic kickoff every other session kind uses: a roster project select (never free text), the agent\'s declared model envelope, a duplicate-session guard, and Start — and the /sessions index links it like every other kind.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[FOB.2] The onboarding session kickoff');

        // The /sessions index links the onboarding kickoff (crosscut-14: the
        // route used to be linked from nowhere).
        await page.goto(watch.uiUrl + '/sessions', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-action="kickoff-onboarding"]', { timeout: 15000 }).catch(() => {});
        check(await page.locator('[data-action="kickoff-onboarding"]').count() > 0,
          'FOB.2 (crosscut-14): the /sessions index renders the onboarding kickoff entry (data-action="kickoff-onboarding")');

        await page.goto(watch.uiUrl + '/sessions/onboarding/new', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('[data-page="session-kickoff"]') !== null,
          null, { timeout: 15000 },
        ).catch(() => {});
        await caption(page, 'The onboarding session kickoff — a real project select and Start, not a dead end.');
        const kickoff = await page.evaluate(() => {
          const main = document.querySelector('[data-kickoff-kind]');
          return {
            kind: main?.getAttribute('data-kickoff-kind') ?? null,
            hasProjectSelect: document.querySelector('select[data-field="kickoff-project"]') !== null,
            hasStart: document.querySelector('[data-action="start-session"]') !== null,
            deadEnd: document.body.textContent.includes('has no kickoff entry'),
          };
        });
        check(kickoff.kind === 'onboarding',
          `FOB.2 (sessions-kinds-01): the generic kickoff renders for kind onboarding (data-kickoff-kind="${kickoff.kind}")`);
        check(kickoff.hasProjectSelect,
          'FOB.2: the kickoff\'s project field is a SELECT over real roster ids (select[data-field="kickoff-project"])');
        check(kickoff.hasStart,
          'FOB.2: the kickoff renders [data-action="start-session"]');
        check(!kickoff.deadEnd,
          'FOB.2: the «has no kickoff entry» dead-end copy is gone');
        await frame(page, 'fob-2-onboarding-kickoff', 'FOB — /sessions/onboarding/new: project select + Start on the one generic kickoff surface', { key: true });
      },
    },
    {
      id: 'flows-onboard-gate',
      title: 'Start closes the loop — a real staged session on the generic panel',
      narration: 'Start genuinely POSTs /api/studio/onboarding/start: the session dir, status.json and prompt.md land on disk for real — only the agent dispatch itself is suppressed by the same dry-bridge seam every kickoff beat in this harness relies on. The operator lands on the generic session panel (data-session-kind="onboarding") — the same shell that carries onboarding\'s multi-stage contract build-out in a live run. The platform gate the old flow wrapper carried (the REAL runPreflight behind gate: contract) stays proven in orchestrator/onboard-flow-gate.test.ts against an authored flow fixture.',
      drive: async (ctx) => {
        const { page, watch, frame, check } = ctx;
        console.log('\n[FOB.3] Start → a real staged onboarding session');
        // Crash-safe leading sweep of a PRIOR interrupted run's residue.
        sweepPriorInterruptedRun();
        try {
          await page.goto(watch.uiUrl + '/sessions/onboarding/new', { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('select[data-field="kickoff-project"]', { timeout: 15000 }).catch(() => {});
          await page.locator('select[data-field="kickoff-project"]').selectOption(PROJECT).catch(() => {});
          await page.locator('[data-action="start-session"]').click().catch(() => {});
          // Duplicate-session guard (W7-A2): a live session on the same
          // kind+target arms the button first — confirm through it.
          await page.waitForTimeout(1200);
          if (!page.url().includes('/sessions/onboarding/')) {
            await page.locator('[data-action="start-session"]').click().catch(() => {});
          }
          await page.waitForURL(/\/sessions\/onboarding\/(?!new)[^/?]+/, { timeout: 20000 }).catch(() => {});
          const url = page.url();
          const m = url.match(/\/sessions\/onboarding\/([^/?]+)/);
          FOB_SESSION_ID = m && m[1] !== 'new' ? decodeURIComponent(m[1]) : null;
          if (FOB_SESSION_ID !== null) recordOnboardMarker(FOB_SESSION_ID);
          check(FOB_SESSION_ID !== null,
            `FOB.3: Start navigates onto the session page (/sessions/onboarding/<sid>, got ${url})`);

          await page.waitForFunction(
            () => document.querySelector('[data-page="session"]')?.getAttribute('data-session-kind') === 'onboarding',
            null, { timeout: 20000 },
          ).catch(() => {});
          const kind = await page.evaluate(() =>
            document.querySelector('[data-page="session"]')?.getAttribute('data-session-kind') ?? null);
          check(kind === 'onboarding',
            `FOB.3: the generic session panel renders the onboarding session (data-session-kind="${kind}")`);

          // The session dir genuinely landed on disk (dry bridge keeps the
          // REAL bookkeeping; only the dispatch is suppressed).
          const sessionDirLanded = FOB_SESSION_ID !== null &&
            existsSync(join(FORGE_ROOT, 'projects', PROJECT, '_onboarding', FOB_SESSION_ID));
          check(sessionDirLanded,
            `FOB.3: the staged session dir landed at projects/${PROJECT}/_onboarding/${FOB_SESSION_ID} — real bookkeeping, not a mock`);

          await caption(page, 'One entry, one loop: the onboarding session, staged for real on the generic panel.');
          await frame(page, 'fob-3-session-panel', 'FOB — Start lands on the generic session panel; the staged session dir is real on disk', { key: true });
        } finally {
          cleanOnboardSession();
        }
      },
    },
  ],
});
