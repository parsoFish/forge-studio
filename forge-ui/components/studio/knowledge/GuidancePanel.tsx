'use client';

import { useState, useCallback } from 'react';
import type { KbNodeArticle } from '@/lib/studio-client';
import { pinGuidance } from '@/lib/studio-client';

interface Props {
  selectedArticle: KbNodeArticle | null;
  kbId: string;
  /** Called on successful pin so the parent can re-fetch the KB graph */
  onPinned?: () => void;
}

export function GuidancePanel({ selectedArticle, kbId, onPinned }: Props) {
  const [text, setText] = useState('');
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetLabel = selectedArticle
    ? `— attaches to "${selectedArticle.title}"`
    : '(no node selected — will float)';

  const handlePin = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || pinning) return;
    setPinning(true);
    setError(null);
    try {
      const result = await pinGuidance(kbId, trimmed, selectedArticle?.id ?? undefined);
      if (result.ok) {
        setText('');
        setPinned(true);
        // Signal for e2e harness
        onPinned?.();
        // Reset the success state after a short delay
        setTimeout(() => setPinned(false), 3000);
      } else {
        setError(result.error ?? 'Pin failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setPinning(false);
    }
  }, [kbId, text, pinning, selectedArticle, onPinned]);

  return (
    <div
      data-guidance-pinned={pinned ? 'true' : undefined}
      style={{ borderBottom: '1px solid var(--line)' }}
    >
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
          disabled={pinning}
        />
        {error && (
          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--red)' }}>{error}</div>
        )}
        {pinned && (
          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--c-kb)' }}>
            Guidance pinned — will appear in graph and be consumed on the next ingest pass.
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <button
            className="btn btn-primary"
            id="pin-guidance-btn"
            style={{ width: '100%' }}
            onClick={() => { void handlePin(); }}
            disabled={!text.trim() || pinning}
          >
            {pinning ? 'Pinning…' : 'Pin guidance'}
          </button>
        </div>
      </div>
    </div>
  );
}
