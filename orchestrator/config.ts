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
  /** Unifier tuning (G4, ADR 009 as amended 2026-07-11). */
  unifier?: {
    /**
     * Hard ceiling on CONSECUTIVE composed-gate failures of the SAME sub-check
     * before the unifier's fix-iteration loop halts with a terminal
     * `uwi.loop-cap-exhausted` event instead of re-invoking the agent.
     * Default: `DEFAULT_UNIFIER_GATE_FAILURE_CAP` (4).
     */
    maxConsecutiveGateFailures?: number;
  };
  /**
   * N6 (plan 2.8): post-merge CI watch tuning. After a confirmed merge the
   * closure phase polls the merged commit's GitHub Actions runs, bounded by
   * this window, and emits `cycle.post-merge-ci` events (green → info,
   * red → error + needs-operator marker).
   */
  postMergeCi?: {
    /** Total watch window. Default: `DEFAULT_POST_MERGE_CI_TIMEOUT_MS` (10 min). */
    timeoutMs?: number;
    /** Poll interval. Default: `DEFAULT_POST_MERGE_CI_POLL_INTERVAL_MS` (30 s). */
    pollIntervalMs?: number;
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

/**
 * Resolve where managed projects live, as an absolute path. Precedence:
 *   1. `FORGE_PROJECTS_DIR` env var (operator/CI override)
 *   2. `projectsDir` from `forge.config.json`
 *   3. the default `<forgeRoot>/projects`
 *
 * A relative config/env value is resolved against `forgeRoot` (NOT cwd) so a
 * project scan is stable regardless of where forge was invoked from. This is
 * the single source of truth for the projects root; disk-scan callers
 * (studio bridge, studio-lint) read it instead of hard-coding `projects/`.
 */
export function resolveProjectsDir(forgeRoot: string, cfg?: ForgeConfig): string {
  const root = resolve(forgeRoot);
  const fromEnv = process.env.FORGE_PROJECTS_DIR?.trim();
  const fromCfg = cfg?.projectsDir?.trim();
  const chosen = fromEnv || fromCfg || 'projects';
  return resolve(root, chosen);
}

/**
 * G4 (2026-07 refinement, plan item 2.2): default ceiling on CONSECUTIVE
 * composed-gate failures of the SAME sub-check inside the unifier's
 * fix-iteration loop. Evidence for 4: the 2026-07-04 themes (16-restart /
 * $84.56 spins) show that a sub-check the agent hasn't cleared after 4
 * straight attempts needs different work (dev-loop code, an operator), not
 * a 5th identical attempt.
 */
export const DEFAULT_UNIFIER_GATE_FAILURE_CAP = 4;

/**
 * Resolve the unifier fix-loop failure cap. Precedence (mirrors
 * `resolveProjectsDir`):
 *   1. `FORGE_UNIFIER_GATE_FAILURE_CAP` env var (operator/CI override)
 *   2. `unifier.maxConsecutiveGateFailures` from `forge.config.json`
 *   3. `DEFAULT_UNIFIER_GATE_FAILURE_CAP` (4)
 *
 * Non-finite / zero / negative values are ignored (fall through) — a cap
 * below 1 would halt the loop before the agent's first fix attempt.
 */
export function resolveUnifierGateFailureCap(cfg: ForgeConfig = loadConfig()): number {
  const fromEnv = Number(process.env.FORGE_UNIFIER_GATE_FAILURE_CAP);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.floor(fromEnv);
  const fromCfg = cfg.unifier?.maxConsecutiveGateFailures;
  if (typeof fromCfg === 'number' && Number.isFinite(fromCfg) && fromCfg >= 1) return Math.floor(fromCfg);
  return DEFAULT_UNIFIER_GATE_FAILURE_CAP;
}

/** N6: default post-merge CI watch window (bounded — forge never waits forever). */
export const DEFAULT_POST_MERGE_CI_TIMEOUT_MS = 10 * 60_000;
/** N6: default post-merge CI poll interval. */
export const DEFAULT_POST_MERGE_CI_POLL_INTERVAL_MS = 30_000;

/**
 * Resolve the post-merge CI watch tuning. Precedence (mirrors
 * `resolveUnifierGateFailureCap`):
 *   1. `FORGE_POST_MERGE_CI_TIMEOUT_MS` / `FORGE_POST_MERGE_CI_POLL_MS` env vars
 *   2. `postMergeCi.{timeoutMs,pollIntervalMs}` from `forge.config.json`
 *   3. the defaults above
 * Non-finite / non-positive values are ignored (fall through).
 */
export function resolvePostMergeCiConfig(
  cfg: ForgeConfig = loadConfig(),
): { timeoutMs: number; pollIntervalMs: number } {
  const pick = (envName: string, cfgValue: number | undefined, fallback: number): number => {
    const fromEnv = Number(process.env[envName]);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
    if (typeof cfgValue === 'number' && Number.isFinite(cfgValue) && cfgValue > 0) {
      return Math.floor(cfgValue);
    }
    return fallback;
  };
  return {
    timeoutMs: pick('FORGE_POST_MERGE_CI_TIMEOUT_MS', cfg.postMergeCi?.timeoutMs, DEFAULT_POST_MERGE_CI_TIMEOUT_MS),
    pollIntervalMs: pick('FORGE_POST_MERGE_CI_POLL_MS', cfg.postMergeCi?.pollIntervalMs, DEFAULT_POST_MERGE_CI_POLL_INTERVAL_MS),
  };
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

/**
 * G8 (2026-07 refinement): env vars that must never reach a spawned Claude
 * Agent SDK child process. Each is a proven host-leakage vector (3 production
 * incidents tracing back to the operator's shell/proxy setup bleeding into
 * agent children) — none of them are forge-managed anywhere in orchestrator/
 * or loops/, so on a spawned child their only possible effect is unintended
 * inheritance. See `pinnedAgentEnv` below, the single scrub point.
 *
 * Explicitly OUT of scope here: GIT_* identity vars (a later wave).
 */
export const AGENT_ENV_DENYLIST: readonly string[] = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_EFFORT',
];

/** Prefix denylist: every `HEADROOM_*` var is a host-compression-proxy leakage vector. */
const HEADROOM_ENV_PREFIX = /^HEADROOM_/;

/**
 * Return a NEW env object (never mutates `base`, never touches global
 * `process.env`) with every `AGENT_ENV_DENYLIST` key and every
 * `HEADROOM_*`-prefixed key removed. Defaults `base` to `process.env`.
 *
 * This is the seam every spawned Claude Agent SDK child's `options.env` must
 * be derived from — see `pinnedSdkQuery` (orchestrator/pinned-sdk-query.ts),
 * the wrapper around the SDK's `query` that every production import site
 * uses instead of importing `query` directly.
 */
export function pinnedAgentEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...base };
  for (const key of AGENT_ENV_DENYLIST) {
    delete result[key];
  }
  for (const key of Object.keys(result)) {
    if (HEADROOM_ENV_PREFIX.test(key)) delete result[key];
  }
  return result;
}
