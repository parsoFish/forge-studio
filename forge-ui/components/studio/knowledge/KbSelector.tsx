'use client';

import { useRouter } from 'next/navigation';
import type { Kb } from '@/lib/studio-client';

interface Props {
  kbs: Kb[];
  currentId: string;
}

const SCOPE_GROUPS: { scope: string; label: string }[] = [
  { scope: 'project',          label: 'Project Brains' },
  { scope: 'flow',             label: 'Flow Knowledge' },
  { scope: 'agent-integration', label: 'Agent Integration' },
];

export function KbSelector({ kbs, currentId }: Props) {
  const router = useRouter();

  const groups: Record<string, Kb[]> = { project: [], flow: [], 'agent-integration': [] };
  for (const kb of kbs) {
    const bucket = groups[kb.scope] ?? (groups[kb.scope] = []);
    bucket.push(kb);
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    router.push(`/knowledge?id=${encodeURIComponent(id)}`);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <select
        id="kb-select"
        aria-label="Select knowledge base"
        value={currentId}
        onChange={handleChange}
        style={{
          background: 'var(--panel)', border: '1px solid var(--line-2)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text)',
          fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500,
          padding: '6px 10px', outline: 'none', cursor: 'pointer',
        }}
      >
        {SCOPE_GROUPS.map(({ scope, label }) => {
          const items = groups[scope];
          if (!items?.length) return null;
          return (
            <optgroup key={scope} label={label}>
              {items.map((kb) => (
                <option key={kb.id} value={kb.id}>{kb.name}</option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}
