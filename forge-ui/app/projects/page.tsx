'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchStudioKbs, fetchStudioProjects, type Kb, type Project } from '@/lib/studio-client';
import { fetchErrorPropsFrom } from '@/components/FetchErrorState';
import { useBridgeRecovery } from '@/lib/use-bridge-status';
import { ProjectsIndexBody, type ProjectsIndexFetchError } from '@/components/studio/ProjectsIndex';

// ---------------------------------------------------------------------------
// /projects — the real projects index (W6-IA-1).
//
// Was a 23-line shim that fetched the roster only to `router.replace()` onto
// the FIRST registered project (an arbitrary already-onboarded project's
// editor, never an index) and rendered dead-end "No projects registered."
// text with no CTA when the roster was empty. `app/page.tsx`'s Home
// dashboard linked its "Onboard a project" CTA straight at this route, so
// the operator's one onboarding entry point from Home landed on a random
// project instead of the onboarding form.
//
// This page now owns ONLY the fetch (mirrors `app/library/page.tsx`'s
// `loadAll` shape, scoped to just projects+kbs) and renders the pure,
// props-driven `ProjectsIndexBody` (`components/studio/ProjectsIndex.tsx`) —
// the piece unit-tested via `lib/projects-index-render.test.ts`.
// ---------------------------------------------------------------------------

export default function ProjectsIndexPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [ready, setReady] = useState(false);
  // W7-A1 (crosscut-01/-22): a failed fetch is an ERROR state, never "No
  // projects yet"; `loadKey` re-runs the load on Retry + bridge recovery.
  const [error, setError] = useState<ProjectsIndexFetchError | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const reload = useCallback(() => setLoadKey((k) => k + 1), []);
  useBridgeRecovery(reload);

  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      try {
        const [p, k] = await Promise.all([fetchStudioProjects(), fetchStudioKbs()]);
        if (signal.cancelled) return;
        setProjects(p);
        setKbs(k);
        setError(null);
      } catch (err) {
        if (signal.cancelled) return;
        const { error: message, status } = fetchErrorPropsFrom(err);
        setError(status !== undefined ? { message, status } : { message });
      } finally {
        if (!signal.cancelled) setReady(true);
      }
    })();
    return () => { signal.cancelled = true; };
  }, [loadKey]);

  return <ProjectsIndexBody projects={projects} kbs={kbs} ready={ready} error={error} onRetry={reload} />;
}
