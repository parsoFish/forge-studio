'use client';

/**
 * Interactive reflection gate — the third human moment, folded into the unified
 * /artifact viewer (M7-3, D-12). Renders the reflector's Stage-2 questions
 * (`user-questions.json`) and writes the operator's answers to `user-feedback.md`,
 * which the reflector consumes.
 *
 * This is the interactive counterpart to the read-only ReflectionRenderer. It
 * carries the exact data-* contract the e2e harness asserts (re-homed from the
 * retired /reflect/[cycleId] screen):
 *   data-section="reflect-questions" · data-question-index ·
 *   data-question-mode="options|freeform" · data-question-resolved ·
 *   data-option-label · data-option-selected · data-question-freeform ·
 *   data-field="freeform" · data-action="submit-reflection" ·
 *   data-section="reflect-done"
 * forge-nk1y.3: an interactive reflector that filed an EMPTY question list
 * (`filed: true`, no questions, not answered) gets one close act instead of
 * the "not filed yet" note —
 *   data-section="reflect-unasked" · data-action="close-reflection" ·
 *   data-reflect-closed="true" (on reflect-done after the close) ·
 *   data-section="reflect-unreadable" (a filed list that does not parse; no close)
 * R4-09-F3 (automated mode): when every question was reflector-inferred the gate
 * renders a read-only view instead of the form —
 *   data-reflect-automated="true" (on the reflect-questions section) ·
 *   data-question-inferred="true" (per fieldset; "false" in the interactive form) ·
 *   data-question-inferred-badge · data-question-answer (the inferred answer).
 *
 * The form logic (allAnswered gating, answer payload assembly) is unit-tested
 * via the pure helpers below.
 */

import { useState } from 'react';

import {
  postReflectionAnswers,
  postReflectionClose,
  type ReflectionData,
} from '@/lib/bridge-client';
import { reflectionAllAnswered, reflectionAnsweredCount, buildReflectionAnswers, hasInferredAnswers } from '@/lib/reflection-form';
import { disabledAttrs } from '@/lib/disabled-reason';
import { GateBand, decisionCard, gateButton } from '@/components/studio/gate/GateBand';
import { pane, paneHeader, paneTitle, meta, eyebrow, input } from '@/components/studio/gate/styles';

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
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questions = data?.questions ?? [];
  const allAnswered = reflectionAllAnswered(questions, choices);
  const done = submitted || Boolean(data?.answered);
  // R4-09-F3: an automated run self-answered the questions — render the Q&A
  // read-only with provenance badges instead of the operator form (and BEFORE
  // the `done` check, since a self-written user-feedback.md makes it "answered").
  // The durable backend mode is authoritative; the per-question inferred
  // heuristic is a fallback for pre-F3 cycles that predate the mode sidecar.
  const automated = data?.mode === 'automated' || hasInferredAnswers(questions);

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

  async function closeUnasked(): Promise<void> {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await postReflectionClose(cycleId);
      if (!res.ok) {
        setError(res.error ?? 'close failed');
        return;
      }
      setClosed(true);
      setSubmitted(true);
      onSubmitted?.();
    } finally {
      setSubmitting(false);
    }
  }

  if (automated) {
    return (
      <div
        data-section="reflect-questions"
        data-reflect-automated="true"
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-4)',
          background: 'var(--panel)',
        }}
      >
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--text)', marginBottom: 'var(--space-1)', fontWeight: 600 }}>
          Automated reflection
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--dim)', marginBottom: 'var(--space-4)' }}>
          No operator was in the loop — the reflector inferred these answers from the
          cycle logs, demo, and diff. Review them; they steer what lands in the brain.
        </div>
        {questions.map((q, i) => {
          // Per-question provenance (graceful degradation): a question the
          // reflector inferred shows its answer + badge; one it couldn't
          // (partial compliance) shows a distinct "needs review" state rather
          // than hiding the whole surface.
          const isInferred = q.inferred === true;
          return (
            <fieldset
              key={i}
              data-question-index={i}
              data-question-inferred={isInferred ? 'true' : 'false'}
              data-question-resolved={isInferred ? 'true' : 'false'}
              style={{ border: 'none', padding: 0, margin: '0 0 var(--space-3)' }}
            >
              <legend style={{ fontSize: 'var(--text-base)', color: 'var(--text)', marginBottom: 'var(--space-2)', padding: 0 }}>
                {q.question}
              </legend>
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-2)',
                  alignItems: 'flex-start',
                  border: `1px solid ${isInferred ? 'var(--line)' : 'rgba(210,153,34,.5)'}`,
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-2) var(--space-3)',
                  background: isInferred ? 'rgba(88,166,255,.06)' : 'rgba(210,153,34,.06)',
                }}
              >
                <span
                  data-question-inferred-badge
                  style={{
                    fontSize: 'var(--text-xs)',
                    textTransform: 'uppercase',
                    letterSpacing: '.04em',
                    color: isInferred ? 'var(--steel)' : 'var(--amber)',
                    border: `1px solid ${isInferred ? 'var(--steel)' : 'var(--amber)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '0 var(--space-1)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isInferred ? 'inferred' : 'not inferred'}
                </span>
                {isInferred ? (
                  <span data-question-answer style={{ fontSize: 'var(--text-base)', color: 'var(--text)' }}>
                    {q.answer || '—'}
                  </span>
                ) : (
                  <span data-question-not-inferred style={{ fontSize: 'var(--text-base)', color: 'var(--dim)' }}>
                    The reflector could not infer an answer — worth an operator review.
                  </span>
                )}
              </div>
            </fieldset>
          );
        })}
      </div>
    );
  }

  if (done) {
    return (
      <div
        data-section="reflect-done"
        data-reflect-closed={closed ? 'true' : undefined}
        style={{
          border: '1px solid rgba(74,222,128,.4)',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'rgba(74,222,128,.07)',
          fontSize: 'var(--text-base)',
          color: 'var(--green)',
        }}
      >
        {closed
          ? 'Reflection closed — the reflector asked nothing this cycle.'
          : 'Reflection captured — the reflector will fold it into the brain.'}
      </div>
    );
  }

  if (data?.unreadable === true) {
    return (
      <div
        data-section="reflect-unreadable"
        role="alert"
        style={{
          border: '1px solid var(--red)',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--panel)',
          fontSize: 'var(--text-base)',
          color: 'var(--red)',
        }}
      >
        The reflector filed a question list that cannot be read (user-questions.json does not parse). Check the cycle&apos;s log directory.
      </div>
    );
  }

  if (questions.length === 0 && data?.filed === true) {
    return (
      <div
        data-section="reflect-unasked"
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--panel)',
          fontSize: 'var(--text-base)',
          color: 'var(--dim)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <span>The reflector asked no questions this cycle. Close the reflection to clear it from Waiting on you.</span>
        <button
          type="button"
          className="btn"
          data-action="close-reflection"
          disabled={submitting}
          data-disabled-reason={submitting ? 'closing the reflection' : undefined}
          title={submitting ? 'closing the reflection' : undefined}
          onClick={() => void closeUnasked()}
        >
          Close reflection
        </button>
        {error ? <span role="alert" style={{ color: 'var(--red)' }}>{error}</span> : null}
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3) var(--space-4)', background: 'var(--panel)', fontSize: 'var(--text-base)', color: 'var(--dim)' }}>
        No reflection questions filed for this cycle yet.
      </div>
    );
  }

  // The gate shell (forge-mfv5.1.31 row 3): what the reflector asks and the
  // submit first (D-46 — the decision inside viewport 1), the questions below
  // in a pane that scrolls inside.
  const answered = reflectionAnsweredCount(questions, choices);
  const blockedReason = submitting ? 'the reflection is being submitted' : allAnswered ? null : `Answer all ${questions.length} questions to submit`;
  return (
    <div data-section="reflect-questions" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <GateBand
        story={(
          <div style={{ ...pane, padding: 'var(--space-4) var(--space-5)', gap: 'var(--space-2)' }}>
            <div style={eyebrow}>How did this cycle go?</div>
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', lineHeight: 1.45, color: 'var(--text)' }}>
              The reflector asked {questions.length} question{questions.length === 1 ? '' : 's'} about this cycle.
            </p>
            <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--dim)' }}>
              Your answers steer what the reflector writes to the brain. The cycle&apos;s already merged — this tunes the next one.
            </p>
          </div>
        )}
        decision={(
          <aside style={decisionCard}>
            <div style={eyebrow}>Your reflection</div>
            <span data-reflect-answered-count style={{ ...meta, fontSize: 'var(--text-sm)', color: allAnswered ? 'var(--green)' : 'var(--dim)' }}>
              {answered} of {questions.length} answered
            </span>
            <textarea
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              placeholder="Anything else worth capturing this cycle…"
              rows={3}
              data-field="freeform"
              style={{ ...input, resize: 'vertical' }}
            />
            {error && <div role="alert" style={{ color: 'var(--red)', fontSize: 'var(--text-sm)' }}>{error}</div>}
            <button onClick={() => void submit()} {...disabledAttrs(blockedReason)} data-action="submit-reflection" style={gateButton('primary', blockedReason === null)}>
              {submitting ? 'Submitting…' : 'Submit reflection'}
            </button>
          </aside>
        )}
      />

      <div style={pane}>
        <header style={paneHeader}><h2 style={paneTitle}>The reflector&apos;s questions</h2><span style={meta}>{questions.length} · pick an answer for each</span></header>
        <div data-pane-body style={{ height: 'var(--pane-xl)', overflowY: 'auto', padding: 'var(--space-3) var(--space-4)' }}>
          {questions.map((q, i) => {
            const hasOptions = Array.isArray(q.options) && q.options.length > 0;
            return (
              <fieldset
                key={i}
                data-question-index={i}
                data-question-resolved={choices[i] ? 'true' : 'false'}
                data-question-mode={hasOptions ? 'options' : 'freeform'}
                data-question-inferred="false"
                style={{ border: 'none', padding: 0, margin: '0 0 var(--space-4)' }}
              >
                <legend style={{ fontSize: 'var(--text-base)', color: 'var(--text)', marginBottom: 'var(--space-2)', padding: 0, overflowWrap: 'anywhere' }}>
                  {q.question}
                </legend>
                {hasOptions ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {(q.options ?? []).map((opt) => {
                      const selected = choices[i] === opt.label;
                      return (
                        <label
                          key={opt.label}
                          data-option-label={opt.label}
                          data-option-selected={selected ? 'true' : 'false'}
                          style={{
                            display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', cursor: 'pointer',
                            border: `1px solid ${selected ? 'var(--ember)' : 'var(--line)'}`, borderRadius: 'var(--radius-sm)',
                            padding: 'var(--space-2) var(--space-3)', background: selected ? 'rgba(255,158,74,.08)' : 'transparent',
                          }}
                        >
                          <input type="radio" name={`rq-${i}`} checked={selected} onChange={() => setChoices((c) => ({ ...c, [i]: opt.label }))} />
                          <span>
                            <span style={{ fontSize: 'var(--text-base)', color: 'var(--text)', fontWeight: 500 }}>{opt.label}</span>
                            {opt.description ? <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>{opt.description}</span> : null}
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
                    style={{ ...input, resize: 'vertical' }}
                  />
                )}
              </fieldset>
            );
          })}
        </div>
      </div>
    </div>
  );
}

