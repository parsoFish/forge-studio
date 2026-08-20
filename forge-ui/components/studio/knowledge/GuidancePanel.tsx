'use client';

import { useState, useCallback } from 'react';
import type { KbNodeArticle } from '@/lib/studio-client';
import { pinGuidance } from '@/lib/studio-client';

interface Props {
  selectedArticle: KbNodeArticle | null;
  kbId: string;
  /** Called on successful pin so the parent can re-fetch the KB graph */
  onPinned?: () => void;
  /** W7-B2 (knowledge-29): the pinned notes still awaiting an ingest pass
   *  (from the KB detail response) — the visible queue the pin feeds. */
  pendingGuidance?: Array<{ file: string; at: string }>;
}

export function GuidancePanel({ selectedArticle, kbId, onPinned, pendingGuidance = [] }: Props) {
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
            {/* W7-B2 (knowledge-29): honest copy — the note is visible in the
                graph NOW; consumption happens only if/when a reflection pass
                ingests into this KB, which this install may never have run. */}
            Guidance pinned — it appears in the graph now, and is consumed if a reflection
            pass ingests into this KB (see the queue below until then).
          </div>
        )}
        {pendingGuidance.length > 0 && (
          <div data-component="guidance-pending" data-guidance-pending-count={pendingGuidance.length} style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-display)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
              Pinned — awaiting ingest ({pendingGuidance.length})
            </div>
            {pendingGuidance.map((g) => (
              <div key={g.file} data-guidance-note={g.file} style={{ fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--font-mono)', padding: '2px 0' }}>
                {g.at}
              </div>
            ))}
          </div>
        )}
        {/* W6-SW-3 (sweep C4#3): with no kbId (zero-KB roster) the Pin button
            was clickable and fired pinGuidance('', text, undefined). Disable
            it with an explanatory hint instead. */}
        {!kbId && (
          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--faint)' }}>
            Select or create a knowledge base first.
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <button
            className="btn btn-primary"
            id="pin-guidance-btn"
            data-action="pin-guidance"
            style={{ width: '100%' }}
            onClick={() => { void handlePin(); }}
            disabled={!kbId || !text.trim() || pinning}
            title={!kbId ? 'Select or create a knowledge base first.' : undefined}
          >
            {pinning ? 'Pinning…' : 'Pin guidance'}
          </button>
        </div>
      </div>
    </div>
  );
}
