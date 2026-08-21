'use client';

import { useRouter } from 'next/navigation';
import type { Kb } from '@/lib/studio-client';

interface Props {
  kbs: Kb[];
  currentId: string;
}

const BINDING_GROUPS: { kind: string; label: string }[] = [
  { kind: 'flow',    label: 'Flow Knowledge' },
  { kind: 'project', label: 'Project Brains' },
  { kind: 'unique',  label: 'Core' },
];

/** Sentinel `<option>` value for the zero-KB "+ New knowledge base" entry —
 *  distinguishes "navigate to the create form" from a real KB id in
 *  `handleChange` (W6-IA-4 sweep finding C4#2). Not a real KB id, so it can
 *  never collide with one. */
const NEW_KB_OPTION_VALUE = '__new__';

export function KbSelector({ kbs, currentId }: Props) {
  const router = useRouter();
  const isEmpty = kbs.length === 0;

  const groups: Record<string, Kb[]> = { flow: [], project: [], unique: [] };
  for (const kb of kbs) {
    const bucket = groups[kb.binding.kind] ?? (groups[kb.binding.kind] = []);
    bucket.push(kb);
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id === NEW_KB_OPTION_VALUE) {
      router.push('/knowledge/new');
      return;
    }
    router.push(`/knowledge?id=${encodeURIComponent(id)}`);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <select
        id="kb-select"
        aria-label="Select knowledge base"
        value={isEmpty ? '' : currentId}
        onChange={handleChange}
        data-kb-select-empty={isEmpty ? 'true' : 'false'}
        style={{
          background: 'var(--panel)', border: '1px solid var(--line-2)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text)',
 fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500,
          padding: '6px 10px', cursor: 'pointer',
        }}
      >
        {isEmpty ? (
          <>
            {/* W6-IA-4 sweep finding C4#2: a zero-KB roster used to render an
                empty <select> with no options at all — nothing to see, and
                the OS-native "no options" affordance is not a discoverable
                creation path. Now: a disabled placeholder (so the selector
                is never mistaken for offering a real, silently-empty KB)
                plus a REAL, selectable "+ New knowledge base" entry. */}
            <option value="" disabled data-kb-select-placeholder="true">
              No knowledge bases yet
            </option>
            <option value={NEW_KB_OPTION_VALUE} data-action="new-kb-select-option">
              + New knowledge base
            </option>
          </>
        ) : (
          BINDING_GROUPS.map(({ kind, label }) => {
            const items = groups[kind];
            if (!items?.length) return null;
            return (
              <optgroup key={kind} label={label}>
                {items.map((kb) => (
                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                ))}
              </optgroup>
            );
          })
        )}
      </select>
    </div>
  );
}
