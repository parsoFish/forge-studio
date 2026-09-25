/**
 * `forge init` — first-run scaffolding (ADR-033, J1).
 *
 * Brings a fresh checkout to a runnable state without the operator having to
 * know forge's internal layout: writes a minimal `forge.config.json` if absent,
 * materialises the `_queue/` + `_worktrees/` + `_logs/` layout (idempotent —
 * the repo ships these via .gitkeep, but a relocated/cleaned tree may not have
 * them), validates the environment, and surfaces friendly next-step hints.
 *
 * Logic is split so the decisions are unit-testable: `layoutDirs` and
 * `defaultConfigJson` are pure; `ensureLayoutDirs` and `ensureDefaultConfig`
 * (forge-8vfn.6.11.46) do the I/O for each half separately, so a caller can
 * ask for scaffolding without ever writing operator config as a side effect;
 * `runInit` composes both and returns a report.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { collectEnvIssues } from './config.ts';

/** The six queue states (mirrors packages/flows/queue.ts getPaths). */
export const QUEUE_SUBDIRS = ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed'] as const;

/**
 * The absolute directory set `forge init` (and the studio/serve preflight)
 * ensures exists, given a forge root. Pure — the I/O caller maps over this.
 */
export function layoutDirs(forgeRoot: string): string[] {
  const root = resolve(forgeRoot);
  const queue = join(root, '_queue');
  return [
    queue,
    ...QUEUE_SUBDIRS.map((s) => join(queue, s)),
    join(root, '_worktrees'),
    join(root, '_logs'),
    // SEC-02: `defaultConfigJson` has always named `projectsDir: './projects'`,
    // but init never created it. That latent gap became load-bearing once
    // manifest path fields are containment-checked against `<root>/projects`:
    // a containment root that does not exist fails CLOSED, so a fresh install
    // without this directory would refuse every manifest carrying a
    // `project_repo_path`.
    join(root, 'projects'),
  ];
}

/** The minimal, comment-free config a fresh install gets. Pure. */
export function defaultConfigJson(): string {
  return (
    JSON.stringify(
      {
        projectsDir: './projects',
        scheduler: { maxConcurrentInitiatives: 2 },
        notify: { desktop: true, webhook_url: null },
      },
      null,
      2,
    ) + '\n'
  );
}

/** True when `gh` is installed AND reports an authenticated account. */
export function ghAuthed(): boolean {
  try {
    execSync('gh auth status', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export type LayoutDirsResult = {
  /** Dirs newly created this run. */
  created: string[];
  /** Dirs already present (skipped). */
  skipped: string[];
};

export type ConfigResult = {
  /** Absolute path to forge.config.json. */
  path: string;
  /** True when this call wrote the file (it was absent). */
  written: boolean;
};

export type LayoutResult = {
  /** Dirs + config files newly created this run. */
  created: string[];
  /** Dirs + config files already present (skipped). */
  skipped: string[];
  /** Whether forge.config.json was written this run. */
  configWritten: boolean;
};

export type InitReport = LayoutResult & {
  /** Environment issues (e.g. missing ANTHROPIC_API_KEY). */
  envIssues: string[];
  /** Friendly next-step hints (gh auth, set the key, etc.). */
  hints: string[];
};

/**
 * Materialise the queue/log/worktrees/projects directories only — never
 * touches forge.config.json (forge-8vfn.6.11.46: a caller that only needs
 * scaffolding must not be able to write operator config as a side effect).
 * Idempotent. Cheap enough to run on every `forge studio` launch as a
 * preflight.
 */
export function ensureLayoutDirs(forgeRoot: string): LayoutDirsResult {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const dir of layoutDirs(forgeRoot)) {
    if (existsSync(dir)) {
      skipped.push(dir);
    } else {
      mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  return { created, skipped };
}

/**
 * Write the default forge.config.json when the tree has none. Idempotent —
 * an existing config is never overwritten (forge-8vfn.6.11.46: named for
 * what it does, so a caller that writes operator config says so).
 */
export function ensureDefaultConfig(forgeRoot: string): ConfigResult {
  const path = join(resolve(forgeRoot), 'forge.config.json');
  if (existsSync(path)) {
    return { path, written: false };
  }
  writeFileSync(path, defaultConfigJson(), 'utf8');
  return { path, written: true };
}

/**
 * Full `forge init`: scaffold the layout + config, then gather environment
 * hints (env key, gh auth). Idempotent.
 */
export function runInit(
  forgeRoot: string,
  deps: { isGhAuthed?: () => boolean } = {},
): InitReport {
  const isGhAuthed = deps.isGhAuthed ?? ghAuthed;
  const dirs = ensureLayoutDirs(forgeRoot);
  const config = ensureDefaultConfig(forgeRoot);
  const created = config.written ? [...dirs.created, config.path] : dirs.created;
  const skipped = config.written ? dirs.skipped : [...dirs.skipped, config.path];
  const configWritten = config.written;

  // Environment issues (no stderr side effect — runInit returns a report and
  // the CLI renders it; collectEnvIssues is the single source of which vars matter).
  const envIssues = collectEnvIssues();

  const hints: string[] = [];
  if (envIssues.length > 0) {
    hints.push(
      'Set ANTHROPIC_API_KEY (or rely on Claude Code credentials) before running a cycle — see .env.example.',
    );
  }
  if (!isGhAuthed()) {
    hints.push('Run `gh auth login` so forge can open and merge pull requests.');
  }
  hints.push('Launch the operator UI with `forge studio`, then create your first agent.');

  return { created, skipped, configWritten, envIssues, hints };
}
