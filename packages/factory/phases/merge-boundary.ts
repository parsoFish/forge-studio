/**
 * The merge boundary for one CHANGE CLASS (spec §5 item 1, columns
 * `mergeBoundaryTest` and `mergeBoundaryVerb`).
 *
 * Two things decide what happens at the boundary, and both are the class's:
 * WHICH of the project's declared `testProcess.*` gates run, and WHETHER an
 * orchestrator VERB runs in addition. `@forge/flows` owns the test gate and may
 * not import this package, so the class's selection is passed DOWN to it as a
 * value; the verb, whose implementation lives here, is run here.
 *
 * A boundary is never empty. `docs` selects no `testProcess.*` — there is no
 * suite to run over markdown — and is checked by `forge gate docs` instead; the
 * class table's contract test refuses a class that selects neither.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import type { MergeGateResult } from '@forge/flows/cycle-helpers.ts';
import type { CycleInput } from '@forge/flows/cycle-context.ts';
import type { EventLogger } from '@forge/kernel';
import type { GateProfile } from '../class-profiles.ts';
import { guardedFile } from '@forge/kernel';

import type { DocsGateFinding } from '../gates/docs-gate.ts';

export type MergeBoundaryDeps = {
  runTestGate: (
    input: CycleInput,
    logger: EventLogger,
    selection: { gates: ReadonlyArray<'ci' | 'local'>; hasVerb: boolean },
  ) => MergeGateResult;
  /** Markdown paths in this branch's diff, ABSOLUTE and already proven inside the worktree. */
  changedMarkdown: (worktreePath: string) => readonly string[];
  docsGate: (paths: readonly string[]) => DocsGateFinding[];
};

/**
 * Run the class's merge boundary: its selected test gates first, then its verb.
 * The verb runs only on a green test gate — a red suite is the more actionable
 * failure and running both would report two causes for one boundary.
 */
export function runClassMergeBoundary(
  profile: GateProfile,
  input: CycleInput,
  logger: EventLogger,
  deps: MergeBoundaryDeps,
): MergeGateResult {
  const gate = deps.runTestGate(input, logger, {
    gates: profile.mergeBoundaryTest,
    hasVerb: profile.mergeBoundaryVerb !== null,
  });
  if (!gate.ok || profile.mergeBoundaryVerb === null) return gate;

  const paths = deps.changedMarkdown(input.worktreePath);
  const cmd = ['forge', 'gate', 'docs', ...paths];
  const emit = (ok: boolean, detail: string): void => {
    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: ok ? 'log' : 'error',
      input_refs: [join(input.worktreePath)],
      output_refs: [],
      message: 'cycle.merge-gate',
      metadata: { gate: 'docs', ok, verb: profile.mergeBoundaryVerb, files: paths.length, detail },
    });
  };

  if (paths.length === 0) {
    // A class whose whole boundary is a docs gate, over a diff with no
    // markdown in it, has checked nothing — and an empty check reads exactly
    // like a green one. Red, and the reason says which.
    const detail = 'the change class selects `gate docs` as its only merge boundary, and this branch changes no markdown — the boundary would check nothing';
    emit(false, detail);
    return { ok: false, failedGate: 'docs', cmd, output: detail };
  }

  const findings = deps.docsGate(paths);
  if (findings.length > 0) {
    const output = findings.map((f) => `${f.path}:${f.line} [${f.check}] ${f.detail}`).join('\n');
    emit(false, `${findings.length} finding(s)`);
    return { ok: false, failedGate: 'docs', cmd, output };
  }
  emit(true, `${paths.length} file(s) clean`);
  return { ok: true, evidence: [...gate.evidence, { gate: 'docs', cmd, ok: true, outputTail: `${paths.length} markdown file(s) clean` }] };
}

/**
 * Markdown paths in this branch's diff vs `main`, worktree-relative. A git
 * failure yields NO paths, which the caller treats as a red boundary rather
 * than a clean one — an unreadable diff must never read as "nothing to check".
 */
export function changedMarkdownFiles(worktreePath: string): readonly string[] {
  let out: string;
  try {
    out = execFileSync('git', ['diff', '--name-only', 'main...HEAD'], { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' });
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const line of out.split('\n')) {
    const rel = line.trim();
    if (rel === '' || !rel.endsWith('.md')) continue;
    // CONTAINMENT (the gate reads every path it is handed). `worktreePath` is
    // request-derived, and git's output is a producer this function does not
    // own — so each path is resolved against the worktree as a FIXED root with
    // every segment its own element, and a path that will not resolve inside it
    // is dropped rather than read. `docs-gate.ts`'s own `existsSync`/
    // `readFileSync` are therefore only ever handed an already-contained
    // absolute path (docs/reference/request-path-sinks.md classifies them).
    const abs = guardedFile(worktreePath, rel.split('/'), 'read');
    if (abs !== null) paths.push(abs);
  }
  return paths;
}
