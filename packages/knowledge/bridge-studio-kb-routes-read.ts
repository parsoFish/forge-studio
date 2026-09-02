/**
 * The four READ routes of the KB surface: the roster, node resolution, one
 * node article, and one KB's graph + health.
 *
 * Split out of `bridge-studio-kbs.ts` in M4 PR 4b alongside the carve that
 * moved these arms out of `handleStudioKbRoutes`'s if-chain and into
 * `packages/knowledge/routes.ts`'s table. Each arm became an exported handler
 * with the table's signature; nothing about what they return changed.
 *
 * ORDER IS STILL THE CONTRACT. These four genuinely overlap —
 * `resolve-node/:nodeId` and `:id/nodes/:nodeId` both sit under the prefix the
 * bare `:id` arm claims — and the if-chain's order is what decided. The table
 * preserves it and the contract test pins each collision by dispatch, because
 * the wrong claimant here returns 200 from the wrong code path.
 */
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveKbBrainDir } from './brain-paths.ts';
import { type UnroutableKb } from './kb-sites.ts';
import { getKbBackend } from './kb-backend.ts';
import { attachKbLintSummaries } from './kb-lint-summary.ts';
import { KB_ID_RE, sendJson, allowedOrigin, sanitizeError, pathOnly, type StudioContext } from '@forge/kernel';
import { buildKbHealth, loadKbDescriptors } from './bridge-studio-kbs.ts';

/**
 * GET /api/studio/kbs — the KB roster, with a per-KB lint summary folded in.
 *
 * forge-2am (R6-07 option (b)): one runBrainLint for the whole list, never
 * per-KB. `unroutable` diagnoses descriptors the roster drops.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
export async function handleKbList(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs (list) -----------------------------------------
  // forge-2am (R6-07 option (b)): fold a cheap per-KB lint summary into the
  // SAME list response Home already reads via fetchStudioKbs() — no new
  // polling path. attachKbLintSummaries runs runBrainLint ONCE for the whole
  // list, never per-KB (the cost option (a) refused).
  if (url === '/api/studio/kbs' && method === 'GET') {
    try {
      // forge-3oq: honest per-kb provenance, derived per request from the
      // real (optional) origin: stamp on kb.yaml via the ONE shared mapping
      // — attached inside loadKbDescriptors itself (forge-3oq review), so
      // this route no longer needs its own copy.
      // W7-FIX-A4 (W7A4-04): a descriptor the roster DROPS (id ≠ dir / fails
      // the id rule) is diagnosed here — `unroutable: [{dir,id,path,reason}]`,
      // collected in the loader's own walk — never silently invisible;
      // `forge studio lint` reports the same predicate as an error finding
      // (`kb:<id>` / `dir-name`).
      const unroutable: UnroutableKb[] = [];
      const kbs = attachKbLintSummaries(ctx.forgeRoot, loadKbDescriptors(ctx.forgeRoot, (u) => unroutable.push(u)));
      sendJson(res, 200, { kbs, unroutable }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

/**
 * GET /api/studio/kbs/resolve-node/:nodeId — which KB owns a node id.
 *
 * ORDER: must be matched BEFORE the bare `:id` arms, which would capture
 * `resolve-node` as a kb id. The route table preserves that order and
 * `tests/contract/routes-table.test.ts` pins it by dispatching the URL.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
export async function handleKbResolveNode(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs/resolve-node/:nodeId ---------------------------
  // Must be matched BEFORE /api/studio/kbs/:id (resolve-node would be captured as a kb id).
  const resolveNodeMatch = url.match(/^\/api\/studio\/kbs\/resolve-node\/(.+)$/);
  if (resolveNodeMatch && method === 'GET') {
    try {
      const nodeId = decodeURIComponent(resolveNodeMatch[1]);
      // NODE_ID_RE: allow alphanumeric, dash, underscore, colon, dot
      const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
      if (!NODE_ID_RE.test(nodeId)) {
        sendJson(res, 400, { error: 'invalid node id' }, origin);
        return true;
      }
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      let foundKbId: string | null = null;
      for (const kb of kbs) {
        try {
          const graph = getKbBackend(ctx.forgeRoot, kb.id).buildGraph();
          if (graph.nodes.some((n) => n.id === nodeId)) {
            foundKbId = kb.id;
            break;
          }
        } catch {
          // skip unreadable KB
        }
      }
      if (!foundKbId) {
        sendJson(res, 404, { error: 'node not found' }, origin);
        return true;
      }
      sendJson(res, 200, { kbId: foundKbId }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

/**
 * GET /api/studio/kbs/:id/nodes/:nodeId — one node article.
 *
 * ORDER: more specific than the bare `:id` arm and must precede it.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
export async function handleKbNode(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs/:id/nodes/:nodeId (node article) ---------------
  // Must be matched before /api/studio/kbs/:id (more specific path).
  const kbNodeMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/nodes\/([^/]+)$/);
  if (kbNodeMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(kbNodeMatch[1]);
      const nodeId = decodeURIComponent(kbNodeMatch[2]);

      // Guard both ids (KB_ID_RE for the kb id; nodeIds may have
      // 'raw:' prefix — use a slightly broader guard for nodeId).
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      // Node ids: allow alphanumeric, dash, underscore, colon, dot (for raw: prefixed ids)
      const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
      if (!NODE_ID_RE.test(nodeId)) {
        sendJson(res, 400, { error: 'invalid node id' }, origin);
        return true;
      }

      // Containment is enforced at the choke point this route actually reads
      // through — `resolveKbBrainDir` (per-segment realpath identity walk) via
      // getKbBackend/kb-graph. The block that stood here built a `kbDir` it
      // then never used and compared it against its own prefix: vacuous,
      // structurally incapable of failing for a KB_ID_RE-valid id. Removed
      // rather than left as false assurance (bd `forge-wze`).

      let article;
      try {
        article = getKbBackend(ctx.forgeRoot, kbId).getNodeArticle(nodeId);
      } catch (err) {
        // Unknown kbId → 404
        const msg = String(err);
        if (msg.includes('Unknown kbId')) {
          sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
          return true;
        }
        throw err;
      }

      if (!article) {
        sendJson(res, 404, { error: `unknown node: ${nodeId}` }, origin);
        return true;
      }

      sendJson(res, 200, { node: article }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

/**
 * GET /api/studio/kbs/:id — one KB: graph + health.
 *
 * The bare `:id` arm. Every more specific GET under `kbs/` precedes it.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
export async function handleKbGet(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs/:id (single kb — graph + health) ---------------
  const kbGetMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)$/);
  if (kbGetMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(kbGetMatch[1]);

      // Slug-guard before any fs operation
      if (!KB_ID_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }

      // Containment is enforced at the choke point this route actually reads
      // through — `resolveKbBrainDir` (per-segment realpath identity walk) via
      // getKbBackend/kb-graph. The block that stood here built a `kbDir` it
      // then never used and compared it against its own prefix: vacuous,
      // structurally incapable of failing for a KB_ID_RE-valid id. Removed
      // rather than left as false assurance (bd `forge-wze`).

      // Resolve the kb descriptor (finds by walking brain/ for kb.yaml)
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      const kb = kbs.find((k) => k.id === kbId);
      if (!kb) {
        sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
        return true;
      }

      // Build the per-kb graph from the brain filesystem
      let graph;
      try {
        graph = getKbBackend(ctx.forgeRoot, kbId).buildGraph();
      } catch (err) {
        const msg = String(err);
        if (msg.includes('Unknown kbId')) {
          sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
          return true;
        }
        throw err;
      }

      // Health: run brain-lint + derive metrics for this kb
      const health = buildKbHealth(ctx.forgeRoot, kbId, graph, kb.counts);

      // W7-B2 (knowledge-29): pinned-guidance notes awaiting an ingest pass —
      // listed so the operator can SEE the queue the pin button feeds,
      // instead of the note vanishing behind a promise about a pass that may
      // never have run. Server-enumerated names under the KB's own dir.
      const guidance: Array<{ file: string; at: string }> = [];
      try {
        const kbBrainDirForGuidance = resolveKbBrainDir(ctx.forgeRoot, kbId);
        const gDir = kbBrainDirForGuidance ? join(kbBrainDirForGuidance, '_guidance') : null;
        if (gDir && existsSync(gDir)) {
          for (const name of readdirSync(gDir)) {
            if (!name.endsWith('.md')) continue;
            guidance.push({ file: name, at: name.replace(/\.md$/, '') });
          }
          guidance.sort((a, b) => (a.at < b.at ? 1 : -1));
        }
      } catch {
        // best-effort — an unreadable _guidance dir just lists nothing
      }

      // Drop 'path' from the KB response (client Kb type doesn't carry it)
      const { path: _path, ...kbPublic } = kb;
      sendJson(res, 200, { kb: kbPublic, graph, health, guidance }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
