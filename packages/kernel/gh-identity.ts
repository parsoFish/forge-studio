/**
 * Which GitHub identity this host acts as when forge does something OUTWARD —
 * bead `forge-8vfn.6.11.35`, T1 rulings 341/344.
 *
 * THE INCIDENT it exists for (M5-B session 9, S2 run 6). `mintRemote` ran
 * `gh` with no token pin, so forge's one outward-facing action inherited
 * whatever account happened to be active on the host. That account was an
 * Enterprise Managed User, and the $0 probe caught the message an EMU gets:
 *
 *   GraphQL: Unauthorized: As an Enterprise Managed User, you cannot access
 *   this content (createRepository)
 *
 * `gh auth status` PASSED the whole time — that account IS logged in — and
 * that was the only question the old gate asked, so the failure landed on the
 * create instead of on the check meant to catch it, AFTER a complete scaffold.
 * Every human and agent `gh` command in this campaign is pinned per command
 * (rulings 284/286); this one code path was not.
 *
 * WHY IT LIVES IN KERNEL (ruling 344, composition A): "which identity does
 * this host act as" is a layout-and-identity fact, beside `loadConfig` and the
 * minted-remote manifest path, not policy belonging to any one package. It is
 * ADDITIVE — nothing here changes an existing signature.
 *
 * THE TOKEN NEVER LEAVES THIS FILE'S CALL STACK. It is read once per runner,
 * put in the CHILD process env only, never in argv (which `ps` shows), never
 * in this process's env, and never in a thrown message. That last rule is
 * tested: a secret in an error message is a secret in a log.
 *
 * Not to be confused with `spawn-env.ts`'s `AGENT_ENV_ALLOWLIST`, which
 * governs what an SDK-spawned AGENT child inherits. `GH_TOKEN` is deliberately
 * NOT on that list and nothing here puts it there: this pins one `gh`
 * subprocess, and agent children remain unable to see it.
 */

import { execFileSync } from 'node:child_process';

/** How a `gh` invocation actually runs. Injected in tests, so they never read a real keyring. */
export type GhExec = (args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) => string;

const defaultExec: GhExec = (args, opts) =>
  execFileSync('gh', args, { cwd: opts.cwd, env: opts.env, encoding: 'utf8' }).toString();

/**
 * The token `gh` holds for `owner`, from the local keyring.
 *
 * Fails loudly and names the owner rather than returning empty: a pin to
 * nothing is the un-pinned behaviour back again, wearing the fix's clothes.
 */
export function ghTokenFor(owner: string, exec: GhExec = defaultExec): string {
  let out: string;
  try {
    out = exec(['auth', 'token', '--user', owner], {});
  } catch (err) {
    throw new Error(
      `no gh token for "${owner}" on this host (\`gh auth token --user ${owner}\` failed: ` +
        `${err instanceof Error ? err.message : String(err)}). Run \`gh auth login\` as that account.`,
    );
  }
  const token = out.trim();
  if (token === '') throw new Error(`gh returned an EMPTY token for "${owner}" — refusing to pin to nothing.`);
  return token;
}

/**
 * Assert that the token pinned for `owner` really belongs to `owner`.
 *
 * The question the old gate should have asked. `gh auth status` answers "is
 * ANYONE logged in"; this answers "can THIS identity act as the owner we are
 * about to write under", which is the only version that catches the incident.
 *
 * The mismatch message names BOTH — the owner asked for and the login the
 * token actually carries — because either one alone is a riddle for whoever
 * reads the failure.
 */
export function assertGhOwner(owner: string, exec: GhExec | undefined = defaultExec): void {
  exec ??= defaultExec;
  const token = ghTokenFor(owner, exec);
  let login: string;
  try {
    login = exec(['api', 'user', '--jq', '.login'], { env: { ...process.env, GH_TOKEN: token } }).trim();
  } catch (err) {
    // Deliberately re-wrapped WITHOUT the token in scope of the message.
    throw new Error(
      `could not confirm the gh identity for "${owner}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (login !== owner) {
    throw new Error(
      `gh identity mismatch: forge is configured to act as "${owner}", but the token on this host names ` +
        `"${login}". Nothing outward was attempted. Fix the account (\`gh auth login\` as "${owner}") or ` +
        'change the configured owner — forge does not act under an identity the operator did not name.',
    );
  }
}

/**
 * A `gh` runner pinned to `owner` — every call carries that account's token in
 * the CHILD env.
 *
 * The token is read ONCE, when the runner is built, not once per call: an
 * outward action should not touch the keyring repeatedly, and a per-call read
 * would make the pin depend on the keyring staying put mid-operation.
 */
export function ghRunnerFor(owner: string, exec: GhExec = defaultExec): (args: string[], cwd?: string) => string {
  const token = ghTokenFor(owner, exec);
  return (args: string[], cwd?: string) => exec(args, { cwd, env: { ...process.env, GH_TOKEN: token } });
}
