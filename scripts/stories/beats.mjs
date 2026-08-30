/**
 * beats.mjs — judging one story beat.
 *
 * `beatVerdict` is PURE and lives apart from any browser I/O, so every rule
 * about what makes a beat red is unit-testable without booting Studio. That
 * separation is the point: the old harness could only be trusted by running
 * it.
 *
 * The rule the whole module exists to enforce: **a beat is judged against the
 * expectations it DECLARED, never against the state that happened to be
 * there.** Iterating observed state instead of expected state is the
 * fail-open shape — it reports green for a page that rendered nothing.
 */

/** A `<name>` expectation: bind whatever the page rendered, for a later beat's route. */
const PLACEHOLDER = /^<([A-Za-z][A-Za-z0-9_]*)>$/;

/**
 * Judge one beat against what was observed on the page.
 *
 * @param {{act: string, say: string, expect: {route: string, data: Record<string,string>}}} beat
 * @param {{route: string, data: Record<string,string>, nested?: readonly Record<string,string>[]}} observed
 * @returns {Readonly<{act: string, say: string, status: 'green'|'red', failures: readonly string[], bindings: Readonly<Record<string,string>>}>}
 */
export function beatVerdict(beat, observed) {
  const failures = [];
  const bindings = {};

  if (observed.route !== beat.expect.route) {
    failures.push(`route: expected "${beat.expect.route}", got "${observed.route}"`);
  }

  const seen = resolveExpectations(beat.expect.data, observed);

  // Iterate the EXPECTED keys. Never the observed ones — an attribute the UI
  // never rendered must be a failure, not an absence nobody looked for.
  for (const [attr, want] of Object.entries(beat.expect.data)) {
    if (!Object.hasOwn(seen, attr)) {
      failures.push(`data-${attr}: expected "${want}", absent from the page`);
      continue;
    }
    const got = seen[attr];
    const placeholder = PLACEHOLDER.exec(want);
    if (placeholder !== null) {
      // A value the product mints at runtime. Any value binds; the empty
      // string is a product that minted nothing, and binding it would put an
      // empty segment in a later beat's route.
      if (got === '') failures.push(`data-${attr}: expected a value to bind as ${want}, got ""`);
      else bindings[placeholder[1]] = got;
      continue;
    }
    if (got !== want) {
      failures.push(`data-${attr}: expected "${want}", got "${got}"`);
    }
  }

  // SETTLED IS NOT SUCCEEDED. The product's convention is that a route whose
  // fetch THREW still renders its own `data-page` and `data-page-ready="true"`
  // — it HAS settled, into an honest failure — and reports it via
  // `data-fetch-status="error"` / `data-load-error="true"`
  // (`components/PageLoadError.tsx`; `ProjectsIndex.tsx`:
  // `error ? 'error' : ready ? 'ok' : 'loading'`).
  //
  // So a beat asserting only {page, page-ready} passes against a visibly
  // broken page. The runner judges these sentinels on EVERY beat rather than
  // trusting each story author to remember them — a rule that depends on nine
  // authors remembering is how this class survives. A story that deliberately
  // asserts an error surface simply declares it, and is honoured.
  for (const [attr, bad] of ERROR_SENTINELS) {
    if (observed.data[attr] !== bad) continue;
    if (beat.expect.data[attr] === bad) continue; // the story asked for it
    failures.push(
      `data-${attr} is "${bad}": the page settled into an error, so this beat cannot pass. ` +
        'Assert it deliberately if the story is about the failure surface.',
    );
  }

  return Object.freeze({
    act: beat.act,
    say: beat.say,
    status: failures.length === 0 ? 'green' : 'red',
    failures: Object.freeze(failures),
    bindings: Object.freeze(bindings),
    // What the beat was JUDGED against, root and nested alike. The how-to
    // fragment renders this as its "what you should see" list, so reporting
    // only the page root would let a beat assert `data-card-id="gitweave"`
    // while the generated documentation never mentions it — the tests, demos
    // and docs drifting apart inside the one script §3 built to stop that.
    data: Object.freeze({ ...observed.data, ...seen }),
  });
}

/**
 * The verdict for a beat that never reached its page — a `do` step that could
 * not act, no real-nav path, a control that was not actionable. All three
 * leave the browser on the PREVIOUS page, which is read so the failure can
 * name where it was stuck.
 *
 * It exports NO bindings. A `<name>` harvested from the wrong page would hand
 * a later beat a route segment that page happened to supply, and that beat
 * could go GREEN on it — the fail-open shape, reached through the new verb.
 */
export function stuckVerdict(beat, observed, failure) {
  return Object.freeze({
    ...beatVerdict(beat, observed),
    status: 'red',
    failures: Object.freeze([failure]),
    bindings: Object.freeze({}),
    data: observed.data,
  });
}

/** Does an observed value answer one expectation? A `<name>` takes any non-empty value. */
const answers = (got, want) => (PLACEHOLDER.test(want) ? got !== '' : got === want);

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
 */
function resolveExpectations(expected, observed) {
  const root = observed.data;
  const missing = Object.keys(expected).filter((k) => !Object.hasOwn(root, k));
  if (missing.length === 0) return root;

  const records = observed.nested ?? [];
  const covers = (r, k) => Object.hasOwn(r, k);
  const score = (r) => missing.reduce((n, k) => n + (covers(r, k) ? (answers(r[k], expected[k]) ? 2 : 1) : 0), 0);

  let best = null;
  let bestScore = 0;
  for (const r of records) {
    if (missing.every((k) => covers(r, k) && answers(r[k], expected[k]))) return { ...r, ...root };
    const sc = score(r);
    if (sc > bestScore) [best, bestScore] = [r, sc];
  }
  return best === null ? root : { ...best, ...root };
}

/**
 * Substitute the `<name>` segments of a beat's route from what earlier beats
 * bound. The pinned S1 already writes this convention: beat 4 declares
 * `'onboard-session-id': '<sessionId>'`, beats 5-6 route
 * `/sessions/onboarding/<sessionId>`.
 *
 * An unbound placeholder is NOT navigated to as a literal — that would 404 and
 * blame the product for a story-authoring gap.
 */
export function resolveBeatRoute(beat, bindings) {
  let unbound = null;
  const route = beat.expect.route.replace(/<([A-Za-z][A-Za-z0-9_]*)>/g, (whole, name) => {
    if (Object.hasOwn(bindings, name)) return bindings[name];
    unbound ??= name;
    return whole;
  });
  return { route, unbound };
}

/** Attributes whose value means "this page is not working", checked on every beat. */
const ERROR_SENTINELS = [
  ['fetch-status', 'error'],
  ['load-error', 'true'],
];

/** How long to wait for a page to declare itself ready before judging it. */
const READY_TIMEOUT_MS = 15_000;

/**
 * Reach the beat's route by REAL NAVIGATION and read what the page shows.
 *
 * `page.goto` is used for the FIRST beat only — the operator opening Studio.
 * Every later beat must get there the way an operator does, by clicking a real
 * control: a story that teleports between routes proves each route renders but
 * never proves you can get from one to the next.
 *
 * The story contract (§3.1) gives prose in `act` and a route in
 * `expect.route`, and no selector. So the runner resolves the click from the
 * route itself — the nav pillar pointing at it, else any link to it. When
 * neither exists the beat is RED saying so; it never falls back to
 * `page.goto`, which would let an unreachable route pass.
 */
export async function driveBeat(page, rawBeat, index, baseUrl, bindings = {}) {
  const { route: target, unbound } = resolveBeatRoute(rawBeat, bindings);
  if (unbound !== null) {
    return Object.freeze({
      act: rawBeat.act,
      say: rawBeat.say,
      status: 'red',
      failures: Object.freeze([
        `route "${rawBeat.expect.route}" needs <${unbound}>, which no earlier beat bound. ` +
          'A beat binds a segment by expecting `<name>` for a data-* key the product mints.',
      ]),
      bindings: Object.freeze({}),
      data: {},
    });
  }
  const beat = Object.freeze({ ...rawBeat, expect: Object.freeze({ ...rawBeat.expect, route: target }) });
  const steps = beat.do ?? [];

  if (index === 0) {
    await page.goto(baseUrl + target, { waitUntil: 'domcontentloaded' });
  }

  // What the operator DOES, on the page they are standing on — the previous
  // beat's page — before this beat's state is judged. All nine operator flows
  // are form-driven, and until this existed the runner could only follow
  // links, so a story stopped dead at the first form.
  const stepError = await performSteps(page, steps);
  if (stepError !== null) {
    return stuckVerdict(beat, await readObserved(page, beat), stepError);
  }

  // A press that saves asynchronously mints its route, or the link to it, a
  // moment later. Wait for whichever arrives — but only for a beat that acted,
  // so a beat that simply cannot reach its route still fails fast.
  if (steps.length > 0 && new URL(page.url()).pathname !== target) {
    await Promise.any([
      page.waitForURL((u) => new URL(u).pathname === target, { timeout: READY_TIMEOUT_MS }),
      page
        .locator(`[data-nav][href="${target}"], a[href="${target}"]`)
        .first()
        .waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS }),
    ]).catch(() => {
      /* neither arrived — the nav resolution below reports it honestly */
    });
  }

  // Already there: the operator acted on this page and stayed on it, or the
  // press navigated. There is nothing to navigate TO. Real-nav-only is about
  // reaching a DIFFERENT route; a form-driven flow dwells on one route across
  // several operator actions, and the shipped runner called that unreachable.
  if (new URL(page.url()).pathname !== target) {
    const nav = page.locator(`[data-nav][href="${target}"]`).first();
    const link = page.locator(`a[href="${target}"]`).first();
    const clickable = (await nav.count()) > 0 ? nav : (await link.count()) > 0 ? link : null;

    if (clickable === null) {
      const observed = await readObserved(page, beat);
      return stuckVerdict(
        beat,
        observed,
        `no real-nav path to "${target}" from "${observed.route}": no [data-nav] pillar and no ` +
          'link points at it. The runner does not fall back to page.goto — an unreachable route ' +
          'must not pass as a beat.',
      );
    }
    // Wait for the NEW route, not merely for "a ready page". The page we
    // clicked FROM is already `data-page-ready="true"`, so waiting on that
    // selector alone returns instantly against the old DOM. Measured on the
    // smoke story's first real run: beat 2 reported route "/" and
    // `data-page: "home"` because the assertion won the race with the
    // navigation — a false RED, and in the mirror case it would be a false
    // GREEN for any beat whose expectations the previous page happens to
    // satisfy.
    // The click itself is guarded. An obscured or non-actionable control (a
    // leftover modal, toast or backdrop from the previous beat) makes
    // playwright throw, and an unguarded throw here propagates past the beat
    // loop and aborts the WHOLE run — dropping every later story's doc and
    // gallery row, with a raw stack trace instead of an attributable verdict.
    // Found by adversarial review, reproduced with a full-viewport overlay
    // over a real [data-nav] link.
    let clickError = null;
    await Promise.all([
      page
        .waitForURL((u) => new URL(u).pathname === target, { timeout: READY_TIMEOUT_MS })
        .catch(() => {
          /* did not navigate — the verdict below reports that honestly */
        }),
      clickable.click().catch((e) => {
        clickError = e?.message ?? String(e);
      }),
    ]);

    if (clickError !== null) {
      const observed = await readObserved(page, beat);
      return stuckVerdict(
        beat,
        observed,
        `could not click through to "${target}" from "${observed.route}": ${clickError}. ` +
          'The control exists but was not actionable — obscured, disabled or detached.',
      );
    }
  }

  await page
    .waitForSelector('main[data-page][data-page-ready="true"]', { timeout: READY_TIMEOUT_MS })
    .catch(() => {
      /* not ready — the verdict below reports that honestly rather than throwing */
    });

  return beatVerdict(beat, await readObserved(page, beat));
}

/**
 * Perform a beat's `do` steps, in order, on the page as it stands.
 *
 * A step names a `data-field` or `data-action` VALUE — forge-ui's own declared
 * contract, the same vocabulary `expect.data` reads — never a CSS selector: a
 * story that names markup is coupled to markup, which §3.1 avoids on purpose.
 *
 * Returns the failure text, or null. Every playwright throw is caught for the
 * reason the click below is: an unguarded throw aborts the WHOLE run and drops
 * every later story's doc and gallery row.
 */
async function performSteps(page, steps) {
  for (const step of steps) {
    const fills = Object.hasOwn(step, 'fill');
    const key = fills ? step.fill : step.press;
    const handle = `[data-${fills ? 'field' : 'action'}="${key}"]`;
    try {
      const el = page.locator(handle).first();
      if (!fills) await el.click();
      else if ((await el.evaluate((n) => n.tagName)) === 'SELECT') await el.selectOption(step.with);
      else await el.fill(step.with);
    } catch (e) {
      return (
        `could not ${fills ? `fill ${handle} with "${step.with}"` : `press ${handle}`}: ` +
        `${e?.message ?? e}. The control is absent, disabled, obscured or not yet rendered.`
      );
    }
  }
  return null;
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
async function readObserved(page, beat) {
  // Always read the error sentinels alongside the beat's own keys — the
  // verdict cannot judge what was never collected.
  const keys = [...new Set([...Object.keys(beat.expect.data), ...ERROR_SENTINELS.map(([a]) => a)])];
  const { data, nested } = await page.evaluate(
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
      return { data: pick(root), nested: kids };
    },
    { wanted: keys, safe: keys.filter((k) => SAFE_KEY.test(k)) },
  );
  return { route: new URL(page.url()).pathname, data, nested };
}
