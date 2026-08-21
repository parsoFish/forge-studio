'use client';

import Link from 'next/link';
import type { Flow } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// UsedInFlows — shows flows that reference this agent slug in their nodes.
//
// W7-C1 (agents-27): an optional `dispatchNote` — the honest "who dispatches
// this agent, if not a flow" line, derived from the agent's SKILL-declared
// phase by `lib/agent-dispatch-provenance.ts`. Rendered ALONGSIDE the
// flow-usage fact (which stays truthful), so a production-wired agent like
// release-finalizer no longer reads as an orphan.
// ---------------------------------------------------------------------------

type Props = {
  agentSlug: string;
  flows: Flow[];
  /** `dispatchProvenanceNote(agent.phase)` — null renders nothing extra. */
  dispatchNote?: string | null;
};

export function UsedInFlows({ agentSlug, flows, dispatchNote = null }: Props) {
  const used = flows.filter((fl) =>
    (fl.nodes ?? []).some((n) => n.agent === agentSlug || n.id === agentSlug)
  );

  return (
    <div className="flows-panel panel" style={{ padding: 12 }} data-component="used-in-flows">
      <div className="panel-head" style={{ margin: '-12px -12px 10px', padding: '10px 12px' }}>Used in Flows</div>
      <div className="flows-chips" id="flows-chips">
        {used.length === 0 ? (
          <span className="no-flows">Not yet used in any flow.</span>
        ) : (
          used.map((fl) => (
            <Link
              key={fl.id}
              href={`/flows/${encodeURIComponent(fl.id)}`}
              className="flow-chip-link"
              title={fl.goal ?? ''}
            >
              {fl.name}
            </Link>
          ))
        )}
      </div>
      {dispatchNote && (
        <p
          data-dispatch-note="true"
          style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.55, color: 'var(--dim)' }}
        >
          {dispatchNote}
        </p>
      )}
    </div>
  );
}
