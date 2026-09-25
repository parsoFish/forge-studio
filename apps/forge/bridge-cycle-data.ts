/**
 * bridge-cycle-data — read-only cycle-scoped data routes on the bridge.
 *
 * forge-4zk: carved out of `apps/forge/ui-bridge.ts` (feature move, no
 * behaviour change) — the cycle-data GET family (events / cost / graph /
 * work-item / artifact) plus the served-file hardening helpers the artifact
 * route depends on:
 *
 *   GET /api/events/<cycleId>              → full events.jsonl as JSON array
 *   GET /api/cost/<cycleId>                → per-cycle cost summary (U1)
 *   GET /api/graph/<cycleId>               → work-item dependency graph (mermaid)
 *   GET /api/work-item/<cycleId>/<wiId>    → single work-item definition
 *   GET /api/artifact/<cycleId>/<filename> → a served cycle artifact (PLAN/DEMO/etc.)
 *
 * `servedFileHeaders` (WI-3, regate row `artifact-plan-45`, bead
 * forge-6gv.3.2) is exported: `startBridge` (still in ui-bridge.ts) imports
 * it back to wire into `makeRouteTable`'s deps, which the carved session
 * routes (`@forge/sessions`) inject as `ctx.servedFileHeaders`. `contentTypeFor`
 * stays private — callable ONLY from `servedFileHeaders`, enforced by the
 * source-level ratchet in
 * `apps/forge/tests/contract/ui-bridge-served-file-headers.test.ts`, which
 * moved its scan target to this file in the same commit as this carve.
 */
import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http';
import { basename } from 'node:path';

import { sendJson, allowedOrigin, resolveGuardedPath, guardedReadFile, isSafeSubPath } from '@forge/kernel';
import type { EventLogEntry } from '@forge/kernel';
import { parseWorkItem, DEV_WORK_ITEM_ID_PATTERN } from '@forge/flows';

/** The context these read-only cycle-data routes need from the host. */
export type CycleDataContext = {
  logsRoot: string;
  forgeRoot: string;
};

/** W7-D1: the ONE artifact `deriveArtifacts` also resolves from the cycle-log
 *  root, for frozen cycles written before the mirror-into-`artifacts/` change.
 *  Kept as a named constant so the route and the deriver's own comment name the
 *  same single file, and so widening it is a deliberate edit rather than a
 *  string that quietly grows. */
const LEGACY_ROOT_ARTIFACT = 'pr-description.md';

/** Content-type by extension for served artifacts. `.html` → `text/html` so the
 *  PLAN/DEMO pages render in the operator's browser (ADR 020 + Phase E); all
 *  else stays `text/plain`. Module-private and, by convention enforced in
 *  `apps/forge/tests/contract/ui-bridge-served-file-headers.test.ts` (a source-level ratchet over
 *  this file), callable ONLY from `servedFileHeaders` below — every route
 *  that serves a file on the bridge origin must go through the hardened
 *  helper, never this alone. */
function contentTypeFor(filename: string): string {
  return filename.toLowerCase().endsWith('.html')
    ? 'text/html; charset=utf-8'
    : 'text/plain; charset=utf-8';
}

/** Reduce a filename to a header-safe charset before it rides inside
 *  `content-disposition: inline; filename="..."`. Strips anything outside
 *  `[A-Za-z0-9._-]` — a bare `"`, CR, LF or any other byte that could break
 *  out of the quoted string or smuggle a second header is gone — and falls
 *  back to a fixed placeholder if that empties the name entirely.
 *  `basename()` runs first so a `filename` that still carries `/`-joined
 *  path segments contributes only its leaf.
 *
 *  This is genuinely load-bearing, not decorative, for SOME of the seven
 *  call sites and NOT others — checked per route, not assumed: `isSafeSegment`
 *  (cli/studio-path-guard.ts, backing `isSafeSubPath`/`resolveGuardedPath`,
 *  which gate the `/api/artifact/`, `/api/architect/file/` and
 *  `/api/instructions/file/` routes) denies control characters (so CR/LF
 *  header-injection is ALREADY refused before this ever runs on those three
 *  routes — a 400, not a sanitised 200) but has no opinion on a bare `"`, so
 *  THIS function is what stops a quote breaking out of the quoted-string on
 *  those routes and on `/api/demo-builder/fragment/` (whose `element`
 *  component is checked only by a lexical `startsWith(base)`, same gap).
 *  `/api/demo-builder/generation/`'s `GENERATION_FILENAME_RE` is a strict
 *  `[A-Za-z0-9._-]+` allowlist that already excludes `"` and control
 *  characters — this function is unreachable-but-harmless for that route.
 *  `/api/demo-builder/demo/` and `/api/demo-builder/history/<project>/<id>`
 *  always pass the fixed literal `'DEMO.html'`, never request-derived
 *  input. */
function sanitizeHeaderFilename(filename: string): string {
  const leaf = basename(filename);
  const cleaned = leaf.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'file';
}

/** WI-3 (regate row `artifact-plan-45`, bead forge-6gv.3.2) — the COMPLETE
 *  header set for a route serving an AGENT-AUTHORED file on the bridge's own
 *  origin (artifact / PLAN / DEMO / instructions-draft / fragment /
 *  generation-snapshot). Before this helper, `contentTypeFor` alone reached
 *  `res.writeHead` at seven call sites with no `content-security-policy`, no
 *  `x-content-type-options` and no `content-disposition` — script inside such
 *  a file would run AS the bridge origin (localhost:4123) and could drive
 *  every mutating route the CSRF check only guards with a header a
 *  same-origin fetch can add just as easily (approve-and-merge, scheduler
 *  start, plan verdicts). No live exploit exists today: a survey of every
 *  HTML file these routes can actually serve on this host — 109
 *  `_logs/**\/artifacts/*.html` files plus every `.forge/demo/**.html`,
 *  `_demo/**\/DEMO.html` and `_architect/**\/PLAN.html` — found zero
 *  `<script>`, zero inline `onclick=`/`onload=`, zero external `<link>`
 *  stylesheets (the only `src=` values are `data:image/png;base64,…`
 *  screenshots). A script-blocking CSP therefore breaks nothing that exists
 *  today and closes the class before an agent-authored file changes that.
 *
 *  Deliberately STRUCTURAL, not per-site: this is the only function in the
 *  file allowed to call `contentTypeFor` (enforced by the source-level
 *  ratchet in `apps/forge/tests/contract/ui-bridge-served-file-headers.test.ts`), so a content-type
 *  can never be obtained here without the hardening headers riding along —
 *  the eighth route someone adds next year gets this for free by using the
 *  helper, and the ratchet fails loudly if they reach for `contentTypeFor`
 *  directly instead.
 *
 *  Two INDEPENDENT script defences, on purpose: `sandbox` with no
 *  `allow-scripts` (the document gets an opaque origin — cannot run script,
 *  cannot reach the bridge, cannot read its own cookies/storage) AND
 *  `default-src 'none'` (a CSP script-src belt for a UA that ignores or only
 *  partially applies the sandbox directive). `style-src 'unsafe-inline'` +
 *  `img-src data:` + `font-src data:` are exactly what the surveyed files
 *  use (inlined CSS, base64 screenshots) — nothing wider is opened.
 *  `content-type` stays `text/html` for `.html` (never `text/plain`):
 *  `apps/studio/app/artifact/page.tsx`, `apps/studio/components/PlanGate.tsx` and
 *  `apps/studio/components/studio/artifact/ArchitectPlanGate.tsx` all render
 *  these files in a `sandbox=""` iframe and expect the browser to actually
 *  RENDER the markup — `text/plain` would show raw source, a user-visible
 *  regression. `content-disposition: inline` (never `attachment`) for the
 *  same reason: `attachment` forces a download instead of an iframe render.
 *  See `sanitizeHeaderFilename` for which routes it is actually load-bearing
 *  on versus redundant-with-an-already-strict-guard. */
export function servedFileHeaders(filename: string, origin: string): OutgoingHttpHeaders {
  return {
    'content-type': contentTypeFor(filename),
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'",
    'content-disposition': `inline; filename="${sanitizeHeaderFilename(filename)}"`,
    'access-control-allow-origin': origin,
    'vary': 'origin',
  };
}

/**
 * The cycle-data GET family: events / cost / graph / work-item / artifact.
 * Dispatched from `handleHttp` after the health/cycles/liveness routes and
 * before the architect routes — same position the arms held inline. Returns
 * `false` on no match (passthrough to the next handler).
 */
export async function handleCycleDataRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: CycleDataContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);

  if (method === 'GET' && url.startsWith('/api/events/')) {
    const cycleId = decodeURIComponent(url.slice('/api/events/'.length));
    // SEC-04 (bd forge-ebj) — cycleId is request-derived and, until now,
    // folded raw into `join(logsRoot, cycleId, 'events.jsonl')` with no
    // per-segment guard: a `%2F`-smuggled `../..` cycleId escaped `_logs`
    // entirely, and a symlinked `events.jsonl` leaf inside a real cycle dir
    // was followed out of root. Route the WHOLE path (cycleId as its OWN
    // segment under the trusted logsRoot, leaf included) through the guard;
    // a rejected/absent path both collapse to 404 (no existence oracle).
    // W7-A2 (sessions-kinds-24, home-sessions-11): a guard-CLEAN path whose
    // events.jsonl simply does not exist yet (a session minted seconds ago,
    // or one whose turn never ran) is 200 `{events: []}` — never a console
    // 404 on the operator's first screen. A guard-REJECTED path (traversal,
    // symlinked leaf/dir) stays 404 exactly as before — the sec04 pins
    // (apps/forge/tests/contract/sec04-cycleid-containment.test.ts) hold.
    const eventsGuard = resolveGuardedPath(ctx.logsRoot, [cycleId, 'events.jsonl']);
    if (eventsGuard.ok && !eventsGuard.exists) {
      sendJson(res, 200, { cycleId, events: [] }, origin);
      return true;
    }
    const raw = guardedReadFile(ctx.logsRoot, [cycleId, 'events.jsonl']);
    if (raw === null) {
      sendJson(res, 404, { error: 'no events.jsonl for cycle', cycleId }, origin);
      return true;
    }
    try {
      const events: EventLogEntry[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      sendJson(res, 200, { cycleId, events }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }
  if (method === 'GET' && url.startsWith('/api/cost/')) {
    // U1: cost summary per cycle (total + per-phase + per-skill).
    const cycleId = decodeURIComponent(url.slice('/api/cost/'.length));
    // SEC-04 (bd forge-ebj) — `summariseCycle` folds `cycleId` into
    // `join(logsRoot, cycleId, 'events.jsonl')` internally; gate the
    // request-derived cycleId (as its OWN segment under the trusted logsRoot)
    // through the per-segment identity guard BEFORE that read so a
    // `%2F`-smuggled `../..` cycleId or a symlinked cycle dir is refused. A
    // legitimately in-flight cycle whose dir does not yet exist stays valid
    // (create-mode ⇒ ok), so an empty summary is unaffected.
    const costCycleGuard = resolveGuardedPath(ctx.logsRoot, [cycleId]);
    if (!costCycleGuard.ok) {
      sendJson(res, 400, { error: 'invalid cycleId' }, origin);
      return true;
    }
    try {
      const { summariseCycle } = await import('@forge/flows');
      const m = summariseCycle(cycleId, ctx.logsRoot);
      sendJson(res, 200, {
        cycleId,
        totalUsd: m.total_cost_usd,
        perPhase: m.per_phase, // { phase: { cost_usd, iterations, duration_ms } }
        perSkill: m.per_skill, // { skill: { invocations, cost_usd, duration_ms } }
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }
  if (method === 'GET' && url.startsWith('/api/graph/')) {
    const cycleId = decodeURIComponent(url.slice('/api/graph/'.length));
    // Prefer the immutable cycle snapshot; fall back to the live worktree graph
    // while the cycle is still in-flight (the snapshot is only mirrored at cycle
    // end). Without this fallback a RESUMED cycle — whose PM phase is skipped, so
    // it has no snapshot until it finishes — serves no graph, and the WI hexes
    // vanish from the live hex view for the whole run. Mirrors /api/work-item.
    // SEC-04 (bd forge-ebj) — BOTH the snapshot path (cycleId under the
    // trusted logsRoot) and the live-worktree fallback (initiativeId, derived
    // from the request-supplied cycleId, under the trusted forgeRoot) are
    // request-derived. Route each through the per-segment identity guard with
    // the untrusted id as its OWN segment; a traversed cycleId or a symlinked
    // leaf/dir at either location is refused rather than followed out of root.
    const initiativeId = (cycleId.match(/_(INIT-.+)$/) ?? [, cycleId])[1] as string;
    const raw =
      guardedReadFile(ctx.logsRoot, [cycleId, 'work-items-snapshot', '_graph.md']) ??
      guardedReadFile(ctx.forgeRoot, ['_worktrees', initiativeId, '.forge', 'work-items', '_graph.md']);
    if (raw === null) {
      sendJson(res, 404, { error: 'no _graph.md for cycle', cycleId }, origin);
      return true;
    }
    try {
      sendJson(res, 200, { cycleId, mermaid: raw }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }
  // Feature #9: single work-item definition for the hex-detail drawer. Serves
  // the on-disk WI snapshot the PM emitted — preferring the immutable cycle
  // snapshot (`_logs/<cycleId>/work-items-snapshot/<wiId>.md`), falling back to
  // the live worktree spec (`_worktrees/<initiativeId>/.forge/work-items/<wiId>.md`)
  // while the cycle is still in-flight (the snapshot is only mirrored at cycle
  // end). The cycleId encodes the initiativeId as `<timestamp>_<INIT-...>`.
  if (method === 'GET' && url.startsWith('/api/work-item/')) {
    const rest = decodeURIComponent(url.slice('/api/work-item/'.length));
    const slash = rest.indexOf('/');
    if (slash < 0) {
      sendJson(res, 400, { error: 'expected /api/work-item/<cycleId>/<wiId>' }, origin);
      return true;
    }
    const cycleId = rest.slice(0, slash);
    const wiId = rest.slice(slash + 1);
    if (!cycleId || !wiId || !DEV_WORK_ITEM_ID_PATTERN.test(wiId)) {
      sendJson(res, 400, { error: 'cycleId and a WI-<n>[<letter>] wiId are required' }, origin);
      return true;
    }
    // SEC-04 (bd forge-ebj) — cycleId is request-derived and was folded raw
    // into both `_logs/<cycleId>/...` and `_worktrees/<initiativeId>/...`; a
    // symlinked cycleId DIRECTORY and a symlinked `WI-<n>.md` LEAF both escaped
    // (wiId is already charset-gated above, but the cycleId hop was not).
    // Route each candidate (untrusted id as its OWN segment under a trusted
    // root, leaf included) through the per-segment identity guard.
    const initiativeId = (cycleId.match(/_(INIT-.+)$/) ?? [, cycleId])[1] as string;
    const found =
      guardedReadFile(ctx.logsRoot, [cycleId, 'work-items-snapshot', `${wiId}.md`]) ??
      guardedReadFile(ctx.forgeRoot, ['_worktrees', initiativeId, '.forge', 'work-items', `${wiId}.md`]);
    if (found === null) {
      sendJson(res, 404, { error: 'work item not found in snapshot or live worktree', cycleId, wiId }, origin);
      return true;
    }
    try {
      const w = parseWorkItem(found);
      sendJson(res, 200, {
        work_item_id: w.work_item_id,
        acceptance_criteria: w.acceptance_criteria,
        files_in_scope: w.files_in_scope,
        quality_gate_cmd: w.quality_gate_cmd ?? [],
        body: w.body,
      }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }
  // Cycle-scoped artifact (PLAN.md / DEMO.md / etc.). The UI's /plan
  // and /demo sub-pages fetch these so the operator's interaction
  // points (verdict form) link to richer in-app views instead of
  // having to dig into the filesystem.
  // Path normalisation + a startsWith(logsRoot) check defeat
  // ../-escape attempts.
  if (method === 'GET' && url.startsWith('/api/artifact/')) {
    const rest = decodeURIComponent(url.slice('/api/artifact/'.length));
    const slash = rest.indexOf('/');
    if (slash < 0) {
      sendJson(res, 400, { error: 'expected /api/artifact/<cycleId>/<filename>' }, origin);
      return true;
    }
    const cycleId = rest.slice(0, slash);
    const filename = rest.slice(slash + 1);
    if (!cycleId || !filename) {
      sendJson(res, 400, { error: 'cycleId and filename are required' }, origin);
      return true;
    }
    // The startsWith(safeBase) check below builds safeBase from the SAME
    // cycleId, so a traversal INSIDE cycleId (e.g. '..') normalises into both
    // sides identically and passes it — validate the segment itself
    // (2026-07-24 adversarial review; same predicate as isSafeRunId).
    if (!/^[A-Za-z0-9._-]+$/.test(cycleId) || cycleId.includes('..')) {
      sendJson(res, 400, { error: 'invalid cycleId' }, origin);
      return true;
    }
    // W7-C3 (bd forge-0u4), re-cut by the W7-C3 review (A-M6) — the FILENAME
    // dimension is enumerated as a DENY of the shapes that matter, sharing
    // the guard's OWN per-segment predicate (`isSafeSubPath`) so the cheap
    // 400 layer and the containment 404 layer cannot drift. The first cut was
    // an allow-list charset (`/^[A-Za-z0-9._-]+$/` + `.includes('..')`) and
    // was a fails-closed regression: it 400'd 55 of 508 real on-disk artifact
    // files (10.8%, all `.capture/{before,after}/*.out` demo evidence named
    // from AC titles) while every real attack shape was ALREADY refused by
    // `guardedReadFile` below. Legitimate names with spaces, parentheses,
    // em-dashes and a leading `..` pass; separators, `.`/`..` segments, empty
    // segments, control characters, NUL, DEL and encoded separators do not.
    // Pinned both ways in apps/forge/tests/contract/sec04-cycleid-containment.test.ts (a real
    // `.capture` name serves 200; every escape shape still refused) and per
    // predicate in cli/studio-path-guard.test.ts.
    if (!isSafeSubPath(filename)) {
      sendJson(res, 400, { error: 'invalid filename' }, origin);
      return true;
    }
    const filenameSegments = filename.split('/');
    // SEC-04 (bd forge-ebj) — the lexical `startsWith(safeBase)` above was
    // blind to a SYMLINKED leaf: `artifacts/<filename>` real-located inside a
    // genuine cycle dir but pointing out of root passed it and readFileSync
    // followed it. Route the WHOLE path (cycleId + fixed `artifacts` + the
    // filename segments, all under the trusted logsRoot) through the
    // per-segment identity + nlink guard, which the lexical check cannot do.
    let body = guardedReadFile(ctx.logsRoot, [cycleId, 'artifacts', ...filenameSegments]);
    // W7-D1 — PARITY with `deriveArtifacts` (orchestrator/run-model-derive.ts),
    // which marks `pr` ready when `pr-description.md` exists in EITHER
    // `artifacts/` OR the cycle-log ROOT ("accept the legacy cycle-log-root
    // location too so older frozen logs still resolve"). This route only ever
    // read `artifacts/`, so a frozen pre-mirror cycle advertised a PR tab in
    // `artifactsReady` and 404'd when the operator clicked it — a declaration
    // enforced by nothing, found by the Wave D crawl on
    // 2026-06-18T10-27-18_INIT-2026-06-17-release-definition-permissions-coverage.
    //
    // Deliberately ONE exact filename, and only as a FALLBACK after the
    // modern location misses: the cycle-log root also holds events.jsonl,
    // report.md, retro.md and user-questions.json, none of which may become
    // servable as a side effect. It goes through the SAME `guardedReadFile`,
    // so a symlinked legacy copy is refused exactly as a symlinked modern one
    // is. All four directions pinned in sec04-cycleid-containment.test.ts.
    if (body === null && filename === LEGACY_ROOT_ARTIFACT) {
      body = guardedReadFile(ctx.logsRoot, [cycleId, LEGACY_ROOT_ARTIFACT]);
    }
    if (body === null) {
      sendJson(res, 404, { error: 'artifact not found', cycleId, filename }, origin);
      return true;
    }
    try {
      res.writeHead(200, servedFileHeaders(filename, origin));
      res.end(body);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  return false;
}
