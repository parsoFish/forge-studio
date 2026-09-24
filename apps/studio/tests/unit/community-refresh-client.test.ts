/**
 * forge-95q7 — COMMUNITY_REFRESH_ROUTE's wiring into `postCommunityRefresh`
 * was pinned ONLY by journey CM-23 (scripts/journeys/community.mjs, now
 * retired, b13502f5), never by the unit suite: repointing the constant at a
 * different route produced zero new failures across the full forge-ui
 * vitest run. This is the missing unit/contract pin — a mocked-transport
 * round trip, the same convention `community-client.test.ts` already uses
 * for `installCommunityItem`'s mcp/tool arm (itself following
 * `connection-client.test.ts`'s `installConnection` precedent) — because
 * the defect under test is DISPATCH (which route the POST actually hits),
 * not a pure parse function.
 *
 * Kills: any change to `postCommunityRefresh` (or to the route constant
 * itself, if a caller stopped reading it) that sends the refresh POST to a
 * route other than the one `COMMUNITY_REFRESH_ROUTE` names.
 */
import { test, expect, vi, beforeEach } from 'vitest';

const mockBridgeFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../lib/bridge-client.ts', () => ({
  bridgeFetch: (path: string, init?: RequestInit) => mockBridgeFetch(path, init),
}));

import { COMMUNITY_REFRESH_ROUTE, postCommunityRefresh } from '../../lib/community-refresh-client.ts';

beforeEach(() => {
  mockBridgeFetch.mockReset();
});

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const WELL_FORMED_OK_BODY = {
  wrote: true,
  dryRun: false,
  lastRefresh: '2026-09-25T00:00:00.000Z',
  counts: { total: 0, refreshed: 0, unchanged: 0, noUpstream: 0, failed: 0 },
  outcomes: [],
  errors: [],
};

test('postCommunityRefresh POSTs to the route COMMUNITY_REFRESH_ROUTE names, not a hardcoded literal', async () => {
  mockBridgeFetch.mockResolvedValue(jsonRes(200, WELL_FORMED_OK_BODY));
  await postCommunityRefresh();
  expect(mockBridgeFetch).toHaveBeenCalledTimes(1);
  const [calledPath, calledInit] = mockBridgeFetch.mock.calls[0]!;
  expect(calledPath).toBe(COMMUNITY_REFRESH_ROUTE);
  expect(calledInit?.method).toBe('POST');
});

test('COMMUNITY_REFRESH_ROUTE is the real community-refresh endpoint, not some other session/start route (forge-95q7 — the exact class of drift a mutation of the constant alone would miss)', () => {
  expect(COMMUNITY_REFRESH_ROUTE).toBe('/api/studio/community/refresh');
});
