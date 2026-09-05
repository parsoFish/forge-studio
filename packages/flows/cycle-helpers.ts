/**
 * cycle-helpers.ts — Dev-loop close + delivery gate helpers.
 *
 * These six functions were extracted from cycle.ts to break an inside-out
 * dependency: flow-runner.ts needs them, but cycle.ts also imports runFlow
 * from flow-runner.ts. By moving the helpers here neither cycle.ts nor
 * flow-runner.ts owns them — each can import from this neutral module.
 *
 * Shared decision-core functions (decideFinalCiGate, execCommandVector, and
 * their supporting types) remain in cycle.ts because they are also directly
 * tested via cycle.ts's public surface. cycle-helpers.ts imports them back.
 * All cross-module references are inside function bodies — no module-eval-time
 * circular use.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { gitIdentityConfigArgs, ORCHESTRATOR_GIT_IDENTITY } from '@forge/kernel';
import type { EventLogger } from '@forge/kernel';
import type { CycleInput } from './cycle-context.ts';
import { DEMO_MD_BASENAME, worktreeDemoMdPath, worktreeDemoRelDir } from './demo-paths.ts';
import { assertLocalRemoteSynced, openPullRequest, pushInitiativeBranch } from './pr.ts';
import { loadProjectConfig } from '@forge/projects/project-config.ts';
import { decideFinalCiGate, execCommandVector } from './ci-gate.ts';
import { resolveGateTimeoutMs } from '@forge/agents/ralph/stop-conditions.ts';

// ---------------------------------------------------------------------------
// openPrInline
// ---------------------------------------------------------------------------

/**
 * REV-6: inline PR-opening (previously `runReviewer`). Opens the PR from the
 * unifier-authored `.forge/pr-description.md`, emitting every event the old
 * `runReviewer` emitted (verbatim phase/skill/message values) so the forge-ui
 * phase hexes and e2e harness remain unaffected.
 *
 * Returns `ReviewerOutcome` — always `'pr-open'` on success, or throws with a
 * structured `unifier.prerequisite-missing` event on failure (matching the
 * former reviewer.ts behaviour exactly).
 */
export async function openPrInline(
  input: CycleInput,
  logger: EventLogger,
): Promise<import('./cycle-context.ts').ReviewerOutcome> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'review-loop',
    skill: 'review-router',
    event_type: 'start',
    input_refs: [input.worktreePath, input.manifestPath],
    output_refs: [],
  });

  const prDescriptionPath = resolve(input.worktreePath, '.forge', 'pr-description.md');
  const prTitle = `forge: ${input.initiativeId}`;
  const prUrl = openPullRequest(input.worktreePath, prDescriptionPath, prTitle);

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'review-loop',
    skill: 'review-router',
    event_type: prUrl ? 'log' : 'error',
    input_refs: [prDescriptionPath],
    output_refs: prUrl ? [prUrl] : [],
    message: prUrl ? 'reviewer.pr-opened' : 'reviewer.pr-open-failed',
    metadata: { url: prUrl, pr_created: prUrl !== null },
  });

  if (!prUrl) {
    // Resolved through the demo-path SSOT (plan 2.5 / N3): the diagnostic must
    // name the path the unifier actually authors (artifactRoot-resolved), or a
    // clean delivery on an artifactRoot project reads as "demo missing" at a
    // location nothing writes to (the 2026-07-05 false-negative theme).
    const demoMdPath = worktreeDemoMdPath(input.worktreePath, input.initiativeId);
    const demoMdRel = `${worktreeDemoRelDir(input.worktreePath, input.initiativeId)}/${DEMO_MD_BASENAME}`;
    const prDescPath = resolve(input.worktreePath, '.forge', 'pr-description.md');
    const missing: string[] = [];
    if (!existsSync(demoMdPath)) missing.push(demoMdRel);
    if (!existsSync(prDescPath)) missing.push('.forge/pr-description.md');
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'review-loop',
      skill: 'review-router',
      event_type: 'error',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: 'unifier.prerequisite-missing',
      metadata: { missing, demo_md_path: demoMdPath, pr_description_path: prDescPath },
    });
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'review-loop',
      skill: 'review-router',
      event_type: 'end',
      input_refs: [input.worktreePath],
      output_refs: [input.worktreePath],
      metadata: { outcome: 'failed', pr_url: null, missing_prerequisites: missing },
    });
    throw new Error(
      `reviewer.pr-open-failed: unifier did not author a PR — missing prerequisites: ${missing.join(', ')}. ` +
        `Dev-loop work items must produce their declared \`creates:\` paths before the unifier can build a demo bundle.`,
    );
  }

  const outcome: import('./cycle-context.ts').ReviewerOutcome = 'pr-open';
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'review-loop',
    skill: 'review-router',
    event_type: 'end',
    input_refs: [input.worktreePath],
    output_refs: [prUrl],
    metadata: { outcome, pr_url: prUrl },
  });

  return outcome;
}

// ---------------------------------------------------------------------------
// preservingForgeScratch
// ---------------------------------------------------------------------------

/**
 * ADR 019/026: run `fn` (the resume rebase) with the named worktree-relative
 * `.forge/` scratch dirs preserved. A `git rebase` replay clobbers gitignored
 * untracked files, so these dirs (the dev WI specs + the unifier queue) are
 * backed up outside the worktree first and restored afterward IF the rebase
 * emptied them. Dirs absent before the rebase are skipped. Best-effort restore
 * — a missing backup never fails the cycle.
 */
export function preservingForgeScratch<T>(worktreePath: string, relDirs: string[], fn: () => T): T {
  const backups = relDirs.map((rel) => {
    const dir = resolve(worktreePath, rel);
    const bak = `${worktreePath}.${rel.replace(/[\\/]/g, '-')}-resume-bak`;
    const present = existsSync(dir);
    if (present) {
      rmSync(bak, { recursive: true, force: true });
      cpSync(dir, bak, { recursive: true });
    }
    return { dir, bak, present };
  });
  try {
    return fn();
  } finally {
    for (const b of backups) {
      if (!b.present) continue;
      if (!existsSync(b.dir) || readdirSync(b.dir).length === 0) {
        mkdirSync(b.dir, { recursive: true });
        cpSync(b.bak, b.dir, { recursive: true });
      }
      rmSync(b.bak, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// assertNonEmptyDelivery
// ---------------------------------------------------------------------------

/**
 * DEV-1: empty-branch delivery guard. Throws with a `zero-delivery`
 * classification and emits a `delivery-gate.empty-branch` error event when
 * the branch has 0 commits ahead of base AND 0 insertions — nothing to
 * review. Exported for direct unit testing (no SDK, no git).
 */
export function assertNonEmptyDelivery(
  outcome: { commitsAhead: number; filesChanged: number; insertions: number },
  initiativeId: string,
  worktreePath: string,
  logger: EventLogger,
): void {
  if (outcome.commitsAhead === 0 && outcome.insertions === 0) {
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'error',
      input_refs: [worktreePath],
      output_refs: [],
      message: 'delivery-gate.empty-branch',
      metadata: {
        failure_class: 'zero-delivery',
        commits_ahead: outcome.commitsAhead,
        files_changed: outcome.filesChanged,
        insertions: outcome.insertions,
        note: 'branch has no commits ahead of base and no insertions — no PR opened',
      },
    });
    throw new Error(
      `delivery gate: branch has 0 commits ahead of base and 0 insertions — ` +
        `nothing to review (zero-delivery). Triage why the dev-loop produced no commits.`,
    );
  }
}

// ---------------------------------------------------------------------------
// commitDevLoopBoundary
// ---------------------------------------------------------------------------

/**
 * Boundary commit between dev-loop and reviewer phases. Catches any
 * uncommitted work from the dev-loop (the agent's per-iteration commit is
 * prompt-only, not enforced; this is the safety net). Best-effort —
 * `--allow-empty` so a no-op cycle doesn't error, and `|| true`-style
 * try/catch so non-git worktrees (e.g. early dry-runs) don't fail the cycle.
 */
export function commitDevLoopBoundary(
  worktreePath: string,
  logger: EventLogger,
  initiativeId: string,
): void {
  try {
    execFileSync('git', ['add', '-A'], { cwd: worktreePath, stdio: 'pipe' });
    // Second guard (linkProjectDeps writes the primary one to the worktree's
    // git exclude): never let the forge-created `node_modules` symlink into
    // the boundary commit. A project .gitignore of `node_modules/` does not
    // match a symlink named `node_modules`; `--ignore-unmatch` keeps this a
    // no-op when it isn't staged.
    try {
      execFileSync('git', ['reset', '-q', '--', 'node_modules'], {
        cwd: worktreePath,
        stdio: 'pipe',
      });
    } catch {
      /* best-effort — not staged / nothing to unstage */
    }
    execFileSync(
      'git',
      [
        ...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY),
        'commit',
        '--allow-empty',
        '-m',
        'chore(developer-loop): pre-review boundary snapshot',
      ],
      { cwd: worktreePath, stdio: 'pipe' },
    );
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'log',
      input_refs: [worktreePath],
      output_refs: [],
      message: 'cycle.dev-boundary-commit',
    });
  } catch {
    // Not a git repo, or no changes to commit, or git failed — non-fatal.
  }
}

// ---------------------------------------------------------------------------
// enforceDevLoopCloseInvariant
// ---------------------------------------------------------------------------

/**
 * G8: enforce the local↔remote invariant at dev-loop close. Pushes once
 * more (the boundary commit may have added a commit on top of the
 * dev-loop's last per-WI push), then asserts:
 *   - `origin/<branch>` == local HEAD  (branch fully published)
 *   - origin/<branch> == local HEAD (the branch is fully published; base drift vs main is GitHub's to arbitrate)
 *
 * On violation this THROWS — a diverged / unpublished branch is not a
 * reviewable state, and the failure-classifier surfaces it. The branch
 * sync is the precondition the review-phase redesign depends on
 * (architecture.md §G / brain theme `review-phase-target-design`).
 */
export function enforceDevLoopCloseInvariant(
  worktreePath: string,
  logger: EventLogger,
  initiativeId: string,
): void {
  const push = pushInitiativeBranch(worktreePath);
  logger.emit({
    initiative_id: initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: push.pushed ? 'log' : 'error',
    input_refs: [worktreePath],
    output_refs: [],
    message: push.pushed ? 'cycle.dev-close-pushed' : 'cycle.dev-close-push-failed',
    metadata: push.pushed ? { branch: push.branch } : { reason: push.reason },
  });
  const inv = assertLocalRemoteSynced(worktreePath);
  logger.emit({
    initiative_id: initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'log',
    input_refs: [worktreePath],
    output_refs: [],
    message: 'cycle.dev-close-invariant-ok',
    metadata: {
      branch: inv.branch,
      local_head: inv.localHead,
      origin_head: inv.originHead,
      main_head: inv.mainHead,
      merge_base: inv.mergeBase,
    },
  });
}

// ---------------------------------------------------------------------------
// enforceFinalCiGate (+ private helper commitAndPushCiFix)
// ---------------------------------------------------------------------------

/**
 * Commit + push any working-tree changes the CI auto-formatter produced.
 * Guarded by `git status --porcelain` so a no-op fixer adds no empty commit.
 * Best-effort push — a push failure is logged but does not throw (the gate
 * already passed against the local tree; the PR open will surface a real sync
 * problem via the existing invariants).
 */
function commitAndPushCiFix(
  worktreePath: string,
  logger: EventLogger,
  initiativeId: string,
): void {
  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).toString().trim();
    if (dirty.length === 0) return;

    execFileSync('git', ['add', '-A'], { cwd: worktreePath, stdio: 'pipe' });
    try {
      execFileSync('git', ['reset', '-q', '--', 'node_modules'], { cwd: worktreePath, stdio: 'pipe' });
    } catch {
      /* best-effort — not staged */
    }
    execFileSync(
      'git',
      [...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY), 'commit', '-m', 'style: apply ci_fix_cmd (auto-format)'],
      { cwd: worktreePath, stdio: 'pipe' },
    );
    let pushed = true;
    let pushReason: string | null = null;
    try {
      execFileSync('git', ['push'], { cwd: worktreePath, stdio: 'pipe' });
    } catch (err) {
      pushed = false;
      pushReason = err instanceof Error ? err.message : String(err);
    }
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: pushed ? 'log' : 'error',
      input_refs: [worktreePath],
      output_refs: [],
      message: pushed ? 'cycle.ci-fix-committed' : 'cycle.ci-fix-push-failed',
      metadata: pushed ? undefined : { reason: pushReason },
    });
  } catch {
    // Not a git repo / nothing to commit / git failed — non-fatal: the gate
    // ran against the local tree regardless.
  }
}

/**
 * Final CI delivery gate (orchestrator wiring around `decideFinalCiGate`).
 * Reads the project's `ci_gate` + `ci_fix_cmd` from `.forge/project.json`;
 * when a `ci_gate` is configured (and not a dry run), applies the formatters,
 * commits+pushes any resulting fmt changes so the PR is fmt-clean, then runs
 * the full CI gate. A red gate emits a classified `cycle.ci-gate` event and
 * throws `ci-gate-failed` so the cycle routes to triage rather than opening a
 * CI-red PR. Best-effort config read — a missing/unreadable project.json
 * simply skips the gate (the dev-loop's scoped gates still ran).
 */
export function enforceFinalCiGate(input: CycleInput, logger: EventLogger): void {
  if (input.dryRun) return;

  let ciGate: string[] | null = null;
  let ciFixCmd: string[] | null = null;
  let ciGateUnsetEnv: string[] = [];
  let ciDeclaredTimeoutMs: number | undefined;
  try {
    const cfg = loadProjectConfig(input.projectRepoPath);
    ciGate = cfg?.ci_gate && cfg.ci_gate.length > 0 ? cfg.ci_gate : null;
    ciFixCmd = cfg?.ci_fix_cmd && cfg.ci_fix_cmd.length > 0 ? cfg.ci_fix_cmd : null;
    ciGateUnsetEnv = cfg?.ci_gate_unset_env && cfg.ci_gate_unset_env.length > 0 ? cfg.ci_gate_unset_env : [];
    ciDeclaredTimeoutMs = cfg?.testProcess.ci?.timeoutMs;
  } catch (err) {
    // A malformed project.json is fail-closed elsewhere (dev-loop loads it);
    // here we log-and-skip rather than mask a real config error at PR-open.
    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: 'log',
      input_refs: [input.projectRepoPath],
      output_refs: [],
      message: 'cycle.ci-gate-skipped',
      metadata: { reason: err instanceof Error ? err.message : String(err) },
    });
    return;
  }

  if (!ciGate) return;

  const decision = decideFinalCiGate({
    ciGate,
    ciFixCmd,
    worktreePath: input.worktreePath,
    // R1-03-F1: bind the declared testProcess.ci.timeoutMs into the runner
    // (env override still wins inside resolveCiTimeoutMs).
    run: (cmd, wt, kind, unsetEnv) => execCommandVector(cmd, wt, kind, unsetEnv, ciDeclaredTimeoutMs),
    unsetEnv: ciGateUnsetEnv,
  });
  // decision is non-null because ciGate is non-empty.
  if (!decision) return;

  // Commit + push any formatting changes the fixer produced so the PR is
  // fmt-clean. Guard on a dirty tree so a no-op fixer adds no empty commit.
  if (decision.ranFixer) {
    commitAndPushCiFix(input.worktreePath, logger, input.initiativeId);
  }

  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: decision.gateOk ? 'log' : 'error',
    input_refs: [input.worktreePath],
    output_refs: [],
    message: 'cycle.ci-gate',
    metadata: {
      ok: decision.gateOk,
      ran_fixer: decision.ranFixer,
      ci_gate: ciGate,
      ...(ciGateUnsetEnv.length > 0 ? { ci_gate_unset_env: ciGateUnsetEnv } : {}),
      output_tail: decision.gateOutput.slice(-1200),
    },
  });

  if (!decision.gateOk) {
    throw new Error(
      `ci-gate-failed: the project ci_gate is red — not opening a PR (triage before re-running).\n` +
        decision.gateOutput.slice(-1200),
    );
  }
}

// ---------------------------------------------------------------------------
// runMergeBoundaryGate (R4-10-F2 — the relocated dual-boundary full-suite gate)
// ---------------------------------------------------------------------------

/**
 * `.forge/last-gate-failure.md` — the results-flow seam (ADR-036 §2, present ⇒
 * fresh). Mirrors `developer-loop.ts`'s `lastGateFailurePath` (the dev-loop /
 * retired-unifier writers of the SAME file); a fix agent reads whichever writer
 * last wrote it, so the merge-boundary gate uses the identical path + a
 * compatible "AUTHORITATIVE … FRESH … fix exactly what is below" body.
 */
const LAST_GATE_FAILURE_REL = ['.forge', 'last-gate-failure.md'] as const;

function mergeGateFeedbackPath(worktreePath: string): string {
  return join(worktreePath, ...LAST_GATE_FAILURE_REL);
}

/** Write the merge-boundary gate's failure to `.forge/last-gate-failure.md`. */
function writeMergeGateFeedback(worktreePath: string, which: 'local' | 'ci', cmd: string[], output: string): void {
  const body = [
    `# Live quality-gate failure — AUTHORITATIVE (forge merge-boundary full-suite gate: ${which})`,
    '',
    "This is the result of the orchestrator's OWN gate run at the develop flow's merge",
    'boundary — the full-suite gate that decides whether the PR can open (R4-10-F2). It runs',
    'the WHOLE suite on the integrated branch tip, so it catches a cross-WI regression the',
    'scoped per-WI gates structurally cannot see. Forge deletes this file on every passing',
    'gate run and at session start, so if you are reading it, it is FRESH. Fix exactly what',
    'is below; the initiative is NOT review-ready until the full suite is green.',
    '',
    `## Failing gate (${which})`,
    '',
    '```',
    `$ ${cmd.join(' ')}`,
    output.slice(-4000).trimEnd(),
    '```',
    '',
  ].join('\n');
  const dir = join(worktreePath, '.forge');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(mergeGateFeedbackPath(worktreePath), body);
}

/** Delete the feedback file on a passing gate (present ⇒ fresh). Best-effort. */
function clearMergeGateFeedback(worktreePath: string): void {
  try {
    const p = mergeGateFeedbackPath(worktreePath);
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best-effort */
  }
}

/**
 * One gate this function actually ran, and what it produced.
 *
 * The gate used to report only a boolean, which meant the demo bundle
 * downstream had no way to state WHICH suite proved the branch — so an agent
 * wrote a sentence about it instead. The evidence rows are what a derived
 * DEMO.md and PR body are built from (spec §5 item 4), and they are emitted by
 * the code that ran the command rather than described by anything downstream.
 */
export type MergeGateEvidence = {
  /** `docs` is the class VERB's row (`forge gate docs`), not a `testProcess.*`. */
  gate: 'local' | 'ci' | 'docs';
  cmd: readonly string[];
  ok: boolean;
  outputTail?: string;
};

export type MergeGateResult =
  | { ok: true; evidence: MergeGateEvidence[] }
  | { ok: false; failedGate: 'local' | 'ci' | 'docs'; cmd: string[]; output: string }
  | { ok: false; failedGate: 'config'; reason: string };

/**
 * Run the LOCAL full-suite gate with LOCAL-gate timeout semantics
 * (`resolveGateTimeoutMs`: `FORGE_GATE_TIMEOUT_MS` env → `testProcess.local.timeoutMs`
 * → 30-min default) — NOT `execCommandVector`'s CI semantics (`FORGE_CI_GATE_TIMEOUT_MS`
 * → 20-min), which would false-red a slow suite the operator already gave
 * `FORGE_GATE_TIMEOUT_MS` headroom for. It is the SAME command the per-WI local
 * gate ran, so it must honour the SAME timeout knob. No env-strip (that is the
 * CI delivery net's job, keyed off `testProcess.ci.unsetEnv`).
 */
function runLocalSuiteGate(cmd: string[], worktreePath: string, declaredTimeoutMs?: number): { ok: boolean; output: string } {
  const [head, ...rest] = cmd;
  try {
    const out = execFileSync(head, rest, {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: resolveGateTimeoutMs(declaredTimeoutMs),
    });
    return { ok: true, output: out.toString() };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = e.stdout ? e.stdout.toString() : '';
    const stderr = e.stderr ? e.stderr.toString() : '';
    return { ok: false, output: (stdout + stderr) || (e.message ?? '') };
  }
}

/**
 * R4-10-F2 — the relocated dual-boundary full-suite gate (ADR-036 amendment,
 * R1-03-F4 spec). Runs, on the INTEGRATED branch tip, keyed off the typed
 * `testProcess` contract:
 *   1. `testProcess.local` (the full suite — today's `quality_gate_cmd`),
 *      UNSCOPED. This is the relocated `composedUnifierGate.initiative_gate`:
 *      it catches a red full-suite baseline the scoped per-WI gates can't see.
 *   2. `testProcess.ci` (the hermetic delivery net — `ci_gate`, env-stripped,
 *      after its `ci_fix_cmd` formatters), when declared.
 *
 * Unlike `enforceFinalCiGate` (which THROWS, failing the cycle), this RETURNS
 * the verdict so the caller (execDemo) can drive the bounded gate-fix loop.
 * Writes `.forge/last-gate-failure.md` on a red gate (the results-flow seam the
 * fix agent reads) and clears it on a green one. Never throws; a dry run passes.
 *
 * Preserved invariant (verbatim, R1-03-F4): **no path to merge exists with a red
 * full-suite baseline** — the caller must not open a PR when this returns red.
 */
/**
 * Emit the SAME `cycle.merge-gate-config-error` error event both config-red
 * triggers (a throwing load, and a cleanly-loaded config with nothing to run)
 * report, then return the RED verdict. One choke point so a future trigger
 * gets the identical event shape for free (M0-A fix round 1, finding 1).
 */
function failMergeGateConfig(input: CycleInput, logger: EventLogger, reason: string): MergeGateResult {
  logger.emit({
    initiative_id: input.initiativeId,
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'error',
    input_refs: [input.projectRepoPath],
    output_refs: [],
    message: 'cycle.merge-gate-config-error',
    metadata: { reason },
  });
  return { ok: false, failedGate: 'config', reason };
}

/**
 * Which declared gates the ORCHESTRATOR runs at the merge boundary, chosen by
 * the initiative's change class (spec §5 item 1). The VALUE comes down from
 * `@forge/factory`, never the table — this package may not import that one.
 * `hasVerb` is not decoration: `gates: []` is legitimate only when the class
 * carries a verb instead, or an empty selection returns a green gate on the
 * strength of having checked nothing.
 */
export type MergeBoundarySelection = {
  gates: ReadonlyArray<'ci' | 'local'>;
  hasVerb: boolean;
};

export function runMergeBoundaryGate(
  input: CycleInput,
  logger: EventLogger,
  selection: MergeBoundarySelection,
): MergeGateResult {
  // A dry run executes no gate, so it has no evidence to report — an empty
  // list, never a fabricated green row.
  if (input.dryRun) return { ok: true, evidence: [] };

  if (selection.gates.length === 0 && !selection.hasVerb) {
    return failMergeGateConfig(
      input,
      logger,
      'the change class selects no merge-boundary test and no merge-boundary verb — a boundary that checks nothing cannot report a green gate',
    );
  }
  // The class's boundary is its VERB, run by the caller, which events its own
  // `cycle.merge-gate` row. Nothing here to run and nothing here claiming to
  // have run: an empty evidence list, never a fabricated green row.
  if (selection.gates.length === 0) return { ok: true, evidence: [] };

  let cfg: ReturnType<typeof loadProjectConfig>;
  try {
    cfg = loadProjectConfig(input.projectRepoPath);
  } catch (err) {
    // A malformed project.json is fail-closed everywhere it's loaded for real
    // (the dev-loop) — and it must be fail-closed HERE too. A cycle whose
    // project config cannot be read has no basis for a green gate; nothing
    // backstops it (a project may declare no `testProcess.ci` at all, per
    // C1b's own preflight WARN), so this reports RED, not `{ ok: true }`.
    return failMergeGateConfig(input, logger, err instanceof Error ? err.message : String(err));
  }

  // `loadProjectConfig` does NOT throw on an absent/unreadable/symlink-rejected
  // `.forge/project.json` — it returns `null` (its own doc comment: "the only
  // non-throwing outcome on parse failure is 'file does not exist'"), and a
  // cleanly-loaded config can still declare an EMPTY `testProcess.local.cmd`
  // (an empty array passes `validateProjectConfig`'s `if (!localCmd) throw` —
  // `![]` is `false`). Both collapse `localCmd` to `null` here — deliberately
  // ONE check, not a `cfg === null` special case: special-casing only the
  // throw/null path would leave the empty-cmd trigger still falling through to
  // `{ ok: true }` below. Neither case has a gate to run, so neither can be
  // green; the two reasons are worded distinctly so an operator can tell "I
  // cannot read your config" from "your config declares no local gate" apart.
  const wantsLocal = selection.gates.includes('local');
  const localCmd = cfg?.quality_gate_cmd && cfg.quality_gate_cmd.length > 0 ? cfg.quality_gate_cmd : null;
  // Fail-closed only when the CLASS asked for a local gate: a `['ci']` class
  // must not be red for a local suite it was never going to run.
  if (wantsLocal && !localCmd) {
    const reason =
      cfg === null
        ? `project.json could not be read at ${join(input.projectRepoPath, '.forge', 'project.json')} (absent, unreadable, or rejected by the containment guard) — the merge gate has nothing to run and cannot report a green gate.`
        : `project.json loaded but testProcess.local.cmd is empty — it declares no local gate command, so the merge gate has nothing to run and cannot report a green gate.`;
    return failMergeGateConfig(input, logger, reason);
  }
  // Reachable only when the class asked for no local gate. An unreadable config
  // is still no basis for a green gate, whichever gate the class selected.
  if (cfg === null) {
    return failMergeGateConfig(
      input,
      logger,
      `project.json could not be read at ${join(input.projectRepoPath, '.forge', 'project.json')} (absent, unreadable, or rejected by the containment guard) — the merge gate has nothing to run and cannot report a green gate.`,
    );
  }
  const loadedCfg = cfg;
  const localTimeoutMs = loadedCfg.testProcess.local?.timeoutMs;
  const ciGate = loadedCfg.ci_gate && loadedCfg.ci_gate.length > 0 ? loadedCfg.ci_gate : null;
  const ciFixCmd = loadedCfg.ci_fix_cmd && loadedCfg.ci_fix_cmd.length > 0 ? loadedCfg.ci_fix_cmd : null;
  const ciGateUnsetEnv =
    loadedCfg.ci_gate_unset_env && loadedCfg.ci_gate_unset_env.length > 0 ? loadedCfg.ci_gate_unset_env : [];
  const ciDeclaredTimeoutMs = loadedCfg.testProcess.ci?.timeoutMs;
  const evidence: MergeGateEvidence[] = [];

  // (1) Full-suite local gate — the relocated initiative_gate. UNSCOPED.
  //     LOCAL-gate timeout semantics (the same command + knob the per-WI gate
  //     used). Runs whenever the CLASS selects it, `localCmd` then guaranteed
  //     non-null above — the structural property finding 1 asks for: `{ ok:
  //     true }` is reachable only past the gates the class chose actually
  //     executing, never by the absence of a failure this happens to check.
  if (wantsLocal && localCmd) {
    const local = runLocalSuiteGate(localCmd, input.worktreePath, localTimeoutMs);
    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: 'cycle',
      event_type: local.ok ? 'log' : 'error',
      input_refs: [input.worktreePath],
      output_refs: [],
      message: 'cycle.merge-gate',
      metadata: { gate: 'local', ok: local.ok, cmd: localCmd, output_tail: local.output.slice(-1200) },
    });
    evidence.push({ gate: 'local', cmd: localCmd, ok: local.ok, outputTail: local.output.slice(-1200) });
    if (!local.ok) {
      writeMergeGateFeedback(input.worktreePath, 'local', localCmd, local.output);
      return { ok: false, failedGate: 'local', cmd: localCmd, output: local.output };
    }
  }

  // (2) CI delivery net — env-stripped, after formatters. Reuses the same
  //     decision core the final CI delivery gate uses today. Runs only when the
  //     CLASS selects it — a `config` initiative is checked by the local suite,
  //     and a project's whole CI over it is spend the class did not ask for.
  if (selection.gates.includes('ci') && ciGate) {
    const decision = decideFinalCiGate({
      ciGate,
      ciFixCmd,
      worktreePath: input.worktreePath,
      run: (cmd, wt, kind, unsetEnv) => execCommandVector(cmd, wt, kind, unsetEnv, ciDeclaredTimeoutMs),
      unsetEnv: ciGateUnsetEnv,
    });
    if (decision) {
      // Commit + push any formatter changes WHENEVER the fixer ran — even on a
      // red gate. A red gate now RETURNS (not throws): execDemo terminates to
      // ready-for-review and the drain re-enters resume_from:'develop', whose
      // first step rebases the preserved branch onto main. Leaving the
      // formatter's tracked-file edits uncommitted would make that rebase abort
      // with "unstaged changes" (the pre-R4-10 enforceFinalCiGate committed on
      // ranFixer regardless of gateOk for exactly this reason; it just threw
      // instead of resuming). Guarded internally on a dirty tree, so a no-op
      // fixer adds no commit.
      if (decision.ranFixer) {
        commitAndPushCiFix(input.worktreePath, logger, input.initiativeId);
      }
      logger.emit({
        initiative_id: input.initiativeId,
        phase: 'orchestrator',
        skill: 'cycle',
        event_type: decision.gateOk ? 'log' : 'error',
        input_refs: [input.worktreePath],
        output_refs: [],
        message: 'cycle.merge-gate',
        metadata: {
          gate: 'ci',
          ok: decision.gateOk,
          ran_fixer: decision.ranFixer,
          cmd: ciGate,
          ...(ciGateUnsetEnv.length > 0 ? { ci_gate_unset_env: ciGateUnsetEnv } : {}),
          output_tail: decision.gateOutput.slice(-1200),
        },
      });
      evidence.push({ gate: 'ci', cmd: ciGate, ok: decision.gateOk, outputTail: decision.gateOutput.slice(-1200) });
      if (!decision.gateOk) {
        writeMergeGateFeedback(input.worktreePath, 'ci', ciGate, decision.gateOutput);
        return { ok: false, failedGate: 'ci', cmd: ciGate, output: decision.gateOutput };
      }
    }
  }

  // Both green — the full-suite baseline is clean; clear the feedback seam.
  clearMergeGateFeedback(input.worktreePath);
  return { ok: true, evidence };
}
