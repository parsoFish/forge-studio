/**
 * Connection install (R3-04 D6/D7/D13) — server-decided argv construction and
 * an injectable-executor install runner with a genuine post-install re-probe.
 *
 * D6 — the SERVER decides what is installed; a client only names a curated
 * id. `installArgvFor` derives the full argv ONLY from the catalog pin
 * (`connection.install`) — there is no parameter through which a caller can
 * influence the package name, version, or registry. This is the security
 * core of F4: an install route that accepted a package/version from the
 * client would be arbitrary remote code execution by design.
 *
 * D13 — `system-provided` AND `external` entries have NO forge-driven install
 * path (an `external` entry's whole point, per D13, is that forge does NOT
 * install it — the true answer, not a stub). Both throw, the same condition
 * `ConnectionDefinition.installable` already names.
 *
 * D7 — this module NEVER shells out to a real `npm install`. `installConnection`
 * takes an injected `executor` (the one production caller — the not-yet-built
 * WI-4 bridge route — will inject the real `spawnSync('npm', argv)` call);
 * this module only builds the argv and re-probes real disk state afterward.
 */

import { resolve } from 'node:path';

import { CONNECTIONS_DIR, probeConnection, type ProbeResult } from './connection-probe.ts';
import type { ConnectionDefinition } from './connection-library.ts';

export interface InstallArgv {
  readonly command: string;
  readonly args: string[];
}

/**
 * Byte-exact install argv (D6): `npm install --prefix <connectionsRoot>
 * --ignore-scripts --no-audit --no-fund --save-exact <pkg>@<version>`.
 *
 * `--ignore-scripts` because an MCP server is arbitrary third-party code and
 * npm lifecycle scripts execute on install — the roadmap places the trust
 * decision at curation time, and this narrows what curation has to trust.
 */
export function installArgvFor(connection: ConnectionDefinition, connectionsRoot: string): InstallArgv {
  if (connection.install.method !== 'npm') {
    throw new Error(
      `installArgvFor: connection "${connection.id}" has install.method "${connection.install.method}" — only an "npm" entry has a forge-driven install path (D13: "system-provided" and "external" both have none)`,
    );
  }
  const { package: pkg, version } = connection.install;
  return {
    command: 'npm',
    args: [
      'install',
      '--prefix',
      connectionsRoot,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      `${pkg}@${version}`,
    ],
  };
}

export interface InstallExecutorResult {
  readonly exitCode: number | null;
}

export interface InstallConnectionOptions {
  /** Runs the REAL install side effect. Production: `spawnSync('npm', args)`
   *  (the not-yet-built WI-4 bridge route). Tests inject a stand-in that
   *  performs the one real side effect a genuine `npm install` would leave
   *  behind (writing the pinned package's `package.json`), so the re-probe
   *  below reads real disk state rather than a second injection. */
  executor: (command: string, args: string[]) => InstallExecutorResult;
}

export interface InstallConnectionResult {
  readonly ok: boolean;
  readonly argv: InstallArgv;
  readonly probeAfter: ProbeResult;
}

/**
 * Install, then genuinely re-probe. A nonzero executor exit fails the install
 * (`ok: false`) and — because `probeAfter` is a REAL re-probe of real disk
 * state, never an assumed/injected success — a failed install cannot leave
 * the re-probe claiming `available`.
 */
export function installConnection(
  forgeRoot: string,
  connection: ConnectionDefinition,
  opts: InstallConnectionOptions,
): InstallConnectionResult {
  const connectionsRoot = resolve(forgeRoot, CONNECTIONS_DIR);
  const argv = installArgvFor(connection, connectionsRoot); // throws before the executor is ever considered for system-provided/external

  const execResult = opts.executor(argv.command, argv.args);
  const ok = execResult.exitCode === 0;
  const probeAfter = probeConnection(forgeRoot, connection);

  return { ok, argv, probeAfter };
}
