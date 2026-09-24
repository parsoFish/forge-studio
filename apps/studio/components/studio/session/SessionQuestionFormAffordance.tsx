'use client';

import { DRAWER_HEIGHT_VAR } from '../../../lib/drawer-reservation';
import { postSessionAffordance, type SessionAffordance } from '@/lib/session-client';
import { ArchitectQuestionForm } from '@/components/ArchitectQuestionForm';
import { disabledAttrs } from '@/lib/disabled-reason';
import { ErrorLine, sectionStyle, labelStyle, inputStyle } from './session-panel-shared';

// ---------------------------------------------------------------------------
// SessionQuestionFormAffordance — the `question-form` affordance-kind
// renderer, split out of `SessionInteractivePanel.tsx` (bead forge-8vfn.8.3.4,
// pure transfer — behaviour identical to the branch this replaces).
//
// Two shapes, both real, honestly derived wire data:
//   - `affordance.meta.questions` present (`awaiting-answers`) — one control
//     PER question, via `ArchitectQuestionForm`, posting the real question
//     text with each answer (`{answers: [{question, answer}, …]}`) so the
//     durable answers.json (and the transcript derived from it) stays
//     honest.
//   - no `meta.questions` — the single free-text box, carrying BOTH the
//     `awaiting-answers` fallback (an older/malformed payload) and the
//     `briefing` checkpoint every new session starts at; keyed on
//     `affordance.phase === 'briefing'` for copy only, never a session-kind
//     compare. The Send button does NOT require non-empty text — a briefing
//     note is genuinely optional, and an empty interview answer is harmless
//     (the agent can simply re-ask).
// ---------------------------------------------------------------------------

export function SessionQuestionFormAffordance({
  affordance,
  project,
  sessionId,
  kind,
  answerText,
  setAnswerText,
  error,
  busy,
  submit,
  onChanged,
}: {
  affordance: SessionAffordance;
  project: string | null;
  sessionId: string;
  kind: string;
  answerText: string;
  setAnswerText: (value: string) => void;
  error?: string;
  busy: boolean;
  /** The SAME generic submit `SessionInteractivePanel` uses for every
   *  affordance kind — owns the POST, the busy/error state and the
   *  post-success reset. This component never posts on its own for the
   *  free-text path. */
  submit: (affordance: SessionAffordance, body: Record<string, unknown>) => Promise<void>;
  onChanged?: () => void;
}): JSX.Element {
  const pendingQuestions = affordance.meta?.questions ?? [];
  if (pendingQuestions.length > 0) {
    return (
      <div key={affordance.id} data-section="session-affordance" data-affordance-kind="question-form" style={sectionStyle}>
        <ArchitectQuestionForm
          project={project ?? ''}
          sessionId={sessionId}
          round={0}
          questions={pendingQuestions.map((q) => ({ id: q.id, question: q.question, header: q.header ?? '', options: q.options }))}
          sectionName="session-interview"
          heading="Interview"
          onSubmitAnswers={async ({ answers }) => {
            if (!project) return { ok: false, error: 'no project known for this session — cannot submit' };
            const result = await postSessionAffordance(kind, sessionId, affordance.id, { project, answers });
            if (!result.ok) return { ok: false, error: result.error };
            onChanged?.();
            return { ok: true };
          }}
        />
      </div>
    );
  }
  const isBriefing = affordance.phase === 'briefing';
  return (
    <div key={affordance.id} data-section="session-affordance" data-affordance-kind="question-form" style={sectionStyle}>
      <div style={labelStyle}>{isBriefing ? 'Brief the agent (optional)' : 'Answer'}</div>
      {isBriefing && (
        <div style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 6 }}>
          Anything you want the agent to focus on before it starts — leave empty to just start.
        </div>
      )}
      <textarea
        value={answerText}
        onChange={(e) => setAnswerText(e.target.value)}
        placeholder={isBriefing ? 'Focus / guidance (optional)…' : 'Your answer…'}
        rows={3}
        data-field="session-answer"
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />
      {error && <ErrorLine message={error} />}
      <button
        type="button"
        className="btn btn-primary"
        data-action="submit-answers"
        {...disabledAttrs(busy ? 'Submitting…' : null)}
        onClick={() => void submit(affordance, { answers: [{ question: isBriefing ? 'Briefing note' : 'Operator response', answer: answerText.trim() }] })}
        // `forge-8vfn.7.6.6` — clear the fixed activity drawer's band.
        style={{ opacity: busy ? 0.5 : 1, scrollMarginBottom: `var(${DRAWER_HEIGHT_VAR}, 0px)` }}
      >
        {busy ? 'Sending…' : isBriefing ? 'Start →' : 'Send answer'}
      </button>
    </div>
  );
}
