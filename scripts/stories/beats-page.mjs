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
export async function readObserved(page, beat) {
  // Always read the error sentinels alongside the beat's own keys — the
  // verdict cannot judge what was never collected.
  const keys = [...new Set([...Object.keys(beat.expect.data), ...ERROR_SENTINELS.map(([a]) => a)])];
  const { data, nested, lifecycle } = await page.evaluate(
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
      return { data: pick(root), nested: kids, lifecycle: bar === null ? null : bar.getAttribute('data-lifecycle-state') };
    },
    { wanted: keys, safe: keys.filter((k) => SAFE_KEY.test(k)) },
  );
  return { route: new URL(page.url()).pathname, data, nested, lifecycle: lifecycle ?? null };
}

/** Is the product itself saying this session is hung? */
async function stalledNow(page) {
  // Reuses `readObserved` rather than minting a second notion of "the page's
  // lifecycle" — an empty `expect.data` collects only the error sentinels, and
  // the bar rides along beside them. §15.161's rule, one layer down.
  const { lifecycle } = await readObserved(page, { expect: { data: {} } });
  return lifecycle === LIFECYCLE_STALLED;
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
export async function waitForHandleOrStall(page, handle, timeoutMs, watchLifecycle) {
  if (!watchLifecycle) {
    await page.locator(handle).first().waitFor({ timeout: timeoutMs }).catch(() => {});
    return null;
  }
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  for (;;) {
    if ((await page.locator(handle).count()) > 0) return null;
    if (await stalledNow(page)) return Object.freeze({ afterMs: Date.now() - startedAt });
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, CONSEQUENCE_POLL_MS));
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
export async function waitForConsequence(page, beat, timeoutMs, watchLifecycle) {
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
    if (watchLifecycle && observed.lifecycle === LIFECYCLE_STALLED) {
      return Object.freeze({ afterMs: Date.now() - startedAt });
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, CONSEQUENCE_POLL_MS));
  }
}
