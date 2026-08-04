/**
 * Forge Studio session-shell read route (R2-10, PR1: the session-shell
 * backend contract).
 *
 * Owns the ONE route:
 *
 *   GET /api/studio/sessions/:kind/:sessionId?project=<p>
 *     → { ok, kind, sessionId, project, phase, stages, defaultStage, turns, artifact }
 *
 * Mirrors bridge-studio-templates.ts's contract exactly: a single
 * `handleStudioSessionsRoutes(req, res, ctx, rawUrl, method): Promise<boolean>`,
 * a linear if-chain, `return false` on a non-matching URL, `sendJson` for every
 * response, `sanitizeError` for anything that reaches a user-visible error
 * string derived from a thrown value. Read-only: no writes, no spawns, no
 * mutation of any session — this route only derives a view over
 * already-on-disk session state (orchestrator/studio/session-kinds.ts +
 * session-transcript.ts do all the real work; this module is glue + guards).
 *
 * `kind` is resolved against the LIVE `studio/session-kinds.yaml` registry
 * (loadSessionKinds) rather than a hardcoded switch — a new descriptor (R4-15/
 * 16/17) needs no code change here. The on-disk session dir is derived as
 * `<projectsRoot>/<project>/_<kind>/<sessionId>` — `_<kind>` built from
 * `descriptor.id`, the same shape `architectSessionDir` / `instructionsSessionDir`
 * / `projectBrainSessionDir` already use (cli/ui-bridge.ts:1416,
 * orchestrator/instructions-runner.ts:142, orchestrator/project-brain-builder-runner.ts:77).
 *
 * Security (the part reviewers attack hardest — a standing brief after 3
 * consecutive lexical-check failures in this campaign):
 *   - `sessionId` is validated with SAFE_ID_RE (cli/bridge-studio.ts) — real
 *     session ids are ISO-ish timestamps (`2026-08-05T10-00-00`, uppercase
 *     `T`) which the lowercase-only SLUG_RE rejects. `project` is validated
 *     with SLUG_RE. Exact precedent: cli/bridge-studio-runs.ts's plan-verdict
 *     route ("project uses SLUG_RE ... sessionId uses SAFE_ID_RE"). BOTH are
 *     validated (length cap + charset) BEFORE any fs call.
 *   - The session dir is resolved via `realpathSync`, never a lexical
 *     `startsWith(dir + sep)` check on the unresolved path — see
 *     `resolveSafeSessionDir` below. The escape probe this defends
 *     (AT-47) is a symlink whose OWN on-disk path is safely inside the
 *     requested `<project>/_<kind>/` dir but which resolves to a DIFFERENT
 *     project's session — a check that only verifies "somewhere under
 *     projectsRoot" would miss this (the target is still under projectsRoot,
 *     just under a different project); the check must be scoped to the
 *     specific `<project>/_<kind>/` parent, not the whole projectsRoot tree.
 *   - `phase` is read from the session's real `status.json`
 *     (`readSessionStatus`, orchestrator/interactive-session.ts:240) — never
 *     fabricated. A resolved session dir with no (or malformed) `status.json`
 *     is a 404, not a 200 with a guessed phase.
 *   - `deriveSessionTranscript`'s `{ok:false}` (an unknown stage in a
 *     checkpoint) surfaces as a 409 naming the offending value + the allowed
 *     set — never smoothed into a 200. A `deriveSessionArtifact` throw
 *     (reserved artifact kind) surfaces as a 500 — never a 200 with an empty
 *     artifact.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, parseQuery, SAFE_ID_RE, type StudioContext } from './bridge-studio.ts';
import { SLUG_RE } from '../orchestrator/studio/validate.ts';
import { MAX_SKILL_ID_LENGTH } from '../orchestrator/skill-path.ts';
import { loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import { loadSessionKinds, type SessionKindDescriptor } from '../orchestrator/studio/session-kinds.ts';
import { deriveSessionTranscript, deriveSessionArtifact } from '../orchestrator/studio/session-transcript.ts';
import { readSessionStatus } from '../orchestrator/interactive-session.ts';

/** Hard length caps on the two path-derived inputs — the same value and
 *  rationale as `MAX_SKILL_ID_LENGTH` (orchestrator/skill-path.ts), imported
 *  rather than re-declared: without a cap, a charset-valid but absurdly long
 *  id sails past SAFE_ID_RE/SLUG_RE and only dies later as an opaque fs error
 *  (or, worse, a resource-exhaustion vector) instead of an actionable 400. No
 *  real session id or project slug is remotely close to this length. */
const MAX_SESSION_ID_LENGTH = MAX_SKILL_ID_LENGTH;
const MAX_PROJECT_ID_LENGTH = MAX_SKILL_ID_LENGTH;

const SESSION_ROUTE_RE = /^\/api\/studio\/sessions\/([^/]+)\/([^/]+)$/;

// ---------------------------------------------------------------------------
// Input validation — length cap THEN charset, both before any fs call.
// ---------------------------------------------------------------------------

/** Decode a URL path segment; never silently passes through a raw,
 *  still-encoded value — throws on malformed percent-encoding (mirrors
 *  bridge-studio-templates.ts's `decodeIdSegment`). */
function decodeSegment(raw: string): string {
  return decodeURIComponent(raw);
}

function invalidSessionIdReason(id: string): string | null {
  if (id.length > MAX_SESSION_ID_LENGTH) {
    return `invalid sessionId "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_SESSION_ID_LENGTH}-character length limit`;
  }
  if (!SAFE_ID_RE.test(id)) {
    return `invalid sessionId "${id}" — must match ${SAFE_ID_RE} (alphanumeric, "_", "-"; no "/", ".", "..", whitespace, or null bytes)`;
  }
  return null;
}

function invalidProjectReason(id: string): string | null {
  if (id.length === 0) {
    return 'project query parameter must not be empty';
  }
  if (id.length > MAX_PROJECT_ID_LENGTH) {
    return `invalid project "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_PROJECT_ID_LENGTH}-character length limit`;
  }
  if (!SLUG_RE.test(id)) {
    return `invalid project "${id}" — must match ${SLUG_RE} (a single lowercase-kebab slug; no "/", "\\", ".", or "..")`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session-dir resolution — realpathSync at the choke point, scoped to the
// specific <project>/_<kind>/ parent (NOT the whole projectsRoot tree — see
// header note on why that broader check would miss the AT-47 escape shape).
// ---------------------------------------------------------------------------

/**
 * Resolves `<projectsRoot>/<project>/<kindDirName>/<sessionId>` and verifies,
 * via `realpathSync` (never a lexical prefix check on the unresolved path),
 * that the resolved directory still lives inside the resolved
 * `<projectsRoot>/<project>/<kindDirName>/` parent. A missing dir and an
 * escaping symlink both return `null` — collapsed into the same "not found"
 * outcome, so an attacker can never distinguish "wrong id" from "blocked
 * escape" from the response.
 */
function resolveSafeSessionDir(projectsRoot: string, project: string, kindDirName: string, sessionId: string): string | null {
  const parentDir = join(projectsRoot, project, kindDirName);
  let realParentDir: string;
  try {
    realParentDir = realpathSync(parentDir);
  } catch {
    return null; // no such project/kind dir at all
  }
  const candidate = join(parentDir, sessionId);
  let realCandidate: string;
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    return null; // missing session dir
  }
  if (realCandidate !== realParentDir && !realCandidate.startsWith(realParentDir + sep)) {
    return null; // escapes the project/kind boundary via a symlink
  }
  return realCandidate;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleStudioSessionsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const routeMatch = url.match(SESSION_ROUTE_RE);
  if (!routeMatch) return false;

  try {
    let kind: string;
    let sessionId: string;
    try {
      kind = decodeSegment(routeMatch[1]);
      sessionId = decodeSegment(routeMatch[2]);
    } catch {
      sendJson(res, 400, { error: 'invalid session route — malformed URL encoding' }, origin);
      return true;
    }

    // Slug-validate BOTH sessionId and project BEFORE any fs read (C1/C2
    // precedent, bridge-studio-runs.ts).
    const sessionIdInvalidReason = invalidSessionIdReason(sessionId);
    if (sessionIdInvalidReason) {
      sendJson(res, 400, { error: sessionIdInvalidReason }, origin);
      return true;
    }

    const projectRaw = parseQuery(rawUrl).get('project');
    if (projectRaw === null) {
      sendJson(res, 400, { error: 'project query parameter is required' }, origin);
      return true;
    }
    const projectInvalidReason = invalidProjectReason(projectRaw);
    if (projectInvalidReason) {
      sendJson(res, 400, { error: projectInvalidReason }, origin);
      return true;
    }
    const project = projectRaw;

    // Resolve `kind` against the live registry — never a hardcoded switch, so
    // a new descriptor needs no code change here.
    let descriptors: SessionKindDescriptor[];
    try {
      descriptors = loadSessionKinds(ctx.forgeRoot);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
      return true;
    }
    const descriptor = descriptors.find((d) => d.id === kind);
    if (!descriptor) {
      const allowed = descriptors.map((d) => d.id).join(', ');
      sendJson(res, 404, { error: `unknown session kind "${kind}" — must be one of: ${allowed}` }, origin);
      return true;
    }

    const projectsRoot = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig());
    const kindDirName = `_${descriptor.id}`;
    const sessionDir = resolveSafeSessionDir(projectsRoot, project, kindDirName, sessionId);
    if (!sessionDir) {
      sendJson(res, 404, { error: 'session not found', kind, sessionId, project }, origin);
      return true;
    }

    // `phase` is read from the session's real status.json — never fabricated.
    // No (or malformed) status.json is a 404, not a 200 with a guessed phase.
    const status = readSessionStatus<Record<string, unknown>>(sessionDir);
    if (!status || typeof status.phase !== 'string') {
      sendJson(res, 404, { error: 'session not found (no readable status.json)', kind, sessionId, project }, origin);
      return true;
    }
    const phase = status.phase;

    const transcriptResult = deriveSessionTranscript({ descriptor, sessionDir });
    if (!transcriptResult.ok) {
      // Fail-closed pass-through: never smoothed into a 200 with defaulted
      // stages — surfaces the offending value + allowed set verbatim.
      sendJson(res, 409, { ok: false, error: transcriptResult.error.message }, origin);
      return true;
    }

    let artifact: unknown;
    try {
      artifact = deriveSessionArtifact({ descriptor, sessionDir });
    } catch (err) {
      // A reserved (or otherwise unrecognised) artifact kind — an explicit
      // error, never a 200 with an empty artifact.
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
      return true;
    }

    sendJson(
      res,
      200,
      {
        ok: true,
        kind: descriptor.id,
        sessionId,
        project,
        phase,
        stages: descriptor.stages,
        defaultStage: descriptor.defaultStage,
        turns: transcriptResult.turns,
        artifact,
      },
      origin,
    );
    return true;
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
    return true;
  }
}
