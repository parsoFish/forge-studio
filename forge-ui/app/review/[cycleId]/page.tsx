'use client';

/**
 * Legacy redirect (M7-3, ADR-031). The review human moment is now served by the
 * unified artifact viewer at /artifact?run=<id>&type=verdict&mode=gate. This thin
 * client-side redirect preserves any bookmarks / deep-links to the old route.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ReviewCycleRedirect({ params }: { params: { cycleId: string } }): JSX.Element {
  const router = useRouter();
  const cycleId = decodeURIComponent(params.cycleId);

  useEffect(() => {
    router.replace(`/artifact?run=${encodeURIComponent(cycleId)}&type=verdict&mode=gate`);
  }, [router, cycleId]);

  return (
    <main
      data-page="review-redirect"
      data-page-ready="true"
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 13 }}
    >
      Redirecting to the artifact viewer…
    </main>
  );
}
