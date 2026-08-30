'use client';

import { useEffect, useState } from 'react';

import { fetchStudioProjects, fetchAgentCapability, type AgentCapability } from '@/lib/studio-client';
import type { FetchState } from '@/lib/route-readiness';

/**
 * The architect kickoff form's roster read, owned OUTSIDE the form so the
 * HOST route can derive its own `data-page-ready` from the same state the form
 * renders as `data-roster-state` (`forge-8vfn.5.7`). One owner, no copy.
 */
export type ProjectRoster = {
  readonly projects: readonly { id: string; name: string }[];
  readonly capability: AgentCapability | null;
  readonly state: FetchState;
};

export function useProjectRoster(agentSlug = 'architect'): ProjectRoster {
  const [roster, setRoster] = useState<ProjectRoster>({ projects: [], capability: null, state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStudioProjects(), fetchAgentCapability(agentSlug).catch(() => null)])
      .then(([projects, capability]) => {
        if (cancelled) return;
        const list = projects
          .map((p) => ({ id: p.id, name: p.name ?? p.id }))
          .sort((a, b) => a.id.localeCompare(b.id));
        setRoster({ projects: list, capability, state: 'ok' });
      })
      .catch(() => {
        if (!cancelled) setRoster({ projects: [], capability: null, state: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [agentSlug]);

  return roster;
}
