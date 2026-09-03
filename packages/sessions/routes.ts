/**
 * routes.ts — this package's `/api/*` routes, as an ordered table.
 *
 * M4 §4 step 2. The table is a FACTORY rather than a constant because three of
 * these routes act on the LIVE BRIDGE — they start a tail on its WS fan-out and
 * broadcast to its connections — and those are per-instance values that do not
 * exist at module load. T1 ruling 59 settles the shape: `apps/forge/routes.ts`
 * exports `makeRouteTable(deps)` and the host calls it once, when it builds its
 * own context. Nothing about `RouteContext` or `dispatchRoute` changes, so no
 * other package's table or contract test moves.
 *
 * The alternative — widening the shared `RouteContext` with these hooks, the way
 * ruling 30 added `readBody` — was rejected deliberately. `readBody` is request
 * policy every route may need; `ensureSessionTail` is one package's vocabulary,
 * and the seam exists to keep that out of the context every package receives.
 *
 * ORDER is part of the contract: `dispatchRoute` is first-match-wins, and
 * `tests/contract/routes-table.test.ts` pins which entry claims each colliding
 * URL rather than merely asserting both exist.
 */
import type { IncomingMessage } from 'node:http';

import type { RouteContext, RouteTable } from '@forge/kernel';
import { pathOnly } from '@forge/kernel';
import { handleArchitectRoutes } from './bridge-studio-architect.ts';
import { handleInstructionsRoutes } from './bridge-studio-instructions.ts';
import type { InstructionsStatus } from './instructions-runner.ts';
import { handleProjectBrainRoutes, type ProjectBrainRow } from './bridge-studio-project-brain.ts';
import { handleKickoffRoutes } from './bridge-studio-kickoff.ts';
import { handleDemoRoutes } from './bridge-studio-demo.ts';
import type { DemoBuilderStatus } from './demo-builder-runner.ts';
import type { SessionHostSurface } from './bridge-studio-session-helpers.ts';
import { handleStudioSessionsRoutes } from './bridge-studio-sessions.ts';
import { handleSessionCancelRoute } from './bridge-studio-session-cancel.ts';
import { handleStudioAgentCapabilityRoute } from './bridge-studio-agent-capability.ts';

/**
 * The bridge-instance state these routes need, declared HERE (ruling 59 §2) so
 * sessions vocabulary never enters `@forge/kernel` or another package. The host
 * supplies the real closures at assembly; the composition of every package's
 * deps type is `apps/forge/routes.ts`'s parameter.
 */
export type SessionsRouteDeps = {
  /** Idempotently start live-tailing a session kind's event log on this
   *  bridge's WS fan-out. A host effect: there is nothing to derive it from. */
  readonly ensureSessionTail: (kind: string, sessionId: string) => void;
  /** Broadcast the per-kind `*-list-changed` WS message after a mutation, so an
   *  open bespoke panel refetches without waiting for its poll. A kind with no
   *  such message in the bridge's vocabulary honestly no-ops. */
  readonly broadcastKindChanged: (kind: string) => void;
  /** The architect kind's own list-changed broadcast, which predates the generic
   *  one above and is what the architect screen actually listens for. */
  readonly broadcastArchitectChanged: () => void;
  /** The instructions kind's own list-changed broadcast. */
  readonly broadcastInstructionsChanged: () => void;
  /** Injected only until the session index collector carves — see
   *  `bridge-studio-instructions.ts`'s own note. */
  readonly listInstructionsSessions: (projectsRoot: string) => InstructionsStatus[];
  /** The project-brain kind's own list-changed broadcast. */
  readonly broadcastProjectBrainChanged: () => void;
  /** Injected only until the session index collector carves. */
  readonly listProjectBrainSessions: (projectsRoot: string) => ProjectBrainRow[];
  /** Host-owned and still host-used; see `bridge-studio-kickoff.ts`. */
  readonly newRunStamp: () => string;
  readonly safeInputKeyRe: RegExp;
  /** The demo kind's own list-changed broadcast. */
  readonly broadcastDemoChanged: () => void;
  /** Injected only until the session index collector carves. */
  readonly listDemoSessions: (projectsRoot: string) => DemoBuilderStatus[];
  /** This bridge's projects directory. Per-instance, and absent from the shared
   *  `RouteContext`, so it is injected rather than read off the context. */
  readonly projectsRoot: string;
} & SessionHostSurface;

/** Matching strips the query; handlers receive the RAW url and normalise for
 *  themselves, so an arm that later needs the query string still has it. */
const pathOf = pathOnly;

/**
 * Route literals live here (ruling 59 §6) so `dry-bridge-coverage`'s pairing
 * keeps working, and the matchers are the regexes of the arms they replace —
 * copied, not re-derived, because re-specifying a hand-written matcher during a
 * move is how a carve changes behaviour while every test stays green.
 */
const SESSION_READ_RE = /^\/api\/studio\/sessions\/([^/]+)\/([^/]+)$/;
const SESSION_CANCEL_RE = /^\/api\/studio\/sessions\/([^/]+)\/([^/]+)\/cancel$/;
const AGENT_CAPABILITY_RE = /^\/api\/studio\/agents\/([^/]+)\/capability$/;

/** The context the carved family handlers read: the shared `RouteContext`, the
 *  bridge closures this package declared above, and the host surface injected
 *  at assembly. Built once per request rather than per route so the families all
 *  see the same object. */
function familyContext(ctx: RouteContext, deps: SessionsRouteDeps) {
  return {
    forgeRoot: ctx.forgeRoot,
    logsRoot: ctx.logsRoot,
    // NOT `ctx.projectsRoot`: the shared `RouteContext` is `{forgeRoot, logsRoot,
    // readBody}` and nothing more, so a cast asserting the field exists compiles
    // and then reads `undefined` at runtime — every session list silently empty,
    // with no error anywhere. (Written as that cast first; the suite caught it.)
    // It is per-bridge state, so it arrives the same way the closures do.
    projectsRoot: deps.projectsRoot,
    readBody: () => ctx.readBody(),
    ensureSessionTail: deps.ensureSessionTail,
    broadcastArchitectChanged: deps.broadcastArchitectChanged,
    broadcastInstructionsChanged: deps.broadcastInstructionsChanged,
    listInstructionsSessions: deps.listInstructionsSessions,
    broadcastProjectBrainChanged: deps.broadcastProjectBrainChanged,
    listProjectBrainSessions: deps.listProjectBrainSessions,
    spawnAgentDispatch: deps.spawnAgentDispatch,
    newRunStamp: deps.newRunStamp,
    safeInputKeyRe: deps.safeInputKeyRe,
    broadcastDemoChanged: deps.broadcastDemoChanged,
    listDemoSessions: deps.listDemoSessions,
    spawnAgentTurn: deps.spawnAgentTurn,
    spawnAgentSpecs: deps.spawnAgentSpecs,
    safeParseJson: deps.safeParseJson,
    servedFileHeaders: deps.servedFileHeaders,
    dryBridgeAgentTurnMarker: deps.dryBridgeAgentTurnMarker,
    isContainedProjectRepoPath: deps.isContainedProjectRepoPath,
  };
}

/** `/api/architect/*` — five routes, one entry each so `dry-bridge-coverage`
 *  keeps a classification per URL; all five delegate into the carved family
 *  module, which holds the arms verbatim. */
const ARCHITECT_FILE_RE = /^\/api\/architect\/file\//;
const INSTRUCTIONS_FILE_RE = /^\/api\/instructions\/file\//;
const PB_THEMES_RE = /^\/api\/project-brain\/themes\/([^/]+)\/([^/]+)$/;
const ONBOARDING_ACTIVE_RE = /^\/api\/studio\/projects\/([^/]+)\/onboarding\/active$/;
const KB_CLEANUP_START_RE = /^\/api\/studio\/kbs\/([^/]+)\/cleanup\/start$/;
const DEMO_SERVE_RE = /^\/api\/demo-builder\/demo\//;
const DEMO_FRAGMENT_RE = /^\/api\/demo-builder\/fragment\//;
const DEMO_GENERATION_RE = /^\/api\/demo-builder\/generation\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/;
const DEMO_HIST_LIST_RE = /^\/api\/demo-builder\/history\/([^/]+)$/;
const DEMO_HIST_SERVE_RE = /^\/api\/demo-builder\/history\/([^/]+)\/([^/]+)$/;

export function sessionsRoutes(deps: SessionsRouteDeps): RouteTable<RouteContext> {
  type Res = Parameters<RouteTable<RouteContext>[number]['handler']>[1];
  const arch = (req: IncomingMessage, res: Res, ctx: RouteContext, url: string, method: string) =>
    handleArchitectRoutes(req, res, familyContext(ctx, deps), url, method);
  const instr = (req: IncomingMessage, res: Res, ctx: RouteContext, url: string, method: string) =>
    handleInstructionsRoutes(req, res, familyContext(ctx, deps), url, method);
  const pbrain = (req: IncomingMessage, res: Res, ctx: RouteContext, url: string, method: string) =>
    handleProjectBrainRoutes(req, res, familyContext(ctx, deps), url, method);
  const kick = (req: IncomingMessage, res: Res, ctx: RouteContext, url: string, method: string) =>
    handleKickoffRoutes(req, res, familyContext(ctx, deps), url, method);
  const demo = (req: IncomingMessage, res: Res, ctx: RouteContext, url: string, method: string) =>
    handleDemoRoutes(req, res, familyContext(ctx, deps), url, method);
  return [
    {
      method: 'GET',
      path: '/api/architect/sessions',
      matches: (url) => pathOf(url) === '/api/architect/sessions',
      dryClassification: 'exempt-local',
      handler: arch,
    },
    {
      method: 'GET',
      path: '/api/architect/file/:project/:sessionId/*name',
      matches: (url) => ARCHITECT_FILE_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: arch,
    },
    {
      method: 'POST',
      path: '/api/architect/start',
      matches: (url) => pathOf(url) === '/api/architect/start',
      dryClassification: 'stub-actions',
      handler: arch,
    },
    {
      method: 'POST',
      path: '/api/architect/answer',
      matches: (url) => pathOf(url) === '/api/architect/answer',
      dryClassification: 'stub-actions',
      handler: arch,
    },
    {
      method: 'POST',
      path: '/api/architect/rerun',
      matches: (url) => pathOf(url) === '/api/architect/rerun',
      dryClassification: 'stub-actions',
      handler: arch,
    },
    {
      method: 'GET',
      path: '/api/instructions/sessions',
      matches: (url) => pathOf(url) === '/api/instructions/sessions',
      dryClassification: 'exempt-local',
      handler: instr,
    },
    {
      method: 'GET',
      path: '/api/instructions/file/:project/:sessionId/*name',
      matches: (url) => INSTRUCTIONS_FILE_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: instr,
    },
    {
      method: 'POST',
      path: '/api/instructions/start',
      matches: (url) => pathOf(url) === '/api/instructions/start',
      dryClassification: 'exempt-local',
      handler: instr,
    },
    {
      method: 'POST',
      path: '/api/instructions/brief',
      matches: (url) => pathOf(url) === '/api/instructions/brief',
      dryClassification: 'stub-actions',
      handler: instr,
    },
    {
      method: 'POST',
      path: '/api/instructions/answer',
      matches: (url) => pathOf(url) === '/api/instructions/answer',
      dryClassification: 'stub-actions',
      handler: instr,
    },
    {
      method: 'POST',
      path: '/api/instructions/verdict',
      matches: (url) => pathOf(url) === '/api/instructions/verdict',
      dryClassification: 'stub-actions',
      handler: instr,
    },
    {
      method: 'GET',
      path: '/api/project-brain/sessions',
      matches: (url) => pathOf(url) === '/api/project-brain/sessions',
      dryClassification: 'exempt-local',
      handler: pbrain,
    },
    {
      method: 'GET',
      path: '/api/project-brain/themes/:project/:sessionId',
      matches: (url) => PB_THEMES_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: pbrain,
    },
    {
      method: 'POST',
      path: '/api/project-brain/start',
      matches: (url) => pathOf(url) === '/api/project-brain/start',
      dryClassification: 'exempt-local',
      handler: pbrain,
    },
    {
      method: 'POST',
      path: '/api/project-brain/brief',
      matches: (url) => pathOf(url) === '/api/project-brain/brief',
      dryClassification: 'stub-actions',
      handler: pbrain,
    },
    {
      // approve and abandon SHARE one host arm and therefore one handler, but
      // they get their own entries: approve spawns (stub-actions), abandon does
      // not (exempt-local). One entry would have to claim a single
      // classification and lie about the other.
      method: 'POST',
      path: '/api/project-brain/approve',
      matches: (url) => pathOf(url) === '/api/project-brain/approve',
      dryClassification: 'stub-actions',
      handler: pbrain,
    },
    {
      method: 'POST',
      path: '/api/project-brain/abandon',
      matches: (url) => pathOf(url) === '/api/project-brain/abandon',
      dryClassification: 'exempt-local',
      handler: pbrain,
    },
    {
      method: 'POST',
      path: '/api/studio/onboarding/start',
      matches: (url) => pathOf(url) === '/api/studio/onboarding/start',
      dryClassification: 'stub-actions',
      handler: kick,
    },
    {
      method: 'GET',
      path: '/api/studio/projects/:project/onboarding/active',
      matches: (url) => ONBOARDING_ACTIVE_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: kick,
    },
    {
      // HANDOFF L12 (library -> sessions). It wears library's URL prefix but it
      // MINTS a session, and ruling 17 puts such a route with the sessions kind.
      method: 'POST',
      path: '/api/studio/authoring/start',
      matches: (url) => pathOf(url) === '/api/studio/authoring/start',
      dryClassification: 'stub-actions',
      handler: kick,
    },
    {
      // HANDOFF K10 (knowledge -> sessions). The 18th KB route, implemented
      // inline in the host and so invisible to the KB seam's handler-file-derived
      // list of 17. Anchored at a different segment count from knowledgeRoutes'
      // own KB patterns; the contract test pins that disjointness against the
      // ASSEMBLED table rather than assuming it.
      method: 'POST',
      path: '/api/studio/kbs/:kbId/cleanup/start',
      matches: (url) => KB_CLEANUP_START_RE.test(pathOf(url)),
      dryClassification: 'stub-actions',
      handler: kick,
    },
    {
      method: 'GET',
      path: '/api/demo-builder/sessions',
      matches: (url) => pathOf(url) === '/api/demo-builder/sessions',
      dryClassification: 'exempt-local',
      handler: demo,
    },
    {
      method: 'GET',
      path: '/api/demo-builder/demo/:project/:sessionId',
      matches: (url) => DEMO_SERVE_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: demo,
    },
    {
      method: 'GET',
      path: '/api/demo-builder/fragment/:project/:sessionId/:element',
      matches: (url) => DEMO_FRAGMENT_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: demo,
    },
    {
      // MUST precede the two history matchers: this one is four segments after
      // the prefix, they are one and two, so they do not actually collide — but
      // the ordering is pinned rather than left to the regexes' luck.
      method: 'GET',
      path: '/api/demo-builder/generation/:project/:sessionId/:n/:file',
      matches: (url) => DEMO_GENERATION_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: demo,
    },
    {
      // Two segments BEFORE one segment: `/history/:project/:id` must be tried
      // before `/history/:project`, or the shorter pattern claims neither — the
      // host chain had them in this order and the order is part of the contract.
      method: 'GET',
      path: '/api/demo-builder/history/:project/:id',
      matches: (url) => DEMO_HIST_SERVE_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: demo,
    },
    {
      method: 'GET',
      path: '/api/demo-builder/history/:project',
      matches: (url) => DEMO_HIST_LIST_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: demo,
    },
    {
      method: 'POST',
      path: '/api/demo-builder/start',
      matches: (url) => pathOf(url) === '/api/demo-builder/start',
      dryClassification: 'exempt-local',
      handler: demo,
    },
    {
      method: 'POST',
      path: '/api/demo-builder/brief',
      matches: (url) => pathOf(url) === '/api/demo-builder/brief',
      dryClassification: 'stub-actions',
      handler: demo,
    },
    {
      method: 'POST',
      path: '/api/demo-builder/feedback',
      matches: (url) => pathOf(url) === '/api/demo-builder/feedback',
      dryClassification: 'stub-actions',
      handler: demo,
    },
    {
      method: 'POST',
      path: '/api/demo-builder/lock',
      matches: (url) => pathOf(url) === '/api/demo-builder/lock',
      dryClassification: 'stub-actions',
      handler: demo,
    },
    {
      method: 'POST',
      path: '/api/demo-builder/abandon',
      matches: (url) => pathOf(url) === '/api/demo-builder/abandon',
      dryClassification: 'stub-actions',
      handler: demo,
    },
    {
      method: 'GET',
      path: '/api/studio/sessions/:kind/:sessionId',
      matches: (url) => SESSION_READ_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: (req, res, ctx, url, method) =>
        handleStudioSessionsRoutes(
          req,
          res,
          { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot, ensureSessionTail: deps.ensureSessionTail },
          url,
          method,
        ),
    },
    {
      // MUST precede any three-segment matcher for this URL family. The
      // affordance route's regex is a bare `([^/]+)/([^/]+)/([^/]+)` and would
      // swallow the literal `cancel` as an affordance id, answering 409 with a
      // 200-shaped body — the wrong handler returning a plausible answer, which
      // is the carve defect that leaves nothing red. That route is still a host
      // arm, and the table is dispatched BEFORE the host's chain, so ordering
      // holds today; the contract test pins it against the ASSEMBLED table so it
      // keeps holding when the affordance route joins this one.
      method: 'POST',
      path: '/api/studio/sessions/:kind/:sessionId/cancel',
      matches: (url) => SESSION_CANCEL_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: (req, res, ctx, url, method) =>
        handleSessionCancelRoute(
          req,
          res,
          { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot, broadcastKindChanged: deps.broadcastKindChanged },
          url,
          method,
        ),
    },
    {
      method: 'GET',
      path: '/api/studio/agents/:slug/capability',
      matches: (url) => AGENT_CAPABILITY_RE.test(pathOf(url)),
      dryClassification: 'exempt-local',
      handler: (req, res, ctx, url, method) =>
        handleStudioAgentCapabilityRoute(req, res, { forgeRoot: ctx.forgeRoot, logsRoot: ctx.logsRoot }, url, method),
    },
  ];
}
