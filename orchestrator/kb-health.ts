/**
 * R4-09-F5 — post-cycle KB health dispatcher.
 *
 * On reflect completion, run each TOUCHED KB's declared `processes` (R1-01
 * contract: `ingest` | `consolidate` | `lint`) so a reflect run leaves the KBs
 * it wrote freshly indexed, auto-consolidated, and lint-clean — evidenced per
 * KB in the event log. This is the first real consumer of `resolveKbProcesses`
 * (kb-descriptor.ts): it turns the declared contract into executed behaviour,
 * closing the gap where the descriptor's `processes` block was parsed + linted
 * + UI-surfaced but dispatched NOWHERE.
 *
 * Scope is deliberately narrow to avoid a repo-wide lint-red: the builtins
 * reuse the existing cycle-touched lint + global index regen + deterministic
 * auto-fix (they never newly-error historical themes). A KB that declares a
 * `cmd`-shaped process instead gets the R1-01-F1 invocation contract (KB root,
 * run id, raw-material dir via env). The FINAL authoritative lint status
 * (`lint_status` on the reflector result) is still produced by
 * `runPostReflectionLint`, which runs AFTER this step so it reflects the
 * consolidate fixes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import { runBrainLint, type Finding } from '../cli/brain-lint.ts';
import { applyAutoFixes } from '../cli/brain-fix-auto.ts';
import { regenerateBrainIndex } from '../cli/brain-index.ts';
import { resolveKbBrainDir } from './brain-paths.ts';
import { loadKbDescriptor, resolveKbProcesses } from './studio/kb-descriptor.ts';
import type { KbDescriptor, KbProcessImpl } from './studio/types.ts';
import type { EventLogger } from './logging.ts';

/** Per-KB outcome of one health pass. */
export type KbHealthEntry = {
  kbId: string;
  freshThemes: number;
  ingest: 'done' | 'skipped';
  consolidate: 'done' | 'skipped';
  lint: 'clean' | 'flagged' | 'skipped';
};

export type KbHealthResult = { kbs: KbHealthEntry[] };

export type KbHealthDeps = {
  /** The cycle-touched lint (shared across KBs, run once). */
  runBrainLint?: typeof runBrainLint;
  /** Deterministic auto-tier consolidation. */
  applyAutoFixes?: typeof applyAutoFixes;
  /** Index regeneration (the `reflector-ingest` builtin). */
  regenerateBrainIndex?: (opts: { cwd: string }) => void;
  /** Load a KB descriptor; defaults to the real kb.yaml loader. */
  loadKbDescriptor?: (kbYamlPath: string) => KbDescriptor;
  /** Run a `cmd`-shaped process (R1-01 invocation contract). */
  runCmdProcess?: (cmd: string, ctx: CmdProcessContext) => number;
};

export type CmdProcessContext = {
  /** Absolute KB root (the `brain/<id>` dir). */
  kbRoot: string;
  /** The reflect run's cycle id. */
  runId: string;
  /** The raw-material dir (`brain/cycles/_raw`). */
  rawDir: string;
  forgeRoot: string;
};

const THEME_INDEX_FILES = new Set(['README.md', 'patterns.md', 'antipatterns.md', 'operations.md', 'decisions.md', 'reference.md']);

/** Fresh (`mtime >= sinceMs`) theme files in a KB's `themes/` dir, excluding index pages. */
function countFreshThemes(themesDir: string, sinceMs: number): number {
  if (!existsSync(themesDir)) return 0;
  let n = 0;
  for (const name of readdirSync(themesDir)) {
    if (!name.endsWith('.md') || THEME_INDEX_FILES.has(name)) continue;
    try {
      if (statSync(join(themesDir, name)).mtimeMs >= sinceMs) n += 1;
    } catch {
      /* unreadable entry — not fresh */
    }
  }
  return n;
}

/** Path to a KB's kb.yaml, or null if the KB has no brain dir. */
function kbYamlPathFor(forgeRoot: string, kbId: string): string | null {
  const dir = resolveKbBrainDir(forgeRoot, kbId);
  if (!dir) return null;
  const p = join(dir, 'kb.yaml');
  return existsSync(p) ? p : null;
}

/** Findings whose absolute `file` sits under a KB's brain dir. */
function findingsForKb(findings: Finding[], kbBrainDir: string): Finding[] {
  const prefix = kbBrainDir.endsWith(sep) ? kbBrainDir : kbBrainDir + sep;
  return findings.filter((f) => f.file === kbBrainDir || f.file.startsWith(prefix));
}

/** The default `cmd` process runner: exec with the R1-01-F1 invocation contract. */
function defaultRunCmdProcess(cmd: string, ctx: CmdProcessContext): number {
  const parts = cmd.trim().split(/\s+/);
  const [bin, ...args] = parts;
  try {
    execFileSync(bin, args, {
      cwd: ctx.forgeRoot,
      env: { ...process.env, FORGE_KB_ROOT: ctx.kbRoot, FORGE_RUN_ID: ctx.runId, FORGE_RAW_DIR: ctx.rawDir },
      stdio: 'ignore',
    });
    return 0;
  } catch (err) {
    const code = (err as { status?: number }).status;
    return typeof code === 'number' ? code : 1;
  }
}

/**
 * Run each touched KB's declared health processes. `candidateKbIds` are the KBs
 * a reflect run may have written to (its project KB, the flow/cycles KB, and
 * forge-dev); a KB is processed only if it received a fresh theme this cycle
 * (the cycles KB is always processed — the cycle archive lands there).
 */
export function runPostReflectionKbHealth(opts: {
  forgeRoot: string;
  cycleId: string;
  candidateKbIds: string[];
  sinceMs: number;
  logger: EventLogger;
  initiativeId: string;
  parentEventId?: string;
  deps?: KbHealthDeps;
}): KbHealthResult {
  const { forgeRoot, cycleId, candidateKbIds, sinceMs, logger, initiativeId, parentEventId } = opts;
  const deps = opts.deps ?? {};
  const lintFn = deps.runBrainLint ?? runBrainLint;
  const autoFixFn = deps.applyAutoFixes ?? applyAutoFixes;
  const regenFn = deps.regenerateBrainIndex ?? ((o: { cwd: string }) => { regenerateBrainIndex(o); });
  const loadDescriptor = deps.loadKbDescriptor ?? loadKbDescriptor;
  const runCmd = deps.runCmdProcess ?? defaultRunCmdProcess;
  const rawDir = join(forgeRoot, 'brain', 'cycles', '_raw');

  const emit = (message: string, metadata: Record<string, unknown>, outputRefs: string[] = []): void => {
    logger.emit({
      initiative_id: initiativeId,
      parent_event_id: parentEventId,
      phase: 'reflection',
      skill: 'reflector',
      event_type: 'log',
      input_refs: [],
      output_refs: outputRefs,
      message,
      metadata,
    });
  };

  // Which candidate KBs were actually touched this cycle. 'cycles' is always
  // touched (the reflector archives the cycle log to brain/cycles/_raw), so it
  // is processed regardless of fresh theme count. Others require a fresh theme.
  const touched: Array<{ kbId: string; brainDir: string; fresh: number }> = [];
  for (const kbId of [...new Set(candidateKbIds)]) {
    const brainDir = resolveKbBrainDir(forgeRoot, kbId);
    if (!brainDir) continue;
    const fresh = countFreshThemes(join(brainDir, 'themes'), sinceMs);
    if (fresh > 0 || kbId === 'cycles') touched.push({ kbId, brainDir, fresh });
  }

  if (touched.length === 0) return { kbs: [] };

  // Shared work, computed ONCE and attributed per KB: the index regen (the
  // `reflector-ingest` builtin) and the cycle-touched lint (whose findings feed
  // both the consolidate auto-fix and each KB's lint attribution).
  let indexRegenerated = false;
  const ensureIndexRegen = (): void => {
    if (indexRegenerated) return;
    try {
      regenFn({ cwd: forgeRoot });
      indexRegenerated = true;
      emit('reflector.brain-index-regenerated', {}, [join(forgeRoot, 'brain', 'INDEX.md')]);
    } catch (err) {
      emit('reflector.brain-index-failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  let lintFindings: Finding[] | null = null;
  const ensureLint = (): Finding[] => {
    if (lintFindings) return lintFindings;
    try {
      lintFindings = lintFn({ cwd: forgeRoot, scope: 'cycle-touched-themes', cycle: cycleId, fix: false }).findings;
    } catch {
      lintFindings = [];
    }
    return lintFindings;
  };

  const entries: KbHealthEntry[] = [];
  for (const { kbId, brainDir, fresh } of touched) {
    const yamlPath = kbYamlPathFor(forgeRoot, kbId);
    let procs: ReturnType<typeof resolveKbProcesses> | null = null;
    if (yamlPath) {
      try {
        procs = resolveKbProcesses(loadDescriptor(yamlPath));
      } catch {
        procs = null;
      }
    }
    const cmdCtx: CmdProcessContext = { kbRoot: brainDir, runId: cycleId, rawDir, forgeRoot };

    // --- ingest ---
    let ingest: KbHealthEntry['ingest'] = 'skipped';
    const ingestImpl: KbProcessImpl | undefined = procs?.ingest;
    if (ingestImpl && 'cmd' in ingestImpl) {
      const rc = runCmd(ingestImpl.cmd, cmdCtx);
      ingest = 'done';
      emit('reflect.kb-ingest', { kb: kbId, impl: 'cmd', cmd: ingestImpl.cmd, exit: rc, fresh_themes: fresh });
    } else {
      // builtin `reflector-ingest` (default): make fresh themes discoverable.
      ensureIndexRegen();
      ingest = 'done';
      emit('reflect.kb-ingest', { kb: kbId, impl: 'builtin', builtin: ingestImpl && 'builtin' in ingestImpl ? ingestImpl.builtin : 'reflector-ingest', fresh_themes: fresh });
    }

    // --- consolidate ---
    let consolidate: KbHealthEntry['consolidate'] = 'skipped';
    const consolidateImpl: KbProcessImpl | undefined = procs?.consolidate;
    if (consolidateImpl && 'cmd' in consolidateImpl) {
      const rc = runCmd(consolidateImpl.cmd, cmdCtx);
      consolidate = 'done';
      emit('reflect.kb-consolidate', { kb: kbId, impl: 'cmd', cmd: consolidateImpl.cmd, exit: rc });
    } else {
      // builtin `brain-fix` (default): deterministic auto-tier fixes on this
      // KB's cycle-touched findings (index re-link, dedupe, date/route fixes).
      const kbFindings = findingsForKb(ensureLint(), brainDir);
      const res = autoFixFn(forgeRoot, kbFindings);
      consolidate = 'done';
      emit('reflect.kb-consolidate', {
        kb: kbId,
        impl: 'builtin',
        builtin: consolidateImpl && 'builtin' in consolidateImpl ? consolidateImpl.builtin : 'brain-fix',
        applied: res.applied.length,
        skipped: res.skipped.length,
      });
    }

    // --- lint (per-KB attribution of the shared cycle-touched pass) ---
    // Re-lint after consolidate so the attributed status reflects the fixes.
    let lint: KbHealthEntry['lint'] = 'skipped';
    const lintImpl: KbProcessImpl | undefined = procs?.lint;
    if (lintImpl && 'cmd' in lintImpl) {
      const rc = runCmd(lintImpl.cmd, cmdCtx);
      lint = rc === 0 ? 'clean' : 'flagged';
      emit('reflect.kb-lint', { kb: kbId, impl: 'cmd', cmd: lintImpl.cmd, exit: rc });
    } else {
      lintFindings = null; // force a fresh post-consolidate pass
      const kbFindings = findingsForKb(ensureLint(), brainDir);
      const errors = kbFindings.filter((f) => f.category === 'error').length;
      lint = errors > 0 ? 'flagged' : 'clean';
      emit('reflect.kb-lint', {
        kb: kbId,
        impl: 'builtin',
        builtin: lintImpl && 'builtin' in lintImpl ? lintImpl.builtin : 'forge-brain-lint',
        result: lint,
        error_findings: errors,
      });
    }

    emit('reflect.kb-health', { kb: kbId, fresh_themes: fresh, ingest, consolidate, lint });
    entries.push({ kbId, freshThemes: fresh, ingest, consolidate, lint });
  }

  return { kbs: entries };
}
