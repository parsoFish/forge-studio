/**
 * Client-side fetch + parse helpers for the Studio community-browser bridge
 * routes (R3-07-F2/F3). Mirrors connection-client.ts's / hook-client.ts's
 * role exactly — see packages/library/bridge-studio-community.ts's own header for the
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
 * packages/library/tests/integration/bridge-studio-community.test.ts instead.
 *
 * W8-B5b adds `postCommunityRefresh` — the client side of the deterministic,
 * LLM-free `POST /api/studio/community/refresh` (see that section below for
 * the full contract this mirrors).
 */

import { bridgeFetch } from './bridge-client.ts';
import { parseProbeResult, parseInstallPreview, type ConnectionProbeResult, type InstallPreview } from './connection-client.ts';

// The wire VOCABULARY — every community type and constant this module parses
// into — lives in `community-types.ts`, and is re-exported here verbatim so
// no import site moved. It was extracted when this file's check-file-size
// ceiling left no room for ruling 477's `upstreamFetchable`: an exemption is
// a ceiling rather than a licence, and a file this size pays for a new field
// by getting smaller, not by spending someone else's comment.
export * from './community-types.ts';
// The refresh half moved to its own module when this file hit its size ceiling;
// re-exported verbatim so no consumer's import path changed (ruling 616).
export * from './community-refresh-client.ts';

import type {
  CommunityHub, CommunityHubWithCount, CommunityItem, CommunityItemDetail, CommunityInstallState,
  CommunityKind, CommunityProbeState, CommunitySignals, CommunityFile, CommunityConnectionCapability,
  CommunityConnectionConfigVar, CommunityConnectionInstallMethod, HookScanFinding, HookScanReport,
  HookScanCategory, HookScanVerdict, HookFindingSeverity, DiscoveredRow,
} from './community-types.ts';
import { COMMUNITY_INSTALL_STATES, COMMUNITY_KINDS, COMMUNITY_PROBE_STATES, HOOK_FINDING_SEVERITIES, HOOK_SCAN_CATEGORIES, HOOK_SCAN_VERDICTS } from './community-types.ts';
// ---------------------------------------------------------------------------
// Parse helpers — REFUSE malformed input (throw), never coerce.
// ---------------------------------------------------------------------------

import {
  isPlainObject, asRecord, requireString, requireBoolean, requireNumber, requireNullableNumber, nullableString, parseNullableField,
} from './community-parse.ts';

// The strict-parse rule these enforce is stated once, in `community-parse.ts`.

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
  // `reason` is the LAST refresh's verdict for this hub, served from disk. It
  // is absent for a hub that was read, and for a registry never refreshed —
  // both of which mean "nothing to explain" rather than "no failure recorded".
  const reason = r['reason'];
  return {
    ...hub,
    itemCount: requireNumber(r, 'itemCount'),
    ...(typeof reason === 'string' && reason !== '' ? { reason } : {}),
  };
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
    category: nullableString(r, 'category'),
    upstream: requireString(r, 'upstream'),
    hub: parseNullableField(r, 'hub', parseCommunityHub),
    signals: parseNullableField(r, 'signals', parseCommunitySignals),
    vendored: requireBoolean(r, 'vendored'),
    upstreamFetchableAs: nullableString(r, 'upstreamFetchableAs'),
    installState: parseCommunityInstallState(r['installState']),
    probeState: parseNullableField(r, 'probeState', parseCommunityProbeState),
    origin: requireString(r, 'origin'),
    fetchedAt: nullableString(r, 'fetchedAt'),
    fetchedBy: requireString(r, 'fetchedBy'),
    upstreamUpdatedAt: nullableString(r, 'upstreamUpdatedAt'),
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
 *  extra payload packages/library/bridge-studio-community.ts's detail route attaches). */
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
// packages/library/tests/integration/bridge-studio-community.test.ts, not by this file's own test (see
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
