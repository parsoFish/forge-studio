/**
 * Resolving a session request to a session directory — the whole chain from an
 * untrusted `:kind`/`:sessionId`/`project` triple to a contained, readable
 * session on disk, and the readability rule that decides whether a caller may
 * see it at all.
 *
 * Split out of `bridge-studio-sessions.ts` (M4 exit row 5). It is the leaf that
 * file's route arms stand on: nothing here reaches back into the route, and the
 * cycle check on the seam reports ZERO references from this module to what
 * stayed behind. Five other modules already imported these symbols through the
 * route file, which is what made the seam obvious.
 *
 * Every guard here runs BEFORE any fs call, and in this order: length cap, then
 * charset, then `resolveGuardedPath` containment. `status.json` is read only
 * through `safeReadFileInSession`'s realpath-guarded choke point — never
 * `readSessionStatus`, whose plain existsSync/readFileSync would be a second,
 * unguarded read path that a symlinked status.json could leak through.
 */
import { readdirSync } from 'node:fs';

import { SAFE_ID_RE, KB_ID_RE, PROJECT_ID_RE, MAX_EXACT_ID_LENGTH, resolveGuardedPath } from '@forge/kernel';
import type { SessionKindDescriptor } from './studio/session-kinds.ts';
import { MAX_SKILL_ID_LENGTH } from '@forge/agents/skill-path.ts';
import { KB_SEEDING_ANCHOR_PREFIX } from '@forge/knowledge/bridge-studio-kbs.ts';
import { LEGACY_SESSION_TERMINAL_PHASES, CANCELLED_PHASE } from './session-phases.ts';
import { safeReadFileInSession } from './studio/session-transcript.ts';
import { resolveLegacySession } from './session-readability.ts';

/** `status.json`'s filename, relative to a session dir — read via
 *  `safeReadFileInSession` (the SAME realpath-guarded choke point
 *  session-transcript.ts uses for every other session file), never via
 *  `readSessionStatus` (packages/sessions/interactive-session.ts): that helper
 *  does a plain existsSync/readFileSync with no realpath containment, which
 *  is a second, unguarded read path — a symlinked status.json pointing
 *  outside the session dir would leak its content into this route. One
 *  choke point for every file this route reads out of a session dir. */
const STATUS_FILENAME = 'status.json';

/** Hard length caps on the two path-derived inputs — the same value and
 *  rationale as `MAX_SKILL_ID_LENGTH` (packages/agents/skill-path.ts), imported
 *  rather than re-declared: without a cap, a charset-valid but absurdly long
 *  id sails past SAFE_ID_RE/PROJECT_ID_RE and only dies later as an opaque fs error
 *  (or, worse, a resource-exhaustion vector) instead of an actionable 400. No
 *  real session id or project slug is remotely close to this length. */
const MAX_SESSION_ID_LENGTH = MAX_SKILL_ID_LENGTH;
const MAX_PROJECT_ID_LENGTH = MAX_EXACT_ID_LENGTH;
// ---------------------------------------------------------------------------
// Input validation — length cap THEN charset, both before any fs call.
// ---------------------------------------------------------------------------

/** Decode a URL path segment; never silently passes through a raw,
 *  still-encoded value — throws on malformed percent-encoding (mirrors
 *  bridge-studio-templates.ts's `decodeIdSegment`). */
export function decodeSegment(raw: string): string {
  return decodeURIComponent(raw);
}

// Exported (cli-side, uncapped — ADR 042) so apps/forge/ui-bridge.ts's kb-cleanup
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

// W6-CR-3 (HISTORY) — the retired community-refresh kind's anchor: ONE fixed,
// dot-prefixed pseudo-project (unparameterized, unlike KB_SEEDING_ANCHOR_PREFIX
// below, because there was exactly one community registry forge-wide). It never
// surfaced as a phantom project — `discoverProjects` filters dot-prefixed dirs.
// Its kickoff route and verdict dispatch are gone (W8-B5b) but the constant
// STAYS EXPORTED for two live reasons: `invalidProjectReason`'s carve-out below
// keeps pre-retirement sessions reachable, and forge-ui's session-shell
// back-link maps it to `/community` via a parity test against this SSOT
// (apps/studio/lib/session-shell-view.test.ts).
export const COMMUNITY_REFRESH_PROJECT_ANCHOR = '.community-registry';

// W6-B9 reviewer fix — the general invariant this file's own KB-seeding
// carve-out comment (below) and W6-CR-3's comment (above) both already
// state: `discoverProjects` (@forge/kernel/project-layout.ts) filters EVERY
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
// (packages/kernel/path-guard.ts), the repo's one shared per-segment IDENTITY
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
  // (apps/forge/ui-bridge.ts) exactly — the per-candidate check below is what is
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
 *     `<logsRoot>/_<kind>-<sessionId>/`, survives (see packages/sessions/session-readability.ts
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
 * (`apps/forge/ui-bridge.ts`'s four `if (s.phase !== ...) ctx.ensureSessionTail(...)`
 * guards) — this is the SAME gate, applied at this route's own choke point,
 * not a re-invented one. Exported (W6-B11) so the aggregate sessions-index
 * collector (`apps/forge/ui-bridge.ts`'s `collectStudioSessionIndexRows`) reuses
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
 *      (apps/forge/bridge-studio.ts) — the SAME constant the legacy list routes
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
 * terminal values, packages/agents/agent-run.ts). Checking `panel` here closes that gap
 * the same way `deriveSessionAffordances` already treats `panel` as a
 * first-class phase-table source.
 */
export function isTerminalPhase(descriptor: SessionKindDescriptor, phase: string): boolean {
  // W7-A2 (ADR-043 2026-08-19 amendment §1) — the ONE universal reserved
  // terminal phase, checked FIRST for every kind: written only by the
  // generic cancel route (packages/sessions/bridge-studio-lifecycle.ts), never by any
  // runner, and deliberately absent from every per-kind table (see
  // CANCELLED_PHASE's own doc comment, apps/forge/bridge-studio.ts).
  if (phase === CANCELLED_PHASE) return true;
  const phases = descriptor.turnSpec?.phases ?? descriptor.panel?.phases;
  if (phases !== undefined) {
    return phases.some((p) => p.step === 'terminal' && p.phase === phase);
  }
  return LEGACY_SESSION_TERMINAL_PHASES[descriptor.id]?.has(phase) ?? false;
}
