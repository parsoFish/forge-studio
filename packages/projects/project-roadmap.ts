/**
 * `GET /api/studio/projects/:id/contract-stages`.
 *
 * M4 §4 (projects routes carve). Named `project-roadmap.ts` per the carve
 * assignment (row 8's route family) but carrying only row 9: row 8
 * (`GET /api/studio/projects/:id/roadmap`) and its whole helper cluster are
 * `@forge/flows` consumers throughout, and `flows` outranks `projects`, so
 * carving them here would mint five new `package-layer-order` violations
 * against a shrink-only baseline. They stayed in `apps/forge/bridge-studio.ts`
 * and were handed to the M4-flows lane. `design.md`'s "What this package
 * deliberately does not own" carries that reasoning AND the decision — this
 * header used to end in a RECOMMENDATION that `design.md` has since settled.
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
