'use client';

import { useEffect, useState } from 'react';
import { ProjectContractPanel } from '@/components/studio/project-builder/ProjectContractPanel';

// ContractPanelMount (R4-12-F1) — the client-side seam that mounts the ASYNC
// server component <ProjectContractPanel> inside the 'use client' project page. React
// 18 can't render an async component directly in a client tree (and has no
// `use()` for its returned promise), so this resolves the panel's element in an
// effect and renders it. The panel still owns its OWN fetch
// (fetchContractStages) exactly as its render-test contract pins — this seam
// only threads the props + awaits the returned markup.
//
// Moved out of app/projects/[id]/page.tsx (row 174, forge-8vfn.8.5.9) so that
// file stays under its file-size baseline.
export function ContractPanelMount(props: {
  projectId: string;
  northStar?: string | null;
  instructions?: string | null;
  instructionsSource?: string | null;
}) {
  const { projectId, northStar, instructions, instructionsSource } = props;
  const [el, setEl] = useState<JSX.Element | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ProjectContractPanel({ projectId, northStar, instructions, instructionsSource })
      .then((resolved) => { if (!cancelled) setEl(resolved); })
      .catch(() => { if (!cancelled) setEl(null); });
    return () => { cancelled = true; };
  }, [projectId, northStar, instructions, instructionsSource]);
  return el;
}
