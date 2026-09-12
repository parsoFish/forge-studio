/**
 * The deterministic community refresh, client side — W8-B5b, plus ruling 478's
 * discovered rows.
 *
 * Split out of `community-client.ts` (M6-D, ruling 616) because that file sat
 * at its `check-file-size` ceiling and could not carry another field. The seam
 * is the file's own: everything about `POST /api/studio/community/refresh` —
 * its route constant, its result union, its parsers and its one transport call
 * — moves together, and nothing else moved with it. `community-client.ts`
 * re-exports all of it, so no consumer's import path changed.
 */

import { bridgeFetch } from './bridge-client.ts';
import { asRecord, requireString, requireBoolean, requireNumber, parseNullableField } from './community-parse.ts';
import type { DiscoveredRow, HubOutcomeRow } from './community-types.ts';

// ---------------------------------------------------------------------------
// W8-B5b — POST /api/studio/community/refresh, the DETERMINISTIC (LLM-free)
// refresh. Types below mirror packages/library/community-refresh-run.ts's
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
      /** Ruling 478 — rows the declared hubs publish that this registry lacks;
       *  see `community-types.ts`. */
      discovered: readonly DiscoveredRow[];
      /** What each declared hub DID. A hub that published nothing and a hub
       *  forge could not read are different facts, and the strip rendered both
       *  as the same blank until this carried the reader's own reason. */
      hubOutcomes: readonly HubOutcomeRow[];
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
/** ABSENT is empty — deliberately unlike the nullable fields above, which
 *  refuse an absent key: "nothing left to discover" and "a server without this
 *  field" both mean no proposals, and the page renders the same nothing for
 *  each. Anything PRESENT is parsed strictly. */
function parseHubOutcomes(raw: unknown): HubOutcomeRow[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`expected "hubOutcomes" to be an array when present, got ${JSON.stringify(raw)}`);
  return raw.map((row) => {
    const d = asRecord(row);
    const reason = d['reason'];
    const message = d['message'];
    return {
      hubId: requireString(d, 'hubId'),
      discovered: requireNumber(d, 'discovered'),
      ...(d['partial'] === true ? { partial: true as const } : {}),
      ...(typeof reason === 'string' ? { reason } : {}),
      ...(typeof message === 'string' ? { message } : {}),
    };
  });
}

function parseDiscoveredRows(raw: unknown): DiscoveredRow[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`expected "discovered" to be an array when present, got ${JSON.stringify(raw)}`);
  return raw.map((row) => {
    const d = asRecord(row);
    return { id: requireString(d, 'id'), sourceUrl: requireString(d, 'sourceUrl'), path: requireString(d, 'path') };
  });
}

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
      discovered: parseDiscoveredRows(r['discovered']),
      hubOutcomes: parseHubOutcomes(r['hubOutcomes']),
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
  // code: `statusForRefreshReason` (packages/library/bridge-studio-community.ts:641)
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
