/**
 * Per-machine config loader (per ADR 009) + environment assertions.
 *
 * `forge.config.json` is gitignored; it contains operator-specific settings
 * (projectsDir, model overrides, scheduler concurrency, notification config).
 * Schema deliberately small — anything more durable belongs in an ADR or a
 * SKILL.md, anything more per-cycle belongs in the manifest frontmatter.
 *
 * F-10 / F-18: prior to this module, `forge.config.json` was documented in
 * ADR 009 but never read by any code path. This module wires it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ForgeConfig = {
  /** Where managed projects are cloned/symlinked. Defaults to `./projects`. */
  projectsDir?: string;
  /** Scheduler tuning. Currently only `maxConcurrentInitiatives` is honoured. */
  scheduler?: {
    maxConcurrentInitiatives?: number;
  };
  /** Notification config. Mirrors the NotifyConfig shape from notify.ts. */
  notify?: {
    desktop?: boolean;
    webhook_url?: string | null;
  };
};

/**
 * Load `forge.config.json` from the given path (default: cwd-relative
 * `./forge.config.json`). Missing or malformed files yield an empty config —
 * the caller layers their own defaults. We deliberately do NOT throw on
 * malformed JSON; a fresh-box install has no config and that should be a
 * working state, not an error.
 */
export function loadConfig(path = 'forge.config.json'): ForgeConfig {
  const abs = resolve(path);
  if (!existsSync(abs)) return {};
  try {
    const raw = readFileSync(abs, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as ForgeConfig;
  } catch {
    return {};
  }
}

export type EnvAssertionMode = 'warn' | 'throw';

/**
 * Gather environment-setup issues without any side effect (no stderr, no
 * throw). The single source of which env vars matter; `assertEnv` and
 * `forge init` both read from here. Currently only `ANTHROPIC_API_KEY`.
 */
export function collectEnvIssues(): string[] {
  const issues: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) {
    issues.push(
      'ANTHROPIC_API_KEY is not set. The Claude Agent SDK may fall back to Claude Code credentials, but production setups should export ANTHROPIC_API_KEY explicitly. See `.env.example`.',
    );
  }
  return issues;
}

/**
 * Verify the environment is set up enough to run a cycle. Returns the list of
 * issues found so callers can decide what to surface. With `mode: 'warn'`
 * (default) it also writes each issue to stderr; with `mode: 'throw'` it throws
 * on the first issue. Some setups — notably Claude Code itself — provide
 * alternative auth, so the default is warn-only.
 */
export function assertEnv(mode: EnvAssertionMode = 'warn'): string[] {
  const issues = collectEnvIssues();
  if (mode === 'throw' && issues.length > 0) {
    throw new Error(`forge env check failed:\n  - ${issues.join('\n  - ')}`);
  }
  if (mode === 'warn') {
    for (const i of issues) {
      process.stderr.write(`forge: warning: ${i}\n`);
    }
  }
  return issues;
}
