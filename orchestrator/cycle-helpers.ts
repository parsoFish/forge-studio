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
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EventLogger } from './logging.ts';
import type { CycleInput } from './cycle-context.ts';
import { assertLocalRemoteSynced, openPullRequest, pushInitiativeBranch } from './pr.ts';
import { loadProjectConfig } from './project-config.ts';
import { decideFinalCiGate, execCommandVector } from './cycle.ts';

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
    const demoMdPath = resolve(input.worktreePath, 'demo', input.initiativeId, 'DEMO.md');
    const prDescPath = resolve(input.worktreePath, '.forge', 'pr-description.md');
    const missing: string[] = [];
    if (!existsSync(demoMdPath)) missing.push(`demo/${input.initiativeId}/DEMO.md`);
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
 *   - `main` == merge-base(main, branch)  (main did not diverge)
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
    execFileSync('git', ['commit', '-m', 'style: apply ci_fix_cmd (auto-format)'], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
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
  try {
    const cfg = loadProjectConfig(input.projectRepoPath);
    ciGate = cfg?.ci_gate && cfg.ci_gate.length > 0 ? cfg.ci_gate : null;
    ciFixCmd = cfg?.ci_fix_cmd && cfg.ci_fix_cmd.length > 0 ? cfg.ci_fix_cmd : null;
    ciGateUnsetEnv = cfg?.ci_gate_unset_env && cfg.ci_gate_unset_env.length > 0 ? cfg.ci_gate_unset_env : [];
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
    run: execCommandVector,
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
