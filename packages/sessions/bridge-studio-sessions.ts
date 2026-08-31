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
 *     `T`) which a lowercase-only slug rule rejects. `project` is validated
 *     with the ONE case-preserving id rule (PROJECT_ID_RE; a `.kb-<id>`
 *     seeding anchor with KB_ID_RE — W7-A4 / W7-FIX-A4). Exact precedent:
 *     cli/bridge-studio-runs.ts's plan-verdict route. BOTH are validated
 *     (length cap + charset) BEFORE any fs call.
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
 * W8-F6 (bead forge-6gv.27) — READ existence and WRITE existence are different
 * questions, deliberately. This GET serves a legacy session (working dir gone,
 * central event log intact) as 200; the cancel route
 * (cli/bridge-studio-session-cancel.ts) and the affordance dispatch
 * (cli/bridge-studio-affordances.ts) still 404 the same session, because THEIR
 * question is "is there a session dir to write into?" and the honest answer is
 * no. Both 404 BEFORE any write, so no phantom session dir is ever created for
 * one. The UI never puts an operator in front of that gap: a legacy session's
 * `lifecycle.cancellable` is false and its `affordances` are `[]`.
 *
 *   - `deriveSessionTranscript`'s `{ok:false}` (an unknown stage in a
 *     checkpoint, a malformed answers/questions/verdicts file) yields ZERO
 *     turns plus the verbatim reason on the ALWAYS-present `transcriptError`
 *     field — never smoothed into defaulted stages or a partial transcript,
 *     and (W7-C2 T1 review, P0-3) never a 409 that takes the whole page down
 *     with it: a corrupt verdicts.json used to make the session
 *     unrenderable, so the operator could not approve/reject/revise their
 *     way out of the very state that produced it. Fail-closed, scoped to the
 *     one pane. A `deriveSessionArtifact` throw (reserved artifact kind)
 *     surfaces as a 500 — never a 200 with an empty artifact.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, parseQuery, SAFE_ID_RE, LEGACY_SESSION_TERMINAL_PHASES, CANCELLED_PHASE, type StudioContext } from './bridge-studio.ts';
import { KB_ID_RE, PROJECT_ID_RE, MAX_EXACT_ID_LENGTH } from '../orchestrator/studio/validate.ts';
import { KB_SEEDING_ANCHOR_PREFIX, computeAgentCleanupFindings } from './bridge-studio-kbs.ts';
import { MAX_SKILL_ID_LENGTH } from '../orchestrator/skill-path.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import { loadSessionKinds, deriveSessionAffordances, type SessionKindDescriptor } from '../orchestrator/studio/session-kinds.ts';
import { deriveSessionTranscript, deriveSessionArtifact, safeReadFileInSession } from '../orchestrator/studio/session-transcript.ts';
import { resolveKbBrainDir } from '../orchestrator/brain-paths.ts';
import { deriveContractStages } from './contract-stages.ts';
import { resolveGuardedPath } from './studio-path-guard.ts';
import { deriveSessionLifecycleFor } from './bridge-studio-lifecycle.ts';
import { fixedTierForSessionKind } from './session-model-tier.ts';
import { resolveLegacySession } from './session-readability.ts';

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
 *  id sails past SAFE_ID_RE/PROJECT_ID_RE and only dies later as an opaque fs error
 *  (or, worse, a resource-exhaustion vector) instead of an actionable 400. No
 *  real session id or project slug is remotely close to this length. */
const MAX_SESSION_ID_LENGTH = MAX_SKILL_ID_LENGTH;
const MAX_PROJECT_ID_LENGTH = MAX_EXACT_ID_LENGTH;

const SESSION_ROUTE_RE = /^\/api\/studio\/sessions\/([^/]+)\/([^/]+)$/;

/** W6-B2 — this route is the generic "session-detail GET" EVERY session kind
 *  goes through (`apps/studio/app/sessions/[kind]/[sessionId]/page.tsx` calls
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

// W6-CR-3 (HISTORY) — the now-retired community-refresh interactive session
// kind (mechanism A; superseded by the deterministic `forge community
// refresh` / `POST /api/studio/community/refresh`, W8-B5) anchored under
// this ONE fixed, dot-prefixed pseudo-project (mirrors KB_SEEDING_ANCHOR_
// PREFIX's own non-project carve-out immediately below, but unparameterized:
// there was exactly ONE community registry, forge-wide, not N per-id KBs,
// so a single literal constant was the honest shape rather than a prefix +
// variable slug). `discoverProjects` (orchestrator/studio/registry.ts)
// already filters every dot-prefixed directory, so this anchor never
// surfaced as a phantom project. The kickoff route and verdict dispatch that
// used to import this are gone (W8-B5b), but the constant stays exported:
// `invalidProjectReason`'s carve-out below still recognizes it so sessions
// that finished under this anchor before retirement remain reachable, and
// forge-ui's session-shell "back to project" link (apps/studio/lib/session-
// shell-view.ts) still maps it to `/community` via a parity test against
// this SSOT (apps/studio/lib/session-shell-view.test.ts).
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
// apps/studio/lib/trigger-kind-parity.test.ts) — its own `isPseudoProjectAnchor`
// (apps/studio/lib/session-shell-view.ts) is a small, independently-declared
// mirror, kept honest by a parity test (apps/studio/lib/session-shell-view.test.ts).
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
  // make that session viewable/drivable, allow EXACTLY `.kb-<valid KB id>`
  // here, validating the post-prefix remainder with the SAME KB_ID_RE the
  // create + cleanup routes validate the id against (W7-FIX-A4 / W7A4-02:
  // the id rule is case-preserving and digit-leading-OK — `MyNotes`,
  // `2026-notes` — so the anchor charset MUST be that rule, or a session the
  // create route wrote is unreachable through both `?project=` and the bare
  // deep link). A `/`, `..`, NUL, `.`-leading, `-`-leading or empty
  // remainder still rejects — traversal defense is unchanged; this is never
  // a general leading-"." allow.
  if (id.startsWith(KB_SEEDING_ANCHOR_PREFIX)) {
    const anchorId = id.slice(KB_SEEDING_ANCHOR_PREFIX.length);
    if (KB_ID_RE.test(anchorId)) {
      return null;
    }
    return `invalid KB seeding anchor "${id}" — the id after "${KB_SEEDING_ANCHOR_PREFIX}" must match ${KB_ID_RE} (the KB id rule)`;
  }
  // W6-CR-3 (HISTORY, W8-B5b) — the SAME bounded carve-out for the retired
  // community-refresh kind's anchor: EXACTLY this one literal value is
  // allowed, never a general leading-"." exemption. The kind that used to
  // create sessions here is gone, but historical sessions still live on
  // disk under this anchor, so it must keep resolving.
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
// W8-F6 (bead forge-6gv.27) — THE ONE session-readability predicate
// ---------------------------------------------------------------------------

/**
 * The result of asking "is there anything at `<kind>/<sessionId>` this bridge
 * can honestly render?" — the SINGLE answer both this route and every producer
 * of a `/sessions/<kind>/<sid>` link is derived from.
 *
 * Two on-disk homes, in priority order:
 *
 *   - `source: 'status'` — the session's own working dir,
 *     `<projectsRoot>/<project>/_<kind>/<sessionId>/`, with a readable
 *     `status.json` carrying a string `phase`. The full, live shape: transcript,
 *     artifact, affordances, everything. Unchanged from before W8-F6.
 *   - `source: 'legacy'` — only the runner's central log dir,
 *     `<logsRoot>/_<kind>-<sessionId>/`, survives (see cli/session-readability.ts
 *     for why: (2) is never pruned, (1) lives inside a gitignored project tree
 *     that is routinely deleted). Read-only, honest, no live affordances.
 *
 * The `status-missing` / `status-no-phase` rejection reasons exist for exactly
 * one purpose: so the route can keep emitting the two 404 message buckets
 * AT-70..74 pin, byte-identical, for a project-side session dir whose
 * `status.json` is unusable AND which has no log dir to fall back to. They are
 * never surfaced to a client verbatim.
 */
export type ReadableSession =
  | { ok: true; source: 'status'; project: string; sessionDir: string; status: Record<string, unknown>; phase: string }
  | { ok: true; source: 'legacy'; project: string; logDir: string; phase: string }
  | { ok: false; reason: 'not-found' | 'ambiguous' | 'status-missing' | 'status-no-phase'; project: string | null };

/**
 * Resolve a session to whichever of its two on-disk homes can be read.
 *
 * `kind` MUST already have been resolved against the live registry and
 * `sessionId` MUST already have passed `invalidSessionIdReason`; this function
 * re-guards every filesystem touch regardless (`resolveGuardedPath`, per-segment
 * identity walk + `nlink===1` leaf), so a caller that forgets cannot escape —
 * it can only get a `not-found`.
 *
 * Order, and why: the project-side status shape WINS. A session that still has
 * its working dir is the live, complete thing; the log dir is the fallback, not
 * a competing source. Falling back only when the status read genuinely fails
 * also means this function's behaviour for every pre-W8-F6 session is
 * bit-for-bit what the route did before.
 */
export function resolveReadableSession(args: {
  projectsRoot: string;
  logsRoot: string;
  kind: string;
  sessionId: string;
  /** The caller's explicit `?project=` when it supplied one — already
   *  `invalidProjectReason`-validated by the route. `null`/absent means
   *  "resolve it server-side". */
  project?: string | null;
}): ReadableSession {
  const { projectsRoot, logsRoot, kind, sessionId } = args;
  const kindDirName = `_${kind}`;

  let project: string | null = args.project ?? null;
  // Adversarial review, finding 1 — PRESENCE of a `?project=` is not evidence
  // that it owns this session. Only a real `<project>/_<kind>/<sessionId>` dir
  // found below confirms ownership, and until W8-F6's own second review round
  // the unconfirmed caller value still reached the wire: for a Shape-B session
  // whose dir genuinely lives under project X, `?project=Y` came back as `Y`.
  // Not an existence oracle (a real-but-unrelated and a nonexistent name give
  // byte-identical 200s), but silent identity spoofing all the same.
  let projectConfirmed = false;
  if (project === null) {
    const found = findSessionProject(projectsRoot, kindDirName, sessionId);
    if (found.ok) {
      project = found.project;
    } else if (found.reason === 'ambiguous') {
      // Two projects genuinely hold this `_<kind>/<sid>` — the caller must
      // disambiguate. Never silently pick one, and never fall through to the
      // log dir, which would answer a DIFFERENT question than the one asked.
      return { ok: false, reason: 'ambiguous', project: null };
    }
  }

  // Remembered so a project-side dir with an unusable status.json AND no log
  // dir still 404s with the SAME message it did before W8-F6.
  let statusFailure: 'status-missing' | 'status-no-phase' | null = null;

  if (project !== null) {
    const sessionDir = resolveSafeSessionDir(projectsRoot, project, kindDirName, sessionId);
    if (sessionDir !== null) {
      // A real `_<kind>/<sessionId>` dir exists under this project — whether or
      // not it holds a usable status.json. THAT is what confirms ownership.
      projectConfirmed = true;
      // The SAME realpath-guarded choke point every other session file goes
      // through — never `readSessionStatus`'s unguarded existsSync/readFileSync
      // (see this file's header). An escaping symlink is indistinguishable from
      // "missing" here.
      const statusRaw = safeReadFileInSession(sessionDir, STATUS_FILENAME);
      let statusParsed: Record<string, unknown> | null = null;
      if (statusRaw !== null) {
        try {
          const parsed: unknown = JSON.parse(statusRaw);
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            statusParsed = parsed as Record<string, unknown>;
          }
        } catch {
          statusParsed = null; // malformed JSON — unreadable, never surfaced
        }
      }
      if (statusParsed === null) {
        statusFailure = 'status-missing';
      } else if (typeof statusParsed.phase !== 'string') {
        statusFailure = 'status-no-phase';
      } else {
        return { ok: true, source: 'status', project, sessionDir, status: statusParsed, phase: statusParsed.phase };
      }
    }
  }

  const legacy = resolveLegacySession({ logsRoot, kind, sessionId });
  if (legacy.ok) {
    // `projectFromLog` is RAW — it comes out of an on-disk log, which is not a
    // trusted input just because it is server-side. It goes through the ONE
    // project-id rule this module owns before it can reach the wire or any
    // filesystem call; anything that rule refuses becomes `''` (honest-absent),
    // never a guessed or partially-sanitised name.
    const derived = legacy.projectFromLog !== '' && invalidProjectReason(legacy.projectFromLog) === null
      ? legacy.projectFromLog
      : '';
    // Precedence, strongest evidence first, and NOTHING else reaches the wire:
    //   1. a CONFIRMED project — a real `_<kind>/<sessionId>` dir was found
    //      under it (Shape B: the dir survived, only status.json is gone);
    //   2. the session's own event log;
    //   3. `''`, honest-absent — forge-ui then renders no "back to project"
    //      link at all (`backToProjectLink('')`).
    // An UNCONFIRMED `?project=` is deliberately NOT in that list. It is a hint
    // about a directory that does not exist, and echoing it back let
    // `?project=<anything>` put `<anything>` on the wire — a dead "back to
    // project" link minted by the very route whose purpose is to stop minting
    // links to nowhere, and, for a Shape-B session, an unrelated real project
    // name displacing the genuine owner. Never assert a project we cannot
    // evidence.
    const legacyProject = projectConfirmed ? (project as string) : derived;
    return { ok: true, source: 'legacy', project: legacyProject, logDir: legacy.logDir, phase: legacy.phase };
  }

  return { ok: false, reason: statusFailure ?? 'not-found', project };
}

/** The boolean face of `resolveReadableSession`, for link producers: a
 *  `/sessions/<kind>/<sid>` href is worth minting only for a session this
 *  bridge can actually serve. Same resolution, same guards — never a second,
 *  cheaper "does the dir exist" probe that could disagree with the route. */
export function sessionIsReadable(args: {
  projectsRoot: string;
  logsRoot: string;
  kind: string;
  sessionId: string;
  project?: string | null;
}): boolean {
  return resolveReadableSession(args).ok;
}

/** The ONE place a `/sessions/<kind>/<sid>` URL is built server-side, so the
 *  aggregate index and this route can never disagree about the address of a
 *  session. */
export function sessionShellHref(kind: string, sessionId: string, project: string): string {
  const base = `/sessions/${encodeURIComponent(kind)}/${encodeURIComponent(sessionId)}`;
  return project === '' ? base : `${base}?project=${encodeURIComponent(project)}`;
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
// W7-C2 (sessions-kinds-17/19, bead forge-lzv) — pending interview questions
// on the wire. `deriveSessionAffordances` is a PURE function over the
// descriptor (it can never read the session dir), so the file-backed half of
// the question-form affordance — the actual pending questions.json — is
// attached HERE, at the one place that already owns the guarded session-dir
// reads. Attached ONLY at phase 'awaiting-answers' (the same pending rule
// `deriveSessionTranscript`'s own AWAITING_ANSWERS_PHASE constant encodes —
// hand-copied literal per that module's convention): any other phase means
// questions.json is stale leftover from a prior round. The panel renders one
// control per entry and posts the REAL question text back with each answer,
// which is what keeps the durable answers.json record honest.
// ---------------------------------------------------------------------------

type PendingQuestion = {
  /** W7-C2 T1 review (A3, finding sessions-kinds-19) — the CORRELATION
   *  handle. questions.json carries no authored id (the shape is the
   *  reflector's `StructuredQuestion`: question/header/options), so the one
   *  honest, stable identity a pending question has is its POSITION in the
   *  round's file — rendered here as `q<1-based index>`. Derived, never
   *  stored: the same file always yields the same ids, and nothing has to
   *  keep a second copy in sync. The panel posts it back with each answer
   *  and `handleInstructionsAnswer` re-derives it from the SAME file to
   *  cross-check, so an edited/duplicated question TEXT can no longer
   *  mis-bind an answer. */
  readonly id: string;
  readonly question: string;
  readonly header?: string;
  readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>;
};

/** The 1-based positional id for the question at `index` of a round's
 *  questions.json. Exported so the WRITE route (cli/bridge-studio-
 *  affordances.ts) derives answer-correlation ids from this ONE rule
 *  instead of re-deriving its own. */
export function pendingQuestionId(index: number): string {
  return `q${index + 1}`;
}

const AWAITING_ANSWERS_PHASE = 'awaiting-answers';
const QUESTIONS_FILENAME = 'questions.json';

/** Structural parse of questions.json for the WIRE (display data). The
 *  transcript derivation has already fail-closed the whole read on a
 *  malformed file by the time this runs, so this parser only needs to shape
 *  what survived: `question` must be a string; `header` optional; `options`
 *  must be an array whose every entry carries string label+description.
 *
 *  W7-C2 T1 review (A4) — EVERY malformed shape returns null (the whole
 *  field is then absent and the panel falls back to the free-text box),
 *  including a malformed OPTION entry. The prior `flatMap` silently dropped
 *  a bad option, showing the operator FEWER choices than the agent asked
 *  for with no signal — a silent partial in a module whose stated
 *  discipline is fail-closed. This now matches the CLIENT's own rule
 *  (`parsePendingQuestionsMeta`, apps/studio/lib/session-client.ts) exactly,
 *  so the stricter side is no longer unreachable behind a pre-sanitising
 *  server. */
export function parsePendingQuestions(raw: string): PendingQuestion[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const questions: PendingQuestion[] = [];
  for (const [index, entry] of parsed.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.question !== 'string') return null;
    if (rec.options !== undefined && !Array.isArray(rec.options)) return null;
    const optionsRaw = Array.isArray(rec.options) ? rec.options : [];
    const options: { label: string; description: string }[] = [];
    for (const o of optionsRaw) {
      if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
      const or = o as Record<string, unknown>;
      if (typeof or.label !== 'string' || typeof or.description !== 'string') return null;
      options.push({ label: or.label, description: or.description });
    }
    questions.push({
      id: pendingQuestionId(index),
      question: rec.question,
      ...(typeof rec.header === 'string' ? { header: rec.header } : {}),
      options,
    });
  }
  return questions;
}

/** Attach `meta.questions` onto the question-form affordance when (and only
 *  when) a pending questions.json exists at awaiting-answers. Every other
 *  affordance rides through untouched. */
function attachPendingQuestions(
  affordances: ReturnType<typeof deriveSessionAffordances>,
  sessionDir: string,
  phase: string,
): ReturnType<typeof deriveSessionAffordances> {
  if (phase !== AWAITING_ANSWERS_PHASE) return affordances;
  if (!affordances.some((a) => a.kind === 'question-form' && a.phase === AWAITING_ANSWERS_PHASE)) return affordances;
  const raw = safeReadFileInSession(sessionDir, QUESTIONS_FILENAME);
  if (raw === null) return affordances;
  const questions = parsePendingQuestions(raw);
  if (questions === null || questions.length === 0) return affordances;
  return affordances.map((a) =>
    a.kind === 'question-form' && a.phase === AWAITING_ANSWERS_PHASE
      ? { ...a, meta: { ...(a.meta ?? {}), questions } }
      : a,
  );
}

/** W7-C2 (sessions-kinds-36) — the persisted "what this session produced"
 *  pointer, read off status.json, plus `exists` — whether the object it
 *  points at is STILL THERE, derived at read time.
 *
 *  W7-C2 T1 review (P0-4) — `exists` closes the dangling-pointer half of
 *  this field: `FinalizedLink` used to emit `/skills/<id>` off the stored
 *  pointer alone, so a deleted or renamed object left the operator a dead
 *  link forever. The pointer's IDENTITY is genuinely new information the
 *  finalizer alone knows (which library id the operator chose), so it stays
 *  persisted; its LIVENESS is derived from the filesystem on every read —
 *  never a second stored copy that can go stale. */
export type FinalizedPointer = { kind: string; id: string; exists: boolean };

/** Where each finalized `kind` lands its object. The ONE table that answers
 *  "does the thing this session produced still exist" — every entry resolves
 *  through the same `resolveGuardedPath` choke point the rest of this module
 *  uses (or, for a KB, through `resolveKbBrainDir`, the SAME resolver the
 *  cleanup-plan artifact branch above already trusts). An unrecognised kind
 *  is NOT dropped from the wire — it rides through with `exists: false`, and
 *  the panel renders the honest label with no link (never a guessed href). */
function finalizedObjectExists(
  kind: string,
  id: string,
  opts: { forgeRoot: string; projectsRoot: string; project: string },
): boolean {
  const guarded = (root: string, segs: readonly string[]): boolean => {
    const g = resolveGuardedPath(root, segs);
    return g.ok && g.exists;
  };
  switch (kind) {
    case 'skill': return guarded(opts.forgeRoot, ['skills', id]);
    case 'hook': return guarded(opts.forgeRoot, ['studio', 'hooks', id]);
    case 'community-registry': return guarded(opts.forgeRoot, ['studio', 'community', 'registry.yaml']);
    // `agents-md`/`demo` name the PROJECT they landed in (instructions writes
    // AGENTS.md at the project repo root; demo's lock lands at
    // .forge/demo/demo.lock.json — DEMO_LOCK_REL_PATH,
    // orchestrator/demo-builder-runner.ts, hand-copied as segments here the
    // same way this module hand-copies AWAITING_ANSWERS_PHASE).
    case 'agents-md': return guarded(opts.projectsRoot, [id, 'AGENTS.md']);
    case 'demo': return guarded(opts.projectsRoot, [id, '.forge', 'demo', 'demo.lock.json']);
    case 'kb': return resolveKbBrainDir(opts.forgeRoot, id) !== null;
    default: return false;
  }
}

/** Anything but the exact {kind: string, id: string} shape collapses to null
 *  (never echoed raw). */
function deriveFinalized(
  statusParsed: Record<string, unknown>,
  opts: { forgeRoot: string; projectsRoot: string; project: string },
): FinalizedPointer | null {
  const raw = statusParsed.finalized;
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.kind !== 'string' || typeof rec.id !== 'string') return null;
  return { kind: rec.kind, id: rec.id, exists: finalizedObjectExists(rec.kind, rec.id, opts) };
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

    // W8-F6 (bead forge-6gv.27) — ONE predicate decides where this session
    // lives and whether it can be read at all: `resolveReadableSession` (this
    // file, above). It performs EXACTLY the project resolution + guarded
    // status read this route used to inline, and only then falls back to the
    // session's central log dir. Every rejection reason maps back onto the
    // SAME response this route sent before, byte-identical (AT-70..74 pin the
    // two status buckets; AT-F6-R3/R4 re-pin them from the outside).
    const resolved = resolveReadableSession({
      projectsRoot, logsRoot: ctx.logsRoot, kind: descriptor.id, sessionId, project: projectRaw,
    });
    if (!resolved.ok) {
      if (resolved.reason === 'ambiguous') {
        sendJson(res, 409, { error: `session "${sessionId}" (kind "${kind}") exists under more than one project — pass ?project= to disambiguate`, kind, sessionId }, origin);
        return true;
      }
      const error =
        resolved.reason === 'status-missing' ? 'session not found (status.json is missing, unreadable, or not valid JSON)'
        : resolved.reason === 'status-no-phase' ? 'session not found (status.json has no string "phase" field)'
        : 'session not found';
      // `project` is echoed only when one was actually resolved — the
      // no-project 404 stays exactly the two-field body it has always been.
      sendJson(res, 404, resolved.project !== null ? { error, kind, sessionId, project: resolved.project } : { error, kind, sessionId }, origin);
      return true;
    }

    const project = resolved.project;
    const phase = resolved.phase;
    // W8-F6 — TRUE iff the only surviving state is the central log dir. Such a
    // session is served READ-ONLY: no transcript (its sources are gone), no
    // affordances (there is nowhere to write a turn), no tail.
    const legacy = resolved.source === 'legacy';
    // `sessionDir` for a legacy session is its LOG dir — deliberately, and only
    // so `deriveSessionArtifact` below can run its ONE real derivation against
    // a directory that provably holds none of the files any renderer scans
    // (a log dir holds events.jsonl / stderr.log / .heartbeat / turn.pid /
    // cancel.json, and not one of `manifests/`, `themes/`, `generations/`,
    // `staging/`, `plan/cleanup-plan.md`, `AGENTS.draft.md` — the real names,
    // orchestrator/studio/session-transcript.ts:125,126,127,758,897,898;
    // enumerated on BOTH sides, zero intersection).
    // That yields each kind's genuine EMPTY artifact without a second,
    // hand-kept per-kind empty table here — pinned by AT-F6-R1.
    const sessionDir = resolved.source === 'status' ? resolved.sessionDir : resolved.logDir;
    const statusParsed: Record<string, unknown> | null = resolved.source === 'status' ? resolved.status : null;

    // W8-F6 — structural, not derived from the phase name: a legacy session has
    // no session dir left for a runner to advance or an affordance to write
    // into, so no further event can ever be appended to it, whatever phase its
    // log last recorded. `isTerminalPhase` still owns every OTHER session.
    const terminal = legacy ? true : isTerminalPhase(descriptor, phase);

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
    // W8-F6 — gated on the COMPUTED `terminal` (above), so a legacy session
    // never opens a permanent 200ms tail on a log nothing will ever append to.
    if (!terminal) ctx.ensureSessionTail(descriptor.id, sessionId);

    // W7-C2 T1 review (P0-3) — fail-closed, SCOPED. A malformed transcript
    // source yields ZERO turns plus the verbatim reason on `transcriptError`
    // (below) — never defaulted stages, never a partial transcript, and
    // never a 409 that takes the operator's verdict controls down with it.
    // See the `transcriptError` field comment for the full rationale.
    // W8-F6 — a legacy session has NO transcript sources to scan (the dir that
    // held them is gone), so the derivation is not run at all: zero turns, zero
    // sources scanned, and `transcriptError: null` — nothing REFUSED, there was
    // simply nothing there. Running it against the log dir would report the
    // same empty result by accident; skipping it says so on purpose.
    const transcriptResult = legacy ? null : deriveSessionTranscript({ descriptor, sessionDir, phase });
    const transcriptError = transcriptResult === null || transcriptResult.ok ? null : transcriptResult.error.message;
    const turns = transcriptResult !== null && transcriptResult.ok ? transcriptResult.turns : [];

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
      if (legacy) {
        // W8-F6 — the SAME derivation every other session goes through, handed
        // this session's log dir (see `sessionDir`'s note above). The two kinds
        // that REQUIRE caller-supplied data get honest empties: a legacy
        // onboarding/kb-cleanup session's stages and findings describe live
        // project/KB state that this dead session neither produced nor owns.
        artifact = deriveSessionArtifact({ descriptor, sessionDir, contractStages: [], cleanupFindings: [] });
      } else if (descriptor.artifact.kind === 'contract-buildout') {
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
        const kbId = typeof statusParsed?.kb_id === 'string' ? statusParsed.kb_id : null;
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
        turns,
        artifact,
        // W6-B3 (ADR-043 2026-08-15 amendment §1/§2) — the derived affordance
        // view for the CURRENT phase; see this file's header for the full
        // contract note. Computed unconditionally (never omitted) — a kind
        // with no turnSpec/panel (architect) yields `[]`, not a missing key.
        // W7-C2: the question-form affordance additionally carries the
        // PENDING questions at awaiting-answers (attachPendingQuestions —
        // file-backed data the pure derivation cannot read itself).
        // W8-F6 — a legacy session derives NO affordance: every affordance is a
        // control that writes into the session dir, and there is no session dir.
        // An empty array here is the honest answer, not a suppressed one.
        affordances: legacy ? [] : attachPendingQuestions(deriveSessionAffordances(descriptor, phase), sessionDir, phase),
        // W6-B6 (ADR-043 2026-08-15 amendment §3) — see this file's header
        // note. Read directly off the already-parsed `statusParsed`, the
        // SAME realpath-guarded read every other field on this envelope
        // comes from; never a second, unguarded status read.
        // W8-B3 (sessions-kinds-R06/31) — when the session recorded no tier,
        // fall back to the kind's agent's FIXED tier, derived live off its
        // SKILL.md. Scoped to `strategy:fixed` on purpose: such an agent has
        // exactly one legal tier, so a session of that kind provably ran on
        // it; a `strategy:range` agent's untiered session ran on whatever the
        // default was at the time, which today's default may no longer be, so
        // "not recorded" stays the honest answer there. Never stored — a
        // skill re-pointed at a different model cannot leave a stale copy.
        // W8-F6: a legacy session recorded no status.json at all, so it falls
        // straight to the kind's FIXED tier (derived live off the agent's
        // SKILL.md) or `null` — never a fabricated tier.
        modelTier: typeof statusParsed?.modelTier === 'string'
          ? statusParsed.modelTier
          : fixedTierForSessionKind(ctx.forgeRoot, descriptor),
        // W6-B8 — the SAME `isTerminalPhase` derivation this route already
        // used internally to gate `ensureSessionTail` (this file's header),
        // now also threaded onto the wire (ALWAYS present, never omitted —
        // mirrors `affordances`' own unconditional presence) so the generic
        // `SessionInteractivePanel` can gate its ActivityLog drawer without a
        // second, hand-kept terminal-phase table client-side.
        terminal,
        // W8-F6 (bead forge-6gv.27) — ALWAYS present, mirroring `terminal`:
        // this session's project-side working dir is gone and everything above
        // was derived from its central event log alone. The shell renders an
        // explicit read-only notice on it rather than an empty live session.
        legacy,
        // W8-B3 (ON-5) — REPLACES W7-FIX-A2's `transcript: descriptor.turnSpec
        // === undefined`. That boolean was a STORED PROXY for "does this kind
        // record turns", and it was factually wrong: its own comment claimed a
        // `turnSpec` kind "never writes the transcript files", but `authoring`
        // declares a turnSpec AND its start route (`writeAuthoringSession`,
        // cli/ui-bridge.ts) writes `prompt.md` before the generic spine ever
        // runs — so the wire said "records no turns" for a kind that records
        // one from second zero. Measured, not argued: driving the real writer
        // and the real derivation yields `turns=1, source=prompt.md`.
        //
        // What ships instead is the FACT, derived by the same reads that built
        // `turns`: which of the scanned candidate sources actually exist here.
        // The consumer (apps/studio/lib/session-shell-view.ts's
        // `deriveSessionPanes`) decides whether a transcript pane belongs from
        // `turns` + the live affordances — there is no longer any field for a
        // writer to leave a stale per-kind copy in. ALWAYS present, mirroring
        // `terminal`/`affordances`.
        transcriptSources: transcriptResult !== null && transcriptResult.ok ? [...transcriptResult.sourcesFound] : [],
        // W7-A2 — the DERIVED lifecycle view (cli/bridge-studio-lifecycle.ts):
        // state (working | awaiting-operator | crashed | stalled | terminal),
        // a truthful `needsYou`, the runner's crash text read live off
        // `_logs/_<kind>-<sid>/stderr.log`, idle time, and cancellability.
        // Derived at read time from the phase row + on-disk liveness facts —
        // nothing here is ever stored on status.json (derive-don't-store).
        // ALWAYS present, mirroring `affordances`/`terminal`.
        lifecycle: deriveSessionLifecycleFor({
          descriptor, phase, terminal, project, sessionId, projectsRoot, logsRoot: ctx.logsRoot,
        }),
        // W7-C2 (sessions-kinds-36) — ALWAYS present, mirroring
        // `modelTier`'s own null-is-honest convention: the persisted
        // {kind, id} pointer at whatever object a committed session
        // produced (runFinalize writes it; historically the now-retired
        // community-refresh kind's own approve arm did too — those old
        // sessions still carry the pointer on disk), or null for a session
        // that produced nothing.
        // W8-F6: no status.json ⇒ no persisted pointer ⇒ `null`, the same
        // honest-absent value a session that produced nothing already gets.
        finalized: statusParsed === null ? null : deriveFinalized(statusParsed, { forgeRoot: ctx.forgeRoot, projectsRoot, project }),
        // W7-C2 T1 review (P0-3, finding A2/F2) — the transcript's own
        // fail-closed error, SCOPED to the transcript. It used to 409 the
        // WHOLE session GET, which made a corrupt verdicts.json brick the
        // page: no verdict controls, so the operator could not approve,
        // reject or revise their way out of it. Fail-closed semantics are
        // unchanged (nothing malformed is ever silently dropped or
        // smoothed into fabricated turns — `turns` is EMPTY, never
        // partial), but the blast radius is now one pane: the shell still
        // renders, the affordances still work, and the transcript pane
        // shows this message verbatim. ALWAYS present, mirroring
        // `terminal`/`affordances`/`finalized`; null when the derivation
        // succeeded.
        transcriptError,
      },
      origin,
    );
    return true;
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
    return true;
  }
}
