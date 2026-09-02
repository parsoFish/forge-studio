/**
 * Brain-consolidate pipeline — the serialized runner behind
 * `POST /api/studio/kbs/:id/maintenance` with `op=consolidate`, and the
 * deterministic subset of it that `op=index` reuses.
 *
 * Split out of `bridge-studio-kbs.ts` in M4 PR 4b, which took that file from
 * 2,068 lines to five under the 800-line cap. The unit that moved is the whole
 * consolidate concern: the per-kb dispatch queue, the finding grouping and
 * description helpers, the deterministic auto-fixes, and the terminal-event
 * writers the fix-agent GET reads back.
 *
 * WHY THIS IS THE SEAM. Three symbols that were private here are now exported,
 * and that is a code-shape change rather than a move: `AgentFinding`,
 * `isDeterministicNotListedFinding` and `applyDeterministicConsolidateFixes`
 * are consumed by BOTH this pipeline and the maintenance route's `op=index`
 * branch, which now lives in `bridge-studio-kb-routes-maintenance.ts`.
 * `writeConsolidateTerminalEvent` is exported for the same reason.
 *
 * This module imports nothing from its siblings — the dependency edges point
 * INTO it, never out — so the route files can import it without a cycle.
 */
import { mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import matter from 'gray-matter';
import { runBrainFixTurn } from '@forge/sessions/brain-fix-runner.ts';
import { ensureLinkedAt } from './brain-fix-auto.ts';
import { type Finding } from './brain-lint.ts';
import { isDryBridge } from '../../cli/dry-bridge.ts';
import { collectKbFindings, runBrainLintFullMemoized, runBrainLintFullFresh } from './kb-lint-summary.ts';

/**
 * R1-06 WI-3: write the SINGLE terminal event for a `consolidate` run's own
 * exposed `runId`. Deliberately NOT one event per finding — each per-finding
 * `runBrainFixTurn` call inside `runBrainConsolidate` is given its OWN
 * discardable sub-runId (never the exposed one), so its 'end' event lands in
 * a different log dir and can never leak into this run's log. Without that
 * separation, `readBrainFixState` (which returns on the FIRST terminal event
 * found scanning backward) would report the whole consolidate batch "done"
 * the moment the FIRST scoped finding cleared, while the rest were still
 * mid-flight — silently truncating the drain this op exists to guarantee.
 */
export function writeConsolidateTerminalEvent(
  forgeRoot: string,
  runId: string,
  outcome: { total: number; clearedCount: number },
): void {
  const logDir = join(forgeRoot, '_logs', `_brainfix-${runId}`);
  mkdirSync(logDir, { recursive: true });
  // W8-F1 (knowledge-42): a run that cleared NOTHING has not cleared
  // anything — `total === 0` used to short-circuit to `cleared:true`, making
  // a no-op consolidate byte-identical to a real full clear on the wire.
  const cleared = outcome.clearedCount > 0 && outcome.clearedCount === outcome.total;
  const line = JSON.stringify({
    event_type: 'end',
    message: `brain-fix-consolidate.end (cleared=${outcome.clearedCount}/${outcome.total})`,
    metadata: { runId, cleared, total: outcome.total, clearedCount: outcome.clearedCount },
  });
  try {
    appendFileSync(join(logDir, 'events.jsonl'), line + '\n', 'utf8');
  } catch {
    // Best-effort: a run whose terminal event never lands stays 'running'
    // forever, which the caller's own poll-budget timeout surfaces loudly
    // rather than this failing silently in a way that hides the cause.
  }
}

/**
 * R1-06 WI-3 review MINOR 1 (poll-hang on throw): the terminal event for a
 * consolidate run whose repair phase (the initial `runBrainLint`, or
 * `applyDeterministicConsolidateFixes`' `ensureLinkedAt` read/write) threw
 * before the normal `writeConsolidateTerminalEvent` could fire. Without this,
 * `readBrainFixState` reports 'running' forever and every poller exhausts its
 * whole budget. Writes an `event_type:'error'` terminal — which
 * `readBrainFixState` maps to state 'failed' — NOT a vacuous cleared:true
 * 'end', so the failure is honest rather than a silent success.
 */
function writeConsolidateErrorTerminalEvent(forgeRoot: string, runId: string, err: unknown): void {
  const logDir = join(forgeRoot, '_logs', `_brainfix-${runId}`);
  try { mkdirSync(logDir, { recursive: true }); } catch { /* dir may already exist; the append below is the real signal */ }
  const line = JSON.stringify({
    event_type: 'error',
    message: 'brain-fix-consolidate.crashed',
    metadata: { runId, error: err instanceof Error ? err.message : String(err) },
  });
  try {
    appendFileSync(join(logDir, 'events.jsonl'), line + '\n', 'utf8');
  } catch {
    // Best-effort — the caller's poll budget still surfaces a stuck run loudly.
  }
}

export type AgentFinding = Finding & { check: string; kind: string };

/**
 * Best-effort extraction of the target index-file path a
 * `checkProjectBrainIndexes` finding's message embeds (e.g. "not listed in
 * project category index: brain/projects/<id>/patterns.md") — the file the
 * FIX actually writes, which is NOT `f.file` (that's the unrelated theme
 * file the finding is keyed by). Falls back to the finding's own `file` when
 * no index path is embedded (a different check's message shape), which just
 * keeps that finding in its own single-finding group rather than breaking.
 */
function consolidateTargetFile(forgeRoot: string, f: AgentFinding): string {
  const m = /category index:\s*(\S+)\s*$/.exec(f.message);
  return m ? resolve(forgeRoot, m[1]) : f.file;
}

/**
 * Group agent-tier findings by the file their fix actually writes to.
 * Findings sharing a write target get ONE real agent session covering ALL of
 * them ("ONE session over the FULL scoped finding set") instead of one
 * session per finding — both far fewer real SDK round trips and no risk of
 * two turns racing edits on the same file.
 */
function groupConsolidateFindings(forgeRoot: string, findings: readonly AgentFinding[]): Map<string, AgentFinding[]> {
  const groups = new Map<string, AgentFinding[]>();
  for (const f of findings) {
    const target = consolidateTargetFile(forgeRoot, f);
    const list = groups.get(target);
    if (list) list.push(f);
    else groups.set(target, [f]);
  }
  return groups;
}

/** Best-effort theme frontmatter `description` (empty string on any
 *  read/parse failure — the agent still gets a valid, if bare, link line). */
function themeDescription(themeFile: string): string {
  try {
    // `{}` — no-cache parse (W7 FIX-B-KB): gray-matter's module-level cache
    // is poisoned to `data: {}` by any THROWING parse of the same content
    // elsewhere in this process (see cli/brain-lint.ts parseTheme).
    const { data } = matter(readFileSync(themeFile, 'utf8'), {});
    return String((data as Record<string, unknown>).description ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/** The exact link-line shape `readIndexEntries` (cli/brain-lint.ts) scans
 *  for, mirroring the deterministic auto-fixer's own `linkLine` convention
 *  (cli/brain-fix-auto.ts) — so a pre-computed line is indistinguishable from
 *  one a human or the auto-fixer would have written. */
function themeLinkLine(themeFile: string): string {
  const slug = basename(themeFile, '.md');
  const desc = themeDescription(themeFile);
  return desc ? `- [\`${slug}\`](./themes/${slug}.md) — ${desc}` : `- [\`${slug}\`](./themes/${slug}.md)`;
}

/**
 * Combine a group's findings into ONE message + fixHint the agent turn can
 * act on in a single pass, rather than the single-finding phrasing
 * `runBrainFixTurn` uses for a lone finding. Real SDK round trips are the
 * dominant cost of every session, so for the common "not listed in project
 * category index" shape this pre-computes the EXACT append-ready line per
 * finding — a directive single-edit instruction instead of asking the agent
 * to open every theme file and compose its own lines, collapsing what would
 * otherwise be several exploratory tool-use turns into one.
 */
function describeConsolidateGroup(group: readonly AgentFinding[]): { message: string; fixHint?: string } {
  if (group.length === 1) return { message: group[0].message, fixHint: group[0].fixHint };
  if (group.every((f) => f.message.startsWith('not listed'))) {
    const lines = group.map((f) => themeLinkLine(f.file));
    return {
      message: `${group.length} theme(s) missing from this category index: ${group.map((f) => basename(f.file, '.md')).join(', ')}`,
      fixHint:
        `Append EXACTLY these ${lines.length} line(s) to the end of the file, verbatim, one per line, then stop — ` +
        `do not open or read any other file:\n${lines.join('\n')}`,
    };
  }
  const message = `${group.length} findings to resolve in this one file:\n` +
    group.map((f, i) => `${i + 1}. [${f.kind}] ${f.message}`).join('\n');
  const hint = group[0].fixHint;
  const fixHint = `Resolve EVERY finding listed above in this single file before stopping.` +
    (hint ? ` ${hint}` : '');
  return { message, fixHint };
}

/**
 * Per-KB consolidate serialization. A second `op:'consolidate'` dispatch
 * against a KB that already has a run in flight must NOT start its own real
 * agent turns concurrently with the first — both could target the same
 * on-disk category-index file (e.g. the operator double-clicking
 * "Consolidate", or a manual dispatch overlapping the reflector's own
 * post-cycle kb-health pass) and race-edit it, which is both a correctness
 * hazard (lost writes) and inflates latency (an agent turn that reads
 * half-written state needs extra tool-use rounds to make sense of it). One
 * `Promise` chain per kbId is the queue; each queued unit re-computes its OWN
 * scoped finding set at ACTUAL run time (`runBrainConsolidateNow`, not at
 * enqueue time), so a run queued behind an already-in-flight one correctly
 * sees whatever the prior run already cleared instead of redoing it.
 */
const consolidateQueues = new Map<string, Promise<unknown>>();

/** Fire-and-forget dispatch defer: long enough that a queued run never lands
 *  inline with (and complete before) the dispatching request's own HTTP
 *  response finishes round-tripping — a same-turn completion (a bare
 *  `.then()` is only a MICROtask, which drains before the response is even
 *  flushed) would let a run's on-disk mutations race ahead of both the
 *  response that reports its `runId` and any other in-flight request against
 *  the same KB. Still 200x under the 10s poll budget the deterministic
 *  in-process repair path (no SDK turn) needs to actually run in. */
const CONSOLIDATE_DISPATCH_DEFER_MS = 50;

function deferToNextTick(): Promise<void> {
  return new Promise((resolveTick) => setTimeout(resolveTick, CONSOLIDATE_DISPATCH_DEFER_MS));
}

/**
 * Exported (cli-side, uncapped — ADR 042) for the R4-19-F2 DEFECT-A fix:
 * the kb-cleanup `apply` route (cli/ui-bridge.ts) must route its own
 * `runBrainConsolidateNow` dispatch through this SAME per-kbId queue the
 * `maintenance` op=consolidate route already uses — see `runBrainConsolidateNow`'s
 * own doc comment above ("Always invoked via enqueueConsolidate, never
 * directly"). Returns the queued run's own `Promise<void>` (always
 * RESOLVES, never rejects — `run()`'s own errors are caught internally, per
 * the comment on the swallowed `.catch` below) so a caller that must know
 * when its OWN dispatch has actually finished (apply writes `phase:applied`
 * only after the drain completes) can `await` it; the pre-existing
 * `maintenance` route stays fire-and-forget by simply not awaiting the
 * returned promise — this change is additive, not a behavior change for
 * that caller.
 */
export function enqueueConsolidate(kbId: string, run: () => Promise<void>): Promise<void> {
  const prior = consolidateQueues.get(kbId) ?? Promise.resolve();
  const next = prior.then(() => deferToNextTick().then(run), () => deferToNextTick().then(run));
  const queued = next.catch(() => { /* queue continuation only; each run's own errors are already handled inside it */ });
  consolidateQueues.set(kbId, queued);
  return queued;
}

/**
 * True for the ONE `checkProjectBrainIndexes` message shape with a fully
 * deterministic repair — "not listed in project category index" — where
 * `consolidateTargetFile` resolves the finding's own message to the EXACT
 * index file to append into, and the theme's link line is a pure function of
 * its own frontmatter (no judgment call). The sibling "category index
 * missing" (would need a whole new file authored) and "listed N times"
 * (needs a keep/drop decision) message shapes stay agent-tier — this
 * deterministic path only ever claims the shape it can prove is safe.
 */
export function isDeterministicNotListedFinding(f: AgentFinding): boolean {
  return f.check === 'checkProjectBrainIndexes' && /not listed in project category index:/.test(f.message);
}

/**
 * R1-06 WI-3 CI-safety fix: resolve every deterministically-repairable
 * finding IN-PROCESS — zero child spawns, zero SDK turns — by reusing
 * `ensureLinkedAt` (cli/brain-fix-auto.ts), the SAME idempotent
 * append-link-line convention `op=fix-auto` already uses for the top-level
 * brains' `index.not-listed` kind. For the pin fixture (all
 * `checkProjectBrainIndexes` "not listed" findings) this clears every
 * finding with zero agent turns. Returns the findings this pass could NOT
 * resolve — genuinely agent-tier work for a real (non-NO_SPAWN) run.
 */
export function applyDeterministicConsolidateFixes(
  forgeRoot: string,
  findings: readonly AgentFinding[],
): AgentFinding[] {
  const residual: AgentFinding[] = [];
  for (const f of findings) {
    if (!isDeterministicNotListedFinding(f)) { residual.push(f); continue; }
    const indexPath = consolidateTargetFile(forgeRoot, f);
    const result = ensureLinkedAt(indexPath, f.file);
    // A failed deterministic attempt (unparseable theme, missing index file,
    // …) falls back to the agent tier rather than silently dropping the
    // finding — the re-lint at the end of the run still surfaces it as
    // uncleared either way.
    if (!result.ok) residual.push(f);
  }
  return residual;
}

/**
 * R1-06 WI-3: drain the FULL agent-tier finding set scoped to `kbId` — the
 * KB's RESOLVED `consolidate` obligation (`DEFAULT_KB_CONSOLIDATE`,
 * `orchestrator/studio/kb-descriptor.ts`) is the SAME 'brain-fix' agent
 * op=fix-agent dispatches one finding at a time; this runs it over every
 * scoped agent-tier finding grouped by shared write-target (one real session
 * per target file, covering every finding that lands there — "ONE session
 * over the FULL scoped finding set"), instead of requiring one "Fix with
 * agent" click per finding. Sequential across groups (not parallel) — agent
 * turns share the same brain corpus on disk, so concurrent turns could race
 * on the same file. Always invoked via `enqueueConsolidate` (never directly),
 * which is what keeps this run from overlapping another dispatch against the
 * same kbId.
 *
 * CI-safety (this WI's fix): deterministically-repairable findings are
 * cleared in-process FIRST via `applyDeterministicConsolidateFixes` — no
 * spawn, no SDK turn, so they never depend on the no-spawn guard below. Only
 * the genuinely-ambiguous residual gets a real agent turn, and ONLY when
 * neither `FORGE_ARCHITECT_NO_SPAWN=1` nor the dry-bridge seam is active —
 * mirroring `spawnAgentTurn`'s own `FORGE_ARCHITECT_NO_SPAWN` guard
 * (cli/ui-bridge.ts) so this route can never spawn a real `forge brain fix` /
 * SDK turn under the harness env CI runs `npm test` with. The single
 * terminal event is always written (even when the loop below is skipped
 * entirely), so a CI run with residual findings still reaches a terminal
 * state deterministically — just with an honest `cleared: false`.
 */
export async function runBrainConsolidateNow(forgeRoot: string, kbId: string, runId: string): Promise<void> {
  // MINOR 1: the whole body is wrapped so the SINGLE terminal event is
  // guaranteed even on an unexpected throw in the pre-terminal repair phase
  // (the initial runBrainLint, or applyDeterministicConsolidateFixes'
  // ensureLinkedAt read/write). The happy path writes its own terminal at the
  // end and returns without throwing, so the catch never double-fires.
  try {
    const { findings } = runBrainLintFullMemoized(forgeRoot);
    // W7-B2 (knowledge-10): the union lens — a project-bound KB's own-theme
    // agent-tier findings are consolidate's obligation too, and the old
    // scopeFindingsToKb-alone read was structurally empty for them.
    const scoped = collectKbFindings(forgeRoot, kbId, findings);
    const agentTier = scoped.filter(
      (f): f is AgentFinding => f.resolution === 'agent' && typeof f.check === 'string' && typeof f.kind === 'string',
    );

    const residual = applyDeterministicConsolidateFixes(forgeRoot, agentTier);
    const noSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge();

    if (!noSpawn) {
      const groups = groupConsolidateFindings(forgeRoot, residual);
      let i = 0;
      for (const [targetFile, group] of groups) {
        const { message, fixHint } = describeConsolidateGroup(group);
        try {
          await runBrainFixTurn({
            runId: `${runId}__${i}`,
            kbId,
            file: targetFile,
            check: group[0].check,
            kind: group[0].kind,
            fixHint,
            message,
            forgeRoot,
          });
        } catch {
          // One group's agent turn failing must not abort the rest of the
          // batch — every other scoped group still gets its own attempt.
        }
        i++;
      }
    }
    // else: CI-safe seam — any residual (non-deterministic) findings are left
    // for a real production run; the terminal event below still fires so the
    // poller never blocks on a turn that will never happen.

    // Re-lint for an ACCURATE cleared count: `runBrainFixTurn`'s own per-run
    // `cleared` signal is scoped to its `file` argument, which for a grouped,
    // multi-finding session is the shared INDEX file — not the theme files
    // the original findings are keyed by — so it would report a vacuous
    // "cleared" that never actually re-checked anything. MUST be the FRESH
    // path, never the memo: this read has to observe the writes this same
    // function just made (applyDeterministicConsolidateFixes above, and any
    // runBrainFixTurn calls), which a memo entry the INITIAL scan (line ~432)
    // may have just seeded cannot be trusted to reflect (reviewer-flagged,
    // W6-P2 round 2).
    let clearedCount = 0;
    try {
      const { findings: after } = runBrainLintFullFresh(forgeRoot);
      const stillPresent = new Set(
        collectKbFindings(forgeRoot, kbId, after)
          .filter((f) => f.resolution === 'agent')
          .map((f) => `${f.kind}::${f.file}`),
      );
      clearedCount = agentTier.filter((f) => !stillPresent.has(`${f.kind}::${f.file}`)).length;
    } catch {
      clearedCount = 0;
    }

    writeConsolidateTerminalEvent(forgeRoot, runId, { total: agentTier.length, clearedCount });
  } catch (err) {
    // The repair phase threw before the normal terminal could fire. Emit an
    // honest error terminal so the poll resolves to 'failed' within its budget
    // instead of hanging on 'running' forever.
    writeConsolidateErrorTerminalEvent(forgeRoot, runId, err);
  }
}
