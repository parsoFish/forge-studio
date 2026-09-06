/**
 * What a control's state IS, reported while a beat waits on it — bead
 * `forge-8vfn.6.11.30`, T1 ruling 330.
 *
 * THE DEFECT THIS CLOSES IS TIMING, NOT MISSING INFORMATION. `beats.mjs`'s
 * `describeControl` already computed "present but still DISABLED" — and printed
 * it only once the beat's declared bound had expired. S2 run 4, S1 run 6 and S1
 * run 7 each spent 461-515 s waiting on a control that was disabled the whole
 * time, then said so. Three funded runs paid about eight minutes each to learn
 * something the first second could have told them.
 *
 * SO THIS REPORTS AT THE FIRST POLL, AND AGAIN ONLY WHEN THE STATE CHANGES.
 * Both halves are load-bearing:
 *   · first poll — a report after the bound is one nobody can act on;
 *   · on change only — a line per poll would bury the change in noise, and a
 *     beat under a ten-minute bound would emit hundreds.
 * A control disabled at t=0 and enabled at t=3s is a product working normally;
 * one disabled from t=0 to the bound is a product that never moved. A single
 * opening reading cannot tell those apart, and that is exactly the distinction
 * the last three runs needed.
 *
 * It is NOT a failure signal. The act may still succeed, and a beat that reds
 * anyway keeps its own failure text unchanged.
 */

/**
 * One reading of the control behind `handle`, as a short human sentence.
 *
 * Never throws: this runs beside a live act, and an inspector that could take
 * the run down would be worse than no inspector. An unreadable control says so.
 */
export async function controlState(page, handle) {
  try {
    if ((await page.locator(handle).count()) === 0) return `${handle}: no element carries that handle yet`;
    return await page.locator(handle).first().evaluate((n) => {
      const disabled = n.disabled === true || n.getAttribute('disabled') !== null;
      const readOnly = n.readOnly === true || n.getAttribute('readonly') !== null;
      const busy = n.getAttribute('aria-busy') === 'true';
      const title = (n.getAttribute('title') ?? '').trim();
      const why = title === '' ? '' : ` (title: "${title}")`;
      if (disabled) return `present but DISABLED${why}`;
      if (readOnly) return `present but READ-ONLY${why}`;
      if (busy) return `present but aria-busy${why}`;
      return 'present and enabled';
    });
  } catch {
    // Detached mid-read is itself a state worth naming: a re-render replacing
    // the element is one of the shapes a fill can silently lose to.
    return `${handle}: could not be inspected (detached or re-rendering)`;
  }
}

/**
 * Watch that control while an act is in flight. Emits once immediately, then
 * only when the reading changes. Returns a `stop()` that is safe to call more
 * than once — it runs in a `finally`, where double-calling is ordinary.
 *
 * @param {object} page
 * @param {string} handle
 * @param {(line: string) => void} emit
 * @param {number} intervalMs
 * @returns {() => void}
 */
export function watchControlState(page, handle, emit, intervalMs = 1000) {
  let last = null;
  let stopped = false;

  const sample = async () => {
    if (stopped) return;
    const now = await controlState(page, handle);
    if (stopped) return;
    if (now !== last) {
      last = now;
      emit(`[stories] while waiting on ${handle}: ${now}`);
    }
  };

  void sample();
  const timer = setInterval(() => void sample(), intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
}
