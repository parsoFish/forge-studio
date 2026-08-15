'use client';

import { useState } from 'react';

import { postArchitectAnswers, type ArchitectQuestion } from '@/lib/bridge-client';

/** The shape a kind's answer-submission endpoint shares
 *  (`postArchitectAnswers` in `@/lib/bridge-client`) — parameterising
 *  `onSubmitAnswers` on this rather than a name keeps this component
 *  reusable by any other kind's bespoke interview form (W6-B9: instructions,
 *  its one-time second consumer, migrated onto the generic
 *  `SessionInteractivePanel`'s single-box `question-form` affordance
 *  instead — see that file's own header note — so architect is this
 *  component's only consumer today; the parameterisation stays, since
 *  architect is permanently bespoke, ADR-043 amendment §4, and any FUTURE
 *  bespoke kind would want the same interview-round UI). */
export type QuestionFormSubmitFn = (input: {
  project: string;
  sessionId: string;
  answers: { question: string; answer: string }[];
}) => Promise<{ ok: boolean; error?: string }>;

/**
 * ADR 020 — renders a session kind's file-handoff interview round
 * (`questions.json`, the reflector's `StructuredQuestion` shape) as one
 * option-group per question. Every question must be answered before submit;
 * answers POST back to the kind's answer endpoint, which appends the round
 * and spawns the next runner turn.
 *
 * Free-text override: each question also shows a textarea so the operator can
 * answer in their own words. A non-empty free-text value takes precedence over
 * any selected radio option. Selecting a radio clears the free-text field for
 * that question.
 *
 * Parameterised on `onSubmitAnswers`/`sectionName`/`heading` (all default to
 * architect's own values) rather than hardcoded — originally shared with the
 * instructions kind (R2-10 PR2, WI-8; W6-B9 migrated instructions off it, see
 * this file's header note), so a future bespoke kind can reuse it the same
 * way without a copy/paste fork. Every per-question / per-option `data-*`
 * anchor (`data-question-index`, `data-question-resolved`,
 * `data-option-label`, `data-option-selected`, `data-question-freetext`,
 * `data-questions-answered`, `data-architect-round`,
 * `data-action="submit-answers"`) stays unparameterised either way.
 */
export function ArchitectQuestionForm({
  project,
  sessionId,
  round,
  questions,
  onSubmitAnswers = postArchitectAnswers,
  sectionName = 'architect-interview',
  heading = 'Architect interview',
}: {
  project: string;
  sessionId: string;
  round: number;
  questions: ArchitectQuestion[];
  onSubmitAnswers?: QuestionFormSubmitFn;
  sectionName?: string;
  heading?: string;
}) {
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [freeText, setFreeText] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Resolved answer for a question: free-text wins if non-empty, else radio. */
  function resolvedAnswer(i: number): string {
    return (freeText[i] ?? '').trim() || choices[i] || '';
  }

  const allAnswered = questions.length > 0 && questions.every((_, i) => resolvedAnswer(i) !== '');

  async function onSubmit(): Promise<void> {
    if (!allAnswered || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const answers = questions.map((q, i) => ({ question: q.question, answer: resolvedAnswer(i) }));
      const res = await onSubmitAnswers({ project, sessionId, answers });
      if (!res.ok) setError(res.error ?? 'failed to submit answers');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-section={sectionName}
      data-architect-round={round}
      data-questions-answered={allAnswered ? 'true' : 'false'}
      style={{ border: '1px solid #30363d', borderRadius: 10, padding: 16, background: '#0d1117' }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>
        {heading} — round {round}
      </div>
      {questions.map((q, i) => {
        const answered = resolvedAnswer(i) !== '';
        return (
          <fieldset
            key={i}
            data-question-index={i}
            data-question-resolved={answered ? 'true' : 'false'}
            style={{ border: 'none', padding: 0, margin: '0 0 14px' }}
          >
            <legend style={{ fontSize: 13, color: '#e6edf3', marginBottom: 6, padding: 0 }}>
              {q.question}
            </legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(q.options ?? []).map((opt) => {
                const selected = choices[i] === opt.label && (freeText[i] ?? '').trim() === '';
                return (
                  <label
                    key={opt.label}
                    data-option-label={opt.label}
                    data-option-selected={selected ? 'true' : 'false'}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                      border: `1px solid ${selected ? '#1f6feb' : '#30363d'}`,
                      borderRadius: 6,
                      padding: '8px 10px',
                      cursor: 'pointer',
                      background: selected ? '#0d2440' : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      name={`q-${i}`}
                      checked={selected}
                      onChange={() => {
                        setChoices((c) => ({ ...c, [i]: opt.label }));
                        setFreeText((ft) => ({ ...ft, [i]: '' }));
                      }}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      <span style={{ fontSize: 13, color: '#e6edf3', fontWeight: 500 }}>{opt.label}</span>
                      <span style={{ display: 'block', fontSize: 12, color: '#8b949e' }}>{opt.description}</span>
                    </span>
                  </label>
                );
              })}
              <textarea
                data-question-freetext={i}
                value={freeText[i] ?? ''}
                onChange={(e) => setFreeText((ft) => ({ ...ft, [i]: e.target.value }))}
                placeholder="Or answer in your own words…"
                rows={2}
                style={{
                  marginTop: 4,
                  width: '100%',
                  background: '#161b22',
                  border: `1px solid ${(freeText[i] ?? '').trim() ? '#1f6feb' : '#30363d'}`,
                  borderRadius: 6,
                  color: '#e6edf3',
                  fontSize: 13,
                  padding: '6px 10px',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </fieldset>
        );
      })}
      {error && (
        <div style={{ color: '#f85149', fontSize: 12, marginBottom: 8 }}>{error}</div>
      )}
      <button
        onClick={() => void onSubmit()}
        disabled={!allAnswered || submitting}
        data-action="submit-answers"
        style={{
          background: allAnswered && !submitting ? '#238636' : '#21262d',
          color: allAnswered && !submitting ? '#fff' : '#8b949e',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: '6px 14px',
          fontSize: 13,
          cursor: allAnswered && !submitting ? 'pointer' : 'not-allowed',
        }}
      >
        {submitting ? 'Submitting…' : 'Submit answers'}
      </button>
    </div>
  );
}
