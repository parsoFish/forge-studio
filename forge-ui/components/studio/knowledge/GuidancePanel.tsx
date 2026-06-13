'use client';

import { useState } from 'react';
import type { KbNodeArticle } from '@/lib/studio-client';

// TODO(M5-3): wire the POST /api/studio/kbs/:id/guidance here once the route exists.
// For M5-2 the panel renders with a present-but-inert button (no POST is made).

interface Props {
  selectedArticle: KbNodeArticle | null;
  kbId: string;
}

export function GuidancePanel({ selectedArticle, kbId: _kbId }: Props) {
  const [text, setText] = useState('');

  const targetLabel = selectedArticle
    ? `— attaches to "${selectedArticle.title}"`
    : '(no node selected — will float)';

  const handlePin = () => {
    // TODO(M5-3): POST to /api/studio/kbs/:id/guidance { text, targetNode: selectedArticle?.id }
    // For now the button is present — the POST wiring lands in M5-3.
    setText('');
  };

  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="panel-head">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M6,1 L7.5,4.5 L11,5 L8.5,7.5 L9.2,11 L6,9.5 L2.8,11 L3.5,7.5 L1,5 L4.5,4.5 Z"
            fill="none" stroke="var(--amber)" strokeWidth="1.2"/>
        </svg>
        HUMAN GUIDANCE
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--faint)', padding: '0 14px 8px', lineHeight: 1.5 }}>
        Leave a note for the next ingest pass — agents decide how to incorporate it.
      </div>

      <div style={{ padding: '0 14px 14px' }}>
        <label className="field-label" htmlFor="guidance-text" style={{ display: 'block', fontSize: 12, fontFamily: 'var(--font-display)', fontWeight: 600, marginBottom: 6, color: 'var(--dim)' }}>
          Note{' '}
          <span id="guidance-target-label" style={{ color: 'var(--faint)', fontWeight: 400 }}>
            {targetLabel}
          </span>
        </label>
        <textarea
          id="guidance-text"
          className="input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. 'The worktree traps theme needs to split: cwd resolution vs path encoding are distinct failure modes.'"
        />
        <div style={{ marginTop: 8 }}>
          <button
            className="btn btn-primary"
            id="pin-guidance-btn"
            style={{ width: '100%' }}
            onClick={handlePin}
            disabled={!text.trim()}
            title="TODO(M5-3): POST wiring"
          >
            Pin guidance
          </button>
        </div>
      </div>
    </div>
  );
}
