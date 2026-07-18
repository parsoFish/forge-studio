'use client';

/**
 * Legacy redirect (R4-11-T3). The standalone stuck-initiative surface (S9/DEC-6)
 * folded onto the per-project roadmap's `InitiativeCard` — a recoverable initiative
 * (in-flight / ready-for-review / failed) now gets inspect/requeue/abandon right on
 * its roadmap card. This thin client-side redirect preserves bookmarks / deep-links
 * to the old route, sending them to the library — the future home of R4-11-F4's
 * cross-project attention strip aggregating stuck initiatives.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RecoveryRedirect(): JSX.Element {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return (
    <main
      data-page="recovery-redirect"
      data-page-ready="true"
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 13 }}
    >
      Redirecting to the library…
    </main>
  );
}
