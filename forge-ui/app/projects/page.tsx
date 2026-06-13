'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchStudioProjects } from '@/lib/studio-client';
import { StudioNav } from '@/components/StudioNav';

export default function ProjectsIndexPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetchStudioProjects().then((projects) => {
      if (projects.length > 0) {
        router.replace(`/projects/${encodeURIComponent(projects[0].id)}`);
      } else {
        setReady(true);
      }
    }).catch(() => setReady(true));
  }, [router]);

  if (!ready) return <main data-page="projects-index" style={{ minHeight: '100vh', background: 'var(--bg)' }}><StudioNav /><div style={{ padding: 40, color: 'var(--dim)' }}>Loading…</div></main>;
  return <main data-page="projects-index" style={{ minHeight: '100vh', background: 'var(--bg)' }}><StudioNav /><div style={{ padding: 40, color: 'var(--dim)' }}>No projects registered.</div></main>;
}
