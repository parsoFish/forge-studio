'use client';

import type { ReactNode } from 'react';

import type { SessionTurn } from '@/lib/session-client';

// ---------------------------------------------------------------------------
// SessionTranscript — the LEFT-hand chat pane of the shared session shell
// (R2-10 PR2, WI-7). Purely presentational: `turns` and `emptyMessage` are
// handed down already-derived by `lib/session-shell-view.ts`
// (`turnsForStage`/`emptyStageMessage`) — no filtering or grouping logic is
// re-implemented here.
//
// Per-turn data-* contract (docs/forge-ui-dom-and-harness.md):
// `data-turn-index`, `data-turn-role="agent"|"operator"`, `data-turn-stage`,
// `data-turn-source`. `children` renders the kind-specific LIVE interactive
// affordance (question form / briefing / verdict / theme review) below the
// historical turns — the chat pane's equivalent of a composer, except the
// composer is a real, wired form rather than the mockup's disabled input.
// ---------------------------------------------------------------------------

export function SessionTranscript({
  turns,
  emptyMessage,
  children,
}: {
  turns: readonly SessionTurn[];
  emptyMessage: string | null;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div
      data-section="session-transcript"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 16,
        minHeight: 240,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {turns.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic' }}>
            {emptyMessage ?? 'No turns recorded yet.'}
          </div>
        ) : (
          turns.map((turn) => <TurnBubble key={turn.index} turn={turn} />)
        )}
      </div>
      {children}
    </div>
  );
}

function TurnBubble({ turn }: { turn: SessionTurn }): JSX.Element {
  const isAgent = turn.role === 'agent';
  return (
    <div
      data-turn-index={turn.index}
      data-turn-role={turn.role}
      data-turn-stage={turn.stage}
      data-turn-source={turn.source}
      style={{
        alignSelf: isAgent ? 'flex-start' : 'flex-end',
        maxWidth: '92%',
        border: `1px solid ${isAgent ? 'var(--line)' : 'rgba(56,139,253,.35)'}`,
        borderRadius: 8,
        padding: '10px 12px',
        background: isAgent ? 'var(--bg-2)' : 'rgba(56,139,253,.08)',
      }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 4 }}>
        {isAgent ? 'agent' : 'operator'}
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {turn.text}
      </div>
    </div>
  );
}
