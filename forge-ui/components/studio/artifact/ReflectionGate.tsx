'use client';

/**
 * Interactive reflection gate — the third human moment, folded into the unified
 * /artifact viewer (M7-3, ADR-031). Renders the reflector's Stage-2 questions
 * (`user-questions.json`) and writes the operator's answers to `user-feedback.md`,
 * which the reflector consumes.
 *
 * This is the interactive counterpart to the read-only ReflectionRenderer. It
 * carries the exact data-* contract the e2e harness asserts (re-homed from the
 * retired /reflect/[cycleId] screen):
 *   data-section="reflect-questions" · data-question-index · data-field="freeform"
 *   data-action="submit-reflection" · data-section="reflect-done"
 *
 * The form logic (allAnswered gating, answer payload assembly) is unit-tested
 * via the pure helpers below.
 */

import { useState } from 'react';

import {
  postReflectionAnswers,
  type ReflectionData,
} from '@/lib/bridge-client';
import { reflectionAllAnswered, buildReflectionAnswers } from '@/lib/reflection-form';

export function ReflectionGate({
  cycleId,
  data,
  onSubmitted,
}: {
  cycleId: string;
  data: ReflectionData | null;
  onSubmitted?: () => void;
}): JSX.Element {
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [freeform, setFreeform] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questions = data?.questions ?? [];
  const allAnswered = reflectionAllAnswered(questions, choices);
  const done = submitted || Boolean(data?.answered);

  async function submit(): Promise<void> {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const answers = buildReflectionAnswers(questions, choices);
      const res = await postReflectionAnswers({
        cycleId,
        answers,
        freeform: freeform.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? 'submit failed');
        return;
      }
      setSubmitted(true);
      onSubmitted?.();
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        data-section="reflect-done"
        style={{
          border: '1px solid rgba(74,222,128,.4)',
          borderRadius: 'var(--radius-sm)',
          padding: '14px 18px',
          background: 'rgba(74,222,128,.07)',
          fontSize: 13,
          color: 'var(--green)',
        }}
      >
        Reflection captured — the reflector will fold it into the brain.
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-sm)',
          padding: '14px 18px',
          background: 'var(--panel)',
          fontSize: 13,
          color: 'var(--dim)',
        }}
      >
        No reflection questions filed for this cycle yet.
      </div>
    );
  }

  return (
    <div
      data-section="reflect-questions"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-sm)',
        padding: 16,
        background: 'var(--panel)',
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4, fontWeight: 600 }}>
        How did this cycle go?
      </div>
      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16 }}>
        Your answers steer what the reflector writes to the brain. The cycle&apos;s
        already merged — this tunes the next one.
      </div>

      {questions.map((q, i) => {
        const hasOptions = Array.isArray(q.options) && q.options.length > 0;
        return (
          <fieldset
            key={i}
            data-question-index={i}
            data-question-resolved={choices[i] ? 'true' : 'false'}
            data-question-mode={hasOptions ? 'options' : 'freeform'}
            style={{ border: 'none', padding: 0, margin: '0 0 14px' }}
          >
            <legend style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6, padding: 0 }}>
              {q.question}
            </legend>
            {hasOptions ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(q.options ?? []).map((opt) => {
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
                        border: `1px solid ${selected ? 'var(--steel)' : 'var(--line)'}`,
                        borderRadius: 6,
                        padding: '8px 10px',
                        cursor: 'pointer',
                        background: selected ? 'rgba(88,166,255,.1)' : 'transparent',
                      }}
                    >
                      <input
                        type="radio"
                        name={`rq-${i}`}
                        checked={selected}
                        onChange={() => setChoices((c) => ({ ...c, [i]: opt.label }))}
                        style={{ marginTop: 2 }}
                      />
                      <span>
                        <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
                          {opt.label}
                        </span>
                        {opt.description ? (
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)' }}>
                            {opt.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={choices[i] ?? ''}
                onChange={(e) => setChoices((c) => ({ ...c, [i]: e.target.value }))}
                placeholder="Your answer…"
                rows={2}
                data-question-freeform
                style={textareaStyle}
              />
            )}
          </fieldset>
        );
      })}

      <textarea
        value={freeform}
        onChange={(e) => setFreeform(e.target.value)}
        placeholder="Anything else worth capturing this cycle…"
        rows={2}
        data-field="freeform"
        style={{ ...textareaStyle, marginBottom: 10 }}
      />
      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <button
        onClick={() => void submit()}
        disabled={!allAnswered || submitting}
        data-action="submit-reflection"
        style={{
          background: allAnswered && !submitting ? '#238636' : 'var(--panel-2)',
          color: allAnswered && !submitting ? '#fff' : 'var(--dim)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: '6px 14px',
          fontSize: 13,
          cursor: allAnswered && !submitting ? 'pointer' : 'not-allowed',
        }}
      >
        {submitting ? 'Submitting…' : 'Submit reflection'}
      </button>
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  resize: 'vertical',
};
