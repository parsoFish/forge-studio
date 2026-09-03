/**
 * GET /api/studio/agents/:slug/capability (W6-B6 fix — wave-6 final gate,
 * journey demo-builder DB-4).
 *
 * Root cause this route fixes: `/api/studio/agents` (`cli/bridge-studio.ts`)
 * builds its roster from `listAgentDefinitions`, which filters through
 * `isStudioAgent` — `library !== false` (@forge/agents/studio/agent-registry.ts).
 * Every kickoff-only system agent (demo-builder, instructions-creator,
 * brain-maintenance, creation-agent, project-brain-builder) sets
 * `library: false` (they're dispatched by the bridge directly, never
 * composed into a flow) so NONE of them ever appear in that roster. The
 * session-kickoff page (apps/studio/app/sessions/[kind]/new/page.tsx) derived
 * its model-tier picker's `allowedTiers` from the roster lookup, so the
 * picker always rendered the read-only 'fixed' chip for those five kinds —
 * even after B5 widened their SKILL.mds to `strategy: range`.
 *
 * This route answers "what's this ONE agent's capability" directly, against
 * the UNFILTERED SKILL.md defs (`isUnfilteredStudioAgent`/`loadAgentDefinition`
 * — the same source `/api/studio/agents` maps over, minus the `library`
 * filter) — never a list, so a kickoff-only agent is resolvable by the exact
 * slug the kickoff page already knows (`KICKOFF_KINDS[kind].agentSlug`).
 *
 *   GET /api/studio/agents/:slug/capability
 *     → 200 { slug, capability: AgentCapabilityDescriptor }
 *     → 400 { error } for a slug that fails SLUG_RE (malformed URL encoding
 *       or a traversal-shaped value) — checked BEFORE any fs call
 *     → 404 { error } for an unknown slug: no SKILL.md, no `runtime:` block
 *       (a plain skill, not a studio agent), a quarantined/installed def
 *       (D4), or an escaping symlink — all collapse to the SAME response, so
 *       an attacker can never distinguish "no such slug" from "blocked
 *       escape" from the response shape (mirrors the sibling
 *       instructions-draft route's security posture).
 *
 * Security — the SAME guarded-path choke point (`resolveGuardedPath`,
 * packages/kernel/path-guard.ts) as the sibling PUT /api/studio/agents/:slug and
 * POST .../instructions-draft routes: `slug` is SLUG_RE-gated before any fs
 * call, and the SKILL.md path is resolved via `realpathSync` at the shared
 * guard rather than a lexical prefix check.
 *
 * Read-only GET route: covered by `dry-bridge.ts`'s blanket
 * `{ method: 'GET', route: '*' }` classification — no new table row needed.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { SLUG_RE } from '@forge/kernel';
import { isUnfilteredStudioAgent, loadAgentDefinition } from '@forge/agents/studio/agent-registry.ts';
import { agentCapabilityDescriptor } from '@forge/agents/studio/derive.ts';
import { resolveGuardedPath } from '@forge/kernel';
import { skillsDir } from '@forge/agents/skill-path.ts';
import { sendJson, allowedOrigin, sanitizeError, pathOnly, type StudioContext } from '@forge/kernel';

const AGENT_CAPABILITY_ROUTE_RE = /^\/api\/studio\/agents\/([^/]+)\/capability$/;

/**
 * Resolve `<forgeRoot>/skills/<slug>/SKILL.md` via the shared
 * `resolveGuardedPath` choke point, then confirm it's a real (unfiltered)
 * studio agent. Returns `null` for a missing file, an escaping symlink, AND
 * a non-agent SKILL.md alike — all three are the SAME "unknown agent" 404 to
 * the caller (see module header).
 */
function resolveUnfilteredAgentPath(forgeRoot: string, slug: string): string | null {
  const guard = resolveGuardedPath(skillsDir(forgeRoot), [slug, 'SKILL.md']);
  if (!guard.ok || !guard.exists) return null;
  if (!isUnfilteredStudioAgent(guard.realPath)) return null;
  return guard.realPath;
}

export async function handleStudioAgentCapabilityRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET') return false;

  const url = pathOnly(rawUrl);
  const match = url.match(AGENT_CAPABILITY_ROUTE_RE);
  if (!match) return false;

  const origin = allowedOrigin(req);

  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    sendJson(res, 400, { error: 'invalid slug — malformed URL encoding' }, origin);
    return true;
  }

  // Slug-guard BEFORE any fs call — identical rule to the PUT route and the
  // sibling instructions-draft route.
  if (!SLUG_RE.test(slug)) {
    sendJson(res, 400, { error: 'invalid slug — must match [a-z][a-z0-9]*(-[a-z0-9]+)*' }, origin);
    return true;
  }

  try {
    const realSkillMdPath = resolveUnfilteredAgentPath(ctx.forgeRoot, slug);
    if (!realSkillMdPath) {
      sendJson(res, 404, { error: `unknown agent "${slug}"` }, origin);
      return true;
    }
    const def = loadAgentDefinition(realSkillMdPath);
    sendJson(res, 200, { slug, capability: agentCapabilityDescriptor(def) }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}
