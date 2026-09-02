/**
 * Forge Studio PUT write route handlers — agents, projects, flows (M2-2).
 *
 * Extracted from bridge-studio.ts to keep both modules under 800 LOC.
 * Imports shared helpers (sendJson, allowedOrigin, sanitizeError, readJson,
 * pathOnly, SLUG_RE) from bridge-studio.ts — no duplication, no circular
 * import (this module imports FROM bridge-studio, not vice versa).
 *
 * Routes:
 *   PUT /api/studio/agents/:slug   → upsert agent SKILL.md
 *   PUT /api/studio/flows/:id      → upsert flow.yaml
 *
 * Returns false for non-matching URLs (passthrough to next handler).
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 *
 * M4-PROJECTS CARVE (§4 step 2, worker B): every PROJECTS route this file
 * used to answer — `POST /api/studio/projects/create`, `POST
 * /api/studio/projects` (onboard), `PUT`+`POST /api/studio/projects/:id`,
 * `POST /api/studio/projects/:id/save-repo`, `POST /api/studio/projects/:id/
 * preflight/fix-auto`, and the projects half of `POST /api/studio/projects/
 * :id/preflight/fix-agent` — has MOVED to `packages/projects/routes.ts`
 * (table) via `bridge-studio-project-onboard.ts` and `bridge-studio-project-preflight-write.ts` (T2
 * assembles the table; not done in this file). `scaffoldContractArtifacts`
 * and `demoProcessChanged` below are now thin re-exports of the moved
 * implementations in `@forge/projects/project-contract-scaffold.ts` and
 * `@forge/projects/bridge-studio-project-onboard.ts` — kept ONLY because two existing test
 * files (`cli/onboard-git-init.test.ts`, `cli/bridge-studio-writes-demo-
 * design.test.ts`) import them directly from this module; every other
 * projects-only helper (`checkContractArtifactContainment`,
 * `resolveManagedProject`, `toClauseDto`, `needsGitInit`, …) moved with no
 * shim, since nothing else in this repo imported them directly. `spawnPreflightFix`
 * stays here (now exported) — it is SESSIONS-owned, not projects', per the
 * M4-projects routes budget row 12b, and `bridge-studio-project-preflight-write.ts`'s
 * `POST .../fix-agent` handler now calls it through an injected dependency
 * instead of a direct import.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, openSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import yaml from 'js-yaml';

import { listAgentDefinitions, listStarterAgents, loadAgentDefinition, loadFlowDefinition, discoverProjects, serializeAgentDefinition, serializeFlowDefinition, listFlowIds, isStudioAgent } from '../orchestrator/studio/registry.ts';
import { loadCatalog } from '@forge/library/studio/catalog-registry.ts';
import { listSkillLibrary } from '@forge/library/studio/skill-trust.ts';
import { checkHookComposition, listHookIds } from '@forge/library/studio/hook-library.ts';
import { communityRegistryPath, loadCommunityRegistry, serializeCommunityRegistry, COMMUNITY_REGISTRY_SCHEMA_VERSION } from '@forge/library/studio/community-registry.ts';
import type { CommunityRegistryItem, CommunityRegistrySource } from '@forge/contracts/studio/types.ts';
import { PLATFORM_GUARD_IDS } from '@forge/agents/agent-bands.ts';
import { skillsDir as toSkillsDir, assertSkillSlug } from '@forge/agents/skill-path.ts';
import { resolveGuardedPath, guardedFile, guardedWriteFile } from '@forge/kernel';
import { removeInstallLedgerEntry } from '@forge/library/studio/skill-install-ledger.ts';
import { CommunityRegistryLockError, lockCommunityRegistry } from '@forge/library/community-registry-lock.ts';
import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';
import { SLUG_RE, isReservedId, validateAgent, validateFlow } from '../orchestrator/studio/validate.ts';
import { MAX_MATERIALS_LENGTH } from '@forge/agents/studio/materials.ts';
import { readArtifactRoot } from '@forge/knowledge/brain-paths.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';
import { isDryBridge } from './dry-bridge.ts';
import { cachedListRuns } from '@forge/flows/run-list-cache.ts';
import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  type StudioContext,
} from './bridge-studio.ts';
// W7-B3 review F8: ONE decode-and-slug-validate helper for community-item URL
// ids — the community routes' own, not a local re-implementation (its
// malformed-%-encoding branch answers a distinct, friendlier 400).
import { decodeIdOrRespond } from '@forge/library/bridge-studio-community.ts';

// ---------------------------------------------------------------------------
// C4 contract-artifact scaffolding (B3) — MOVED to
// @forge/projects/project-contract-scaffold.ts (M4-projects carve, worker B).
// `scaffoldContractArtifacts` is re-exported here, with `readArtifactRoot`
// wired to the real @forge/knowledge implementation (already an accepted,
// baselined `legacy-to-package-not-via-shim` edge for this legacy file —
// see scripts/baselines/boundaries.json), ONLY because
// cli/onboard-git-init.test.ts imports it directly from this module. Every
// other helper that used to live here (ScaffoldContainmentError,
// contractArtifactTargets, needsGitInit, isPackageManagerShaped,
// PM_NATIVE_SUBCOMMANDS, resolveScriptName, needsPackageJsonScaffold,
// checkContractArtifactContainment) moved with NO shim: nothing else in this
// repo imported them directly.
// ---------------------------------------------------------------------------
import { scaffoldContractArtifacts as scaffoldContractArtifactsImpl } from '@forge/projects/project-contract-scaffold.ts';

export function scaffoldContractArtifacts(
  projectRoot: string,
  name: string,
  forgeRoot: string,
  opts: { id?: string; qualityGateCmd?: readonly string[] } = {},
): string[] {
  return scaffoldContractArtifactsImpl(projectRoot, name, forgeRoot, readArtifactRoot, opts);
}

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

// ---------------------------------------------------------------------------
// Write routes (M2-2) — PUT /api/studio/agents/:slug, PUT /api/studio/projects/:id
// ---------------------------------------------------------------------------

// `demoProcessChanged` MOVED to @forge/projects/bridge-studio-project-onboard.ts (M4-projects
// carve, worker B). Re-exported here ONLY because
// cli/bridge-studio-writes-demo-design.test.ts imports it directly from this
// module.
export { demoProcessChanged } from '@forge/projects/bridge-studio-project-onboard.ts';

/**
 * Handle Forge Studio write (PUT) routes.
 *
 * Returns true iff the route was handled (even on error). Returns false for
 * unrecognised URLs so the caller can chain to the next handler.
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 *
 * Security invariants (see self-audit in implementation plan):
 *   1. Slug/id validated against SLUG_RE BEFORE any fs path construction.
 *   2. Resolved fs paths prefix-guarded to their containing directory.
 *   3. Load-merge-write pattern: never clobbers preserved fields.
 *   4. validateAgent / validateFlow block writes on error-level findings.
 */

/**
 * Spawn ONE detached `forge preflight fix` agent turn; events stream to
 * _logs/_preflight-fix-<runId>/events.jsonl. Mirrors spawnBrainFix.
 *
 * SESSIONS-owned (M4-projects routes budget row 12b), not projects' — kept
 * in this file (its original home) rather than moved, since the sessions
 * lane has not carved its routes yet. EXPORTED (it was module-local before
 * the M4-projects carve) so `apps/forge/routes.ts` can inject it into
 * `@forge/projects/bridge-studio-project-preflight-write.ts`'s `makePreflightWriteHandlers`
 * factory as `deps.spawnPreflightFix` — the same injected-dependency shape
 * used for `seedProjectBrain` in `bridge-studio-project-onboard.ts`.
 */
export function spawnPreflightFix(
  forgeRoot: string,
  p: { project: string; clause: string; instruction: string; detail: string; runId: string },
): void {
  // Harness guard: tests pin FORGE_ARCHITECT_NO_SPAWN=1 so the route is exercised
  // without launching a real SDK agent.
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()) return;
  const logDir = join(forgeRoot, '_logs', `_preflight-fix-${p.runId}`);
  mkdirSync(logDir, { recursive: true });
  const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
  const argv = [
    '--experimental-strip-types', 'apps/forge/cli.ts', 'preflight', 'fix',
    '--project', p.project, '--clause', p.clause, '--run-id', p.runId,
    '--instruction', p.instruction, '--detail', p.detail,
  ];
  const proc = spawn(process.execPath, argv, { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] });
  closeSync(stderrFd);
  proc.unref();
}

// ---------------------------------------------------------------------------
// W7-B4 helpers — agent/flow lifecycle (delete guards, no-op detection,
// starter-agent materialisation).
// ---------------------------------------------------------------------------

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

/** Key-sorted JSON — a stable equality basis for the flow no-op check. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The UI-editable projection of a flow definition — the fields a builder
 *  save can actually change. Version is EXCLUDED on purpose: a save that
 *  changes nothing else must not bump it (flows-12's no-op preservation). */
function flowEditableProjection(def: FlowDefinition): string {
  return canonicalJson({
    name: def.name,
    goal: def.goal,
    project: def.project ?? null,
    kb: def.kb ?? null,
    costCeilingUsd: def.costCeilingUsd,
    nodes: def.nodes,
    edges: def.edges,
    triggers: def.triggers,
    kickoff: def.kickoff ?? null,
  });
}

/**
 * W7-B4 (flows-09) — materialise any STARTER agents a flow save references
 * into the real roster (skills/<slug>/), so the seeded plan→dev→review
 * canvas is saveable on a fresh install. The slug set is CLOSED — only slugs
 * `listStarterAgents` itself enumerates (server-controlled values; the
 * client's node.agent strings merely SELECT from that set by equality), and
 * only when skills/<slug> does not already exist (an operator's own agent of
 * the same name always wins — nothing is ever overwritten).
 */
function planStarterAgentMaterialisation(
  forgeRoot: string,
  nodes: unknown[],
): { def: AgentDefinition; destPath: string }[] {
  const wanted = new Set<string>();
  for (const raw of nodes) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const agent = (raw as Record<string, unknown>)['agent'];
    if (typeof agent === 'string' && agent) wanted.add(agent);
  }
  if (wanted.size === 0) return [];
  const planned: { def: AgentDefinition; destPath: string }[] = [];
  for (const starter of listStarterAgents(forgeRoot)) {
    if (!wanted.has(starter.slug)) continue;
    const guard = resolveGuardedPath(toSkillsDir(forgeRoot), [starter.slug]);
    if (!guard.ok || guard.exists) continue; // existing roster agent wins
    planned.push({ def: starter, destPath: guard.realPath });
  }
  return planned;
}

/**
 * W7-B4 review finding 10 — APPLY the plan above. Split from the planning
 * pass because materialisation is a real, persistent mutation of the roster
 * (it copies whole packages into skills/), and it used to run BEFORE
 * validation, the edit-lock and the no-op check: a save that the server then
 * answered 400/423, or that changed nothing at all, still left new agents in
 * skills/. Planning is pure and can therefore still happen early enough to
 * inform validation; only the copy waits until the save is certain to land.
 */
function applyStarterAgentMaterialisation(
  forgeRoot: string,
  planned: { def: AgentDefinition; destPath: string }[],
): string[] {
  const materialized: string[] = [];
  for (const { def, destPath } of planned) {
    cpSync(join(forgeRoot, 'studio', 'starters', 'agents', def.slug), destPath, { recursive: true });

    // agents-44: a starter package is a design-time TEMPLATE and declares no
    // `phase:` — but the copy above lands it in the LIVE, dispatchable roster,
    // and deriveAgentSpec (runAgent()'s synchronous Step 1, before any spawn)
    // hard-requires phase. Copied verbatim, every materialised starter was
    // undispatchable from both the standalone Run button and flow execution,
    // with no in-Studio recovery (a builder re-save preserves an existing
    // agent's absent phase verbatim, by design). Stamp the SAME synthesis the
    // sibling agent-builder PUT path performs for a brand-new mint —
    // `phase: <slug>` — plus the explicit `library: true` every shipped
    // roster agent carries. Only ever applied to a FRESH copy: this path runs
    // exclusively when skills/<slug> did not already exist (see
    // planStarterAgentMaterialisation), so it can never rewrite an operator's
    // own agent.
    // The read/write both go back through the SAME containment guard the
    // destination came from (leaf included) rather than raw-joining onto
    // destPath — the SEC-04 leaf-append rule.
    const skillsRoot = toSkillsDir(forgeRoot);
    const skillMdPath = guardedFile(skillsRoot, [def.slug, 'SKILL.md'], 'read');
    if (skillMdPath === null) {
      throw new Error(`starter "${def.slug}": no readable SKILL.md under skills/${def.slug} after materialisation`);
    }
    const copied = loadAgentDefinition(skillMdPath);
    if (copied.phase === undefined || copied.library === undefined) {
      const stamped: AgentDefinition = {
        ...copied,
        phase: copied.phase ?? copied.slug,
        library: copied.library ?? true,
      };
      // No `originalRaw` fast path on purpose: the frontmatter genuinely
      // CHANGES here (phase is being added), so the byte-preserving branch
      // could never apply — passing it would only imply a fidelity guarantee
      // this write does not have.
      if (guardedWriteFile(skillsRoot, [def.slug, 'SKILL.md'], serializeAgentDefinition(stamped)) === null) {
        throw new Error(`starter "${def.slug}": containment rejected the SKILL.md phase stamp`);
      }
    }

    materialized.push(def.slug);
  }
  return materialized;
}

// W7-B3 (community-23) — community-registry CRUD helpers. The registry
// (studio/community/registry.yaml) had exactly one writer, an agent commit
// path — Studio itself had no add/edit/remove. These helpers give the
// routes below the SAME structural discipline commitRegistryDraft holds:
// parse the body against the loader's own field rules, serialize through
// the ONE shared serializer, write temp-then-rename, and RE-PARSE the temp
// file through loadCommunityRegistry before it replaces the real one (a
// write this module cannot re-load must never land).
//
// Honesty stamps: an operator-written row is hand-curated — `fetchedAt:
// null` / `fetchedBy: 'operator'` are FORCED server-side regardless of what
// the body claims (never a fabricated verification timestamp; the freshness
// badge reads such a row as never-verified, which is the truth).
// ---------------------------------------------------------------------------

// W7-B3 review F1 (confirmed by live probe): the community index projects ONLY
// kind:'skill' rows out of the registry (hooks come from vendored packages,
// mcp/tool from studio/catalog.yaml), so a hand-added hook/mcp/tool row would
// write successfully and then be invisible and un-curatable — the detail page
// the form redirects to 404s and the edit/remove controls live there. The CRUD
// surface therefore admits ONLY 'skill'.
const COMMUNITY_REGISTRY_ITEM_KINDS = ['skill'] as const;

function parseRegistryItemBody(raw: unknown): { ok: true; item: CommunityRegistryItem } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'body must be a JSON object with an "item" field' };
  const itemRaw = (raw as Record<string, unknown>)['item'];
  if (itemRaw === null || typeof itemRaw !== 'object' || Array.isArray(itemRaw)) return { ok: false, error: '"item" must be an object' };
  const e = itemRaw as Record<string, unknown>;

  const requireString = (field: string): string | { error: string } => {
    const v = e[field];
    if (typeof v !== 'string' || v.trim() === '') return { error: `item.${field} is required and must be a non-empty string` };
    return v;
  };

  const id = requireString('id');
  if (typeof id !== 'string') return { ok: false, error: id.error };
  try {
    assertSkillSlug(id, 'community item');
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }

  const kindRaw = e['kind'];
  if (typeof kindRaw !== 'string' || !(COMMUNITY_REGISTRY_ITEM_KINDS as readonly string[]).includes(kindRaw)) {
    return {
      ok: false,
      error: `item.kind must be "skill" — the community index surfaces only skill rows from the registry (hooks are vendored packages under studio/community/hooks/; mcp/tool connections live in studio/catalog.yaml)`,
    };
  }

  const name = requireString('name');
  if (typeof name !== 'string') return { ok: false, error: name.error };
  const category = requireString('category');
  if (typeof category !== 'string') return { ok: false, error: category.error };
  const sourceUrl = requireString('sourceUrl');
  if (typeof sourceUrl !== 'string') return { ok: false, error: sourceUrl.error };
  if (!/^https?:\/\//.test(sourceUrl)) return { ok: false, error: 'item.sourceUrl must be an http(s) URL' };
  const provenance = requireString('provenance');
  if (typeof provenance !== 'string') return { ok: false, error: provenance.error };

  const desc = e['desc'];
  if (desc !== undefined && typeof desc !== 'string') return { ok: false, error: 'item.desc must be a string when present' };
  const tier = e['tier'];
  if (tier !== undefined && typeof tier !== 'string') return { ok: false, error: 'item.tier must be a string when present' };
  // W8-B5 (schema v2, exit row E5): stars / starsDisplay / upstreamUpdatedAt /
  // fetchedAt / fetchedBy are REPO facts and no longer exist on an item at
  // all — they live in the registry's top-level `sources` map, keyed by
  // sourceUrl, and are written only by a refresh that actually got a 200.
  // A body that carries one with a REAL value is refused, naming where the
  // fact belongs: silently ignoring it is the declared-data-fails-open shape
  // (the operator would see their number accepted and never rendered).
  // An explicit `null` carries no information, so it is accepted-and-dropped
  // rather than refused. That is ordinary input tolerance, NOT a back-compat
  // path: forge's own client does not send these keys at all any more
  // (apps/studio/app/community/new/page.tsx's `toInput`, changed alongside this),
  // so nothing in this repo depends on the tolerance. It survives only so a
  // scripted or third-party caller that spells "I have no star count" as an
  // explicit null is not punished for it.
  const retiredRepoFields: Array<[string, unknown]> = [
    ['upstreamUpdatedAt', e['upstreamUpdatedAt']],
    ['fetchedAt', e['fetchedAt']],
    ['fetchedBy', e['fetchedBy']],
  ];

  const signalsRaw = e['signals'];
  let attributedTo: string | null = null;
  if (signalsRaw !== undefined && signalsRaw !== null) {
    if (typeof signalsRaw !== 'object' || Array.isArray(signalsRaw)) return { ok: false, error: 'item.signals must be an object when present' };
    const s = signalsRaw as Record<string, unknown>;
    retiredRepoFields.push(['signals.stars', s['stars']], ['signals.starsDisplay', s['starsDisplay']]);
    if (s['attributedTo'] !== undefined && s['attributedTo'] !== null && typeof s['attributedTo'] !== 'string') return { ok: false, error: 'item.signals.attributedTo must be a string or null' };
    attributedTo = (s['attributedTo'] as string | null | undefined) ?? null;
  }

  for (const [field, value] of retiredRepoFields) {
    if (value !== undefined && value !== null) {
      return {
        ok: false,
        error: `item.${field} is a REPO-level fact and is not a property of an item — it lives in the registry's "sources" map, keyed by this item's sourceUrl, and is written only by "forge community refresh". Remove it from the body.`,
      };
    }
  }

  return {
    ok: true,
    item: {
      id,
      kind: kindRaw as CommunityRegistryItem['kind'],
      name,
      ...(desc !== undefined ? { desc } : {}),
      category,
      sourceUrl,
      provenance,
      ...(tier !== undefined ? { tier } : {}),
      // `attributedTo` is the ONLY signal an item carries in v2: it is a
      // curation note ("who to credit for THIS skill"), not a fetched
      // repo-level fact. W7-B3 review F4/F5 protected stars/starsDisplay/
      // upstreamUpdatedAt by forcing them server-side; v2 protects them
      // structurally instead — an item has no such field to force.
      signals: { attributedTo },
    },
  };
}

/** Load the live registry tolerantly (missing file = the fresh-root empty
 *  baseline), apply `mutate`, then temp-write → re-parse → rename. A `null`
 *  from `mutate` means "refused, write NOTHING" — the file stays
 *  byte-identical (a 409/404 must never reformat the registry as a side
 *  effect). Throws on a malformed EXISTING registry (never half-trusts a
 *  corrupt file) and on a produced document the loader itself refuses.
 *
 *  W8-B5 security review, FINDING 1: the WHOLE read-modify-write runs under
 *  the shared registry mutex (cli/community-registry-lock.ts), and the load
 *  below happens INSIDE it — the same lock, on the same path, that
 *  `runCommunityRefresh` and `commitRegistryDraft` take. A lock only one of
 *  three writers honours is not a lock, which is why there is exactly one
 *  helper and all three call it. Contention throws
 *  `CommunityRegistryLockError`, which every arm below renders as a 503;
 *  nothing is written on that path. The critical section is fs-only and
 *  sub-millisecond — no caller of this function does network I/O while
 *  holding it. */
async function mutateCommunityRegistry(
  forgeRoot: string,
  mutate: (items: CommunityRegistryItem[]) => CommunityRegistryItem[] | null,
): Promise<void> {
  const destPath = communityRegistryPath(forgeRoot);
  // Ahead of the lock, not after the mutate: the mutex is taken on
  // studio/community/ itself, so on a fresh forge root the directory has to
  // exist before two concurrent creators have anything to serialise on.
  mkdirSync(dirname(destPath), { recursive: true });
  const release = await lockCommunityRegistry(forgeRoot);
  try {
    const existing = existsSync(destPath)
      ? loadCommunityRegistry(destPath)
      : {
          schemaVersion: COMMUNITY_REGISTRY_SCHEMA_VERSION as number,
          lastRefresh: null as string | null,
          sources: {} as Record<string, CommunityRegistrySource>,
          items: [] as CommunityRegistryItem[],
          leadingComments: '',
        };
    const nextItems = mutate([...existing.items]);
    if (nextItems === null) return;
    // W8-B5 (exit row E4): `leadingComments` threads the file's curation header
    // through the ONE shared serializer, so a CRUD write no longer destroys it.
    // `sources` is carried forward untouched — a CRUD edit is curation, never a
    // refresh, and must not disturb a repo fact (nor prune a source row a
    // re-added item would want back). That split is also what makes the
    // refresh's re-load-under-lock merge safe: CRUD owns `items`, a refresh
    // owns `sources` + `lastRefresh`, and neither writes the other's half.
    const serialized = serializeCommunityRegistry({
      schemaVersion: existing.schemaVersion,
      lastRefresh: existing.lastRefresh,
      sources: existing.sources,
      items: nextItems,
      leadingComments: existing.leadingComments,
    });

    const tempPath = join(dirname(destPath), `.registry.yaml.tmp-${randomBytes(6).toString('hex')}`);
    writeFileSync(tempPath, serialized, 'utf8');
    try {
      loadCommunityRegistry(tempPath); // structural round-trip — the ONE loader is the validator
      renameSync(tempPath, destPath);
    } catch (err) {
      try {
        unlinkSync(tempPath);
      } catch {
        /* best-effort cleanup */
      }
      throw err;
    }
  } finally {
    await release();
  }
}

/** W8-B5 security review, FINDING 1: lock contention is a 503 ("another
 *  writer holds the registry, retry"), never the 500 every other failure in
 *  these arms renders. Kept as one helper so the three CRUD arms cannot drift
 *  into answering the same condition three different ways. */
function sendRegistryWriteFailure(res: ServerResponse, err: unknown, origin: string): void {
  if (err instanceof CommunityRegistryLockError) {
    sendJson(res, 503, { error: err.message, reason: 'registry-locked' }, origin);
    return;
  }
  sendJson(res, 500, { error: sanitizeError(err) }, origin);
}

export async function handleStudioWriteRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'PUT' && method !== 'POST' && method !== 'DELETE') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // W7-B3 review F3 (guard-symmetry), WIDENED at the W7-B4 merge: DELETE is
  // admitted into this function ONLY for the three routes that actually
  // implement it — the community registry item (W7-B3) and the agent/flow
  // deletes (W7-B4). Every OTHER write arm (projects/:id, save-repo,
  // preflight/*, ...) dispatches on its URL match alone with no `method ===`
  // test, so an unscoped DELETE would fall into a PUT handler and act; those
  // still fall through here (404), exactly as before W7-B3 added the method
  // to the top gate.
  //
  // This list is load-bearing and must grow with every new DELETE arm: W7-B3
  // wrote it as `!registryItemMatch` when the registry item was the only
  // DELETE route, and merging W7-B4 (which added two more) silently disabled
  // BOTH of them — the auto-merge was clean, and only the acceptance suite
  // caught it. Adding a DELETE arm below without adding its match here is a
  // route that answers 404 forever.
  const registryItemMatch = url.match(/^\/api\/studio\/community\/registry\/items\/([^/]+)$/);
  const agentDeleteMatch = url.match(/^\/api\/studio\/agents\/([^/]+)$/);
  const flowDeleteMatch = url.match(/^\/api\/studio\/flows\/([^/]+)$/);
  if (method === 'DELETE' && !registryItemMatch && !agentDeleteMatch && !flowDeleteMatch) return false;

  // ---- W7-B3 (community-23): community registry CRUD ----------------------
  if (method === 'POST' && url === '/api/studio/community/registry/items') {
    try {
      const parsed = parseRegistryItemBody(await readJson(req));
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error }, origin);
        return true;
      }
      let conflict = false;
      await mutateCommunityRegistry(ctx.forgeRoot, (items) => {
        if (items.some((i) => i.id === parsed.item.id)) {
          conflict = true;
          return null; // refused — the file stays byte-identical
        }
        return [...items, parsed.item];
      });
      if (conflict) {
        sendJson(res, 409, { error: `a registry item with id "${parsed.item.id}" already exists — edit it instead` }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, id: parsed.item.id }, origin);
    } catch (err) {
      sendRegistryWriteFailure(res, err, origin);
    }
    return true;
  }

  // (PUT and DELETE are two separate dispatch lines, each with its own
  // explicit `method ===` test, so cli/dry-bridge-coverage.test.ts's route
  // derivation sees BOTH — a combined `(PUT || DELETE)` arm derives only the
  // first method and leaves the DELETE invisible to the coverage gate.
  // `registryItemMatch` itself is hoisted to the top of this function: the
  // DELETE-scoping guard there needs it.)
  if (registryItemMatch && method === 'PUT') {
    try {
      const id = decodeIdOrRespond(registryItemMatch[1], res, origin);
      if (id === null) return true;
      const parsed = parseRegistryItemBody(await readJson(req));
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error }, origin);
        return true;
      }
      if (parsed.item.id !== id) {
        sendJson(res, 400, { error: `item.id "${parsed.item.id}" does not match the URL id "${id}" — a rename is delete + add` }, origin);
        return true;
      }
      let found = false;
      await mutateCommunityRegistry(ctx.forgeRoot, (items) => {
        const next = items.map((i) => {
          if (i.id !== id) return i;
          found = true;
          // W8-B5 (schema v2): W7-B3 review F4's "carry the existing row's
          // agent-fetched facts forward" is now unnecessary by construction —
          // an item HAS no fetched facts to wipe. They live on the shared
          // `sources` row, which `mutateCommunityRegistry` carries forward
          // untouched, so an operator edit cannot disturb another item's data
          // either. `attributedTo` remains operator-editable curation.
          return { ...parsed.item };
        });
        return found ? next : null; // 404 path writes nothing
      });
      if (!found) {
        sendJson(res, 404, { error: `no registry item with id "${id}"` }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendRegistryWriteFailure(res, err, origin);
    }
    return true;
  }

  if (registryItemMatch && method === 'DELETE') {
    try {
      const id = decodeIdOrRespond(registryItemMatch[1], res, origin);
      if (id === null) return true;
      let found = false;
      await mutateCommunityRegistry(ctx.forgeRoot, (items) => {
        const next = items.filter((i) => {
          if (i.id === id) {
            found = true;
            return false;
          }
          return true;
        });
        return found ? next : null; // 404 path writes nothing
      });
      if (!found) {
        sendJson(res, 404, { error: `no registry item with id "${id}"` }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendRegistryWriteFailure(res, err, origin);
    }
    return true;
  }

  // ---- PUT /api/studio/agents/:slug ----------------------------------------
  const agentMatch = url.match(/^\/api\/studio\/agents\/([^/]+)$/);
  if (agentMatch) {
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
        // isStudioAgent refusal (cli/bridge-studio-skills.ts), pointing the
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
        const composedBy = listSkillLibrary(ctx.forgeRoot).find((e) => e.id === slug)?.usedBy ?? [];
        if (composedBy.length > 0) {
          sendJson(res, 409, {
            error: `agent "${slug}" is still composed by ${composedBy.length} agent(s): ${composedBy.join(', ')} — unbind it from their builders first`,
            usedBy: composedBy,
          }, origin);
          return true;
        }
        const referencingFlows: string[] = [];
        for (const flowId of listFlowIds(ctx.forgeRoot)) {
          const guarded = resolveGuardedPath(resolve(ctx.forgeRoot, 'studio', 'flows'), [flowId, 'flow.yaml']);
          if (!guarded.ok || !guarded.exists) continue;
          try {
            const def = loadFlowDefinition(guarded.realPath);
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
        // cli/bridge-studio-skills.ts's DELETE route ordering: a crash
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
        body = await readJson(req);
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
      // tool (cli/studio-lint-tool-fence.ts) — this is a security control, not
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
      // at spawn") — mirrors cli/studio-lint.ts's identical block; a missing
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
  }

  // ---- PUT /api/studio/flows/:id -------------------------------------------
  const flowMatch = url.match(/^\/api\/studio\/flows\/([^/]+)$/);
  if (flowMatch) {
    try {
      const id = decodeURIComponent(flowMatch[1]);

      // 1. Slug-guard before any fs path construction (blocks path traversal)
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid flow id — must match [a-z][a-z0-9]*(-[a-z0-9]+)*' }, origin);
        return true;
      }
      // W7-A4 (crosscut-20): `new` is the /flows/new builder segment, never a flow.
      if (isReservedId(id)) {
        sendJson(res, 400, { error: `flow id "${id}" is reserved (the /flows/new builder lives at that path) — choose another id` }, origin);
        return true;
      }

      // 2. Resolve + guard the flow.yaml path through the shared containment
      // guard (cli/studio-path-guard.ts). The former lexical
      // `startsWith(flowsBase + sep)` check had NO dirent-type gate anywhere
      // backing it up (unlike discoverProjects()'s isDirectory() filter for
      // projects) — all four escape shapes were reproduced live here.
      const flowsBase = resolve(ctx.forgeRoot, 'studio', 'flows');
      const pathGuard = resolveGuardedPath(flowsBase, [id, 'flow.yaml']);
      if (!pathGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }
      const flowYamlPath = pathGuard.realPath;

      // ---- DELETE /api/studio/flows/:id (W7-B4, flows-11) ------------------
      // A shipped seed is refused outright (403 — the OOTB pipeline is not
      // deletable state); an in-flight run locks deletion exactly like edits
      // (423, ADR-028 D6); an authored flow deletes with its directory.
      if (method === 'DELETE') {
        if (!pathGuard.exists) {
          sendJson(res, 404, { error: `unknown flow "${id}"` }, origin);
          return true;
        }
        // W7-B4 review finding 7: the seed refusal must not DEPEND on a
        // successful parse. A corrupted authored flow.yaml used to answer 500
        // here, leaving the flow permanently undeletable from Studio (hand
        // surgery on disk was the only exit) — while the library listing kept
        // rendering it. On a parse failure we fall back to a raw-text seed
        // probe: a file that still declares `origin: seed` is refused exactly
        // as a parsed seed would be, and anything else is treated as authored
        // and deletable. Deleting is the recovery action for a broken flow.
        let def: FlowDefinition | null = null;
        try {
          def = loadFlowDefinition(flowYamlPath);
        } catch {
          const raw = readFileSync(flowYamlPath, 'utf8');
          if (/^\s*origin:\s*['"]?seed['"]?\s*$/m.test(raw)) {
            sendJson(res, 403, { error: `flow "${id}" is a shipped seed (origin: seed) — the OOTB pipeline cannot be deleted from Studio` }, origin);
            return true;
          }
        }
        if (def && def.origin === 'seed') {
          sendJson(res, 403, { error: `flow "${id}" is a shipped seed (origin: seed) — the OOTB pipeline cannot be deleted from Studio` }, origin);
          return true;
        }
        const activeDel = cachedListRuns(ctx.forgeRoot, Date.now()).find(
          (r) => r.flowId === id && r.status === 'active',
        );
        if (activeDel) {
          sendJson(res, 423, { error: 'flow locked — a run is in flight', runId: activeDel.id }, origin);
          return true;
        }
        // W7-B4 review finding 6 (dangling reference) — refuse while a SIBLING
        // flow triggers on this one. Every other delete on this surface has a
        // referenced-by guard; without this, `triggers[].target.ref` was left
        // pointing at nothing, which fails that sibling's next save and errors
        // studio lint. A malformed sibling is studio-lint's finding, not a
        // reason to block (or unblock) this delete — same rule the agent
        // delete's flow scan uses.
        const triggeringFlows: string[] = [];
        for (const otherId of listFlowIds(ctx.forgeRoot)) {
          if (otherId === id) continue;
          const g = resolveGuardedPath(flowsBase, [otherId, 'flow.yaml']);
          if (!g.ok || !g.exists) continue;
          try {
            const otherDef = loadFlowDefinition(g.realPath);
            if (otherDef.triggers.some((t) => t.target?.kind === 'flow' && t.target.ref === id)) {
              triggeringFlows.push(otherId);
            }
          } catch {
            // malformed sibling: studio lint's finding, not this route's
          }
        }
        if (triggeringFlows.length > 0) {
          sendJson(res, 409, {
            error: `flow "${id}" is the trigger target of ${triggeringFlows.length} flow(s): ${triggeringFlows.join(', ')} — retarget or remove those triggers first`,
            referencedBy: triggeringFlows,
          }, origin);
          return true;
        }
        rmSync(dirname(flowYamlPath), { recursive: true, force: true });
        sendJson(res, 200, { ok: true, id }, origin);
        return true;
      }

      // 3. Parse request body
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }, origin);
        return true;
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'body must be a JSON object' }, origin);
        return true;
      }
      const b = body as Record<string, unknown>;

      // W7-B4 (flows-13): an EXPLICIT create must never silently overwrite an
      // existing flow — /flows/new sends `create: true`, collides with 409.
      if (b['create'] === true && pathGuard.exists) {
        sendJson(res, 409, {
          error: `flow "${id}" already exists — open /flows/${id} to edit it, or pick another name`,
        }, origin);
        return true;
      }

      // 4. Load existing flow (or scaffold for new flow)
      let existing: FlowDefinition | null = null;
      if (pathGuard.exists) {
        try {
          existing = loadFlowDefinition(flowYamlPath);
        } catch (err) {
          sendJson(res, 500, { error: sanitizeError(err) }, origin);
          return true;
        }
      }

      // W7-B4 (flows-09): a save referencing STARTER agents materialises them
      // into the roster, so the seeded plan→dev→review canvas actually
      // validates (agent-ref) on a fresh install. Closed slug set; an existing
      // skills/<slug> always wins. Only the PLAN is computed here (pure) — the
      // copy itself runs after every gate below (review finding 10); the
      // planned definitions are folded into the agents map so validation still
      // sees the agents this save is about to create.
      const plannedStarterAgents = planStarterAgentMaterialisation(
        ctx.forgeRoot,
        Array.isArray(b['nodes']) ? (b['nodes'] as unknown[]) : [],
      );

      // 5. Merge UI-editable fields over existing; preserve id/origin/disposable/path
      const name = typeof b['name'] === 'string' ? b['name'] : existing?.name ?? id;
      const goal = typeof b['goal'] === 'string' ? b['goal'] : existing?.goal ?? '';
      const project =
        b['project'] !== undefined
          ? (typeof b['project'] === 'string' ? b['project'] : null)
          : (existing?.project ?? null);
      const kb =
        b['kb'] !== undefined
          ? (typeof b['kb'] === 'string' ? b['kb'] : null)
          : (existing?.kb ?? null);
      const costCeilingUsd =
        typeof b['costCeilingUsd'] === 'number'
          ? b['costCeilingUsd']
          : existing?.costCeilingUsd ?? 2.0;

      // nodes/edges/triggers: only override if provided in body
      const nodes = Array.isArray(b['nodes']) ? b['nodes'] : (existing?.nodes ?? []);
      const edges = Array.isArray(b['edges']) ? b['edges'] : (existing?.edges ?? []);
      const triggers = Array.isArray(b['triggers']) ? b['triggers'] : (existing?.triggers ?? []);

      // Bump version: n+1 for existing, 1 for new
      const version = (existing?.version ?? 0) + 1;

      const merged: FlowDefinition = {
        id,
        name,
        version,
        goal,
        project,
        kb,
        costCeilingUsd,
        origin: existing?.origin ?? 'studio',
        disposable: existing?.disposable,
        nodes: nodes as FlowDefinition['nodes'],
        edges: edges as FlowDefinition['edges'],
        triggers: triggers as FlowDefinition['triggers'],
        // W7-B4 (flows-12): kickoff is a NON-UI field the builder never
        // sends — it must ride the merge like origin/disposable, or every
        // BUILD-tab save of a seeded flow silently strips its launch surface.
        kickoff: existing?.kickoff,
        path: flowYamlPath,
      };

      // 6. Build agents map for validateFlow
      const skillsDir = toSkillsDir(ctx.forgeRoot);
      let agentsList: AgentDefinition[] = [];
      try {
        agentsList = listAgentDefinitions(skillsDir);
      } catch {
        // skills dir absent in tests — proceed with empty map (agent-ref check will flag)
      }
      const agentsMap = new Map(agentsList.map((a) => [a.slug, a]));
      // Fold in the starters this save would materialise, so the agent-ref
      // check passes on the strength of the PLAN rather than of a side effect
      // that has already been committed to disk.
      for (const { def } of plannedStarterAgents) {
        if (!agentsMap.has(def.slug)) agentsMap.set(def.slug, def);
      }

      // 7. Validate — reject on any error-level finding. `flowProjectOf`
      // resolves the TARGET flow's project (R2-04) so the external-trigger
      // project requirement checks the flow the mint actually uses. `merged`
      // (the flow being saved) is resolved from memory so an in-flight edit to
      // its own project is honored; other targets load from disk.
      const flowProjectOf = (id: string): string | null | undefined => {
        if (id === merged.id) return merged.project;
        // CONTAINMENT (bd `forge-b2k`). `id` here is NOT the URL's `:id` — it
        // is `triggers[].target.ref` out of the REQUEST BODY, and the
        // SLUG_RE gate on this route covers the URL param only, never this
        // path. It used to reach a bare `join()` + read, which leaked a
        // boolean existence oracle: "is there a project-bearing,
        // flow.yaml-shaped file at this `..`-traversed location?", surfaced as
        // a difference in the returned validation findings.
        //
        // Two layers, matching the four already-fixed write routes:
        //   1. SLUG_RE as the independent first layer (defense in depth).
        //   2. The shared realpath identity guard, with `studio/flows` as a
        //      fixed forgeRoot-derived root and `id` as its OWN segment.
        // Every rejection returns `undefined` — byte-identical to "no such
        // flow" — because an oracle closes only when the rejected and the
        // not-found cases are indistinguishable to the caller.
        if (!SLUG_RE.test(id)) return undefined;
        const guarded = resolveGuardedPath(resolve(ctx.forgeRoot, 'studio', 'flows'), [id, 'flow.yaml']);
        if (!guarded.ok || !guarded.exists) return undefined;
        try {
          return loadFlowDefinition(guarded.realPath).project;
        } catch {
          return undefined;
        }
      };
      // R2-08-F1: thread the discovered-project id set so the trigger-projects
      // membership check runs on this write path too (mirrors flowIds above) —
      // the write path must reject the same shapes the dispatcher/lint reject,
      // not just accept-and-fail-later on the next load.
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const findings = validateFlow(merged, agentsMap, {
        flowIds: new Set(listFlowIds(ctx.forgeRoot)),
        flowProjectOf,
        projectIds: new Set(discoverProjects(projectsDir, ctx.forgeRoot).map((p) => p.id)),
      });
      const hasErrors = findings.some((f) => f.level === 'error');
      if (hasErrors) {
        sendJson(res, 400, { error: 'validation failed', findings }, origin);
        return true;
      }

      // 8. Edit-lock: reject if a run of this flowId is currently active (ADR-028 D6)
      // The predicate `r.flowId === id` is correct: since S8/DEC-3 run-model stamps
      // each run with the flowId its manifest names (forge-architect /
      // forge-develop), so a run of THIS flow is locked while in flight.
      // Pre-S8 manifests with no flow_id stamp as 'unknown' (never matches a real
      // editable flow id) — correct, an unknowable archival flow is not editable.
      // ADR-044 P1: cached per-manifest derivation — see cli/run-list-cache.ts.
      const activeRun = cachedListRuns(ctx.forgeRoot, Date.now()).find(
        (r) => r.flowId === id && r.status === 'active',
      );
      if (activeRun) {
        sendJson(res, 423, { error: 'flow locked — a run is in flight', runId: activeRun.id }, origin);
        return true;
      }

      const flagFindings = findings.filter((f) => f.level === 'flag');

      // W7-B4 (flows-12): a save that changes NOTHING the builder can edit is
      // a no-op — the file is left byte-identical (hand-authored comments in
      // seed files survive) and the version does not bump. serializeFlow-
      // Definition drops YAML comments by construction, so "don't rewrite"
      // is the only preservation that actually preserves.
      if (existing && flowEditableProjection(existing) === flowEditableProjection(merged)) {
        sendJson(res, 200, { ok: true, id, version: existing.version, noop: true, findings: flagFindings }, origin);
        return true;
      }

      // Every gate has passed and this save WILL land — only now is the roster
      // mutated (review finding 10).
      const materializedAgents = applyStarterAgentMaterialisation(ctx.forgeRoot, plannedStarterAgents);

      // 9. Serialize and write. Derive from the ALREADY-GUARDED real path.
      const serialized = serializeFlowDefinition(merged);
      const flowDir = dirname(flowYamlPath);
      if (!existsSync(flowDir)) {
        mkdirSync(flowDir, { recursive: true });
      }
      writeFileSync(flowYamlPath, serialized, 'utf8');

      sendJson(res, 200, {
        ok: true,
        id,
        version,
        findings: flagFindings,
        ...(materializedAgents.length > 0 ? { materializedAgents } : {}),
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
