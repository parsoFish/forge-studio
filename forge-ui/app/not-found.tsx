'use client';

/**
 * Unmatched-route page (W7-A4, finding crosscut-07): a mistyped URL
 * (`/knowledge/nope`, `/community/new`, `/totally-not-a-route`) renders the
 * ONE shared NotFound with Studio chrome intact — the top nav and a way home —
 * instead of Next's bare 404. Same contract as every `[id]` route's unknown
 * branch: `data-page="not-found"`, `data-not-found-kind="page"`,
 * `data-not-found-id=<pathname>`.
 */
import { usePathname } from 'next/navigation';

import { NotFound } from '@/components/NotFound';

export default function StudioNotFound() {
  const pathname = usePathname() ?? '';
  return (
    <NotFound
      kind="page"
      id={pathname}
      backHref="/"
      backLabel="Home"
      detail="No Studio route matches this path — pick a pillar from the nav above, or head home."
    />
  );
}
