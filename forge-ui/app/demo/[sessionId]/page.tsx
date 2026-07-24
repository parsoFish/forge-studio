'use client';

/**
 * Legacy redirect (R1-03-F2). The standalone demo-builder review surface
 * folded into the per-project page's inline `DemoBuilderPanel` (rendered
 * beneath the Demo Timeline panel — see `app/projects/[id]/page.tsx`). This
 * thin client-side redirect preserves bookmarks/deep-links to the old
 * `/demo/<sessionId>` route (mirrors the `/recovery` redirect precedent,
 * `app/recovery/page.tsx`): it resolves the session's project via
 * `listDemoSessions()` and forwards to `/projects/<project>?demo=<sessionId>`,
 * which the project page reads on mount to reopen the panel on this exact
 * session. Falls back to '/' when the session can't be resolved (already
 * locked/abandoned and pruned, or simply unknown).
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { listDemoSessions } from '@/lib/bridge-client';

export default function DemoBuilderRedirect({
  params,
}: {
  params: { sessionId: string };
}): JSX.Element {
  const sessionId = decodeURIComponent(params.sessionId);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    listDemoSessions()
      .then((sessions) => {
        if (cancelled) return;
        const session = sessions.find((s) => s.sessionId === sessionId);
        if (session) {
          router.replace(`/projects/${encodeURIComponent(session.project)}?demo=${encodeURIComponent(sessionId)}`);
        } else {
          router.replace('/');
        }
      })
      .catch(() => {
        if (!cancelled) router.replace('/');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, router]);

  return (
    <main
      data-page="demo-builder-redirect"
      data-page-ready="true"
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 13 }}
    >
      Redirecting to the project…
    </main>
  );
}
