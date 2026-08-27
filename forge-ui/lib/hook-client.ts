/**
 * Client-side fetch + parse helpers for the Studio hooks-library bridge
 * routes (R3-03-F4). Mirrors skill-client.ts's role — see
 * cli/bridge-studio-hooks.ts's own header for the transport shapes this
 * carries through verbatim.
 *
 * Split out of studio-client.ts the same way skill-client.ts and
 * template-client.ts were, for the same reason: zero interdependency with
 * the rest of that file, which already has no headroom under this repo's
 * file-size discipline.
 *
 * ---------------------------------------------------------------------------
 * ONE DELIBERATE DEVIATION FROM skill-client.ts: `parseHookLibraryEntry` /
 * `parseHookDetail` are EXPORTED (skill-client.ts's equivalents are private)
 * so their refusal behaviour is directly pinnable
 * (forge-ui/lib/hook-client.test.ts). skill-client.ts's / template-client.ts's
 * `Array.isArray(x) ? x : []` parses turned a malformed/missing array into a
 * confident empty answer — one of those shipped as a review BLOCKER. These
 * parsers REFUSE (throw) on a malformed payload instead of coercing one, so
 * the "carriedBy: [] because scanned N, found none" case can never become
 * indistinguishable from "carriedBy: [] because the transport was broken".
 * ---------------------------------------------------------------------------
 */

import { bridgeFetch } from './bridge-client';

// ---------------------------------------------------------------------------
// Types mirroring server shapes (cli/bridge-studio-hooks.ts)
// ---------------------------------------------------------------------------

export const HOOK_LIFECYCLE_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'SessionEnd',
  'Notification',
  'UserPromptSubmit',
] as const;
export type HookLifecycleEvent = (typeof HOOK_LIFECYCLE_EVENTS)[number];

export type HookScanVerdict = 'blocked' | 'findings' | 'clean';
export type HookTrust = 'needs-review' | 'approved' | 'overridden';

export type HookPermissions = {
  env: string[];
  read: string[];
  network: boolean;
};

export type HookUsedByDerivation = {
  source: string;
  scanned: number;
};

export type HookLibraryEntryOk = {
  ok: true;
  id: string;
  name: string;
  description: string;
  on: HookLifecycleEvent;
  matcher?: string;
  permissions: HookPermissions;
  carriedBy: string[];
  carriedByDerivation: HookUsedByDerivation;
  scanVerdict: HookScanVerdict;
  trust: HookTrust;
  runnable: boolean;
};

export type HookLibraryEntryMalformed = {
  ok: false;
  id: string;
  carriedBy: string[];
  carriedByDerivation: HookUsedByDerivation;
  error: string;
};

export type HookLibraryEntry = HookLibraryEntryOk | HookLibraryEntryMalformed;

export type HookScanFinding = {
  category: 'network-egress' | 'env-read' | 'file-read' | 'obfuscation';
  severity: 'critical' | 'info';
  message: string;
  match: string;
  declared: boolean;
  /** Additive-optional: which PACKAGE FILE this finding came from — present
   *  only when the server threaded it (more than one file was scanned; see
   *  hook-scan.ts's `scanHookFiles`). Never defaulted to '' when absent — a
   *  finding with a fabricated empty path would be a lie about provenance. */
  path?: string;
};

export type HookScanReport = {
  verdict: HookScanVerdict;
  findings: HookScanFinding[];
};

/** `hash` is a `sha256:<hex>` content hash of `body`, added alongside
 *  `packageHash` (PIN E) so an operator can see, per file, whether it
 *  changed — DISPLAY-ONLY provenance; the actual approval decision is gated
 *  by the ledger's own pins server-side, never by this client re-deriving
 *  trust from a hash it re-displays. */
export type HookPackageFile = { path: string; body: string; hash: string };

/** W7-B4 (library-09) — the recorded approval the resolved-state panel
 *  renders. Present on the detail wire iff a live ledger entry exists. */
export type HookApprovalRecord = {
  approvedAt: string;
  overridden: boolean;
  reason?: string;
};

export type HookDetail = HookLibraryEntryOk & {
  files: HookPackageFile[];
  /** Whole-package sha256 fingerprint (`hashHookPackage`, hook-package.ts) —
   *  the EXACT value the approval ledger pins. DISPLAY-ONLY on this client:
   *  the operator reads it to see what they are about to approve, but the
   *  approve/override routes re-derive and check the real ledger pins
   *  server-side rather than trusting anything this client sends back. */
  packageHash: string;
  scan: HookScanReport;
  approval?: HookApprovalRecord;
};

// ---------------------------------------------------------------------------
// Parse helpers — REFUSE malformed input (throw), never coerce.
// ---------------------------------------------------------------------------

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(raw)}`);
  }
  return raw as Record<string, unknown>;
}

function reqString(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  if (typeof v !== 'string') throw new Error(`expected "${key}" to be a string, got ${JSON.stringify(v)}`);
  return v;
}

function reqStringArray(r: Record<string, unknown>, key: string): string[] {
  const v = r[key];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new Error(`expected "${key}" to be a string array, got ${JSON.stringify(v)}`);
  }
  return v as string[];
}

function reqBoolean(r: Record<string, unknown>, key: string): boolean {
  const v = r[key];
  if (typeof v !== 'boolean') throw new Error(`expected "${key}" to be a boolean, got ${JSON.stringify(v)}`);
  return v;
}

function parseHookLifecycleEvent(raw: unknown): HookLifecycleEvent {
  if (typeof raw === 'string' && (HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(raw)) {
    return raw as HookLifecycleEvent;
  }
  throw new Error(`unrecognised hook lifecycle event: ${JSON.stringify(raw)}`);
}

function parseHookScanVerdict(raw: unknown): HookScanVerdict {
  if (raw === 'blocked' || raw === 'findings' || raw === 'clean') return raw;
  throw new Error(`unrecognised hook scan verdict: ${JSON.stringify(raw)}`);
}

function parseHookTrust(raw: unknown): HookTrust {
  if (raw === 'needs-review' || raw === 'approved' || raw === 'overridden') return raw;
  throw new Error(`unrecognised hook trust value: ${JSON.stringify(raw)}`);
}

function parseHookUsedByDerivation(raw: unknown): HookUsedByDerivation {
  const r = asRecord(raw);
  return { source: reqString(r, 'source'), scanned: reqNumber(r, 'scanned') };
}

function reqNumber(r: Record<string, unknown>, key: string): number {
  const v = r[key];
  if (typeof v !== 'number') throw new Error(`expected "${key}" to be a number, got ${JSON.stringify(v)}`);
  return v;
}

function parseHookPermissions(raw: unknown): HookPermissions {
  const r = asRecord(raw);
  return {
    env: reqStringArray(r, 'env'),
    read: reqStringArray(r, 'read'),
    network: reqBoolean(r, 'network'),
  };
}

/** Parse one `/api/studio/hooks` list entry — a discriminated union on `ok`.
 *  THROWS on a malformed payload (missing/wrong-typed field) rather than
 *  coercing it to a default; the caller (fetchHookLibrary) turns that into
 *  the page's existing explicit error state, exactly as skill-client.ts's
 *  own `parseSkillTrust` does for an unrecognised trust token. */
export function parseHookLibraryEntry(raw: unknown): HookLibraryEntry {
  const r = asRecord(raw);
  const ok = r['ok'];
  if (typeof ok !== 'boolean') throw new Error(`expected "ok" to be a boolean, got ${JSON.stringify(ok)}`);

  const id = reqString(r, 'id');
  const carriedBy = reqStringArray(r, 'carriedBy');
  const carriedByDerivation = parseHookUsedByDerivation(r['carriedByDerivation']);

  if (!ok) {
    return { ok: false, id, carriedBy, carriedByDerivation, error: reqString(r, 'error') };
  }

  const matcherRaw = r['matcher'];
  if (matcherRaw !== undefined && typeof matcherRaw !== 'string') {
    throw new Error(`expected "matcher" to be a string when present, got ${JSON.stringify(matcherRaw)}`);
  }

  return {
    ok: true,
    id,
    name: reqString(r, 'name'),
    description: reqString(r, 'description'),
    on: parseHookLifecycleEvent(r['on']),
    ...(matcherRaw !== undefined ? { matcher: matcherRaw } : {}),
    permissions: parseHookPermissions(r['permissions']),
    carriedBy,
    carriedByDerivation,
    scanVerdict: parseHookScanVerdict(r['scanVerdict']),
    trust: parseHookTrust(r['trust']),
    runnable: reqBoolean(r, 'runnable'),
  };
}

function parseHookScanFinding(raw: unknown): HookScanFinding {
  const r = asRecord(raw);
  const category = r['category'];
  if (category !== 'network-egress' && category !== 'env-read' && category !== 'file-read' && category !== 'obfuscation') {
    throw new Error(`unrecognised hook finding category: ${JSON.stringify(category)}`);
  }
  const severity = r['severity'];
  if (severity !== 'critical' && severity !== 'info') {
    throw new Error(`unrecognised hook finding severity: ${JSON.stringify(severity)}`);
  }
  // `path` is additive-optional (server only threads it when >1 file was
  // scanned) — a present-but-wrong-typed value THROWS (refused, not
  // coerced), and an absent value is omitted entirely rather than defaulted
  // to '' (an empty path would be a fabricated claim about provenance).
  const pathRaw = r['path'];
  if (pathRaw !== undefined && typeof pathRaw !== 'string') {
    throw new Error(`expected "path" to be a string when present, got ${JSON.stringify(pathRaw)}`);
  }
  return {
    category,
    severity,
    message: reqString(r, 'message'),
    match: reqString(r, 'match'),
    declared: reqBoolean(r, 'declared'),
    ...(pathRaw !== undefined ? { path: pathRaw } : {}),
  };
}

function parseHookScanReport(raw: unknown): HookScanReport {
  const r = asRecord(raw);
  const findings = r['findings'];
  if (!Array.isArray(findings)) throw new Error(`expected "findings" to be an array, got ${JSON.stringify(findings)}`);
  return {
    verdict: parseHookScanVerdict(r['verdict']),
    findings: findings.map(parseHookScanFinding),
  };
}

function parseHookPackageFile(raw: unknown): HookPackageFile {
  const r = asRecord(raw);
  return { path: reqString(r, 'path'), body: reqString(r, 'body'), hash: reqString(r, 'hash') };
}

/** Parse a `/api/studio/hooks/:id` detail response — the ok:true entry
 *  fields plus `files` + `packageHash` + `scan`. THROWS on any malformed
 *  field, same refusal discipline as `parseHookLibraryEntry` — `packageHash`
 *  and every file's `hash` are REQUIRED, never defaulted, so a bridge that
 *  forgot to send either surfaces as a load error rather than a page that
 *  silently omits the fingerprint an operator is meant to check. A
 *  `declared: true` finding round-trips unchanged (no field is dropped or
 *  coerced along the way). */
export function parseHookDetail(raw: unknown): HookDetail {
  const entry = parseHookLibraryEntry(raw);
  if (!entry.ok) throw new Error(`hook detail payload must be ok:true, got ok:false ("${entry.error}")`);
  const r = asRecord(raw);
  const files = r['files'];
  if (!Array.isArray(files)) throw new Error(`expected "files" to be an array, got ${JSON.stringify(files)}`);
  // `approval` is legitimately absent (nothing approved yet); a PRESENT but
  // malformed record is a malformed response and throws — never coerced.
  let approval: HookApprovalRecord | undefined;
  if (r['approval'] !== undefined) {
    const a = asRecord(r['approval']);
    const reasonRaw = a['reason'];
    if (reasonRaw !== undefined && typeof reasonRaw !== 'string') {
      throw new Error(`expected "approval.reason" to be a string when present, got ${JSON.stringify(reasonRaw)}`);
    }
    approval = {
      approvedAt: reqString(a, 'approvedAt'),
      overridden: reqBoolean(a, 'overridden'),
      ...(reasonRaw !== undefined ? { reason: reasonRaw } : {}),
    };
  }
  return {
    ...entry,
    files: files.map(parseHookPackageFile),
    packageHash: reqString(r, 'packageHash'),
    scan: parseHookScanReport(r['scan']),
    ...(approval !== undefined ? { approval } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/** Fetch the hooks library. Distinguishes a reachable-but-empty library from
 *  an unreachable bridge or a malformed payload (`ok: false` for both) — the
 *  caller must never render the two the same way. */
export async function fetchHookLibrary(): Promise<{ ok: boolean; hooks: HookLibraryEntry[]; error?: string }> {
  try {
    const res = await bridgeFetch(`/api/studio/hooks`);
    const data = (await res.json().catch(() => ({}))) as { hooks?: unknown[]; error?: string };
    if (!res.ok) return { ok: false, hooks: [], error: data.error ?? `HTTP ${res.status}` };
    if (!Array.isArray(data.hooks)) return { ok: false, hooks: [], error: 'malformed response: "hooks" is not an array' };
    try {
      return { ok: true, hooks: data.hooks.map(parseHookLibraryEntry) };
    } catch (err) {
      return { ok: false, hooks: [], error: String(err) };
    }
  } catch (err) {
    return { ok: false, hooks: [], error: String(err) };
  }
}

/** Fetch a single hook's detail (package + trust + scan). `status` is
 *  surfaced so the caller can tell a genuine 404 apart from a
 *  reachable-but-erroring bridge. */
export async function fetchHook(
  id: string,
): Promise<{ ok: boolean; status?: number; detail?: HookDetail; error?: string }> {
  try {
    const res = await bridgeFetch(`/api/studio/hooks/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data as { error?: string })?.error;
      return { ok: false, status: res.status, error: err ?? `HTTP ${res.status}` };
    }
    try {
      return { ok: true, status: res.status, detail: parseHookDetail(data) };
    } catch (err) {
      return { ok: false, status: res.status, error: String(err) };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function hookClientSend(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await bridgeFetch(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string } & Record<string, unknown>;
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: typeof data.ok === 'boolean' ? data.ok : true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function hookClientPost(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  return hookClientSend('POST', path, body);
}

/** Author a new library hook (D-5: the route always writes the script to
 *  the fixed `scripts/run.sh` path — no client-supplied script path). */
export async function createHook(input: {
  name: string;
  description: string;
  on: HookLifecycleEvent;
  matcher?: string;
  scriptBody: string;
  permissions: HookPermissions;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await hookClientPost('/api/studio/hooks', input);
  return { ok: r.ok, id: typeof r.data?.id === 'string' ? r.data.id : undefined, error: r.error };
}

/** Approve a hook (refuses a blocked verdict — 409, see the bridge route). */
export async function approveHook(id: string): Promise<{ ok: boolean; error?: string }> {
  const r = await hookClientPost(`/api/studio/hooks/${encodeURIComponent(id)}/approve`, {});
  return { ok: r.ok, error: r.error };
}

/** Override a blocked hook's verdict — a DISTINCT, explainable act; never
 *  launders the scan verdict itself (see hook-scan.ts's own contract). */
export async function overrideHookBlock(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const r = await hookClientPost(`/api/studio/hooks/${encodeURIComponent(id)}/override`, { reason });
  return { ok: r.ok, error: r.error };
}

/** W7-B4 (library-08) — edit a hook's definition fields and/or script. An
 *  edit to an approved hook honestly drops it back to needs-review (the
 *  pinned hashes no longer match) — the bridge never launders trust. */
export async function updateHook(
  id: string,
  input: Partial<{ name: string; description: string; on: HookLifecycleEvent; matcher: string | null; scriptBody: string; permissions: HookPermissions }>,
): Promise<{ ok: boolean; error?: string }> {
  const r = await hookClientSend('PUT', `/api/studio/hooks/${encodeURIComponent(id)}`, input);
  return { ok: r.ok, error: r.error };
}

/** W7-B4 (library-08) — delete a hook package. The bridge refuses (409,
 *  naming them) while any agent still carries it. */
export async function deleteHook(id: string): Promise<{ ok: boolean; error?: string }> {
  const r = await hookClientSend('DELETE', `/api/studio/hooks/${encodeURIComponent(id)}`);
  return { ok: r.ok, error: r.error };
}

/** W7-B4 (library-08) — revoke a live approval/override. Recorded in the
 *  ledger's `revoked` history; 409 when nothing is approved. */
export async function revokeHookApproval(id: string): Promise<{ ok: boolean; error?: string }> {
  const r = await hookClientPost(`/api/studio/hooks/${encodeURIComponent(id)}/revoke-approval`, {});
  return { ok: r.ok, error: r.error };
}
