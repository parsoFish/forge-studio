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
 * The builtin `lint` runs `lintThemeFiles` over exactly the theme FILES the
 * reflect run just wrote in that KB — a REAL, project-aware structural check
 * (frontmatter/category/links/index) scoped to fresh files, so it never touches
 * historical themes (no repo-wide lint-red) yet genuinely validates a project
 * KB's own writes (the shared `cycle-touched-themes` scan never walks
 * brain/projects/*). A KB that declares a `cmd`-shaped process instead gets the
 * R1-01-F1 invocation contract (KB root, run id, raw-material dir via env). The
 * authoritative aggregate `lint_status` on the reflector result is still
 * produced by `runPostReflectionLint`, which runs AFTER this step so it
 * reflects the consolidate fixes.
 *
 * Every process is fail-loud, never fail-open: a non-zero cmd exit or a thrown
 * builtin surfaces as a `'failed'` status at `event_type: 'error'` (a declared
 * process that promises a guard must not silently report success), and one KB's
 * failure never aborts the others or the rest of the reflector pipeline.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { lintThemeFiles, classify, type Finding } from './brain-lint.ts';
import { applyAutoFixes } from './brain-fix-auto.ts';
import { regenerateBrainIndex } from './brain-index.ts';
import { tryGetKbBackend, type KbBackend } from './kb-backend.ts';
import { loadKbDescriptor, resolveKbProcesses } from './studio/kb-descriptor.ts';
import type { KbDescriptor, KbProcessImpl } from '@forge/contracts/studio/types.ts';
import type { EventLogger } from '@forge/kernel';

type StepStatus = 'done' | 'skipped' | 'failed';
type LintStatus = 'clean' | 'flagged' | 'skipped' | 'failed';

/** Per-KB outcome of one health pass. */
export type KbHealthEntry = {
  kbId: string;
  freshThemes: number;
  ingest: StepStatus;
  consolidate: StepStatus;
  lint: LintStatus;
};

export type KbHealthResult = { kbs: KbHealthEntry[] };

export type KbHealthDeps = {
  /** Structural lint of an explicit theme-file list (defaults to the real one). */
  lintThemeFiles?: typeof lintThemeFiles;
  /** Deterministic auto-tier consolidation. */
  applyAutoFixes?: typeof applyAutoFixes;
  /** Index regeneration (the `reflector-ingest` builtin). */
  regenerateBrainIndex?: (opts: { cwd: string }) => void;
  /** Load a KB descriptor; defaults to the real kb.yaml loader. */
  loadKbDescriptor?: (kbYamlPath: string) => KbDescriptor;
  /** Run a `cmd`-shaped process (R1-01 invocation contract). */
  runCmdProcess?: (cmd: string, ctx: CmdProcessContext) => number;
  /**
   * H8 — resolve a kbId to its `KbBackend`, the seam every per-KB read in this
   * module goes through (SPEC.md §4). Injected rather than imported-and-called
   * so this module never performs the brain-dir resolution itself; `null` means
   * "no such KB", the same answer the direct resolution used to give.
   */
  resolveBackend?: (forgeRoot: string, kbId: string) => KbBackend | null;
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

// The fresh-theme enumeration and the descriptor lookup that used to live here
// are `KbBackend.freshThemeFiles` / `KbBackend.descriptorPath` (H8): both are
// per-KB reads, and this module reaches a KB's store only through the seam.

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
  const lintFn = deps.lintThemeFiles ?? lintThemeFiles;
  const autoFixFn = deps.applyAutoFixes ?? applyAutoFixes;
  const regenFn = deps.regenerateBrainIndex ?? ((o: { cwd: string }) => { regenerateBrainIndex(o); });
  const loadDescriptor = deps.loadKbDescriptor ?? loadKbDescriptor;
  const runCmd = deps.runCmdProcess ?? defaultRunCmdProcess;
  const resolveBackend = deps.resolveBackend ?? tryGetKbBackend;
  const rawDir = join(forgeRoot, 'brain', 'cycles', '_raw');

  const emit = (message: string, eventType: 'log' | 'error', metadata: Record<string, unknown>, outputRefs: string[] = []): void => {
    logger.emit({
      initiative_id: initiativeId,
      parent_event_id: parentEventId,
      phase: 'reflection',
      skill: 'reflector',
      event_type: eventType,
      input_refs: [],
      output_refs: outputRefs,
      message,
      metadata,
    });
  };

  // Which candidate KBs were actually touched this cycle. 'cycles' is always
  // touched (the reflector archives the cycle log to brain/cycles/_raw), so it
  // is processed regardless of fresh theme count. Others require a fresh theme.
  const touched: Array<{ kbId: string; backend: KbBackend; freshFiles: string[] }> = [];
  for (const kbId of [...new Set(candidateKbIds)]) {
    const backend = resolveBackend(forgeRoot, kbId);
    if (!backend) continue;
    const freshFiles = backend.freshThemeFiles(sinceMs);
    if (freshFiles.length > 0 || kbId === 'cycles') touched.push({ kbId, backend, freshFiles });
  }

  if (touched.length === 0) return { kbs: [] };

  // The index regen (the `reflector-ingest` builtin) is repo-wide; compute it
  // ONCE and share across KBs.
  let indexRegenerated = false;
  const ensureIndexRegen = (): void => {
    if (indexRegenerated) return;
    try {
      regenFn({ cwd: forgeRoot });
      indexRegenerated = true;
      emit('reflector.brain-index-regenerated', 'log', {}, [join(forgeRoot, 'brain', 'INDEX.md')]);
    } catch (err) {
      emit('reflector.brain-index-failed', 'error', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const entries: KbHealthEntry[] = [];
  for (const { kbId, backend, freshFiles } of touched) {
    const yamlPath = backend.descriptorPath();
    let procs: ReturnType<typeof resolveKbProcesses> | null = null;
    if (yamlPath) {
      try {
        procs = resolveKbProcesses(loadDescriptor(yamlPath));
      } catch {
        procs = null;
      }
    }
    // `kbRoot` is only ever read by `runCmd`, and a `cmd`-shaped process can only
    // be declared IN the descriptor — so when there is no descriptor there is no
    // cmd process and no root to hand out. Deriving it from the descriptor's own
    // location keeps the store's root from leaking out of the seam as a method.
    const cmdCtx: CmdProcessContext = { kbRoot: yamlPath ? dirname(yamlPath) : '', runId: cycleId, rawDir, forgeRoot };
    const builtinName = (impl: KbProcessImpl | undefined, dflt: string): string => (impl && 'builtin' in impl ? impl.builtin : dflt);

    // --- ingest ---
    let ingest: StepStatus = 'skipped';
    const ingestImpl = procs?.ingest;
    if (ingestImpl && 'cmd' in ingestImpl) {
      const rc = runCmd(ingestImpl.cmd, cmdCtx);
      ingest = rc === 0 ? 'done' : 'failed';
      emit('reflect.kb-ingest', ingest === 'failed' ? 'error' : 'log', { kb: kbId, impl: 'cmd', cmd: ingestImpl.cmd, exit: rc, fresh_themes: freshFiles.length });
    } else {
      try {
        ensureIndexRegen();
        ingest = indexRegenerated ? 'done' : 'failed';
      } catch (err) {
        ingest = 'failed';
        emit('reflect.kb-ingest', 'error', { kb: kbId, impl: 'builtin', builtin: builtinName(ingestImpl, 'reflector-ingest'), error: err instanceof Error ? err.message : String(err) });
      }
      if (ingest !== 'failed') {
        emit('reflect.kb-ingest', 'log', { kb: kbId, impl: 'builtin', builtin: builtinName(ingestImpl, 'reflector-ingest'), fresh_themes: freshFiles.length });
      }
    }

    // --- lint (real, per-fresh-file structural check) + consolidate ---
    // Compute the KB's fresh-file findings once, auto-fix (consolidate), then
    // re-lint so the reported status reflects the fixes.
    let consolidate: StepStatus = 'skipped';
    let lint: LintStatus = 'skipped';
    const consolidateImpl = procs?.consolidate;
    const lintImpl = procs?.lint;
    const cmdConsolidate = consolidateImpl && 'cmd' in consolidateImpl;
    const cmdLint = lintImpl && 'cmd' in lintImpl;

    // Builtin lint/consolidate share the structural findings; a cmd override
    // for either replaces just that step.
    let kbFindings: Finding[] | null = null;
    const computeFindings = (): Finding[] => lintFn(forgeRoot, freshFiles).map(classify);

    // consolidate
    if (cmdConsolidate) {
      const rc = runCmd((consolidateImpl as { cmd: string }).cmd, cmdCtx);
      consolidate = rc === 0 ? 'done' : 'failed';
      emit('reflect.kb-consolidate', consolidate === 'failed' ? 'error' : 'log', { kb: kbId, impl: 'cmd', cmd: (consolidateImpl as { cmd: string }).cmd, exit: rc });
    } else {
      try {
        kbFindings = computeFindings();
        const res = autoFixFn(forgeRoot, kbFindings);
        consolidate = 'done';
        emit('reflect.kb-consolidate', 'log', { kb: kbId, impl: 'builtin', builtin: builtinName(consolidateImpl, 'brain-fix'), applied: res.applied.length, skipped: res.skipped.length });
      } catch (err) {
        consolidate = 'failed';
        emit('reflect.kb-consolidate', 'error', { kb: kbId, impl: 'builtin', builtin: builtinName(consolidateImpl, 'brain-fix'), error: err instanceof Error ? err.message : String(err) });
      }
    }

    // lint (final status, post-consolidate)
    if (cmdLint) {
      const rc = runCmd((lintImpl as { cmd: string }).cmd, cmdCtx);
      lint = rc === 0 ? 'clean' : 'flagged';
      emit('reflect.kb-lint', lint === 'flagged' ? 'error' : 'log', { kb: kbId, impl: 'cmd', cmd: (lintImpl as { cmd: string }).cmd, exit: rc });
    } else {
      try {
        const post = computeFindings();
        const errors = post.filter((f) => f.category === 'error').length;
        lint = errors > 0 ? 'flagged' : 'clean';
        emit('reflect.kb-lint', lint === 'flagged' ? 'error' : 'log', { kb: kbId, impl: 'builtin', builtin: builtinName(lintImpl, 'forge-brain-lint'), result: lint, error_findings: errors, fresh_themes: freshFiles.length });
      } catch (err) {
        lint = 'failed';
        emit('reflect.kb-lint', 'error', { kb: kbId, impl: 'builtin', builtin: builtinName(lintImpl, 'forge-brain-lint'), error: err instanceof Error ? err.message : String(err) });
      }
    }

    emit('reflect.kb-health', lint === 'failed' || ingest === 'failed' || consolidate === 'failed' ? 'error' : 'log', { kb: kbId, fresh_themes: freshFiles.length, ingest, consolidate, lint });
    entries.push({ kbId, freshThemes: freshFiles.length, ingest, consolidate, lint });
  }

  return { kbs: entries };
}
