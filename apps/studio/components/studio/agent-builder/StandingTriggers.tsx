'use client';

import {
  standingTriggersForAgent,
  triggerScopeCount,
  type StandingTrigger,
} from '@/lib/standing-triggers';

// ---------------------------------------------------------------------------
// StandingTriggers (R6-01 WI-4) — READ-ONLY list of the standing triggers
// whose target is this agent, on the agent kickoff panel.
//
// Same shape as the sibling `UsedInFlows.tsx`: a derived list rendered from
// an already-fetched prop, with no fetch, no state and no mutation of its
// own. The caller (app/agents/[id]/page.tsx) fetches the FULL
// `GET /api/triggers` roster once and hands it down whole; the filtering to
// this agent happens here via `standingTriggersForAgent`, so no caller can
// hand this component a pre-filtered list that disagrees with the rule.
//
// The `data-*` names below are RESERVED vocabulary, named (not attached) by
// R2-08-F4 in docs/forge-ui-dom-and-harness.md — "Trigger provenance". This
// component is the consuming surface that attaches them. `data-trigger-kind`
// carries the declaration's `on`, exactly as the flow builder's existing
// trigger chip does (FlowHeader.tsx `data-trigger-kind={tr.on}`) — reused,
// not forked.
//
// A trigger is a DECLARATION, not a run: nothing here dispatches, edits or
// deletes. Authoring lives in the flow builder, where the declaration
// actually belongs.
// ---------------------------------------------------------------------------

type Props = {
  agentSlug: string;
  /** The FULL unfiltered `GET /api/triggers` result — filtered here. */
  triggers: StandingTrigger[];
};

/** Human-readable rendering of the scope the DOM carries as
 *  `data-trigger-scope-count`. `null` (unscoped) and `[]` (scoped to
 *  nothing) are opposites and must never read the same. */
function scopeLabel(projects: string[] | null): string {
  if (!Array.isArray(projects)) return 'all projects';
  if (projects.length === 0) return 'no projects';
  return projects.join(', ');
}

export function StandingTriggers({ agentSlug, triggers }: Props) {
  const mine = standingTriggersForAgent(agentSlug, triggers);

  return (
    <section data-component="standing-triggers" style={{ marginTop: 10 }}>
      <label className="field-label" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
        Standing triggers
      </label>
      {mine.length === 0 ? (
        <p
          data-component="standing-triggers-empty"
          className="muted"
          style={{ fontSize: 11, margin: 0 }}
        >
          Nothing starts this agent automatically — it runs only when dispatched here.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 11 }}>
          {mine.map((t, i) => (
            <li
              key={`${t.sourceFlowId}:${t.on}:${t.target.ref}:${i}`}
              data-standing-trigger="true"
              data-trigger-kind={t.on}
              data-trigger-target={t.target.ref}
              data-trigger-scope-count={triggerScopeCount(t.projects)}
              style={{ padding: '2px 0' }}
            >
              on <strong>{t.on}</strong> · declared by <code>{t.sourceFlowId}</code> ·{' '}
              <span className="muted">{scopeLabel(t.projects)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
