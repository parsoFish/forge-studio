/**
 * bridge-agents-studio.ts — the three `/api/studio/agents*` routes.
 *
 * Carved out of `apps/forge/bridge-studio.ts` (the roster GET) and
 * `apps/forge/bridge-studio-writes.ts` (the upsert/delete block) in M4-agents,
 * exit row 2.
 *
 * `PUT` AND `DELETE` SHARE ONE HANDLER, DELIBERATELY. In the host they were a
 * single `if (agentMatch)` block: thirty lines of slug validation and
 * `resolveGuardedPath` containment, and only then a branch on method. Splitting
 * them into two independent handlers would mean duplicating that containment
 * guard, which is a security-invariant breach rather than a smaller diff
 * (COMMON §15.47). So the table carries two entries — `dispatchRoute` filters on
 * method before `matches` is ever called — and both point at the SAME function,
 * which branches on the `method` argument exactly as the if-chain did.
 *
 * WHAT TURNED OUT NOT TO NEED INJECTING. Reading the re-export chain rather
 * than the import specifier collapsed most of the expected dependency list:
 * `isStudioAgent`, `loadAgentDefinition`, `listAgentDefinitions` and
 * `serializeAgentDefinition` are already this package's own (the #329 registry
 * split); `SLUG_RE`, `isReservedId`, `AGENT_PROVENANCE` and
 * `resolveDefaultKickoffCeilingUsd` are `@forge/kernel`'s; and
 * `@forge/library`'s catalog, hook and skill-trust readers are a legal rank-3 →
 * rank-2 import. Only THREE things genuinely live above this package:
 * `validateAgent` (this package's `studio/validate-agent.ts` since ruling 159 — the Agent kind's
 * validator is the half of the registry split that has not moved yet) and the
 * Flow-kind pair `listFlowIds` / `loadFlowDefinition`, which wave 4 carries.
 * The roster GET needs no injection at all.
 *
 * `isStringArray` and `sessionKindAgentRefs` came with the handler. The
 * projects lane had left `isStringArray` in the host with a note that it is
 * "used exclusively by the agents-owned PUT handler" and was duplicated rather
 * than imported only because importing it from a projects package file would
 * have minted a `projects → cli` edge. That constraint dies here: the handler
 * it serves now lives in the package that owns it.
 *
 * The body arrives as `ctx.readBody()` (T1 ruling 30) — the host keeps the CSRF
 * and transport policy and hands the RESULT down. `DELETE` never calls it: the
 * delete arm returns before the parse step, exactly as it did in the host.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import yaml from 'js-yaml';

import {
  allowedOrigin, sanitizeError, sendJson, resolveGuardedPath,
  SLUG_RE, isReservedId, AGENT_PROVENANCE, resolveDefaultKickoffCeilingUsd,
  loadConfig, defaultConfigPath, type RouteContext,
} from '@forge/kernel';
import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';
import { loadCatalog } from '@forge/library/studio/catalog-registry.ts';
import { checkHookComposition, listHookIds } from '@forge/library/studio/hook-library.ts';
import { removeInstallLedgerEntry } from '@forge/library/studio/skill-install-ledger.ts';
import { listSkillLibrary } from '@forge/library/studio/skill-trust.ts';
import type { AgentFacts } from '@forge/library/studio/agent-facts.ts';

import { PLATFORM_GUARD_IDS } from './agent-bands.ts';
import { skillsDir as toSkillsDir } from './skill-path.ts';
import { MAX_MATERIALS_LENGTH } from './studio/materials.ts';
import { agentCapabilityDescriptor } from './studio/derive.ts';
import { serializeAgentDefinition } from './studio/skill-md-fidelity.ts';
import {
  isStudioAgent, loadAgentDefinition, listAgentDefinitions,
} from './studio/agent-registry.ts';
import { validateAgent } from './studio/validate-agent.ts';

/**
 * The symbols that genuinely live above rank 3, declared structurally.
 * `apps/forge/routes.ts` supplies them; the Flow pair comes home when wave 4
 * carves the Flow kind.
 *
 * `validateAgent` USED to be a fourth field here, injected only because the
 * Agent kind's validator was still `orchestrator/studio/validate.ts`. Ruling
 * 159 brought it into this package (`studio/validate-agent.ts`), so the port
 * is retired and the call below imports it — exactly what the old comment
 * said would happen "when it does".
 */
export type AgentStudioRouteDeps = {
  listFlowIds(forgeRoot: string): string[];
  loadFlowDefinition(flowYamlPath: string): FlowDefinition;
  /** Library's `AgentFacts` port, bound at `apps/forge`. This module calls
   *  into `@forge/library` (rank 3 → 2, legal) and library's readers now take
   *  the facts by injection, so the binding travels with the deps rather than
   *  being rebuilt here — there is ONE resilient roster walk in the tree. */
  agentFacts: AgentFacts;
};

type Handler = (
  req: IncomingMessage, res: ServerResponse, ctx: RouteContext, url: string, method: string,
) => Promise<boolean>;

/** forge-hoq — type guard for a PUT body's `allowedTools`/`disallowedTools`:
 *  an array of strings, nothing looser. Used to reject a malformed explicit
 *  value (400) rather than silently downgrading it to "field omitted" —
 *  same rigor as the `materials` field's explicit-shape check above.
 *
 *  NOT a projects helper — it lived inside the C4 scaffolding block by file
 *  position only, and is used exclusively by the agents-owned `PUT
 *  /api/studio/agents/:slug` handler below. Kept here verbatim (M4-projects
 *  carve rule: `isStringArray` is shared with an agents route, so it is
 *  DUPLICATED rather than imported from a new package file — importing it
 *  the other way, from a projects package file, would mint a
 *  `projects → cli` legacy-import edge). */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Which session-kind descriptors reference each agent slug (the DELETE
 * guard's second reference source, beside flow nodes). Deliberately a
 * TOLERANT scan of the descriptor ROWS rather than the strict
 * `loadSessionKinds` parse: for a refusal guard, over-collecting references
 * from a row that would fail the strict parse is the fail-closed direction
 * (a strict throw per-row would let a malformed sibling descriptor unblock a
 * guarded delete). A missing file is genuinely "no session kinds" — an empty
 * map.
 *
 * W7-B4 review finding 5: tolerance stops at the FILE. The previous `catch {
 * return refs }` around `yaml.load` inverted this function's whole rationale
 * — an unparseable file (one stray tab) produced an EMPTY map, so the caller
 * read "no session kind references this agent" and deleted it, breaking
 * every kind that dispatched it. An unreadable/unparseable descriptor file
 * means the guard CANNOT prove the agent is unreferenced, so it throws and
 * the caller refuses.
 */
export class SessionKindsUnreadableError extends Error {}

function sessionKindAgentRefs(forgeRoot: string): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  const file = join(forgeRoot, 'studio', 'session-kinds.yaml');
  if (!existsSync(file)) return refs;
  let parsed: unknown;
  try {
    parsed = yaml.load(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new SessionKindsUnreadableError(
      `studio/session-kinds.yaml could not be parsed (${err instanceof Error ? err.message : String(err)}) — fix it before deleting agents, since it cannot be checked for references`,
    );
  }
  if (!Array.isArray(parsed)) return refs;
  for (const row of parsed) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const agent = typeof r['agent'] === 'string' ? r['agent'] : '';
    const kindId = typeof r['id'] === 'string' ? r['id'] : '(unnamed kind)';
    if (!agent) continue;
    refs.set(agent, [...(refs.get(agent) ?? []), kindId]);
  }
  return refs;
}

/** `GET /api/studio/agents` — the roster, each entry carrying its
 *  server-computed capability descriptor (R2-02-F1: no capability fact may
 *  exist only in UI code) and, as a TOP-LEVEL sibling rather than a per-agent
 *  field, the run-level default cost ceiling. */
export const handleStudioAgentsList = (): Handler => async (req, res, ctx) => {
  const origin = allowedOrigin(req);
  try {
    const skillsDir = toSkillsDir(resolve(ctx.forgeRoot));
    const agents = listAgentDefinitions(skillsDir);
    // R2-02-F1: thread the server-computed capability descriptor onto each
    // agent's wire payload — no capability fact may exist only in UI code.
    // R6-04 (WI-2): `defaultCostCeilingUsd` is RUN-LEVEL policy (read from
    // forge.config.json's `runs.defaultCostCeilingUsd`, falling back to
    // the named `DEFAULT_KICKOFF_COST_CEILING_USD` constant) — served as a
    // TOP-LEVEL sibling of `agents`, never nested onto a per-agent object,
    // which would falsely assert the default is agent-specific.
    const defaultCostCeilingUsd = resolveDefaultKickoffCeilingUsd(
      loadConfig(defaultConfigPath(ctx.forgeRoot)),
    );
    sendJson(
      res,
      200,
      {
        // forge-3oq: AGENT_PROVENANCE is the named 'unknown' constant —
        // SKILL.md carries no origin field, so guessing would be exactly
        // the fabricated badge this change exists to remove.
        agents: agents.map((a) => ({ ...a, capability: agentCapabilityDescriptor(a), provenance: AGENT_PROVENANCE })),
        defaultCostCeilingUsd,
      },
      origin,
    );
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
  return true;
};

/**
 * `PUT` and `DELETE /api/studio/agents/:slug` — ONE handler behind two table
 * entries, sharing the slug validation and containment guard the host block
 * shared. Branches on `method`, as the if-chain did.
 */
export const handleStudioAgentWrite = (deps: AgentStudioRouteDeps): Handler => async (req, res, ctx, url, method) => {
  const origin = allowedOrigin(req);
  const agentMatch = /^\/api\/studio\/agents\/([^/]+)$/.exec(url.split('?')[0] ?? '');
  if (!agentMatch) return false;
  try {
    const slug = decodeURIComponent(agentMatch[1]);

    // 1. Validate slug before any fs operation (blocks path traversal)
    if (!SLUG_RE.test(slug)) {
      sendJson(res, 400, { error: 'invalid slug — must match [a-z][a-z0-9]*(-[a-z0-9]+)*' }, origin);
      return true;
    }
    // W7-A4 (crosscut-20): `new` is the /agents/new builder segment, never
    // an agent — refuse it here so it can never be minted or shadowed.
    if (isReservedId(slug)) {
      sendJson(res, 400, { error: `agent slug "${slug}" is reserved (the /agents/new builder lives at that path) — choose another slug` }, origin);
      return true;
    }

    // 2. Resolve + guard the SKILL.md path through the shared, generalized
    // containment guard (cli/studio-path-guard.ts — see its docstring for
    // the full writeup of every escape shape closed: symlinked leaf,
    // symlinked slug dir, same-root cross-agent alias, hardlinked leaf,
    // nested-segment symlink). Also used by the instructions-draft and
    // skills-library author routes. Tolerates not-yet-created (`exists:
    // false`) so scaffolding a brand-new agent still works.
    const pathGuard = resolveGuardedPath(toSkillsDir(ctx.forgeRoot), [slug, 'SKILL.md']);
    if (!pathGuard.ok) {
      sendJson(res, 400, { error: 'path traversal detected' }, origin);
      return true;
    }
    const skillMdPath = pathGuard.realPath;

    // ---- DELETE /api/studio/agents/:slug (W7-B4, agents-09) --------------
    // Refuses while anything REAL still references the agent: a flow node
    // (the run-time dispatch source) or a session-kind descriptor (the
    // interactive dispatch source) — each 409 names the referrers.
    if (method === 'DELETE') {
      if (!pathGuard.exists) {
        sendJson(res, 404, { error: `unknown agent "${slug}"` }, origin);
        return true;
      }
      // W7-B4 review finding 1 (kind confusion) — skills and agents share
      // skills/<id>/SKILL.md, so this route can address a plain composable
      // SKILL by slug. Neither guard below fires for one (flow nodes and
      // session kinds only ever reference AGENTS), so without this check a
      // skill fell straight through to the rmSync — deleting a package the
      // skills route deliberately refuses, and breaking every agent that
      // composes it at next spawn. Mirror of the skills route's own
      // isStudioAgent refusal (packages/library/bridge-studio-skills.ts), pointing the
      // operator at the surface that owns the object.
      if (!isStudioAgent(skillMdPath)) {
        sendJson(res, 404, {
          error: `"${slug}" is a library skill, not a studio agent — delete it from the library (/skills/${slug})`,
        }, origin);
        return true;
      }
      // Defence in depth: even for a real agent, never delete one that
      // something still composes. Same `usedBy` derivation the library
      // listing renders — one source of truth, no second scan.
      const composedBy = listSkillLibrary(ctx.forgeRoot, deps.agentFacts).find((e) => e.id === slug)?.usedBy ?? [];
      if (composedBy.length > 0) {
        sendJson(res, 409, {
          error: `agent "${slug}" is still composed by ${composedBy.length} agent(s): ${composedBy.join(', ')} — unbind it from their builders first`,
          usedBy: composedBy,
        }, origin);
        return true;
      }
      const referencingFlows: string[] = [];
      for (const flowId of deps.listFlowIds(ctx.forgeRoot)) {
        const guarded = resolveGuardedPath(resolve(ctx.forgeRoot, 'studio', 'flows'), [flowId, 'flow.yaml']);
        if (!guarded.ok || !guarded.exists) continue;
        try {
          const def = deps.loadFlowDefinition(guarded.realPath);
          if (def.nodes.some((n) => n.agent === slug)) referencingFlows.push(flowId);
        } catch {
          // a malformed sibling flow is studio-lint's finding, not a
          // reason to unblock (or block) this delete
        }
      }
      if (referencingFlows.length > 0) {
        sendJson(res, 409, {
          error: `agent "${slug}" is still a node in ${referencingFlows.length} flow(s): ${referencingFlows.join(', ')} — edit those flows first`,
          referencedBy: referencingFlows,
        }, origin);
        return true;
      }
      let kindRefs: string[];
      try {
        kindRefs = sessionKindAgentRefs(ctx.forgeRoot).get(slug) ?? [];
      } catch (err) {
        // Fail CLOSED: the reference set is unknown, so the delete is refused
        // with the actionable reason rather than proceeding blind.
        sendJson(res, 409, { error: sanitizeError(err) }, origin);
        return true;
      }
      if (kindRefs.length > 0) {
        sendJson(res, 409, {
          error: `agent "${slug}" drives the session kind(s): ${kindRefs.join(', ')} (studio/session-kinds.yaml) — retire the descriptor first`,
          referencedBy: kindRefs,
        }, origin);
        return true;
      }
      // W8-B4 FIX-2 (library-35 x4): this route addresses `skills/<slug>`
      // (agents and library skills share the same package layout — see the
      // isStudioAgent kind-confusion note above), so a package this delete
      // destroys can carry an install-ledger row exactly like the skills
      // route's own DELETE — e.g. a skill installed then hand-converted to
      // an agent (provenance stripped, runtime added) still has a
      // provenance-installed history. Prune BEFORE the rmSync, mirroring
      // packages/library/bridge-studio-skills.ts's DELETE route ordering: a crash
      // between the two steps then fails CLOSED (an orphaned package that
      // still needs re-review) rather than fails OPEN (a gone package
      // whose stale ledger row would taint a future skill reusing the id).
      // Tolerant / idempotent — removeInstallLedgerEntry never throws on
      // "nothing to prune", the common case for a real studio agent that
      // was authored by hand and never went through installSkillPackage.
      removeInstallLedgerEntry(ctx.forgeRoot, slug);
      rmSync(dirname(skillMdPath), { recursive: true, force: true });
      sendJson(res, 200, { ok: true, slug }, origin);
      return true;
    }

    // 3. Parse request body
    let body: unknown;
    try {
      body = await ctx.readBody();
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' }, origin);
      return true;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
      return true;
    }
    const b = body as Record<string, unknown>;

    // W7-B4 (agents-28): an EXPLICIT create must never silently overwrite
    // an existing agent — the /agents/new save path sends `create: true`
    // and collides with 409, leaving the file untouched.
    if (b['create'] === true && pathGuard.exists) {
      sendJson(res, 409, {
        error: `agent "${slug}" already exists — open /agents/${slug} to edit it, or pick another name`,
      }, origin);
      return true;
    }

    // 4. Load existing def or scaffold minimal one. Also capture the RAW
    // on-disk bytes (D5 wiring): five phase bindings + the release
    // finalizer readFileSync the WHOLE SKILL.md verbatim into the agent's
    // system prompt (orchestrator/phases/dev-binding.ts:63, pm-binding.ts:53,
    // reflector-binding.ts:52, adversarial-review-binding.ts:40,
    // demo-agent-binding.ts:53, orchestrator/release-finalize-invocation.ts:51)
    // — so a lossy re-serialize on save is a PROMPT change, not mere file
    // churn. Handing `originalRaw` to serializeAgentDefinition below lets it
    // take the byte-preserving fast path (comments, fanout, key order kept
    // verbatim) whenever the frontmatter didn't actually change. Both this
    // read and loadAgentDefinition's internal read use the same 'utf8'
    // encoding — no double-encoding risk, just two reads of the same bytes.
    let existing: AgentDefinition | null = null;
    let originalRaw: string | undefined;
    if (pathGuard.exists) {
      try {
        originalRaw = readFileSync(skillMdPath, 'utf8');
        existing = loadAgentDefinition(skillMdPath);
      } catch (err) {
        sendJson(res, 500, { error: sanitizeError(err) }, origin);
        return true;
      }
    }

    // 5. Build merged definition: preserve slug/phase/surface/allowedTools/disallowedTools/budgets
    const name = typeof b['name'] === 'string' ? b['name'] : existing?.name ?? slug;
    const purpose = typeof b['purpose'] === 'string' ? b['purpose'] : existing?.purpose ?? '';
    // UI sends `process` for the body field
    const body_text = typeof b['process'] === 'string' ? b['process'] : existing?.body ?? '';
    const interactivity = typeof b['interactivity'] === 'string' ? b['interactivity'] : existing?.interactivity ?? '';
    const brainAccess = (['mandatory', 'advisory', 'none'] as const).includes(
      b['brainAccess'] as 'mandatory' | 'advisory' | 'none',
    )
      ? (b['brainAccess'] as 'mandatory' | 'advisory' | 'none')
      : existing?.brainAccess ?? 'none';

    // Composition: merge from body, fall back to existing
    const rawComp = b['composition'];
    const compIn: Record<string, unknown> =
      rawComp !== null && typeof rawComp === 'object' && !Array.isArray(rawComp)
        ? (rawComp as Record<string, unknown>)
        : {};
    const composition = {
      skills: Array.isArray(compIn['skills']) ? (compIn['skills'] as string[]) : (existing?.composition.skills ?? []),
      tools: Array.isArray(compIn['tools']) ? (compIn['tools'] as string[]) : (existing?.composition.tools ?? []),
      mcps: Array.isArray(compIn['mcps']) ? (compIn['mcps'] as string[]) : (existing?.composition.mcps ?? []),
      guards: Array.isArray(compIn['guards']) ? (compIn['guards'] as string[]) : (existing?.composition.guards ?? []),
      // Deliberately NOT falling back to existing?.composition.hooks like
      // the other four fields (2026-08-04, see bridge-studio-writes-
      // guards-migration.test.ts's E1b): a stale on-disk SKILL.md can
      // carry the OLD `hooks:` vocabulary (guard ids, pre-rename) under
      // the field that now means library-hook ids — falling back to it
      // would silently round-trip that colliding value through every save
      // of that agent, forever, with no validation catching it (this
      // route does not yet run lintHookComposition — see the T3 report's
      // JOB 2 finding). Reading ONLY the request body means a save either
      // explicitly re-declares composition.hooks (the F4 Agent-Builder
      // binding path) or it's empty — never a silently-inherited legacy
      // value.
      hooks: Array.isArray(compIn['hooks']) ? (compIn['hooks'] as string[]) : [],
    };

    // Runtime: merge from body, fall back to existing
    const rawRt = b['runtime'];
    const rtIn: Record<string, unknown> =
      rawRt !== null && typeof rawRt === 'object' && !Array.isArray(rawRt)
        ? (rawRt as Record<string, unknown>)
        : {};
    const runtime = {
      sdk: typeof rtIn['sdk'] === 'string' ? rtIn['sdk'] : (existing?.runtime.sdk ?? 'claude'),
      strategy: (['fixed', 'range'] as const).includes(rtIn['strategy'] as 'fixed' | 'range')
        ? (rtIn['strategy'] as 'fixed' | 'range')
        : (existing?.runtime.strategy ?? 'fixed'),
      model: typeof rtIn['model'] === 'string' ? rtIn['model'] : existing?.runtime.model,
      range: Array.isArray(rtIn['range']) ? (rtIn['range'] as string[]) : existing?.runtime.range,
      loopStrategy: typeof rtIn['loopStrategy'] === 'string' ? rtIn['loopStrategy'] : existing?.runtime.loopStrategy,
    };

    // materials (R2-09 D2/D7 + 2026-08-05 adversarial-review round 2,
    // findings C/8 and C/9): the SAME inherit-when-omitted convention as
    // `phase`/`surface`/`executor` above — omitted from the PUT body ⇒
    // inherited from disk (`existing?.materials`); explicitly `[]` (or any
    // other array, up to the vocabulary-derived length cap) in the body ⇒
    // replaces it, including clearing to empty. The presence test is now
    // `b['materials'] !== undefined`, NOT `Array.isArray` — the previous
    // version treated ANY non-array explicit value as "not sent" and
    // silently fell back to the on-disk value with a 200 OK, so a caller
    // sending `materials: null` / `{}` / `"images"` believed it saved and
    // nothing changed (this campaign's recurring "declared data fails
    // open" shape). An explicit, malformed shape is now REJECTED (400,
    // file byte-unchanged) before any further processing — never
    // downgraded to "omitted". An oversized array (longer than the
    // vocabulary can ever legitimately need) is rejected the same way,
    // BEFORE validateAgent's per-value materials/enum lint would otherwise
    // fan out into one finding per element.
    if (b['materials'] !== undefined) {
      if (!Array.isArray(b['materials'])) {
        sendJson(
          res,
          400,
          { error: `materials must be an array of strings, got ${b['materials'] === null ? 'null' : typeof b['materials']}` },
          origin,
        );
        return true;
      }
      if ((b['materials'] as unknown[]).length > MAX_MATERIALS_LENGTH) {
        sendJson(
          res,
          400,
          {
            error: `materials array too long (${(b['materials'] as unknown[]).length} entries) — the vocabulary has only ${MAX_MATERIALS_LENGTH} kinds`,
          },
          origin,
        );
        return true;
      }
    }
    const materials: string[] | undefined = Array.isArray(b['materials'])
      ? (b['materials'] as string[])
      : existing?.materials;

    // forge-hoq — allowedTools/disallowedTools: SAME inherit-when-omitted /
    // explicit-replaces convention as `materials` above. `disallowed-tools`
    // is the only real fence against a skill reaching the subagent-spawn
    // tool (packages/library/studio-lint-tool-fence.ts) — this is a security control, not
    // cosmetic state, so a malformed explicit value is REJECTED (400, file
    // byte-unchanged) rather than silently downgraded to "omitted" (the
    // same declared-data-fails-open shape `materials` already guards
    // against). The field must be read from the body at all: a BRAND-NEW
    // agent (starter-derived via applyStarter, or duplicateAgentState) has
    // no `existing` to inherit from, so `existing?.disallowedTools ?? []`
    // alone silently strips the fence on every new-agent save — forge-ui's
    // buildAgentPutBody now sends both fields on every save specifically so
    // this path has something to read.
    for (const field of ['allowedTools', 'disallowedTools'] as const) {
      if (b[field] !== undefined && !isStringArray(b[field])) {
        sendJson(
          res,
          400,
          { error: `${field} must be an array of strings, got ${b[field] === null ? 'null' : typeof b[field]}` },
          origin,
        );
        return true;
      }
    }
    const allowedTools: string[] = isStringArray(b['allowedTools'])
      ? b['allowedTools']
      : existing?.allowedTools ?? [];
    const disallowedTools: string[] = isStringArray(b['disallowedTools'])
      ? b['disallowedTools']
      : existing?.disallowedTools ?? [];

    const merged: AgentDefinition = {
      slug,
      name,
      description: existing?.description ?? name,
      // W7-B4 (agents-18): a BRAND-NEW mint synthesises `phase: <slug>` so
      // the agent is dispatchable (deriveAgentSpec hard-requires phase;
      // without it a Studio-made agent could NEVER run). An existing
      // agent's phase — including deliberately-absent (declaration-only) —
      // is preserved verbatim, never backfilled.
      phase: existing ? existing.phase : slug,
      surface: existing?.surface,
      // R4-01 review: preserve the declared executor row — dropping it on a
      // builder save would silently strip developer-unifier's dispatch (the
      // one remaining executor, held until R4-01-F4 retirement).
      executor: existing?.executor,
      purpose,
      composition,
      runtime,
      // D7 fix: this literal used to omit `fanout` entirely, so saving a
      // fanout-capable agent (e.g. developer-ralph) through the builder
      // silently stripped its `fanout:` block and flipped its
      // `fanoutCapable` descriptor false. Same inherit-when-omitted
      // convention as `phase`/`surface`/`executor` — the PUT body has no
      // fanout-editing UI yet, so this is always inherited from disk.
      fanout: existing?.fanout,
      materials,
      brainAccess,
      interactivity,
      budgets: existing?.budgets ?? {},
      allowedTools,
      disallowedTools,
      body: body_text,
      // 2026-08-05 adversarial-review round 2, finding C/10 claimed
      // `existing?.library ?? true` "silently flips" an agent whose on-disk
      // `library` is explicitly `false` (e.g. instructions-creator,
      // project-brain-builder) to `true` on a PUT that omits `library`.
      // VERIFIED AND NOT REPRODUCIBLE: `??` (nullish coalescing) only
      // substitutes its right operand when the left is `null`/`undefined`
      // — `false ?? true` evaluates to `false` in JS, confirmed empirically
      // (`node -e "console.log(false ?? true)"` → `false`). So
      // `existing?.library ?? true` already preserves an explicit
      // `library: false` verbatim; it only backfills `true` for (a) a
      // genuinely new agent (`existing` is `null`) or (b) an EXISTING
      // agent whose `library` key was never declared at all
      // (`existing.library === undefined`) — and that backfill is inert:
      // `isStudioAgent` (registry.ts) already treats an undeclared
      // `library` the same as `true` (`d.library !== false`), so writing
      // the explicit `true` changes no observable behaviour, only makes
      // the R3-01-F2 "explicit on every shipped skill" convention hold.
      // Kept as-is rather than "fixed" per the false claim — see the final
      // report.
      library: existing?.library ?? true,
      path: skillMdPath,
    };

    // 5b. Pre-load catalog guard ids for the composition/guard-unknown check
    // below (ADR-027 §6: "the same validation runs at save (bridge PUT) and
    // at spawn") — mirrors apps/forge/studio-lint.ts's identical block; a missing
    // or malformed catalog leaves the set undefined so the rule simply does
    // not fire (a catalog load failure must not turn every save into a 400).
    let validGuardIds: ReadonlySet<string> | undefined;
    {
      const catalogPathEarly = join(ctx.forgeRoot, 'studio', 'catalog.yaml');
      if (existsSync(catalogPathEarly)) {
        try {
          validGuardIds = new Set(loadCatalog(catalogPathEarly).guards.map((g) => g.id));
        } catch {
          validGuardIds = undefined;
        }
      }
    }

    // 5c. Symmetric hooks/guards composition check (ADR-027 R3-03 amendment;
    // 2026-08-04 finding — the THIRD appearance of the same defect class in
    // this initiative: a rule implemented and unit-tested but inert because
    // production never invokes it). `checkHookComposition` is the SAME pure
    // predicate `lintHookComposition` runs over on-disk agents
    // (orchestrator/studio/hook-library.ts) — applied HERE to the
    // IN-MEMORY `merged.composition` candidate, since it is not yet
    // written; re-scanning disk would miss the very save this gates.
    // PLATFORM_GUARD_IDS is a fixed platform-vocabulary constant (not
    // catalog-sourced), and listHookIds reads studio/hooks/ directly, so
    // neither needs the catalog-load guard the guard-unknown check above
    // needs.
    const hookCompositionFindings = checkHookComposition(
      slug,
      merged.composition,
      new Set(PLATFORM_GUARD_IDS),
      new Set(listHookIds(ctx.forgeRoot)),
    );

    // 6. Validate — reject on any error-level finding
    const findings = [...validateAgent(merged, undefined, validGuardIds), ...hookCompositionFindings];
    const hasErrors = findings.some((f) => f.level === 'error');
    if (hasErrors) {
      sendJson(res, 400, { error: 'validation failed', findings }, origin);
      return true;
    }

    // 7. Serialize and write. Passing `originalRaw` lets serializeAgentDefinition
    // take the D5 byte-preserving fast path when nothing frontmatter-relevant
    // changed — see the comment on `originalRaw`'s read above for why a lossy
    // save here is a PROMPT change, not mere file churn.
    const serialized = serializeAgentDefinition(merged, originalRaw);
    // Derive the containing dir from the ALREADY-GUARDED real path (not a
    // fresh `skillDir(slug, ...)` lexical join) — reusing the guarded
    // value end-to-end means there is no second, unguarded path
    // construction for a brand-new agent to slip through.
    const skillDirPath = dirname(skillMdPath);
    if (!existsSync(skillDirPath)) {
      mkdirSync(skillDirPath, { recursive: true });
    }
    writeFileSync(skillMdPath, serialized, 'utf8');

    const flagFindings = findings.filter((f) => f.level === 'flag');
    sendJson(res, 200, { ok: true, slug, findings: flagFindings }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
};
