'use client';

import Link from 'next/link';
import type { Flow } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// UsedInFlows — shows flows that reference this agent slug in their nodes
// ---------------------------------------------------------------------------

type Props = {
  agentSlug: string;
  flows: Flow[];
};

export function UsedInFlows({ agentSlug, flows }: Props) {
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
    </div>
  );
}
