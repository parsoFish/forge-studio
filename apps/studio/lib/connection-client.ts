/**
 * Client-side fetch + parse helpers for the Studio connections-library bridge
 * routes (R3-04-F2/F3). Mirrors hook-client.ts's / template-client.ts's role
 * exactly — see cli/bridge-studio-connections.ts's own header for the
 * transport shapes this carries through verbatim.
 *
 * `parseConnection` is EXPORTED (not private), same rationale as
 * hook-client.ts's `parseHookLibraryEntry`: the `Array.isArray(x) ? x : []`
 * permissive-parse shape — a malformed/missing array silently becoming a
 * confident empty answer — is a defect this campaign has found three times.
 * Every parser below REFUSES (throws) on a malformed payload rather than
 * coercing it. A missing field means the server did not send it; inventing
 * one (a default `[]`, a guessed enum token, a fabricated `false`) destroys
 * the guarantee the field exists to provide.
 *
 * Tested ONLY via the pure `parseConnection` function
 * (forge-ui/lib/connection-client.test.ts) — no fetch, no window, no jsdom
 * (this repo's forge-ui vitest config is `environment: 'node'`, a standing
 * decision; the transport, `bridgeFetch`, requires `window`). The over-the-wire
 * behaviour (list/detail/probe/install round trips, the security core) is
 * pinned by cli/bridge-studio-connections.test.ts instead.
 */

import { bridgeFetch } from './bridge-client.ts';

// ---------------------------------------------------------------------------
// Types mirroring server shapes (orchestrator/studio/connection-library.ts,
// orchestrator/studio/connection-probe.ts, cli/bridge-studio-connections.ts)
// ---------------------------------------------------------------------------

export type ConnectionKind = 'tool' | 'mcp';

export type ConnectionInstallMethod =
  | { method: 'system-provided' }
  | { method: 'npm'; package: string; version: string }
  | { method: 'external'; upstream: string };

export type ConnectionConfigVar = { env: string; required: boolean; purpose: string };

export type ConnectionCapability = { name: string; summary: string };

export const CONNECTION_PROBE_STATES = ['not-installed', 'available', 'misconfigured'] as const;
export type ConnectionProbeState = (typeof CONNECTION_PROBE_STATES)[number];

export type ConnectionProbeResult = {
  state: ConnectionProbeState;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  missingConfig?: string[];
  installedVersion?: string;
  pinnedVersion?: string;
};

/** Names the real on-disk source a `usedBy` array was scanned from, and how
 *  many of that source were scanned — an empty `usedBy` always reads as
 *  "scanned N, found none", never "unknown". Mirrors hook-client.ts's
 *  `HookUsedByDerivation` / template-client.ts's `TemplateUsedByDerivation`. */
export type ConnectionUsedByDerivation = { source: string; scanned: number };

export type ConnectionWire = {
  id: string;
  name: string;
  desc?: string;
  kind: ConnectionKind;
  installable: boolean;
  install: ConnectionInstallMethod;
  config: ConnectionConfigVar[];
  probe: ConnectionProbeResult;
  provenance: string;
  usedBy: string[];
  usedByDerivation: ConnectionUsedByDerivation;
  /** `kind:'mcp'` entries that declare capabilities ONLY — a `kind:'tool'`
   *  entry, or an mcp entry the catalog declares none for, never carries this
   *  key (undefined, never a fabricated empty array — D8). */
  capabilities?: ConnectionCapability[];
  /** Present iff `capabilities` is present — the "derivation names itself"
   *  device (D8): a capability list is CURATED data, never presented as a
   *  verified live capability list of the running server. */
  capabilitiesSource?: 'curated';
};

// ---------------------------------------------------------------------------
// Parse helpers — REFUSE malformed input (throw), never coerce.
// ---------------------------------------------------------------------------

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function requireString(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  if (typeof v !== 'string') throw new Error(`expected "${key}" to be a string, got ${JSON.stringify(v)}`);
  return v;
}

function requireBoolean(r: Record<string, unknown>, key: string): boolean {
  const v = r[key];
  if (typeof v !== 'boolean') throw new Error(`expected "${key}" to be a boolean, got ${JSON.stringify(v)}`);
  return v;
}

function requireNumber(r: Record<string, unknown>, key: string): number {
  const v = r[key];
  if (typeof v !== 'number') throw new Error(`expected "${key}" to be a number, got ${JSON.stringify(v)}`);
  return v;
}

function parseKind(raw: unknown): ConnectionKind {
  if (raw === 'tool' || raw === 'mcp') return raw;
  throw new Error(`unrecognised connection kind: ${JSON.stringify(raw)}`);
}

/** Install is a discriminated union closed at exactly THREE methods (D13,
 *  round 3) — an unrecognised method (or a variant missing its own required
 *  sub-field) throws, never silently coerced to a guessed shape. */
function parseInstall(raw: unknown): ConnectionInstallMethod {
  const r = asRecord(raw);
  const method = r['method'];
  if (method === 'system-provided') return { method };
  if (method === 'npm') {
    return { method, package: requireString(r, 'package'), version: requireString(r, 'version') };
  }
  if (method === 'external') {
    return { method, upstream: requireString(r, 'upstream') };
  }
  throw new Error(`unrecognised connection install method: ${JSON.stringify(method)}`);
}

function parseConfigVar(raw: unknown): ConnectionConfigVar {
  const r = asRecord(raw);
  return { env: requireString(r, 'env'), required: requireBoolean(r, 'required'), purpose: requireString(r, 'purpose') };
}

/** `config` missing or non-array is a malformed response — never defaulted
 *  to `[]` (a curated entry with genuinely zero config vars sends `[]`
 *  explicitly; a missing/wrong-typed field means the transport is broken). */
function parseConfig(raw: unknown): ConnectionConfigVar[] {
  if (!Array.isArray(raw)) throw new Error(`expected "config" to be an array, got ${JSON.stringify(raw)}`);
  return raw.map(parseConfigVar);
}

function parseProbeState(raw: unknown): ConnectionProbeState {
  if ((CONNECTION_PROBE_STATES as readonly string[]).includes(raw as string)) return raw as ConnectionProbeState;
  throw new Error(`unrecognised connection probe state: ${JSON.stringify(raw)}`);
}

/** `probe` missing or non-object throws — never defaulted to
 *  `{state:"not-installed"}`, which would fabricate a readiness fact the
 *  server never sent (D3: readiness is EXECUTED, never declared/guessed). */
export function parseProbeResult(raw: unknown): ConnectionProbeResult {
  const r = asRecord(raw);
  const state = parseProbeState(r['state']);

  const exitCode = r['exitCode'];
  if (exitCode !== undefined && exitCode !== null && typeof exitCode !== 'number') {
    throw new Error(`expected "exitCode" to be a number, null, or absent, got ${JSON.stringify(exitCode)}`);
  }
  const stdout = r['stdout'];
  if (stdout !== undefined && typeof stdout !== 'string') {
    throw new Error(`expected "stdout" to be a string when present, got ${JSON.stringify(stdout)}`);
  }
  const stderr = r['stderr'];
  if (stderr !== undefined && typeof stderr !== 'string') {
    throw new Error(`expected "stderr" to be a string when present, got ${JSON.stringify(stderr)}`);
  }
  const timedOut = r['timedOut'];
  if (timedOut !== undefined && typeof timedOut !== 'boolean') {
    throw new Error(`expected "timedOut" to be a boolean when present, got ${JSON.stringify(timedOut)}`);
  }
  const missingConfig = r['missingConfig'];
  if (missingConfig !== undefined && (!Array.isArray(missingConfig) || !missingConfig.every((x) => typeof x === 'string'))) {
    throw new Error(`expected "missingConfig" to be a string array when present, got ${JSON.stringify(missingConfig)}`);
  }
  const installedVersion = r['installedVersion'];
  if (installedVersion !== undefined && typeof installedVersion !== 'string') {
    throw new Error(`expected "installedVersion" to be a string when present, got ${JSON.stringify(installedVersion)}`);
  }
  const pinnedVersion = r['pinnedVersion'];
  if (pinnedVersion !== undefined && typeof pinnedVersion !== 'string') {
    throw new Error(`expected "pinnedVersion" to be a string when present, got ${JSON.stringify(pinnedVersion)}`);
  }

  return {
    state,
    ...(exitCode !== undefined ? { exitCode: exitCode as number | null } : {}),
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
    ...(timedOut !== undefined ? { timedOut } : {}),
    ...(missingConfig !== undefined ? { missingConfig: missingConfig as string[] } : {}),
    ...(installedVersion !== undefined ? { installedVersion } : {}),
    ...(pinnedVersion !== undefined ? { pinnedVersion } : {}),
  };
}

/** `usedBy` absent, or present but not a string array, is a malformed
 *  response — never coerced to `[]` (the empty-vs-unknown distinction
 *  `usedByDerivation` exists to preserve). */
function parseUsedBy(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) {
    throw new Error(`expected "usedBy" to be a string array, got ${JSON.stringify(raw)}`);
  }
  return raw as string[];
}

function parseUsedByDerivation(raw: unknown): ConnectionUsedByDerivation {
  const r = asRecord(raw);
  return { source: requireString(r, 'source'), scanned: requireNumber(r, 'scanned') };
}

function parseCapability(raw: unknown): ConnectionCapability {
  const r = asRecord(raw);
  return { name: requireString(r, 'name'), summary: requireString(r, 'summary') };
}

/**
 * Parse one connection entry (list row or detail — same shape, D-1 in
 * cli/bridge-studio-connections.ts's header). THROWS on any malformed or
 * missing REQUIRED field, or an unrecognised enum token, rather than
 * coercing it to a plausible default — the refusal discipline this whole
 * module exists to enforce.
 */
export function parseConnection(raw: unknown): ConnectionWire {
  const r = asRecord(raw);

  const id = requireString(r, 'id');
  const name = requireString(r, 'name');

  const descRaw = r['desc'];
  if (descRaw !== undefined && typeof descRaw !== 'string') {
    throw new Error(`expected "desc" to be a string when present, got ${JSON.stringify(descRaw)}`);
  }

  const kind = parseKind(r['kind']);
  const installable = requireBoolean(r, 'installable');
  const install = parseInstall(r['install']);
  const config = parseConfig(r['config']);
  const probe = parseProbeResult(r['probe']);
  const provenance = requireString(r, 'provenance');
  const usedBy = parseUsedBy(r['usedBy']);
  const usedByDerivation = parseUsedByDerivation(r['usedByDerivation']);

  const capabilitiesRaw = r['capabilities'];
  let capabilities: ConnectionCapability[] | undefined;
  if (capabilitiesRaw !== undefined) {
    if (!Array.isArray(capabilitiesRaw)) {
      throw new Error(`expected "capabilities" to be an array when present, got ${JSON.stringify(capabilitiesRaw)}`);
    }
    capabilities = capabilitiesRaw.map(parseCapability);
  }

  const capabilitiesSourceRaw = r['capabilitiesSource'];
  let capabilitiesSource: 'curated' | undefined;
  if (capabilitiesSourceRaw !== undefined) {
    if (capabilitiesSourceRaw !== 'curated') {
      throw new Error(`unrecognised connection capabilitiesSource: ${JSON.stringify(capabilitiesSourceRaw)} — expected "curated"`);
    }
    capabilitiesSource = capabilitiesSourceRaw;
  }

  return {
    id,
    name,
    ...(descRaw !== undefined ? { desc: descRaw } : {}),
    kind,
    installable,
    install,
    config,
    probe,
    provenance,
    usedBy,
    usedByDerivation,
    ...(capabilities !== undefined ? { capabilities } : {}),
    ...(capabilitiesSource !== undefined ? { capabilitiesSource } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fetch helpers — over-the-wire behaviour pinned by
// cli/bridge-studio-connections.test.ts, not by this file's own test (see
// module header: no window/fetch under this repo's node-environment vitest).
// ---------------------------------------------------------------------------

function errorFrom(data: unknown, fallback: string): string {
  return isPlainObject(data) && typeof data['error'] === 'string' ? data['error'] : fallback;
}

/** Fetch the connections library. Distinguishes a reachable-but-empty library
 *  from an unreachable bridge or a malformed payload (`ok: false` for both)
 *  — never rendered the same way. */
export async function fetchConnections(): Promise<{ ok: boolean; connections: ConnectionWire[]; error?: string }> {
  let res: Response;
  try {
    res = await bridgeFetch(`/api/studio/connections`);
  } catch (err) {
    return { ok: false, connections: [], error: `bridge unreachable: ${String(err)}` };
  }

  try {
    const data = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, connections: [], error: errorFrom(data, `HTTP ${res.status}`) };
    if (!isPlainObject(data) || !Array.isArray(data['connections'])) {
      return {
        ok: false,
        connections: [],
        error: `malformed bridge response: "connections" ${isPlainObject(data) && 'connections' in data ? 'is not an array' : 'is missing'}`,
      };
    }
    return { ok: true, connections: (data['connections'] as unknown[]).map(parseConnection) };
  } catch (err) {
    return { ok: false, connections: [], error: `malformed bridge response: ${String(err)}` };
  }
}

/** Fetch a single connection's detail. `status` is surfaced so the caller can
 *  tell a genuine 404 (unknown id) apart from a reachable-but-erroring
 *  bridge — never conflated. */
export async function fetchConnectionDetail(
  id: string,
): Promise<{ ok: boolean; status?: number; connection?: ConnectionWire; error?: string }> {
  let res: Response;
  try {
    res = await bridgeFetch(`/api/studio/connections/${encodeURIComponent(id)}`);
  } catch (err) {
    return { ok: false, error: `bridge unreachable: ${String(err)}` };
  }

  try {
    const data = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, status: res.status, error: errorFrom(data, `HTTP ${res.status}`) };
    return { ok: true, status: res.status, connection: parseConnection(data) };
  } catch (err) {
    return { ok: false, status: res.status, error: `malformed bridge response: ${String(err)}` };
  }
}

/** Re-run the real probe for one connection (explicit user-triggered
 *  re-check, e.g. "I just set the env var, check again"). */
export async function probeConnection(id: string): Promise<{ ok: boolean; probe?: ConnectionProbeResult; error?: string }> {
  let res: Response;
  try {
    res = await bridgeFetch(`/api/studio/connections/${encodeURIComponent(id)}/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify({}),
    });
  } catch (err) {
    return { ok: false, error: `bridge unreachable: ${String(err)}` };
  }

  try {
    const data = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, error: errorFrom(data, `HTTP ${res.status}`) };
    const r = asRecord(data);
    return { ok: true, probe: parseProbeResult(r['probe']) };
  } catch (err) {
    return { ok: false, error: `malformed bridge response: ${String(err)}` };
  }
}

/** The D6/D7 security-core round trip, client side: this route is called
 *  with NO body except the `confirm` flag itself — package/version/registry
 *  are never client-supplied fields in the first place, so there is nothing
 *  here that COULD leak into the request (the server-side guarantee is that
 *  it never reads the body for anything but `confirm`; this client
 *  reinforces it by never sending anything else to read).
 *
 * forge-6gv.8.2 — the confirm gate (bridge-studio-connections.ts's own
 * header) means an UNCONFIRMED call returns a `preview` (ZERO network/
 * executor side effects on the bridge) rather than an install result — the
 * `preview` variant below is reached on every call this client makes unless
 * `{ confirm: true }` is explicitly requested (`installConnection(id,
 * {confirm:true})`). The three variants mirror the server's three DISJOINT
 * response shapes exactly: `{ok,preview}` / `{ok,suppressed,wouldInstall}` /
 * `{ok,installed,probe}` — never a shape this client invents. */
export type ConnectionInstallOutcome =
  | { ok: true; preview: InstallPreview }
  | { ok: true; suppressed: true; wouldInstall: { command: string; args: string[] } }
  | { ok: true; suppressed: false; installed: boolean; probe: ConnectionProbeResult };

/** forge-6gv.8.2 — the CONFIRM-BEFORE-INSTALL preview
 *  (studio/connection-install.ts's `InstallPreview`, carried verbatim):
 *  package, version, registry, the exact argv, and whether npm lifecycle
 *  scripts will run. Every field is REQUIRED — a preview response missing
 *  one is malformed, never defaulted. */
export type InstallPreview = {
  package: string;
  version: string;
  registry: string;
  command: string;
  args: string[];
  willRunLifecycleScripts: boolean;
};

function parseWouldInstall(raw: unknown): { command: string; args: string[] } {
  const r = asRecord(raw);
  const command = requireString(r, 'command');
  const args = r['args'];
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
    throw new Error(`expected "args" to be a string array, got ${JSON.stringify(args)}`);
  }
  return { command, args: args as string[] };
}

/** Exported (not private) so community-client.ts — the mcp/tool install
 *  branch there is "byte-identical" to this route's own (bridge-studio-
 *  community.ts's own header) — parses the SAME preview shape rather than
 *  maintaining a second, independently-drifting copy. */
export function parseInstallPreview(raw: unknown): InstallPreview {
  const r = asRecord(raw);
  const args = r['args'];
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
    throw new Error(`expected "args" to be a string array, got ${JSON.stringify(args)}`);
  }
  return {
    package: requireString(r, 'package'),
    version: requireString(r, 'version'),
    registry: requireString(r, 'registry'),
    command: requireString(r, 'command'),
    args: args as string[],
    willRunLifecycleScripts: requireBoolean(r, 'willRunLifecycleScripts'),
  };
}

export async function installConnection(
  id: string,
  opts?: { confirm?: boolean },
): Promise<{ ok: boolean; result?: ConnectionInstallOutcome; error?: string }> {
  const confirmed = opts?.confirm === true;
  let res: Response;
  try {
    res = await bridgeFetch(`/api/studio/connections/${encodeURIComponent(id)}/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(confirmed ? { confirm: true } : {}),
    });
  } catch (err) {
    return { ok: false, error: `bridge unreachable: ${String(err)}` };
  }

  try {
    const data = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, error: errorFrom(data, `HTTP ${res.status}`) };
    const r = asRecord(data);

    // Discriminate on the server's own disjoint key sets (never a second,
    // independently-maintained "which shape is this" guess): `preview` only
    // exists on the unconfirmed shape, `suppressed` only on the D7 dry-run
    // shape — `requireBoolean(r, 'installed')` below is reached ONLY once
    // both are ruled out, i.e. only on a genuine confirmed install result.
    if (r['preview'] !== undefined) {
      return { ok: true, result: { ok: true, preview: parseInstallPreview(r['preview']) } };
    }

    if (r['suppressed'] === true) {
      return { ok: true, result: { ok: true, suppressed: true, wouldInstall: parseWouldInstall(r['wouldInstall']) } };
    }

    const installed = requireBoolean(r, 'installed');
    return { ok: true, result: { ok: true, suppressed: false, installed, probe: parseProbeResult(r['probe']) } };
  } catch (err) {
    return { ok: false, error: `malformed bridge response: ${String(err)}` };
  }
}
