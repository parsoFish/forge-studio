/**
 * Connection probing — real per-entry readiness (R3-04, `_wave5/specs/R3-04.md`
 * D3/D4/D11/D15). WI-2 of the initiative: consumes WI-1's
 * `ConnectionDefinition` (`connection-library.ts`) and turns it into a REAL,
 * executed readiness state — never a declared/attributed one.
 *
 * State machine (D3, the ONLY three states):
 *   - `not-installed`  — the install-method presence check fails (command
 *     unresolvable on PATH, or the pinned npm package absent from the
 *     connections root).
 *   - `available`      — present, the probe itself succeeds, and every
 *     REQUIRED config env-var NAME is set.
 *   - `misconfigured`  — present, but the probe failed (nonzero exit /
 *     timeout) OR a required config env-var NAME is unset. Always carries the
 *     REAL evidence (exit code, captured output, missing NAMES) — never a
 *     generic error string (F2 acceptance criterion).
 *
 * Per-target reality (D3): every connection is probed with its OWN execution.
 * There is no shared scan and no memoization — two connections that happen to
 * share a probe binary still each get a real, independent run.
 *
 * D15 — `probe.kind` is a discriminated union with fundamentally different
 * runtime semantics, dispatched in `probeConnection`:
 *   - `command`          — spawn the declared argv for real; exit code +
 *     captured output decide the state.
 *   - `command-presence` — resolve the command on PATH and NEVER execute it.
 *     Exists because some curated entries (`fetch`, `sqlite`) have no
 *     upstream-verified probe flag — inventing one risks hanging a real
 *     server process and fabricating a signal for a healthy install.
 *   - `npm-package`      — read the pinned package's OWN `package.json` under
 *     the connections root and require its `version` to equal the pin
 *     EXACTLY. Never spawns anything (neither shipped npm entry has any
 *     `--version` handling upstream — a command-invocation probe would
 *     misreport a healthy install as broken).
 *
 * D11 — probe env: every REAL spawn in this module (kind:'command' only —
 * the other two kinds never spawn) composes `buildChildEnv(parentEnv, {})`
 * over `HOOK_ENV_BASE_ALLOWLIST`, mirroring `hook-runtime.ts`'s
 * `buildHookChildEnv` exactly — NEVER the wider `AGENT_ENV_ALLOWLIST`. A
 * curated probe is *more* trusted than a third-party hook script, so reusing
 * the NARROWER hook base is conservative, not miscalibrated: reusing the
 * wider agent allowlist would hand every probe the operator's real API key
 * for no reason. Stated limit, out loud: because the probe child never
 * receives a credential, a probe can verify presence + configuration-name
 * presence, but it can NEVER verify *credentialed* connectivity — "available"
 * means "installed and the config names it needs are set", not "the
 * credential actually works". Callers/UI copy must not imply otherwise.
 *
 * `installArgvFor`/`installConnection` (D6/D7/D13) and `connectionsReadinessFor`
 * (WI-3's shared combinator) live in sibling modules
 * (`connection-install.ts`/`connection-readiness.ts`) to keep this file under
 * the house 400-line preference, and are re-exported below so every name the
 * acceptance tests import stays reachable from this one path.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join, relative, resolve } from 'node:path';

import { HOOK_ENV_BASE_ALLOWLIST, buildChildEnv } from '@forge/kernel/spawn-env.ts';
import type { ConnectionConfigVar, ConnectionDefinition, ConnectionProbeSpec } from './connection-library.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The three states D3 allows — closed, exhaustive. */
export const PROBE_STATES = ['not-installed', 'available', 'misconfigured'] as const;
export type ProbeState = (typeof PROBE_STATES)[number];

/** Bounded wall-clock budget for a single probe spawn (kind:'command' only).
 *  Probe commands are lightweight (`--version`, presence checks) — a probe
 *  that has not returned within this window is treated as `misconfigured`
 *  with `timedOut: true`, never left to hang the caller. */
export const PROBE_TIMEOUT_MS = 10_000;

/** Install root (D13/"Install root") — gitignored, house convention
 *  alongside `_queue/`/`_logs/`. Created on demand by the real installer. */
export const CONNECTIONS_DIR = '_connections';

/** Captured stdout/stderr beyond this many characters is truncated with an
 *  explicit marker (D3) — the evidence stays real, just bounded. */
const OUTPUT_TRUNCATE_CHARS = 4_000;

function truncateOutput(output: string): string {
  if (output.length <= OUTPUT_TRUNCATE_CHARS) return output;
  const omitted = output.length - OUTPUT_TRUNCATE_CHARS;
  return `${output.slice(0, OUTPUT_TRUNCATE_CHARS)}\n…[truncated ${omitted} more character(s)]`;
}

// ---------------------------------------------------------------------------
// ProbeResult — the one shared output shape every probe kind produces, so
// connectionsReadinessFor (connection-readiness.ts) never has to branch on
// probe kind itself (D-D).
// ---------------------------------------------------------------------------

export interface ProbeResult {
  readonly state: ProbeState;
  readonly exitCode?: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly timedOut?: boolean;
  readonly missingConfig?: string[];
  readonly installedVersion?: string;
  readonly pinnedVersion?: string;
}

// ---------------------------------------------------------------------------
// deriveProbeState — pure, kind-discriminated (D-B). No I/O.
// ---------------------------------------------------------------------------

interface ExecResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
}

export type DeriveProbeStateInput =
  | { kind: 'command'; presenceOk: boolean; exec?: ExecResult; missingConfig: string[] }
  | { kind: 'command-presence'; presenceOk: boolean; missingConfig: string[] }
  | {
      kind: 'npm-package';
      presenceOk: boolean;
      versionMatches: boolean;
      installedVersion?: string;
      pinnedVersion: string;
      missingConfig: string[];
    };

export function deriveProbeState(input: DeriveProbeStateInput): ProbeResult {
  // D3: presence check fails ⇒ not-installed, for every kind — exec/version
  // is never even consulted (the campaign's declared-data-fails-open guard,
  // applied here to "don't infer readiness past a failed presence check").
  if (!input.presenceOk) return { state: 'not-installed' };

  if (input.kind === 'command') {
    const { exec, missingConfig } = input;
    if (!exec) {
      // Contract violation, not a real probe outcome: a caller claiming
      // presenceOk:true for a "command" probe must have actually run it.
      // Fail fast rather than fabricate a state from nothing.
      throw new Error(
        'deriveProbeState: kind "command" with presenceOk=true requires an "exec" result — a probe that is present must have actually been executed',
      );
    }
    if (exec.timedOut) {
      return {
        state: 'misconfigured',
        exitCode: exec.exitCode,
        stdout: truncateOutput(exec.stdout),
        stderr: truncateOutput(exec.stderr),
        timedOut: true,
        missingConfig,
      };
    }
    if (exec.exitCode !== 0 || missingConfig.length > 0) {
      return {
        state: 'misconfigured',
        exitCode: exec.exitCode,
        stdout: truncateOutput(exec.stdout),
        stderr: truncateOutput(exec.stderr),
        missingConfig,
      };
    }
    // Available still carries the real captured output (D11's env-leak ATs
    // read the probed child's own stdout to prove what it did/didn't see) —
    // "available" means the evidence looked clean, not that the evidence was
    // discarded.
    return {
      state: 'available',
      exitCode: exec.exitCode,
      stdout: truncateOutput(exec.stdout),
      stderr: truncateOutput(exec.stderr),
    };
  }

  if (input.kind === 'command-presence') {
    if (input.missingConfig.length > 0) {
      return { state: 'misconfigured', missingConfig: input.missingConfig };
    }
    return { state: 'available' };
  }

  // input.kind === 'npm-package'
  const { versionMatches, installedVersion, pinnedVersion, missingConfig } = input;
  if (!versionMatches || missingConfig.length > 0) {
    return { state: 'misconfigured', installedVersion, pinnedVersion, missingConfig };
  }
  return { state: 'available' };
}

// ---------------------------------------------------------------------------
// Shared helpers for the REAL runner
// ---------------------------------------------------------------------------

/** Config handling (D5): a required config var is "missing" iff its NAME is
 *  unset in `process.env`. This is the ONLY thing this module ever does with
 *  `process.env[name]` — a presence test, never a read/log/return of the
 *  value itself (there is an AT that plants a sentinel value and requires it
 *  to appear in no payload; this function never puts the value anywhere). */
function computeMissingConfig(config: ConnectionConfigVar[]): string[] {
  return config.filter((c) => c.required && process.env[c.env] === undefined).map((c) => c.env);
}

/** D11 — the probe child's env base: pre-filter `parentEnv` down to
 *  `HOOK_ENV_BASE_ALLOWLIST` BEFORE calling `buildChildEnv`, mirroring
 *  `hook-runtime.ts`'s `buildHookChildEnv` exactly. Composing
 *  `buildChildEnv(parentEnv, {})` directly on the RAW parent env would filter
 *  by the wider `AGENT_ENV_ALLOWLIST` internally (which includes
 *  `ANTHROPIC_API_KEY`) — pre-narrowing first is what actually keeps the
 *  credential out; skipping this step would be the exact leak D11 forbids.
 *
 * Exported (round-6 FIX-FIRST, MAJOR item 2) so the install executor
 * (`cli/bridge-studio-connections.ts`) can reuse this EXACT filter for the
 * npm install child's environment, rather than a second hand-rolled copy. An
 * install child is at least as untrusted as a probe child — `--ignore-scripts`
 * blocks npm lifecycle-script execution, it does nothing to keep a credential
 * out of the child's environment — so the same narrow, credential-free base
 * applies. Env leaks in this repo get fixed at the shared seam, never
 * per-launcher; duplicating the filter is how the next one drifts.
 *
 * STATED LIMIT of that reuse (adversarial review round 2, MINOR-1): the
 * allowlist strips `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`, `npm_config_*` and
 * `NODE_EXTRA_CA_CERTS`, so an install on a network that needs proxy or custom
 * CA settings **from the environment** will fail. `HOME` survives, so the
 * `~/.npmrc` route to a registry, a proxy or an auth token still works, and
 * that is the supported path. This is a deliberate trade — a narrow env that
 * cannot leak the operator's API key, against convenience for an
 * env-var-configured proxy — and it is written down rather than discovered
 * later by whoever's install mysteriously times out. */
export function buildProbeChildEnv(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const probeBaseEnv: NodeJS.ProcessEnv = {};
  for (const name of HOOK_ENV_BASE_ALLOWLIST) {
    const value = parentEnv[name];
    if (value !== undefined) probeBaseEnv[name] = value;
  }
  return buildChildEnv(probeBaseEnv, {});
}

/** Real PATH resolution, shared by `command`'s presence pre-check and
 *  `command-presence`'s whole implementation. A command containing a path
 *  separator is checked directly (mirrors POSIX execvp: a name with a `/`
 *  is never PATH-searched); a bare name is checked against every PATH
 *  directory. NEVER executes anything — existence + regular-file only. */
function resolveOnPath(command: string, pathEnvStr: string): boolean {
  if (command.includes('/')) return existsSync(command) && statSync(command).isFile();
  const dirs = pathEnvStr.split(delimiter).filter((d) => d.length > 0);
  return dirs.some((dir) => {
    const candidate = join(dir, command);
    return existsSync(candidate) && statSync(candidate).isFile();
  });
}

/** Path-traversal guard (house convention): resolve the pinned package's
 *  `package.json` path and refuse if it would land outside
 *  `<connectionsRoot>/node_modules` — a catalog `install.package` value is
 *  curated, but nothing here re-derives that trust; the guard holds even if
 *  a future caller feeds this an unreviewed value. */
function resolvePackageJsonPath(forgeRoot: string, pkg: string): string {
  const nodeModulesRoot = resolve(forgeRoot, CONNECTIONS_DIR, 'node_modules');
  const candidate = resolve(nodeModulesRoot, pkg, 'package.json');
  const rel = relative(nodeModulesRoot, candidate);
  if (rel.startsWith('..') || rel === '') {
    throw new Error(
      `connection-probe: npm package name "${pkg}" resolves outside the connections root's node_modules (${nodeModulesRoot}) — refusing (path-traversal guard)`,
    );
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// probeConnection — the REAL runner (D4), dispatching on probe.kind (D15).
// ---------------------------------------------------------------------------

export interface ProbeConnectionOptions {
  /** kind:'command' ONLY — TEST-INJECTION-ONLY replacement for the real
   *  spawnSync call. Production code never sets this. */
  exec?: (command: string, args: string[]) => ExecResult;
  /** kind:'command-presence' ONLY — TEST-INJECTION-ONLY override of the PATH
   *  string used for resolution. Defaults to the REAL `process.env.PATH` —
   *  there is an AT that calls with no opts at all and requires the real
   *  environment to be consulted. */
  pathEnv?: string;
  /** kind:'command' ONLY — TEST-INJECTION-ONLY shortening of the spawn timeout,
   *  so the real ETIMEDOUT branch can be exercised by a committed test instead
   *  of resting on a manual sanity check. Defaults to `PROBE_TIMEOUT_MS`;
   *  production code never sets it, and every other probe AT exercises that
   *  default. */
  timeoutMs?: number;
}

function probeCommand(
  probe: Extract<ConnectionProbeSpec, { kind: 'command' }>,
  missingConfig: string[],
  opts: ProbeConnectionOptions,
): ProbeResult {
  if (opts.exec) {
    const exec = opts.exec(probe.command, probe.args);
    return deriveProbeState({ kind: 'command', presenceOk: true, exec, missingConfig });
  }

  const env = buildProbeChildEnv(process.env);
  const presenceOk = resolveOnPath(probe.command, env['PATH'] ?? '');
  if (!presenceOk) {
    return deriveProbeState({ kind: 'command', presenceOk: false, missingConfig });
  }

  const spawned = spawnSync(probe.command, probe.args, {
    shell: false,
    timeout: opts.timeoutMs ?? PROBE_TIMEOUT_MS,
    encoding: 'utf8',
    env,
  });

  if (spawned.error) {
    const code = (spawned.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') {
      return deriveProbeState({
        kind: 'command',
        presenceOk: true,
        exec: { exitCode: spawned.status, stdout: spawned.stdout ?? '', stderr: spawned.stderr ?? '', timedOut: true },
        missingConfig,
      });
    }
    // Presence was already confirmed by resolveOnPath — any OTHER spawn
    // failure here (e.g. a permission error, or the file vanishing between
    // the check and the spawn) is real evidence the command is present but
    // broken. Surface the real message; never swallow it or fabricate a
    // generic string (D3's explicit F2 acceptance criterion).
    return deriveProbeState({
      kind: 'command',
      presenceOk: true,
      exec: { exitCode: spawned.status, stdout: spawned.stdout ?? '', stderr: spawned.error.message, timedOut: false },
      missingConfig,
    });
  }

  return deriveProbeState({
    kind: 'command',
    presenceOk: true,
    exec: { exitCode: spawned.status, stdout: spawned.stdout ?? '', stderr: spawned.stderr ?? '', timedOut: false },
    missingConfig,
  });
}

function probeCommandPresence(
  probe: Extract<ConnectionProbeSpec, { kind: 'command-presence' }>,
  missingConfig: string[],
  opts: ProbeConnectionOptions,
): ProbeResult {
  const pathEnvStr = opts.pathEnv ?? process.env['PATH'] ?? '';
  const presenceOk = resolveOnPath(probe.command, pathEnvStr);
  return deriveProbeState({ kind: 'command-presence', presenceOk, missingConfig });
}

function probeNpmPackage(forgeRoot: string, connection: ConnectionDefinition, missingConfig: string[]): ProbeResult {
  if (connection.install.method !== 'npm') {
    // D15's coherence table ties npm-package probes to npm installs; a lint
    // rule (WI-1's validateConnections) is meant to catch this at curation
    // time. Reaching here anyway (a hand-built ConnectionDefinition bypassing
    // lint) is a genuine contract violation — fail fast, don't guess a pin.
    throw new Error(
      `probeConnection: connection "${connection.id}" has probe.kind "npm-package" but install.method is "${connection.install.method}" — an npm-package probe requires an npm install pin (D15)`,
    );
  }
  const { package: pkg, version: pinnedVersion } = connection.install;
  const pkgJsonPath = resolvePackageJsonPath(forgeRoot, pkg);

  if (!existsSync(pkgJsonPath)) {
    return deriveProbeState({ kind: 'npm-package', presenceOk: false, versionMatches: false, pinnedVersion, missingConfig });
  }

  const raw = readFileSync(pkgJsonPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`probeConnection: "${connection.id}"'s installed package.json at ${pkgJsonPath} is not valid JSON — ${(err as Error).message}`);
  }
  const installedVersion = (parsed as Record<string, unknown>)['version'];
  if (typeof installedVersion !== 'string') {
    throw new Error(`probeConnection: "${connection.id}"'s installed package.json at ${pkgJsonPath} has no string "version" field`);
  }

  const versionMatches = installedVersion === pinnedVersion;
  return deriveProbeState({ kind: 'npm-package', presenceOk: true, versionMatches, installedVersion, pinnedVersion, missingConfig });
}

/**
 * The real runner (D4). Every call is a genuinely independent execution —
 * this function holds no cache/memo, so per-target reality (D3) falls out of
 * simply never sharing state between calls.
 */
export function probeConnection(
  forgeRoot: string,
  connection: ConnectionDefinition,
  opts: ProbeConnectionOptions = {},
): ProbeResult {
  const missingConfig = computeMissingConfig(connection.config);
  switch (connection.probe.kind) {
    case 'command':
      return probeCommand(connection.probe, missingConfig, opts);
    case 'command-presence':
      return probeCommandPresence(connection.probe, missingConfig, opts);
    case 'npm-package':
      return probeNpmPackage(forgeRoot, connection, missingConfig);
  }
}

// ---------------------------------------------------------------------------
// Re-exports (D6/D7/D13 install; WI-3's readiness combinator) — kept in
// sibling modules to stay under the house 400-line file-size preference,
// re-exported here so every name the acceptance tests import resolves from
// this one path.
// ---------------------------------------------------------------------------

