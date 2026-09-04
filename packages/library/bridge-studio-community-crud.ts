/**
 * Forge Studio community-registry CRUD bridge routes (W7-B3, community-23).
 *
 * Owns the WRITE half of `/api/studio/community/registry/items*` (the GET
 * half lives in `bridge-studio-community.ts`):
 *   POST   .../registry/items      → add    (handleCommunityRegistryItemCreate)
 *   PUT    .../registry/items/:id  → edit   (handleCommunityRegistryItemUpdate)
 *   DELETE .../registry/items/:id  → remove (handleCommunityRegistryItemDelete)
 *
 * M4 §4 step 2 RESIDUE carve: these arms, `mutateCommunityRegistry` (the ONE
 * writer all three share) and its W7-B3 comment block MOVED VERBATIM from
 * `apps/forge/bridge-studio-writes.ts` (`:583` `:615` `:654`, helper `~:483` +
 * comment `~:340`) — see the comment on the function for the mutex it shares
 * with `runCommunityRefresh`/`commitRegistryDraft`. The old hoisted
 * `registryItemMatch` is now `REGISTRY_ROW_RE` (`bridge-studio-community.ts`,
 * already exported for the GET arm): each handler matches it for itself, per
 * the one-handler-per-route contract (own `pathOnly`, own `origin`, `false`
 * on no match).
 *
 * `sendJson`/`allowedOrigin`/`sanitizeError`/`pathOnly`/`StudioContext`/
 * `RouteContext` come from `@forge/kernel`, never the legacy host module
 * (`package-to-legacy`). POST/PUT take `RouteContext` and call
 * `ctx.readBody()`; `readJson` is not imported (forbidden — T1 ruling 30).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError, pathOnly, type StudioContext, type RouteContext } from '@forge/kernel';
import { assertSkillSlug } from '@forge/kernel/ids.ts';
import type { CommunityRegistryItem, CommunityRegistrySource } from '@forge/contracts/studio/types.ts';
import { communityRegistryPath, loadCommunityRegistry, serializeCommunityRegistry, COMMUNITY_REGISTRY_SCHEMA_VERSION } from './studio/community-registry.ts';
import { CommunityRegistryLockError, lockCommunityRegistry } from './community-registry-lock.ts';
import { decodeIdOrRespond, REGISTRY_ROW_RE } from './bridge-studio-community.ts';

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
 *  the shared registry mutex (packages/library/community-registry-lock.ts), and the load
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

/**
 * POST /api/studio/community/registry/items (W7-B3, community-23).
 *
 * Adds one hand-curated row. 409s (naming the id) on a collision rather than
 * silently overwriting — an edit is what PUT is for.
 */
export async function handleCommunityRegistryItemCreate(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  if (method !== 'POST' || url !== '/api/studio/community/registry/items') return false;

  try {
    const parsed = parseRegistryItemBody(await ctx.readBody());
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

/**
 * PUT /api/studio/community/registry/items/:id (W7-B3, community-23).
 *
 * Whole-row replace, never a rename: `item.id` must match the URL id, or the
 * request 400s naming both (a rename is delete + add).
 */
export async function handleCommunityRegistryItemUpdate(req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  const registryItemMatch = REGISTRY_ROW_RE.exec(url);
  if (method !== 'PUT' || !registryItemMatch) return false;

  try {
    const id = decodeIdOrRespond(registryItemMatch[1], res, origin);
    if (id === null) return true;
    const parsed = parseRegistryItemBody(await ctx.readBody());
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

/**
 * DELETE /api/studio/community/registry/items/:id (W7-B3, community-23).
 */
export async function handleCommunityRegistryItemDelete(req: IncomingMessage, res: ServerResponse, ctx: StudioContext, rawUrl: string, method: string): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);
  const registryItemMatch = REGISTRY_ROW_RE.exec(url);
  if (method !== 'DELETE' || !registryItemMatch) return false;

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
