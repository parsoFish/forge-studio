'use client';

import { useState } from 'react';
import type { Flow } from '@/lib/studio-client';

/**
 * RunAFlow (P4) — replaces the old read-only "Used by flows" list. In the new
 * model a flow is given work FROM the project: pick a flow, click "give this
 * project work", and land on the architect entry pre-scoped to this project
 * (the established work-creation path; the chosen flow is carried as ?flow=).
 *
 * Only flows whose kickoff starts with an interactive component (kickoff.kind ===
 * 'idea', e.g. forge-architect) belong here — they are the operator's "describe
 * the work" entry point. Flows fed by that (kickoff: initiative-select, e.g.
 * forge-develop) launch from the roadmap's planned initiatives; trigger-only
 * flows (forge-reflect) are never manually launched.
 */
export function UsedByFlows({ flows, projectId }: { flows: Flow[]; projectId: string }) {
  const ideaFlows = flows.filter((f) => f.kickoff?.kind === 'idea');
  const [flowId, setFlowId] = useState(ideaFlows[0]?.id ?? '');
  const href = `/architect/new?project=${encodeURIComponent(projectId)}${flowId ? `&flow=${encodeURIComponent(flowId)}` : ''}`;

  return (
    <div data-section="run-a-flow">
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
        Run a flow
      </div>
      {ideaFlows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}>No interactive flow yet — build one whose kickoff is an idea.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select
            data-field="run-flow-select"
            value={flowId}
            onChange={(e) => setFlowId(e.target.value)}
            style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, padding: '6px 9px', outline: 'none' }}
          >
            {ideaFlows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <a
            className="btn btn-primary"
            data-action="run-a-flow"
            href={href}
            style={{ textDecoration: 'none', textAlign: 'center' }}
          >
            Give this project work →
          </a>
          <span style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.5 }}>
            Describe the work to the architect; it plans, you approve, and the flow builds it.
          </span>
        </div>
      )}
    </div>
  );
}
