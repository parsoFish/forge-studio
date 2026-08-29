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

  return Object.freeze({
    act: beat.act,
    say: beat.say,
    status: failures.length === 0 ? 'green' : 'red',
    failures: Object.freeze(failures),
  });
}
