'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { StudioArchitectShell } from '@/components/StudioArchitectShell';
import { NewIdeaBox } from '@/components/NewIdeaBox';
import { fetchArchitectSessions } from '@/lib/bridge-client';
import { fetchStudioProjects } from '@/lib/studio-client';

/**
 * Native Studio "new idea / start a run" entry (M7-4, ADR-031). Replaces the
 * /dashboard ArchitectLauncher as the harness entry point: same NewIdeaBox
 * surface ([data-section="new-idea"] + project/idea fields + start-architect),
 * same POST /api/architect/start, but inside Studio chrome. On start, navigate
 * to the native Studio interview surface (/architect/<sid>/interview), NOT the
 * retired standalone /architect/<sid> screen.
 */
export default function ArchitectNewPage(): JSX.Element {
  const router = useRouter();
  const [knownProjects, setKnownProjects] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  // P4: a project can pre-scope this entry (?project=<id>) when the operator
  // clicks "Give this project work" from the project tab.
  const [initialProject, setInitialProject] = useState('');

  useEffect(() => {
    setInitialProject(new URLSearchParams(window.location.search).get('project') ?? '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchStudioProjects().catch(() => []),
      fetchArchitectSessions().catch(() => []),
    ])
      .then(([projects, sessions]) => {
        if (cancelled) return;
        const names = new Set<string>();
        for (const p of projects) names.add(p.name);
        for (const s of sessions) names.add(s.project);
        setKnownProjects([...names].filter(Boolean).sort());
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <StudioArchitectShell dataPage="architect-new" ready={ready} title="New idea → architect">
      <p style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: 560, lineHeight: 1.6, margin: '0 0 20px' }}>
        Describe the idea like you would to a colleague. Forge reads the project
        and the brain, asks only what it can&apos;t resolve itself, then drafts a
        plan for your approval before any code is written.
      </p>
      <div style={{ maxWidth: 560 }}>
        <NewIdeaBox
          key={initialProject}
          initialProject={initialProject}
          knownProjects={knownProjects}
          onStarted={(sessionId) =>
            router.push(`/architect/${encodeURIComponent(sessionId)}/interview`)
          }
        />
      </div>
    </StudioArchitectShell>
  );
}
