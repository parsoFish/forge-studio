/**
 * Forge Studio session-shell read route (R2-10, PR1: the session-shell
 * backend contract).
 *
 * Owns the ONE route:
 *
 *   GET /api/studio/sessions/:kind/:sessionId?project=<p>
 *     → { ok, kind, title, sessionId, project, phase, stages, defaultStage, turns, artifact }
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
 *   - The session dir is resolved via `resolveGuardedPath`
 *     (cli/studio-path-guard.ts) — a per-segment IDENTITY walk, never a
 *     lexical `startsWith(dir + sep)` check on the unresolved path, and
 *     never (R6-06 round 6 fix) a realpath computed on an ALREADY-FOLDED
 *     `<project>/_<kind>` baseline — see `resolveSafeSessionDir` below for
 *     why that earlier shape was tautological when `_<kind>` itself was the
 *     symlink. The escape probe AT-47 defends is a symlink whose OWN on-disk
 *     path is safely inside the requested `<project>/_<kind>/` dir but which
 *     resolves to a DIFFERENT project's session — a check that only verifies
 *     "somewhere under projectsRoot" would miss this (the target is still
 *     under projectsRoot, just under a different project); the check must be
 *     scoped to the specific `<project>/_<kind>/` parent, not the whole
 *     projectsRoot tree. `resolveGuardedPath`'s per-segment walk additionally
 *     catches a symlinked `_<kind>` DIRECTORY itself (the R6-06 P0 shape,
 *     git-plantable via `git update-index --cacheinfo 120000` inside any
 *     onboarded project's own repo) — the one shape the old hand-rolled check
 *     missed.
 *   - `phase` is read from the session's real `status.json` through the SAME
 *     realpath-guarded choke point (`safeReadFileInSession`,
 *     orchestrator/studio/session-transcript.ts) every other session file in
 *     this route goes through — never `readSessionStatus`
 *     (orchestrator/interactive-session.ts:240), a plain
 *     existsSync/readFileSync with no realpath containment that would leak a
 *     symlinked status.json's outside content. `phase` is never fabricated.
 *     A resolved session dir with no readable, parseable, or string-`phase`
 *     `status.json` — including an escaping symlink, which is treated as
 *     unreadable — is a 404, not a 200 with a guessed or leaked phase.
 *
 *   - Traversal (session dirs AND status.json) is blocked for SYMLINK
 *     escapes via realpathSync. It is NOT blocked for HARDLINK escapes — a
 *     hardlink has no separate target to resolve away from — which is
 *     accepted, not fixed: creating a hardlink inside a session dir needs
 *     the same local write access as writing the outside content in
 *     directly, so the residual risk is negligible (see
 *     session-transcript.ts's module header for the full rationale).
 *   - `deriveSessionTranscript`'s `{ok:false}` (an unknown stage in a
 *     checkpoint) surfaces as a 409 naming the offending value + the allowed
 *     set — never smoothed into a 200. A `deriveSessionArtifact` throw
 *     (reserved artifact kind) surfaces as a 500 — never a 200 with an empty
 *     artifact.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, parseQuery, SAFE_ID_RE, type StudioContext } from './bridge-studio.ts';
import { SLUG_RE } from '../orchestrator/studio/validate.ts';
import { KB_SEEDING_ANCHOR_PREFIX } from './bridge-studio-kbs.ts';
import { MAX_SKILL_ID_LENGTH } from '../orchestrator/skill-path.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import { loadSessionKinds, type SessionKindDescriptor } from '../orchestrator/studio/session-kinds.ts';
import { deriveSessionTranscript, deriveSessionArtifact, safeReadFileInSession } from '../orchestrator/studio/session-transcript.ts';
import { deriveContractStages } from './contract-stages.ts';
import { resolveGuardedPath } from './studio-path-guard.ts';

/** `status.json`'s filename, relative to a session dir — read via
 *  `safeReadFileInSession` (the SAME realpath-guarded choke point
 *  session-transcript.ts uses for every other session file), never via
 *  `readSessionStatus` (orchestrator/interactive-session.ts): that helper
 *  does a plain existsSync/readFileSync with no realpath containment, which
 *  is a second, unguarded read path — a symlinked status.json pointing
 *  outside the session dir would leak its content into this route. One
 *  choke point for every file this route reads out of a session dir. */
const STATUS_FILENAME = 'status.json';

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
  // R4-19 WI-2 — bounded carve-out: a non-project KB seeding session anchors
  // under `projects/.kb-<id>/` (KB_SEEDING_ANCHOR_PREFIX, so it never surfaces
  // as a phantom project — discoverProjects still filters ALL dot-dirs). To
  // make that session viewable/drivable, allow EXACTLY `.kb-<valid-slug>` here,
  // validating the post-prefix remainder with the SAME SLUG_RE (so a `/`, `..`,
  // NUL, or empty slug still rejects — traversal defense is unchanged; this is
  // never a general leading-"." allow).
  if (id.startsWith(KB_SEEDING_ANCHOR_PREFIX)) {
    const anchorSlug = id.slice(KB_SEEDING_ANCHOR_PREFIX.length);
    if (SLUG_RE.test(anchorSlug)) {
      return null;
    }
    return `invalid KB seeding anchor "${id}" — the id after "${KB_SEEDING_ANCHOR_PREFIX}" must match ${SLUG_RE}`;
  }
  if (!SLUG_RE.test(id)) {
    return `invalid project "${id}" — must match ${SLUG_RE} (a single lowercase-kebab slug; no "/", "\\", ".", or "..")`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session-dir resolution — delegates to `resolveGuardedPath`
// (cli/studio-path-guard.ts), the repo's one shared per-segment IDENTITY
// containment guard, scoped to the specific <project>/_<kind>/ parent (NOT
// the whole projectsRoot tree — see header note on why that broader check
// would miss the AT-47 escape shape).
// ---------------------------------------------------------------------------

/**
 * Resolves `<projectsRoot>/<project>/<kindDirName>/<sessionId>` with genuine
 * per-segment IDENTITY containment (R6-06 round 6 — replaces a HAND-ROLLED
 * check that had its own root-folding defect: it called
 * `realpathSync(join(projectsRoot, project, kindDirName))` FIRST and used
 * THAT as its comparison baseline, so when `kindDirName` (the `_<kind>` dir)
 * itself was a symlink, the baseline was already the escaped location and
 * the "containment" check was tautological — proven by direct execution
 * before this fix, see the R6-06 task report). `project`, `kindDirName`, and
 * `sessionId` each arrive as their OWN element of `segments[]` — never
 * folded into `root` — so `resolveGuardedPath`'s walk checks EVERY one of
 * them against its own expected literal location, catching a symlinked
 * `_<kind>` dir (this function's own prior defect) exactly as it catches a
 * symlinked `sessionId` (AT-47, always caught, even by the old code).
 *
 * `projectsRoot` is a fixed, config-derived constant — the caller's own
 * `root` in `resolveGuardedPath`'s trust contract — never request-derived.
 *
 * A missing dir and an escaping symlink both return `null` — collapsed into
 * the same "not found" outcome, so an attacker can never distinguish "wrong
 * id" from "blocked escape" from the response.
 */
function resolveSafeSessionDir(projectsRoot: string, project: string, kindDirName: string, sessionId: string): string | null {
  const guarded = resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId]);
  if (!guarded.ok || !guarded.exists) return null;
  return guarded.realPath;
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

    const projectsRoot = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
    const kindDirName = `_${descriptor.id}`;
    const sessionDir = resolveSafeSessionDir(projectsRoot, project, kindDirName, sessionId);
    if (!sessionDir) {
      sendJson(res, 404, { error: 'session not found', kind, sessionId, project }, origin);
      return true;
    }

    // `phase` is read from the session's real status.json through the SAME
    // realpath-guarded choke point every other session file in this route
    // goes through — never readSessionStatus's unguarded existsSync/
    // readFileSync (see header). An escaping symlink is indistinguishable
    // from "missing" here (safeReadFileInSession returns null for both) —
    // never fabricated, never leaked.
    const statusRaw = safeReadFileInSession(sessionDir, STATUS_FILENAME);
    let statusParsed: Record<string, unknown> | null = null;
    if (statusRaw !== null) {
      try {
        const parsed: unknown = JSON.parse(statusRaw);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          statusParsed = parsed as Record<string, unknown>;
        }
      } catch {
        statusParsed = null; // malformed JSON — treated as unreadable, never surfaced
      }
    }
    if (statusParsed === null) {
      sendJson(res, 404, { error: 'session not found (status.json is missing, unreadable, or not valid JSON)', kind, sessionId, project }, origin);
      return true;
    }
    if (typeof statusParsed.phase !== 'string') {
      sendJson(res, 404, { error: 'session not found (status.json has no string "phase" field)', kind, sessionId, project }, origin);
      return true;
    }
    const phase = statusParsed.phase;

    const transcriptResult = deriveSessionTranscript({ descriptor, sessionDir, phase });
    if (!transcriptResult.ok) {
      // Fail-closed pass-through: never smoothed into a 200 with defaulted
      // stages — surfaces the offending value + allowed set verbatim.
      sendJson(res, 409, { ok: false, error: transcriptResult.error.message }, origin);
      return true;
    }

    let artifact: unknown;
    try {
      // R4-17 — the 'contract-buildout' kind needs rows derived from the
      // PROJECT tree (outside sessionDir's own containment — D4), so they
      // are computed HERE, via cli/contract-stages.ts's own realpath-guarded
      // containment, and threaded in verbatim. A {ok:false} derivation (an
      // unknown/escaping project, or a malformed .forge/project.json)
      // surfaces as a 409 naming the cause — never a 200 with an empty
      // artifact, mirroring the fail-closed pass-through just above for
      // deriveSessionTranscript.
      if (descriptor.artifact.kind === 'contract-buildout') {
        const contractResult = deriveContractStages({ forgeRoot: ctx.forgeRoot, projectsRoot, projectId: project });
        if (!contractResult.ok) {
          sendJson(res, 409, { ok: false, error: contractResult.error.message }, origin);
          return true;
        }
        artifact = deriveSessionArtifact({ descriptor, sessionDir, contractStages: contractResult.rows });
      } else {
        artifact = deriveSessionArtifact({ descriptor, sessionDir });
      }
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
        // R2-10 PR2, WI-8: the descriptor's declared `title` (studio/session-
        // kinds.yaml), threaded through verbatim — mirrors how `artifact.label`
        // already flows via `deriveSessionArtifact`. Closes a declared-data-
        // with-no-consumer gap: `title` was parsed and lint-validated but the
        // session-shell page previously hardcoded its own local heading map
        // instead of reading it off the wire.
        title: descriptor.title,
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
