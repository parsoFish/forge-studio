/**
 * routes.ts — `@forge/library`'s HTTP routes, as a table.
 *
 * M4 §4 step 2. These 31 routes used to reach their handlers through SEVEN
 * monolithic prefix dispatchers that `cli/ui-bridge.ts` called in sequence
 * (`:2365` skills, `:2366` hooks, `:2367` authoring, `:2368` templates,
 * `:2418` instructions, `:2422` connections, `:2423` community). Every one of
 * those dispatchers is now DELETED; nothing dispatches these routes but this
 * table, which `apps/forge/routes.ts` assembles and the host claims at
 * `cli/ui-bridge.ts:2094`, before its own switch.
 *
 * ORDER. `dispatchRoute` is first-match-wins, and knowledge's table pins its
 * one real collision (`drain/cancel` vs `drain/:runId`) by order. LIBRARY HAS
 * NO COLLISION: no two of these 31 share a method and both claim any one URL.
 * `dispatchRoute` filters on method BEFORE calling `matches`
 * (`packages/kernel/route-entry.ts:108`), and every same-method near-pair is
 * separated by segment count — `POST /skills/install` is two segments where
 * no `POST /skills/:id` exists; `/community/registry/items/:id` is three
 * segments past `community` where `:kind/:id` is two; the `{approve,override,
 * revoke-approval,probe,install}` forms are three where `/:id` is one. So an
 * order assertion would pin NOTHING here — it would pass under a swap. The
 * contract test pins the invariant that makes order irrelevant instead (no
 * two entries share a method and a URL), which fails the day an overlap is
 * added and names both rows; see `tests/contract/route-table.test.ts`.
 *
 * MATCHERS ARE IMPORTED, NOT RE-DECLARED — a deliberate divergence from
 * `packages/knowledge/routes.ts`, which re-declares its patterns "verbatim
 * from the if-chain arms they replace". Every library route's regex is
 * exported by the module that owns the handler and used in both places, so
 * there is ONE source per route. A duplicated regex edited on one side only
 * gives a table that matches while the handler declines: the request 404s
 * with nothing red, which is the same silent shape this carve exists to
 * remove.
 *
 * `dryClassification` — two provenances, stated separately because they are
 * NOT the same kind of claim:
 *   · A row carried VERBATIM from `cli/dry-bridge.ts`'s
 *     `BRIDGE_ROUTE_CLASSIFICATION`, with that table's line cited in the
 *     entry's comment. Eighteen of the twenty non-GET routes are these.
 *   · A route with no row there is `exempt-local` BY CONSTRUCTION, with the
 *     reason stated: it reads on-disk state and nothing else — no spawn, no
 *     remote call, no write. All eleven GETs are these; that table is
 *     mutating-route-focused (68 POST rows against 2 GET) and
 *     `dry-bridge-coverage.test.ts` skips GET candidates by design.
 *
 * TWO ROUTES THIS CARVE UN-BLINDED. `POST /api/studio/authoring/finalize` and
 * `POST /api/studio/agents/:slug/instructions-draft` are mutating routes that
 * `cli/dry-bridge.ts` had NEVER classified — not because they were exempt but
 * because `dry-bridge-coverage.test.ts` derives its candidates by reading
 * `url === '<literal>'` / `url.match(/…/)` arms, and both of these arms
 * compared against a module CONST instead (`FINALIZE_URL`,
 * `INSTRUCTIONS_DRAFT_ROUTE_RE`). Stating method and path as DATA here is what
 * made them visible. Both were then read and classified honestly in the same
 * commit (`cli/dry-bridge.ts`); the guard's row count went 84 → 86.
 *
 * `dryClassification` is non-optional in `RouteEntry` because a carved route
 * that lost its classification would be a route that acts for real under
 * `FORGE_DRY_BRIDGE=1`; the contract test asserts every entry carries one.
 */
import { pathOnly, type RouteContext, type RouteTable } from '@forge/kernel';

import {
  handleSkillsList,
  handleSkillCreate,
  handleSkillInstall,
  handleSkillApprove,
  handleSkillUpdate,
  handleSkillDelete,
  handleSkillDetail,
  SKILL_APPROVE_RE,
  SKILL_ID_RE,
} from './bridge-studio-skills.ts';
import {
  handleHooksList,
  handleHookCreate,
  handleHookApprove,
  handleHookOverride,
  handleHookRevokeApproval,
  handleHookUpdate,
  handleHookDelete,
  handleHookDetail,
  HOOK_APPROVE_RE,
  HOOK_OVERRIDE_RE,
  HOOK_REVOKE_RE,
  HOOK_ID_RE,
} from './bridge-studio-hooks.ts';
import { handleAuthoringFinalize, FINALIZE_URL } from './bridge-studio-authoring.ts';
import {
  handleTemplateCreate,
  handleTemplatePut,
  handleTemplateDeleteRoute,
  handleTemplatesList,
  handleTemplateDetail,
  TEMPLATE_ID_RE,
} from './bridge-studio-templates.ts';
import { handleStudioInstructionsRoutes, INSTRUCTIONS_DRAFT_ROUTE_RE } from './bridge-studio-instructions.ts';
import {
  handleConnectionsList,
  handleConnectionsProbe,
  handleConnectionsInstall,
  handleConnectionsDetail,
  PROBE_RE,
  INSTALL_RE as CONNECTION_INSTALL_RE,
  DETAIL_RE as CONNECTION_DETAIL_RE,
} from './bridge-studio-connections.ts';
import {
  handleCommunityList,
  handleCommunityRegistryItem,
  handleCommunityRefresh,
  handleCommunityInstall,
  handleCommunityDetail,
  REGISTRY_ROW_RE,
  INSTALL_RE as COMMUNITY_INSTALL_RE,
  DETAIL_RE as COMMUNITY_DETAIL_RE,
} from './bridge-studio-community.ts';

/**
 * The context these handlers receive. `RouteContext` (`@forge/kernel`) is
 * `StudioContext` plus the host-supplied `readBody` — most of this package's
 * routes are writes, so the library lane met the envelope's deliberate
 * body-parsing gap immediately (unlike knowledge, whose two carved POSTs take
 * everything from the URL); T1 ruling 30 is that gap's resolution. A handler
 * that reads no body still declares the narrower `StudioContext` and is
 * assignable here by contravariance.
 */
export type LibraryRouteContext = RouteContext;

/** Matching strips the query; handlers get the RAW url and normalise for
 *  themselves, so an arm that later needs the query string still has it. */
const pathOf = pathOnly;

/**
 * Ordered, first-match-wins. Sections follow the order `cli/ui-bridge.ts`
 * called the seven dispatchers in, and within a section the order that
 * dispatcher's if-chain matched its arms in. Order changes nothing while the
 * disjointness invariant holds — it is preserved because reproducing the
 * pre-carve sequence is what makes this a move rather than a redesign.
 */
export const libraryRoutes: RouteTable<LibraryRouteContext> = [
  // ---- bridge-studio-skills.ts (7 routes, was :105 :122 :186 :273 :360 :420 :473)
  {
    method: 'GET',
    path: '/api/studio/skills',
    matches: (url) => pathOf(url) === '/api/studio/skills',
    // exempt-local BY CONSTRUCTION: lists the on-disk skill library.
    dryClassification: 'exempt-local',
    handler: handleSkillsList,
  },
  {
    method: 'POST',
    path: '/api/studio/skills',
    matches: (url) => pathOf(url) === '/api/studio/skills',
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:260, verbatim
    handler: handleSkillCreate,
  },
  {
    method: 'POST',
    path: '/api/studio/skills/install',
    matches: (url) => pathOf(url) === '/api/studio/skills/install',
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:261, verbatim
    handler: handleSkillInstall,
  },
  {
    method: 'POST',
    path: '/api/studio/skills/:id/approve',
    matches: (url) => SKILL_APPROVE_RE.test(pathOf(url)),
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:262, verbatim
    handler: handleSkillApprove,
  },
  {
    method: 'PUT',
    path: '/api/studio/skills/:id',
    matches: (url) => SKILL_ID_RE.test(pathOf(url)),
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:252, verbatim
    handler: handleSkillUpdate,
  },
  {
    method: 'DELETE',
    path: '/api/studio/skills/:id',
    matches: (url) => SKILL_ID_RE.test(pathOf(url)),
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:253, verbatim
    handler: handleSkillDelete,
  },
  {
    method: 'GET',
    path: '/api/studio/skills/:id',
    matches: (url) => SKILL_ID_RE.test(pathOf(url)),
    // exempt-local BY CONSTRUCTION: reads one on-disk SKILL.md.
    dryClassification: 'exempt-local',
    handler: handleSkillDetail,
  },

  // ---- bridge-studio-hooks.ts (8 routes, was :275 :286 :389 :430 :475 :500 :595 :630)
  {
    method: 'GET',
    path: '/api/studio/hooks',
    matches: (url) => pathOf(url) === '/api/studio/hooks',
    // exempt-local BY CONSTRUCTION: lists on-disk hook packages + the ledger.
    dryClassification: 'exempt-local',
    handler: handleHooksList,
  },
  {
    method: 'POST',
    path: '/api/studio/hooks',
    matches: (url) => pathOf(url) === '/api/studio/hooks',
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:263, verbatim
    handler: handleHookCreate,
  },
  {
    method: 'POST',
    path: '/api/studio/hooks/:id/approve',
    matches: (url) => HOOK_APPROVE_RE.test(pathOf(url)),
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:264, verbatim
    handler: handleHookApprove,
  },
  {
    method: 'POST',
    path: '/api/studio/hooks/:id/override',
    matches: (url) => HOOK_OVERRIDE_RE.test(pathOf(url)),
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:265, verbatim
    handler: handleHookOverride,
  },
  {
    method: 'POST',
    path: '/api/studio/hooks/:id/revoke-approval',
    matches: (url) => HOOK_REVOKE_RE.test(pathOf(url)),
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:256, verbatim
    handler: handleHookRevokeApproval,
  },
  {
    method: 'PUT',
    path: '/api/studio/hooks/:id',
    matches: (url) => HOOK_ID_RE.test(pathOf(url)),
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:254, verbatim
    handler: handleHookUpdate,
  },
  {
    method: 'DELETE',
    path: '/api/studio/hooks/:id',
    matches: (url) => HOOK_ID_RE.test(pathOf(url)),
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:255, verbatim
    handler: handleHookDelete,
  },
  {
    method: 'GET',
    path: '/api/studio/hooks/:id',
    matches: (url) => HOOK_ID_RE.test(pathOf(url)),
    // exempt-local BY CONSTRUCTION: reads one on-disk hook package.
    dryClassification: 'exempt-local',
    handler: handleHookDetail,
  },

  // ---- bridge-studio-authoring.ts (1 route, was :471-474)
  {
    method: 'POST',
    // A LITERAL, not `FINALIZE_URL` — `RouteEntry.path`'s own contract says this
    // string is the entry's identity, and `dry-bridge-coverage.test.ts` reads it
    // as text: a const here is exactly the blindness (see this file's header)
    // that hid this route from the classifier in the first place. The matcher
    // still uses the const, so the two cannot drift.
    path: '/api/studio/authoring/finalize',
    matches: (url) => pathOf(url) === FINALIZE_URL,
    // cli/dry-bridge.ts, added by THIS carve — the arm compared against
    // FINALIZE_URL, a const the coverage scanner cannot read, so this mutating
    // route had never been classified. The `committing` turn performs no SDK
    // spawn at all — it runs copyStagingToLibrary; the install writes local
    // bytes through the guarded-path helpers. No spawn, no remote, no daemon.
    dryClassification: 'exempt-local',
    handler: handleAuthoringFinalize,
  },

  // ---- bridge-studio-templates.ts (5 routes, was :175 :300 :301 :306 :317)
  {
    method: 'POST',
    path: '/api/studio/templates',
    matches: (url) => pathOf(url) === '/api/studio/templates',
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:257, verbatim
    handler: handleTemplateCreate,
  },
  {
    method: 'PUT',
    path: '/api/studio/templates/:id',
    matches: (url) => TEMPLATE_ID_RE.test(pathOf(url)),
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:258, verbatim
    handler: handleTemplatePut,
  },
  {
    method: 'DELETE',
    path: '/api/studio/templates/:id',
    matches: (url) => TEMPLATE_ID_RE.test(pathOf(url)),
    dryClassification: 'exempt-local', // cli/dry-bridge.ts:259, verbatim
    handler: handleTemplateDeleteRoute,
  },
  {
    method: 'GET',
    path: '/api/studio/templates',
    matches: (url) => pathOf(url) === '/api/studio/templates',
    // exempt-local BY CONSTRUCTION: lists on-disk template files.
    dryClassification: 'exempt-local',
    handler: handleTemplatesList,
  },
  {
    method: 'GET',
    path: '/api/studio/templates/:id',
    matches: (url) => TEMPLATE_ID_RE.test(pathOf(url)),
    // exempt-local BY CONSTRUCTION: reads one on-disk template file.
    dryClassification: 'exempt-local',
    handler: handleTemplateDetail,
  },

  // ---- bridge-studio-instructions.ts (1 route, was :89)
  {
    method: 'POST',
    path: '/api/studio/agents/:slug/instructions-draft',
    matches: (url) => INSTRUCTIONS_DRAFT_ROUTE_RE.test(pathOf(url)),
    // cli/dry-bridge.ts, added by THIS carve — the arm compared against
    // INSTRUCTIONS_DRAFT_ROUTE_RE, a const the coverage scanner cannot read.
    // Composes a draft from the request body and confirms the agent exists via
    // a guarded SKILL.md existence check; writes nothing at all.
    dryClassification: 'exempt-local',
    handler: handleStudioInstructionsRoutes,
  },

  // ---- bridge-studio-connections.ts (4 routes, was :129 :140 :153 :212)
  {
    method: 'GET',
    path: '/api/studio/connections',
    matches: (url) => pathOf(url) === '/api/studio/connections',
    // exempt-local BY CONSTRUCTION: lists the on-disk connection catalog.
    dryClassification: 'exempt-local',
    handler: handleConnectionsList,
  },
  {
    method: 'POST',
    path: '/api/studio/connections/:id/probe',
    matches: (url) => PROBE_RE.test(pathOf(url)),
    // cli/dry-bridge.ts:266, verbatim — and note its reason: this probe is
    // DELIBERATELY never suppressed under a dry bridge (D3, readiness stays real).
    dryClassification: 'exempt-local',
    handler: handleConnectionsProbe,
  },
  {
    method: 'POST',
    path: '/api/studio/connections/:id/install',
    matches: (url) => CONNECTION_INSTALL_RE.test(pathOf(url)),
    dryClassification: 'stub-actions', // cli/dry-bridge.ts:189, verbatim
    handler: handleConnectionsInstall,
  },
  {
    method: 'GET',
    path: '/api/studio/connections/:id',
    matches: (url) => CONNECTION_DETAIL_RE.test(pathOf(url)),
    // exempt-local BY CONSTRUCTION: reads one on-disk connection definition.
    dryClassification: 'exempt-local',
    handler: handleConnectionsDetail,
  },

  // ---- bridge-studio-community.ts (5 routes, was :406 :440 :469 :533 :539)
  {
    method: 'GET',
    path: '/api/studio/community',
    matches: (url) => pathOf(url) === '/api/studio/community',
    // exempt-local BY CONSTRUCTION: reads the on-disk registry + index.
    dryClassification: 'exempt-local',
    handler: handleCommunityList,
  },
  {
    method: 'GET',
    path: '/api/studio/community/registry/items/:id',
    matches: (url) => REGISTRY_ROW_RE.test(pathOf(url)),
    // exempt-local BY CONSTRUCTION: reads one on-disk registry row. The POST /
    // PUT / DELETE forms of this same URL live in `cli/bridge-studio-writes.ts`
    // and are NOT carved here — different methods, so no contention.
    dryClassification: 'exempt-local',
    handler: handleCommunityRegistryItem,
  },
  {
    method: 'POST',
    path: '/api/studio/community/refresh',
    matches: (url) => pathOf(url) === '/api/studio/community/refresh',
    // cli/dry-bridge.ts:121, verbatim — the ONLY non-exempt library route: a
    // real third-party network call made with the operator's GH_TOKEN.
    dryClassification: 'refuse',
    handler: handleCommunityRefresh,
  },
  {
    method: 'POST',
    path: '/api/studio/community/:kind/:id/install',
    matches: (url) => COMMUNITY_INSTALL_RE.test(pathOf(url)),
    dryClassification: 'stub-actions', // cli/dry-bridge.ts:198, verbatim
    handler: handleCommunityInstall,
  },
  {
    method: 'GET',
    path: '/api/studio/community/:kind/:id',
    matches: (url) => COMMUNITY_DETAIL_RE.test(pathOf(url)),
    // exempt-local BY CONSTRUCTION: reads one on-disk community item.
    dryClassification: 'exempt-local',
    handler: handleCommunityDetail,
  },
];
