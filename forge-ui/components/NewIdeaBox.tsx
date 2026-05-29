'use client';

import { useState } from 'react';

import { startArchitect } from '@/lib/bridge-client';

/**
 * ADR 020 — the operator's entry point into the in-UI architect. Captures a
 * project + a free-form idea and POSTs `/api/architect/start`, which seeds the
 * session and spawns the first interview turn. This is the ONLY way the
 * architect starts — forge never auto-starts it (preserves the
 * impossible-to-auto-satisfy property of the human moment).
 */
export function NewIdeaBox({
  knownProjects = [],
  onStarted,
}: {
  knownProjects?: string[];
  onStarted?: (sessionId: string) => void;
}) {
  const [project, setProject] = useState('');
  const [idea, setIdea] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = project.trim().length > 0 && idea.trim().length > 0 && !submitting;

  async function onSubmit(): Promise<void> {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await startArchitect({ project: project.trim(), idea: idea.trim() });
      if (!res.ok) { setError(res.error ?? 'failed to start'); return; }
      setIdea('');
      if (res.sessionId) onStarted?.(res.sessionId);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-section="new-idea"
      data-new-idea-ready={canSubmit ? 'true' : 'false'}
      style={{
        border: '1px solid #30363d',
        borderRadius: 10,
        padding: 16,
        background: '#0d1117',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 10 }}>
        New idea → architect
      </div>
      <input
        list="forge-known-projects"
        value={project}
        onChange={(e) => setProject(e.target.value)}
        placeholder="project"
        data-field="project"
        style={inputStyle}
      />
      <datalist id="forge-known-projects">
        {knownProjects.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Describe the idea, pain point, or brief…"
        rows={3}
        data-field="idea"
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />
      {error && (
        <div data-new-idea-error style={{ color: '#f85149', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}
      <button
        onClick={() => void onSubmit()}
        disabled={!canSubmit}
        data-action="start-architect"
        style={{
          background: canSubmit ? '#238636' : '#21262d',
          color: canSubmit ? '#fff' : '#8b949e',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: '6px 14px',
          fontSize: 13,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        {submitting ? 'Starting…' : 'Start architect'}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#010409',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  marginBottom: 10,
};
