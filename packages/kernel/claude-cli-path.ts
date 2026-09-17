/**
 * WHICH Claude Code binary an SDK spawn runs — `forge-8vfn.7.6.116`, T1 1066.
 *
 * WHAT BROKE. The Agent SDK pinned at `^0.1.0` (0.1.77) spawns its OWN BUNDLED
 * CLI, `node_modules/@anthropic-ai/claude-agent-sdk/cli.js`, whose product
 * constant reads `VERSION:"2.0.77"` beside `"@anthropic-ai/claude-code"`. That
 * binary carries an October 2025 Consumer Terms gate. Some time around
 * 20:08Z on 2026-09-17 the gate began firing in its BLOCKING form: the child
 * printed `[ACTION REQUIRED] … You must run \`claude\` to review the updated
 * terms` to stderr and exited 1 before any turn ran. S9 run 1 died there at
 * beat 8, $0 of a $25 ceiling — C had priced a real turn at 13:50Z the same
 * day, which brackets it to hours.
 *
 * NOTHING THE OPERATOR CAN DO IN A SHELL FIXES IT. They ran `claude`
 * interactively and were never prompted, because their installed CLI is 2.1.274
 * — a different binary with no such flow. The gate belongs to the OLD bundled
 * client, and no amount of accepting terms in the new one satisfies it.
 *
 * THE FIX IS TO NAME THE BINARY. The SDK honours
 * `Options.pathToClaudeCodeExecutable` (handled at `sdk.mjs:7647` and
 * `:7788-7790`) even though 0.1.77's `sdk.d.ts` does not declare it — which is
 * a non-issue here because `pinned-sdk-query.ts` already threads a plain
 * `Record<string, unknown>` options bag. Measured on this box: the operator's
 * `claude` is a symlink to `claude.exe`, a native ELF, so the SDK's own
 * `isNativeBinary` test (`path does not end in .js/.mjs/.ts/.tsx/.jsx`) is TRUE
 * and it is spawned DIRECTLY rather than handed to a node wrapper.
 *
 * THERE IS NO FALLBACK, AND THAT IS THE POINT (T1 1066). Falling back to the
 * bundled `cli.js` when the variable is absent would silently restore this
 * exact bug — a spawn that dies before its first turn, on a box where nothing
 * looks misconfigured. So an unset, missing, or non-executable value REFUSES,
 * naming the variable and the reason. Absence never resolves toward proceeding
 * (§15.504).
 *
 * DERIVATION IS THE LAUNCHER'S JOB, NOT THE PRODUCT'S. The story launchers and
 * `lanes.sh` derive the path (`command -v claude` → `readlink -f`) and PRINT
 * what they derived; this module only checks and refuses. A product that
 * searched `PATH` itself would be choosing a binary on the operator's behalf,
 * which is how the wrong one gets chosen quietly.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/** The one variable that names the CLI. Carried in `AGENT_ENV_ALLOWLIST`. */
export const CLAUDE_CLI_ENV = 'FORGE_CLAUDE_CLI';

export class ClaudeCliPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeCliPathError';
  }
}

const WHY =
  `The SDK's own bundled CLI is version 2.0.77 and its October 2025 Consumer Terms gate ` +
  `exits 1 before any turn runs, so there is deliberately NO fallback to it: falling back ` +
  `would restore forge-8vfn.7.6.116 silently. A launcher derives this value with ` +
  `\`command -v claude\` then \`readlink -f\` and prints what it derived.`;

/**
 * The absolute path of the Claude Code binary an SDK spawn must use.
 *
 * @throws ClaudeCliPathError when the variable is unset, relative, absent from
 *   disk, not a file, or not executable — each with its own sentence, because
 *   "it did not work" sends the reader looking and "it is not executable"
 *   does not.
 */
export function resolveClaudeCliPath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[CLAUDE_CLI_ENV];
  if (raw === undefined || raw.trim() === '') {
    throw new ClaudeCliPathError(
      `${CLAUDE_CLI_ENV} is not set, so no Claude Code binary is named for this spawn. ${WHY}`,
    );
  }
  const path = raw.trim();
  if (!isAbsolute(path)) {
    throw new ClaudeCliPathError(
      `${CLAUDE_CLI_ENV} is "${path}", which is not an ABSOLUTE path. A relative value resolves ` +
      `against whatever cwd the spawn happens to inherit, which is not a choice anyone made. ${WHY}`,
    );
  }
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new ClaudeCliPathError(
      `${CLAUDE_CLI_ENV} names "${path}", which is not on disk. ${WHY}`,
    );
  }
  if (!stat.isFile()) {
    throw new ClaudeCliPathError(
      `${CLAUDE_CLI_ENV} names "${path}", which exists but is not a file. ${WHY}`,
    );
  }
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new ClaudeCliPathError(
      `${CLAUDE_CLI_ENV} names "${path}", which is not EXECUTABLE by this user. ${WHY}`,
    );
  }
  return path;
}
