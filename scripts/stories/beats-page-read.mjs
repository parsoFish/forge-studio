/**
 * beats-page-read.mjs — what the page SAYS, and how a beat's expectations are
 * matched against it. Split out of `beats-page.mjs` (forge-8vfn.7.6.121).
 *
 * WHY THE SPLIT, and why THIS half moved. `beats-page.mjs` reached 790 of the
 * 800-line cap with two lanes editing it, so a merge neither branch could see
 * would have put the next comment over the cap on main — the §15.412 shape.
 *
 * The seam is where the file stops READING and starts WAITING. Everything here
 * is pure or read-only: predicates (`answers`, `routeMatches`), the sentinels
 * and lifecycle tokens, the expectation resolver, and `readObserved`, which
 * collects what the page carries. Nothing here polls, sleeps, or decides to
 * stop.
 *
 * THE DIRECTION OF THE DEPENDENCY IS THE POINT. This module imports NOTHING
 * from `beats-page.mjs`; `beats-page.mjs` imports from it and re-exports these
 * names, so every existing importer and every door keeps working unmodified.
 * Moving the WATCH half instead would have required `beats-page.mjs` to
 * re-export from a module that imports it back — a real cycle, which the bead's
 * acceptance forbids. Measured before choosing: with comments stripped, the
 * pure half references NONE of the watch half's definitions (the only apparent
 * hit was a doc comment naming `waitForConsequence`), and the four symbols
 * `beats-page.mjs` imports from `beats-agent-proc.mjs` and `beats-progress.mjs`
 * are used ONLY by the watch half.
 */
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
// EXPORTED ONLY BECAUSE THE SPLIT CROSSES IT (forge-8vfn.7.6.121). This was
// module-private and stays out of `beats-page.mjs`'s re-export list, so the
// PUBLIC surface is unchanged: the watch half imports it, nobody else can.
export const CONSEQUENCE_POLL_MS = 100;

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

/** A `data-*` key safe to interpolate into a selector — story files are external input.
 *  EXPORTED so `story-file.mjs` can refuse at the boundary what this would silently
 *  drop from the selector, and so a door can prove the two patterns identical
 *  (the `STALL_CEILING_MS` arrangement, T1 ruling 580). */
export const SAFE_KEY = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * Read the route, the page root's own `data-*` for the keys this beat asked
 * about, and every DESCENDANT that carries at least one of them.
 *
 * Deliberately VALUE-BLIND: it collects by key and never sees what the beat
 * expects. All value judgement lives in `beatVerdict`, which is pure and
 * unit-testable — a reader that knew the answer is how a gate starts agreeing
 * with itself.
 */
/**
 * Drop the candidate elements a beat's `expect.among` rule excludes
 * (`forge-8vfn.26`).
 *
 * WHY HERE. `resolveExpectations` is deliberately VALUE-BLIND — "a reader that
 * knew the answer is how a gate starts agreeing with itself" — so the choice of
 * WHICH elements are candidates belongs to the collector, not the judge. The
 * rule is resolved to a set at LOAD by `story-file.mjs`, so this function asks
 * nothing of git and stays as pure as the evaluate it filters.
 *
 * WHAT IT IS FOR. `proof.story.mjs` beat 1 binds `<someProjectId>` from a
 * project card, and "the first card" is a property of the running checkout's
 * `projects/` directory — `gitpulse` here, `mdtoc` in CI, `gitweave` in the
 * committed sample. Restricting the candidates to TRACKED projects makes the
 * answer identical in every checkout without the story naming an id, so the
 * binding still proves what it exists to prove.
 *
 * A record missing the key entirely is KEPT: the restriction is about which
 * element may answer that key, not about which elements exist, and dropping
 * unrelated records would silently narrow every other key the beat asks about.
 */
export function restrictNested(records, beat) {
  const ids = beat?.expect?.amongIds;
  if (ids === undefined) return records;
  return records.filter((r) =>
    Object.entries(ids).every(([key, allowed]) => !Object.hasOwn(r, key) || allowed.includes(r[key])));
}

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
    route: seen.pathname + seen.search, data, nested: restrictNested(nested, beat),
    lifecycle: lifecycle ?? null, lifecycleError: lifecycleError ?? null, sessionPhase: sessionPhase ?? null,
  };
}
