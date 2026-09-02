/**
 * The KB surface's shared base: descriptors, health, and cleanup approval.
 *
 * What this file is NOT any more. Until M4 PR 4b it was 2,068 lines and held
 * the whole knowledge-base surface behind one `handleStudioKbRoutes`
 * if-chain. That PR carved the eleven routes into
 * `packages/knowledge/routes.ts`'s table and split the module five ways under
 * the 800-line cap:
 *
 *   · `bridge-studio-kb-consolidate.ts`        the consolidate pipeline
 *   · `bridge-studio-kb-routes-read.ts`        the 4 read routes
 *   · `bridge-studio-kb-routes-lifecycle.ts`   create · delete · guidance
 *   · `bridge-studio-kb-routes-maintenance.ts` the 4 maintenance routes
 *   · this file                                everything they share
 *
 * WHAT STAYED, AND WHY HERE. Four symbols are imported from OUTSIDE the
 * package and must keep the module path their consumers already use —
 * `loadKbDescriptors`, `KB_SEEDING_ANCHOR_PREFIX`, `computeAgentCleanupFindings`
 * (`cli/ui-bridge.ts`, `packages/sessions/bridge-studio-sessions.ts`,
 * `cli/id-rule.test.ts`, three bridge tests) and `approveKbCleanup`
 * (`cli/bridge-studio-affordances.ts`, `kb-drain-structural.test.ts`). No
 * barrel re-export was added for them: they did not move, so nothing needed
 * re-pointing, and a barrel here would have made this file import its own
 * route files back — a cycle bought for nothing.
 *
 * The dependency edges all point INTO this module and into
 * `bridge-studio-kb-consolidate.ts`; neither imports a route file.
 *
 * `handleStudioKbRoutes` is GONE, not deprecated. Its last caller
 * (`cli/ui-bridge.ts`) now reaches these routes through the table, which
 * `dispatchRoute` runs before the host's own arms. `tests/contract/routes-table.test.ts`
 * pins all 17 carved routes so that "carved" and "lost" can never be confused.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { resolveGuardedPath, guardedReadFile } from '@forge/kernel';
import { loadKbDescriptor } from './studio/kb-descriptor.ts';
import { provenanceOfOrigin, type Provenance } from '../../cli/studio-provenance.ts';
import { resolveKbBrainDir } from './brain-paths.ts';
import { kbSites, unroutableKbReason, type UnroutableKb } from './kb-sites.ts';
import { type KbBinding } from '@forge/contracts/studio/types.ts';
import { guardedReadSessionStatus, guardedWriteSessionStatus } from '@forge/sessions/interactive-session.ts';
import { type ProjectBrainStatus } from '../../orchestrator/project-brain-builder-runner.ts';
import { classify, CHECK_NAMES, type Finding } from './brain-lint.ts';
import { auditKbEdit, buildKbEditSoundnessCtx, brainRootDir } from './kb-drain-edit-soundness.ts';
import {
  collectKbFindings,
  computeKbLintChecks,
  runBrainLintFullMemoized,
  type CheckHealthEntry,
} from './kb-lint-summary.ts';
import { sanitizeError } from '@forge/kernel';

// ---------------------------------------------------------------------------
// The KB surface's ONE remaining door to the legacy host
// ---------------------------------------------------------------------------
//
// Three of the eleven routes read a JSON request body, and one validates a run
// id; `readJson` and `SAFE_ID_RE` live in `cli/bridge-studio.ts` and have no
// kernel home — `@forge/kernel`'s `http-envelope.ts` deliberately scopes itself
// to the RESPONSE envelope and leaves body policy (size caps, CSRF,
// content-type) with the host.
//
// They are re-exported HERE, from the module that already carried this edge,
// rather than imported directly by each route file. Said plainly: a five-way
// split must not turn one boundary row into three, and centralising the door
// also means the repoint has ONE call site when T1 ruling 30's
// `ctx.readBody` lands from the library lane — at which point this block and
// the package's last `package-to-legacy` body-read edge both go away.
export { readJson, SAFE_ID_RE } from '../../cli/bridge-studio.ts';
import { enqueueConsolidate, runBrainConsolidateNow } from './bridge-studio-kb-consolidate.ts';

// ---------------------------------------------------------------------------
// KBs with layer counts
// ---------------------------------------------------------------------------

export type KbWithCounts = {
  id: string;
  name: string;
  binding: KbBinding;
  desc: string;
  path: string;
  /** Present when kb.yaml carries an `origin:` key (forge-3oq) — absent on
   *  every pre-existing brain that predates the stamp, an honest gap. */
  origin?: string;
  counts: { index: number; themes: number; raw: number };
  /** Derived from `origin` via the ONE shared `provenanceOfOrigin` mapping,
   *  attached HERE inside `loadKbDescriptors` (forge-3oq review) so every
   *  caller of the loader — list, detail, resolve-node, delete, guidance —
   *  inherits it and none can independently forget it. Never persisted;
   *  recomputed on every call. */
  provenance: Provenance;
};

function countLayerFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.')).length;
  } catch {
    return 0;
  }
}

/** Sub-directory names of a dir (empty on any error). */
export function subDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      // Skip dot-prefixed dirs — a `.staging-<id>-*` brain leftover (SEC-05 4on
      // reopen-1) must never surface as a phantom KB. Real kb/project ids are
      // slug-safe (no leading dot).
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// approveKbCleanup — the kb-cleanup session's ONE approve choreography
// (W6-B4 adversarial-review fix, closing a live-reproduced double-drain
// race).
//
// BEFORE this fix, both `POST /api/studio/kbs/:id/cleanup/apply`
// (cli/ui-bridge.ts) and the generic `POST /api/studio/sessions/kb-cleanup/
// :sid/:affordance` (cli/bridge-studio-affordances.ts) independently ran:
// read status -> check phase === 'awaiting-approval' -> `await
// enqueueConsolidate(...)` -> write phase:'applied'. `enqueueConsolidate`
// serializes the DRAIN per kbId (so two concurrent runs never corrupt the
// SAME on-disk category-index file concurrently), but it does NOT prevent a
// SECOND caller from being enqueued at all: two concurrent approves both
// read `awaiting-approval` (both pass the check) BEFORE either write landed,
// so both proceeded to `enqueueConsolidate` — reproduced live as two
// independent `runBrainConsolidateNow` runs, two distinct `runId`s, two
// `_logs/_brainfix-<runId>/` dirs, for what should have been ONE approved
// action.
//
// THE FIX — check-then-act made atomic via a SYNCHRONOUS claim, not a lock:
// the status read, the phase (and, when `expectedKbId` is supplied, kb_id
// identity) check, and the phase:'applying' write below are ALL
// synchronous — zero `await` between them. Node's single-threaded event
// loop never preempts a synchronous span: once this function's synchronous
// prefix starts running (after whatever awaits got it dispatched — e.g. the
// caller's own `await readJson(req)`), it runs to completion — read,
// check, AND the 'applying' write — before the event loop can process any
// OTHER callback, including a second concurrent request's own continuation.
// A second caller therefore either (a) has not started this function's
// synchronous prefix yet, in which case it starts AFTER the first caller's
// 'applying' write has already landed and reads 'applying' (not
// 'awaiting-approval') itself, or (b) — impossible — interleaves mid-span,
// which Node's execution model does not allow. Either way, the SECOND
// caller 409s BEFORE ever calling `enqueueConsolidate` or minting a runId.
//
// SYNC INVARIANT (do not violate): nothing between the `guardedReadSessionStatus`
// call and the `guardedWriteSessionStatus(..., {phase:'applying'})` call may
// ever become `await`ed, or ever call anything that itself awaits. Doing so
// reopens exactly the race this function exists to close — see
// studio/session-kinds.yaml's own comment on the `applying` phase row for
// the state-machine side of this fix, and this file's header note on
// `enqueueConsolidate` ("Always invoked via enqueueConsolidate (never
// directly)") for the SEPARATE, already-existing same-kbId serialization
// this fix does not replace, only complements: serialization alone was
// never sufficient, because it never stopped a second unapproved caller
// from being enqueued in the first place.
//
// BOTH callers used to funnel through this ONE function — the duplicated
// choreography that independently existed in each is deleted, not merely
// mirrored. W6-B9 (reviewer finding on W6-B8): the bespoke `/cleanup/apply`
// route (which additionally checked `expectedKbId` against the URL's own
// `:id` segment — DEFECT B) is now DELETED — kb-cleanup migrated onto the
// generic session shell, and the bespoke route had no production caller
// left. The generic affordance route (`cli/bridge-studio-affordances.ts`)
// is the ONLY caller now; it carries no URL-supplied kb id at all, so it
// omits `expectedKbId`. The parameter itself is left in place (optional,
// unused today) rather than stripped along with its one caller — a narrower
// removal than this fix's own scope.
// ---------------------------------------------------------------------------

export type ApproveKbCleanupOutcome = { ok: true; runId: string } | { ok: false; status: number; error: string };

export async function approveKbCleanup(
  forgeRoot: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  opts: { expectedKbId?: string } = {},
): Promise<ApproveKbCleanupOutcome> {
  // --- SYNC INVARIANT SPAN START — see header. No await until the
  //     phase:'applying' write below has returned. ---
  const status = guardedReadSessionStatus<{ phase?: unknown; kb_id?: unknown } & Record<string, unknown>>(projectsRoot, dirSegs);
  if (!status || typeof status.phase !== 'string') {
    return { ok: false, status: 404, error: 'session not found' };
  }
  if (typeof status.kb_id !== 'string') {
    return { ok: false, status: 500, error: 'kb-cleanup apply: status.json has no string "kb_id"' };
  }
  // DEFECT B (preserved from the bespoke route this replaces): a well-formed
  // but MISMATCHED expectedKbId is a 404 — no (kbId, project, sessionId)
  // triple names this pairing — never a silent drain of whichever kb the
  // session happens to carry. Checked BEFORE the phase gate: 409 is reserved
  // for a CORRECTLY-identified resource in the wrong state.
  if (opts.expectedKbId !== undefined && opts.expectedKbId !== status.kb_id) {
    return { ok: false, status: 404, error: `session does not belong to kb "${opts.expectedKbId}"` };
  }
  if (status.phase !== 'awaiting-approval') {
    return { ok: false, status: 409, error: `session is not awaiting-approval (current phase: "${status.phase}")` };
  }
  const kbId = status.kb_id;
  // W7-C2 T1 review (P0-4, sessions-kinds-36) — the permanent "what this
  // session produced" pointer, written alongside EVERY `applied` transition
  // below (both the draft-apply arm and the consolidate arm). It was
  // declared REQUIRED on the session-shell payload and rendered by
  // `FinalizedLink`, but only 2 of the 5 finalizing kinds ever wrote it — a
  // field surfaced everywhere and produced by 40% of its producers is
  // declared-data-fails-open. What a kb-cleanup session produces is the
  // cleaned KB itself, so the pointer names `status.kb_id` (the SAME sole
  // source of truth the drain uses); the shell route derives whether that
  // KB still resolves rather than trusting the pointer's mere presence.
  const finalized = { kind: 'kb', id: kbId };

  // ---- W7-B2 (orch-01): a DRAFT-carrying session (minted by the drain's
  // structural-only gate — `mintKbCleanupDraftSession`, cli/bridge-studio-
  // kb-drain.ts) applies EXACTLY the parked draft files on approve, never a
  // consolidate. Validated fully — every target contained to THIS session's
  // own KB brain dir, every draft readable — BEFORE the atomic claim below,
  // so a refused draft leaves the session still approvable after the
  // problem is fixed (all checks here are synchronous; the SYNC INVARIANT
  // span is preserved). ------------------------------------------------------
  const draftApplyRaw = (status as Record<string, unknown>)['draft_apply'];
  let draftWrites: Array<{ target: string; content: string }> | null = null;
  if (Array.isArray(draftApplyRaw) && draftApplyRaw.length > 0) {
    const brainDir = resolveKbBrainDir(forgeRoot, kbId);
    if (!brainDir) {
      return { ok: false, status: 500, error: `kb-cleanup apply: kb id "${kbId}" does not resolve to any brain directory` };
    }
    draftWrites = [];
    for (const raw of draftApplyRaw) {
      const entry = raw as Record<string, unknown> | null;
      const file = entry && typeof entry['file'] === 'string' ? entry['file'] : null;
      const draft = entry && typeof entry['draft'] === 'string' ? entry['draft'] : null;
      if (!file || !draft) {
        return { ok: false, status: 422, error: 'kb-cleanup apply: malformed draft_apply entry (need string "file" and "draft")' };
      }
      const target = resolve(forgeRoot, file);
      // Real containment to the session's OWN kb dir — a draft may only ever
      // replace a file inside the brain dir status.kb_id resolves to (never
      // a sibling KB, never anything outside brain/). `brainDir` is already
      // realpath-resolved by resolveKbBrainDir; `resolve` collapses any
      // lexical `..` in the target before the boundary check.
      // `target === brainDir` is refused too (W7-B2 code-review round): the
      // brain dir is a DIRECTORY, so letting it through only bought an EISDIR
      // deeper in — a containment check must reject the boundary itself, not
      // rely on the write failing.
      if (!target.startsWith(brainDir + sep)) {
        return { ok: false, status: 422, error: `kb-cleanup apply: draft target escapes kb "${kbId}"'s own brain dir: ${file}` };
      }
      // The draft body is read through the SAME guarded read the session
      // status came through — a draft path escaping the session dir reads
      // null and refuses.
      const content = guardedReadFile(projectsRoot, [...dirSegs, ...draft.split('/')]);
      if (content === null) {
        return { ok: false, status: 422, error: `kb-cleanup apply: draft file unreadable or escapes the session dir: ${draft}` };
      }
      draftWrites.push({ target, content });
    }
  }

  // THE ATOMIC CLAIM — the write that makes this a claim, not merely a
  // check: any concurrent caller reading status AFTER this line observes
  // 'applying', never 'awaiting-approval', so at most one caller ever passes
  // the gate above.
  const claimed = guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'applying' });
  if (claimed === null) {
    return { ok: false, status: 500, error: 'kb-cleanup apply: status.json write for phase "applying" failed containment' };
  }
  // --- SYNC INVARIANT SPAN END — everything below may safely await. ---

  if (draftWrites !== null) {
    const writes = draftWrites;
    const draftRunId = `${kbId}-draftapply-${Date.now().toString(36)}`;
    // Same per-kbId serialization as the consolidate path below (forge-sqn's
    // invariant): the draft write may never interleave with a live drain's
    // own agent turns against the same files.
    // The callback owns its OWN error handling (W7-B2 code-review round).
    // `enqueueConsolidate` always RESOLVES — its queue continuation swallows
    // the run's rejection by contract (see its doc comment) — so a callback
    // that lets a write throw made the failure vanish entirely: the session
    // was stamped 'applied' and ok:true returned while nothing had landed.
    // The operator was told a drain-gated prose draft applied, the theme file
    // still held the old content, and the finding re-flagged next drain.
    let writeError: string | null = null;
    await enqueueConsolidate(kbId, async () => {
      try {
        // W8-F1 (review round 2, S1) — RE-AUDIT AT APPLY, against the bytes on
        // disk RIGHT NOW.
        //
        // The drain audits a proposal when it MINTS the draft
        // (`mintKbCleanupDraftSession`), against the file as it stood then.
        // This write puts the agent's `after` back byte-for-byte over whatever
        // the file holds at APPROVE time, which can be minutes or days later —
        // so every edge added to that theme in between died silently, with
        // `ok:true` and the session stamped `applied`. That is forge-d8l with
        // one extra click, and the plan page's own promise ("audited for graph
        // soundness before it was parked") is a claim about the mint instant
        // that this apply has to make true again.
        //
        // Reachable without any external actor: a later round of the SAME
        // drain run can land a sound structural edit on the same file, and
        // `runBrainConsolidateNow`, `forge brain fix` or the reflector can all
        // touch it while the session waits.
        const ctx = buildKbEditSoundnessCtx(forgeRoot, brainRootDir(forgeRoot));
        const stale: string[] = [];
        for (const w of writes) {
          const current = readFileSync(w.target, 'utf8');
          if (current === w.content) continue; // nothing to destroy
          const relFromBrain = relative(brainRootDir(forgeRoot), w.target).split(sep).join('/');
          for (const u of auditKbEdit({ relPath: relFromBrain, before: current, after: w.content, klass: 'prose' }, ctx)) {
            stale.push(u.message);
          }
        }
        if (stale.length > 0) {
          writeError = `the parked draft is no longer sound against the file as it stands now — ${stale.join('; ')}`;
          return;
        }
        for (const w of writes) {
          mkdirSync(dirname(w.target), { recursive: true });
          writeFileSync(w.target, w.content, 'utf8');
        }
      } catch (err) {
        writeError = sanitizeError(err);
      }
    });
    if (writeError !== null) {
      // Release the claim back to 'awaiting-approval' rather than wedging the
      // session at 'applying' forever: every draft write is a whole-file
      // replacement, so a retry after the operator fixes the underlying
      // problem is idempotent. The failure itself is recorded on the session
      // AND returned — never only one of the two.
      guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'awaiting-approval', apply_error: writeError });
      return { ok: false, status: 500, error: `kb-cleanup apply: draft write failed: ${writeError}` };
    }
    const draftDone = guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'applied', finalized });
    if (draftDone === null) {
      return { ok: false, status: 500, error: 'kb-cleanup apply: status.json write for phase "applied" failed containment' };
    }
    return { ok: true, runId: draftRunId };
  }

  // The drain's SOLE source of truth is `status.kb_id`, never `expectedKbId`
  // — the equality check above makes the two identical by construction from
  // here on, which is why a caller cannot observe a swap to `expectedKbId`.
  const runId = `${kbId}-consolidate-${Date.now().toString(36)}`;
  // Stake out this run's log dir SYNCHRONOUSLY, exactly as the sibling
  // maintenance op=consolidate route does (W7-B2 code-review round).
  // `runBrainConsolidateNow` only creates `_logs/_brainfix-<runId>/` at its
  // OWN terminal write, so without this the run was invisible to
  // `deriveKbActiveJob` for its whole duration — minutes of real agent turns
  // during which the knowledge-05 mutual gate reported NO active job for this
  // KB and index / delete / drain were all still dispatchable against the
  // files this run was editing. SEC-04: routed through the shared guard, same
  // as that route — `runId` embeds the KB_ID_RE-validated `kbId`, but the
  // whole compound directory name is still built from request-derived text.
  const consolidateLogGuard = resolveGuardedPath(forgeRoot, ['_logs', `_brainfix-${runId}`]);
  if (consolidateLogGuard.ok) mkdirSync(consolidateLogGuard.realPath, { recursive: true });
  // `enqueueConsolidate` — the SAME per-kbId serialization queue the sibling
  // maintenance op=consolidate route uses (see its own doc comment: "Always
  // invoked via enqueueConsolidate, never directly"). Awaited so this
  // function can still write `phase: 'applied'` and return only once the
  // QUEUED run has actually finished, not merely been enqueued. This
  // serialization is a SEPARATE, complementary property to the atomic claim
  // above — it protects the on-disk category-index file from two
  // concurrently-RUNNING drains; the claim above protects against a SECOND
  // drain ever being enqueued in the first place for one approval.
  await enqueueConsolidate(kbId, () => runBrainConsolidateNow(forgeRoot, kbId, runId));

  const written = guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'applied', finalized });
  if (written === null) {
    return { ok: false, status: 500, error: 'kb-cleanup apply: status.json write for phase "applied" failed containment' };
  }
  return { ok: true, runId };
}

// ---------------------------------------------------------------------------
// KB health computation
// ---------------------------------------------------------------------------

// `CheckHealthStatus`/`CheckHealthEntry` moved to cli/kb-lint-summary.ts
// (forge-2am); `CheckHealthEntry` is re-imported above for the `KbHealth` type
// below. The per-KB own-theme lens that used to live here with them is gone —
// the full-scope scan covers every theme dir (ADR 035), so there is one lens.

export type KbHealth = {
  layerBalance: { index: number; theme: number; raw: number };
  /** Degree-0 nodes EXCLUDING the raw layer (W7-B2, knowledge-28) — raw
   *  archives are unlinked by design, so counting them here made the
   *  Connectivity block contradict the checkOrphans verdict beside it. */
  orphans: number;
  /** Degree-0 RAW-layer nodes, reported separately and neutrally. */
  unlinkedRaw: number;
  linkDensity: number;
  staleness: { staleRawCount: number; staleThemeCount: number };
  lintFlags: number;
  lintErrors: number;
  /** R6-08 WI-1 — one entry per CHECK_NAMES, always present (never omitted
   *  for a clean check — status:'pass', count 0). */
  checks: CheckHealthEntry[];
  /** R6-08 WI-1 RULING 3 — set iff the lint run itself threw; every `checks[]`
   *  entry is 'unknown' in that case, never a silent 0/0 pass. */
  healthError?: string;
};

/**
 * Build the health object for a single KB by:
 *   1. Using the pre-computed layer counts from KbWithCounts.
 *   2. Running runBrainLint(scope:'full') and filtering findings to this kb's dir.
 *   3. Deriving orphans (nodes with degree 0), link density (edges/nodes),
 *      and staleness (nodes with updated_at older than 30 days).
 *   4. Itemizing findings per CHECK_NAMES (R6-08 WI-1) — the aggregate
 *      lintFlags/lintErrors fields are KEPT (RULING 2), derived as a roll-up
 *      over `checks[]` rather than computed independently, so the two can
 *      never diverge.
 */
export function buildKbHealth(
  forgeRoot: string,
  kbId: string,
  graph: import('./kb-graph.ts').KbGraph,
  _counts: { index: number; themes: number; raw: number },
): KbHealth {
  const { nodes, edges } = graph;

  // Layer balance from graph node counts (more accurate than the raw dir count)
  const layerBalance = {
    index: nodes.filter((n) => n.layer === 'index').length,
    theme: nodes.filter((n) => n.layer === 'theme').length,
    raw: nodes.filter((n) => n.layer === 'raw').length,
  };

  // Orphans: nodes with degree 0 (no inbound AND no outbound edges).
  // W7-B2 (knowledge-28): the raw layer is EXCLUDED — raw cycle archives are
  // unlinked by design, and folding them in ('79 orphan nodes' with an amber
  // dot) contradicted the checkOrphans 'pass' rendered six lines below.
  // They're still reported, separately and neutrally, as `unlinkedRaw`.
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const orphans = nodes.filter((n) => n.layer !== 'raw' && (degree.get(n.id) ?? 0) === 0).length;
  const unlinkedRaw = nodes.filter((n) => n.layer === 'raw' && (degree.get(n.id) ?? 0) === 0).length;

  // Link density
  const linkDensity = nodes.length > 0 ? edges.length / nodes.length : 0;

  // Staleness: themes/raw with updatedAt older than 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let staleThemeCount = 0;
  let staleRawCount = 0;
  for (const n of nodes) {
    if (!n.updatedAt) continue;
    const ts = new Date(n.updatedAt).getTime();
    if (!isNaN(ts) && ts < thirtyDaysAgo) {
      if (n.layer === 'theme') staleThemeCount++;
      else if (n.layer === 'raw') staleRawCount++;
    }
  }

  // Run brain-lint and scope it to this KB (R6-08 4on — fix for 3
  // adversarial-review-confirmed declared-data-fails-open MAJORs). Findings
  // come from the shared full-scope scan, filtered to this KB's dir through
  // the SAME exact-dir helper consolidate/lint use
  // (resolveKbBrainDir/scopeFindingsToKb), so a project brain at
  // brain/projects/<id> is counted (MAJOR 1). The scan itself now walks every
  // theme dir, so the second lens that used to compensate for its blindness is
  // gone — one scan, one set of numbers, and no way for this route and
  // `forge brain lint` to disagree.
  //
  // THE HONESTY INVARIANT: a check reports 'pass' ONLY if it actually
  // inspected THIS KB and found nothing. A check whose CHECK_SCOPE domain does
  // not cover this KB — or whose themes the scan read none of — reports 'n/a',
  // NEVER 'pass'.
  //
  // RULING 3 (unchanged): if the lint run itself throws (e.g. a category
  // index that is a directory — readIndexEntries' readFileSync throws EISDIR
  // inside checkProjectBrainIndexes, uncaught by runBrainLint), every check
  // reports status:'unknown' plus a top-level healthError — never a silent
  // 0/0 "clean" pass.
  let lintFlags = 0;
  let lintErrors = 0;
  let checks: CheckHealthEntry[];
  let healthError: string | undefined;
  try {
    // The per-check itemization (CHECK_SCOPE applicability, the F3 aggregate
    // roll-up) lives in `computeKbLintChecks` (cli/kb-lint-summary.ts)
    // now — the ONE derivation both this per-KB detail route and the list
    // route's `attachKbLintSummaries` share, so the two can never drift.
    const { findings } = runBrainLintFullMemoized(forgeRoot);
    const result = computeKbLintChecks(forgeRoot, kbId, findings);
    checks = result.checks;
    lintErrors = result.lintErrors;
    lintFlags = result.lintFlags;
  } catch (err) {
    checks = CHECK_NAMES.map((name) => ({ check: name, status: 'unknown' as const, errorCount: 0, flagCount: 0 }));
    healthError = err instanceof Error ? err.message : String(err);
    lintFlags = 0;
    lintErrors = 0;
  }

  return {
    layerBalance,
    orphans,
    unlinkedRaw,
    linkDensity,
    staleness: { staleRawCount, staleThemeCount },
    lintFlags,
    lintErrors,
    checks,
    ...(healthError !== undefined ? { healthError } : {}),
  };
}

/**
 * R4-19-F2 — the kb-cleanup session's live-findings computation. Exported
 * (cli/ is uncapped) so both the session kickoff (`POST /api/studio/kbs/:id/
 * cleanup/start`, cli/ui-bridge.ts) and the session read branch
 * (`GET /api/studio/sessions/kb-cleanup/:id`, cli/bridge-studio-sessions.ts)
 * share ONE implementation of this union rather than each duplicating it.
 *
 * Routed through `collectKbFindings` — the ONE per-KB lens, shared with the
 * health read path and the drain's fix path, so a cleanup plan is drafted over
 * exactly the findings `forge brain lint` reports for this KB and no others.
 *
 * Filtered to `resolution === 'agent'` — the tier brain-maintenance's
 * SKILL.md is scoped to drafting a plan for: 'auto' findings are handled by
 * the deterministic consolidate drain with no plan needed, and 'user'
 * findings need an operator decision neither the agent nor this session can
 * make. Every finding is stamped via `classify` (idempotent, total — safe to
 * call on an already-stamped Finding) so `.kind` is always populated, which
 * `deriveCleanupPlan`'s (orchestrator/studio/session-transcript.ts) plan-line
 * join requires (it matches a parsed action against a finding on (kind,
 * file)).
 *
 * Throws, naming the kb id, when it does not resolve to any real brain
 * directory — fail loud, never a silent empty findings array for an
 * unresolvable KB (the declared-data-fails-open shape this campaign guards
 * against).
 */
export function computeAgentCleanupFindings(forgeRoot: string, kbId: string): (Finding & { kind: string })[] {
  const brainDir = resolveKbBrainDir(forgeRoot, kbId);
  if (!brainDir) {
    throw new Error(`computeAgentCleanupFindings: kb id "${kbId}" does not resolve to any real brain directory`);
  }
  const { findings } = runBrainLintFullMemoized(forgeRoot);
  return collectKbFindings(forgeRoot, kbId, findings)
    .map((f) => classify(f))
    // `.kind` is narrowed to `string` here (classify's own signature keeps
    // it optional — it stamps the SAME field it declares, so TS cannot see
    // that the stamp always lands) — the narrowing is what lets this
    // return type satisfy deriveCleanupPlan's CleanupFinding contract
    // (orchestrator/studio/session-transcript.ts) without a cast.
    .filter((f): f is Finding & { kind: string } => f.resolution === 'agent' && typeof f.kind === 'string');
}

/**
 * Walk brain/ for kb.yaml files and enrich each with layer counts.
 *
 * Scans every direct sub-directory of brain/ (the top-level brains — cycles,
 * forge-dev) AND every sub-directory of brain/projects/ (the central per-project
 * brains, ADR 035 — gitpulse, mdtoc, …). Without the second pass, project brains
 * are invisible in Studio's KB graph even though the reflector writes to them.
 *
 * Sited here (rather than beside the other list-building helpers above) so
 * this declaration is immediately followed by a top-level `export` — the
 * exact structural shape `cli/studio-provenance.test.ts`'s AT-10 walks to
 * prove `provenanceOfOrigin(` is called INSIDE this function and nowhere
 * else (a `function` declaration hoists, so this relocation changes nothing
 * about when or how it runs).
 */
export function loadKbDescriptors(
  forgeRoot: string,
  // W7-FIX-A4 (W7A4-04): every descriptor this walk DROPS as unroutable is
  // reported here (dir + id + reason) in the SAME pass — the list route folds
  // it into `unroutable[]` so the drop is never silent, without a second walk
  // / re-parse of every kb.yaml per poll.
  onUnroutable?: (u: UnroutableKb) => void,
): KbWithCounts[] {
  const result: KbWithCounts[] = [];

  // CONTAINMENT (SEC-01 guard-attack round). `subDirs` filters on dirent type,
  // so a symlinked `brain/<id>` DIRECTORY never reaches here — but that
  // accident says nothing about the LEAF. A genuinely real `brain/<id>/` whose
  // `kb.yaml` is a symlink was confirmed live disclosing the outside file's
  // contents verbatim in this route's 200 response, because this function read
  // `kb.yaml` with no guard at all and every other KB route's fix went in
  // around it. `base` is the fixed containment root and `name` is its own
  // segment (never folded into the root — ./studio-path-guard.ts, CONTRACT).
  const pushFrom = (base: string, name: string): void => {
    const yamlGuard = resolveGuardedPath(base, [name, 'kb.yaml']);
    if (!yamlGuard.ok || !yamlGuard.exists) return;
    try {
      const kb = loadKbDescriptor(yamlGuard.realPath);
      // W7-A4 (knowledge-03): a listed id MUST be routable. Every per-KB route
      // resolves `kbId` → `brain/**/<kbId>/`, so a descriptor whose id is not
      // its directory name, or fails the id rule, is skipped here rather than
      // listed as a KB no route will ever accept. ONE predicate
      // (`unroutableKbReason`, cli/kb-sites.ts) shared with the derived
      // project↔KB binding, the roster's `unroutable[]` diagnostic and
      // `forge studio lint`'s kb `dir-name` check (W7-FIX-A4 / W7A4-04) — the
      // drop is never silent.
      const unroutable = unroutableKbReason(kb.id, name);
      if (unroutable !== null) {
        onUnroutable?.({ dir: name, id: kb.id, path: yamlGuard.realPath, reason: unroutable });
        return;
      }
      // Each layer path is independently guarded — a real kb.yaml is no
      // warrant for a symlinked `themes/` or `_raw/` beside it.
      const layer = (tail: string): string | null => {
        const g = resolveGuardedPath(base, [name, tail]);
        return g.ok && g.exists ? g.realPath : null;
      };
      const indexPath = layer('INDEX.md');
      const themesPath = layer('themes');
      const rawPath = layer('_raw');
      const counts = {
        index: indexPath ? 1 : 0,
        themes: themesPath ? countLayerFiles(themesPath) : 0,
        raw: rawPath ? countLayerFiles(rawPath) : 0,
      };
      // forge-3oq review: attach provenance HERE, the single construction
      // site — never at an individual route (see the `provenance` field's
      // doc comment on KbWithCounts above).
      result.push({ ...kb, counts, provenance: provenanceOfOrigin(kb.origin) });
    } catch {
      // Skip unreadable kb.yaml
    }
  };

  // Both containment roots — brain/<id>/kb.yaml and brain/projects/<id>/kb.yaml
  // (ADR 035) — come from the ONE enumeration in cli/kb-sites.ts, shared with
  // the project roster's derived `kb` field (W7-A4), so the KB roster and the
  // project↔KB pairing can never see different descriptors. Each site gets
  // the identical guarded treatment — a fix that hardens only the primary
  // root leaves the fallback wide open.
  for (const { base, name } of kbSites(forgeRoot)) pushFrom(base, name);

  return result;
}

/**
 * R1-06-F2: session id for the project-brain hand-off a successful KB create
 * starts. Same shape as the architect/instructions/demo-builder family's
 * `newArchitectSessionId` (cli/ui-bridge.ts) — a chronologically-sortable
 * ISO-ish timestamp plus a hex entropy suffix (SAFE_ID_RE-compatible), so a
 * same-second double-create can never collide. Kept local rather than
 * imported: that helper is a private, unexported function of ui-bridge.ts.
 */
function newProjectBrainSessionId(): string {
  const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '');
  const entropy = randomBytes(4).toString('hex');
  return `${stamp}-${entropy}`;
}

/**
 * Mint the project-brain SEEDING session the KB-create route hands off to
 * (R1-06-F2), and return its id.
 *
 * It lives here rather than in `bridge-studio-kb-routes-lifecycle.ts` for one
 * reason: this module is already the KB surface's single point of coupling to
 * `@forge/sessions` (`approveKbCleanup` reads and writes session status), and a
 * five-way split must not turn one boundary row into two. The route decides
 * WHICH project anchors the session; this decides what a project-brain session
 * looks like on disk.
 *
 * Mirrors `POST /api/project-brain/start`'s `{ ok, sessionId }` contract and
 * its status.json write, so a new KB seeds through the SAME shell rather than a
 * competing path. Throws — never returns a half-made session — when the write
 * fails containment.
 */
export function mintProjectBrainSeedingSession(
  projectsRoot: string,
  sessionProject: string,
  kbId: string,
  binding: KbBinding,
): string {
  const sessionId = newProjectBrainSessionId();
  const written = guardedWriteSessionStatus<ProjectBrainStatus>(
    projectsRoot,
    [sessionProject, '_project-brain', sessionId],
    {
      session_id: sessionId,
      project: sessionProject,
      project_repo_path: join(projectsRoot, sessionProject),
      phase: 'briefing',
      prompt: '',
      updated_at: new Date().toISOString(),
      kb_id: kbId,
      kb_binding: binding,
    },
  );
  if (written === null) {
    throw new Error(`kb create: hand-off session status.json for "${kbId}" failed containment`);
  }
  return sessionId;
}

/**
 * R1-06 WI-2 review (MAJOR 2): dot-prefixed anchor for a NON-project KB
 * seeding session's `projects/<anchor>/_project-brain/<sid>/` directory. A
 * flow/unique-bound KB has no natural project home, so anchoring it under the
 * bare KB id created a top-level `projects/<kbId>/` dir that `discoverProjects`
 * (orchestrator/studio/registry.ts) surfaced as a PHANTOM project. Both
 * `discoverProjects` and `subDirs` (this file) already skip dot-prefixed dirs —
 * a real project/kb id is slug-validated (no leading dot) — so a dot-prefixed
 * anchor keeps the seeding session on disk + runner-reachable while filtering it
 * out of project discovery. The anchor is a pure filesystem-nesting device: the
 * seeding runner reads the KB's identity from the session status.json's `kb_id`
 * field, never from the anchor name.
 */
export const KB_SEEDING_ANCHOR_PREFIX = '.kb-';
