'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchStudioKbs, fetchStudioProjects, type Kb, type Project } from '@/lib/studio-client';
import { fetchCycles, fetchProjectAttention, type Cycle, type ProjectAttentionItem } from '@/lib/bridge-client';
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

  // W8-C3 (projects-08): the activity sources are a SEPARATE read with its own
  // failure. Folding them into the roster's `Promise.all` would let a hiccup in
  // the attention aggregate turn a perfectly good roster into a full-page error
  // state. `undefined` = not settled yet; `[]` = settled and empty.
  const [attention, setAttention] = useState<ProjectAttentionItem[] | undefined>(undefined);
  const [cycles, setCycles] = useState<Cycle[] | undefined>(undefined);
  const [activityError, setActivityError] = useState<ProjectsIndexFetchError | null>(null);

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

  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      try {
        const [a, c] = await Promise.all([fetchProjectAttention(), fetchCycles()]);
        if (signal.cancelled) return;
        setAttention(a);
        setCycles([...c.live, ...c.recent]);
        setActivityError(null);
      } catch (err) {
        if (signal.cancelled) return;
        // Never swallowed: the body renders an explicit "activity unavailable"
        // notice, so a failed read can never read as a quiet roster.
        const { error: message, status } = fetchErrorPropsFrom(err);
        setAttention(undefined);
        setCycles(undefined);
        setActivityError(status !== undefined ? { message, status } : { message });
      }
    })();
    return () => { signal.cancelled = true; };
  }, [loadKey]);

  return (
    <ProjectsIndexBody
      projects={projects}
      kbs={kbs}
      ready={ready}
      error={error}
      onRetry={reload}
      attention={attention}
      cycles={cycles}
      activityError={activityError}
    />
  );
}
