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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ForgeConfig = {
  /** Where managed projects are cloned/symlinked. Defaults to `./projects`. */
  projectsDir?: string;
  /** Managed-project policy. */
  projects?: {
    /**
     * Whether creating a greenfield project also mints its GitHub remote —
     * bead `forge-8vfn.6.11.27`, operator ruling 323.
     *
     * DEFAULT OFF, and deliberately so: minting is an irreversible OUTWARD
     * side effect (a real repository under the operator's account) attached to
     * an otherwise local, routine act, so a mistyped name would leave a repo
     * behind. Gated the same way the story sweep's DELETE is gated (ruling
     * 303), so creation and deletion are symmetrical rather than one being
     * free and the other guarded.
     *
     * Without it, preflight clause C6 cannot pass for a greenfield project:
     * `checkC6` requires `git remote get-url origin` to name a github.com
     * remote, and a project that is its own repo from birth has none.
     */
    remote?: { create?: boolean };
  };
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
  /** Dev-loop tuning (Phase 4 step 6 — concurrent WI dispatch). */
  dev?: {
    /**
     * Max concurrently in-flight per-WI Ralph loops (each in its own
     * worktree — see `wi-worktree.ts` / `wi-dispatch-scheduler.ts`). Default
     * `DEFAULT_DEV_WI_CONCURRENCY` (1 — the pre-step-6 serial behavior).
     * Never unbounded — clamped to `DEV_WI_CONCURRENCY_CEILING`.
     */
    maxConcurrentWorkItems?: number;
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
  /**
   * R4-08-F2 (ADR-040): review send-back loop bounds. A verdict's send-back
   * appends fix work items and re-runs the dev-loop/unifier spine; either cap
   * exhausting PARKS the initiative needs-operator (`.forge/REVIEW-CAP-EXHAUSTED.md`)
   * rather than looping forever.
   */
  review?: {
    /** Max send-back rounds per initiative. Default: `DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS` (6). */
    maxSendBackRounds?: number;
    /** Max total fix work items appended across all rounds. Default: `DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS` (24). */
    maxTotalFixWorkItems?: number;
  };
  /**
   * R2-04 (ADR-041): budgets stamped onto initiatives MINTED by external
   * triggers (cron/webhook origination — no architect sized them). Spend
   * policy: conservative defaults, operator-tunable.
   */
  triggers?: {
    /** Default: `DEFAULT_TRIGGERED_RUN_COST_BUDGET_USD` (10). */
    defaultCostBudgetUsd?: number;
    /** Default: `DEFAULT_TRIGGERED_RUN_ITERATION_BUDGET` (30). */
    defaultIterationBudget?: number;
  };
  /**
   * R6-04 (WI-2): per-kickoff cost ceiling tuning — the operator-set cap on
   * `POST /api/agents/:slug/run`, wired to runAgent's existing SDK-budget
   * enforcement path (`options.maxBudgetUsd`).
   */
  runs?: {
    /** Default: `DEFAULT_KICKOFF_COST_CEILING_USD`. Pre-fills the kickoff UI's ceiling field. */
    defaultCostCeilingUsd?: number;
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
 * R4-17 round-3 BLOCKER (pin 5, item 2): the FORGE-ROOT-ANCHORED
 * `forge.config.json` path — pass this to `loadConfig` instead of relying on
 * its cwd-relative default (`path = 'forge.config.json'`, resolved via a bare
 * `resolve(path)` against `process.cwd()`). A caller running from a different
 * cwd than `forgeRoot` (any subprocess, any test, any daemon started from an
 * unexpected directory) would otherwise silently get `loadConfig`'s soft
 * `{}` fallback — the untouched DEFAULT config — even with a real
 * `forge.config.json` sitting right there in `forgeRoot`. Every call to
 * `loadConfig` on the projects-root resolution path must use this rather
 * than the bare no-arg default; see `resolveProjectsDir`'s own docstring,
 * which calls itself "the single source of truth for the projects root" —
 * a cwd-dependent config load one step upstream of it contradicts that.
 */
export function defaultConfigPath(forgeRoot: string): string {
  return join(resolve(forgeRoot), 'forge.config.json');
}

/**
 * The `studio/starters/projects/` dir — the F2 project-template library root.
 *
 * MOVED VERBATIM from `packages/projects/project-create.ts` (M4-library PR 2).
 * `packages/library/studio/template-library.ts` lists project scaffolds as one
 * of the template kinds it surfaces, and library (rank 2) may not import
 * projects (rank 2 — `check-boundaries.mjs` treats SAME rank as a violation,
 * `b >= a`). It is a layout fact, so it sits beside `resolveProjectsDir` here
 * rather than being duplicated; `project-create.ts` re-exports both names, so
 * its own importers (`apps/forge/bridge-studio.ts`, `apps/forge/cli.ts`, its tests)
 * are unchanged.
 *
 * The previous body composed this as `join(skillsDir(forgeRoot), '..',
 * 'studio', 'starters', 'projects')`. `join` normalizes the `..`, so dropping
 * the indirection through `skillsDir` — which kernel (rank 1) may not import
 * from library (rank 2), where that helper now lives — leaves the SAME string
 * for every input, relative roots included.
 *
 * Deliberately `join`, NOT `resolve(forgeRoot)`. An earlier draft of this move
 * used `resolve` for symmetry with `resolveProjectsDir` below, and that is a
 * real behaviour change hiding behind a claim of equivalence: `join` leaves a
 * relative `forgeRoot` relative, `resolve` anchors it to `process.cwd()`.
 * Every caller today passes an absolute root (`FORGE_ROOT`, `ctx.forgeRoot`,
 * or a test's `process.cwd()`), so it would have been inert — which is exactly
 * why it would have survived review and gone wrong later, under a caller that
 * passes a relative root. Equivalence claimed in a comment has to be true for
 * every input, not for the inputs that happen to exist.
 */
export function projectStartersDir(forgeRoot: string): string {
  return join(forgeRoot, 'studio', 'starters', 'projects');
}

/** The curated app-type templates available for creation. */
export function listProjectStarters(forgeRoot: string): string[] {
  const dir = projectStartersDir(forgeRoot);
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
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
 * Phase 4 step 6 — the pre-step-6 behavior (one WI's Ralph loop at a time)
 * is the default; concurrency is opt-in.
 */
export const DEFAULT_DEV_WI_CONCURRENCY = 1;
/**
 * Hard ceiling regardless of env/config input — "never unbounded" (each
 * concurrent slot is its own worktree + Ralph agent invocation; an
 * unbounded cap would let a large initiative fan out to N simultaneous
 * agent processes with no resource guard).
 */
export const DEV_WI_CONCURRENCY_CEILING = 8;

/**
 * Resolve the dev-loop's per-WI concurrency cap. Precedence (preserves
 * ADR-009's operator levers: an explicit env/config value still wins):
 *   1. `FORGE_DEV_WI_CONCURRENCY` env var (operator/CI override)
 *   2. `dev.maxConcurrentWorkItems` from `forge.config.json` (operator lever)
 *   3. `definitionCap` — the fanout AGENT's declared `fanout.concurrencyCap`
 *      (R2-03-F4: the declared cap is the agent's DEFAULT — it replaces the
 *      hardcoded `DEFAULT_DEV_WI_CONCURRENCY` as the source of the default, but
 *      does NOT shadow an operator's explicit config/env override)
 *   4. `DEFAULT_DEV_WI_CONCURRENCY` (1 — serial, byte-identical to pre-step-6;
 *      the fallback when no agent declares a cap)
 *
 * Non-finite / zero / negative values are ignored (fall through — a cap
 * below 1 would dispatch nothing). The resolved value is always clamped to
 * `DEV_WI_CONCURRENCY_CEILING` ("never unbounded"), even a definition-declared
 * cap — the resource guard is deliberate, not an artifact of the old design.
 */
export function resolveDevWiConcurrency(cfg: ForgeConfig = loadConfig(), definitionCap?: number): number {
  const clamp = (n: number): number => Math.min(Math.floor(n), DEV_WI_CONCURRENCY_CEILING);
  const fromEnv = Number(process.env.FORGE_DEV_WI_CONCURRENCY);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return clamp(fromEnv);
  const fromCfg = cfg.dev?.maxConcurrentWorkItems;
  if (typeof fromCfg === 'number' && Number.isFinite(fromCfg) && fromCfg >= 1) return clamp(fromCfg);
  if (typeof definitionCap === 'number' && Number.isFinite(definitionCap) && definitionCap >= 1) return clamp(definitionCap);
  return DEFAULT_DEV_WI_CONCURRENCY;
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

/**
 * R4-08-F2 (ADR-040): default cap on send-back rounds per initiative before
 * the loop parks needs-operator instead of re-invoking the reviewer/dev-loop
 * spine again.
 */
export const DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS = 6;
/**
 * R4-08-F2 (ADR-040): default cap on total fix work items appended across
 * all send-back rounds of an initiative — the `UNIFIER_MAX_TOTAL_ITEMS`
 * analogue for the send-back loop, now operator-tunable.
 */
export const DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = 24;

/**
 * Resolve the review send-back loop's caps. Precedence per field (mirrors
 * `resolvePostMergeCiConfig`):
 *   1. `FORGE_REVIEW_MAX_SEND_BACK_ROUNDS` / `FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS` env vars
 *   2. `review.{maxSendBackRounds,maxTotalFixWorkItems}` from `forge.config.json`
 *   3. `DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS` (6) / `DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS` (24)
 *
 * Non-finite / non-integer / < 1 values are ignored (fall through) at every
 * level — a cap below 1 would park an initiative before its first send-back
 * round, and a fractional round/item count has no meaning here.
 */
export function resolveReviewLoopCaps(
  cfg: ForgeConfig = loadConfig(),
): { maxSendBackRounds: number; maxTotalFixWorkItems: number } {
  const isValidCap = (value: number): boolean => Number.isFinite(value) && Number.isInteger(value) && value >= 1;
  const pick = (envName: string, cfgValue: number | undefined, fallback: number): number => {
    const fromEnv = Number(process.env[envName]);
    if (isValidCap(fromEnv)) return fromEnv;
    if (typeof cfgValue === 'number' && isValidCap(cfgValue)) return cfgValue;
    return fallback;
  };
  return {
    maxSendBackRounds: pick(
      'FORGE_REVIEW_MAX_SEND_BACK_ROUNDS',
      cfg.review?.maxSendBackRounds,
      DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS,
    ),
    maxTotalFixWorkItems: pick(
      'FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS',
      cfg.review?.maxTotalFixWorkItems,
      DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS,
    ),
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
 * G8 wave 2 (2026-07-12): distinct git identity for forge-authored commits.
 *
 * PROVEN by spike (2026-07-11, $0.25, control-tested against a deliberately
 * poisoned local gitconfig): SDK `options.env` GIT_AUTHOR_* / GIT_COMMITTER_*
 * vars reach the Claude Code CLI child's own Bash-tool `git commit` calls and
 * take precedence over local/global gitconfig — no worktree-config plumbing
 * needed. This is the identity policy the rest of forge composes on top of:
 * SDK-spawned agents via `gitIdentityEnvOverlay` below, direct
 * orchestrator-issued `git commit` invocations via `gitIdentityConfigArgs`.
 */
export type GitIdentity = {
  readonly name: string;
  readonly email: string;
};

/**
 * Ralph (the per-WI dev agent)'s commit identity. Distinct PER WORK ITEM
 * (the email is tagged with `workItemId`) so `git log` / `git blame` on a
 * merged initiative branch can attribute exactly which WI authored which
 * commit even when several WIs land on the same branch.
 */
export function ralphGitIdentity(workItemId: string): GitIdentity {
  return { name: 'forge-ralph', email: `forge-ralph+${workItemId}@forge.local` };
}

/**
 * The unifier agent's commit identity. Flat (NOT per-UWI) — the unifier
 * composes/finishes a cycle's work items, it isn't itself one, so every UWI
 * (the packaging role and the code-fix role alike) shares this one identity.
 */
export const UNIFIER_GIT_IDENTITY: GitIdentity = {
  name: 'forge-unifier',
  email: 'forge-unifier@forge.local',
};

/**
 * Commits the orchestrator process issues directly (no agent in the loop —
 * dev-loop boundary snapshots, CI auto-fix commits, PR-branch scratch
 * stripping, demo-capture artifact commits, forge-studio project-config
 * writes, the Ralph-loop autocommit safety net). Distinct from the agent
 * identities above so `git log` can tell "an agent wrote this" from "forge's
 * own orchestration code wrote this" at a glance.
 */
export const ORCHESTRATOR_GIT_IDENTITY: GitIdentity = {
  name: 'forge-orchestrator',
  email: 'forge-orchestrator@forge.local',
};

/**
 * The GIT_* identity delta for an SDK-spawned agent child (R5-02): NOT a
 * full env, just the four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` keys for the
 * given identity. Pass this as `options.env` to a `pinnedSdkQuery` call
 * (orchestrator/pinned-sdk-query.ts) — the seam treats `options.env` as
 * deliberate overrides layered on top of the allowlist-filtered ambient
 * env, so this small delta reaches the child without ever needing to
 * pre-merge (or re-filter) the rest of the environment itself.
 */
export function gitIdentityEnvOverlay(identity: GitIdentity): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}

/**
 * `-c user.name=... -c user.email=...` flags for a DIRECT (non-SDK) `git
 * commit` / `git merge` invocation the orchestrator process issues itself via
 * `execFileSync`. The SDK path uses `gitIdentityEnvOverlay` (env
 * vars) instead because those commits happen inside a spawned Claude Code CLI
 * child, not in this process; a direct `execFileSync('git', ...)` call has no
 * such child env to set, so a per-invocation gitconfig override is the
 * equivalent mechanism. Spread immediately after `'git'` in the args array,
 * before the subcommand.
 */
export function gitIdentityConfigArgs(identity: GitIdentity): string[] {
  return ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`];
}

/**
 * R2-04 (ADR-041): default budgets for trigger-minted initiatives (no
 * architect sized them). Conservative on purpose — an unattended cron/webhook
 * fire must not carry architect-scale spend authority by default.
 */
export const DEFAULT_TRIGGERED_RUN_COST_BUDGET_USD = 10;
export const DEFAULT_TRIGGERED_RUN_ITERATION_BUDGET = 30;

/**
 * Resolve the budgets stamped onto trigger-minted initiatives. Precedence per
 * field (mirrors `resolveReviewLoopCaps`): `FORGE_TRIGGERED_RUN_COST_BUDGET_USD`
 * / `FORGE_TRIGGERED_RUN_ITERATION_BUDGET` env > `triggers.*` config > default.
 * Non-finite or <= 0 values fall through (a zero/negative budget would make
 * every triggered run dead-on-arrival).
 */
export function resolveTriggeredRunBudgets(
  cfg: ForgeConfig = loadConfig(),
): { defaultCostBudgetUsd: number; defaultIterationBudget: number } {
  const valid = (v: number): boolean => Number.isFinite(v) && v > 0;
  const pick = (envName: string, cfgValue: number | undefined, fallback: number): number => {
    const fromEnv = Number(process.env[envName]);
    if (valid(fromEnv)) return fromEnv;
    if (typeof cfgValue === 'number' && valid(cfgValue)) return cfgValue;
    return fallback;
  };
  return {
    defaultCostBudgetUsd: pick(
      'FORGE_TRIGGERED_RUN_COST_BUDGET_USD',
      cfg.triggers?.defaultCostBudgetUsd,
      DEFAULT_TRIGGERED_RUN_COST_BUDGET_USD,
    ),
    defaultIterationBudget: pick(
      'FORGE_TRIGGERED_RUN_ITERATION_BUDGET',
      cfg.triggers?.defaultIterationBudget,
      DEFAULT_TRIGGERED_RUN_ITERATION_BUDGET,
    ),
  };
}

/**
 * R6-04 (WI-2): default per-kickoff cost ceiling, pre-filled into the
 * kickoff UI and used whenever an operator omits an explicit `costCeilingUsd`
 * on `POST /api/agents/:slug/run` (the route itself does not apply this as a
 * cap — an absent `costCeilingUsd` simply means no operator ceiling is in
 * force; this constant is UI/config guidance only).
 */
export { DEFAULT_KICKOFF_COST_CEILING_USD } from '@forge/contracts';
import { DEFAULT_KICKOFF_COST_CEILING_USD } from '@forge/contracts';

/**
 * R6-04 (WI-2): the sane absolute maximum an operator kickoff ceiling may not
 * exceed, enforced at the `POST /api/agents/:slug/run` route boundary. A
 * would-be ceiling above this is refused with a 400 before any dispatch.
 */
export { MAX_KICKOFF_COST_CEILING_USD } from '@forge/contracts';

/**
 * Resolve the default per-kickoff cost ceiling served to the kickoff UI
 * (`GET /api/studio/agents`'s `defaultCostCeilingUsd`). Precedence:
 *   1. `runs.defaultCostCeilingUsd` from `forge.config.json`
 *   2. `DEFAULT_KICKOFF_COST_CEILING_USD`
 * Non-finite / non-positive config values are ignored (fall through) — a
 * zero/negative default would pre-fill the kickoff UI with a dead-on-arrival
 * ceiling.
 */
export function resolveDefaultKickoffCeilingUsd(cfg: ForgeConfig = loadConfig()): number {
  const fromCfg = cfg.runs?.defaultCostCeilingUsd;
  if (typeof fromCfg === 'number' && Number.isFinite(fromCfg) && fromCfg > 0) return fromCfg;
  return DEFAULT_KICKOFF_COST_CEILING_USD;
}
