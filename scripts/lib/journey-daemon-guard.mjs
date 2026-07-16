/**
 * journey-daemon-guard — pre-seed daemon/queue isolation guard.
 *
 * Why this exists (docs/known-gaps.md item 10): `e2e-journey.mjs` seeds queue
 * manifests straight into `_queue/{pending,in-flight}` to emulate a cycle. If a
 * real `forge serve` daemon is alive at the same time, it can claim one of those
 * manifests and run a REAL cycle to completion — including a real release-finalize
 * commit — while the harness thinks it's just emulating. This has happened twice
 * (a stray forge release + an mdtoc release, both untangled by hand). Refuse to
 * seed anything until we're sure the coast is clear.
 *
 * Node ≥22.18 strips types natively (no `tsx`/`ts-node` needed), so the daemon
 * helpers can be imported directly from the orchestrator TypeScript source
 * instead of re-implementing pid-file parsing here.
 */
import { daemonPaths, readPid, isAlive } from '../../orchestrator/daemon.ts';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Refuse to proceed if a live `forge serve` daemon is running, or if the queue
 * already has stray manifests sitting in `pending`/`in-flight` (leftovers from a
 * prior run, or — worse — real work a live scheduler is mid-claim on).
 *
 * @param {string} forgeRoot — absolute path to the forge install root.
 * @throws {Error} if a live daemon or a stray manifest is found.
 */
export async function assertNoLiveDaemon(forgeRoot) {
  const { pidFile } = daemonPaths(forgeRoot);
  const pid = readPid(pidFile);
  if (pid !== null && isAlive(pid)) {
    if (process.env.FORGE_E2E_AUTOKILL_DAEMON === '1') {
      process.kill(pid, 'SIGTERM');
      // A dying daemon can still claim a manifest — wait for it to actually
      // exit before letting the harness seed anything.
      const deadline = Date.now() + 5000;
      while (isAlive(pid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (isAlive(pid)) {
        throw new Error(
          `[e2e] REFUSING to seed: daemon (pid ${pid}) survived SIGTERM — stop it manually before seeding.`
        );
      }
    } else {
      throw new Error(
        `[e2e] REFUSING to seed: live forge daemon (pid ${pid}, ${pidFile}) could claim seeded queue ` +
        `manifests and run a REAL cycle (known-gaps #10). Stop it first (\`forge daemon stop\`), or set ` +
        `FORGE_E2E_AUTOKILL_DAEMON=1 to have this guard SIGTERM it before seeding.`
      );
    }
  }

  const strays = ['pending', 'in-flight'].flatMap((q) => {
    const dir = join(forgeRoot, '_queue', q);
    return existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => `${q}/${f}`)
      : [];
  });
  if (strays.length) {
    throw new Error(
      `[e2e] REFUSING to seed: stray queue manifest(s) already present: ${strays.join(', ')} — ` +
      `inspect/clear _queue before running the journey.`
    );
  }
}
