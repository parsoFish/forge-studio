/**
 * `GET /api/studio/projects/:id/contract-stages`.
 *
 * M4 §4 (projects routes carve). Named `project-roadmap.ts` per the carve
 * assignment (row 8's route family), but carries only row 9 — see the
 * "NOT CARVED" section below for why row 8 itself, and its whole helper
 * cluster, could not move here.
 *
 * ============================================================================
 * NOT CARVED: `GET /api/studio/projects/:id/roadmap` and its helpers
 * ============================================================================
 *
 * The carve assignment for this file was: the roadmap handler (row 8) plus
 * `buildProjectRoadmap`, `scanProjectManifests`, `completedAtByInitiative`,
 * `isCompletenessFlagged`, `readWorkItemsForInitiative`, `tryReadWorkItemDir`,
 * `discoverCycleIdFromLogs` and the roadmap types, plus the contract-stages
 * handler (row 9).
 *
 * Verifying that assignment against `scripts/check-boundaries.mjs`'s
 * `PACKAGE_RANK` (kernel=1 < {library,knowledge,projects}=2 < agents=3 <
 * sessions=4 < flows=5 — "a package may import only strictly lower ranks")
 * found that `buildProjectRoadmap` and its helper cluster are NOT
 * projects-shaped code that happens to sit in `cli/bridge-studio.ts` — they
 * are `@forge/flows` consumers throughout:
 *
 *   - `scanProjectManifests` (and therefore `buildProjectRoadmap` AND
 *     `buildProjectAttention`, which calls it too): `getPaths`, `QueueState`
 *     (`@forge/flows/queue.ts`), `parseManifest` (`@forge/flows/manifest.ts`).
 *   - `buildProjectRoadmap` additionally: `initiativeTitle`
 *     (`@forge/flows/manifest.ts`), `checkInitiativeDeps`
 *     (`@forge/flows/scheduler.ts`), `completedAtByInitiative` →
 *     `cachedListRuns` (`@forge/flows/run-list-cache.ts`),
 *     `readWorkItemsForInitiative` → `tryReadWorkItemDir` → `parseWorkItem`/
 *     `WORK_ITEM_FILE_PATTERN`/`WorkItem` (`@forge/flows/work-item.ts`).
 *
 * That is FIVE distinct `packages/projects/*.ts → packages/flows/*.ts` edges,
 * every one a NEW `package-layer-order` violation (`flows` is a strictly
 * HIGHER rank than `projects`; carve-rules.md's boundary section names
 * `@forge/flows` explicitly as forbidden). `scripts/check-boundaries.mjs`'s
 * violation baseline is a shrink-only ratchet — `compareBaseline()` hard-fails
 * a NEW `(rule, from, to)` triple and there is no `--write-baseline` — so this
 * is not a debt this carve can quietly incur the way `cli/bridge-studio.ts`'s
 * many pre-existing `legacy-to-package-not-via-shim` edges already are
 * (grandfathered, 300+ entries in `scripts/baselines/boundaries.json`).
 *
 * Unlike the single-function dependency-injection carve-rules.md already
 * precedents for `seedProjectBrain` (and this same PR applies once more for
 * `projectKbBindings`, `listStarterAgents`/`loadStarterFlow`/
 * `agentCapabilityDescriptor` — see `project-roster.ts`'s header), this is
 * not "pass one function in": it is the feature's ENTIRE domain model
 * (queue-state scanning, manifest parsing, initiative dependency checks,
 * work-item snapshots) built out of flows primitives. Injecting all five
 * would not be a carve ("move code verbatim... no signature changes") — it
 * would be redesigning the roadmap feature's ownership boundary, which is a
 * T1/T2 ruling, not a call this worker made unilaterally.
 *
 * `isCompletenessFlagged` and `discoverCycleIdFromLogs` (also named in the
 * assignment) are themselves flows-free (`node:fs`/`node:path` only) — but
 * both exist only to serve `scanProjectManifests`'s callers, which cannot
 * move, so they stayed with it in `cli/bridge-studio.ts` rather than being
 * split out here to orphan half a cluster.
 *
 * `GET /api/studio/projects/:id/roadmap` therefore still lives in
 * `cli/bridge-studio.ts`'s `handleStudioRoutes`, unchanged in behaviour.
 * RECOMMENDATION (not a decision this worker is positioned to make): either
 * `@forge/flows` — which CAN import `@forge/projects` freely (5 > 2) — takes
 * ownership of this route and its helper cluster, or T1 rules the five new
 * edges into the boundary baseline as accepted debt.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { deriveContractStages } from '@forge/projects/contract-stages.ts';
import {
  defaultConfigPath,
  loadConfig,
  resolveProjectsDir,
  sendJson,
  allowedOrigin,
  sanitizeError,
  pathOnly,
  PROJECT_ID_RE,
  type StudioContext,
} from '@forge/kernel';

/**
 * GET /api/studio/projects/:id/contract-stages (R4-17, D9)
 *
 * The onboarding session's data contract, as its own route — this is what
 * makes "staged artifacts land on the project page" true rather than
 * aspirational (R4-12-F1 renders it in batch D). `id` is path-shaped, so it
 * is validated (`PROJECT_ID_RE`) BEFORE any fs call — a raw ".." segment a
 * browser client would normalise away must still be rejected server-side
 * (mirrors the R4-16 wire-level rule for path-shaped params).
 */
export async function handleProjectContractStages(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  const contractStagesMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/contract-stages$/);
  if (contractStagesMatch && method === 'GET') {
    try {
      const id = decodeURIComponent(contractStagesMatch[1]);
      if (!PROJECT_ID_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id' }, origin);
        return true;
      }
      const projectsRoot = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const result = deriveContractStages({ forgeRoot: ctx.forgeRoot, projectsRoot, projectId: id });
      if (!result.ok) {
        // Distinguishes "unknown project" from "project exists but its
        // .forge/project.json is malformed" the same way deriveContractStages
        // itself does — an unknown/escaping id 404s, a malformed config never
        // gets smoothed into a 200 ("declared data fails open" is the shape
        // this campaign keeps finding and closing).
        const status = /^unknown project /.test(result.error.message) ? 404 : 409;
        // W7-B6 (projects-01 / crosscut-12): when the 409 is the R1-03
        // MIGRATE shape ("the flat gate keys moved to the typed testProcess
        // object"), the message names the mechanical remedy — `forge project
        // migrate <id>` applies the exact mapping the validator's text
        // describes. Review F6: the CONFLICT shape ("conflicting flat gate
        // key(s) alongside testProcess") must NOT get the hint — migrate
        // REFUSES that shape ('conflict': which source wins is a human
        // decision), so the old broad /flat gate key/ match pointed the
        // operator at a command that would decline to act.
        const error =
          status === 409 && /flat gate keys moved to the typed testProcess object/.test(result.error.message)
            ? `${result.error.message} Run \`forge project migrate ${id}\` to apply this migration automatically.`
            : result.error.message;
        sendJson(res, status, { ok: false, error }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, project: id, stages: result.rows, sourcesScanned: result.sourcesScanned }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }
  return false;
}
