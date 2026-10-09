'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchRepoStatus } from './studio-client';
import type { RepoStatus } from './save-control';

/** How often the project page re-reads repo-status (forge-mfv5.1.20). */
export const REPO_STATUS_POLL_MS = 5000;

/**
 * Poll `GET /api/studio/projects/:id/repo-status` while the project page is open,
 * one read at a time (a timeout chain, never overlapping intervals). A failed read
 * leaves `repo` null — unknown — and the Save control falls back to the form.
 */
export function useRepoStatus(projectId: string | null): { repo: RepoStatus | null; refresh: () => void } {
  const [repo, setRepo] = useState<RepoStatus | null>(null);
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const read = async (): Promise<void> => {
      try {
        const r = await fetchRepoStatus(projectId);
        if (!cancelled) setRepo(r);
      } catch {
        if (!cancelled) setRepo(null);
      }
      if (!cancelled) timer.current = setTimeout(() => void read(), REPO_STATUS_POLL_MS);
    };
    void read();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [projectId, tick]);
  return { repo, refresh };
}
export { deriveSaveControl } from './save-control';
