/**
 * sessions-index — W6-B11: the aggregate in-flight sessions surface.
 *
 * "Every session that needs me, in one place" — the operator lands on Home,
 * sees the active-sessions strip (a real seeded in-flight session, needs-you
 * flagged), follows the strip's overflow link to the full `/sessions`
 * index, and resumes straight into the session shell from there. Entry-point
 * rule: the clip starts at `/` (Home), not mid-flow on `/sessions` itself —
 * the strip's "all sessions" link IS the trigger this journey proves.
 *
 * FIXTURE: reuses the harness's EXISTING instructions-session seeding
 * helpers (`scripts/lib/journey-fixtures.mjs`'s `writeInstrStatus`/
 * `cleanInstructionsSession` — the same ones knowledge.mjs/agents.mjs and
 * others already use to seed a real instructions session) rather than
 * inventing a new one. `SESSIONS_INDEX_SID` is disjoint from every other
 * journey's own instructions-session ids (never home.mjs's own scratch
 * projects, never J4, never any SHOWCASE fixture id) — seeded under the
 * SAME `mdtoc` reference project
 * every instructions-touching journey already writes into, at phase
 * `awaiting-verdict` (a REAL `deriveSessionAffordances` verdict affordance —
 * mirrors apps/forge/ui-bridge-sessions-index.test.ts's own AT fixture shape) so
 * both the strip's needs-you dot AND the index's `data-needs-you="true"` are
 * driven by an honest, derivable condition, never a hand-poked flag.
 */
import { defineJourney } from '../lib/journey-runtime.mjs';
import { caption, ACT, READ } from '../lib/journey-fixtures.mjs';
import { sleep, checkHonestPillarRead } from '../lib/journey-assertions.mjs';
import { writeInstrStatus, writeCrashedInstrSession, cleanInstructionsSession } from '../lib/journey-fixtures.mjs';

// Disjoint from home.mjs's HOME_* fixtures and every other journey's own
// instructions-session ids.
export const SESSIONS_INDEX_SID = 'journey-sessions-index-fixture';
// W7-A2 — a SECOND fixture: a CRASHED session (status.json stuck at the
// working phase `drafting`, an InteractiveRunnerError in its stderr.log
// written after it — the operator's own stuck-session shape, see
// `writeCrashedInstrSession`'s provenance note). The bridge derives
// `state: crashed` at read time; this journey proves the crash is visible
// on the index and that the row can be CANCELLED from there.
export const SESSIONS_INDEX_CRASHED_SID = 'journey-sessions-index-crashed';

function seedSessionsIndexFixture() {
  writeInstrStatus(SESSIONS_INDEX_SID, { phase: 'awaiting-verdict', round: 2 });
  writeCrashedInstrSession(SESSIONS_INDEX_CRASHED_SID);
}

function cleanSessionsIndexFixture() {
  cleanInstructionsSession(SESSIONS_INDEX_SID);
  cleanInstructionsSession(SESSIONS_INDEX_CRASHED_SID);
}

/** goto `/` and wait for Home's real readiness signal — never a fixed sleep. */
async function gotoHomeReady(page, watch) {
  await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('[data-page="home"]')?.getAttribute('data-page-ready') === 'true',
    null, { timeout: 20000 },
  ).catch(() => {});
}

export const journey = defineJourney({
  id: 'sessions-index',
  title: 'Sessions index — every in-flight session, one place',
  story: 'As the operator, I land on Home, see a real in-flight session that needs my attention in the active-sessions strip, follow its overflow link to the full /sessions index, see a crashed session read as crashed (with the runner\'s own error) rather than as a calm "needs you", cancel it right there, and open the live one straight into the session shell — never a dead end.',
  beats: [
    {
      id: 'sessions-index-home-strip',
      title: 'Home\'s active-sessions strip — a real needs-you session',
      narration: 'Home\'s active-sessions strip (W6-B11, the IA-4 marked slot) renders a real in-flight session — a genuine instructions session sitting at awaiting-verdict, the same phase that drives a REAL deriveSessionAffordances verdict affordance, never a fabricated needs-you flag.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[SESSIONS-IDX.1] Home — the active-sessions strip');
        cleanSessionsIndexFixture(); // crash-safe leading sweep
        seedSessionsIndexFixture();

        // Review fix (same class as home.mjs's home-landing beat): the
        // fixture lives under mdtoc's SHARED `_instructions/` dir, so a
        // thrown exception anywhere below would leak it there until this
        // journey's next run — polluting a project other journeys also
        // depend on. Wraps the whole beat body so the seed is always swept
        // before the error propagates.
        try {
          await gotoHomeReady(page, watch);
          await caption(page, 'The active-sessions strip: a real in-flight session that needs the operator, surfaced right on Home.');
          await sleep(READ);

          // W7-B1: the strip is the NAMED `sessions-needing-you` section now.
          const stripCount = await page.locator('section[data-section="sessions-needing-you"]').count();
          check(stripCount === 1, `SESSIONS-IDX.1: section[data-section="sessions-needing-you"] renders — the seeded in-flight session fired it (got ${stripCount})`);

          const stripAttrs = await page.evaluate(() => {
            const el = document.querySelector('[data-section="sessions-needing-you"]');
            return el ? {
              count: el.getAttribute('data-active-session-count'),
              needsYou: el.getAttribute('data-needs-you-count'),
            } : null;
          });
          check(stripAttrs !== null, 'SESSIONS-IDX.1: the strip carries data-active-session-count and data-needs-you-count');
          check(parseInt(stripAttrs?.count ?? '0', 10) >= 1, `SESSIONS-IDX.1: data-active-session-count >= 1 (got "${stripAttrs?.count}")`);
          check(parseInt(stripAttrs?.needsYou ?? '0', 10) >= 1, `SESSIONS-IDX.1: data-needs-you-count >= 1 — the seeded awaiting-verdict session (got "${stripAttrs?.needsYou}")`);

          const seededCard = await page.evaluate((sid) => {
            // W7-A2: the card is a div keyed by data-session-id (the link is
            // a child, so a cancel button can sit beside it un-nested).
            const el = document.querySelector(`[data-session-card][data-session-id="${sid}"]`);
            return el ? {
              kind: el.getAttribute('data-session-kind'),
              phase: el.getAttribute('data-session-phase'),
              needsYou: el.getAttribute('data-needs-you'),
              state: el.getAttribute('data-session-state'),
              hasCancel: el.querySelector('[data-action="cancel-session"]') !== null,
            } : null;
          }, SESSIONS_INDEX_SID);
          check(seededCard !== null, 'SESSIONS-IDX.1: the seeded session renders its own card in the strip');
          check(seededCard?.kind === 'instructions', `SESSIONS-IDX.1: the seeded card is the real instructions kind (got "${seededCard?.kind}")`);
          check(seededCard?.needsYou === 'true', `SESSIONS-IDX.1: the seeded card is flagged needs-you — a REAL derived operator gate (awaiting-verdict), not fabricated (got "${seededCard?.needsYou}")`);
          check(seededCard?.state === 'awaiting-operator', `SESSIONS-IDX.1: the card carries the bridge-derived lifecycle state (got "${seededCard?.state}")`);
          check(seededCard?.hasCancel === true, 'SESSIONS-IDX.1: every Home session card offers cancel (W7-A2)');

          // W7-A2: the crashed fixture reads CRASHED on Home too — never a
          // calm needs-you row.
          const crashedCard = await page.evaluate((sid) => {
            const el = document.querySelector(`[data-session-card][data-session-id="${sid}"]`);
            return el ? { state: el.getAttribute('data-session-state'), needsYou: el.getAttribute('data-needs-you'), chip: el.querySelector('[data-session-state-chip]')?.textContent ?? '' } : null;
          }, SESSIONS_INDEX_CRASHED_SID);
          check(crashedCard !== null, 'SESSIONS-IDX.1: the crashed fixture renders a card');
          check(crashedCard?.state === 'crashed', `SESSIONS-IDX.1: the crashed session\'s card reads state=crashed (got "${crashedCard?.state}")`);
          check((crashedCard?.chip ?? '').includes('Crashed'), `SESSIONS-IDX.1: the crashed card\'s chip says so, with the runner\'s own error (got "${(crashedCard?.chip ?? '').slice(0, 80)}")`);

          await frame(page, 'sessions-idx-0-home-strip', 'Home — the active-sessions strip: a real needs-you session, surfaced without hunting for it', { key: true });
        } catch (err) {
          cleanSessionsIndexFixture(); // shared-mdtoc fixture — never leak it on a throw
          throw err;
        }
      },
    },
    {
      id: 'sessions-index-overflow',
      title: 'Following the strip to the full /sessions index — crash visible, cancel from the row',
      narration: 'The strip\'s "all sessions" overflow link is the trigger this journey proves: clicking it lands on the real /sessions index, where the SAME seeded session appears as its own table row, sorted needs-you first — never re-derived, the SAME bridge-computed needsYou/phase/state the strip already showed. A second, CRASHED session (its runner threw into stderr.log after its last phase write) reads state=crashed with the runner\'s own error in the row — never a calm "needs you" — and is cancelled right there with a two-step confirm; the cancelled session drops out of the in-flight list, the live one stays.',
      drive: async (ctx) => {
        const { page, watch, check, frame } = ctx;
        console.log('\n[SESSIONS-IDX.2] Home -> /sessions via the overflow link');
        try {
          await gotoHomeReady(page, watch);
          await sleep(ACT);

          await page.locator('[data-action="view-all-sessions"]').click();
          await page.waitForFunction(
            () => document.querySelector('[data-page="sessions-index"]')?.getAttribute('data-page-ready') === 'true',
            null, { timeout: 15000 },
          ).catch(() => {});
          await caption(page, 'The full /sessions index — every in-flight session, across kinds and projects, needs-you first.');
          await sleep(READ);

          const pageAttrs = await page.evaluate(() => {
            const m = document.querySelector('[data-page="sessions-index"]');
            return m ? { ready: m.getAttribute('data-page-ready'), count: m.getAttribute('data-session-count') } : null;
          });
          check(pageAttrs !== null, 'SESSIONS-IDX.2: [data-page="sessions-index"] renders at /sessions');
          check(pageAttrs?.ready === 'true', `SESSIONS-IDX.2: [data-page-ready="true"] once the fetch settles (got "${pageAttrs?.ready}")`);
          // W7-A1 / FIX-A1 (A1-11): the sessions pillar's read is honest —
          // data-fetch-status="ok" + the app-shell bridge banner mounted.
          await checkHonestPillarRead(page, check, 'sessions-index', 'SESSIONS-IDX.2');
          check(parseInt(pageAttrs?.count ?? '0', 10) >= 1, `SESSIONS-IDX.2: data-session-count >= 1 — the seeded session is present (got "${pageAttrs?.count}")`);

          // W7-B1 (crosscut-13/home-sessions-19): the kickoff CTAs render in
          // the POPULATED state too — with real rows on screen, starting a
          // new session stays one click away.
          const kickoff = await page.evaluate(() => {
            const el = document.querySelector('[data-section="sessions-kickoff"]');
            return el ? {
              entries: Array.from(el.querySelectorAll('a[data-action^="kickoff-"]')).map((a) => a.getAttribute('data-action')),
            } : null;
          });
          check(kickoff !== null, 'SESSIONS-IDX.2 (W7-B1): [data-section="sessions-kickoff"] renders alongside the populated table');
          // W7-C1 (sessions-kinds-01/crosscut-14) made `onboarding` a real
          // generic kickoff kind — the onboard-project FLOW was retired in
          // favour of the session. W8-B5b WI-3 retired community-refresh, so
          // the ONE shared list is seven entries, pinned at 7 in
          // `apps/studio/lib/session-kind-meta.test.ts`. The identities matter
          // more than the count: a list that silently swaps one kind for
          // another keeps the same length.
          check((kickoff?.entries ?? []).length === 7, `SESSIONS-IDX.2 (W7-B1/C1): all seven kickoff entries render (got ${(kickoff?.entries ?? []).length})`);
          check((kickoff?.entries ?? []).includes('kickoff-onboarding'), 'SESSIONS-IDX.2 (W7-C1): onboarding is among them too — the retired onboard-project flow\'s replacement is reachable from the sessions index');

          // W7-B1 (home-sessions-07) — the filter bar is live state: present
          // with rows, and the table mirrors the (default, all-pass) filter
          // state as data-filter-* attributes.
          const filterState = await page.evaluate(() => ({
            barPresent: document.querySelector('[data-section="sessions-filters"]') !== null,
            kindSelect: document.querySelector('select[data-field="filter-kind"]') !== null,
            needsYouDefault: document.querySelector('[data-section="sessions-table"]')?.getAttribute('data-filter-needs-you') ?? null,
          }));
          check(filterState.barPresent && filterState.kindSelect, 'SESSIONS-IDX.2 (W7-B1): the filter bar renders with kind/project/state selects on a populated index');
          check(filterState.needsYouDefault === 'false', `SESSIONS-IDX.2 (W7-B1): the table mirrors the default filter state (data-filter-needs-you="false", got "${filterState.needsYouDefault}")`);

          const rowOf = (sid) => page.evaluate((id) => {
            const el = document.querySelector(`a[data-action="resume-session"][href*="${id}"]`);
            const tr = el ? el.closest('tr') : null;
            return tr ? {
              kind: tr.getAttribute('data-session-kind'),
              kindLabel: tr.querySelector('a[data-action="open-session"]')?.textContent ?? '',
              phase: tr.getAttribute('data-session-phase'),
              needsYou: tr.getAttribute('data-needs-you'),
              state: tr.getAttribute('data-session-state'),
              chip: tr.querySelector('[data-session-state-chip]')?.textContent ?? '',
              hasCancel: tr.querySelector('[data-action="cancel-session"]') !== null,
              needsYouChip: tr.querySelector('[data-needs-you-chip]')?.textContent ?? null,
              dotStatus: tr.querySelector('[data-needs-you-chip] .status-dot')?.getAttribute('data-status') ?? null,
            } : null;
          }, sid);
          const row = await rowOf(SESSIONS_INDEX_SID);
          check(row !== null, 'SESSIONS-IDX.2: the seeded session renders its own table row');
          check(row?.kind === 'instructions', `SESSIONS-IDX.2: the row carries the real kind (got "${row?.kind}")`);
          // W7-B1 (home-sessions-20): the visible Kind label is the
          // descriptor's own authored title, linking into the session.
          check((row?.kindLabel ?? '').includes('Instructions session'), `SESSIONS-IDX.2 (W7-B1): the Kind cell reads the descriptor title (got "${row?.kindLabel}")`);
          check(row?.needsYou === 'true', `SESSIONS-IDX.2: the row carries the real needsYou (got "${row?.needsYou}")`);
          // W7-B1 (home-sessions-03/24, community-24): the needs-you signal
          // is a labelled chip with its OWN status token — never "retrying".
          check((row?.needsYouChip ?? '').includes('needs you'), `SESSIONS-IDX.2 (W7-B1): the needs-you chip carries visible text (got "${row?.needsYouChip}")`);
          check(row?.dotStatus === 'needs-you', `SESSIONS-IDX.2 (W7-B1): the chip's dot carries data-status="needs-you", not the borrowed "retrying" (got "${row?.dotStatus}")`);
          check(row?.state === 'awaiting-operator', `SESSIONS-IDX.2: the row carries data-session-state from the bridge (got "${row?.state}")`);
          check(row?.hasCancel === true, 'SESSIONS-IDX.2: every in-flight row offers cancel (W7-A2)');

          // W7-A2 — the crashed session reads CRASHED on the index, with the
          // runner\'s own error in its chip, and needs-you (a human decision).
          const crashedRow = await rowOf(SESSIONS_INDEX_CRASHED_SID);
          check(crashedRow !== null, 'SESSIONS-IDX.2: the crashed fixture renders its own row');
          check(crashedRow?.state === 'crashed', `SESSIONS-IDX.2: the crashed row reads data-session-state="crashed" — derived from stderr.log at read time (got "${crashedRow?.state}")`);
          check(crashedRow?.needsYou === 'true', `SESSIONS-IDX.2: a crash needs the operator (got "${crashedRow?.needsYou}")`);
          check((crashedRow?.chip ?? '').includes('declares writes: [draft]'), `SESSIONS-IDX.2: the chip carries the runner\'s own message (got "${(crashedRow?.chip ?? '').slice(0, 100)}")`);

          await caption(page, 'A crashed session reads as crashed — the runner\'s own error, right in the row — never a calm "needs you".');
          await frame(page, 'sessions-idx-1-full-index', '/sessions — the full in-flight index: needs-you first, and a crashed session shows its runner error instead of hiding behind "needs you"', { key: true });

          // W7-A2 — cancel the crashed one from its row: two-step confirm
          // (arm, then confirm) → the bridge writes the universal
          // `cancelled` terminal phase → the row leaves the active list.
          const crashedCancel = page.locator(`a[data-action="resume-session"][href*="${SESSIONS_INDEX_CRASHED_SID}"]`).locator('xpath=ancestor::tr').locator('[data-action="cancel-session"]').first();
          await crashedCancel.click();
          await sleep(ACT);
          const armed = await crashedCancel.getAttribute('data-confirming');
          check(armed === 'true', `SESSIONS-IDX.2: the first click ARMS the cancel (data-confirming="true"), never fires it (got "${armed}")`);
          await caption(page, 'Cancel is a two-step confirm — a stray click never kills a live turn.');
          await frame(page, 'sessions-idx-1b-cancel-armed', '/sessions — Cancel armed on the crashed row: "Confirm cancel", with a keep link beside it', { key: true });
          await crashedCancel.click();
          await page.waitForFunction(
            (id) => document.querySelector(`a[data-action="resume-session"][href*="${id}"]`) === null,
            SESSIONS_INDEX_CRASHED_SID, { timeout: 15000 },
          ).catch(() => {});
          const gone = await rowOf(SESSIONS_INDEX_CRASHED_SID);
          check(gone === null, 'SESSIONS-IDX.2: after the confirmed cancel the crashed row leaves the in-flight index (phase=cancelled is terminal for every kind)');
          const stillThere = await rowOf(SESSIONS_INDEX_SID);
          check(stillThere !== null, 'SESSIONS-IDX.2: the live awaiting-verdict session is untouched by cancelling its neighbour');
          await caption(page, 'Confirmed — the crashed session is cancelled and gone from the in-flight list.');
          await frame(page, 'sessions-idx-1c-cancelled', '/sessions — the crashed session cancelled from its row; only the live one remains', { key: true });

          // Resume straight into the session shell — never a dead end.
          await page.locator(`a[data-action="resume-session"][href*="${SESSIONS_INDEX_SID}"]`).first().click();
          await page.waitForFunction(
            () => document.querySelector('[data-page="session"]')?.getAttribute('data-session-id') != null,
            null, { timeout: 15000 },
          ).catch(() => {});
          const shell = await page.evaluate(() => {
            const m = document.querySelector('[data-page="session"]');
            return m ? { kind: m.getAttribute('data-session-kind'), id: m.getAttribute('data-session-id') } : null;
          });
          check(shell?.id === SESSIONS_INDEX_SID, `SESSIONS-IDX.2: the Resume link lands on the seeded session's own shell (data-session-id="${shell?.id}")`);
          check(shell?.kind === 'instructions', `SESSIONS-IDX.2: the shell resolves the real kind (got "${shell?.kind}")`);

          await frame(page, 'sessions-idx-2-resume', '/sessions — Resume lands straight in the real session shell, phase intact', { key: true });
        } finally {
          cleanSessionsIndexFixture(); // the last beat that needs the fixture
        }
      },
    },
  ],
});
