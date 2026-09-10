/**
 * beats-page.mjs — what the page SAYS, and how long the runner waits for it to
 * say it.
 *
 * Split out of `beats.mjs` when that file reached 802 lines against the
 * 800-line cap (`scripts/check-file-size.mjs`, a shrink-only ratchet — a
 * baseline entry would raise the debt ceiling, not honour it). The gate names
 * the remedy itself: "Split it."
 *
 * The seam is one that was already there, not one invented to fit a number.
 * Everything here answers *what is on the page*: reading its `data-*`, deciding
 * which observed record an expectation is judged against, and waiting for the
 * page to change. Every one of them fails the same way — a DOM-contract
 * problem, a selector that no longer matches, a wait whose bound is wrong for
 * what it waits on. What stayed in `beats.mjs` answers *what the beat MEANS*:
 * the verdict, the route resolution, and the operator acts a `do` block
 * performs. A judgement bug and a reading bug are found and fixed in different
 * places, so they live in different places.
 *
 * Nothing here judges. `readObserved` is deliberately VALUE-BLIND: it collects
 * by key and never sees what the beat expects, because a reader that knew the
 * answer is how a gate starts agreeing with itself.
 */

// The product's stall ceiling, single-sourced from the module that owns the
// runner's other agent-evidence reads and bound to the TypeScript constant by
// `beats-offsession-stall.test.ts` (T1 ruling 580).
import { STALL_CEILING_MS } from './beats-agent-proc.mjs';

/** A `<name>` expectation: bind whatever the page rendered, for a later beat's route. */
export const PLACEHOLDER = /^<([A-Za-z][A-Za-z0-9_]*)>$/;

/** Does an observed value answer one expectation? A `<name>` takes any non-empty value. */
export const answers = (got, want) => (PLACEHOLDER.test(want) ? got !== '' : got === want);

/** Attributes whose value means "this page is not working", checked on every beat. */
export const ERROR_SENTINELS = [
  ['fetch-status', 'error'],
  ['load-error', 'true'],
];

/**
 * The product's OWN verdict on a session, published by `SessionLifecycleBar`
 * on the 5-token contract `working | awaiting-operator | crashed | stalled |
 * terminal` and derived server-side by `deriveSessionLifecycle` — never
 * re-derived from phase names or timestamps, here or in the page.
 *
 * `stalled` is that function's "hung-SDK shape": a live pid whose channel went
 * quiet past its kind's ceiling (120 s for an architect). A beat waiting on an
 * agent has no business sitting out a ten-minute bound after the product has
 * said, at two minutes, that nothing is coming.
 */
export const LIFECYCLE_STALLED = 'stalled';

/**
 * The same contract's word for "the runner's process died".
 *
 * Bead `forge-8vfn.7.5.x` (T1 ruling 518), measured on D's S6 run: the
 * project-brain turn crashed, the page rendered `data-lifecycle-state=
 * "crashed"` with the runner's own last stderr line beneath it, and beat 6
 * spent its full declared bound anyway.
 *
 * NEITHER existing door could open. A crash is the shape where the process
 * dies WITHOUT writing a terminal phase, so `status.json` still reads whatever
 * it read mid-flight and the phase door below stays shut; and
 * `deriveSessionLifecycle` calls it `crashed`, not `stalled`, so the stall door
 * stays shut too. The one signal that was true is the one nothing read.
 *
 * It also carries the only MESSAGE any of these doors has: `error` is the
 * runner's own last non-stack stderr line, extracted server-side by
 * `extractErrorMessage` and rendered in `pre[data-lifecycle-error]`. A beat
 * that stops here says what the page said.
 */
export const LIFECYCLE_CRASHED = 'crashed';

/**
 * The session's own terminal phases that are NOT a success.
 *
 * Bead `forge-8vfn.6.11.39`, the mirror of `6.11.38`: that one is the loop
 * overshooting the phase it waits for, this is the loop waiting on a corpse.
 * Measured on S2 run 7 — the architect's SDK child exited code 1 three seconds
 * in, `status.json` recorded `phase: "failed"` with its error, and beat 12 then
 * spent its full declared 600 000 ms because "the act kept being available".
 * It was: the page still rendered the control. The SESSION was dead, and the
 * product had said so in its own status.
 *
 * The lifecycle bar cannot say it. `deriveSessionLifecycle`'s first rule
 * collapses every terminal phase to `terminal` with `error: null`, so a failed
 * session is indistinguishable there from a finished one — which is why this
 * reads the phase instead.
 *
 * And reading it is NOT the re-derivation this file's header forbids. That rule
 * is "never re-derive the LIFECYCLE from phase names or timestamps". `failed` is
 * the product's own word for its own state, written by
 * `writeSessionTerminalPhase(…, 'failed', msg)` and declared
 * `{ phase: failed, step: terminal }` in `studio/session-kinds.yaml`. Believing
 * a terminal verdict the product published is the opposite of second-guessing
 * it.
 *
 * T1 ruling 518 widened this from the single token `failed` to the product's
 * own closed set. `apps/studio/lib/history-ledger.ts` declares it —
 * `SESSION_STOPPED_PHASES = rejected | abandoned | cancelled | failed` — and
 * pins it there against the REAL `studio/session-kinds.yaml`'s `step: terminal`
 * rows, so a future kind's new terminal token turns that suite red rather than
 * drifting past this one. A beat waiting on a session the operator REJECTED has
 * exactly as little to wait for as one waiting on a session that threw, and
 * before 518 it waited out the whole bound.
 *
 * The DONE half of that vocabulary (`committed | locked | applying | applied |
 * complete`) is deliberately absent: a beat may be waiting for the control a
 * session renders only once it has committed, and stopping there would invent a
 * failure out of a success. Copied rather than imported because this harness is
 * plain `.mjs` run by `node scripts/stories/run.mjs` with no type stripping, so
 * it cannot import the `.ts` that declares it — `beats-agent-crashed.test.ts`
 * names the source and the three tokens it adds.
 */
export const TERMINAL_STOPPED_PHASES = Object.freeze(new Set(['failed', 'rejected', 'abandoned', 'cancelled']));

/**
 * Does `url` satisfy the route a beat DECLARED?
 *
 * Pathname always; query only when the beat asked for one (T1 ruling 514).
 *
 * 7.5.3 made both reading and selection query-BLIND, because three live product
 * sites mount links carrying `?project=…` and a story should name the route an
 * operator would say out loud, not the product's parameter plumbing. The
 * inverse case is just as real: D's S6 beat 7 wants `/knowledge?id=story-s6`
 * from a page that offers `/knowledge` too, and blind-by-pathname can only see
 * two links sharing a pathname and refuse.
 *
 * So the beat decides. Declare no query and nothing changes — the product stays
 * free to add parameters. Declare one and it is matched EXACTLY, because a beat
 * that names a query is naming which of two destinations it means.
 */
export function routeMatches(url, declared) {
  // Ruling 527 moved the link filter's copy of this out of the browser and into
  // this one function, so `url` is now sometimes a raw `href` off the page. An
  // href that will not parse is NOT a match — skipped rather than guessed at,
  // which is what the inlined copy did and what a predicate reading untrusted
  // page content has to do.
  // AN HREF THAT NAMES NO PATH IS NOT A NAVIGATION — T1 ruling 546, bought by
  // A's funded S9 run, which went 8/15 with SEVEN reds from this one line.
  //
  // `url` is sometimes a raw `href` off the page (ruling 527 moved the link
  // filter in here), and these are resolved against a SYNTHETIC origin. So the
  // app-wide skip link `href="#main-content"` (`SkipLink.tsx`, on every page)
  // resolves to pathname `/`:
  //
  //     new URL('#main-content', 'http://forge.invalid').pathname === '/'
  //
  // and every real-click navigation to `/` then saw `2 links share that
  // pathname and differ only in their query — #main-content , /` and refused.
  // The refusal was correct about what it was shown; it was shown a fragment.
  //
  // A QUERY-ONLY href is the SAME defect and is fixed with it: `?tab=x`
  // resolves to pathname `/` here for exactly the same reason. Measured, both.
  // Neither names a path, so neither can satisfy a route.
  //
  // NOT fixed, and deliberately: a protocol-relative `//host/path` resolves to
  // pathname `/path` and would match a declared `/path` on another host, and a
  // directory-relative `sub/page` resolves against the origin ROOT rather than
  // the current page. Both are real, neither occurs in this app (every `Link`
  // is path-absolute), and the obvious guard — compare hosts — would BREAK the
  // primary caller: `routeMatches(page.url(), target)` is passed a real
  // `http://localhost:4124/…`, whose host never equals the synthetic base's. A
  // guard that breaks the main path to close a shape nobody writes is a worse
  // trade than saying so here.
  // `String(url)` because playwright hands `waitForURL`'s predicate a URL
  // OBJECT, not a string (`beats-drive.mjs` calls this from there), and this
  // function's other callers pass strings. `new URL(url, base)` below had always
  // accepted either — URL's constructor stringifies — so the distinction only
  // became visible the moment a STRING METHOD was applied to the argument, and
  // it cost 546 a CI red to find: the predicate threw, the swallowing catch ate
  // it, no arrival wait happened, and every real-nav beat read its page one
  // navigation early.
  const raw = String(url);
  if (raw.startsWith('#') || raw.startsWith('?')) return false;
  let want;
  let got;
  try {
    want = new URL(declared, 'http://forge.invalid');
    got = new URL(url, 'http://forge.invalid');
  } catch {
    return false;
  }
  if (got.pathname !== want.pathname) return false;
  if (want.search === '') return true;
  // T1 ruling 534. The query is compared as PARSED PARAMETERS, never as a raw
  // string. Two reasons, both measured rather than imagined:
  //
  //   ENCODING. The product builds its artifact links with
  //   `encodeURIComponent(cycleId)` (`PhaseDrawer.tsx:749`), so a run id
  //   carrying a character that percent-encodes arrives as `%3A` in the href
  //   while a story author writes the readable id in the beat. A raw string
  //   compare calls those two different destinations. They are the same one.
  //
  //   ORDER. `?a=1&b=2` and `?b=2&a=1` are the same request to every server and
  //   to `URLSearchParams`; only a string compare thinks otherwise. A beat
  //   should not have to guess the order a component happens to build its href
  //   in, and a component reordering its own parameters is not a story defect.
  //
  // Still EXACT on content: same key set, same decoded value for every key. A
  // declared query is a beat naming WHICH destination it means (ruling 514), so
  // an extra parameter on either side is still a mismatch.
  const wantKeys = [...want.searchParams.keys()].sort();
  const gotKeys = [...got.searchParams.keys()].sort();
  if (wantKeys.length !== gotKeys.length) return false;
  if (wantKeys.some((k, i) => k !== gotKeys[i])) return false;
  // `getAll`, not `get`: a repeated key (`?tag=a&tag=b`) carries every value,
  // and comparing only the first would call two different queries equal.
  return wantKeys.every((k) => {
    const w = want.searchParams.getAll(k);
    const g = got.searchParams.getAll(k);
    return w.length === g.length && w.every((v, i) => v === g[i]);
  });
}

/**
 * What makes two hrefs the SAME PLACE, for the real-nav candidate set.
 *
 * `routeMatches` above decides WHICH hrefs are candidates, and it is blind to
 * the fragment — ruling 546: a fragment-only href is not a different place.
 * Whatever collapses those candidates has to be blind to exactly the same
 * thing, or the two steps disagree and the disagreement becomes a refusal.
 *
 * It did. G1/S10 run 5's beat 6 was refused with "2 links share that pathname
 * and differ only in their query — /projects/gitpulse , /projects/gitpulse#roadmap",
 * because the collapse was `new Set` over the RAW HREF STRINGS. The predicate
 * said one destination, the Set said two strings, and the message named a query
 * where a fragment stood. Beats 6-22 were lost to a page that offered its own
 * route twice.
 *
 * Pathname AND query, because a query IS a different destination (ruling 514,
 * D's S6 beat 7) and naming rather than picking between two of them is exactly
 * what 527 asks for. Fragment and nothing else is discarded.
 */
export function destinationKey(href) {
  const raw = String(href);
  if (raw.startsWith('#') || raw.startsWith('?')) return null;
  try {
    const u = new URL(raw, 'http://forge.invalid');
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/** How often `waitForConsequence` re-reads the page while it waits. */
const CONSEQUENCE_POLL_MS = 100;

/**
 * Decide which observed values this beat is judged against.
 *
 * `docs/forge-ui-dom-and-harness.md` states that nested `data-*` IS the
 * contract — the project card is `a[data-card-type="project"][data-card-id]
 * [data-health]`, not an attribute of `main[data-page]`. Reading only the page
 * root made the runner's scope narrower than the contract it judges, and S1
 * beat 1 called state "absent from the page" that the page plainly rendered.
 *
 * The page ROOT always wins: it is the page's own statement about itself, and
 * a nested element must never overrule it.
 *
 * The keys the root does not carry must be answered TOGETHER BY ONE element.
 * Answering each key independently is the fail-open shape one layer down: with
 * gitweave healthy and mdtoc needing attention, "the gitweave card needs
 * attention" is false, yet per-key matching reports it true. When no element
 * answers them all, the best-covering candidate is returned so the failures
 * name real values instead of a blanket absence.
 *
 * That rule was too narrow for a page that SPLITS one assertion across sibling
 * elements. `/projects/<id>` renders `preflight-status` on ContractReadiness's
 * div and `checklist-row`/`checklist-status` on ProjectContractPanel `<li>`s;
 * no element carries both, so the best-covering candidate decided which key
 * went missing and S1 beat 3 reported a key the page plainly rendered as
 * "absent from the page" (bead forge-8vfn.9, refuted by
 * `_1.0/evidence/m5-b-probe9/` — a probe reading that key ALONE found it).
 *
 * The relaxation is bounded by SOURCE COUNT, never by convenience: a key that
 * exactly ONE element on the page carries names no competing entity, so
 * reading it from its own element cannot pick the wrong one. Every key two or
 * more elements carry — `card-id`, `health`, `checklist-row` — is precisely
 * the ambiguity the together-rule exists for, and stays under it.
 */
export function resolveExpectations(expected, observed) {
  const root = observed.data;
  const missing = Object.keys(expected).filter((k) => !Object.hasOwn(root, k));
  if (missing.length === 0) return root;

  const records = observed.nested ?? [];
  const covers = (r, k) => Object.hasOwn(r, k);

  // Keys exactly one element carries: read each from its own element.
  const solo = {};
  const shared = [];
  for (const k of missing) {
    const carriers = records.filter((r) => covers(r, k));
    if (carriers.length === 1) solo[k] = carriers[0][k];
    else shared.push(k);
  }
  if (shared.length === 0) return { ...solo, ...root };

  // What is left is ambiguous by construction and stays under the together-rule.
  const score = (r) => shared.reduce((n, k) => n + (covers(r, k) ? (answers(r[k], expected[k]) ? 2 : 1) : 0), 0);

  let best = null;
  let bestScore = 0;
  for (const r of records) {
    if (shared.every((k) => covers(r, k) && answers(r[k], expected[k]))) return { ...r, ...solo, ...root };
    const sc = score(r);
    if (sc > bestScore) [best, bestScore] = [r, sc];
  }
  return best === null ? { ...solo, ...root } : { ...best, ...solo, ...root };
}

/** A `data-*` key safe to interpolate into a selector — story files are external input. */
const SAFE_KEY = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * Read the route, the page root's own `data-*` for the keys this beat asked
 * about, and every DESCENDANT that carries at least one of them.
 *
 * Deliberately VALUE-BLIND: it collects by key and never sees what the beat
 * expects. All value judgement lives in `beatVerdict`, which is pure and
 * unit-testable — a reader that knew the answer is how a gate starts agreeing
 * with itself.
 */
export async function readObserved(page, beat, alsoWanted = []) {
  // Always read the error sentinels alongside the beat's own keys — the
  // verdict cannot judge what was never collected.
  //
  // `alsoWanted` is how a CALLER declares the keys IT needs, and it exists
  // because a repeat's `until` is the repeat's own condition (T1 ruling 320),
  // not the beat's. Bead `forge-8vfn.6.11.45`: without it this read collected
  // `expect.data` alone, so `matchesData` asked `Object.hasOwn(seen, …)` for a
  // key nobody had collected and answered `false` HOWEVER THE PAGE READ. S1
  // run 9 measured the cost — the architect reached `awaiting-verdict` and
  // wrote its plan at 23:46:57, the page carried `data-session-phase=
  // "awaiting-verdict"`, and beat 11 spent 2 m 24 s more before reporting that
  // same condition unmet. The union, not the beat's keys: a key asked for
  // twice is collected once, and nothing that used to be read stops being read.
  const keys = [...new Set([...Object.keys(beat.expect.data), ...alsoWanted, ...ERROR_SENTINELS.map(([a]) => a)])];
  const { data, nested, lifecycle, lifecycleError, sessionPhase } = await page.evaluate(
    ({ wanted, safe }) => {
      const root = document.querySelector('main[data-page]') ?? document.body;
      const pick = (el) => {
        const out = {};
        for (const k of wanted) {
          const v = el.getAttribute(`data-${k}`);
          if (v !== null) out[k] = v;
        }
        return out;
      };
      const sel = safe.map((k) => `[data-${k}]`).join(',');
      const kids = sel === '' ? [] : [...root.querySelectorAll(sel)].map(pick);
      // The lifecycle bar is read by its OWN selector rather than folded into
      // `wanted`: collecting it as an ordinary key would put it in `nested`,
      // where `resolveExpectations` could return it inside a matched record and
      // the generated how-to would start listing an attribute no beat asked
      // about. It is diagnosis, not an expectation, so it travels beside them.
      const bar = document.querySelector('div[data-section="session-lifecycle"][data-lifecycle-state]');
      // The runner's OWN last stderr line, which the bar renders beneath a
      // crash (and beneath a terminal failure that carries one). Read for the
      // same reason and by the same rule as the bar above — diagnosis, never an
      // expectation — and it is the whole point of ruling 518's "red it with
      // the page's own message": a stop that paraphrases the page tells the
      // operator less than the page already told them.
      const err = bar === null ? null : bar.querySelector('pre[data-lifecycle-error]');
      // Read by its OWN selector for the same reason the bar is, and never
      // folded into `wanted`: it is diagnosis, not an expectation, so it must
      // not reach `nested` where `resolveExpectations` could return it inside a
      // matched record and the generated how-to would start listing an
      // attribute no beat asked about.
      return {
        data: pick(root),
        nested: kids,
        lifecycle: bar === null ? null : bar.getAttribute('data-lifecycle-state'),
        lifecycleError: err === null ? null : (err.textContent ?? '').trim(),
        sessionPhase: root.getAttribute('data-session-phase'),
      };
    },
    { wanted: keys, safe: keys.filter((k) => SAFE_KEY.test(k)) },
  );
  // Ruling 514: the query is part of the route when a beat declares one, so
  // the observation carries it and the comparison decides what matters.
  const seen = new URL(page.url(), 'http://forge.invalid');
  return {
    route: seen.pathname + seen.search, data, nested,
    lifecycle: lifecycle ?? null, lifecycleError: lifecycleError ?? null, sessionPhase: sessionPhase ?? null,
  };
}

/**
 * Is the product itself saying to stop — that the session CRASHED, that it
 * reached a terminal phase which is not a success, or that it is hung? Returns
 * the REASON, or `null` to keep waiting.
 *
 * ONE predicate for all three so they can never drift apart, and so a caller
 * cannot check one and forget the others — which is exactly how `6.11.39`
 * survived alongside the stall check it sat beside, and then how the crash door
 * (ruling 518) survived alongside both of them. Each door was added after a
 * measured run spent its whole declared bound on a session the product had
 * already given up on.
 */
export function stopReasonFor(observed, sessionScope = null) {
  // Bead `forge-8vfn.6.11.47` (T1 ruling 366). A STOP REASON BELONGS TO A
  // SESSION, and may only end a beat that is ABOUT that session.
  //
  // S1 run 10 beat 9 stands on the project page and died `0s into the agent
  // wait` on a `failed` that belonged to the DEMO session beat 8 had just left
  // behind — read during the commit window a client-side navigation leaves
  // open, when `page.url()` and the DOM still answer for the page being left
  // (§2.28's class). The captured DOM for that beat is `data-page="projects"`
  // with no `data-session-phase` at all. Beat 9 was green one run earlier;
  // nothing about it changed, a NEIGHBOUR's session failing ended it.
  //
  // `sessionScope` is the beat's own resolved route when that route IS a
  // session page, and `null` otherwise — so a beat that names no session
  // cannot be stopped by any session's phase, and a beat that names one is
  // stopped only while standing on it.
  //
  // T1 ruling 514 made `observed.route` carry the QUERY, and this compare was a
  // string equality against the beat's DECLARED route — so the moment the
  // product mounted the session page with its own `?project=` parameter (three
  // live sites do), a beat that named no query stopped being "about" the
  // session it was standing on and all three doors below silently closed. The
  // beat's route is a declaration and `routeMatches` is what reads it: pathname
  // always, query only when the beat asked for one.
  if (sessionScope === null || !routeMatches(observed.route, sessionScope)) return null;
  // Ruling 518 — the crash door FIRST, because it is the only one of the three
  // that carries the product's own message, and a stop that can say what the
  // page said should say it.
  if (observed.lifecycle === LIFECYCLE_CRASHED) {
    const said = observed.lifecycleError ?? null;
    return `the session's own lifecycle read "${LIFECYCLE_CRASHED}"` + (said === null || said === '' ? '' : ` — ${said}`);
  }
  if (observed.sessionPhase !== null && TERMINAL_STOPPED_PHASES.has(observed.sessionPhase)) {
    return `the session's own phase reached the terminal "${observed.sessionPhase}"`;
  }
  if (observed.lifecycle === LIFECYCLE_STALLED) {
    return `the session's own lifecycle read "${LIFECYCLE_STALLED}"`;
  }
  return null;
}

/** The same question, against a live read. */
async function stopNow(page, sessionScope) {
  // Reuses `readObserved` rather than minting a second notion of "the page's
  // state" — an empty `expect.data` collects only the error sentinels, and the
  // bar and the phase ride along beside them. §15.161's rule, one layer down.
  return stopReasonFor(await readObserved(page, { expect: { data: {} } }), sessionScope);
}

/**
 * Wait for a `do` step's handle, or stop as soon as the product says the
 * session is hung — the SECOND place an agent-scale bound is spent, and the one
 * S2 beat 12 and S1 beat 6 actually spend it in. Their field
 * (`[data-field="session-answer"]`) exists only inside a `question-form`
 * affordance, i.e. only once the architect has ASKED, so the bound goes here
 * and never reaches `waitForConsequence`.
 *
 * The shipped wait was a single `locator.waitFor({ timeout })`, which cannot
 * consult anything mid-wait — and it SWALLOWS its timeout, after which
 * `setControl` re-waits on the same handle under the SAME bound. Measured by
 * `AT-6.11.17-8` before this existed: a declared 30 000 ms bound took
 * **60 006 ms**. A ten-minute bound on a field that never appears is a
 * twenty-minute beat.
 *
 * Returns a stall record, or null (found, or the bound expired — the act below
 * then throws its own honest failure, exactly as before).
 */
export async function waitForHandleOrStall(page, handle, timeoutMs, sessionScope, probe = null, stallDoor = null) {
  // `sessionScope` replaces the old `watchLifecycle` boolean rather than
  // joining it (`6.11.47`): the flag always stood for "this beat waits on a
  // session", and saying WHICH session is the whole fix. One value, and the
  // predicate cannot be armed without naming what it is armed about.
  if (sessionScope === null) return waitOffSession(page, handle, timeoutMs, stallDoor);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  for (;;) {
    if ((await page.locator(handle).count()) > 0) return null;
    // Bead `forge-8vfn.6.11.22`: sample the agent's own process WHILE waiting.
    // Diagnosis must never fail a beat that would otherwise pass, so it throws
    // nothing and the beat's outcome does not depend on it.
    if (probe !== null) { try { probe(); } catch { /* a probe is never load-bearing */ } }
    const why = await stopNow(page, sessionScope);
    if (why !== null) return Object.freeze({ afterMs: Date.now() - startedAt, why });
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, CONSEQUENCE_POLL_MS));
  }
}

/**
 * The wait for a beat that is NOT on a session page — T1 ruling 580.
 *
 * This used to be a bare `locator.waitFor`: no poll, no observation, no door.
 * Every protection built this milestone was therefore inert for exactly the
 * beats carrying the biggest bounds — 518's doors and the process probe both
 * need a `/sessions/<kind>/<id>` route, and 531(3) cannot fire on a beat that is
 * standing ON its declared route. G1/S10 run 5's beat 16 sat 14 m 13 s of its
 * fifteen minutes on a page whose run had stopped writing before the beat began.
 *
 * The signal is the RUN'S OWN LOG, not the page. `readObserved` collects only
 * the keys the beat declared, so during a wait it changes exactly once — at
 * success — and a door on it would red every off-session beat at the ceiling
 * whether or not the agent was working. Run 5 measured the two apart: the
 * runner's log sat silent 2 m 31 s while the architect's `events.jsonl` grew
 * 33 822 → 48 409 bytes.
 *
 * THE DECLARED BOUND STAYS A HARD MAXIMUM. Nothing runs longer than `timeoutMs`;
 * the only new exit is earlier. A page that names no run, or a run with no
 * channel, keeps exactly today's behaviour — no channel is "nothing to judge",
 * never "it has been quiet".
 */
async function waitOffSession(page, handle, timeoutMs, stallDoor) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const runId = stallDoor === null ? null : await readRunId(page);
  for (;;) {
    if ((await page.locator(handle).count()) > 0) return null;
    if (runId !== null) {
      const idleMs = stallDoor(runId);
      if (idleMs !== null && idleMs > STALL_CEILING_MS) {
        return Object.freeze({
          afterMs: Date.now() - startedAt,
          why:
            `the run this page names (${runId}) has written nothing for ${Math.round(idleMs / 1000)}s, ` +
            `past the product's own ${Math.round(STALL_CEILING_MS / 1000)}s stall ceiling, and ${handle} ` +
            'never appeared. The declared bound would have been spent waiting on a run that had stopped.',
        });
      }
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, CONSEQUENCE_POLL_MS));
  }
}

/**
 * The run a page says it is showing, from the `data-run` its own contract
 * publishes (`apps/studio/app/artifact/page.tsx:926`). Read through `evaluate`,
 * which every page and every fake already models, and null on anything at all —
 * a page that names no run is answered by the bound alone, exactly as before.
 */
async function readRunId(page) {
  try {
    const got = await page.locator('main[data-page]').first().evaluate((n) => n.getAttribute('data-run'));
    return typeof got === 'string' && got !== '' ? got : null;
  } catch {
    return null;
  }
}

/**
 * Wait for a same-route act's CONSEQUENCE — EVERY data-* state this beat
 * declared — to settle before the beat is judged. `driveBeat`'s other waits
 * are all keyed to a URL change, so a `do` block that acts on the route it
 * already stands on gets none of them; a press there can still start real
 * work (an agent dispatch, a save) whose answer arrives a moment later, and
 * reading immediately reports on work that is provably still in flight. Bead
 * `forge-8vfn.2.25`.
 *
 * It waits for ALL of them. Waiting on the FIRST declared key alone made the
 * ORDER of keys in an `expect.data` object silently decide what the runner
 * waited for — a rule no story author could learn from §3.1, only by reading
 * this function. Measured on S1 beat 7 (H6 sitting, 2026-09-05): the beat
 * declares `stage-detail-stage` first, the press before it satisfies that key
 * instantly, and the page was read while `launch-demo-builder`'s POST was
 * still in flight — `data-action: expected "view-demo-session", got
 * "back-to-project"` on a handoff that run 1 had proved works. Swapping the
 * beat's keys would have turned it green and pinned the trap into a gate;
 * bead `forge-8vfn.6.11.7`, ruling 196. §3.1 states the semantics now.
 *
 * Asks the question `beatVerdict` asks, through `resolveExpectations` — the
 * SAME reader (`readObserved`) AND the same resolution — so what satisfies
 * this wait and what the verdict judges can never disagree. A per-key search
 * of `[data, ...nested]` was a second notion of "the page's data": it could
 * be satisfied by a record the verdict would never pick (§15.161).
 *
 * Bounded and never throws: on timeout it simply returns, and `beatVerdict`
 * below reports the honest mismatch (which attribute, expected vs. got) on
 * its own terms — the same catch-and-let-the-verdict-explain shape every
 * other wait in this function already uses.
 */
export async function waitForConsequence(page, beat, timeoutMs, sessionScope, probe = null) {
  const wanted = Object.entries(beat.expect.data);
  if (wanted.length === 0) return null;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  for (;;) {
    const observed = await readObserved(page, beat);
    const seen = resolveExpectations(beat.expect.data, observed);
    if (wanted.every(([attr, want]) => Object.hasOwn(seen, attr) && answers(seen[attr], want))) return null;
    // Ruling 241 step 2. Only for a beat that DECLARED an agent wait: those are
    // the beats that stand on a session, and scoping it there means no other
    // beat gains a new way to fail. The product is believed rather than
    // second-guessed — `stalled` is server-derived, and re-deriving it here
    // from phases or timestamps is the mistake the bar's own header forbids.
    if (probe !== null) { try { probe(); } catch { /* a probe is never load-bearing */ } }
    const why = stopReasonFor(observed, sessionScope);
    if (why !== null) {
      return Object.freeze({ afterMs: Date.now() - startedAt, why });
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, CONSEQUENCE_POLL_MS));
  }
}
