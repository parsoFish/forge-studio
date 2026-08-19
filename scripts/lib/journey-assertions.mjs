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
 * it and the helper still asserts, just without a frame. Pass an `onCheck`
 * callback to additionally observe every check as it fires (e.g. to wire checks
 * into `journey-runtime.mjs`'s beat tracker) — optional and purely additive;
 * existing callers that omit it behave identically.
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
 * W7-A1 / W7-FIX-A1 (A1-11): the honest-read assertion EVERY pillar landing
 * carries — the six pillar roots (`home`, `sessions-index`, `projects-index`,
 * `flows-index`, `agents-index`, `knowledge`) report
 * `data-fetch-status="ok"` once their read settled on a healthy bridge, and
 * the app shell's `[data-component="bridge-status"]` is mounted on every
 * route (docs/forge-ui-dom-and-harness.md → "Shared — failed-read state" /
 * "Global — bridge status banner"). One helper, called from each pillar
 * journey's landing beat, so the contract shipped on six roots is asserted on
 * six roots (the sweep found it asserted on Home alone).
 *
 * @param {import('playwright').Page} page
 * @param {(cond: boolean, msg: string) => void} check  the beat's soft asserter
 * @param {string} pageId  the root's `data-page` value
 * @param {string} label   the beat's check-label prefix (e.g. 'SESSIONS-IDX.2')
 */
export async function checkHonestPillarRead(page, check, pageId, label) {
  const r = await page.evaluate((id) => ({
    fetch: document.querySelector(`[data-page="${id}"]`)?.getAttribute('data-fetch-status') ?? '(absent)',
    bridge: document.querySelector('[data-component="bridge-status"]')?.getAttribute('data-bridge-status') ?? null,
    errors: document.querySelectorAll('[data-component="fetch-error"]').length,
  }), pageId);
  check(r.fetch === 'ok', `${label}: [data-page="${pageId}"][data-fetch-status="ok"] — the read settled without a bridge failure (got "${r.fetch}")`);
  check(r.bridge !== null, `${label}: [data-component="bridge-status"] is mounted in the app shell (got ${r.bridge === null ? 'absent' : `"${r.bridge}"`})`);
  check(r.errors === 0, `${label}: no [data-component="fetch-error"] on a healthy bridge (got ${r.errors})`);
}

/**
 * @param {object}   [opts]
 * @param {function} [opts.frame]    async (page, name, caption) — capture helper for held-open frames.
 * @param {number}   [opts.dwellMs]  how long to hold an opened drawer before the frame (default 4200).
 * @param {number}   [opts.actMs]    short settle after a click (default 1500).
 * @param {function} [opts.onCheck]  ({ msg, pass }) — fired for every check() call, in addition to
 *                                   the existing console + failures-array behaviour. Optional.
 */
export function createAssertions({ frame, dwellMs = 4200, actMs = 1500, onCheck } = {}) {
  const failures = [];

  function check(cond, msg) {
    if (cond) { console.log(`  ✓ ${msg}`); }
    else { failures.push(msg); console.error(`  ✗ ${msg}`); }
    if (onCheck) onCheck({ msg, pass: !!cond });
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
