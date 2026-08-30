'use client';

import { useEffect, useState } from 'react';

import { fetchStudioProjects, fetchAgentCapability, type AgentCapability } from '@/lib/studio-client';
import type { FetchState } from '@/lib/route-readiness';

/**
 * The architect kickoff form's roster read, owned OUTSIDE the form.
 *
 * `NewIdeaBox` used to fetch this itself, which left the routes that host it
 * unable to say whether their own first fetch had settled — so both wrote
 * `ready={true}` as a literal and `data-page-ready` disagreed with the
 * `data-roster-state` rendered one element below it (`forge-8vfn.5.7`).
 * Hoisting the read to the host makes the host the owner of the ONE state both
 * attributes derive from; there is no copy left to go stale.
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
