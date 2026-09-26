import Link from 'next/link';

import { runDetailHref } from '@/lib/run-detail-href';
import type { Run } from '@/lib/studio-client';

/**
 * The breadcrumb's run segment (with its `/` separator) on the artifact / gate
 * page — `forge-8vfn.8.1.18`. A link to the run's OWN page
 * (`a[data-action="open-run"]`) when a run record resolved, so an operator at a
 * gate can get back to the run's timeline; the plain id when none did — never a
 * guessed path (lib/run-detail-href.ts).
 */
export function RunCrumb({ run, runId }: { run: Run | null; runId: string }) {
  const href = runDetailHref(run);
  const label = runId || '—';
  const segment = href === null ? (
    <span>{label}</span>
  ) : (
    <Link href={href} data-action="open-run" style={{ color: 'var(--dim)', textDecoration: 'none' }}>
      {label}
    </Link>
  );
  return (
    <>
      <span style={{ color: 'var(--line-2)' }}>/</span>
      {segment}
    </>
  );
}
