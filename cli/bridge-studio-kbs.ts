/**
 * Forge Studio KB (Knowledge Base) bridge routes (M5).
 *
 * Extracted from bridge-studio.ts to keep both modules under 800 LOC.
 * Imports shared helpers from bridge-studio.ts — no duplication, no circular
 * import (this module imports FROM bridge-studio, not vice versa).
 *
 * Routes:
 *   GET  /api/studio/kbs                        → { kbs: KbWithCounts[] }
 *   GET  /api/studio/kbs/resolve-node/:nodeId   → { kbId: string }
 *   GET  /api/studio/kbs/:id/nodes/:nodeId      → { node: KbNodeArticle }
 *   GET  /api/studio/kbs/:id                    → { kb, graph, health }
 *   POST /api/studio/kbs                        → create a new KB
 *   POST /api/studio/kbs/:id/guidance           → append guidance to a KB
 *
 * Returns false for non-matching URLs (passthrough to next handler).
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, rmSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { resolveGuardedPath, type PathGuardResult } from './studio-path-guard.ts';
// gray-matter has no usable types; treated as `any` like cli/brain-lint.ts and
// cli/brain-fix-auto.ts, which import it the same way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import matter from 'gray-matter';

import { loadKbDescriptor, serializeKbDescriptor, listFlowIds, discoverProjects, resolveKbProcesses } from '../orchestrator/studio/registry.ts';
import { resolveKbBrainDir } from '../orchestrator/brain-paths.ts';
import { SLUG_RE } from '../orchestrator/studio/validate.ts';
import { getKbBackend } from '../orchestrator/kb-backend.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '../orchestrator/config.ts';
import { KB_BINDING_KINDS, type KbBinding, type KbDescriptor } from '../orchestrator/studio/types.ts';
import { listFlowBandIds } from './flow-band-vocab.ts';
import { guardedWriteSessionStatus } from '../orchestrator/interactive-session.ts';
import type { ProjectBrainStatus } from '../orchestrator/project-brain-builder-runner.ts';
import { runBrainFixTurn } from '../orchestrator/brain-fix-runner.ts';
import { ensureLinkedAt } from './brain-fix-auto.ts';
import { runBrainLint, resolutionCounts, applyAutoFixesUntilStable, CHECK_NAMES, type Finding } from './brain-lint.ts';
import { regenerateBrainIndex } from './brain-index.ts';
import { isDryBridge, refuseDryBridge } from './dry-bridge.ts';
import {
  sendJson,
  allowedOrigin,
  sanitizeError,
  readJson,
  pathOnly,
  SAFE_ID_RE,
  type StudioContext,
} from './bridge-studio.ts';

// ---------------------------------------------------------------------------
// KBs with layer counts
// ---------------------------------------------------------------------------

type KbWithCounts = {
  id: string;
  name: string;
  binding: KbBinding;
  desc: string;
  path: string;
  counts: { index: number; themes: number; raw: number };
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
function subDirs(dir: string): string[] {
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

/**
 * Walk brain/ for kb.yaml files and enrich each with layer counts.
 *
 * Scans every direct sub-directory of brain/ (the top-level brains — cycles,
 * forge-dev) AND every sub-directory of brain/projects/ (the central per-project
 * brains, ADR 035 — gitpulse, mdtoc, …). Without the second pass, project brains
 * are invisible in Studio's KB graph even though the reflector writes to them.
 */
export function loadKbDescriptors(forgeRoot: string): KbWithCounts[] {
  const brainRoot = join(resolve(forgeRoot), 'brain');
  if (!existsSync(brainRoot)) return [];

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
      result.push({ ...kb, counts });
    } catch {
      // Skip unreadable kb.yaml
    }
  };

  // Top-level brains: brain/<id>/kb.yaml (brain/projects has no kb.yaml of its
  // own, so it is naturally skipped here).
  for (const d of subDirs(brainRoot)) pushFrom(brainRoot, d);
  // Central per-project brains: brain/projects/<id>/kb.yaml (ADR 035). This is
  // a SECOND containment root and gets the identical treatment — a fix that
  // hardens only the primary root leaves the fallback wide open.
  const projectsRoot = join(brainRoot, 'projects');
  for (const d of subDirs(projectsRoot)) pushFrom(projectsRoot, d);

  return result;
}

// ---------------------------------------------------------------------------
// Lint-resolution helpers (the guided-resolution UI)
// ---------------------------------------------------------------------------

/**
 * R1-06 WI-3 review MAJOR 1 + MAJOR 2 — the ONE exact-dir scoping root both a
 * KB's health lint COUNT (read) and its consolidate/fix-auto obligation (WRITE)
 * share. A finding belongs to `kbId` iff its file resolves to a path AT or
 * nested UNDER the KB's OWN resolved brain dir — `resolveKbBrainDir`, the SAME
 * resolution consolidate/lint/health use, covering BOTH `brain/<id>` and the
 * central per-project `brain/projects/<id>` (ADR 035).
 *
 * The two shapes this replaces were both live defects:
 *   - substring `f.file.includes(kbId)` (the old `scopeFindingsToKb`) folded a
 *     SIBLING like `alpha-two` into `alpha` — and because consolidate turns the
 *     scope into WRITES, consolidating `alpha` mutated `brain/projects/alpha-two/`
 *     (cross-KB write, MAJOR 2);
 *   - the hardcoded `brain/<id>` prefix (buildKbHealth's old filter) matched
 *     NOTHING for a project brain at `brain/projects/<id>`, so health reported
 *     lintFlags=0 and hid the Lint section for exactly the project KBs WI-3
 *     targets (declared-data-fails-open, MAJOR 1).
 *
 * Comparison is by identity-after-realpath (not a lexical prefix): the finding's
 * file is realpath'd where it exists, matching `resolveKbBrainDir`'s own
 * realpath'd return — so a symlinked forge-root component (e.g. macOS `/tmp`)
 * can't defeat the prefix check, and a theme reached through a symlink that
 * escapes the dir is correctly EXCLUDED from a write scope rather than folded in.
 */
function findingUnderDir(forgeRoot: string, brainDir: string, f: Finding): boolean {
  if (!f.file) return false;
  const abs = resolve(forgeRoot, f.file);
  // Never let a realpath fs-throw (e.g. a TOCTOU unlink between existsSync and
  // realpathSync) escape the scoping path and 500 an otherwise-fine lint —
  // fall back to the lexical absolute path.
  let real = abs;
  try {
    if (existsSync(abs)) real = realpathSync(abs);
  } catch {
    real = abs;
  }
  return real === brainDir || real.startsWith(brainDir + sep);
}

function scopeFindingsToKb(forgeRoot: string, kbId: string, findings: readonly Finding[]): Finding[] {
  const brainDir = resolveKbBrainDir(forgeRoot, kbId);
  if (!brainDir) return [];
  return findings.filter((f) => findingUnderDir(forgeRoot, brainDir, f));
}

/** Spawn ONE detached `forge brain fix` agent turn; events stream to
 *  _logs/_brainfix-<runId>/events.jsonl. Mirrors spawnArchitectTurn. */
function spawnBrainFix(
  forgeRoot: string,
  p: { kbId: string; file: string; check: string; kind: string; fixHint?: string; message: string; runId: string },
): void {
  const logDir = join(forgeRoot, '_logs', `_brainfix-${p.runId}`);
  mkdirSync(logDir, { recursive: true });
  const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
  const argv = [
    '--experimental-strip-types', 'orchestrator/cli.ts', 'brain', 'fix',
    '--kb', p.kbId, '--file', p.file, '--check', p.check, '--kind', p.kind,
    '--run-id', p.runId, '--message', p.message,
  ];
  if (p.fixHint) argv.push('--hint', p.fixHint);
  const proc = spawn(process.execPath, argv, { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] });
  closeSync(stderrFd);
  proc.unref();
}

/** Read a brain-fix run's terminal state from its event log. */
function readBrainFixState(forgeRoot: string, runId: string): { state: 'running' | 'cleared' | 'not-cleared' | 'failed'; cleared: boolean } {
  const evPath = join(forgeRoot, '_logs', `_brainfix-${runId}`, 'events.jsonl');
  if (!existsSync(evPath)) return { state: 'running', cleared: false };
  let raw: string;
  try { raw = readFileSync(evPath, 'utf8'); } catch { return { state: 'running', cleared: false }; }
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    let ev: { event_type?: string; message?: string; metadata?: { cleared?: boolean } };
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.event_type === 'end' || ev.message?.startsWith('brain-fix.end')) {
      const cleared = ev.metadata?.cleared === true;
      return { state: cleared ? 'cleared' : 'not-cleared', cleared };
    }
    if (ev.event_type === 'error' || ev.message === 'brain-fix.crashed') {
      return { state: 'failed', cleared: false };
    }
  }
  return { state: 'running', cleared: false };
}

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
function writeConsolidateTerminalEvent(
  forgeRoot: string,
  runId: string,
  outcome: { total: number; clearedCount: number },
): void {
  const logDir = join(forgeRoot, '_logs', `_brainfix-${runId}`);
  mkdirSync(logDir, { recursive: true });
  const cleared = outcome.total === 0 || outcome.clearedCount === outcome.total;
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

type AgentFinding = Finding & { check: string; kind: string };

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
    const { data } = matter(readFileSync(themeFile, 'utf8'));
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

function enqueueConsolidate(kbId: string, run: () => Promise<void>): void {
  const prior = consolidateQueues.get(kbId) ?? Promise.resolve();
  const next = prior.then(() => deferToNextTick().then(run), () => deferToNextTick().then(run));
  consolidateQueues.set(kbId, next.catch(() => { /* queue continuation only; each run's own errors are already handled inside it */ }));
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
function isDeterministicNotListedFinding(f: AgentFinding): boolean {
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
function applyDeterministicConsolidateFixes(
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
async function runBrainConsolidateNow(forgeRoot: string, kbId: string, runId: string): Promise<void> {
  // MINOR 1: the whole body is wrapped so the SINGLE terminal event is
  // guaranteed even on an unexpected throw in the pre-terminal repair phase
  // (the initial runBrainLint, or applyDeterministicConsolidateFixes'
  // ensureLinkedAt read/write). The happy path writes its own terminal at the
  // end and returns without throwing, so the catch never double-fires.
  try {
    const { findings } = runBrainLint({ cwd: forgeRoot, scope: 'full' });
    const scoped = scopeFindingsToKb(forgeRoot, kbId, findings);
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
    // "cleared" that never actually re-checked anything.
    let clearedCount = 0;
    try {
      const { findings: after } = runBrainLint({ cwd: forgeRoot, scope: 'full' });
      const stillPresent = new Set(
        scopeFindingsToKb(forgeRoot, kbId, after)
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

// ---------------------------------------------------------------------------
// KB health computation
// ---------------------------------------------------------------------------

/** R6-08 WI-1 — per-check itemization row. `status` is 'unknown' only when
 *  the whole lint run threw (RULING 3) — never a per-check outcome otherwise. */
type CheckHealthStatus = 'pass' | 'warn' | 'fail' | 'unknown';
type CheckHealthEntry = { check: string; status: CheckHealthStatus; errorCount: number; flagCount: number };

type KbHealth = {
  layerBalance: { index: number; theme: number; raw: number };
  orphans: number;
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
function buildKbHealth(
  forgeRoot: string,
  kbId: string,
  graph: import('../orchestrator/kb-graph.ts').KbGraph,
  _counts: { index: number; themes: number; raw: number },
): KbHealth {
  const { nodes, edges } = graph;

  // Layer balance from graph node counts (more accurate than the raw dir count)
  const layerBalance = {
    index: nodes.filter((n) => n.layer === 'index').length,
    theme: nodes.filter((n) => n.layer === 'theme').length,
    raw: nodes.filter((n) => n.layer === 'raw').length,
  };

  // Orphans: nodes with degree 0 (no inbound AND no outbound edges)
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const orphans = nodes.filter((n) => (degree.get(n.id) ?? 0) === 0).length;

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

  // Run brain-lint and filter findings to this kb's directory. MAJOR 1: scope
  // through the SAME exact-dir helper consolidate/lint use (resolveKbBrainDir),
  // so a project brain at brain/projects/<id> is counted — the old hardcoded
  // `resolve(forgeRoot,'brain',kbId)` prefix matched nothing for a project KB
  // and reported a false 0, hiding the Lint section for exactly those KBs.
  //
  // R6-08 WI-1: itemize by CHECK_NAMES (the single source of truth,
  // cli/brain-lint.ts) — every one of the 10 full-scope checks always gets an
  // entry, a clean check reporting status:'pass' rather than being omitted.
  // RULING 3: if the lint run itself throws (e.g. a category index that is a
  // directory — readIndexEntries' readFileSync throws EISDIR inside
  // checkProjectBrainIndexes, uncaught by runBrainLint), every check reports
  // status:'unknown' plus a top-level healthError — NEVER a silent 0/0 "clean"
  // pass, which is exactly the declared-data-fails-open bug this replaces.
  let lintFlags = 0;
  let lintErrors = 0;
  let checks: CheckHealthEntry[];
  let healthError: string | undefined;
  try {
    const { findings } = runBrainLint({ cwd: forgeRoot, scope: 'full' });
    const kbFindings = scopeFindingsToKb(forgeRoot, kbId, findings);
    const byCheck = new Map<string, Finding[]>();
    for (const name of CHECK_NAMES) byCheck.set(name, []);
    for (const f of kbFindings) {
      if (!f.check) continue;
      byCheck.get(f.check)?.push(f);
    }
    checks = CHECK_NAMES.map((name) => {
      const list = byCheck.get(name) ?? [];
      const errorCount = list.filter((f) => f.category === 'error').length;
      const flagCount = list.filter((f) => f.category === 'flag' || f.category === 'auto-fix').length;
      const status: CheckHealthStatus = errorCount > 0 ? 'fail' : flagCount > 0 ? 'warn' : 'pass';
      return { check: name, status, errorCount, flagCount };
    });
    lintErrors = checks.reduce((sum, c) => sum + c.errorCount, 0);
    lintFlags = checks.reduce((sum, c) => sum + c.flagCount, 0);
  } catch (err) {
    checks = CHECK_NAMES.map((name) => ({ check: name, status: 'unknown' as const, errorCount: 0, flagCount: 0 }));
    healthError = err instanceof Error ? err.message : String(err);
    lintFlags = 0;
    lintErrors = 0;
  }

  return {
    layerBalance,
    orphans,
    linkDensity,
    staleness: { staleRawCount, staleThemeCount },
    lintFlags,
    lintErrors,
    checks,
    ...(healthError !== undefined ? { healthError } : {}),
  };
}

// ---------------------------------------------------------------------------
// Guidance size cap
// ---------------------------------------------------------------------------

const GUIDANCE_MAX_BYTES = 8 * 1024; // 8 KiB

/**
 * Guarded resolution of a path NESTED under a kb dir that
 * `resolveKbBrainDir` already identity-verified (bd `forge-wze`).
 *
 * Every "path traversal detected" check this file used to carry was
 * `resolve(base, id).startsWith(base + sep)` on an UNRESOLVED path — VACUOUS,
 * structurally incapable of failing for a `SLUG_RE`-valid id, because
 * `resolve()` normalizes `..` before the comparison and a symlink's own
 * location is lexically inside the root even when it points elsewhere. A
 * guard that cannot fail is not a guard; they are replaced, not supplemented.
 *
 * `kbDir` is split back into its trusted base + its own id rather than passed
 * as the guard's `root`, so the id re-enters as a `segments[]` element and is
 * identity-checked — the root-folding prohibition in the CONTRACT section of
 * `./studio-path-guard.ts`. Returns the raw guard result because the write
 * routes need `exists` to distinguish create-mode from edit-mode.
 */
function guardKbTail(kbDir: string, ...tail: readonly string[]): PathGuardResult {
  return resolveGuardedPath(dirname(kbDir), [basename(kbDir), ...tail]);
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

// ---------------------------------------------------------------------------
// Unified KB route handler (GET + POST)
// ---------------------------------------------------------------------------

/**
 * Handle all Forge Studio KB routes (read and write).
 *
 * Returns true if the route was handled (even on error), false for unknown URLs.
 * Never throws — all errors caught, returned as JSON.
 *
 * @param req    - Incoming request (used for origin check)
 * @param res    - Server response
 * @param ctx    - Minimal context: forgeRoot + logsRoot
 * @param rawUrl - Full URL including query string
 * @param method - HTTP method string
 */
export async function handleStudioKbRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- GET /api/studio/kbs (list) -----------------------------------------
  if (url === '/api/studio/kbs' && method === 'GET') {
    try {
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      sendJson(res, 200, { kbs }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

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

  // ---- GET /api/studio/kbs/:id/nodes/:nodeId (node article) ---------------
  // Must be matched before /api/studio/kbs/:id (more specific path).
  const kbNodeMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/nodes\/([^/]+)$/);
  if (kbNodeMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(kbNodeMatch[1]);
      const nodeId = decodeURIComponent(kbNodeMatch[2]);

      // Slug-guard both ids (SLUG_RE covers typical slugs; nodeIds may have
      // 'raw:' prefix — use a slightly broader guard for nodeId).
      if (!SLUG_RE.test(kbId)) {
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
      // structurally incapable of failing for a SLUG_RE-valid id. Removed
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

  // ---- GET /api/studio/kbs/:id (single kb — graph + health) ---------------
  const kbGetMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)$/);
  if (kbGetMatch && method === 'GET') {
    try {
      const kbId = decodeURIComponent(kbGetMatch[1]);

      // Slug-guard before any fs operation
      if (!SLUG_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }

      // Containment is enforced at the choke point this route actually reads
      // through — `resolveKbBrainDir` (per-segment realpath identity walk) via
      // getKbBackend/kb-graph. The block that stood here built a `kbDir` it
      // then never used and compared it against its own prefix: vacuous,
      // structurally incapable of failing for a SLUG_RE-valid id. Removed
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

      // Drop 'path' from the KB response (client Kb type doesn't carry it)
      const { path: _path, ...kbPublic } = kb;
      sendJson(res, 200, { kb: kbPublic, graph, health }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/kbs (create a new KB) (M5-4) ---------------------
  if (url === '/api/studio/kbs' && method === 'POST') {
    try {
      // 1. Parse request body
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

      // 2. Validate id (slug-guard blocks path traversal)
      const id = typeof b['id'] === 'string' ? b['id'].trim() : '';
      if (!id) {
        sendJson(res, 400, { error: 'id is required' }, origin);
        return true;
      }
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid kb id — must match [a-z][a-z0-9]*(-[a-z0-9]+)*' }, origin);
        return true;
      }

      // 3. Validate name + desc (non-empty strings)
      const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
      if (!name) {
        sendJson(res, 400, { error: 'name is required and must be non-empty' }, origin);
        return true;
      }
      const desc = typeof b['desc'] === 'string' ? b['desc'].trim() : '';
      if (!desc) {
        sendJson(res, 400, { error: 'desc is required and must be non-empty' }, origin);
        return true;
      }

      // 4. Validate binding (R1-01 KB contract — replaces the old scope enum)
      const bindingRaw = b['binding'];
      if (bindingRaw === null || typeof bindingRaw !== 'object' || Array.isArray(bindingRaw)) {
        sendJson(res, 400, { error: 'binding is required and must be an object' }, origin);
        return true;
      }
      const bindingObj = bindingRaw as Record<string, unknown>;
      const kind = typeof bindingObj['kind'] === 'string' ? bindingObj['kind'] : '';
      if (!(KB_BINDING_KINDS as readonly string[]).includes(kind)) {
        sendJson(res, 400, { error: `binding.kind must be one of: ${KB_BINDING_KINDS.join(', ')}` }, origin);
        return true;
      }
      let binding: KbBinding;
      if (kind === 'unique') {
        binding = { kind: 'unique' };
      } else {
        const ref = typeof bindingObj['ref'] === 'string' ? bindingObj['ref'].trim() : '';
        if (!ref) {
          sendJson(res, 400, { error: `binding.ref is required for binding.kind "${kind}"` }, origin);
          return true;
        }
        if (kind === 'flow') {
          const flowIds = listFlowIds(ctx.forgeRoot);
          if (!flowIds.includes(ref)) {
            sendJson(res, 400, { error: `binding.ref "${ref}" is not a registered flow id` }, origin);
            return true;
          }

          // R1-06: an optional band scope, meaningful only on a flow binding.
          // Reject an unknown band up front, naming the flow's real band
          // vocabulary — mirrors the ref-existence check just above.
          const bandRaw = bindingObj['band'];
          if (bandRaw !== undefined && bandRaw !== null) {
            if (typeof bandRaw !== 'string' || bandRaw.length === 0) {
              sendJson(res, 400, { error: 'binding.band must be a non-empty string when present' }, origin);
              return true;
            }
            const realBands = listFlowBandIds(ctx.forgeRoot, ref);
            if (!realBands.includes(bandRaw)) {
              sendJson(
                res,
                400,
                { error: `binding.band "${bandRaw}" is not one of flow "${ref}"'s real bands: ${realBands.join(', ')}` },
                origin,
              );
              return true;
            }
            binding = { kind: 'flow', ref, band: bandRaw };
          } else {
            binding = { kind: 'flow', ref };
          }
        } else {
          const projectsDir = resolveProjectsDir(ctx.forgeRoot, loadConfig(defaultConfigPath(ctx.forgeRoot)));
          const projectIds = discoverProjects(projectsDir, ctx.forgeRoot).map((p) => p.id);
          if (!projectIds.includes(ref)) {
            sendJson(res, 400, { error: `binding.ref "${ref}" is not a discovered project id` }, origin);
            return true;
          }
          binding = { kind: 'project', ref };
        }
      }

      // 5. Containment: `brain/` is the fixed, forgeRoot-derived root and `id`
      // is its own segment (never folded into the root — see the CONTRACT
      // section of ./studio-path-guard.ts). Replaces a vacuous lexical check.
      const brainBase = resolve(ctx.forgeRoot, 'brain');
      const kbGuard = resolveGuardedPath(brainBase, [id]);
      if (!kbGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected' }, origin);
        return true;
      }
      const kbDir = kbGuard.realPath;

      // 6. Reject if already exists (409). `exists` is lstat-based, so a
      // DANGLING symlink occupying the slot is a 400 from the guard above
      // rather than the EEXIST-500 the old `existsSync` produced — and can
      // never become a create-through-the-link.
      if (kbGuard.exists) {
        sendJson(res, 409, { error: `kb already exists: ${id}` }, origin);
        return true;
      }

      // 7. Scaffold: mkdir brain/<id>/ + brain/<id>/themes/ + brain/<id>/_raw/
      mkdirSync(join(kbDir, 'themes'), { recursive: true });
      mkdirSync(join(kbDir, '_raw'), { recursive: true });

      // 8. Write brain/<id>/kb.yaml via the canonical serializer (leaves
      // `processes` absent — the KB resolves every obligation to its default
      // via resolveKbProcesses until an operator opts into an override).
      const kbYamlPath = join(kbDir, 'kb.yaml');
      writeFileSync(kbYamlPath, serializeKbDescriptor({ id, name, binding, desc, path: kbYamlPath }), 'utf8');

      // 9. Verify loadKbDescriptor can round-trip it
      loadKbDescriptor(kbYamlPath);

      // 10. R1-06-F2: hand off to a project-brain seeding session — mirrors
      // POST /api/project-brain/start's `{ ok: true, sessionId }` contract
      // (cli/ui-bridge.ts:3797-3826) plus its status.json write, so the new,
      // still-empty KB gets a REAL agentic seeding pass through the SAME
      // shell (GET /api/studio/sessions/project-brain/:sessionId) rather
      // than a separate, competing seed path (T1 ruling Q3 removed the old
      // POST .../bootstrap route for exactly this reason). The session
      // carries the created KB's OWN descriptor (kb_id/kb_binding) so a
      // flow/band-scoped KB seeds against its real scope, not a re-derived
      // `{kind:'project'}` guess (T1 ruling Q4).
      //
      // Session-dir anchor: a project binding nests the session under its
      // own (real, discovered) project dir — the established architect/
      // instructions/demo-builder shape, and a real project so it is a
      // legitimate discovered project, not a phantom. Every other binding kind
      // has no natural project home; anchoring it under the bare KB id created a
      // top-level `projects/<kbId>/` dir that `discoverProjects` surfaced as a
      // PHANTOM project (MAJOR 2). It nests under a dot-prefixed anchor instead,
      // which `discoverProjects` filters out while the runner still finds its
      // status there (via the anchored `projectRoot`).
      const projectsRoot = resolveProjectsDir(ctx.forgeRoot, loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const sessionProject = binding.kind === 'project' ? binding.ref : `${KB_SEEDING_ANCHOR_PREFIX}${id}`;
      const sessionId = newProjectBrainSessionId();
      const sessionWritten = guardedWriteSessionStatus<ProjectBrainStatus>(
        projectsRoot,
        [sessionProject, '_project-brain', sessionId],
        {
          session_id: sessionId,
          project: sessionProject,
          project_repo_path: join(projectsRoot, sessionProject),
          phase: 'briefing',
          prompt: '',
          updated_at: new Date().toISOString(),
          kb_id: id,
          kb_binding: binding,
        },
      );
      if (sessionWritten === null) {
        throw new Error(`kb create: hand-off session status.json for "${id}" failed containment`);
      }

      sendJson(res, 200, { ok: true, id, sessionId }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- DELETE /api/studio/kbs/:id (R1-5) — remove a knowledge base --------
  const kbDeleteMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)$/);
  if (kbDeleteMatch && method === 'DELETE') {
    try {
      const id = decodeURIComponent(kbDeleteMatch[1]);
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }
      // Guard the forge-owned core brains (the three-brain model) from deletion.
      if (id === 'cycles' || id === 'forge-dev') {
        sendJson(res, 403, { error: `the forge-owned brain "${id}" cannot be deleted` }, origin);
        return true;
      }
      const dir = resolveKbBrainDir(ctx.forgeRoot, id);
      if (!dir || !existsSync(dir)) {
        sendJson(res, 404, { error: `unknown kb: ${id}` }, origin);
        return true;
      }
      // Containment is enforced at the choke point: `resolveKbBrainDir` now
      // runs the per-segment realpath identity walk, so `dir` is either a
      // verified real directory under `brain/` (or `brain/projects/`) or
      // null. The lexical `resolve(dir).startsWith(brainBase + sep)` check
      // that stood here was vacuous — it compared a path the same function
      // had just built against that path's own prefix — and is removed rather
      // than kept as false assurance.
      rmSync(dir, { recursive: true, force: true });
      sendJson(res, 200, { ok: true, id }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- POST /api/studio/kbs/:id/guidance (M5-3) -------------------------
  const guidanceMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/guidance$/);
  if (guidanceMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(guidanceMatch[1]);

      // 1. Slug-guard kbId before any fs operation (blocks path traversal)
      if (!SLUG_RE.test(kbId)) {
        sendJson(res, 400, { error: 'invalid kb id' }, origin);
        return true;
      }

      // 2. Containment: resolve the kb dir through the guarded choke point.
      // This replaces a vacuous `resolve(brainBase, kbId).startsWith(...)`
      // check AND fixes a second, latent bug it was hiding — that check built
      // `brain/<id>` unconditionally, so guidance for a per-project brain
      // (`brain/projects/<id>`, ADR 035) was written to the wrong directory.
      const kbDir = resolveKbBrainDir(ctx.forgeRoot, kbId);
      if (!kbDir) {
        sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
        return true;
      }

      // 3. Resolve kb (must have a kb.yaml — use loadKbDescriptors to find it)
      const kbs = loadKbDescriptors(ctx.forgeRoot);
      const kb = kbs.find((k) => k.id === kbId);
      if (!kb) {
        sendJson(res, 404, { error: `unknown kb: ${kbId}` }, origin);
        return true;
      }

      // 4. Parse request body
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

      // 5. Validate text (non-empty)
      const text = typeof b['text'] === 'string' ? b['text'].trim() : '';
      if (!text) {
        sendJson(res, 400, { error: 'text is required and must be non-empty' }, origin);
        return true;
      }

      // 5b. Guidance length cap (Fix #2)
      if (Buffer.byteLength(text, 'utf8') > GUIDANCE_MAX_BYTES) {
        sendJson(res, 400, { error: 'guidance text too large' }, origin);
        return true;
      }

      // 6. Validate targetNode if present (SLUG_RE + path guard)
      const targetNodeRaw = b['targetNode'];
      let targetNode: string | undefined;
      if (targetNodeRaw !== undefined && targetNodeRaw !== null && targetNodeRaw !== '') {
        if (typeof targetNodeRaw !== 'string') {
          sendJson(res, 400, { error: 'targetNode must be a string' }, origin);
          return true;
        }
        // Node ids may have 'raw:' prefix — allow alphanumeric, dash, underscore, colon, dot
        const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
        if (!NODE_ID_RE.test(targetNodeRaw)) {
          sendJson(res, 400, { error: 'invalid targetNode — must be a valid node id' }, origin);
          return true;
        }
        targetNode = targetNodeRaw;
      }

      // 7. Resolve `_guidance/` with a real per-segment identity check.
      // THIS IS THE ARBITRARY-FILE-WRITE FIX (bd `forge-wze`): a genuinely
      // real `brain/<id>/` whose `_guidance` is a SYMLINK pointing outside
      // `brain/` was confirmed live writing an attacker-supplied payload to an
      // attacker-chosen location, 200 OK. The two checks removed here compared
      // a string against itself and could never fire.
      const guidanceGuard = guardKbTail(kbDir, '_guidance');
      if (!guidanceGuard.ok) {
        // Fixed, generic message — the guard's own `reason` names which
        // segment failed, which is a fingerprinting aid for an attacker
        // iterating on it, so it is never forwarded to the client.
        sendJson(res, 400, { error: 'path traversal detected in guidance dir' }, origin);
        return true;
      }
      const guidanceDir = guidanceGuard.realPath;

      // 8. Mkdir _guidance/ if absent (create-mode: the guard proved the tail
      // does not exist yet, so it cannot currently be a symlink or hardlink).
      if (!guidanceGuard.exists) {
        mkdirSync(guidanceDir, { recursive: true });
      }

      // 9. Build filename: ISO-timestamp slug (e.g. 2026-06-13T14-30-00-000Z.md)
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${ts}.md`;

      // Re-guard the full tail now that `_guidance/` exists — closes a planted
      // symlink/hardlink AT the leaf, not merely at its parent.
      const fileGuard = guardKbTail(kbDir, '_guidance', filename);
      if (!fileGuard.ok) {
        sendJson(res, 400, { error: 'path traversal detected in guidance file' }, origin);
        return true;
      }
      const filePath = fileGuard.realPath;

      // 10. Write frontmatter + body
      const frontmatterLines = [
        '---',
        `created_at: "${new Date().toISOString()}"`,
        ...(targetNode ? [`target_node: "${targetNode}"`] : []),
        '---',
        '',
        text,
      ];
      writeFileSync(filePath, frontmatterLines.join('\n'), 'utf8');

      sendJson(res, 200, { ok: true, file: `brain/${kbId}/_guidance/${filename}` }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- GET /api/studio/kbs/:id/fix-agent/:runId — agent-fix run state ----
  const fixStatusMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/fix-agent\/([^/]+)$/);
  if (fixStatusMatch && method === 'GET') {
    const runId = decodeURIComponent(fixStatusMatch[2]);
    if (!SAFE_ID_RE.test(runId)) { sendJson(res, 400, { error: 'invalid run id' }, origin); return true; }
    sendJson(res, 200, { ok: true, runId, ...readBrainFixState(ctx.forgeRoot, runId) }, origin);
    return true;
  }

  // ---- POST /api/studio/kbs/:id/maintenance (K3) — manual brain maintenance --
  const maintMatch = url.match(/^\/api\/studio\/kbs\/([^/]+)\/maintenance$/);
  if (maintMatch && method === 'POST') {
    try {
      const kbId = decodeURIComponent(maintMatch[1]);
      if (!SLUG_RE.test(kbId)) { sendJson(res, 400, { error: 'invalid kb id' }, origin); return true; }
      let body: unknown;
      try { body = await readJson(req); } catch { sendJson(res, 400, { error: 'invalid JSON body' }, origin); return true; }
      const op = (body as Record<string, unknown>)?.['op'];

      if (op === 'lint') {
        const { findings } = runBrainLint({ cwd: ctx.forgeRoot, scope: 'full' });
        const scoped = scopeFindingsToKb(ctx.forgeRoot, kbId, findings);
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
        if (abs !== file || !abs.startsWith(resolve(ctx.forgeRoot, 'brain') + sep)) {
          sendJson(res, 400, { error: 'file must be an absolute path under brain/' }, origin); return true;
        }
        const runId = `${kbId}-${Date.now().toString(36)}`;
        try {
          spawnBrainFix(ctx.forgeRoot, { kbId, file: abs, check, kind, fixHint, message, runId });
        } catch (err) {
          sendJson(res, 500, { error: `failed to dispatch agent fix: ${sanitizeError(err)}` }, origin); return true;
        }
        sendJson(res, 200, { op: 'fix-agent', ok: true, runId }, origin);
        return true;
      }
      if (op === 'index') {
        const result = regenerateBrainIndex({ cwd: ctx.forgeRoot });
        sendJson(res, 200, { op: 'index', ok: true, result }, origin);
        return true;
      }
      if (op === 'consolidate') {
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
        // Fire-and-forget: dispatched async like fix-agent, pollable via the
        // existing GET .../fix-agent/:runId route. Queued per-kbId (not run
        // directly) so an overlapping dispatch against the same KB never
        // races its real agent turns against this one on the same files.
        enqueueConsolidate(kbId, () => runBrainConsolidateNow(ctx.forgeRoot, kbId, runId));
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
