'use client';

import { useState } from 'react';

import { postArchitectAnswers, type ArchitectQuestion } from '@/lib/bridge-client';

/**
 * ADR 020 — renders the architect's file-handoff interview round
 * (`questions.json`, the reflector's `StructuredQuestion` shape) as one
 * option-group per question. Every question must be answered before submit;
 * answers POST back to `/api/architect/answer`, which appends the round and
 * spawns the next runner turn.
 */
export function ArchitectQuestionForm({
  project,
  sessionId,
  round,
  questions,
}: {
  project: string;
  sessionId: string;
  round: number;
  questions: ArchitectQuestion[];
}) {
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allAnswered = questions.length > 0 && questions.every((_, i) => choices[i]);

  async function onSubmit(): Promise<void> {
    if (!allAnswered || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const answers = questions.map((q, i) => ({ question: q.question, answer: choices[i] }));
      const res = await postArchitectAnswers({ project, sessionId, answers });
      if (!res.ok) setError(res.error ?? 'failed to submit answers');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-section="architect-interview"
      data-architect-round={round}
      data-questions-answered={allAnswered ? 'true' : 'false'}
      style={{ border: '1px solid #30363d', borderRadius: 10, padding: 16, background: '#0d1117' }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>
        Architect interview — round {round}
      </div>
      {questions.map((q, i) => (
        <fieldset
          key={i}
          data-question-index={i}
          data-question-resolved={choices[i] ? 'true' : 'false'}
          style={{ border: 'none', padding: 0, margin: '0 0 14px' }}
        >
          <legend style={{ fontSize: 13, color: '#e6edf3', marginBottom: 6, padding: 0 }}>
            {q.question}
          </legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {q.options.map((opt) => {
              const selected = choices[i] === opt.label;
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
                    onChange={() => setChoices((c) => ({ ...c, [i]: opt.label }))}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <span style={{ fontSize: 13, color: '#e6edf3', fontWeight: 500 }}>{opt.label}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8b949e' }}>{opt.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
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
