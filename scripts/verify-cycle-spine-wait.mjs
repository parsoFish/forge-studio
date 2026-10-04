/**
 * verify-cycle-spine-wait.mjs — the spine's own waits on Studio's supervised
 * `forge serve` (M7-E row 205), split out of `verify-cycle.mjs` (baselined
 * over the 800-line cap; an exemption is a ceiling, not a licence — same
 * reason `verify-cycle-stage2.mjs` exists).
 *
 * `forge studio` supervises a forever-mode `forge serve` from boot (ADR
 * 011/031): the instant a manifest exists in `_queue/pending/` it is live to
 * a claim, and it claims every eligible manifest on its own. Neither spine
 * stage spawns `forge serve` itself any more — both wait on the SAME two
 * observables the product exposes: the manifest's queue directory and its
 * own `_logs/<cycleId>/events.jsonl` (`scripts/lib/serve-wait.mjs`'s
 * `waitForManifestOutcome`), never a spawned child's stdout.
 *
 * Collaborators (`page`, `getPhaseStates`, `captureFrame`,
 * `cycleStatusFromBridge`, `sleep`, `log`) are injected so this module stays
 * Playwright-and-bridge-free in its own imports and is testable with fakes —
 * the same shape `verify-cycle-stage2.mjs`'s `createStageTwo` uses.
 */
import { assertServeRunning, waitForManifestOutcome, DEFAULT_POLL_MS } from './lib/serve-wait.mjs';

/** M7-E row 205: PM-decompose (stage 1) is one phase, lighter than a full
 *  dev-loop → demo → review pass — the same order of magnitude as the
 *  architect interview's own 25-minute budget (`verify-cycle.mjs`), not the
 *  heavier per-initiative budget stage 2/3 needs below. */
export const ARCHITECT_DECOMPOSE_WAIT_MS = 15 * 60_000;

/** One unit of stage-2/3 convergence wall-clock budget — the direct
 *  translation of the prior discrete "one `serve --once` pass" into
 *  wall-clock time now that a live, continuously-running `forge serve`
 *  makes progress on its own rather than this driver spawning + blocking on
 *  it per pass. Same order of magnitude `scripts/stories/d12-demo-runs.mjs`
 *  gives one independent initiative's full dev-loop → demo → review pass.
 *  A caller multiplies this by its own pass-count margin for the total
 *  convergence deadline. */
export const DEVELOP_PASS_BUDGET_MS = 45 * 60_000;

/**
 * @param {object} deps
 * @param {string} deps.forgeRoot
 * @param {import('playwright-core').Page} deps.page
 * @param {(page: import('playwright-core').Page) => Promise<Record<string, string>>} deps.getPhaseStates
 * @param {(page: import('playwright-core').Page, name: string) => Promise<void>} deps.captureFrame
 * @param {(bridgeUrl: string, cycleId: string) => Promise<string | null>} deps.cycleStatusFromBridge
 * @param {(ms: number) => Promise<void>} deps.sleep
 * @param {(msg: string) => void} deps.log
 */
export function createSpineWait({ forgeRoot, page, getPhaseStates, captureFrame, cycleStatusFromBridge, sleep, log }) {
  /**
   * Capture a frame on every `[data-phase][data-phase-status]` transition
   * until `stop()` is called — the same visual trail this stage's phase
   * transitions produce, run as an independent ticker alongside a pure
   * queue/event-log wait (Studio's supervised `forge serve` does the actual
   * work in the background; nothing here spawns it or blocks on it).
   */
  function trackPhaseFrames(label) {
    const seen = new Map();
    let stopped = false;
    const loop = (async () => {
      while (!stopped) {
        try {
          const states = await getPhaseStates(page);
          for (const [phase, status] of Object.entries(states)) {
            if (seen.get(phase) !== status) {
              seen.set(phase, status);
              await captureFrame(page, `${label}-${phase}-${status}`);
            }
          }
        } catch { /* */ }
        await sleep(DEFAULT_POLL_MS);
      }
    })();
    return { stop: async () => { stopped = true; await loop; } };
  }

  /**
   * Wait for the architect flow's PM-decompose pass to land EVERY
   * initiative's manifest at a resolved queue state — `ready-for-review` is
   * the documented default outcome for the forge-architect flow
   * (`packages/flows/scheduler-dispatch.ts`: a closure-less flow ends there)
   * or `failed` on a decisive error. A live, Studio-supervised `forge serve`
   * does the actual work; this only OBSERVES it via `waitForManifestOutcome`
   * (queue state + the cycle's own events.jsonl), never a spawned child's
   * stdout (bead forge-8vfn.6.10.6's original defect — handing off to
   * develop while stage 1 had already failed — cannot recur: the caller's
   * hand-off only fires once every initiative is OBSERVED at a resolved
   * state).
   *
   * @returns {Promise<Map<string, {outcome: 'ok'|'failed'|'timeout', state: string, errors: string[]}>>}
   */
  async function waitForArchitectStage(bridgeUrl, initiatives) {
    await assertServeRunning(bridgeUrl);
    const deadlineMs = Date.now() + ARCHITECT_DECOMPOSE_WAIT_MS;
    const frames = trackPhaseFrames('architect');
    const results = await Promise.all(
      initiatives.map(async (init) => {
        const r = await waitForManifestOutcome(forgeRoot, {
          initiativeId: init.initiativeId,
          cycleId: init.cycleId,
          deadlineMs,
          pollMs: DEFAULT_POLL_MS,
          sleep,
        });
        return [init.initiativeId, r];
      }),
    );
    await frames.stop();
    return new Map(results);
  }

  /**
   * Wait, bounded, for a send-back's in-place drain (ADR-026) to actually
   * finish: the cycle's bridge-reported status must first LEAVE
   * `ready-for-review` (the pre-send-back snapshot — evidence Studio's
   * supervised `forge serve` has started reprocessing it) and only THEN
   * landing back on `ready-for-review` or `failed` counts as done. Reading
   * `ready-for-review` before it ever left would be the stale, pre-drain
   * status, not the drain's own outcome.
   */
  async function waitForSendBackDrain(watch, cycleId, deadlineMs) {
    let left = false;
    while (Date.now() < deadlineMs) {
      const status = await cycleStatusFromBridge(watch.bridgeUrl, cycleId);
      if (!left) {
        if (status !== 'ready-for-review') left = true;
      } else if (status === 'ready-for-review' || status === 'failed') {
        return status;
      }
      await sleep(DEFAULT_POLL_MS);
    }
    log(`send-back drain wait timed out for ${cycleId} (left ready-for-review: ${left})`);
    return left ? 'timeout-after-leaving' : 'timeout-never-left';
  }

  return { trackPhaseFrames, waitForArchitectStage, waitForSendBackDrain };
}
