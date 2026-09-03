/**
 * Drives this package's route TABLE directly, with no bridge.
 *
 * COMMON §5: a package test never boots one. Both affordance suites used to —
 * they called `startBridge` and `fetch`ed a real port, which is why they could
 * not move into the package with the dispatch they cover. Converting them is
 * rulings 30/49/50: the body arrives as the RESULT `ctx.readBody()` hands down
 * (never a bodyless default, which silently loses exactly the cases that post
 * one), and a path no entry claims maps to the host's 404 rather than to a
 * status of 0, so an assertion cannot pass against a route that is not there.
 *
 * What is NOT exercised here, deliberately: origin/CSRF and the host's own
 * 404 fallthrough. Those are the HOST's request policy and stay pinned in
 * `cli/bridge-studio-affordances.test.ts`, which still boots a real bridge.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

import { dispatchRoute, type RouteContext } from '@forge/kernel';
import { sessionsRoutes, type SessionsRouteDeps } from '../../../routes.ts';

/** A complete inert deps set. The three the affordance arms actually read are
 *  overridable: the spawn outcome, the per-kind broadcast, and the brain-fix
 *  turn. `runFixTurn` THROWS by default — no case here expects a dispatch, and
 *  a plausible stub would hide a future one (knowledge's own precedent). */
export function affordanceDeps(root: string, over: Partial<SessionsRouteDeps> = {}): SessionsRouteDeps {
  return {
    ensureSessionTail: () => {},
    broadcastKindChanged: () => {},
    broadcastArchitectChanged: () => {},
    broadcastInstructionsChanged: () => {},
    broadcastProjectBrainChanged: () => {},
    spawnAgentDispatch: () => {},
    newRunStamp: () => 'stamp',
    safeInputKeyRe: /^[A-Za-z0-9_-]+$/,
    broadcastDemoChanged: () => {},
    projectsRoot: join(root, 'projects'),
    spawnAgentTurn: () => ({ ok: true, spawned: false }),
    spawnAgentSpecs: {},
    safeParseJson: () => null,
    servedFileHeaders: () => ({}),
    dryBridgeAgentTurnMarker: () => ({}),
    isContainedProjectRepoPath: () => true,
    runFixTurn: async () => { throw new Error('unexpected brain-fix dispatch in this test'); },
    ...over,
  };
}

const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

/** `headersSent` and `statusCode` are both load-bearing: `verdictWasAccepted`
 *  reads them to decide whether a handler ANSWERED, and a mock that leaves
 *  `headersSent` false would silently stop every verdict recording. */
function mockRes(): { res: ServerResponse; captured: { status: number | null; body: string } } {
  const captured: { status: number | null; body: string } = { status: null, body: '' };
  const res = {
    headersSent: false,
    statusCode: 200,
    writeHead(status: number) {
      captured.status = status;
      (res as { statusCode: number }).statusCode = status;
      (res as { headersSent: boolean }).headersSent = true;
      return res;
    },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

export type HandlerResponse = {
  readonly status: number;
  readonly text: string;
  json<T>(): T;
};

/** POSTs `path` at the table built over `root`. An unclaimed path answers 404
 *  — the host's own reply for "no route" — never 0. */
export async function postAt(
  root: string,
  path: string,
  body: unknown,
  deps: SessionsRouteDeps,
): Promise<HandlerResponse> {
  const { res, captured } = mockRes();
  const ctx: RouteContext = {
    forgeRoot: root,
    logsRoot: join(root, '_logs'),
    readBody: async () => body,
  };
  const matched = await dispatchRoute(sessionsRoutes(deps), mockReq(), res, ctx, path, 'POST');
  const status = matched ? (captured.status ?? 0) : 404;
  const text = matched ? captured.body : '{"error":"not found"}';
  return { status, text, json: <T>() => JSON.parse(text || '{}') as T };
}
