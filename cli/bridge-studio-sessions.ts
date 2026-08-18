/**
 * Forge Studio session-shell read route (R2-10, PR1: the session-shell
 * backend contract).
 *
 * Owns the ONE route:
 *
 *   GET /api/studio/sessions/:kind/:sessionId?project=<p>
 *     → { ok, kind, title, sessionId, project, phase, stages, defaultStage, turns, artifact,
 *         affordances, modelTier, terminal }
 *
 * W6-B3 (ADR-043 2026-08-15 amendment §1/§2) data-contract additions:
 *   - `affordances` — `deriveSessionAffordances(descriptor, phase)`
 *     (orchestrator/studio/session-kinds.ts), computed server-side from
 *     whichever phase table the descriptor carries (`turnSpec` for a real
 *     dispatchable kind, `panel` for a legacy kind's read-only twin) —
 *     "derived, not authored" (ADR-043 §1): the client renders what it is
 *     handed and never re-derives. A descriptor with neither table
 *     (architect, permanently bespoke — amendment §4) always yields `[]`.
 *   - `modelTier` — the session's own kickoff-selected tier (ADR-043
 *     2026-08-15 amendment §3), read straight off `status.json.modelTier`
 *     (W6-B5 landed the write side: every `/start` route persists
 *     `resolveKickoffModelTier`'s validated `tier` there when the operator
 *     supplied one). `null` for a session with no `modelTier` key at all —
 *     no request predates the seam, and a `strategy:fixed` skill's kickoff
 *     never writes one (the model chip renders the descriptor's fixed model
 *     instead) — never fabricated, never defaulted to a guessed tier. The
 *     key is always present (never omitted) either way.
 *   - `terminal` (W6-B8) — `isTerminalPhase(descriptor, phase)`, the SAME
 *     derivation this route already used internally to gate `ensureSessionTail`,
 *     now also threaded onto the wire so the generic `SessionInteractivePanel`
 *     can gate its ActivityLog drawer without a second, hand-kept
 *     terminal-phase table client-side. ALWAYS present (never omitted).
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
import { readdirSync } from 'node:fs';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, parseQuery, SAFE_ID_RE, LEGACY_SESSION_TERMINAL_PHASES, CANCELLED_PHASE, type StudioContext } from './bridge-studio.ts';
import { SLUG_RE, PROJECT_ID_RE, MAX_EXACT_ID_LENGTH } from '../orchestrator/studio/validate.ts';
import { KB_SEEDING_ANCHOR_PREFIX, computeAgentCleanupFindings } from './bridge-studio-kbs.ts';
import { MAX_SKILL_ID_LENGTH } from '../orchestrator/skill-path.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import { loadSessionKinds, deriveSessionAffordances, type SessionKindDescriptor } from '../orchestrator/studio/session-kinds.ts';
import { deriveSessionTranscript, deriveSessionArtifact, safeReadFileInSession } from '../orchestrator/studio/session-transcript.ts';
import { resolveKbBrainDir } from '../orchestrator/brain-paths.ts';
import { deriveContractStages } from './contract-stages.ts';
import { resolveGuardedPath } from './studio-path-guard.ts';
import { deriveSessionLifecycleFor } from './bridge-studio-lifecycle.ts';

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
const MAX_PROJECT_ID_LENGTH = MAX_EXACT_ID_LENGTH;

const SESSION_ROUTE_RE = /^\/api\/studio\/sessions\/([^/]+)\/([^/]+)$/;

/** W6-B2 — this route is the generic "session-detail GET" EVERY session kind
 *  goes through (`forge-ui/app/sessions/[kind]/[sessionId]/page.tsx` calls
 *  `fetchSessionShell` for architect/instructions/project-brain/demo/
 *  onboarding/authoring/kb-cleanup alike), and for authoring + kb-cleanup it
 *  is the ONLY read route they have — neither has a per-kind list route like
 *  `/api/architect/sessions`. `ensureSessionTail` is threaded in here (rather
 *  than only from the four legacy per-kind list routes in cli/ui-bridge.ts)
 *  so every kind's live event log gets tailed to the WS stream, closing bd
 *  forge-2ee's "no consumer reads the authoring spine's events dir" half. */
export type SessionsRouteContext = StudioContext & {
  ensureSessionTail: (kind: string, sessionId: string) => void;
};

// ---------------------------------------------------------------------------
// Input validation — length cap THEN charset, both before any fs call.
// ---------------------------------------------------------------------------

/** Decode a URL path segment; never silently passes through a raw,
 *  still-encoded value — throws on malformed percent-encoding (mirrors
 *  bridge-studio-templates.ts's `decodeIdSegment`). */
function decodeSegment(raw: string): string {
  return decodeURIComponent(raw);
}

// Exported (cli-side, uncapped — ADR 042) so cli/ui-bridge.ts's kb-cleanup
// apply route (R4-19-F2 adversarial-review fix) can validate its own
// `project`/`sessionId` body fields against this file's own stated
// convention (length cap + charset, before any fs call) WITHOUT
// re-implementing it — including the KB-seeding dot-anchor carve-out
// (`.kb-<id>`), which every non-project-bound kb-cleanup session anchors
// under and must stay accepted here in exactly one place.
export function invalidSessionIdReason(id: string): string | null {
  if (id.length > MAX_SESSION_ID_LENGTH) {
    return `invalid sessionId "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_SESSION_ID_LENGTH}-character length limit`;
  }
  if (!SAFE_ID_RE.test(id)) {
    return `invalid sessionId "${id}" — must match ${SAFE_ID_RE} (alphanumeric, "_", "-"; no "/", ".", "..", whitespace, or null bytes)`;
  }
  return null;
}

// W6-CR-3 — the community-refresh session anchors under this ONE fixed,
// dot-prefixed pseudo-project (mirrors KB_SEEDING_ANCHOR_PREFIX's own
// non-project carve-out immediately below, but unparameterized: there is
// exactly ONE community registry, forge-wide, not N per-id KBs, so a single
// literal constant is the honest shape rather than a prefix + variable slug).
// `discoverProjects` (orchestrator/studio/registry.ts) already filters every
// dot-prefixed directory, so this anchor never surfaces as a phantom
// project. Exported so cli/ui-bridge.ts's `/api/studio/community-refresh/
// start` route and cli/bridge-studio-affordances.ts's generic verdict
// dispatch both use the SAME literal rather than each hand-typing it.
export const COMMUNITY_REFRESH_PROJECT_ANCHOR = '.community-registry';

// W6-B9 reviewer fix — the general invariant this file's own KB-seeding
// carve-out comment (below) and W6-CR-3's comment (above) both already
// state: `discoverProjects` (orchestrator/studio/registry.ts) filters EVERY
// dot-prefixed directory out of the real project list, categorically — not
// just `.kb-<id>` (KB_SEEDING_ANCHOR_PREFIX) or `.community-registry`
// (COMMUNITY_REFRESH_PROJECT_ANCHOR, above). A project id starting with "."
// is therefore NEVER a real registered project, full stop — this is that
// one general check, exported so a consumer that only needs "is this a
// phantom anchor, yes/no" (as opposed to `invalidProjectReason`'s full
// validate-or-reject contract) has a single source rather than re-deriving
// the same leading-"." fact. forge-ui never imports cli/ at runtime (see
// this repo's SSOT-parity-test convention, e.g.
// forge-ui/lib/trigger-kind-parity.test.ts) — its own `isPseudoProjectAnchor`
// (forge-ui/lib/session-shell-view.ts) is a small, independently-declared
// mirror, kept honest by a parity test (forge-ui/lib/session-shell-view.test.ts).
export function isPseudoProjectAnchor(project: string): boolean {
  return project.startsWith('.');
}

export function invalidProjectReason(id: string): string | null {
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
  // W6-CR-3 — the SAME bounded carve-out for the community-refresh anchor:
  // EXACTLY this one literal value is allowed, never a general leading-"."
  // exemption.
  if (id === COMMUNITY_REFRESH_PROJECT_ANCHOR) {
    return null;
  }
  // W7-A4 (forge-9bd): the project id IS the directory name — case-preserving,
  // matched exactly (`trafficGame` is valid; `../x`, `a/b`, `.hidden` are not).
  if (!PROJECT_ID_RE.test(id)) {
    return `invalid project "${id}" — must match ${PROJECT_ID_RE} (the project's directory name: one path segment; no "/", "\\", ".", "..", or a leading "-")`;
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

/**
 * W7-A2 (community-06, knowledge-18, sessions-kinds-20) — resolve the anchor
 * project of `<kindDirName>/<sessionId>` when the caller did not supply one
 * (a deep link with no `?project=`, or a cancel POST with no body.project).
 * Enumerates the REAL on-disk project names under the trusted `projectsRoot`
 * (server-enumerated — never a client string; dot-anchors such as
 * `.kb-<id>` / `.community-registry` are real session homes and are
 * INCLUDED), skips any name `invalidProjectReason` would refuse (so an
 * escaping/odd directory can never become a resolved project), and checks
 * each candidate through the SAME `resolveGuardedPath` choke point every
 * other session read here uses (`ok && exists`, an escaping symlink is
 * simply not a match). Exactly one hit resolves; zero is `not-found`; two
 * or more is `ambiguous` (the caller 409s and asks for `?project=` — the
 * response never names the candidates, so this is not a project-name
 * oracle beyond what the aggregate index already lists).
 */
export function findSessionProject(
  projectsRoot: string,
  kindDirName: string,
  sessionId: string,
): { ok: true; project: string } | { ok: false; reason: 'not-found' | 'ambiguous' } {
  // `projectsRoot` is the config-derived trusted root (never request data);
  // enumerating it raw mirrors `collectStudioSessionIndexRows`
  // (cli/ui-bridge.ts) exactly — the per-candidate check below is what is
  // guarded, and every candidate name is server-enumerated.
  let names: string[];
  try {
    names = readdirSync(projectsRoot);
  } catch {
    names = [];
  }
  const hits: string[] = [];
  for (const name of names) {
    if (invalidProjectReason(name) !== null) continue;
    const guarded = resolveGuardedPath(projectsRoot, [name, kindDirName, sessionId]);
    if (guarded.ok && guarded.exists) hits.push(name);
  }
  if (hits.length === 1) return { ok: true, project: hits[0] };
  return { ok: false, reason: hits.length === 0 ? 'not-found' : 'ambiguous' };
}

// ---------------------------------------------------------------------------
// W6-B2 review fix (MEDIUM 2) — terminal-phase gate for ensureSessionTail
// ---------------------------------------------------------------------------

/**
 * True iff `phase` is a TERMINAL phase for this session kind — a session at
 * a terminal phase never appends further events, so tailing it would spin a
 * permanent, never-stopping 200ms poll (ensureTailFor's `setInterval`) that
 * only stops when the LAST WS client of the whole bridge disconnects (there
 * is no per-tail teardown), not when this one session is done. Mirrors the
 * legacy per-kind list routes' existing terminal-phase filter
 * (`cli/ui-bridge.ts`'s four `if (s.phase !== ...) ctx.ensureSessionTail(...)`
 * guards) — this is the SAME gate, applied at this route's own choke point,
 * not a re-invented one. Exported (W6-B11) so the aggregate sessions-index
 * collector (`cli/ui-bridge.ts`'s `collectStudioSessionIndexRows`) reuses
 * this SAME derivation for its own `terminal` field — no second, hand-kept
 * terminal-phase notion.
 *
 * Derives, never hand-writes a new list — checked in order:
 *   1. A descriptor carrying EITHER a `turnSpec` (kb-cleanup, authoring) OR a
 *      `panel` (demo, instructions, onboarding — the legacy kinds' read-only
 *      twin, ADR-043 2026-08-15 amendment §2) derives its terminal set from
 *      THAT table — any phase whose row declares `step: 'terminal'` (the
 *      ADR-043 state-machine's own "this is where it stops" marker, already
 *      validated by validateSessionKinds to have at least one such row —
 *      CHECK_TURNSPEC_NO_TERMINAL_PHASE / CHECK_PANEL_NO_TERMINAL_PHASE).
 *      Mirrors `deriveSessionAffordances`'s own `turnSpec?.phases ??
 *      panel?.phases` precedent exactly (orchestrator/studio/session-kinds.
 *      ts) — a rename/addition of a terminal phase in studio/session-
 *      kinds.yaml is picked up automatically, with no code change here.
 *      Verified behavior-preserving for instructions/demo (both predate
 *      W6-B3's panel tables and already had a `LEGACY_SESSION_TERMINAL_
 *      PHASES` row): their panel tables list EXACTLY the same terminal
 *      phases as that legacy row (instructions: committed/rejected; demo:
 *      locked/abandoned), so step 1 and step 2 agree for both — never
 *      actually reached via step 2 for either kind.
 *   2. A descriptor with NEITHER table (architect, project-brain — the two
 *      kinds that predate both) falls back to `LEGACY_SESSION_TERMINAL_PHASES`
 *      (cli/bridge-studio.ts) — the SAME constant the legacy list routes
 *      import instead of hand-writing their own inline literals.
 *   3. Any OTHER kind with neither source has no terminal-phase signal at
 *      all — treated as never-terminal (`false`), never a guess.
 *
 * Landed independently in both W6-B8 and W6-B11 (merge-reconciled, same
 * fix): this function previously checked ONLY `descriptor.turnSpec` before
 * falling to the legacy table — a `panel`-carrying descriptor (demo/
 * instructions/onboarding, all three added by W6-B3 after this function was
 * first written) fell straight through to `LEGACY_SESSION_TERMINAL_PHASES`,
 * which has no 'onboarding' row at all: onboarding was therefore reported
 * non-terminal at every phase, including its own declared-terminal
 * 'complete'/'failed' rows (`writeSessionTerminalPhase`'s own two literal
 * terminal values, cli/agent-run.ts). Checking `panel` here closes that gap
 * the same way `deriveSessionAffordances` already treats `panel` as a
 * first-class phase-table source.
 */
export function isTerminalPhase(descriptor: SessionKindDescriptor, phase: string): boolean {
  // W7-A2 (ADR-043 2026-08-19 amendment §1) — the ONE universal reserved
  // terminal phase, checked FIRST for every kind: written only by the
  // generic cancel route (cli/bridge-studio-lifecycle.ts), never by any
  // runner, and deliberately absent from every per-kind table (see
  // CANCELLED_PHASE's own doc comment, cli/bridge-studio.ts).
  if (phase === CANCELLED_PHASE) return true;
  const phases = descriptor.turnSpec?.phases ?? descriptor.panel?.phases;
  if (phases !== undefined) {
    return phases.some((p) => p.step === 'terminal' && p.phase === phase);
  }
  return LEGACY_SESSION_TERMINAL_PHASES[descriptor.id]?.has(phase) ?? false;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleStudioSessionsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: SessionsRouteContext,
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

    // W7-A2 — `?project=` is OPTIONAL: when present it is validated exactly
    // as before; when absent the anchor project is resolved server-side via
    // `findSessionProject` (below), so a deep link that omits it (or names
    // no guessable dot-anchor like `.kb-cycles`) still resolves.
    const projectRaw = parseQuery(rawUrl).get('project');
    if (projectRaw !== null) {
      const projectInvalidReason = invalidProjectReason(projectRaw);
      if (projectInvalidReason) {
        sendJson(res, 400, { error: projectInvalidReason }, origin);
        return true;
      }
    }

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
    let project: string;
    if (projectRaw !== null) {
      project = projectRaw;
    } else {
      const found = findSessionProject(projectsRoot, kindDirName, sessionId);
      if (!found.ok) {
        if (found.reason === 'ambiguous') {
          sendJson(res, 409, { error: `session "${sessionId}" (kind "${kind}") exists under more than one project — pass ?project= to disambiguate`, kind, sessionId }, origin);
        } else {
          sendJson(res, 404, { error: 'session not found', kind, sessionId }, origin);
        }
        return true;
      }
      project = found.project;
    }
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

    // W6-B2 — live-tail this session's event log (idempotent; no-ops for a
    // kind whose runner never writes `_logs/_<kind>-<sid>/events.jsonl`, e.g.
    // 'onboarding', which dispatches through a different, already-streaming
    // mechanism — see cli/ui-bridge.ts's ensureSessionTail doc comment).
    // Gated on isTerminalPhase (review fix, MEDIUM 2): a terminal session
    // never appends further events, so tailing it would spin a permanent
    // 200ms poll with no per-tail teardown (ensureTailFor only stops ALL
    // tails together, on the last WS client disconnecting from the whole
    // bridge) — mirrors the legacy per-kind list routes' own terminal-phase
    // filter, derived (not re-invented) from the turnSpec table or
    // LEGACY_SESSION_TERMINAL_PHASES; see isTerminalPhase's own doc comment.
    if (!isTerminalPhase(descriptor, phase)) ctx.ensureSessionTail(descriptor.id, sessionId);

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
      } else if (descriptor.artifact.kind === 'cleanup-plan') {
        // R4-19-F2 — the kb-cleanup session needs a LIVE, KB-scoped
        // brain-lint pass (derive-don't-store: the plan file on disk only
        // ever supplies the agent's PROPOSED actions, never current truth).
        // `kb_id` comes from the session's own status.json — an
        // unresolvable kb_id (the KB was deleted/renamed since the session
        // started) fails LOUD here, naming it, rather than falling through
        // to deriveSessionArtifact with no cleanupFindings (which would
        // throw a DIFFERENT, less specific error) or smoothing into a 200
        // with an empty artifact.
        const kbId = typeof statusParsed.kb_id === 'string' ? statusParsed.kb_id : null;
        if (kbId === null) {
          sendJson(res, 409, { ok: false, error: `session "${sessionId}" status.json has no string "kb_id" — cannot compute live cleanup findings` }, origin);
          return true;
        }
        let cleanupFindings: ReturnType<typeof computeAgentCleanupFindings>;
        try {
          cleanupFindings = computeAgentCleanupFindings(ctx.forgeRoot, kbId);
        } catch (findingsErr) {
          sendJson(res, 409, { ok: false, error: sanitizeError(findingsErr) }, origin);
          return true;
        }
        // R4-19-F2 fail-safe fix (ORCHESTRATOR RULING) — the scanned-domain
        // signal that makes 'cleared' derivable at all (see session-
        // transcript.ts's CleanupScan doc). Resolved via the SAME
        // `resolveKbBrainDir` choke point `computeAgentCleanupFindings`
        // itself already used, immediately above, to scope the live lint
        // pass — so `brainDir` names exactly the region that was actually
        // scanned. A TOCTOU miss (the KB vanishes between the two calls,
        // vanishingly unlikely) degrades to `cleanupScan` omitted, i.e.
        // every unmatched action stays 'unknown' — fail SAFE, never a hard
        // 500 for a signal that is advisory, not load-bearing for the
        // read's own success.
        const brainDir = resolveKbBrainDir(ctx.forgeRoot, kbId);
        const cleanupScan = brainDir !== null ? { forgeRoot: ctx.forgeRoot, brainDir } : undefined;
        artifact = deriveSessionArtifact({ descriptor, sessionDir, cleanupFindings, cleanupScan });
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
        // W6-B3 (ADR-043 2026-08-15 amendment §1/§2) — the derived affordance
        // view for the CURRENT phase; see this file's header for the full
        // contract note. Computed unconditionally (never omitted) — a kind
        // with no turnSpec/panel (architect) yields `[]`, not a missing key.
        affordances: deriveSessionAffordances(descriptor, phase),
        // W6-B6 (ADR-043 2026-08-15 amendment §3) — see this file's header
        // note. Read directly off the already-parsed `statusParsed`, the
        // SAME realpath-guarded read every other field on this envelope
        // comes from; never a second, unguarded status read.
        modelTier: typeof statusParsed.modelTier === 'string' ? statusParsed.modelTier : null,
        // W6-B8 — the SAME `isTerminalPhase` derivation this route already
        // used internally to gate `ensureSessionTail` (this file's header),
        // now also threaded onto the wire (ALWAYS present, never omitted —
        // mirrors `affordances`' own unconditional presence) so the generic
        // `SessionInteractivePanel` can gate its ActivityLog drawer without a
        // second, hand-kept terminal-phase table client-side.
        terminal: isTerminalPhase(descriptor, phase),
        // W7-A2 — the DERIVED lifecycle view (cli/bridge-studio-lifecycle.ts):
        // state (working | awaiting-operator | crashed | stalled | terminal),
        // a truthful `needsYou`, the runner's crash text read live off
        // `_logs/_<kind>-<sid>/stderr.log`, idle time, and cancellability.
        // Derived at read time from the phase row + on-disk liveness facts —
        // nothing here is ever stored on status.json (derive-don't-store).
        // ALWAYS present, mirroring `affordances`/`terminal`.
        lifecycle: deriveSessionLifecycleFor({
          descriptor, phase, terminal: isTerminalPhase(descriptor, phase), project, sessionId, projectsRoot, logsRoot: ctx.logsRoot,
        }),
      },
      origin,
    );
    return true;
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
    return true;
  }
}
