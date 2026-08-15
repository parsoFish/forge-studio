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
//
// W6-B9 reviewer fix — a pending `questions.json` turn (`deriveSessionTranscript`,
// orchestrator/studio/session-transcript.ts) concatenates every real question's
// text into ONE turn, joined on a blank line — the wire carries no per-question
// boundary. Now that the generic `SessionInteractivePanel`'s single-box
// `question-form` affordance has retired the bespoke per-question
// `ArchitectQuestionForm` fieldset list for instructions, this pane is the
// ONLY place multiple pending questions are structurally observable — so a
// `source === 'questions.json'` turn splits its text on that SAME separator
// and renders each question in its own `[data-transcript-question-index]` element
// (display-only; the wire `SessionTurn.text` shape is unchanged).
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

/** The SAME separator `deriveSessionTranscript` joins pending questions on
 *  (orchestrator/studio/session-transcript.ts) — a shared literal, not
 *  independently guessed, so a change to one side is a visible diff on the
 *  other. */
const QUESTIONS_TURN_SEPARATOR = '\n\n';

function TurnBubble({ turn }: { turn: SessionTurn }): JSX.Element {
  const isAgent = turn.role === 'agent';
  // Gated on `source === 'questions.json'` (never a text-shape guess) — the
  // ONLY turn kind whose text is a joined multi-question blob; every other
  // source's text is a single genuine block (idea.md/prompt.md/feedback.md)
  // that must never be chopped into fake "questions" by a coincidental blank
  // line.
  const questionLines = turn.source === 'questions.json'
    ? turn.text.split(QUESTIONS_TURN_SEPARATOR).filter((line) => line.trim().length > 0)
    : null;
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
      {questionLines ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {questionLines.map((line, i) => (
            <div
              key={i}
              data-transcript-question-index={i}
              style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {line}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {turn.text}
        </div>
      )}
    </div>
  );
}
