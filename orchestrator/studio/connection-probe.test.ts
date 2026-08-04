/**
 * Acceptance tests for orchestrator/studio/connection-probe.ts (R3-04-F2/F3/
 * F4, D3/D4/D6/D11/D13-D16 of `_wave5/specs/R3-04.md`) — DOES NOT EXIST YET.
 * This file is RED at branch base (`Cannot find module './connection-probe.ts'`)
 * — the expected, deliberate red. Do not stub the module into existence.
 *
 * ROUND 3 SCHEMA CHANGE (D15): `probe:` is a KIND-tagged discriminated union
 * (`command` | `command-presence` | `npm-package`), each with fundamentally
 * different runtime semantics:
 *   - `command`  — spawnSync the argv for real, exit code + output decide
 *     the state (unchanged from round 1/2).
 *   - `command-presence` — resolve the command on PATH via a real filesystem
 *     scan, NEVER spawn it. Exists because `fetch`/`sqlite` have no
 *     upstream-verified probe flag; inventing one would hang a real server
 *     process and fabricate a `misconfigured` signal for a healthy install.
 *   - `npm-package` — read the pinned package's OWN `package.json` under
 *     `<forgeRoot>/_connections/node_modules/<pkg>/package.json` and require
 *     `version` to equal the pin EXACTLY. Never spawns anything (verified:
 *     neither `@modelcontextprotocol/server-filesystem` nor `-memory` has
 *     any `--version` handling in `dist/index.js` — a command-invocation
 *     probe would misreport a healthy install as broken).
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS MADE HERE THAT WERE NOT SPECIFIED (ratify or redirect):
 *
 *  D-A. Module surface: PROBE_STATES, ProbeState, ProbeResult,
 *       deriveProbeState, probeConnection, PROBE_TIMEOUT_MS, CONNECTIONS_DIR
 *       (`_connections`, D13's install root — gitignored, house convention),
 *       installArgvFor, installConnection, connectionsReadinessFor.
 *  D-B. `deriveProbeState` is PURE and now takes a KIND-DISCRIMINATED input
 *       (mine to shape, since D15 doesn't specify the pure function's own
 *       signature — only the runtime semantics table): `{kind:'command',
 *       presenceOk, exec?, missingConfig}` | `{kind:'command-presence',
 *       presenceOk, missingConfig}` | `{kind:'npm-package', presenceOk,
 *       versionMatches, installedVersion?, pinnedVersion, missingConfig}`.
 *       One shared function, one shared `ProbeResult` output shape, so
 *       `connectionsReadinessFor` never has to branch on probe kind itself.
 *  D-C. `probeConnection(forgeRoot, connection, opts?)` is the REAL runner,
 *       dispatching on `connection.probe.kind`:
 *         - `command`: real `spawnSync` with `buildChildEnv(parentEnv, {})`
 *           over `HOOK_ENV_BASE_ALLOWLIST` (D11) + a bounded timeout.
 *           `opts.exec` is TEST-INJECTION-ONLY.
 *         - `command-presence`: a real filesystem PATH scan (split
 *           `process.env.PATH`, check each `<dir>/<command>` for existence)
 *           — NEVER a spawn. `opts.pathEnv` (a raw PATH string) is
 *           TEST-INJECTION-ONLY, so a test can point it at a temp dir
 *           without mutating the real process env.
 *         - `npm-package`: reads
 *           `<forgeRoot>/_connections/node_modules/<pkg>/package.json` for
 *           real — no injection needed, a test just writes/omits the real
 *           fixture file.
 *  D-D. `connectionsReadinessFor(def, probeResults)` (WI-3's shared
 *       combinator) is CO-LOCATED here rather than in a new module — a
 *       light, pure function over `ProbeState`/`ProbeResult`, kind-agnostic
 *       (it only ever looks at `.state`, never `.kind`).
 *  D-E. Install (D6): `installArgvFor(connection, connectionsRoot)` returns
 *       `{ command: 'npm', args: string[] }`. Throws for BOTH
 *       `system-provided` AND `external` (D13: neither has a forge-driven
 *       install path — this is the SAME throw condition installable:false
 *       already names, not a new install-only rule). `installConnection`'s
 *       round trip (D7: no real `npm install`, ever) works by having the
 *       injected executor perform the ONE side effect a real `npm install`
 *       would leave behind — writing the pinned package's `package.json`
 *       into the real (temp) connections root — so the REAL post-install
 *       `probeConnection` re-probe runs genuinely, reading real disk state,
 *       rather than being itself re-injected a second time.
 * ---------------------------------------------------------------------------
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentDefinition } from './types.ts';

import {
  deriveProbeState,
  probeConnection,
  installArgvFor,
  installConnection,
  connectionsReadinessFor,
  type ProbeResult,
} from './connection-probe.ts';
import type { ConnectionDefinition } from './connection-library.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const envKeysToRestore = new Map<string, string | undefined>();
const createdDirs: string[] = [];
after(() => {
  for (const [key, value] of envKeysToRestore) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});
function setEnvForTest(key: string, value: string): void {
  if (!envKeysToRestore.has(key)) envKeysToRestore.set(key, process.env[key]);
  process.env[key] = value;
}
function tmpRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function makeConnection(overrides: Partial<ConnectionDefinition> = {}): ConnectionDefinition {
  return {
    id: 'fixture-conn',
    name: 'Fixture Connection',
    kind: 'tool',
    install: { method: 'system-provided' },
    installable: false,
    config: [],
    probe: { kind: 'command', command: 'node', args: ['--version'] },
    provenance: 'system',
    usedBy: [],
    usedByDerivation: { source: 'test', scanned: 0 },
    ...overrides,
  } as ConnectionDefinition;
}

function makeAgentDef(slug: string, tools: string[], mcps: string[]): AgentDefinition {
  return {
    slug,
    name: slug,
    description: `Agent ${slug}.`,
    purpose: 'Test purpose.',
    composition: { skills: [], tools, mcps, hooks: [], guards: [] },
    runtime: { sdk: 'claude', strategy: 'fixed' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: 'Body.',
    path: `/fake/${slug}/SKILL.md`,
  } as AgentDefinition;
}

/** Write a real, minimal package.json under a fake connections-root's
 *  node_modules — exactly what npm install would leave behind. */
function writeInstalledPackageJson(forgeRoot: string, pkg: string, version: string): void {
  const dir = join(forgeRoot, '_connections', 'node_modules', pkg);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg, version }), 'utf8');
}

// ===========================================================================
// deriveProbeState — the pure, KIND-DISCRIMINATED state machine (D3/D15)
// ===========================================================================

describe('deriveProbeState — kind:"command" (unchanged three-state machine, D3)', () => {
  it('presence check fails → not-installed (exec is never even consulted)', () => {
    const result = deriveProbeState({ kind: 'command', presenceOk: false, missingConfig: [] });
    assert.equal(result.state, 'not-installed');
  });

  it('present, exit 0, no missing config → available', () => {
    const result = deriveProbeState({ kind: 'command', presenceOk: true, exec: { exitCode: 0, stdout: 'v1.2.3', stderr: '' }, missingConfig: [] });
    assert.equal(result.state, 'available');
  });

  it('present, exit != 0 → misconfigured, carrying the REAL exit code + captured output (never a generic string)', () => {
    const result = deriveProbeState({ kind: 'command', presenceOk: true, exec: { exitCode: 1, stdout: 'partial output', stderr: 'boom: connection refused' }, missingConfig: [] });
    assert.equal(result.state, 'misconfigured');
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, 'partial output');
    assert.equal(result.stderr, 'boom: connection refused');
  });

  it('present, timed out → misconfigured, timedOut: true', () => {
    const result = deriveProbeState({ kind: 'command', presenceOk: true, exec: { exitCode: null, stdout: '', stderr: '', timedOut: true }, missingConfig: [] });
    assert.equal(result.state, 'misconfigured');
    assert.equal(result.timedOut, true);
  });

  it('present, exec succeeds, but a required config env-var NAME is missing → misconfigured, carrying the NAMES', () => {
    const result = deriveProbeState({ kind: 'command', presenceOk: true, exec: { exitCode: 0, stdout: 'ok', stderr: '' }, missingConfig: ['GITHUB_TOKEN'] });
    assert.equal(result.state, 'misconfigured');
    assert.deepEqual(result.missingConfig, ['GITHUB_TOKEN']);
  });
});

describe('deriveProbeState — kind:"command-presence" (D15: presence only, no exec ever)', () => {
  it('not resolvable on PATH → not-installed', () => {
    const result = deriveProbeState({ kind: 'command-presence', presenceOk: false, missingConfig: [] });
    assert.equal(result.state, 'not-installed');
  });

  it('resolvable, no missing config → available', () => {
    const result = deriveProbeState({ kind: 'command-presence', presenceOk: true, missingConfig: [] });
    assert.equal(result.state, 'available');
  });

  it('resolvable, but required config missing → misconfigured, carrying the NAMES', () => {
    const result = deriveProbeState({ kind: 'command-presence', presenceOk: true, missingConfig: ['X_TOKEN'] });
    assert.equal(result.state, 'misconfigured');
    assert.deepEqual(result.missingConfig, ['X_TOKEN']);
  });
});

describe('deriveProbeState — kind:"npm-package" (D15: version-pin check, NEVER exec)', () => {
  it('package absent from the connections root → not-installed', () => {
    const result = deriveProbeState({ kind: 'npm-package', presenceOk: false, versionMatches: false, pinnedVersion: '2026.7.4', missingConfig: [] });
    assert.equal(result.state, 'not-installed');
  });

  it('present, version matches the pin exactly, no missing config → available', () => {
    const result = deriveProbeState({ kind: 'npm-package', presenceOk: true, versionMatches: true, installedVersion: '2026.7.4', pinnedVersion: '2026.7.4', missingConfig: [] });
    assert.equal(result.state, 'available');
  });

  it('T2-mandated AT: present but at the WRONG version → misconfigured, NEVER available — a version-drifted install is a real state', () => {
    const result = deriveProbeState({ kind: 'npm-package', presenceOk: true, versionMatches: false, installedVersion: '2026.6.1', pinnedVersion: '2026.7.4', missingConfig: [] });
    assert.equal(result.state, 'misconfigured');
    assert.equal(result.installedVersion, '2026.6.1', 'the drift must carry BOTH the real installed version...');
    assert.equal(result.pinnedVersion, '2026.7.4', '...and the pin, so the operator can see the mismatch, not just "misconfigured"');
  });

  it('present, version matches, but required config missing → misconfigured, carrying the NAMES', () => {
    const result = deriveProbeState({ kind: 'npm-package', presenceOk: true, versionMatches: true, installedVersion: '1.0.0', pinnedVersion: '1.0.0', missingConfig: ['GITHUB_TOKEN'] });
    assert.equal(result.state, 'misconfigured');
    assert.deepEqual(result.missingConfig, ['GITHUB_TOKEN']);
  });
});

// ===========================================================================
// probeConnection — the REAL runner (D4), one describe per probe kind
// ===========================================================================

describe('probeConnection — kind:"command": REAL runner against real commands (D4)', () => {
  it('a real, guaranteed-present command ("node --version") → available', () => {
    const conn = makeConnection({ id: 'real-node', probe: { kind: 'command', command: 'node', args: ['--version'] } });
    const result = probeConnection(process.cwd(), conn);
    assert.equal(result.state, 'available', `expected available, got ${result.state} (stderr: ${result.stderr ?? ''})`);
  });

  it('a real, guaranteed-absent command → not-installed', () => {
    const conn = makeConnection({ id: 'real-absent', probe: { kind: 'command', command: 'definitely-absent-binary-xyz-forge-test', args: ['--version'] } });
    const result = probeConnection(process.cwd(), conn);
    assert.equal(result.state, 'not-installed');
  });

  it('a missing required config env-var on an otherwise-working probe → misconfigured, naming the var', () => {
    const conn = makeConnection({
      id: 'real-node-cfg',
      probe: { kind: 'command', command: 'node', args: ['--version'] },
      config: [{ env: 'FORGE_PROBE_TEST_UNSET_VAR_xyz', required: true, purpose: 'test' }],
    });
    delete process.env['FORGE_PROBE_TEST_UNSET_VAR_xyz'];
    const result = probeConnection(process.cwd(), conn);
    assert.equal(result.state, 'misconfigured');
    assert.deepEqual(result.missingConfig, ['FORGE_PROBE_TEST_UNSET_VAR_xyz']);
  });

  it('the required config env-var IS set → available (presence-only check, per D11 — never validates the VALUE)', () => {
    setEnvForTest('FORGE_PROBE_TEST_SET_VAR_xyz', 'anything-at-all');
    const conn = makeConnection({
      id: 'real-node-cfg-2',
      probe: { kind: 'command', command: 'node', args: ['--version'] },
      config: [{ env: 'FORGE_PROBE_TEST_SET_VAR_xyz', required: true, purpose: 'test' }],
    });
    const result = probeConnection(process.cwd(), conn);
    assert.equal(result.state, 'available');
  });
});

describe('probeConnection — kind:"command-presence": REAL PATH scan, NEVER executes (D15)', () => {
  // T2 ruling (round 4): these two ATs deliberately call probeConnection
  // with NO THIRD ARGUMENT AT ALL — the MANDATORY companion proof that the
  // production DEFAULT (no opts) really does consult the REAL
  // `process.env.PATH`, not merely that the injectable `opts.pathEnv` seam
  // works when a test bothers to supply it. This is the exact "optional
  // param the production caller forgets to wire" shape the campaign has
  // shipped four times: an implementer could default `pathEnv` to `''` (or
  // anything else disconnected from the real environment) and every OTHER
  // test in this describe block — which all pass their own `pathEnv`
  // explicitly — would still go green. These two cannot be faked that way:
  // 'node' resolving to `available` is only possible by actually consulting
  // the real environment's PATH; there is no other source that value could
  // come from.
  it('DEFAULT (no opts at all): a real, guaranteed-present command ("node") resolves against the REAL process.env.PATH → available', () => {
    const conn = makeConnection({ id: 'presence-node-default', probe: { kind: 'command-presence', command: 'node' } });
    const result = probeConnection(process.cwd(), conn);
    assert.equal(result.state, 'available', 'the default (unwired) path must consult the REAL process.env.PATH, not a disconnected/empty default');
  });

  it('DEFAULT (no opts at all): a real, guaranteed-absent command → not-installed', () => {
    const conn = makeConnection({ id: 'presence-absent-default', probe: { kind: 'command-presence', command: 'definitely-absent-binary-xyz-forge-presence-test' } });
    const result = probeConnection(process.cwd(), conn);
    assert.equal(result.state, 'not-installed');
  });

  it('opts.pathEnv INJECTED (a present command, via the seam, not the default): available', () => {
    const conn = makeConnection({ id: 'presence-node-injected', probe: { kind: 'command-presence', command: 'node' } });
    const result = probeConnection(process.cwd(), conn, { pathEnv: process.env.PATH ?? '' });
    assert.equal(result.state, 'available');
  });

  it('opts.pathEnv INJECTED (an absent command, via the seam): not-installed', () => {
    const conn = makeConnection({ id: 'presence-absent-injected', probe: { kind: 'command-presence', command: 'definitely-absent-binary-xyz-forge-presence-test' } });
    const result = probeConnection(process.cwd(), conn, { pathEnv: process.env.PATH ?? '' });
    assert.equal(result.state, 'not-installed');
  });

  it('T2-mandated AT (round 4 — rewritten to use opts.pathEnv, NEVER mutates process.env.PATH): a command that WOULD create a marker file if run leaves NO marker — command-presence never executes it', () => {
    // No process.env.PATH mutation anywhere in this test (round-3's version
    // did; T2 round-4 ruling: a process-global mutation in a suite node's
    // test runner may run concurrently is a flake vector, and a flaky
    // security AT is worse than none — it trains people to re-run until
    // green). The injectable opts.pathEnv seam makes this fully hermetic:
    // the real ambient process.env.PATH is never touched, read only via
    // process.env.PATH ?? '' to COMPOSE the injected value, never assigned.
    const root = tmpRoot('forge-presence-noexec-');
    const markerPath = join(root, 'marker.txt');
    const scriptPath = join(root, 'marker-writer');
    writeFileSync(scriptPath, `#!/usr/bin/env bash\ntouch "${markerPath}"\n`, 'utf8');
    // Executable bit — if this probe ever actually spawned the script, it
    // would need to be runnable; making it non-executable would let a
    // "not-installed" false-negative masquerade as "proof" of non-execution.
    chmodSync(scriptPath, 0o755);

    const conn = makeConnection({ id: 'marker-conn', probe: { kind: 'command-presence', command: 'marker-writer' } });
    const injectedPathEnv = `${root}${delimiter}${process.env.PATH ?? ''}`;
    const result = probeConnection(process.cwd(), conn, { pathEnv: injectedPathEnv });
    assert.equal(result.state, 'available', 'the script must be found on the injected PATH (proves the probe actually looked)');
    assert.equal(existsSync(markerPath), false, 'the marker file must NOT exist — command-presence must resolve without EVER executing the command');
  });
});

describe('probeConnection — kind:"npm-package": reads the REAL package.json, NEVER spawns anything (D15)', () => {
  it('package absent from the connections root → not-installed', () => {
    const root = tmpRoot('forge-npmpkg-absent-');
    const conn = makeConnection({
      id: 'absent-pkg',
      probe: { kind: 'npm-package' },
      install: { method: 'npm', package: '@forge-test/absent-pkg', version: '1.0.0' },
      installable: true,
    });
    const result = probeConnection(root, conn);
    assert.equal(result.state, 'not-installed');
  });

  it('package present at EXACTLY the pinned version → available', () => {
    const root = tmpRoot('forge-npmpkg-match-');
    writeInstalledPackageJson(root, '@forge-test/matched-pkg', '2026.7.4');
    const conn = makeConnection({
      id: 'matched-pkg',
      probe: { kind: 'npm-package' },
      install: { method: 'npm', package: '@forge-test/matched-pkg', version: '2026.7.4' },
      installable: true,
    });
    const result = probeConnection(root, conn);
    assert.equal(result.state, 'available');
  });

  it('T2-mandated AT: package present at a DIFFERENT (drifted) version → misconfigured, never available', () => {
    const root = tmpRoot('forge-npmpkg-drift-');
    writeInstalledPackageJson(root, '@forge-test/drifted-pkg', '2026.6.1');
    const conn = makeConnection({
      id: 'drifted-pkg',
      probe: { kind: 'npm-package' },
      install: { method: 'npm', package: '@forge-test/drifted-pkg', version: '2026.7.4' },
      installable: true,
    });
    const result = probeConnection(root, conn);
    assert.equal(result.state, 'misconfigured', 'a version-drifted install must read misconfigured, not available (D15 real finding)');
    assert.equal(result.installedVersion, '2026.6.1');
    assert.equal(result.pinnedVersion, '2026.7.4');
  });
});

// ===========================================================================
// Per-target reality (D3): two connections sharing a probe produce TWO
// independent executions; state is never copied from another's.
// ===========================================================================

describe('per-target reality: two connections sharing a probe command are probed independently', () => {
  it('a real present + a real absent command:kind connection sharing NOTHING but node.js as the runner never cross-contaminate', () => {
    const present = makeConnection({ id: 'shared-present', probe: { kind: 'command', command: 'node', args: ['--version'] } });
    const absent = makeConnection({ id: 'shared-absent', probe: { kind: 'command', command: 'definitely-absent-binary-xyz-forge-test-2', args: [] } });
    const r1 = probeConnection(process.cwd(), present);
    const r2 = probeConnection(process.cwd(), absent);
    assert.equal(r1.state, 'available');
    assert.equal(r2.state, 'not-installed', 'the absent connection must not inherit the present one\'s result');
  });

  it('an injected exec spy is called once PER connection — never memoized/shared across two connections with the identical probe spec', () => {
    let callCount = 0;
    const spyExec = (): { exitCode: number; stdout: string; stderr: string } => {
      callCount += 1;
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };
    const connA = makeConnection({ id: 'twin-a', probe: { kind: 'command', command: 'node', args: ['--version'] } });
    const connB = makeConnection({ id: 'twin-b', probe: { kind: 'command', command: 'node', args: ['--version'] } });
    probeConnection(process.cwd(), connA, { exec: spyExec });
    probeConnection(process.cwd(), connB, { exec: spyExec });
    assert.equal(callCount, 2, 'each connection must trigger its own independent execution, even with an identical probe spec');
  });

  it('two npm-package connections pinned to DIFFERENT versions of the SAME package name never share a result', () => {
    const root = tmpRoot('forge-npmpkg-twins-');
    writeInstalledPackageJson(root, '@forge-test/twin-pkg', '1.0.0');
    const matched = makeConnection({ id: 'twin-matched', probe: { kind: 'npm-package' }, install: { method: 'npm', package: '@forge-test/twin-pkg', version: '1.0.0' }, installable: true });
    const drifted = makeConnection({ id: 'twin-drifted', probe: { kind: 'npm-package' }, install: { method: 'npm', package: '@forge-test/twin-pkg', version: '9.9.9' }, installable: true });
    assert.equal(probeConnection(root, matched).state, 'available');
    assert.equal(probeConnection(root, drifted).state, 'misconfigured');
  });
});

// ===========================================================================
// Probe env (D11): the probe child does NOT see ANTHROPIC_API_KEY —
// asserted against a REAL spawned child, not by reading the allowlist
// constant. (kind:"command" only — the other two kinds never spawn.)
// ===========================================================================

describe('probe env (D11): a REAL spawned probe child does not see the credential allowlist exclusion', () => {
  it('ANTHROPIC_API_KEY set to a sentinel in the parent is ABSENT in the real probed child\'s env', () => {
    setEnvForTest('ANTHROPIC_API_KEY', 'sk-ant-test-sentinel-should-never-leak');
    const conn = makeConnection({
      id: 'env-leak-probe',
      probe: { kind: 'command', command: process.execPath, args: ['-e', 'process.stdout.write(process.env.ANTHROPIC_API_KEY ? "LEAKED" : "CLEAN")'] },
    });
    const result = probeConnection(process.cwd(), conn);
    assert.equal(result.state, 'available', `probe must itself succeed (exit 0) so stdout is trustworthy: ${JSON.stringify(result)}`);
    assert.equal(result.stdout?.trim(), 'CLEAN', 'the real spawned probe child must NOT receive ANTHROPIC_API_KEY (D11 / HOOK_ENV_BASE_ALLOWLIST)');
  });

  it('a real spawned probe child DOES see PATH (base hygiene, not stripped to nothing)', () => {
    const conn = makeConnection({
      id: 'env-path-probe',
      probe: { kind: 'command', command: process.execPath, args: ['-e', 'process.stdout.write(process.env.PATH ? "HASPATH" : "NOPATH")'] },
    });
    const result = probeConnection(process.cwd(), conn);
    assert.equal(result.stdout?.trim(), 'HASPATH');
  });
});

// ===========================================================================
// Install (D6/D13): argv byte-exact, throws for BOTH non-npm methods,
// injected-installer round trip that leaves the REAL side effect on disk.
// ===========================================================================

describe('installArgvFor: byte-exact argv derived from the catalog pin (D6, D16: memory is the round-trip example)', () => {
  it('the FULL argv array matches the spec exactly, byte-for-byte', () => {
    const conn = makeConnection({
      id: 'memory',
      install: { method: 'npm', package: '@modelcontextprotocol/server-memory', version: '2026.7.4' },
      installable: true,
    });
    const result = installArgvFor(conn, '/fake/connections-root');
    assert.equal(result.command, 'npm');
    assert.deepEqual(result.args, [
      'install',
      '--prefix',
      '/fake/connections-root',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      '@modelcontextprotocol/server-memory@2026.7.4',
    ]);
  });

  it('a system-provided entry has NO install argv at all — throws', () => {
    const conn = makeConnection({ id: 'git', install: { method: 'system-provided' }, installable: false });
    assert.throws(() => installArgvFor(conn, '/fake/connections-root'));
  });

  it('D13: an external entry has NO install argv either — throws (parallel to system-provided, NOT a special case)', () => {
    const conn = makeConnection({
      id: 'sqlite',
      install: { method: 'external', upstream: 'https://pypi.org/project/mcp-server-sqlite/' },
      installable: false,
      probe: { kind: 'command-presence', command: 'mcp-server-sqlite' },
    });
    assert.throws(() => installArgvFor(conn, '/fake/connections-root'));
  });
});

describe('installConnection: injected-installer round trip (D7 — NO real npm execution, ever)', () => {
  it('not-installed → install (injected executor writes the REAL post-install package.json) → available (REAL re-probe, not re-injected)', () => {
    const root = tmpRoot('forge-install-roundtrip-');
    const conn = makeConnection({
      id: 'round-trip-conn',
      install: { method: 'npm', package: '@forge-test/round-trip', version: '1.0.0' },
      installable: true,
      probe: { kind: 'npm-package' },
    });

    assert.equal(probeConnection(root, conn).state, 'not-installed', 'sanity: genuinely not installed before this test does anything');

    let installedArgv: { command: string; args: string[] } | undefined;
    const result = installConnection(root, conn, {
      executor: (command: string, args: string[]) => {
        installedArgv = { command, args };
        // The ONE side effect a real `npm install --prefix root --save-exact
        // @forge-test/round-trip@1.0.0` would leave — written by the test's
        // injected executor, never by an actual npm process.
        writeInstalledPackageJson(root, '@forge-test/round-trip', '1.0.0');
        return { exitCode: 0 };
      },
    });

    assert.ok(installedArgv, 'the injected executor must have been invoked — no real npm process spawned');
    assert.equal(installedArgv!.command, 'npm');
    assert.ok(installedArgv!.args.includes('@forge-test/round-trip@1.0.0'));
    assert.equal(result.ok, true);
    assert.equal(result.probeAfter.state, 'available', 'the round trip must end with a REAL re-probe reading real disk state, not an injected/assumed success');
  });

  it('the injected executor reporting a nonzero exit code → install fails, no package.json is written, re-probe reports not-installed', () => {
    const root = tmpRoot('forge-install-fail-');
    const conn = makeConnection({
      id: 'fail-install-conn',
      install: { method: 'npm', package: '@forge-test/fail-install', version: '1.0.0' },
      installable: true,
      probe: { kind: 'npm-package' },
    });
    const result = installConnection(root, conn, { executor: () => ({ exitCode: 1 }) });
    assert.equal(result.ok, false);
    assert.equal(result.probeAfter.state, 'not-installed');
  });

  it('a system-provided entry cannot be installed — throws before any executor is even considered', () => {
    const conn = makeConnection({ id: 'git', install: { method: 'system-provided' }, installable: false });
    assert.throws(() => installConnection(process.cwd(), conn, { executor: () => ({ exitCode: 0 }) }));
  });

  it('D13: an external entry cannot be installed either — throws, same as system-provided', () => {
    const conn = makeConnection({
      id: 'sqlite',
      install: { method: 'external', upstream: 'https://pypi.org/project/mcp-server-sqlite/' },
      installable: false,
      probe: { kind: 'command-presence', command: 'mcp-server-sqlite' },
    });
    assert.throws(() => installConnection(process.cwd(), conn, { executor: () => ({ exitCode: 0 }) }));
  });
});

// ===========================================================================
// connectionsReadinessFor (WI-3 shared combinator, D-D above) — kind-agnostic,
// only ever inspects .state.
// ===========================================================================

describe('connectionsReadinessFor: the pure readiness combinator runAgent + the bridge run route both consume', () => {
  const AVAILABLE: ProbeResult = { state: 'available' };
  const NOT_INSTALLED: ProbeResult = { state: 'not-installed' };
  const MISCONFIGURED: ProbeResult = { state: 'misconfigured', exitCode: 1, missingConfig: ['X'] };

  it('all bound connections available → [] (fully ready)', () => {
    const def = makeAgentDef('ready-agent', ['git'], ['memory']);
    const probes = new Map<string, ProbeResult>([['git', AVAILABLE], ['memory', AVAILABLE]]);
    assert.deepEqual(connectionsReadinessFor(def, probes), []);
  });

  it('an unbound agent (no tools/mcps) → [] regardless of probe results', () => {
    const def = makeAgentDef('no-tools-agent', [], []);
    assert.deepEqual(connectionsReadinessFor(def, new Map()), []);
  });

  it('a bound mcp that is not-installed → one unready entry, naming id/kind/state', () => {
    const def = makeAgentDef('unready-agent', [], ['sqlite']);
    const probes = new Map<string, ProbeResult>([['sqlite', NOT_INSTALLED]]);
    const unready = connectionsReadinessFor(def, probes);
    assert.equal(unready.length, 1);
    assert.equal(unready[0]!.id, 'sqlite');
    assert.equal(unready[0]!.kind, 'mcp');
    assert.equal(unready[0]!.state, 'not-installed');
  });

  it('a bound tool that is misconfigured → one unready entry', () => {
    const def = makeAgentDef('misconfigured-agent', ['git'], []);
    const probes = new Map<string, ProbeResult>([['git', MISCONFIGURED]]);
    const unready = connectionsReadinessFor(def, probes);
    assert.equal(unready.length, 1);
    assert.equal(unready[0]!.state, 'misconfigured');
  });

  it('a bound connection ABSENT from probeResults is treated as not-installed — never assumed available (declared-data-fails-open guard)', () => {
    const def = makeAgentDef('unprobed-agent', ['git'], []);
    const unready = connectionsReadinessFor(def, new Map());
    assert.equal(unready.length, 1);
    assert.equal(unready[0]!.id, 'git');
    assert.equal(unready[0]!.state, 'not-installed');
  });

  it('multiple unready components are ALL reported, not just the first', () => {
    const def = makeAgentDef('multi-unready-agent', ['git'], ['sqlite']);
    const probes = new Map<string, ProbeResult>([['git', NOT_INSTALLED], ['sqlite', MISCONFIGURED]]);
    const unready = connectionsReadinessFor(def, probes);
    assert.equal(unready.length, 2);
    assert.deepEqual(unready.map((u) => u.id).sort(), ['git', 'sqlite']);
  });
});

// Prove the real `spawnSync` import isn't accidentally shadowing anything —
// sanity that node:child_process really is usable in this environment.
describe('sanity: the test environment can spawn real child processes at all', () => {
  it('spawnSync("node", ["--version"]) succeeds in this environment', () => {
    const r = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
  });
});
