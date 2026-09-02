/**
 * Brain-lint vocabulary — the finding shape, the resolution tier, the scan
 * scopes and the run options every check and every consumer speaks.
 *
 * Split out of `brain-lint.ts` (M4 step 4, the 800-line cap). Types only, and
 * it imports nothing: that is what lets the four check modules and the run
 * orchestration share one vocabulary without importing each other.
 */
export type FindingCategory = 'auto-fix' | 'flag' | 'error';

/**
 * Resolution tier — WHO clears a finding, orthogonal to `category` (severity):
 *   - `auto`  — a deterministic fixer (regenerate index, clamp dates, git-mv). No LLM.
 *   - `agent` — an LLM can resolve it unattended (infer a description, repoint a link).
 *   - `user`  — needs a human decision (which of a contradicting pair, archive-or-keep).
 * The guided lint-resolution UI dispatches on this tier.
 */
export type Resolution = 'auto' | 'agent' | 'user';

export type Finding = {
  category: FindingCategory;
  file: string; // absolute path
  message: string;
  /** Optional check name for grouping in output. */
  check?: string;
  /** Stable discriminator slug (e.g. `index.not-listed`), stamped by classifyFinding. */
  kind?: string;
  /** Resolution tier, stamped by classifyFinding. */
  resolution?: Resolution;
  /** Agent-tier only: a targeted instruction for the fix turn. */
  fixHint?: string;
};

export type Scope =
  | 'full'
  | 'forge-only'
  | 'project-only'
  | 'single-file'
  | 'cycle-touched-themes'
  | 'cleanup-dry-run';

export type RunBrainLintOptions = {
  cwd: string;
  scope: Scope;
  project?: string;
  file?: string; // relative to cwd
  cycle?: string;
  fix?: boolean;
};

export type RunBrainLintResult = {
  findings: Finding[];
  exitCode: 0 | 1;
};
