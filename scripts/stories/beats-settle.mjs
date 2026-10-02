/**
 * beats-settle.mjs — when has a `wait: { for: 'settle', key, while }` SETTLED?
 *
 * T1 ruling 621(ii), bought by A's S1 beat 3. A plain `for: 'agent'` wait
 * already carries a beat past its transient (green in 1208 ms on the
 * fixture); what it does NOT do is stop — a wrong value is waited out exactly
 * as patiently as a transient one, to the full declared bound, and the verdict
 * then reports a timeout where it could have reported the mismatch. So
 * `settle` adds SHARPNESS, not patience: the story names the one value it is
 * willing to sit through, and the moment the key holds anything else the wait
 * stops and lets the verdict say what it actually saw.
 *
 * Split out of `beats-page.mjs` at the 800-line cap (T1 ruling 492: SPLIT,
 * NEVER BASELINE) by row 196 (bead `forge-8vfn.8.5.34`, T1 1973gf), which is
 * this file's one rule beyond 621(ii):
 *
 * A PRESS'S CONSEQUENCE HAS NOT SETTLED BEFORE IT HAS VISIBLY BEGUN. M7-E run
 * 6, S6 beat 14 (`do: [open-kb-tab-health, drain-to-green]`, `while:
 * 'running'`) reded 0.2 s into a 180 s bound — `expected "green", got
 * "running"` / `gave up at the settle wait` — on a drain that went green 1.1 s
 * after the press. No bound fired: the wait's first poll read the panel's
 * PRE-dispatch value (`idle`/`attaching`, `deriveDrainDisplayState`,
 * `apps/studio/lib/kb-drain-view.ts`), which is "not `running`", so 621(ii)
 * called the drain settled before it had started, and the verdict's fresh read
 * a moment later saw `running` (`settle-drain-run6-capture.test.ts`, the real
 * capture). So for a beat that PRESSED, a value read before the declared
 * transient has been seen even once is the page before the press took effect,
 * and is waited through; the sharpness applies from the first sighting of
 * `while` on, exactly as before. A beat that pressed nothing keeps 621(ii)
 * unchanged — what its page shows is already the consequence it waits on
 * (`beats-settle.test.ts`' CONTROL). The cost is bounded and named: a press
 * whose consequence jumps straight to a wrong value without ever showing the
 * transient is judged at the declared bound rather than at once — late, never
 * wrong — and the green check ahead of this still passes a right value the
 * poll it appears.
 */

/**
 * Build the per-wait settle gate, or null when the beat declared no settle.
 *
 * @param {{key: string, while: string}|null} settle  the beat's `wait`, when `for: 'settle'`
 * @param {boolean} pressed  whether the beat's own `do` acted before this wait
 * @returns {{settled: (got: string|undefined) => boolean}|null}
 *   `settled(got)` folds one reading of `settle.key` in and answers whether the
 *   wait should stop and let the verdict judge the page.
 */
export function makeSettleGate(settle, pressed) {
  if (settle === null || settle === undefined) return null;
  let sawTransient = !pressed;
  return {
    settled(got) {
      if (got === undefined) return false;
      if (got === settle.while) {
        sawTransient = true;
        return false;
      }
      return sawTransient;
    },
  };
}
