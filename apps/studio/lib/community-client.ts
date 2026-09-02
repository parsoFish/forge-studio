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
 *
 * W8-B5b adds `postCommunityRefresh` — the client side of the deterministic,
 * LLM-free `POST /api/studio/community/refresh` (see that section below for
 * the full contract this mirrors).
 */

import { bridgeFetch } from './bridge-client.ts';
import { parseProbeResult, parseInstallPreview, type ConnectionProbeResult, type InstallPreview } from './connection-client.ts';

// ---------------------------------------------------------------------------
// Types mirroring server shapes (orchestrator/studio/community-index.ts,
// cli/bridge-studio-community.ts)
// ---------------------------------------------------------------------------

export const COMMUNITY_KINDS = ['skill', 'hook', 'mcp', 'tool'] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

export const COMMUNITY_INSTALL_STATES = ['not-installed', 'draft-pending-approval', 'needs-review', 'installed', 'present-unmanaged'] as const;
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
  /** W8-B5 (community-05) — the registry row's own category ("planning",
   *  "memory", "review", …), mirrored from `CommunityItemWire`. It exists so
   *  the browse search can match the word the registry itself files rows
   *  under. `null` for an item with no registry row at all (a vendored
   *  package, a catalog connection): an honest absence, never an invented
   *  string and deliberately never `''`. */
  category: string | null;
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
    // W8-B5 (community-05): nullable, but the KEY must be PRESENT — the same
    // rule hub/signals/probeState already hold. An absent `category` is a
    // malformed response (a wire projection that forgot to send it), never
    // silently the same as an item that genuinely has none.
    category: parseNullableField(r, 'category', (v) => {
      if (typeof v !== 'string') throw new Error(`expected "category" to be a string when present, got ${JSON.stringify(v)}`);
      return v;
    }),
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

// ---------------------------------------------------------------------------
// W7-B3 (community-16 / community-03) — registry-level meta on the index
// payload. Same refuse-don't-coerce discipline as every parser above: a
// malformed meta THROWS (the caller maps it to ok:false), never a silently
// defaulted shape.
// ---------------------------------------------------------------------------

export type CommunityIndexMeta = {
  /** commitRegistryDraft's stamp — null = no agent refresh ever committed. */
  lastRefresh: string | null;
  /** Uncommitted changes on the repo-tracked registry file; null = git did
   *  not answer (not a repo) — an unknown, never a fabricated "clean". */
  registryDirty: boolean | null;
};

export function parseCommunityIndexMeta(raw: unknown): CommunityIndexMeta {
  if (!isPlainObject(raw)) throw new Error('community index meta: not an object');
  const lastRefresh = raw['lastRefresh'];
  if (lastRefresh !== null && typeof lastRefresh !== 'string') {
    throw new Error('community index meta: lastRefresh must be a string or null');
  }
  const registryDirty = raw['registryDirty'];
  if (registryDirty !== null && typeof registryDirty !== 'boolean') {
    throw new Error('community index meta: registryDirty must be a boolean or null');
  }
  return { lastRefresh, registryDirty };
}

/** Fetch the community index: every real hub (with a DERIVED itemCount) plus
 *  the cross-kind item list. Distinguishes a reachable-but-empty index from
 *  an unreachable bridge or a malformed payload (`ok: false` for both) —
 *  never rendered the same way. */
/** `kind` (optional) narrows the index the BRIDGE builds — a hooks-only
 *  consumer must not trigger a probe per catalog connection (W7-B3 review
 *  F7). Omitted = the full cross-kind index. */
export async function fetchCommunityIndex(kind?: CommunityKind): Promise<{
  ok: boolean;
  hubs: CommunityHubWithCount[];
  items: CommunityItem[];
  meta: CommunityIndexMeta | null;
  error?: string;
}> {
  let res: Response;
  try {
    res = await bridgeFetch(kind === undefined ? `/api/studio/community` : `/api/studio/community?kind=${encodeURIComponent(kind)}`);
  } catch (err) {
    return { ok: false, hubs: [], items: [], meta: null, error: `bridge unreachable: ${String(err)}` };
  }

  try {
    const data = await res.json().catch(() => undefined);
    if (!res.ok) return { ok: false, hubs: [], items: [], meta: null, error: errorFrom(data, `HTTP ${res.status}`) };
    if (!isPlainObject(data) || !Array.isArray(data['hubs']) || !Array.isArray(data['items'])) {
      return { ok: false, hubs: [], items: [], meta: null, error: 'malformed bridge response: "hubs"/"items" missing or not arrays' };
    }
    return {
      ok: true,
      hubs: (data['hubs'] as unknown[]).map(parseCommunityHubWithCount),
      items: (data['items'] as unknown[]).map(parseCommunityItem),
      meta: parseCommunityIndexMeta(data['meta']),
    };
  } catch (err) {
    return { ok: false, hubs: [], items: [], meta: null, error: `malformed bridge response: ${String(err)}` };
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

/** The F3 install round trip, client side: called with NO body except the
 *  `confirm` flag itself — this route takes an item id only (D9: the server
 *  decides what is installed).
 *
 * forge-6gv.8.2 — the mcp/tool arm is byte-identical to
 * `installConnection`'s route, confirm gate included: unconfirmed returns
 * `preview` with zero side effects. The skill-draft/hook arms ignore
 * `confirm` server-side; defaulting them to unconfirmed is harmless. */
export type CommunityInstallOutcome =
  | { routedTo: 'skill-draft'; alreadyInstalled: boolean }
  | { routedTo: 'hook-needs-approval'; alreadyInstalled: boolean }
  | { routedTo: 'connection-install'; preview: InstallPreview }
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
  opts?: { confirm?: boolean },
): Promise<{ ok: boolean; result?: CommunityInstallOutcome; error?: string }> {
  const confirmed = opts?.confirm === true;
  let res: Response;
  try {
    res = await bridgeFetch(`/api/studio/community/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/install`, {
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
    const routedTo = r['routedTo'];

    if (routedTo === 'skill-draft' || routedTo === 'hook-needs-approval') {
      return { ok: true, result: { routedTo, alreadyInstalled: requireBoolean(r, 'alreadyInstalled') } };
    }
    if (routedTo === 'connection-install') {
      // Disjoint-key discrimination, order and reasoning as in
      // connection-client.ts's `installConnection` — see its comment.
      if (r['preview'] !== undefined) {
        return { ok: true, result: { routedTo, preview: parseInstallPreview(r['preview']) } };
      }
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

// ---------------------------------------------------------------------------
// W7-B3 (community-23) — registry CRUD. The server forces the hand-curated
// stamps (fetchedAt:null / fetchedBy:'operator'); this client only carries
// the operator's curated fields. `status` is surfaced so callers can tell
// 409 (duplicate id) / 404 (unknown id) / 400 (invalid field) apart.
// ---------------------------------------------------------------------------

export type RegistryItemInput = {
  id: string;
  kind: CommunityKind;
  name: string;
  desc?: string;
  category: string;
  sourceUrl: string;
  provenance: string;
  tier?: string;
  signals?: { stars?: number | null; starsDisplay?: string | null; attributedTo?: string | null };
  upstreamUpdatedAt?: string | null;
};

type RegistryCrudResult = { ok: boolean; status?: number; error?: string };

async function registryCrud(path: string, method: 'POST' | 'PUT' | 'DELETE', item?: RegistryItemInput): Promise<RegistryCrudResult> {
  let res: Response;
  try {
    res = await bridgeFetch(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      ...(item !== undefined ? { body: JSON.stringify({ item }) } : {}),
    });
  } catch (err) {
    return { ok: false, error: `bridge unreachable: ${String(err)}` };
  }
  const data = await res.json().catch(() => undefined);
  if (!res.ok) return { ok: false, status: res.status, error: errorFrom(data, `HTTP ${res.status}`) };
  return { ok: true, status: res.status };
}

export function addRegistryItem(item: RegistryItemInput): Promise<RegistryCrudResult> {
  return registryCrud('/api/studio/community/registry/items', 'POST', item);
}

export function updateRegistryItem(id: string, item: RegistryItemInput): Promise<RegistryCrudResult> {
  return registryCrud(`/api/studio/community/registry/items/${encodeURIComponent(id)}`, 'PUT', item);
}

export function deleteRegistryItem(id: string): Promise<RegistryCrudResult> {
  return registryCrud(`/api/studio/community/registry/items/${encodeURIComponent(id)}`, 'DELETE');
}

// ---------------------------------------------------------------------------
// W8-B5b — POST /api/studio/community/refresh, the DETERMINISTIC (LLM-free)
// refresh. Types below mirror cli/community-refresh-run.ts's
// `CommunityRefreshRunResult`/`CommunityRefreshCounts` and
// orchestrator/studio/community-refresh-api.ts's `CommunityRefreshOutcome`/
// `CommunityRefreshFailure`/`CommunityRefreshErrorKind` — mirrored LOCALLY
// (never imported from cli/orchestrator, same as every other type in this
// file) so forge-ui keeps no build-time edge into those packages.
//
// `CommunityRefreshResult` is a client-side discriminated union that keeps
// FOUR outcomes distinct, because collapsing any pair of them into one shape
// would make the UI unable to tell the truth:
//   - `ok`                 a 200. `errors` MAY be non-empty (a partial pass).
//   - `refused-dry-bridge` the honest 409 dry-bridge refusal (`error:
//                           'dry-bridge'`, no `reason` key) — the harness
//                           refused to make the real outbound GitHub call,
//                           not a failure of the refresh itself.
//   - `refused`            a TYPED refusal from `runCommunityRefresh` — always
//                           carries `reason`+`remedy` (the one field ONLY this
//                           shape has), so it is distinguished from the two
//                           shapes below by field presence, never by status
//                           code alone (dry-bridge is ALSO a 409).
//   - `server-error`       the bare `{ error }` catch-all: a body carrying
//                           NEITHER `error:'dry-bridge'` NOR a `reason` key.
//                           In practice that is the route's own
//                           `catch { sendJson(res, 500, { error: … }) }`.
//                           NOT "any 500": `statusForRefreshReason` maps
//                           `write-failed` to 500 TOO, and that one IS a
//                           typed refusal carrying `reason` + `remedy`. The
//                           status code alone can therefore never separate
//                           these two — which is exactly why the parse below
//                           dispatches on FIELD PRESENCE and nothing else.
//                           Rewriting it as `status === 500 -> server-error`
//                           would silently reclassify every failed registry
//                           WRITE as an anonymous server fault and discard
//                           the operator's remedy.
//   - `transport-error`    the bridge was never reached, or answered with a
//                           body that parsed as neither of the above — "the
//                           request never got a real answer", the same
//                           distinction `bridge-result.ts` makes for reads.
// ---------------------------------------------------------------------------

/** The ONE place this route path is written — reused by the transport call
 *  below and by the page's title copy, so neither can drift from the other. */
export const COMMUNITY_REFRESH_ROUTE = '/api/studio/community/refresh';

export type CommunityRefreshCounts = {
  total: number;
  refreshed: number;
  unchanged: number;
  noUpstream: number;
  failed: number;
};

export const COMMUNITY_REFRESH_STATUSES = ['refreshed', 'unchanged', 'no-upstream', 'failed'] as const;
export type CommunityRefreshStatus = (typeof COMMUNITY_REFRESH_STATUSES)[number];

export type CommunityRefreshOutcome = {
  id: string;
  source: string | null;
  status: CommunityRefreshStatus;
  detail: string;
};

export const COMMUNITY_REFRESH_ERROR_KINDS = [
  'missing-token',
  'invalid-token',
  'rate-limited',
  'timeout',
  'network-error',
  'blocked-origin',
  'blocked-redirect',
  'not-found',
  'http-error',
  'malformed-response',
] as const;
export type CommunityRefreshErrorKind = (typeof COMMUNITY_REFRESH_ERROR_KINDS)[number];

export type CommunityRefreshFailure = {
  source: string;
  kind: CommunityRefreshErrorKind;
  message: string;
};

export const COMMUNITY_REFRESH_RUN_REASONS = [
  'missing-token',
  'invalid-token',
  'rate-limited',
  'refresh-refused',
  'registry-missing',
  'registry-invalid',
  'registry-locked',
  'all-sources-failed',
  'write-failed',
] as const;
export type CommunityRefreshRunReason = (typeof COMMUNITY_REFRESH_RUN_REASONS)[number];

export type CommunityRefreshResult =
  | {
      state: 'ok';
      wrote: boolean;
      dryRun: boolean;
      lastRefresh: string | null;
      counts: CommunityRefreshCounts;
      outcomes: readonly CommunityRefreshOutcome[];
      errors: readonly CommunityRefreshFailure[];
    }
  | { state: 'refused-dry-bridge'; route: string; method: string; action: string }
  | {
      state: 'refused';
      status: number;
      error: string;
      reason: CommunityRefreshRunReason;
      remedy: string;
      counts?: CommunityRefreshCounts;
      outcomes?: readonly CommunityRefreshOutcome[];
      errors?: readonly CommunityRefreshFailure[];
    }
  | { state: 'server-error'; status: number; error: string }
  | { state: 'transport-error'; error: string };

function parseCommunityRefreshCounts(raw: unknown): CommunityRefreshCounts {
  const r = asRecord(raw);
  return {
    total: requireNumber(r, 'total'),
    refreshed: requireNumber(r, 'refreshed'),
    unchanged: requireNumber(r, 'unchanged'),
    noUpstream: requireNumber(r, 'noUpstream'),
    failed: requireNumber(r, 'failed'),
  };
}

function parseCommunityRefreshOutcomeStatus(raw: unknown): CommunityRefreshStatus {
  if ((COMMUNITY_REFRESH_STATUSES as readonly string[]).includes(raw as string)) return raw as CommunityRefreshStatus;
  throw new Error(`unrecognised community refresh outcome status: ${JSON.stringify(raw)}`);
}

function parseCommunityRefreshOutcome(raw: unknown): CommunityRefreshOutcome {
  const r = asRecord(raw);
  return {
    id: requireString(r, 'id'),
    source: parseNullableField(r, 'source', (v) => {
      if (typeof v !== 'string') throw new Error(`expected "source" to be a string when present, got ${JSON.stringify(v)}`);
      return v;
    }),
    status: parseCommunityRefreshOutcomeStatus(r['status']),
    detail: requireString(r, 'detail'),
  };
}

function parseCommunityRefreshOutcomes(raw: unknown): CommunityRefreshOutcome[] {
  if (!Array.isArray(raw)) throw new Error(`expected "outcomes" to be an array, got ${JSON.stringify(raw)}`);
  return raw.map(parseCommunityRefreshOutcome);
}

function parseCommunityRefreshErrorKind(raw: unknown): CommunityRefreshErrorKind {
  if ((COMMUNITY_REFRESH_ERROR_KINDS as readonly string[]).includes(raw as string)) return raw as CommunityRefreshErrorKind;
  throw new Error(`unrecognised community refresh error kind: ${JSON.stringify(raw)}`);
}

function parseCommunityRefreshFailure(raw: unknown): CommunityRefreshFailure {
  const r = asRecord(raw);
  return {
    source: requireString(r, 'source'),
    kind: parseCommunityRefreshErrorKind(r['kind']),
    message: requireString(r, 'message'),
  };
}

function parseCommunityRefreshFailures(raw: unknown): CommunityRefreshFailure[] {
  if (!Array.isArray(raw)) throw new Error(`expected "errors" to be an array, got ${JSON.stringify(raw)}`);
  return raw.map(parseCommunityRefreshFailure);
}

function parseCommunityRefreshRunReason(raw: unknown): CommunityRefreshRunReason {
  if ((COMMUNITY_REFRESH_RUN_REASONS as readonly string[]).includes(raw as string)) return raw as CommunityRefreshRunReason;
  throw new Error(`unrecognised community refresh reason: ${JSON.stringify(raw)}`);
}

/**
 * Parse the raw HTTP status + JSON body of `POST /api/studio/community/refresh`
 * into the client's typed union. THROWS on any malformed shape (refuse, never
 * coerce — this module's house rule); `postCommunityRefresh` below is the ONE
 * caller and converts a throw into `{state:'transport-error'}`, mirroring
 * `parseRegistryItemResponse`/`fetchRegistryItem`'s own split exactly.
 *
 * The dry-bridge refusal is told apart from a TYPED refusal by the presence
 * of the `reason` key — the one field only a typed refusal carries — never by
 * status code alone: both answer 409.
 */
export function parseCommunityRefreshResponse(status: number, raw: unknown): CommunityRefreshResult {
  const r = asRecord(raw);

  if (status === 200) {
    return {
      state: 'ok',
      wrote: requireBoolean(r, 'wrote'),
      dryRun: requireBoolean(r, 'dryRun'),
      lastRefresh: parseNullableField(r, 'lastRefresh', (v) => {
        if (typeof v !== 'string') throw new Error(`expected "lastRefresh" to be a string when present, got ${JSON.stringify(v)}`);
        return v;
      }),
      counts: parseCommunityRefreshCounts(r['counts']),
      outcomes: parseCommunityRefreshOutcomes(r['outcomes']),
      errors: parseCommunityRefreshFailures(r['errors']),
    };
  }

  const error = requireString(r, 'error');

  if (error === 'dry-bridge') {
    return {
      state: 'refused-dry-bridge',
      route: requireString(r, 'route'),
      method: requireString(r, 'method'),
      action: requireString(r, 'action'),
    };
  }

  if ('reason' in r) {
    return {
      state: 'refused',
      status,
      error,
      reason: parseCommunityRefreshRunReason(r['reason']),
      remedy: requireString(r, 'remedy'),
      ...(r['counts'] !== undefined ? { counts: parseCommunityRefreshCounts(r['counts']) } : {}),
      ...(r['outcomes'] !== undefined ? { outcomes: parseCommunityRefreshOutcomes(r['outcomes']) } : {}),
      ...(r['errors'] !== undefined ? { errors: parseCommunityRefreshFailures(r['errors']) } : {}),
    };
  }

  // Neither a dry-bridge refusal nor a typed one: no `reason`, no `remedy` —
  // the route's own `catch` arm. Reached by ELIMINATION, never by status
  // code: `statusForRefreshReason` (cli/bridge-studio-community.ts:641)
  // answers 500 for `write-failed` as well, and that is a typed refusal the
  // branch above has already claimed on its `reason` key. Do not "simplify"
  // this to a 500 check — see this section's header.
  return { state: 'server-error', status, error };
}

/**
 * POST the deterministic refresh with NO body (the route takes none) and
 * classify the answer. Never throws: a transport failure or a malformed body
 * both land on `{state:'transport-error'}` with distinct `error` text — same
 * convention `fetchCommunityIndex` already uses above for its own two
 * non-answer cases.
 *
 * Deliberately NOT built on `bridgePost` (bridge-client.ts): that helper
 * normalises every reply to an `{ok}` envelope, and this route's 200 body has
 * no `ok` field at all — `bridgePost` would read a genuine success as a
 * failure.
 */
export async function postCommunityRefresh(): Promise<CommunityRefreshResult> {
  let res: Response;
  try {
    res = await bridgeFetch(COMMUNITY_REFRESH_ROUTE, { method: 'POST', headers: { 'x-forge-csrf': '1' } });
  } catch (err) {
    return { state: 'transport-error', error: `bridge unreachable: ${String(err)}` };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    return { state: 'transport-error', error: `malformed bridge response: ${String(err)}` };
  }
  try {
    return parseCommunityRefreshResponse(res.status, data);
  } catch (err) {
    return { state: 'transport-error', error: `malformed bridge response: ${String(err)}` };
  }
}

/**
 * The RAW registry row (tier/signals included — the browse wire projection
 * carries `category` since W8-B5 but not those) for the edit form's prefill.
 *
 * W8-B5 (exit row E9): `status` is carried through whenever the bridge
 * ANSWERED, and is deliberately ABSENT when the transport threw — the same
 * vocabulary `bridge-result.ts` uses, and the fact `registryEditLoadOutcome`
 * needs to tell "no such registry row" (404 → the shared NotFound) from "the
 * bridge was never reached" (→ the error banner). Without it the edit form
 * could only ever render one surface for both, which is the defect.
 */
export async function fetchRegistryItem(id: string): Promise<{ ok: boolean; item?: RegistryItemInput; error?: string; status?: number }> {
  let res: Response;
  try {
    res = await bridgeFetch(`/api/studio/community/registry/items/${encodeURIComponent(id)}`);
  } catch (err) {
    return { ok: false, error: `bridge unreachable: ${String(err)}` };
  }
  const data = await res.json().catch(() => undefined);
  if (!res.ok) return { ok: false, status: res.status, error: errorFrom(data, `HTTP ${res.status}`) };
  // W7-B3 review F6: the parse below throws on an unexpected shape
  // (asRecord/requireString) — wrap it like every sibling in this module so
  // a malformed 200 body becomes ok:false, never an unhandled rejection that
  // strands the edit form at data-page-ready="false".
  try {
    return { ...parseRegistryItemResponse(data), status: res.status };
  } catch (err) {
    // A malformed 200 is an ERROR, not a not-found: the status is carried so
    // the caller can see the bridge answered, and 200 !== 404 keeps it out of
    // the NotFound arm.
    return { ok: false, status: res.status, error: `malformed bridge response: ${String(err)}` };
  }
}

/** Exported for the parse-contract pin in community-client.test.ts (W7-B3
 *  review F6): throws on any unexpected shape; `fetchRegistryItem` above is
 *  the ONE caller and converts the throw to `ok:false`. */
export function parseRegistryItemResponse(data: unknown): { ok: true; item: RegistryItemInput } {
  const r = asRecord(data);
  const item = asRecord(r['item']);
  return {
    ok: true,
    item: {
      id: requireString(item, 'id'),
      kind: requireString(item, 'kind') as CommunityKind,
      name: requireString(item, 'name'),
      desc: typeof item['desc'] === 'string' ? item['desc'] : undefined,
      category: requireString(item, 'category'),
      sourceUrl: requireString(item, 'sourceUrl'),
      provenance: requireString(item, 'provenance'),
      tier: typeof item['tier'] === 'string' ? item['tier'] : undefined,
      signals: (() => {
        const s = item['signals'];
        if (s === null || typeof s !== 'object' || Array.isArray(s)) return undefined;
        const sig = s as Record<string, unknown>;
        return {
          stars: typeof sig['stars'] === 'number' ? sig['stars'] : null,
          starsDisplay: typeof sig['starsDisplay'] === 'string' ? sig['starsDisplay'] : null,
          attributedTo: typeof sig['attributedTo'] === 'string' ? sig['attributedTo'] : null,
        };
      })(),
      upstreamUpdatedAt: typeof item['upstreamUpdatedAt'] === 'string' ? item['upstreamUpdatedAt'] : null,
    },
  };
}
