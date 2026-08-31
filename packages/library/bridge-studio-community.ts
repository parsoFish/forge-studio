/**
 * Forge Studio community-browser bridge routes (R3-07-F2/F3,
 * `_wave5/specs/R3-07.md`).
 *
 * Owns EVERY `/api/studio/community*` route:
 *
 *   GET  /api/studio/community            → { hubs, items } (D1: derived from
 *        WI-1's `hubsWithCounts` / `listCommunityIndex` — no fourth declared
 *        list; each item is projected onto the wire shape below)
 *   GET  /api/studio/community/:kind/:id  → the item plus kind-appropriate
 *        payload: `files` for vendored skill/hook packages, `scan` (a REAL,
 *        pre-install run of R3-03's scanner over the vendored bytes) for
 *        hooks, `capabilities`/`capabilitiesSource`/`install`/`config`/`probe`
 *        for mcp/tool (mirrors bridge-studio-connections.ts's own detail
 *        shape exactly).
 *   POST /api/studio/community/:kind/:id/install → dispatches to whichever
 *        already-merged pipeline `routeCommunityInstall` names — this module
 *        never decides trust, it only routes to the pipeline that does.
 *
 * D2 (structural negative AC): this module never approves, overrides, or
 * mutates trust for anything — every branch below either materialises a
 * quarantined draft (the owning pipeline's own contract) or 400/404s. No
 * function in this file can turn an installed-but-unreviewed object into a
 * trusted one (`cli/community-no-trust-decisions.test.ts` scans this file's
 * source text for the five functions that could).
 *
 * WIRE PROJECTION — WI-1's `CommunityItem` (orchestrator/studio/
 * community-index.ts) carries `description?`/`probeState?` as narrow/optional
 * facts; the wire item below is a STRICTER, always-present projection built
 * for the client's refuse-don't-coerce parser
 * (apps/studio/lib/community-client.ts):
 *
 *   - `desc` is ALWAYS a string — a source record with no description
 *     renders the honest sentinel "No description published." (same idiom
 *     D5 already uses for signals: state the absence, never fabricate content
 *     or default to "").
 *   - `upstream` is the item's OWN real source URL — a vendored item's own
 *     forge-seed URL (matches VENDORED_UPSTREAM_SOURCE, the same real,
 *     literal constant community-index.ts/community-install.ts already use
 *     for hub resolution), or the catalog `source`/connection `provenance`
 *     field for a non-vendored item. Read from the SAME primary records WI-1
 *     itself reads (studio/community/registry.yaml, listConnections) — never
 *     a second declared list, never hub.url substituted in (a hub can be a
 *     coarser prefix of an item's own upstream link — see studio/catalog.yaml's
 *     real MCP entries, which point at a `tree/main/src/<name>` subpath of
 *     their hub's repo root).
 *   - `probeState` is the REAL live probe state for a tool/mcp item (not just
 *     the narrower "misconfigured only" fact WI-1's own type surfaces), and
 *     null for a skill/hook (no probe concept exists for either).
 *   - `origin` names which real registry record produced the item, mirroring
 *     `usedByDerivation`/`carriedByDerivation`'s "name the source" device
 *     elsewhere in this codebase.
 *
 * Anti-pattern #3 (this campaign's own named lesson — "a route that 500s on
 * one bad neighbour"): the LIST route wraps each item's wire projection in
 * its own try/catch (`toWireItemSafe`) — one item's derivation failure
 * degrades to an honest `error` field on THAT item, never a 500 for the
 * other N-1.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, type StudioContext } from '../../cli/bridge-studio.ts';
import { isDryBridge, refuseDryBridge } from '../../cli/dry-bridge.ts';
import { assertSkillSlug } from '@forge/agents/skill-path.ts';
import {
  hubCountsFrom,
  listCommunityHubs,
  listCommunityIndex,
  communityItem,
  buildConnectionItem,
  readVendoredPackage,
  COMMUNITY_KINDS,
  type CommunityKind,
  type CommunityItem,
} from './studio/community-index.ts';
import { routeCommunityInstall, installCommunityHookPackage } from './studio/community-install.ts';
import { installSkillPackage, type PackageFile } from './studio/skill-library.ts';
import { scanHookFiles, type HookScanReport } from './studio/hook-scan.ts';
import type { HookPackageFile } from './studio/hook-package.ts';
import {
  HOOK_LIFECYCLE_EVENTS,
  hookTriggerError,
  type HookLifecycleEvent,
  type HookPermissionManifest,
} from './studio/hook-library.ts';
import { listConnections, type ConnectionDefinition } from './studio/connection-library.ts';
import { probeConnection, buildProbeChildEnv, CONNECTIONS_DIR, type ProbeState } from './studio/connection-probe.ts';
import { installArgvFor, installConnection } from './studio/connection-install.ts';
import { communitySkillsFromRegistry, communityRegistryPath, loadCommunityRegistry } from '../../orchestrator/studio/registry.ts';
import { reqString, stringArray, optBool, optString, oneOf } from '@forge/kernel/studio/yaml-fields.ts';
import {
  communityRefreshRemedy,
  runCommunityRefresh,
  type CommunityRefreshRunReason,
} from './community-refresh-run.ts';
import type { CommunitySkill } from '@forge/contracts/studio/types.ts';

/** Bounded wall-clock budget for the real `npm install` child (production
 *  only — every AT that exercises this route pins FORGE_ARCHITECT_NO_SPAWN=1
 *  and never reaches this branch). Mirrors bridge-studio-connections.ts's own
 *  constant exactly — kept local rather than shared to avoid a cross-module
 *  coupling for one number. */
const INSTALL_TIMEOUT_MS = 120_000;

/** Every real committed vendored package (studio/community/{skills,hooks}/)
 *  is forge-authored and attributed to this repo's own seed hub — the same
 *  real, literal URL community-index.ts/community-install.ts already name
 *  for hub resolution (duplicated there twice already; a third read-only
 *  copy here follows that established convention rather than exporting a
 *  cross-module constant for one string). */
const VENDORED_UPSTREAM_SOURCE = 'https://github.com/parsoFish/forge-studio';

/** D5's "no signals published" idiom, applied to description: a source
 *  record with no description renders an honest statement of absence, never
 *  a fabricated string and never a silently-dropped wire field. */
const NO_DESCRIPTION = 'No description published.';

// ---------------------------------------------------------------------------
// Wire projection
// ---------------------------------------------------------------------------

type CommunityItemWire = {
  id: string;
  kind: CommunityKind;
  name: string;
  desc: string;
  /** W8-B5 (community-05 / exit row E11) — the registry row's OWN `category`,
   *  so `/community`'s search can match the word the registry actually files
   *  rows under ("planning", "memory", "review"). It reached the client
   *  nowhere before this, which is why adding the search term alone would
   *  have been a no-op.
   *
   *  `null` is LOAD-BEARING and never an invented string: a vendored package
   *  or a catalog connection has no registry row at all, so it genuinely has
   *  no category. Same discipline as `hub`/`signals` — an honest absence,
   *  never a fabricated value, and deliberately not `''` (an empty string
   *  would make every empty-ish query "match" it). */
  category: string | null;
  upstream: string;
  hub: CommunityItem['hub'];
  signals: CommunityItem['signals'];
  vendored: boolean;
  installState: CommunityItem['installState'];
  probeState: ProbeState | null;
  origin: string;
  /** W6-CR-2 — carried straight through from the item's own real fact (D14 in
   *  community-index.ts): null/'local' for a vendored package or connection
   *  with no registry row, never fabricated. */
  fetchedAt: CommunityItem['fetchedAt'];
  fetchedBy: CommunityItem['fetchedBy'];
  upstreamUpdatedAt: CommunityItem['upstreamUpdatedAt'];
  error?: string;
};

type WireCtx = {
  communitySkills: readonly CommunitySkill[];
  connections: readonly ConnectionDefinition[];
};

/** T2 round 6, AT GROUP 5: mirrors listCommunityIndex's own deliberate
 *  missing-vs-malformed split (orchestrator/studio/community-index.ts, MAJOR
 *  2) at the ROUTE level, now over TWO independent files (W6-CR-1 decoupled
 *  community-skill sourcing from catalog.yaml):
 *   - connections: `listConnections` calls `loadCatalog` unguarded — correct
 *     for ITS callers, which never expect a catalog-less root — so this
 *     function must not call it at all when studio/catalog.yaml is genuinely
 *     absent (the fresh/half-onboarded shape: degrade to no connections,
 *     never a 500).
 *   - communitySkills: `communitySkillsFromRegistry` is tolerant of a MISSING
 *     studio/community/registry.yaml (degrades to `[]`) but throws loud on a
 *     MALFORMED one (via its own unguarded `loadCommunityRegistry` call) — a
 *     corrupt registry must never render identically to an honest empty one. */
function buildWireCtx(forgeRoot: string): WireCtx {
  const catalogPath = join(forgeRoot, 'studio', 'catalog.yaml');
  const catalogExists = existsSync(catalogPath);
  const communitySkills = communitySkillsFromRegistry(forgeRoot);
  const connections = catalogExists ? listConnections(forgeRoot) : [];
  return { communitySkills, connections };
}

/**
 * W7-B3 (community-16 / community-03) — the registry-level `meta` block on
 * the list payload:
 *   - `lastRefresh`: the commitRegistryDraft stamp, straight from
 *     studio/community/registry.yaml's own `meta.lastRefresh` — never
 *     re-derived from item rows. A missing registry file is the honest
 *     fresh-root `null`.
 *   - `registryDirty`: whether the repo-tracked registry file carries
 *     uncommitted changes (Studio writes it on approve; the operator commits
 *     via their normal git flow — the page must say when that commit is
 *     still pending). THREE-state: true/false only when git itself answered;
 *     `null` when the forge root is not a git repo or git is unavailable —
 *     an unknown must never render as a fabricated "clean".
 * Fixed argv, fixed path — nothing request-derived reaches the child.
 */
function communityIndexMeta(forgeRoot: string): { lastRefresh: string | null; registryDirty: boolean | null } {
  const registryPath = communityRegistryPath(forgeRoot);
  const lastRefresh = existsSync(registryPath) ? loadCommunityRegistry(registryPath).lastRefresh : null;
  let registryDirty: boolean | null = null;
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', 'studio/community/registry.yaml'], {
      cwd: forgeRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    registryDirty = out.trim().length > 0;
  } catch {
    registryDirty = null;
  }
  return { lastRefresh, registryDirty };
}

function originFor(item: CommunityItem): string {
  if (item.kind === 'skill') {
    return item.vendored ? `studio/community/skills/${item.id}/SKILL.md` : 'studio/community/registry.yaml';
  }
  if (item.kind === 'hook') return `studio/community/hooks/${item.id}/hook.yaml`;
  return `listConnections (studio/catalog.yaml ${item.kind}s:)`;
}

/**
 * W8-B5 (exit row E11) — the item's category, read from the ONE place it is
 * declared: the registry row this item was sourced from (`CommunitySkill`,
 * itself projected from `CommunityRegistryItem`). Never derived, never
 * guessed, never defaulted to a plausible-looking string.
 *
 * A vendored-only skill package, a vendored hook and a catalog connection all
 * have NO registry row (D1's other two sources), so they honestly carry
 * `null` — the same treatment `fetchedAt`/`upstreamUpdatedAt` already get for
 * exactly the same reason (D14).
 */
function categoryFor(item: CommunityItem, ctx: WireCtx): string | null {
  if (item.kind !== 'skill') return null;
  const cs = ctx.communitySkills.find((c) => c.id === item.id);
  return cs ? cs.category : null;
}

/** The item's own real source link — never hub.url substituted in (see this
 *  file's header: a hub can be a coarser prefix of an item's own upstream). */
function upstreamFor(item: CommunityItem, ctx: WireCtx): string {
  if (item.vendored) return VENDORED_UPSTREAM_SOURCE;
  if (item.kind === 'hook') {
    // Unreachable under D1 (every hook item is sourced from a vendored
    // package) — thrown, not guessed, if that invariant is ever violated.
    throw new Error(`community item "${item.id}" (hook) is not vendored — every hook item must be vendored (D1)`);
  }
  if (item.kind === 'skill') {
    const cs = ctx.communitySkills.find((c) => c.id === item.id);
    if (!cs) {
      throw new Error(`community item "${item.id}" (skill) is not vendored and has no studio/community/registry.yaml community-skills entry`);
    }
    return cs.source;
  }
  const conn = ctx.connections.find((c) => c.kind === item.kind && c.id === item.id);
  if (!conn) throw new Error(`community item "${item.id}" (${item.kind}) has no matching listConnections entry`);
  return conn.provenance;
}

/** The REAL live probe state for a tool/mcp item; null for skill/hook (no
 *  probe concept exists for either). Read directly off the item's own
 *  `probeState` — `listCommunityIndex`/`communityItem`/`buildConnectionItem`
 *  populate it from the ONE real probe execution they already ran (T2 round
 *  5/6 probe-budget fix); this function never spawns a second one to get it.
 *  The throw below is defensive only — an invariant violation, not a
 *  reachable production path. */
function probeStateFor(item: CommunityItem): ProbeState | null {
  if (item.kind !== 'tool' && item.kind !== 'mcp') return null;
  if (item.probeState === undefined) {
    throw new Error(`community item "${item.id}" (${item.kind}) carries no probeState — expected it to be populated for every connection-kind item`);
  }
  return item.probeState;
}

/** One item's wire projection. THROWS on a genuine derivation failure — the
 *  caller (`toWireItemSafe`) is the one place that degrades, so this
 *  function itself stays honest about failing loud. */
function toWireItem(item: CommunityItem, ctx: WireCtx): CommunityItemWire {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    desc: item.description ?? NO_DESCRIPTION,
    category: categoryFor(item, ctx),
    upstream: upstreamFor(item, ctx),
    hub: item.hub,
    signals: item.signals,
    vendored: item.vendored,
    installState: item.installState,
    probeState: probeStateFor(item),
    origin: originFor(item),
    fetchedAt: item.fetchedAt,
    fetchedBy: item.fetchedBy,
    upstreamUpdatedAt: item.upstreamUpdatedAt,
    ...(item.error !== undefined ? { error: item.error } : {}),
  };
}

/** Anti-pattern #3: one item's wire-projection failure degrades to an honest
 *  `error` field on THAT item — never a 500 for the other N-1 rows in the
 *  list route. */
function toWireItemSafe(item: CommunityItem, ctx: WireCtx): CommunityItemWire {
  try {
    return toWireItem(item, ctx);
  } catch (err) {
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      desc: item.description ?? NO_DESCRIPTION,
      // The degraded row still carries the honest absence rather than
      // omitting the key: an ABSENT key is a malformed response to the
      // client's parser, which would turn one item's derivation failure into
      // a whole-list parse throw — the opposite of this arm's purpose.
      category: null,
      upstream: VENDORED_UPSTREAM_SOURCE,
      hub: item.hub,
      signals: item.signals,
      vendored: item.vendored,
      installState: item.installState,
      probeState: null,
      origin: originFor(item),
      fetchedAt: item.fetchedAt,
      fetchedBy: item.fetchedBy,
      upstreamUpdatedAt: item.upstreamUpdatedAt,
      error: `cannot fully derive community wire item — ${sanitizeError(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Pre-install hook scan (D7) — run it on the VENDORED bytes, never the
// installed ones. Parses hook.yaml with the SAME shared low-level field
// helpers hook-library.ts's own loadHookDefinition uses (reqString/
// stringArray/optBool/loadYaml) — a narrow, generic YAML read, not a
// re-implementation of that (install-path-scoped) loader.
//
// 2026-08-28 (hostile review, PIN A/B/C's enumeration duty): this used to
// scan ONLY the one declared entry script — the same sibling-file blind spot
// hook-scan.ts's scanHookPackage fixed post-install. Left unfixed here, this
// PRE-INSTALL preview would report `clean` for a package the POST-install
// scan reports `blocked` — an operator approving on the preview would be
// approving on a lie. Now delegates to `scanHookFiles`, the SAME primitive
// `scanHookPackage` uses — one predicate, one meaning.
//
// A vendored `PackageFile` carries no executable bit (readVendoredPackage
// never stats the leaf) — every file below gets `executable: false`, making
// this preview a LOWER BOUND: a file selected only via a real `+x` bit is
// invisible here and caught only post-install. Every other selection route
// (entry path, extension, sourced-basename fixpoint) is unaffected.
// ---------------------------------------------------------------------------

function scanVendoredHookPackage(id: string, files: readonly PackageFile[]): HookScanReport {
  const label = `studio/community/hooks/${id}/hook.yaml`;
  const yamlFile = files.find((f) => f.path === 'hook.yaml');
  if (!yamlFile) throw new Error(`${label}: no vendored hook.yaml — cannot run the pre-install scan`);

  const parsed: unknown = yaml.load(yamlFile.body);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}: YAML root must be a mapping`);
  }
  const d = parsed as Record<string, unknown>;

  const scriptRel = reqString(d, 'script', label);
  const permsRaw = d['permissions'];
  const permsObj = permsRaw !== null && typeof permsRaw === 'object' && !Array.isArray(permsRaw) ? (permsRaw as Record<string, unknown>) : {};
  const permissions: HookPermissionManifest = {
    env: stringArray(permsObj, 'env', label),
    read: stringArray(permsObj, 'read', label),
    network: optBool(permsObj, 'network') ?? false,
  };

  if (!files.some((f) => f.path === scriptRel)) {
    throw new Error(`${label}: declares script "${scriptRel}" but no such file exists in the vendored package`);
  }

  const hookFiles: HookPackageFile[] = files.map((f) => ({ path: f.path, body: f.body, executable: false }));
  return scanHookFiles(hookFiles, permissions, scriptRel);
}


// ---------------------------------------------------------------------------
// W8-B6 — trigger coherence on the FIFTH (and least-trusted) write path into
// studio/hooks/. A vendored community package is authored by a third party, so
// it is the LAST place to assume the matcher/event pair is coherent. Checked
// HERE, in the route, rather than inside `installCommunityHookPackage`, for the
// same reason `cli/bridge-studio-authoring.ts:80-85` gives about its own copy
// step: the install function is a generic COPY primitive and must not grow
// hook-shape awareness. Same shared predicate as the other four callers.
// ---------------------------------------------------------------------------

function vendoredHookTriggerError(id: string, files: readonly PackageFile[]): string | undefined {
  const label = `studio/community/hooks/${id}/hook.yaml`;
  const yamlFile = files.find((f) => f.path === 'hook.yaml');
  if (!yamlFile) return `${label}: no vendored hook.yaml — refusing to install a hook package with no definition`;

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlFile.body);
  } catch (err) {
    return `${label}: not valid YAML — ${sanitizeError(err)}`;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return `${label}: YAML root must be a mapping`;
  const d = parsed as Record<string, unknown>;

  let on: HookLifecycleEvent;
  try {
    on = oneOf(reqString(d, 'on', label), HOOK_LIFECYCLE_EVENTS, label, 'on');
  } catch (err) {
    return sanitizeError(err);
  }
  const triggerError = hookTriggerError(on, optString(d, 'matcher'));
  return triggerError ? `${label}: ${triggerError}` : undefined;
}

// ---------------------------------------------------------------------------
// Id resolution — decode + slug-validate. Writes its own 400 and returns null
// on failure, mirroring bridge-studio-connections.ts's
// resolveConnectionOrRespond.
// ---------------------------------------------------------------------------

export function decodeIdOrRespond(rawIdSegment: string, res: ServerResponse, origin: string): string | null {
  let id: string;
  try {
    id = decodeURIComponent(rawIdSegment);
  } catch {
    sendJson(res, 400, { error: 'invalid community item id — malformed URL encoding' }, origin);
    return null;
  }
  try {
    assertSkillSlug(id, 'community item');
  } catch (err) {
    sendJson(res, 400, { error: sanitizeError(err) }, origin);
    return null;
  }
  return id;
}

// ---------------------------------------------------------------------------
// GET /api/studio/community/:kind/:id — detail
// ---------------------------------------------------------------------------

function handleDetail(ctx: StudioContext, res: ServerResponse, origin: string, rawKind: string, rawIdSegment: string): true {
  try {
    const id = decodeIdOrRespond(rawIdSegment, res, origin);
    if (id === null) return true;

    // A kind segment outside the closed set simply matches no item below
    // (communityItem/routeCommunityInstall both degrade to "not found" for
    // an unrecognised discriminant) — no separate validation branch needed.
    const kind = rawKind as CommunityKind;
    const wctx = buildWireCtx(ctx.forgeRoot);

    // mcp | tool — resolved AND probed directly here, exactly ONCE (T2 round
    // 5/6 probe-budget fix): the SAME ProbeResult feeds both the wire item's
    // `probeState` (via buildConnectionItem) and this route's own full
    // `probe` field below — never communityItem() followed by a second,
    // independent probeConnection() call for the same connection.
    if (kind === 'mcp' || kind === 'tool') {
      const conn = wctx.connections.find((c) => c.kind === kind && c.id === id);
      if (!conn) {
        sendJson(res, 404, { error: `unknown community item "${kind}/${id}"` }, origin);
        return true;
      }
      const probe = probeConnection(ctx.forgeRoot, conn);
      const item = buildConnectionItem(listCommunityHubs(ctx.forgeRoot), conn, probe);
      const base = toWireItemSafe(item, wctx);
      // Mirrors bridge-studio-connections.ts's toWireConnection shape exactly
      // (D8: capabilities present iff the catalog entry declares them, never
      // a fabricated empty array).
      sendJson(res, 200, {
        ...base,
        install: conn.install,
        config: conn.config,
        probe,
        ...(conn.capabilities !== undefined ? { capabilities: conn.capabilities } : {}),
        ...(conn.capabilitiesSource !== undefined ? { capabilitiesSource: conn.capabilitiesSource } : {}),
      }, origin);
      return true;
    }

    const item = communityItem(ctx.forgeRoot, kind, id);
    if (!item) {
      sendJson(res, 404, { error: `unknown community item "${kind}/${id}"` }, origin);
      return true;
    }
    const base = toWireItemSafe(item, wctx);

    if (kind === 'skill') {
      sendJson(res, 200, { ...base, files: readVendoredPackage(ctx.forgeRoot, 'skill', id) }, origin);
      return true;
    }

    if (kind === 'hook') {
      const files = readVendoredPackage(ctx.forgeRoot, 'hook', id);
      const scan = scanVendoredHookPackage(id, files);
      sendJson(res, 200, { ...base, files, scan }, origin);
      return true;
    }

    // kind is narrowed to `never` here (mcp/tool handled above; skill/hook
    // handled just above) — unreachable in practice, kept only so this
    // function has an explicit terminating statement, never a fabricated 200.
    sendJson(res, 404, { error: `unknown community item "${kind}/${id}"` }, origin);
    return true;
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
    return true;
  }
}

// ---------------------------------------------------------------------------
// POST /api/studio/community/:kind/:id/install — F3 routing (D2/D9)
// ---------------------------------------------------------------------------

/** The mcp/tool install branch — byte-identical behaviour to
 *  bridge-studio-connections.ts's own install route (D13 refusal, D6 argv
 *  derivation, D7 dual suppression seam) so the community surface can never
 *  drift from R3-04's own security core. */
function handleConnectionInstall(ctx: StudioContext, res: ServerResponse, origin: string, wctx: WireCtx, connectionId: string): true {
  const def = wctx.connections.find((c) => c.id === connectionId && (c.kind === 'tool' || c.kind === 'mcp'));
  if (!def) {
    // Unreachable in practice — routeCommunityInstall only returns
    // pipeline:'connection' for an id it just confirmed via the SAME
    // listConnections read. Defensive only, never a fabricated 200.
    sendJson(res, 404, { error: `unknown connection "${connectionId}"` }, origin);
    return true;
  }

  if (!def.installable) {
    sendJson(res, 400, {
      error: `connection "${def.id}" has install method "${def.install.method}" — no install action exists for a "${def.install.method}" entry (D13: system-provided and external are both non-installable)`,
    }, origin);
    return true;
  }

  const connectionsRoot = resolve(ctx.forgeRoot, CONNECTIONS_DIR);
  const argv = installArgvFor(def, connectionsRoot);

  if (isDryBridge() || process.env.FORGE_ARCHITECT_NO_SPAWN === '1') {
    sendJson(res, 200, {
      ok: true,
      routedTo: 'connection-install',
      suppressed: true,
      wouldInstall: { command: argv.command, args: argv.args },
    }, origin);
    return true;
  }

  const result = installConnection(ctx.forgeRoot, def, {
    executor: (command, args) => {
      const spawned = spawnSync(command, args, {
        shell: false,
        timeout: INSTALL_TIMEOUT_MS,
        encoding: 'utf8',
        env: buildProbeChildEnv(process.env),
      });
      return { exitCode: spawned.status };
    },
  });
  sendJson(res, 200, { ok: result.ok, routedTo: 'connection-install', installed: result.ok, argv: result.argv, probe: result.probeAfter }, origin);
  return true;
}

function handleInstall(ctx: StudioContext, res: ServerResponse, origin: string, rawKind: string, rawIdSegment: string): true {
  try {
    const id = decodeIdOrRespond(rawIdSegment, res, origin);
    if (id === null) return true;
    const kind = rawKind as CommunityKind;

    // T2 ruling: resolve the item FIRST so 404 (unknown) and 400 (known, no
    // route) can never collapse into each other — routeCommunityInstall's
    // two "no route" reasons are textually distinguishable, but this bridge
    // doesn't need to parse them: an item communityItem() cannot find is
    // unconditionally 404; anything routeCommunityInstall still calls
    // pipeline:'none' AFTER that is unconditionally the "known, no route"
    // 400 case.
    const item = communityItem(ctx.forgeRoot, kind, id);
    if (!item) {
      sendJson(res, 404, { error: `unknown community item "${kind}/${id}"` }, origin);
      return true;
    }

    const route = routeCommunityInstall(ctx.forgeRoot, kind, id);

    if (route.pipeline === 'skill') {
      const result = installSkillPackage({ forgeRoot: ctx.forgeRoot, id, packageDir: route.packageDir, upstream: route.upstream });
      sendJson(res, 200, { ok: true, routedTo: 'skill-draft', alreadyInstalled: result.alreadyInstalled }, origin);
      return true;
    }

    if (route.pipeline === 'hook') {
      // Refused BEFORE any byte is materialised under studio/hooks/<id>/.
      const triggerError = vendoredHookTriggerError(id, readVendoredPackage(ctx.forgeRoot, 'hook', id));
      if (triggerError) { sendJson(res, 400, { error: triggerError }, origin); return true; }
      const result = installCommunityHookPackage({ forgeRoot: ctx.forgeRoot, id });
      sendJson(res, 200, { ok: true, routedTo: 'hook-needs-approval', alreadyInstalled: result.alreadyInstalled }, origin);
      return true;
    }

    if (route.pipeline === 'connection') {
      const wctx = buildWireCtx(ctx.forgeRoot);
      return handleConnectionInstall(ctx, res, origin, wctx, route.connectionId);
    }

    // pipeline === 'none' — item is KNOWN (checked above), so this is always
    // the "known but not vendored" case, never "unknown".
    sendJson(res, 400, { error: route.reason }, origin);
    return true;
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
    return true;
  }
}

/**
 * The HTTP status for each refusal `runCommunityRefresh` can return. Every
 * choice here is deliberate, and the reasoning is written down because a
 * status picked by reflex is a status nobody can defend later:
 *
 * - `missing-token` / `invalid-token` → **409**, and specifically NOT 500 and
 *   NOT 401. Not 500: nothing broke — the route worked exactly as designed and
 *   is reporting an unmet precondition; a 500 is indistinguishable from a crash
 *   and would carry `sanitizeError` prose where an operator needs an actionable
 *   remedy. Not 401: the missing credential is not the CALLER's. The caller is
 *   the operator's own browser against their own bridge; the credential is the
 *   SERVER process's environment, and a 401 would invite a UI to prompt for a
 *   login it has no way to supply. 409 is this bridge's established "the server
 *   is in a state that conflicts with this request, here is the fix" status —
 *   the same one the contract-stages check uses to name `forge project migrate`,
 *   and the hook-already-exists and KB-active-job routes use for their own
 *   preconditions. The body carries `reason` + `remedy`, so a client
 *   distinguishes absent from rejected without parsing prose.
 * - `rate-limited` → **429**, the exact semantic, so a client can back off
 *   without reading text.
 * - `all-sources-failed` → **502**: forge reached its upstreams and every one
 *   of them failed it. Deliberately NOT a 200 carrying `wrote:false`, because a
 *   200 is what a UI renders as "refreshed" — the precise lie this lane exists
 *   to stop.
 * - `registry-missing` → **404** (there is no such document to refresh).
 * - `registry-invalid` / `refresh-refused` → **409** (a local document or a
 *   guard the operator must resolve).
 * - `registry-locked` → **503** (W8-B5 security review, FINDING 1): another
 *   writer — a curation edit, a draft commit, a second refresh — holds the
 *   registry mutex, so this pass discarded its verified facts rather than race
 *   them onto a document someone else is mid-way through changing. Transient
 *   and retryable, the same status the verdict mutex in
 *   cli/bridge-studio-runs.ts answers for its own contention, and deliberately
 *   NOT a 500: nothing is broken and nothing was written.
 * - `write-failed` → **500**: an unexpected I/O condition, and the only reason
 *   here that genuinely is a server fault. The registry on disk is untouched.
 */
function statusForRefreshReason(reason: CommunityRefreshRunReason): number {
  switch (reason) {
    case 'rate-limited':
      return 429;
    case 'registry-locked':
      return 503;
    case 'registry-missing':
      return 404;
    case 'all-sources-failed':
      return 502;
    case 'write-failed':
      return 500;
    case 'missing-token':
    case 'invalid-token':
    case 'registry-invalid':
    case 'refresh-refused':
      return 409;
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleStudioCommunityRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET' && method !== 'POST') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/community — hubs + cross-kind items (D1) -----------
  if (method === 'GET' && url === '/api/studio/community') {
    try {
      // W7-B3 review F7: `?kind=<k>` narrows the BUILD, not just the response
      // — a hooks-only consumer (the /hooks community shelf) must not pay one
      // probeConnection child process per catalog connection to render
      // vendored hook rows. No param = the full index, unchanged. Hub counts
      // stay derived from the SAME (here: filtered) item computation.
      const kindParam = new URL(rawUrl, 'http://forge.local').searchParams.get('kind');
      if (kindParam !== null && !(COMMUNITY_KINDS as readonly string[]).includes(kindParam)) {
        sendJson(res, 400, { error: `unknown community kind "${kindParam}" — expected one of ${COMMUNITY_KINDS.join(', ')}` }, origin);
        return true;
      }
      // Computed ONCE (T2 round 5/6 probe-budget fix): every connection item
      // in `rawItems` was already probed exactly once inside this single
      // listCommunityIndex call. Hub counts and wire items are BOTH derived
      // from this SAME computation — never a second, independent
      // hubsWithCounts()/listCommunityIndex() call re-entering the same
      // probes a second (and third) time.
      const rawItems = listCommunityIndex(ctx.forgeRoot, kindParam === null ? undefined : [kindParam as CommunityKind]);
      const hubs = hubCountsFrom(rawItems, listCommunityHubs(ctx.forgeRoot));
      const wctx = buildWireCtx(ctx.forgeRoot);
      const items = rawItems.map((item) => toWireItemSafe(item, wctx));
      sendJson(res, 200, { hubs, items, meta: communityIndexMeta(ctx.forgeRoot) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/community/registry/items/:id — the RAW registry row
  // (W7-B3, community-23: the edit form pre-fills from the row's own fields —
  // category/tier/signals — which the browse wire projection does not carry).
  // Matched BEFORE the 2-segment detail route cannot collide: this is 3
  // segments after /community/.
  const registryRowMatch = url.match(/^\/api\/studio\/community\/registry\/items\/([^/]+)$/);
  if (method === 'GET' && registryRowMatch) {
    try {
      const id = decodeIdOrRespond(registryRowMatch[1], res, origin);
      if (id === null) return true;
      const registryPath = communityRegistryPath(ctx.forgeRoot);
      const row = existsSync(registryPath) ? loadCommunityRegistry(registryPath).items.find((i) => i.id === id) : undefined;
      if (!row) {
        sendJson(res, 404, { error: `no registry item with id "${id}"` }, origin);
        return true;
      }
      sendJson(res, 200, { item: row }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/community/refresh — the DETERMINISTIC refresh -----
  // (W8-B5, exit row E7.) This route holds NO refresh logic of its own: it
  // calls the same `runCommunityRefresh` that `forge community refresh` calls
  // (cli/community-refresh-run.ts) and renders the typed result as HTTP. That
  // sharing IS the deliverable — two hand-rolled load→refresh→write copies
  // would drift, and a byte-parity test pins the two surfaces together.
  //
  // The write destination is the FIXED, server-owned `communityRegistryPath(
  // forgeRoot)`; nothing request-derived reaches any path in this arm (the
  // request has no body and no parameters at all), so no containment guard
  // applies and none is faked.
  if (method === 'POST' && url === '/api/studio/community/refresh') {
    // The FIRST bridge route in forge's history that makes an outbound call to
    // a third-party API, and it makes it with the operator's real GitHub PAT.
    // Dry-bridge REFUSES it outright rather than stubbing a sub-step: unlike
    // the spawn families there is no local bookkeeping half worth keeping —
    // the network call IS the route — and a `ui:journey` run that quietly
    // spent the operator's GitHub rate limit, or wrote live upstream numbers
    // into the repo-tracked registry mid-harness, is the 2026-07-16 incident
    // shape this seam exists to prevent.
    if (isDryBridge()) {
      refuseDryBridge(res, origin, {
        route: '/api/studio/community/refresh',
        method: 'POST',
        action: 'network',
        logsRoot: ctx.logsRoot,
      });
      return true;
    }
    try {
      const result = await runCommunityRefresh({ forgeRoot: ctx.forgeRoot });
      if (!result.ok) {
        sendJson(
          res,
          statusForRefreshReason(result.reason),
          {
            error: result.message,
            reason: result.reason,
            remedy: communityRefreshRemedy(result.reason),
            // Stated explicitly on every refusal so a client never has to
            // infer from a status code whether the file was touched.
            wrote: false,
            ...(result.counts !== undefined ? { counts: result.counts } : {}),
            ...(result.outcomes !== undefined ? { outcomes: result.outcomes } : {}),
            ...(result.errors !== undefined ? { errors: result.errors } : {}),
          },
          origin,
        );
        return true;
      }
      // Everything a UI needs to render the outcome without a second request:
      // one row per registry item with its own status + detail, the tallies,
      // the new `meta.lastRefresh`, and the per-source failures (which MAY be
      // non-empty on a 200 — a partial pass writes what verified and reports
      // what did not).
      sendJson(
        res,
        200,
        {
          wrote: result.wrote,
          dryRun: result.dryRun,
          lastRefresh: result.lastRefresh,
          counts: result.counts,
          outcomes: result.outcomes,
          errors: result.errors,
        },
        origin,
      );
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/community/:kind/:id/install ------------------------
  const installMatch = url.match(/^\/api\/studio\/community\/([^/]+)\/([^/]+)\/install$/);
  if (method === 'POST' && installMatch) {
    return handleInstall(ctx, res, origin, installMatch[1], installMatch[2]);
  }

  // ---- GET /api/studio/community/:kind/:id — detail ------------------------
  const detailMatch = url.match(/^\/api\/studio\/community\/([^/]+)\/([^/]+)$/);
  if (method === 'GET' && detailMatch) {
    return handleDetail(ctx, res, origin, detailMatch[1], detailMatch[2]);
  }

  return false;
}
