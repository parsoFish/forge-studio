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

/**
 * Judge one beat against what was observed on the page.
 *
 * @param {{act: string, say: string, expect: {route: string, data: Record<string,string>}}} beat
 * @param {{route: string, data: Record<string,string>}} observed
 * @returns {Readonly<{act: string, say: string, status: 'green'|'red', failures: readonly string[]}>}
 */
export function beatVerdict(beat, observed) {
  const failures = [];

  if (observed.route !== beat.expect.route) {
    failures.push(`route: expected "${beat.expect.route}", got "${observed.route}"`);
  }

  // Iterate the EXPECTED keys. Never the observed ones — an attribute the UI
  // never rendered must be a failure, not an absence nobody looked for.
  for (const [attr, want] of Object.entries(beat.expect.data)) {
    if (!Object.hasOwn(observed.data, attr)) {
      failures.push(`data-${attr}: expected "${want}", absent from the page`);
      continue;
    }
    const got = observed.data[attr];
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
  });
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
export async function driveBeat(page, beat, index, baseUrl) {
  if (index === 0) {
    await page.goto(baseUrl + beat.expect.route, { waitUntil: 'domcontentloaded' });
  } else {
    const target = beat.expect.route;
    const nav = page.locator(`[data-nav][href="${target}"]`).first();
    const link = page.locator(`a[href="${target}"]`).first();
    const clickable = (await nav.count()) > 0 ? nav : (await link.count()) > 0 ? link : null;

    if (clickable === null) {
      const observed = await readObserved(page, beat);
      return Object.freeze({
        ...beatVerdict(beat, observed),
        status: 'red',
        failures: Object.freeze([
          `no real-nav path to "${target}" from "${observed.route}": no [data-nav] pillar and no ` +
            'link points at it. The runner does not fall back to page.goto — an unreachable route ' +
            'must not pass as a beat.',
        ]),
        data: observed.data,
      });
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
      return Object.freeze({
        ...beatVerdict(beat, observed),
        status: 'red',
        failures: Object.freeze([
          `could not click through to "${target}" from "${observed.route}": ${clickError}. ` +
            'The control exists but was not actionable — obscured, disabled or detached.',
        ]),
        data: observed.data,
      });
    }
  }

  await page
    .waitForSelector('main[data-page][data-page-ready="true"]', { timeout: READY_TIMEOUT_MS })
    .catch(() => {
      /* not ready — the verdict below reports that honestly rather than throwing */
    });

  const observed = await readObserved(page, beat);
  return Object.freeze({ ...beatVerdict(beat, observed), data: observed.data });
}

/** Read the route and only the `data-*` keys this beat asked about. */
async function readObserved(page, beat) {
  // Always read the error sentinels alongside the beat's own keys — the
  // verdict cannot judge what was never collected.
  const keys = [...new Set([...Object.keys(beat.expect.data), ...ERROR_SENTINELS.map(([a]) => a)])];
  const data = await page.evaluate((wanted) => {
    const root = document.querySelector('main[data-page]') ?? document.body;
    const out = {};
    for (const k of wanted) {
      const v = root.getAttribute(`data-${k}`);
      if (v !== null) out[k] = v;
    }
    return out;
  }, keys);
  return { route: new URL(page.url()).pathname, data };
}
