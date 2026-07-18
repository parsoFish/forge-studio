/**
 * S6B — `forge reflect <id> --rerun` helper.
 *
 * Re-invokes `runReflector` against the closed manifest for `<id>`. The
 * reflector's user prompt already reads `_logs/<id>/user-feedback.md`, so
 * a rerun simply walks the existing stage-1→4 flow with the operator's
 * answers in place.
 *
 * Resolution rules for the manifest:
 *   1. `_queue/done/<id>.md`
 *   2. `_queue/merged/<id>.md` (R4-11-F1 — a confirmed-merge manifest briefly
 *      parked between closure's two terminal moves, same sweep)
 *   3. `_queue/ready-for-review/<id>.md`
 *   4. `_queue/in-flight/<id>.md`
 *   5. `_queue/failed/<id>.md`
 *
 * If none exist we throw with a clear message — rerun on a cycle whose
 * manifest is gone has nothing to reflect on.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runReflector } from './phases/reflector.ts';
import { createLogger } from './logging.ts';
import { parseManifest } from './manifest.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..');

export type RerunInput = {
  cycleId: string;
  /** Defaults to `<forge>/_logs`. */
  logsRoot?: string;
  /** Defaults to `<forge>/_queue`. */
  queueRoot?: string;
};

const QUEUE_STATES = ['done', 'merged', 'ready-for-review', 'in-flight', 'failed'] as const;

/**
 * The manifest is named by INITIATIVE id, but a cycleId is usually the timestamped
 * log-dir name `<ts>_<initiativeId>`. Recover the initiativeId from the cycle's
 * event log (`initiative_id` field), falling back to stripping a leading
 * timestamp prefix. Returns the cycleId unchanged when it already is the id.
 */
export function resolveInitiativeId(cycleId: string, logsRoot: string): string {
  const eventsPath = resolve(logsRoot, cycleId, 'events.jsonl');
  if (existsSync(eventsPath)) {
    try {
      const firstLine = readFileSync(eventsPath, 'utf8').split('\n').find((l) => l.trim());
      if (firstLine) {
        const ev = JSON.parse(firstLine) as { initiative_id?: string };
        if (ev.initiative_id) return ev.initiative_id;
      }
    } catch {
      // fall through to the prefix-strip heuristic
    }
  }
  const underscore = cycleId.indexOf('_');
  return underscore >= 0 ? cycleId.slice(underscore + 1) : cycleId;
}

export async function rerunReflector(input: RerunInput): Promise<void> {
  const logsRoot = input.logsRoot ? resolve(input.logsRoot) : resolve(FORGE_ROOT, '_logs');
  const queueRoot = input.queueRoot ? resolve(input.queueRoot) : resolve(FORGE_ROOT, '_queue');

  // Locate the manifest across the terminal states. The cycleId is often the
  // timestamped log-dir name (`<ts>_<initiativeId>`); the manifest is named by
  // initiativeId — so try BOTH the cycleId and the recovered initiativeId.
  const initiativeId = resolveInitiativeId(input.cycleId, logsRoot);
  const ids = initiativeId === input.cycleId ? [input.cycleId] : [input.cycleId, initiativeId];
  const candidates = ids.flatMap((id) => QUEUE_STATES.map((s) => resolve(queueRoot, s, `${id}.md`)));
  const manifestPath = candidates.find((p) => existsSync(p));
  if (!manifestPath) {
    throw new Error(
      `rerun: no manifest for cycle ${input.cycleId} (initiative ${initiativeId}) in ${queueRoot} (tried done/ready-for-review/in-flight/failed)`,
    );
  }

  const m = parseManifest(readFileSync(manifestPath, 'utf8'));
  const projectRepoPath =
    m.project_repo_path ?? resolve(FORGE_ROOT, 'projects', m.project);

  const logger = createLogger(input.cycleId, logsRoot);
  await runReflector(
    {
      initiativeId: m.initiative_id,
      manifestPath,
      projectRepoPath,
      worktreePath: projectRepoPath,
      cycleId: input.cycleId,
    },
    logger,
  );
}
