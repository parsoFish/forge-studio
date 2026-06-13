'use client';

import Link from 'next/link';
import type { Flow } from '@/lib/studio-client';

export function UsedByFlows({ flows }: { flows: Flow[] }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>Used By Flows</div>
      {flows.length === 0
        ? <div style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}>No flow targets this project yet.</div>
        : flows.map((fl) => (
            <div key={fl.id} style={{ marginBottom: 6 }}>
              <Link href={`/flows/${encodeURIComponent(fl.id)}`} className="badge badge-flow">{fl.name}</Link>
            </div>
          ))
      }
    </div>
  );
}
