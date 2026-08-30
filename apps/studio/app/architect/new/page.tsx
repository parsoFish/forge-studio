'use client';

import { useEffect, useState } from 'react';

import { StudioArchitectShell } from '@/components/StudioArchitectShell';
import { NewIdeaBox } from '@/components/NewIdeaBox';
import { routeReady } from '@/lib/route-readiness';
import { useProjectRoster } from '@/lib/use-project-roster';

/**
 * Native Studio "new idea / start a run" entry (M7-4, ADR-031). W7-B6: the
 * whole form lives in `NewIdeaBox` (self-contained: roster select over real
 * project ids, tier picker, cost ceiling) so `/architect/new` and
 * `/sessions/architect/new` render the SAME component — the two entries
 * converge on one form (projects-14/-15, sessions-kinds-03/-04,
 * crosscut-21). On start, navigate to the shared session shell
 * (/sessions/architect/<sid>).
 */
export default function ArchitectNewPage(): JSX.Element {
  // forge-8vfn.5.7: this route's FIRST fetch is the kickoff form's roster, so
  // `data-page-ready` is derived from it instead of being declared `true`
  // beside a `data-roster-state="loading"` that contradicted it.
  const roster = useProjectRoster();
  // P4: a project can pre-scope this entry (?project=<id>) when the operator
  // clicks "Give this project work" from the project tab. NewIdeaBox itself
  // validates the id against the roster (crosscut-21: an unknown ?project=
  // renders an honest notice, never an enabled Start).
  const [initialProject, setInitialProject] = useState('');
  useEffect(() => {
    setInitialProject(new URLSearchParams(window.location.search).get('project') ?? '');
  }, []);

  return (
    <StudioArchitectShell dataPage="architect-new" ready={routeReady(roster.state)} title="New idea → architect">
      <p style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: 560, lineHeight: 1.6, margin: '0 0 20px' }}>
        Describe the idea like you would to a colleague. Forge reads the project
        and the brain, asks only what it can&apos;t resolve itself, then drafts a
        plan for your approval before any code is written.
      </p>
      <div style={{ maxWidth: 560 }}>
        <NewIdeaBox key={initialProject} roster={roster} initialProject={initialProject} />
      </div>
    </StudioArchitectShell>
  );
}
