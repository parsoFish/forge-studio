'use client';

import { useState } from 'react';
import type { Kb } from '@/lib/studio-client';
import { createKb, bootstrapKb } from '@/lib/studio-client';

type CreateState = 'idle' | 'creating' | 'bootstrapping' | 'done' | 'error';
const KB_KINDS = [
  { id: 'project', label: 'Project' },
  { id: 'flow', label: 'Flow' },
  { id: 'agent-integration', label: 'Agent integration' },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48); // keep ids reasonable in length
}

export function KbBind({
  kb,
  kbs,
  projectName,
  summary,
  onChange,
}: {
  kb: string | null;
  kbs: Kb[];
  projectName?: string;
  summary?: string;
  onChange: (v: string | null) => void;
}) {
  const boundKb = kb ? kbs.find((k) => k.id === kb) : null;
  const [createState, setCreateState] = useState<CreateState>('idle');
  const [createError, setCreateError] = useState<string | null>(null);
  const [kind, setKind] = useState('project');

  async function handleCreateProjectBrain() {
    const base = projectName ? slugify(projectName) : 'project';
    const id = `${base}-brain`;
    const name = projectName ? `${projectName} Brain` : 'Project Brain';
    setCreateState('creating');
    setCreateError(null);
    const result = await createKb({
      id,
      name,
      scope: kind,
      desc: `${KB_KINDS.find((k) => k.id === kind)?.label ?? 'Project'} knowledge base for ${projectName ?? id}`,
    });
    if (!result.ok) {
      setCreateState('error');
      setCreateError(result.error ?? 'Unknown error');
      return;
    }
    // P3: bootstrap real content (a seeded profile node + index) so the brain
    // isn't an empty stub — staged progress, not an instant fake "Created".
    setCreateState('bootstrapping');
    const boot = await bootstrapKb(result.id ?? id, { name, summary });
    if (!boot.ok) {
      setCreateState('error');
      setCreateError(boot.error ?? 'bootstrap failed');
      return;
    }
    setCreateState('done');
    onChange(result.id ?? id);
  }

  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>Knowledge Base</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {boundKb ? (
          <span className="chip" data-kind="kb">
            <span className="dot" />
            {boundKb.name}
            <span className="x" onClick={() => onChange(null)} style={{ cursor: 'pointer' }}>×</span>
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}>None bound</span>
        )}
      </div>
      <select
        value={kb ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={{
          width: '100%', background: 'var(--panel)', border: '1px solid var(--line-2)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)',
          fontSize: 12.5, padding: '6px 10px', cursor: 'pointer', outline: 'none', marginBottom: 8,
        }}
      >
        <option value="">— bind a knowledge base —</option>
        {kbs.map((k) => <option key={k.id} value={k.id}>{k.name} [{k.scope}]</option>)}
      </select>
      {/* A project carries a SINGLE brain — once one is bound, the build button is
          hidden (swap via the dropdown above, or unbind with the × chip). */}
      {!boundKb && (
        <div data-section="build-project-brain">
          {/* P3: pick the KB kind before building the brain. */}
          <select
            data-field="kb-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={createState === 'creating' || createState === 'bootstrapping'}
            style={{
              width: '100%', background: 'var(--panel)', border: '1px solid var(--line-2)',
              borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)',
              fontSize: 12.5, padding: '6px 10px', cursor: 'pointer', outline: 'none', marginBottom: 6,
            }}
          >
            {KB_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label} brain</option>)}
          </select>
          <button
            className="btn btn-ghost"
            data-action="create-project-brain"
            style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
            disabled={createState === 'creating' || createState === 'bootstrapping'}
            onClick={handleCreateProjectBrain}
          >
            {createState === 'creating' ? 'Creating…'
              : createState === 'bootstrapping' ? 'Building brain…'
              : createState === 'done' ? '✓ Brain built'
              : '+ Build project brain'}
          </button>
          {createState === 'error' && createError && (
            <div style={{ fontSize: 11, color: 'var(--error, #f87171)', marginTop: 4 }}>
              {createError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
