/**
 * R5-02 (G8 env-pin, allowlist hardening) — the single allowlist governing
 * which AMBIENT (inherited) env vars an SDK-spawned agent child may see, and
 * the pure function that builds a child's full env from it.
 *
 * Replaces the prior denylist (`AGENT_ENV_DENYLIST` / `pinnedAgentEnv`,
 * removed from orchestrator/config.ts). A denylist only stops leaks the
 * author already thought of; the env-leak class recurred three times
 * (2026-06-16, 2026-07-02, 2026-07-11 — see
 * brain/forge-dev/themes/env-leak-must-be-fixed-at-spawn-seam-not-launcher.md)
 * via NEW vars nobody had denylisted yet. An allowlist inverts the failure
 * mode: an unrecognised var is stripped by construction, not by omission.
 *
 * Every entry below is enumerated from evidence, not guessed:
 *   - PATH: hard requirement. `node_modules/@anthropic-ai/claude-agent-sdk`'s
 *     `ProcessTransport` spawns `node`/`bun` via `child_process.spawn(command,
 *     args, { env })` with a BARE command name — Node resolves that command
 *     using the CHILD env's own PATH, not the parent process's. Omit PATH
 *     here and every one of forge's 5 spawn launch paths fails outright.
 *   - HOME: the spawned CLI locates its own config/credentials at
 *     `CLAUDE_CONFIG_DIR ?? homedir()/.claude` (confirmed in the SDK
 *     bundle); it is also the POSIX convention `git`/`npm`/`ssh` — the tools
 *     an agent's own Bash-tool calls invoke — rely on.
 *   - SHELL/TERM/LANG/LC_ALL/LC_CTYPE/LANGUAGE: locale + terminal basics an
 *     agent's Bash-tool shell commands (npm test, git, project build
 *     tooling) need for correct behaviour and readable, locale-stable output.
 *   - TMPDIR/TMP/TEMP: temp-file basics common CLI tooling expects.
 *   - USER/LOGNAME: generic process identity some tools (git, ssh) consult.
 *   - ANTHROPIC_API_KEY: the one auth var forge's own `.env.example`
 *     documents as required for the SDK to authenticate — allowed
 *     explicitly per the design decision ("if the SDK needs an auth var,
 *     allow it explicitly").
 *
 * Deliberately NOT included: ANTHROPIC_BASE_URL, ANTHROPIC_CUSTOM_HEADERS,
 * any HEADROOM_* var, CLAUDE_EFFORT — the exact leak class this closes.
 * GH_TOKEN is also deliberately excluded: spawned agents are instructed
 * (every dev/unifier SKILL.md) never to call `gh` themselves — only the
 * orchestrator PROCESS calls `gh` directly, outside this seam entirely.
 *
 * No `.*` wildcards: every entry is a literal, explicit name.
 */
export const AGENT_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LANGUAGE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'USER',
  'LOGNAME',
  'ANTHROPIC_API_KEY',
] as const;

/**
 * Build the full env for an SDK-spawned agent child: an allowlist-filtered
 * snapshot of `parentEnv` (only `AGENT_ENV_ALLOWLIST` names, when defined),
 * with `overrides` layered on top unconditionally.
 *
 * `overrides` are the CALLER's own deliberate composition (e.g. the
 * git-identity SDK overlay's four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` keys) —
 * they always win, even for a key outside the allowlist, because they never
 * originate from ambient/host pollution: the only production call site that
 * sets them is forge's own code, not an inherited shell var. This is what
 * lets a per-WI/per-UWI override (like a distinct git author per work item)
 * coexist with a strict ambient allowlist without the wrapper needing two
 * different code paths.
 *
 * Pure: never mutates `parentEnv` or `overrides`, always returns a new
 * object. A key present with an `undefined` value (either side) is treated
 * as absent, never written back as the literal string `"undefined"`.
 */
export function buildChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of AGENT_ENV_ALLOWLIST) {
    const value = parentEnv[key];
    if (value !== undefined) result[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    result[key] = value;
  }
  return result;
}
