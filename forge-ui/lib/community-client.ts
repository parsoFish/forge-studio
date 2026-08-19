/**
 * Client-side fetch + parse helpers for the Studio community-browser bridge
 * routes (R3-07-F2/F3). Mirrors connection-client.ts's / hook-client.ts's
 * role exactly — see cli/bridge-studio-community.ts's own header for the
 * transport shapes this carries through verbatim.
 *
 * Every parser below REFUSES (throws) on a malformed payload rather than
 * coercing it — the `Array.isArray(x) ? x : []` / `?? []` / `?? null`
 * permissive-parse shape has been found three times in this campaign
 * (R3-06's `fetchTemplateLibrary` is the most recent). `hub`/`signals`/
 * `probeState` are all legitimately NULLABLE fields — but the KEY must still
 * be PRESENT (explicit `null`) in the payload; an ABSENT key is a malformed
 * response, never silently treated the same as an explicit null.
 *
 * Tested ONLY via the pure parse functions (community-client.test.ts) — no
 * fetch, no window, no jsdom (this repo's forge-ui vitest config is
 * `environment: 'node'`, a standing decision; the transport, `bridgeFetch`,
 * requires `window`). The over-the-wire behaviour is pinned by
 * cli/bridge-studio-community.test.ts instead.
 */

import { bridgeFetch } from './bridge-client.ts';
import { parseProbeResult, type ConnectionProbeResult } from './connection-client.ts';

// ---------------------------------------------------------------------------
// Types mirroring server shapes (orchestrator/studio/community-index.ts,
// cli/bridge-studio-community.ts)
// ---------------------------------------------------------------------------

export const COMMUNITY_KINDS = ['skill', 'hook', 'mcp', 'tool'] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

export const COMMUNITY_INSTALL_STATES = ['not-installed', 'draft-pending-approval', 'needs-review', 'installed'] as const;
export type CommunityInstallState = (typeof COMMUNITY_INSTALL_STATES)[number];

export const COMMUNITY_PROBE_STATES = ['not-installed', 'available', 'misconfigured'] as const;
export type CommunityProbeState = (typeof COMMUNITY_PROBE_STATES)[number];

export type CommunityHub = {
  id: string;
  name: string;
  url: string;
  kinds: string; // raw curated string, never parsed into an array
};

export type CommunityHubWithCount = CommunityHub & { itemCount: number };

export type CommunitySignals = {
  stars: string;
  attributedTo: string;
  /** Parsed NUMERIC star count alongside the display `stars` string above —
   *  null when the curated display string names a different unit or carries
   *  no figure at all; never fabricated (W6-CR-2). */
  starsNumeric: number | null;
};

export type CommunityItem = {
  id: string;
  kind: CommunityKind;
  name: string;
  desc: string;
  upstream: string;
  hub: CommunityHub | null;
  signals: CommunitySignals | null;
  vendored: boolean;
  installState: CommunityInstallState;
  probeState: CommunityProbeState | null;
  origin: string;
  /** ISO date this item was last verified against upstream — null until a
   *  real refresh pass has run for it, or for an item with no registry row
   *  at all (a vendored package / connection). NEVER render a date for a
   *  null fetchedAt — the honest "seed — never verified" state instead
   *  (W6-CR-2). */
  fetchedAt: string | null;
  /** Provenance of the currently-recorded data — "seed" for a
   *  registry-sourced item, "local" for a vendored package/connection with
   *  no registry row. Always a real, non-blank string. */
  fetchedBy: string;
  /** ISO date the upstream project last published a change, per the
   *  registry's own curated fact — null when unknown or for an item with no
   *  registry row; never fabricated. */
  upstreamUpdatedAt: string | null;
};

export type CommunityFile = { path: string; body: string };

export const HOOK_SCAN_CATEGORIES = ['network-egress', 'env-read', 'file-read', 'obfuscation'] as const;
export type HookScanCategory = (typeof HOOK_SCAN_CATEGORIES)[number];

export const HOOK_FINDING_SEVERITIES = ['critical', 'info'] as const;
export type HookFindingSeverity = (typeof HOOK_FINDING_SEVERITIES)[number];

export const HOOK_SCAN_VERDICTS = ['blocked', 'findings', 'clean'] as const;
export type HookScanVerdict = (typeof HOOK_SCAN_VERDICTS)[number];

export type HookScanFinding = {
  category: HookScanCategory;
  severity: HookFindingSeverity;
  message: string;
  match: string;
  declared: boolean;
};

export type HookScanReport = {
  verdict: HookScanVerdict;
  findings: HookScanFinding[];
};

export type CommunityConnectionInstallMethod =
  | { method: 'system-provided' }
  | { method: 'npm'; package: string; version: string }
  | { method: 'external'; upstream: string };

export type CommunityConnectionConfigVar = { env: string; required: boolean; purpose: string };
export type CommunityConnectionCapability = { name: string; summary: string };

export type CommunitySkillDetail = CommunityItem & { files: CommunityFile[] };
export type CommunityHookDetail = CommunityItem & { files: CommunityFile[]; scan: HookScanReport };
export type CommunityConnectionDetail = CommunityItem & {
  install: CommunityConnectionInstallMethod;
  config: CommunityConnectionConfigVar[];
  probe: ConnectionProbeResult;
  /** Present iff the catalog mcp entry declares them — never a fabricated
   *  empty array for a tool entry or an mcp entry that declares none. */
  capabilities?: CommunityConnectionCapability[];
  capabilitiesSource?: 'curated';
};
export type CommunityItemDetail = CommunitySkillDetail | CommunityHookDetail | CommunityConnectionDetail;

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

/** A field that is legitimately a number OR null (never absent — the KEY
 *  must still be present, mirroring `parseNullableField`'s own discipline
 *  below for object-shaped nullable fields). */
function requireNullableNumber(r: Record<string, unknown>, key: string): number | null {
  if (!(key in r)) throw new Error(`expected "${key}" key to be present (explicit null is allowed, an absent key is not)`);
  const v = r[key];
  if (v === null) return null;
  if (typeof v !== 'number') throw new Error(`expected "${key}" to be a number or null, got ${JSON.stringify(v)}`);
  return v;
}

/** A field that is legitimately nullable MUST still be a PRESENT key
 *  (explicit `null` is honest; an absent key is a malformed response — this
 *  campaign's recurring "declared data fails open" shape, applied to parse
 *  time: silently treating "absent" the same as "explicitly none" hides a
 *  transport bug behind a plausible-looking value). */
function parseNullableField<T>(r: Record<string, unknown>, key: string, parse: (raw: unknown) => T): T | null {
  if (!(key in r)) throw new Error(`expected "${key}" key to be present (explicit null is allowed, an absent key is not)`);
  const v = r[key];
  return v === null ? null : parse(v);
}

export function parseCommunityHub(raw: unknown): CommunityHub {
  const r = asRecord(raw);
  return {
    id: requireString(r, 'id'),
    name: requireString(r, 'name'),
    url: requireString(r, 'url'),
    kinds: requireString(r, 'kinds'),
  };
}

/** `itemCount` is DERIVED, never a declared field on the hub registry — a
 *  genuine zero is not falsy-coerced away (requireNumber, not `|| 0`). */
export function parseCommunityHubWithCount(raw: unknown): CommunityHubWithCount {
  const r = asRecord(raw);
  const hub = parseCommunityHub(r);
  return { ...hub, itemCount: requireNumber(r, 'itemCount') };
}

function parseCommunityKind(raw: unknown): CommunityKind {
  if ((COMMUNITY_KINDS as readonly string[]).includes(raw as string)) return raw as CommunityKind;
  throw new Error(`unrecognised community kind: ${JSON.stringify(raw)}`);
}

function parseCommunityInstallState(raw: unknown): CommunityInstallState {
  if ((COMMUNITY_INSTALL_STATES as readonly string[]).includes(raw as string)) return raw as CommunityInstallState;
  throw new Error(`unrecognised community installState: ${JSON.stringify(raw)}`);
}

function parseCommunityProbeState(raw: unknown): CommunityProbeState {
  if ((COMMUNITY_PROBE_STATES as readonly string[]).includes(raw as string)) return raw as CommunityProbeState;
  throw new Error(`unrecognised community probeState: ${JSON.stringify(raw)}`);
}

function parseCommunitySignals(raw: unknown): CommunitySignals {
  const r = asRecord(raw);
  return {
    stars: requireString(r, 'stars'),
    attributedTo: requireString(r, 'attributedTo'),
    starsNumeric: requireNullableNumber(r, 'starsNumeric'),
  };
}

/**
 * Parse one cross-kind community item (list row or detail's base fields —
 * same shape). THROWS on any malformed or missing REQUIRED field, or an
 * unrecognised enum token, rather than coercing it to a plausible default.
 */
export function parseCommunityItem(raw: unknown): CommunityItem {
  const r = asRecord(raw);
  return {
    id: requireString(r, 'id'),
    kind: parseCommunityKind(r['kind']),
    name: requireString(r, 'name'),
    desc: requireString(r, 'desc'),
    upstream: requireString(r, 'upstream'),
    hub: parseNullableField(r, 'hub', parseCommunityHub),
    signals: parseNullableField(r, 'signals', parseCommunitySignals),
    vendored: requireBoolean(r, 'vendored'),
    installState: parseCommunityInstallState(r['installState']),
    probeState: parseNullableField(r, 'probeState', parseCommunityProbeState),
    origin: requireString(r, 'origin'),
    fetchedAt: parseNullableField(r, 'fetchedAt', (v) => {
      if (typeof v !== 'string') throw new Error(`expected "fetchedAt" to be a string when present, got ${JSON.stringify(v)}`);
      return v;
    }),
    fetchedBy: requireString(r, 'fetchedBy'),
    upstreamUpdatedAt: parseNullableField(r, 'upstreamUpdatedAt', (v) => {
      if (typeof v !== 'string') throw new Error(`expected "upstreamUpdatedAt" to be a string when present, got ${JSON.stringify(v)}`);
      return v;
    }),
  };
}

// ---------------------------------------------------------------------------
// Detail parsing — kind-specific extras layered onto the base item.
// ---------------------------------------------------------------------------

function parseCommunityFile(raw: unknown): CommunityFile {
  const r = asRecord(raw);
  return { path: requireString(r, 'path'), body: requireString(r, 'body') };
}

function parseCommunityFiles(raw: unknown): CommunityFile[] {
  if (!Array.isArray(raw)) throw new Error(`expected "files" to be an array, got ${JSON.stringify(raw)}`);
  return raw.map(parseCommunityFile);
}

function parseHookScanFinding(raw: unknown): HookScanFinding {
  const r = asRecord(raw);
  const category = r['category'];
  if (!(HOOK_SCAN_CATEGORIES as readonly string[]).includes(category as string)) {
    throw new Error(`unrecognised hook scan finding category: ${JSON.stringify(category)}`);
  }
  const severity = r['severity'];
  if (!(HOOK_FINDING_SEVERITIES as readonly string[]).includes(severity as string)) {
    throw new Error(`unrecognised hook scan finding severity: ${JSON.stringify(severity)}`);
  }
  return {
    category: category as HookScanCategory,
    severity: severity as HookFindingSeverity,
    message: requireString(r, 'message'),
    match: requireString(r, 'match'),
    declared: requireBoolean(r, 'declared'),
  };
}

export function parseHookScanReport(raw: unknown): HookScanReport {
  const r = asRecord(raw);
  const verdict = r['verdict'];
  if (!(HOOK_SCAN_VERDICTS as readonly string[]).includes(verdict as string)) {
    throw new Error(`unrecognised hook scan verdict: ${JSON.stringify(verdict)}`);
  }
  const findingsRaw = r['findings'];
  if (!Array.isArray(findingsRaw)) throw new Error(`expected "findings" to be an array, got ${JSON.stringify(findingsRaw)}`);
  return { verdict: verdict as HookScanVerdict, findings: findingsRaw.map(parseHookScanFinding) };
}

/** Mirrors connection-client.ts's own `parseInstall` exactly — a discriminated
 *  union closed at exactly three methods; an unrecognised method (or a
 *  variant missing its own required sub-field) throws. */
function parseCommunityConnectionInstall(raw: unknown): CommunityConnectionInstallMethod {
  const r = asRecord(raw);
  const method = r['method'];
  if (method === 'system-provided') return { method };
  if (method === 'npm') return { method, package: requireString(r, 'package'), version: requireString(r, 'version') };
  if (method === 'external') return { method, upstream: requireString(r, 'upstream') };
  throw new Error(`unrecognised community connection install method: ${JSON.stringify(method)}`);
}

function parseCommunityConnectionConfigVar(raw: unknown): CommunityConnectionConfigVar {
  const r = asRecord(raw);
  return { env: requireString(r, 'env'), required: requireBoolean(r, 'required'), purpose: requireString(r, 'purpose') };
}

function parseCommunityConnectionConfig(raw: unknown): CommunityConnectionConfigVar[] {
  if (!Array.isArray(raw)) throw new Error(`expected "config" to be an array, got ${JSON.stringify(raw)}`);
  return raw.map(parseCommunityConnectionConfigVar);
}

function parseCommunityConnectionCapability(raw: unknown): CommunityConnectionCapability {
  const r = asRecord(raw);
  return { name: requireString(r, 'name'), summary: requireString(r, 'summary') };
}

/** Parse a full detail response (base item fields + the kind-appropriate
 *  extra payload cli/bridge-studio-community.ts's detail route attaches). */
export function parseCommunityItemDetail(raw: unknown): CommunityItemDetail {
  const item = parseCommunityItem(raw);
  const r = asRecord(raw);

  if (item.kind === 'skill') {
    return { ...item, files: parseCommunityFiles(r['files']) };
  }
  if (item.kind === 'hook') {
    return { ...item, files: parseCommunityFiles(r['files']), scan: parseHookScanReport(r['scan']) };
  }

  const install = parseCommunityConnectionInstall(r['install']);
  const config = parseCommunityConnectionConfig(r['config']);
  const probe = parseProbeResult(r['probe']);

  const capabilitiesRaw = r['capabilities'];
  let capabilities: CommunityConnectionCapability[] | undefined;
  if (capabilitiesRaw !== undefined) {
    if (!Array.isArray(capabilitiesRaw)) {
      throw new Error(`expected "capabilities" to be an array when present, got ${JSON.stringify(capabilitiesRaw)}`);
    }
    capabilities = capabilitiesRaw.map(parseCommunityConnectionCapability);
  }

  const capabilitiesSourceRaw = r['capabilitiesSource'];
  let capabilitiesSource: 'curated' | undefined;
  if (capabilitiesSourceRaw !== undefined) {
    if (capabilitiesSourceRaw !== 'curated') {
      throw new Error(`unrecognised community capabilitiesSource: ${JSON.stringify(capabilitiesSourceRaw)} — expected "curated"`);
    }
    capabilitiesSource = capabilitiesSourceRaw;
  }

  return {
    ...item,
    install,
    config,
    probe,
    ...(capabilities !== undefined ? { capabilities } : {}),
    ...(capabilitiesSource !== undefined ? { capabilitiesSource } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fetch helpers — over-the-wire behaviour pinned by
// cli/bridge-studio-community.test.ts, not by this file's own test (see
// module header: no window/fetch under this repo's node-environment vitest).
// ---------------------------------------------------------------------------

function errorFrom(data: unknown, fallback: string): string {
  return isPlainObject(data) && typeof data['error'] === 'string' ? data['error'] : fallback;
}

/** Fetch the community index: every real hub (with a DERIVED itemCount) plus
 *  the cross-kind item list. Distinguishes a reachable-but-empty index from
 *  an unreachable bridge or a malformed payload (`ok: false` for both) —
 *  never rendered the same way. */
export async function fetchCommunityIndex(): Promise<{
  ok: boolean;
  hubs: CommunityHubWithCount[];
  items: CommunityItem[];
  error?: string;
}> {
  let res: Response;
  try {
    res = await bridgeFetch(`/api/studio/community`);
  } catch (err) {
    return { ok: false, hubs: [], items: [], error: `bridge unreachable: ${String(err)}` };
  }

  try {
    const data = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, hubs: [], items: [], error: errorFrom(data, `HTTP ${res.status}`) };
    if (!isPlainObject(data) || !Array.isArray(data['hubs']) || !Array.isArray(data['items'])) {
      return { ok: false, hubs: [], items: [], error: 'malformed bridge response: "hubs"/"items" missing or not arrays' };
    }
    return {
      ok: true,
      hubs: (data['hubs'] as unknown[]).map(parseCommunityHubWithCount),
      items: (data['items'] as unknown[]).map(parseCommunityItem),
    };
  } catch (err) {
    return { ok: false, hubs: [], items: [], error: `malformed bridge response: ${String(err)}` };
  }
}

/** Fetch one item's detail (base fields + the kind-appropriate extra
 *  payload). `status` is surfaced so the caller can tell a genuine 404
 *  (unknown item) apart from a reachable-but-erroring bridge. */
export async function fetchCommunityItemDetail(
  kind: CommunityKind,
  id: string,
): Promise<{ ok: boolean; status?: number; item?: CommunityItemDetail; error?: string }> {
  let res: Response;
  try {
    res = await bridgeFetch(`/api/studio/community/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
  } catch (err) {
    return { ok: false, error: `bridge unreachable: ${String(err)}` };
  }

  try {
    const data = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, status: res.status, error: errorFrom(data, `HTTP ${res.status}`) };
    return { ok: true, status: res.status, item: parseCommunityItemDetail(data) };
  } catch (err) {
    return { ok: false, status: res.status, error: `malformed bridge response: ${String(err)}` };
  }
}

/** The F3 install round trip, client side: called with NO body — this route
 *  takes an item id only (D9: the server decides what is installed). */
export type CommunityInstallOutcome =
  | { routedTo: 'skill-draft'; alreadyInstalled: boolean }
  | { routedTo: 'hook-needs-approval'; alreadyInstalled: boolean }
  | { routedTo: 'connection-install'; suppressed: true; wouldInstall: { command: string; args: string[] } }
  | { routedTo: 'connection-install'; suppressed: false; installed: boolean; probe: ConnectionProbeResult };

function parseWouldInstall(raw: unknown): { command: string; args: string[] } {
  const r = asRecord(raw);
  const command = requireString(r, 'command');
  const args = r['args'];
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
    throw new Error(`expected "args" to be a string array, got ${JSON.stringify(args)}`);
  }
  return { command, args: args as string[] };
}

export async function installCommunityItem(
  kind: CommunityKind,
  id: string,
): Promise<{ ok: boolean; result?: CommunityInstallOutcome; error?: string }> {
  let res: Response;
  try {
    res = await bridgeFetch(`/api/studio/community/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/install`, {
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
    const routedTo = r['routedTo'];

    if (routedTo === 'skill-draft' || routedTo === 'hook-needs-approval') {
      return { ok: true, result: { routedTo, alreadyInstalled: requireBoolean(r, 'alreadyInstalled') } };
    }
    if (routedTo === 'connection-install') {
      if (r['suppressed'] === true) {
        return { ok: true, result: { routedTo, suppressed: true, wouldInstall: parseWouldInstall(r['wouldInstall']) } };
      }
      return { ok: true, result: { routedTo, suppressed: false, installed: requireBoolean(r, 'installed'), probe: parseProbeResult(r['probe']) } };
    }
    throw new Error(`unrecognised routedTo: ${JSON.stringify(routedTo)}`);
  } catch (err) {
    return { ok: false, error: `malformed bridge response: ${String(err)}` };
  }
}
