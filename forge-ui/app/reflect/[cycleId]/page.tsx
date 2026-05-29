'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  fetchReflection,
  fetchEvents,
  postReflectionAnswers,
  subscribe,
  type ReflectionData,
  type EventLogEntry,
} from '@/lib/bridge-client';
import { ReflectStageHex } from '@/components/ReflectStageHex';

/**
 * The standalone reflection screen — the third human moment, in-UI (converting
 * the `/forge-reflect` slash command into a page, consistent with the architect
 * + review screens). Renders the reflector's Stage-2 questions
 * (`user-questions.json`) and writes the operator's answers to
 * `user-feedback.md`, which the reflector consumes.
 */
export default function ReflectCyclePage({ params }: { params: { cycleId: string } }): JSX.Element {
  const cycleId = decodeURIComponent(params.cycleId);
  const [data, setData] = useState<ReflectionData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [nowMs, setNowMs] = useState(0);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [freeform, setFreeform] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetchReflection(cycleId).then((d) => { if (!cancelled) { setData(d); setLoaded(true); } }).catch(() => { if (!cancelled) setLoaded(true); });
    };
    refresh();
    fetchEvents(cycleId).then((rows) => { if (!cancelled) setEvents(rows); }).catch(() => {});
    const sub = subscribe({
      onMessage: (msg) => {
        if (msg.type === 'cycle-list-changed' || msg.type === 'snapshot') refresh();
        else if (msg.type === 'event' && msg.cycleId === cycleId) {
          setEvents((prev) => (prev.some((e) => e.event_id === msg.event.event_id) ? prev : [...prev, msg.event]));
        }
      },
    });
    return () => { cancelled = true; sub.close(); };
  }, [cycleId]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const questions = data?.questions ?? [];
  const allAnswered = questions.length > 0 && questions.every((_, i) => choices[i]);
  const done = submitted || data?.answered;

  async function submit(): Promise<void> {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const answers = questions.map((q, i) => ({ question: q.question, answer: choices[i] ?? '[operator skipped]' }));
      const res = await postReflectionAnswers({ cycleId, answers, freeform: freeform.trim() || undefined });
      if (!res.ok) { setError(res.error ?? 'submit failed'); return; }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      data-page="reflect-cycle"
      data-cycle-id={cycleId}
      data-page-ready={loaded ? 'true' : 'false'}
      data-reflect-answered={done ? 'true' : 'false'}
      style={{ padding: '16px 24px', minHeight: '100vh', maxWidth: 1000, margin: '0 auto' }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 18 }}>
        <Link href="/" data-action="back-to-dashboard" style={{ color: '#58a6ff', fontSize: 13, textDecoration: 'none' }}>← forge</Link>
        <h1 style={{ margin: 0, fontSize: 18, letterSpacing: 0.4 }}>reflect</h1>
        <span style={{ fontSize: 12, color: '#8b949e', fontFamily: 'ui-monospace, Menlo, monospace' }}>{cycleId}</span>
      </header>

      {!loaded ? (
        <div style={{ color: '#8b949e', fontSize: 13 }}>Loading reflection…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
          <ReflectStageHex answered={!!done} events={events} nowMs={nowMs} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: '#e6edf3', marginBottom: 4, fontWeight: 600 }}>
              How did this cycle go?
            </div>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 16 }}>
              Your answers steer what the reflector writes to the brain. The cycle's already merged — this tunes the next one.
            </div>

            {done ? (
              <div data-section="reflect-done" style={{ border: '1px solid #2ea04366', borderRadius: 10, padding: '14px 18px', background: '#07140d', fontSize: 13, color: '#3fb950' }}>
                Reflection captured — the reflector will fold it into the brain. <Link href="/" style={{ color: '#58a6ff' }}>Back to dashboard</Link>.
              </div>
            ) : questions.length === 0 ? (
              <div style={{ border: '1px solid #30363d', borderRadius: 10, padding: '14px 18px', background: '#0d1117', fontSize: 13, color: '#8b949e' }}>
                No reflection questions filed for this cycle yet.
              </div>
            ) : (
              <div data-section="reflect-questions" style={{ border: '1px solid #30363d', borderRadius: 10, padding: 16, background: '#0d1117' }}>
                {questions.map((q, i) => (
                  <fieldset key={i} data-question-index={i} data-question-resolved={choices[i] ? 'true' : 'false'} style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
                    <legend style={{ fontSize: 13, color: '#e6edf3', marginBottom: 6, padding: 0 }}>{q.question}</legend>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {q.options.map((opt) => {
                        const selected = choices[i] === opt.label;
                        return (
                          <label key={opt.label} data-option-label={opt.label} data-option-selected={selected ? 'true' : 'false'}
                            style={{ display: 'flex', gap: 8, alignItems: 'flex-start', border: `1px solid ${selected ? '#1f6feb' : '#30363d'}`, borderRadius: 6, padding: '8px 10px', cursor: 'pointer', background: selected ? '#0d2440' : 'transparent' }}>
                            <input type="radio" name={`rq-${i}`} checked={selected} onChange={() => setChoices((c) => ({ ...c, [i]: opt.label }))} style={{ marginTop: 2 }} />
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
                <textarea value={freeform} onChange={(e) => setFreeform(e.target.value)} placeholder="Anything else worth capturing this cycle…" rows={2} data-field="freeform"
                  style={{ width: '100%', boxSizing: 'border-box', background: '#010409', color: '#e6edf3', border: '1px solid #30363d', borderRadius: 6, padding: '8px 10px', fontSize: 13, marginBottom: 10, resize: 'vertical' }} />
                {error && <div style={{ color: '#f85149', fontSize: 12, marginBottom: 8 }}>{error}</div>}
                <button onClick={() => void submit()} disabled={!allAnswered || submitting} data-action="submit-reflection"
                  style={{ background: allAnswered && !submitting ? '#238636' : '#21262d', color: allAnswered && !submitting ? '#fff' : '#8b949e', border: '1px solid #30363d', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: allAnswered && !submitting ? 'pointer' : 'not-allowed' }}>
                  {submitting ? 'Submitting…' : 'Submit reflection'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
