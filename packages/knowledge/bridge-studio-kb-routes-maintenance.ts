/**
 * The KB MAINTENANCE routes: the agent-fix run state GET, the consolidate
 * reattach GET, the ingest-activity GET, and the five-op maintenance POST —
 * plus the two brain-fix helpers (`spawnBrainFix`, `readBrainFixState`) they
 * are the only callers of.
 *
 * Split out of `bridge-studio-kbs.ts` in M4 PR 4b.
 *
 * THE ONE-ROW DECISION lives here and is recorded on `handleKbMaintenance`:
 * five ops, one URL, one table row classified `stub-actions` (T1 ruling 29).
 * `cli/dry-bridge.ts`'s manifest KEEPS its two finer-grained op rows — it
 * CLASSIFIES, it does not DISPATCH — and the coverage test pairs this one
 * table row to both of them.
 */
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { resolveGuardedPath, guardedReadFile } from '@forge/kernel';
import { loadKbDescriptor, resolveKbProcesses } from './studio/kb-descriptor.ts';
import { resolveKbBrainDir } from './brain-paths.ts';
import { type KbDescriptor } from '@forge/contracts/studio/types.ts';
import { resolutionCounts, applyAutoFixesUntilStable, type Finding } from './brain-lint.ts';
import { listCycles } from '@forge/kernel';
import { regenerateBrainIndex } from './brain-index.ts';
import { isDryBridge, refuseDryBridge } from '@forge/kernel';
import { deriveKbActiveJob, activeJobReason } from './kb-job-state.ts';
import {
  findingUnderDir,
  collectKbFindings,
  runBrainLintFullMemoized,
  runBrainLintFullFresh,
} from './kb-lint-summary.ts';
import { EXACT_ID_RE, KB_ID_RE, sendJson, allowedOrigin, sanitizeError, pathOnly, type RouteContext } from '@forge/kernel';
import {
  applyDeterministicConsolidateFixes,
  enqueueConsolidate,
  isDeterministicNotListedFinding,
  runBrainConsolidateNow,
  type AgentFinding,
} from './bridge-studio-kb-consolidate.ts';
import { subDirs } from './bridge-studio-kbs.ts';

// ---------------------------------------------------------------------------
// Lint-resolution helpers (the guided-resolution UI)
// ---------------------------------------------------------------------------
//
// `findingUnderDir`/`scopeFindingsToKb` moved to cli/kb-lint-summary.ts
// (forge-2am) — imported back above for the consolidate path (below) and
// the fix-auto op, which both still need the exact-dir write scope.

/** Spawn ONE detached `forge brain fix` agent turn; events stream to
 *  _logs/_brainfix-<runId>/events.jsonl. Mirrors spawnArchitectTurn. */
export function spawnBrainFix(
  forgeRoot: string,
  p: { kbId: string; file: string; check: string; kind: string; fixHint?: string; message: string; runId: string },
): void {
  const logDir = join(forgeRoot, '_logs', `_brainfix-${p.runId}`);
  mkdirSync(logDir, { recursive: true });
  const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
  const argv = [
    '--experimental-strip-types', 'apps/forge/cli.ts', 'brain', 'fix',
    '--kb', p.kbId, '--file', p.file, '--check', p.check, '--kind', p.kind,
    '--run-id', p.runId, '--message', p.message,
  ];
  if (p.fixHint) argv.push('--hint', p.fixHint);
  const proc = spawn(process.execPath, argv, { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] });
  closeSync(stderrFd);
  proc.unref();
}

/** Read a brain-fix run's terminal state from its event log. `total`/
 *  `clearedCount` are genuinely OPTIONAL: only a `consolidate` run's terminal
 *  event (`writeConsolidateTerminalEvent`) carries those counters in its
 *  metadata — the per-finding `op=fix-agent` runs never write them, and this
 *  reader must not fabricate them for those (they stay absent, unchanged
 *  from before this function threaded them through). */
export function readBrainFixState(
  forgeRoot: string,
  runId: string,
): { state: 'running' | 'cleared' | 'not-cleared' | 'failed'; cleared: boolean; total?: number; clearedCount?: number } {
  // Containment (forge-2zz): `runId` reaching here is only EXACT_ID_RE-gated
  // (charset only, never realpath) at the calling routes — route it through
  // the shared resolveGuardedPath so a symlinked `_logs/_brainfix-<runId>`
  // cannot be read through. `_brainfix-<runId>` and 'events.jsonl' are each
  // single, separator-free components, so this is a legal segments[] list —
  // the fixed `<forgeRoot>/_logs` stays the trusted root; runId only ever
  // enters as its OWN segment, never folded into root (see
  // studio-path-guard.ts's CONTRACT section).
  const guarded = resolveGuardedPath(join(forgeRoot, '_logs'), [`_brainfix-${runId}`, 'events.jsonl']);
  // Fail-soft by design, unchanged: this helper has no error channel to its
  // callers (both GET routes above spread its return straight into a 200
  // response), so a guard rejection collapses into the SAME 'running' shape
  // a not-yet-started run reports — never a distinct error, which would
  // leak an oracle for exactly the attacker iterating on this guard.
  if (!guarded.ok || !guarded.exists) return { state: 'running', cleared: false };
  const evPath = guarded.realPath;
  let raw: string;
  try { raw = readFileSync(evPath, 'utf8'); } catch { return { state: 'running', cleared: false }; }
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    let ev: { event_type?: string; message?: string; metadata?: { cleared?: boolean; total?: number; clearedCount?: number } };
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.event_type === 'end' || ev.message?.startsWith('brain-fix.end')) {
      const cleared = ev.metadata?.cleared === true;
      const total = ev.metadata?.total;
      const clearedCount = ev.metadata?.clearedCount;
      return {
        state: cleared ? 'cleared' : 'not-cleared',
        cleared,
        ...(typeof total === 'number' ? { total } : {}),
        ...(typeof clearedCount === 'number' ? { clearedCount } : {}),
      };
    }
    if (ev.event_type === 'error' || ev.message === 'brain-fix.crashed') {
      return { state: 'failed', cleared: false };
    }
  }
  return { state: 'running', cleared: false };
}

/**
 * GET /api/studio/kbs/:id/fix-agent/:runId — one agent-fix run's state.
 *
 * Reads the same `_logs/_brainfix-<runId>/events.jsonl` the consolidate
 * reattach GET below rediscovers.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
export async function handleKbFixAgentStatus(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs/:id/fix-agent/:runId — agent-fix run state ----
  const fixStatusMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/fix-agent\/([^/]+)$/);
  if (fixStatusMatch && method === 'GET') {
    const runId = decodeURIComponent(fixStatusMatch[2]);
    if (!EXACT_ID_RE.test(runId)) { sendJson(res, 400, { error: 'invalid run id' }, origin); return true; }
    sendJson(res, 200, { ok: true, runId, ...readBrainFixState(ctx.forgeRoot, runId) }, origin);
    return true;
  }

  return false;
}

/**
 * GET /api/studio/kbs/:id/consolidate/active — reattach discovery (W6-B14).
 *
 * ORDER: `consolidate/active` must not be read as a node or run tail; the
 * contract test pins the collision by dispatch.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
export async function handleKbConsolidateActive(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs/:id/consolidate/active — reattach discovery ----
  // W6-B14: a consolidate run mints its own runId
  // (`${kbId}-consolidate-<base36-Date.now()-stamp>`, the maintenance route's
  // op==='consolidate' branch below) and its terminal state already lives at
  // `_logs/_brainfix-<runId>/events.jsonl` — the SAME file `readBrainFixState`
  // reads for the fix-agent GET above. The one thing that was missing: a way
  // to REDISCOVER that runId once a client has forgotten it (nav-away,
  // reload) — `lib/kb-consolidate.ts`'s old `runConsolidateToTerminal` used
  // to `await` its own bounded poll loop inside the SAME click handler that
  // dispatched it, so a nav-away lost the result outright even though the
  // consolidate run itself kept going server-side. This is that tiny GET:
  // scan `_logs/` for this kb's own `_brainfix-<kbId>-consolidate-*` dirs and
  // report the MOST RECENT one's state — the base36 timestamp embedded right
  // after the fixed `-consolidate-` token sorts chronologically as a plain
  // string for a long time yet (Date.now().toString(36) stays the same
  // length until year ~2059), so `.sort().reverse()` picks the latest.
  // `runId: null` means this kb has never consolidated — never a guess.
  // Excludes `<runId>__<i>` — `runBrainConsolidateNow`'s own PER-FINDING
  // sub-runIds (never the exposed one; see that function's own header) —
  // which would otherwise sort AFTER their parent runId (a longer string
  // that has the shorter one as a prefix sorts greater) and be picked
  // instead of the real top-level run.
  const consolidateActiveMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/consolidate\/active$/);
  if (consolidateActiveMatch && method === 'GET') {
    const kbId = decodeURIComponent(consolidateActiveMatch[1]);
    if (!KB_ID_RE.test(kbId)) { sendJson(res, 400, { error: 'invalid kb id' }, origin); return true; }
    const prefix = `_brainfix-${kbId}-consolidate-`;
    const runIds = subDirs(join(ctx.forgeRoot, '_logs'))
      .filter((d) => d.startsWith(prefix))
      .map((d) => d.slice('_brainfix-'.length))
      .filter((id) => !id.includes('__'))
      .sort()
      .reverse();
    const runId = runIds[0] ?? null;
    if (!runId) { sendJson(res, 200, { ok: true, runId: null, state: null, cleared: false }, origin); return true; }
    sendJson(res, 200, { ok: true, runId, ...readBrainFixState(ctx.forgeRoot, runId) }, origin);
    return true;
  }

  return false;
}

/**
 * GET /api/studio/kbs/:id/ingest-activity — real reflect.kb-ingest events (R6-08 WI-2).
 *
 * READ-ONLY by construction: no dispatch branch exists on this URL pattern,
 * which `scripts/check-kb-ingest-affordance.test.ts` keeps ratcheted.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
export async function handleKbIngestActivity(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs/:id/ingest-activity (R6-08 WI-2) — READ-ONLY -----
  // Lists real `reflect.kb-ingest` events (orchestrator/kb-health.ts) for this
  // KB, discovered via a listCycles-style walk of `_logs/<cycleId>/events.jsonl`
  // (mirroring cli/metrics.ts's summariseCycle: guardedReadFile with cycleId as
  // its OWN segments[] element, never folded into the root). The kbId filter is
  // applied AFTER the guarded read, on the parsed event's own metadata — never
  // folded into the filesystem path. GET-only: no dispatch branch exists on
  // this URL pattern, so nothing here can trigger an ingest (see
  // scripts/check-kb-ingest-affordance.test.ts's standing ratchet).
  const ingestActivityMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/ingest-activity$/);
  if (ingestActivityMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(ingestActivityMatch[1]);
      if (!KB_ID_RE.test(kbId)) { sendJson(res, 400, { error: 'invalid kb id' }, origin); return true; }

      const events: Array<{ kb: string; freshThemes: number; impl: string; cycleId: string }> = [];
      for (const cycleId of listCycles(ctx.logsRoot)) {
        const raw = guardedReadFile(ctx.logsRoot, [cycleId, 'events.jsonl']);
        if (raw === null) continue;
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          let ev: { message?: string; metadata?: Record<string, unknown> };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.message !== 'reflect.kb-ingest') continue;
          const md = ev.metadata ?? {};
          if (md['kb'] !== kbId) continue;
          events.push({
            kb: kbId,
            freshThemes: typeof md['fresh_themes'] === 'number' ? md['fresh_themes'] : 0,
            impl: typeof md['impl'] === 'string' ? md['impl'] : 'unknown',
            cycleId,
          });
        }
      }
      sendJson(res, 200, { events }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

/**
 * POST /api/studio/kbs/:id/maintenance — manual brain maintenance (K3).
 *
 * FIVE ops behind ONE url, discriminated by a BODY field: lint | fix-auto |
 * fix-agent | index | consolidate. That is why the route table carries ONE
 * row for this URL and not one per op (T1 ruling 29): `RouteEntry.matches` is
 * `(url) => boolean` and the body is a consumable stream, so `op` is not a
 * matcher-visible discriminator the way a path, method or query is.
 *
 * The row is classified `stub-actions`, which is what this handler actually
 * does under `FORGE_DRY_BRIDGE=1`: the inline `isDryBridge()` guard refuses
 * the one op that spawns (`fix-agent`) and the other four proceed with their
 * local bookkeeping. `tests/contract/routes-table.test.ts` pins that guard
 * with a positive control in both directions, because a classification that
 * no longer matches the handler is exactly the declared-data-fails-open shape
 * this campaign exists to kill.
 *
 * Returns false for a non-matching URL (passthrough), never throws.
 */
import type { KbDrainRunFixTurnFn } from './bridge-studio-kb-drain.ts';

/**
 * M4 ruling 86 — the maintenance route is reached through a FACTORY now: its
 * `op=consolidate` arm dispatches the real brain-fix turn, which the assembly
 * supplies (`apps/forge/routes.ts` via `knowledgeRoutes(deps)`) rather than
 * this package importing it. Same shape and reason as `createKbCreateHandler`.
 */
export function createKbMaintenanceHandler(deps: { runFixTurn: KbDrainRunFixTurnFn }) {
  return (req: IncomingMessage, res: ServerResponse, ctx: RouteContext, rawUrl: string, method: string) =>
    handleKbMaintenance(req, res, ctx, rawUrl, method, deps.runFixTurn);
}

export async function handleKbMaintenance(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
  rawUrl: string,
  method: string,
  runFixTurn?: KbDrainRunFixTurnFn,
): Promise<boolean> {
  // Normalise here, not only in the caller: the route table hands handlers the
  // RAW url so an arm that later needs the query string still has it, and
  // `pathOnly` is idempotent (COMMON §15.2 — an un-normalised handler fails its
  // own anchored regex against `?x=1`, declines, and the request 404s silently).
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- POST /api/studio/kbs/:id/maintenance (K3) — manual brain maintenance --
  const maintMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/maintenance$/);
  if (maintMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(maintMatch[1]);
      if (!KB_ID_RE.test(kbId)) { sendJson(res, 400, { error: 'invalid kb id' }, origin); return true; }
      let body: unknown;
      try { body = await ctx.readBody(); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const op = (body as Record<string, unknown>)?.['op'];

      if (op === 'lint') {
        const { findings } = runBrainLintFullMemoized(ctx.forgeRoot);
        // W7-B2 (knowledge-10): the SAME full-scan ∪ own-theme union the
        // health readout counts from — never scopeFindingsToKb alone, which
        // is structurally empty for every project-bound KB.
        const scoped = collectKbFindings(ctx.forgeRoot, kbId, findings);
        // `ok: true` so the UI's studioPost (which gates success on data.ok, like
        // the sibling `index` op) treats a successful lint as success, not failure.
        sendJson(res, 200, { op: 'lint', ok: true, findings: scoped, total: scoped.length, counts: resolutionCounts(scoped) }, origin);
        return true;
      }
      if (op === 'fix-auto') {
        // Apply every deterministic AUTO-tier fix for this kb to a FIXED POINT —
        // one click drains the whole auto tier (re-lints between rounds), no
        // repeat clicks. MAJOR 2: fix-auto also WRITES, so it must share the
        // exact-dir scope — the old substring `includes(kbId)` folded a sibling
        // (e.g. `alpha-two` into `alpha`) into this KB's auto-fix write set.
        const kbBrainDir = resolveKbBrainDir(ctx.forgeRoot, kbId);
        const inKb = (f: Finding): boolean => kbBrainDir !== null && findingUnderDir(ctx.forgeRoot, kbBrainDir, f);
        const result = applyAutoFixesUntilStable(ctx.forgeRoot, { filter: inKb });
        sendJson(res, 200, { op: 'fix-auto', ok: true, applied: result.applied, skipped: result.skipped, rounds: result.rounds, remaining: result.remaining, counts: resolutionCounts(result.remaining) }, origin);
        return true;
      }
      if (op === 'fix-agent') {
        if (isDryBridge()) {
          refuseDryBridge(res, origin, {
            route: '/api/studio/kbs/:id/maintenance (op=fix-agent)', method, action: 'spawn-agent', logsRoot: ctx.logsRoot,
          });
          return true;
        }
        // Dispatch ONE agent-tier fix turn. Body carries the finding + (for a
        // user-decided finding) the operator's decision folded into fixHint.
        const b = body as Record<string, unknown>;
        const file = typeof b.file === 'string' ? b.file : '';
        const check = typeof b.check === 'string' ? b.check : '';
        const kind = typeof b.kind === 'string' ? b.kind : '';
        const fixHint = typeof b.fixHint === 'string' ? b.fixHint : undefined;
        const message = typeof b.message === 'string' ? b.message : '';
        if (!file || !check || !kind) { sendJson(res, 400, { error: 'fix-agent requires file, check, kind' }, origin); return true; }
        // Path-guard: the target file MUST be under brain/ (no traversal).
        const abs = resolve(file);
        // Keep the existing rejection as-is — it refuses a path that is not
        // exactly what it declares (any relative segment or '..' that
        // resolve() would silently normalize away before the comparison
        // below ever ran).
        if (abs !== file) {
          sendJson(res, 400, { error: 'file must be an absolute path under brain/' }, origin); return true;
        }
        // forge-2zz: below this point the OLD check was
        // `abs.startsWith(resolve(forgeRoot,'brain') + sep)` — a LEXICAL
        // prefix test on an already-normalized-but-unresolved path, with no
        // realpath anywhere. An already-normalized path through a SYMLINKED
        // INTERMEDIATE segment under brain/ (a real brain/<kb>/ whose, say,
        // `_raw/` is itself a symlinked directory pointing outside) passes
        // that check and reaches a spawned `brain fix --file` process that
        // WRITES to it. The client (forge-ui, out of this lane's scope)
        // still supplies a full absolute path — the request shape is
        // unchanged; this fix is entirely server-side. Convert the absolute
        // path to a relative tail against the fixed brain/ root and route
        // THAT through the same per-segment realpath-identity guard every
        // other studio route uses.
        const brainRoot = resolve(ctx.forgeRoot, 'brain');
        const rel = relative(brainRoot, abs);
        // `rel` splits into an empty single segment when abs === brainRoot,
        // and into a leading '..' segment when abs falls entirely outside
        // brainRoot (relative() legitimately returns a '..'-prefixed path in
        // that case) — resolveGuardedPath's isSafeSegment rejects both
        // BEFORE any filesystem call, so no stat is ever attempted on a
        // path outside the root.
        const guardedTarget = resolveGuardedPath(brainRoot, rel.split(sep));
        // Require BOTH containment (ok) AND that the target already exists —
        // a fix targets a file that is genuinely there; create-mode has no
        // meaning for "go fix this finding".
        if (!guardedTarget.ok || !guardedTarget.exists) {
          sendJson(res, 400, { error: 'file must be an absolute path under brain/' }, origin); return true;
        }
        const runId = `${kbId}-${Date.now().toString(36)}`;
        try {
          // Pass the guard's OWN realPath, never the caller's original `abs`
          // string — reusing the caller's string after validating it leaves
          // a TOCTOU window open for no reason; resolveGuardedPath already
          // paid for the realpath walk, so its output is what gets forwarded
          // to the spawned process.
          spawnBrainFix(ctx.forgeRoot, { kbId, file: guardedTarget.realPath, check, kind, fixHint, message, runId });
        } catch (err) {
          sendJson(res, 500, { error: `failed to dispatch agent fix: ${sanitizeError(err)}` }, origin); return true;
        }
        sendJson(res, 200, { op: 'fix-agent', ok: true, runId }, origin);
        return true;
      }
      if (op === 'index') {
        // W7-B2 (knowledge-05): index REWRITES brain files — refuse while any
        // KB job runs (before this it wasn't even queued, so it could rewrite
        // brain/INDEX.md while a drain was mid-edit of theme files).
        const activeJob = deriveKbActiveJob(ctx.forgeRoot, kbId);
        if (activeJob) {
          sendJson(res, 409, { error: activeJobReason(activeJob), runId: activeJob.runId }, origin);
          return true;
        }
        // W7-B2 (knowledge-06): the button lives on a PER-KB screen — do the
        // per-KB index work it claims (drain every index-tier auto finding
        // scoped to THIS kb, via the same union lens the drain uses), and
        // ALSO refresh the global brain meta-index (cheap, and its counts
        // include this KB). The response reports both halves so the UI can
        // say what actually happened.
        const idxBrainDir = resolveKbBrainDir(ctx.forgeRoot, kbId);
        if (!idxBrainDir) {
          sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
          return true;
        }
        const idxInKb = (f: Finding): boolean =>
          findingUnderDir(ctx.forgeRoot, idxBrainDir, f) && typeof f.kind === 'string' && f.kind.startsWith('index.');
        // Two per-KB repair lanes, both deterministic and spawn-free: the
        // auto-tier index fixers (forge sub-wiki indexes), plus the SAME
        // ensureLinkedAt repair consolidate uses for a project brain's
        // "not listed in project category index" findings.
        const kbResult = applyAutoFixesUntilStable(ctx.forgeRoot, {
          filter: idxInKb,
          });
        const { findings: idxFindings } = runBrainLintFullFresh(ctx.forgeRoot);
        const idxDeterministic = collectKbFindings(ctx.forgeRoot, kbId, idxFindings).filter(
          (f): f is AgentFinding =>
            typeof f.check === 'string' && typeof f.kind === 'string' && isDeterministicNotListedFinding(f as AgentFinding),
        );
        const idxResidual = applyDeterministicConsolidateFixes(ctx.forgeRoot, idxDeterministic);
        const result = regenerateBrainIndex({ cwd: ctx.forgeRoot });
        sendJson(res, 200, {
          op: 'index', ok: true, result,
          kb: {
            applied: kbResult.applied.length + (idxDeterministic.length - idxResidual.length),
            skipped: kbResult.skipped.length + idxResidual.length,
          },
        }, origin);
        return true;
      }
      if (op === 'consolidate') {
        // W7-B2 (knowledge-05): refuse while any KB job runs — before this a
        // Consolidate clicked during a drain silently queued behind it and
        // read as "Consolidating…" for however long the drain took.
        const consolidateActiveJob = deriveKbActiveJob(ctx.forgeRoot, kbId);
        if (consolidateActiveJob) {
          sendJson(res, 409, { error: activeJobReason(consolidateActiveJob), runId: consolidateActiveJob.runId }, origin);
          return true;
        }
        // NO route-level dry-bridge refusal here (unlike op=fix-agent above).
        // Consolidate's shipped shape clears the deterministic
        // `checkProjectBrainIndexes` "not listed" findings IN-PROCESS via
        // `applyDeterministicConsolidateFixes` — an idempotent category-index
        // append, the SAME spawn-free write op=fix-auto already performs under
        // dry-bridge without a guard. `runBrainConsolidateNow` treats
        // `isDryBridge()` as `noSpawn` internally, so the ONLY thing dry-bridge
        // must suppress — a real `forge brain fix` agent turn on the residual —
        // is already skipped there. Refusing the whole op at the route (the old
        // behaviour) killed the deterministic path too: under the journey/CI
        // harness's `FORGE_DRY_BRIDGE=1`, consolidate 409'd, so a KB whose
        // health legitimately reports a fixable flag could never be healed
        // (declared-data-fails-open — health surfaces a finding the only fix
        // path refuses to act on). Dispatch and let the internal noSpawn guard
        // keep it CI-safe.
        // Resolve the KB's declared consolidate obligation (R1-06 WI-3):
        // defaults to the 'brain-fix' builtin (DEFAULT_KB_CONSOLIDATE) unless
        // the kb.yaml explicitly overrides it. Only 'brain-fix' is
        // implemented today — an explicit, typed rejection beats silently
        // running the wrong obligation for a `{cmd}` or unrecognized builtin.
        const kbDir = resolveKbBrainDir(ctx.forgeRoot, kbId);
        if (!kbDir) { sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin); return true; }
        let kb: KbDescriptor;
        try {
          kb = loadKbDescriptor(join(kbDir, 'kb.yaml'));
        } catch (err) {
          sendJson(res, 500, { error: `failed to load kb descriptor: ${sanitizeError(err)}` }, origin);
          return true;
        }
        const consolidateImpl = resolveKbProcesses(kb).consolidate;
        if (!('builtin' in consolidateImpl) || consolidateImpl.builtin !== 'brain-fix') {
          sendJson(res, 400, { error: `unsupported consolidate obligation for kb "${kbId}": ${JSON.stringify(consolidateImpl)}` }, origin);
          return true;
        }

        const runId = `${kbId}-consolidate-${Date.now().toString(36)}`;
        // W6-B14: stake out this run's log dir SYNCHRONOUSLY, before the
        // fire-and-forget work below ever runs — `runBrainConsolidateNow`
        // only creates `_logs/_brainfix-<runId>/` itself once it reaches its
        // OWN terminal write (writeConsolidateTerminalEvent), which can be
        // seconds away. Without this, `GET .../consolidate/active`'s
        // reattach discovery (which finds a run by scanning `_logs/` for
        // this kb's `_brainfix-<kbId>-consolidate-*` dirs) could not see a
        // just-dispatched run at all for that whole window — a client that
        // dispatched, then immediately reloaded, would see "no run" instead
        // of "watching" (readBrainFixState already reports an empty/absent
        // events.jsonl as the honest 'running' default; this only makes the
        // DIRECTORY itself exist immediately, so the scan can find it).
        // SEC-04 — route through the shared guard (`resolveGuardedPath`,
        // same primitive the fix-agent GET above relies on via
        // `readBrainFixState`'s own log dir): `runId` embeds `kbId`
        // (KB_ID_RE-validated above, so it cannot itself carry a `/`), but
        // the whole compound directory name is still built from
        // request-derived text, so this creates it through the guard rather
        // than a raw `mkdirSync` on a hand-joined path.
        const brainfixLogGuard = resolveGuardedPath(ctx.forgeRoot, ['_logs', `_brainfix-${runId}`]);
        if (brainfixLogGuard.ok) mkdirSync(brainfixLogGuard.realPath, { recursive: true });
        // Fire-and-forget: dispatched async like fix-agent, pollable via the
        // existing GET .../fix-agent/:runId route. Queued per-kbId (not run
        // directly) so an overlapping dispatch against the same KB never
        // races its real agent turns against this one on the same files.
        enqueueConsolidate(kbId, () => runBrainConsolidateNow(ctx.forgeRoot, kbId, runId, runFixTurn));
        sendJson(res, 200, { op: 'consolidate', ok: true, runId }, origin);
        return true;
      }
      sendJson(res, 400, { error: 'op must be one of: lint | fix-auto | fix-agent | index | consolidate' }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}
