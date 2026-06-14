/**
 * journey-assertions — shared DOM-as-metrics regression layer.
 *
 * Extracted from e2e-journey.mjs so the watchable demo (e2e-journey.mjs) and the
 * real-capability harness (verify-cycle.mjs) assert the SAME way and stop
 * entangling: every check is SOFT (recorded, never throws), the video/run always
 * finishes, and a non-zero process exit at the end flags any invariant that
 * regressed.
 *
 * `createAssertions()` returns an asserter bound to its own `failures` array so a
 * caller owns its pass/fail tally. Pass a `frame` callback (the harness's
 * screenshot helper) to enable the drawer-open helper's held-open capture; omit
 * it and the helper still asserts, just without a frame.
 *
 * The phase-cost / hex-drawer helpers target the Studio flow monitor
 * ([data-mon-node]) — the cycle-monitor surface since /dashboard was deleted
 * (M7-1/M7-2, ADR-031).
 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Per-phase cost is asserted on the Studio monitor hexes (M7-1/M7-2, ADR-031):
 *  each phase HexNode carries [data-mon-node][data-phase-cost-usd]. */
export const PHASE_COST_SEL = '[data-mon-node][data-phase-cost-usd]';

/**
 * @param {object}   [opts]
 * @param {function} [opts.frame]    async (page, name, caption) — capture helper for held-open frames.
 * @param {number}   [opts.dwellMs]  how long to hold an opened drawer before the frame (default 4200).
 * @param {number}   [opts.actMs]    short settle after a click (default 1500).
 */
export function createAssertions({ frame, dwellMs = 4200, actMs = 1500 } = {}) {
  const failures = [];

  function check(cond, msg) {
    if (cond) { console.log(`  ✓ ${msg}`); }
    else { failures.push(msg); console.error(`  ✗ ${msg}`); }
  }

  async function countAtLeast(page, selector, n, msg) {
    try {
      await page.waitForFunction(
        ({ s, k }) => document.querySelectorAll(s).length >= k,
        { s: selector, k: n }, { timeout: 15000 },
      );
    } catch { /* fall through and report actual count */ }
    const got = await page.evaluate((s) => document.querySelectorAll(s).length, selector);
    check(got >= n, `${msg} (found ${got}, want ≥${n})`);
  }

  async function maxPhaseCost(page) {
    return page.evaluate((sel) => Math.max(0, ...[...document.querySelectorAll(sel)]
      .map((e) => parseFloat(e.getAttribute('data-phase-cost-usd') ?? '0') || 0)), PHASE_COST_SEL);
  }

  async function expectPhaseCost(page, msg) {
    try {
      await page.waitForFunction(
        (sel) => [...document.querySelectorAll(sel)].some((e) =>
          (parseFloat(e.getAttribute('data-phase-cost-usd') ?? '0') || 0) > 0),
        PHASE_COST_SEL, { timeout: 15000 },
      );
    } catch { /* report real value below */ }
    check(await maxPhaseCost(page) > 0, msg);
  }

  /** Click the first Studio-monitor hex matching hexSelector and assert the
   *  PhaseDrawer (#phase-drawer) opens with the expected data-hex-kind.
   *  Guards the pointer-events regression + the M7-1 WI-drawer requirement. */
  async function expectHexOpensDrawer(page, hexSelector, kind, label) {
    const el = page.locator(hexSelector).first();
    if ((await el.count()) === 0) { check(false, `${label}: no ${hexSelector} present to click`); return; }
    await el.hover().catch(() => {});
    await sleep(actMs);
    await el.click();
    let opened = false;
    try {
      await page.waitForFunction(
        (k) => {
          const d = document.querySelector('#phase-drawer');
          return d?.getAttribute('data-drawer-open') === 'true' && d?.getAttribute('data-hex-kind') === k;
        },
        kind, { timeout: 5000 },
      );
      opened = true;
      check(true, `${label}: clicking a ${kind} hex opens the drawer (data-hex-kind="${kind}")`);
    } catch {
      const got = await page.evaluate(() => {
        const d = document.querySelector('#phase-drawer');
        return `open=${d?.getAttribute('data-drawer-open') ?? '(absent)'} kind=${d?.getAttribute('data-hex-kind') ?? '(absent)'}`;
      });
      check(false, `${label}: clicking a ${kind} hex opens the drawer (got ${got})`);
    }
    if (opened && frame) {
      await sleep(dwellMs);
      await frame(page, `hex-detail-${kind}`, `Phase drawer — ${kind} hex opens the detail drawer (held open)`);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForFunction(
      () => document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') === 'false',
      null, { timeout: 3000 },
    ).catch(() => {});
    await sleep(actMs);
  }

  return { failures, check, countAtLeast, maxPhaseCost, expectPhaseCost, expectHexOpensDrawer, PHASE_COST_SEL };
}
