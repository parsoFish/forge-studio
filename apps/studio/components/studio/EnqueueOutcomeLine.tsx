'use client';

/**
 * EnqueueOutcomeLine — the honest "enqueued — now what?" line after a Plan /
 * Start development / Start Run click (W7-A3: projects-16/17/32, flows-02/23).
 *
 * Every one of those buttons is a QUEUE WRITE; `forge serve` does the actual
 * running, and `forge studio` supervises it directly (M7-E row 205) — there
 * is no operator start control to put here. This line states the claim and
 * links the run the enqueue just returned
 * (`/flows/<flowId>/run/<initiativeId>` — the initiative id is the run
 * handle that stays valid across serve's claim), and mounts the ONE shared
 * `<ServeStatusNotice>` so a restarting/draining/down serve is still honest
 * about "nothing will run yet" instead of silently promising progress.
 *
 * `EnqueueOutcomeLineView` is the pure half (render-pinned);
 * `EnqueueOutcomeLine` wires it to `useServeStatus()` — the poll only starts
 * once an enqueue actually succeeded and the line mounts.
 *
 * DOM contract:
 *   [data-component="enqueue-outcome"][data-enqueue-kind][data-run-id]
 *     a[data-action=<runAction>]  (when a run href is known)
 *     [data-component="serve-status-notice"][data-serve-state] (when serve is not running)
 */

import Link from 'next/link';

import { ServeStatusNotice } from '@/components/studio/ServeStatusNotice';
import { useServeStatus } from '@/lib/use-serve-status';
import type { ServeStatus } from '@/lib/bridge-client';

export type EnqueueOutcomeLineViewProps = {
  kind: 'plan' | 'develop' | 'flow';
  /** The stable run handle — the INITIATIVE id (see `enqueuedRunHref`). */
  runId?: string;
  flowId?: string;
  /** The `data-action` name on the run link (kept per surface for the journeys). */
  runAction: string;
  serve: ServeStatus | null;
};

const KIND_CLAIM: Record<'plan' | 'develop' | 'flow', string> = {
  plan: 'Planning enqueued — forge serve will decompose it into work items.',
  develop: 'Development enqueued — the develop flow will open a PR for review.',
  flow: 'Run enqueued — forge serve will pick it up.',
};

/** Href for the run an enqueue just returned — flow + run handle when both are
 *  known, the flow monitor when only the flow is, else null (never fabricated).
 *  `runId` is the STABLE handle: the initiative id (the bridge's findRun matches
 *  it in every queue state — a planned run's own id IS the initiative id, and a
 *  claimed run is found by its initiativeId), never the cycle id, which only
 *  resolves once serve has claimed the manifest. */
function enqueuedRunHref(enqueued: { runId?: string; flowId?: string }): string | null {
  if (enqueued.flowId && enqueued.runId) {
    return `/flows/${encodeURIComponent(enqueued.flowId)}/run/${encodeURIComponent(enqueued.runId)}`;
  }
  if (enqueued.flowId) return `/flows/${encodeURIComponent(enqueued.flowId)}`;
  return null;
}

export function EnqueueOutcomeLineView({
  kind,
  runId,
  flowId,
  runAction,
  serve,
}: EnqueueOutcomeLineViewProps): JSX.Element {
  const runHref = enqueuedRunHref({ runId, flowId });
  return (
    <div
      data-component="enqueue-outcome"
      data-enqueue-kind={kind}
      // Bead `forge-8vfn.7.6.8` — the minted-session rule extends to a minted
      // RUN. `runId` built the href and reached the DOM nowhere, so the run was
      // nameable only by reading a URL out of an anchor, which no beat can do.
      // Undefined omits the attribute: no run, no id, never a bindable "".
      data-run-id={runId}
      style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--green, #3fb950)', fontWeight: 600 }}>
          {KIND_CLAIM[kind]}
        </span>
        {runHref && (
          <Link
            data-action={runAction}
            href={runHref}
            style={{ fontSize: 11, color: '#fff', background: '#1f6feb', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', textDecoration: 'none' }}
          >
            view run →
          </Link>
        )}
      </div>
      <ServeStatusNotice status={serve} variant="strip" />
    </div>
  );
}

export function EnqueueOutcomeLine(props: Omit<EnqueueOutcomeLineViewProps, 'serve'>): JSX.Element {
  const { status } = useServeStatus();
  return <EnqueueOutcomeLineView {...props} serve={status} />;
}
